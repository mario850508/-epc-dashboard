// ===================================================================
// 發票請款（2026-10-28；左側選單獨立一項）
// 廠商開發票向我們請款：上傳發票掃描檔（PDF，可多頁、一頁一張）→ 後端 Claude 讀發票 → 比對案場（合約編號／
// 案號／簡寫）、請款節點（工程合約七期）、發票總計 vs 工程合約該期含稅金額、該期要的函文有沒有拿到。
// 一張發票一筆，存 Airtable「發票請款」表；可人工改案號／節點／金額後重新檢查；狀態 待確認→可付款／退回→已付款。
// 後端：POST /api/invoice/upload → GET /api/invoice/jobs/<id>（輪詢）、GET /api/invoice/list、
// POST /api/invoice/<id>/recheck、POST /api/invoice/<id>/status、DELETE /api/invoice/<id>、GET /api/invoice/cases
// ===================================================================
let INV_ITEMS = [];
let INV_NODES = ['簽約款', '同意備案款', '材料訂購款', '工班進場款', '掛錶驗收款', '設備登記款', '正式售電款'];
let INV_FILTER = 'todo';
let INV_CASES = null;
let INV_OPEN_ID = null;

function invEsc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function invMoney(v){ return (v === null || v === undefined || v === '') ? '—' : Number(v).toLocaleString('zh-TW', {maximumFractionDigits: 0}); }
function invUser(){ try{ return localStorage.getItem('pdfPm') || ''; }catch(e){ return ''; } }
function invProblem(it){
  const c = it.check || {};
  return !(c.amount && c.amount.ok) || !c.docs_ok || (c.warnings || []).length > 0;
}
function invStatusPill(s){
  const cls = {'待確認': 'ops-status-pending', '可付款': 'ops-status-done', '已付款': 'ops-status-pdf', '退回': 'inv-pill-bad'}[s] || 'ops-status-pending';
  return `<span class="ops-status-pill ${cls}">${invEsc(s || '待確認')}</span>`;
}
function invOkBadge(ok, label){
  if(!label) return '<span class="inv-muted">—</span>';
  return `<span class="inv-badge ${ok ? 'inv-ok' : 'inv-bad'}">${ok ? '✓' : '✗'} ${invEsc(label)}</span>`;
}

async function loadInvoices(){
  const box = document.getElementById('invBox');
  if(!INV_ITEMS.length) box.innerHTML = '<div class="login-note">載入中…</div>';
  try{
    const res = await fetch(API_BASE + '/api/invoice/list', {cache: 'no-store'});
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || '載入失敗');
    INV_ITEMS = data.items || [];
    if(data.nodes) INV_NODES = data.nodes;
    renderInvoices();
    if(INV_OPEN_ID && document.getElementById('invModalOverlay').classList.contains('show')) openInvoiceModal(INV_OPEN_ID);
  }catch(e){
    box.innerHTML = `<div class="login-note">載入失敗：${invEsc(e.message)}</div>`;
  }
}

function setInvFilter(f){ INV_FILTER = f; renderInvoices(); }

// ---- 廠商分類（2026-10-28 使用者：全部混在一起很亂，要能只看尚展／三創／曙光…，「全部」也保留）----
const INV_VENDOR_NAMES = ['三創', '尚展', '曙光', '光鼎', '宇陽達', '聚曜', '澄品', '大昇', '展亦', '凰太竹', '國欽', '振庭'];
let INV_VENDOR = (function(){ try{ return localStorage.getItem('invVendor') || 'all'; }catch(e){ return 'all'; } })();
// 廠商＝比對到的案場的施作廠商；比對不到案場的看發票賣方名稱
function invVendorOf(it){
  if(it.vendor) return it.vendor;
  const s = it.seller || '';
  return INV_VENDOR_NAMES.find(v => s.includes(v)) || '其他';
}
function setInvVendor(v){
  INV_VENDOR = v;
  try{ localStorage.setItem('invVendor', v); }catch(e){}
  renderInvoices();
}
function renderInvVendorTabs(){
  const counts = {};
  INV_ITEMS.forEach(it => { const v = invVendorOf(it); counts[v] = (counts[v] || 0) + 1; });
  const vendors = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  if(INV_VENDOR !== 'all' && !counts[INV_VENDOR]) vendors.push(INV_VENDOR);
  document.getElementById('invVendorTabs').innerHTML = [['all', '全部', INV_ITEMS.length]].concat(vendors.map(v => [v, v, counts[v] || 0]))
    .map(([k, label, n]) => `<div class="tab ${INV_VENDOR === k ? 'active' : ''}" onclick="setInvVendor('${invEsc(k)}')">${invEsc(label)} <span class="inv-muted">${n}</span></div>`).join('');
}

