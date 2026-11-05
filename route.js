// 路線排程（測試版，2026-11-05）：勾選指派任務的案件 → 依縣市優先順序排最佳拜訪順序＋時程＋路線圖。
// 只計算、不寫入任何預約。後端：POST /api/route-plan（app.py「路線排程」區塊）。
let RP = {sel: {}, extras: [], order: [], free: false, start: '09:00', buf: 10, lunch: false, vendor: '', result: null, busy: false, err: ''};
let RP_MAP = null, RP_LAYER = null;

const RP_COUNTY_RE = /(臺北|台北|新北|基隆|桃園|新竹|苗栗|臺中|台中|彰化|南投|雲林|嘉義|臺南|台南|高雄|屏東|宜蘭|花蓮|臺東|台東|澎湖|金門|連江)/;
function rpCounty(){ for(const t of arguments){ const m = RP_COUNTY_RE.exec(t || ''); if(m) return m[1].replace('台', '臺'); } return ''; }
function rpTasks(){
  return (typeof SLOT_TASKS !== 'undefined' ? SLOT_TASKS : []).filter(t => t.status !== '已完成' && t.status !== '已取消' && !t.group_id);
}
function rpStops(){
  const out = [];
  rpTasks().forEach(t => {
    const s = RP.sel[t.record_id];
    if(!s || !s.on) return;
    out.push({key: t.record_id, case: t.case, alias: t.alias, label: t.alias || t.case, address: (s.addr || '').trim(), duration_min: Number(s.dur) || t.duration_min || 60,
              county: rpCounty(t.case, t.alias, s.addr)});
  });
  RP.extras.forEach((x, i) => {
    if(!x.on) return;
    out.push({key: 'x' + i, case: '', alias: x.name, label: x.name || x.addr, address: (x.addr || '').trim(), duration_min: Number(x.dur) || 60, county: rpCounty(x.name, x.addr)});
  });
  return out;
}
function rpSyncOrder(stops){
  const cnt = {};
  stops.forEach(s => { const c = s.county || '其他'; cnt[c] = (cnt[c] || 0) + 1; });
  const keep = RP.order.filter(c => cnt[c]);
  const add = Object.keys(cnt).filter(c => !keep.includes(c)).sort((a, b) => cnt[b] - cnt[a]);
  RP.order = keep.concat(add);
  return cnt;
}

function loadRouteTab(){
  rpLoadLeaflet();
  renderRouteTab();
}
function rpLoadLeaflet(){
  if(window.L || document.getElementById('leafletJs')) return;
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css';
  document.head.appendChild(css);
  const js = document.createElement('script');
  js.id = 'leafletJs'; js.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js';
  js.onload = () => { if(RP.result) rpDrawMap(); };
  document.head.appendChild(js);
}

