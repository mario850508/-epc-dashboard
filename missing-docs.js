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
let MD_DELETED = [];
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
    MD_DELETED = data.deleted || [];
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
  mdSuppliedPopup();
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
  const gotPend = pool.filter(i => i.status === '已取得' && i.vendor && !i.vendor_notified && i.got && MD_TODAY && mdDaysBetween(i.got, MD_TODAY) <= 21);
  const got = pool.filter(i => i.status === '已取得').sort((a, b) => (b.got || '').localeCompare(a.got || '')).slice(0, 60);
  document.getElementById('mdSummary').innerHTML =
    `缺件中 <b>${open.length}</b> 項，涉及 <b>${new Set(open.map(i => i.alias || i.case_no)).size}</b> 個案場；` +
    (due.length ? `<span class="md-due">⏰ ${due.length} 項已超過 ${MD_DUE_DAYS} 天沒確認</span>` : '本週都確認過了 ✅');
  document.getElementById('mdFilters').innerHTML =
    [['open', `缺件中（${open.length}）`], ['unn', `🆕 未通知（${unn.length}）`], ['sup', `📬 業務已補件（${sup.length}）`], ['del', `🗑 最近刪除（${MD_DELETED.length}）`], ['due', `本週待確認（${due.length}）`], ['got', `已取得（${got.length}）`]]
      .map(([k, l]) => `<button class="md-chip ${MD_FILTER === k ? 'on' : ''}" onclick="mdSetFilter('${k}')">${l}</button>`).join('') +
    '<span class="md-sep"></span>廠商：' + ((typeof MD_LOCK_VENDOR !== 'undefined' && MD_LOCK_VENDOR) ? `<b>${mdEsc(MD_LOCK_VENDOR)}</b>` :
      '<select class="cert-rename-input" style="padding:3px 8px;" onchange="MD_VENDOR_FILTER=this.value;mdRender()"><option value="">全部</option>' +
      MD_VENDORS.map(v => `<option value="${mdEsc(v)}" ${MD_VENDOR_FILTER === v ? 'selected' : ''}>${mdEsc(v)}</option>`).join('') + '</select>') +
    '<span class="md-sep"></span>' + `<button class="btn ${gotPend.length ? 'btn-primary' : 'btn-ghost'} md-btn" onclick="mdGotNoticeOpen()" title="把最近已拿到的資料整理成訊息，通知廠商已補件">📣 通知廠商已補件（${gotPend.length}）</button>` +
    '<span class="md-sep"></span>' + `<button class="btn btn-ghost md-btn" onclick="mdHandoverOpen()" title="業務離職時，把他名下的缺件交接給繼任業務">👥 業務離職交接</button>` +
    '<span class="md-sep"></span>分組：' +
    [['rep', '業務'], ['type', '缺件類型'], ['case', '案場']]
      .map(([k, l]) => `<button class="md-chip ${MD_GROUP === k ? 'on' : ''}" onclick="mdSetGroup('${k}')">${l}</button>`).join('');
  const confirmBtn = document.getElementById('mdConfirmAllBtn');
  confirmBtn.style.display = (MD_FILTER === 'due' && due.length) || (MD_FILTER === 'open' && open.length) ? '' : 'none';
  confirmBtn.textContent = MD_FILTER === 'due' ? `✅ 這 ${due.length} 項本週都確認過了` : `✅ 全部 ${open.length} 項標為本週已確認`;

  if(MD_FILTER === 'del'){ box.innerHTML = mdDeletedHtml(); return; }
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
    const nameLink = !notifyBtn ? mdEsc(k)
      : (k === MD_ASSIST_KEY ? `<a href="#" class="md-rep-link" onclick="mdNotifyOpen('', 'assistant'); return false;" title="看這位所有廠商的缺件，並傳字卡">${mdEsc(k)}</a>`
        : `<a href="#" class="md-rep-link" onclick="mdNotifyOpen(${JSON.stringify(k).replace(/"/g, '&quot;')}); return false;" title="看這位業務所有廠商的缺件，並傳字卡">${mdEsc(k)}</a>`);
    return `<div class="md-group"><div class="md-group-head"><span>${nameLink} <span class="md-sub">${its.length} 項${MD_VENDOR_FILTER ? '（只算' + mdEsc(MD_VENDOR_FILTER) + '）' : ''}</span>${mdHandoverNote(its)}</span>${notifyBtn}</div>` +
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
    `<td class="md-note" onclick="mdEditNote('${it.id}')" title="點一下修改備註">${it.source === '廠商填報' ? '<span class="md-tag-v" title="廠商在預約頁自己填的' + (it.reporter ? '；填報人：' + mdEsc(it.reporter) : '') + '" style="display:inline-block;font-size:11px;font-weight:700;background:#FFF1D6;color:#B45309;border-radius:99px;padding:0 7px;margin-right:4px;">🏭廠商填報</span>' : ''}${it.handover_from ? '<span title="這位業務已離職，案件由繼任業務接手" style="display:inline-block;font-size:11px;font-weight:700;background:#E0E7FF;color:#3730A3;border-radius:99px;padding:0 7px;margin-right:4px;white-space:nowrap;">↪ ' + mdEsc(it.handover_from) + '的案件</span>' : ''}${it.note ? mdEsc(it.note) : '<span class="md-sub">＋備註</span>'}</td>` +
    (!showRep ? '' : `<td onclick="mdEditRep('${it.id}')" title="點一下修改業務">${mdEsc(it.rep) || '<span class="md-sub">＋業務</span>'}</td>`) +
    `<td>${mdEsc(it.provider)}</td>` +
    `<td>${isGot ? '✔ ' + mdMD(it.got) : (days == null ? '—' : days + ' 天')}</td>` +
    `<td>${due ? '<span class="md-due">⏰ ' : '<span>'}${mdMD(mdLastCheck(it))}</span></td>` +
    `<td>${it.notified ? mdMD(it.notified) + (it.notify_count > 1 ? '（' + it.notify_count + '次）' : '') : (mdNeedNotify(it) ? '<span class="md-due" style="white-space:nowrap;">🆕 未通知</span>' : '—')}` +
    `${isGot ? '<div><span style="font-size:11px;white-space:nowrap;' + (it.vendor_notified ? 'color:#15803D;' : 'color:#B45309;') + '">' + (it.vendor_notified ? '📣 已通知廠商 ' + mdMD(it.vendor_notified) : '📣 還沒通知廠商') + '</span></div>' : ''}` +
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
  if(!confirm('確定刪除「' + (it.alias || it.case_no) + '」的「' + it.doc_type + '」這筆缺件？（拿到了請按「已拿到」，不要刪。刪錯了可以到上面「最近刪除」還原）')) return;
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
    setTimeout(() => mdSlackLoad(isAsst ? to : rep, data.slack_id || ''), 0);
    const canSend = data.bound && (!isAsst || to);
    body.innerHTML = toBox +
      `<div class="md-sub" style="margin-bottom:6px;">將傳給：<b>${mdEsc(who)}</b>（共 ${data.count} 項）` +
      (!isAsst || to ? (data.bound ? ' ✅ 已綁定 LINE／Slack' : ' <span class="md-due">⚠ 這位還沒綁定 LINE／Slack，無法直接推播，請複製文字自己貼給他</span>') : ' <span class="md-due">⚠ 請先在上面選收件人</span>') + '</div>' +
      mdNoticeItemsHtml(data.items) +
      (data.cards ? `<div class="md-sub" style="margin-bottom:6px;">📇 實際會用<b>字卡</b>送出（共 ${data.cards} 張，業務可左右滑；每個案場有「📂 上傳」按鈕開業務雲端資料夾）。下面是文字版，給你複製用。` +
        ((data.no_folder || []).length ? ` <span class="md-due">⚠ 這些案場找不到資料夾連結、沒有上傳按鈕：${mdEsc(data.no_folder.join('、'))}</span>` : '') + '</div>' : '') +
      `<textarea id="mdNoticeText" class="md-notice-text" readonly>${mdEsc(data.text)}</textarea>` +
      (data.slack_me_ready ? `<div style="margin-top:10px;padding:8px 10px;border:1px solid #E5E7EB;border-radius:10px;font-size:13px;">💬 用<b>我的 Slack</b>傳給：` +
        `<input id="mdSlackTo" class="cert-rename-input vm-in" list="mdSlackList" placeholder="載入 Slack 成員中…" style="width:230px;max-width:100%;margin:0 6px;" onfocus="mdSlackFocus(this)" onblur="mdSlackBlur(this)" onchange="mdSlackPicked()">` +
        `<datalist id="mdSlackList"></datalist>` +
        `<button class="btn btn-ghost md-btn" id="mdNoticeSlackMe" onclick="mdNoticeSlackMe()" title="用你本人的 Slack 帳號私訊（字卡有「上傳」「已補件」按鈕），不需要對方綁定">💬 用我的 Slack 傳</button>` +
        `<div class="md-sub" style="margin-top:4px;">直接從 Slack 成員挑人就好，不用綁定。</div></div>` : '') +
      `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap;">` +
      `<button class="btn btn-ghost md-btn" onclick="mdNoticeCopy()">📋 複製文字</button>` +
      `<button class="btn btn-ghost md-btn" id="mdNoticeMark" onclick="mdNoticeMark()" title="不會推播，只在系統記下「已通知」，列表上就不會再顯示未通知">✅ 確認已通知（我自己傳的）</button>` +
      `<button class="btn btn-ghost md-btn" onclick="mdNoticeClose()">取消</button>` +
      (canSend ? `<button class="btn btn-ghost md-btn" id="mdNoticeSend" onclick="mdNoticeSend()" title="由機器人傳給這位業務，並傳一份副本給你">📨 確認送出（機器人）</button>` : '') +
      (data.share_url ? `<a class="btn btn-primary md-btn" href="${mdEsc(data.share_url)}" target="_blank" rel="noopener" onclick="mdSharePending()" style="text-decoration:none;" title="用你自己的 LINE 開啟，自己選要傳給哪位業務或群組">📤 用我的 LINE 傳（自己選對象）</a>` : '') + '</div>';
  }catch(e){
    body.innerHTML = '<div class="login-note">整理訊息失敗：' + mdEsc(e.message || e) + '</div>';
  }
}
// 用自己的 Slack 傳：挑 Slack 成員（不需綁定）。預選順序：已綁定的 Slack > 名字剛好對得上的唯一一位
var MD_SLACK_USERS = null;
var MD_SLACK_PICK = {};   // 顯示文字 → Slack ID
async function mdSlackLoad(rep, boundId){
  const inp = document.getElementById('mdSlackTo');
  if(!inp) return;
  try{
    if(!MD_SLACK_USERS){ const r = await fetch(API_BASE + '/api/slack/users'); const d = await r.json(); MD_SLACK_USERS = d.users || []; }
  }catch(e){ MD_SLACK_USERS = []; }
  MD_SLACK_PICK = {};
  const label = u => u.name + (u.display && u.display !== u.name ? '（' + u.display + '）' : '');
  MD_SLACK_USERS.forEach(u => { MD_SLACK_PICK[label(u)] = u.id; });
  const dl = document.getElementById('mdSlackList');
  if(dl) dl.innerHTML = MD_SLACK_USERS.map(u => `<option value="${mdEsc(label(u))}">`).join('');
  inp.placeholder = MD_SLACK_USERS.length ? '輸入或選一位 Slack 成員' : '讀不到 Slack 成員名單';
  let pre = boundId ? MD_SLACK_USERS.find(u => u.id === boundId) : null;
  if(!pre && rep){
    const hit = MD_SLACK_USERS.filter(u => (u.name || '').includes(rep) || (u.display || '').includes(rep) || (rep.length > 1 && (rep.includes(u.name) || (u.display && rep.includes(u.display)))));
    if(hit.length === 1) pre = hit[0];
  }
  if(pre) inp.value = label(pre);
}
// 點進欄位先清空，下拉才會列出全部 76 人（瀏覽器的下拉只列出符合目前文字的選項）；沒選就離開則還原
function mdSlackFocus(el){ el.dataset.prev = el.value; el.value = ''; }
function mdSlackBlur(el){ if(!el.value.trim() && el.dataset.prev) el.value = el.dataset.prev; }
function mdSlackPicked(){ /* 欄位值本身就是選擇，不需另外處理 */ }
// 用自己的 LINE 傳字卡：另開分頁去 LINE 選人，回到這個分頁時自動重新整理（傳送後後端會把缺件記成已通知）
let MD_SHARE_PENDING = false;
function mdSharePending(){
  MD_SHARE_PENDING = true;
  window.addEventListener('focus', function once(){
    window.removeEventListener('focus', once);
    if(MD_SHARE_PENDING){ MD_SHARE_PENDING = false; mdNoticeClose(); mdLoad(); }
  });
}
// 通知視窗上方：這位業務在「所有廠商」的缺件，依廠商分段（不受頁面上方廠商篩選影響）
function mdNoticeItemsHtml(items){
  if(!items || !items.length) return '';
  const byVendor = new Map();
  items.forEach(it => { const v = it.vendor || '（未填廠商）'; if(!byVendor.has(v)) byVendor.set(v, []); byVendor.get(v).push(it); });
  const badge = it => it.supplied ? '<span style="color:#15803D;font-weight:700;">📬 已補件 ' + mdMD(it.supplied) + '</span>'
    : (it.notified ? '<span class="md-sub">已通知 ' + mdMD(it.notified) + '</span>' : '<span class="md-due">🆕 未通知</span>');
  return '<div style="border:1px solid #E5E7EB;border-radius:10px;padding:8px 10px;margin-bottom:8px;max-height:230px;overflow:auto;">' +
    '<div class="md-sub" style="margin-bottom:4px;">這位業務所有廠商的缺件，共 ' + items.length + ' 項</div>' +
    Array.from(byVendor.entries()).map(([v, its]) =>
      '<div style="font-weight:700;margin-top:6px;">◆ ' + mdEsc(v) + ' <span class="md-sub">' + its.length + ' 項</span></div>' +
      its.map(it => '<div style="display:flex;gap:8px;justify-content:space-between;font-size:13px;padding:2px 0;">' +
        '<span><b>' + mdEsc(it.alias) + '</b>' + (it.handover_from ? '<span class="md-sub">（' + mdEsc(it.handover_from) + '的案件）</span>' : '') + '　' + mdEsc(it.doc_type) + (it.note ? '<span class="md-sub">（' + mdEsc(it.note) + '）</span>' : '') +
        (it.provider === '業務助理' ? ' <span class="md-sub">・業務助理處理</span>' : '') + '</span>' +
        '<span style="white-space:nowrap;">' + badge(it) + '</span></div>').join('')).join('') + '</div>';
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
// 用使用者本人的 Slack 帳號私訊這位業務（不是機器人）：字卡每個案場有「上傳」「已補件」按鈕，傳完自動記已通知
async function mdNoticeSlackMe(){
  if(!MD_NOTICE) return;
  const pickedLabel = (document.getElementById('mdSlackTo') || {}).value || '';
  const slackTo = MD_SLACK_PICK[pickedLabel.trim()] || '';
  if(!slackTo){ alert('請先從清單選一位 Slack 成員（要選清單裡的名字）'); return; }
  const who = pickedLabel.trim();
  if(!confirm('確定用你自己的 Slack 帳號，私訊「' + who + '」嗎？（共 ' + MD_NOTICE.count + ' 項缺件）')) return;
  const btn = document.getElementById('mdNoticeSlackMe'); btn.disabled = true; btn.textContent = '傳送中…';
  try{
    const res = await fetch(API_BASE + '/api/missing-docs/notify', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(MD_NOTICE.role === 'assistant' ? {role: 'assistant', to: MD_NOTICE.to, ids: MD_NOTICE.ids, via: 'slack_me', slack_to: slackTo} : {rep: MD_NOTICE.rep, ids: MD_NOTICE.ids, via: 'slack_me', slack_to: slackTo})});
    const data = await res.json();
    if(!res.ok || data.error && !data.sent) throw new Error(data.error || res.status);
    if(!data.sent) throw new Error(data.error || '沒有送出');
    mdNoticeClose();
    alert('✅ 已用你的 Slack 私訊 ' + who + '（' + data.count + ' 項），並記成已通知。');
    mdLoad();
  }catch(e){
    btn.disabled = false; btn.textContent = '💬 用我的 Slack 傳';
    alert('Slack 傳送失敗：' + (e.message || e));
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
    if(!data.sent){ btn.disabled = false; btn.textContent = '📨 確認送出（機器人）'; alert('推播沒有成功（可能 LINE 額度用完且沒綁 Slack），請改用「複製文字」自己貼給他。'); return; }
    mdNoticeClose();
    alert('✅ 已通知 ' + MD_NOTICE.rep + '（' + data.count + ' 項）' + (MD_NOTICE.role !== 'assistant' ? (data.copied ? '。副本已傳到你的 LINE。' : '。（副本沒有傳成功／不需要）') : ''));
    mdLoad();
  }catch(e){
    btn.disabled = false; btn.textContent = '📨 確認送出（機器人）';
    alert('送出失敗：' + (e.message || e));
  }
}