function renderInvoices(){
  renderInvVendorTabs();
  const q = (document.getElementById('invSearch') || {}).value || '';
  const scoped = INV_ITEMS.filter(it => INV_VENDOR === 'all' || invVendorOf(it) === INV_VENDOR);
  const counts = {todo: 0, problem: 0, ok: 0, '可付款': 0, '退回': 0, '已付款': 0, all: scoped.length};
  scoped.forEach(it => {
    const s = it.status || '待確認';
    if(s === '待確認'){ counts.todo++; if(invProblem(it)) counts.problem++; else counts.ok++; }
    else counts[s] = (counts[s] || 0) + 1;
  });
  const filters = [['todo', '待確認'], ['problem', '待確認・有問題'], ['ok', '待確認・全部符合'], ['可付款', '可付款'], ['退回', '退回'], ['已付款', '已付款'], ['all', '全部']];
  document.getElementById('invFilters').innerHTML = filters.map(([k, label]) =>
    `<button class="cert-filter-btn ${INV_FILTER === k ? 'active' : ''}" onclick="setInvFilter('${k}')">${label} ${counts[k] || 0}</button>`).join(' ');

  let list = scoped.filter(it => {
    const s = it.status || '待確認';
    if(INV_FILTER === 'todo') return s === '待確認';
    if(INV_FILTER === 'problem') return s === '待確認' && invProblem(it);
    if(INV_FILTER === 'ok') return s === '待確認' && !invProblem(it);
    if(INV_FILTER === 'all') return true;
    return s === INV_FILTER;
  });
  if(q.trim()){
    const k = q.trim().toLowerCase();
    list = list.filter(it => [it.invoice_no, it.case_no, it.alias, it.vendor, it.seller, it.items, it.src_name].join(' ').toLowerCase().includes(k));
  }
  const box = document.getElementById('invBox');
  INV_LIST = list;
  renderInvSelBar();
  if(!list.length){ box.innerHTML = '<div class="login-note">沒有符合的發票</div>'; return; }
  const allOn = list.every(it => INV_SELECTED.has(it.id));
  box.innerHTML = '<div style="overflow-x:auto;"><table class="mc-table"><thead><tr>'
    + `<th style="width:28px;"><input type="checkbox" title="全選目前列表" ${allOn ? 'checked' : ''} onclick="invSelectAll(this.checked)"></th>`
    + '<th>發票</th><th>案場</th><th>請款節點</th><th style="text-align:right;">發票總計</th><th style="text-align:right;">合約金額</th><th>金額</th><th>函文</th><th>狀態</th></tr></thead><tbody>'
    + list.map(it => {
      const c = it.check || {};
      const warn = (c.warnings || []).length;
      return `<tr class="inv-row" onclick="openInvoiceModal('${it.id}')">
        <td onclick="event.stopPropagation()"><input type="checkbox" ${INV_SELECTED.has(it.id) ? 'checked' : ''} onclick="invToggleSel('${it.id}', this.checked)"></td>
        <td><div style="font-weight:700;">${invEsc(it.invoice_no)}</div><div class="inv-muted">${invEsc(it.date || '')}　${invEsc(it.seller || '')}</div></td>
        <td>${it.case_no ? `<div style="font-weight:700;">${invEsc(it.case_no)}</div><div class="inv-muted">${invEsc(it.alias || '')}　${invEsc(it.vendor || '')}</div>` : '<span class="inv-badge inv-bad">比對不到案場</span>'}</td>
        <td>${invEsc(it.nodes || '') || '<span class="inv-badge inv-bad">未判斷</span>'}<div class="inv-muted">${invEsc(it.items || '')}</div></td>
        <td style="text-align:right;">${invMoney(it.total)}</td>
        <td style="text-align:right;">${invMoney(it.expected)}</td>
        <td>${invOkBadge(c.amount && c.amount.ok, it.amount_check)}</td>
        <td>${invOkBadge(c.docs_ok, it.doc_check)}${warn ? `<div class="inv-warn-mini">⚠ ${warn} 個提醒</div>` : ''}</td>
        <td>${invStatusPill(it.status)}</td></tr>`;
    }).join('') + '</tbody></table></div>';
}

