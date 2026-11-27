export async function openUsageTab(tabsApi, source) {
  const candidates = await tabsApi.query({ url: `${source.url}*` });
  const existing = selectMatchingUsageTab(candidates.filter(tab => !tab.incognito), source.url);
  if (existing?.id !== undefined) return tabsApi.update(existing.id, { active: true });
  return tabsApi.create({ url: source.url, active: true });
}

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
