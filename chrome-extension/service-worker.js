import { getExtensionApi } from '../src/extension-api.mjs';
import { parseUsage, usagePageDiagnostics } from '../src/parse-usage.mjs';
import { ensurePersistentUsageTab } from '../src/usage-tabs.mjs';
import { ensureHourlyAlarm, prepareDashboardSync, dispatchHourlyAlarm, isSyncOverdue, ALARM_NAME } from '../src/sync-scheduler.mjs';
import { buildExportPayload } from '../src/telegram-summary.mjs';
import { exportLatestSnapshot } from '../src/export-latest.mjs';

const browser = getExtensionApi();
const SOURCES = [
  { id: 'cursor', label: 'Cursor', url: 'https://cursor.com/dashboard/spending' },
  { id: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com/settings/usage' },
  { id: 'ollama', label: 'Ollama', url: 'https://ollama.com/dashboard' }
];
const MAX_READ_ATTEMPTS = 20;
const READ_RETRY_MS = 1000;
let syncPromise = null;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function ensureAlarm(autoSyncEnabled) {
  if (autoSyncEnabled === undefined) {
    const { autoSync } = await browser.storage.local.get('autoSync');
    autoSyncEnabled = autoSync !== false;
  }
  return ensureHourlyAlarm(browser.alarms, autoSyncEnabled);
}

async function recordSchedulerError(error) {
  const message = error ? String(error?.message || error) : '';
  const { schedulerError = '' } = await browser.storage.local.get('schedulerError');
  if (schedulerError !== message) await browser.storage.local.set({ schedulerError: message });
}

async function waitForLoad(tabId, timeoutMs = 30000) {
  const existing = await browser.tabs.get(tabId).catch(() => null);
  if (existing?.status === 'complete') return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Timed out waiting for the usage page.')), timeoutMs);
    const listener = (updatedId, info) => {
      if (updatedId === tabId && info.status === 'complete') finish();
    };
    function finish(error) {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(listener);
      error ? reject(error) : resolve();
    }
    browser.tabs.onUpdated.addListener(listener);
    browser.tabs.get(tabId).then(tab => { if (tab?.status === 'complete') finish(); }).catch(finish);
  });
}

async function readPage(tabId) {
  const results = await browser.scripting.executeScript({
    target: { tabId },
    func: () => ({
      title: document.title || '',
      url: location.href,
      text: (document.body?.innerText || '').slice(0, 12000)
    })
  });
  return results?.[0]?.result || { title: '', url: '', text: '' };
}

function isAuthRedirect(url) {
  try {
    const host = new URL(url).hostname;
    return /^(authenticator\.cursor\.sh|signin\.ollama\.com|auth\.openai\.com|accounts\.google\.com)$/.test(host);
  } catch { return false; }
}

async function rememberSessionTab(sourceId, tabId) {
  const { sessionTabIds = {} } = await browser.storage.local.get('sessionTabIds');
  if (sessionTabIds[sourceId] === tabId) return;
  await browser.storage.local.set({ sessionTabIds: { ...sessionTabIds, [sourceId]: tabId } });
}

async function maybeFocusAuthTab(sourceId, tabId) {
  const { authFocusAt = {} } = await browser.storage.local.get('authFocusAt');
  const last = Date.parse(authFocusAt[sourceId] || '');
  const recentlyFocused = Number.isFinite(last) && Date.now() - last < 12 * 60 * 60 * 1000;
  if (recentlyFocused) return false;
  await browser.tabs.update(tabId, { active: true }).catch(() => {});
  await browser.storage.local.set({
    authFocusAt: { ...authFocusAt, [sourceId]: new Date().toISOString() }
  });
  return true;
}