// ---------- 通知廠商已補件（先預覽、複製貼給廠商、按「確認已通知廠商」只記日期）----------
async function mdGotNoticeOpen(){
  const ov = document.getElementById('mdNoticeOverlay');
  const body = document.getElementById('mdNoticeBody');
  body.innerHTML = '<div class="login-note">整理訊息中…</div>';
  ov.classList.add('show');
  try{
    const res = await fetch(API_BASE + '/api/missing-docs/got-notice?vendor=' + encodeURIComponent(MD_VENDOR_FILTER || ''));
    const data = await res.json();
    if(data.error) throw new Error(data.error);
    if(!data.groups.length){
      body.innerHTML = '<div class="login-note">最近 ' + (data.days || 21) + ' 天內「已拿到」的資料，都已經通知過廠商了 ✅</div>' +
        '<div style="text-align:right;margin-top:10px;"><button class="btn btn-ghost md-btn" onclick="mdNoticeClose()">關閉</button></div>';
      return;
    }
    body.innerHTML = '<div class="md-sub" style="margin-bottom:8px;">下面是要通知廠商的「已補件」訊息（只含最近 ' + (data.days || 21) + ' 天標成已拿到、還沒通知廠商的）。複製貼給廠商後，按「確認已通知廠商」記錄；系統不會自己發給廠商。</div>' +
      data.groups.map((g, i) =>
        `<div style="border:1px solid #E5E7EB;border-radius:10px;padding:10px;margin-bottom:10px;">` +
        `<div style="font-weight:700;margin-bottom:6px;">${mdEsc(g.vendor)} <span class="md-sub">${g.count} 項</span></div>` +
        `<textarea id="mdGotText${i}" class="md-notice-text" readonly>${mdEsc(g.text)}</textarea>` +
        `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;flex-wrap:wrap;">` +
        `<button class="btn btn-ghost md-btn" onclick="mdGotNoticeCopy(${i})">📋 複製文字</button>` +
        `<button class="btn btn-ghost md-btn" id="mdGotMark${i}" onclick='mdGotNoticeMark(${i}, ${JSON.stringify(g.ids)})'>✅ 確認已通知廠商</button></div></div>`).join('') +
      '<div style="text-align:right;"><button class="btn btn-ghost md-btn" onclick="mdNoticeClose()">關閉</button></div>';
  }catch(e){
    body.innerHTML = '<div class="login-note">整理訊息失敗：' + mdEsc(e.message || e) + '</div>';
  }
}
function mdGotNoticeCopy(i){
  const ta = document.getElementById('mdGotText' + i);
  if(!ta) return;
  ta.select();
  try{ navigator.clipboard.writeText(ta.value); }catch(e){ document.execCommand('copy'); }
  const mk = document.getElementById('mdGotMark' + i);
  if(mk){ mk.classList.remove('btn-ghost'); mk.classList.add('btn-primary'); }   // 複製完，提醒下一步是按「確認已通知廠商」
}
async function mdGotNoticeMark(i, ids){
  if(!confirm('要把這 ' + ids.length + ' 項標記為「已通知廠商」嗎？' + '\n' + '（只是記錄，系統不會發任何訊息）')) return;
  const btn = document.getElementById('mdGotMark' + i); btn.disabled = true; btn.textContent = '記錄中…';
  try{
    const res = await fetch(API_BASE + '/api/missing-docs/got-notice/mark', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ids})});
    const data = await res.json();
    if(!res.ok || data.error) throw new Error(data.error || res.status);
    await mdLoad();
    mdGotNoticeOpen();   // 重新整理這個視窗：剩下還沒通知的廠商
  }catch(e){
    btn.disabled = false; btn.textContent = '✅ 確認已通知廠商';
    alert('記錄失敗：' + (e.message || e));
  }
}

