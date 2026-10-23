import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import sharp from 'sharp';

const require = createRequire(import.meta.url);

test('Pigment can still create its Happy DOM context on Node 22', () => {
  const { createVmContext } = require('@wyw-in-js/transform/lib/vm/createVmContext.js');
  const { context, teardown } = createVmContext('offline.css.js', { happyDOM: true }, {});
  try { assert.equal(vm.runInContext('document.createElement("span").tagName', context), 'SPAN'); }
  finally { teardown(); }
});

test('JSDOM text parsing works without the unused optional native canvas', () => {
  assert.throws(() => require.resolve('canvas'), { code: 'MODULE_NOT_FOUND' });
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<p>offline DOM fixture</p>');
  try { assert.equal(dom.window.document.querySelector('p').textContent, 'offline DOM fixture'); }
  finally { dom.window.close(); }
});

test('Sharp can encode and decode media with patched native libraries', async () => {
  const image = await sharp({ create: { width: 4, height: 3, channels: 4, background: '#336699' } }).png().toBuffer();
  const metadata = await sharp(image).metadata();
  assert.equal(metadata.width, 4);
  assert.equal(metadata.height, 3);
  assert.equal(metadata.format, 'png');
  assert.equal(sharp.versions.sharp, '0.35.5');
});

test('Sentry profiling native addon loads on the patched Node release', () => {
  const { nodeProfilingIntegration } = require('@sentry/profiling-node');
  assert.equal(typeof nodeProfilingIntegration, 'function');
  assert.ok(nodeProfilingIntegration());
});
