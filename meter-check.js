// ===================================================================
// 掛表資訊確認（2026-10-22；左側選單獨立一項，分頁：掛表案件／撤案案件）
// 取代 Google 試算表「7月掛錶案件異動」：選月份 → 列出當月掛表的案件（掛表日期＝Airtable「進度管理」
// 掛表里程碑的實際日期），對照「專案細節」的系統容量／工程合約電價，人工填「容量確認」「電價確認」，
// 電價對照電價表（MC_TARIFF，北／南＋容量級距），不一致標紅；下方記當月撤案案件＋案件狀況（同一段說明的案件合併顯示）。
// 後端：GET/POST /api/meter-check、DELETE /api/meter-check/<id>（epc-backend app.py「掛表資訊確認」區塊），
// 人工確認值存 Airtable「掛表資訊確認」表。
// ===================================================================
let MC_DATA = null;
let mcFilter = 'all';
let MC_TAB = 'cases';
let MC_MONTH = (function(){
  try{ const m = localStorage.getItem('mcMonth'); if(/^\d{4}-\d{2}$/.test(m || '')) return m; }catch(e){}
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);   // 預設上個月（通常是確認上個月掛表的案件）
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
})();

function mcEsc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function mcJs(v){ return mcEsc(String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")); }
function mcMe(){ try{ return localStorage.getItem('pdfPm') || ''; }catch(e){ return ''; } }
function mcNum(v){ return (v === null || v === undefined || v === '') ? null : Number(v); }
function mcSame(a, b, eps){ return a !== null && b !== null && Math.abs(a - b) < eps; }
function mcFmt(v){ return v === null || v === undefined || v === '' ? '' : String(Number(v)); }
function mcDate(d){ return d ? d.replace(/^(\d{4})-0?(\d+)-0?(\d+)$/, '$1/$2/$3') : ''; }
// 容量確認：人工填的優先，沒填就用台電契約／細部協商上讀到的容量（後端 doc_cap）
function mcDocCap(c){ return c.doc_cap ? mcNum(c.doc_cap.value) : null; }
function mcCapOk(c){ const v = mcNum(c.cap_confirm); return v !== null ? v : mcDocCap(c); }

// ---- 電價表（2026-10-22 使用者提供 115 年度第一期(1/1-6/30)、第二期(7/1-12/31)）----
// 我們用最右邊兩欄：高效&模組(南)／高效&模組(北)。期別（1–6 月第一期、7–12 月第二期）看哪一天：
//   掛表日在同意備案日 4 個月內 → 用同意備案日那一期；超過 4 個月 → 用掛表日那一期（電價可能已經掉了）。
// 依容量級距（10 kWp 以上算 10–20，以此類推）、案號裡的縣市決定北／南。
// 新的一期電價出來時，在這裡加一筆（key＝民國年-期別）。地面型、併網高壓等加乘沒有放進來。
const MC_TARIFF = {
  '115-1': {south: [6.0312, 5.7704, 4.5711, 4.3543, 4.0037, 3.9066], north: [6.8754, 6.5777, 5.2087, 4.9612, 4.5610, 4.4501]},
  '115-2': {south: [6.0312, 5.7704, 4.5711, 4.3543, 4.0037, 3.9066], north: [6.8754, 6.5777, 5.2087, 4.9612, 4.5610, 4.4501]},
};
const MC_TIERS = [10, 20, 50, 100, 500];   // 1-10／10-20／20-50／50-100／100-500／>500 kWp
const MC_TIER_LABEL = ['1-10', '10-20', '20-50', '50-100', '100-500', '>500'];
// 北部加乘地區（台電躉購北部地區；宜蘭使用者確認算北）；其他縣市算南
const MC_NORTH_RE = /(臺北|台北|新北|基隆|桃園|新竹|苗栗|宜蘭|花蓮)/;
const MC_SOUTH_RE = /(臺中|台中|彰化|南投|雲林|嘉義|臺南|台南|高雄|屏東|臺東|台東|澎湖|金門|連江)/;

function mcPeriod(date){
  const d = /^(\d{4})-(\d{2})/.exec(date || '');
  return d ? (Number(d[1]) - 1911) + '-' + (Number(d[2]) <= 6 ? 1 : 2) : '';
}
function mcPeriodName(p){ return p.replace('-', ' 年第') + '期'; }
// 同意備案日加 4 個月（月底遇到短月份就取那個月最後一天）
function mcAddMonths(date, n){
  const [y, m, d] = date.split('-').map(Number);
  const last = new Date(y, m - 1 + n + 1, 0).getDate();
  const t = new Date(y, m - 1 + n, Math.min(d, last));
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}
function mcPriceAt(period, region, tier){ const t = MC_TARIFF[period]; return t ? t[region][tier] : null; }

// 回傳 {price, label, basis, dropped} 或 {price: null, label: 原因}
//   basis：電價依據說明；dropped：超過同備 4 個月、掛表那期比同備那期便宜時 {from, to}
function mcTariff(c){
  if(!c.meter_date) return {price: null, label: '沒有掛表日期'};
  // 先看案號的縣市；看不出來（例：安南怡安謝秉翰）就看地址（後端給：業務自治區 A01資訊 → Airtable → 場勘）
  const regionOf = t => MC_NORTH_RE.test(t || '') ? 'north' : MC_SOUTH_RE.test(t || '') ? 'south' : null;
  let region = regionOf(c.case_no), byAddr = false;
  if(!region){ region = regionOf(c.address); byAddr = !!region; }
  if(!region) return {price: null, label: c.address ? '地址看不出縣市：' + c.address : '案號看不出縣市、也沒有地址'};
  const cap = mcCapOk(c) !== null ? mcCapOk(c) : mcNum(c.capacity);
  if(cap === null) return {price: null, label: '沒有容量'};
  let tier = MC_TIERS.findIndex(x => cap < x);
  if(tier < 0) tier = MC_TIERS.length;
  const meterP = mcPeriod(c.meter_date);
  let period = meterP, basis, dropped = null;
  if(!c.agree_date){
    basis = '沒有同備日，依掛表日';
  }else if(c.meter_date <= mcAddMonths(c.agree_date, 4)){
    period = mcPeriod(c.agree_date);
    basis = '同備 ' + mcDate(c.agree_date) + '，4 個月內掛表';
  }else{
    basis = '同備 ' + mcDate(c.agree_date) + '，超過 4 個月，依掛表日';
    const was = mcPriceAt(mcPeriod(c.agree_date), region, tier), now = mcPriceAt(meterP, region, tier);
    if(was !== null && now !== null && now < was) dropped = {from: was, to: now};
  }
  const price = mcPriceAt(period, region, tier);
  if(price === null) return {price: null, label: '沒有 ' + mcPeriodName(period) + '電價表', basis};
  return {price, label: mcPeriodName(period) + '・' + (region === 'north' ? '北' : '南') + (byAddr ? '（依地址）' : '') + ' ' + MC_TIER_LABEL[tier] + ' kWp', basis, dropped};
}
// 電價確認要對照的基準：電價表算得出來就用電價表，否則用 Airtable 工程合約電價
function mcPriceBase(c){ const t = mcTariff(c).price; return t !== null ? t : mcNum(c.price); }

// 每筆的確認狀態：待確認（還有沒填的）／不一致（填了但跟基準不同；基準沒有就不算不一致）／已確認
function mcState(c){
  const cap = mcNum(c.capacity), capOk = mcCapOk(c), price = mcPriceBase(c), priceOk = mcNum(c.price_confirm);
  const capBad = capOk !== null && cap !== null && !mcSame(cap, capOk, 0.0005);
  const priceBad = priceOk !== null && price !== null && !mcSame(price, priceOk, 0.00005);
  if(capBad || priceBad) return 'bad';
  if(capOk === null || priceOk === null) return 'todo';
  return 'ok';
}

function showMcTab(tab){
  if(!['cases', 'withdrawn'].includes(tab)) tab = 'cases';
  MC_TAB = tab;
  showView('metercheck');
  document.getElementById('mcCasesPanel').style.display = tab === 'cases' ? '' : 'none';
  document.getElementById('mcWdPanel').style.display = tab === 'withdrawn' ? '' : 'none';
  document.querySelectorAll('#view-metercheck .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'mc-' + tab));
  document.querySelectorAll('.nav-sub-item').forEach(n => n.classList.remove('active'));
  document.querySelector('.nav-sub-item[data-sub="mc-' + tab + '"]').classList.add('active');
  saveNavState({view: 'metercheck', mcTab: tab});
  if(!MC_DATA || MC_DATA.month !== MC_MONTH) loadMeterCheck();
}

async function loadMeterCheck(){
  const box = document.getElementById('mcBox');
  if(!box) return;
  const m = document.getElementById('mcMonth');
  if(m) m.value = MC_MONTH;
  box.innerHTML = '<div class="login-note">載入 ' + mcEsc(MC_MONTH) + ' 掛表案件…</div>';
  document.getElementById('mcWdBox').innerHTML = '<div class="login-note">載入 ' + mcEsc(MC_MONTH) + ' 撤案案件…</div>';
  try{
    const res = await fetch(API_BASE + '/api/meter-check?month=' + encodeURIComponent(MC_MONTH), {cache: 'no-store'});
    const d = await res.json();
    if(!res.ok || d.error) throw new Error(d.error || res.status);
    if(d.month !== MC_MONTH) return;   // 載入途中又換了月份
    MC_DATA = d;
  }catch(e){
    box.innerHTML = '<div class="login-note">載入失敗：' + mcEsc(e.message) + '</div>';
    document.getElementById('mcWdBox').innerHTML = box.innerHTML;
    return;
  }
  renderMeterCheck();
}

function mcSetMonth(v){
  if(!/^\d{4}-\d{2}$/.test(v || '')) return;
  MC_MONTH = v;
  try{ localStorage.setItem('mcMonth', v); }catch(e){}
  MC_DATA = null;
  loadMeterCheck();
}
function mcShiftMonth(delta){
  const [y, m] = MC_MONTH.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  mcSetMonth(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
}
function mcSetFilter(k){ mcFilter = k; renderMeterCheck(); }

// 容量確認下面的小字：值從哪份文件來（可以點開 PDF）、或為什麼沒有
function mcDocCapNote(c, fromDoc){
  const d = c.doc_cap;
  const style = 'font-size:11px;margin-top:2px;white-space:nowrap;';
  if(!d) return mcNum(c.cap_confirm) === null ? '<div class="cert-src" style="' + style + 'color:#B54708;">沒有台電契約／細部協商</div>' : '';
  const name = '📄 ' + mcEsc(d.kind) + (d.date ? ' ' + mcEsc(mcDate(d.date)) : '');
  const link = d.file_url ? '<a href="' + mcEsc(d.file_url) + '" target="_blank" rel="noopener" title="' + mcEsc(d.src || d.filename || '') + '">' + name + '</a>' : name;
  if(d.value === null || d.value === undefined) return '<div class="cert-src" style="' + style + 'color:#B54708;" title="' + mcEsc(d.src || '') + '">' + link + ' 讀不到容量</div>';
  if(fromDoc) return '<div class="cert-src" style="' + style + '" title="' + mcEsc(d.src || '') + '">' + link + '</div>';
  return mcSame(mcNum(d.value), mcNum(c.cap_confirm), 0.0005) ? '<div class="cert-src" style="' + style + '">' + link + '</div>'
    : '<div class="cert-src" style="' + style + '">手動填（' + link + '：' + mcEsc(mcFmt(d.value)) + '）</div>';
}

function renderMeterCheck(){
  const box = document.getElementById('mcBox');
  if(!box || !MC_DATA) return;
  const cases = MC_DATA.cases || [];
  const kw = ((document.getElementById('mcSearch') || {}).value || '').trim().replace(/台/g, '臺');
  const counts = {all: cases.length, todo: 0, bad: 0, ok: 0, drop: 0};
  cases.forEach(c => { counts[mcState(c)]++; if(mcTariff(c).dropped) counts.drop++; });
  let rows = mcFilter === 'all' ? cases : mcFilter === 'drop' ? cases.filter(c => mcTariff(c).dropped) : cases.filter(c => mcState(c) === mcFilter);
  if(kw) rows = rows.filter(c => [c.case_no, c.alias, c.vendor].some(v => String(v || '').replace(/台/g, '臺').includes(kw)));
  const totalCap = cases.reduce((s, c) => s + (mcNum(c.capacity) || 0), 0);
  const btn = (k, label) => '<button class="cert-filter-btn ' + (mcFilter === k ? 'active' : '') + '" onclick="mcSetFilter(\'' + k + '\')">' + label + ' ' + counts[k] + '</button>';

  const cell = (c, kind) => {
    const sys = kind === 'cap' ? mcNum(c.capacity) : mcPriceBase(c);
    const val = kind === 'cap' ? mcCapOk(c) : mcNum(c.price_confirm);
    const fromDoc = kind === 'cap' && mcNum(c.cap_confirm) === null && val !== null;   // 這個值是從文件帶的，還沒人工改過
    const eps = kind === 'cap' ? 0.0005 : 0.00005;
    const bg = val === null || sys === null ? '' : (mcSame(sys, val, eps) ? 'background:#E7F6EC;' : 'background:#FDECEC;color:#B42318;font-weight:700;');
    return '<td style="white-space:nowrap;">'
      + '<input type="number" step="any" class="quick-mark-input" style="width:92px;padding:4px 6px;' + bg + '" value="' + mcEsc(mcFmt(val)) + '"'
      + ' onchange="mcSave(\'' + mcJs(c.case_no) + '\',\'' + kind + '\',this.value)">'
      + (sys !== null && !mcSame(sys, val, eps) ? ' <button class="btn btn-ghost" title="' + (kind === 'cap' ? '跟 Airtable 一樣' : '跟電價表一樣') + '" style="padding:2px 7px;font-size:12px;" onclick="mcSave(\'' + mcJs(c.case_no) + '\',\'' + kind + '\',\'' + sys + '\')">✓</button>' : '')
      + (kind === 'cap' ? mcDocCapNote(c, fromDoc) : '')
      + '</td>';
  };
  const stPill = c => ({
    ok: '<span class="ops-status-pill ops-status-done">已確認</span>',
    bad: '<span class="ops-status-pill" style="background:#FDECEC;color:#B42318;">不一致</span>',
    todo: '<span class="ops-status-pill ops-status-pending">待確認</span>',
  })[mcState(c)];

  const keep = document.activeElement && document.activeElement.id === 'mcSearch';
  const draft = ['mcWdCases', 'mcWdNote'].map(id => (document.getElementById(id) || {}).value || '');
  box.innerHTML = '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">'
    + btn('all', '全部') + btn('todo', '待確認') + btn('bad', '不一致') + btn('ok', '已確認') + (counts.drop ? btn('drop', '⚠️ 電價掉了') : '')
    + '<input id="mcSearch" class="quick-mark-input" placeholder="搜尋案號、別名、廠商…" value="' + mcEsc(kw) + '" oninput="renderMeterCheck()" style="max-width:220px;">'
    + '<span class="cert-src" style="margin-left:auto;">共 ' + cases.length + ' 件・總容量 ' + (Math.round(totalCap * 1000) / 1000) + ' kW</span>'
    + '<button class="btn btn-ghost" style="padding:4px 10px;font-size:12px;" onclick="mcCopyTable()">📋 複製表格</button>'
    + '</div>'
    + '<div style="overflow:auto;"><table><thead><tr>'
    + '<th>案號</th><th>別名</th><th>掛表日期</th><th>施工廠商</th><th>容量</th><th>容量確認</th><th>電價表</th><th>Airtable<br>合約電價</th><th>電價確認</th><th>備註</th><th>狀態</th>'
    + '</tr></thead><tbody>'
    + (rows.length ? rows.map(c => '<tr>'
      + '<td style="white-space:nowrap;"><b>' + mcEsc(c.case_no) + '</b>'
      + (c.close_status && c.close_status !== '進行中' ? '<div class="cert-src">' + mcEsc(c.close_status) + '</div>' : '') + '</td>'
      + '<td style="white-space:nowrap;">' + mcEsc(c.alias) + '</td>'
      + '<td style="white-space:nowrap;">' + mcEsc(mcDate(c.meter_date)) + '</td>'
      + '<td style="white-space:nowrap;">' + mcEsc(c.vendor) + '</td>'
      + '<td>' + (mcNum(c.capacity) === null ? '<span class="cert-src" style="color:#B54708;">未填</span>' : mcEsc(mcFmt(c.capacity))) + '</td>'
      + cell(c, 'cap')
      + (t => '<td style="white-space:nowrap;">' + (t.price === null ? '<span class="cert-src" style="color:#B54708;">' + mcEsc(t.label) + '</span>'
        : '<b>' + mcEsc(mcFmt(t.price)) + '</b><div class="cert-src" style="font-size:11px;">' + mcEsc(t.label) + '</div>')
        + (t.basis ? '<div class="cert-src" style="font-size:11px;">' + mcEsc(t.basis) + '</div>' : '')
        + (t.dropped ? '<div style="font-size:11px;color:#B42318;font-weight:700;">⚠️ 電價掉了 ' + mcEsc(mcFmt(t.dropped.from)) + ' → ' + mcEsc(mcFmt(t.dropped.to)) + '</div>' : '')
        + '</td>')(mcTariff(c))
      + '<td>' + (mcNum(c.price) === null ? '<span class="cert-src" style="color:#B54708;">未填</span>'
        : mcEsc(mcFmt(c.price)) + (mcTariff(c).price !== null && !mcSame(mcTariff(c).price, mcNum(c.price), 0.00005)
          ? '<div style="font-size:11px;color:#B54708;font-weight:700;">≠ 電價表</div>' : '')) + '</td>'
      + cell(c, 'price')
      + '<td><input class="quick-mark-input" style="min-width:120px;padding:4px 6px;" value="' + mcEsc(c.note) + '" placeholder="—"'
      + ' onchange="mcSave(\'' + mcJs(c.case_no) + '\',\'note\',this.value)"></td>'
      + '<td style="white-space:nowrap;">' + stPill(c)
      + (c.by || c.updated ? '<div class="cert-src" style="font-size:11px;">' + mcEsc([c.by, c.updated].filter(Boolean).join(' ')) + '</div>' : '') + '</td>'
      + '</tr>').join('')
      : '<tr><td colspan="11" style="text-align:center;color:var(--text-muted);padding:20px 0;">' + (cases.length ? '沒有符合的案件' : MC_MONTH + ' 沒有掛表的案件') + '</td></tr>')
    + '</tbody></table></div>';
  document.getElementById('mcCasesCount').textContent = '(' + cases.length + ')';
  document.getElementById('mcWdCount').textContent = '(' + ((MC_DATA.withdrawn || []).length) + ')';
  document.getElementById('mcWdBox').innerHTML = renderMcWithdrawn();
  ['mcWdCases', 'mcWdNote'].forEach((id, i) => { if(draft[i]) document.getElementById(id).value = draft[i]; });
  if(keep){ const el = document.getElementById('mcSearch'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}

// 撤案案件：同一段「案件狀況」的案件合併成一格（跟試算表一樣），可以改說明、加案件、移除
function renderMcWithdrawn(){
  const list = (MC_DATA && MC_DATA.withdrawn) || [];
  const groups = mcGroups();
  let body = '';
  groups.forEach((g, gi) => {
    g.items.forEach((w, i) => {
      body += '<tr>'
        + '<td style="white-space:nowrap;"><b>' + mcEsc(w.case_no) + '</b>'
        + (w.close_status ? '<div class="cert-src">' + mcEsc(w.close_status) + '</div>' : '') + '</td>'
        + '<td>' + mcEsc(w.alias) + '</td><td>' + mcEsc(mcFmt(w.capacity)) + '</td><td>' + mcEsc(w.vendor) + '</td>'
        + (i === 0 ? '<td rowspan="' + g.items.length + '" style="white-space:pre-wrap;vertical-align:top;font-size:12.5px;line-height:1.6;">'
          + (g.note ? mcEsc(g.note) : '<span class="cert-src">（沒有說明）</span>')
          + '<div><button class="btn btn-ghost" style="padding:2px 8px;font-size:12px;margin-top:4px;" onclick="mcEditGroupNote(' + gi + ')">✏️ 修改說明</button></div></td>' : '')
        + '<td><button class="btn btn-ghost" style="padding:2px 8px;font-size:12px;" onclick="mcRemoveWithdrawn(\'' + mcJs(w.check_id) + '\',\'' + mcJs(w.case_no) + '\')">🗑</button></td>'
        + '</tr>';
    });
  });
  return '<div>'
    + '<div class="panel-title">' + mcEsc(MC_MONTH) + ' 撤案案件 <span class="module-tag tag-cloud" style="margin-left:6px;">共 ' + list.length + ' 筆</span></div>'
    + '<div style="overflow:auto;"><table><thead><tr><th>案號</th><th>別名</th><th>容量</th><th>施工廠商</th><th style="min-width:280px;">案件狀況</th><th></th></tr></thead><tbody>'
    + (body || '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:16px 0;">' + mcEsc(MC_MONTH) + ' 還沒有記錄撤案案件</td></tr>')
    + '</tbody></table></div>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;margin-top:10px;">'
    + '<textarea id="mcWdCases" class="quick-mark-input" rows="3" style="max-width:220px;font-family:inherit;" placeholder="案號（多筆用換行或逗號分開）&#10;例：潤特臺中8號"></textarea>'
    + '<textarea id="mcWdNote" class="quick-mark-input" rows="3" style="flex:1;min-width:240px;font-family:inherit;" placeholder="案件狀況（同一個原因的案件一起加，會合併顯示）"></textarea>'
    + (groups.length ? '<select id="mcWdGroup" class="quick-mark-input" style="max-width:200px;" onchange="mcPickGroup(this.value)"><option value="">或沿用已有的說明…</option>'
      + groups.map((g, i) => '<option value="' + i + '">' + mcEsc((g.note || '（沒有說明）').slice(0, 24)) + '</option>').join('') + '</select>' : '')
    + '<button class="btn btn-primary" style="padding:6px 14px;" onclick="mcAddWithdrawn()">＋ 加入撤案案件</button>'
    + '</div></div>';
}

function mcGroups(){
  const groups = [];
  ((MC_DATA && MC_DATA.withdrawn) || []).forEach(w => {
    const g = groups.find(x => x.note === w.note);
    if(g) g.items.push(w); else groups.push({note: w.note, items: [w]});
  });
  return groups;
}
function mcPickGroup(i){
  const g = mcGroups()[Number(i)];
  if(g) document.getElementById('mcWdNote').value = g.note;
}

async function mcPost(body){
  const res = await fetch(API_BASE + '/api/meter-check', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(Object.assign({month: MC_MONTH, by: mcMe()}, body)),
  });
  const d = await res.json().catch(() => ({}));
  if(!res.ok || d.error) throw new Error(d.error || res.status);
  return d;
}

async function mcSave(caseNo, kind, value){
  const c = (MC_DATA.cases || []).find(x => x.case_no === caseNo);
  if(!c) return;
  const key = {cap: 'cap_confirm', price: 'price_confirm', note: 'note'}[kind];
  const v = kind === 'note' ? String(value || '').trim() : (String(value).trim() === '' ? null : Number(value));
  if(kind !== 'note' && v !== null && isNaN(v)){ showToast('請輸入數字'); return; }
  const old = c[key];
  c[key] = v;
  renderMeterCheck();
  try{
    const d = await mcPost({case_no: caseNo, kind: '掛表', [key]: v});
    c.check_id = d.check_id;
    c.by = mcMe();
  }catch(e){
    c[key] = old;
    renderMeterCheck();
    showToast('儲存失敗：' + e.message);
  }
}

async function mcAddWithdrawn(){
  const nos = (document.getElementById('mcWdCases').value || '').split(/[\n,，、]+/).map(s => s.trim()).filter(Boolean);
  const note = (document.getElementById('mcWdNote').value || '').trim();
  if(!nos.length){ showToast('請輸入案號'); return; }
  try{
    for(const n of nos) await mcPost({case_no: n, kind: '撤案', note});
    document.getElementById('mcWdCases').value = '';
    document.getElementById('mcWdNote').value = '';
    showToast('已加入 ' + nos.length + ' 筆撤案案件');
    loadMeterCheck();
  }catch(e){ showToast('加入失敗：' + e.message); }
}

async function mcEditGroupNote(gi){
  const g = mcGroups()[gi];
  if(!g) return;
  const note = prompt('修改這 ' + g.items.length + ' 筆撤案案件的案件狀況：', g.note || '');
  if(note === null) return;
  try{
    for(const w of g.items) await mcPost({case_no: w.case_no, kind: '撤案', note: note.trim()});
    loadMeterCheck();
  }catch(e){ showToast('儲存失敗：' + e.message); }
}

async function mcRemoveWithdrawn(id, caseNo){
  if(!id || !confirm('從 ' + MC_MONTH + ' 撤案案件移除 ' + caseNo + '？（不會改 Airtable 案件本身）')) return;
  try{
    const res = await fetch(API_BASE + '/api/meter-check/' + encodeURIComponent(id), {method: 'DELETE'});
    const d = await res.json().catch(() => ({}));
    if(!res.ok || d.error) throw new Error(d.error || res.status);
    loadMeterCheck();
  }catch(e){ showToast('移除失敗：' + e.message); }
}

// 複製成 Tab 分隔，可以直接貼回 Google 試算表／Excel（欄位順序跟原本試算表一樣）
function mcCopyTable(){
  if(!MC_DATA) return;
  const lines = [['案號', '別名', '掛表日期', '施工廠商', '容量', '容量確認', '工程合約電價', '電價確認', '備註'].join('\t')];
  (MC_DATA.cases || []).forEach(c => lines.push([c.case_no, c.alias, mcDate(c.meter_date), c.vendor, mcFmt(c.capacity),
    mcFmt(mcCapOk(c)), mcFmt(mcPriceBase(c)), mcFmt(c.price_confirm), (c.note || '').replace(/\s+/g, ' ')].join('\t')));
  if((MC_DATA.withdrawn || []).length){
    lines.push('', '撤案案件', ['案號', '別名', '容量', '施工廠商', '案件狀況'].join('\t'));
    MC_DATA.withdrawn.forEach(w => lines.push([w.case_no, w.alias, mcFmt(w.capacity), w.vendor, (w.note || '').replace(/\s+/g, ' ')].join('\t')));
  }
  navigator.clipboard.writeText(lines.join('\n')).then(() => showToast('已複製，可以直接貼到試算表'), () => showToast('複製失敗'));
}

// 重新整理頁面時如果停在這一頁（導覽狀態還原比這支檔案早執行），切回記住的分頁
(function(){
  const v = document.getElementById('view-metercheck');
  if(!v || !v.classList.contains('active')) return;
  showMcTab(window.MC_RESTORE_TAB || 'cases');
})();
