// ===================================================================
// 掛表資訊確認（2026-10-22；左側選單獨立一項，分頁：掛表案件／撤案案件）
// 2026-10-23 使用者說明的流程：當月掛表的案件，比對「工程合約」（03 資料夾；容量、跟 EPC 簽約的電價）跟
// 「掛表時」（台電契約／細部協商的容量、依規則算的掛表當下電價）。兩個都一樣＝OK；有下修→廠商開折讓、
// 上調→廠商開發票，在頁面上追蹤處理進度（待廠商提供 → 已收到折讓／發票 → 已通知內部）。
// 工程合約那側目前用專案細節的系統容量／工程合約電價（可人工修正），之後再接 03 資料夾的合約檔。
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
// 完整電價表（「電價表」分頁顯示用；計算只用最後兩欄）。列：1-10／10-20／20-50／50-100／100-500／>500 kWp／地面型
const MC_TARIFF_COLS = ['原始電價', '北部加乘', 'nonvpc&回收(南)', 'nonvpc&回收(北)', '高效&模組(南)', '高效&模組(北)'];
const MC_TARIFF_ROWS = ['1 - 10 kWp', '10 - 20 kWp', '20 - 50 kWp', '50 - 100 kWp', '100 - 500 kWp', '>500 kWp', '地面型'];
const MC_TARIFF_FULL_115 = [
  [5.6279, 6.4721, 5.6935, 6.5377, 6.0312, 6.8754],
  [5.3819, 6.1892, 5.4475, 6.2548, 5.7704, 6.5777],
  [4.2505, 4.8881, 4.3161, 4.9537, 4.5711, 5.2087],
  [4.0459, 4.6528, 4.1115, 4.7184, 4.3543, 4.9612],
  [3.7152, 4.2725, 3.7808, 4.3381, 4.0037, 4.5610],
  [3.6236, 4.1671, 3.6892, 4.2327, 3.9066, 4.4501],
  [3.5037, 4.0293, 3.5693, 4.0949, 3.7795, 4.3051],
];
const MC_TARIFF_TABLES = {
  '115-1': {title: '115年度第一期電費(1/1-6/30)', rows: MC_TARIFF_FULL_115},
  '115-2': {title: '115年度第二期電費(7/1-12/31)', rows: MC_TARIFF_FULL_115,
    extras: [['併網低壓50-100', '+0.0688'], ['併網低壓100-500', '+0.0964'], ['併網高壓', '+0.0413'], ['加強電力網', '+0.1356']]},
};
// 計算用：高效&模組(南／北)，前 6 列（不含地面型）
const MC_TARIFF = Object.fromEntries(Object.entries(MC_TARIFF_TABLES).map(([k, t]) =>
  [k, {south: t.rows.slice(0, 6).map(r => r[4]), north: t.rows.slice(0, 6).map(r => r[5])}]));
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
// 掛表時電價：人工填的優先，沒填就直接帶依規則算出來的電價（不退回 Airtable：Airtable 那個是工程合約電價，是比對的另一邊）
function mcPriceOk(c){ const v = mcNum(c.price_confirm); return v !== null ? v : mcTariff(c).price; }
// 工程合約那側：人工修正 > 03 資料夾工程合約讀到的（後端 eng）> 專案細節的系統容量／工程合約電價
function mcEng(c, k){ return c.eng ? mcNum(c.eng[k]) : null; }
function mcContractCap(c){ const v = mcNum(c.contract_cap); return v !== null ? v : mcEng(c, 'cap') !== null ? mcEng(c, 'cap') : mcNum(c.capacity); }
function mcContractPrice(c){ const v = mcNum(c.contract_price); return v !== null ? v : mcEng(c, 'price') !== null ? mcEng(c, 'price') : mcNum(c.price); }
// 容量有差時估算折讓／發票金額：差的容量 × 工程單價 × 1.05（合約第參條六：價金依實際掛表容量結算）
function mcAdjAmount(c){
  const unit = mcEng(c, 'unit_price'), a = mcContractCap(c), b = mcCapOk(c);
  if(unit === null || a === null || b === null || mcSame(a, b, 0.0005)) return null;
  return Math.round(Math.abs(b - a) * unit * 1.05);
}
const MC_ADJ = ['待廠商提供', '已收到折讓／發票', '已通知內部'];
// 比對結果：{state: ok|adj|missing, items:[{what, from, to, dir}], need:[折讓|發票], missing:[…], done}
function mcCompare(c){
  const pairs = [['容量', mcContractCap(c), mcCapOk(c), 0.0005, 'kW'], ['電價', mcContractPrice(c), mcPriceOk(c), 0.00005, '']];
  const items = [], missing = [];
  pairs.forEach(([what, a, b, eps]) => {
    if(a === null) missing.push('工程合約' + what);
    if(b === null) missing.push('掛表時' + what);
    if(a !== null && b !== null && !mcSame(a, b, eps)) items.push({what, from: a, to: b, dir: b < a ? 'down' : 'up'});
  });
  const need = [];
  if(items.some(x => x.dir === 'down')) need.push('折讓');
  if(items.some(x => x.dir === 'up')) need.push('發票');
  const state = items.length ? 'adj' : missing.length ? 'missing' : 'ok';
  return {state, items, need, missing, done: state === 'adj' && c.adj_status === '已通知內部'};
}

