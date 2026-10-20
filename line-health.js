// LINE 推播額度警告（2026-10-20）：LINE 官方帳號每月免費訊息有上限，用完後機器人所有通知
// （業務收不到屋主回覆、提醒、明日總覽…）都會被拒，之前完全沒有提示。這裡定期問後端，額度用完就在頁面上方顯示提示卡。
// 2026-10-20 改版：跟主控台其他卡片同樣的暖色圓角卡片，不再是整條紅色橫幅；可按「我知道了」收起（當天不再顯示）。
(function(){
  const DISMISS_KEY = 'lineQuotaDismissed';
  function today(){ const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function dismissed(){ try{ return localStorage.getItem(DISMISS_KEY) === today(); }catch(e){ return false; } }
  window.dismissLineQuotaBanner = function(){
    try{ localStorage.setItem(DISMISS_KEY, today()); }catch(e){}
    const bar = document.getElementById('lineQuotaBanner'); if(bar) bar.remove();
  };
  async function checkLineQuota(){
    try{
      const res = await fetch(API_BASE + '/api/line/quota', {cache: 'no-store'});
      const d = await res.json();
      let bar = document.getElementById('lineQuotaBanner');
      if(!res.ok || !d.exhausted || dismissed()){ if(bar) bar.remove(); return; }
      if(!bar){
        bar = document.createElement('div');
        bar.id = 'lineQuotaBanner';
        bar.style.cssText = 'display:flex;align-items:flex-start;gap:12px;background:#FFF8E8;border:1px solid #F3DDA8;border-radius:14px;padding:12px 16px;margin:0 0 16px;box-shadow:0 2px 8px rgba(120,80,0,.06);';
        const main = document.querySelector('.main');
        if(main) main.insertBefore(bar, main.firstChild); else document.body.insertBefore(bar, document.body.firstChild);
      }
      const used = (d.used != null && d.limit != null) ? `${d.used} / ${d.limit} 則` : '';
      bar.innerHTML = `<div style="font-size:20px;line-height:1.3;">💬</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13.5px;font-weight:800;color:#8A4B00;">LINE 機器人本月推播額度已用完${used ? '<span style="font-weight:600;color:#B45309;">　' + used + '，每月 1 號重置</span>' : ''}</div>
          <div style="font-size:12.5px;color:#6B5B3E;line-height:1.7;margin-top:3px;">機器人的通知（業務收屋主回覆、期限提醒、明日總覽…）目前都送不出去。恢復前，請用「完成安排」的「通知業務」產生的分享連結，自己用 LINE 轉傳給業務。</div>
        </div>
        <button type="button" class="btn btn-ghost" style="padding:5px 12px;font-size:12px;flex-shrink:0;" onclick="dismissLineQuotaBanner()">我知道了</button>`;
    }catch(e){}
  }
  document.addEventListener('DOMContentLoaded', () => { setTimeout(checkLineQuota, 1500); setInterval(checkLineQuota, 300000); });
})();
