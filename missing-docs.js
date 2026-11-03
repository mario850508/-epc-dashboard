// ===================================================================
// 缺件追蹤（2026-11-01；左側選單獨立一項）
// 廠商會來對「哪些案件還缺哪些資料」（竣工圖／使用執照／電費單／監控／出場保固書…）；資料常常是業務向屋主要、
// 要著要著就漏掉，廠商又得再要一次。這頁讓 PM 把缺件記下來、每週確認一次拿到沒、並把「某位業務名下還缺的」
// 整理成一則訊息一鍵推播給他（走業務 LINE／Slack 綁定，送出前先預覽）。
// 後端：GET/POST /api/missing-docs、PATCH/DELETE /api/missing-docs/<id>、POST /api/missing-docs/confirm、
//       GET /api/missing-docs/notice?rep=、POST /api/missing-docs/notify；案場搜尋沿用 /api/case-search
// ===================================================================
const MD_TYPES = ['竣工圖', '使用執照', '使用執照附件', '無使用執照證明', '使用分區證明', '舊有房屋證明', '電費單', '身分證', '公證書', '監控', '模組、逆變器出場&保固書', '結案保固書', '其他'];
const MD_DUE_DAYS = 7;   // 距離上次確認（沒確認過就從建立日算）滿 7 天 → 該確認了
let MD_ITEMS = [];
let MD_TODAY = '';
let MD_FILTER = 'open';   // open 缺件中｜due 本週待確認｜got 已取得
let MD_GROUP = 'rep';     // rep 依業務｜type 依類型｜case 依案場
const MD_SELF_KEY = '我自己（Mario）要處理';
const MD_ASSIST_KEY = '業務助理';
const MD_VENDORS = ['三創', '尚展', '曙光', '光鼎', '宇陽達', '聚曜', '澄品', '大昇', '展亦', '凰太竹', '國欽', '振庭'];
let MD_VENDOR_FILTER = '';   // 清單依廠商篩選（空＝全部）
let MD_CASE_PICK = null;
let MD_CASES = [];           // 新增表單：目前選的廠商底下進行中的案場
let MD_TYPES_PICKED = [];    // 新增表單：已選的缺件類型
let MD_REPS_LOADED = false;
let MD_NOTICE = null;
function mdStore(k, v){ try{ if(v === undefined) return localStorage.getItem('md_' + k) || ''; localStorage.setItem('md_' + k, v); }catch(e){ return ''; } }

function mdEsc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function mdDaysBetween(a, b){ return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }
function mdMD(d){ return d ? d.slice(5).replace('-', '/') : '—'; }
function mdLastCheck(it){ return it.confirmed || it.created || ''; }
function mdIsDue(it){ return it.status === '缺件' && MD_TODAY && mdLastCheck(it) && mdDaysBetween(mdLastCheck(it), MD_TODAY) >= MD_DUE_DAYS; }

async function mdLoad(){
  const box = document.getElementById('mdBox');
  if(box && !MD_ITEMS.length) box.innerHTML = '<div class="login-note">載入中…</div>';
  try{
    const res = await fetch(API_BASE + '/api/missing-docs');
    const data = await res.json();
    if(data.error) throw new Error(data.error);
    MD_ITEMS = data.items || [];
    MD_TODAY = data.today || '';
  }catch(e){
    if(box) box.innerHTML = '<div class="login-note">載入失敗，請按「重新整理」再試一次（' + mdEsc(e.message || e) + '）</div>';
    return;
  }
  if(!MD_REPS_LOADED){
    MD_REPS_LOADED = true;
    fetch(API_BASE + '/api/reps').then(r => r.json()).then(d => {
      const dl = document.getElementById('mdRepList');
      if(dl) dl.innerHTML = (d.reps || []).map(r => `<option value="${mdEsc(r.name)}">`).join('');
    }).catch(() => {});
  }
  mdRenderForm();
  mdRender();
}

