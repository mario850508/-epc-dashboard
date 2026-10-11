// 案件詳細浮動視窗＋「提醒業務通知屋主」（2026-10-11）。
// 從排程日曆／當日排程／近一週安排／場勘＆放樣安排點進來。資料用案號向後端現查
// （/api/case-brief），提醒走 /api/case-reminder：業務有綁 LINE → 機器人直接推卡片；
// 沒綁（沒加好友／離職）→ 產生 LIFF 分享連結，窗口用自己的 LINE 轉傳給代辦同事。
const CAL_EVENT_KIND = {
  'ship-module': '模組出貨', 'ship-inverter': '變流器出貨', 'ship-both': '模組＆變流器出貨',
  enter: '進場', meter: '掛表', 'meter-planned': '掛表', rebar: '植筋', survey: '場勘', stake: '放樣',
};
let CASE_DETAIL = null;   // {opts, brief}

function closeCaseDetail(){ const ov = document.getElementById('caseDetailOverlay'); if(ov) ov.remove(); CASE_DETAIL = null; }

function showEventDetail(id){
  const e = (window.CAL_EVENT_MAP || {})[id];
  if(!e){ showToast('找不到這筆排程，請重新整理'); return; }
  openCaseDetail({case: e.case, alias: e.alias, vendor: e.vendor, kind: CAL_EVENT_KIND[e.type] || '', date: e.date,
                  time: e.time || '', address: e.address || '', note: e.note || ''});
}
function openSurveyCaseDetail(recordId){
  const r = SURVEY_CASES.find(c => c.record_id === recordId);
  if(!r){ showToast('找不到這個案件，請重新整理'); return; }
  openCaseDetail({case: r.case, alias: r.alias, vendor: r.vendor, kind: '場勘', date: r.planned_date || '', address: r.address || ''});
}
function openSlotBookingDetail(recordId){
  const b = SLOT_BOOKINGS.find(x => x.record_id === recordId);
  if(!b){ showToast('找不到這筆預約，請重新整理'); return; }
  openCaseDetail({case: b.case, alias: b.alias, vendor: b.vendor, kind: (b.type || []).join('＋'), date: b.date,
                  time: (b.start_time && b.end_time) ? b.start_time + '-' + b.end_time : '', note: b.note || ''});
}

async function openCaseDetail(opts){
  closeCaseDetail();
  const ov = document.createElement('div');
  ov.id = 'caseDetailOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9998;display:flex;align-items:center;justify-content:center;padding:16px;';
  ov.onclick = e => { if(e.target === ov) closeCaseDetail(); };
  ov.innerHTML = '<div style="background:#fff;border-radius:16px;padding:22px;max-width:480px;width:100%;color:#1B2333;max-height:92vh;overflow-y:auto;">載入中…</div>';
  document.body.appendChild(ov);
  CASE_DETAIL = {opts, brief: null};
  let brief = null, err = '';
  try{
    const res = await fetch(API_BASE + '/api/case-brief?case=' + encodeURIComponent(opts.case || ''), {cache: 'no-store'});
    const d = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(d.error || ('HTTP ' + res.status));
    brief = d;
  }catch(e){ err = e.message; }
  if(!document.getElementById('caseDetailOverlay')) return;   // 載入期間被關掉了
  CASE_DETAIL.brief = brief;
  renderCaseDetail(err);
}

