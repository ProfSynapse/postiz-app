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

  it('accepts an ISO 8601 date', async () => {
    await expectValid({ ...legacy, recordingDate: '2026-05-15' });
  });

  it('accepts an ISO 8601 datetime', async () => {
    await expectValid({
      ...legacy,
      recordingDate: '2026-05-15T10:00:00.000Z',
    });
  });

  it('rejects an invalid date string', async () => {
    await expectInvalidOn(
      { ...legacy, recordingDate: '2026-13-99' },
      'recordingDate'
    );
  });
});

describe('YoutubeSettingsDto — captionsLanguage', () => {
  it('passes when omitted', async () => {
    await expectValid(legacy);
  });

  it('accepts a BCP-47 tag', async () => {
    await expectValid({ ...legacy, captionsLanguage: 'en' });
    await expectValid({ ...legacy, captionsLanguage: 'pt-BR' });
  });

  it('rejects a string with digits', async () => {
    await expectInvalidOn(
      { ...legacy, captionsLanguage: 'en1' },
      'captionsLanguage'
    );
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
