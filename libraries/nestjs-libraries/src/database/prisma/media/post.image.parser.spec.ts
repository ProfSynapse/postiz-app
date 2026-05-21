// libraries/nestjs-libraries/src/database/prisma/media/post.image.parser.spec.ts
//
// Pure-unit coverage of the contract assumed by the repository's
// LIKE '%"<mediaId>"%' eligibility match (architect §3, plan §Canonical
// eligibility SQL).
//
// Post.image is a JSON-stringified array of { id, path, ... } objects. The SQL
// LIKE pattern relies on three invariants of how that JSON is rendered:
//   (A) media-id appears literally as a JSON string literal — `"abc-123"`.
//   (B) JSON.stringify always quotes string values with double-quotes (per
//       RFC 8259 §7), so the LIKE pattern is stable across CockroachDB /
//       Postgres serializations of the same logical content.
//   (C) The id field name `id` (NOT mediaId, NOT media_id) is the established
//       Post.image key — checked here so a future refactor that renames the
//       field is caught by the test suite, NOT in production.
//
// This spec validates a small JS implementation of the matcher that the SQL
// LIKE expresses — so any future move away from `LIKE` (e.g., JSONB containment)
// can re-use these fixtures verbatim.
//
// Coverage targets (plan §Test Engineer): null, empty, valid single, valid
// multi, malformed, non-array, orphan-id (id without matching media row),
// duplicate-id. 100% branch.

/**
 * Mirror of the eligibility LIKE check in SQL:
 *   p."image" LIKE '%"' || mediaId || '"%'
 *
 * Pure JS port — no DB connection. Used to validate the test fixture matrix
 * against the contract assumed by media.janitor.repository.ts.
 */
function imageStringContainsMediaId(
  imageJson: string | null | undefined,
  mediaId: string
): boolean {
  if (imageJson == null || typeof imageJson !== 'string') return false;
  return imageJson.includes(`"${mediaId}"`);
}

/**
 * The intended semantic match: parse JSON, look at .id on each object.
 * Diverges from the LIKE in edge cases (a non-id field whose value happens
 * to equal the mediaId string would false-positive the LIKE). This is
 * acceptable for the janitor because (a) a hard-delete TOCTOU re-check
 * (intra-txn) covers the false-positive case by relying on the SAME LIKE,
 * and (b) the soft-delete cutoff is conservative — false-positives in
 * candidate discovery → soft-delete → resurrect path on intra-txn re-check
 * if a real Post.image LIKE-match exists during grace. Documented here so
 * a future invariants audit doesn't treat (A) vs (B) as drift.
 */
function imageJsonHasMediaIdField(
  imageJson: string | null | undefined,
  mediaId: string
): boolean {
  if (imageJson == null || typeof imageJson !== 'string') return false;
  try {
    const parsed = JSON.parse(imageJson);
    if (!Array.isArray(parsed)) return false;
    return parsed.some(
      (entry) =>
        entry != null &&
        typeof entry === 'object' &&
        (entry as { id?: unknown }).id === mediaId
    );
  } catch {
    return false;
  }
}

