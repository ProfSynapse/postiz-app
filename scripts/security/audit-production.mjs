import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';
import YAML from 'yaml';
import semver from 'semver';

// Traverse each lock snapshot once; pnpm audit's path expansion can exhaust heap
// on this workspace. Include optional dependencies conservatively, and keep one
// shortest route per snapshot. This is lock reachability, not exploitability.
const { values } = parseArgs({ options: {
  lock: { type: 'string', default: 'pnpm-lock.yaml' },
  output: { type: 'string', default: 'audit-production.json' },
  advisories: { type: 'string' },
} });
const lockText = await readFile(values.lock, 'utf8');
const lock = YAML.parse(lockText);
if (!String(lock.lockfileVersion).startsWith('9')) throw new Error('Expected pnpm v9 lockfile');
const snapshots = lock.snapshots;
const queue = [];
const routes = new Map();
const unresolved = new Set();
function edge(name, reference) {
  if (reference.startsWith('link:')) return { workspace: reference.slice(5) };
  if (reference.startsWith('npm:')) reference = reference.slice(4);
  const key = `${name}@${reference}`;
  if (snapshots[key]) return { key };
  // Aliased packages contain their actual name in the resolution reference.
  if (snapshots[reference]) return { key: reference };
  throw new Error(`Unresolved dependency ${key}`);
}
function dependencies(info, route, importer) {
  for (const group of ['dependencies', 'optionalDependencies']) {
    for (const [name, entry] of Object.entries(info[group] || {})) {
      const resolved = edge(name, typeof entry === 'string' ? entry : entry.version);
      if (resolved.workspace) {
        const target = path.posix.normalize(path.posix.join(importer, resolved.workspace));
        queue.push({ workspace: target, route: [...route, `workspace:${target}`] });
      } else queue.push({ key: resolved.key, route: [...route, name] });
    }
  }
}
const workspaces = new Set();
for (const importer of Object.keys(lock.importers)) queue.push({ workspace: importer, route: [importer] });
for (let i = 0; i < queue.length; i++) {
  const item = queue[i];
  if (item.workspace !== undefined) {
    if (workspaces.has(item.workspace)) continue;
    workspaces.add(item.workspace);
    const info = lock.importers[item.workspace];
    if (!info) throw new Error(`Missing workspace ${item.workspace}`);
    dependencies(info, item.route, item.workspace);
  } else {
    if (routes.has(item.key)) continue;
    routes.set(item.key, item.route);
    dependencies(snapshots[item.key], item.route, '.');
  }
}
const versions = {};
for (const key of routes.keys()) {
  const match = key.match(/^(@[^/]+\/[^@]+|[^@]+)@([^()]+)/);
  if (!match || !semver.valid(match[2])) { unresolved.add(key); continue; }
  (versions[match[1]] ||= new Set()).add(match[2]);
}
if (unresolved.size) throw new Error(`Unparsed snapshots: ${[...unresolved].join(', ')}`);
let advisories = {};
if (values.advisories) advisories = JSON.parse(await readFile(values.advisories, 'utf8'));
else {
  const names = Object.keys(versions).sort();
  for (let i = 0; i < names.length; i += 200) {
    const body = Object.fromEntries(names.slice(i, i + 200).map(n => [n, [...versions[n]]]));
    const response = await fetch('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`Registry audit failed: ${response.status}`);
    Object.assign(advisories, await response.json());
  }
}
const findings = [];
for (const [name, entries] of Object.entries(advisories)) {
  for (const advisory of entries) {
    const affected = [...(versions[name] || [])].filter(v => semver.satisfies(v, advisory.vulnerable_versions, { includePrerelease: true }));
    if (!affected.length) continue;
    const paths = [];
    for (const [key, route] of routes) {
      if (affected.some(v => key === `${name}@${v}` || key.startsWith(`${name}@${v}(`))) paths.push({ snapshot: key, route });
    }
    findings.push({ name, versions: affected, ...advisory, paths });
  }
}
const counts = {};
for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;
const report = {
  date: new Date().toISOString(), lockfile: values.lock,
  lockfileSha256: createHash('sha256').update(lockText).digest('hex'),
  scope: 'All workspace production dependencies plus optional dependencies; includes packages declared production but used at build time. Does not establish runtime/exploit reachability or platform applicability.',
  algorithm: 'Breadth-first snapshot traversal with alias resolution and one route per snapshot; no path expansion',
  snapshots: routes.size, packageNames: Object.keys(versions).length,
  versions: Object.fromEntries(Object.entries(versions).map(([n, v]) => [n, [...v].sort()])),
  counts, findings,
};
await writeFile(values.output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output: values.output, snapshots: routes.size, packageNames: report.packageNames, counts }));
// Critical findings must remain visible to callers and CI.
if (counts.critical) process.exitCode = 1;
