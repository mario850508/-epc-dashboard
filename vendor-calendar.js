// 廠商行程日曆（2026-10-27）：「廠商時段協調」底下的「📅 廠商日曆」分頁。
// 把所有廠商已排定的預約放在月曆上，從本月一路顯示到「最後一筆已排行程」所在的月份（例如已經排到明年三月就顯示到三月），
// 可以只看某一家廠商。點行程會開啟原本的「查看填單」。資料用 slots.js 載好的 SLOT_BOOKINGS，不另外抓。
let VCAL_VENDOR = '';
try{ VCAL_VENDOR = localStorage.getItem('vcalVendor') || ''; }catch(e){}

(function(){
  const css = document.createElement('style');
  css.textContent = `
  .vc-month{margin-bottom:22px;}
  .vc-month-title{font-size:15px;font-weight:800;margin:0 0 8px;display:flex;align-items:baseline;gap:8px;}
  .vc-month-title small{font-size:11.5px;color:var(--text-muted);font-weight:600;}
  .vc-scroll{overflow-x:auto;}
  .vc-grid{display:grid;grid-template-columns:repeat(7,minmax(104px,1fr));gap:4px;min-width:740px;}
  .vc-dow{text-align:center;font-size:12px;color:var(--text-muted);font-weight:700;padding:2px 0;}
  .vc-day{min-height:70px;border:1.5px solid var(--border);border-radius:10px;background:#fff;padding:4px;display:flex;flex-direction:column;gap:3px;}
  .vc-day.empty{background:transparent;border-color:transparent;}
  .vc-day.today{border-color:var(--sun-2,#F59E0B);box-shadow:0 0 0 2px rgba(242,121,12,.15);}
  .vc-day.past{opacity:.55;}
  .vc-day.weekend{background:#FBF8F2;}
  .vc-n{font-size:12px;font-weight:700;color:var(--text-muted);}
  .vc-day.today .vc-n{color:var(--sun-3,#C2570C);}
  .vc-item{font-size:11px;line-height:1.35;border-radius:6px;padding:2px 5px;cursor:pointer;font-weight:600;word-break:break-all;}
  .vc-item:hover{filter:brightness(.96);}
  .vc-sum{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;}
  .vc-sum-card{border:1.5px solid var(--border);background:#fff;border-radius:12px;padding:8px 12px;cursor:pointer;font-size:12px;line-height:1.5;min-width:140px;}
  .vc-sum-card.active{border-color:var(--sun-2,#F59E0B);background:#FFF7E6;}
  .vc-sum-card b{font-size:13px;}
  `;
  document.head.appendChild(css);
})();

function vcalPickVendor(v){
  VCAL_VENDOR = (VCAL_VENDOR === v) ? '' : v;
  try{ localStorage.setItem('vcalVendor', VCAL_VENDOR); }catch(e){}
  renderVendorCalendar();
}

function renderVendorCalendar(){
  const box = document.getElementById('vendorCalContainer');
  if(!box) return;
  const pad = n => String(n).padStart(2, '0');
  const now = new Date();
  const today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  const monthStart = today.slice(0, 7) + '-01';
  const all = (SLOT_BOOKINGS || []).filter(b => b.date && !b.cancelled);
  const upcoming = all.filter(b => b.date >= today);

  // 每家廠商：已排幾筆、最後排到哪天
  const sum = {};
  upcoming.forEach(b => {
    const s = sum[b.vendor] || (sum[b.vendor] = {n: 0, last: ''});
    s.n += 1;
    if(b.date > s.last) s.last = b.date;
  });
  const vendors = Object.keys(sum).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  if(VCAL_VENDOR && !sum[VCAL_VENDOR]) VCAL_VENDOR = '';
  const fmtLast = d => d.slice(0, 4) + '/' + Number(d.slice(5, 7)) + '/' + Number(d.slice(8, 10));
  const sumHtml = vendors.length ? `<div class="vc-sum">${vendors.map(v => `
      <div class="vc-sum-card ${VCAL_VENDOR === v ? 'active' : ''}" onclick="vcalPickVendor('${escHtml(v)}')" title="點一下只看這家廠商，再點一次看全部">
        <span class="vendor-pill ${VENDOR_CLASS[v] || 'vendor-other'}">${escHtml(v)}</span><br>
        已排 <b>${sum[v].n}</b> 筆｜最後排到 <b>${fmtLast(sum[v].last)}</b>
      </div>`).join('')}</div>` : '';

  const shown = (VCAL_VENDOR ? all.filter(b => b.vendor === VCAL_VENDOR) : all).filter(b => b.date >= monthStart);
  if(!shown.length){
    box.innerHTML = sumHtml + '<div class="login-note">目前沒有已排定的行程。</div>';
    return;
  }
  // 從本月顯示到最後一筆行程所在的月份
  const lastDate = shown.reduce((m, b) => b.date > m ? b.date : m, today);
  let y = now.getFullYear(), m = now.getMonth() + 1;
  const ly = Number(lastDate.slice(0, 4)), lm = Number(lastDate.slice(5, 7));
  const byDay = {};
  mergeCompanionBookings(shown).forEach(b => { (byDay[b.date] = byDay[b.date] || []).push(b); });
  const typeShort = t => (t || []).join('+');
  const months = [];
  while(y < ly || (y === ly && m <= lm)){
    const first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate();
    let cells = ['日', '一', '二', '三', '四', '五', '六'].map(t => `<div class="vc-dow">${t}</div>`).join('');
    for(let i = 0; i < first.getDay(); i++) cells += '<div class="vc-day empty"></div>';
    let count = 0;
    for(let d = 1; d <= days; d++){
      const iso = `${y}-${pad(m)}-${pad(d)}`;
      const wd = new Date(y, m - 1, d).getDay();
      const list = (byDay[iso] || []).slice().sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
      count += list.length;
      const items = list.map(b => {
        const ack = b.vendor_can_ack ? (b.vendor_ack_at ? ' ✓' : ' ⏳') : '';
        const label = (b.start_time || '') + ' ' + (VCAL_VENDOR ? '' : b.vendor + ' ') + typeShort(b.type) + ' ' + (b.case || '');
        return `<div class="vc-item ${VENDOR_CLASS[b.vendor] || 'vendor-other'}" onclick="showSlotBookingDetail('${b.record_id}')" title="${escHtml(label + (b.alias ? '　' + b.alias : '') + (b.vendor_ack_at ? '（廠商已確認）' : b.vendor_can_ack ? '（廠商未確認）' : ''))}">${escHtml(label.trim())}${ack}</div>`;
      }).join('');
      cells += `<div class="vc-day ${iso === today ? 'today' : ''} ${iso < today ? 'past' : ''} ${wd === 0 || wd === 6 ? 'weekend' : ''}"><span class="vc-n">${d}</span>${items}</div>`;
    }
    months.push(`<div class="vc-month"><div class="vc-month-title">${y} 年 ${m} 月<small>${count ? count + ' 筆行程' : '沒有行程'}</small></div>
      <div class="vc-scroll"><div class="vc-grid">${cells}</div></div></div>`);
    m += 1; if(m > 12){ m = 1; y += 1; }
  }
  box.innerHTML = sumHtml + months.join('');
}