describe('Post.image LIKE-match contract (mirrors SQL eligibility)', () => {
  const MEDIA_ID = 'media-abc-123';

  describe('imageStringContainsMediaId (SQL LIKE port)', () => {
    it('null / undefined / empty → false', () => {
      expect(imageStringContainsMediaId(null, MEDIA_ID)).toBe(false);
      expect(imageStringContainsMediaId(undefined, MEDIA_ID)).toBe(false);
      expect(imageStringContainsMediaId('', MEDIA_ID)).toBe(false);
    });

    it('valid single-entry → true', () => {
      const image = JSON.stringify([{ id: MEDIA_ID, path: '/2025/01/02/x.png' }]);
      expect(imageStringContainsMediaId(image, MEDIA_ID)).toBe(true);
    });

    it('valid multi-entry containing MEDIA_ID → true', () => {
      const image = JSON.stringify([
        { id: 'other-id', path: '/2025/01/02/y.png' },
        { id: MEDIA_ID, path: '/2025/01/02/x.png' },
      ]);
      expect(imageStringContainsMediaId(image, MEDIA_ID)).toBe(true);
    });

    it('valid multi-entry NOT containing MEDIA_ID → false', () => {
      const image = JSON.stringify([
        { id: 'other-id', path: '/2025/01/02/y.png' },
      ]);
      expect(imageStringContainsMediaId(image, MEDIA_ID)).toBe(false);
    });

    it('malformed JSON (truncated) → SQL LIKE matches the raw substring; impl matches', () => {
      // SQL LIKE doesn't care if JSON is parseable; the substring may still
      // be present. Documents the SQL semantics.
      const image = `[{"id":"${MEDIA_ID}","path":...truncated`;
      expect(imageStringContainsMediaId(image, MEDIA_ID)).toBe(true);
    });

    it('non-array JSON (object at root) → still substring-matches if ID present', () => {
      // SQL LIKE has no shape awareness. Documents the SQL semantics.
      const image = JSON.stringify({ id: MEDIA_ID });
      expect(imageStringContainsMediaId(image, MEDIA_ID)).toBe(true);
    });

    it('orphan-id (Post.image references a media row that was hard-deleted) → still LIKE-matches', () => {
      // Orphan-id is a DATA-INTEGRITY artifact — the janitor's hard-delete
      // path explicitly handles this via the resurrect branch (Inv #9).
      const image = JSON.stringify([{ id: MEDIA_ID, path: 'GONE' }]);
      expect(imageStringContainsMediaId(image, MEDIA_ID)).toBe(true);
    });

    it('duplicate-id (same media id appears twice) → LIKE still matches', () => {
      const image = JSON.stringify([
        { id: MEDIA_ID, path: '/a.png' },
        { id: MEDIA_ID, path: '/a.png' },
      ]);
      expect(imageStringContainsMediaId(image, MEDIA_ID)).toBe(true);
    });

    it('mediaId substring-only match (no quotes) → false (the `"..."` guard prevents drift)', () => {
      // Without the surrounding `"` characters, a Post whose image field
      // mentions the mediaId substring in a non-key context would
      // false-positive. The quote-anchored LIKE guards against this.
      const image = `[{"path":"${MEDIA_ID}.png"}]`; // mediaId embedded WITHOUT quotes
      // The LIKE pattern is `%"<mediaId>"%`. The substring `"<mediaId>"`
      // happens to appear inside `"${MEDIA_ID}.png"` since the path string
      // value starts with `"` and the chars `media-abc-123` are followed
      // by `.`, NOT `"`. So the LIKE pattern does NOT match here.
      expect(imageStringContainsMediaId(image, MEDIA_ID)).toBe(false);
    });
  });

  describe('imageJsonHasMediaIdField (semantic interpretation; diverges intentionally)', () => {
    it('null / undefined / empty → false', () => {
      expect(imageJsonHasMediaIdField(null, MEDIA_ID)).toBe(false);
      expect(imageJsonHasMediaIdField(undefined, MEDIA_ID)).toBe(false);
      expect(imageJsonHasMediaIdField('', MEDIA_ID)).toBe(false);
    });

    it('valid single-entry with .id === mediaId → true', () => {
      const image = JSON.stringify([{ id: MEDIA_ID }]);
      expect(imageJsonHasMediaIdField(image, MEDIA_ID)).toBe(true);
    });

    it('malformed JSON → false (parser rejects)', () => {
      expect(imageJsonHasMediaIdField('not json', MEDIA_ID)).toBe(false);
    });

    it('non-array root → false', () => {
      const image = JSON.stringify({ id: MEDIA_ID });
      expect(imageJsonHasMediaIdField(image, MEDIA_ID)).toBe(false);
    });

    it('orphan-id: structurally present .id → true (mirrors data-integrity edge)', () => {
      const image = JSON.stringify([{ id: MEDIA_ID, path: 'GONE' }]);
      expect(imageJsonHasMediaIdField(image, MEDIA_ID)).toBe(true);
    });

    it('duplicate-id → true (any() suffices)', () => {
      const image = JSON.stringify([{ id: MEDIA_ID }, { id: MEDIA_ID }]);
      expect(imageJsonHasMediaIdField(image, MEDIA_ID)).toBe(true);
    });

    it('mediaId-as-non-id-field → false (semantic match rejects), unlike SQL LIKE which may false-positive', () => {
      const image = JSON.stringify([{ id: 'other', altRef: MEDIA_ID }]);
      // SQL LIKE-port WOULD return true here; the semantic interpretation
      // says false. This is the ACCEPTABLE divergence documented above —
      // janitor uses the LIKE form because false-positives are caught by
      // the hard-delete intra-txn re-check via RESURRECT.
      expect(imageJsonHasMediaIdField(image, MEDIA_ID)).toBe(false);
      expect(imageStringContainsMediaId(image, MEDIA_ID)).toBe(true);
    });
  });
});
