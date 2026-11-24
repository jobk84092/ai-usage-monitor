import { chooseBudgetRoute } from '../src/recommend.mjs';

const SOURCES = [
  { id: 'cursor', name: 'Cursor', blurb: 'Plan and model-use limits', color: '#586c7c' },
  { id: 'chatgpt', name: 'ChatGPT tools', blurb: 'Codex / Work / Agents / Excel limits', color: '#25644a' },
  { id: 'ollama', name: 'Ollama', blurb: 'Cloud plan and usage credits', color: '#a27842' }
];
const ACTIVE_SOURCE_IDS = new Set(SOURCES.map(source => source.id));
const $ = id => document.getElementById(id);
let dataCache = { snapshots: [], sourceStatus: {}, modelRoutes: [], autoSync: true };
let toastTimer;

function send(message) {
  return browser.runtime.sendMessage(message)
    .catch(error => ({ error: String(error?.message || error) }));
}
function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function fmtNum(value, decimals = 0) {
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: decimals }).format(Number(value));
}
function fmtMoney(value) { return value === null || value === undefined ? '—' : `$${Number(value).toFixed(2)}`; }
function stamp(value) {
  if (!value) return 'not synced yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'not synced yet' : new Intl.DateTimeFormat('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }).format(date);
}
function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function latestFor(sourceId) {
  return dataCache.snapshots.filter(s => s.provider === sourceId).sort((a,b) => b.capturedAt.localeCompare(a.capturedAt))[0] || null;
}
function metric(label, value, note = '') {
  return `<div class="metric"><span class="metric-label">${escapeHTML(label)}</span><span class="metric-value">${escapeHTML(value)}</span>${note ? `<span class="metric-note">${escapeHTML(note)}</span>` : ''}</div>`;
}
function statusLabel(status) {
  return ({ ok: 'Connected', no_data: 'No data in range', auth_required: 'Sign-in needed', blocked: 'Security check', unavailable: 'Not reachable', unrecognized: 'Page not recognized' })[status] || 'Waiting for sync';
}
function sourceMetrics(snapshot, status = {}) {
  if (!snapshot) {
    if (status.status === 'no_data') return `<div class="empty-service">${escapeHTML(status.message || 'The provider did not display numeric usage for this range; no zero was recorded.')}</div>`;
    return `<div class="empty-service">No successful reading yet. Open the service in your browser, sign in if needed, then run Sync now.</div>`;
  }
  const m = snapshot.metrics || {}, r = snapshot.resets || {};
  if (snapshot.provider === 'cursor') {
    return [
      metric('Cursor models', m.cursorModelsUsedPercent === null ? '—' : `${fmtNum(m.cursorModelsUsedPercent,1)}% used`),
      metric('Other models', m.otherModelsUsedPercent === null ? '—' : `${fmtNum(m.otherModelsUsedPercent,1)}% used`),
      metric('Weekly use', m.weeklyUsedPercent === null ? '—' : `${fmtNum(m.weeklyUsedPercent,1)}% used`, r.weekly ? `Resets ${r.weekly}` : ''),
      metric('On-demand', m.onDemandSpent === null ? '—' : `${fmtMoney(m.onDemandSpent)} / ${fmtMoney(m.onDemandLimit)}`, r.account ? `Plan resets ${r.account}` : '')
    ].join('');
  }
  if (snapshot.provider === 'chatgpt') {
    return [
      metric('5-hour limit', m.fiveHourRemainingPercent === null ? '—' : `${fmtNum(m.fiveHourRemainingPercent,1)}% left`, r.fiveHour ? `Resets in ${r.fiveHour}` : ''),
      metric('Weekly limit', m.weeklyRemainingPercent === null ? '—' : `${fmtNum(m.weeklyRemainingPercent,1)}% left`, r.weekly ? `Resets in ${r.weekly}` : '')
    ].join('');
  }
  if (snapshot.provider === 'ollama') {
    return [
      metric('Usage credits', fmtMoney(m.usageCredits)),
      metric('Weekly usage', m.weeklyUsedPercent === null ? '—' : `${fmtNum(m.weeklyUsedPercent,1)}% used`, r.weekly ? `Resets in ${r.weekly}` : ''),
      metric('Session usage', m.sessionUsedPercent === null ? '—' : `${fmtNum(m.sessionUsedPercent,1)}% used`, r.session ? `Resets in ${r.session}` : '')
    ].join('');
  }
  return `<div class="empty-service">No recognized usage fields.</div>`;
}
function renderServices() {
  $('services').innerHTML = SOURCES.map(source => {
    const snapshot = latestFor(source.id);
    const status = dataCache.sourceStatus[source.id] || {};
    const statusText = statusLabel(status.status);
    const updated = snapshot ? `Updated ${stamp(snapshot.capturedAt)}` : status.attemptedAt ? `Checked ${stamp(status.attemptedAt)}` : 'Not checked';
    const plan = snapshot?.plan ? `<span class="service-plan">${escapeHTML(snapshot.plan)}</span>` : `<span class="service-plan">${escapeHTML(source.blurb)}</span>`;
    const warning = status.status && status.status !== 'ok' && !(status.status === 'no_data' && !snapshot) ? `<div class="empty-service">${escapeHTML(status.message || statusText)}</div>` : '';
    return `<article class="service" style="--tone:${source.color}">
      <div class="service-name"><span class="dot"></span><div><strong>${source.name}</strong><small>${escapeHTML(source.blurb)}</small></div></div>
      <div class="service-body"><div class="service-top">${plan}<span class="service-updated">${escapeHTML(updated)}</span></div><div class="metrics">${sourceMetrics(snapshot,status)}</div>${warning}</div>
      <div class="service-action"><span class="status ${escapeHTML(status.status || 'stale')}">${escapeHTML(statusText)}</span>${status.status === 'auth_required' || status.status === 'blocked' || status.status === 'unavailable' ? `<button class="text-button" data-open-source="${source.id}" type="button">Open ${source.name}</button>` : ''}</div>
    </article>`;
  }).join('');
}
function monthSnapshots() {
  const month = $('monthFilter').value || currentMonth();
  return dataCache.snapshots.filter(s => ACTIVE_SOURCE_IDS.has(s.provider) && String(s.capturedAt || '').startsWith(month)).sort((a,b) => b.capturedAt.localeCompare(a.capturedAt));
}
function snapshotSummary(s) {
  const m=s.metrics||{};
  if(s.provider==='cursor') return `Cursor ${fmtNum(m.cursorModelsUsedPercent,1)}% · other ${fmtNum(m.otherModelsUsedPercent,1)}% · week ${fmtNum(m.weeklyUsedPercent,1)}%`;
  if(s.provider==='chatgpt') return `5h ${fmtNum(m.fiveHourRemainingPercent,1)}% left · week ${fmtNum(m.weeklyRemainingPercent,1)}% left`;
  if (s.provider==='ollama') return `Credits ${fmtMoney(m.usageCredits)} · week ${fmtNum(m.weeklyUsedPercent,1)}% · session ${fmtNum(m.sessionUsedPercent,1)}%`;
  return 'Usage snapshot';
}
function renderHistory() {
  const snapshots=monthSnapshots();
  if(!snapshots.length){$('history').innerHTML='<div class="empty">No snapshots for this month. The extension saves each successful hourly sync.</div>';return;}
  $('history').innerHTML=`<table><thead><tr><th>Captured</th><th>Account</th><th>Reading</th></tr></thead><tbody>${snapshots.slice(0,100).map(s=>`<tr><td class="mono">${escapeHTML(stamp(s.capturedAt))}</td><td>${escapeHTML(SOURCES.find(p=>p.id===s.provider)?.name||s.provider)}</td><td>${escapeHTML(snapshotSummary(s))}</td></tr>`).join('')}</tbody></table>`;
}
function renderRoutes() {
  const routes=dataCache.modelRoutes||[];
  if(!routes.length){$('routes').innerHTML='<div class="empty">Add a primary and optional backup. The monitor suggests the backup only when both services have measured headroom and the backup has more.</div>';return;}
  $('routes').innerHTML=routes.map(route=>{
    const decision=chooseBudgetRoute(route,dataCache.snapshots||[]);
    const usingBackup=decision.selection==='backup';
    const selectedModel=usingBackup?route.backupModel:route.primaryModel;
    const selectedProvider=usingBackup?route.backupProvider:route.primaryProvider;
    const status={
      primary_budget_unknown:'No current cap reading for primary service; keep your preference.',
      primary_has_headroom:`Primary has ${fmtNum(decision.primaryHeadroom,1)}% headroom in its tightest reported window.`,
      no_backup:`Primary has ${fmtNum(decision.primaryHeadroom,1)}% headroom; no backup is set.`,
      backup_budget_unknown:`Primary has ${fmtNum(decision.primaryHeadroom,1)}% headroom; backup budget is unknown, so no switch is suggested.`,
      backup_has_more_headroom:`Primary has ${fmtNum(decision.primaryHeadroom,1)}%; backup has ${fmtNum(decision.backupHeadroom,1)}% headroom.`,
      backup_not_better:`Primary has ${fmtNum(decision.primaryHeadroom,1)}% headroom; backup has no more measured headroom.`
    }[decision.reason];
    return `<article class="route"><div class="route-head"><div><div class="route-purpose">${escapeHTML(route.purpose)}</div><div class="route-choice">Use ${escapeHTML(selectedModel)} <small>· ${escapeHTML(SOURCES.find(s=>s.id===selectedProvider)?.name||selectedProvider)}</small></div></div><div class="route-status">${escapeHTML(status)}</div></div><div class="route-sub">Primary: ${escapeHTML(route.primaryModel)} (${escapeHTML(SOURCES.find(s=>s.id===route.primaryProvider)?.name||route.primaryProvider)})${route.backupModel?` · Backup: ${escapeHTML(route.backupModel)} (${escapeHTML(SOURCES.find(s=>s.id===route.backupProvider)?.name||route.backupProvider)})`:''}<button class="delete" type="button" data-delete-route="${escapeHTML(route.id)}" aria-label="Delete route">×</button></div></article>`;
  }).join('');
}
function renderSyncStatus() {
  const last=dataCache.lastSyncAt;
  const trigger=({manual:'manual',hourly:'hourly alarm',startup:'browser start',install:'extension reload'})[dataCache.lastSyncTrigger]||'';
  const lastSync=last?`Last sync ${stamp(last)}${trigger?` (${trigger})`:''}`:'No account sync yet';
  const alarmStatus=dataCache.autoSync===false?'auto-sync paused':dataCache.lastAlarmAt?`last hourly alarm ${stamp(dataCache.lastAlarmAt)}`:'no hourly alarm recorded yet';
  $('syncStatus').textContent=dataCache.syncing?`Syncing account pages… · ${alarmStatus}`:`${lastSync} · ${alarmStatus} · snapshots stay on this browser profile`;
  $('syncButton').disabled=Boolean(dataCache.syncing);
  $('syncButton').textContent=dataCache.syncing?'Syncing…':'Sync now';
  $('autoSync').checked=dataCache.autoSync!==false;
  $('syncFooter').textContent=dataCache.autoSync===false?'Auto-sync paused; use Sync now when you want a fresh reading.':'Hourly checks require Chrome and the Mac to stay awake; alarms can be delayed.';
}
function render() { renderSyncStatus(); renderServices(); renderHistory(); renderRoutes(); }
async function loadData() {
  const data=await browser.runtime.sendMessage({type:'get-data'}).catch(()=>null);
  dataCache=data||dataCache;
  render();
}
function toast(message) {
  const node=$('toast');node.textContent=message;node.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('show'),2600);
}
function providerOptions() {
  return SOURCES.map(s=>`<option value="${s.id}">${escapeHTML(s.name)}</option>`).join('');
}
function downloadJSON(name, value) {
  const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'});
  const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}

