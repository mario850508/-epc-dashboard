// 業務填單頁（book.html）圖文教學。第一次打開會自動跳出，之後可以按右上角「❓ 使用教學」重看。
// 每一頁是一張簡化的畫面示意圖（內嵌 SVG，不用另外載入圖片）＋一兩句說明。
(function(){
  const F = 'font-family="PingFang TC,Microsoft JhengHei,Noto Sans TC,sans-serif"';
  const CARD = '<rect x="10" y="8" width="300" height="174" rx="14" fill="#FFFCF5" stroke="#F0E4CC"/>';
  const pill = (x, y, w, t, active) =>
    `<rect x="${x}" y="${y}" width="${w}" height="26" rx="13" fill="${active ? '#F7931E' : '#fff'}" stroke="${active ? '#F7931E' : '#E4E8F1'}"/>` +
    `<text x="${x + w / 2}" y="${y + 17}" text-anchor="middle" font-size="11.5" font-weight="700" fill="${active ? '#fff' : '#1B2333'}" ${F}>${t}</text>`;
  const field = (x, y, w, t, muted) =>
    `<rect x="${x}" y="${y}" width="${w}" height="28" rx="8" fill="#fff" stroke="#E4E8F1"/>` +
    `<text x="${x + 10}" y="${y + 18}" font-size="12" fill="${muted ? '#9AA0AA' : '#1B2333'}" ${F}>${t}</text>`;
  const badge = (cx, cy, n) =>
    `<circle cx="${cx}" cy="${cy}" r="10" fill="#E5484D"/><text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="11" font-weight="800" fill="#fff" ${F}>${n}</text>`;

  const SLIDES = [
    {
      title: '必做：先綁定 LINE 提醒',
      svg: `${CARD}
        <rect x="22" y="20" width="276" height="46" rx="12" fill="#fff" stroke="#E4E8F1"/>
        <text x="34" y="38" font-size="11.5" fill="#1B2333" ${F}>🔔 要在回覆期限前收到 LINE 提醒嗎？</text>
        <rect x="34" y="44" width="108" height="16" rx="8" fill="#F7931E"/><text x="88" y="56" text-anchor="middle" font-size="10.5" font-weight="800" fill="#fff" ${F}>綁定 LINE 提醒</text>
        <rect x="22" y="78" width="276" height="86" rx="12" fill="#E8F5E9"/>
        <circle cx="42" cy="96" r="9" fill="#06C755"/><text x="42" y="100" text-anchor="middle" font-size="9" font-weight="800" fill="#fff" ${F}>LINE</text>
        <text x="58" y="100" font-size="10.5" font-weight="700" fill="#166534" ${F}>陽光機器人</text>
        <rect x="34" y="106" width="250" height="48" rx="10" fill="#fff"/>
        <text x="44" y="123" font-size="11" fill="#1B2333" ${F}>⏰ 小夫 您好，工程宜蘭20號</text>
        <text x="44" y="139" font-size="11" fill="#1B2333" ${F}>場勘時段還沒確認，回覆期限 18:00，</text>
        <text x="44" y="151" font-size="11" fill="#1B2333" ${F}>剩約 60 分鐘。</text>
        ${badge(300, 22, '必')}`,
      text: '送出預約前，要先完成這一步：① 加「陽光機器人」LINE 好友 ② 按頁面上方的「綁定 LINE 提醒」。只要綁一次，之後期限前 1 小時還沒安排，機器人會直接傳訊息提醒你。沒綁定就不能送出預約。',
    },
    {
      title: '這個頁面是做什麼的？',
      svg: `${CARD}
        <text x="24" y="34" font-size="15" font-weight="800" fill="#1B2333" ${F}>三創　場勘</text>
        <rect x="22" y="44" width="276" height="42" rx="10" fill="#FDECEC" stroke="#F5C2C2"/>
        <text x="34" y="62" font-size="12.5" font-weight="800" fill="#B42318" ${F}>⏰ 請在 10/06（二）18:00 前回覆窗口</text>
        <text x="34" y="78" font-size="10.5" fill="#B42318" ${F}>還剩 23 小時 15 分</text>
        <text x="24" y="112" font-size="11.5" fill="#6B7280" ${F}>案號</text><text x="74" y="112" font-size="12" fill="#1B2333" ${F}>工程宜蘭20號　羅東中山林○○</text>
        <text x="24" y="136" font-size="11.5" fill="#6B7280" ${F}>項目</text>
        <rect x="72" y="124" width="46" height="18" rx="9" fill="#E8EEFF"/><text x="95" y="137" text-anchor="middle" font-size="11" font-weight="700" fill="#1E46C4" ${F}>場勘</text>
        <text x="24" y="164" font-size="11" fill="#6B7280" ${F}>窗口請你跟屋主約現場時間，直接在這頁選好送出</text>
        ${badge(292, 52, 1)}`,
      text: '窗口把「要去現場的案子」交給你安排。你只要跟屋主約好時間，在這頁選好送出，這個時段就會直接鎖定，不用再來回傳訊息。紅框是「請在幾點前回覆」，要在那之前完成。',
    },
    {
      title: '第 1 步：選日期、選開始時間',
      svg: `${CARD}
        <text x="24" y="32" font-size="11.5" font-weight="700" fill="#1B2333" ${F}>選擇日期（廠商提供的候選日期）</text>
        ${pill(22, 42, 86, '10/08（四）', true)}${pill(116, 42, 86, '10/09（五）', false)}${pill(210, 42, 86, '10/12（一）', false)}
        <text x="24" y="92" font-size="11.5" font-weight="700" fill="#1B2333" ${F}>開始時間</text>
        <text x="170" y="92" font-size="11.5" font-weight="700" fill="#1B2333" ${F}>結束時間</text>
        ${field(22, 98, 128, '10:00　▾')}${field(168, 98, 128, '11:00　▾')}
        <path d="M153 112 h6" stroke="#F2790C" stroke-width="2"/>
        <polygon points="158,107 166,112 158,117" fill="#F2790C"/>
        <text x="24" y="150" font-size="10.5" fill="#6B7280" ${F}>⏱ 選好開始時間，結束時間會自動帶出（也可以自己改）</text>
        <rect x="22" y="156" width="130" height="18" rx="6" fill="#E9E9EC"/><text x="30" y="169" font-size="10.5" fill="#9AA0AA" ${F}>09:00　已被預約</text>
        <text x="160" y="169" font-size="10.5" fill="#6B7280" ${F}>← 灰色＝已被別案預約</text>
        ${badge(300, 22, 2)}`,
      text: '點一個候選日期（橘色＝已選）。選開始時間後，結束時間會依預估時間自動算好，不合適可以自己改。灰色、不能選的時間，是廠商那個時段已經被別的案子預約了。',
    },
    {
      title: '第 2 步：填屋主聯絡資訊',
      svg: `${CARD}
        <text x="24" y="32" font-size="12" font-weight="800" fill="#1B2333" ${F}>屋主聯絡資訊</text>
        <rect x="22" y="42" width="276" height="30" rx="10" fill="#E7F7EE" stroke="#BFE6CF"/>
        <rect x="32" y="50" width="14" height="14" rx="3" fill="#16A34A"/><path d="M35 57 l3 3 l6 -7" stroke="#fff" stroke-width="2" fill="none"/>
        <text x="54" y="61" font-size="12" font-weight="700" fill="#166534" ${F}>同公證書資訊（自動帶入）</text>
        <text x="24" y="92" font-size="11" fill="#6B7280" ${F}>姓名</text>${field(22, 96, 276, '王小明')}
        <text x="24" y="138" font-size="11" fill="#6B7280" ${F}>電話</text>${field(22, 142, 276, '0912-345-678')}
        ${badge(300, 22, 3)}`,
      text: '屋主的姓名和電話。如果跟公證書上一樣，直接勾「同公證書資訊」就會自動帶入；不一樣就取消勾選、自己填。',
    },
    {
      title: '屋主那天不行？改提供其他時間',
      svg: `${CARD}
        <rect x="22" y="20" width="276" height="44" rx="12" fill="#FFF4DC" stroke="#F3DDA8"/>
        <rect x="32" y="34" width="14" height="14" rx="3" fill="#F2790C"/><path d="M35 41 l3 3 l6 -7" stroke="#fff" stroke-width="2" fill="none"/>
        <text x="54" y="38" font-size="11.5" font-weight="700" fill="#1B2333" ${F}>原預約時間屋主無法配合，</text>
        <text x="54" y="53" font-size="11.5" font-weight="700" fill="#1B2333" ${F}>已和屋主確認其他時間</text>
        ${field(22, 74, 96, '10/12')}${field(124, 74, 82, '14:00')}${field(212, 74, 86, '15:30')}
        ${field(22, 106, 96, '10/13')}${field(124, 106, 82, '09:00')}${field(212, 106, 86, '10:30')}
        <rect x="22" y="142" width="276" height="30" rx="10" fill="#F7931E"/>
        <text x="160" y="162" text-anchor="middle" font-size="12.5" font-weight="800" fill="#fff" ${F}>回傳其他時間給窗口</text>
        ${badge(300, 22, 4)}`,
      text: '如果約好的那天屋主不行，勾選上面那一格，填屋主可以的其他日期和時間（可填好幾組），按「回傳其他時間給窗口」。窗口跟廠商確認後會選一個，你再打開同一個連結按「確認」就完成。',
    },
    {
      title: '最後一步：按「完成預約」',
      svg: `${CARD}
        <rect x="22" y="24" width="276" height="40" rx="12" fill="#F7931E"/>
        <text x="160" y="49" text-anchor="middle" font-size="14" font-weight="800" fill="#fff" ${F}>完成預約</text>
        <path d="M160 68 v14" stroke="#F2790C" stroke-width="2.5"/>
        <polygon points="152,80 168,80 160,94" fill="#F2790C"/>
        <rect x="22" y="96" width="276" height="68" rx="14" fill="#E7F7EE" stroke="#BFE6CF"/>
        <text x="160" y="124" text-anchor="middle" font-size="22" ${F}>✅</text>
        <text x="160" y="146" text-anchor="middle" font-size="13" font-weight="800" fill="#166534" ${F}>預約完成，時段已鎖定</text>
        <text x="160" y="159" text-anchor="middle" font-size="10" fill="#4B7A5C" ${F}>窗口會收到通知，不用再另外回報</text>
        ${badge(300, 22, 5)}`,
      text: '確認日期、時間、屋主資料都對了，按「完成預約」。時段就會鎖定，其他案子不能再卡進來，窗口也會收到通知。這個連結只能用一次，完成後就失效。',
    },
  ];

  let cur = 0;
  function render(){
    const ov = document.getElementById('tutorialOverlay');
    if(!ov) return;
    const s = SLIDES[cur];
    const last = cur === SLIDES.length - 1;
    ov.querySelector('.tut-card').innerHTML = `
      <button type="button" class="tut-x" onclick="closeTutorial()" aria-label="關閉">✕</button>
      <div class="tut-step">${cur + 1} / ${SLIDES.length}</div>
      <div class="tut-title">${s.title}</div>
      <svg viewBox="0 0 320 190" class="tut-svg" xmlns="http://www.w3.org/2000/svg">${s.svg}</svg>
      <div class="tut-text">${s.text}</div>
      <div class="tut-dots">${SLIDES.map((_, i) => `<span class="${i === cur ? 'on' : ''}"></span>`).join('')}</div>
      <div class="tut-btns">
        <button type="button" class="tut-b ghost" onclick="tutorialGo(-1)" ${cur === 0 ? 'disabled' : ''}>上一步</button>
        <button type="button" class="tut-b main" onclick="${last ? 'closeTutorial()' : 'tutorialGo(1)'}">${last ? '我知道了' : '下一步'}</button>
      </div>`;
  }
  window.tutorialGo = function(d){
    cur = Math.max(0, Math.min(SLIDES.length - 1, cur + d));
    render();
  };
  window.showTutorial = function(){
    closeTutorial(true);
    cur = 0;
    const ov = document.createElement('div');
    ov.id = 'tutorialOverlay';
    ov.innerHTML = '<div class="tut-card"></div>';
    document.body.appendChild(ov);
    render();
  };
  window.closeTutorial = function(silent){
    const ov = document.getElementById('tutorialOverlay');
    if(ov) ov.remove();
    if(silent === true) return;
    try{ localStorage.setItem('bookTutorialSeen', '1'); }catch(e){}
    // 教學開著的時候被擋下來的 LINE 綁定視窗，關掉教學後再補跳出來
    if(window._pendingLineModal && typeof showLineModal === 'function'){
      const m = window._pendingLineModal;
      window._pendingLineModal = null;
      showLineModal(m);
    }
  };
  // 第一次打開才自動跳出；沒辦法讀 localStorage（無痕模式等）就每次都跳，不影響使用
  window.maybeShowTutorial = function(){
    let seen = false;
    try{ seen = localStorage.getItem('bookTutorialSeen') === '1'; }catch(e){}
    if(!seen) showTutorial();
  };
})();
