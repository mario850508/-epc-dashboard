// 請款確認（陽光端，2026-11-17）：發票請款頁上方的面板。
// 看廠商（尚展）哪些節點文件已齊可以請款、哪些還缺什麼；確認／退回廠商上傳的缺件文件；決定要不要開放給廠商看。
// 後端：GET /api/billing/overview、GET /api/billing/uploads、POST /api/billing/uploads/<id>/review、GET／POST /api/billing/public
let BCA = {vendor: '尚展', data: null, uploads: [], pub: null, open: false, busy: false, err: '', q: ''};

async function bcaInit(){
  const box = document.getElementById('bcAdmin');
  if(!box) return;
  if(BCA.data || BCA.busy){ renderBca(); return; }
  BCA.busy = true; renderBca();
  try{
    const [ov, up, pb] = await Promise.all([
      fetch(API_BASE + '/api/billing/overview?vendor=' + encodeURIComponent(BCA.vendor), {cache: 'no-store'}).then(r => r.json().then(d => { if(!r.ok) throw new Error(d.error || ('HTTP ' + r.status)); return d; })),
      fetch(API_BASE + '/api/billing/uploads?status=' + encodeURIComponent('待確認'), {cache: 'no-store'}).then(r => r.json()),
      fetch(API_BASE + '/api/billing/public', {cache: 'no-store'}).then(r => r.json()),
    ]);
    BCA.data = ov; BCA.uploads = up.items || []; BCA.pub = (pb.vendors || {})[BCA.vendor] || false; BCA.err = '';
  }catch(e){ BCA.err = e.message; }
  BCA.busy = false;
  renderBca();
}
async function bcaReload(fresh){
  BCA.busy = true; renderBca();
  try{
    const [ov, up] = await Promise.all([
      fetch(API_BASE + '/api/billing/overview?vendor=' + encodeURIComponent(BCA.vendor) + (fresh ? '&fresh=1' : ''), {cache: 'no-store'}).then(r => r.json().then(d => { if(!r.ok) throw new Error(d.error || ('HTTP ' + r.status)); return d; })),
      fetch(API_BASE + '/api/billing/uploads?status=' + encodeURIComponent('待確認'), {cache: 'no-store'}).then(r => r.json()),
    ]);
    BCA.data = ov; BCA.uploads = up.items || []; BCA.err = '';
  }catch(e){ BCA.err = e.message; }
  BCA.busy = false;
  renderBca();
}
async function bcaTogglePublic(){
  const on = !BCA.pub;
  if(!confirm(on ? `要把「請款確認」開放給${BCA.vendor}嗎？\n開放後，${BCA.vendor}在預約頁就會看到「💰 請款確認」分頁（可請款節點、缺件清單、上傳）。` : `要對${BCA.vendor}關閉「請款確認」嗎？分頁會從他們的預約頁消失。`)) return;
  try{
    const res = await fetch(API_BASE + '/api/billing/public', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({vendor: BCA.vendor, on})});
    const d = await res.json();
    if(!res.ok) throw new Error(d.error || ('HTTP ' + res.status));
    BCA.pub = on; renderBca(); showToast(on ? '已開放給' + BCA.vendor : '已關閉');
  }catch(e){ showToast('✗ ' + e.message); }
}
async function bcaReview(id, status){
  let note = '';
  if(status === '退回'){ note = prompt('退回原因（廠商會看到）：', '檔案不清楚／不是這一項要的文件'); if(note === null) return; }
  try{
    const res = await fetch(API_BASE + '/api/billing/uploads/' + encodeURIComponent(id) + '/review', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({status, note, by: invUser()})});
    const d = await res.json();
    if(!res.ok) throw new Error(d.error || ('HTTP ' + res.status));
    showToast(status === '已確認' ? '已確認，該項文件算齊' : '已退回');
    bcaReload(true);
  }catch(e){ showToast('✗ ' + e.message); }
}
function bcaToggleOpen(){ BCA.open = !BCA.open; renderBca(); }