// ---- 勾選 → 發票明細（給廠商）／拆分 PDF 打包下載（2026-10-28）----
let INV_SELECTED = new Set();
let INV_LIST = [];
function invToggleSel(id, on){ if(on) INV_SELECTED.add(id); else INV_SELECTED.delete(id); renderInvSelBar(); }
function invSelectAll(on){ INV_LIST.forEach(it => on ? INV_SELECTED.add(it.id) : INV_SELECTED.delete(it.id)); renderInvoices(); }
function invSelected(){ return INV_ITEMS.filter(it => INV_SELECTED.has(it.id)); }
function renderInvSelBar(){
  const bar = document.getElementById('invSelBar');
  if(!bar) return;
  [...INV_SELECTED].forEach(id => { if(!INV_ITEMS.some(it => it.id === id)) INV_SELECTED.delete(id); });
  const sel = invSelected();
  if(!sel.length){ bar.style.display = 'none'; return; }
  const total = sel.reduce((s, it) => s + (Number(it.total) || 0), 0);
  bar.style.display = 'flex';
  bar.innerHTML = `<b>已勾選 ${sel.length} 張</b><span class="inv-muted">合計 ${invMoney(total)}</span>
    <button class="btn" style="padding:6px 12px;font-size:12.5px;" onclick="openInvDetailSheet()">📋 發票明細（給廠商）</button>
    <button class="btn btn-ghost" style="padding:6px 12px;font-size:12.5px;" onclick="downloadInvZip()">📦 下載拆分的發票 PDF（ZIP）</button>
    <button class="btn btn-ghost" style="padding:6px 12px;font-size:12.5px;" onclick="INV_SELECTED.clear(); renderInvoices();">取消勾選</button>`;
}

// 案場簡稱：潤特宜蘭33號→宜33、工程宜蘭5號→工宜5、潤特新竹47號→竹47（照使用者給廠商的發票明細寫法）
const INV_COUNTY_SHORT = {'桃園': '桃', '新竹': '竹', '苗栗': '苗', '宜蘭': '宜', '臺中': '中', '台中': '中', '彰化': '彰', '雲林': '雲', '南投': '投',
  '嘉義': '嘉', '臺南': '南', '台南': '南', '高雄': '高', '屏東': '屏', '臺北': '北', '台北': '北', '新北': '新北', '基隆': '基', '花蓮': '花', '臺東': '東', '台東': '東'};