function mdRenderForm(){
  const vs = document.getElementById('mdVendorSel');
  if(!vs || vs.dataset.ready) return;
  vs.dataset.ready = '1';
  if(typeof MD_LOCK_VENDOR !== 'undefined' && MD_LOCK_VENDOR){   // 案件觀測中心:廠商以頂端選的為準,整頁只有這一家
    vs.innerHTML = `<option value="${mdEsc(MD_LOCK_VENDOR)}">${mdEsc(MD_LOCK_VENDOR)}</option>`;
    vs.value = MD_LOCK_VENDOR; vs.disabled = true;
    document.getElementById('mdTypeSel').innerHTML = '<option value="">請選缺哪一項…</option>' + MD_TYPES.map(t => `<option value="${mdEsc(t)}">缺${mdEsc(t)}</option>`).join('');
    MD_VENDOR_FILTER = MD_LOCK_VENDOR; mdVendorChanged();
    return;
  }
  const want = new URLSearchParams(location.search).get('vendor') || mdStore('vendor');
  vs.innerHTML = '<option value="">請選廠商</option>' + MD_VENDORS.map(v => `<option value="${mdEsc(v)}">${mdEsc(v)}</option>`).join('');
  document.getElementById('mdTypeSel').innerHTML = '<option value="">請選缺哪一項…</option>' + MD_TYPES.map(t => `<option value="${mdEsc(t)}">缺${mdEsc(t)}</option>`).join('');
  if(want && MD_VENDORS.includes(want)){ vs.value = want; MD_VENDOR_FILTER = want; mdVendorChanged(); }
}

async function mdVendorChanged(){
  const v = document.getElementById('mdVendorSel').value;
  const cs = document.getElementById('mdCaseSel');
  const dl = document.getElementById('mdCaseList');
  MD_CASE_PICK = null;
  cs.value = '';
  document.getElementById('mdPicked').textContent = '';
  document.getElementById('mdRepInput').value = '';
  MD_CASES = [];
  if(!v){ dl.innerHTML = ''; cs.placeholder = '先選廠商'; return; }
  mdStore('vendor', v);
  MD_VENDOR_FILTER = v;
  dl.innerHTML = ''; cs.placeholder = '載入案場中…';
  mdRender();
  try{
    const res = await fetch(API_BASE + '/api/missing-docs/cases?vendor=' + encodeURIComponent(v));
    const data = await res.json();
    if(data.error) throw new Error(data.error);
    MD_CASES = data.cases || [];
    cs.placeholder = '輸入關鍵字搜尋，例如 桃園15（共 ' + MD_CASES.length + ' 個進行中）';
    dl.innerHTML = MD_CASES.map(c => `<option value="${mdEsc(mdCaseLabel(c))}">${c.rep ? mdEsc(c.rep) : ''}</option>`).join('');
  }catch(e){
    cs.placeholder = '案場載入失敗，請重選廠商再試';
  }
}

function mdCaseLabel(c){ return (c.case_no || '') + (c.alias && c.alias !== c.case_no ? '（' + c.alias + '）' : ''); }

// 案場欄:打關鍵字(例如 桃園15)由瀏覽器列出符合的選項;選到完整名稱就帶入業務。
// 離開欄位時如果只剩唯一符合的案場,直接採用;多個就維持沒選,請再選一個。
function mdCaseChanged(commit){
  const inp = document.getElementById('mdCaseSel');
  const q = inp.value.trim();
  let c = MD_CASES.find(x => mdCaseLabel(x) === q) || null;
  if(!c && commit && q){
    const hits = MD_CASES.filter(x => (mdCaseLabel(x) + (x.rep || '')).includes(q));
    if(hits.length === 1){ c = hits[0]; inp.value = mdCaseLabel(c); }
  }
  const changed = c !== MD_CASE_PICK;
  MD_CASE_PICK = c;
  const pk = document.getElementById('mdPicked');
  if(c){
    pk.textContent = c.case_no + (c.rep ? '｜業務：' + c.rep : '｜⚠ 找不到這案的業務，請在右邊填');
    if(changed) document.getElementById('mdRepInput').value = c.rep || '';
  }else{
    pk.textContent = (commit && q) ? '找不到唯一符合的案場，請從下拉清單點選一個' : '';
    if(commit || !q) document.getElementById('mdRepInput').value = '';
  }
}

function mdTypeChosen(){
  const sel = document.getElementById('mdTypeSel');
  const t = sel.value;
  sel.value = '';
  if(t && !MD_TYPES_PICKED.includes(t)) MD_TYPES_PICKED.push(t);
  mdRenderChips();
}
function mdRemoveType(t){ MD_TYPES_PICKED = MD_TYPES_PICKED.filter(x => x !== t); mdRenderChips(); }
function mdRenderChips(){
  document.getElementById('mdTypeBox').innerHTML = MD_TYPES_PICKED.length
    ? MD_TYPES_PICKED.map(t => `<span class="md-type on">缺${mdEsc(t)} <a href="#" onclick="mdRemoveType(${JSON.stringify(t).replace(/"/g, '&quot;')});return false;" style="text-decoration:none;color:#B42318;">✕</a></span>`).join('')
    : '<span class="md-sub">還沒選</span>';
}