function renderRouteTab(){
  const c = document.getElementById('routeContainer');
  if(!c) return;
  const tasks = rpTasks();
  const vendors = [...new Set(tasks.map(t => t.vendor).filter(Boolean))];
  const shown = tasks.filter(t => !RP.vendor || t.vendor === RP.vendor);
  const stops = rpStops();
  const cnt = rpSyncOrder(stops);
  const taskRows = shown.map(t => {
    const s = RP.sel[t.record_id] || {};
    const cty = rpCounty(t.case, t.alias);
    return `<div style="display:flex;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;">
      <input type="checkbox" ${s.on ? 'checked' : ''} onchange="rpToggle('${t.record_id}',this.checked)" style="width:17px;height:17px;">
      <div style="flex:1;min-width:190px;">
        <div style="font-weight:700;font-size:13px;">${escHtml(t.alias || t.case)} <span style="font-weight:500;color:var(--text-muted);font-size:11.5px;">${escHtml(t.case)}${cty ? '｜' + cty : ''}</span></div>
        <div style="font-size:11.5px;color:var(--text-muted);">${escHtml((t.vendor || '') + '｜' + (t.type || []).join('、'))}</div>
      </div>
      <input type="number" min="10" step="10" value="${s.dur || t.duration_min || 60}" onchange="rpSetField('${t.record_id}','dur',this.value)" style="width:64px;padding:5px;border:1px solid var(--border);border-radius:6px;" title="作業分鐘"><span style="font-size:11.5px;color:var(--text-muted);">分</span>
      <input type="text" value="${escHtml(s.addr || '')}" placeholder="地址（空白＝自動帶入案件地址）" onchange="rpSetField('${t.record_id}','addr',this.value)" style="flex:1;min-width:190px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;">
    </div>`;
  }).join('') || '<div class="login-note">目前沒有指派中的任務</div>';
  const extraRows = RP.extras.map((x, i) => `<div style="display:flex;gap:8px;align-items:center;padding:6px 0;flex-wrap:wrap;">
      <input type="checkbox" ${x.on ? 'checked' : ''} onchange="rpExtraSet(${i},'on',this.checked)" style="width:17px;height:17px;">
      <input type="text" value="${escHtml(x.name)}" placeholder="名稱" onchange="rpExtraSet(${i},'name',this.value)" style="width:130px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;">
      <input type="number" min="10" step="10" value="${x.dur}" onchange="rpExtraSet(${i},'dur',this.value)" style="width:64px;padding:5px;border:1px solid var(--border);border-radius:6px;"><span style="font-size:11.5px;color:var(--text-muted);">分</span>
      <input type="text" value="${escHtml(x.addr)}" placeholder="完整地址" onchange="rpExtraSet(${i},'addr',this.value)" style="flex:1;min-width:190px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;">
      <button class="btn btn-ghost" style="padding:4px 10px;font-size:12px;" onclick="rpExtraDel(${i})">✕</button></div>`).join('');
  const orderChips = RP.order.map((k, i) => `<span style="display:inline-flex;align-items:center;gap:4px;background:#FFF1DE;border-radius:14px;padding:4px 6px 4px 11px;font-size:12.5px;font-weight:700;margin:3px 6px 3px 0;">
      第${i + 1}順位：${escHtml(k)}（${cnt[k]}）
      <button class="btn btn-ghost" style="padding:1px 7px;font-size:12px;" onclick="rpMove(${i},-1)" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button class="btn btn-ghost" style="padding:1px 7px;font-size:12px;" onclick="rpMove(${i},1)" ${i === RP.order.length - 1 ? 'disabled' : ''}>↓</button></span>`).join('');
  c.innerHTML = `
    <div class="login-note" style="margin-bottom:10px;">🧪 測試版：只計算、不會建立任何預約。勾選案件 → 設縣市順位 → 算出最佳拜訪順序、時程和路線圖。座標優先用業務自治區的案場座標，沒有才用地址轉換（只到路名附近時會標示）。</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:8px;">
      <b style="font-size:13px;">廠商</b>
      <select onchange="RP.vendor=this.value;renderRouteTab()" style="padding:6px 10px;border:1px solid var(--border);border-radius:8px;">
        <option value="">全部</option>${vendors.map(v => `<option value="${escHtml(v)}" ${RP.vendor === v ? 'selected' : ''}>${escHtml(v)}</option>`).join('')}
      </select>
      <button class="btn btn-ghost" style="padding:5px 12px;font-size:12px;" onclick="rpSelectAll(true)">全選</button>
      <button class="btn btn-ghost" style="padding:5px 12px;font-size:12px;" onclick="rpSelectAll(false)">全不選</button>
      <span style="font-size:12px;color:var(--text-muted);">已勾選 ${stops.length} 個地點（最多 15 個）</span>
    </div>
    <div style="max-height:340px;overflow:auto;border:1px solid var(--border);border-radius:10px;padding:4px 12px;">${taskRows}</div>
    <div style="margin-top:12px;"><b style="font-size:13px;">另外加地點（測試用，不在指派任務裡也可以）</b>${extraRows}
      <button class="btn btn-ghost" style="padding:5px 12px;font-size:12px;margin-top:4px;" onclick="rpExtraAdd()">＋ 新增地點</button></div>
    <div style="margin-top:14px;"><b style="font-size:13px;">縣市順位</b>（一天先跑第 1 順位的縣市，跑完才換下一個縣市；縣市內自動排最順的路線）
      <div style="margin-top:6px;">${RP.free ? '<span class="muted">已選「不分縣市」</span>' : (orderChips || '<span class="muted">先勾選案件</span>')}</div>
      <label style="font-size:12.5px;"><input type="checkbox" ${RP.free ? 'checked' : ''} onchange="RP.free=this.checked;renderRouteTab()"> 不分縣市，整體路線最短就好</label></div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-top:14px;font-size:12.5px;">
      <label>第一站開始 <input type="time" value="${RP.start}" onchange="RP.start=this.value" style="padding:5px;border:1px solid var(--border);border-radius:6px;"></label>
      <label>每段車程外加緩衝 <input type="number" min="0" max="120" step="5" value="${RP.buf}" onchange="RP.buf=Number(this.value)||0" style="width:60px;padding:5px;border:1px solid var(--border);border-radius:6px;"> 分</label>
      <label><input type="checkbox" ${RP.lunch ? 'checked' : ''} onchange="RP.lunch=this.checked"> 12:00–13:00 午休（這時段要出發的順延到 13:00）</label>
      <button class="btn btn-warm-primary" style="padding:8px 18px;font-size:13px;" onclick="rpRun()" ${RP.busy ? 'disabled' : ''}>${RP.busy ? '計算中…（第一次查地址較慢）' : '🧭 算最佳路徑'}</button>
    </div>
    ${RP.err ? `<div style="margin-top:10px;color:#B42318;font-size:13px;">⚠️ ${escHtml(RP.err)}</div>` : ''}
    <div id="rpResult" style="margin-top:16px;">${rpResultHtml()}</div>`;
  if(RP.result) setTimeout(rpDrawMap, 0);
}

