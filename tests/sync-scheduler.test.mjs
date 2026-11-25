import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureHourlyAlarm, dispatchHourlyAlarm, prepareDashboardSync, hourlyAlarmOptions, isSyncStuck, ALARM_NAME } from '../src/sync-scheduler.mjs';

test('persists alarms across sessions on Chrome 150+ without breaking older browsers', () => {
  assert.deepEqual(hourlyAlarmOptions('Mozilla/5.0 Chrome/158.0.0.0'), {
    delayInMinutes: 60,
    periodInMinutes: 60,
    persistAcrossSessions: true
  });
  assert.deepEqual(hourlyAlarmOptions('Mozilla/5.0 Chrome/148.0.0.0'), {
    delayInMinutes: 60,
    periodInMinutes: 60
  });
  assert.deepEqual(hourlyAlarmOptions('Mozilla/5.0 Firefox/121.0'), {
    delayInMinutes: 60,
    periodInMinutes: 60
  });
});

test('detects orphaned or overlong sync state without interrupting a fresh sync', () => {
  const now = Date.parse('2026-11-25T12:00:00.000Z');
  assert.equal(isSyncStuck(true, null, now), true);
  assert.equal(isSyncStuck(true, 'not-a-date', now), true);
  assert.equal(isSyncStuck(true, new Date(now - 6 * 60_000).toISOString(), now), true);
  assert.equal(isSyncStuck(true, new Date(now - 60_000).toISOString(), now), false);
  assert.equal(isSyncStuck(false, null, now), false);
});

test('creates and awaits a missing hourly alarm', async () => {
  let createFinished = false;
  let created = null;
  const alarmState = new Map();
  const alarms = {
    get: async name => { assert.equal(name, ALARM_NAME); return alarmState.get(name); },
    create: async (name, info) => {
      created = { name, info };
      await new Promise(resolve => setTimeout(resolve, 10));
      alarmState.set(name, { name, periodInMinutes: info.periodInMinutes, scheduledTime: 12345 });
      createFinished = true;
    },
    clear: async () => true
  };

  const alarm = await ensureHourlyAlarm(alarms, true);

  assert.equal(createFinished, true);
  assert.deepEqual(created, { name: ALARM_NAME, info: { delayInMinutes: 60, periodInMinutes: 60 } });
  assert.deepEqual(alarm, { name: ALARM_NAME, periodInMinutes: 60, scheduledTime: 12345 });
});

test('does not report success when Chrome fails to retain the created alarm', async () => {
  const alarms = {
    get: async () => undefined,
    create: async () => {},
    clear: async () => true
  };

  await assert.rejects(ensureHourlyAlarm(alarms, true), /could not be confirmed/i);
});

test('does not reset an existing hourly alarm', async () => {
  let createCount = 0;
  let clearCount = 0;
  const existing = { name: ALARM_NAME, periodInMinutes: 60, scheduledTime: 12345 };
  const alarms = {
    get: async () => existing,
    create: async () => { createCount++; },
    clear: async () => { clearCount++; }
  };

  assert.equal(await ensureHourlyAlarm(alarms, true), existing);
  assert.equal(createCount, 0);
  assert.equal(clearCount, 0);
});

test('clears the alarm when auto-sync is disabled', async () => {
  let cleared = null;
  const alarms = {
    get: async () => { throw new Error('must not read alarm'); },
    create: async () => { throw new Error('must not create alarm'); },
    clear: async name => { cleared = name; return true; }
  };

  assert.equal(await ensureHourlyAlarm(alarms, false), null);
  assert.equal(cleared, ALARM_NAME);
});

test('runs an enabled hourly alarm and waits for sync completion', async () => {
  let finished = false;
  const pending = new Promise(resolve => setTimeout(() => { finished = true; resolve('done'); }, 10));
  const result = await dispatchHourlyAlarm({ name: ALARM_NAME }, true, () => pending);
  assert.equal(result, 'done');
  assert.equal(finished, true);
});

test('ignores unrelated alarms and paused auto-sync', async () => {
  let calls = 0;
  const sync = async () => { calls++; };
  assert.equal(await dispatchHourlyAlarm({ name: 'another-alarm' }, true, sync), null);
  assert.equal(await dispatchHourlyAlarm({ name: ALARM_NAME }, false, sync), null);
  assert.equal(calls, 0);
});