const INV_NODE_SHORT = {'簽約款': '簽約', '同意備案款': '同備', '材料訂購款': '材料', '工班進場款': '進場', '掛錶驗收款': '掛表', '設備登記款': '設登', '正式售電款': '售電'};
function invCaseShort(caseNo){
  const m = /^(潤特|工程)(\D+?)(\d+)號?$/.exec(caseNo || '');
  if(!m) return caseNo || '';
  return (m[1] === '工程' ? '工' : '') + (INV_COUNTY_SHORT[m[2]] || m[2]) + m[3];
}
function invSlashDate(d){ const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? `${m[1]}/${+m[2]}/${+m[3]}` : (d || ''); }
function invDetailRows(){
  return invSelected().sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.invoice_no || '').localeCompare(b.invoice_no || '')).map(it => {
    const short = invCaseShort(it.case_no);
    const nodes = (it.nodes || '').split('、').filter(Boolean).map(n => INV_NODE_SHORT[n] || n).join('+');
    return [invSlashDate(it.date), it.invoice_no || '', short, short + (nodes ? '-' + nodes : ''), it.sales == null ? '' : it.sales, it.tax == null ? '' : it.tax, it.total == null ? '' : it.total];
  });
}
function openInvDetailSheet(){
  const rows = invDetailRows();
  const sum = rows.reduce((s, r) => s + (Number(r[6]) || 0), 0);
  let pay = '';
  try{ pay = localStorage.getItem('invPayDate') || ''; }catch(e){}
  document.getElementById('invModalTitle').textContent = `發票明細（${rows.length} 張）`;
  document.getElementById('invModalBody').innerHTML = `
    <div class="inv-muted">複製後直接貼到廠商同步的 Google Sheets（從「付款日期」那一列的 A 欄貼上）。案場、摘要照你們的寫法自動帶，貼上後可再改。</div>
    <div style="display:flex;gap:8px;align-items:center;margin:10px 0;flex-wrap:wrap;">
      <label style="font-size:13px;">付款日期 <input id="invPayDate" type="date" class="cert-rename-input" style="width:160px;padding:4px 8px;" value="${invEsc(pay)}"></label>
      <label style="font-size:13px;"><input type="checkbox" id="invPayRow" checked> 含「付款日期」列</label>
      <label style="font-size:13px;"><input type="checkbox" id="invHeadRow" checked> 含標題列</label>
      <label style="font-size:13px;"><input type="checkbox" id="invSumRow" checked> 含「總計」列</label>
      <button class="btn" style="padding:6px 14px;font-size:12.5px;" onclick="copyInvDetail()">📋 複製（貼到 Google Sheets）</button>
    </div>
    <div style="overflow-x:auto;"><table class="mc-table"><thead><tr><th>發票日期</th><th>字軌</th><th>案場</th><th>摘要</th><th style="text-align:right;">稅前</th><th style="text-align:right;">稅</th><th style="text-align:right;">金額</th></tr></thead><tbody>
      ${rows.map(r => `<tr>${r.map((v, i) => `<td style="${i >= 4 ? 'text-align:right;' : ''}">${i >= 4 ? invMoney(v) : invEsc(v)}</td>`).join('')}</tr>`).join('')}
      <tr><td colspan="6" style="text-align:center;font-weight:700;">總計</td><td style="text-align:right;font-weight:700;">${invMoney(sum)}</td></tr>
    </tbody></table></div>`;
  INV_OPEN_ID = 'detail';
  document.getElementById('invModalOverlay').classList.add('show');
}
async function copyInvDetail(){
  const rows = invDetailRows();
  const pay = document.getElementById('invPayDate').value;
  try{ localStorage.setItem('invPayDate', pay); }catch(e){}
  const sum = rows.reduce((s, r) => s + (Number(r[6]) || 0), 0);
  const lines = [];
  // 對齊廠商 Sheets：A 發票日期 B 字軌 C 案場 D 摘要 E 稅前 F 稅 G 金額；「付款日期」「總計」字放 D 欄、數字放 G 欄
  if(document.getElementById('invPayRow').checked) lines.push(['', '', '', '付款日期', '', '', invSlashDate(pay)]);
  if(document.getElementById('invHeadRow').checked) lines.push(['發票日期', '字軌', '案場', '摘要', '稅前', '稅', '金額']);
  rows.forEach(r => lines.push(r));
  if(document.getElementById('invSumRow').checked) lines.push(['', '', '', '總計', '', '', sum]);
  const tsv = lines.map(r => r.join('\t')).join('\n');
  try{
    await navigator.clipboard.writeText(tsv);
    showToast(`已複製 ${rows.length} 張，到 Google Sheets 貼上`);
  }catch(e){
    showToast('複製失敗：' + e.message);
  }
}
async function downloadInvZip(){
  const sel = invSelected();
  if(!sel.length) return;
  showToast(`打包 ${sel.length} 張發票中…`);
  try{
    const res = await fetch(API_BASE + '/api/invoice/zip', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ids: sel.map(it => it.id)})});
    if(!res.ok){ const d = await res.json().catch(() => ({})); throw new Error(d.error || res.status); }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = m ? decodeURIComponent(m[1]) : '發票掃描檔.zip';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    const missing = decodeURIComponent(res.headers.get('X-Missing') || '');
    showToast(missing ? `已下載；這幾張沒有檔案：${missing}` : `已下載 ${sel.length} 個發票 PDF`);
  }catch(e){ showToast('下載失敗：' + e.message); }
}
async function invCopy(text, label){
  try{ await navigator.clipboard.writeText(String(text == null ? '' : text)); showToast('已複製' + label + '：' + text); }
  catch(e){ showToast('複製失敗：' + e.message); }
}

