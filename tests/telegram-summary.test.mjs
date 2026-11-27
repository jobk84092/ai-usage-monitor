import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTelegramSummary, buildExportPayload } from '../src/telegram-summary.mjs';
import { exportLatestSnapshot, postToLocalRelay } from '../src/export-latest.mjs';

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

test('a failed relay never starts a browser download', async () => {
  let downloadCalls = 0;
  const result = await exportLatestSnapshot({
    payload: {},
    fetchImpl: async () => ({ ok: false, status: 503 }),
    downloadsApi: { download: async () => { downloadCalls += 1; return 7; } }
  });
  assert.equal(downloadCalls, 0);
  assert.deepEqual(result, { ok: false, reason: 'http_503' });
});

test('exports to the local relay when it is available', async () => {
  const result = await exportLatestSnapshot({
    payload: { readings: 3 },
    fetchImpl: async (_url, options) => {
      assert.deepEqual(JSON.parse(options.body), { readings: 3 });
      return { ok: true };
    }
  });
  assert.deepEqual(result, { ok: true, reason: 'relay' });
});

test('the relay helper reports failure without throwing', async () => {
  assert.deepEqual(await postToLocalRelay('http://127.0.0.1:9/export', {}, null), { ok: false, reason: 'no_fetch' });
  assert.deepEqual(await exportLatestSnapshot({ payload: {}, fetchImpl: async () => { throw new Error('offline'); } }), { ok: false, reason: 'offline' });
});
