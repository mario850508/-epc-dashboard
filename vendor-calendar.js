// 廠商行程日曆（2026-10-27）：「廠商時段協調」底下的「📅 廠商日曆」分頁。
// 把所有廠商已排定的預約放在月曆上，從本月一路顯示到「最後一筆已排行程」所在的月份（例如已經排到明年三月就顯示到三月），
// 可以只看某一家廠商。點行程會開啟原本的「查看填單」。資料用 slots.js 載好的 SLOT_BOOKINGS，不另外抓。
let VCAL_MONTH = '';   // 目前顯示的月份 YYYY-MM(空 = 本月)；用上/下個月按鈕切換，不再一次把所有月份排下來
let VCAL_VENDOR = '';
try{ VCAL_VENDOR = localStorage.getItem('vcalVendor') || ''; }catch(e){}

(function(){
  const css = document.createElement('style');
  css.textContent = `
  .vc-month{margin-bottom:22px;}
  .vc-month-title{font-size:15px;font-weight:800;margin:0 0 8px;display:flex;align-items:baseline;gap:8px;}
  .vc-nav{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;}
  .vc-nav .vc-month-title{justify-content:center;font-size:16px;}
  .vc-nav-btn{height:34px;width:38px;border:1.5px solid var(--border);border-radius:10px;background:#fff;font-size:18px;cursor:pointer;font-weight:700;}
  .vc-nav-btn:hover{background:#FFF7E6;border-color:var(--sun-2,#F59E0B);}
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
  .vc-item{font-size:11px;line-height:1.35;border-radius:6px;padding:2px 5px;cursor:pointer;font-weight:600;word-break:break-all;border-left:4px solid transparent;}
  .vc-legend{display:flex;gap:10px;flex-wrap:wrap;font-size:12px;margin-bottom:12px;align-items:center;}
  .vc-legend span{display:inline-flex;align-items:center;gap:5px;}
  .vc-legend i{width:12px;height:12px;border-radius:4px;display:inline-block;}
  .vc-item:hover{filter:brightness(.96);}
  .vc-sum{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;}
  .vc-sum-card{border:1.5px solid var(--border);background:#fff;border-radius:12px;padding:8px 12px;cursor:pointer;font-size:12px;line-height:1.5;min-width:140px;}
  .vc-sum-card.active{border-color:var(--sun-2,#F59E0B);background:#FFF7E6;}
  .vc-sum-card b{font-size:13px;}
  `;
  document.head.appendChild(css);
})();

// 各項目的顏色（行程依項目上色：場勘／放樣／植筋／進場／掛表）。廠商行程頁 vendor.html 用同一組顏色。
const VCAL_TYPE_COLORS = {
  '場勘': ['#DBEAFE', '#1D4ED8'], '放樣': ['#CCFBF1', '#0F766E'], '植筋': ['#EDE9FE', '#6D28D9'],
  '進場': ['#FFEDD5', '#C2410C'], '掛表': ['#DCFCE7', '#15803D'],
};
function vcalTypeColor(types){
  const t = (types || []).find(x => VCAL_TYPE_COLORS[x]);
  return VCAL_TYPE_COLORS[t] || ['#F1F5F9', '#475569'];
}

