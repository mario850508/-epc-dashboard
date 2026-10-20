// LINE 推播額度警告（2026-10-20）：LINE 官方帳號每月免費訊息有上限，用完後機器人所有通知
// （業務收不到�屋主回覆、提醒、明日總覽…）都會被拒，之前完全沒有提示。這裡定期問後端，額度用完就在頁面最上方顯示紅色橫幅。
(function(){
  async function checkLineQuota(){
    try{
      const res = await fetch(API_BASE + '/api/line/quota', {cache: 'no-store'});
      const d = await res.json();
      let bar = document.getElementById('lineQuotaBanner');
      if(!res.ok || !d.exhausted){ if(bar) bar.remove(); return; }
      if(!bar){
        bar = document.createElement('div');
        bar.id = 'lineQuotaBanner';
        bar.style.cssText = 'position:sticky;top:0;z-index:150;background:#FEE2E2;border-bottom:2px solid #DC2626;color:#7F1D1D;padding:10px 16px;font-size:13px;line-height:1.7;';
        const main = document.querySelector('.main');
        if(main) main.insertBefore(bar, main.firstChild); else document.body.insertBefore(bar, document.body.firstChild);
      }
      const used = (d.used != null && d.limit != null) ? `（本月已用 ${d.used} ／ ${d.limit} 則）` : '';
      bar.innerHTML = `⚠️ <b>LINE 機器人本月的推播額度已用完${used}</b>，目前所有 LINE 通知（業務收屋主回覆、期限提醒、明日總覽…）都送不出去，每月 1 號重置。` +
        `<br>要立刻恢復請升級 LINE 官方帳號的訊息方案；在那之前，「完成安排」的「通知業務」按鈕會改給「分享連結」，請用自己的 LINE 轉傳給業務。`;
    }catch(e){}
  }
  document.addEventListener('DOMContentLoaded', () => { setTimeout(checkLineQuota, 1500); setInterval(checkLineQuota, 300000); });
})();
