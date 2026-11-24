import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseBudgetRoute } from '../src/recommend.mjs';

const snap = (provider, metrics, capturedAt='2026-11-24T10:00:00.000Z') => ({ provider, status:'ok', metrics, capturedAt });

test('chooses a backup only when measured headroom is better', () => {
  const route = { primaryProvider:'cursor', backupProvider:'ollama', backupModel:'qwen3.5:cloud' };
  const snapshots = [
    snap('cursor', { weeklyUsedPercent:85, cursorModelsUsedPercent:50, otherModelsUsedPercent:0 }),
    snap('ollama', { weeklyUsedPercent:30, sessionUsedPercent:10 })
  ];
  const result = chooseBudgetRoute(route, snapshots);
  assert.equal(result.selection, 'backup');
  assert.equal(result.primaryHeadroom, 15);
  assert.equal(result.backupHeadroom, 70);
  assert.equal(result.reason, 'backup_has_more_headroom');
});

test('does not assume an unmetered backup has spare budget', () => {
  const route = { primaryProvider:'chatgpt', backupProvider:'ollama', backupModel:'qwen3.5:cloud' };
  const snapshots = [snap('chatgpt', { fiveHourRemainingPercent:80, weeklyRemainingPercent:10 })];
  const result = chooseBudgetRoute(route, snapshots);
  assert.equal(result.selection, 'primary');
  assert.equal(result.primaryHeadroom, 10);
  assert.equal(result.backupHeadroom, null);
  assert.equal(result.reason, 'backup_budget_unknown');
});

test('keeps the configured primary when it has no current budget meter', () => {
  const route = { primaryProvider:'chatgpt', backupProvider:'ollama', backupModel:'llama3.3' };
  const snapshots = [snap('chatgpt', {}), snap('ollama', {})];
  const result = chooseBudgetRoute(route, snapshots);
  assert.equal(result.selection, 'primary');
  assert.equal(result.primaryHeadroom, null);
  assert.equal(result.reason, 'primary_budget_unknown');
});
