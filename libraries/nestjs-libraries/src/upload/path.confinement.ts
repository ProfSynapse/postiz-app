/**
 * libraries/nestjs-libraries/src/upload/path.confinement.ts
 *
 * Pure async helper that authoritatively confines a `Media.path` to the
 * configured upload root. Reused by both layers of the two-layer path-guard:
 *
 *   Layer 1 - MediaPathResolver (pre-flight; attribution-rich logs)
 *   Layer 2 - LocalStorage.removeFile (authoritative gate; defense-in-depth)
 *
 * Treats every input as untrusted (Media.path can arrive via /upload-simple,
 * /upload-from-url, or public-api /upload - none of which run through
 * CustomFileValidationPipe; see secretary memory 02db174a). Therefore we MUST
 * NOT trust prefix shape alone - TOCTOU defense relies on realpath + lstat at
 * the moment of intended unlink.
 *
 * Algorithm (executed verbatim per plan §Path-confinement contract):
 *   1. Reject control chars (NUL, CR, LF, anything <0x20 or 0x7F)
 *   2. Classify by shape (in order):
 *        a. `startsWith(${FRONTEND_URL}/uploads/)` -> extract suffix after /uploads/
 *        b. `/^\/\d{4}\/\d{2}\/\d{2}\//` (legacy relative) -> use path as suffix
 *        c. `/^https?:\/\//` (not local prefix) -> `unsupported_scheme`
 *        d. Else -> `unsupported_scheme`
 *   3. `path.resolve(uploadRoot, decodedSuffix)` -> flattens `..` AND
 *      collapses legacy edge cases (`/year//month`, `/./month`).
 *   4. `path.relative(uploadRoot, target)` -> reject if it starts with `..`,
 *      equals `..`, or is absolute -> `traversal`
 *   5. `fs.promises.realpath(target)` -> catches symlinked intermediate dirs
 *      (ENOENT or other -> `realpath_failed`)
 *   6. Re-run step 4 on realpath result -> `symlink` on escape (intermediate
 *      symlink whose realpath leaves the root)
 *   7. `fs.promises.lstat(real).isFile()` -> reject symlinks at leaf, dirs,
 *      fifos, devices -> `non_regular_file` or `symlink`
 *   8. Success -> { ok: true, absolutePath: real }
 *
 * Used by:
 *   - libraries/nestjs-libraries/src/upload/media.path.resolver.ts
 *   - libraries/nestjs-libraries/src/upload/local.storage.ts (defense-in-depth)
 *
 * See: docs/architecture/media-janitor.md §5
 *      docs/plans/media-janitor-plan.md §Path-confinement contract, SD1-SD4
 */
import { promises as fsp } from 'fs';
import path from 'path';

export type ConfinementReason =
  | 'traversal'
  | 'symlink'
  | 'non_regular_file'
  | 'realpath_failed'
  | 'control_char'
  | 'unsupported_scheme';

export type ConfineResult =
  | { ok: true; absolutePath: string }
  | { ok: false; reason: ConfinementReason };

// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_REGEX = /[\x00-\x1f\x7f]/;
const LEGACY_RELATIVE_SHAPE = /^\/\d{4}\/\d{2}\/\d{2}\//;
const HTTP_PREFIX = /^https?:\/\//i;

/**
 * Authoritative path confinement check. Pure function (no caching, no shared
 * state) so it is exhaustively unit-testable (SD3).
 *
 * @param mediaPath  Raw `Media.path` value as stored in the DB (untrusted).
 * @param uploadRoot Absolute path to the configured upload directory
 *                   (must already be absolute; caller is responsible - the
 *                   janitor task validates this at boot).
 * @returns          Discriminated union; never throws on classification or
 *                   on filesystem errors during realpath/lstat (those map to
 *                   typed rejection reasons).
 */
/**
 * Authoritative re-confinement check for an ALREADY-ABSOLUTE filesystem path.
 *
 * Used by `LocalStorage.removeFile` as the defense-in-depth gate (SD1) AFTER
 * the resolver returned a `{kind:'local',absolutePath}`. Skips shape
 * classification (input is not a Media.path; it is the resolved absolute
 * path) and runs steps 4-7 only: confine, realpath, re-confine, lstat.
 *
 * Rejects control chars, non-absolute inputs, anything escaping uploadRoot,
 * anything that fails realpath, and anything that is not a regular file at
 * the leaf (symlink, dir, fifo, device).
 */
