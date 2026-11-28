import { getExtensionApi } from '../src/extension-api.mjs';
import { collectUsage } from '../src/usage-collector.mjs';
import { openUsageTab } from '../src/usage-tabs.mjs';
import { ensureHourlyAlarm, shouldCatchUp, ALARM_NAME } from '../src/sync-scheduler.mjs';
import { buildExportPayload } from '../src/telegram-summary.mjs';
import { exportLatestSnapshot } from '../src/export-latest.mjs';

const browser = getExtensionApi();
const SOURCES = [
  { id: 'cursor', url: 'https://cursor.com/dashboard/spending' },
  { id: 'chatgpt', url: 'https://chatgpt.com/settings/usage' },
  { id: 'ollama', url: 'https://ollama.com/dashboard' }
];
const { local } = browser.storage;
const now = () => new Date().toISOString();
const errorMessage = error => String(error?.message || error);
let syncPromise = null;
let alarmQueue = Promise.resolve();

async function reconcileAlarm(requestedEnabled) {
  const task = alarmQueue.then(async () => {
    if (requestedEnabled !== undefined) await local.set({ autoSync: requestedEnabled });
    const { autoSync, schedulerError } = await local.get(['autoSync', 'schedulerError']);
    const enabled = autoSync !== false;
    let alarm = null;
    let issue = '';
    try { alarm = await ensureHourlyAlarm(browser.alarms, enabled); }
    catch (error) { issue = errorMessage(error); }
    if ((schedulerError || '') !== issue) await local.set({ schedulerError: issue });
    return { enabled, alarm, issue };
  });
  alarmQueue = task.catch(() => {});
  return task;
}

async function performSync(trigger) {
  const current = await local.get(['snapshots', 'sourceStatus', 'recentChecks', 'exportHost']);
  const results = await Promise.all(SOURCES.map(source => collectUsage(browser, source)));
  const snapshots = Array.isArray(current.snapshots) ? current.snapshots.slice() : [];
  const sourceStatus = {};
  for (const result of results) {
    sourceStatus[result.source] = {
      status: result.status,
      attemptedAt: result.attemptedAt,
      message: result.message || '',
      lastSuccessAt: result.snapshot?.capturedAt || current.sourceStatus?.[result.source]?.lastSuccessAt || null
    };
    if (result.snapshot) snapshots.push(result.snapshot);
  }
  const cutoff = Date.now() - 120 * 24 * 60 * 60 * 1000;
  const recent = snapshots.filter(item => Date.parse(item.capturedAt) >= cutoff).slice(-5000);
  const completedAt = now();
  const check = {
    completedAt,
    trigger,
    readings: results.filter(result => result.status === 'ok').length,
    providers: Object.fromEntries(results.map(({ source, status }) => [source, status]))
  };
  const recentChecks = [check, ...(Array.isArray(current.recentChecks) ? current.recentChecks : [])].slice(0, 12);
  const exportPayload = buildExportPayload({
    snapshots: recent,
    sourceStatus,
    lastSyncAt: completedAt,
    lastSyncTrigger: trigger,
    host: current.exportHost || (globalThis.navigator?.userAgent?.includes('Linux') ? 'hp' : 'mac'),
    exportedAt: completedAt
  });
  // A slow or unavailable relay must never cost the local readings.
  await local.set({
    snapshots: recent, sourceStatus, lastSyncAt: completedAt, lastSyncTrigger: trigger, recentChecks,
    lastExport: exportPayload, lastExportResult: null, syncing: false, syncStartedAt: null, syncError: ''
  });
  // The toolbar warns about a failed check without showing private usage numbers.
  void Promise.all([
    browser.action.setBadgeText({ text: check.readings === SOURCES.length ? '' : '!' }),
    browser.action.setBadgeBackgroundColor({ color: '#93631f' }),
    browser.action.setTitle({ title: `AI Usage Monitor: ${check.readings}/${SOURCES.length} fresh readings` })
  ]).catch(() => {});
  await exportLatestSnapshot({ payload: exportPayload })
    .catch(error => ({ ok: false, reason: errorMessage(error) }))
    .then(lastExportResult => local.set({ lastExportResult })).catch(() => {});
  return { completedAt, results: results.map(({ source, status, message }) => ({ source, status, message: message || '' })) };
}

