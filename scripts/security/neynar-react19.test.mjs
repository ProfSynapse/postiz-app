import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
const require = createRequire(import.meta.url);
test('Neynar context renders with the Next App Router React runtime', () => {
  const react = require('next/dist/compiled/react');
  assert.match(react.version, /^19\./);
  const load = Module._load;
  // Simulate Next's documented React aliasing for this isolated server render.
  // No provider, popup, account or network operation is invoked.
  Module._load = function (id, ...args) {
    if (id === 'react') return react;
    if (id === '@gitroom/react/helpers/loading.spinner') return require('../../libraries/react-shared-libraries/src/helpers/loading.spinner.tsx');
    if (id === 'react/jsx-runtime') return require('next/dist/compiled/react/jsx-runtime');
    if (id === 'react/jsx-dev-runtime') return require('next/dist/compiled/react/jsx-dev-runtime');
    return load.call(this, id, ...args);
  };
  try {
    const { renderToString } = require('next/dist/compiled/react-dom/server');
    const { NeynarContextProvider, useNeynarContext, Theme } = require('@neynar/react');
    function Child() {
      const context = useNeynarContext();
      assert.equal(context.client_id, 'offline-fixture');
      return react.createElement('span', null, 'offline-context');
    }
    const output = renderToString(react.createElement(NeynarContextProvider, { settings: { clientId: 'offline-fixture', defaultTheme: Theme.Dark } }, react.createElement(Child)));
    assert.ok(output.includes('offline-context'));
    require('ts-node').register({ project: 'scripts/security/tsconfig.json', transpileOnly: true });
    const { Button } = require('../../libraries/react-shared-libraries/src/form/button.tsx');
    // A real loading button previously returned bundled React16 elements (#525).
    assert.ok(renderToString(react.createElement(Button, { loading: true }, 'Fixture')).includes('aria-label="Loading"'));
  } finally { Module._load = load; }
});