// ---- 上傳 ----
function initInvoiceDrop(){
  const zone = document.getElementById('invDrop');
  if(!zone || zone.dataset.init) return;
  zone.dataset.init = '1';
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag'); uploadInvoices(e.dataTransfer.files); });
}

async function uploadInvoices(fileList){
  const files = Array.from(fileList || []).filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  if(!files.length){ showToast('請選擇 PDF 檔'); return; }
  const prog = document.getElementById('invProgress');
  const fd = new FormData();
  files.slice(0, 10).forEach(f => fd.append('files', f, f.name));
  fd.append('uploader', invUser());
  prog.textContent = `上傳中（${files.length} 份）…`;
  try{
    const res = await fetch(API_BASE + '/api/invoice/upload', {method: 'POST', body: fd});
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || '上傳失敗');
    pollInvoiceJob(data.job_id);
  }catch(e){
    prog.textContent = '✗ ' + e.message;
  }
  document.getElementById('invFileInput').value = '';
}

async function pollInvoiceJob(jobId){
  const prog = document.getElementById('invProgress');
  try{
    const res = await fetch(API_BASE + '/api/invoice/jobs/' + jobId, {cache: 'no-store'});
    const job = await res.json();
    if(!res.ok) throw new Error(job.error || '查詢失敗');
    if(job.status === 'running'){
      prog.textContent = `辨識中… ${job.done} / ${job.total}（一頁約 15～30 秒）`;
      setTimeout(() => pollInvoiceJob(jobId), 4000);
      if(job.done) loadInvoices();
      return;
    }
    const r = job.results || [];
    const ok = r.filter(x => x.record_id && !x.duplicate).length;
    const dup = r.filter(x => x.replaced).map(x => x.invoice_no);
    const err = r.filter(x => x.error).map(x => `${x.invoice_no || x.file}：${x.error}`);
    prog.textContent = `✓ 新增 ${ok - dup.length} 張發票` + (dup.length ? `；已存在、覆蓋舊資料 ${dup.length} 張：${dup.join('、')}` : '') + (err.length ? `；✗ ${err.join('；')}` : '') + (job.error ? `；✗ ${job.error}` : '');
    INV_FILTER = 'todo';
    loadInvoices();
  }catch(e){
    prog.textContent = '✗ ' + e.message;
  }
}

// ---- 詳細／修正 ----
async function invEnsureCases(){
  if(INV_CASES) return;
  try{
    const res = await fetch(API_BASE + '/api/invoice/cases');
    INV_CASES = (await res.json()).cases || [];
    document.getElementById('invCaseList').innerHTML = INV_CASES.map(c => `<option value="${invEsc(c.case_no)}">${invEsc(c.alias)} ${invEsc(c.vendor)}</option>`).join('');
  }catch(e){ INV_CASES = null; }
}

