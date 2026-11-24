import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUsage, usagePageDiagnostics } from '../src/parse-usage.mjs';

test('parses Cursor plan meters and separate reset windows', () => {
  const text = `Spending\nCURRENT PLAN\nPro\n$25/mo\nUsage limits reset on Jan 31 (30 days left)\nIncluded in Pro\nCursor Models\nIncludes Cursor Grok and Composer\n34% used\nOther Models\n12% used\nGrok Bot\nWeekly usage\n46% used\nResets Jan 10 (9 days left)\nOn-Demand Usage\nOn-Demand\n$8.50 / $100`;
  assert.deepEqual(parseUsage('cursor', text), {
    provider: 'cursor', status: 'ok', plan: 'Pro', period: null,
    metrics: { cursorModelsUsedPercent: 34, otherModelsUsedPercent: 12, weeklyUsedPercent: 46, onDemandSpent: 8.5, onDemandLimit: 100 },
    resets: { account: 'Jan 31 (30 days left)', weekly: 'Jan 10 (9 days left)' }
  });
});

test('parses ChatGPT remaining allowances and reset countdowns', () => {
  const text = `Usage\nOverview\nPlan limits\n5-hour limit\nResets in 2h 20m\n84% left\nWeekly limit\nResets in 1d 4h\n36% left`;
  assert.deepEqual(parseUsage('chatgpt', text), {
    provider: 'chatgpt', status: 'ok', plan: null, period: null,
    metrics: { fiveHourRemainingPercent: 84, weeklyRemainingPercent: 36 },
    resets: { fiveHour: '2h 20m', weekly: '1d 4h' }
  });
});

test('parses Ollama cloud plan credits and weekly/session limits', () => {
  const text = `Dashboard\nUsage\nKeys\nBilling\nProfile\nModels\nGood morning, user\nPro\nUsage credits\n$7.25\nWeekly usage\n37.2% used\nResets in 4 days\nSession usage\n18.6% used\nResets in 7 hours`;
  assert.deepEqual(parseUsage('ollama', text), {
    provider: 'ollama', status: 'ok', plan: 'Pro', period: null,
    metrics: { usageCredits: 7.25, weeklyUsedPercent: 37.2, sessionUsedPercent: 18.6 },
    resets: { weekly: '4 days', session: '7 hours' }
  });
});

test('rejects the retired OpenAI API source', () => {
  assert.throws(() => parseUsage('openai-api', 'Analytics\nTotal tokens\n0'), /Unknown usage source/);
});

test('keeps ChatGPT tool limits separate and parses the live usage page', () => {
  const text = `Usage\nTrack your usage and check your limits\nOverview\nAnalytics\nPlan limits\nShared across Codex, Work, Workspace Agents, and ChatGPT for Excel. Chat conversations are not included.\n5-hour limit\nResets in 1h 45m\n72% left\nWeekly limit\nResets in 2d 8h\n48% left`;
  assert.deepEqual(parseUsage('chatgpt', text), {
    provider: 'chatgpt', status: 'ok', plan: null, period: null,
    metrics: { fiveHourRemainingPercent: 72, weeklyRemainingPercent: 48 },
    resets: { fiveHour: '1h 45m', weekly: '2d 8h' }
  });
});

test('parses ChatGPT usage labels from a representative page', () => {
  const text = `Settings\nUsage\nTrack your usage and check your limits\nOverview\nAnalytics\nPlan limits\nShared across Codex, Work, Workspace Agents, and ChatGPT for Excel. Chat conversations are not included.\n5-hour limit\nResets in 2h 10m\n87% left\nWeekly limit\nResets in 1d 6h\n42% left`;
  assert.deepEqual(parseUsage('chatgpt', text), {
    provider: 'chatgpt', status: 'ok', plan: null, period: null,
    metrics: { fiveHourRemainingPercent: 87, weeklyRemainingPercent: 42 },
    resets: { fiveHour: '2h 10m', weekly: '1d 6h' }
  });
});

test('flags sign-in and security challenge pages instead of recording zero usage', () => {
  assert.equal(parseUsage('cursor', 'Sign in\nEmail\nContinue').status, 'auth_required');
  assert.equal(parseUsage('chatgpt', 'Login to continue').status, 'auth_required');
  assert.equal(parseUsage('ollama', 'Attention Required!\nCloudflare verification').status, 'blocked');
});

test('diagnostics expose only marker presence, not account usage text or values', () => {
  const text = `Settings\nUsage\nPlan limits\n5-hour limit\nResets in 1h 15m\n68% left\nWeekly limit\nResets in 1d 3h\n54% left`;
  assert.deepEqual(usagePageDiagnostics('chatgpt', text), {
    visibleChars: text.length,
    markers: { fiveHourLimit: true, weeklyLimit: true, percentLeft: true }
  });
  assert.deepEqual(usagePageDiagnostics('ollama', 'Sign in to continue'), {
    visibleChars: 19,
    markers: { usageCredits: false, weeklyUsage: false, sessionUsage: false }
  });
});
