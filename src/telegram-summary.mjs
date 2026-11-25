/** Build a short Telegram-friendly usage digest from export/sync payload. */

const LABELS = {
  cursor: 'Cursor',
  chatgpt: 'ChatGPT tools',
  ollama: 'Ollama'
};

function fmtPct(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  return `${Number(value).toFixed(Number(value) % 1 ? 1 : 0)}%`;
}

function fmtMoney(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  return `$${Number(value).toFixed(2)}`;
}

function stamp(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: false, timeZone: 'Africa/Nairobi'
  }).format(date);
}

function latestByProvider(snapshots = []) {
  const latest = {};
  for (const snap of snapshots) {
    const id = snap?.provider;
    if (!id) continue;
    if (!latest[id] || String(snap.capturedAt || '') > String(latest[id].capturedAt || '')) latest[id] = snap;
  }
  return latest;
}

function cursorLine(snap) {
  const m = snap?.metrics || {};
  const parts = [
    fmtPct(m.cursorModelsUsedPercent) && `models ${fmtPct(m.cursorModelsUsedPercent)} used`,
    fmtPct(m.otherModelsUsedPercent) && `other ${fmtPct(m.otherModelsUsedPercent)} used`,
    fmtPct(m.weeklyUsedPercent) && `week ${fmtPct(m.weeklyUsedPercent)} used`
  ].filter(Boolean);
  const onDemand = fmtMoney(m.onDemandSpent) && fmtMoney(m.onDemandLimit)
    ? `on-demand ${fmtMoney(m.onDemandSpent)} / ${fmtMoney(m.onDemandLimit)}`
    : null;
  return [...parts, onDemand].filter(Boolean).join(' · ') || 'no meters';
}

function chatgptLine(snap) {
  const m = snap?.metrics || {};
  const parts = [
    fmtPct(m.fiveHourRemainingPercent) && `5h ${fmtPct(m.fiveHourRemainingPercent)} left`,
    fmtPct(m.weeklyRemainingPercent) && `week ${fmtPct(m.weeklyRemainingPercent)} left`
  ].filter(Boolean);
  return parts.join(' · ') || 'no meters';
}

function ollamaLine(snap) {
  const m = snap?.metrics || {};
  const parts = [
    fmtMoney(m.usageCredits) && `credits ${fmtMoney(m.usageCredits)}`,
    fmtPct(m.weeklyUsedPercent) && `week ${fmtPct(m.weeklyUsedPercent)} used`,
    fmtPct(m.sessionUsedPercent) && `session ${fmtPct(m.sessionUsedPercent)} used`
  ].filter(Boolean);
  return parts.join(' · ') || 'no meters';
}

function lineFor(provider, snap) {
  if (provider === 'cursor') return cursorLine(snap);
  if (provider === 'chatgpt') return chatgptLine(snap);
  if (provider === 'ollama') return ollamaLine(snap);
  return 'no meters';
}

function statusNote(status = {}) {
  if (!status.status || status.status === 'ok') return '';
  if (status.status === 'no_data') return 'no numeric data in range';
  if (status.status === 'auth_required') return 'sign-in needed';
  if (status.status === 'blocked') return 'security check';
  if (status.status === 'unavailable') return 'not reachable';
  if (status.status === 'unrecognized') return 'page not recognized';
  return status.status;
}

/**
 * @param {object} payload export or storage-shaped object
 * @returns {string}
 */
export function formatTelegramSummary(payload = {}) {
  const latest = payload.latest && Object.keys(payload.latest).length
    ? payload.latest
    : latestByProvider(payload.snapshots || []);
  const sourceStatus = payload.sourceStatus || {};
  const when = stamp(payload.lastSyncAt || payload.exportedAt) || 'unknown time';
  const host = payload.host ? ` · ${payload.host}` : '';
  const trigger = payload.lastSyncTrigger ? ` · ${payload.lastSyncTrigger}` : '';

  const lines = [`AI usage · ${when}${host}`];
  for (const id of ['cursor', 'chatgpt', 'ollama']) {
    const snap = latest[id];
    const note = statusNote(sourceStatus[id]);
    lines.push('');
    lines.push(LABELS[id] + (snap?.plan ? ` · ${snap.plan}` : ''));
    if (snap) lines.push(`· ${lineFor(id, snap)}`);
    else lines.push(`· ${note || 'no reading yet'}`);
    if (snap && note && sourceStatus[id]?.status !== 'ok') lines.push(`· ${note}`);
  }
  lines.push('');
  lines.push(`Sync${trigger}`);
  return lines.join('\n');
}

export function buildExportPayload({
  snapshots = [],
  sourceStatus = {},
  lastSyncAt = null,
  lastSyncTrigger = '',
  host = '',
  exportedAt = new Date().toISOString()
} = {}) {
  return {
    schema: 'ai-usage-monitor/v1',
    exportedAt,
    host,
    lastSyncAt,
    lastSyncTrigger,
    sourceStatus,
    latest: latestByProvider(snapshots),
    snapshotCount: Array.isArray(snapshots) ? snapshots.length : 0
  };
}
