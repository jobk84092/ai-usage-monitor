import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMatchingUsageTab, getOrCreateUsageTab } from '../src/usage-tabs.mjs';

test('reuses the open ChatGPT Usage tab, preferring a loaded match', () => {
  const tabs = [
    { id: 1, url: 'https://chatgpt.com/', status: 'complete', active: true },
    { id: 2, url: 'https://chatgpt.com/settings/usage', status: 'loading', active: true },
    { id: 3, url: 'https://chatgpt.com/settings/usage?tab=overview', status: 'complete', active: false }
  ];

  assert.equal(selectMatchingUsageTab(tabs, 'https://chatgpt.com/settings/usage')?.id, 3);
});

test('does not treat a different ChatGPT page as the Usage tab', () => {
  const tabs = [
    { id: 1, url: 'https://chatgpt.com/', status: 'complete', active: true },
    { id: 2, url: 'https://chatgpt.com/settings/account', status: 'complete', active: false }
  ];

  assert.equal(selectMatchingUsageTab(tabs, 'https://chatgpt.com/settings/usage'), null);
});

test('reuses the open authenticated Usage tab without creating or closing it', async () => {
  const existing = { id: 9, url: 'https://chatgpt.com/settings/usage', status: 'complete', active: true };
  let created = false;
  const tabsApi = {
    async query(queryInfo) {
      assert.deepEqual(queryInfo, { url: 'https://chatgpt.com/settings/usage*' });
      return [existing];
    },
    async create() { created = true; throw new Error('must reuse the existing tab'); }
  };

  assert.deepEqual(await getOrCreateUsageTab(tabsApi, { url: 'https://chatgpt.com/settings/usage' }), {
    tabId: 9, created: false
  });
  assert.equal(created, false);
});

test('creates a background Usage tab only when none is already open', async () => {
  let requested = null;
  const tabsApi = {
    async query() { return []; },
    async create(options) { requested = options; return { id: 10 }; }
  };

  assert.deepEqual(await getOrCreateUsageTab(tabsApi, { url: 'https://chatgpt.com/settings/usage' }), {
    tabId: 10, created: true
  });
  assert.deepEqual(requested, { url: 'https://chatgpt.com/settings/usage', active: false });
});
