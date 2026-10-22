// 聯合排程（2026-10-12）：把同廠商、同項目的幾個案件綁在一起，約同一天做完。
// 流程：新增聯合排程（案件＋第一／第二期望日與時段）→ 把邀請傳給各屋主 → 屋主回覆方便的時段 →
// 全部回覆後機器人通知 → 這裡看自動排好的行程、調整、確認 → 機器人把確認卡給安排人員，再傳給屋主 →
// 屋主在卡片按「確認時間沒問題」才成立預約。後端：/api/joint-schedules（app.py 的「聯合排程」區塊）。
let JOINT_LIST = [];
let JOINT_CUR = null;        // 目前開著的詳細視窗資料
let JOINT_EDIT = {};         // {task_id: {start, end}}
let JOINT_DATE = '';
let JOINT_FORM = null;       // 新增視窗的狀態
let JOINT_PRELOAD = null;    // 編輯聯合排程：把既有資料帶進表單（initJointForm 用）
let JOINT_EMBED = false;     // 2026-10-20：新增表單放在「指派給業務」視窗的「聯合預約」分頁裡（true），不另外開視窗

function jtPrefsText(prefs, withWins){
  const tiers = [...new Set((prefs || []).map(p => p.tier))].sort((a, b) => a - b);
  return tiers.map((t, i) => ['第一', '第二', '第三'][i] + '期望：' + prefs.filter(p => p.tier === t).map(p => fmtDate(p.date) + '（' + fmtWeekday(p.date) + '）' + (withWins ? p.windows.map(w => w[0] + '–' + w[1]).join('、') : '')).join('、')).join('｜');
}
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
        <div style="font-size:11.5px;color:var(--text-muted);">${jtPrefsText(g.prefs, false)}｜回覆 ${g.counts.replied}/${g.counts.total}｜確認 ${g.counts.confirmed}/${g.counts.total}</div>
      </div>
      <button class="btn btn-warm-primary" style="padding:6px 14px;font-size:12px;" onclick="openJointDetail('${g.id}')">開啟</button>
      <button class="btn btn-ghost" style="padding:6px 12px;font-size:12px;" onclick="editJoint('${g.id}')">✏️ 編輯</button>
      <button class="btn btn-ghost" style="padding:6px 12px;font-size:12px;color:#B42318;" onclick="deleteJoint('${g.id}')">🗑 刪除</button>
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
function jtNewDay(){ return {date: '', w1: ['09:00', '12:00'], w2on: true, w2: ['13:00', '17:00']}; }
function openJointCreate(){   // 從聯合排程分頁的「＋ 新增」按鈕進來：開「指派給業務」視窗並切到「聯合預約」分頁
  openSlotTaskModal();
  switchSlotTaskTab('joint');
}
function initJointForm(){
  let saved = [];
  try{ saved = splitNames(localStorage.getItem('slotSchedulerNames') || ''); }catch(e){}
  const tmr = new Date(Date.now() + 86400000);
  JOINT_FORM = {
    vendor: '三創', types: ['放樣'], cases: [], cl: {}, ord: {}, q: '', results: [],   // cl：{案號: 'A'|'B'|'C'}＝同排住戶組（同一排幾戶，只要其中一戶方便開門）
    tiers: [{days: [jtNewDay()]}],   // 第一期望（日期數不設上限）；第二期望選填
    dur: 60, gap: 30, creators: saved.length ? saved : [],
    dlDate: tmr.getFullYear() + '-' + String(tmr.getMonth() + 1).padStart(2, '0') + '-' + String(tmr.getDate()).padStart(2, '0'), dlTime: '18:00',
  };
  if(JOINT_PRELOAD){ Object.assign(JOINT_FORM, JOINT_PRELOAD); JOINT_PRELOAD = null; }
  renderJointCreate();
  if(typeof loadSlotSchedulers === 'function') loadSlotSchedulers().then(() => { if(JOINT_EMBED || document.getElementById('jointCreateOverlay')) renderJointCreate(); });
}
// 2026-10-22：聯合排程清單直接編輯／刪除
async function editJoint(id){
  try{
    const res = await fetch(API_BASE + '/api/joint-schedules/' + encodeURIComponent(id), {cache: 'no-store'});
    const g = await res.json();
    if(!res.ok) throw new Error(g.error || ('HTTP ' + res.status));
    if(['待屋主確認', '已完成', '已取消'].includes(g.status)){ showToast('這個聯合排程「' + g.status + '」，不能編輯；要改請取消後重建'); return; }
    const cases = [], cl = {}, ord = {};
    const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
    let li = 0;
    (g.tasks || []).forEach(t => {
      const members = [t.case, ...(t.companions || [])];
      members.forEach(c => cases.push(c));
      if(members.length > 1){
        const L = letters[li++] || 'F';
        members.forEach(c => { cl[c] = L; });
        if(t.order > 1) ord['g:' + L] = t.order;
      } else if(t.order > 1){ ord['c:' + t.case] = t.order; }
    });
    const tiersMap = {};
    (g.prefs || []).forEach(p => {
      (tiersMap[p.tier] ||= {days: []}).days.push({date: p.date, w1: (p.windows[0] || ['09:00', '12:00']).slice(), w2on: p.windows.length > 1, w2: (p.windows[1] || ['13:00', '17:00']).slice()});
    });
    const tiers = Object.keys(tiersMap).sort().map(k => tiersMap[k]);
    const dl = g.deadline ? new Date(g.deadline) : null;
    JOINT_PRELOAD = {editId: id, vendor: g.vendor, types: g.type || [], cases, cl, ord, tiers: tiers.length ? tiers : [{days: [jtNewDay()]}], dur: g.duration_min || 60, gap: g.gap_min != null ? g.gap_min : 30,
      creators: splitNames(g.creators || ''), q: '', results: [],
      dlDate: dl && !isNaN(dl) ? dl.getFullYear() + '-' + String(dl.getMonth() + 1).padStart(2, '0') + '-' + String(dl.getDate()).padStart(2, '0') : '',
      dlTime: dl && !isNaN(dl) ? String(dl.getHours()).padStart(2, '0') + ':' + String(dl.getMinutes()).padStart(2, '0') : '18:00'};
    openSlotTaskModal();
    switchSlotTaskTab('joint');
  }catch(e){ JOINT_PRELOAD = null; showToast('開啟編輯失敗：' + e.message); }
}
function deleteJoint(id){
  const g = JOINT_LIST.find(x => x.id === id);
  confirmDanger('確定要刪除這個聯合排程嗎？<br><span style="font-size:12.5px;font-weight:500;color:#6B7280;">' + escHtml(g ? g.title : '') + '<br>底下各案的屋主連結會立刻失效，已經收集的回覆會一起刪除。</span>', async () => {
    try{
      const res = await fetch(API_BASE + '/api/joint-schedules/' + encodeURIComponent(id), {method: 'DELETE'});
      const d = await res.json().catch(() => ({}));
      if(!res.ok) throw new Error(d.error || ('HTTP ' + res.status));
      showToast('已刪除聯合排程');
      loadJoint();
    }catch(e){ showToast('刪除失敗：' + e.message); }
  }, '是，刪除');
}
function jtDefaultDur(types){
  const m = {'掛表': 180, '植筋': 180, '放樣': 60, '場勘': 60, '進場': 240};
  return types.reduce((s, t) => s + (m[t] || 0), 0) || 60;
}
function renderJointCreate(){
  const F = JOINT_FORM;
  const box = JOINT_EMBED ? document.getElementById('slotTaskJointBox') : jtOverlay('jointCreateOverlay', 560);
  const lab = t => `<div style="font-size:12px;font-weight:700;margin:14px 0 6px;">${t}</div>`;
  const dayRow = (p, ti, di) => `
    <div style="border:1px solid var(--border);border-radius:12px;padding:10px 12px;margin-bottom:8px;background:#fff;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <b style="font-size:12.5px;">日期 ${di + 1}</b>
        <input type="date" class="quick-mark-input" style="flex:1;" value="${p.date}" onchange="JOINT_FORM.tiers[${ti}].days[${di}].date=this.value">
        ${(ti > 0 || di > 0) ? `<button class="btn btn-ghost" style="padding:4px 9px;" onclick="jtRemoveDay(${ti},${di})">✕</button>` : ''}
      </div>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
        <span style="font-size:11.5px;color:var(--text-muted);width:62px;">廠商時段</span>
        <select class="quick-mark-input" style="flex:1;" onchange="JOINT_FORM.tiers[${ti}].days[${di}].w1[0]=this.value">${jtTimeOpts(p.w1[0])}</select>到
        <select class="quick-mark-input" style="flex:1;" onchange="JOINT_FORM.tiers[${ti}].days[${di}].w1[1]=this.value">${jtTimeOpts(p.w1[1])}</select>
      </div>
      <label style="display:flex;gap:6px;align-items:center;font-size:12px;cursor:pointer;margin-bottom:6px;"><input type="checkbox" ${p.w2on ? 'checked' : ''} onchange="JOINT_FORM.tiers[${ti}].days[${di}].w2on=this.checked;renderJointCreate()"> 加第二個時段（中間是午休，屋主不能選）</label>
      ${p.w2on ? `<div style="display:flex;gap:6px;align-items:center;">
        <span style="font-size:11.5px;color:var(--text-muted);width:62px;">下午</span>
        <select class="quick-mark-input" style="flex:1;" onchange="JOINT_FORM.tiers[${ti}].days[${di}].w2[0]=this.value">${jtTimeOpts(p.w2[0])}</select>到
        <select class="quick-mark-input" style="flex:1;" onchange="JOINT_FORM.tiers[${ti}].days[${di}].w2[1]=this.value">${jtTimeOpts(p.w2[1])}</select></div>` : ''}
    </div>`;
  const tierBox = (t, ti) => `
    <div style="border:2px solid ${ti === 0 ? '#BFD3FF' : '#FDE0A8'};border-radius:14px;padding:12px;margin-bottom:12px;background:${ti === 0 ? '#F5F8FF' : '#FFFBF1'};">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <b style="font-size:13.5px;">${['第一', '第二'][ti]}期望${ti === 0 ? '（優先：屋主先看這組，日期可以加很多天）' : '（第一期望都不行，才會看這組）'}</b>
        ${ti > 0 ? `<button class="btn btn-ghost" style="padding:3px 9px;font-size:11px;" onclick="JOINT_FORM.tiers.splice(${ti},1);renderJointCreate()">移除</button>` : ''}
      </div>
      ${t.days.map((d, di) => dayRow(d, ti, di)).join('')}
      <button class="btn btn-ghost" style="padding:5px 12px;font-size:12px;" onclick="JOINT_FORM.tiers[${ti}].days.push(jtNewDay());renderJointCreate()">＋ 再加一個日期</button>
    </div>`;
  box.innerHTML = `
    ${JOINT_EMBED ? '' : `<div style="display:flex;align-items:center;justify-content:space-between;"><div style="font-size:17px;font-weight:800;">🧩 新增聯合排程</div>
      <button type="button" onclick="document.getElementById('jointCreateOverlay').remove()" style="border:none;background:#F1F3F8;border-radius:50%;width:30px;height:30px;cursor:pointer;">✕</button></div>`}
    <div style="font-size:12px;color:var(--text-muted);margin:6px 0 0;line-height:1.7;">把同一廠商、同一項目的幾個案件綁在一起：屋主先回覆哪幾天、哪個時段方便，你再統一排出每案的時間，讓廠商一天跑完。</div>
    ${lab('廠商')}
    <select class="quick-mark-input" ${F.editId ? 'disabled' : ''} onchange="JOINT_FORM.vendor=this.value">${ALL_VENDOR_NAMES.map(v => `<option ${v === F.vendor ? 'selected' : ''}>${v}</option>`).join('')}</select>
    ${lab('項目')}
    <div style="display:flex;gap:14px;flex-wrap:wrap;">${['放樣', '場勘', '掛表', '植筋', '進場'].map(t => `<label style="display:flex;gap:5px;align-items:center;font-size:13px;cursor:pointer;"><input type="checkbox" ${F.types.includes(t) ? 'checked' : ''} ${F.editId ? 'disabled' : ''} onchange="jtToggleType('${t}',this.checked)">${t}</label>`).join('')}</div>
    ${F.editId ? '<div style="font-size:11.5px;color:var(--text-muted);margin-top:4px;">編輯時廠商和項目不能改。已回覆的屋主會保留回覆；期望日被拿掉時，選了那些日期的屋主要重新回覆。已排好時間、等屋主確認中的不能編輯。</div>' : ''}
    ${lab('案件（至少兩個單位；打案號或關鍵字搜尋）')}
    <div style="font-size:11.5px;color:var(--text-muted);line-height:1.6;margin-bottom:6px;">每個案件預設是「獨立」，要各自回覆。同一排的幾戶、只需要其中一戶方便開門就好的，在案件右邊選同一個組別（例如都選「同排A」），整組只會收到一份邀請、算一個單位，確認後兩邊一起預約。</div>
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:6px;">${F.cases.map((c, i) => `<div style="display:flex;align-items:center;gap:8px;background:#EEF3FF;border-radius:12px;padding:5px 10px;font-size:12.5px;">
      <span style="flex:1;">${escHtml(c)}</span>
      <select class="quick-mark-input" style="width:auto;padding:3px 8px;font-size:12px;" onchange="JOINT_FORM.cl[${JSON.stringify(c).replace(/"/g, '&quot;')}]=this.value;renderJointCreate()">
        ${[['', '獨立'], ['A', '同排 A'], ['B', '同排 B'], ['C', '同排 C']].map(([v, l]) => `<option value="${v}" ${(F.cl[c] || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <a style="cursor:pointer;color:#B42318;" onclick="delete JOINT_FORM.cl[${JSON.stringify(c).replace(/"/g, '&quot;')}];JOINT_FORM.cases.splice(${i},1);renderJointCreate()">✕</a></div>`).join('') || '<span style="font-size:12px;color:var(--text-muted);">還沒選案件</span>'}</div>
    ${(() => { const g = jtUnits(); return F.cases.length ? `<div style="font-size:11.5px;color:${g.units >= 2 ? '#15803D' : '#B45309'};margin-bottom:4px;">目前 ${g.units} 個單位：獨立 ${g.single.length} 案${g.clusters.map((c, i) => '、同排組 ' + c.length + ' 戶').join('')}</div>` : ''; })()}
    ${(() => { const g = jtUnits(); if(g.units < 2) return '';
      return `<div style="border:1px dashed var(--border);border-radius:12px;padding:10px 12px;margin:8px 0;">
        <div style="font-size:12px;font-weight:700;margin-bottom:4px;">回覆順序（選填）</div>
        <div style="font-size:11.5px;color:var(--text-muted);line-height:1.6;margin-bottom:8px;">預設全部「第 1 批」＝大家同時回覆。若要<b>先讓某幾戶決定日期</b>，再讓其他戶從他們共同方便的日期裡選，把後面的單位設成「第 2 批」：第 2 批要等第 1 批都回覆後才開放，而且只會看到第 1 批選的日期（例如第 1 批選了 23、24 號，第 2 批就只能在 23、24 號裡選）。</div>
        ${g.unitList.map(u => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12.5px;"><span style="flex:1;">${escHtml(u.label)}${u.members.length > 1 ? ' <span style="color:var(--text-muted);font-size:11.5px;">' + u.members.map(escHtml).join('＋') + '</span>' : ''}</span>
          <select class="quick-mark-input" style="width:auto;padding:3px 8px;font-size:12px;" onchange="JOINT_FORM.ord[${JSON.stringify(u.key).replace(/"/g, '&quot;')}]=parseInt(this.value,10)">
            ${[1, 2, 3].map(n => `<option value="${n}" ${(F.ord[u.key] || 1) === n ? 'selected' : ''}>第 ${n} 批${n === 1 ? '（先回覆）' : ''}</option>`).join('')}</select></div>`).join('')}
      </div>`; })()}
    <input class="quick-mark-input" id="jtCaseQ" placeholder="輸入案號或別名…" value="${escHtml(F.q)}" oninput="jtSearchCase(this.value)" autocomplete="off">
    <div id="jtCaseRes">${jtResultsHtml()}</div>
    ${lab('期望日與廠商可作業時段')}
    ${F.tiers.map(tierBox).join('')}
    ${F.tiers.length < 2 ? '<button class="btn btn-ghost" style="padding:5px 12px;font-size:12px;" onclick="JOINT_FORM.tiers.push({days:[jtNewDay()]});renderJointCreate()">＋ 加第二期望（第一期望都不行時才看）</button>' : ''}
    ${lab('每案預計作業時間／案件之間的緩衝')}
    <div style="display:flex;gap:8px;align-items:center;">
      <input type="number" class="quick-mark-input" style="flex:1;" min="15" step="15" value="${F.dur}" onchange="JOINT_FORM.dur=parseInt(this.value,10)||60"><span style="font-size:12px;">分鐘／案</span>
      <input type="number" class="quick-mark-input" style="flex:1;" min="0" step="15" value="${F.gap}" onchange="JOINT_FORM.gap=parseInt(this.value,10)||0"><span style="font-size:12px;">分鐘緩衝</span>
    </div>
    ${lab('請屋主在這個時間前回覆（日期留空＝不設期限）')}
    <div style="display:flex;gap:8px;"><input type="date" class="quick-mark-input" style="flex:1.3;" value="${F.dlDate}" onchange="JOINT_FORM.dlDate=this.value"><select class="quick-mark-input" style="flex:1;" onchange="JOINT_FORM.dlTime=this.value">${jtTimeOpts(F.dlTime)}</select></div>
    ${lab('安排人員（屋主回覆、確認時，LINE 通知這些同仁）')}
    <div style="display:flex;flex-wrap:wrap;gap:8px 16px;">${(typeof SLOT_SCHEDULERS !== 'undefined' ? SLOT_SCHEDULERS : []).map(n => `<label style="display:flex;gap:5px;align-items:center;font-size:13px;cursor:pointer;"><input type="checkbox" ${F.creators.includes(n) ? 'checked' : ''} onchange="jtToggleCreator('${escHtml(n)}',this.checked)">${escHtml(n)}</label>`).join('') || '<span style="font-size:12px;color:var(--text-muted);">名單載入中…</span>'}</div>
    <button type="button" class="btn btn-primary" id="jtCreateBtn" style="width:100%;justify-content:center;padding:11px;margin-top:18px;" onclick="submitJointCreate()">${F.editId ? '儲存修改' : '建立聯合排程'}</button>`;
}
function jtRemoveDay(ti, di){
  const t = JOINT_FORM.tiers[ti];
  t.days.splice(di, 1);
  if(!t.days.length) JOINT_FORM.tiers.splice(ti, 1);
  renderJointCreate();
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
// 把選好的案件整理成「獨立案件」與「同排住戶組」；只有一戶的同排組視為獨立
function jtUnits(){
  const F = JOINT_FORM, by = {};
  F.cases.forEach(c => { const k = F.cl[c] || ''; if(k) (by[k] ||= []).push(c); });
  const clusterKeys = Object.keys(by).filter(k => by[k].length >= 2);
  const clusters = clusterKeys.map(k => by[k]);
  const inCluster = new Set(clusters.flat());
  const single = F.cases.filter(c => !inCluster.has(c));
  // unitList：每個單位（獨立案件或同排組）一筆，用來設定「回覆順序」
  const unitList = [...single.map(c => ({key: 'c:' + c, label: c, members: [c]})), ...clusterKeys.map(k => ({key: 'g:' + k, label: '同排 ' + k + '（' + by[k].length + ' 戶）', members: by[k]}))];
  return {single, clusters, clusterKeys, unitList, units: single.length + clusters.length};
}
// 回覆順序：{案號: 批次}（同排組每個成員都帶同一個批次）；全部第 1 批就不送
function jtOrdersMap(U){
  const out = {};
  U.unitList.forEach(u => { const n = JOINT_FORM.ord[u.key] || 1; if(n > 1) u.members.forEach(c => { out[c] = n; }); });
  return out;
}
function jtAddCase(i){
  const r = JOINT_FORM.results[i]; if(!r) return;
  if(!JOINT_FORM.cases.includes(r.case)) JOINT_FORM.cases.push(r.case);
  JOINT_FORM.q = ''; JOINT_FORM.results = [];
  renderJointCreate();
}
async function submitJointCreate(){
  const F = JOINT_FORM;
  const tiers = [];
  const seen = new Set();
  for(const t of F.tiers){
    const days = [];
    for(const p of t.days){
      if(!p.date) continue;
      if(seen.has(p.date)){ showToast('日期 ' + p.date + ' 重複了'); return; }
      seen.add(p.date);
      const wins = [[p.w1[0], p.w1[1]]];
      if(p.w2on) wins.push([p.w2[0], p.w2[1]]);
      if(wins.some(w => !w[0] || !w[1] || w[0] >= w[1])){ showToast('時段的開始時間要早於結束時間'); return; }
      if(p.w2on && wins[1][0] < wins[0][1]){ showToast('第二個時段要從第一個時段結束之後開始'); return; }
      days.push({date: p.date, windows: wins});
    }
    if(days.length) tiers.push({days});
  }
  const U = jtUnits();
  if(!F.types.length || U.units < 2 || !tiers.length){ showToast('請選項目、至少兩個單位（同排住戶組算一個），並設定第一期望日'); return; }
  const btn = document.getElementById('jtCreateBtn');
  btn.disabled = true; btn.textContent = F.editId ? '儲存中…' : '建立中…';
  try{
    const res = await fetch(API_BASE + '/api/joint-schedules' + (F.editId ? '/' + encodeURIComponent(F.editId) : ''), {method: F.editId ? 'PATCH' : 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({
      vendor: F.vendor, type: F.types, cases: U.single, clusters: U.clusters, tiers, orders: jtOrdersMap(U), duration_min: F.dur, gap_min: F.gap, creator: F.creators.join('、'),
      deadline: F.dlDate ? F.dlDate + 'T' + (F.dlTime || '18:00') + ':00+08:00' : null})});
    const d = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(d.error || ('HTTP ' + res.status));
    try{ localStorage.setItem('slotSchedulerNames', F.creators.join('、')); }catch(e){}
    if(JOINT_EMBED){ closeSlotTaskModal(); } else { const ov = document.getElementById('jointCreateOverlay'); if(ov) ov.remove(); }
    if(d.failed && d.failed.length) showToast('這些案件處理失敗：' + d.failed.join('、'));
    else if(F.editId) showToast('已儲存修改' + ((d.cleared || []).length ? '；' + d.cleared.join('、') + ' 選的日期被拿掉了，需要屋主重新回覆' : '') + ((d.removed || []).length ? '；已移除 ' + d.removed.join('、') : ''));
    loadJoint();
    JOINT_CUR = d.joint; JOINT_EDIT = {}; JOINT_DATE = '';
    renderJointDetail();
  }catch(err){
    showToast((F.editId ? '儲存失敗：' : '建立失敗：') + err.message);
    btn.disabled = false; btn.textContent = F.editId ? '儲存修改' : '建立聯合排程';
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
      <td style="padding:8px 6px;font-size:12.5px;"><b>${escHtml(t.case)}</b>${(t.companions || []).length ? ' <span style="color:#1D4ED8;font-weight:700;">＋ ' + t.companions.map(escHtml).join('＋') + '</span>' : ''}<div style="color:var(--text-muted);font-size:11.5px;">${escHtml(t.alias || '')}${t.assignee ? '｜業務 ' + escHtml(t.assignee) : ''}${t.cluster ? '<br>🏘 同排住戶（任一戶回覆即可，同一條連結傳給這幾戶）' : ''}${t.order > 1 ? '<br>🔢 第 ' + t.order + ' 批' + (t.open_dates && t.open_dates.length ? '：只能選 ' + t.open_dates.map(d => fmtDate(d)).join('、') : '') : ''}</div></td>
      <td style="padding:8px 6px;font-size:12px;">${escHtml(t.status_text)}${t.chosen_slot ? '<div style="color:#7C3AED;">' + fmtDate(t.chosen_slot.date) + ' ' + escHtml(t.chosen_slot.start_time) + '–' + escHtml(t.chosen_slot.end_time) + '</div>' : ''}</td>
      <td style="padding:8px 6px;font-size:12px;color:#374151;">${escHtml(t.reply_text)}${t.alt_slots && t.alt_slots.length ? '<div style="color:#B45309;">屋主另提：' + t.alt_slots.map(s => fmtDate(s.date)).join('、') + '</div>' : ''}</td>
      <td style="padding:8px 6px;font-size:11.5px;white-space:nowrap;">
        ${!t.done && !t.chosen_slot && t.invite_share_url ? `<a href="${t.invite_share_url}" target="_blank" rel="noopener" style="color:#2563EB;">📤 傳邀請給屋主</a><br>` : ''}
        ${!t.done && t.chosen_slot && t.confirm_share_url ? `<a href="${t.confirm_share_url}" target="_blank" rel="noopener" style="color:#16A34A;font-weight:700;">📤 傳確認卡給屋主</a><br>` : ''}
        ${!t.done && !t.chosen_slot ? `<a style="cursor:pointer;color:#4A154B;font-weight:700;" onclick="openSlackCard('joint-invite', '${t.task_id}')">💬 傳邀請到 Slack</a><br>` : ''}
        ${!t.done && t.chosen_slot ? `<a style="cursor:pointer;color:#4A154B;font-weight:700;" onclick="openSlackCard('joint-confirm', '${t.task_id}')">💬 傳確認訊息到 Slack</a><br>` : ''}
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
            <td style="padding:7px 6px;font-size:12.5px;"><b>${escHtml(t.case)}</b>${(t.companions || []).length ? ' ＋ ' + t.companions.map(escHtml).join('＋') : ''} ${escHtml(t.alias || '')}${un && !e.start ? `<div style="color:#B42318;font-size:11.5px;">⚠ ${escHtml(un.reason)}，需要另約或手動指定</div>` : ''}</td>
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
    <div style="font-size:12px;color:var(--text-muted);margin:6px 0 10px;line-height:1.7;">${jtPrefsText(g.prefs, true)}｜回覆 ${g.counts.replied}/${g.counts.total}｜確認 ${g.counts.confirmed}/${g.counts.total}</div>
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
function cancelJoint(id){
  confirmDanger('確定取消這個聯合排程？<br><span style="font-size:12.5px;font-weight:500;color:#6B7280;">會直接移除，不留紀錄；還沒確認的案件任務一起刪除，屋主連結失效。已經成立的預約不受影響。</span>', () => cancelJointNow(id), '是，取消並移除');
}
async function cancelJointNow(id){
  try{
    const res = await fetch(API_BASE + '/api/joint-schedules/' + encodeURIComponent(id) + '/cancel', {method: 'POST'});
    if(!res.ok) throw new Error('HTTP ' + res.status);
    document.getElementById('jointDetailOverlay').remove();
    loadJoint();
    showToast('已取消並移除');
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
