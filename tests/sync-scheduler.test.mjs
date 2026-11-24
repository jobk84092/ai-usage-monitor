import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureHourlyAlarm, dispatchHourlyAlarm, ALARM_NAME } from '../src/sync-scheduler.mjs';

test('creates and awaits a missing hourly alarm', async () => {
  let createFinished = false;
  let created = null;
  const alarms = {
    get: async name => { assert.equal(name, ALARM_NAME); return undefined; },
    create: async (name, info) => {
      created = { name, info };
      await new Promise(resolve => setTimeout(resolve, 10));
      createFinished = true;
    },
    clear: async () => true
  };

  await ensureHourlyAlarm(alarms, true);

  assert.equal(createFinished, true);
  assert.deepEqual(created, { name: ALARM_NAME, info: { delayInMinutes: 60, periodInMinutes: 60 } });
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