async function mdAdd(){
  const msg = document.getElementById('mdAddMsg');
  mdCaseChanged(true);
  const c = MD_CASE_PICK;
  if(!c){ msg.textContent = '請先選廠商和案場'; return; }
  if(!MD_TYPES_PICKED.length){ msg.textContent = '請在「缺什麼」下拉選單選至少一項'; return; }
  const body = {
    case_no: c.case_no || '', alias: (c.case_no || '') + (c.alias && c.alias !== c.case_no ? '（' + c.alias + '）' : ''), vendor: c.vendor || '',
    doc_types: MD_TYPES_PICKED.slice(),
    note: document.getElementById('mdNoteInput').value.trim(),
    rep: document.getElementById('mdRepInput').value.trim(),
    provider: document.getElementById('mdProviderSel').value,
  };
  msg.textContent = '新增中…';
  try{
    const res = await fetch(API_BASE + '/api/missing-docs', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const data = await res.json();
    if(!res.ok || data.error){ msg.textContent = '新增失敗：' + (data.error || res.status); return; }
    let t = '✅ ' + c.case_no + ' 已新增 ' + (data.created || []).length + ' 項' + (data.rep ? '，業務：' + data.rep : '，⚠ 找不到這案的業務，請在清單上補填');
    if((data.skipped || []).length) t += '（' + data.skipped.join('、') + ' 本來就在追蹤中，略過）';
    msg.textContent = t;
    MD_TYPES_PICKED = [];
    mdRenderChips();
    document.getElementById('mdNoteInput').value = '';
    MD_CASE_PICK = null; document.getElementById('mdCaseSel').value = '';   // 廠商留著，方便連續新增同廠商的下一個案場
    mdCaseChanged();
    await mdLoad();
  }catch(e){ msg.textContent = '新增失敗：' + e; }
}

// ---------- 清單 ----------
// 還沒通知過業務的缺件（我自己處理的不用通知）
function mdNeedNotify(it){ return it.status === '缺件' && !it.notified && it.provider !== 'Mario'; }
function mdSetFilter(f){ MD_FILTER = f; mdRender(); }
function mdSetGroup(g){ MD_GROUP = g; mdRender(); }

function mdRender(){
  const box = document.getElementById('mdBox');
  if(!box) return;
  const pool = MD_VENDOR_FILTER ? MD_ITEMS.filter(i => i.vendor === MD_VENDOR_FILTER) : MD_ITEMS;
  const open = pool.filter(i => i.status === '缺件');
  const due = open.filter(mdIsDue);
  const unn = open.filter(mdNeedNotify);
  const sup = open.filter(i => i.supplied);
  const got = pool.filter(i => i.status === '已取得').sort((a, b) => (b.got || '').localeCompare(a.got || '')).slice(0, 60);
  document.getElementById('mdSummary').innerHTML =
    `缺件中 <b>${open.length}</b> 項，涉及 <b>${new Set(open.map(i => i.alias || i.case_no)).size}</b> 個案場；` +
    (due.length ? `<span class="md-due">⏰ ${due.length} 項已超過 ${MD_DUE_DAYS} 天沒確認</span>` : '本週都確認過了 ✅');
  document.getElementById('mdFilters').innerHTML =
    [['open', `缺件中（${open.length}）`], ['unn', `🆕 未通知（${unn.length}）`], ['sup', `📬 業務已補件（${sup.length}）`], ['due', `本週待確認（${due.length}）`], ['got', `已取得（${got.length}）`]]
      .map(([k, l]) => `<button class="md-chip ${MD_FILTER === k ? 'on' : ''}" onclick="mdSetFilter('${k}')">${l}</button>`).join('') +
    '<span class="md-sep"></span>廠商：' + ((typeof MD_LOCK_VENDOR !== 'undefined' && MD_LOCK_VENDOR) ? `<b>${mdEsc(MD_LOCK_VENDOR)}</b>` :
      '<select class="cert-rename-input" style="padding:3px 8px;" onchange="MD_VENDOR_FILTER=this.value;mdRender()"><option value="">全部</option>' +
      MD_VENDORS.map(v => `<option value="${mdEsc(v)}" ${MD_VENDOR_FILTER === v ? 'selected' : ''}>${mdEsc(v)}</option>`).join('') + '</select>') +
    '<span class="md-sep"></span>分組：' +
    [['rep', '業務'], ['type', '缺件類型'], ['case', '案場']]
      .map(([k, l]) => `<button class="md-chip ${MD_GROUP === k ? 'on' : ''}" onclick="mdSetGroup('${k}')">${l}</button>`).join('');
  const confirmBtn = document.getElementById('mdConfirmAllBtn');
  confirmBtn.style.display = (MD_FILTER === 'due' && due.length) || (MD_FILTER === 'open' && open.length) ? '' : 'none';
  confirmBtn.textContent = MD_FILTER === 'due' ? `✅ 這 ${due.length} 項本週都確認過了` : `✅ 全部 ${open.length} 項標為本週已確認`;

  const list = MD_FILTER === 'due' ? due : (MD_FILTER === 'got' ? got : (MD_FILTER === 'unn' ? unn : (MD_FILTER === 'sup' ? sup : open)));
  if(!list.length){
    box.innerHTML = '<div class="login-note">' + (MD_FILTER === 'got' ? '還沒有已取得的資料' : (MD_FILTER === 'due' ? '沒有需要確認的項目 🎉' : (MD_FILTER === 'unn' ? '都通知過了 ✅' : MD_FILTER === 'sup' ? '目前沒有業務按「已補件」待確認的項目' : '目前沒有缺件，用上面的表單新增吧'))) + '</div>';
    return;
  }
  const keyOf = it => MD_GROUP === 'rep' ? (it.provider === 'Mario' ? MD_SELF_KEY : (it.provider === '業務助理' ? MD_ASSIST_KEY : (it.rep || '（未指定業務）'))) : (MD_GROUP === 'type' ? (it.doc_type || '其他') : (it.alias || it.case_no));
  const groups = new Map();
  list.forEach(it => { const k = keyOf(it); if(!groups.has(k)) groups.set(k, []); groups.get(k).push(it); });
  const order = Array.from(groups.keys()).sort((a, b) => {
    if(a === MD_SELF_KEY) return 1;      // 我自己要處理的放最後,跟業務分開
    if(b === MD_SELF_KEY) return -1;
    if(a === MD_ASSIST_KEY) return 1;    // 業務助理當成一個人名,排在一般業務之後
    if(b === MD_ASSIST_KEY) return -1;
    if(a.startsWith('（未指定')) return 1;
    if(b.startsWith('（未指定')) return -1;
    if(MD_GROUP === 'type') return MD_TYPES.indexOf(a) - MD_TYPES.indexOf(b);
    return a.localeCompare(b, 'zh-Hant');
  });
  box.innerHTML = order.map(k => {
    const its = groups.get(k);
    const nn = its.filter(mdNeedNotify).length, nnTxt = nn ? `（🆕 ${nn} 項未通知）` : '';
    const notifyBtn = (MD_GROUP === 'rep' && MD_FILTER !== 'got' && !k.startsWith('（未指定') && k !== MD_SELF_KEY)
      ? (k === MD_ASSIST_KEY
          ? `<button class="btn btn-primary md-btn" onclick="mdNotifyOpen('', 'assistant')">📨 通知業務助理${nnTxt}</button>`
          : `<button class="btn btn-primary md-btn" onclick="mdNotifyOpen(${JSON.stringify(k).replace(/"/g, '&quot;')})">📨 通知這位業務${nnTxt}</button>`) : '';
    const showRep = MD_GROUP !== 'rep' || k === MD_SELF_KEY || k === MD_ASSIST_KEY;   // 業務助理/我自己那區要看得到是哪位業務的案
    return `<div class="md-group"><div class="md-group-head"><span>${mdEsc(k)} <span class="md-sub">${its.length} 項</span></span>${notifyBtn}</div>` +
      `<div class="md-table-wrap"><table class="md-table"><thead><tr>` +
      (MD_GROUP === 'case' ? '' : '<th>案場</th>') + (MD_GROUP === 'type' || MD_GROUP === 'rep' ? '' : '<th>缺件類型</th>') +
      `<th>備註</th>${showRep ? '<th>業務</th>' : ''}<th>誰提供</th><th>已缺</th><th>上次確認</th><th>上次通知</th><th></th></tr></thead><tbody>` +
      mdRowsFor(its, showRep) + '</tbody></table></div></div>';
  }).join('');
}

// 依業務分組時,每個人底下再依缺件類型分區(電費單一區、使用執照一區…),同類型內依案場排序
function mdRowsFor(its, showRep){
  if(MD_GROUP !== 'rep') return its.map(it => mdRow(it, true)).join('');
  const byType = new Map();
  its.forEach(it => { const t = it.doc_type || '其他'; if(!byType.has(t)) byType.set(t, []); byType.get(t).push(it); });
  const types = Array.from(byType.keys()).sort((a, b) => {
    const ia = MD_TYPES.indexOf(a), ib = MD_TYPES.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return types.map(t => {
    const rows = byType.get(t).sort((a, b) => (a.alias || a.case_no || '').localeCompare(b.alias || b.case_no || '', 'zh-Hant'));
    return `<tr class="md-subhead"><td colspan="${showRep ? 8 : 7}">▸ ${mdEsc(t)} <span class="md-sub">${rows.length} 項</span></td></tr>` + rows.map(it => mdRow(it, showRep)).join('');
  }).join('');
}

function mdRow(it, showRep){
  const days = it.created && MD_TODAY ? mdDaysBetween(it.created, MD_TODAY) : null;
  const due = mdIsDue(it);
  const isGot = it.status === '已取得';
  return `<tr class="${due ? 'md-row-due' : ''}">` +
    (MD_GROUP === 'case' ? '' : `<td><b>${mdEsc(it.alias || it.case_no)}</b></td>`) +
    (MD_GROUP === 'type' || MD_GROUP === 'rep' ? '' : `<td>${mdEsc(it.doc_type)}</td>`) +
    `<td class="md-note" onclick="mdEditNote('${it.id}')" title="點一下修改備註">${it.source === '廠商填報' ? '<span class="md-tag-v" title="廠商在預約頁自己填的' + (it.reporter ? '；填報人：' + mdEsc(it.reporter) : '') + '" style="display:inline-block;font-size:11px;font-weight:700;background:#FFF1D6;color:#B45309;border-radius:99px;padding:0 7px;margin-right:4px;">🏭廠商填報</span>' : ''}${it.note ? mdEsc(it.note) : '<span class="md-sub">＋備註</span>'}</td>` +
    (!showRep ? '' : `<td onclick="mdEditRep('${it.id}')" title="點一下修改業務">${mdEsc(it.rep) || '<span class="md-sub">＋業務</span>'}</td>`) +
    `<td>${mdEsc(it.provider)}</td>` +
    `<td>${isGot ? '✔ ' + mdMD(it.got) : (days == null ? '—' : days + ' 天')}</td>` +
    `<td>${due ? '<span class="md-due">⏰ ' : '<span>'}${mdMD(mdLastCheck(it))}</span></td>` +
    `<td>${it.notified ? mdMD(it.notified) + (it.notify_count > 1 ? '（' + it.notify_count + '次）' : '') : (mdNeedNotify(it) ? '<span class="md-due" style="white-space:nowrap;">🆕 未通知</span>' : '—')}` +
    `${it.supplied && !isGot ? '<div><span title="業務在字卡按了已補件，請到資料夾確認" style="display:inline-block;font-size:11px;font-weight:700;background:#DCFCE7;color:#15803D;border-radius:99px;padding:0 7px;white-space:nowrap;">📬 已補件 ' + mdMD(it.supplied) + '</span></div>' : ''}</td>` +
    `<td class="md-actions">` +
    `<button class="md-mini" onclick="mdEdit('${it.id}')" title="修改業務、誰提供、缺件類型、備註">✏️ 編輯</button>` +
    (isGot ? `<button class="md-mini" onclick="mdSetStatus('${it.id}','缺件')">↩ 改回缺件</button>`
           : `<button class="md-mini md-ok" onclick="mdSetStatus('${it.id}','已取得')">✅ 已拿到</button><button class="md-mini" onclick="mdConfirm('${it.id}')">本週已確認</button>`) +
    `<button class="md-mini md-del" onclick="mdDelete('${it.id}')" title="刪除">🗑</button></td></tr>`;
}

async function mdPatch(id, body){
  const res = await fetch(API_BASE + '/api/missing-docs/' + id, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const data = await res.json().catch(() => ({}));
  if(!res.ok || data.error){ alert('更新失敗：' + (data.error || res.status)); return false; }
  return true;
}
async function mdSetStatus(id, status){ if(await mdPatch(id, {status})) mdLoad(); }
async function mdConfirm(id){ if(await mdPatch(id, {confirm: true})) mdLoad(); }
async function mdEditNote(id){
  const it = MD_ITEMS.find(x => x.id === id); if(!it) return;
  const v = prompt('備註（例如：最新為1月、2戶都要提供最新一期）', it.note || '');
  if(v === null) return;
  if(await mdPatch(id, {note: v})) mdLoad();
}
async function mdEditRep(id){
  const it = MD_ITEMS.find(x => x.id === id); if(!it) return;
  const v = prompt('負責的業務名字（要跟業務名單一致，通知才找得到人）', it.rep || '');
  if(v === null) return;
  if(await mdPatch(id, {rep: v})) mdLoad();
}
// 編輯一筆缺件:業務、誰提供、缺件類型、備註(案場要改請刪掉重新新增)
function mdEdit(id){
  const it = MD_ITEMS.find(x => x.id === id); if(!it) return;
  const old = document.getElementById('mdEditOverlay'); if(old) old.remove();
  const opt = (arr, cur) => arr.map(v => `<option value="${mdEsc(v)}" ${v === cur ? 'selected' : ''}>${mdEsc(v)}</option>`).join('');
  const types = MD_TYPES.includes(it.doc_type) ? MD_TYPES : MD_TYPES.concat([it.doc_type]);
  const fs = 'width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box;font-family:inherit;';
  const lb = 'display:block;font-size:12px;color:#888;margin:10px 0 4px;';
  const ov = document.createElement('div');
  ov.id = 'mdEditOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px;';
  ov.onclick = e => { if(e.target === ov) ov.remove(); };
  ov.innerHTML = `<div style="background:#fff;border-radius:14px;width:100%;max-width:440px;padding:18px 20px;max-height:92vh;overflow:auto;">
    <div style="font-weight:700;font-size:15px;">✏️ 修改缺件</div>
    <div style="font-size:13px;color:#888;margin-top:4px;">${mdEsc(it.alias || it.case_no)}</div>
    <label style="${lb}">缺件類型</label><select id="mdEdType" style="${fs}">${opt(types, it.doc_type)}</select>
    <label style="${lb}">誰提供</label><select id="mdEdProv" style="${fs}">${['業務', '業務助理', 'Mario'].map(v => `<option value="${v}" ${v === it.provider ? 'selected' : ''}>${v === 'Mario' ? 'Mario（我自己）' : v}</option>`).join('')}</select>
    <label style="${lb}">業務（要跟業務名單一致，通知才找得到人）</label><input id="mdEdRep" list="mdRepList" value="${mdEsc(it.rep || '')}" style="${fs}">
    <label style="${lb}">備註</label><input id="mdEdNote" value="${mdEsc(it.note || '')}" style="${fs}">
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;">
      <button type="button" onclick="document.getElementById('mdEditOverlay').remove()" style="padding:7px 16px;border:1px solid #ddd;background:#fff;border-radius:8px;cursor:pointer;">取消</button>
      <button type="button" id="mdEdSave" onclick="mdEditSave('${it.id}')" style="padding:7px 18px;border:0;background:#F0A050;color:#fff;font-weight:600;border-radius:8px;cursor:pointer;">儲存</button>
    </div></div>`;
  document.body.appendChild(ov);
}
async function mdEditSave(id){
  const it = MD_ITEMS.find(x => x.id === id); if(!it) return;
  const body = {
    doc_type: document.getElementById('mdEdType').value,
    provider: document.getElementById('mdEdProv').value,
    rep: document.getElementById('mdEdRep').value.trim(),
    note: document.getElementById('mdEdNote').value.trim(),
  };
  const btn = document.getElementById('mdEdSave'); btn.disabled = true; btn.textContent = '儲存中…';
  if(await mdPatch(id, body)){ document.getElementById('mdEditOverlay').remove(); mdLoad(); }
  else { btn.disabled = false; btn.textContent = '儲存'; }
}
async function mdDelete(id){
  const it = MD_ITEMS.find(x => x.id === id); if(!it) return;
  if(!confirm('確定刪除「' + (it.alias || it.case_no) + '」的「' + it.doc_type + '」這筆缺件？（拿到了請按「已拿到」，不要刪）')) return;
  const res = await fetch(API_BASE + '/api/missing-docs/' + id, {method: 'DELETE'});
  if(!res.ok){ alert('刪除失敗'); return; }
  mdLoad();
}
async function mdConfirmAll(){
  const open = MD_ITEMS.filter(i => i.status === '缺件' && (!MD_VENDOR_FILTER || i.vendor === MD_VENDOR_FILTER));
  const ids = (MD_FILTER === 'due' ? open.filter(mdIsDue) : open).map(i => i.id);
  if(!ids.length) return;
  const res = await fetch(API_BASE + '/api/missing-docs/confirm', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ids})});
  const data = await res.json().catch(() => ({}));
  if(!res.ok || data.error){ alert('更新失敗：' + (data.error || res.status)); return; }
  mdLoad();
}

// ---------- 通知業務（先預覽、按送出才真的推播）----------
var MD_BOUND_NAMES = null;
async function mdBoundNames(){
  if(MD_BOUND_NAMES) return MD_BOUND_NAMES;
  try{ const r = await fetch(API_BASE + '/api/line/bound-names'); const d = await r.json(); MD_BOUND_NAMES = d.names || []; }catch(e){ MD_BOUND_NAMES = []; }
  return MD_BOUND_NAMES;
}
function mdAsstChanged(){ const v = document.getElementById('mdAsstTo').value.trim(); mdStore('assistant', v); mdNotifyOpen('', 'assistant', true); }

// role='assistant':傳給業務助理(收件人自己選,記在這個瀏覽器);否則傳給 rep 這位業務
async function mdNotifyOpen(rep, role, keepOpen){
  const isAsst = role === 'assistant';
  const ov = document.getElementById('mdNoticeOverlay');
  const body = document.getElementById('mdNoticeBody');
  const to = isAsst ? (keepOpen && document.getElementById('mdAsstTo') ? document.getElementById('mdAsstTo').value.trim() : mdStore('assistant')) : '';
  if(!keepOpen) body.innerHTML = '<div class="login-note">整理訊息中…</div>';
  ov.classList.add('show');
  try{
    const url = isAsst
      ? API_BASE + '/api/missing-docs/notice?role=assistant&to=' + encodeURIComponent(to) + '&vendor=' + encodeURIComponent(MD_VENDOR_FILTER || '')
      : API_BASE + '/api/missing-docs/notice?rep=' + encodeURIComponent(rep);
    const res = await fetch(url);
    const data = await res.json();
    if(data.error) throw new Error(data.error);
    MD_NOTICE = data;
    const names = isAsst ? await mdBoundNames() : [];
    const toBox = isAsst
      ? `<div style="margin-bottom:8px;font-size:13px;">傳給：<input id="mdAsstTo" class="cert-rename-input vm-in" list="mdAsstList" value="${mdEsc(to)}" placeholder="選一位業務助理（已綁定 LINE／Slack 的名單）" style="width:260px;max-width:100%;" onchange="mdAsstChanged()">` +
        `<datalist id="mdAsstList">${names.map(n => `<option value="${mdEsc(n)}"></option>`).join('')}</datalist></div>` : '';
    if(!data.count){
      body.innerHTML = toBox + '<div class="login-note">' + (isAsst ? '目前沒有業務助理要處理的缺件' : mdEsc(rep) + ' 名下沒有需要通知的缺件') + '</div>';
      return;
    }
    const who = isAsst ? (to || '（還沒選收件人）') : rep;
    const canSend = data.bound && (!isAsst || to);
    body.innerHTML = toBox +
      `<div class="md-sub" style="margin-bottom:6px;">將傳給：<b>${mdEsc(who)}</b>（共 ${data.count} 項）` +
      (!isAsst || to ? (data.bound ? ' ✅ 已綁定 LINE／Slack' : ' <span class="md-due">⚠ 這位還沒綁定 LINE／Slack，無法直接推播，請複製文字自己貼給他</span>') : ' <span class="md-due">⚠ 請先在上面選收件人</span>') + '</div>' +
      (data.cards ? `<div class="md-sub" style="margin-bottom:6px;">📇 實際會用<b>字卡</b>送出（共 ${data.cards} 張，業務可左右滑；每個案場有「📂 上傳」按鈕開業務雲端資料夾）。下面是文字版，給你複製用。` +
        ((data.no_folder || []).length ? ` <span class="md-due">⚠ 這些案場找不到資料夾連結、沒有上傳按鈕：${mdEsc(data.no_folder.join('、'))}</span>` : '') + '</div>' : '') +
      `<textarea id="mdNoticeText" class="md-notice-text" readonly>${mdEsc(data.text)}</textarea>` +
      `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap;">` +
      `<button class="btn btn-ghost md-btn" onclick="mdNoticeCopy()">📋 複製文字</button>` +
      `<button class="btn btn-ghost md-btn" id="mdNoticeMark" onclick="mdNoticeMark()" title="不會推播，只在系統記下「已通知」，列表上就不會再顯示未通知">✅ 確認已通知（我自己傳的）</button>` +
      `<button class="btn btn-ghost md-btn" onclick="mdNoticeClose()">取消</button>` +
      (canSend ? `<button class="btn btn-primary md-btn" id="mdNoticeSend" onclick="mdNoticeSend()">📨 確認送出</button>` : '') + '</div>';
  }catch(e){
    body.innerHTML = '<div class="login-note">整理訊息失敗：' + mdEsc(e.message || e) + '</div>';
  }
}
function mdNoticeClose(){ document.getElementById('mdNoticeOverlay').classList.remove('show'); }
function mdNoticeCopy(){
  const ta = document.getElementById('mdNoticeText');
  if(!ta) return;
  ta.select();
  try{ navigator.clipboard.writeText(ta.value); }catch(e){ document.execCommand('copy'); }
  const mk = document.getElementById('mdNoticeMark');
  if(mk){ mk.classList.remove('btn-ghost'); mk.classList.add('btn-primary'); }   // 複製完，提醒下一步是按「確認已通知」
}
// 使用者自己把文字貼給對方後，按這顆只在系統記錄「已通知」，不會推播
async function mdNoticeMark(){
  if(!MD_NOTICE) return;
  if(!confirm('要把這 ' + MD_NOTICE.count + ' 項標記為「已通知 ' + (MD_NOTICE.rep || '業務助理') + '」嗎？\n（只是記錄，系統不會再發任何訊息）')) return;
  const btn = document.getElementById('mdNoticeMark'); btn.disabled = true; btn.textContent = '記錄中…';
  try{
    const res = await fetch(API_BASE + '/api/missing-docs/notify', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(MD_NOTICE.role === 'assistant' ? {role: 'assistant', to: MD_NOTICE.to, ids: MD_NOTICE.ids, manual: true} : {rep: MD_NOTICE.rep, ids: MD_NOTICE.ids, manual: true})});
    const data = await res.json();
    if(!res.ok || data.error) throw new Error(data.error || res.status);
    mdNoticeClose();
    mdLoad();
  }catch(e){
    btn.disabled = false; btn.textContent = '✅ 確認已通知（我自己傳的）';
    alert('記錄失敗：' + (e.message || e));
  }
}
// 按「確認送出」：傳給業務，同時傳一份一模一樣的副本到你自己的 LINE／Slack（確認業務看到的樣子）
async function mdNoticeSend(){
  if(!MD_NOTICE) return;
  if(MD_NOTICE.role !== 'assistant' && !confirm('確定傳給業務「' + MD_NOTICE.rep + '」嗎？' + '\n' + '（同時會傳一份一模一樣的副本到你自己的 LINE，讓你看業務看到的樣子）')) return;
  mdNoticeDoSend('');
}
async function mdNoticeDoSend(to){
  if(!MD_NOTICE) return;
  const btn = document.getElementById('mdNoticeSend');
  btn.disabled = true; btn.textContent = '送出中…';
  try{
    const res = await fetch(API_BASE + '/api/missing-docs/notify', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(MD_NOTICE.role === 'assistant' ? {role: 'assistant', to: MD_NOTICE.to, ids: MD_NOTICE.ids} : {rep: MD_NOTICE.rep, ids: MD_NOTICE.ids, to: to || MD_NOTICE.rep})});
    const data = await res.json();
    if(!res.ok || data.error) throw new Error(data.error || res.status);
    if(!data.sent){ btn.disabled = false; btn.textContent = '📨 確認送出'; alert('推播沒有成功（可能 LINE 額度用完且沒綁 Slack），請改用「複製文字」自己貼給他。'); return; }
    mdNoticeClose();
    alert('✅ 已通知 ' + MD_NOTICE.rep + '（' + data.count + ' 項）' + (MD_NOTICE.role !== 'assistant' ? (data.copied ? '。副本已傳到你的 LINE。' : '。（副本沒有傳成功／不需要）') : ''));
    mdLoad();
  }catch(e){
    btn.disabled = false; btn.textContent = '📨 確認送出';
    alert('送出失敗：' + (e.message || e));
  }
}
