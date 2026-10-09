// 廠商時段協調／指派任務／取消預約／通知廠商／屋主版 等前端程式（從 index.html 拆出來，2026-10-09）。
// 用「經典 script」載入，跟 index.html 的主程式共用全域變數與函式，執行順序跟原本完全一樣（在原本這段的位置載入）。
// 改這支檔案時，要同步把 index.html 裡 <script src="slots.js?v=N"> 的版本號 +1，瀏覽器才不會用舊快取。

// ===================================================================
// 廠商時段協調（2026-10-01 新增，同日拿掉「開放時段」概念，改成直接預約）：
// 業務預約時段（PM 直接預約，或透過「指派給業務」任務讓業務自己選時間），
// 同一廠商同一天時間重疊由後端擋（見 /api/vendor-slots/bookings 409），
// 前端這裡主要負責畫面分組顯示、modal 表單、跟衝突錯誤訊息的呈現。資料量小，
// 不走背景快取，每次切到這個頁面或按重新整理就直接抓最新的。
// ===================================================================
let SLOT_BOOKINGS = [];
let SLOT_CANCELLED = [];   // 2026-10-08：已取消的預約（只在歷史紀錄顯示，不算佔用時段）
let SLOT_TASKS = [];

async function loadVendorSlots(){
  const container = document.getElementById('slotsContainer');
  const btn = document.getElementById('slotsRefreshBtn');
  if(container && SLOT_BOOKINGS.length === 0){
    container.innerHTML = '<div class="login-note">載入中…</div>';
  }
  if(btn) btn.disabled = true;
  try{
    const [slotsRes, tasksRes] = await Promise.all([
      fetch(API_BASE + '/api/vendor-slots', {cache: 'no-store'}),
      fetch(API_BASE + '/api/vendor-slots/tasks', {cache: 'no-store'}),
    ]);
    if(!slotsRes.ok) throw new Error('HTTP ' + slotsRes.status);
    const data = await slotsRes.json();
    SLOT_BOOKINGS = data.bookings || [];
    SLOT_CANCELLED = data.cancelled || [];
    renderVendorSlots();
    refreshAllVendorFilteredViews();
    if(tasksRes.ok){
      const taskData = await tasksRes.json();
      SLOT_TASKS = taskData.tasks || [];
      renderSlotTasks();
    }
  }catch(err){
    if(container) container.innerHTML = '<div class="login-note">載入失敗：' + err.message + '</div>';
    console.error(err);
  }finally{
    if(btn) btn.disabled = false;
  }
}

// 2026-10-01 從單一清單拆成兩個分頁：「指派任務」只顯示還沒確認時間的任務，
// 「完成安排」把已完成的任務跟下面實際卡下來的時段卡片放在一起看，避免
// 使用者還要在同一個落落長清單裡自己分辨哪些結束了。
function showSlotsTab(tab){
  document.querySelectorAll('#view-slots .subview').forEach(v=>v.classList.remove('active'));
  document.getElementById('slots-tab-'+tab).classList.add('active');
  document.querySelectorAll('#view-slots .tab').forEach(t=>t.classList.remove('active'));
  document.querySelector('#view-slots .tab[data-slots-tab="'+tab+'"]').classList.add('active');
}