function runSync(trigger) {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    try {
      const startedAt = now();
      const started = { syncing: true, syncStartedAt: startedAt, syncError: '' };
      if (trigger === 'wake' || trigger === 'recovery') started.lastRecoveryAt = startedAt;
      await local.set(started);
      return await performSync(trigger);
    } catch (error) {
      await local.set({ syncing: false, syncStartedAt: null, syncError: errorMessage(error) }).catch(() => {});
      throw error;
    } finally { syncPromise = null; }
  })();
  return syncPromise;
}

async function recoverInterruptedSync() {
  const state = await local.get(['autoSync', 'syncing', 'lastRecoveryAt']);
  if (syncPromise || state.syncing !== true) return;
  if (shouldCatchUp('recovery', state)) return runSync('recovery');
  await local.set({ syncing: false, syncStartedAt: null, syncError: 'The previous check was interrupted. Use Sync now to retry.' });
}

async function catchUp(trigger) {
  const { enabled } = await reconcileAlarm();
  if (!enabled || syncPromise) return;
  const state = await local.get(['autoSync', 'lastSyncAt', 'lastRecoveryAt', 'syncing']);
  if (!syncPromise && shouldCatchUp(trigger, state)) return runSync(trigger);
}

browser.runtime.onInstalled.addListener(() => { void catchUp('install').catch(() => {}); });
browser.runtime.onStartup.addListener(() => { void catchUp('startup').catch(() => {}); });
browser.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== ALARM_NAME) return;
  void (async () => {
    if ((await local.get('autoSync')).autoSync === false) return;
    await local.set({ lastAlarmAt: now() });
    const result = await runSync('hourly');
    await local.set({ lastHourlyCheck: { completedAt: result.completedAt, readings: result.results.filter(item => item.status === 'ok').length } });
  })().catch(() => {});
});

if (browser.idle?.onStateChanged) {
  try { browser.idle.setDetectionInterval?.(60); } catch {}
  browser.idle.onStateChanged.addListener(state => { if (state === 'active') void catchUp('wake').catch(() => {}); });
}

browser.action.onClicked.addListener(async () => {
  const url = browser.runtime.getURL('chrome-extension/dashboard.html');
  const { dashboardTabId } = await local.get('dashboardTabId');
  const existing = dashboardTabId ? await browser.tabs.get(dashboardTabId).catch(() => null) : null;
  if (existing?.url === url && existing.id !== undefined) {
    await browser.tabs.update(existing.id, { active: true });
    return;
  }
  const tab = await browser.tabs.create({ url, active: true });
  if (tab.id !== undefined) await local.set({ dashboardTabId: tab.id });
});

async function handleMessage(message) {
  switch (message.type) {
    case 'get-data': {
      if (message.repair === true) void catchUp('recovery').catch(() => {});
      const data = await local.get(['snapshots', 'sourceStatus', 'lastSyncAt', 'lastSyncTrigger', 'lastAlarmAt', 'lastHourlyCheck', 'recentChecks', 'syncing', 'autoSync', 'modelRoutes', 'syncError', 'schedulerError', 'lastExportResult']);
      const hourlyAlarm = await browser.alarms.get(ALARM_NAME);
      return { ...data, syncing: Boolean(syncPromise && data.syncing), hourlyAlarm };
    }
    case 'sync-now':
      await reconcileAlarm();
      return runSync('manual');
    case 'set-auto-sync': {
      const { issue } = await reconcileAlarm(Boolean(message.enabled));
      return issue ? { error: issue } : { ok: true };
    }
    case 'open-source': {
      const source = SOURCES.find(item => item.id === message.source);
      if (!source) return { error: 'Unknown source.' };
      await openUsageTab(browser.tabs, source);
      return { ok: true };
    }
    case 'save-model-routes':
      await local.set({ modelRoutes: Array.isArray(message.routes) ? message.routes : [] });
      return { ok: true };
    default: return { error: 'Unknown command.' };
  }
}

browser.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message?.type || sender.url !== browser.runtime.getURL('chrome-extension/dashboard.html')) return false;
  handleMessage(message).then(respond, error => respond({ error: errorMessage(error) }));
  return true;
});

// Register listeners synchronously, then verify the alarm on every worker activation.
void reconcileAlarm().catch(() => {});
void recoverInterruptedSync().catch(() => {});
