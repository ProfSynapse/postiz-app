// libraries/nestjs-libraries/src/integrations/social/youtube.builders.spec.ts
//
// Phase 1: Unit specs for the four exported pure builders in youtube.provider.ts.
// These exercise request-body composition without invoking the googleapis client
// or running any of the provider's side-effecting code.
//
// Expected counter-test-by-revert cardinalities (per pact-testing-strategies):
// - Revert "categoryId spread" in buildYoutubeSnippet → {2 fail} (snippet test + integration baseline).
// - Revert "publishAt → privacyStatus=private coercion" in buildYoutubeStatus → {2 fail}
//   (this spec's coercion test + the DTO cross-field overlay spec).
// - Revert "fresh array per call" in buildYoutubePartArray (lift to module scope) → {2 fail}
//   (this spec's fresh-array test + the second-consecutive-call regression test below).
// - Revert "recordingDetails block" in buildYoutubeRequestBody → {1 fail} (this spec).

// Mock concurrency.service to bypass the module-load-time Bottleneck.IORedisConnection
// side effect. The builders themselves don't use concurrency — this mock keeps the
// import graph for youtube.provider.ts loadable without a running redis.
jest.mock('@gitroom/helpers/utils/concurrency.service', () => ({
  concurrency: async (_id: string, _max: number, fn: () => Promise<unknown>) =>
    fn(),
}));

import {
  buildYoutubeSnippet,
  buildYoutubeStatus,
  buildYoutubePartArray,
  buildYoutubeRequestBody,
} from './youtube.provider';
import {
  validYoutubeSettings,
  validCaptionMediaDto,
} from './__fixtures__/youtube.fixtures';

describe('buildYoutubeSnippet', () => {
  it('returns title from settings and description from message', () => {
    const snippet = buildYoutubeSnippet(
      validYoutubeSettings({ title: 'My video' }),
      'Body of the post'
    );
    expect(snippet.title).toBe('My video');
    expect(snippet.description).toBe('Body of the post');
  });

  it('omits tags key when tags array is empty (legacy shape preserved)', () => {
    const snippet = buildYoutubeSnippet(
      validYoutubeSettings({ tags: [] }),
      'msg'
    );
    expect(snippet).not.toHaveProperty('tags');
  });

  it('maps tags[].label into snippet.tags when tags is non-empty', () => {
    const snippet = buildYoutubeSnippet(
      validYoutubeSettings({
        tags: [
          { value: 'a', label: 'alpha' },
          { value: 'b', label: 'beta' },
        ],
      }),
      'msg'
    );
    expect(snippet.tags).toEqual(['alpha', 'beta']);
  });

  it('omits categoryId when settings.categoryId is undefined', () => {
    const snippet = buildYoutubeSnippet(validYoutubeSettings(), 'msg');
    expect(snippet).not.toHaveProperty('categoryId');
  });

  it('forwards categoryId verbatim when set', () => {
    const snippet = buildYoutubeSnippet(
      validYoutubeSettings({ categoryId: '22' }),
      'msg'
    );
    expect((snippet as any).categoryId).toBe('22');
  });

  it('omits defaultLanguage when settings.defaultLanguage is undefined', () => {
    const snippet = buildYoutubeSnippet(validYoutubeSettings(), 'msg');
    expect(snippet).not.toHaveProperty('defaultLanguage');
  });

  it('forwards defaultLanguage verbatim when set', () => {
    const snippet = buildYoutubeSnippet(
      validYoutubeSettings({ defaultLanguage: 'en-US' }),
      'msg'
    );
    expect((snippet as any).defaultLanguage).toBe('en-US');
  });
});

describe('buildYoutubeStatus', () => {
  it('returns privacyStatus from settings.type when publishAt is unset', () => {
    expect(buildYoutubeStatus(validYoutubeSettings({ type: 'public' })))
      .toMatchObject({ privacyStatus: 'public' });
    expect(buildYoutubeStatus(validYoutubeSettings({ type: 'unlisted' })))
      .toMatchObject({ privacyStatus: 'unlisted' });
    expect(buildYoutubeStatus(validYoutubeSettings({ type: 'private' })))
      .toMatchObject({ privacyStatus: 'private' });
  });

  it('omits publishAt when not set', () => {
    const status = buildYoutubeStatus(validYoutubeSettings());
    expect(status).not.toHaveProperty('publishAt');
  });

  it('forwards publishAt and forces privacyStatus=private (S3 belt-and-suspenders)', () => {
    // Even if settings.type sneaks through as 'public', the builder coerces.
    const status = buildYoutubeStatus(
      validYoutubeSettings({
        type: 'public',
        publishAt: '2026-06-15T14:00:00.000Z',
      })
    );
    expect(status.privacyStatus).toBe('private');
    expect((status as any).publishAt).toBe('2026-06-15T14:00:00.000Z');
  });

  it('selfDeclaredMadeForKids reflects the boolean coercion', () => {
    expect(
      buildYoutubeStatus(validYoutubeSettings({ selfDeclaredMadeForKids: 'yes' }))
    ).toMatchObject({ selfDeclaredMadeForKids: true });
    expect(
      buildYoutubeStatus(validYoutubeSettings({ selfDeclaredMadeForKids: 'no' }))
    ).toMatchObject({ selfDeclaredMadeForKids: false });
  });
});

