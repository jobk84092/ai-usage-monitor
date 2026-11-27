import { parseUsage, usagePageDiagnostics } from './parse-usage.mjs';
import { sameUsagePath } from './usage-tabs.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function isAuthRedirect(url) {
  try {
    const { hostname, pathname } = new URL(url);
    return ['authenticator.cursor.sh', 'signin.ollama.com', 'auth.openai.com', 'accounts.google.com'].includes(hostname) ||
      (hostname === 'chatgpt.com' && /^\/auth\//i.test(pathname));
  } catch { return false; }
}

function readUsageText(origin, path) {
  // Check again inside the tab so a navigation racing with the check cannot expose other pages.
  if (location.origin !== origin || location.pathname.replace(/\/+$/, '') !== path) return null;
  return (document.body?.innerText || '').slice(0, 12000);
}

function describeRead(status, source, text) {
  if (status === 'auth_required') return 'Sign-in needed. Use Open to sign in to the provider in this browser profile, then Sync now.';
  if (status === 'blocked') return 'The provider showed a security check. Use Open to complete it yourself, then Sync now.';
  if (status === 'unavailable') return 'The usage page did not load or could not be read. Use Open to check the page, then try again.';
  const { visibleChars, markers } = usagePageDiagnostics(source, text);
  const present = Object.keys(markers).filter(key => markers[key]).join(', ') || 'none';
  return `No recognized usage meters in the background check (${visibleChars} characters; markers: ${present}).`;
}

async function createCollectionTab(tabs, source) {
  // Explicitly target a regular window: an extension can have incognito access as well.
  const windows = await tabs.query({ active: true, windowType: 'normal' });
  const regular = windows.find(tab => !tab.incognito && tab.windowId !== undefined);
  if (!regular) throw new Error('No regular browser window is open.');
  const tab = await tabs.create({ url: source.url, active: false, windowId: regular.windowId });
  if (tab?.id === undefined) throw new Error('The browser did not create a tab.');
  return tab.id;
}

export async function collectUsage(browser, source, { timeoutMs = 18000, pollMs = 500 } = {}) {
  const attemptedAt = new Date().toISOString();
  const { tabs, scripting } = browser;
  const { origin, pathname } = new URL(source.url);
  let tabId;
  let adopted = false;
  let text = '';
  let status = 'unavailable';
  let authSince = null;
  const onActivated = event => { if (event.tabId === tabId) adopted = true; };
  tabs.onActivated?.addListener(onActivated);
  try {
    tabId = await createCollectionTab(tabs, source);
    const deadline = Date.now() + timeoutMs;
    do {
      const tab = await tabs.get(tabId);
      if (tab.incognito) break;
      adopted ||= Boolean(tab.active);
      if (isAuthRedirect(tab.url)) { status = 'auth_required'; break; }
      if (tab.status === 'complete' && sameUsagePath(tab.url, source.url)) {
        const results = await scripting.executeScript({
          target: { tabId }, func: readUsageText, args: [origin, pathname.replace(/\/+$/, '')]
        }).catch(() => []);
        const result = results?.[0]?.result;
        if (typeof result === 'string') {
          text = result;
          const parsed = parseUsage(source.id, text);
          status = parsed.status;
          if (status === 'ok') {
            return { source: source.id, status, attemptedAt, snapshot: { ...parsed, capturedAt: new Date().toISOString() } };
          }
          if (status === 'blocked') break;
          if (status === 'auth_required') {
            // A SPA can render a signed-out shell while its session is loading.
            authSince ??= Date.now();
            if (Date.now() - authSince >= 2500) break;
          } else {
            authSince = null;
          }
        }
      }
      if (Date.now() >= deadline) break;
      await delay(Math.min(pollMs, Math.max(0, deadline - Date.now())));
    } while (Date.now() < deadline);
  } catch {
    status = 'unavailable';
  } finally {
    if (tabId !== undefined && !adopted) {
      const tab = await tabs.get(tabId).catch(() => null);
      const ownedUrl = url => sameUsagePath(url, source.url) || isAuthRedirect(url);
      const onCollectionPage = tab && (ownedUrl(tab.url) || ((!tab.url || tab.url === 'about:blank') && ownedUrl(tab.pendingUrl)));
      if (onCollectionPage && !adopted && !tab.active && !tab.pinned && (!tab.pendingUrl || ownedUrl(tab.pendingUrl))) {
        await tabs.remove(tabId).catch(() => {});
      }
    }
    tabs.onActivated?.removeListener(onActivated);
  }
  return { source: source.id, status, attemptedAt, message: describeRead(status, source.id, text) };
}
