// 主控台登入（2026-10-09）。只有 index.html 載入這支；業務填單頁、屋主頁走 token 連結，不需要登入。
// 作法：包住 window.fetch——對後端的請求自動帶 Authorization: Bearer <token>；後端回 401（請先登入）
// 時跳出密碼視窗，登入成功後把剛剛失敗的請求重送一次。後端沒設定密碼（DASHBOARD_PASSWORD）時
// /api/auth/status 回 required:false，這裡什麼都不做。
(function(){
  const API = 'https://epc-backend-4aj2.onrender.com';
  const KEY = 'epcAuthToken';
  const origFetch = window.fetch.bind(window);
  let loginPromise = null;

  function getToken(){ try{ return localStorage.getItem(KEY) || ''; }catch(e){ return ''; } }
  function setToken(t){ try{ if(t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); }catch(e){} }

  // 給 <a href> 下載連結用（連結沒辦法帶標頭，後端認 ?access_token=）
  window.epcAuthUrl = function(url){
    const t = getToken();
    return t ? url + (url.indexOf('?') >= 0 ? '&' : '?') + 'access_token=' + encodeURIComponent(t) : url;
  };
  window.epcLogout = function(){ setToken(''); location.reload(); };

  function showLogin(){
    if(loginPromise) return loginPromise;
    loginPromise = new Promise(resolve => {
      const ov = document.createElement('div');
      ov.id = 'epcLoginOverlay';
      ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:linear-gradient(135deg,#FFF6E8,#F3E3C8);display:flex;align-items:center;justify-content:center;padding:20px;font-family:"PingFang TC","Microsoft JhengHei","Noto Sans TC",system-ui,sans-serif;';
      ov.innerHTML = `<div style="background:#fff;border-radius:18px;padding:26px 24px;max-width:360px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,.18);">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
          <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(150deg,#FFB648,#F2790C 65%,#C4530A);color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center;">陽</div>
          <div><div style="font-weight:800;font-size:17px;">陽光管理主控台</div><div style="font-size:12px;color:#6B7280;">請輸入密碼登入</div></div>
        </div>
        <input id="epcLoginPw" type="password" autocomplete="current-password" placeholder="密碼" style="width:100%;padding:13px 14px;border:1.5px solid #E4E8F1;border-radius:12px;font-size:16px;box-sizing:border-box;">
        <div id="epcLoginErr" style="color:#D64545;font-size:13px;margin-top:8px;min-height:18px;"></div>
        <button id="epcLoginBtn" style="width:100%;margin-top:6px;padding:13px;border:none;border-radius:12px;background:linear-gradient(135deg,#FFB648,#F2790C);color:#fff;font-size:16px;font-weight:800;cursor:pointer;">登入</button>
      </div>`;
      document.body.appendChild(ov);
      const pw = ov.querySelector('#epcLoginPw'), err = ov.querySelector('#epcLoginErr'), btn = ov.querySelector('#epcLoginBtn');
      setTimeout(() => pw.focus(), 50);
      async function submit(){
        err.textContent = ''; btn.disabled = true; btn.textContent = '登入中…';
        try{
          const res = await origFetch(API + '/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({password: pw.value})});
          const d = await res.json().catch(() => ({}));
          if(!res.ok || !d.token){ throw new Error(d.error || '登入失敗'); }
          setToken(d.token);
          ov.remove(); loginPromise = null; resolve();
        }catch(e){
          err.textContent = e.message; btn.disabled = false; btn.textContent = '登入'; pw.select();
        }
      }
      btn.onclick = submit;
      pw.addEventListener('keydown', e => { if(e.key === 'Enter') submit(); });
    });
    return loginPromise;
  }

  window.fetch = async function(input, init){
    const url = typeof input === 'string' ? input : '';
    if(!url || url.indexOf(API) !== 0) return origFetch(input, init);
    const build = () => {
      const headers = new Headers((init && init.headers) || {});
      const t = getToken();
      if(t && !headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + t);
      return Object.assign({}, init || {}, {headers});
    };
    let res = await origFetch(input, build());
    if(res.status === 401){
      const j = await res.clone().json().catch(() => ({}));
      if(j.login_required){
        setToken('');
        await showLogin();
        res = await origFetch(input, build());
      }
    }
    return res;
  };

  // 一打開頁面就先確認要不要登入（不用等到第一個 API 失敗才跳）
  origFetch(API + '/api/auth/status', {headers: getToken() ? {Authorization: 'Bearer ' + getToken()} : {}})
    .then(r => r.json())
    .then(d => { if(d.required && !d.valid){ setToken(''); const go = () => showLogin(); (document.body ? go() : document.addEventListener('DOMContentLoaded', go)); } })
    .catch(() => {});
})();