// 提供給廠商的行程日曆連結：每家廠商一條專屬連結，打開直接看到「📅 行程日曆」（自己的預約進度、確認收到）
async function openVendorCalLinks(){
  const old = document.getElementById('vcalLinksOverlay'); if(old) old.remove();
  const ov = document.createElement('div');
  ov.id = 'vcalLinksOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
  ov.onclick = e => { if(e.target === ov) ov.remove(); };
  ov.innerHTML = '<div style="background:#fff;border-radius:16px;padding:22px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;color:#1B2333;">載入中…</div>';
  document.body.appendChild(ov);
  try{
    const res = await fetch(API_BASE + '/api/vendor-portal-links', {cache: 'no-store'});
    const d = await res.json();
    if(!res.ok) throw new Error(d.error || res.status);
    window._vcalLinks = d.links.map(l => Object.assign({}, l, {cal: l.url + (l.url.includes('?') ? '&' : '?') + 'tab=booked'}));
    ov.firstElementChild.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-size:17px;font-weight:800;">🔗 廠商行程日曆連結</div>
        <button type="button" onclick="document.getElementById('vcalLinksOverlay').remove()" style="border:none;background:#F1F3F8;border-radius:50%;width:30px;height:30px;cursor:pointer;">✕</button></div>
      <div style="font-size:12.5px;color:#6B7280;margin:6px 0 10px;line-height:1.7;">每家廠商一條專屬連結，點開就是「📅 行程日曆」：只看得到自己廠商的行程，各項目用不同顏色標示，可以直接按「確認收到」或回報問題。連結等於密碼，請勿轉傳給其他廠商。</div>
      ${window._vcalLinks.map((l, i) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 0;border-top:1px solid #EEE;">
        <span class="vendor-pill ${VENDOR_CLASS[l.vendor] || 'vendor-other'}">${escHtml(l.vendor)}</span>
        <div style="display:flex;gap:6px;"><button class="btn btn-ghost" style="padding:5px 10px;font-size:12px;" onclick="copyVnText(window._vcalLinks[${i}].cal, '已複製${escHtml(l.vendor)}的行程日曆連結')">複製連結</button>
        <a class="btn btn-ghost" style="padding:5px 10px;font-size:12px;text-decoration:none;" target="_blank" rel="noopener" href="${escHtml(l.cal)}">開啟</a></div></div>`).join('')}`;
  }catch(e){
    ov.firstElementChild.innerHTML = '<div>載入失敗：' + escHtml(e.message) + '</div>';
  }
}

// 模組／變流器到貨（採購專區「出貨日曆」同一份資料）：行程日曆上一起顯示
let VCAL_SHOW_SHIP = true;
try{ VCAL_SHOW_SHIP = localStorage.getItem('vcalShowShip') !== '0'; }catch(e){}
let VCAL_SHIP = {ts: 0, events: [], loading: false};
function vcalShipColor(e){ return e.equipment === '模組' ? ['#FEF3C7', '#A16207'] : ['#FCE7F3', '#BE185D']; }
async function vcalLoadShips(){
  if(VCAL_SHIP.loading || Date.now() - VCAL_SHIP.ts < 5 * 60 * 1000) return;
  VCAL_SHIP.loading = true;
  try{
    const res = await fetch(API_BASE + '/api/procurement/order-calendar', {cache: 'no-store'});
    const d = await res.json();
    if(res.ok && !d.error){ VCAL_SHIP.events = d.events || []; VCAL_SHIP.ts = Date.now(); renderVendorCalendar(); }
  }catch(e){ console.error('到貨日曆載入失敗', e); }
  finally{ VCAL_SHIP.loading = false; }
}
function vcalToggleShip(on){
  VCAL_SHOW_SHIP = !!on;
  try{ localStorage.setItem('vcalShowShip', on ? '1' : '0'); }catch(e){}
  renderVendorCalendar();
}

function vcalGo(delta){
  const now = new Date();
  const cur = VCAL_MONTH || (now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0'));
  const d = new Date(Number(cur.slice(0, 4)), Number(cur.slice(5, 7)) - 1 + delta, 1);
  VCAL_MONTH = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  renderVendorCalendar();
}
function vcalThisMonth(){ VCAL_MONTH = ''; renderVendorCalendar(); }

function vcalPickVendor(v){
  VCAL_VENDOR = (VCAL_VENDOR === v) ? '' : v;
  try{ localStorage.setItem('vcalVendor', VCAL_VENDOR); }catch(e){}
  renderVendorCalendar();
}

function renderVendorCalendar(){
  const box = document.getElementById('vendorCalContainer');
  if(!box) return;
  if(VCAL_SHOW_SHIP) vcalLoadShips();
  const pad = n => String(n).padStart(2, '0');
  const now = new Date();
  const today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
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
  const legendHtml = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
      <div class="vc-legend" style="margin:0;">${Object.keys(VCAL_TYPE_COLORS).map(t => `<span><i style="background:${VCAL_TYPE_COLORS[t][1]};"></i>${t}</span>`).join('')}
        <label style="display:inline-flex;gap:4px;align-items:center;cursor:pointer;margin-left:6px;"><input type="checkbox" ${VCAL_SHOW_SHIP ? 'checked' : ''} onchange="vcalToggleShip(this.checked)"><i style="background:#A16207;"></i>🟧模組到貨 <i style="background:#BE185D;"></i>🔌變流器到貨</label></div>
      <button class="btn btn-primary" style="padding:8px 14px;font-size:12.5px;white-space:nowrap;" onclick="openVendorCalLinks()">🔗 提供給廠商的行程日曆連結</button></div>`;
  const sumHtml = legendHtml + (vendors.length ? `<div class="vc-sum">${vendors.map(v => `
      <div class="vc-sum-card ${VCAL_VENDOR === v ? 'active' : ''}" onclick="vcalPickVendor('${escHtml(v)}')" title="點一下只看這家廠商，再點一次看全部">
        <span class="vendor-pill ${VENDOR_CLASS[v] || 'vendor-other'}">${escHtml(v)}</span><br>
        已排 <b>${sum[v].n}</b> 筆｜最後排到 <b>${fmtLast(sum[v].last)}</b>
      </div>`).join('')}</div>` : '');

  const shown = (VCAL_VENDOR ? all.filter(b => b.vendor === VCAL_VENDOR) : all);
  // 模組／變流器到貨（出貨日曆）：EPC 對得到廠商就跟著廠商篩選；可以用勾選隱藏
  const ships = VCAL_SHOW_SHIP ? ((VCAL_SHIP.events || []).filter(e => (!VCAL_VENDOR || e.epc === VCAL_VENDOR))) : [];
  const shipByDay = {};
  ships.forEach(e => { (shipByDay[e.date] = shipByDay[e.date] || []).push(e); });
  if(!shown.length && !ships.length){
    box.innerHTML = sumHtml + '<div class="login-note">目前沒有已排定的行程。</div>';
    return;
  }
  // 一次只顯示一個月，用按鈕切換上/下個月
  const curMonth = VCAL_MONTH || today.slice(0, 7);
  let y = Number(curMonth.slice(0, 4)), m = Number(curMonth.slice(5, 7));
  const byDay = {};
  mergeCompanionBookings(shown).forEach(b => { (byDay[b.date] = byDay[b.date] || []).push(b); });
  const typeShort = t => (t || []).join('+');
  let monthHtml = '';
  {
    const first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate();
    let cells = ['日', '一', '二', '三', '四', '五', '六'].map(t => `<div class="vc-dow">${t}</div>`).join('');
    for(let i = 0; i < first.getDay(); i++) cells += '<div class="vc-day empty"></div>';
    let count = 0;
    for(let d = 1; d <= days; d++){
      const iso = `${y}-${pad(m)}-${pad(d)}`;
      const wd = new Date(y, m - 1, d).getDay();
      const list = (byDay[iso] || []).slice().sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
      const sl = shipByDay[iso] || [];
      count += list.length + sl.length;
      const shipItems = sl.map(e => {
        const [bg, fg] = vcalShipColor(e);
        const abbr = typeof ocalAbbr === 'function' ? ocalAbbr(e.case_no) : e.case_no;
        const models = e.items.map(it => (typeof ocalModelShort === 'function' ? ocalModelShort(it.model, e.equipment) : it.model) + '×' + it.qty).join('、');
        const tip = e.equipment + '到貨（' + e.status + '）｜' + e.case_no + ' ' + (e.alias || '') + '｜' + e.vendor + ' ' + e.items.map(it => it.model + '×' + it.qty).join('、') + (e.epc ? '｜EPC：' + e.epc : '') + (e.arrival ? '｜' + e.arrival : '');
        return `<div class="vc-item" style="background:${bg};color:${fg};border-left-color:${fg};cursor:default;${e.status === '已出貨' ? 'opacity:.7;' : ''}" title="${escHtml(tip)}">${e.equipment === '模組' ? '🟧' : '🔌'} ${escHtml((VCAL_VENDOR ? '' : (e.epc ? e.epc + ' ' : '')) + abbr + ' ' + models)}</div>`;
      }).join('');
      const items = shipItems + list.map(b => {
        const ack = b.vendor_can_ack ? (b.vendor_ack_at ? ' ✓' : ' ⏳') : '';
        const label = (b.start_time || '') + ' ' + (VCAL_VENDOR ? '' : b.vendor + ' ') + typeShort(b.type) + ' ' + (b.case || '');
        const [bg, fg] = vcalTypeColor(b.type);
        return `<div class="vc-item" style="background:${bg};color:${fg};border-left-color:${fg};" onclick="showSlotBookingDetail('${b.record_id}')" title="${escHtml(label + (b.alias ? '　' + b.alias : '') + (b.vendor_ack_at ? '（廠商已確認）' : b.vendor_can_ack ? '（廠商未確認）' : ''))}">${escHtml(label.trim())}${ack}</div>`;
      }).join('');
      cells += `<div class="vc-day ${iso === today ? 'today' : ''} ${iso < today ? 'past' : ''} ${wd === 0 || wd === 6 ? 'weekend' : ''}"><span class="vc-n">${d}</span>${items}</div>`;
    }
    monthHtml = `<div class="vc-month"><div class="vc-nav"><button class="vc-nav-btn" onclick="vcalGo(-1)" title="上個月">‹</button>
      <div class="vc-month-title" style="margin:0;">${y} 年 ${m} 月<small>${count ? count + ' 筆行程' : '沒有行程'}</small>${curMonth !== today.slice(0, 7) ? '<button class="vc-nav-btn" style="width:auto;padding:0 10px;font-size:12px;" onclick="vcalThisMonth()">回本月</button>' : ''}</div>
      <button class="vc-nav-btn" onclick="vcalGo(1)" title="下個月">›</button></div>
      <div class="vc-scroll"><div class="vc-grid">${cells}</div></div></div>`;
  }
  box.innerHTML = sumHtml + monthHtml;
}
