export const ALARM_NAME = 'ai-usage-hourly-sync';
export const ALARM_PERIOD_MINUTES = 60;
export const SYNC_STALE_MS = ALARM_PERIOD_MINUTES * 60 * 1000;
/** Prevent dashboard storage churn from starting recovery syncs back-to-back. */
export const RECOVERY_COOLDOWN_MS = 15 * 60 * 1000;

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

export function isRecoveryCoolingDown(lastRecoveryAt, now = Date.now()) {
  if (lastRecoveryAt === null || lastRecoveryAt === undefined || lastRecoveryAt === '') return false;
  const last = typeof lastRecoveryAt === 'number' ? lastRecoveryAt : Date.parse(lastRecoveryAt);
  return Number.isFinite(last) && now - last < RECOVERY_COOLDOWN_MS;
}

export function shouldCatchUp(trigger, state, now = Date.now()) {
  if (state.autoSync === false) return false;
  if (trigger === 'install' || trigger === 'startup') return true;
  if (trigger !== 'wake' && trigger !== 'recovery') return false;
  return !isRecoveryCoolingDown(state.lastRecoveryAt, now) && (state.syncing === true || isSyncOverdue(state.lastSyncAt, now));
}
