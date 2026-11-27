import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMatchingUsageTab, openUsageTab } from '../src/usage-tabs.mjs';

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

test('open focuses a regular matching tab without navigating it', async () => {
  const source = { url: 'https://chatgpt.com/settings/usage' };
  const tabsApi = {
    query: async () => [{ id: 1, url: source.url, incognito: true }, { id: 2, url: source.url, incognito: false }],
    update: async (id, options) => { assert.equal(id, 2); assert.deepEqual(options, { active: true }); }
  };
  await openUsageTab(tabsApi, source);
});
