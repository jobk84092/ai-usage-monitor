import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTelegramSummary, buildExportPayload } from '../src/telegram-summary.mjs';
import { exportLatestSnapshot, postToLocalRelay, downloadLatestJson } from '../src/export-latest.mjs';

test('formats a tidy multi-provider Telegram digest', () => {
  const text = formatTelegramSummary({
    lastSyncAt: '2026-11-25T13:00:00.000Z',
    lastSyncTrigger: 'hourly',
    host: 'hp',
    sourceStatus: {
      cursor: { status: 'ok' },
      chatgpt: { status: 'ok' },
      ollama: { status: 'auth_required' }
    },
    latest: {
      cursor: {
        provider: 'cursor',
        plan: 'Pro',
        capturedAt: '2026-11-25T13:00:00.000Z',
        metrics: {
          cursorModelsUsedPercent: 42.5,
          otherModelsUsedPercent: 10,
          weeklyUsedPercent: 55,
          onDemandSpent: 3.2,
          onDemandLimit: 50
        }
      },
      chatgpt: {
        provider: 'chatgpt',
        capturedAt: '2026-11-25T13:00:00.000Z',
        metrics: { fiveHourRemainingPercent: 60, weeklyRemainingPercent: 80 }
      }
    }
  });

  assert.match(text, /^AI usage · /);
  assert.match(text, /Cursor · Pro/);
  assert.match(text, /models 42\.5% used/);
  assert.match(text, /ChatGPT tools/);
  assert.match(text, /5h 60% left/);
  assert.match(text, /Ollama/);
  assert.match(text, /sign-in needed/);
  assert.match(text, /Sync · hourly/);
  assert.match(text, /hp/);
});

test('buildExportPayload keeps only the newest snapshot per provider', () => {
  const payload = buildExportPayload({
    snapshots: [
      { provider: 'cursor', capturedAt: '2026-11-25T10:00:00.000Z', metrics: { weeklyUsedPercent: 1 } },
      { provider: 'cursor', capturedAt: '2026-11-25T12:00:00.000Z', metrics: { weeklyUsedPercent: 9 } },
      { provider: 'ollama', capturedAt: '2026-11-25T11:00:00.000Z', metrics: { usageCredits: 2 } }
    ],
    lastSyncAt: '2026-11-25T12:00:00.000Z',
    lastSyncTrigger: 'manual',
    host: 'mac'
  });
  assert.equal(payload.schema, 'ai-usage-monitor/v1');
  assert.equal(payload.latest.cursor.metrics.weeklyUsedPercent, 9);
  assert.equal(payload.latest.ollama.metrics.usageCredits, 2);
  assert.equal(payload.snapshotCount, 3);
});

test('export prefers local relay and falls back to downloads', async () => {
  const relayOk = await exportLatestSnapshot({
    payload: { ok: true },
    fetchImpl: async () => ({ ok: true }),
    downloadsApi: { download: async () => { throw new Error('should not download'); } }
  });
  assert.deepEqual(relayOk, { ok: true, reason: 'relay' });

  const fallback = await exportLatestSnapshot({
    payload: { hello: 'world' },
    fetchImpl: async () => { throw new Error('relay down'); },
    downloadsApi: {
      download: async options => {
        assert.match(options.filename, /ai-usage-monitor\/latest\.json/);
        assert.equal(options.conflictAction, 'overwrite');
        return 7;
      }
    }
  });
  assert.equal(fallback.ok, true);
  assert.equal(fallback.reason, 'download');
  assert.match(fallback.relayError, /relay down/);
});

test('relay and download helpers report soft failures', async () => {
  assert.deepEqual(await postToLocalRelay('http://127.0.0.1:9/export', {}, null), { ok: false, reason: 'no_fetch' });
  assert.deepEqual(await downloadLatestJson(null, {}), { ok: false, reason: 'no_downloads_api' });
});
