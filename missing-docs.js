// ===================================================================
// 缺件追蹤（2026-11-01；左側選單獨立一項）
// 廠商會來對「哪些案件還缺哪些資料」（竣工圖／使用執照／電費單／監控／出場保固書…）；資料常常是業務向屋主要、
// 要著要著就漏掉，廠商又得再要一次。這頁讓 PM 把缺件記下來、每週確認一次拿到沒、並把「某位業務名下還缺的」
// 整理成一則訊息一鍵推播給他（走業務 LINE／Slack 綁定，送出前先預覽）。
// 後端：GET/POST /api/missing-docs、PATCH/DELETE /api/missing-docs/<id>、POST /api/missing-docs/confirm、
//       GET /api/missing-docs/notice?rep=、POST /api/missing-docs/notify；案場搜尋沿用 /api/case-search
// ===================================================================
const MD_TYPES = ['竣工圖', '使用執照', '電費單', '監控', '模組、逆變器出場&保固書', '結案保固書', '其他'];
const MD_DUE_DAYS = 7;   // 距離上次確認（沒確認過就從建立日算）滿 7 天 → 該確認了
let MD_ITEMS = [];
let MD_TODAY = '';
let MD_FILTER = 'open';   // open 缺件中｜due 本週待確認｜got 已取得
let MD_GROUP = 'rep';     // rep 依業務｜type 依類型｜case 依案場
const MD_VENDORS = ['三創', '尚展', '曙光', '光鼎', '宇陽達', '聚曜', '澄品', '大昇', '展亦', '凰太竹', '國欽', '振庭'];
let MD_VENDOR_FILTER = '';   // 清單依廠商篩選（空＝全部）
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
  const want = new URLSearchParams(location.search).get('vendor') || mdStore('vendor');
  vs.innerHTML = '<option value="">請選廠商</option>' + MD_VENDORS.map(v => `<option value="${mdEsc(v)}">${mdEsc(v)}</option>`).join('');
  document.getElementById('mdTypeSel').innerHTML = '<option value="">請選缺哪一項…</option>' + MD_TYPES.map(t => `<option value="${mdEsc(t)}">缺${mdEsc(t)}</option>`).join('');
  if(want && MD_VENDORS.includes(want)){ vs.value = want; MD_VENDOR_FILTER = want; mdVendorChanged(); }
}

async function mdVendorChanged(){
  const v = document.getElementById('mdVendorSel').value;
  const cs = document.getElementById('mdCaseSel');
  document.getElementById('mdPicked').textContent = '';
  document.getElementById('mdRepInput').value = '';
  MD_CASES = [];
  if(!v){ cs.innerHTML = '<option value="">先選廠商</option>'; return; }
  mdStore('vendor', v);
  MD_VENDOR_FILTER = v;
  cs.innerHTML = '<option value="">載入案場中…</option>';
  mdRender();
  try{
    const res = await fetch(API_BASE + '/api/missing-docs/cases?vendor=' + encodeURIComponent(v));
    const data = await res.json();
    if(data.error) throw new Error(data.error);
    MD_CASES = data.cases || [];
    cs.innerHTML = '<option value="">請選案場（' + MD_CASES.length + ' 個進行中）</option>' +
      MD_CASES.map((c, i) => `<option value="${i}">${mdEsc(c.alias || c.case_no)}${c.alias && c.case_no ? '（' + mdEsc(c.case_no) + '）' : ''}${c.rep ? '｜' + mdEsc(c.rep) : ''}</option>`).join('');
  }catch(e){
    cs.innerHTML = '<option value="">案場載入失敗，請重選廠商再試</option>';
  }
}

function mdCaseChanged(){
  const i = document.getElementById('mdCaseSel').value;
  const c = i === '' ? null : MD_CASES[Number(i)];
  document.getElementById('mdPicked').textContent = c ? (c.case_no + (c.rep ? '｜業務：' + c.rep : '｜⚠ 找不到這案的業務，請在右邊填')) : '';
  document.getElementById('mdRepInput').value = c ? (c.rep || '') : '';
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
  const ci = document.getElementById('mdCaseSel').value;
  const c = ci === '' ? null : MD_CASES[Number(ci)];
  if(!c){ msg.textContent = '請先選廠商和案場'; return; }
  if(!MD_TYPES_PICKED.length){ msg.textContent = '請在「缺什麼」下拉選單選至少一項'; return; }
  const body = {
    case_no: c.case_no || '', alias: c.alias || c.case_no || '', vendor: c.vendor || '',
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
    let t = '✅ ' + (c.alias || c.case_no) + ' 已新增 ' + (data.created || []).length + ' 項' + (data.rep ? '，業務：' + data.rep : '，⚠ 找不到這案的業務，請在清單上補填');
    if((data.skipped || []).length) t += '（' + data.skipped.join('、') + ' 本來就在追蹤中，略過）';
    msg.textContent = t;
    MD_TYPES_PICKED = [];
    mdRenderChips();
    document.getElementById('mdNoteInput').value = '';
    document.getElementById('mdCaseSel').value = '';   // 廠商留著，方便連續新增同廠商的下一個案場
    mdCaseChanged();
    await mdLoad();
  }catch(e){ msg.textContent = '新增失敗：' + e; }
}

