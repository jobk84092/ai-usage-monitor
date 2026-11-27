import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUsage } from '../src/parse-usage.mjs';

test('a missing ChatGPT 5-hour meter does not borrow the weekly value or reset', () => {
  const { metrics, resets } = parseUsage('chatgpt', 'Usage\n5-hour limit\nNot available\nWeekly limit\n73% left\nResets in 5d');
  assert.deepEqual(metrics, { fiveHourRemainingPercent: null, weeklyRemainingPercent: 73 });
  assert.deepEqual(resets, { fiveHour: null, weekly: '5d' });
});

test('recognizes typographic dash and remaining variants without guessing a missing meter', () => {
  const { metrics } = parseUsage('chatgpt', 'Usage\n5‑hour limit\n65% remaining\nWeekly limit\n82% left');
  assert.deepEqual(metrics, { fiveHourRemainingPercent: 65, weeklyRemainingPercent: 82 });
});

test('Ollama does not assign the session meter to weekly usage', () => {
  const { metrics } = parseUsage('ollama', 'Weekly usage\nNo reading\nSession usage\n10% used');
  assert.equal(metrics.weeklyUsedPercent, null);
  assert.equal(metrics.sessionUsedPercent, 10);
});
