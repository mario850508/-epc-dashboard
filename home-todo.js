// 總覽首頁「今日待辦」（2026-10-09）。把「現在要處理什麼、今天明天有什麼行程」一次列出來，
// 取代原本寫死的假數字（待處理 PDF 1 份／本週 7 件／今日待辦 2 件）。
// 資料全部沿用主控台已經載入的全域資料：SLOT_TASKS／SLOT_BOOKINGS（slots.js）、
// collectCalendarEvents()（出貨／進場／掛表／植筋）、APP_CASE_STATUS（異常案件）、BOUND_NAMES（LINE 綁定）。
// 獨立成一支檔案，避免跟其他對話改 index.html 時衝突。
(function(){
  'use strict';
  const E = s => (typeof escHtml === 'function' ? escHtml(s) : String(s == null ? '' : s));
  const pad = n => String(n).padStart(2, '0');
  const ymd = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  const md = iso => { const d = new Date(iso + 'T00:00:00'); return (d.getMonth() + 1) + '/' + d.getDate() + '（' + WD[d.getDay()] + '）'; };
  const hm = iso => { const d = new Date(iso); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const caseName = t => ((t.case || '') + (t.alias ? ' ' + t.alias : '')).trim();
  const jump = (fn) => fn;   // 只是讓下面的 onclick 字串好讀
  let PDF_COUNTS = {};
  let lastRefresh = 0;

  window.homeGoSlots = function(tab){ showView('slots'); showSlotsTab(tab); if(typeof loadVendorSlots === 'function') loadVendorSlots(); };

  // ---------- 待辦項目 ----------
  function buildTodos(){
    const items = [];
    const now = Date.now();
    const today = ymd(0);
    const tasks = (typeof SLOT_TASKS !== 'undefined' ? SLOT_TASKS : []).filter(t => t.status !== '已完成' && t.status !== '已取消');

    // 1. 等你選時間
    tasks.filter(t => t.stage === '待窗口確認').forEach(t => items.push({
      level: 'urgent', icon: '🟡',
      title: `${caseName(t)}：${t.owner_mode ? '屋主' : '業務'}回傳了其他${(t.alt_slots || []).some(s => s.start_time) ? '時間' : '日期'}，等你選`,
      detail: (t.alt_slots || []).map(s => md(s.date) + (s.start_time ? ' ' + s.start_time + '-' + s.end_time : '')).join('、'),
      actions: [{label: '去選時間', js: "homeGoSlots('pending')", primary: true}],
    }));

    // 2. 回覆期限逾期（還在等業務／屋主）
    tasks.filter(t => t.stage !== '待窗口確認' && t.deadline && new Date(t.deadline).getTime() < now).forEach(t => {
      const hrs = Math.max(1, Math.round((now - new Date(t.deadline).getTime()) / 3600000));
      items.push({
        level: 'urgent', icon: '🔴',
        title: `${caseName(t)}：${t.owner_mode ? '屋主還沒填預約表' : '業務還沒回覆'}，已逾期 ${hrs >= 24 ? Math.floor(hrs / 24) + ' 天' : hrs + ' 小時'}`,
        detail: `${t.vendor || ''}｜${(t.type || []).join('＋')}${t.assignee ? '｜業務 ' + t.assignee : ''}｜期限 ${md(t.deadline.slice(0, 10))} ${hm(t.deadline)}`,
        actions: [{label: '查看任務', js: "homeGoSlots('pending')", primary: true}, {label: '調整期限', js: `adjustSlotDeadline('${t.record_id}')`}],
      });
    });

    // 3. 今天要回覆的期限
    tasks.filter(t => t.stage !== '待窗口確認' && t.deadline && new Date(t.deadline).getTime() >= now && t.deadline.slice(0, 10) === today).forEach(t => items.push({
      level: 'warn', icon: '⏰',
      title: `${caseName(t)}：今天 ${hm(t.deadline)} 前要${t.owner_mode ? '等屋主填表' : '等業務回覆'}`,
      detail: `${t.vendor || ''}｜${(t.type || []).join('＋')}${t.assignee ? '｜業務 ' + t.assignee : ''}`,
      actions: [{label: '查看任務', js: "homeGoSlots('pending')"}],
    }));

    // 4. 已選好時間、等對方按確認
    tasks.filter(t => t.stage === '待業務確認').forEach(t => items.push({
      level: 'warn', icon: '⏳',
      title: `${caseName(t)}：已選好時間，等${t.owner_mode ? '屋主' : '業務'}按確認`,
      detail: t.chosen_slot ? md(t.chosen_slot.date) + ' ' + t.chosen_slot.start_time + '-' + t.chosen_slot.end_time : '',
      actions: [{label: '查看任務', js: "homeGoSlots('pending')"}],
    }));

    // 5. 業務沒綁 LINE（收不到提醒）
    const unbound = {};
    tasks.forEach(t => { if(t.assignee && typeof isBoundName === 'function' && !isBoundName(t.assignee)) (unbound[t.assignee] = unbound[t.assignee] || []).push(t); });
    Object.keys(unbound).forEach(name => items.push({
      level: 'warn', icon: '🔔',
      title: `業務 ${name} 還沒綁定 LINE（${unbound[name].length} 筆任務收不到提醒）`,
      detail: unbound[name].map(caseName).slice(0, 3).join('、') + (unbound[name].length > 3 ? '…' : ''),
      actions: [{label: '複製綁定連結', js: `copyRepBindLink(${JSON.stringify(name).replace(/"/g, '&quot;')})`, primary: true}],
    }));

    // 6. 近 3 天的預約還沒通知廠商
    const horizon = ymd(3);
    (typeof SLOT_BOOKINGS !== 'undefined' ? SLOT_BOOKINGS : []).filter(b => b.date >= today && b.date <= horizon && !b.vendor_notified_at && matchesGlobalVendorScope(b.vendor))
      .sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time)).forEach(b => items.push({
        level: 'warn', icon: '📤',
        title: `${caseName(b)}：${md(b.date)} 的預約還沒通知廠商`,
        detail: `${b.vendor}｜${(b.type || []).join('＋')}｜${b.start_time}-${b.end_time}`,
        actions: [{label: '通知廠商', js: `openVendorNotice('${b.record_id}')`, primary: true}],
      }));

    // 7. 異常案件
    const issues = Object.keys(typeof APP_CASE_STATUS !== 'undefined' ? APP_CASE_STATUS : {}).filter(id => APP_CASE_STATUS[id].issue_note && !APP_CASE_STATUS[id].withdrawn_note);
    if(issues.length) items.push({
      level: 'info', icon: '⚠️', title: `異常案件 ${issues.length} 筆待追蹤`, detail: '',
      actions: [{label: '前往', js: "showView('epc'); showEpcTab('epc-issue')"}],
    });

    const rank = {urgent: 0, warn: 1, info: 2};
    return items.sort((a, b) => rank[a.level] - rank[b.level]);
  }

  // ---------- 今天／明天行程（預約＋出貨／進場／掛表／植筋）----------
  function buildDay(date){
    const rows = [];
    const bookings = (typeof SLOT_BOOKINGS !== 'undefined' ? SLOT_BOOKINGS : []).filter(b => b.date === date && matchesGlobalVendorScope(b.vendor));
    const bookedKinds = new Set();
    bookings.forEach(b => {
      (b.type || []).forEach(ty => bookedKinds.add(b.case + '|' + ty));
      rows.push({time: b.start_time + '-' + b.end_time, kind: (b.type || []).join('＋'), name: caseName(b), vendor: b.vendor,
                 extra: [b.owner_name, b.owner_phone].filter(Boolean).join(' '), phone: b.owner_phone, who: b.registrant, booking: b});
    });
    const CAL_TO_BOOK = {'enter': '進場', 'meter': '掛表', 'meter-planned': '掛表', 'rebar': '植筋'};
    let events = [];
    try{ events = collectCalendarEvents().filter(e => e.date === date); }catch(e){}
    events.forEach(e => {
      if(bookedKinds.has(e.case + '|' + CAL_TO_BOOK[e.type])) return;   // 已經有時段預約了，不重複列
      rows.push({time: '', kind: CAL_TYPE_LABEL[e.type] || e.type, name: (e.case + (e.alias ? ' ' + e.alias : '')).trim(), vendor: e.vendor,
                 extra: [e.module, e.inverter].filter(Boolean).join('；'), phone: '', who: ''});
    });
    return rows.sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  }

  function dayBlock(label, date){
    const rows = buildDay(date);
    const body = rows.length ? rows.map(r => `
      <div style="display:flex;gap:8px;align-items:flex-start;padding:7px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;">
        <span style="font-weight:700;font-size:12.5px;min-width:86px;">${r.time || '全天'}</span>
        <span class="chip" style="flex-shrink:0;">${E(r.kind)}</span>
        <span style="flex:1;min-width:150px;font-size:12.5px;">${E(r.name)}<span style="color:var(--text-muted);font-size:11.5px;">　${E(r.vendor || '')}${r.who ? '｜' + E(r.who) : ''}</span>
          ${r.extra ? `<div style="font-size:11.5px;color:var(--text-muted);">${r.phone ? '👤 ' : ''}${E(r.extra)}</div>` : ''}</span>
        ${r.phone ? `<a href="tel:${E(r.phone.replace(/[^\d+]/g, ''))}" class="btn btn-ghost" style="padding:3px 8px;font-size:11px;text-decoration:none;">📞 撥號</a>` : ''}
        ${r.booking ? `<button class="btn btn-ghost" style="padding:3px 8px;font-size:11px;" onclick="showSlotBookingDetail('${r.booking.record_id}')">📄 填單</button>` : ''}
      </div>`).join('') : '<div style="font-size:12.5px;color:var(--text-muted);padding:8px 0;">沒有排程</div>';
    return {rows, html: `<div style="flex:1;min-width:280px;"><div style="font-weight:800;font-size:13.5px;margin-bottom:4px;">${label} ${md(date)}　<span style="color:var(--text-muted);font-weight:500;">${rows.length} 件</span></div>${body}</div>`};
  }

  // ---------- 畫面 ----------
  function render(){
    const stats = document.getElementById('homeStats');
    const box = document.getElementById('homeTodo');
    if(!stats || !box) return;
    const todos = buildTodos();
    const must = todos.filter(t => t.level !== 'info').length;
    const urgent = todos.filter(t => t.level === 'urgent').length;
    const d0 = dayBlock('今天', ymd(0)), d1 = dayBlock('明天', ymd(1));
    let weekCount = 0;
    for(let i = 0; i < 7; i++) weekCount += buildDay(ymd(i)).length;
    const pdfReview = PDF_COUNTS['待確認'] || 0, pdfBusy = (PDF_COUNTS['待辨識'] || 0) + (PDF_COUNTS['辨識中'] || 0), pdfFail = PDF_COUNTS['辨識失敗'] || 0;

    stats.innerHTML = `
      <div class="stat-card" style="cursor:pointer;" onclick="document.getElementById('homeTodo').scrollIntoView({behavior:'smooth'})">
        <div class="stat-icon ${urgent ? '' : 'icon-green'}">${urgent ? '🔴' : '✅'}</div>
        <div><div class="stat-label">待處理事項</div><div class="stat-value">${must} 件</div><div class="stat-sub">${urgent ? urgent + ' 件需要馬上處理' : '目前沒有緊急事項'}</div></div>
      </div>
      <div class="stat-card"><div class="stat-icon">🗓️</div>
        <div><div class="stat-label">今天行程</div><div class="stat-value">${d0.rows.length} 件</div><div class="stat-sub">明天 ${d1.rows.length} 件｜未來 7 天共 ${weekCount} 件</div></div>
      </div>
      <div class="stat-card" style="cursor:pointer;" onclick="showView('pdf')"><div class="stat-icon icon-blue">📄</div>
        <div><div class="stat-label">PDF 待確認</div><div class="stat-value">${pdfReview} 份</div><div class="stat-sub">${pdfBusy ? '辨識中 ' + pdfBusy + ' 份' : '沒有排隊中'}${pdfFail ? '｜失敗 ' + pdfFail + ' 份' : ''}</div></div>
      </div>`;

    const lvlStyle = {urgent: 'border-left:4px solid #DC2626;background:#FFF5F5;', warn: 'border-left:4px solid #F2790C;background:#FFFAF2;', info: 'border-left:4px solid #9CA3AF;background:#F9FAFB;'};
    const todoHtml = todos.length ? todos.map(t => `
      <div style="${lvlStyle[t.level]}border-radius:10px;padding:10px 12px;margin-bottom:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <span style="font-size:16px;">${t.icon}</span>
        <div style="flex:1;min-width:200px;"><div style="font-size:13px;font-weight:700;">${E(t.title)}</div>${t.detail ? `<div style="font-size:11.5px;color:var(--text-muted);margin-top:2px;">${E(t.detail)}</div>` : ''}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">${t.actions.map(a => `<button class="btn ${a.primary ? 'btn-warm-primary' : 'btn-ghost'}" style="padding:4px 12px;font-size:11.5px;" onclick="${a.js}">${a.label}</button>`).join('')}</div>
      </div>`).join('') : '<div style="padding:14px;text-align:center;color:var(--text-muted);font-size:13px;">🎉 目前沒有待處理事項</div>';

    box.innerHTML = `
      <div class="panel" style="margin-bottom:16px;">
        <div class="panel-title">🔔 今日待辦 <span class="module-tag tag-cloud" style="margin-left:6px;">${must} 件</span>
          <div class="panel-title-actions"><button class="btn btn-ghost notes-trigger-btn" onclick="refreshHomeTodo(true)">🔄 重新整理</button></div></div>
        ${todoHtml}
      </div>
      <div class="panel" style="margin-bottom:16px;">
        <div class="panel-title">📅 今天・明天的行程</div>
        <div style="display:flex;gap:24px;flex-wrap:wrap;">${d0.html}${d1.html}</div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:8px;">包含廠商時段預約，以及出貨、進場、掛表、植筋日期。右上角的廠商篩選會一起套用。</div>
      </div>`;
  }

  async function fetchPdfCounts(){
    try{
      const d = await (await fetch(API_BASE + '/api/pdf-rename/status', {cache: 'no-store'})).json();
      PDF_COUNTS = d.counts || {};
    }catch(e){ /* 取不到就維持上次的數字 */ }
  }

  window.refreshHomeTodo = async function(force){
    const home = document.getElementById('view-home');
    if(!home || !home.classList.contains('active')) return;
    if(!force && Date.now() - lastRefresh < 20000){ render(); return; }
    lastRefresh = Date.now();
    render();   // 先用手上的資料畫一次，下面載入完再更新
    const jobs = [fetchPdfCounts()];
    if(typeof loadSlotTasksQuiet === 'function') jobs.push(loadSlotTasksQuiet());
    if(typeof loadSlotBookingsQuiet === 'function') jobs.push(loadSlotBookingsQuiet());
    if(typeof loadBoundNames === 'function') jobs.push(loadBoundNames(false));
    if(typeof loadRepList === 'function' && !Object.keys(REP_MAP).length) jobs.push(loadRepList());
    if(typeof loadAppData === 'function' && force) jobs.push(loadAppData());
    await Promise.allSettled(jobs);
    render();
  };

  // 切到總覽時更新；停在總覽時每 60 秒更新一次
  const origShowView = window.showView;
  window.showView = function(name){
    const r = origShowView.apply(this, arguments);
    if(name === 'home') refreshHomeTodo();
    return r;
  };
  setInterval(() => { if(!document.hidden) refreshHomeTodo(); }, 60000);
  document.addEventListener('DOMContentLoaded', () => setTimeout(() => refreshHomeTodo(), 800));
  // 主控台背景資料（出貨／進場）載完後也補畫一次
  setTimeout(() => refreshHomeTodo(true), 4000);
})();
