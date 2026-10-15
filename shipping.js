// ===================================================================
// 採購專區 → 安排出貨（2026-10-14）
// 查案號 → 左邊審訖圖／系統送審圖、右邊工程部配比信＋現有訂單＋比對 → 新下單／排出貨／已出貨
// → 累積成「待產生」變更 → 產生新 Excel（套用到最新的元晶／碩天訂單 Excel，保留格式）下載，自己寄給廠商。
// 後端：/api/procurement/case-detail、/api/procurement/shipping/*（epc-backend app.py「安排出貨」區塊）。
// ===================================================================
let SHIP_CASE = null;          // 目前查詢的案件（case-detail 回傳）
let SHIP_ACTION = '新下單';
let SHIP_VENDOR = '元晶';
let SHIP_EDITS = [];

function shipEsc(v){ return certEsc(v); }

async function loadShippingPage(){
  renderShipForm();
  loadShipCandidates();
  await loadShipEdits();
}

// ---- 已取得同意備案的案件清單（2026-10-15）：搜尋、篩選未下單，按「安排」帶到下面查詢 ----
let SHIP_CANDS = null;
let shipCandFilter = 'module';
async function loadShipCandidates(refresh){
  const box = document.getElementById('shipCandBox');
  if(box && !SHIP_CANDS) box.innerHTML = '<div class="cert-src">載入已取得同意備案的案件…</div>';
  try{
    const res = await fetch(API_BASE + '/api/procurement/shipping/candidates' + (refresh ? '?refresh=1' : ''), {cache: 'no-store'});
    const d = await res.json();
    if(!res.ok || d.error) throw new Error(d.error || res.status);
    SHIP_CANDS = d.cases || [];
  }catch(e){
    if(box) box.innerHTML = '<div class="cert-src">案件清單載入失敗:' + shipEsc(e.message) + '</div>';
    return;
  }
  renderShipCandidates();
}
function shipSetCandFilter(k){ shipCandFilter = k; renderShipCandidates(); }
function shipPick(caseNo){
  document.getElementById('shipCaseInput').value = caseNo;
  shipLookup();
  document.getElementById('shipCaseBox').scrollIntoView({behavior: 'smooth', block: 'start'});
}
function renderShipCandidates(){
  const box = document.getElementById('shipCandBox');
  if(!box || !SHIP_CANDS) return;
  const kw = ((document.getElementById('shipCandSearch') || {}).value || '').trim().replace(/台/g, '臺');
  const flt = {
    module: c => !c.module_order,
    inverter: c => !c.inverter_order,
    all: c => true,
  };
  const counts = {module: SHIP_CANDS.filter(flt.module).length, inverter: SHIP_CANDS.filter(flt.inverter).length, all: SHIP_CANDS.length};
  let rows = SHIP_CANDS.filter(flt[shipCandFilter]);
  if(kw) rows = rows.filter(c => [c.case_no, c.alias, c.epc, c.address].some(v => String(v || '').replace(/台/g, '臺').includes(kw)));
  const st = v => v ? '<span class="ops-status-pill ' + (v === '已出貨' ? 'ops-status-done' : 'ops-status-pending') + '">' + shipEsc(v) + '</span>' : '<span class="cert-src" style="color:#B42318;">未下單</span>';
  const btn = (k, label) => '<button class="cert-filter-btn ' + (shipCandFilter === k ? 'active' : '') + '" onclick="shipSetCandFilter(\'' + k + '\')">' + label + ' ' + counts[k] + '</button>';
  const keep = document.activeElement && document.activeElement.id === 'shipCandSearch';
  box.innerHTML = '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px;">'
    + '<b style="font-size:14px;">📋 已取得同意備案、尚未掛表的案件</b>'
    + '<input id="shipCandSearch" class="quick-mark-input" placeholder="搜尋案號、別名、EPC、地址…" value="' + shipEsc(kw) + '" oninput="renderShipCandidates()" style="max-width:240px;">'
    + btn('module', '模組未下單') + btn('inverter', '變流器未下單') + btn('all', '全部')
    + '<button class="btn btn-ghost" style="padding:3px 10px;font-size:12px;" onclick="loadShipCandidates(true)">🔄</button></div>'
    + '<div style="max-height:360px;overflow:auto;border:1px solid var(--border,#E3E6EA);border-radius:10px;">'
    + '<table><thead><tr><th>案號</th><th>EPC</th><th>同意備案</th><th>模組(元晶)</th><th>變流器(碩天)</th><th>工程部配比信</th><th></th></tr></thead><tbody>'
    + (rows.length ? rows.map(c => '<tr>'
      + '<td><b>' + shipEsc(c.case_no) + '</b><div class="case-alias">' + shipEsc(c.alias) + '</div></td>'
      + '<td>' + shipEsc(c.epc) + '</td><td style="white-space:nowrap;">' + shipEsc(c.agree_date || '—') + '</td>'
      + '<td>' + st(c.module_order) + '</td><td>' + st(c.inverter_order) + '</td>'
      + '<td style="font-size:12px;">' + (c.mail_cancelled ? '<span style="color:#B42318;font-weight:700;">⛔ 取消通知</span>'
        : c.has_mail ? shipEsc(c.mail_modules.concat(c.mail_inverters).join('、')) : '<span class="cert-src">沒有</span>') + '</td>'
      + '<td><button class="btn btn-primary" style="padding:4px 10px;font-size:12px;" onclick="shipPick(\'' + shipEsc(c.case_no).replace(/'/g, '') + '\')">安排</button></td></tr>').join('')
      : '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:16px 0;">沒有符合的案件</td></tr>')
    + '</tbody></table></div>';
  if(keep){ const el = document.getElementById('shipCandSearch'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}

async function shipLookup(){
  const caseNo = (document.getElementById('shipCaseInput').value || '').trim().replace(/台/g, '臺');
  if(!caseNo){ showToast('請輸入案號'); return; }
  const box = document.getElementById('shipCaseBox');
  box.innerHTML = '<div class="cert-src" style="padding:20px;">載入中…</div>';
  try{
    const res = await fetch(API_BASE + '/api/procurement/case-detail?case=' + encodeURIComponent(caseNo), {cache: 'no-store'});
    const d = await res.json();
    if(!res.ok || d.error) throw new Error(d.error || res.status);
    SHIP_CASE = d;
  }catch(e){
    SHIP_CASE = null;
    box.innerHTML = '<div class="cert-src" style="padding:20px;">查詢失敗:' + shipEsc(e.message) + '</div>';
    return;
  }
  renderShipCase();
  renderShipForm();
}

function renderShipCase(){
  const d = SHIP_CASE, box = document.getElementById('shipCaseBox');
  if(!d){ box.innerHTML = ''; return; }
  const dr = d.drawing;
  const drawing = !dr
    ? '<div class="cert-pdf-frame" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:13px;text-align:center;padding:20px;">這案還沒有審訖圖或系統送審圖</div>'
    : (!dr.ext || String(dr.ext).replace(/^\./, '').toLowerCase() === 'pdf'
      ? '<iframe class="cert-pdf-frame" src="' + shipEsc(dr.file_url) + '#view=FitH"></iframe>'
      : '<div class="cert-pdf-frame" style="display:flex;align-items:center;justify-content:center;font-size:13px;"><a href="' + shipEsc(dr.file_url) + '" target="_blank" rel="noopener">開新分頁查看圖面</a></div>');
  const mc = (d.mail_configs || [])[0];
  const mailHtml = !mc ? '<div class="cert-src">還沒有這案的工程部配比信</div>'
    : (mc.cancelled ? '<div style="background:#FEE2E2;color:#991B1B;border-radius:8px;padding:6px 10px;font-weight:700;margin-bottom:6px;">⛔ 工程部已發取消通知:' + shipEsc(mc.cancel_reason || '') + '</div>' : '')
      + '<div style="font-size:13px;background:#F5F3FF;border-radius:10px;padding:8px 12px;line-height:1.7;">'
      + '<div class="cert-src">' + shipEsc(mc.from || '') + '｜' + shipEsc((mc.date || '').slice(0, 10)) + '</div>'
      + (mc.lines || []).map(l => '<div>' + shipEsc(l) + '</div>').join('') + '</div>';
  const chk = (d.config_check || []).map(c => {
    const u = c.equipment === '模組' ? ' 片' : ' 台';
    return '<div>' + (c.ok ? '✅' : (c.order_qty ? '⚠️' : '⏳')) + ' ' + shipEsc(c.equipment) + ' ' + shipEsc(c.model) + ':配比信 ' + shipEsc(c.mail_qty) + u + '／' + (c.order_qty ? '訂單 ' + shipEsc(c.order_qty) + u : '尚未下單') + '</div>';
  }).join('');
  const orders = (d.orders || []).map(o => '<div style="font-size:12.5px;padding:3px 0;border-bottom:1px solid var(--border,#EEF0F5);">'
    + (o.equipment === '模組' ? '🟦 ' : '🔌 ') + '<b>' + shipEsc(o.model) + ' × ' + shipEsc(o.qty) + '</b> '
    + '<span class="ops-status-pill ' + (o.status === '已出貨' ? 'ops-status-done' : 'ops-status-pending') + '">' + shipEsc(o.status) + '</span> '
    + '<span class="cert-src" style="display:inline;">' + shipEsc(o.vendor) + '｜下單 ' + shipEsc(o.order_date || '—') + '｜到貨 ' + shipEsc(o.arrival || '—') + '</span></div>').join('')
    || '<div class="cert-src">還沒有元晶／碩天訂單</div>';
  box.innerHTML = '<div style="font-size:16px;font-weight:800;margin-bottom:6px;">🧾 ' + shipEsc(d.case) + ' <span style="font-size:13px;font-weight:500;color:#6B7280;">' + shipEsc(d.alias || '') + '</span></div>'
    + (d.spec && d.spec.address ? '<div class="cert-src" style="margin-bottom:8px;">📍 ' + shipEsc(d.spec.address) + '</div>' : '')
    + '<div class="cert-modal-grid"><div>'
    + '<div class="cert-side-label" style="margin-top:0;">📐 ' + (dr ? shipEsc(dr.doc_type) + ' ' + shipEsc(dr.doc_date || '') : '審訖圖／系統送審圖') + '</div>' + drawing
    + (dr ? '<div style="font-size:12px;margin-top:4px;"><a href="' + shipEsc(dr.file_url) + '" target="_blank" rel="noopener">↗ 在新分頁開啟(可放大)</a></div>' : '')
    + '</div><div>'
    + '<div class="cert-side-label" style="margin-top:0;">📧 工程部配比信</div>' + mailHtml
    + (chk ? '<div style="margin-top:6px;font-size:12.5px;line-height:1.8;">' + chk + '</div>' : '')
    + '<div class="cert-side-label">📦 現有訂單</div>' + orders
    + '<div class="cert-side-label">📋 專案細節登記的規格</div><div style="font-size:12.5px;">模組:' + shipEsc((d.spec || {}).module || '(未填)') + '<br>變流器:' + shipEsc((d.spec || {}).inverter || '(未填)') + '</div>'
    + '</div></div>';
}

function shipSetAction(a){ SHIP_ACTION = a; renderShipForm(); }
function shipSetVendor(v){ SHIP_VENDOR = v; renderShipForm(); }

function shipDefaultItems(){
  const mc = SHIP_CASE && (SHIP_CASE.mail_configs || []).find(c => (c.modules || []).length || (c.inverters || []).length);
  if(!mc) return [{model: '', qty: ''}];
  const list = SHIP_VENDOR === '元晶' ? (mc.modules || []) : (mc.inverters || []);
  return list.length ? list.map(x => ({model: x.model, qty: x.qty})) : [{model: '', qty: ''}];
}

function shipOpenModels(){
  return ((SHIP_CASE && SHIP_CASE.orders) || []).filter(o => o.vendor === SHIP_VENDOR && o.status === '已成立').map(o => o.model);
}

function renderShipForm(){
  const box = document.getElementById('shipFormBox');
  if(!box) return;
  if(!SHIP_CASE){ box.innerHTML = '<div class="cert-src">先在上面輸入案號查詢,核對圖面與配比信後再安排。</div>'; return; }
  const d = SHIP_CASE;
  const today = new Date(); const pad = n => String(n).padStart(2, '0');
  const todayIso = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
  const epcGuess = ((d.mail_configs || [])[0] || {}).epc || ((d.orders || []).find(o => o.epc) || {}).epc || '';
  const btn = (k, label, cur, fn) => '<button class="cert-filter-btn ' + (cur === k ? 'active' : '') + '" onclick="' + fn + '(\'' + k + '\')">' + label + '</button>';
  let html = '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">'
    + btn('新下單', '🆕 新下單', SHIP_ACTION, 'shipSetAction') + btn('排出貨', '📅 排出貨', SHIP_ACTION, 'shipSetAction') + btn('已出貨', '✅ 已出貨', SHIP_ACTION, 'shipSetAction')
    + '<span style="margin-left:12px;font-weight:700;font-size:12.5px;">廠商</span>'
    + btn('元晶', '🟦 元晶(模組)', SHIP_VENDOR, 'shipSetVendor') + btn('碩天', '🔌 碩天(變流器)', SHIP_VENDOR, 'shipSetVendor') + '</div>';
  const inp = (id, label, val, ph, w) => '<label style="display:flex;flex-direction:column;gap:3px;font-size:12px;min-width:' + (w || 160) + 'px;flex:1;">' + label
    + '<input id="' + id + '" value="' + shipEsc(val || '') + '" placeholder="' + shipEsc(ph || '') + '" style="padding:6px 8px;border:1px solid var(--border,#E3E6EA);border-radius:8px;font-size:13px;"></label>';
  const modelSelect = () => {
    const ms = shipOpenModels();
    return '<label style="display:flex;flex-direction:column;gap:3px;font-size:12px;min-width:200px;flex:1;">型號(這案「已成立」的' + SHIP_VENDOR + '訂單)'
      + '<select id="shipModel" style="padding:6px 8px;border:1px solid var(--border,#E3E6EA);border-radius:8px;font-size:13px;"><option value="">全部型號</option>'
      + ms.map(m => '<option value="' + shipEsc(m) + '">' + shipEsc(m) + '</option>').join('') + '</select>'
      + (ms.length ? '' : '<span style="color:#B42318;">這案在' + SHIP_VENDOR + '訂單表沒有「已成立」的列(要先新下單)</span>') + '</label>';
  };
  if(SHIP_ACTION === '新下單'){
    const items = shipDefaultItems();
    html += '<div class="cert-side-label" style="margin-top:0;">型號 × 數量(已從配比信帶入,可修改)</div><div id="shipItems">'
      + items.map((it, i) => shipItemRow(it, i)).join('') + '</div>'
      + '<button class="btn btn-ghost" style="padding:3px 10px;font-size:12px;margin:4px 0 10px;" onclick="shipAddItem()">＋ 再加一個型號</button>'
      + '<div style="display:flex;gap:10px;flex-wrap:wrap;">'
      + inp('shipAlias', '案場別名', d.alias, '') + inp('shipOrderDate', '訂單成立日期(YYYY-MM-DD)', todayIso, '', 140)
      + inp('shipEpc', 'EPC', epcGuess, '例如 尚展') + inp('shipSiteAddr', '案場地址', (d.spec || {}).address, '', 260)
      + (SHIP_VENDOR === '碩天' ? inp('shipWarranty', '加購十年延保', 'V', 'V／不需要', 100) : '')
      + inp('shipNote', '備註', '', '', 200) + '</div>'
      + '<div class="cert-src" style="margin-top:4px;">到貨時間、出貨地址、簽收人會先寫「待確認」,排出貨時再填。</div>';
  } else if(SHIP_ACTION === '排出貨'){
    html += '<div style="display:flex;gap:10px;flex-wrap:wrap;">' + modelSelect()
      + inp('shipArrDate', '到貨日期(YYYY-MM-DD)', '', '例如 2026-10-29', 140)
      + '<label style="display:flex;flex-direction:column;gap:3px;font-size:12px;min-width:110px;">到貨時段<select id="shipArrTime" style="padding:6px 8px;border:1px solid var(--border,#E3E6EA);border-radius:8px;font-size:13px;">'
      + ['上午9:00', '上午10:00', '上午11:00', '下午1:00', '下午2:00', '下午3:00'].map(t => '<option>' + t + '</option>').join('') + '</select></label>'
      + inp('shipEpc', 'EPC(用來帶入上次地址)', epcGuess, '', 120) + '</div>'
      + '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;">'
      + inp('shipShipTo', '出貨地址', '', '', 280) + inp('shipReceiver', '簽收人', '', '', 120) + inp('shipPhone', '聯絡電話', '', '', 140) + inp('shipNote', '備註', '', '', 160) + '</div>'
      + '<button class="btn btn-ghost" style="padding:3px 10px;font-size:12px;margin-top:6px;" onclick="shipFillEpcDefaults()">↺ 帶入這家 EPC 上次的出貨地址／簽收人</button>';
  } else {
    html += '<div style="display:flex;gap:10px;flex-wrap:wrap;">' + modelSelect()
      + (SHIP_VENDOR === '碩天' ? inp('shipShippedAt', '碩天出貨時間', todayIso.replace(/-/g, '/'), '', 140) : '') + '</div>'
      + '<div class="cert-src" style="margin-top:4px;">產生 Excel 時,這幾列會從「已成立」搬到「已出貨訂單」分頁。</div>';
  }
  html += '<label style="display:flex;gap:6px;align-items:center;margin-top:12px;font-size:13px;font-weight:700;">'
    + '<input type="checkbox" id="shipChecked"> 我已核對審訖圖／系統送審圖與工程部配比信、訂單料件相符</label>'
    + '<button class="btn btn-primary" style="padding:7px 16px;font-size:13px;margin-top:8px;" onclick="shipSubmit()">加入待產生清單</button>';
  box.innerHTML = html;
  if(SHIP_ACTION === '排出貨') shipFillEpcDefaults(true);
}

function shipItemRow(it, i){
  return '<div style="display:flex;gap:8px;margin-bottom:4px;" data-item="' + i + '">'
    + '<input class="shipItemModel" value="' + shipEsc(it.model) + '" placeholder="型號,例如 TS60-CMH-500 H6QT" style="flex:2;padding:6px 8px;border:1px solid var(--border,#E3E6EA);border-radius:8px;font-size:13px;">'
    + '<input class="shipItemQty" value="' + shipEsc(it.qty) + '" placeholder="數量" style="width:80px;padding:6px 8px;border:1px solid var(--border,#E3E6EA);border-radius:8px;font-size:13px;">'
    + '<button class="btn btn-ghost" style="padding:2px 8px;font-size:12px;" onclick="this.parentElement.remove()">✕</button></div>';
}
function shipAddItem(){ document.getElementById('shipItems').insertAdjacentHTML('beforeend', shipItemRow({model: '', qty: ''}, Date.now())); }

async function shipFillEpcDefaults(silent){
  const epc = (document.getElementById('shipEpc') || {}).value || '';
  if(!epc.trim()){ if(!silent) showToast('先填 EPC'); return; }
  try{
    const res = await fetch(API_BASE + '/api/procurement/shipping/epc-defaults?epc=' + encodeURIComponent(epc.trim()) + '&vendor=' + encodeURIComponent(SHIP_VENDOR));
    const d = await res.json();
    if(!d.found){ if(!silent) showToast('找不到這家 EPC 之前的出貨資料'); return; }
    const set = (id, v) => { const el = document.getElementById(id); if(el && (!el.value || !silent)) el.value = v || ''; };
    set('shipShipTo', d.ship_to); set('shipReceiver', d.receiver); set('shipPhone', d.phone);
    if(!silent) showToast('已帶入(來自 ' + d.from_case + '),可以再修改');
  }catch(e){ if(!silent) showToast('帶入失敗:' + e.message); }
}

async function shipSubmit(){
  if(!SHIP_CASE) return;
  if(!document.getElementById('shipChecked').checked){ showToast('請先勾選「已核對」'); return; }
  const val = id => ((document.getElementById(id) || {}).value || '').trim();
  const body = {vendor: SHIP_VENDOR, action: SHIP_ACTION, case_no: SHIP_CASE.case, alias: SHIP_CASE.alias || ''};
  if(SHIP_ACTION === '新下單'){
    body.items = [...document.querySelectorAll('#shipItems [data-item]')].map(r => ({model: r.querySelector('.shipItemModel').value.trim(), qty: r.querySelector('.shipItemQty').value.trim()})).filter(x => x.model);
    if(!body.items.length){ showToast('請至少填一個型號'); return; }
    Object.assign(body, {alias: val('shipAlias'), order_date: val('shipOrderDate'), epc: val('shipEpc'), site_addr: val('shipSiteAddr'), warranty: val('shipWarranty'), note: val('shipNote')});
  } else if(SHIP_ACTION === '排出貨'){
    const dt = val('shipArrDate');
    if(!/^\d{4}-\d{1,2}-\d{1,2}$/.test(dt)){ showToast('到貨日期請填 YYYY-MM-DD'); return; }
    body.items = val('shipModel') ? [{model: val('shipModel')}] : [];
    Object.assign(body, {arrival: dt.replace(/-/g, '/') + ' ' + val('shipArrTime'), ship_to: val('shipShipTo'), receiver: val('shipReceiver'), phone: val('shipPhone'), epc: val('shipEpc'), note: val('shipNote')});
  } else {
    body.items = val('shipModel') ? [{model: val('shipModel')}] : [];
    body.shipped_at = val('shipShippedAt');
  }
  try{
    const res = await fetch(API_BASE + '/api/procurement/shipping/edits', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const d = await res.json();
    if(!res.ok || d.error) throw new Error(d.error || res.status);
    showToast('已加入待產生清單(' + d.count + ' 筆)');
  }catch(e){ showToast('加入失敗:' + e.message); return; }
  loadShipEdits();
}

async function loadShipEdits(){
  try{
    const res = await fetch(API_BASE + '/api/procurement/shipping/edits', {cache: 'no-store'});
    const d = await res.json();
    if(!res.ok || d.error) throw new Error(d.error || res.status);
    SHIP_EDITS = d.edits || [];
  }catch(e){ SHIP_EDITS = []; }
  renderShipEdits();
}

function renderShipEdits(){
  const box = document.getElementById('shipEditsBox');
  if(!box) return;
  const html = ['元晶', '碩天'].map(v => {
    const list = SHIP_EDITS.filter(e => e.vendor === v);
    const rows = list.map(e => '<tr><td>' + shipEsc(e.action) + '</td><td><b>' + shipEsc(e.case_no) + '</b><div class="case-alias">' + shipEsc(e.alias || '') + '</div></td>'
      + '<td>' + shipEsc(e.model || '(全部型號)') + (e.qty ? ' × ' + shipEsc(e.qty) : '') + '</td>'
      + '<td style="font-size:12px;">' + [e.arrival && '到貨 ' + e.arrival, e.ship_to && '地址 ' + e.ship_to, e.receiver && '簽收 ' + e.receiver + ' ' + (e.phone || ''), e.shipped_at && '出貨 ' + e.shipped_at, e.epc && 'EPC ' + e.epc].filter(Boolean).map(shipEsc).join('<br>') + '</td>'
      + '<td><button class="btn btn-ghost" style="padding:2px 8px;font-size:11.5px;color:#D64545;" onclick="shipDeleteEdit(\'' + e.id + '\')">刪除</button></td></tr>').join('');
    return '<div style="margin-bottom:14px;"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">'
      + '<b>' + (v === '元晶' ? '🟦 元晶(模組)' : '🔌 碩天(變流器)') + ' 待產生 ' + list.length + ' 筆</b>'
      + (list.length ? '<button class="btn btn-ghost" style="padding:4px 10px;font-size:12px;" onclick="shipPreview(\'' + v + '\')">🔍 預覽會怎麼改</button>'
        + '<button class="btn btn-primary" style="padding:4px 12px;font-size:12px;" onclick="shipGenerate(\'' + v + '\')">📥 產生新 Excel 並下載</button>' : '')
      + '</div>' + (list.length ? '<table><thead><tr><th>動作</th><th>案號</th><th>型號</th><th>內容</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' : '<div class="cert-src">沒有待產生的變更</div>')
      + '<div id="shipPreview_' + v + '"></div></div>';
  }).join('');
  box.innerHTML = html;
}

async function shipDeleteEdit(id){
  if(!confirm('刪除這筆待產生的變更?')) return;
  await fetch(API_BASE + '/api/procurement/shipping/edits/' + id, {method: 'DELETE'});
  loadShipEdits();
}

async function shipPreview(vendor){
  const box = document.getElementById('shipPreview_' + vendor);
  box.innerHTML = '<div class="cert-src">預覽中…</div>';
  try{
    const res = await fetch(API_BASE + '/api/procurement/shipping/generate', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({vendor, preview: true})});
    const d = await res.json();
    if(!res.ok || d.error) throw new Error(d.error || res.status);
    box.innerHTML = '<div style="background:#F6F8FB;border-radius:8px;padding:8px 12px;margin-top:6px;font-size:12.5px;line-height:1.8;">'
      + '<div class="cert-src">底稿:' + shipEsc(d.base_file) + ' → 新檔:' + shipEsc(d.file_name) + '</div>'
      + d.results.map(r => '<div>' + (r.ok ? '✅ ' : '⚠️ ') + shipEsc(r.msg) + '</div>').join('') + '</div>';
  }catch(e){ box.innerHTML = '<div class="cert-src">預覽失敗:' + shipEsc(e.message) + '</div>'; }
}

async function shipGenerate(vendor){
  if(!confirm('用最新的' + vendor + '訂單 Excel 套用 ' + SHIP_EDITS.filter(e => e.vendor === vendor).length + ' 筆變更,產生新檔下載?\n(產生後這些變更會標成「已產生」)')) return;
  try{
    const res = await fetch(API_BASE + '/api/procurement/shipping/generate', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({vendor})});
    if(!res.ok){ const d = await res.json().catch(() => ({})); throw new Error(d.error || res.status); }
    const blob = await res.blob();
    // 跨網域讀不到 Content-Disposition，檔名在這裡用同樣的規則產生（今天日期_模組需求_元晶／逆變器需求_碩天）
    const t = new Date(), p2 = n => String(n).padStart(2, '0');
    const name = t.getFullYear() + p2(t.getMonth() + 1) + p2(t.getDate()) + (vendor === '元晶' ? '_模組需求_元晶.xlsx' : '_逆變器需求_碩天.xlsx');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    showToast('已產生 ' + name + '。寄給廠商前請打開確認;也建議存回 G 槽同一個資料夾,下次就以它為底稿');
  }catch(e){ showToast('產生失敗:' + e.message); }
  loadShipEdits();
}