// 2026-10-01 調整：「完成安排」分頁原本同時顯示「已完成的任務紀錄」跟
// 下面實際卡下來的時段卡片，使用者反饋這是同一件事重複顯示兩次（候選
// 日期/指派業務 vs. 實際日期時間/登記人），看起來很像 bug。拿掉已完成
// 任務的那份清單，完成安排分頁只留時段卡片（結果），任務清單只保留
// 還沒確認的（過程）。
function slotAltConflicts(t, s){
  if(!s.start_time) return false;   // 屋主只給日期的備選，時間還沒定，不檢查
  return SLOT_BOOKINGS.some(b => b.vendor === t.vendor && b.date === s.date && b.start_time < s.end_time && s.start_time < b.end_time);
}
function slotLabelText(s){
  const wd = ['日','一','二','三','四','五','六'][new Date(s.date + 'T00:00:00').getDay()];
  if(!s.start_time) return fmtDate(s.date) + '（' + wd + '）屋主這天可以，時間由你決定';
  return fmtDate(s.date) + '（' + wd + '）' + s.start_time + '-' + s.end_time;
}
// 2026-10-04：業務「原時間屋主不行，提供其他時間」的協調流程，主控台這邊的畫面：
// 待窗口確認＝業務已回傳備選時段，窗口跟廠商確認後在這裡選一個；待業務確認＝
// 已選定、等業務打開連結按確認。標籤/側邊欄會顯示待處理數量。
function updateSlotTaskBadges(){
  const n = SLOT_TASKS.filter(t => t.status !== '已完成' && t.stage === '待窗口確認').length;
  const tab = document.querySelector('#view-slots .tab[data-slots-tab="pending"]');
  if(tab) tab.textContent = '📋 指派任務' + (n ? '　🔴 ' + n + ' 待處理' : '');
  const nav = document.querySelector('.nav-item[data-view="slots"]');
  if(nav){
    let b = nav.querySelector('.slots-nav-badge');
    if(n && !b){ b = document.createElement('span'); b.className = 'slots-nav-badge'; b.style.cssText = 'margin-left:6px;background:#E5484D;color:#fff;border-radius:10px;font-size:11px;font-weight:700;padding:1px 7px;'; nav.appendChild(b); }
    if(b){ if(n) b.textContent = n; else b.remove(); }
  }
}
// 2026-10-07：指派任務可以依「廠商」「業務」「安排人員」篩選（三個都可複選，可一起用＝要同時符合）。
// 業務＝任務的「指派給」；安排人員＝建立任務的同仁（creator）。
let SLOT_TASK_FILTER = {vendors: [], reps: [], schedulers: []};
function slotTaskFilterMatch(t){
  const f = SLOT_TASK_FILTER;
  if(f.vendors.length && !f.vendors.includes(t.vendor)) return false;
  if(f.reps.length && !f.reps.includes(t.assignee)) return false;
  if(f.schedulers.length && !f.schedulers.includes(t.creator)) return false;
  return true;
}
function onSlotTaskFilterChange(el){
  const arr = SLOT_TASK_FILTER[el.dataset.kind];
  const v = el.dataset.val;
  const i = arr.indexOf(v);
  if(el.checked && i < 0) arr.push(v);
  if(!el.checked && i >= 0) arr.splice(i, 1);
  renderSlotTasks();
}
function clearSlotTaskFilters(){
  SLOT_TASK_FILTER = {vendors: [], reps: [], schedulers: []};
  renderSlotTasks();
}
function renderSlotTaskFilterBar(pending, shownCount){
  const bar = document.getElementById('slotTaskFilterBar');
  if(!bar) return;
  const openIds = [...bar.querySelectorAll('.slot-type-dropdown.show')].map(p => p.id);
  const vendors = [...new Set([...pending.map(t => t.vendor), ...SLOT_TASK_FILTER.vendors].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  const zh = (a, b) => a.localeCompare(b, 'zh-Hant');
  const reps = [...new Set([...pending.map(t => t.assignee), ...SLOT_TASK_FILTER.reps].filter(Boolean))].sort(zh);
  const schedulers = [...new Set([...pending.map(t => t.creator), ...SLOT_TASK_FILTER.schedulers].filter(Boolean))].sort(zh);
  const dd = (id, emptyLabel, kind, options, selected) => `
    <div class="quick-mark-input-wrap" style="min-width:170px;max-width:260px;">
      <div class="quick-mark-input slot-type-trigger" id="${id}Trigger" onclick="toggleSlotTypeDropdown('${id}Panel')">
        <span style="color:${selected.length ? 'var(--text)' : 'var(--text-muted)'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${selected.length ? escHtml(selected.join('、')) : emptyLabel}</span>
        <span style="color:var(--text-muted);font-size:11px;">▾</span>
      </div>
      <div class="quick-mark-results slot-type-dropdown" id="${id}Panel" data-trigger-id="${id}Trigger">
        ${options.length ? options.map(o => `<label class="slot-type-option"><input type="checkbox" data-kind="${kind}" data-val="${escHtml(o)}" ${selected.includes(o) ? 'checked' : ''} onchange="onSlotTaskFilterChange(this)">${escHtml(o)}</label>`).join('') : '<div style="padding:10px 14px;font-size:12px;color:var(--text-muted);">沒有可選項目</div>'}
      </div>
    </div>`;
  const active = SLOT_TASK_FILTER.vendors.length || SLOT_TASK_FILTER.reps.length || SLOT_TASK_FILTER.schedulers.length;
  bar.innerHTML = dd('slotTaskFilterVendor', '全部廠商（可複選）', 'vendors', vendors, SLOT_TASK_FILTER.vendors)
    + dd('slotTaskFilterRep', '全部業務（可複選）', 'reps', reps, SLOT_TASK_FILTER.reps)
    + dd('slotTaskFilterScheduler', '全部安排人員（可複選）', 'schedulers', schedulers, SLOT_TASK_FILTER.schedulers)
    + (active ? `<button type="button" class="btn btn-ghost" style="padding:5px 12px;font-size:12px;" onclick="clearSlotTaskFilters()">清除篩選</button>
      <span style="font-size:12px;color:var(--text-muted);">顯示 ${shownCount} / ${pending.length} 筆</span>` : '');
  openIds.forEach(id => { const p = document.getElementById(id); if(p) p.classList.add('show'); });
}
// 2026-10-08：已綁定 LINE 的名字（業務＋安排人員）。指派任務要讓屋主填表時，業務一定要先綁，
// 屋主在期限前沒填表，業務跟安排人員才收得到提醒。
let BOUND_NAMES = new Set();
let BOUND_NAMES_AT = 0;
async function loadBoundNames(force){
  if(!force && Date.now() - BOUND_NAMES_AT < 60000) return;
  if(!Object.keys(REP_MAP).length) loadRepList();
  BOUND_NAMES_AT = Date.now();
  try{
    const d = await (await fetch(API_BASE + '/api/line/bound-names', {cache: 'no-store'})).json();
    BOUND_NAMES = new Set(d.names || []);
    renderSlotTasks();
    updateAssigneeBindLine();
  }catch(e){ console.error('載入綁定名單失敗', e); }
}
// 「林嘉偉(Mika)」也算對得上只綁「Mika」或「林嘉偉」的人（跟後端 _binding_name_candidates 同規則）
// 2026-10-09：業務名單（Airtable「業務名單」表，後端 /api/reps）。同一個人的不同寫法
// （JACK／Jack Wu、Mika／林嘉偉(Mika)）統一成名單上的姓名，LINE 綁定、篩選才對得上。
let REP_MAP = {};   // {小寫別名: 統一姓名}
async function loadRepList(){
  try{
    const d = await (await fetch(API_BASE + '/api/reps', {cache: 'no-store'})).json();
    REP_MAP = {};
    (d.reps || []).forEach(r => [r.name, ...(r.aliases || [])].forEach(k => { REP_MAP[k.toLowerCase()] = r.name; }));
    const dl = document.getElementById('repNameList');
    if(dl) dl.innerHTML = (d.reps || []).map(r => `<option value="${escHtml(r.name)}"></option>`).join('');
  }catch(e){ console.error('載入業務名單失敗', e); }
}
function canonRep(name){
  name = (name || '').trim();
  if(!name) return name;
  const m = name.match(/^(.*?)[(（]\s*(.+?)\s*[)）]\s*$/);
  const cands = [name].concat(m ? [m[2].trim(), m[1].trim()] : []);
  for(const c of cands){ const k = REP_MAP[(c || '').toLowerCase()]; if(k) return k; }
  return name;
}
function isBoundName(name){
  name = canonRep(name);
  if(!name) return false;
  const cands = [name];
  const m = name.match(/^(.*?)[(（]\s*(.+?)\s*[)）]\s*$/);
  if(m){ cands.push(m[2].trim(), m[1].trim()); }
  return cands.some(c => c && BOUND_NAMES.has(c));
}
function updateAssigneeBindLine(){
  const el = document.getElementById('slotTaskAssigneeBind');
  const inp = document.getElementById('slotTaskAssignee');
  if(!el || !inp) return;
  const name = inp.value.trim();
  if(!name){ el.innerHTML = ''; return; }
  el.innerHTML = isBoundName(name)
    ? '<span style="color:#16A34A;font-weight:700;">✓ ' + escHtml(name) + ' 已綁定 LINE 通知</span>'
    : '<span style="color:#D97706;font-weight:700;">⚠️ ' + escHtml(name) + ' 還沒綁定 LINE，期限前屋主沒填表時他收不到提醒</span>'
      + ` <button type="button" class="btn btn-ghost" style="padding:2px 8px;font-size:11px;" onclick="copyRepBindLink(document.getElementById('slotTaskAssignee').value.trim())">複製綁定連結給業務</button>`;
}
async function copyRepBindLink(name){
  if(!name){ showToast('請先填業務名字'); return; }
  try{
    const d = await (await fetch(API_BASE + '/api/line/rep-bind-url?name=' + encodeURIComponent(name), {cache: 'no-store'})).json();
    if(!d.url){ showToast('LINE 功能尚未設定'); return; }
    const text = `${name} 您好，請用手機 LINE 打開下面的連結綁定陽光機器人通知（只要一次）：\n${d.url}\n綁定後，屋主還沒填預約表、期限快到時，你會收到 LINE 提醒。`;
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    showToast('已複製「' + name + '」的綁定連結，請傳給他');
  }catch(e){ showToast('複製失敗：' + e.message); }
}

function renderSlotTasks(){
  updateSlotTaskBadges();
  loadBoundNames();
  const pendingContainer = document.getElementById('slotTasksPendingContainer');
  if(!pendingContainer) return;
  const allPending = SLOT_TASKS.filter(t => t.status !== '已完成');
  const pending = allPending.filter(slotTaskFilterMatch);
  renderSlotTaskFilterBar(allPending, pending.length);
  const typeChipClass = {'掛表':'chip-meter','植筋':'chip-rebar','放樣':'chip-enter','場勘':'chip-ship','進場':'chip-enter'};
  const typeChipsHtml = (types) => (types||[]).map(ty => `<span class="chip ${typeChipClass[ty]||''}" style="flex-shrink:0;">${ty}</span>`).join('');
  const stageBlockHtml = (t) => {
    if(!t.stage || !(t.alt_slots||[]).length) return '';
    const chosen = t.chosen_slot;
    const isSame = (a, b) => b && a.date === b.date && (!a.start_time || (a.start_time === b.start_time && a.end_time === b.end_time));
    const head = t.stage === '待窗口確認'
      ? `<div style="font-size:12.5px;font-weight:700;color:#B45309;margin-bottom:6px;">🟡 業務回報：原時間屋主無法配合，以下是屋主可以的其他時間——跟廠商確認後選一個</div>`
      : `<div style="font-size:12.5px;font-weight:700;color:#1E46C4;margin-bottom:6px;">⏳ 已選定 ${slotLabelText(chosen)}，等業務打開連結確認（也可以改選別的）</div>`;
    const opts = t.alt_slots.map((s, i) => {
      const busy = slotAltConflicts(t, s);
      const picked = isSame(s, chosen);
      return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;flex-wrap:wrap;">
        <span style="font-size:13px;font-weight:600;min-width:170px;${busy ? 'color:var(--text-muted);text-decoration:line-through;' : ''}">${slotLabelText(s)}</span>
        ${busy ? '<span style="font-size:11px;color:var(--text-muted);">廠商這段已被其他案件預約</span>'
               : picked ? '<span style="font-size:11px;color:#16A34A;font-weight:700;">✓ 目前選定</span>'
               : `<button class="btn btn-warm-primary" style="padding:4px 12px;font-size:11.5px;" onclick="chooseSlotAlt('${t.record_id}', ${i})">選這個</button>`}
      </div>`;
    }).join('');
    const note = t.rep_note ? `<div style="font-size:11.5px;color:var(--text-muted);margin-top:4px;">業務備註：${t.rep_note}</div>` : '';
    const actions = `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
      ${t.stage === '待業務確認' ? `<button class="btn btn-ghost" style="padding:4px 10px;font-size:11px;" onclick="copySlotTaskMessage('${t.record_id}')">📎 重新產生「請業務確認」訊息</button>` : ''}
      <button class="btn btn-ghost" style="padding:4px 10px;font-size:11px;" onclick="resetSlotAlts('${t.record_id}')">↩️ 都不行，退回請業務重新提供</button>
    </div>`;
    return `<div style="background:#FFF8E8;border:1px solid #F3DDA8;border-radius:12px;padding:10px 14px;margin:2px 0 10px;">${head}${opts}${note}${actions}</div>`;
  };
  const rowHtml = (t) => `
    <div style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;">
      <span class="vendor-pill ${VENDOR_CLASS[t.vendor]||'vendor-other'}" style="flex-shrink:0;">${t.vendor}</span>
      ${typeChipsHtml(t.type)}
      <span style="font-size:12.5px;flex:1;min-width:140px;">${t.case||''}${t.alias?('　'+t.alias):''}</span>
      <span style="font-size:11px;color:var(--text-muted);flex-shrink:0;">候選：${t.candidate_dates.map(d=>fmtDate(d)).join('、')}</span>
      ${t.assignee ? `<span style="font-size:11px;color:var(--text-muted);flex-shrink:0;">指派：${t.assignee}${isBoundName(t.assignee) ? ' <span style="color:#16A34A;font-weight:700;">✓LINE</span>' : ` <span style="color:#D97706;font-weight:700;cursor:pointer;" title="按一下複製綁定連結給業務" onclick="copyRepBindLink('${t.assignee.replace(/'/g, '')}')">⚠️未綁LINE</span>`}</span>` : ''}
      ${t.deadline ? (() => { const over = new Date(t.deadline) < new Date(); return `<span style="font-size:11px;font-weight:700;flex-shrink:0;color:${over ? '#D64545' : '#B45309'};">⏰ ${fmtDeadline(t.deadline)}${over ? '（已逾期）' : ''}</span>`; })() : ''}
      <button class="btn btn-ghost" style="padding:4px 10px;font-size:11px;flex-shrink:0;" onclick="adjustSlotDeadline('${t.record_id}')">⏰ 期限</button>
      <button class="btn btn-ghost" style="padding:4px 10px;font-size:11px;flex-shrink:0;" onclick="copySlotTaskMessage('${t.record_id}')">📎 複製訊息</button>
      <button class="btn btn-ghost" style="padding:4px 10px;font-size:11px;flex-shrink:0;" onclick="openOwnerMessageFor('${t.record_id}')">🏠 屋主版</button>
      <button class="btn btn-ghost" style="padding:4px 8px;font-size:11px;flex-shrink:0;" onclick="deleteSlotTask('${t.record_id}')">刪除</button>
    </div>${stageBlockHtml(t)}`;
  // 需要窗口處理的（業務已回傳備選時段）排最前面
  const order = {'待窗口確認': 0, '待業務確認': 1};
  const sorted = [...pending].sort((a, b) => (order[a.stage] ?? 2) - (order[b.stage] ?? 2));
  pendingContainer.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <div class="panel-title">📋 指派給業務、還在等確認的任務</div>
      ${sorted.length === 0 ? `<div style="font-size:12px;color:var(--text-muted);padding:6px 0;">${allPending.length ? '沒有符合篩選條件的任務' : '目前沒有待業務安排的任務'}</div>` : sorted.map(t=>rowHtml(t)).join('')}
    </div>`;
}
// 調整回覆期限：用 prompt 輸入「2026-10-05 18:00」，留空＝取消期限
async function adjustSlotDeadline(recordId){
  const t = SLOT_TASKS.find(x => x.record_id === recordId);
  if(!t) return;
  let cur = '';
  if(t.deadline){
    const d = new Date(t.deadline);
    cur = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  }
  const input = prompt('業務回覆期限（格式：2026-10-05 18:00，留空＝取消期限）', cur);
  if(input === null) return;
  let iso = null;
  if(input.trim()){
    const m = input.trim().match(/^(\d{4}-\d{1,2}-\d{1,2})\s+(\d{1,2}:\d{2})$/);
    if(!m){ showToast('格式不對，請輸入像 2026-10-05 18:00'); return; }
    const [y, mo, da] = m[1].split('-');
    iso = y + '-' + mo.padStart(2,'0') + '-' + da.padStart(2,'0') + 'T' + m[2].padStart(5,'0') + ':00+08:00';
  }
  try{
    const res = await fetch(API_BASE + '/api/vendor-slots/tasks/' + encodeURIComponent(recordId) + '/deadline', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({deadline: iso}),
    });
    const data = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    t.deadline = iso ? new Date(iso).toISOString() : '';
    renderSlotTasks();
    showToast(iso ? '已更新回覆期限，要通知業務的話請用「複製訊息」重新傳' : '已取消回覆期限');
  }catch(err){
    showToast('調整失敗：' + err.message);
  }
}
async function chooseSlotAlt(recordId, idx){
  // 2026-10-08：屋主只給日期的備選，選的時候要填開始時間（結束時間依作業時長自動算）
  const tk = SLOT_TASKS.find(x => x.record_id === recordId);
  const alt = tk && (tk.alt_slots || [])[idx];
  const body = {index: idx};
  if(alt && !alt.start_time){
    const input = prompt(fmtDate(alt.date) + ' 要從幾點開始？（例如 09:00，結束時間會依作業時長自動算）', (tk && tk.est_start) || '09:00');
    if(input === null) return;
    const m = input.trim().match(/^(\d{1,2}):(\d{2})$/);
    if(!m){ showToast('時間格式不對，請輸入像 09:00'); return; }
    body.start_time = m[1].padStart(2, '0') + ':' + m[2];
  }
  try{
    const res = await fetch(API_BASE + '/api/vendor-slots/tasks/' + encodeURIComponent(recordId) + '/choose', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if(res.status === 409 && data.conflict){
      showToast('這個時段已經被別的案件預約了（' + (data.conflict.case || '') + '），請選其他時間');
      loadVendorSlots();
      return;
    }
    if(!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    const t = SLOT_TASKS.find(x => x.record_id === recordId);
    if(t){ t.stage = '待業務確認'; t.chosen_slot = data.chosen_slot; }
    renderSlotTasks();
    if(t) showSlotChosenMessage(t);
  }catch(err){
    showToast('選定失敗：' + err.message);
  }
}
async function resetSlotAlts(recordId){
  if(!confirm('確定要退回嗎？備選時間會清掉，業務需要重新提供其他時間（連結不變）。')) return;
  try{
    const res = await fetch(API_BASE + '/api/vendor-slots/tasks/' + encodeURIComponent(recordId) + '/reset', {method: 'POST'});
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const t = SLOT_TASKS.find(x => x.record_id === recordId);
    if(t){ t.stage = ''; t.alt_slots = []; t.chosen_slot = null; }
    renderSlotTasks();
    showToast('已退回，業務打開連結會看到原本的候選日期');
  }catch(err){
    showToast('退回失敗：' + err.message);
  }
}
// 窗口選定時間後，產生「請業務確認」的訊息（跟指派訊息共用同一個複製/LINE/預覽視窗）
function showSlotChosenMessage(t){
  const link = window.location.origin + '/book.html?token=' + t.token;
  const typeLabel = (t.type||[]).join('+');
  const text = `【${t.vendor} ${typeLabel}｜時間已跟廠商確認】\n案號：${t.case}${t.alias?('（'+t.alias+'）'):''}\n確認時間：${slotLabelText(t.chosen_slot)}\n請跟屋主確認這個時間沒問題後，點以下連結按「確認」完成安排：\n${link}`;
  document.getElementById('slotSummaryTitle').textContent = '📨 請業務確認的訊息';
  document.getElementById('slotSummaryTextarea').value = text;
  const previewBtn = document.getElementById('slotSummaryPreviewBtn');
  previewBtn.dataset.link = link;
  previewBtn.style.display = 'block';
  document.getElementById('slotSummaryModalOverlay').classList.add('show');
}
async function loadSlotTasksQuiet(){
  try{
    const res = await fetch(API_BASE + '/api/vendor-slots/tasks', {cache: 'no-store'});
    if(!res.ok) return;
    const next = (await res.json()).tasks || [];
    if(JSON.stringify(next) === JSON.stringify(SLOT_TASKS)) return;
    SLOT_TASKS = next;
    renderSlotTasks();
  }catch(err){ console.error('載入時段任務失敗（不影響其他頁面）', err); }
}

function openSlotTaskModal(){
  document.getElementById('slotTaskVendor').innerHTML = ALL_VENDOR_NAMES.map(v => `<option value="${v}">${v}</option>`).join('');
  document.getElementById('slotTaskCase').value = '';
  document.getElementById('slotTaskAlias').value = '';
  document.getElementById('slotTaskAssignee').value = '';
  document.getElementById('slotTaskOwnerName').value = '';
  document.getElementById('slotTaskOwnerPhone').value = '';
  document.getElementById('slotTaskOwnerInfo').style.display = 'none';
  document.getElementById('slotTaskDeadlineTime').innerHTML = deadlineTimeOptionsHtml();
  slotDeadlineTouched = false;
  updateAssigneeBindLine();
  loadBoundNames(true);
  loadRepList();
  populateSlotCreatorSelect();
  loadSlotSchedulers();
  ['slotTaskOwnerWinStart', 'slotTaskOwnerWinEnd'].forEach(id => { document.getElementById(id).innerHTML = slotTimeOptionsHtml(); });
  document.getElementById('slotTaskOwnerWinStart').value = '09:00';
  document.getElementById('slotTaskOwnerWinEnd').value = '17:00';
  document.getElementById('slotTaskCaseResults').classList.remove('show');
  document.getElementById('slotTaskTypeDropdown').classList.remove('show');
  document.querySelectorAll('.slot-task-type-check').forEach(c => { c.checked = false; });
  setDefaultSlotDeadline();
  updateSlotTypeLabel('slot-task-type-check', 'slotTaskTypeLabel');
  document.getElementById('slotTaskDateRows').innerHTML = '<div style="display:flex;gap:8px;align-items:center;"><input type="date" class="quick-mark-input slot-task-date-input" style="flex:1;"></div>';
  document.getElementById('slotTaskEstStart').innerHTML = slotTimeOptionsHtml();
  document.getElementById('slotTaskEstEnd').innerHTML = slotTimeOptionsHtml();
  document.getElementById('slotTaskEstStart').value = '';
  document.getElementById('slotTaskEstEnd').value = '';
  document.getElementById('slotTaskEstDurationHour').value = '0';
  document.getElementById('slotTaskEstDurationMin').value = '0';
  document.getElementById('slotTaskEstDelegate').checked = false;
  document.getElementById('slotTaskEstRange').style.display = 'flex';
  document.getElementById('slotTaskEstDurationWrap').style.display = 'none';
  applySlotTaskTimeDefault();
  document.getElementById('slotTaskModalOverlay').classList.add('show');
}
// 2026-10-01 新增：勾選「交由業務安排」時，PM 不填具體的開始/結束時間，
// 改填一個「預計花費時間」（小時+分鐘兩個數字輸入，可以直接打數字或用
// 上下箭頭增減，預設帶入目前勾選項目類型的總時長），業務到 book.html
// 自助預約頁時就只用選開始時間，結束時間會依這個時長自動算出來（仍可
// 手動調整）。取消勾選就恢復成原本「填具體預估時間」的兩個時間下拉。
// 2026-10-01 同日：原本用一個 30 分鐘一格的下拉選單（30分~8小時共16個
// 選項），使用者反饋選項太多太雜，改成這種小時/分鐘分開輸入的方式。
// 2026-10-04：業務回覆期限。預設當天 18:00（下班），如果建任務時已經過 18:00 就預設
// 隔天 18:00（不然一建立就逾期）。期限用台北時間 +08:00 的 ISO 字串存。
function deadlineTimeOptionsHtml(){
  const list = [];
  for(let h = 7; h <= 23; h++){ list.push(String(h).padStart(2,'0') + ':00'); list.push(String(h).padStart(2,'0') + ':30'); }
  return list.map(t => `<option value="${t}">${t}</option>`).join('');
}
// 2026-10-05 改：預設回覆期限＝隔天 18:00；項目有「進場」的任務＝2 天後 18:00。
// 使用者手動改過日期/時間（slotDeadlineTouched）之後，勾選項目類型就不再覆蓋。
// 2026-10-05：安排人員（建立任務的同仁）。業務完成安排／回傳其他時間／期限快到時，
// 後端會用 LINE 通知這個人（名字對應「業務LINE綁定」表）。名單只含已綁定 LINE 的人。
let SLOT_SCHEDULERS = [];
function populateSlotCreatorSelect(){
  const sel = document.getElementById('slotTaskCreator');
  if(!sel) return;
  const cur = sel.value;
  let saved = '';
  try{ saved = localStorage.getItem('slotSchedulerName') || ''; }catch(e){}
  sel.innerHTML = '<option value="">（不通知）</option>' + SLOT_SCHEDULERS.map(n => `<option value="${n}">${n}</option>`).join('');
  const want = cur || saved;
  if(SLOT_SCHEDULERS.includes(want)) sel.value = want;
}
async function loadSlotSchedulers(){
  try{
    const res = await fetch(API_BASE + '/api/line/schedulers', {cache: 'no-store'});
    const data = await res.json();
    SLOT_SCHEDULERS = data.names || [];
    populateSlotCreatorSelect();
  }catch(err){ console.error('載入安排人員名單失敗（不影響建立任務）', err); }
}
async function copySchedulerBindLink(){
  try{
    const res = await fetch(API_BASE + '/api/line/liff-config', {cache: 'no-store'});
    const cfg = await res.json();
    if(!cfg.liff_id){ showToast('LINE 功能尚未設定'); return; }
    const link = 'https://liff.line.me/' + cfg.liff_id + '?bind=scheduler';
    const ta = document.createElement('textarea');
    ta.value = link; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast('已複製綁定連結，請傳給安排人員用手機 LINE 開啟');
  }catch(err){ showToast('複製失敗：' + err.message); }
}
let slotDeadlineTouched = false;
function setDefaultSlotDeadline(){
  const now = new Date();
  const days = getCheckedSlotTypes('slot-task-type-check').includes('進場') ? 2 : 1;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  document.getElementById('slotTaskDeadlineDate').value = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  document.getElementById('slotTaskDeadlineTime').value = '18:00';
}
function slotDeadlineIso(dateStr, timeStr){
  return dateStr ? (dateStr + 'T' + (timeStr || '18:00') + ':00+08:00') : null;
}
function fmtDeadline(iso){
  if(!iso) return '';
  const d = new Date(iso);
  if(isNaN(d)) return '';
  const wd = ['日','一','二','三','四','五','六'][d.getDay()];
  return String(d.getMonth()+1).padStart(2,'0') + '/' + String(d.getDate()).padStart(2,'0') + '（' + wd + '）' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}
function getSlotTaskTypeDurationSum(){
  const types = getCheckedSlotTypes('slot-task-type-check');
  return types.reduce((sum, t) => sum + (SLOT_TYPE_DURATION_MIN[t] || 0), 0) || 60;
}
function setSlotTaskEstDurationFromMinutes(totalMin){
  document.getElementById('slotTaskEstDurationHour').value = String(Math.floor(totalMin / 60));
  document.getElementById('slotTaskEstDurationMin').value = String(totalMin % 60);
}
function getSlotTaskEstDurationMinutes(){
  const h = parseInt(document.getElementById('slotTaskEstDurationHour').value, 10) || 0;
  const m = parseInt(document.getElementById('slotTaskEstDurationMin').value, 10) || 0;
  return h * 60 + m;
}
function onSlotTaskEstDelegateChange(){
  const delegate = document.getElementById('slotTaskEstDelegate').checked;
  document.getElementById('slotTaskEstRange').style.display = delegate ? 'none' : 'flex';
  document.getElementById('slotTaskEstDurationWrap').style.display = delegate ? 'flex' : 'none';
  if(delegate){
    setSlotTaskEstDurationFromMinutes(getSlotTaskTypeDurationSum());
  } else {
    applySlotTaskTimeDefault();
  }
}
function closeSlotTaskModal(){
  document.getElementById('slotTaskModalOverlay').classList.remove('show');
}
function addSlotTaskDateRow(){
  const wrap = document.getElementById('slotTaskDateRows');
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;align-items:center;';
  row.innerHTML = '<input type="date" class="quick-mark-input slot-task-date-input" style="flex:1;"><button class="btn btn-ghost" style="padding:6px 10px;font-size:12px;" onclick="this.parentElement.remove()">✕</button>';
  wrap.appendChild(row);
}
async function confirmSlotTask(){
  const vendor = document.getElementById('slotTaskVendor').value;
  const type = getCheckedSlotTypes('slot-task-type-check');
  const caseNo = document.getElementById('slotTaskCase').value.trim();
  const alias = document.getElementById('slotTaskAlias').value.trim();
  const assignee = document.getElementById('slotTaskAssignee').value.trim();
  const ownerName = document.getElementById('slotTaskOwnerName').value.trim();
  const ownerPhone = document.getElementById('slotTaskOwnerPhone').value.trim();
  const deadline = slotDeadlineIso(document.getElementById('slotTaskDeadlineDate').value, document.getElementById('slotTaskDeadlineTime').value);
  const candidateDates = [...document.querySelectorAll('.slot-task-date-input')].map(i=>i.value).filter(Boolean);
  const estDelegate = document.getElementById('slotTaskEstDelegate').checked;
  let estStart = '', estEnd = '', durationMin = null;
  if(estDelegate){
    durationMin = getSlotTaskEstDurationMinutes() || null;
  } else {
    estStart = document.getElementById('slotTaskEstStart').value;
    estEnd = document.getElementById('slotTaskEstEnd').value;
    if(estStart && estEnd) durationMin = slotMinutesBetween(estStart, estEnd);
  }
  if(!vendor || type.length === 0 || !caseNo || candidateDates.length === 0){
    showToast('請把廠商/項目類型/案號填好，候選日期至少填一天');
    return;
  }
  const btn = document.querySelector('#slotTaskModalOverlay .btn-primary');
  const originalText = btn.textContent;
  btn.textContent = '建立中…'; btn.disabled = true;
  try{
    const res = await fetch(API_BASE + '/api/vendor-slots/tasks', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({vendor, type, case: caseNo, alias, assignee, creator: (document.getElementById('slotTaskCreator') || {}).value || '', candidate_dates: candidateDates, duration_min: durationMin, est_start: estStart || '', owner_win_start: document.getElementById('slotTaskOwnerWinStart').value || '09:00', owner_win_end: document.getElementById('slotTaskOwnerWinEnd').value || '17:00', owner_name: ownerName, owner_phone: ownerPhone, deadline}),
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || ('HTTP '+res.status));
    closeSlotTaskModal();
    loadVendorSlots();
    window.LAST_SLOT_TASK_RECORD_ID = data.record_id || null;
    showSlotTaskMessage(vendor, caseNo, alias, type, candidateDates, data.path, estStart, estEnd, durationMin, estDelegate, deadline);
  }catch(err){
    showToast('建立失敗：' + err.message);
  }finally{
    btn.textContent = originalText; btn.disabled = false;
  }
}
// estStart/estEnd 只是建立當下用來算 durationMin 的輸入，不會直接存；
// durationMin（分鐘）才是真正寫回 Airtable 任務紀錄的值（見
// FIELD_TASK_DURATION_MIN），不管是「交由業務安排」直接填的時長，還是
// 從完整預估時間換算出來的，book.html 自助預約頁都會用這個值幫業務把
// 結束時間自動帶出來。estDelegate=true 時訊息顯示「預估時長」，否則（有
// 完整起訖時間）顯示「預估時間」區間；之後從任務清單「📎 複製訊息」重新
// 產生時一樣會帶（因為 durationMin 已經存在任務紀錄裡了，不像以前會不見）。
function showSlotTaskMessage(vendor, caseNo, alias, type, candidateDates, path, estStart, estEnd, durationMin, estDelegate, deadline){
  const link = window.location.origin + path;
  const typeLabel = (type||[]).join('+');
  let estLine = '';
  if(estDelegate && durationMin){
    estLine = `\n預估時長：${slotDurationLabel(durationMin)}（僅供參考，實際時間依現場工班作業時間為主）`;
  } else if(estStart && estEnd){
    estLine = `\n預估時間：${estStart}-${estEnd}（僅供參考，實際時間依現場工班作業時間為主）`;
  }
  const text = `【${vendor} ${typeLabel}安排通知】\n案號：${caseNo}${alias?('（'+alias+'）'):''}\n候選日期：${candidateDates.map(d=>fmtDate(d)+'（'+fmtWeekday(d)+'）').join('、')}${estLine}${deadline ? `\n⏰ 請於 ${fmtDeadline(deadline)} 前回覆給我` : ''}\n請點以下連結，跟屋主確認好時間後進去完成預約：\n${link}`;
  document.getElementById('slotSummaryTitle').textContent = '📨 傳給業務的訊息';
  const bn = document.getElementById('slotSummaryBindNote'); if(bn) bn.innerHTML = '';
  document.getElementById('slotSummaryTextarea').value = text;
  const previewBtn = document.getElementById('slotSummaryPreviewBtn');
  previewBtn.dataset.link = link;
  previewBtn.textContent = '👀 預覽業務填單畫面';
  previewBtn.style.display = 'block';
  document.getElementById('slotSummaryOwnerBtn').style.display = window.LAST_SLOT_TASK_RECORD_ID ? 'flex' : 'none';
  document.getElementById('slotSummaryModalOverlay').classList.add('show');
}
// 2026-10-02 新增：傳送給業務之前先自己看一眼業務會看到的畫面長什麼樣子。
// 只有「指派給業務」產生的訊息才有連結可以預覽，複製清單（copySlotSummary）
// 沒有對應的 book.html 連結，所以按鈕預設隱藏，只有 showSlotTaskMessage
// 才會打開。
// 2026-10-07：屋主版連結（測試版）。業務把這段訊息轉給屋主，屋主在 owner.html 自己選時間。
// 舊任務第一次按時，後端會補上屋主 token 與預設可選時段（09:00–17:00）。
async function showOwnerMessage(){
  const id = window.LAST_SLOT_TASK_RECORD_ID;
  if(!id){ showToast('找不到這個任務，請從任務清單按「🏠 屋主版」'); return; }
  try{
    const res = await fetch(API_BASE + '/api/vendor-slots/tasks/' + encodeURIComponent(id) + '/owner-link', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}',
    });
    const d = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(d.error || ('HTTP ' + res.status));
    const link = window.location.origin + d.owner_path;
    const text = `您好，我是陽光伏特家的業務${d.assignee || ''}。\n`
      + `我們要幫您安排「${(d.items || []).join('、')}」，想請您直接點下面的連結，選一個您方便的時間（大約需要 ${slotDurationLabel(d.duration_min)}）：\n${link}\n\n`
      + `可選日期：${(d.candidate_dates || []).map(x => fmtDate(x) + '（' + fmtWeekday(x) + '）').join('、')}\n`
      + `可選時段：${d.window_start}–${d.window_end} 之間\n`
      + `如果不方便操作，直接回覆我就可以了，謝謝您！`;
    document.getElementById('slotSummaryTitle').textContent = '🏠 傳給屋主的訊息（請業務轉傳，測試中）';
    const bindNote = document.getElementById('slotSummaryBindNote');
    if(bindNote){
      bindNote.innerHTML = !d.assignee ? '<div style="font-size:12.5px;color:#D97706;margin-bottom:10px;">⚠️ 這個任務沒有填「指派給」業務，期限前屋主沒填表時只有安排人員會收到提醒。</div>'
        : d.assignee_bound ? `<div style="font-size:12.5px;color:#16A34A;margin-bottom:10px;">✓ 業務 ${escHtml(d.assignee)} 已綁定 LINE。屋主在期限前 1 小時還沒填表，他和安排人員都會收到提醒。</div>`
        : `<div style="font-size:12.5px;color:#D97706;margin-bottom:10px;line-height:1.7;">⚠️ 業務 ${escHtml(d.assignee)} 還沒綁定 LINE，屋主沒填表時他收不到提醒。<br>
            <button type="button" class="btn btn-ghost" style="padding:3px 10px;font-size:12px;" onclick="copyRepBindLink(${JSON.stringify(d.assignee).replace(/"/g, '&quot;')})">複製綁定連結給 ${escHtml(d.assignee)}</button></div>`;
    }
    document.getElementById('slotSummaryTextarea').value = text;
    const previewBtn = document.getElementById('slotSummaryPreviewBtn');
    previewBtn.dataset.link = link;
    previewBtn.textContent = '👀 預覽屋主畫面（只看，不要送出）';
    previewBtn.style.display = 'block';
    document.getElementById('slotSummaryOwnerBtn').style.display = 'none';
    document.getElementById('slotSummaryModalOverlay').classList.add('show');
  }catch(err){
    showToast('產生屋主版訊息失敗：' + err.message);
  }
}
function openOwnerMessageFor(recordId){
  window.LAST_SLOT_TASK_RECORD_ID = recordId;
  showOwnerMessage();
}
function previewSlotTaskLink(){
  const link = document.getElementById('slotSummaryPreviewBtn').dataset.link;
  if(link) window.open(link, '_blank');
}
function copySlotTaskMessage(recordId){
  const t = SLOT_TASKS.find(x => x.record_id === recordId);
  if(!t) return;
  window.LAST_SLOT_TASK_RECORD_ID = recordId;
  if(t.stage === '待業務確認' && t.chosen_slot){ showSlotChosenMessage(t); return; }
  const path = '/book.html?token=' + t.token;
  let estS = '', estE = '', delegate = !!t.duration_min;
  if(t.est_start && t.duration_min){
    const [h, m] = t.est_start.split(':').map(Number);
    const endMin = h * 60 + m + t.duration_min;
    estS = t.est_start;
    estE = String(Math.floor(endMin / 60)).padStart(2,'0') + ':' + String(endMin % 60).padStart(2,'0');
    delegate = false;
  }
  showSlotTaskMessage(t.vendor, t.case, t.alias, t.type, t.candidate_dates, path, estS, estE, t.duration_min, delegate, t.deadline);
}
async function deleteSlotTask(recordId){
  if(!confirm('確定要刪除這個任務嗎？（連結會立刻失效，如果業務已經在填的話會失敗）')) return;
  try{
    const res = await fetch(API_BASE + '/api/vendor-slots/tasks/' + encodeURIComponent(recordId), {method:'DELETE'});
    if(!res.ok) throw new Error('HTTP ' + res.status);
    SLOT_TASKS = SLOT_TASKS.filter(t => t.record_id !== recordId);
    renderSlotTasks();
    showToast('已刪除任務');
  }catch(err){
    showToast('刪除失敗：' + err.message);
  }
}

function fmtWeekday(dateStr){
  const wdays = ['日','一','二','三','四','五','六'];
  const d = new Date(dateStr + 'T00:00:00');
  return '週' + wdays[d.getDay()];
}

// 2026-10-08：「完成安排」只放今天（含）以後的預約；日期已過的移到「🗂 歷史紀錄」分頁
// （資料都還在 Airtable，只是分開顯示）。兩頁共用同一組篩選：項目類型按鈕＋
// 廠商／業務／安排人員下拉（可複選）。業務＝任務的指派對象（沒有任務、直接預約的用登記人），
// 安排人員＝建立任務的同仁。
let SLOT_TYPE_FILTER = '';
let SLOT_BOOKING_FILTER = {vendors: [], reps: [], schedulers: []};
function setSlotTypeFilter(t){ SLOT_TYPE_FILTER = t; renderVendorSlots(); }
function bookingPeople(b){
  const t = (typeof SLOT_TASKS !== 'undefined' ? SLOT_TASKS : []).find(x => x.booking_id === b.record_id);
  return {rep: canonRep((t && t.assignee) || b.registrant || ''), scheduler: (t && t.creator) || ''};
}
function slotBookingFilterMatch(b){
  const f = SLOT_BOOKING_FILTER, p = bookingPeople(b);
  if(SLOT_TYPE_FILTER && !(b.type || []).includes(SLOT_TYPE_FILTER)) return false;
  if(f.vendors.length && !f.vendors.includes(b.vendor)) return false;
  if(f.reps.length && !f.reps.includes(p.rep)) return false;
  if(f.schedulers.length && !f.schedulers.includes(p.scheduler)) return false;
  return true;
}
function onSlotBookingFilterChange(el){
  const arr = SLOT_BOOKING_FILTER[el.dataset.kind];
  const v = el.dataset.val, i = arr.indexOf(v);
  if(el.checked && i < 0) arr.push(v);
  if(!el.checked && i >= 0) arr.splice(i, 1);
  renderVendorSlots();
}
function clearSlotBookingFilters(){
  SLOT_BOOKING_FILTER = {vendors: [], reps: [], schedulers: []};
  SLOT_TYPE_FILTER = '';
  renderVendorSlots();
}
function renderSlotBookingFilterBars(barId, typeBarId, pool, shownCount){
  const typeBar = document.getElementById(typeBarId);
  if(typeBar){
    typeBar.innerHTML = ['', '掛表', '植筋', '放樣', '場勘', '進場'].map(t => {
      const n = t ? pool.filter(b => (b.type || []).includes(t)).length : pool.length;
      return `<button type="button" class="btn ${SLOT_TYPE_FILTER === t ? 'btn-primary' : 'btn-ghost'}" style="padding:4px 12px;font-size:12px;" onclick="setSlotTypeFilter('${t}')">${t || '全部'} ${n}</button>`;
    }).join('');
  }
  const bar = document.getElementById(barId);
  if(!bar) return;
  const openIds = [...bar.querySelectorAll('.slot-type-dropdown.show')].map(x => x.id);
  const f = SLOT_BOOKING_FILTER;
  const zh = (a, b) => a.localeCompare(b, 'zh-Hant');
  const uniq = (arr, extra) => [...new Set([...arr, ...extra].filter(Boolean))].sort(zh);
  const vendors = uniq(pool.map(b => b.vendor), f.vendors);
  const reps = uniq(pool.map(b => bookingPeople(b).rep), f.reps);
  const schedulers = uniq(pool.map(b => bookingPeople(b).scheduler), f.schedulers);
  const dd = (id, emptyLabel, kind, options, selected) => `
    <div class="quick-mark-input-wrap" style="min-width:170px;max-width:260px;">
      <div class="quick-mark-input slot-type-trigger" id="${id}Trigger" onclick="toggleSlotTypeDropdown('${id}Panel')">
        <span style="color:${selected.length ? 'var(--text)' : 'var(--text-muted)'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${selected.length ? escHtml(selected.join('、')) : emptyLabel}</span>
        <span style="color:var(--text-muted);font-size:11px;">▾</span>
      </div>
      <div class="quick-mark-results slot-type-dropdown" id="${id}Panel" data-trigger-id="${id}Trigger">
        ${options.length ? options.map(o => `<label class="slot-type-option"><input type="checkbox" data-kind="${kind}" data-val="${escHtml(o)}" ${selected.includes(o) ? 'checked' : ''} onchange="onSlotBookingFilterChange(this)">${escHtml(o)}</label>`).join('') : '<div style="padding:10px 14px;font-size:12px;color:var(--text-muted);">沒有可選項目</div>'}
      </div>
    </div>`;
  const active = SLOT_TYPE_FILTER || f.vendors.length || f.reps.length || f.schedulers.length;
  bar.innerHTML = dd(barId + 'Vendor', '全部廠商（可複選）', 'vendors', vendors, f.vendors)
    + dd(barId + 'Rep', '全部業務（可複選）', 'reps', reps, f.reps)
    + dd(barId + 'Scheduler', '全部安排人員（可複選）', 'schedulers', schedulers, f.schedulers)
    + (active ? `<button type="button" class="btn btn-ghost" style="padding:5px 12px;font-size:12px;" onclick="clearSlotBookingFilters()">清除篩選</button>
      <span style="font-size:12px;color:var(--text-muted);">顯示 ${shownCount} / ${pool.length} 筆</span>` : '');
  openIds.forEach(id => { const x = document.getElementById(id); if(x) x.classList.add('show'); });
}

function renderBookingGroups(container, list, poolSize, newestFirst, emptyMsg, canCancel){
  if(!container) return;
  if(poolSize === 0){ container.innerHTML = `<div class="login-note">${emptyMsg}</div>`; return; }
  if(list.length === 0){ container.innerHTML = '<div class="login-note">沒有符合篩選條件的預約。</div>'; return; }
  // 依廠商分組，每個廠商底下再依日期分組
  const byVendor = {};
  list.forEach(b => {
    if(!byVendor[b.vendor]) byVendor[b.vendor] = {};
    if(!byVendor[b.vendor][b.date]) byVendor[b.vendor][b.date] = [];
    byVendor[b.vendor][b.date].push(b);
  });
  const typeChipClass = {'掛表':'chip-meter','植筋':'chip-rebar','放樣':'chip-enter','場勘':'chip-ship','進場':'chip-enter'};
  const typeChipsHtml = (types) => (types||[]).map(ty => `<span class="chip ${typeChipClass[ty]||''}" style="flex-shrink:0;">${ty}</span>`).join('');
  container.innerHTML = Object.keys(byVendor).sort((a,b)=>a.localeCompare(b,'zh-Hant')).map(vendor => {
    const vendorClass = VENDOR_CLASS[vendor] || 'vendor-other';
    const dates = Object.keys(byVendor[vendor]).sort();
    if(newestFirst) dates.reverse();
    const dayBlocks = dates.map(date => {
      const sortedBookings = [...byVendor[vendor][date]].sort((a,b)=>(a.start_time||'').localeCompare(b.start_time||''));
      const rows = sortedBookings.map(b => `
            <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;">
              ${typeChipsHtml(b.type)}
              <span style="font-weight:700;font-size:12.5px;flex-shrink:0;">${b.start_time}-${b.end_time}</span>
              <span style="font-size:12.5px;flex:1;min-width:120px;">${b.case||''}${b.alias?('　'+b.alias):''}</span>
              <span style="font-size:11px;color:var(--text-muted);flex-shrink:0;">${b.registrant||''}</span>
              ${b.cancelled ? `<span class="chip" style="flex-shrink:0;background:#FDECEC;color:#B42318;">❌ 已取消</span>` : ''}
              <button class="btn btn-ghost" style="padding:3px 8px;font-size:11px;flex-shrink:0;" onclick="showSlotBookingDetail('${b.record_id}')">📄 查看填單</button>
              ${b.cancelled ? '' : `<button class="btn btn-ghost" style="padding:3px 8px;font-size:11px;flex-shrink:0;${b.vendor_notified_at ? 'color:#16A34A;border-color:#BFE6CF;' : ''}" onclick="openVendorNotice('${b.record_id}')" title="${b.vendor_notified_at ? '已通知廠商：' + fmtDateTimeTW(b.vendor_notified_at) : '確認屋主資料後，傳卡片到廠商群組'}">${b.vendor_notified_at ? '✓ 已通知廠商' : '📤 通知廠商'}</button>`}
              ${canCancel && !b.cancelled ? `<button class="btn btn-ghost" style="padding:3px 8px;font-size:11px;flex-shrink:0;color:#B42318;" onclick="openCancelBooking('${b.record_id}')">❌ 取消預約</button>` : ''}
              ${b.cancelled ? '' : `<button class="btn btn-ghost" style="padding:3px 8px;font-size:11px;flex-shrink:0;" onclick="deleteSlotBooking('${b.record_id}')">刪除</button>`}
              ${b.cancelled ? `<div style="flex-basis:100%;font-size:11.5px;color:#B42318;padding-left:2px;">取消原因：${escHtml(b.cancel_reason || '（未填）')}${b.cancelled_at ? '　' + fmtDateTimeTW(b.cancelled_at) : ''}</div>` : ''}
              ${(b.owner_name || b.owner_phone || b.note) ? `<div style="flex-basis:100%;font-size:11.5px;color:var(--text-muted);line-height:1.6;padding-left:2px;">
                ${(b.owner_name || b.owner_phone) ? `👤 屋主：${[b.owner_name, b.owner_phone].filter(Boolean).join('　')}` : ''}
                ${b.note ? `${(b.owner_name || b.owner_phone) ? '　' : ''}📝 備註：${b.note}` : ''}
              </div>` : ''}
            </div>`).join('');
      return `
        <div style="margin-bottom:14px;">
          <div style="font-weight:700;font-size:13px;margin-bottom:4px;">${fmtDate(date)}（${fmtWeekday(date)}）</div>
          ${rows}
        </div>`;
    }).join('');
    return `
      <div class="panel" style="margin-bottom:16px;">
        <div class="panel-title">
          <span class="vendor-pill ${vendorClass}">${vendor}</span>
          <div class="panel-title-actions">
            <button class="btn btn-ghost notes-trigger-btn" onclick="copySlotSummary('${vendor}')">📋 複製清單</button>
          </div>
        </div>
        ${dayBlocks}
      </div>`;
  }).join('');
}

function renderVendorSlots(){
  const today = todayStr();
  const upcoming = SLOT_BOOKINGS.filter(b => (b.date || '') >= today);
  // 歷史紀錄＝日期已過的預約＋所有已取消的預約
  const past = SLOT_BOOKINGS.filter(b => (b.date || '') < today).concat(SLOT_CANCELLED || []);
  const shownUp = upcoming.filter(slotBookingFilterMatch);
  const shownPast = past.filter(slotBookingFilterMatch);
  renderSlotBookingFilterBars('slotBookingFilterBar', 'slotTypeFilterBar', upcoming, shownUp.length);
  renderSlotBookingFilterBars('slotHistoryFilterBar', 'slotHistoryTypeFilterBar', past, shownPast.length);
  const histTab = document.querySelector('#view-slots .tab[data-slots-tab="history"]');
  if(histTab) histTab.textContent = '🗂 歷史紀錄' + (past.length ? ' ' + past.length : '');
  renderBookingGroups(document.getElementById('slotsContainer'), shownUp, upcoming.length, false,
    '目前沒有今天以後的預約，點上面「➕ 預約時段」或「📨 指派給業務」新增一筆。', true);
  renderBookingGroups(document.getElementById('slotsHistoryContainer'), shownPast, past.length, true, '還沒有歷史紀錄。');
}

// 2026-10-05：查看業務當時送出的填單內容（唯讀，排成跟業務填單頁類似的版面）
function closeSlotDetail(){
  const ov = document.getElementById('slotDetailOverlay');
  if(ov) ov.remove();
}
function escHtml(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtDateTimeTW(iso){
  if(!iso) return '';
  const d = new Date(iso);
  if(isNaN(d)) return '';
  const f = new Intl.DateTimeFormat('zh-TW', {timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false}).format(d);
  return f;
}
async function showSlotBookingDetail(recordId){
  closeSlotDetail();
  const ov = document.createElement('div');
  ov.id = 'slotDetailOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
  ov.onclick = e => { if(e.target === ov) closeSlotDetail(); };
  ov.innerHTML = '<div style="background:#fff;border-radius:16px;padding:24px;max-width:460px;width:100%;color:#1B2333;">載入中…</div>';
  document.body.appendChild(ov);
  try{
    const res = await fetch(API_BASE + '/api/vendor-slots/' + encodeURIComponent(recordId) + '/detail', {cache:'no-store'});
    const d = await res.json();
    if(!res.ok) throw new Error(d.error || ('HTTP ' + res.status));
    const b = d.booking, t = d.task;
    const row = (k, v) => v ? `<div style="display:flex;gap:10px;padding:7px 0;border-bottom:1px solid #F0E4CC;font-size:13.5px;"><div style="width:84px;flex-shrink:0;color:#6B7280;">${k}</div><div style="flex:1;word-break:break-all;">${v}</div></div>` : '';
    const wd = b.date ? '（' + fmtWeekday(b.date) + '）' : '';
    // 屋主資訊是否同公證書（任務預設值）
    let ownerTag = '';
    if(t && (t.owner_name || t.owner_phone)){
      const same = (b.owner_name || '') === (t.owner_name || '') && (b.owner_phone || '') === (t.owner_phone || '');
      ownerTag = same ? '<span style="color:#16A34A;font-weight:700;">　✓ 與公證書／合約資訊相同</span>'
                      : `<div style="margin-top:4px;font-size:12px;color:#B45309;">⚠️ 業務有修改過。公證書／合約帶入的是：${escHtml(t.owner_name)} ${escHtml(t.owner_phone)}</div>`;
    }
    const alts = t && t.alt_slots && t.alt_slots.length
      ? t.alt_slots.map(s => `${fmtDate(s.date)} ${s.start_time}-${s.end_time}`).join('、') : '';
    ov.firstElementChild.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
        <div style="font-size:17px;font-weight:800;">業務填單內容</div>
        <button type="button" onclick="closeSlotDetail()" style="border:none;background:#F1F3F8;border-radius:50%;width:30px;height:30px;cursor:pointer;">✕</button>
      </div>
      <div style="font-size:12px;color:#6B7280;margin-bottom:10px;">這是業務送出預約當時填寫的資料（唯讀）</div>
      <div style="background:#FFFCF5;border:1px solid #F0E4CC;border-radius:12px;padding:6px 14px;">
        ${row('廠商／項目', escHtml(b.vendor) + '　' + escHtml((b.type || []).join('＋')))}
        ${row('案號', escHtml(b.case) + (b.alias ? '　' + escHtml(b.alias) : ''))}
        ${row('預約時間', b.date ? `${fmtDate(b.date)}${wd}　${escHtml(b.start_time)}–${escHtml(b.end_time)}` : '')}
        ${row('登記人', escHtml(b.registrant))}
        ${row('屋主姓名', escHtml(b.owner_name) + ownerTag)}
        ${row('屋主電話', escHtml(b.owner_phone))}
        ${row('業務備註', escHtml(b.note))}
        ${row('填單時間', escHtml(fmtDateTimeTW(b.created_at)))}
      </div>
      ${t ? `<div style="font-size:12.5px;font-weight:700;margin:14px 0 4px;">指派任務資訊</div>
      <div style="background:#fff;border:1px solid #E4E8F1;border-radius:12px;padding:6px 14px;">
        ${row('指派給', escHtml(t.assignee))}
        ${row('安排人員', escHtml(t.creator))}
        ${row('回覆期限', escHtml(t.deadline ? fmtDeadline(t.deadline) : ''))}
        ${row('候選日期', escHtml((t.candidate_dates || []).map(fmtDate).join('、')))}
        ${row('曾回傳其他時間', escHtml(alts))}
        ${row('窗口備註', escHtml(t.note))}
      </div>` : '<div style="font-size:12px;color:#6B7280;margin-top:12px;">這筆是在主控台直接預約的，沒有業務填單任務。</div>'}`;
  }catch(err){
    ov.firstElementChild.innerHTML = '<div style="color:#B42318;">載入失敗：' + escHtml(err.message) + '</div><button type="button" class="btn btn-ghost" style="margin-top:10px;" onclick="closeSlotDetail()">關閉</button>';
  }
}

// 2026-10-08：通知廠商。先確認屋主聯絡資料（預設帶公證書／合約上的資料），存回預約，
// 再產生 LIFF 分享連結；用手機 LINE 打開、選廠商群組，把卡片傳過去。
function closeVendorNotice(){ const ov = document.getElementById('vendorNoticeOverlay'); if(ov) ov.remove(); }
async function openVendorNotice(recordId){
  const b = SLOT_BOOKINGS.find(x => x.record_id === recordId);
  if(!b){ showToast('找不到這筆預約，請重新整理'); return; }
  closeVendorNotice();
  const ov = document.createElement('div');
  ov.id = 'vendorNoticeOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
  ov.onclick = e => { if(e.target === ov) closeVendorNotice(); };
  ov.innerHTML = '<div style="background:#fff;border-radius:16px;padding:22px;max-width:460px;width:100%;color:#1B2333;max-height:92vh;overflow-y:auto;">載入中…</div>';
  document.body.appendChild(ov);
  let contract = null;
  try{
    const r = await fetch(API_BASE + '/api/owner-contact?case=' + encodeURIComponent(b.case || ''), {cache: 'no-store'});
    const d = await r.json();
    if(d.found) contract = d;
  }catch(e){}
  const defName = (contract && contract.name) || b.owner_name || '';
  const defPhone = (contract && contract.phone) || b.owner_phone || '';
  const src = (label, n, p) => (n || p) ? `<div style="font-size:12px;color:#6B7280;margin-top:4px;">${label}：${escHtml(n)} ${escHtml(p)}
      <button type="button" class="btn btn-ghost" style="padding:1px 8px;font-size:11px;margin-left:4px;" onclick="document.getElementById('vnName').value=${JSON.stringify(n || '').replace(/"/g, '&quot;')};document.getElementById('vnPhone').value=${JSON.stringify(p || '').replace(/"/g, '&quot;')}">帶入</button></div>` : '';
  const wd = b.date ? '（' + fmtWeekday(b.date) + '）' : '';
  ov.firstElementChild.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div style="font-size:17px;font-weight:800;">📤 通知廠商</div>
      <button type="button" onclick="closeVendorNotice()" style="border:none;background:#F1F3F8;border-radius:50%;width:30px;height:30px;cursor:pointer;">✕</button>
    </div>
    <div style="font-size:13px;color:#6B7280;margin:4px 0 12px;">${escHtml(b.vendor)}｜${escHtml((b.type || []).join('＋'))}｜${fmtDate(b.date)}${wd} ${escHtml(b.start_time)}–${escHtml(b.end_time)}<br>${escHtml(b.case)} ${escHtml(b.alias || '')}</div>
    <div style="font-size:13px;font-weight:700;margin-bottom:6px;">屋主聯絡資訊（會出現在給廠商的卡片上）</div>
    <div style="display:flex;gap:8px;">
      <input id="vnName" class="quick-mark-input" placeholder="屋主姓名" value="${escHtml(defName)}" style="flex:1;">
      <input id="vnPhone" class="quick-mark-input" placeholder="屋主電話" value="${escHtml(defPhone)}" style="flex:1;">
    </div>
    ${src('公證書／合約資料', contract && contract.name, contract && contract.phone)}
    ${src('業務填寫', b.owner_name, b.owner_phone)}
    ${!contract ? '<div style="font-size:12px;color:#B45309;margin-top:4px;">找不到這案的公證書資料，請手動確認姓名電話。</div>' : ''}
    <div style="font-size:13px;font-weight:700;margin:14px 0 6px;">給廠商的備註（選填）</div>
    <textarea id="vnNote" class="quick-mark-input" rows="2" placeholder="例如：請提早 10 分鐘到、屋主下午才在家"></textarea>
    <button type="button" class="btn btn-primary" id="vnSubmit" style="width:100%;justify-content:center;padding:11px;margin-top:14px;" onclick="submitVendorNotice('${recordId}')">儲存並產生廠商通知</button>
    <div id="vnResult"></div>`;
}
async function submitVendorNotice(recordId){
  const btn = document.getElementById('vnSubmit');
  const name = document.getElementById('vnName').value.trim();
  const phone = document.getElementById('vnPhone').value.trim();
  if(!name || !phone){ showToast('請先填屋主姓名和電話'); return; }
  btn.disabled = true; btn.textContent = '儲存中…';
  try{
    const res = await fetch(API_BASE + '/api/vendor-slots/' + encodeURIComponent(recordId) + '/vendor-notice', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({owner_name: name, owner_phone: phone, pm_note: document.getElementById('vnNote').value.trim()}),
    });
    const d = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(d.error || ('HTTP ' + res.status));
    window._vnPlain = d.plain_text || '';
    window._vnLink = d.liff_url || '';
    btn.style.display = 'none';
    document.getElementById('vnResult').innerHTML = `
      <div style="margin-top:14px;padding:12px 14px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:12px;font-size:13px;line-height:1.7;">
        ✅ 已儲存屋主資料。<b>下一步：用手機 LINE 開啟下面的連結</b>，按「選擇廠商群組並傳送」，選這家廠商的群組送出卡片。
      </div>
      ${d.liff_url ? `<a href="${d.liff_url}" target="_blank" rel="noopener" class="btn btn-primary" style="width:100%;justify-content:center;padding:11px;margin-top:10px;text-decoration:none;">📱 在 LINE 開啟並選擇群組</a>
      <button type="button" class="btn btn-ghost" style="width:100%;justify-content:center;padding:10px;margin-top:8px;" onclick="copyVnText(window._vnLink, '已複製連結，可以貼到 LINE 給自己再點開')">複製連結（在電腦上時，傳到自己的 LINE 再點）</button>` : ''}
      <button type="button" class="btn btn-ghost" style="width:100%;justify-content:center;padding:10px;margin-top:8px;" onclick="copyVnText(window._vnPlain, '已複製文字版通知')">複製文字版（備用）</button>`;
    loadVendorSlots();
  }catch(err){
    showToast('儲存失敗：' + err.message);
    btn.disabled = false; btn.textContent = '儲存並產生廠商通知';
  }
}
function copyVnText(text, okMsg){
  const ta = document.createElement('textarea');
  ta.value = text || ''; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try{ document.execCommand('copy'); showToast(okMsg); }catch(e){ showToast('複製失敗'); }
  ta.remove();
}

// 2026-10-08：取消預約（例如發現還不能進場）。跟「刪除」不同：保留紀錄（移到歷史紀錄）、
// 釋放廠商時段、清掉自動寫回的預計日期、屋主頁顯示已取消，並通知業務（附給屋主的取消訊息）。
function closeCancelBooking(){ const ov = document.getElementById('cancelBookingOverlay'); if(ov) ov.remove(); }
function openCancelBooking(recordId){
  const b = SLOT_BOOKINGS.find(x => x.record_id === recordId);
  if(!b){ showToast('找不到這筆預約，請重新整理'); return; }
  closeCancelBooking();
  const p = bookingPeople(b);
  const ov = document.createElement('div');
  ov.id = 'cancelBookingOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
  ov.onclick = e => { if(e.target === ov) closeCancelBooking(); };
  ov.innerHTML = `<div style="background:#fff;border-radius:16px;padding:22px;max-width:460px;width:100%;color:#1B2333;max-height:92vh;overflow-y:auto;">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div style="font-size:17px;font-weight:800;color:#B42318;">❌ 取消預約</div>
      <button type="button" onclick="closeCancelBooking()" style="border:none;background:#F1F3F8;border-radius:50%;width:30px;height:30px;cursor:pointer;">✕</button>
    </div>
    <div style="font-size:13px;color:#6B7280;margin:6px 0 14px;line-height:1.7;">${escHtml(b.vendor)}｜${escHtml((b.type || []).join('＋'))}｜${fmtDate(b.date)}（${fmtWeekday(b.date)}）${escHtml(b.start_time)}–${escHtml(b.end_time)}<br>${escHtml(b.case)} ${escHtml(b.alias || '')}${b.owner_name ? '<br>屋主：' + escHtml(b.owner_name) + ' ' + escHtml(b.owner_phone || '') : ''}</div>
    <div style="font-size:13px;font-weight:700;margin-bottom:6px;">取消原因（會寫進給屋主的訊息）</div>
    <input id="cbReason" class="quick-mark-input" placeholder="例如：現場還有問題需要先處理" value="施工安排需要調整">
    <div style="font-size:13px;font-weight:700;margin:14px 0 6px;">之後要重新約嗎？</div>
    <label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;margin-bottom:6px;cursor:pointer;"><input type="radio" name="cbReopen" value="1" checked style="margin-top:3px;"> 要，任務退回「指派任務」，之後再重新約時間（業務／屋主連結會恢復成可以選時間）</label>
    <label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;cursor:pointer;"><input type="radio" name="cbReopen" value="0" style="margin-top:3px;"> 不用，這個任務就結束（連結會顯示已取消）</label>
    <label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-top:14px;cursor:pointer;"><input type="checkbox" id="cbNotify" checked> 用 LINE 通知業務${p.rep ? ' ' + escHtml(p.rep) : ''}（附「複製給屋主的取消訊息」按鈕）</label>
    ${b.vendor_notified_at ? '<div style="font-size:12px;color:#D97706;margin-top:10px;">⚠️ 這筆已經通知過廠商，取消後記得也跟廠商說一聲。</div>' : ''}
    <button type="button" id="cbSubmit" class="btn btn-primary" style="width:100%;justify-content:center;padding:11px;margin-top:16px;background:#DC2626;border-color:#DC2626;" onclick="submitCancelBooking('${recordId}')">確定取消這筆預約</button>
    <div id="cbResult"></div>
  </div>`;
  document.body.appendChild(ov);
}
async function submitCancelBooking(recordId){
  const btn = document.getElementById('cbSubmit');
  const reopen = (document.querySelector('input[name="cbReopen"]:checked') || {}).value === '1';
  btn.disabled = true; btn.textContent = '取消中…';
  try{
    const res = await fetch(API_BASE + '/api/vendor-slots/' + encodeURIComponent(recordId) + '/cancel', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({reason: document.getElementById('cbReason').value.trim(), reopen, notify: document.getElementById('cbNotify').checked}),
    });
    const d = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(d.error || ('HTTP ' + res.status));
    window._cbMsg = d.owner_message || '';
    btn.style.display = 'none';
    document.getElementById('cbResult').innerHTML = `
      <div style="margin-top:14px;padding:12px 14px;background:#ECFDF3;border:1px solid #BFE6CF;border-radius:12px;font-size:13px;line-height:1.7;">
        ✅ 已取消，時段已釋放${d.reopened ? '，任務已退回「指派任務」' : ''}。<br>
        ${d.rep_notified ? '已用 LINE 通知業務 ' + escHtml(d.rep_name) + '，卡片上有「複製給屋主的取消訊息」按鈕。'
          : (d.rep_name ? '⚠️ 業務 ' + escHtml(d.rep_name) + ' 沒有綁定 LINE（或推播失敗），請把下面的訊息傳給他或直接傳給屋主。' : '⚠️ 這筆沒有對應的業務，請把下面的訊息直接傳給屋主。')}
        ${d.vendor_was_notified ? '<br>⚠️ 這筆通知過廠商，記得也跟廠商說取消。' : ''}
      </div>
      <div style="font-size:12.5px;font-weight:700;margin:12px 0 6px;">給屋主的取消訊息</div>
      <textarea readonly class="quick-mark-input" style="min-height:110px;font-size:13px;">${escHtml(d.owner_message || '')}</textarea>
      <button type="button" class="btn btn-ghost" style="width:100%;justify-content:center;padding:10px;margin-top:8px;" onclick="copyVnText(window._cbMsg, '已複製給屋主的取消訊息')">📋 複製訊息</button>`;
    loadVendorSlots();
  }catch(err){
    showToast('取消失敗：' + err.message);
    btn.disabled = false; btn.textContent = '確定取消這筆預約';
  }
}

async function deleteSlotBooking(recordId){
  if(!confirm('確定要刪除這筆預約嗎？')) return;
  try{
    const res = await fetch(API_BASE + '/api/vendor-slots/' + encodeURIComponent(recordId), {method:'DELETE'});
    if(!res.ok) throw new Error('HTTP ' + res.status);
    SLOT_BOOKINGS = SLOT_BOOKINGS.filter(b => b.record_id !== recordId);
    renderVendorSlots();
    refreshAllVendorFilteredViews();
    showToast('已刪除預約');
  }catch(err){
    showToast('刪除失敗：' + err.message);
  }
}

// 跟「出貨通知訊息」(copyNotifyText) 同一種做法：把文字放進唯讀 textarea 讓
// 使用者自己看一眼/能手動調整，用 execCommand('copy') 複製，不直接用
// navigator.clipboard（在非 HTTPS 或某些瀏覽器安全性設定下會整個不存在，
// 直接呼叫會丟出例外）。
function copySlotSummary(vendor){
  const dates = [...new Set(SLOT_BOOKINGS.filter(b=>b.vendor===vendor).map(b=>b.date))].sort();
  let text = vendor + ' 現場排程確認：\n';
  dates.forEach(date => {
    text += fmtDate(date) + '（' + fmtWeekday(date) + '）\n';
    const bookings = SLOT_BOOKINGS.filter(b=>b.vendor===vendor && b.date===date).sort((a,b)=>(a.start_time||'').localeCompare(b.start_time||''));
    bookings.forEach(b => {
      text += `　${b.start_time}-${b.end_time}　${(b.type||[]).join('+')}｜${b.case}${b.alias ? '（'+b.alias+'）' : ''}\n`;
    });
  });
  document.getElementById('slotSummaryTitle').textContent = '📋 ' + vendor + ' 時段清單';
  document.getElementById('slotSummaryTextarea').value = text;
  document.getElementById('slotSummaryPreviewBtn').style.display = 'none'; // 複製清單沒有對應的 book.html 連結可以預覽
  const bn2 = document.getElementById('slotSummaryBindNote'); if(bn2) bn2.innerHTML = '';
  document.getElementById('slotSummaryOwnerBtn').style.display = 'none';
  document.getElementById('slotSummaryModalOverlay').classList.add('show');
}
function closeSlotSummaryModal(){
  document.getElementById('slotSummaryModalOverlay').classList.remove('show');
}
function copySlotSummaryText(){
  const ta = document.getElementById('slotSummaryTextarea');
  ta.select();
  try{ document.execCommand('copy'); }catch(e){}
  const btn = event.target;
  const original = btn.textContent;
  btn.textContent = '✓ 已複製';
  setTimeout(()=>{ btn.textContent = original; }, 1500);
}
// 2026-10-01 新增：LINE 官方提供的分享連結格式（https://line.me/R/msg/text/?
// 文字），不用申請任何 API/權限，點開會跳轉到 LINE app（手機）或 LINE 桌面版
// /網頁版，讓使用者自己選要傳給誰，文字已經預先帶好。開新分頁而不是直接
// location.href，避免使用者從 LINE 切回來時這頁的狀態不見。
function shareSlotSummaryToLine(){
  const text = document.getElementById('slotSummaryTextarea').value;
  // noreferrer：避免 LINE 把目前頁面的網址（主控台首頁）也額外附在訊息後面
  window.open('https://line.me/R/msg/text/?' + encodeURIComponent(text), '_blank', 'noopener,noreferrer');
}

// 原本開始/結束時間用 <input type="time">，使用者反饋原生時間選取器（上午/下午
// 分段輸入）很難用。改成固定的 <select> 時間下拉（07:00~20:00，每 30 分鐘一格），
// 跟案件安排時段的場景夠用，點選比對著原生元件輸入精準快很多。
const SLOT_TIME_OPTIONS = (() => {
  const list = [];
  for(let h = 7; h <= 20; h++){
    for(const m of [0, 30]){
      if(h === 20 && m === 30) continue; // 到 20:00 就好，不用到 20:30
      list.push(String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0'));
    }
  }
  return list;
})();
function slotTimeOptionsHtml(){
  return '<option value="">請選擇</option>' + SLOT_TIME_OPTIONS.map(t => `<option value="${t}">${t}</option>`).join('');
}

// 2026-10-01 新增：把分鐘數轉成「X小時Y分鐘」文字，給「交由業務安排」的
// 預估時長訊息行用。
function slotDurationLabel(min){
  const h = Math.floor(min / 60), m = min % 60;
  return (h > 0 ? h + '小時' : '') + (m > 0 ? m + '分鐘' : '');
}
function slotMinutesBetween(start, end){
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

// 2026-10-01 新增：各項目類型預設需要的時間長度（分鐘），掛表另外固定
// 09:00 開始（使用者指定早上9點到中午12點）。開始時間空白時先補 09:00，
// 再依類型長度算出結束時間；使用者改開始時間或項目類型都會重算一次，
// 但算完之後還是可以手動改選單，不會卡死。參數化成 typeCheckClass/
// startId/endId 是因為「預約時段」modal（實際時間，必填）跟「指派給業務」
// modal（預估時間，純參考用、選填）都要套用同一套規則。
// 2026-10-01 同日再調整：項目類型改成可複選（使用者反饋常常「放樣跟植筋
// 一起」跑同一趟），勾選多個時長度直接加總（例如植筋3hr+放樣1hr＝4hr）。
const SLOT_TYPE_DURATION_MIN = {'掛表':180,'植筋':180,'放樣':60,'場勘':60};
function getCheckedSlotTypes(checkClass){
  return [...document.querySelectorAll('.' + checkClass + ':checked')].map(c => c.value);
}
function applyTypeTimeDefault(typeCheckClass, startId, endId){
  const startSel = document.getElementById(startId);
  const endSel = document.getElementById(endId);
  if(!startSel || !endSel) return;
  const types = getCheckedSlotTypes(typeCheckClass);
  const duration = types.reduce((sum, t) => sum + (SLOT_TYPE_DURATION_MIN[t] || 0), 0);
  if(!duration) return;
  if(!startSel.value) startSel.value = '09:00';
  const [h, m] = startSel.value.split(':').map(Number);
  const totalMin = h * 60 + m + duration;
  const endVal = String(Math.floor(totalMin / 60)).padStart(2,'0') + ':' + String(totalMin % 60).padStart(2,'0');
  if([...endSel.options].some(o => o.value === endVal)) endSel.value = endVal;
}
function applySlotBookingTimeDefault(){ applyTypeTimeDefault('slot-booking-type-check', 'slotBookingStart', 'slotBookingEnd'); }
function applySlotTaskTimeDefault(){ applyTypeTimeDefault('slot-task-type-check', 'slotTaskEstStart', 'slotTaskEstEnd'); }

// 2026-10-01：項目類型從「一排勾選框」改成「下拉式複選」（使用者反饋勾選框
// 排一排不好看），點觸發框展開下拉面板，面板裡還是勾選框（可以勾多個），
// 觸發框上的文字即時顯示已選的項目，沒選就顯示「請選擇」。跟案號模糊搜尋
// 共用同一個 .quick-mark-results 下拉外觀跟 position:relative 容器寫法。
function updateSlotTypeLabel(checkClass, labelId){
  const labelEl = document.getElementById(labelId);
  if(!labelEl) return;
  const types = getCheckedSlotTypes(checkClass);
  if(types.length === 0){
    labelEl.textContent = '請選擇';
    labelEl.style.color = 'var(--text-muted)';
  } else {
    labelEl.textContent = types.join('、');
    labelEl.style.color = 'var(--text)';
  }
}
function toggleSlotTypeDropdown(panelId){
  const panel = document.getElementById(panelId);
  if(!panel) return;
  document.querySelectorAll('.slot-type-dropdown.show').forEach(p => { if(p.id !== panelId) p.classList.remove('show'); });
  panel.classList.toggle('show');
}
document.addEventListener('click', (e) => {
  document.querySelectorAll('.slot-type-dropdown.show').forEach(panel => {
    const trigger = document.getElementById(panel.dataset.triggerId);
    if(!panel.contains(e.target) && e.target !== trigger && !(trigger && trigger.contains(e.target))){
      panel.classList.remove('show');
    }
  });
});
function onSlotBookingTypeChange(){
  applySlotBookingTimeDefault();
  updateSlotTypeLabel('slot-booking-type-check', 'slotBookingTypeLabel');
}
function onSlotTaskTypeChange(){
  updateSlotTypeLabel('slot-task-type-check', 'slotTaskTypeLabel');
  if(!slotDeadlineTouched) setDefaultSlotDeadline();
  if(document.getElementById('slotTaskEstDelegate').checked){
    setSlotTaskEstDurationFromMinutes(getSlotTaskTypeDurationSum());
  } else {
    applySlotTaskTimeDefault();
  }
}

// 2026-10-01 新增：案號打完之後自動帶出廠商／別名／負責業務，資料來源跟
// 「電話紀錄」筆記本功能共用同一個後端查詢（/api/case-lookup?case_no=，
// 需要完全符合案號），避免兩個廠商時段 modal 的案號/廠商/別名/業務要再
// 手動對一次。只在查到資料時才覆蓋欄位，查無資料（案號還沒打完/打錯）就
// 不動使用者已經填的內容。debounce 500ms，不然每打一個字就送一次查詢。
// 廠商欄位是 <select>，用程式改值不會自動觸發 onchange，所以改完手動
// dispatch 一次 change，讓「預約時段」modal 原本掛在廠商 onchange 上的
// 當天預約預覽也會跟著刷新。
function wireSlotCaseAutofill(caseId, aliasId, assigneeId, vendorId){
  const caseInput = document.getElementById(caseId);
  if(!caseInput) return;
  let timer = null;
  caseInput.addEventListener('input', () => {
    clearTimeout(timer);
    const caseNo = caseInput.value.trim();
    if(!caseNo) return;
    timer = setTimeout(async () => {
      try{
        const res = await fetch(API_BASE + '/api/case-lookup?case_no=' + encodeURIComponent(caseNo), {cache: 'no-store'});
        const data = await res.json().catch(() => ({}));
        if(!res.ok || !data.found) return;
        if(caseInput.value.trim() !== caseNo) return; // 查詢回來前使用者又改了案號，這筆結果已經過時
        if(data.alias){
          const aliasEl = document.getElementById(aliasId);
          if(aliasEl) aliasEl.value = data.alias;
        }
        if(data.sales_person){
          const assigneeEl = document.getElementById(assigneeId);
          if(assigneeEl){ assigneeEl.value = canonRep(data.sales_person); updateAssigneeBindLine(); }
        }
        if(data.vendor && vendorId){
          const vendorEl = document.getElementById(vendorId);
          if(vendorEl && [...vendorEl.options].some(o => o.value === data.vendor)){
            vendorEl.value = data.vendor;
            vendorEl.dispatchEvent(new Event('change'));
          }
        }
      }catch(err){ /* 查詢失敗就安靜放棄，不影響手動輸入 */ }
    }, 500);
  });
}
wireSlotCaseAutofill('slotTaskCase', 'slotTaskAlias', 'slotTaskAssignee', 'slotTaskVendor');
wireSlotCaseAutofill('slotBookingCase', 'slotBookingAlias', 'slotBookingRegistrant', 'slotBookingVendor');

// 2026-10-01 新增：案號改成可以打部分關鍵字模糊搜尋（跟「電話紀錄」筆記本
// 的案場模糊搜尋共用同一個 /api/case-search 後端），不用把完整案號一字
// 不差打完才能觸發上面 wireSlotCaseAutofill 的完全符合查詢。輸入框下方
// 跳出候選清單，點一個之後把案號/別名/廠商直接帶過去；case-search 本身
// 沒有業務資料，選定後再用 record_id 精準查一次 /api/case-lookup 補業務
// 姓名（record_id 比案號文字查詢快也準，跟「電話紀錄」選候選案件後的查法
// 一樣）。
function wireSlotCaseSearch(caseId, resultsId, aliasId, assigneeId, vendorId, ownerNameId, ownerPhoneId){
  const caseInput = document.getElementById(caseId);
  const resultsBox = document.getElementById(resultsId);
  if(!caseInput || !resultsBox) return;
  let timer = null;
  caseInput.addEventListener('input', () => {
    clearTimeout(timer);
    const q = caseInput.value.trim();
    if(!q){ resultsBox.classList.remove('show'); resultsBox.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      try{
        // include_certified=1：額外把業務自治區「已公證」但還沒建進 Airtable
        // 的案件也混進來（只有這裡帶，電話紀錄筆記本／案件進場安排手動新增
        // 都不帶，維持原本只查 Airtable 的行為）。
        const res = await fetch(API_BASE + '/api/case-search?include_certified=1&q=' + encodeURIComponent(q), {cache: 'no-store'});
        const data = await res.json().catch(() => ({}));
        if(caseInput.value.trim() !== q) return; // 使用者又改了關鍵字，這批結果已經過時
        const results = data.results || [];
        resultsBox.innerHTML = results.length === 0
          ? '<div class="qm-empty">查無符合的案件，可以直接手動填寫</div>'
          : results.map(r => `
              <div class="qm-result" onclick='selectSlotCaseCandidate(${JSON.stringify(r).replace(/'/g, "&apos;")}, "${caseId}", "${resultsId}", "${aliasId}", "${assigneeId}", "${vendorId}", "${ownerNameId||''}", "${ownerPhoneId||''}")'>
                <div>
                  <div class="qm-result-name">${r.case || ''}${r.alias ? '　' + r.alias : ''}${r.not_in_airtable ? '　<span style="color:var(--text-muted);font-weight:400;">（尚未建檔）</span>' : ''}</div>
                  <div class="qm-result-addr">${r.vendor || ''}　${r.address || ''}</div>
                </div>
              </div>`).join('');
        resultsBox.classList.add('show');
      }catch(err){ /* 查詢失敗就安靜放棄，不影響手動輸入 */ }
    }, 300);
  });
  document.addEventListener('click', (e) => {
    if(e.target !== caseInput && !resultsBox.contains(e.target)) resultsBox.classList.remove('show');
  });
}
async function selectSlotCaseCandidate(r, caseId, resultsId, aliasId, assigneeId, vendorId, ownerNameId, ownerPhoneId){
  document.getElementById(caseId).value = r.case || '';
  const resultsBox = document.getElementById(resultsId);
  if(resultsBox){ resultsBox.classList.remove('show'); resultsBox.innerHTML = ''; }
  if(r.alias){
    const aliasEl = document.getElementById(aliasId);
    if(aliasEl) aliasEl.value = r.alias;
  }
  if(r.vendor){
    const vendorEl = document.getElementById(vendorId);
    if(vendorEl && [...vendorEl.options].some(o => o.value === r.vendor)){
      vendorEl.value = r.vendor;
      vendorEl.dispatchEvent(new Event('change'));
    }
  }
  if(r.record_id){
    try{
      const res = await fetch(API_BASE + '/api/case-lookup?case_record_id=' + encodeURIComponent(r.record_id), {cache: 'no-store'});
      const data = await res.json().catch(() => ({}));
      if(data.found && data.sales_person){
        const assigneeEl = document.getElementById(assigneeId);
        if(assigneeEl){ assigneeEl.value = canonRep(data.sales_person); updateAssigneeBindLine(); }
      }
    }catch(err){ /* 查詢失敗就放棄，不影響已經帶好的案號/別名/廠商 */ }
  } else if(r.sales_person){
    // not_in_airtable 的案件沒有 record_id 可以查，業務姓名是搜尋結果裡
    // 直接帶來的（業務自治區 U 欄），不用再另外查一次。
    const assigneeEl = document.getElementById(assigneeId);
    if(assigneeEl){ assigneeEl.value = canonRep(r.sales_person); updateAssigneeBindLine(); }
  }
  // 2026-10-01 新增：屋主聯絡資訊（姓名/電話，來源是業務自治區 K 欄連結的
  // 租賃合約書，見 OWNER_CONTACT_CACHE）只有「指派給業務」modal 會傳
  // ownerNameId/ownerPhoneId（「預約時段」modal 沒有這兩個欄位，不會傳，
  // 這裡就直接跳過）。查到的值先存進這兩個隱藏欄位，建立任務時會一起送出
  // 當作 book.html「同公證書資訊」勾選後的預設值。
  if(ownerNameId && r.case){
    try{
      const res = await fetch(API_BASE + '/api/owner-contact?case=' + encodeURIComponent(r.case), {cache: 'no-store'});
      const data = await res.json().catch(() => ({}));
      const nameEl = document.getElementById(ownerNameId);
      const phoneEl = document.getElementById(ownerPhoneId);
      if(nameEl) nameEl.value = data.found ? (data.name || '') : '';
      if(phoneEl) phoneEl.value = data.found ? (data.phone || '') : '';
      const infoBox = document.getElementById('slotTaskOwnerInfo');
      if(infoBox){
        const hasInfo = data.found && (data.name || data.phone);
        infoBox.style.display = hasInfo ? 'block' : 'none';
        if(hasInfo) document.getElementById('slotTaskOwnerInfoText').textContent = [data.name, data.phone].filter(Boolean).join('　');
      }
    }catch(err){ /* 查詢失敗就放棄，屋主聯絡資訊留空，業務在 book.html 手動填 */ }
  }
}
wireSlotCaseSearch('slotTaskCase', 'slotTaskCaseResults', 'slotTaskAlias', 'slotTaskAssignee', 'slotTaskVendor', 'slotTaskOwnerName', 'slotTaskOwnerPhone');
wireSlotCaseSearch('slotBookingCase', 'slotBookingCaseResults', 'slotBookingAlias', 'slotBookingRegistrant', 'slotBookingVendor');

// ---- 預約時段 modal ----
function openSlotBookingModal(){
  const sel = document.getElementById('slotBookingVendor');
  // 2026-10-01 拿掉「開放時段」概念後，廠商選單直接列出全部廠商，日期改用
  // 自由選的 <input type="date">，選好廠商/日期才會顯示當天已卡的時段。
  sel.innerHTML = ALL_VENDOR_NAMES.map(v => `<option value="${v}">${v}</option>`).join('');
  document.getElementById('slotBookingStart').innerHTML = slotTimeOptionsHtml();
  document.getElementById('slotBookingEnd').innerHTML = slotTimeOptionsHtml();
  document.getElementById('slotBookingDate').value = '';
  document.getElementById('slotBookingStart').value = '';
  document.getElementById('slotBookingEnd').value = '';
  document.getElementById('slotBookingCase').value = '';
  document.getElementById('slotBookingAlias').value = '';
  document.getElementById('slotBookingRegistrant').value = '';
  document.getElementById('slotBookingNote').value = '';
  document.getElementById('slotBookingCaseResults').classList.remove('show');
  document.getElementById('slotBookingTypeDropdown').classList.remove('show');
  document.querySelectorAll('.slot-booking-type-check').forEach(c => { c.checked = false; });
  updateSlotTypeLabel('slot-booking-type-check', 'slotBookingTypeLabel');
  applySlotBookingTimeDefault();
  document.getElementById('slotBookingError').style.display = 'none';
  renderSlotBookingDayPreview();
  document.getElementById('slotBookingModalOverlay').classList.add('show');
}
function closeSlotBookingModal(){
  document.getElementById('slotBookingModalOverlay').classList.remove('show');
}
function renderSlotBookingDayPreview(){
  const vendor = document.getElementById('slotBookingVendor').value;
  const date = document.getElementById('slotBookingDate').value;
  const preview = document.getElementById('slotBookingDayPreview');
  if(!preview) return;
  if(!vendor || !date){ preview.innerHTML = ''; return; }
  const bookings = SLOT_BOOKINGS.filter(b=>b.vendor===vendor && b.date===date).sort((a,b)=>(a.start_time||'').localeCompare(b.start_time||''));
  if(bookings.length === 0){
    preview.innerHTML = '這天目前還沒有任何預約，整天都空著。';
  } else {
    preview.innerHTML = '這天已經有：' + bookings.map(b => `<b>${b.start_time}-${b.end_time}</b>（${(b.type||[]).join('+')}·${b.case}）`).join('、');
  }
}
async function confirmSlotBooking(){
  const vendor = document.getElementById('slotBookingVendor').value;
  const date = document.getElementById('slotBookingDate').value;
  const start_time = document.getElementById('slotBookingStart').value;
  const end_time = document.getElementById('slotBookingEnd').value;
  const type = getCheckedSlotTypes('slot-booking-type-check');
  const registrant = document.getElementById('slotBookingRegistrant').value.trim();
  const caseNo = document.getElementById('slotBookingCase').value.trim();
  const alias = document.getElementById('slotBookingAlias').value.trim();
  const note = document.getElementById('slotBookingNote').value.trim();
  const errBox = document.getElementById('slotBookingError');
  errBox.style.display = 'none';
  if(!vendor || !date || !start_time || !end_time || !caseNo || !registrant || type.length === 0){
    showToast('請把廠商/日期/時間/項目類型/案號/登記人都填好');
    return;
  }
  const btn = document.querySelector('#slotBookingModalOverlay .btn-primary');
  const originalText = btn.textContent;
  btn.textContent = '儲存中…'; btn.disabled = true;
  try{
    const res = await fetch(API_BASE + '/api/vendor-slots/bookings', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({vendor, date, start_time, end_time, type, registrant, case: caseNo, alias, note}),
    });
    const data = await res.json().catch(()=>({}));
    if(res.status === 409){
      const c = data.conflict || {};
      errBox.innerHTML = `⚠️ 這個時段已經被佔用了：<b>${c.start_time}-${c.end_time}</b>　${(c.type||[]).join('+')}｜${c.case||''}${c.alias?('（'+c.alias+'）'):''}　登記人：${c.registrant||''}`;
      errBox.style.display = 'block';
      return;
    }
    if(!res.ok) throw new Error(data.error || ('HTTP '+res.status));
    closeSlotBookingModal();
    showToast('已預約成功');
    loadVendorSlots();
  }catch(err){
    showToast('儲存失敗：' + err.message);
  }finally{
    btn.textContent = originalText; btn.disabled = false;
  }
}