async function syncSource(source, sessionTabIds = {}) {
  let tabId = null;
  const attemptedAt = new Date().toISOString();
  try {
    const tab = await ensurePersistentUsageTab(browser.tabs, source, sessionTabIds[source.id]);
    tabId = tab.tabId;
    await rememberSessionTab(source.id, tabId);
    await waitForLoad(tabId);
    let page = null;
    let parsed = null;
    for (let attempt = 0; attempt < MAX_READ_ATTEMPTS; attempt++) {
      page = await readPage(tabId);
      parsed = parseUsage(source.id, page.text);
      if (parsed.status !== 'unrecognized') break;
      if (attempt + 1 < MAX_READ_ATTEMPTS) await delay(READ_RETRY_MS);
    }
    const diagnostics = usagePageDiagnostics(source.id, page?.text || '');
    const markerSummary = Object.entries(diagnostics.markers)
      .map(([marker, present]) => `${marker}=${present ? 'yes' : 'no'}`)
      .join(', ');
    if (parsed?.status === 'ok') {
      return {
        source: source.id,
        status: 'ok',
        attemptedAt,
        sessionTabId: tabId,
        snapshot: { ...parsed, capturedAt: new Date().toISOString() }
      };
    }
    if (parsed?.status === 'blocked') {
      await maybeFocusAuthTab(source.id, tabId);
      return {
        source: source.id,
        status: 'blocked',
        attemptedAt,
        sessionTabId: tabId,
        message: 'The service showed a security check. Complete it in the open session tab, then Sync now.'
      };
    }
    if (parsed?.status === 'no_data') {
      return {
        source: source.id,
        status: 'no_data',
        attemptedAt,
        sessionTabId: tabId,
        message: `The dashboard shows no numeric API usage for ${parsed.period || 'the selected range'}; no zero was recorded.`
      };
    }
    if (parsed?.status === 'auth_required' || (page && isAuthRedirect(page.url))) {
      await maybeFocusAuthTab(source.id, tabId);
      return {
        source: source.id,
        status: 'auth_required',
        attemptedAt,
        sessionTabId: tabId,
        message: `Sign-in needed in this Chrome profile. A session tab stays open — sign in once there; hourly sync reuses that session (${diagnostics.visibleChars} characters; markers: ${markerSummary}).`
      };
    }
    return {
      source: source.id,
      status: 'unrecognized',
      attemptedAt,
      sessionTabId: tabId,
      message: `No recognized usage labels after ${MAX_READ_ATTEMPTS} checks; read ${diagnostics.visibleChars} visible characters. Markers: ${markerSummary}. No zero values were recorded.`
    };
  } catch (error) {
    let url = '';
    if (tabId !== null) url = (await browser.tabs.get(tabId).catch(() => null))?.url || '';
    const auth = isAuthRedirect(url);
    if (auth && tabId !== null) await maybeFocusAuthTab(source.id, tabId);
    return {
      source: source.id,
      status: auth ? 'auth_required' : 'unavailable',
      attemptedAt,
      sessionTabId: tabId,
      message: auth
        ? 'Sign-in needed. The session tab was left open — finish sign-in there, then Sync again.'
        : 'Could not read this page from the extension. Open it in your browser and retry.'
    };
  }
}

async function performSync(trigger = 'manual') {
  const current = await browser.storage.local.get(['snapshots', 'sourceStatus', 'sessionTabIds']);
  const sessionTabIds = current.sessionTabIds || {};
  const results = await Promise.all(SOURCES.map(source => syncSource(source, sessionTabIds)));
  const snapshots = Array.isArray(current.snapshots) ? current.snapshots.slice() : [];
  const sourceStatus = { ...(current.sourceStatus || {}) };
  const nextSessionTabIds = { ...sessionTabIds };
  for (const result of results) {
    sourceStatus[result.source] = {
      status: result.status,
      attemptedAt: result.attemptedAt,
      message: result.message || '',
      lastSuccessAt: result.snapshot?.capturedAt || sourceStatus[result.source]?.lastSuccessAt || null,
      sessionTabId: result.sessionTabId ?? sourceStatus[result.source]?.sessionTabId ?? null
    };
    if (result.sessionTabId !== undefined && result.sessionTabId !== null) {
      nextSessionTabIds[result.source] = result.sessionTabId;
    }
    if (result.snapshot) snapshots.push(result.snapshot);
  }
  const cutoff = Date.now() - 120 * 24 * 60 * 60 * 1000;
  const recent = snapshots.filter(item => Date.parse(item.capturedAt) >= cutoff).slice(-5000);
  const completedAt = new Date().toISOString();
  const { exportHost = '' } = await browser.storage.local.get('exportHost');
  const exportPayload = buildExportPayload({
    snapshots: recent,
    sourceStatus,
    lastSyncAt: completedAt,
    lastSyncTrigger: trigger,
    host: exportHost || (globalThis.navigator?.userAgent?.includes('Linux') ? 'hp' : 'mac'),
    exportedAt: completedAt
  });
  const exportResult = await exportLatestSnapshot({
    payload: exportPayload,
    downloadsApi: browser.downloads
  }).catch(error => ({ ok: false, reason: String(error?.message || error) }));
  await browser.storage.local.set({
    snapshots: recent,
    sourceStatus,
    sessionTabIds: nextSessionTabIds,
    lastSyncAt: completedAt,
    lastSyncTrigger: trigger,
    lastExport: exportPayload,
    lastExportResult: exportResult,
    syncing: false,
    syncStartedAt: null,
    syncError: ''
  });
  return { completedAt, results: results.map(({ source, status, message }) => ({ source, status, message: message || '' })) };
}

function runSync(trigger = 'manual') {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    await browser.storage.local.set({ syncing: true, syncStartedAt: new Date().toISOString(), syncError: '' });
    try { return await performSync(trigger); }
    catch (error) {
      await browser.storage.local.set({ syncing: false, syncStartedAt: null, syncError: String(error?.message || error) });
      throw error;
    } finally { syncPromise = null; }
  })();
  return syncPromise;
}

browser.runtime.onInstalled.addListener(async () => {
  const { autoSync } = await browser.storage.local.get('autoSync');
  const enabled = autoSync !== false;
  await browser.storage.local.set({ autoSync: enabled });
  try { await ensureAlarm(enabled); await recordSchedulerError(null); }
  catch (error) { await recordSchedulerError(error); }
  await runSync('install').catch(() => {});
});

