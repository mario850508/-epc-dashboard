// 聯合排程（2026-10-12）：把同廠商、同項目的幾個案件綁在一起，約同一天做完。
// 流程：新增聯合排程（案件＋第一／第二期望日與時段）→ 把邀請傳給各屋主 → 屋主回覆方便的時段 →
// 全部回覆後機器人通知 → 這裡看自動排好的行程、調整、確認 → 機器人把確認卡給安排人員，再傳給屋主 →
// 屋主在卡片按「確認時間沒問題」才成立預約。後端：/api/joint-schedules（app.py 的「聯合排程」區塊）。
let JOINT_LIST = [];
let JOINT_CUR = null;        // 目前開著的詳細視窗資料
let JOINT_EDIT = {};         // {task_id: {start, end}}
let JOINT_DATE = '';
let JOINT_FORM = null;       // 新增視窗的狀態

function jtTimeOpts(sel){
  let h = '<option value="">—</option>';
  for(let m = 7 * 60; m <= 20 * 60; m += 30){
    const t = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    h += `<option value="${t}" ${sel === t ? 'selected' : ''}>${t}</option>`;
  }
  return h;
}
function jtMin(t){ const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + m; }
function jtFmt(m){ return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
function jtStatusChip(s){
  const c = {'收集中': '#2563EB', '待排程': '#D97706', '待屋主確認': '#7C3AED', '已完成': '#16A34A', '已取消': '#6B7280'}[s] || '#6B7280';
  return `<span style="background:${c}1A;color:${c};font-size:11.5px;font-weight:700;padding:2px 9px;border-radius:10px;">${escHtml(s)}</span>`;
}

// ---------- 清單 ----------
async function loadJoint(){
  try{
    const res = await fetch(API_BASE + '/api/joint-schedules', {cache: 'no-store'});
    const d = await res.json();
    if(!res.ok) throw new Error(d.error || ('HTTP ' + res.status));
    JOINT_LIST = d.groups || [];
    renderJointList();
  }catch(err){
    const c = document.getElementById('jointContainer');
    if(c && !JOINT_LIST.length) c.innerHTML = '<div class="login-note">載入失敗：' + escHtml(err.message) + '</div>';
  }
}
function renderJointList(){
  const tab = document.querySelector('#view-slots .tab[data-slots-tab="joint"]');
  const need = JOINT_LIST.filter(g => g.status === '待排程').length;
  if(tab) tab.textContent = '🧩 聯合排程' + (need ? '　🔴 ' + need + ' 待排程' : '');
  const c = document.getElementById('jointContainer');
  if(!c) return;
  const rows = JOINT_LIST.map(g => `
    <div style="display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;">
      <div style="flex:1;min-width:220px;">
        <div style="font-weight:700;font-size:13.5px;">${escHtml(g.title)} ${jtStatusChip(g.status)}</div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:3px;">${(g.cases || []).map(escHtml).join('、')}</div>
        <div style="font-size:11.5px;color:var(--text-muted);">期望日：${(g.prefs || []).map(p => fmtDate(p.date) + '（' + fmtWeekday(p.date) + '）').join('、')}｜回覆 ${g.counts.replied}/${g.counts.total}｜確認 ${g.counts.confirmed}/${g.counts.total}</div>
      </div>
      <button class="btn btn-warm-primary" style="padding:6px 14px;font-size:12px;" onclick="openJointDetail('${g.id}')">開啟</button>
    </div>`).join('');
  c.innerHTML = `<div class="panel" style="margin-bottom:16px;">
    <div class="panel-title">🧩 聯合排程（幾個案件約同一天做完）
      <div class="panel-title-actions"><button class="btn btn-primary" style="padding:6px 14px;font-size:12px;" onclick="openJointCreate()">＋ 新增聯合排程</button></div></div>
    ${rows || '<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">目前沒有聯合排程。例如廠商一次要做宜蘭三個案子的放樣，想讓他們同一天跑完，就在這裡把三案綁在一起。</div>'}
  </div>`;
}

// ---------- 新增 ----------
function jtOverlay(id, width){
  const old = document.getElementById(id); if(old) old.remove();
  const ov = document.createElement('div');
  ov.id = id;
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
  ov.onclick = e => { if(e.target === ov) ov.remove(); };
  ov.innerHTML = `<div style="background:#fff;border-radius:16px;padding:22px;max-width:${width}px;width:100%;color:#1B2333;max-height:92vh;overflow-y:auto;"></div>`;
  document.body.appendChild(ov);
  return ov.firstElementChild;
}
function openJointCreate(){
  let saved = [];
  try{ saved = splitNames(localStorage.getItem('slotSchedulerNames') || ''); }catch(e){}
  const tmr = new Date(Date.now() + 86400000);
  JOINT_FORM = {
    vendor: '三創', types: ['放樣'], cases: [], q: '', results: [],
    prefs: [{date: '', w1: ['09:00', '12:00'], w2on: true, w2: ['13:00', '17:00']}],
    dur: 60, gap: 30, creators: saved.length ? saved : [],
    dlDate: tmr.getFullYear() + '-' + String(tmr.getMonth() + 1).padStart(2, '0') + '-' + String(tmr.getDate()).padStart(2, '0'), dlTime: '18:00',
  };
  renderJointCreate();
  if(typeof loadSlotSchedulers === 'function') loadSlotSchedulers().then(() => { if(document.getElementById('jointCreateOverlay')) renderJointCreate(); });
}
function jtDefaultDur(types){
  const m = {'掛表': 180, '植筋': 180, '放樣': 60, '場勘': 60, '進場': 240};
  return types.reduce((s, t) => s + (m[t] || 0), 0) || 60;
}
function renderJointCreate(){
  const F = JOINT_FORM;
  const box = jtOverlay('jointCreateOverlay', 560);
  const lab = t => `<div style="font-size:12px;font-weight:700;margin:14px 0 6px;">${t}</div>`;
  const prefRow = (p, i) => `
    <div style="border:1px solid var(--border);border-radius:12px;padding:10px 12px;margin-bottom:8px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <b style="font-size:12.5px;">${['第一', '第二', '第三', '第四'][i]}期望日</b>
        <input type="date" class="quick-mark-input" style="flex:1;" value="${p.date}" onchange="JOINT_FORM.prefs[${i}].date=this.value">
        ${i > 0 ? `<button class="btn btn-ghost" style="padding:4px 9px;" onclick="JOINT_FORM.prefs.splice(${i},1);renderJointCreate()">✕</button>` : ''}
      </div>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
        <span style="font-size:11.5px;color:var(--text-muted);width:62px;">廠商時段</span>
        <select class="quick-mark-input" style="flex:1;" onchange="JOINT_FORM.prefs[${i}].w1[0]=this.value">${jtTimeOpts(p.w1[0])}</select>到
        <select class="quick-mark-input" style="flex:1;" onchange="JOINT_FORM.prefs[${i}].w1[1]=this.value">${jtTimeOpts(p.w1[1])}</select>
      </div>
      <label style="display:flex;gap:6px;align-items:center;font-size:12px;cursor:pointer;margin-bottom:6px;"><input type="checkbox" ${p.w2on ? 'checked' : ''} onchange="JOINT_FORM.prefs[${i}].w2on=this.checked;renderJointCreate()"> 加第二個時段（中間是午休，屋主不能選）</label>
      ${p.w2on ? `<div style="display:flex;gap:6px;align-items:center;">
        <span style="font-size:11.5px;color:var(--text-muted);width:62px;">下午</span>
        <select class="quick-mark-input" style="flex:1;" onchange="JOINT_FORM.prefs[${i}].w2[0]=this.value">${jtTimeOpts(p.w2[0])}</select>到
        <select class="quick-mark-input" style="flex:1;" onchange="JOINT_FORM.prefs[${i}].w2[1]=this.value">${jtTimeOpts(p.w2[1])}</select></div>` : ''}
    </div>`;
  box.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;"><div style="font-size:17px;font-weight:800;">🧩 新增聯合排程</div>
      <button type="button" onclick="document.getElementById('jointCreateOverlay').remove()" style="border:none;background:#F1F3F8;border-radius:50%;width:30px;height:30px;cursor:pointer;">✕</button></div>
    <div style="font-size:12px;color:var(--text-muted);margin:6px 0 0;line-height:1.7;">把同一廠商、同一項目的幾個案件綁在一起：屋主先回覆哪個時段方便，你再統一排出每案的時間，讓廠商一天跑完。</div>
    ${lab('廠商')}
    <select class="quick-mark-input" onchange="JOINT_FORM.vendor=this.value">${ALL_VENDOR_NAMES.map(v => `<option ${v === F.vendor ? 'selected' : ''}>${v}</option>`).join('')}</select>
    ${lab('項目')}
    <div style="display:flex;gap:14px;flex-wrap:wrap;">${['放樣', '場勘', '掛表', '植筋', '進場'].map(t => `<label style="display:flex;gap:5px;align-items:center;font-size:13px;cursor:pointer;"><input type="checkbox" ${F.types.includes(t) ? 'checked' : ''} onchange="jtToggleType('${t}',this.checked)">${t}</label>`).join('')}</div>
    ${lab('案件（至少兩個；打案號或關鍵字搜尋）')}
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">${F.cases.map((c, i) => `<span style="background:#EEF3FF;border-radius:12px;padding:3px 10px;font-size:12px;">${escHtml(c)} <a style="cursor:pointer;color:#B42318;" onclick="JOINT_FORM.cases.splice(${i},1);renderJointCreate()">✕</a></span>`).join('') || '<span style="font-size:12px;color:var(--text-muted);">還沒選案件</span>'}</div>
    <input class="quick-mark-input" id="jtCaseQ" placeholder="輸入案號或別名…" value="${escHtml(F.q)}" oninput="jtSearchCase(this.value)" autocomplete="off">
    <div id="jtCaseRes">${jtResultsHtml()}</div>
    ${lab('期望日與廠商可作業時段（第一期望優先，屋主都不行才看第二期望）')}
    ${F.prefs.map(prefRow).join('')}
    ${F.prefs.length < 4 ? '<button class="btn btn-ghost" style="padding:5px 12px;font-size:12px;" onclick="JOINT_FORM.prefs.push({date:\'\',w1:[\'09:00\',\'12:00\'],w2on:true,w2:[\'13:00\',\'17:00\']});renderJointCreate()">＋ 再加一個期望日</button>' : ''}
    ${lab('每案預計作業時間／案件之間的緩衝')}
    <div style="display:flex;gap:8px;align-items:center;">
      <input type="number" class="quick-mark-input" style="flex:1;" min="15" step="15" value="${F.dur}" onchange="JOINT_FORM.dur=parseInt(this.value,10)||60"><span style="font-size:12px;">分鐘／案</span>
      <input type="number" class="quick-mark-input" style="flex:1;" min="0" step="15" value="${F.gap}" onchange="JOINT_FORM.gap=parseInt(this.value,10)||0"><span style="font-size:12px;">分鐘緩衝</span>
    </div>
    ${lab('請屋主在這個時間前回覆（日期留空＝不設期限）')}
    <div style="display:flex;gap:8px;"><input type="date" class="quick-mark-input" style="flex:1.3;" value="${F.dlDate}" onchange="JOINT_FORM.dlDate=this.value"><select class="quick-mark-input" style="flex:1;" onchange="JOINT_FORM.dlTime=this.value">${jtTimeOpts(F.dlTime)}</select></div>
    ${lab('安排人員（屋主回覆、確認時，LINE 通知這些同仁）')}
    <div style="display:flex;flex-wrap:wrap;gap:8px 16px;">${(typeof SLOT_SCHEDULERS !== 'undefined' ? SLOT_SCHEDULERS : []).map(n => `<label style="display:flex;gap:5px;align-items:center;font-size:13px;cursor:pointer;"><input type="checkbox" ${F.creators.includes(n) ? 'checked' : ''} onchange="jtToggleCreator('${escHtml(n)}',this.checked)">${escHtml(n)}</label>`).join('') || '<span style="font-size:12px;color:var(--text-muted);">名單載入中…</span>'}</div>
    <button type="button" class="btn btn-primary" id="jtCreateBtn" style="width:100%;justify-content:center;padding:11px;margin-top:18px;" onclick="submitJointCreate()">建立聯合排程</button>`;
}
function jtToggleType(t, on){
  const F = JOINT_FORM;
  F.types = on ? [...new Set([...F.types, t])] : F.types.filter(x => x !== t);
  F.dur = jtDefaultDur(F.types);
  renderJointCreate();
}
function jtToggleCreator(n, on){
  const F = JOINT_FORM;
  F.creators = on ? [...new Set([...F.creators, n])] : F.creators.filter(x => x !== n);
}
function jtResultsHtml(){
  const F = JOINT_FORM;
  if(!F.results.length) return '';
  return '<div style="border:1px solid var(--border);border-radius:10px;margin-top:4px;max-height:170px;overflow-y:auto;">' + F.results.map((r, i) =>
    `<div style="padding:7px 10px;font-size:12.5px;cursor:pointer;border-bottom:1px solid var(--border);" onclick="jtAddCase(${i})"><b>${escHtml(r.case)}</b> ${escHtml(r.alias || '')} <span style="color:var(--text-muted);">${escHtml(r.vendor || '')}</span></div>`).join('') + '</div>';
}
let jtSearchTimer = null;
function jtSearchCase(q){
  JOINT_FORM.q = q;
  clearTimeout(jtSearchTimer);
  if(!q.trim()){ JOINT_FORM.results = []; document.getElementById('jtCaseRes').innerHTML = ''; return; }
  jtSearchTimer = setTimeout(async () => {
    try{
      const res = await fetch(API_BASE + '/api/case-search?include_certified=1&q=' + encodeURIComponent(q.trim()), {cache: 'no-store'});
      const d = await res.json();
      JOINT_FORM.results = d.results || [];
      const el = document.getElementById('jtCaseRes'); if(el) el.innerHTML = jtResultsHtml();
    }catch(e){}
  }, 350);
}
function jtAddCase(i){
  const r = JOINT_FORM.results[i]; if(!r) return;
  if(!JOINT_FORM.cases.includes(r.case)) JOINT_FORM.cases.push(r.case);
  JOINT_FORM.q = ''; JOINT_FORM.results = [];
  renderJointCreate();
}
async function submitJointCreate(){
  const F = JOINT_FORM;
  const prefs = [];
  for(const p of F.prefs){
    if(!p.date) continue;
    const wins = [[p.w1[0], p.w1[1]]];
    if(p.w2on) wins.push([p.w2[0], p.w2[1]]);
    if(wins.some(w => !w[0] || !w[1] || w[0] >= w[1])){ showToast('時段的開始時間要早於結束時間'); return; }
    if(p.w2on && wins[1][0] < wins[0][1]){ showToast('第二個時段要從第一個時段結束之後開始'); return; }
    prefs.push({date: p.date, windows: wins});
  }
  if(!F.types.length || F.cases.length < 2 || !prefs.length){ showToast('請選項目、至少兩個案件，並設定第一期望日'); return; }
  const btn = document.getElementById('jtCreateBtn');
  btn.disabled = true; btn.textContent = '建立中…';
  try{
    const res = await fetch(API_BASE + '/api/joint-schedules', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({
      vendor: F.vendor, type: F.types, cases: F.cases, prefs, duration_min: F.dur, gap_min: F.gap, creator: F.creators.join('、'),
      deadline: F.dlDate ? F.dlDate + 'T' + (F.dlTime || '18:00') + ':00+08:00' : null})});
    const d = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(d.error || ('HTTP ' + res.status));
    try{ localStorage.setItem('slotSchedulerNames', F.creators.join('、')); }catch(e){}
    document.getElementById('jointCreateOverlay').remove();
    if(d.failed && d.failed.length) showToast('這些案件建立失敗：' + d.failed.join('、'));
    loadJoint();
    JOINT_CUR = d.joint; JOINT_EDIT = {}; JOINT_DATE = '';
    renderJointDetail();
  }catch(err){
    showToast('建立失敗：' + err.message);
    btn.disabled = false; btn.textContent = '建立聯合排程';
  }
}

// ---------- 詳細／排程 ----------
async function openJointDetail(id, date){
  const box = jtOverlay('jointDetailOverlay', 820);
  box.innerHTML = '載入中…';
  try{
    const res = await fetch(API_BASE + '/api/joint-schedules/' + encodeURIComponent(id) + (date ? '?date=' + encodeURIComponent(date) : ''), {cache: 'no-store'});
    const d = await res.json();
    if(!res.ok) throw new Error(d.error || ('HTTP ' + res.status));
    JOINT_CUR = d; JOINT_EDIT = {}; JOINT_DATE = date || '';
    renderJointDetail();
  }catch(err){
    box.innerHTML = '<div style="color:#B42318;">載入失敗：' + escHtml(err.message) + '</div>';
  }
}
function renderJointDetail(){
  const g = JOINT_CUR;
  if(!g) return;
  const box = jtOverlay('jointDetailOverlay', 820);
  const editable = ['收集中', '待排程', '待屋主確認'].includes(g.status);
  const sg = g.suggest;
  const plan = sg && sg.plan;
  if(!Object.keys(JOINT_EDIT).length){
    if(!JOINT_DATE && g.plan && g.status === '待屋主確認'){   // 已確認過的行程：先帶出來，可再調整
      g.plan.items.forEach(it => { JOINT_EDIT[it.task_id] = {start: it.start, end: it.end}; });
      JOINT_DATE = g.plan.date;
    }else if(plan){
      plan.items.forEach(it => { JOINT_EDIT[it.task_id] = {start: it.start, end: it.end}; });
      JOINT_DATE = plan.date;
    }
  }
  const memberRows = g.tasks.map(t => `
    <tr>
      <td style="padding:8px 6px;font-size:12.5px;"><b>${escHtml(t.case)}</b><div style="color:var(--text-muted);font-size:11.5px;">${escHtml(t.alias || '')}${t.assignee ? '｜業務 ' + escHtml(t.assignee) : ''}</div></td>
      <td style="padding:8px 6px;font-size:12px;">${escHtml(t.status_text)}${t.chosen_slot ? '<div style="color:#7C3AED;">' + fmtDate(t.chosen_slot.date) + ' ' + escHtml(t.chosen_slot.start_time) + '–' + escHtml(t.chosen_slot.end_time) + '</div>' : ''}</td>
      <td style="padding:8px 6px;font-size:12px;color:#374151;">${escHtml(t.reply_text)}${t.alt_slots && t.alt_slots.length ? '<div style="color:#B45309;">屋主另提：' + t.alt_slots.map(s => fmtDate(s.date)).join('、') + '</div>' : ''}</td>
      <td style="padding:8px 6px;font-size:11.5px;white-space:nowrap;">
        ${!t.done && !t.chosen_slot && t.invite_share_url ? `<a href="${t.invite_share_url}" target="_blank" rel="noopener" style="color:#2563EB;">📤 傳邀請給屋主</a><br>` : ''}
        ${!t.done && t.chosen_slot && t.confirm_share_url ? `<a href="${t.confirm_share_url}" target="_blank" rel="noopener" style="color:#16A34A;font-weight:700;">📤 傳確認卡給屋主</a><br>` : ''}
        <a style="cursor:pointer;color:#6B7280;" onclick="copyVnText(${JSON.stringify(t.invite_text).replace(/"/g, '&quot;')}, '已複製邀請訊息')">📋 複製邀請訊息</a><br>
        <a style="cursor:pointer;color:#6B7280;" onclick="copyVnText('${t.owner_link}', '已複製屋主頁連結')">🔗 複製屋主頁連結</a>
      </td>
    </tr>`).join('');
  let editor = '';
  if(editable && sg && plan){
    const cands = sg.candidates || [];
    const dur = g.duration_min;
    editor = `
      <div style="font-size:14px;font-weight:800;margin:20px 0 6px;">🗓️ 排程</div>
      <div style="font-size:12px;color:var(--text-muted);line-height:1.7;margin-bottom:8px;">系統依屋主回覆先排好一版（每案 ${dur} 分鐘、案件間隔 ${g.gap_min} 分鐘），可以直接改時間。確認後，機器人會把「確認卡」傳給安排人員，再轉給屋主；屋主按「確認時間沒問題」才算預約成功。</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
        <span style="font-size:12.5px;font-weight:700;">排在哪一天</span>
        <select class="quick-mark-input" style="width:auto;min-width:230px;" onchange="openJointDetail('${g.id}', this.value)">
          ${cands.map(c => `<option value="${c.date}" ${c.date === JOINT_DATE ? 'selected' : ''}>${fmtDate(c.date)}（${fmtWeekday(c.date)}）— ${c.placed}/${c.total} 案可排</option>`).join('')}
        </select>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="font-size:11.5px;color:var(--text-muted);text-align:left;"><th style="padding:4px 6px;">案件</th><th style="padding:4px 6px;">屋主方便</th><th style="padding:4px 6px;">開始</th><th style="padding:4px 6px;">結束</th></tr></thead>
        <tbody>${g.tasks.filter(t => !t.done).map(t => {
          const e = JOINT_EDIT[t.task_id] || {start: '', end: ''};
          const un = (plan.unplaced || []).find(u => u.task_id === t.task_id);
          return `<tr style="border-top:1px solid var(--border);">
            <td style="padding:7px 6px;font-size:12.5px;"><b>${escHtml(t.case)}</b> ${escHtml(t.alias || '')}${un && !e.start ? `<div style="color:#B42318;font-size:11.5px;">⚠ ${escHtml(un.reason)}，需要另約或手動指定</div>` : ''}</td>
            <td style="padding:7px 6px;font-size:11.5px;color:#374151;">${escHtml(t.reply_text)}</td>
            <td style="padding:7px 6px;"><select class="quick-mark-input" data-tid="${t.task_id}" data-k="start" onchange="jtEditTime(this)">${jtTimeOpts(e.start)}</select></td>
            <td style="padding:7px 6px;"><select class="quick-mark-input" data-tid="${t.task_id}" data-k="end" onchange="jtEditTime(this)">${jtTimeOpts(e.end)}</select></td>
          </tr>`; }).join('')}</tbody>
      </table>
      <div id="jtPlanWarn" style="font-size:12px;color:#B42318;margin-top:6px;"></div>
      <button type="button" class="btn btn-primary" id="jtConfirmBtn" style="width:100%;justify-content:center;padding:11px;margin-top:12px;" onclick="confirmJointPlan()">✅ 確認行程，產生給屋主的確認卡</button>`;
  }
  box.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;"><div style="font-size:17px;font-weight:800;">🧩 ${escHtml(g.title)} ${jtStatusChip(g.status)}</div>
      <button type="button" onclick="document.getElementById('jointDetailOverlay').remove()" style="border:none;background:#F1F3F8;border-radius:50%;width:30px;height:30px;cursor:pointer;">✕</button></div>
    <div style="font-size:12px;color:var(--text-muted);margin:6px 0 10px;line-height:1.7;">期望日：${g.prefs.map((p, i) => ['第一', '第二', '第三', '第四'][i] + ' ' + fmtDate(p.date) + '（' + fmtWeekday(p.date) + '）' + p.windows.map(w => w[0] + '–' + w[1]).join('、')).join('｜')}｜回覆 ${g.counts.replied}/${g.counts.total}｜確認 ${g.counts.confirmed}/${g.counts.total}</div>
    <table style="width:100%;border-collapse:collapse;"><thead><tr style="font-size:11.5px;color:var(--text-muted);text-align:left;"><th style="padding:4px 6px;">案件</th><th style="padding:4px 6px;">狀態</th><th style="padding:4px 6px;">屋主回覆</th><th style="padding:4px 6px;"></th></tr></thead>
      <tbody>${memberRows}</tbody></table>
    ${editor}
    ${editable ? `<button type="button" class="btn btn-ghost" style="margin-top:14px;padding:6px 12px;font-size:12px;color:#B42318;" onclick="cancelJoint('${g.id}')">取消這個聯合排程</button>` : ''}`;
  jtCheckPlan();
}
function jtEditTime(sel){
  const tid = sel.dataset.tid, k = sel.dataset.k;
  const e = JOINT_EDIT[tid] = JOINT_EDIT[tid] || {start: '', end: ''};
  e[k] = sel.value;
  if(k === 'start' && sel.value){   // 改開始時間：結束時間依每案時長自動帶
    e.end = jtFmt(jtMin(sel.value) + JOINT_CUR.duration_min);
    const endSel = document.querySelector(`select[data-tid="${tid}"][data-k="end"]`);
    if(endSel) endSel.innerHTML = jtTimeOpts(e.end);
  }
  jtCheckPlan();
}
function jtCheckPlan(){
  const w = document.getElementById('jtPlanWarn');
  if(!w || !JOINT_CUR) return;
  const items = JOINT_CUR.tasks.filter(t => !t.done && JOINT_EDIT[t.task_id] && JOINT_EDIT[t.task_id].start && JOINT_EDIT[t.task_id].end)
    .map(t => ({case: t.case, s: jtMin(JOINT_EDIT[t.task_id].start), e: jtMin(JOINT_EDIT[t.task_id].end)})).sort((a, b) => a.s - b.s);
  const msgs = [];
  items.forEach((it, i) => {
    if(it.e <= it.s) msgs.push(`${it.case} 的結束時間要晚於開始時間`);
    if(i < items.length - 1 && it.e > items[i + 1].s) msgs.push(`${it.case} 和 ${items[i + 1].case} 的時間重疊`);
  });
  w.textContent = msgs.length ? '⚠ ' + msgs.join('；') : '';
}
async function confirmJointPlan(){
  const g = JOINT_CUR;
  const items = g.tasks.filter(t => !t.done).map(t => ({task_id: t.task_id, start: (JOINT_EDIT[t.task_id] || {}).start, end: (JOINT_EDIT[t.task_id] || {}).end})).filter(i => i.start && i.end);
  if(!items.length){ showToast('請至少排好一個案件的時間'); return; }
  const missing = g.tasks.filter(t => !t.done && !(JOINT_EDIT[t.task_id] || {}).start).map(t => t.case);
  if(missing.length && !confirm('這些案件還沒排時間：' + missing.join('、') + '\n要先確認其他案件嗎？（沒排的之後要另外處理）')) return;
  const btn = document.getElementById('jtConfirmBtn');
  btn.disabled = true; btn.textContent = '處理中…';
  try{
    const res = await fetch(API_BASE + '/api/joint-schedules/' + encodeURIComponent(g.id) + '/confirm', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({date: JOINT_DATE, items})});
    const d = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(d.error || ('HTTP ' + res.status));
    showToast('已確認行程，確認卡已用機器人傳給安排人員');
    loadJoint();
    JOINT_CUR = d.joint; JOINT_EDIT = {};
    renderJointDetail();
  }catch(err){
    showToast('確認失敗：' + err.message);
    btn.disabled = false; btn.textContent = '✅ 確認行程，產生給屋主的確認卡';
  }
}
async function cancelJoint(id){
  if(!confirm('確定取消這個聯合排程？（還沒確認的案件任務會一起取消，屋主連結失效）')) return;
  try{
    const res = await fetch(API_BASE + '/api/joint-schedules/' + encodeURIComponent(id) + '/cancel', {method: 'POST'});
    if(!res.ok) throw new Error('HTTP ' + res.status);
    document.getElementById('jointDetailOverlay').remove();
    loadJoint();
    showToast('已取消');
  }catch(err){ showToast('取消失敗：' + err.message); }
}

// 機器人卡片的「開啟排程」連結：主控台網址 #joint=<id>
function jtOpenFromHash(){
  const m = /#joint=([A-Za-z0-9]+)/.exec(location.hash || '');
  if(!m) return;
  try{ showView('slots'); showSlotsTab('joint'); }catch(e){}
  openJointDetail(m[1]);
  history.replaceState(null, '', location.pathname + location.search);
}
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => { loadJoint(); jtOpenFromHash(); }, 800);
  setInterval(loadJoint, 90000);
});
