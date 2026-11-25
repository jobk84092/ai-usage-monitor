export const ALARM_NAME = 'ai-usage-hourly-sync';
export const ALARM_PERIOD_MINUTES = 60;
export const SYNC_STALE_MS = ALARM_PERIOD_MINUTES * 60 * 1000;
export const SYNC_STUCK_AFTER_MS = 5 * 60 * 1000;

export function hourlyAlarmOptions(userAgent = globalThis.navigator?.userAgent || '') {
  const options = {
    delayInMinutes: ALARM_PERIOD_MINUTES,
    periodInMinutes: ALARM_PERIOD_MINUTES
  };
  const chromeMajor = Number(String(userAgent).match(/(?:Chrome|Chromium)\/(\d+)/)?.[1] || 0);
  if (chromeMajor >= 150) options.persistAcrossSessions = true;
  return options;
}

export async function ensureHourlyAlarm(alarms, autoSyncEnabled) {
  if (autoSyncEnabled === false) {
    await alarms.clear(ALARM_NAME);
    return null;
  }

  const existing = await alarms.get(ALARM_NAME);
  if (existing?.periodInMinutes === ALARM_PERIOD_MINUTES) return existing;

  await alarms.create(ALARM_NAME, hourlyAlarmOptions());
  const created = await alarms.get(ALARM_NAME);
  if (!created || created.periodInMinutes !== ALARM_PERIOD_MINUTES) {
    throw new Error('Hourly sync alarm could not be confirmed after creation.');
  }
  return created;
}

export function isSyncOverdue(lastSyncAt, now = Date.now()) {
  if (lastSyncAt === null || lastSyncAt === undefined || lastSyncAt === '') return true;
  const lastSyncTime = typeof lastSyncAt === 'number' ? lastSyncAt : Date.parse(lastSyncAt);
  return !Number.isFinite(lastSyncTime) || now - lastSyncTime >= SYNC_STALE_MS;
}

export function isSyncStuck(syncing, syncStartedAt, now = Date.now()) {
  if (syncing !== true) return false;
  if (syncStartedAt === null || syncStartedAt === undefined || syncStartedAt === '') return true;
  const startedAt = typeof syncStartedAt === 'number' ? syncStartedAt : Date.parse(syncStartedAt);
  return !Number.isFinite(startedAt) || now - startedAt >= SYNC_STUCK_AFTER_MS;
}

export async function prepareDashboardSync({ alarms, autoSyncEnabled, lastSyncAt, syncing, syncStartedAt, runSync, resetStaleSync, now = Date.now() }) {
  let hourlyAlarm = null;
  let schedulerError = '';
  try {
    hourlyAlarm = await ensureHourlyAlarm(alarms, autoSyncEnabled);
  } catch (error) {
    schedulerError = String(error?.message || error);
  }

  const staleSync = isSyncStuck(syncing, syncStartedAt, now);
  if (staleSync && resetStaleSync) {
    try { await resetStaleSync(); }
    catch (error) { schedulerError ||= String(error?.message || error); }
  }

  const recoveryDue = autoSyncEnabled !== false && (staleSync || (syncing !== true && isSyncOverdue(lastSyncAt, now)));
  if (recoveryDue) {
    try { Promise.resolve(runSync('recovery')).catch(() => {}); }
    catch {}
  }
  return { hourlyAlarm, schedulerError, recoveryDue, staleSync };
}

export async function dispatchHourlyAlarm(alarm, autoSyncEnabled, runSync) {
  if (alarm?.name !== ALARM_NAME || autoSyncEnabled === false) return null;
  return await runSync('hourly');
}
