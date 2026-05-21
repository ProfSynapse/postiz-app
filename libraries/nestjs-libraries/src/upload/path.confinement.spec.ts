// libraries/nestjs-libraries/src/upload/path.confinement.spec.ts
//
// Unit coverage for the authoritative path-guard (architect §5, plan §Path-
// confinement contract, SD1-SD4, invariants #1/#7/#8).
//
// confineAndVerify is the Media.path entrypoint (8-step algorithm).
// verifyAbsolutePath is the LocalStorage layer-2 gate (steps 4-7 only).
//
// Tests use a real tmpfs scratch root so realpath / lstat exercise the actual
// filesystem semantics the production code relies on. Adversarial fixtures
// cover the security-engineer's SD2 surface (traversal, symlink escape via
// intermediate dirs, leaf symlink, control chars, non-regular file, malformed
// percent-encoding, unsupported schemes).
//
// Counter-test-by-revert mandated by plan §Test Engineer on path-guard:
// each of the 7 reject reasons is paired with an inverse positive case that
// would flip RED if confineAndVerify drifted away from the contract.
import { promises as fsp } from 'fs';
import { mkdtemp, mkdir, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import {
  confineAndVerify,
  verifyAbsolutePath,
  ConfinementReason,
} from './path.confinement';

// Control-char fixtures as String.fromCharCode references so the source file
// stays UTF-8 — inline raw NUL / DEL bytes flip git into binary-file mode and
// the spec becomes invisible in PR review UIs (Task #22 finding B1).
const NUL = String.fromCharCode(0);
const DEL = String.fromCharCode(0x7f);

describe('confineAndVerify (Media.path entrypoint)', () => {
  let root: string; // tmpfs upload root, realpath-resolved
  let rootRaw: string; // un-realpathed (may differ on macOS /var vs /private/var)
  const originalFrontendUrl = process.env.FRONTEND_URL;

  const FRONTEND = 'https://app.example.test';

  beforeAll(async () => {
    rootRaw = await mkdtemp(path.join(tmpdir(), 'mj-confine-'));
    root = await fsp.realpath(rootRaw);

    // Seed a populated YYYY/MM/DD tree with a regular file and a leaf symlink
    // pointing OUTSIDE the root (the canonical SD2 attack).
    await mkdir(path.join(root, '2025', '01', '02'), { recursive: true });
    await writeFile(path.join(root, '2025', '01', '02', 'real.png'), 'PNG');
    // Seed for MINOR-3 positive baseline: substring `..` in filename must
    // NOT trip rule (a). Rule (a) splits on `/\` and rejects segments
    // strictly equal to `..` — a filename merely CONTAINING `..` is legal.
    await writeFile(
      path.join(root, '2025', '01', '02', 'my..file.png'),
      'PNG'
    );

    // Outside-root file (target of escape symlink and intermediate-symlink test)
    const outsideRoot = await fsp.realpath(
      await mkdtemp(path.join(tmpdir(), 'mj-confine-outside-'))
    );
    await writeFile(path.join(outsideRoot, 'secret.txt'), 'SECRET');

    await symlink(
      path.join(outsideRoot, 'secret.txt'),
      path.join(root, '2025', '01', '02', 'escape.png')
    );

    // Intermediate-symlink: dir-level symlink that escapes the root.
    await symlink(
      outsideRoot,
      path.join(root, '2025', '01', '02', 'escape-dir')
    );

    // Non-regular file: a directory at a leaf the resolver would consider
    // a Media path.
    await mkdir(path.join(root, '2025', '01', '03'), { recursive: true });
    await mkdir(path.join(root, '2025', '01', '03', 'isdir.png'));

    process.env.FRONTEND_URL = FRONTEND;
  });

  afterAll(async () => {
    if (originalFrontendUrl === undefined) {
      delete process.env.FRONTEND_URL;
    } else {
      process.env.FRONTEND_URL = originalFrontendUrl;
    }
    // Best-effort cleanup; tmpdir cleanup by the OS suffices on test failure.
    await fsp.rm(rootRaw, { recursive: true, force: true }).catch(() => {});
  });

  describe('positive cases (counter-test-by-revert anchors)', () => {
    it('accepts modern URL shape ${FRONTEND_URL}/uploads/YYYY/MM/DD/file', async () => {
      const input = `${FRONTEND}/uploads/2025/01/02/real.png`;
      const result = await confineAndVerify(input, root);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.absolutePath).toBe(
          path.join(root, '2025', '01', '02', 'real.png')
        );
      }
    });

    it('accepts legacy relative shape /YYYY/MM/DD/file', async () => {
      const input = '/2025/01/02/real.png';
      const result = await confineAndVerify(input, root);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.absolutePath).toBe(
          path.join(root, '2025', '01', '02', 'real.png')
        );
      }
    });

    it('decodes percent-encoded filenames', async () => {
      const encodedName = 'with%20space.png';
      await writeFile(
        path.join(root, '2025', '01', '02', 'with space.png'),
        'PNG'
      );
      const result = await confineAndVerify(
        `/2025/01/02/${encodedName}`,
        root
      );
      expect(result.ok).toBe(true);
    });

    // MINOR-3: positive-baseline pin for rule (a). The filename `my..file.png`
    // CONTAINS the substring `..` but no path SEGMENT === `..` (segments are
    // split on `/\`). Rule (a) must permit this. Counter-test-by-revert: if
    // rule (a) were rewritten to use `.includes('..')` instead of
    // `.includes(..)` on segments, this test would flip RED with `traversal`.
    it('accepts filename containing `..` substring (rule a segment-equality, not substring)', async () => {
      const input = `${FRONTEND}/uploads/2025/01/02/my..file.png`;
      const result = await confineAndVerify(input, root);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.absolutePath).toBe(
          path.join(root, '2025', '01', '02', 'my..file.png')
        );
      }
    });
  });

  describe('adversarial / SD2 rejects (each paired with a positive baseline)', () => {
    const expectReject = async (
      input: string,
      reason: ConfinementReason
    ): Promise<void> => {
      const result = await confineAndVerify(input, root);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe(reason);
      }
    };

    it('rejects ../ traversal in legacy shape', async () => {
      // Note: leading /YYYY/MM/DD/ shape passes step-2 classification, but
      // path.resolve flattens `..` and step-4 catches the escape.
      await expectReject(
        '/2025/01/02/../../../etc/passwd',
        'traversal'
      );
    });

    it('rejects ../ traversal in modern URL shape', async () => {
      await expectReject(
        `${FRONTEND}/uploads/2025/01/02/../../../etc/passwd`,
        'traversal'
      );
    });

    it('rejects absolute path injected via percent-encoding', async () => {
      // %2F is forward slash — decodeURIComponent yields literal slash that
      // path.resolve treats as a new absolute anchor.
      await expectReject(
        `/2025/01/02/%2Fetc%2Fpasswd`,
        'traversal'
      );
    });

    it('rejects malformed percent-encoding (decodeURIComponent throws)', async () => {
      await expectReject('/2025/01/02/%E0%A4%A.png', 'traversal');
    });

    it('rejects leaf symlink (lstat-isFile catches it after realpath re-confine)', async () => {
      // escape.png is a symlink in-root whose target is OUTSIDE root.
      // realpath resolves the symlink target; step 6 catches the escape.
      await expectReject(
        '/2025/01/02/escape.png',
        'symlink'
      );
    });

    it('rejects intermediate symlink that escapes root', async () => {
      // escape-dir is a directory symlink pointing outside root; any file
      // accessed through it has a realpath outside root.
      await writeFile(
        path.join(
          await fsp.realpath(path.join(root, '2025', '01', '02', 'escape-dir')),
          'inner.png'
        ),
        'PNG'
      );
      await expectReject(
        '/2025/01/02/escape-dir/inner.png',
        'symlink'
      );
    });

    it('rejects non-regular file (directory at leaf)', async () => {
      await expectReject(
        '/2025/01/03/isdir.png',
        'non_regular_file'
      );
    });

    it('rejects realpath failure (file does not exist)', async () => {
      await expectReject(
        '/2025/01/02/does-not-exist.png',
        'realpath_failed'
      );
    });

    it('rejects control chars (NUL byte)', async () => {
      await expectReject(
        `/2025/01/02/evil${NUL}.png`,
        'control_char'
      );
    });

    it('rejects control chars (CR / LF injection)', async () => {
      await expectReject(
        '/2025/01/02/inj\necti\rion.png',
        'control_char'
      );
    });

    it('rejects control chars (DEL 0x7f)', async () => {
      await expectReject(
        `/2025/01/02/del${DEL}.png`,
        'control_char'
      );
    });

    it('rejects unsupported scheme (https:// not matching FRONTEND_URL)', async () => {
      await expectReject(
        'https://attacker.example.test/uploads/2025/01/02/evil.png',
        'unsupported_scheme'
      );
    });

    it('rejects unsupported scheme (http://)', async () => {
      await expectReject(
        'http://attacker.example.test/uploads/2025/01/02/evil.png',
        'unsupported_scheme'
      );
    });

    it('rejects unknown shape (no leading /YYYY/, not a URL)', async () => {
      await expectReject('random-string', 'unsupported_scheme');
    });

    it('rejects empty-string input', async () => {
      await expectReject('', 'unsupported_scheme');
    });

    it('rejects non-string input via the typeof guard', async () => {
      // The function is typed `(string, string)` but the typeof guard exists
      // for defense-in-depth against `any`-shaped DB rows.
      const result = await confineAndVerify(
        null as unknown as string,
        root
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('control_char');
      }
    });

    // ─── Step-2.5 sub-rule coverage (MINOR-1, MINOR-2, MINOR-3, FUTURE-1..5,
    //     plus security-engineer's %5C and double-encoded %252E%252E pins).
    //
    // Each test below names the Step-2.5 sub-rule it pins. Counter-test-by-
    // revert: removing the targeted sub-rule would flip the test to either
    // `realpath_failed` (the wrong typed reason) or — in the worst case — to
    // `ok: true` for an attacker-controlled path that path.resolve happens to
    // anchor inside root. The whole point of Step 2.5 is to fail SHARPLY on
    // SYNTAX before path.resolve destroys the evidence.

    // MINOR-1 (rule c, backslash): three discriminators for the
    // backslash-as-segment-separator rule. POSIX path.resolve treats `\` as a
    // literal character, so without rule (c) these would survive flattening
    // and either pass step-4 isInsideRoot or fail at step-5 with the wrong
    // reason. Rule (c) must reject pre-resolve regardless of where the `\`
    // appears in the path.
    it('rejects backslash-separator traversal (rule c, MINOR-1)', async () => {
      // Modern URL shape with backslash-separator `..` traversal.
      await expectReject(
        `${FRONTEND}/uploads/2025/01/02/..\\..\\..\\etc\\passwd`,
        'traversal'
      );
    });

    it('rejects mixed-separator path with backslash (rule c, MINOR-1)', async () => {
      // Legacy shape, backslash appears mid-path without `..`. Rule (c)
      // rejects any backslash — not just traversal-shaped — to defend against
      // POSIX path.resolve treating it as a literal segment character.
      await expectReject('/2025/01/02/foo\\bar', 'traversal');
    });

    it('rejects filename containing backslash (rule c, MINOR-1)', async () => {
      // Backslash anywhere — even in the leaf — rejects. No legitimate Postiz
      // upload writes a backslash to disk.
      await expectReject('/2025/01/02/file\\name.png', 'traversal');
    });

    // MINOR-2 (rule b, leading-`/` after decode): regression pin for the
    // leading-/ attack family. Defense-in-depth: this leading-/ input is
    // caught by rule (b) AND rule (d) (the post-decode leading slash
    // produces both a startsWith('/') match and an empty first segment
    // under the /[\\/]/ split). Removing EITHER rule alone does not flip
    // this test RED — only removing BOTH does. We keep this test as a
    // regression pin for the leading-/ attack family; the rule overlap is
    // intentional (SD2 belt-and-suspenders), not redundant code.
    it('rejects %2F-injection re-anchor in modern URL shape (rule b ∧ rule d, MINOR-2)', async () => {
      await expectReject(
        `${FRONTEND}/uploads/%2Fetc%2Fpasswd`,
        'traversal'
      );
    });

    // FUTURE-1: URL-encoded `..` (`%2E%2E`). decodeURIComponent is case-
    // insensitive on hex digits, so `%2E%2E` and `%2e%2e` both decode to `..`.
    // After single-decode, segments include `..` → rule (a) catches.
    // Counter-test-by-revert: without rule (a), path.resolve would flatten
    // the `..` segments and step-4 isInsideRoot may or may not catch depending
    // on the leading-prefix depth. Rule (a) makes rejection sharp.
    it('rejects URL-encoded `..` (`%2E%2E`) via rule a after decode (FUTURE-1)', async () => {
      await expectReject(
        '/2025/01/02/%2E%2E/%2E%2E/etc/passwd',
        'traversal'
      );
    });

    // FUTURE-2: trailing `..` segment with no following path. path.resolve
    // would flatten to `<root>/2025/01/02` — INSIDE root, but pointing at a
    // directory, which would then fail at step-7 lstat with `non_regular_file`
    // (the wrong reason). Rule (a) catches the syntactic `..` segment first.
    it('rejects trailing `..` segment (FUTURE-2, rule a)', async () => {
      await expectReject('/2025/01/02/..', 'traversal');
    });

    // FUTURE-3: triple-slash via `%2F%2F`. Decodes to `//`, producing an
    // empty segment in the split → rule (d) catches. Counter-test-by-revert:
    // without rule (d), path.resolve silently collapses `//` and the request
    // resolves inside root to `<root>/2025/01/02/file/name.png` — which
    // doesn't exist, so step-5 returns `realpath_failed` (wrong reason).
    // Worse, if the resolved file DID exist, the request would succeed.
    it('rejects `%2F%2F` triple-slash producing empty segment (FUTURE-3, rule d)', async () => {
      await expectReject(
        '/2025/01/02/file%2F%2Fname.png',
        'traversal'
      );
    });

    // FUTURE-4: lowercase `%2f` (decodeURIComponent is case-insensitive on
    // hex digits). Decodes to `/`, producing an empty segment after the
    // legacy-branch leading-slash strip → rule (d) catches.
    it('rejects lowercase `%2f` re-anchor (FUTURE-4, rule d, hex-case-insensitive)', async () => {
      await expectReject(
        '/2025/01/02/%2fetc%2fpasswd',
        'traversal'
      );
    });

    // FUTURE-5: `..` before `/uploads/` in modern URL shape. The modern
    // branch slices off `${FRONTEND}/uploads/`, leaving suffix `../etc/passwd`.
    // Without rule (a), path.resolve(uploadRoot, '../etc/passwd') yields
    // `<parent-of-root>/etc/passwd` — OUTSIDE root, so step-4 catches but
    // via isInsideRoot rather than syntactic rejection. Rule (a) makes the
    // rejection happen pre-resolve at the syntactic layer.
    it('rejects `..` in modern URL suffix (FUTURE-5, rule a)', async () => {
      await expectReject(
        `${FRONTEND}/uploads/../etc/passwd`,
        'traversal'
      );
    });

    // Security-engineer add (#49 HANDOFF): `%5C` decodes to literal `\`,
    // which rule (c) rejects. Pins rule (c) against percent-encoded
    // backslash injection — the natural evasion attempt against a code
    // review that adds rule (c) for raw `\` but forgets the percent-encoded
    // variant. decodeURIComponent runs BEFORE step 2.5, so the literal `\`
    // surfaces in time for rule (c) to fire.
    it('rejects %5C-encoded backslash injection (rule c, %-encoded variant)', async () => {
      await expectReject(
        '/2025/01/02/%5C..%5C..%5Cetc%5Cpasswd',
        'traversal'
      );
    });

    // Security-engineer add (#49 HANDOFF): double-encoded `%252E%252E`.
    // NEGATIVE sharp test — this input must NOT be classified as `traversal`.
    // decodeURIComponent runs ONCE, so the input decodes to `%2E%2E` (literal
    // 6-char string `%2E%2E`, not `..`). No Step-2.5 rule matches:
    //   - rule (a): segment `%2E%2E` is not strictly `..`
    //   - rule (b): no leading `/`
    //   - rule (c): no backslash
    //   - rule (d): no empty segment
    // path.resolve treats `%2E%2E` as a literal directory name. The directory
    // does not exist, so step-5 realpath fails → `realpath_failed`. This
    // test pins the boundary: Step 2.5 is a SYNTAX gate, not a recursive
    // decoder. Defending against double-encoding is the realpath gate's job.
    // Counter-test-by-revert: if a future change adds recursive decoding to
    // confineAndVerify, this test would flip RED with `traversal`.
    it('classifies double-encoded `%252E%252E` as realpath_failed (NOT traversal)', async () => {
      await expectReject(
        '/2025/01/02/%252E%252E/file.png',
        'realpath_failed'
      );
    });
  });

  describe('classification ordering (invariant #8)', () => {
    it('http(s) that does NOT match FRONTEND_URL is unsupported_scheme, NOT remote', async () => {
      // The resolver layer classifies remote; the path-guard rejects http(s)
      // entirely. This is the boundary between resolver kind=remote and
      // path-guard reject — keeping them aligned is invariant #8.
      const result = await confineAndVerify(
        'https://cdn.cloudflare.com/img.png',
        root
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('unsupported_scheme');
    });

    it('modern URL takes precedence over legacy when FRONTEND_URL is set', async () => {
      // Both shapes match for `${FRONTEND}/uploads/2025/01/02/real.png`:
      // it starts with the modern prefix and also contains the YYYY-MM-DD
      // segment further in. Modern is tried first and wins.
      const result = await confineAndVerify(
        `${FRONTEND}/uploads/2025/01/02/real.png`,
        root
      );
      expect(result.ok).toBe(true);
    });

    it('legacy /YYYY/MM/DD/ is matched when FRONTEND_URL is unset', async () => {
      const saved = process.env.FRONTEND_URL;
      delete process.env.FRONTEND_URL;
      try {
        const result = await confineAndVerify(
          '/2025/01/02/real.png',
          root
        );
        expect(result.ok).toBe(true);
      } finally {
        process.env.FRONTEND_URL = saved;
      }
    });
  });
});

