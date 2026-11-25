import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMatchingUsageTab, getOrCreateUsageTab, ensurePersistentUsageTab } from '../src/usage-tabs.mjs';

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

test('reuses a remembered session tab and refreshes it onto the usage URL', async () => {
  const updates = [];
  const tabsApi = {
    async get(id) {
      assert.equal(id, 44);
      return { id: 44, url: 'https://chatgpt.com/', status: 'complete' };
    },
    async update(id, options) { updates.push({ id, options }); return { id }; },
    async query() { throw new Error('must use remembered session tab'); },
    async create() { throw new Error('must use remembered session tab'); }
  };

  assert.deepEqual(
    await ensurePersistentUsageTab(tabsApi, { url: 'https://chatgpt.com/settings/usage' }, 44),
    { tabId: 44, created: false, reusedSession: true }
  );
  assert.deepEqual(updates, [{ id: 44, options: { url: 'https://chatgpt.com/settings/usage', active: false } }]);
});

test('creates a fresh session tab when the remembered id is gone', async () => {
  const tabsApi = {
    async get() { throw new Error('tab missing'); },
    async query() { return []; },
    async create(options) {
      assert.deepEqual(options, { url: 'https://ollama.com/dashboard', active: false });
      return { id: 77 };
    }
  };

  assert.deepEqual(
    await ensurePersistentUsageTab(tabsApi, { url: 'https://ollama.com/dashboard' }, 12),
    { tabId: 77, created: true, reusedSession: false }
  );
});
