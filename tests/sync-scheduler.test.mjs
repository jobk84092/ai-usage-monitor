import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureHourlyAlarm, shouldCatchUp, hourlyAlarmOptions, ALARM_NAME } from '../src/sync-scheduler.mjs';

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

const now = Date.parse('2026-11-25T12:00:00.000Z');
const recent = new Date(now - 5 * 60_000).toISOString();
const overdue = new Date(now - 61 * 60_000).toISOString();

test('catches up after idle only when due or interrupted and not cooling down', () => {
  assert.equal(shouldCatchUp('wake', { lastSyncAt: recent }, now), false);
  assert.equal(shouldCatchUp('wake', { lastSyncAt: overdue }, now), true);
  assert.equal(shouldCatchUp('recovery', { lastSyncAt: recent, syncing: true }, now), true);
  assert.equal(shouldCatchUp('recovery', { lastSyncAt: overdue, lastRecoveryAt: recent }, now), false);
  assert.equal(shouldCatchUp('read-only', { lastSyncAt: overdue }, now), false);
});

test('startup and install can check immediately unless auto-sync is paused', () => {
  assert.equal(shouldCatchUp('startup', { lastSyncAt: recent }, now), true);
  assert.equal(shouldCatchUp('install', { autoSync: false }, now), false);
  assert.equal(shouldCatchUp('wake', { autoSync: false }, now), false);
});
