// libraries/nestjs-libraries/src/integrations/social/linkedin.version.smoke.ts
//
// Node-runnable smoke test for the LinkedIn-Version self-healing helper.
// Run via: `npx ts-node libraries/nestjs-libraries/src/integrations/social/linkedin.version.smoke.ts`
//
// Exists because the libraries/nestjs-libraries package has no configured Jest
// project at present. The .spec.ts file alongside this one is the proper unit
// test suite if/when test infra is added; this smoke script verifies the same
// core behaviors using only the Node assert module.

import { strict as assert } from 'node:assert';
import {
  getLinkedInVersion,
  linkedInFetchWithFallback,
  linkedInRetryOn426,
} from './linkedin.version';

type TestFn = () => Promise<void> | void;
const tests: { name: string; fn: TestFn }[] = [];
function test(name: string, fn: TestFn) {
  tests.push({ name, fn });
}

test('getLinkedInVersion returns a 6-digit YYYYMM string', () => {
  const v = getLinkedInVersion();
  assert.match(v, /^\d{6}$/, `expected YYYYMM, got ${v}`);
});

test('linkedInRetryOn426 returns first-attempt result when no error', async () => {
  let calls = 0;
  const result = await linkedInRetryOn426(async () => {
    calls += 1;
    return 'first-ok';
  });
  assert.equal(result, 'first-ok');
  assert.equal(calls, 1);
});

test('linkedInRetryOn426 retries with older version on NONEXISTENT_VERSION', async () => {
  const seen: string[] = [];
  let calls = 0;
  await linkedInRetryOn426(async (version) => {
    seen.push(version);
    calls += 1;
    if (calls === 1) {
      throw Object.assign(new Error('426'), {
        json: '{"code":"NONEXISTENT_VERSION"}',
      });
    }
    return 'ok';
  });
  assert.equal(seen.length, 2, 'expected exactly one retry');
  const first = parseInt(seen[0], 10);
  const second = parseInt(seen[1], 10);
  const firstYear = Math.floor(first / 100);
  const firstMonth = first % 100;
  const expectedSecond =
    firstMonth === 1
      ? (firstYear - 1) * 100 + 12
      : firstYear * 100 + firstMonth - 1;
  assert.equal(
    second,
    expectedSecond,
    `expected ${expectedSecond}, got ${second}`
  );
});

test('linkedInRetryOn426 rethrows non-426 errors immediately', async () => {
  let calls = 0;
  await assert.rejects(
    async () => {
      await linkedInRetryOn426(async () => {
        calls += 1;
        throw new Error('plain network failure');
      });
    },
    (err: Error) => /plain network failure/.test(err.message)
  );
  assert.equal(calls, 1, 'must not retry on non-426');
});

test('linkedInRetryOn426 caps retries at ~24 attempts', async () => {
  let calls = 0;
  await assert.rejects(async () => {
    await linkedInRetryOn426(async () => {
      calls += 1;
      throw Object.assign(new Error('persistent 426'), {
        json: '{"code":"NONEXISTENT_VERSION"}',
      });
    });
  });
  assert.ok(calls <= 26, `attempts=${calls}, expected <= 26`);
  assert.ok(calls >= 20, `attempts=${calls}, expected >= 20 (sanity)`);
});

test('linkedInFetchWithFallback retries with different version on 426 response', async () => {
  const originalFetch = global.fetch;
  const versionsSent: string[] = [];
  global.fetch = async (
    _url: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const headers = new Headers(init?.headers || undefined);
    const v = headers.get('LinkedIn-Version') || '';
    versionsSent.push(v);
    if (versionsSent.length === 1) {
      return new Response(
        JSON.stringify({ status: 426, code: 'NONEXISTENT_VERSION' }),
        { status: 426 }
      );
    }
    return new Response('{"ok":true}', { status: 200 });
  };
  try {
    const result = await linkedInFetchWithFallback(
      'https://api.linkedin.com/v2/test',
      {},
      (version) => ({
        headers: { 'LinkedIn-Version': version },
      })
    );
    assert.equal(result.status, 200);
    assert.equal(versionsSent.length, 2, 'expected one retry');
    assert.notEqual(versionsSent[0], versionsSent[1]);
    assert.ok(
      parseInt(versionsSent[1], 10) < parseInt(versionsSent[0], 10),
      `expected backward walk, got ${versionsSent[0]} -> ${versionsSent[1]}`
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('linkedInFetchWithFallback propagates non-426 status codes without retry', async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async (): Promise<Response> => {
    fetchCalls += 1;
    return new Response('{"error":"server"}', { status: 500 });
  };
  try {
    const result = await linkedInFetchWithFallback(
      'https://api.linkedin.com/v2/test',
      {},
      (version) => ({
        headers: { 'LinkedIn-Version': version },
      })
    );
    assert.equal(result.status, 500);
    assert.equal(fetchCalls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

(async () => {
  const originalWarn = console.warn;
  const originalLog = console.log;
  console.warn = () => {};
  console.log = () => {};

  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      originalLog.call(console, `  ok  ${name}`);
    } catch (err) {
      failed += 1;
      originalLog.call(console, `  FAIL ${name}`);
      originalLog.call(console, '       ' + (err as Error).message);
    }
  }

  console.warn = originalWarn;
  console.log = originalLog;

  if (failed > 0) {
    console.log(`\n${failed} of ${tests.length} test(s) failed`);
    process.exit(1);
  }
  console.log(`\n${tests.length} test(s) passed`);
})();