// ---------- 最近刪除（可還原）----------
function mdDeletedHtml(){
  const pool = MD_VENDOR_FILTER ? MD_DELETED.filter(i => i.vendor === MD_VENDOR_FILTER) : MD_DELETED;
  if(!pool.length) return '<div class="login-note">沒有最近刪除的缺件（刪除後會保留 60 天，可在這裡還原）</div>';
  return '<div class="md-sub" style="margin-bottom:8px;">刪掉的缺件會保留 60 天，按「↩ 還原」就會回到原本的狀態。</div>' +
    '<div class="md-table-wrap"><table class="md-table"><thead><tr><th>案場</th><th>缺件類型</th><th>備註</th><th>業務</th><th>廠商</th><th>刪除日</th><th>刪除前</th><th></th></tr></thead><tbody>' +
    pool.map(it => `<tr><td><b>${mdEsc(it.alias || it.case_no)}</b></td><td>${mdEsc(it.doc_type)}</td><td class="md-note">${mdEsc(it.note)}</td><td>${mdEsc(it.rep)}</td><td>${mdEsc(it.vendor)}</td><td>${mdMD(it.deleted)}</td><td>${mdEsc(it.prev_status || '缺件')}</td>` +
      `<td class="md-actions"><button class="md-mini md-ok" onclick="mdRestore('${it.id}')">↩ 還原</button></td></tr>`).join('') + '</tbody></table></div>';
}
async function mdRestore(id){
  const res = await fetch(API_BASE + '/api/missing-docs/' + id + '/restore', {method: 'POST'});
  const data = await res.json().catch(() => ({}));
  if(!res.ok || data.error){ alert('還原失敗：' + (data.error || res.status)); return; }
  await mdLoad();
}

