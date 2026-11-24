const SOURCE_IDS = new Set(['cursor', 'chatgpt', 'ollama']);

function firstLineAfter(text, label) {
  const at = text.toLowerCase().indexOf(label.toLowerCase());
  if (at < 0) return null;
  return text.slice(at + label.length).split(/\r?\n/).map(s => s.trim()).find(Boolean) || null;
}

function percentAfter(text, label, kind) {
  const at = text.toLowerCase().indexOf(label.toLowerCase());
  if (at < 0) return null;
  const slice = text.slice(at + label.length, at + label.length + 320);
  const m = slice.match(new RegExp('([0-9]+(?:\\.[0-9]+)?)\\s*%\\s*' + kind, 'i'));
  return m ? Number(m[1]) : null;
}

function resetAfter(text, label) {
  const at = text.toLowerCase().indexOf(label.toLowerCase());
  if (at < 0) return null;
  const slice = text.slice(at + label.length, at + label.length + 320);
  const m = slice.match(/resets?\s+(?:in\s+)?([^\n]+)/i);
  return m ? m[1].trim() : null;
}

function moneyAfter(text, label) {
  const at = text.toLowerCase().indexOf(label.toLowerCase());
  if (at < 0) return null;
  const slice = text.slice(at + label.length, at + label.length + 240);
  const m = slice.match(/\$\s*([\d,]+(?:\.\d+)?)/);
  return m ? Number(m[1].replaceAll(',', '')) : null;
}

function parseCursor(text) {
  const planLine = firstLineAfter(text, 'CURRENT PLAN');
  const accountReset = firstLineAfter(text, 'Usage limits reset on');
  const onDemandAt = text.toLowerCase().indexOf('on-demand usage');
  let onDemandSpent = null, onDemandLimit = null;
  if (onDemandAt >= 0) {
    const m = text.slice(onDemandAt, onDemandAt + 300).match(/\$\s*([\d,]+(?:\.\d+)?)\s*\/\s*\$\s*([\d,]+(?:\.\d+)?)/i);
    if (m) { onDemandSpent = Number(m[1].replaceAll(',', '')); onDemandLimit = Number(m[2].replaceAll(',', '')); }
  }
  const metrics = {
    cursorModelsUsedPercent: percentAfter(text, 'Cursor Models', 'used'),
    otherModelsUsedPercent: percentAfter(text, 'Other Models', 'used'),
    weeklyUsedPercent: percentAfter(text, 'Weekly usage', 'used'),
    onDemandSpent,
    onDemandLimit
  };
  const hasAny = Object.values(metrics).some(v => v !== null);
  if (!hasAny) return null;
  return {
    provider: 'cursor', status: 'ok', plan: planLine, period: null, metrics,
    resets: { account: accountReset, weekly: resetAfter(text, 'Weekly usage') }
  };
}

function parseChatGPT(text) {
  const metrics = {
    fiveHourRemainingPercent: percentAfter(text, '5-hour limit', 'left'),
    weeklyRemainingPercent: percentAfter(text, 'Weekly limit', 'left')
  };
  if (Object.values(metrics).every(v => v === null)) return null;
  return {
    provider: 'chatgpt', status: 'ok', plan: null, period: null, metrics,
    resets: { fiveHour: resetAfter(text, '5-hour limit'), weekly: resetAfter(text, 'Weekly limit') }
  };
}

function parseOllama(text) {
  const greetingAt = text.toLowerCase().indexOf('good morning');
  const plan = greetingAt >= 0 ? firstLineAfter(text.slice(greetingAt), text.slice(greetingAt).split(/\r?\n/)[0]) : null;
  const metrics = {
    usageCredits: moneyAfter(text, 'Usage credits'),
    weeklyUsedPercent: percentAfter(text, 'Weekly usage', 'used'),
    sessionUsedPercent: percentAfter(text, 'Session usage', 'used')
  };
  if (Object.values(metrics).every(v => v === null)) return null;
  return {
    provider: 'ollama', status: 'ok', plan, period: null, metrics,
    resets: { weekly: resetAfter(text, 'Weekly usage'), session: resetAfter(text, 'Session usage') }
  };
}

const DIAGNOSTIC_MARKERS = {
  cursor: {
    currentPlan: /current plan/i,
    cursorModels: /cursor models/i,
    weeklyUsage: /weekly usage/i
  },
  chatgpt: {
    fiveHourLimit: /5[-\u2010-\u2015 ]hour\s+limit/i,
    weeklyLimit: /weekly\s+limit/i,
    percentLeft: /[0-9]+(?:\.[0-9]+)?\s*%\s*left/i
  },
  ollama: {
    usageCredits: /usage credits/i,
    weeklyUsage: /weekly usage/i,
    sessionUsage: /session usage/i
  }
};

export function usagePageDiagnostics(provider, rawText) {
  if (!SOURCE_IDS.has(provider)) throw new Error(`Unknown usage source: ${provider}`);
  const text = String(rawText || '').replace(/\r/g, '').trim();
  const markers = Object.fromEntries(
    Object.entries(DIAGNOSTIC_MARKERS[provider]).map(([name, pattern]) => [name, pattern.test(text)])
  );
  return { visibleChars: text.length, markers };
}

export function parseUsage(provider, rawText) {
  if (!SOURCE_IDS.has(provider)) throw new Error(`Unknown usage source: ${provider}`);
  const text = String(rawText || '').replace(/\r/g, '').trim();
  if (/attention required|just a moment|cloudflare|security verification|verify you are human/i.test(text)) {
    return { provider, status: 'blocked', plan: null, period: null, metrics: {}, resets: {} };
  }

  const parsers = {
    cursor: parseCursor,
    chatgpt: parseChatGPT,
    ollama: parseOllama
  };
  const parsed = parsers[provider](text);
  if (parsed) return parsed;
  if (/\b(sign in|log in|login|create account|continue with email)\b/i.test(text)) {
    return { provider, status: 'auth_required', plan: null, period: null, metrics: {}, resets: {} };
  }
  return { provider, status: 'unrecognized', plan: null, period: null, metrics: {}, resets: {} };
}
