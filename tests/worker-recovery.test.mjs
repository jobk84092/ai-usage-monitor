import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';

const event = () => ({ addListener() {} });
const fixtureText = { 'cursor.com': 'Cursor Models\n33% used', 'chatgpt.com': '5-hour limit\n75% left', 'ollama.com': 'Weekly usage\n25% used' };

async function bootWorker(t, overrides = {}) {
  const state = { syncing: true, syncStartedAt: new Date().toISOString(), lastSyncAt: new Date().toISOString(), ...overrides };
  const tabs = new Map();
  let collections = 0;
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true }));
  globalThis.chrome = {
    storage: { local: {
      get: async keys => Object.fromEntries([keys].flat().filter(key => key in state).map(key => [key, state[key]])),
      set: async values => Object.assign(state, values)
    } },
    alarms: { get: async () => ({ periodInMinutes: 60 }), clear: async () => true, onAlarm: event() },
    action: { onClicked: event(), setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
    runtime: { onInstalled: event(), onStartup: event(), onMessage: event() },
    tabs: {
      query: async () => [{ windowId: 1 }],
      create: async ({ url }) => {
        const tab = { id: ++collections, status: 'complete', url, active: false };
        tabs.set(tab.id, tab);
        return tab;
      },
      get: async id => tabs.get(id),
      remove: async id => tabs.delete(id)
    },
    scripting: { executeScript: async ({ args }) => [{ result: fixtureText[new URL(args[0]).hostname] }] }
  };
  t.after(() => { delete globalThis.chrome; });
  await import(`../chrome-extension/service-worker.js?case=${encodeURIComponent(t.name)}`);
  // Drain worker startup and mocked async API completions, without an actual browser or relay.
  await setImmediate();
  return { state, collections };
}

test('a fresh worker retries an interrupted check even when the last successful check is recent', async t => {
  const { state, collections } = await bootWorker(t);
  assert.equal(state.lastSyncTrigger, 'recovery');
  assert.equal(collections, 3);
  assert.equal(state.syncing, false);
  assert.ok(state.lastRecoveryAt);
  assert.equal(state.lastExportResult.ok, true);
});

test('a paused extension clears interrupted state but does not resume checking', async t => {
  const { state, collections } = await bootWorker(t, { autoSync: false });
  assert.equal(state.syncing, false);
  assert.equal(collections, 0);
});

test('an interruption during cooldown does not create a retry loop', async t => {
  const { state, collections } = await bootWorker(t, { lastRecoveryAt: new Date().toISOString() });
  assert.equal(state.syncing, false);
  assert.equal(collections, 0);
});