// ---------- 業務離職交接（2026-11-16）----------
function mdHandoverNote(its){
  const from = Array.from(new Set(its.map(i => i.handover_from).filter(Boolean)));
  return from.length ? ' <span style="font-size:11px;font-weight:700;background:#E0E7FF;color:#3730A3;border-radius:99px;padding:0 7px;white-space:nowrap;">含 ' + from.map(mdEsc).join('、') + ' 交接</span>' : '';
}
async function mdHandoverOpen(){
  let ov = document.getElementById('mdHandoverOverlay');
  if(!ov){
    ov = document.createElement('div');
    ov.id = 'mdHandoverOverlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px;';
    ov.onclick = e => { if(e.target === ov) ov.remove(); };
    document.body.appendChild(ov);
  }
  ov.innerHTML = '<div style="background:#fff;border-radius:14px;width:100%;max-width:480px;padding:18px 20px;max-height:92vh;overflow:auto;"><div class="login-note">讀取中…</div></div>';
  try{
    const res = await fetch(API_BASE + '/api/missing-docs/handover');
    const d = await res.json();
    if(!res.ok || d.error) throw new Error(d.error || res.status);
    const fs = 'width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box;font-family:inherit;';
    const lb = 'display:block;font-size:12px;color:#888;margin:10px 0 4px;';
    const list = (d.handovers || []).map(h => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #eee;font-size:13px;">` +
      `<span><b>${mdEsc(h.from)}</b> → <b>${mdEsc(h.to)}</b> <span class="md-sub">（${mdMD(h.since)} 起，目前 ${h.count} 項）</span></span>` +
      `<button class="md-mini" onclick="mdHandoverCancel(${JSON.stringify(h.from).replace(/"/g, '&quot;')})">取消交接</button></div>`).join('');
    ov.firstElementChild.innerHTML = `<div style="font-weight:700;font-size:15px;">👥 業務離職交接</div>
      <div style="font-size:13px;color:#666;margin-top:4px;line-height:1.6;">選離職的業務和繼任的業務後，他名下的缺件（含之後新增的）會歸到繼任業務底下一起通知；訊息裡案場名稱後面會註明「某某的案件」。原本的資料不會被改掉，取消交接就恢復。</div>
      <label style="${lb}">離職的業務</label>
      <input id="mdHvFrom" list="mdHvFromList" placeholder="選或輸入名字" style="${fs}">
      <datalist id="mdHvFromList">${(d.candidates || []).map(n => `<option value="${mdEsc(n)}">`).join('')}</datalist>
      <label style="${lb}">交接給（繼任業務）</label>
      <input id="mdHvTo" list="mdHvToList" placeholder="選一位繼任的業務" style="${fs}">
      <datalist id="mdHvToList">${(d.reps || []).map(n => `<option value="${mdEsc(n)}">`).join('')}</datalist>
      <div style="font-size:12px;color:#B45309;margin-top:8px;">交接時會把這些缺件舊的「已通知」記錄清掉，繼任業務才會顯示為未通知、可以重新通知。</div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px;">
        <button type="button" onclick="document.getElementById('mdHandoverOverlay').remove()" style="padding:7px 16px;border:1px solid #ddd;background:#fff;border-radius:8px;cursor:pointer;">關閉</button>
        <button type="button" id="mdHvSave" onclick="mdHandoverSave()" style="padding:7px 18px;border:0;background:#F0A050;color:#fff;font-weight:600;border-radius:8px;cursor:pointer;">確定交接</button>
      </div>` + (list ? `<div style="margin-top:16px;font-weight:700;font-size:13px;">目前的交接</div>${list}` : '');
  }catch(e){
    ov.firstElementChild.innerHTML = '<div class="login-note">讀取失敗：' + mdEsc(e.message || e) + '</div><div style="text-align:right;"><button onclick="document.getElementById(\'mdHandoverOverlay\').remove()" style="padding:7px 16px;border:1px solid #ddd;background:#fff;border-radius:8px;cursor:pointer;">關閉</button></div>';
  }
}
async function mdHandoverSave(){
  const from = document.getElementById('mdHvFrom').value.trim();
  const to = document.getElementById('mdHvTo').value.trim();
  if(!from || !to){ alert('請填離職的業務和繼任的業務'); return; }
  if(!confirm('確定把「' + from + '」名下的缺件交接給「' + to + '」嗎？')) return;
  const btn = document.getElementById('mdHvSave'); btn.disabled = true; btn.textContent = '處理中…';
  try{
    const res = await fetch(API_BASE + '/api/missing-docs/handover', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({from, to})});
    const d = await res.json().catch(() => ({}));
    if(!res.ok || d.error) throw new Error(d.error || res.status);
    alert('✅ 已交接：' + from + ' → ' + to + '（目前 ' + d.moved + ' 項缺件改歸 ' + to + '）');
    await mdLoad();
    mdHandoverOpen();
  }catch(e){ alert('交接失敗：' + (e.message || e)); btn.disabled = false; btn.textContent = '確定交接'; }
}
async function mdHandoverCancel(from){
  if(!confirm('確定取消「' + from + '」的交接嗎？缺件會回到他自己名下。')) return;
  try{
    const res = await fetch(API_BASE + '/api/missing-docs/handover', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({from, to: ''})});
    const d = await res.json().catch(() => ({}));
    if(!res.ok || d.error) throw new Error(d.error || res.status);
    await mdLoad();
    mdHandoverOpen();
  }catch(e){ alert('取消失敗：' + (e.message || e)); }
}