function openInvoiceModal(id){
  const it = INV_ITEMS.find(x => x.id === id);
  if(!it) return;
  INV_OPEN_ID = id;
  invEnsureCases();
  const c = it.check || {};
  const ext = it.ext || {};
  const amt = c.amount || {};
  const sched = (c.contract && c.contract.sched) || {};
  const nodes = c.nodes || [];
  document.getElementById('invModalTitle').textContent = `發票 ${it.invoice_no}` + (it.case_no ? `｜${it.case_no}` : '');
  const warnings = (c.warnings || []).map(w => `<li>${invEsc(w)}</li>`).join('');
  const docs = (c.docs || []).map(d => `<div class="inv-doc-node"><div class="inv-doc-node-title">${invEsc(d.node)}</div>`
    + d.reqs.map(r => `<div class="inv-doc-req ${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓' : '✗'} ${invEsc(r.label)}`
      + (r.found.length ? `<div class="inv-src">${r.found.map(invEsc).join('<br>')}</div>` : '')
      + (r.pending.length ? `<div class="inv-src inv-src-bad">${r.pending.map(invEsc).join('<br>')}</div>` : '')
      + (!r.found.length && !r.pending.length ? '<div class="inv-src inv-src-bad">Airtable／案件資料都找不到</div>' : '')
      + '</div>').join('') + '</div>').join('');
  const schedRows = INV_NODES.filter(n => sched[n]).map(n => `<tr class="${nodes.includes(n) ? 'inv-sched-on' : ''}"><td>${n}</td><td style="text-align:right;">${sched[n].pct}%</td><td style="text-align:right;">${invMoney(sched[n].amount)}${sched[n].calc ? '<span class="inv-muted">（總價×比例）</span>' : ''}</td></tr>`).join('');
  const cand = (c.candidates || []).slice(0, 3).map(x => `<div class="inv-src">${invEsc(x.case_no)} ${invEsc(x.alias)}（${invEsc(x.why)}）</div>`).join('');
  document.getElementById('invModalBody').innerHTML = `<div class="cert-modal-grid">
    <div>${it.file_url ? `<iframe class="cert-pdf-frame" src="${invEsc(it.file_url)}#view=FitH"></iframe>` : '<div class="login-note">沒有附件</div>'}</div>
    <div class="inv-side">
      ${warnings ? `<div class="inv-warn-box"><b>⚠ 提醒</b><ul>${warnings}</ul></div>` : ''}
      <div class="cert-side-label">發票內容（AI 辨識）</div>
      <div class="inv-kv">
        <div>發票號碼</div><div>${invEsc(it.invoice_no)}</div>
        <div>日期</div><div>${invEsc(it.date || '')}</div>
        <div>賣方</div><div>${invEsc(it.seller || '')}</div>
        <div>品名</div><div>${invEsc(it.items || '')}</div>
        <div>備註</div><div>${invEsc(ext.remarks || '')}</div>
        <div>銷售額／稅</div><div>${invMoney(it.sales)} ／ ${invMoney(it.tax)}</div>
        <div>總計</div><div><input id="invTotal" class="cert-rename-input" style="width:130px;padding:4px 8px;" value="${it.total == null ? '' : it.total}"></div>
      </div>
      ${ext.notes ? `<div class="inv-src">AI 備註：${invEsc(ext.notes)}</div>` : ''}

      <div class="cert-side-label">前台填寫（點一下複製）</div>
      <div class="inv-copy-grid">
        <div>發票號碼</div><button class="inv-copy-btn" onclick="invCopy('${invEsc(it.invoice_no)}','發票號碼')">${invEsc(it.invoice_no)} 📋</button>
        <div>發票開立日期</div><div>${it.date ? `<button class="inv-copy-btn" onclick="invCopy('${invEsc(it.date)}','開立日期')">${invEsc(it.date)} 📋</button> <button class="inv-copy-btn" onclick="invCopy('${invEsc(it.date.replace(/-/g, '/'))}','開立日期')">${invEsc(it.date.replace(/-/g, '/'))} 📋</button>` : '<span class="inv-src-bad">沒讀到日期</span>'}</div>
        <div>核對</div><div class="inv-src">未稅 ${invMoney(it.sales)}｜稅額 ${invMoney(it.tax)}｜總金額 ${invMoney(it.total)}（前台系統已帶的金額，對一下有沒有一樣）</div>
      </div>

      <div class="cert-side-label">案場</div>
      <input id="invCaseNo" class="cert-rename-input" list="invCaseList" value="${invEsc(it.case_no || '')}" placeholder="輸入或選案號">
      <div class="inv-src">比對依據：${invEsc(c.case_how || '—')}</div>${cand}

      <div class="cert-side-label">請款節點</div>
      <div class="inv-node-picks">${INV_NODES.map(n => `<label><input type="checkbox" class="inv-node-cb" value="${n}" ${nodes.includes(n) ? 'checked' : ''}> ${n}</label>`).join('')}</div>
      <button class="btn btn-ghost" style="margin-top:8px;padding:6px 12px;font-size:12.5px;" onclick="recheckInvoice('${it.id}', true)">💾 套用修正並重新檢查</button>
      <button class="btn btn-ghost" style="margin-top:8px;padding:6px 12px;font-size:12.5px;" onclick="recheckInvoice('${it.id}', false)">🔄 重新檢查函文</button>

      <div class="cert-side-label">金額 ${invOkBadge(amt.ok, amt.label)}</div>
      <div class="inv-src">發票總計 ${invMoney(amt.invoice_total)}　／　合約 ${invMoney(amt.expected)}（含稅）</div>
      ${schedRows ? `<table class="mc-table inv-sched"><thead><tr><th>工程合約付款期程</th><th style="text-align:right;">比例</th><th style="text-align:right;">含稅金額</th></tr></thead><tbody>${schedRows}</tbody></table>` : ''}
      <div class="inv-src">${c.contract ? (c.contract.found ? `來源：${invEsc(c.contract.origin)} ${c.contract.file_url ? `<a href="${invEsc(c.contract.file_url)}" target="_blank">${invEsc(c.contract.filename)}</a>` : invEsc(c.contract.filename)}（${invEsc(c.contract.how)}）` : '') : ''}${c.contract && c.contract.note ? `<div class="inv-src-bad">${invEsc(c.contract.note)}</div>` : ''}</div>
      ${it.case_no && c.contract && (!c.contract.found || !Object.keys(sched).length) && !c.contract.reading ? `<button class="btn btn-ghost" style="margin-top:6px;padding:6px 12px;font-size:12.5px;" onclick="invPickContract('${it.id}')">⬆ 上傳工程合約（掃描檔）</button><div class="inv-src">剛簽約還沒掃描的：掃描後在這裡上傳（跟 EPC 簽的那份，不是「(潤特)」上包合約），系統讀出付款期程後自動重新判讀這案的發票</div>` : ''}

      <div class="cert-side-label">函文 ${invOkBadge(c.docs_ok, it.doc_check)}</div>
      ${docs || '<div class="inv-src">先選請款節點</div>'}
      <div class="inv-src">檢查時間：${invEsc(c.checked_at || '')}</div>

      <div class="cert-side-label">處理 ${invStatusPill(it.status)}</div>
      <textarea id="invNote" class="cert-rename-input" rows="2" placeholder="備註（退回原因等）">${invEsc(it.note || '')}</textarea>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
        <button class="btn" style="padding:6px 12px;font-size:12.5px;" onclick="setInvoiceStatus('${it.id}','可付款')">✓ 可付款</button>
        <button class="btn btn-ghost" style="padding:6px 12px;font-size:12.5px;" onclick="setInvoiceStatus('${it.id}','退回')">↩ 退回</button>
        <button class="btn btn-ghost" style="padding:6px 12px;font-size:12.5px;" onclick="setInvoiceStatus('${it.id}','已付款')">💰 已付款</button>
        <button class="btn btn-ghost" style="padding:6px 12px;font-size:12.5px;" onclick="setInvoiceStatus('${it.id}','待確認')">待確認</button>
        <button class="btn btn-ghost" style="padding:6px 12px;font-size:12.5px;color:#C0392B;margin-left:auto;" onclick="deleteInvoice('${it.id}')">🗑 刪除</button>
      </div>
      <div class="inv-src">上傳：${invEsc(it.uploader || '')} ${invEsc(it.uploaded_at || '')}　${invEsc(it.src_name || '')} 第 ${invEsc(it.page || '')} 頁</div>
    </div></div>`;
  document.getElementById('invModalOverlay').classList.add('show');
}
function closeInvoiceModal(){ document.getElementById('invModalOverlay').classList.remove('show'); INV_OPEN_ID = null; }

