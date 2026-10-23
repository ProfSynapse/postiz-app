import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

test('production audit resolves aliases/cycles, excludes dev roots and matches exact ranges', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'postiz-audit-'));
  try {
    const lock = {
      lockfileVersion: '9.0',
      importers: { '.': {
        dependencies: { alias: { version: 'actual@1.0.0(peer@1.0.0)' } },
        devDependencies: { dev: { version: '1.0.0' } },
      } },
      snapshots: {
        'actual@1.0.0(peer@1.0.0)': { dependencies: { child: '2.0.0' } },
        'child@2.0.0': { optionalDependencies: { alias: 'actual@1.0.0(peer@1.0.0)' } },
        'dev@1.0.0': {},
      },
    };
    const advisories = {
      actual: [{ id: 1, severity: 'high', vulnerable_versions: '<1.0.0' }],
      child: [{ id: 2, severity: 'critical', vulnerable_versions: '<2.1.0' }],
      dev: [{ id: 3, severity: 'critical', vulnerable_versions: '*' }],
    };
    const lockPath = path.join(directory, 'pnpm-lock.yaml');
    const advisoryPath = path.join(directory, 'advisories.json');
    const output = path.join(directory, 'audit.json');
    await writeFile(lockPath, YAML.stringify(lock));
    await writeFile(advisoryPath, JSON.stringify(advisories));
    const result = spawnSync(process.execPath, ['scripts/security/audit-production.mjs', '--lock', lockPath, '--advisories', advisoryPath, '--output', output], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(report.snapshots, 2);
    assert.match(report.lockfileSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(report.counts, { critical: 1 });
    assert.deepEqual(report.findings.map(f => f.name), ['child']);
    assert.deepEqual(report.findings[0].paths[0].route, ['.', 'alias', 'child']);
    // Broken edges fail closed rather than silently reducing the package set.
    lock.snapshots['child@2.0.0'].dependencies = { missing: '1.0.0' };
    await writeFile(lockPath, YAML.stringify(lock));
    const broken = spawnSync(process.execPath, ['scripts/security/audit-production.mjs', '--lock', lockPath, '--advisories', advisoryPath, '--output', output], { encoding: 'utf8', timeout: 10000 });
    assert.notEqual(broken.status, 0);
    assert.match(broken.stderr, /Unresolved dependency missing@1.0.0/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
