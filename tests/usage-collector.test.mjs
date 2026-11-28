import assert from 'node:assert/strict';
import test from 'node:test';
import { collectUsage } from '../src/usage-collector.mjs';

const source = { id: 'chatgpt', url: 'https://chatgpt.com/settings/usage' };
const usageText = '5-hour limit\n75% left\nWeekly limit\n90% left';

function fixture({ text = reloads => reloads ? usageText : '', url = source.url, active = false } = {}) {
  const reloads = [], closed = [];
  const tab = { id: 7, url, active, incognito: false, status: 'complete' };
  return { browser: {
    tabs: {
      query: async () => [{ windowId: 3, incognito: false }],
      create: async () => tab,
      get: async id => { assert.equal(id, tab.id); return tab; },
      reload: async (id, options) => { assert.equal(id, tab.id); reloads.push(options); },
      remove: async id => { assert.equal(id, tab.id); closed.push(id); }
    },
    scripting: { executeScript: async () => [{ result: text(reloads.length) }] }
  }, reloads, closed };
}

const options = { timeoutMs: 140, pollMs: 10, blankReloadAfterMs: 25 };

test('one reload of an empty temporary ChatGPT tab recovers the meters', async () => {
  const { browser, reloads, closed } = fixture();
  const result = await collectUsage(browser, source, options);
  assert.equal(result.status, 'ok');
  assert.equal(result.snapshot.metrics.fiveHourRemainingPercent, 75);
  assert.deepEqual(reloads, [{ bypassCache: true }]);
  assert.deepEqual(closed, [7]);
});

test('a permanently empty page is reloaded once and reported separately from sign-in', async () => {
  const { browser, reloads, closed } = fixture({ text: () => '' });
  const result = await collectUsage(browser, source, options);
  assert.equal(result.status, 'not_rendered');
  assert.equal(result.snapshot, undefined);
  assert.equal(reloads.length, 1);
  assert.deepEqual(closed, [7]);
});

test('an adopted tab stays open and is never reloaded', async () => {
  const { browser, reloads, closed } = fixture({ active: true });
  await collectUsage(browser, source, options);
  assert.deepEqual(reloads, []);
  assert.deepEqual(closed, []);
});

test('an actual sign-in redirect is not reloaded', async () => {
  const { browser, reloads } = fixture({ url: 'https://auth.openai.com/log-in' });
  assert.equal((await collectUsage(browser, source, options)).status, 'auth_required');
  assert.deepEqual(reloads, []);
});

test('an unrecognized nonempty layout is not reloaded', async () => {
  const { browser, reloads } = fixture({ text: () => 'A rendered page with no known labels' });
  assert.equal((await collectUsage(browser, source, options)).status, 'unrecognized');
  assert.deepEqual(reloads, []);
});