async function recheckInvoice(id, applyEdits){
  const body = {};
  if(applyEdits){
    body.case_no = document.getElementById('invCaseNo').value.trim();
    body.nodes = Array.from(document.querySelectorAll('.inv-node-cb:checked')).map(x => x.value);
    const t = document.getElementById('invTotal').value.replace(/,/g, '').trim();
    if(t) body.total = Number(t);
  }
  showToast('檢查中…');
  try{
    const res = await fetch(API_BASE + '/api/invoice/' + id + '/recheck', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || '檢查失敗');
    const i = INV_ITEMS.findIndex(x => x.id === id);
    if(i >= 0) INV_ITEMS[i] = data.item;
    renderInvoices();
    openInvoiceModal(id);
    showToast('已重新檢查');
  }catch(e){ showToast('✗ ' + e.message); }
}

// ---- 上傳工程合約（剛簽約、03 契約還沒有掃描檔的案件）----
// 沿用掛表資訊確認的上傳（POST /api/procurement/drawings/sync，類型 工程合約，存案場圖面表；頁面上傳的 G 槽同步不會蓋掉），
// 後端背景 OCR 約 30～60 秒，讀完後這案的發票自動重新檢查。mcFirstPages／mcB64 在 meter-check.js。
function invPickContract(id){
  const it = INV_ITEMS.find(x => x.id === id);
  if(!it || !it.case_no) return;
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'application/pdf,.pdf';
  inp.onchange = () => { if(inp.files[0]) invUploadContract(it.case_no, inp.files[0]); };
  inp.click();
}

