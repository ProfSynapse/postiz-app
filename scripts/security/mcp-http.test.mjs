import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import express from 'express';
import { MCPServer } from '@mastra/mcp';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const require = createRequire(import.meta.url);
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'CommonJS' } });
const { isMcpInputWithinLimits, MCP_MAX_BODY_BYTES } = require('../../libraries/nestjs-libraries/src/chat/mcp.request.limits.ts');

test('actual Mastra MCP HTTP adapter and patched SDK support independent concurrent sessions', { timeout: 20000 }, async () => {
  const app = express();
  app.use(express.json({ limit: MCP_MAX_BODY_BYTES }));
  let calls = 0;
  const echo = createTool({ id: 'fixtureEcho', description: 'Local echo only', inputSchema: z.object({ text: z.string() }), execute: async ({ context }) => { calls++; return { echo: context.text }; } });
  const mcp = new MCPServer({ name: 'Postiz fixture', version: '1.0.0', tools: { fixtureEcho: echo } });
  let base;
  app.all('/mcp/fixture', async (req, res, next) => {
    console.log('MCP fixture request', req.method, req.body?.method || 'guard');
    res.on('finish', () => console.log('MCP fixture response', req.body?.method || 'guard', res.statusCode));
    if (req.headers.auth !== 'dummy-test-key') return res.sendStatus(400);
    if (req.method === 'POST' && (!req.is('application/json') || req.body === undefined)) return res.sendStatus(415);
    if (!isMcpInputWithinLimits(req.body)) return res.sendStatus(413);
    try {
      await mcp.startHTTP({ url: new URL('/mcp/fixture', base), httpPath: '/mcp/fixture', options: { sessionIdGenerator: randomUUID, maxRequestBodySize: MCP_MAX_BODY_BYTES }, req, res });
    } catch (err) { next(err); }
  });
  app.use((err, _req, res, _next) => {
    console.log('MCP fixture HTTP rejection', err.status || 500);
    res.status(err.status || 500).end();
  });
  const server = createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const clients = ['one', 'two'].map(n => new Client({ name: 'fixture-' + n, version: '1.0.0' }));
  const transports = clients.map(() => new StreamableHTTPClientTransport(new URL('/mcp/fixture', base), { requestInit: { headers: { auth: 'dummy-test-key' } } }));
  try {
    assert.equal((await fetch(base + '/mcp/fixture', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 400);
    assert.equal((await fetch(base + '/mcp/fixture', { method: 'POST', headers: { auth: 'dummy-test-key', 'content-type': 'text/plain' }, body: '{}' })).status, 415);
    assert.equal((await fetch(base + '/mcp/fixture', { method: 'POST', headers: { auth: 'dummy-test-key', 'content-type': 'application/json' }, body: JSON.stringify({ params: { arguments: Array(10001).fill(0) } }) })).status, 413);
    assert.equal((await fetch(base + '/mcp/fixture', { method: 'POST', headers: { auth: 'dummy-test-key', 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(MCP_MAX_BODY_BYTES + 1) }) })).status, 413);
    console.log('MCP fixture connecting clients');
    await Promise.all(clients.map((c, i) => c.connect(transports[i], { timeout: 3000 })));
    console.log('MCP fixture clients initialized');
    assert.notEqual(transports[0].sessionId, transports[1].sessionId);
    const list = await clients[0].listTools(undefined, { timeout: 3000 });
    assert.ok(list.tools.some(t => t.name === 'fixtureEcho'));
    const results = await Promise.all(clients.map((c, i) => c.callTool({ name: 'fixtureEcho', arguments: { text: 'session-' + i } }, undefined, { timeout: 3000 })));
    results.forEach((r, i) => assert.match(JSON.stringify(r), new RegExp('session-' + i)));
    const invalid = await clients[0].callTool({ name: 'fixtureEcho', arguments: { text: 4 } }, undefined, { timeout: 3000 });
    assert.equal(invalid.isError, true);
    assert.equal(calls, 2);
  } finally {
    await Promise.all(clients.map(c => c.close()));
    server.closeAllConnections();
    await mcp.close();
    await new Promise(r => server.close(r));
  }
});