export async function verifyAbsolutePath(
  absolutePath: string,
  uploadRoot: string
): Promise<ConfineResult> {
  if (typeof absolutePath !== 'string' || CONTROL_CHAR_REGEX.test(absolutePath)) {
    return { ok: false, reason: 'control_char' };
  }
  if (!path.isAbsolute(absolutePath)) {
    return { ok: false, reason: 'traversal' };
  }

  const target = path.resolve(absolutePath);

  if (!isInsideRoot(target, uploadRoot)) {
    return { ok: false, reason: 'traversal' };
  }

  let real: string;
  try {
    real = await fsp.realpath(target);
  } catch {
    return { ok: false, reason: 'realpath_failed' };
  }

  if (!isInsideRoot(real, uploadRoot)) {
    return { ok: false, reason: 'symlink' };
  }

  let stat;
  try {
    stat = await fsp.lstat(real);
  } catch {
    return { ok: false, reason: 'realpath_failed' };
  }

  if (stat.isSymbolicLink()) {
    return { ok: false, reason: 'symlink' };
  }
  if (!stat.isFile()) {
    return { ok: false, reason: 'non_regular_file' };
  }

  return { ok: true, absolutePath: real };
}

export async function confineAndVerify(
  mediaPath: string,
  uploadRoot: string
): Promise<ConfineResult> {
  // Step 1: reject control chars anywhere in the input.
  if (typeof mediaPath !== 'string' || CONTROL_CHAR_REGEX.test(mediaPath)) {
    return { ok: false, reason: 'control_char' };
  }

  // Step 2: classify shape and extract the suffix relative to uploadRoot.
  const frontendUrl = process.env.FRONTEND_URL ?? '';
  const modernPrefix =
    frontendUrl.length > 0 ? `${frontendUrl}/uploads/` : null;

  let suffix: string;
  if (modernPrefix && mediaPath.startsWith(modernPrefix)) {
    suffix = mediaPath.slice(modernPrefix.length);
    // Strip leading slash so path.resolve(uploadRoot, suffix) anchors here.
    // path.resolve discards earlier args when an absolute segment appears
    // later; keeping suffix relative anchors it under uploadRoot.
    if (suffix.startsWith('/')) {
      suffix = suffix.slice(1);
    }
  } else if (LEGACY_RELATIVE_SHAPE.test(mediaPath)) {
    suffix = mediaPath.startsWith('/') ? mediaPath.slice(1) : mediaPath;
  } else if (HTTP_PREFIX.test(mediaPath)) {
    return { ok: false, reason: 'unsupported_scheme' };
  } else {
    return { ok: false, reason: 'unsupported_scheme' };
  }

  // Decode percent-encoding before joining. Malformed encodings reject.
  let decodedSuffix: string;
  try {
    decodedSuffix = decodeURIComponent(suffix);
  } catch {
    return { ok: false, reason: 'traversal' };
  }

  // Step 3: resolve. path.resolve collapses `..`, `.`, and consecutive
  // separators.
  const target = path.resolve(uploadRoot, decodedSuffix);

  // Step 4: confine to uploadRoot.
  if (!isInsideRoot(target, uploadRoot)) {
    return { ok: false, reason: 'traversal' };
  }

  // Step 5: realpath resolves intermediate symlinks. ENOENT and friends
  // all collapse to a single typed reason.
  let real: string;
  try {
    real = await fsp.realpath(target);
  } catch {
    return { ok: false, reason: 'realpath_failed' };
  }

  // Step 6: re-confine after realpath. An intermediate symlink whose target
  // escapes the upload root is rejected here.
  if (!isInsideRoot(real, uploadRoot)) {
    return { ok: false, reason: 'symlink' };
  }

  // Step 7: lstat rejects leaf symlinks, dirs, fifos, devices.
  let stat;
  try {
    stat = await fsp.lstat(real);
  } catch {
    return { ok: false, reason: 'realpath_failed' };
  }

  if (stat.isSymbolicLink()) {
    return { ok: false, reason: 'symlink' };
  }
  if (!stat.isFile()) {
    return { ok: false, reason: 'non_regular_file' };
  }

  return { ok: true, absolutePath: real };
}

function isInsideRoot(target: string, root: string): boolean {
  const normalizedRoot = path.resolve(root);
  const rel = path.relative(normalizedRoot, target);
  if (rel === '') {
    // The target IS the root directory itself, never a valid file path.
    return false;
  }
  if (rel === '..' || rel.startsWith(`..${path.sep}`)) {
    return false;
  }
  if (path.isAbsolute(rel)) {
    return false;
  }
  return true;
}
