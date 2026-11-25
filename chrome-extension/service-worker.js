import { getExtensionApi } from '../src/extension-api.mjs';
import { parseUsage, usagePageDiagnostics } from '../src/parse-usage.mjs';
import { getOrCreateUsageTab } from '../src/usage-tabs.mjs';
import { ensureHourlyAlarm, dispatchHourlyAlarm, ALARM_NAME } from '../src/sync-scheduler.mjs';

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

async function ensureAlarm() {
  const { autoSync } = await browser.storage.local.get('autoSync');
  return ensureHourlyAlarm(browser.alarms, autoSync !== false);
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

async function syncSource(source) {
  let tabId = null;
  let ownsTab = false;
  const attemptedAt = new Date().toISOString();
  try {
    const tab = await getOrCreateUsageTab(browser.tabs, source);
    tabId = tab.tabId;
    ownsTab = tab.created;
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
        snapshot: { ...parsed, capturedAt: new Date().toISOString() }
      };
    }
    if (parsed?.status === 'blocked') {
      return { source: source.id, status: 'blocked', attemptedAt, message: 'The service showed a security check. Open it normally in your browser to continue.' };
    }
    if (parsed?.status === 'no_data') {
      return { source: source.id, status: 'no_data', attemptedAt, message: `The dashboard shows no numeric API usage for ${parsed.period || 'the selected range'}; no zero was recorded.` };
    }
    if (parsed?.status === 'auth_required' || (page && isAuthRedirect(page.url))) {
      return {
        source: source.id,
        status: 'auth_required',
        attemptedAt,
        message: `The page read by the extension looks signed out or has no visible meters (${diagnostics.visibleChars} characters; markers: ${markerSummary}).`
      };
    }
    return {
      source: source.id,
      status: 'unrecognized',
      attemptedAt,
      message: `No recognized usage labels after ${MAX_READ_ATTEMPTS} checks; read ${diagnostics.visibleChars} visible characters. Markers: ${markerSummary}. No zero values were recorded.`
    };
  } catch (error) {
    let url = '';
    if (tabId !== null) url = (await browser.tabs.get(tabId).catch(() => null))?.url || '';
    const auth = isAuthRedirect(url);
    return {
      source: source.id,
      status: auth ? 'auth_required' : 'unavailable',
      attemptedAt,
      message: auth ? 'Sign in to this service in your browser, then run Sync again.' : 'Could not read this page from the extension. Open it in your browser and retry.'
    };
  } finally {
    if (ownsTab && tabId !== null) await browser.tabs.remove(tabId).catch(() => {});
  }
}

async function performSync(trigger = 'manual') {
  const current = await browser.storage.local.get(['snapshots', 'sourceStatus']);
  const results = await Promise.all(SOURCES.map(syncSource));
  const snapshots = Array.isArray(current.snapshots) ? current.snapshots.slice() : [];
  const sourceStatus = { ...(current.sourceStatus || {}) };
  for (const result of results) {
    sourceStatus[result.source] = {
      status: result.status,
      attemptedAt: result.attemptedAt,
      message: result.message || '',
      lastSuccessAt: result.snapshot?.capturedAt || sourceStatus[result.source]?.lastSuccessAt || null
    };
    if (result.snapshot) snapshots.push(result.snapshot);
  }
  const cutoff = Date.now() - 120 * 24 * 60 * 60 * 1000;
  const recent = snapshots.filter(item => Date.parse(item.capturedAt) >= cutoff).slice(-5000);
  const completedAt = new Date().toISOString();
  await browser.storage.local.set({ snapshots: recent, sourceStatus, lastSyncAt: completedAt, lastSyncTrigger: trigger, syncing: false });
  return { completedAt, results: results.map(({ source, status, message }) => ({ source, status, message: message || '' })) };
}

function runSync(trigger = 'manual') {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    await browser.storage.local.set({ syncing: true });
    try { return await performSync(trigger); }
    catch (error) {
      await browser.storage.local.set({ syncing: false, syncError: String(error?.message || error) });
      throw error;
    } finally { syncPromise = null; }
  })();
  return syncPromise;
}

browser.runtime.onInstalled.addListener(async () => {
  const { autoSync } = await browser.storage.local.get('autoSync');
  await browser.storage.local.set({ autoSync: autoSync !== false });
  await ensureAlarm();
  await runSync('install').catch(() => {});
});

browser.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  const { autoSync } = await browser.storage.local.get('autoSync');
  if (autoSync !== false) await runSync('startup').catch(() => {});
});
browser.alarms.onAlarm.addListener(async alarm => {
  const { autoSync } = await browser.storage.local.get('autoSync');
  try {
    await dispatchHourlyAlarm(alarm, autoSync !== false, async trigger => {
      await browser.storage.local.set({ lastAlarmAt: new Date().toISOString() });
      return runSync(trigger);
    });
  } catch {}
});

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
    browser.storage.local.get(['snapshots', 'sourceStatus', 'lastSyncAt', 'lastSyncTrigger', 'lastAlarmAt', 'syncing', 'autoSync', 'modelRoutes'])
      .then(data => sendResponse(data));
    return true;
  }
  if (message?.type === 'sync-now') {
    runSync('manual').then(sendResponse).catch(error => sendResponse({ error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === 'set-auto-sync') {
    browser.storage.local.set({ autoSync: Boolean(message.enabled) })
      .then(ensureAlarm)
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === 'open-source') {
    const source = SOURCES.find(item => item.id === message.source);
    if (!source) { sendResponse({ error: 'Unknown source.' }); return false; }
    browser.tabs.create({ url: source.url, active: true }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === 'save-model-routes') {
    browser.storage.local.set({ modelRoutes: Array.isArray(message.routes) ? message.routes : [] })
      .then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
