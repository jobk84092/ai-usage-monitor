export const ALARM_NAME = 'ai-usage-hourly-sync';
export const ALARM_PERIOD_MINUTES = 60;

export async function ensureHourlyAlarm(alarms, autoSyncEnabled) {
  if (autoSyncEnabled === false) {
    await alarms.clear(ALARM_NAME);
    return null;
  }

  const existing = await alarms.get(ALARM_NAME);
  if (existing?.periodInMinutes === ALARM_PERIOD_MINUTES) return existing;

  await alarms.create(ALARM_NAME, {
    delayInMinutes: ALARM_PERIOD_MINUTES,
    periodInMinutes: ALARM_PERIOD_MINUTES
  });
  return await alarms.get(ALARM_NAME) || {
    name: ALARM_NAME,
    periodInMinutes: ALARM_PERIOD_MINUTES
  };
}

export async function dispatchHourlyAlarm(alarm, autoSyncEnabled, runSync) {
  if (alarm?.name !== ALARM_NAME || autoSyncEnabled === false) return null;
  return await runSync('hourly');
}
