/**
 * Persist the latest sync payload for Telegram relay / Contabo.
 * Prefers local relay (127.0.0.1), falls back to Downloads JSON.
 */

export const DEFAULT_RELAY_URL = 'http://127.0.0.1:8792/export';
export const DOWNLOAD_FILENAME = 'ai-usage-monitor/latest.json';

export async function postToLocalRelay(url, payload, fetchImpl = globalThis.fetch) {
  if (!fetchImpl) return { ok: false, reason: 'no_fetch' };
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) return { ok: false, reason: `http_${response.status}` };
    return { ok: true, reason: 'relay' };
  } catch (error) {
    return { ok: false, reason: String(error?.message || error) };
  }
}

export async function downloadLatestJson(downloadsApi, payload) {
  if (!downloadsApi?.download) return { ok: false, reason: 'no_downloads_api' };
  const blobText = JSON.stringify(payload, null, 2);
  const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(blobText)}`;
  try {
    const id = await downloadsApi.download({
      url: dataUrl,
      filename: DOWNLOAD_FILENAME,
      conflictAction: 'overwrite',
      saveAs: false
    });
    return { ok: true, reason: 'download', id };
  } catch (error) {
    return { ok: false, reason: String(error?.message || error) };
  }
}

export async function exportLatestSnapshot({
  payload,
  relayUrl = DEFAULT_RELAY_URL,
  downloadsApi = null,
  fetchImpl = globalThis.fetch
}) {
  const relay = await postToLocalRelay(relayUrl, payload, fetchImpl);
  if (relay.ok) return relay;
  const downloaded = await downloadLatestJson(downloadsApi, payload);
  if (downloaded.ok) return { ...downloaded, relayError: relay.reason };
  return { ok: false, reason: `relay:${relay.reason}; download:${downloaded.reason}` };
}