test('dashboard health check repairs a missing alarm and catches up an overdue sync', async () => {
  const now = Date.parse('2026-11-25T12:00:00.000Z');
  const alarmState = new Map();
  const alarms = {
    get: async name => alarmState.get(name),
    create: async (name, info) => alarmState.set(name, { name, ...info, scheduledTime: now + 60 * 60_000 }),
    clear: async name => alarmState.delete(name)
  };
  const syncCalls = [];

  const result = await prepareDashboardSync({
    alarms,
    autoSyncEnabled: true,
    lastSyncAt: new Date(now - 61 * 60_000).toISOString(),
    syncing: false,
    runSync: async trigger => { syncCalls.push(trigger); },
    now
  });

  assert.equal(result.hourlyAlarm?.periodInMinutes, 60);
  assert.equal(result.recoveryDue, true);
  assert.equal(result.schedulerError, '');
  assert.deepEqual(syncCalls, ['recovery']);
});

test('dashboard health check reports alarm failure but still catches up an overdue sync', async () => {
  const alarms = { get: async () => undefined, create: async () => {}, clear: async () => true };
  const syncCalls = [];
  const now = Date.parse('2026-11-25T12:00:00.000Z');

  const result = await prepareDashboardSync({
    alarms,
    autoSyncEnabled: true,
    lastSyncAt: new Date(now - 61 * 60_000).toISOString(),
    syncing: false,
    runSync: async trigger => { syncCalls.push(trigger); },
    now
  });

  assert.equal(result.hourlyAlarm, null);
  assert.match(result.schedulerError, /could not be confirmed/i);
  assert.equal(result.recoveryDue, true);
  assert.deepEqual(syncCalls, ['recovery']);
});

test('dashboard health check clears a stuck sync and restarts even if the previous sync was recent', async () => {
  const now = Date.parse('2026-11-25T12:00:00.000Z');
  const alarms = {
    get: async () => ({ name: ALARM_NAME, periodInMinutes: 60, scheduledTime: now + 60 * 60_000 }),
    create: async () => { throw new Error('must preserve existing alarm'); },
    clear: async () => true
  };
  let resetCount = 0;
  const syncCalls = [];

  const result = await prepareDashboardSync({
    alarms,
    autoSyncEnabled: true,
    lastSyncAt: new Date(now - 2 * 60_000).toISOString(),
    syncing: true,
    syncStartedAt: new Date(now - 6 * 60_000).toISOString(),
    resetStaleSync: async () => { resetCount++; },
    runSync: async trigger => { syncCalls.push(trigger); },
    now
  });

  assert.equal(result.staleSync, true);
  assert.equal(result.recoveryDue, true);
  assert.equal(resetCount, 1);
  assert.deepEqual(syncCalls, ['recovery']);
});

test('dashboard health check does not start duplicate or disabled recovery syncs', async () => {
  const existing = { name: ALARM_NAME, periodInMinutes: 60, scheduledTime: 12345 };
  const alarms = {
    get: async () => existing,
    create: async () => { throw new Error('must preserve existing alarm'); },
    clear: async () => true
  };
  const syncCalls = [];
  const runSync = async trigger => syncCalls.push(trigger);
  const staleAt = '2026-11-25T10:00:00.000Z';

  const alreadySyncing = await prepareDashboardSync({
    alarms, autoSyncEnabled: true, lastSyncAt: staleAt, syncing: true, syncStartedAt: '2026-11-25T11:59:00.000Z', runSync, now: Date.parse('2026-11-25T12:00:00.000Z')
  });
  const disabled = await prepareDashboardSync({
    alarms, autoSyncEnabled: false, lastSyncAt: staleAt, syncing: false, runSync, now: Date.parse('2026-11-25T12:00:00.000Z')
  });

  assert.equal(alreadySyncing.recoveryDue, false);
  assert.equal(disabled.recoveryDue, false);
  assert.equal(disabled.hourlyAlarm, null);
  assert.deepEqual(syncCalls, []);
});
