// 廠商預約申請（2026-10-19）：廠商從 vendor.html（每家廠商一條專屬連結）送來的預約申請，
// 在「廠商時段協調 → 📥 廠商申請」處理：轉成指派任務（預填廠商／案號／項目／候選日期）或退回。
// 用「經典 script」載入，跟 slots.js 共用全域函式（openSlotTaskModal、showToast、confirmDanger…）。
let VENDOR_REQS = [];

async function loadVendorRequests(){
  const box = document.getElementById('vendorReqContainer');
  if(box && !VENDOR_REQS.length) box.innerHTML = '<div class="login-note">載入中…</div>';
  try{
    const res = await fetch(API_BASE + '/api/vendor-requests?status=all', {cache: 'no-store'});
    const d = await res.json();
    if(!res.ok) throw new Error(d.error || ('HTTP ' + res.status));
    VENDOR_REQS = d.requests || [];
    renderVendorRequests();
  }catch(e){
    if(box) box.innerHTML = '<div class="login-note">載入失敗：' + escHtml(e.message) + '</div>';
  }
}

function updateVendorReqBadge(){
  const n = VENDOR_REQS.filter(r => r.status === '待處理').length;
  const el = document.getElementById('navVendorReqBadge');   // 側邊選單「廠商預約」的待處理數量
  if(el){ el.textContent = n || ''; el.style.display = n ? 'inline-block' : 'none'; }
}

function vrCard(r, pending){
  const when = (r.submitted_at || '').replace('T', ' ').slice(5, 16);
  const stColor = {'待處理': '#B45309', '已轉任務': '#15803D', '已退回': '#B42318', '已取消': '#6B7280'}[r.status] || '#6B7280';
  return `<div style="padding:12px 0;border-top:1px solid #F0E4CC;">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap;">
      <div><span class="vendor-pill" style="margin-right:6px;">${escHtml(r.vendor)}</span><b>${escHtml(r.case)}</b> <span style="color:var(--text-muted);font-size:12.5px;">${escHtml(r.alias || '')}</span>
        ${r.items.map(t => `<span class="chip chip-enter" style="margin-left:4px;">${escHtml(t)}</span>`).join('')}</div>
      <span style="font-size:12px;font-weight:800;color:${stColor};">${escHtml(r.status)}</span>
    </div>
    <div style="font-size:13px;margin-top:6px;line-height:1.7;">
      📅 希望：${[r.dates.map(d => escHtml(fmtDate(d)) + '（' + fmtWeekday(d) + '）').join('、'), r.weekdays_text ? '🔁 ' + escHtml(r.weekdays_text) : ''].filter(Boolean).join('　') || '—'}${r.time_pref ? '｜⏰ ' + escHtml(r.time_pref) : ''}
      ${r.contact ? '<br>👤 ' + escHtml(r.contact) : ''}${r.note ? '<br>📝 ' + escHtml(r.note) : ''}
      ${r.reply ? '<br>💬 回覆：' + escHtml(r.reply) : ''}
      <br><span style="color:var(--text-muted);font-size:12px;">申請時間 ${escHtml(when)}</span>
    </div>
    ${pending ? `<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
      <button class="btn btn-warm-primary" style="padding:6px 12px;font-size:12px;" onclick="handleVendorRequest('${r.id}')">📨 轉成指派任務</button>
      <button class="btn btn-ghost" style="padding:6px 12px;font-size:12px;color:#B42318;" onclick="rejectVendorRequest('${r.id}')">↩️ 退回</button></div>` : ''}
  </div>`;
}