// ---------- 清單 ----------
function mdSetFilter(f){ MD_FILTER = f; mdRender(); }
function mdSetGroup(g){ MD_GROUP = g; mdRender(); }

function mdRender(){
  const box = document.getElementById('mdBox');
  if(!box) return;
  const pool = MD_VENDOR_FILTER ? MD_ITEMS.filter(i => i.vendor === MD_VENDOR_FILTER) : MD_ITEMS;
  const open = pool.filter(i => i.status === '缺件');
  const due = open.filter(mdIsDue);
  const got = pool.filter(i => i.status === '已取得').sort((a, b) => (b.got || '').localeCompare(a.got || '')).slice(0, 60);
  document.getElementById('mdSummary').innerHTML =
    `缺件中 <b>${open.length}</b> 項，涉及 <b>${new Set(open.map(i => i.alias || i.case_no)).size}</b> 個案場；` +
    (due.length ? `<span class="md-due">⏰ ${due.length} 項已超過 ${MD_DUE_DAYS} 天沒確認</span>` : '本週都確認過了 ✅');
  document.getElementById('mdFilters').innerHTML =
    [['open', `缺件中（${open.length}）`], ['due', `本週待確認（${due.length}）`], ['got', `已取得（${got.length}）`]]
      .map(([k, l]) => `<button class="md-chip ${MD_FILTER === k ? 'on' : ''}" onclick="mdSetFilter('${k}')">${l}</button>`).join('') +
    '<span class="md-sep"></span>廠商：<select class="cert-rename-input" style="padding:3px 8px;" onchange="MD_VENDOR_FILTER=this.value;mdRender()"><option value="">全部</option>' +
      MD_VENDORS.map(v => `<option value="${mdEsc(v)}" ${MD_VENDOR_FILTER === v ? 'selected' : ''}>${mdEsc(v)}</option>`).join('') + '</select>' +
    '<span class="md-sep"></span>分組：' +
    [['rep', '業務'], ['type', '缺件類型'], ['case', '案場']]
      .map(([k, l]) => `<button class="md-chip ${MD_GROUP === k ? 'on' : ''}" onclick="mdSetGroup('${k}')">${l}</button>`).join('');
  const confirmBtn = document.getElementById('mdConfirmAllBtn');
  confirmBtn.style.display = (MD_FILTER === 'due' && due.length) || (MD_FILTER === 'open' && open.length) ? '' : 'none';
  confirmBtn.textContent = MD_FILTER === 'due' ? `✅ 這 ${due.length} 項本週都確認過了` : `✅ 全部 ${open.length} 項標為本週已確認`;

  const list = MD_FILTER === 'due' ? due : (MD_FILTER === 'got' ? got : open);
  if(!list.length){
    box.innerHTML = '<div class="login-note">' + (MD_FILTER === 'got' ? '還沒有已取得的資料' : (MD_FILTER === 'due' ? '沒有需要確認的項目 🎉' : '目前沒有缺件，用上面的表單新增吧')) + '</div>';
    return;
  }
  const keyOf = it => MD_GROUP === 'rep' ? (it.rep || '（未指定業務）') : (MD_GROUP === 'type' ? (it.doc_type || '其他') : (it.alias || it.case_no));
  const groups = new Map();
  list.forEach(it => { const k = keyOf(it); if(!groups.has(k)) groups.set(k, []); groups.get(k).push(it); });
  const order = Array.from(groups.keys()).sort((a, b) => {
    if(a.startsWith('（未指定')) return 1;
    if(b.startsWith('（未指定')) return -1;
    if(MD_GROUP === 'type') return MD_TYPES.indexOf(a) - MD_TYPES.indexOf(b);
    return a.localeCompare(b, 'zh-Hant');
  });
  box.innerHTML = order.map(k => {
    const its = groups.get(k);
    const notifyBtn = (MD_GROUP === 'rep' && MD_FILTER !== 'got' && !k.startsWith('（未指定'))
      ? `<button class="btn btn-primary md-btn" onclick="mdNotifyOpen(${JSON.stringify(k).replace(/"/g, '&quot;')})">📨 通知這位業務</button>` : '';
    return `<div class="md-group"><div class="md-group-head"><span>${mdEsc(k)} <span class="md-sub">${its.length} 項</span></span>${notifyBtn}</div>` +
      `<div class="md-table-wrap"><table class="md-table"><thead><tr>` +
      (MD_GROUP === 'case' ? '' : '<th>案場</th>') + (MD_GROUP === 'type' ? '' : '<th>缺件類型</th>') +
      `<th>備註</th>${MD_GROUP === 'rep' ? '' : '<th>業務</th>'}<th>誰提供</th><th>已缺</th><th>上次確認</th><th>上次通知</th><th></th></tr></thead><tbody>` +
      its.map(it => mdRow(it)).join('') + '</tbody></table></div></div>';
  }).join('');
}