// ---------- 業務已補件提示（2026-11-19）：業務按了「✅ 已補件」→ 進頁面時跳出，可一鍵確認並傳「補件完成」卡片給廠商 ----------
function mdSupAcked(){ try{ return JSON.parse(localStorage.getItem('md_sup_ack') || '[]'); }catch(e){ return []; } }
function mdSupPending(){
  const acked = new Set(mdSupAcked());
  return MD_ITEMS.filter(i => i.status === '缺件' && i.supplied && !acked.has(i.id + '|' + i.supplied));
}
function mdSuppliedPopup(force){
  if(!force){ try{ if(sessionStorage.getItem('md_sup_dismiss')) return; }catch(e){} }
  const list = mdSupPending();
  let ov = document.getElementById('mdSupOverlay');
  if(!list.length){ if(ov) ov.remove(); return; }
  if(!ov){
    ov = document.createElement('div');
    ov.id = 'mdSupOverlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px;';
    document.body.appendChild(ov);
  }
  const byVendor = new Map();
  list.forEach(i => { const v = i.vendor || '（未填廠商）'; if(!byVendor.has(v)) byVendor.set(v, []); byVendor.get(v).push(i); });
  const byCase = its => { const m = new Map(); its.forEach(i => { const k = i.alias || i.case_no; if(!m.has(k)) m.set(k, []); m.get(k).push(i); }); return [...m.entries()]; };
  ov.innerHTML = `<div style="background:#fff;border-radius:14px;width:100%;max-width:560px;padding:18px 20px;max-height:92vh;overflow:auto;">
    <div style="font-weight:700;font-size:16px;">📬 業務已補件，請確認（${list.length} 項）</div>
    <div style="font-size:13px;color:#666;margin:4px 0 10px;line-height:1.6;">以下是業務／業務助理按了「✅ 已補件」的資料。先點「📂 資料夾」確認檔案齊全，再按該廠商的「📣 一鍵通知廠商」：會把這些項目標成<b>已取得</b>，並開 LINE 讓你選廠商群組、送出「補件完成」字卡。</div>
    ${[...byVendor.entries()].map(([v, its]) => `<div style="border:1px solid #E5E7EB;border-radius:10px;padding:8px 10px;margin-bottom:10px;">
      <div style="font-weight:700;">◆ ${mdEsc(v)} <span class="md-sub">${its.length} 項</span></div>
      ${byCase(its).map(([name, rows]) => `<div style="font-size:13px;padding:5px 0;border-top:1px dashed #eee;">
        <b>${mdEsc(name)}</b>${rows[0].handover_from ? `<span class="md-sub">（${mdEsc(rows[0].handover_from)}的案件）</span>` : ''}
        ${rows[0].folder ? ` <a href="${mdEsc(rows[0].folder)}" target="_blank" rel="noopener" style="white-space:nowrap;">📂 資料夾</a>` : ''}
        <div>${rows.map(r => mdEsc(r.doc_type) + (r.note ? '<span class="md-sub">（' + mdEsc(r.note) + '）</span>' : '')).join('、')}
          <span class="md-sub">・${mdEsc(rows[0].rep || '')} ${mdMD(rows[0].supplied)} 補件</span></div></div>`).join('')}
      <div style="text-align:right;margin-top:6px;"><button class="btn btn-primary md-btn" onclick='mdSuppliedSend(${JSON.stringify(v).replace(/'/g, "&#39;")}, ${JSON.stringify(its.map(i => i.id))})'>📣 一鍵通知廠商（${its.length} 項）</button></div></div>`).join('')}
    <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
      <button class="btn btn-ghost md-btn" onclick="mdSuppliedLater()">先關閉（這次不再跳）</button>
      <button class="btn btn-ghost md-btn" onclick="mdSuppliedAck()" title="這幾項之後不再跳出提醒（仍可在「業務已補件」篩選看到）">知道了，不用再提醒</button>
    </div></div>`;
}
function mdSuppliedLater(){ try{ sessionStorage.setItem('md_sup_dismiss', '1'); }catch(e){} const ov = document.getElementById('mdSupOverlay'); if(ov) ov.remove(); }
function mdSuppliedAck(){
  const acked = new Set(mdSupAcked()); mdSupPending().forEach(i => acked.add(i.id + '|' + i.supplied));
  try{ localStorage.setItem('md_sup_ack', JSON.stringify([...acked].slice(-400))); }catch(e){}
  const ov = document.getElementById('mdSupOverlay'); if(ov) ov.remove();
}
async function mdSuppliedSend(vendor, ids){
  if(!confirm('確定已看過資料夾、資料齊全嗎？\n\n按「確定」會：\n① 把「' + vendor + '」這 ' + ids.length + ' 項標成「已取得」\n② 開 LINE 讓你選廠商群組，送出「補件完成」字卡')) return;
  const w = window.open('', '_blank');   // 先開空白分頁，等 API 回來再導到 LINE（避免被瀏覽器擋彈出視窗）
  try{
    const res = await fetch(API_BASE + '/api/missing-docs/supplied-confirm', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({vendor, ids})});
    const d = await res.json().catch(() => ({}));
    if(!res.ok || d.error) throw new Error(d.error || res.status);
    if(d.share_url && w){ w.location.href = d.share_url; MD_SHARE_PENDING = false; }
    else{ if(w) w.close(); alert('已把 ' + d.count + ' 項標成「已取得」。\n這邊沒有 LINE 分享連結，請用上方「📣 通知廠商已補件」複製文字傳給廠商。'); }
    await mdLoad();
    mdSuppliedPopup(true);
  }catch(e){
    if(w) w.close();
    alert('處理失敗：' + (e.message || e));
  }
}