function renderVendorRequests(){
  const box = document.getElementById('vendorReqContainer');
  updateVendorReqBadge();
  if(!box) return;
  const pending = VENDOR_REQS.filter(r => r.status === '待處理');
  const done = VENDOR_REQS.filter(r => r.status !== '待處理').slice(0, 40);
  box.innerHTML = `<div class="panel" style="margin-bottom:14px;">
      <div class="panel-title">📥 待處理的廠商申請 <span class="module-tag tag-cloud">${pending.length} 筆</span></div>
      ${pending.length ? pending.map(r => vrCard(r, true)).join('') : '<div class="login-note">目前沒有待處理的廠商申請。</div>'}
    </div>
    ${done.length ? `<div class="panel"><div class="panel-title">已處理（最近 ${done.length} 筆）</div>${done.map(r => vrCard(r, false)).join('')}</div>` : ''}`;
}

// 轉成指派任務：開「指派給業務」視窗並預填；建立成功後（confirmSlotTask）回頭把申請標成「已轉任務」
function handleVendorRequest(id){
  const r = VENDOR_REQS.find(x => x.id === id);
  if(!r){ showToast('找不到這筆申請，請重新整理'); return; }
  showSlotsTab('pending');
  openSlotTaskModal();
  window.PENDING_VENDOR_REQ = id;
  const setv = (el, v) => { const e = document.getElementById(el); if(e) e.value = v == null ? '' : v; };
  if(![...document.getElementById('slotTaskVendor').options].some(o => o.value === r.vendor)){
    document.getElementById('slotTaskVendor').insertAdjacentHTML('beforeend', `<option value="${escHtml(r.vendor)}">${escHtml(r.vendor)}</option>`);
  }
  setv('slotTaskVendor', r.vendor); setv('slotTaskCase', r.case); setv('slotTaskAlias', r.alias);
  document.querySelectorAll('.slot-task-type-check').forEach(c => { c.checked = r.items.includes(c.value); });
  updateSlotTypeLabel('slot-task-type-check', 'slotTaskTypeLabel');
  const rows = document.getElementById('slotTaskDateRows');
  rows.innerHTML = '';
  // 廠商只填了星期偏好（沒指定日期）：依「可以／不行的星期」＋期間，預填接下來符合的日期（最多 8 天），窗口再自己調整
  let candDates = r.dates.slice();
  let wdHint = '';
  if(!candDates.length && r.weekdays){
    const ok = new Set(r.weekdays.ok || []), no = new Set(r.weekdays.no || []);
    const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const d = new Date(); d.setHours(12, 0, 0, 0);
    for(let i = 1; i <= (r.weekdays.within || 14) && candDates.length < 8; i++){
      const x = new Date(d.getTime() + i * 86400000);
      const w = (x.getDay() + 6) % 7;      // 0＝週一 … 6＝週日
      if(no.has(w)) continue;
      if(ok.size ? !ok.has(w) : w >= 5) continue;     // 沒指定可以的星期：預設只排週一到週五
      candDates.push(iso(x));
    }
    wdHint = '廠商的星期偏好：' + (r.weekdays_text || '') + '，已預填接下來符合的日期，請自行調整';
  }
  (candDates.length ? candDates : ['']).forEach((d, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:center;';
    row.innerHTML = `<input type="date" class="quick-mark-input slot-task-date-input" style="flex:1;" value="${d}">` + (i ? '<button class="btn btn-ghost" style="padding:6px 10px;font-size:12px;" onclick="this.parentElement.remove()">✕</button>' : '');
    rows.appendChild(row);
  });
  applySlotTaskTimeDefault();
  const hint = [r.time_pref ? '希望時段：' + r.time_pref : '', r.contact ? '聯絡人：' + r.contact : '', r.note ? '備註：' + r.note : ''].filter(Boolean).join('｜');
  showToast('已帶入廠商申請的案號／項目／希望日期' + (hint ? '（' + hint + '）' : '') + (wdHint ? '。' + wdHint : ''));
  if(typeof applyMeterDefaultScheduler === 'function') applyMeterDefaultScheduler();
}

async function markVendorRequestTask(id, taskId){
  try{
    await fetch(API_BASE + '/api/vendor-requests/' + encodeURIComponent(id) + '/status', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({status: '已轉任務', task_id: taskId || ''})});
  }catch(e){ console.error(e); }
  loadVendorRequests();
}

