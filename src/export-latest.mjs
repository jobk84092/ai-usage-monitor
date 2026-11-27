// Deliver the latest snapshot to the optional local Telegram relay.
export const DEFAULT_RELAY_URL = 'http://127.0.0.1:8792/export';

export async function postToLocalRelay(url, payload, fetchImpl = globalThis.fetch) {
  if (!fetchImpl) return { ok: false, reason: 'no_fetch' };
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) return { ok: false, reason: `http_${response.status}` };
    return { ok: true, reason: 'relay' };
  } catch (error) {
    return { ok: false, reason: String(error?.message || error) };
  }
}

export function exportLatestSnapshot({ payload, relayUrl = DEFAULT_RELAY_URL, fetchImpl = globalThis.fetch }) {
  // The caller has already persisted the snapshot. Never fall back to a browser download.
  return postToLocalRelay(relayUrl, payload, fetchImpl);
}