function mcState(c){ return mcCompare(c).state; }

function showMcTab(tab){
  if(!['cases', 'withdrawn', 'tariff'].includes(tab)) tab = 'cases';
  MC_TAB = tab;
  showView('metercheck');
  document.getElementById('mcCasesPanel').style.display = tab === 'cases' ? '' : 'none';
  document.getElementById('mcWdPanel').style.display = tab === 'withdrawn' ? '' : 'none';
  document.getElementById('mcTariffPanel').style.display = tab === 'tariff' ? '' : 'none';
  if(tab === 'tariff') renderMcTariff();
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
  if(d.value === null || d.value === undefined) return '<div class="cert-src" style="' + style + 'color:#B54708;" title="' + mcEsc(d.src || '') + '">' + link
    + (String(d.src || '').startsWith('讀取中') ? ' 讀取中…' : ' 讀不到容量') + '</div>';
  if(fromDoc) return '<div class="cert-src" style="' + style + '" title="' + mcEsc(d.src || '') + '">' + link + '</div>';
  return mcSame(mcNum(d.value), mcNum(c.cap_confirm), 0.0005) ? '<div class="cert-src" style="' + style + '">' + link + '</div>'
    : '<div class="cert-src" style="' + style + '">手動填（' + link + '：' + mcEsc(mcFmt(d.value)) + '）</div>';
}