function rejectVendorRequest(id){
  const r = VENDOR_REQS.find(x => x.id === id);
  if(!r) return;
  const reason = prompt(`退回 ${r.vendor} ${r.case} 的申請。\n請輸入要給廠商看到的原因（例如：這幾天已滿，請改約 11/5 之後）：`, '');
  if(reason === null) return;
  fetch(API_BASE + '/api/vendor-requests/' + encodeURIComponent(id) + '/status', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({status: '已退回', note: reason.trim()})})
    .then(res => res.json().then(d => { if(!res.ok) throw new Error(d.error || res.status); showToast('已退回，廠商在「我的申請」會看到原因'); loadVendorRequests(); }))
    .catch(e => showToast('退回失敗：' + e.message));
}

// 每家廠商的專屬預約連結
async function openVendorPortalLinks(){
  const old = document.getElementById('vpLinksOverlay'); if(old) old.remove();
  const ov = document.createElement('div');
  ov.id = 'vpLinksOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
  ov.onclick = e => { if(e.target === ov) ov.remove(); };
  ov.innerHTML = '<div style="background:#fff;border-radius:16px;padding:22px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;color:#1B2333;">載入中…</div>';
  document.body.appendChild(ov);
  try{
    const res = await fetch(API_BASE + '/api/vendor-portal-links', {cache: 'no-store'});
    const d = await res.json();
    if(!res.ok) throw new Error(d.error || res.status);
    window._vpLinks = d.links;
    ov.firstElementChild.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-size:17px;font-weight:800;">🔗 廠商預約連結</div>
        <button type="button" onclick="document.getElementById('vpLinksOverlay').remove()" style="border:none;background:#F1F3F8;border-radius:50%;width:30px;height:30px;cursor:pointer;">✕</button></div>
      <div style="font-size:12.5px;color:#6B7280;margin:6px 0 10px;line-height:1.7;">每家廠商一條專屬連結，傳給該廠商的窗口就好：他們只看得到、也只能預約<b>自己廠商</b>的案件。連結等於密碼，請勿轉傳給其他廠商。</div>
      ${d.links.map((l, i) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-top:1px solid #EEE;">
        <b>${escHtml(l.vendor)}</b>
        <div style="display:flex;gap:6px;"><button class="btn btn-ghost" style="padding:5px 10px;font-size:12px;" onclick="copyVnText(window._vpLinks[${i}].url, '已複製${escHtml(l.vendor)}的預約連結')">複製連結</button>
        <a class="btn btn-ghost" style="padding:5px 10px;font-size:12px;text-decoration:none;" target="_blank" rel="noopener" href="${escHtml(l.url)}">開啟</a></div></div>`).join('')}`;
  }catch(e){
    ov.firstElementChild.innerHTML = '<div>載入失敗：' + escHtml(e.message) + '</div>';
  }
}

// 載入「廠商時段協調」資料時順便更新待處理數量的徽章；從 LINE 卡片點進來（#slots-requests）直接開這個分頁
(function(){
  const _orig = window.loadVendorSlots;
  if(typeof _orig === 'function'){
    window.loadVendorSlots = async function(){ const r = await _orig.apply(this, arguments); loadVendorRequests(); return r; };
  }
  const _origClose = window.closeSlotTaskModal;
  if(typeof _origClose === 'function'){
    window.closeSlotTaskModal = function(){ window.PENDING_VENDOR_REQ = null; return _origClose.apply(this, arguments); };
  }
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      loadVendorRequests();
      if((location.hash || '') === '#slots-requests'){
        try{ showView('slots'); showSlotsTab('requests'); }catch(e){}
        history.replaceState(null, '', location.pathname + location.search);
      }
    }, 900);
    setInterval(loadVendorRequests, 120000);
  });
})();