describe('buildYoutubePartArray', () => {
  it("returns ['id','snippet','status'] when recordingDate is unset", () => {
    expect(buildYoutubePartArray(validYoutubeSettings())).toEqual([
      'id',
      'snippet',
      'status',
    ]);
  });

  it("appends 'recordingDetails' when settings.recordingDate is set", () => {
    expect(
      buildYoutubePartArray(
        validYoutubeSettings({ recordingDate: '2026-05-15' })
      )
    ).toEqual(['id', 'snippet', 'status', 'recordingDetails']);
  });

  it('returns a FRESH array per call (S9 mutability guard)', () => {
    const a = buildYoutubePartArray(validYoutubeSettings());
    const b = buildYoutubePartArray(validYoutubeSettings());
    expect(a).not.toBe(b); // identity check — different references
    expect(a).toEqual(b);
  });

  it('does NOT leak recordingDetails across consecutive calls (regression guard)', () => {
    // First call WITH recordingDate, second WITHOUT. Verifies no shared array.
    const first = buildYoutubePartArray(
      validYoutubeSettings({ recordingDate: '2026-01-01' })
    );
    expect(first).toContain('recordingDetails');

    const second = buildYoutubePartArray(validYoutubeSettings());
    expect(second).not.toContain('recordingDetails');
  });

  it('caller mutation of returned array does NOT pollute next call', () => {
    // If a future refactor accidentally returns a frozen module-scope value,
    // this would either throw on push (good — visible failure) or pollute the
    // next call (caught by the next assertion).
    const arr = buildYoutubePartArray(validYoutubeSettings());
    arr.push('contentDetails');
    const next = buildYoutubePartArray(validYoutubeSettings());
    expect(next).not.toContain('contentDetails');
  });
});

describe('buildYoutubeRequestBody', () => {
  it('composes snippet + status with no recordingDetails when recordingDate unset', () => {
    const body = buildYoutubeRequestBody(validYoutubeSettings(), 'msg');
    expect(body).toHaveProperty('snippet');
    expect(body).toHaveProperty('status');
    expect(body).not.toHaveProperty('recordingDetails');
  });

  it('adds recordingDetails.recordingDate when settings.recordingDate is set', () => {
    const body = buildYoutubeRequestBody(
      validYoutubeSettings({ recordingDate: '2026-05-15' }),
      'msg'
    );
    expect((body as any).recordingDetails).toEqual({
      recordingDate: '2026-05-15',
    });
  });

  it('full happy path: every new field present yields the expected merged shape', () => {
    const body = buildYoutubeRequestBody(
      validYoutubeSettings({
        title: 'Full payload',
        type: 'private',
        publishAt: '2026-06-15T14:00:00.000Z',
        categoryId: '22',
        defaultLanguage: 'en',
        recordingDate: '2026-05-15',
        captionsLanguage: 'en',
        captions: validCaptionMediaDto(),
        tags: [{ value: 'tag', label: 'tag-label' }],
      }),
      'Description body'
    );

    expect(body).toMatchObject({
      snippet: {
        title: 'Full payload',
        description: 'Description body',
        tags: ['tag-label'],
        categoryId: '22',
        defaultLanguage: 'en',
      },
      status: {
        privacyStatus: 'private',
        publishAt: '2026-06-15T14:00:00.000Z',
      },
      recordingDetails: { recordingDate: '2026-05-15' },
    });
  });

  it('legacy shape (no new fields) keeps backwards compatibility', () => {
    const body = buildYoutubeRequestBody(
      validYoutubeSettings({ title: 'Legacy', type: 'public', tags: [] }),
      'Old description'
    );
    expect(body).toEqual({
      snippet: { title: 'Legacy', description: 'Old description' },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
    });
  });
});