function renderBca(){
  const box = document.getElementById('bcAdmin');
  if(!box) return;
  const d = BCA.data;
  const head = `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <b style="font-size:15px;">💰 請款確認（${invEsc(BCA.vendor)}）</b>
      ${BCA.pub === null ? '' : `<span class="inv-muted" style="padding:2px 9px;border-radius:10px;background:${BCA.pub ? '#DCFCE7' : '#F3F4F6'};color:${BCA.pub ? '#15803D' : '#6B7280'};font-weight:700;">${BCA.pub ? '已開放給廠商' : '尚未開放給廠商'}</span>`}
      <span style="margin-left:auto;display:flex;gap:8px;">
        ${BCA.pub === null ? '' : `<button class="btn btn-ghost" style="padding:5px 12px;font-size:12.5px;" onclick="bcaTogglePublic()">${BCA.pub ? '關閉廠商頁面' : '開放給廠商'}</button>`}
        <button class="btn btn-ghost" style="padding:5px 12px;font-size:12.5px;" onclick="bcaReload(true)" ${BCA.busy ? 'disabled' : ''}>🔄 重新計算</button>
        <button class="btn btn-ghost" style="padding:5px 12px;font-size:12.5px;" onclick="bcaToggleOpen()">${BCA.open ? '收合' : '展開明細'}</button>
      </span></div>`;
  if(BCA.busy && !d){ box.innerHTML = `<div class="panel">${head}<div class="inv-muted" style="margin-top:8px;">計算中…（約 1 分鐘）</div></div>`; return; }
  if(BCA.err && !d){ box.innerHTML = `<div class="panel">${head}<div style="color:#B42318;margin-top:8px;">載入失敗：${invEsc(BCA.err)}</div></div>`; return; }
  if(!d){ box.innerHTML = ''; return; }
  const ups = BCA.uploads.filter(u => u.vendor === BCA.vendor);
  const upHtml = ups.length ? `<div style="margin-top:10px;border:1px solid #BFD7F5;background:#F3F8FF;border-radius:10px;padding:8px 12px;"><b>📥 廠商上傳、等你確認（${ups.length}）</b>` + ups.map(u => `
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:6px 0;border-top:1px solid #DCE8FA;">
        <span style="flex:1;min-width:220px;"><b>${invEsc(u.case_no)}</b>　${invEsc(u.node)}｜${invEsc(u.label)}<div class="inv-muted">${invEsc(u.at)}${u.vendor_note ? '｜' + invEsc(u.vendor_note) : ''}</div></span>
        <span>${u.files.map(f => `<a href="${invEsc(f.url)}" target="_blank" rel="noopener">⬇ ${invEsc(f.name)}</a>`).join('<br>')}</span>
        <button class="btn" style="padding:5px 12px;font-size:12.5px;background:var(--success);border-color:var(--success);" onclick="bcaReview('${u.id}','已確認')">✓ 確認</button>
        <button class="btn btn-ghost" style="padding:5px 12px;font-size:12.5px;color:#C0392B;" onclick="bcaReview('${u.id}','退回')">退回</button>
      </div>`).join('') + '</div>' : '';
  const unm = (d.unmatched_history || []).length ? `<div style="margin-top:8px;color:#B45309;font-size:12.5px;">⚠️ 尚展發票明細裡有 ${d.unmatched_history.length} 個案場簡稱對不到案件（${d.unmatched_history.map(invEsc).join('、')}），這些案的已請款沒有被排除。</div>` : '';
  let detail = '';
  if(BCA.open){
    const q = (BCA.q || '').trim();
    const cases = (d.cases || []).filter(c => !q || (c.case + c.alias + c.county).includes(q));
    detail = `<div style="margin:10px 0 6px;"><input class="cert-rename-input" style="max-width:240px;padding:5px 10px;" placeholder="搜尋案號／別名" value="${invEsc(BCA.q)}" oninput="BCA.q=this.value;renderBca()"></div>
      <div style="max-height:420px;overflow:auto;border:1px solid var(--border);border-radius:10px;">` + cases.map(c => `<div style="padding:8px 12px;border-bottom:1px solid var(--border);">
        <b>${invEsc(c.case)}</b> <span class="inv-muted">${invEsc(c.alias)}｜${invEsc(c.county)}</span>
        ${c.nodes.map(n => `<div style="margin:4px 0 0 10px;font-size:13px;">${n.status === 'ready' ? '<span style="color:#15803D;font-weight:700;">✅ 可請款</span>' : '<span style="color:#B45309;font-weight:700;">📎 缺件</span>'}　${invEsc(n.node)}　<span class="inv-muted">${n.items.map(i => (i.ok ? '✓' : '✗') + invEsc(i.label) + (i.upload ? '(' + invEsc(i.upload) + ')' : '')).join('、')}${n.since ? '｜' + invEsc(n.since) + ' 起可請款' : ''}</span></div>`).join('')}
      </div>`).join('') + '</div>';
  }
  box.innerHTML = `<div class="panel">${head}
    <div style="margin-top:8px;">✅ 可請款 <b style="color:#15803D;">${d.ready_count}</b> 個節點　📎 還缺文件 <b style="color:#B45309;">${d.partial_count}</b> 個節點　<span class="inv-muted">（已請款的已排除：${invEsc(BCA.vendor)}發票明細表＋發票請款頁；更新 ${invEsc(d.generated_at || '')}）</span></div>
    ${unm}${upHtml}${detail}</div>`;
}
