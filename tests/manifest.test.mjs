import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const firefoxManifest = JSON.parse(readFileSync(new URL('../manifest.firefox.json', import.meta.url), 'utf8'));

test('Chrome Manifest V3 uses a service worker without the MV2 scripts field', () => {
  assert.equal(manifest.background.service_worker, 'chrome-extension/service-worker.js');
  assert.equal(manifest.background.scripts, undefined);
  assert.equal(manifest.background.type, 'module');
  assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, '121.0');
  assert.equal(typeof manifest.browser_specific_settings.gecko.id, 'string');
  assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.required, ['none']);
});

test('Firefox Manifest V3 uses its own scripts-based background manifest', () => {
  assert.equal(firefoxManifest.background.service_worker, undefined);
  assert.deepEqual(firefoxManifest.background.scripts, ['chrome-extension/service-worker.js']);
  assert.equal(firefoxManifest.background.type, 'module');
  assert.equal(firefoxManifest.browser_specific_settings.gecko.strict_min_version, '121.0');
  assert.deepEqual(firefoxManifest.browser_specific_settings.gecko.data_collection_permissions.required, ['none']);
});

test('host access stays limited to the three monitored usage dashboards plus local Telegram relay', () => {
  assert.deepEqual(manifest.host_permissions, [
    'https://cursor.com/*',
    'https://chatgpt.com/*',
    'https://ollama.com/*',
    'http://127.0.0.1:8792/*'
  ]);
  assert.ok(manifest.permissions.includes('downloads'));
  assert.doesNotMatch(manifest.description, /OpenAI API/i);
});
