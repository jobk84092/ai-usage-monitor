import test from 'node:test';
import assert from 'node:assert/strict';
import { getExtensionApi } from '../src/extension-api.mjs';

test('selects the WebExtension browser namespace when Firefox provides it', () => {
  const browserApi = { runtime: {} };
  assert.equal(getExtensionApi({ browser: browserApi, chrome: { runtime: {} } }), browserApi);
});

test('selects the Chrome namespace when browser is not provided', () => {
  const chromeApi = { runtime: {} };
  assert.equal(getExtensionApi({ chrome: chromeApi }), chromeApi);
});

test('fails with a useful error outside an extension runtime', () => {
  assert.throws(() => getExtensionApi({}), /WebExtension API is unavailable/);
});