async function invUploadContract(caseNo, file){
  if(!/\.pdf$/i.test(file.name)){ showToast('請選 PDF 檔'); return; }
  if(/[(（_]\s*潤特/.test(file.name) && !confirm('檔名有「(潤特)」，這是上包合約，系統不會拿來比對。確定要上傳嗎？')) return;
  showToast('上傳中…');
  try{
    let bytes = new Uint8Array(await file.arrayBuffer()), trimmed = false;
    if(bytes.length > 5 * 1024 * 1024){
      showToast('檔案比較大，先切前 6 頁（付款期程在第 3～4 頁）…');
      const cut = await mcFirstPages(bytes, 6);
      if(cut){ bytes = cut; trimmed = true; }
    }
    if(bytes.length > 10 * 1024 * 1024){ showToast('檔案太大（前 6 頁也超過 10MB），請降低掃描解析度再上傳'); return; }
    const m = /(20\d{2})(\d{2})(\d{2})/.exec(file.name);
    const docDate = m ? m[1] + '-' + m[2] + '-' + m[3] : new Date().toISOString().slice(0, 10);
    const res = await fetch(API_BASE + '/api/procurement/drawings/sync', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({case_no: caseNo, kind: '工程合約', filename: file.name, doc_date: docDate,
        src_path: '發票請款上傳（' + (invUser() || '未選我是誰') + '）', mtime: new Date().toISOString().slice(0, 19).replace('T', ' '),
        orig_size: file.size, trimmed, data: mcB64(bytes)}),
    });
    const d = await res.json().catch(() => ({}));
    if(!res.ok || d.error) throw new Error(d.error || res.status);
    showToast('已上傳 ' + caseNo + ' 工程合約，背景讀取中，約 1 分鐘後自動重新判讀');
    invRecheckCase(caseNo);
    setTimeout(() => invRecheckCase(caseNo), 60000);
    setTimeout(() => invRecheckCase(caseNo), 120000);
  }catch(e){ showToast('上傳失敗：' + e.message); }
}

async function invRecheckCase(caseNo){
  for(const it of INV_ITEMS.filter(x => x.case_no === caseNo)){
    try{
      const res = await fetch(API_BASE + '/api/invoice/' + it.id + '/recheck', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
      const data = await res.json();
      if(res.ok){ const i = INV_ITEMS.findIndex(x => x.id === it.id); if(i >= 0) INV_ITEMS[i] = data.item; }
    }catch(e){}
  }
  renderInvoices();
  if(INV_OPEN_ID && INV_ITEMS.some(x => x.id === INV_OPEN_ID && x.case_no === caseNo)) openInvoiceModal(INV_OPEN_ID);
}

async function setInvoiceStatus(id, status){
  const note = document.getElementById('invNote').value;
  if(status === '退回' && !note.trim()){ showToast('請先在備註寫退回原因'); return; }
  try{
    const res = await fetch(API_BASE + '/api/invoice/' + id + '/status', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({status, note})});
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || '儲存失敗');
    const it = INV_ITEMS.find(x => x.id === id);
    if(it){ it.status = status; it.note = note; }
    renderInvoices();
    closeInvoiceModal();
    showToast(`已設為「${status}」`);
  }catch(e){ showToast('✗ ' + e.message); }
}

async function deleteInvoice(id){
  if(!confirm('確定刪除這張發票的紀錄？')) return;
  try{
    const res = await fetch(API_BASE + '/api/invoice/' + id, {method: 'DELETE'});
    if(!res.ok) throw new Error((await res.json()).error || '刪除失敗');
    INV_ITEMS = INV_ITEMS.filter(x => x.id !== id);
    renderInvoices();
    closeInvoiceModal();
  }catch(e){ showToast('✗ ' + e.message); }
}

document.addEventListener('keydown', e => { if(e.key === 'Escape' && INV_OPEN_ID) closeInvoiceModal(); });

// 重新整理時停在這頁（restoreNavState 在這支 js 載入前就跑了，這裡補載入資料）
if(document.getElementById('view-invoice') && document.getElementById('view-invoice').classList.contains('active')){ initInvoiceDrop(); loadInvoices(); }
