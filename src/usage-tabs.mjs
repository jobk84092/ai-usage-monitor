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

export async function getOrCreateUsageTab(tabsApi, source) {
  const matches = await tabsApi.query({ url: `${source.url}*` });
  const existing = selectMatchingUsageTab(matches, source.url);
  if (existing?.id !== undefined) return { tabId: existing.id, created: false };

  const tab = await tabsApi.create({ url: source.url, active: false });
  if (tab?.id === undefined) throw new Error('The browser did not create a tab.');
  return { tabId: tab.id, created: true };
}