$('monthFilter').value=currentMonth();
$('primaryProvider').innerHTML=providerOptions();
$('backupProvider').innerHTML=providerOptions();
$('monthFilter').addEventListener('change',renderHistory);
$('syncButton').addEventListener('click',async()=>{
  $('syncButton').disabled=true;$('syncButton').textContent='Syncing…';
  const result=await send({type:'sync-now'});
  await loadData();
  const statuses=result.results||[];
  const checked=statuses.filter(x=>x.status==='ok'||x.status==='no_data').length;
  const withValues=statuses.filter(x=>x.status==='ok').length;
  toast(result.error||`${checked} pages checked; ${withValues} showed numeric usage.`);
});
$('autoSync').addEventListener('change',async event=>{
  const response=await send({type:'set-auto-sync',enabled:event.target.checked});
  if(response.error)toast(response.error);else toast(event.target.checked?'Hourly sync enabled.':'Hourly sync paused.');
  await loadData();
});
$('services').addEventListener('click',event=>{
  const button=event.target.closest('[data-open-source]');if(!button)return;
  send({type:'open-source',source:button.dataset.openSource}).then(()=>toast('Opened the service in a new tab. Sign in there, then sync again.'));
});
$('routeForm').addEventListener('submit',async event=>{
  event.preventDefault();const formEl=event.currentTarget;const fd=new FormData(formEl);
  const route={id:crypto.randomUUID(),purpose:String(fd.get('purpose')).trim(),primaryModel:String(fd.get('primaryModel')).trim(),primaryProvider:String(fd.get('primaryProvider')),backupModel:String(fd.get('backupModel')||'').trim(),backupProvider:String(fd.get('backupProvider'))};
  const routes=[...(dataCache.modelRoutes||[]),route];
  const response=await send({type:'save-model-routes',routes});
  if(response.error){toast(response.error);return;}
  formEl.reset();await loadData();toast('Model route saved.');
});
$('routes').addEventListener('click',async event=>{
  const button=event.target.closest('[data-delete-route]');if(!button)return;
  const routes=(dataCache.modelRoutes||[]).filter(r=>r.id!==button.dataset.deleteRoute);
  await send({type:'save-model-routes',routes});await loadData();toast('Route removed.');
});
$('exportButton').addEventListener('click',()=>downloadJSON(`ai-usage-snapshots-${currentMonth()}.json`,{exportedAt:new Date().toISOString(),snapshots:dataCache.snapshots||[],sourceStatus:dataCache.sourceStatus||{},modelRoutes:dataCache.modelRoutes||[]}));
$('exportMonth').addEventListener('click',()=>downloadJSON(`ai-usage-${$('monthFilter').value}.json`,{month:$('monthFilter').value,snapshots:monthSnapshots()}));
browser.storage.onChanged.addListener(()=>loadData());
loadData();
setInterval(loadData,5000);
