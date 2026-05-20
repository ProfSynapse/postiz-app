// libraries/nestjs-libraries/src/integrations/social/youtube.settings.dto.spec.ts
//
// Phase 3: DTO validation spec for YoutubeSettingsDto + the new CaptionMediaDto
// sibling. Covers:
//   - Backwards-compat: legacy 5-field payloads still validate.
//   - 6 new @IsOptional() fields: valid / invalid / omitted matrix.
//   - Decorator-order regression: each new field with undefined input passes.
//   - S3 cross-field overlay: publishAt + non-private type → validation error.
//   - CaptionMediaDto dual-validator stack: ValidUrlPath + ValidCaptionUrlExtension.
//
// Validation pipeline mirrors production: posts.service.ts:122-128 instantiates
// `new ValidationPipe({ skipMissingProperties:false, transform:true,
// transformOptions:{ enableImplicitConversion:true } })`. We instantiate the
// same pipe for fidelity. We also exercise class-validator's `validate()` on
// `plainToInstance()` output for unit speed where pipe behavior is not
// load-bearing.
//
// Expected counter-test-by-revert cardinalities:
// - Revert S3 cross-field overlay (`@ValidateIf((o)=>o.publishAt) @IsIn(['private'])`)
//   → {3 fail} (rejects-public, rejects-unlisted, accepts-private-with-publishAt).
// - Revert `@IsOptional()` from any new field → {2-3 fail} (omitted-passes
//   tests for that field) — silent regression vector.

