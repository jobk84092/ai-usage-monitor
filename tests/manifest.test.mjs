import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

test('Manifest V3 targets Chrome service workers and Firefox background scripts', () => {
  assert.equal(manifest.background.service_worker, 'chrome-extension/service-worker.js');
  assert.deepEqual(manifest.background.scripts, ['chrome-extension/service-worker.js']);
  assert.equal(manifest.background.type, 'module');
  assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, '121.0');
  assert.equal(typeof manifest.browser_specific_settings.gecko.id, 'string');
  assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.required, ['none']);
});

test('host access stays limited to the three monitored usage dashboards', () => {
  assert.deepEqual(manifest.host_permissions, [
    'https://cursor.com/*',
    'https://chatgpt.com/*',
    'https://ollama.com/*'
  ]);
  assert.doesNotMatch(manifest.description, /OpenAI API/i);
});