function mdRow(it){
  const days = it.created && MD_TODAY ? mdDaysBetween(it.created, MD_TODAY) : null;
  const due = mdIsDue(it);
  const isGot = it.status === '已取得';
  return `<tr class="${due ? 'md-row-due' : ''}">` +
    (MD_GROUP === 'case' ? '' : `<td><b>${mdEsc(it.alias || it.case_no)}</b></td>`) +
    (MD_GROUP === 'type' ? '' : `<td>${mdEsc(it.doc_type)}</td>`) +
    `<td class="md-note" onclick="mdEditNote('${it.id}')" title="點一下修改備註">${it.note ? mdEsc(it.note) : '<span class="md-sub">＋備註</span>'}</td>` +
    (MD_GROUP === 'rep' ? '' : `<td onclick="mdEditRep('${it.id}')" title="點一下修改業務">${mdEsc(it.rep) || '<span class="md-sub">＋業務</span>'}</td>`) +
    `<td>${mdEsc(it.provider)}</td>` +
    `<td>${isGot ? '✔ ' + mdMD(it.got) : (days == null ? '—' : days + ' 天')}</td>` +
    `<td>${due ? '<span class="md-due">⏰ ' : '<span>'}${mdMD(mdLastCheck(it))}</span></td>` +
    `<td>${it.notified ? mdMD(it.notified) + (it.notify_count > 1 ? '（' + it.notify_count + '次）' : '') : '—'}</td>` +
    `<td class="md-actions">` +
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
async function mdNotifyOpen(rep){
  const ov = document.getElementById('mdNoticeOverlay');
  document.getElementById('mdNoticeBody').innerHTML = '<div class="login-note">整理訊息中…</div>';
  ov.classList.add('show');
  try{
    const res = await fetch(API_BASE + '/api/missing-docs/notice?rep=' + encodeURIComponent(rep));
    const data = await res.json();
    if(data.error) throw new Error(data.error);
    MD_NOTICE = data;
    if(!data.count){
      document.getElementById('mdNoticeBody').innerHTML = '<div class="login-note">' + mdEsc(rep) + ' 名下沒有需要通知的缺件</div>';
      return;
    }
    document.getElementById('mdNoticeBody').innerHTML =
      `<div class="md-sub" style="margin-bottom:6px;">將傳給：<b>${mdEsc(rep)}</b>（共 ${data.count} 項）` +
      (data.bound ? ' ✅ 已綁定 LINE／Slack' : ' <span class="md-due">⚠ 這位業務還沒綁定 LINE／Slack，無法直接推播，請複製文字自己貼給他</span>') + '</div>' +
      `<textarea id="mdNoticeText" class="md-notice-text" readonly>${mdEsc(data.text)}</textarea>` +
      `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap;">` +
      `<button class="btn btn-ghost md-btn" onclick="mdNoticeCopy()">📋 複製文字</button>` +
      `<button class="btn btn-ghost md-btn" onclick="mdNoticeClose()">取消</button>` +
      (data.bound ? `<button class="btn btn-primary md-btn" id="mdNoticeSend" onclick="mdNoticeSend()">📨 確認送出</button>` : '') + '</div>';
  }catch(e){
    document.getElementById('mdNoticeBody').innerHTML = '<div class="login-note">整理訊息失敗：' + mdEsc(e.message || e) + '</div>';
  }
}
function mdNoticeClose(){ document.getElementById('mdNoticeOverlay').classList.remove('show'); }
function mdNoticeCopy(){
  const ta = document.getElementById('mdNoticeText');
  if(!ta) return;
  ta.select();
  try{ navigator.clipboard.writeText(ta.value); }catch(e){ document.execCommand('copy'); }
}
async function mdNoticeSend(){
  if(!MD_NOTICE) return;
  const btn = document.getElementById('mdNoticeSend');
  btn.disabled = true; btn.textContent = '送出中…';
  try{
    const res = await fetch(API_BASE + '/api/missing-docs/notify', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({rep: MD_NOTICE.rep, ids: MD_NOTICE.ids})});
    const data = await res.json();
    if(!res.ok || data.error) throw new Error(data.error || res.status);
    if(!data.sent){ btn.disabled = false; btn.textContent = '📨 確認送出'; alert('推播沒有成功（可能 LINE 額度用完且沒綁 Slack），請改用「複製文字」自己貼給他。'); return; }
    mdNoticeClose();
    alert('✅ 已通知 ' + MD_NOTICE.rep + '（' + data.count + ' 項）');
    mdLoad();
  }catch(e){
    btn.disabled = false; btn.textContent = '📨 確認送出';
    alert('送出失敗：' + (e.message || e));
  }
}