browser.runtime.onStartup.addListener(async () => {
  const { autoSync } = await browser.storage.local.get('autoSync');
  const enabled = autoSync !== false;
  try { await ensureAlarm(enabled); await recordSchedulerError(null); }
  catch (error) { await recordSchedulerError(error); }
  if (enabled) await runSync('startup').catch(() => {});
});
browser.alarms.onAlarm.addListener(async alarm => {
  const { autoSync } = await browser.storage.local.get('autoSync');
  try {
    await dispatchHourlyAlarm(alarm, autoSync !== false, async trigger => {
      await browser.storage.local.set({ lastAlarmAt: new Date().toISOString() });
      return runSync(trigger);
    });
  } catch (error) { await recordSchedulerError(error).catch(() => {}); }
});

if (browser.idle?.onStateChanged) {
  try { browser.idle.setDetectionInterval?.(60); } catch {}
  browser.idle.onStateChanged.addListener(async state => {
    if (state !== 'active') return;
    const { autoSync, lastSyncAt, syncing } = await browser.storage.local.get(['autoSync', 'lastSyncAt', 'syncing']);
    if (autoSync === false || syncing) return;
    try {
      await ensureAlarm(true);
      await recordSchedulerError(null);
    } catch (error) {
      await recordSchedulerError(error);
      return;
    }
    if (isSyncOverdue(lastSyncAt)) await runSync('wake').catch(() => {});
  });
}

browser.action.onClicked.addListener(async () => {
  const url = browser.runtime.getURL('chrome-extension/dashboard.html');
  const { dashboardTabId } = await browser.storage.local.get('dashboardTabId');
  const existing = dashboardTabId ? await browser.tabs.get(dashboardTabId).catch(() => null) : null;
  if (existing?.url === url && existing.id !== undefined) {
    await browser.tabs.update(existing.id, { active: true });
    return;
  }
  const tab = await browser.tabs.create({ url, active: true });
  if (tab.id !== undefined) await browser.storage.local.set({ dashboardTabId: tab.id });
});

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'get-data') {
    const allowRecovery = message.repair === true;
    browser.storage.local.get(['snapshots', 'sourceStatus', 'lastSyncAt', 'lastSyncTrigger', 'lastAlarmAt', 'syncing', 'syncStartedAt', 'autoSync', 'modelRoutes', 'syncError', 'schedulerError', 'sessionTabIds', 'lastRecoveryAt'])
      .then(async data => {
        const scheduler = await prepareDashboardSync({
          alarms: browser.alarms,
          autoSyncEnabled: data.autoSync !== false,
          lastSyncAt: data.lastSyncAt,
          syncing: data.syncing,
          syncStartedAt: data.syncStartedAt,
          lastRecoveryAt: data.lastRecoveryAt,
          allowRecovery,
          runSync: async trigger => {
            if (trigger === 'recovery') {
              await browser.storage.local.set({ lastRecoveryAt: new Date().toISOString() });
            }
            return runSync(trigger);
          },
          resetStaleSync: () => browser.storage.local.set({ syncing: false, syncStartedAt: null })
        });
        await recordSchedulerError(scheduler.schedulerError ? new Error(scheduler.schedulerError) : null);
        sendResponse({ ...data, ...scheduler, schedulerError: scheduler.schedulerError });
      })
      .catch(error => sendResponse({ error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === 'sync-now') {
    (async () => {
      const { autoSync } = await browser.storage.local.get('autoSync');
      if (autoSync !== false) {
        try { await ensureAlarm(true); await recordSchedulerError(null); }
        catch (error) { await recordSchedulerError(error); }
      }
      return runSync('manual');
    })().then(sendResponse).catch(error => sendResponse({ error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === 'set-auto-sync') {
    const enabled = Boolean(message.enabled);
    browser.storage.local.set({ autoSync: enabled })
      .then(async () => {
        try { await ensureAlarm(enabled); await recordSchedulerError(null); sendResponse({ ok: true }); }
        catch (error) { await recordSchedulerError(error); sendResponse({ error: String(error?.message || error) }); }
      })
      .catch(error => sendResponse({ error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === 'open-source') {
    const source = SOURCES.find(item => item.id === message.source);
    if (!source) { sendResponse({ error: 'Unknown source.' }); return false; }
    (async () => {
      const { sessionTabIds = {} } = await browser.storage.local.get('sessionTabIds');
      const tab = await ensurePersistentUsageTab(browser.tabs, source, sessionTabIds[source.id]);
      await rememberSessionTab(source.id, tab.tabId);
      await browser.tabs.update(tab.tabId, { active: true });
      sendResponse({ ok: true, tabId: tab.tabId });
    })().catch(error => sendResponse({ error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === 'save-model-routes') {
    browser.storage.local.set({ modelRoutes: Array.isArray(message.routes) ? message.routes : [] })
      .then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
