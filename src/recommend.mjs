function latestSnapshot(snapshots, provider) {
  return (Array.isArray(snapshots) ? snapshots : [])
    .filter(item => item?.provider === provider && item.status === 'ok')
    .sort((a, b) => Date.parse(b.capturedAt || 0) - Date.parse(a.capturedAt || 0))[0] || null;
}

export function headroomForSnapshot(snapshot) {
  if (!snapshot || snapshot.status !== 'ok') return null;
  const m = snapshot.metrics || {};
  if (snapshot.provider === 'cursor') {
    const used = [m.cursorModelsUsedPercent, m.otherModelsUsedPercent, m.weeklyUsedPercent].filter(Number.isFinite);
    return used.length ? Math.max(0, 100 - Math.max(...used)) : null;
  }
  if (snapshot.provider === 'chatgpt') {
    const remaining = [m.fiveHourRemainingPercent, m.weeklyRemainingPercent].filter(Number.isFinite);
    return remaining.length ? Math.max(0, Math.min(...remaining)) : null;
  }
  if (snapshot.provider === 'ollama') {
    const used = [m.weeklyUsedPercent, m.sessionUsedPercent].filter(Number.isFinite);
    return used.length ? Math.max(0, 100 - Math.max(...used)) : null;
  }
  return null;
}

export function chooseBudgetRoute(route, snapshots, threshold = 20) {
  const primaryHeadroom = headroomForSnapshot(latestSnapshot(snapshots, route?.primaryProvider));
  const backupHeadroom = route?.backupProvider ? headroomForSnapshot(latestSnapshot(snapshots, route.backupProvider)) : null;
  if (primaryHeadroom === null) return { selection: 'primary', primaryHeadroom, backupHeadroom, reason: 'primary_budget_unknown' };
  if (primaryHeadroom > threshold) return { selection: 'primary', primaryHeadroom, backupHeadroom, reason: 'primary_has_headroom' };
  if (!route?.backupModel || !route?.backupProvider) return { selection: 'primary', primaryHeadroom, backupHeadroom, reason: 'no_backup' };
  if (backupHeadroom === null) return { selection: 'primary', primaryHeadroom, backupHeadroom, reason: 'backup_budget_unknown' };
  if (backupHeadroom > primaryHeadroom) return { selection: 'backup', primaryHeadroom, backupHeadroom, reason: 'backup_has_more_headroom' };
  return { selection: 'primary', primaryHeadroom, backupHeadroom, reason: 'backup_not_better' };
}