function rpResultHtml(){
  const r = RP.result;
  if(!r) return '';
  const rows = r.schedule.map(s => `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:7px 6px;font-weight:800;">${s.seq}</td>
      <td style="padding:7px 6px;white-space:nowrap;font-weight:700;">${s.start}–${s.end}</td>
      <td style="padding:7px 6px;"><b>${escHtml(s.label)}</b><div style="font-size:11.5px;color:var(--text-muted);">${escHtml(s.case || '')}${s.county ? '｜' + escHtml(s.county) : ''}｜${escHtml(s.address)}</div></td>
      <td style="padding:7px 6px;white-space:nowrap;">${s.seq === 1 ? '—' : '車程 ' + s.drive_min + ' 分'}</td>
      <td style="padding:7px 6px;font-size:11.5px;color:var(--text-muted);">${escHtml(s.precision)}</td></tr>`).join('');
  return `<div style="font-weight:800;font-size:14px;margin-bottom:6px;">最佳時程　<span style="font-weight:600;font-size:12.5px;color:var(--text-muted);">全部結束約 ${r.end_time}｜總車程 ${r.total_drive_min} 分鐘${r.regions && r.regions.length ? '｜縣市順序：' + r.regions.map(escHtml).join(' → ') : ''}</span></div>
    ${(r.warnings || []).map(w => `<div style="font-size:12.5px;color:#B45309;margin-bottom:4px;">⚠️ ${escHtml(w)}</div>`).join('')}
    <div style="overflow:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="font-size:11.5px;color:var(--text-muted);text-align:left;"><th>序</th><th>時間</th><th>案件／地址</th><th>從上一站</th><th>定位</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div style="font-weight:800;font-size:14px;margin:14px 0 6px;">路線圖</div>
    <div id="rpMap" style="height:420px;border:1px solid var(--border);border-radius:12px;"></div>`;
}

function rpDrawMap(){
  const r = RP.result, el = document.getElementById('rpMap');
  if(!r || !el || !window.L) return;
  if(RP_MAP){ try{ RP_MAP.remove(); }catch(e){} RP_MAP = null; }
  RP_MAP = L.map(el);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, attribution: '© OpenStreetMap'}).addTo(RP_MAP);
  const line = L.polyline(r.geometry, {color: '#E8730C', weight: 5, opacity: 0.85}).addTo(RP_MAP);
  r.schedule.forEach(s => {
    L.marker([s.lat, s.lon], {icon: L.divIcon({className: '', html: `<div style="background:#1F2937;color:#fff;border-radius:50%;width:26px;height:26px;line-height:26px;text-align:center;font-weight:800;font-size:13px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);">${s.seq}</div>`, iconSize: [26, 26], iconAnchor: [13, 13]})})
      .bindPopup(`<b>${s.seq}. ${escHtml(s.label)}</b><br>${s.start}–${s.end}<br>${escHtml(s.address)}`).addTo(RP_MAP);
  });
  RP_MAP.fitBounds(line.getBounds().pad(0.15));
}

function rpToggle(id, on){ RP.sel[id] = Object.assign(RP.sel[id] || {}, {on}); renderRouteTab(); }
function rpSetField(id, k, v){ RP.sel[id] = Object.assign(RP.sel[id] || {}, {[k]: v}); }
function rpSelectAll(on){
  rpTasks().filter(t => !RP.vendor || t.vendor === RP.vendor).forEach(t => { RP.sel[t.record_id] = Object.assign(RP.sel[t.record_id] || {}, {on}); });
  renderRouteTab();
}
function rpExtraAdd(){ RP.extras.push({on: true, name: '', addr: '', dur: 60}); renderRouteTab(); }
function rpExtraSet(i, k, v){ RP.extras[i][k] = v; if(k === 'on') renderRouteTab(); }
function rpExtraDel(i){ RP.extras.splice(i, 1); renderRouteTab(); }
function rpMove(i, d){
  const j = i + d;
  if(j < 0 || j >= RP.order.length) return;
  [RP.order[i], RP.order[j]] = [RP.order[j], RP.order[i]];
  renderRouteTab();
}

async function rpRun(){
  const stops = rpStops();
  if(!stops.length){ RP.err = '請先勾選至少一個案件'; renderRouteTab(); return; }
  RP.busy = true; RP.err = ''; renderRouteTab();
  try{
    const res = await fetch(API_BASE + '/api/route-plan', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({stops, region_order: RP.order, free_order: RP.free, start: RP.start, extra_buffer_min: RP.buf, lunch: RP.lunch}),
    });
    const d = await res.json().catch(() => ({}));
    if(d.stops){   // 把查到的地址回填到輸入框，方便修正
      d.stops.forEach(s => { if(RP.sel[s.key] && !RP.sel[s.key].addr) RP.sel[s.key].addr = s.address || ''; });
    }
    if(!res.ok){
      const bad = (d.stops || []).filter(s => s.error).map(s => (s.label || s.case) + '：' + s.error).join('；');
      RP.err = (d.error || ('HTTP ' + res.status)) + (bad ? '（' + bad + '）' : '');
      RP.result = null;
    }else{
      RP.result = d;
      d.schedule.forEach(s => { if(RP.sel[s.key] && !RP.sel[s.key].addr) RP.sel[s.key].addr = s.address || ''; });
    }
  }catch(err){
    RP.err = '計算失敗：' + err.message; RP.result = null;
  }
  RP.busy = false;
  renderRouteTab();
}
