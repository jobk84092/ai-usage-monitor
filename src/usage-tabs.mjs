function normalizedPath(pathname) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

export function selectMatchingUsageTab(tabs, usageUrl) {
  let expected;
  try { expected = new URL(usageUrl); } catch { return null; }

  const matches = (Array.isArray(tabs) ? tabs : []).filter(tab => {
    try {
      const candidate = new URL(tab?.url);
      return candidate.origin === expected.origin &&
        normalizedPath(candidate.pathname) === normalizedPath(expected.pathname);
    } catch { return false; }
  });

  matches.sort((a, b) =>
    Number(b.status === 'complete') - Number(a.status === 'complete') ||
    Number(Boolean(b.active)) - Number(Boolean(a.active))
  );
  return matches[0] || null;
}

export function sameUsagePath(candidateUrl, usageUrl) {
  try {
    const candidate = new URL(candidateUrl);
    const expected = new URL(usageUrl);
    return candidate.origin === expected.origin &&
      normalizedPath(candidate.pathname) === normalizedPath(expected.pathname);
  } catch {
    return false;
  }
}

/**
 * Resolve a durable usage tab for a provider.
 * Prefer a remembered session tab, then any open matching tab, else create one.
 * Callers should keep these tabs open so the browser session stays signed in.
 */
export async function ensurePersistentUsageTab(tabsApi, source, sessionTabId) {
  if (sessionTabId !== undefined && sessionTabId !== null) {
    const remembered = await tabsApi.get(sessionTabId).catch(() => null);
    if (remembered?.id !== undefined) {
      if (!sameUsagePath(remembered.url, source.url)) {
        await tabsApi.update(remembered.id, { url: source.url, active: false });
      }
      return { tabId: remembered.id, created: false, reusedSession: true };
    }
  }

  const matches = await tabsApi.query({ url: `${source.url}*` });
  const existing = selectMatchingUsageTab(matches, source.url);
  if (existing?.id !== undefined) return { tabId: existing.id, created: false, reusedSession: false };

  const tab = await tabsApi.create({ url: source.url, active: false });
  if (tab?.id === undefined) throw new Error('The browser did not create a tab.');
  return { tabId: tab.id, created: true, reusedSession: false };
}

/** @deprecated Prefer ensurePersistentUsageTab — kept for older tests/callers. */
export async function getOrCreateUsageTab(tabsApi, source) {
  const result = await ensurePersistentUsageTab(tabsApi, source, null);
  return { tabId: result.tabId, created: result.created };
}