function renderCaseDetail(err){
  const ov = document.getElementById('caseDetailOverlay');
  if(!ov || !CASE_DETAIL) return;
  const o = CASE_DETAIL.opts, b = CASE_DETAIL.brief || {};
  const today = todayStr();
  const vendor = o.vendor || b.vendor || '';
  const address = o.address || b.address || '';
  const wd = o.date ? '（' + fmtWeekday(o.date) + '）' : '';
  const row = (k, v) => v ? `<div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid #EEF0F5;font-size:13px;"><div style="width:62px;flex-shrink:0;color:#6B7280;">${k}</div><div style="flex:1;word-break:break-all;">${v}</div></div>` : '';
  const mapUrl = b.coords ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(b.coords)
    : (address ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address) : '');
  const phoneDigits = (b.owner_phone || '').replace(/[^\d+]/g, '');
  const ownerHtml = (b.owner_name || b.owner_phone)
    ? escHtml([b.owner_name, b.owner_phone].filter(Boolean).join('　')) + (phoneDigits.length >= 8 ? `　<a href="tel:${phoneDigits}" style="color:#2563EB;">📞 撥號</a>` : '')
    : '<span style="color:#B45309;">沒有屋主資料</span>';
  const repHtml = b.rep_name
    ? escHtml(b.rep_name) + (b.rep_bound ? ' <span style="color:#16A34A;font-size:12px;">✓ 已綁定 LINE</span>' : ' <span style="color:#B45309;font-size:12px;">⚠ 尚未綁定 LINE</span>')
    : '<span style="color:#B45309;">查不到負責業務</span>';
  const bookings = (b.bookings || []).map(x => {
    const cur = x.date === o.date;
    return `<div style="font-size:12.5px;padding:2px 0;${cur ? 'font-weight:700;' : ''}">📌 ${escHtml((x.type || []).join('＋'))}　${fmtDate(x.date)}（${fmtWeekday(x.date)}）${x.start_time ? escHtml(x.start_time) + '–' + escHtml(x.end_time) : ''}</div>`;
  }).join('');
  const canRemind = o.kind && o.date && o.date >= today;
  const remindBtn = canRemind ? `
    <div style="font-size:13px;font-weight:700;margin:16px 0 6px;">📨 提醒業務通知屋主</div>
    <input id="cdNote" class="quick-mark-input" placeholder="給業務的備註（選填，例如：請提醒屋主準備好門禁）">
    <button type="button" class="btn btn-primary" id="cdRemindBtn" style="width:100%;justify-content:center;padding:11px;margin-top:10px;" onclick="sendCaseReminder(false)">${
      b.rep_name && b.rep_bound ? '用機器人傳給 ' + escHtml(b.rep_name) : '產生提醒（轉傳給代辦同事）'}</button>
    ${b.rep_name && b.rep_bound ? '<button type="button" class="btn btn-ghost" style="width:100%;justify-content:center;padding:9px;margin-top:6px;font-size:12px;" onclick="sendCaseReminder(true)">改轉傳給其他人（業務離職／由別人處理）</button>' : ''}
    <div id="cdResult"></div>`
    : `<div style="font-size:12px;color:#6B7280;margin-top:14px;">${o.kind && o.date ? '這個日期已經過了，不能發提醒。' : '這個案件還沒有排定日期，所以沒有可以提醒的行程。'}</div>`;
  ov.firstElementChild.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div style="font-size:17px;font-weight:800;">📋 案件詳細</div>
      <button type="button" onclick="closeCaseDetail()" style="border:none;background:#F1F3F8;border-radius:50%;width:30px;height:30px;cursor:pointer;">✕</button>
    </div>
    <div style="margin:10px 0 4px;font-size:16px;font-weight:800;">${escHtml(o.case)} ${escHtml(o.alias || b.alias || '')}</div>
    ${o.kind ? `<div style="font-size:13.5px;margin-bottom:8px;"><b>${escHtml(o.kind)}</b>${o.date ? '　' + fmtDate(o.date) + wd : ''}${o.time ? '　' + escHtml(o.time) : ''}${o.kind.includes('進場') ? '<span style="color:#6B7280;">（預計施工 3～5 天）</span>' : ''}</div>` : ''}
    ${err ? `<div style="color:#B42318;font-size:13px;">案件資料載入失敗：${escHtml(err)}</div>` : ''}
    ${row('廠商', escHtml(vendor))}
    ${row('業務', repHtml)}
    ${row('屋主', ownerHtml)}
    ${row('地址', address ? escHtml(address) + (mapUrl ? `　<a href="${mapUrl}" target="_blank" rel="noopener" style="color:#2563EB;">📍 地圖</a>` : '') : '')}
    ${row('座標', escHtml(b.coords || ''))}
    ${row('備註', escHtml(o.note || ''))}
    ${bookings ? row('預約', bookings) : ''}
    ${remindBtn}`;
}

async function sendCaseReminder(share){
  if(!CASE_DETAIL) return;
  const o = CASE_DETAIL.opts;
  const btn = document.getElementById('cdRemindBtn');
  const result = document.getElementById('cdResult');
  if(btn){ btn.disabled = true; btn.textContent = '處理中…'; }
  try{
    const res = await fetch(API_BASE + '/api/case-reminder', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({case: o.case, kind: o.kind, date: o.date, time: o.time || '', share: !!share,
                            note: (document.getElementById('cdNote') || {}).value || ''}),
    });
    const d = await res.json().catch(() => ({}));
    if(!res.ok) throw new Error(d.error || ('HTTP ' + res.status));
    if(d.sent){
      showToast('✅ 已用機器人提醒 ' + d.rep_name);
      if(result) result.innerHTML = `<div style="margin-top:12px;padding:10px 12px;background:#ECFDF3;border:1px solid #BFE6CF;border-radius:12px;font-size:13px;">✅ 已用機器人把提醒卡片傳給 ${escHtml(d.rep_name)}。</div>`;
      if(btn){ btn.disabled = false; btn.textContent = '再傳一次'; }
      return;
    }
    window._vnPlain = d.plain_text || '';
    window._vnLink = d.liff_url || '';
    const why = share ? '你選擇了轉傳給其他人'
      : (d.rep_name ? (d.bound ? escHtml(d.rep_name) + ' 的 LINE 推播沒成功' : escHtml(d.rep_name) + ' 還沒綁定 LINE（或已離職）') : '查不到這案的負責業務');
    if(result) result.innerHTML = `
      <div style="margin-top:12px;padding:12px 14px;background:#FFF7E6;border:1px solid #FDE0A8;border-radius:12px;font-size:13px;line-height:1.7;">
        ${why}。<b>請用手機 LINE 開啟下面的連結</b>，按「選擇要傳送的人／群組」，傳給代為處理的同事。
      </div>
      ${d.liff_url ? `<a href="${d.liff_url}" target="_blank" rel="noopener" class="btn btn-primary" style="width:100%;justify-content:center;padding:11px;margin-top:10px;text-decoration:none;">📱 在 LINE 開啟並選擇要傳給誰</a>
      <button type="button" class="btn btn-ghost" style="width:100%;justify-content:center;padding:10px;margin-top:8px;" onclick="copyVnText(window._vnLink, '已複製連結，可以貼到 LINE 給自己再點開')">複製連結（在電腦上時，傳到自己的 LINE 再點）</button>` : ''}
      <button type="button" class="btn btn-ghost" style="width:100%;justify-content:center;padding:10px;margin-top:8px;" onclick="copyVnText(window._vnPlain, '已複製文字版提醒')">複製文字版（備用）</button>`;
    if(btn){ btn.disabled = false; btn.textContent = '重新產生'; }
  }catch(err){
    showToast('提醒失敗：' + err.message);
    if(btn){ btn.disabled = false; btn.textContent = '再試一次'; }
  }
}