import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { ValidationPipe } from '@nestjs/common';
import { YoutubeSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/youtube.settings.dto';
import { CaptionMediaDto } from '@gitroom/nestjs-libraries/dtos/media/caption.media.dto';

async function expectValid(payload: Record<string, unknown>): Promise<void> {
  const instance = plainToInstance(YoutubeSettingsDto, payload);
  const errors = await validate(instance);
  if (errors.length) {
    // Surface the failing constraints to make CI output diagnosable.
    throw new Error(
      `Expected payload to validate but got errors:\n${formatErrors(errors)}`
    );
  }
}

async function expectInvalidOn(
  payload: Record<string, unknown>,
  property: string
): Promise<ValidationError> {
  const instance = plainToInstance(YoutubeSettingsDto, payload);
  const errors = await validate(instance);
  const target = errors.find((e) => e.property === property);
  if (!target) {
    throw new Error(
      `Expected validation error on '${property}' but got:\n${formatErrors(errors)}`
    );
  }
  return target;
}

function formatErrors(errors: ValidationError[]): string {
  return errors
    .map((e) => `  ${e.property}: ${JSON.stringify(e.constraints)}`)
    .join('\n');
}

const legacy: Record<string, unknown> = {
  title: 'Legacy video',
  type: 'public',
  selfDeclaredMadeForKids: 'no',
  tags: [],
};

describe('YoutubeSettingsDto — backwards compatibility', () => {
  it('accepts the legacy 5-field payload (title, type, selfDeclaredMadeForKids, tags)', async () => {
    await expectValid(legacy);
  });

  it('accepts the legacy payload with thumbnail attached', async () => {
    await expectValid({
      ...legacy,
      thumbnail: { id: 'thumb-1', path: 'https://cdn.example.com/x.png' },
    });
  });

  it('accepts the legacy payload with private + unlisted types', async () => {
    await expectValid({ ...legacy, type: 'private' });
    await expectValid({ ...legacy, type: 'unlisted' });
  });
});

describe('YoutubeSettingsDto — selfDeclaredMadeForKids (M8 omitted-branch)', () => {
  // M8: explicit branch coverage for the @IsOptional() field being absent from
  // the body. buildYoutubeStatus() in youtube.provider.ts:52 evaluates
  // `settings.selfDeclaredMadeForKids === 'yes'` — undefined coerces to false.
  // A regression that flipped the strict-equality to `!== 'no'` would silently
  // change omitted-input behavior. Anchor that branch here.
  it('passes validation when selfDeclaredMadeForKids is omitted entirely', async () => {
    const { selfDeclaredMadeForKids: _omit, ...withoutKidsFlag } = legacy;
    void _omit; // discard
    await expectValid(withoutKidsFlag);
  });

  it('accepts the legacy enum values explicitly (no-regression anchor)', async () => {
    await expectValid({ ...legacy, selfDeclaredMadeForKids: 'yes' });
    await expectValid({ ...legacy, selfDeclaredMadeForKids: 'no' });
  });

  it('rejects a value outside the {yes,no} enum', async () => {
    await expectInvalidOn(
      { ...legacy, selfDeclaredMadeForKids: 'maybe' },
      'selfDeclaredMadeForKids'
    );
  });
});

describe('YoutubeSettingsDto — categoryId', () => {
  it('passes when omitted (decorator-order regression guard)', async () => {
    await expectValid(legacy);
  });

  it('accepts a numeric string', async () => {
    await expectValid({ ...legacy, categoryId: '22' });
  });

  it('rejects a non-numeric string', async () => {
    const err = await expectInvalidOn(
      { ...legacy, categoryId: 'abc' },
      'categoryId'
    );
    expect(err.constraints).toHaveProperty('matches');
  });

  it('rejects a present-but-wrong-type input (number, not string)', async () => {
    await expectInvalidOn({ ...legacy, categoryId: 22 }, 'categoryId');
  });
});

describe('YoutubeSettingsDto — publishAt', () => {
  it('passes when omitted', async () => {
    await expectValid(legacy);
  });

  it('accepts a valid ISO 8601 timestamp with type=private', async () => {
    await expectValid({
      ...legacy,
      type: 'private',
      publishAt: '2026-06-15T14:00:00.000Z',
    });
  });

  it('rejects a non-ISO string', async () => {
    await expectInvalidOn(
      {
        ...legacy,
        type: 'private',
        publishAt: 'not-a-date',
      },
      'publishAt'
    );
  });
});

describe('YoutubeSettingsDto — S3 cross-field overlay (publishAt requires type=private)', () => {
  it('rejects publishAt with type=public', async () => {
    const err = await expectInvalidOn(
      {
        ...legacy,
        type: 'public',
        publishAt: '2026-06-15T14:00:00.000Z',
      },
      'type'
    );
    expect(JSON.stringify(err.constraints)).toContain('private');
  });

  it('rejects publishAt with type=unlisted', async () => {
    const err = await expectInvalidOn(
      {
        ...legacy,
        type: 'unlisted',
        publishAt: '2026-06-15T14:00:00.000Z',
      },
      'type'
    );
    expect(JSON.stringify(err.constraints)).toContain('private');
  });

  it('accepts publishAt when type=private (S3 happy path)', async () => {
    await expectValid({
      ...legacy,
      type: 'private',
      publishAt: '2026-06-15T14:00:00.000Z',
    });
  });

  it('without publishAt, the overlay does NOT fire and any valid type is fine', async () => {
    // Falsifies whether the overlay over-fires — when publishAt is absent,
    // `@ValidateIf` short-circuits and type=public must still pass.
    await expectValid({ ...legacy, type: 'public' });
  });
});

describe('YoutubeSettingsDto — defaultLanguage', () => {
  it('passes when omitted', async () => {
    await expectValid(legacy);
  });

  it.each([
    ['en'],
    ['en-US'],
    ['zh-Hant'],
    ['fr-CA'],
  ])('accepts BCP-47 tag %s', async (tag) => {
    await expectValid({ ...legacy, defaultLanguage: tag });
  });

  it('rejects a string with digits', async () => {
    await expectInvalidOn({ ...legacy, defaultLanguage: 'en1' }, 'defaultLanguage');
  });

  it('rejects a present-but-wrong-type input (number)', async () => {
    await expectInvalidOn(
      { ...legacy, defaultLanguage: 123 },
      'defaultLanguage'
    );
  });
});

describe('YoutubeSettingsDto — recordingDate', () => {
  it('passes when omitted', async () => {
    await expectValid(legacy);
  });

  it('accepts an ISO 8601 date (YYYY-MM-DD)', async () => {
    await expectValid({ ...legacy, recordingDate: '2026-05-15' });
  });

  it('M10: rejects an ISO 8601 datetime (YouTube API rejects non-date forms)', async () => {
    const err = await expectInvalidOn(
      { ...legacy, recordingDate: '2026-05-15T10:00:00.000Z' },
      'recordingDate'
    );
    expect(err.constraints).toHaveProperty('matches');
  });

  it('M10: rejects a date with trailing whitespace', async () => {
    await expectInvalidOn(
      { ...legacy, recordingDate: '2026-05-15 ' },
      'recordingDate'
    );
  });

  it('rejects an invalid date string', async () => {
    await expectInvalidOn(
      { ...legacy, recordingDate: '2026-13-99' },
      'recordingDate'
    );
  });
});

describe('YoutubeSettingsDto — captionsLanguage', () => {
  const withCaptionsAttached = (extra: Record<string, unknown> = {}) => ({
    ...legacy,
    captions: { id: 'cap-1', path: 'https://cdn.example.com/captions.srt' },
    ...extra,
  });

  it('M1: passes when omitted with no captions attached', async () => {
    await expectValid(legacy);
  });

  it('M1: passes when value is set but captions is absent (gated by @ValidateIf — value ignored)', async () => {
    await expectValid({ ...legacy, captionsLanguage: 'en' });
  });

  it('accepts a BCP-47 tag when captions are attached', async () => {
    await expectValid(withCaptionsAttached({ captionsLanguage: 'en' }));
    await expectValid(withCaptionsAttached({ captionsLanguage: 'pt-BR' }));
  });

  it('M1: rejects a malformed tag when captions are attached (gate fires)', async () => {
    await expectInvalidOn(
      withCaptionsAttached({ captionsLanguage: 'en1' }),
      'captionsLanguage'
    );
  });
});

describe('YoutubeSettingsDto — M15 length caps', () => {
  it('M15: rejects categoryId longer than 10 chars', async () => {
    await expectInvalidOn(
      { ...legacy, categoryId: '12345678901' },
      'categoryId'
    );
  });

  it('M15: rejects defaultLanguage longer than 35 chars', async () => {
    await expectInvalidOn(
      { ...legacy, defaultLanguage: 'a'.repeat(36) },
      'defaultLanguage'
    );
  });

  it('M15: rejects captionsLanguage longer than 35 chars (when captions attached)', async () => {
    await expectInvalidOn(
      {
        ...legacy,
        captions: { id: 'cap-1', path: 'https://cdn.example.com/captions.srt' },
        captionsLanguage: 'a'.repeat(36),
      },
      'captionsLanguage'
    );
  });

  it('M15: accepts categoryId at boundary (10 chars)', async () => {
    await expectValid({ ...legacy, categoryId: '1234567890' });
  });
});

describe('YoutubeSettingsDto — M11 presigned URL acceptance', () => {
  it('M11: accepts captions.path with multi-key query string (presigned-style)', async () => {
    await expectValid({
      ...legacy,
      captions: {
        id: 'cap-1',
        path: 'https://bucket.s3.amazonaws.com/folder/captions.srt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeef',
      },
    });
  });

  it('M11: accepts captions.path with fragment after the extension', async () => {
    await expectValid({
      ...legacy,
      captions: {
        id: 'cap-1',
        path: 'https://cdn.example.com/captions.vtt#track1',
      },
    });
  });

  it('M11: accepts captions.path with uppercase extension', async () => {
    await expectValid({
      ...legacy,
      captions: {
        id: 'cap-1',
        path: 'https://cdn.example.com/CAPTIONS.SRT',
      },
    });
  });

  it('M11: still rejects an extensionless presigned URL', async () => {
    const err = await expectInvalidOn(
      {
        ...legacy,
        captions: {
          id: 'cap-1',
          path: 'https://bucket.s3.amazonaws.com/abc123def?X-Amz-Signature=xyz',
        },
      },
      'captions'
    );
    const pathErr = err.children?.find((c) => c.property === 'path');
    expect(pathErr).toBeDefined();
    expect(JSON.stringify(pathErr?.constraints)).toContain('extension');
  });
});

describe('YoutubeSettingsDto — captions (nested CaptionMediaDto)', () => {
  it('passes when omitted', async () => {
    await expectValid(legacy);
  });

  it('accepts a valid CaptionMediaDto with .srt extension', async () => {
    await expectValid({
      ...legacy,
      captions: {
        id: 'cap-1',
        path: 'https://cdn.example.com/captions.srt',
      },
    });
  });

  it('accepts a valid CaptionMediaDto with .vtt extension', async () => {
    await expectValid({
      ...legacy,
      captions: {
        id: 'cap-1',
        path: 'https://cdn.example.com/captions.vtt',
      },
    });
  });

  it('rejects a CaptionMediaDto missing required path', async () => {
    const err = await expectInvalidOn(
      { ...legacy, captions: { id: 'cap-1' } },
      'captions'
    );
    expect(err.children?.some((c) => c.property === 'path')).toBe(true);
  });

  it('rejects a non-srt/non-vtt extension on captions.path', async () => {
    const err = await expectInvalidOn(
      {
        ...legacy,
        captions: { id: 'cap-1', path: 'https://cdn.example.com/captions.mp4' },
      },
      'captions'
    );
    // Nested validation surface — the child's `path` constraint should fail
    // via ValidCaptionUrlExtension.
    const pathErr = err.children?.find((c) => c.property === 'path');
    expect(pathErr).toBeDefined();
    expect(JSON.stringify(pathErr?.constraints)).toContain('extension');
  });

  it('rejects captions.path with a .txt extension (M7 explicit symmetry with .mp4)', async () => {
    // M7: .srt and .vtt are the only accepted caption extensions per
    // valid.caption.url.path.ts. A regression that loosens
    // ValidCaptionUrlExtension to accept .txt (e.g., adding plain-text caption
    // support without YouTube API alignment) would silently widen the surface.
    // Anchor .txt rejection symmetrically with the existing .mp4 case.
    const err = await expectInvalidOn(
      {
        ...legacy,
        captions: { id: 'cap-1', path: 'https://cdn.example.com/captions.txt' },
      },
      'captions'
    );
    const pathErr = err.children?.find((c) => c.property === 'path');
    expect(pathErr).toBeDefined();
    expect(JSON.stringify(pathErr?.constraints)).toContain('extension');
  });

  it('accepts a captions.path with query string after the extension', async () => {
    // ValidCaptionUrlExtension strips ?... before checking endsWith.
    await expectValid({
      ...legacy,
      captions: {
        id: 'cap-1',
        path: 'https://cdn.example.com/captions.srt?signature=abc123',
      },
    });
  });
});

describe('YoutubeSettingsDto — production ValidationPipe round trip', () => {
  // Mirrors posts.service.ts:122-128 so the test catches discriminator +
  // implicit-conversion edge cases the user actually hits in prod.
  const pipe = new ValidationPipe({
    skipMissingProperties: false,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  it('full happy-path payload survives the production pipe', async () => {
    const out = await pipe.transform(
      {
        title: 'Pipe test',
        type: 'private',
        selfDeclaredMadeForKids: 'no',
        tags: [{ value: 'a', label: 'A' }],
        categoryId: '22',
        publishAt: '2026-06-15T14:00:00.000Z',
        defaultLanguage: 'en',
        recordingDate: '2026-05-15',
        captionsLanguage: 'en',
        captions: {
          id: 'cap-1',
          path: 'https://cdn.example.com/captions.srt',
        },
      },
      { type: 'body', metatype: YoutubeSettingsDto }
    );
    expect(out).toBeInstanceOf(YoutubeSettingsDto);
    expect(out.categoryId).toBe('22');
    expect(out.captions).toBeInstanceOf(CaptionMediaDto);
  });

  it('S3 cross-field overlay fires through the production pipe', async () => {
    await expect(
      pipe.transform(
        {
          title: 'Pipe test',
          type: 'public',
          tags: [],
          publishAt: '2026-06-15T14:00:00.000Z',
        },
        { type: 'body', metatype: YoutubeSettingsDto }
      )
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('CaptionMediaDto — direct validation', () => {
  it('requires id and path', async () => {
    const errors = await validate(plainToInstance(CaptionMediaDto, {}));
    const props = errors.map((e) => e.property);
    expect(props).toEqual(expect.arrayContaining(['id', 'path']));
  });

  it('rejects path missing extension', async () => {
    const errors = await validate(
      plainToInstance(CaptionMediaDto, {
        id: 'x',
        path: 'https://cdn.example.com/file',
      })
    );
    const pathErr = errors.find((e) => e.property === 'path');
    expect(pathErr).toBeDefined();
    expect(JSON.stringify(pathErr?.constraints)).toContain('extension');
  });

  it('rejects path ending in .txt at the direct-validation layer (M7)', async () => {
    // M7 mirror: a CaptionMediaDto instance constructed without going through
    // the parent YoutubeSettingsDto must also reject .txt. Future callers may
    // validate CaptionMediaDto in isolation (e.g., an MCP tool route); this
    // guards them too.
    const errors = await validate(
      plainToInstance(CaptionMediaDto, {
        id: 'x',
        path: 'https://cdn.example.com/captions.txt',
      })
    );
    const pathErr = errors.find((e) => e.property === 'path');
    expect(pathErr).toBeDefined();
    expect(JSON.stringify(pathErr?.constraints)).toContain('extension');
  });

  it('respects RESTRICT_UPLOAD_DOMAINS via ValidUrlPath when env is set', async () => {
    const prev = process.env.RESTRICT_UPLOAD_DOMAINS;
    try {
      process.env.RESTRICT_UPLOAD_DOMAINS = 'trusted-cdn.com';
      const errors = await validate(
        plainToInstance(CaptionMediaDto, {
          id: 'x',
          path: 'https://untrusted.com/file.srt',
        })
      );
      const pathErr = errors.find((e) => e.property === 'path');
      expect(pathErr).toBeDefined();
      // The ValidUrlPath message references the env var contents.
      expect(JSON.stringify(pathErr?.constraints)).toContain('trusted-cdn.com');
    } finally {
      if (prev === undefined) delete process.env.RESTRICT_UPLOAD_DOMAINS;
      else process.env.RESTRICT_UPLOAD_DOMAINS = prev;
    }
  });

  it('passes when both ValidUrlPath (env unset) and ValidCaptionUrlExtension are satisfied', async () => {
    delete process.env.RESTRICT_UPLOAD_DOMAINS;
    const errors = await validate(
      plainToInstance(CaptionMediaDto, {
        id: 'x',
        path: 'https://cdn.example.com/cap.vtt',
      })
    );
    expect(errors).toEqual([]);
  });
});