function renderMeterCheck(){
  const box = document.getElementById('mcBox');
  if(!box || !MC_DATA) return;
  const cases = MC_DATA.cases || [];
  const kw = ((document.getElementById('mcSearch') || {}).value || '').trim().replace(/台/g, '臺');
  const cmp = new Map(cases.map(c => [c, mcCompare(c)]));
  const counts = {all: cases.length, ok: 0, adj: 0, todo: 0, missing: 0, drop: 0};
  cases.forEach(c => { const r = cmp.get(c); counts[r.state]++; if(r.state === 'adj' && !r.done) counts.todo++; if(mcTariff(c).dropped) counts.drop++; });
  const flt = {all: c => true, ok: c => cmp.get(c).state === 'ok', adj: c => cmp.get(c).state === 'adj',
    todo: c => cmp.get(c).state === 'adj' && !cmp.get(c).done, missing: c => cmp.get(c).state === 'missing', drop: c => mcTariff(c).dropped};
  let rows = cases.filter(flt[mcFilter] || flt.all);
  if(kw) rows = rows.filter(c => [c.case_no, c.alias, c.vendor].some(v => String(v || '').replace(/台/g, '臺').includes(kw)));
  const totalCap = cases.reduce((s, c) => s + (mcNum(c.capacity) || 0), 0);
  const btn = (k, label) => '<button class="cert-filter-btn ' + (mcFilter === k ? 'active' : '') + '" onclick="mcSetFilter(\'' + k + '\')">' + label + ' ' + counts[k] + '</button>';
  const sub = (t, color) => '<div class="cert-src" style="font-size:11px;margin-top:2px;white-space:nowrap;' + (color ? 'color:' + color + ';' : '') + '">' + t + '</div>';
  // 一格數字輸入：base＝要比對的另一邊（工程合約），不同就標紅
  const inp = (c, key, val, base, eps) => {
    const bg = val === null || base === null ? '' : mcSame(val, base, eps) ? 'background:#E7F6EC;' : 'background:#FDECEC;color:#B42318;font-weight:700;';
    return '<input type="number" step="any" class="quick-mark-input" style="width:84px;padding:4px 6px;' + bg + '" value="' + mcEsc(mcFmt(val)) + '"'
      + ' onchange="mcSave(\'' + mcJs(c.case_no) + '\',\'' + key + '\',this.value)">';
  };
  const engLink = c => {
    const e = c.eng, name = '📄 工程合約' + (e.date ? ' ' + mcEsc(mcDate(e.date)) : '');
    return e.file_url ? '<a href="' + mcEsc(e.file_url) + '" target="_blank" rel="noopener" title="' + mcEsc(e.src || e.filename || '') + '">' + name + '</a>' : name;
  };
  // 工程合約那側的來源小字：手動修正／工程合約（可點開）／專案細節
  const contractCell = (c, key, val, engKey, airVal) => {
    const engVal = mcEng(c, engKey);
    let note;
    if(mcNum(c[key]) !== null) note = sub('手動修正（' + (engVal !== null ? engLink(c) + '：' + mcEsc(mcFmt(engVal)) : '專案細節 ' + mcEsc(mcFmt(airVal))) + '）');
    else if(engVal !== null) note = sub(engLink(c));
    else {
      const why = c.eng ? engLink(c) + (String(c.eng.src || '').startsWith('讀取中') ? ' 讀取中…' : ' 讀不到') : '';
      note = val === null ? sub(c.eng ? why : '沒有工程合約、專案細節也未填', '#B54708')
        : sub('專案細節' + (c.eng ? '（' + why + '）' : '（沒有工程合約）'), c.eng ? '#B54708' : '');
    }
    return '<td style="white-space:nowrap;">' + inp(c, key, val, null, 0) + note + '</td>';
  };
  const meterPriceNote = c => {
    const t = mcTariff(c);
    return (mcNum(c.price_confirm) !== null ? sub('手動填（規則：' + (t.price === null ? mcEsc(t.label) : mcEsc(mcFmt(t.price))) + '）')
        : t.price === null ? sub(mcEsc(t.label), '#B54708') : sub(mcEsc(t.label)))
      + (t.basis ? sub(mcEsc(t.basis)) : '')
      + (t.dropped ? sub('⚠️ 電價掉了 ' + mcEsc(mcFmt(t.dropped.from)) + ' → ' + mcEsc(mcFmt(t.dropped.to)), '#B42318') : '');
  };
  const resultCell = c => {
    const r = cmp.get(c);
    if(r.state === 'ok') return '<span class="ops-status-pill ops-status-done">OK</span>';
    if(r.state === 'missing') return '<span class="ops-status-pill ops-status-pending">資料不足</span>' + sub('缺：' + mcEsc(r.missing.join('、')), '#B54708');
    return r.items.map(x => '<div style="font-size:12.5px;white-space:nowrap;font-weight:700;color:' + (x.dir === 'down' ? '#B42318' : '#1E70C8') + ';">'
        + x.what + (x.dir === 'down' ? '下修 ' : '上調 ') + mcEsc(mcFmt(x.from)) + ' → ' + mcEsc(mcFmt(x.to)) + '</div>').join('')
      + '<div style="margin-top:3px;">' + r.need.map(n => '<span class="ops-status-pill" style="background:' + (n === '折讓' ? '#FDECEC;color:#B42318' : '#E8F1FB;color:#1E70C8') + ';margin-right:4px;">需' + n + '</span>').join('') + '</div>'
      + (mcAdjAmount(c) !== null ? sub('容量差估 NT$ ' + mcAdjAmount(c).toLocaleString() + '（含稅，單價 ' + mcEng(c, 'unit_price').toLocaleString() + '/kWp）') : '')
      + (r.missing.length ? sub('缺：' + mcEsc(r.missing.join('、')), '#B54708') : '');
  };
  const adjCell = c => {
    if(cmp.get(c).state !== 'adj') return '<span class="cert-src">—</span>';
    const cur = c.adj_status || '待廠商提供';
    return '<select class="quick-mark-input" style="min-width:132px;padding:4px 6px;font-size:12.5px;' + (cur === '已通知內部' ? 'background:#E7F6EC;' : cur === '待廠商提供' ? 'background:#FFF4E5;' : '') + '"'
      + ' onchange="mcSave(\'' + mcJs(c.case_no) + '\',\'adj\',this.value)">'
      + MC_ADJ.map(x => '<option' + (x === cur ? ' selected' : '') + '>' + x + '</option>').join('') + '</select>'
      + (c.by || c.updated ? sub(mcEsc([c.by, c.updated].filter(Boolean).join(' '))) : '');
  };

  const keep = document.activeElement && document.activeElement.id === 'mcSearch';
  const draft = ['mcWdCases', 'mcWdNote'].map(id => (document.getElementById(id) || {}).value || '');
  box.innerHTML = '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">'
    + btn('all', '全部') + btn('ok', 'OK') + btn('adj', '有調整') + btn('todo', '調整待處理') + btn('missing', '資料不足') + (counts.drop ? btn('drop', '⚠️ 電價掉了') : '')
    + '<input id="mcSearch" class="quick-mark-input" placeholder="搜尋案號、別名、廠商…" value="' + mcEsc(kw) + '" oninput="renderMeterCheck()" style="max-width:220px;">'
    + '<span class="cert-src" style="margin-left:auto;">共 ' + cases.length + ' 件・總容量 ' + (Math.round(totalCap * 1000) / 1000) + ' kW</span>'
    + '<button class="btn btn-ghost" style="padding:4px 10px;font-size:12px;" title="台電契約／細協／工程合約讀不到數字的，用新的規則重讀一次" onclick="mcReparse()">🔁 重讀讀不到的文件</button>'
    + '<button class="btn btn-ghost" style="padding:4px 10px;font-size:12px;" onclick="mcCopyTable()">📋 複製表格</button>'
    + '</div>'
    + '<div style="overflow:auto;"><table style="min-width:1280px;"><thead>'
    + '<tr><th rowspan="2">案號／別名</th><th rowspan="2">掛表日期</th><th rowspan="2">施工廠商</th>'
    + '<th colspan="2" style="text-align:center;background:#F4F6F8;">📑 工程合約</th><th colspan="2" style="text-align:center;background:#FFF8EC;">🔌 掛表時</th>'
    + '<th rowspan="2">比對結果</th><th rowspan="2" style="white-space:nowrap;">調整處理</th><th rowspan="2">備註</th></tr>'
    + '<tr><th style="background:#F4F6F8;">容量</th><th style="background:#F4F6F8;">電價</th><th style="background:#FFF8EC;">容量<div class="cert-src" style="font-weight:400;">台電契約／細協</div></th><th style="background:#FFF8EC;">電價<div class="cert-src" style="font-weight:400;">依規則</div></th></tr>'
    + '</thead><tbody>'
    + (rows.length ? rows.map(c => '<tr>'
      + '<td style="white-space:nowrap;"><b>' + mcEsc(c.case_no) + '</b>' + (c.alias && c.alias !== c.case_no ? '<div class="cert-src">' + mcEsc(c.alias) + '</div>' : '')
      + (c.close_status && c.close_status !== '進行中' ? '<div class="cert-src">' + mcEsc(c.close_status) + '</div>' : '') + '</td>'
      + '<td style="white-space:nowrap;">' + mcEsc(mcDate(c.meter_date)) + '</td>'
      + '<td style="white-space:nowrap;">' + mcEsc(c.vendor) + '</td>'
      + contractCell(c, 'contract_cap', mcContractCap(c), 'cap', mcNum(c.capacity))
      + contractCell(c, 'contract_price', mcContractPrice(c), 'price', mcNum(c.price))
      + '<td style="white-space:nowrap;">' + inp(c, 'cap', mcCapOk(c), mcContractCap(c), 0.0005) + mcDocCapNote(c, mcNum(c.cap_confirm) === null && mcCapOk(c) !== null) + '</td>'
      + '<td style="white-space:nowrap;">' + inp(c, 'price', mcPriceOk(c), mcContractPrice(c), 0.00005) + meterPriceNote(c) + '</td>'
      + '<td>' + resultCell(c) + '</td>'
      + '<td>' + adjCell(c) + '</td>'
      + '<td><input class="quick-mark-input" style="min-width:110px;padding:4px 6px;" value="' + mcEsc(c.note) + '" placeholder="—"'
      + ' onchange="mcSave(\'' + mcJs(c.case_no) + '\',\'note\',this.value)"></td>'
      + '</tr>').join('')
      : '<tr><td colspan="10" style="text-align:center;color:var(--text-muted);padding:20px 0;">' + (cases.length ? '沒有符合的案件' : MC_MONTH + ' 沒有掛表的案件') + '</td></tr>')
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
  const key = {cap: 'cap_confirm', price: 'price_confirm', note: 'note', contract_cap: 'contract_cap', contract_price: 'contract_price', adj: 'adj_status'}[kind];
  const text = kind === 'note' || kind === 'adj';
  const v = text ? String(value || '').trim() : (String(value).trim() === '' ? null : Number(value));
  if(!text && v !== null && isNaN(v)){ showToast('請輸入數字'); return; }
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

// 「電價表」分頁：每一期一張完整表，標出我們用的兩欄（高效&模組 南／北）和今天適用的那一期
function renderMcTariff(){
  const box = document.getElementById('mcTariffBox');
  if(!box) return;
  const now = mcPeriod(new Date().toISOString().slice(0, 10));
  const use = i => i >= 4;
  box.innerHTML = Object.entries(MC_TARIFF_TABLES).sort((a, b) => b[0].localeCompare(a[0])).map(([k, t]) =>
    '<div style="margin-bottom:22px;">'
    + '<div class="panel-title">' + mcEsc(t.title) + (k === now ? ' <span class="module-tag tag-cloud" style="margin-left:6px;">目前這一期</span>' : '') + '</div>'
    + '<div style="overflow:auto;"><table style="min-width:760px;"><thead><tr><th>容量</th>'
    + MC_TARIFF_COLS.map((c, i) => '<th style="text-align:right;' + (use(i) ? 'background:#FFF4E5;color:#B54708;' : '') + '">' + mcEsc(c) + '</th>').join('')
    + '</tr></thead><tbody>'
    + t.rows.map((r, ri) => '<tr><td style="white-space:nowrap;font-weight:600;">' + mcEsc(MC_TARIFF_ROWS[ri]) + '</td>'
      + r.map((v, i) => '<td style="text-align:right;font-variant-numeric:tabular-nums;' + (use(i) ? 'background:#FFF8EC;font-weight:700;' : '') + '">' + v.toFixed(4) + '</td>').join('') + '</tr>').join('')
    + '</tbody></table></div>'
    + (t.extras ? '<div class="cert-src" style="margin-top:6px;">加乘：' + t.extras.map(e => mcEsc(e[0]) + ' ' + mcEsc(e[1])).join('　') + '</div>' : '')
    + '</div>').join('')
    + '<div class="login-note"><div style="line-height:1.7;">'
    + '<div>🔗 橘色兩欄「高效&模組(南／北)」是我們用的電價，掛表案件分頁的電價就是從這兩欄算的：</div>'
    + '<div>・期別：1–6 月第一期、7–12 月第二期，看掛表日；掛表日在同意備案日 4 個月內，用同備日那一期。</div>'
    + '<div>・北／南：新北、桃園、新竹、苗栗、宜蘭等北部用（北），其他用（南）；案號看不出縣市就看地址。</div>'
    + '<div>・容量級距：下限含、上限不含（10 kWp 算 10–20），有台電契約／細協的容量就用那個。</div>'
    + '<div>新的一期電價出來，把表傳給 Claude 加進來（meter-check.js 的 MC_TARIFF_TABLES）。</div>'
    + '</div></div>';
}

async function mcReparse(){
  try{
    const res = await fetch(API_BASE + '/api/procurement/drawings/reparse', {method: 'POST'});
    const d = await res.json().catch(() => ({}));
    if(!res.ok || d.error) throw new Error(d.error || res.status);
    showToast(d.queued ? '已排 ' + d.queued + ' 份重讀（一份約 10～40 秒），過一陣子再按 🔄 重新整理' : '沒有讀不到的文件');
  }catch(e){ showToast('重讀失敗：' + e.message); }
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
  const lines = [['案號', '別名', '掛表日期', '施工廠商', '工程合約容量', '工程合約電價', '掛表時容量', '掛表時電價', '比對結果', '調整處理', '備註'].join('\t')];
  (MC_DATA.cases || []).forEach(c => {
    const r = mcCompare(c);
    const res = r.state === 'ok' ? 'OK' : r.state === 'missing' ? '資料不足（缺' + r.missing.join('、') + '）'
      : r.items.map(x => x.what + (x.dir === 'down' ? '下修' : '上調') + mcFmt(x.from) + '→' + mcFmt(x.to)).join('；') + '（需' + r.need.join('、')
        + (mcAdjAmount(c) !== null ? '，容量差估 NT$' + mcAdjAmount(c) + ' 含稅' : '') + '）';
    lines.push([c.case_no, c.alias, mcDate(c.meter_date), c.vendor, mcFmt(mcContractCap(c)), mcFmt(mcContractPrice(c)),
      mcFmt(mcCapOk(c)), mcFmt(mcPriceOk(c)), res, r.state === 'adj' ? (c.adj_status || '待廠商提供') : '', (c.note || '').replace(/\s+/g, ' ')].join('\t'));
  });
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