describe('verifyAbsolutePath (LocalStorage layer-2 gate)', () => {
  let root: string;
  let rootRaw: string;

  beforeAll(async () => {
    rootRaw = await mkdtemp(path.join(tmpdir(), 'mj-verify-'));
    root = await fsp.realpath(rootRaw);
    await mkdir(path.join(root, 'a'), { recursive: true });
    await writeFile(path.join(root, 'a', 'good.png'), 'PNG');

    const outside = await fsp.realpath(
      await mkdtemp(path.join(tmpdir(), 'mj-verify-outside-'))
    );
    await writeFile(path.join(outside, 'secret.txt'), 'SECRET');
    await symlink(
      path.join(outside, 'secret.txt'),
      path.join(root, 'a', 'link.png')
    );
  });

  afterAll(async () => {
    await fsp.rm(rootRaw, { recursive: true, force: true }).catch(() => {});
  });

  it('accepts an absolute path inside root pointing at a regular file', async () => {
    const result = await verifyAbsolutePath(
      path.join(root, 'a', 'good.png'),
      root
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a relative path (input must be absolute)', async () => {
    const result = await verifyAbsolutePath('a/good.png', root);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('traversal');
  });

  it('rejects an absolute path OUTSIDE root', async () => {
    const result = await verifyAbsolutePath('/etc/passwd', root);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('traversal');
  });

  it('rejects a leaf symlink whose target is outside root', async () => {
    const result = await verifyAbsolutePath(
      path.join(root, 'a', 'link.png'),
      root
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('symlink');
  });

  it('rejects control chars in the absolute path string', async () => {
    const result = await verifyAbsolutePath(
      path.join(root, 'a', `good${NUL}.png`),
      root
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('control_char');
  });

  it('rejects when the file does not exist (realpath_failed)', async () => {
    const result = await verifyAbsolutePath(
      path.join(root, 'a', 'missing.png'),
      root
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('realpath_failed');
  });
});
