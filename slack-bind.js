// Slack 綁定（2026-10-26）：LINE 每月只有 200 則額度，爆了就整個收不到通知。
// 這裡把「人員 → Slack 帳號」綁起來，機器人通知會 LINE 與 Slack 同步私訊（Slack 沒有額度限制）；
// 另外「我的通知」（明日行程總覽、出貨日期更新、廠商申請這些沒有指定收件人的）同步到你自己的 Slack。
// 用「經典 script」載入，跟 slots.js 共用 showToast／escHtml。
let SB = {people: [], users: [], def: {id: '', name: ''}};

function sbUserLabel(u){
  return u.name + (u.display && u.display !== u.name ? '（' + u.display + '）' : '') + (u.email ? ' · ' + u.email : '');
}
function sbOptions(selectedId, selectedName){
  let list = SB.users.slice();
  if(selectedId && !list.some(u => u.id === selectedId)) list.unshift({id: selectedId, name: selectedName || selectedId, display: '', email: ''});
  return '<option value="">未綁定</option>' + list.map(u => `<option value="${escHtml(u.id)}" ${u.id === selectedId ? 'selected' : ''}>${escHtml(sbUserLabel(u))}</option>`).join('');
}
// 可打字搜尋的欄位：<input list> 配一份 datalist，直接打名字／email 的一部分就會篩選；選好或按 Enter 才綁定
function sbLabelOf(id, name){
  const u = SB.users.find(x => x.id === id);
  return u ? sbUserLabel(u) : (id ? (name || id) : '');
}
function sbInput(id, name, onchange, extraAttr){
  return `<input class="quick-mark-input sb-input" list="sbUsers" autocomplete="off" placeholder="輸入名字或 email 搜尋 Slack 帳號…"
    value="${escHtml(sbLabelOf(id, name))}" onfocus="this.select()" onchange="${onchange}" ${extraAttr || ''}>`;
}
// 輸入的字 → 唯一的 Slack 使用者（完全等於選項文字，或只有一位符合）；找不到／好幾位回 null
function sbResolve(text){
  const v = (text || '').trim();
  if(!v) return {empty: true};
  const exact = SB.users.find(u => sbUserLabel(u) === v);
  if(exact) return {user: exact};
  const n = sbNorm(v);
  const hits = SB.users.filter(u => [u.name, u.display, u.email, sbUserLabel(u)].some(x => sbNorm(x).includes(n)));
  if(hits.length === 1) return {user: hits[0]};
  return {user: null, many: hits.length};
}
function sbNorm(t){ return String(t || '').normalize('NFKC').toLowerCase().replace(/[\s_.\-()（）]/g, ''); }
// 名字配對：Slack 顯示名稱／真名／email 前綴 跟人員名字互相包含（至少 2 個字）
function sbGuess(personName){
  const n = sbNorm(personName);
  if(n.length < 2) return null;
  const hits = SB.users.filter(u => [u.name, u.display, (u.email || '').split('@')[0]].map(sbNorm).some(x => x && x.length >= 2 && (x.includes(n) || n.includes(x))));
  return hits.length === 1 ? hits[0] : null;      // 只有唯一符合才算有把握
}

async function openSlackBindModal(){
  const old = document.getElementById('sbOverlay'); if(old) old.remove();
  const ov = document.createElement('div');
  ov.id = 'sbOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
  ov.onclick = e => { if(e.target === ov) ov.remove(); };
  ov.innerHTML = '<div id="sbBox" style="background:#fff;border-radius:16px;padding:22px;max-width:680px;width:100%;max-height:90vh;overflow-y:auto;color:#1B2333;">載入中…</div>';
  document.body.appendChild(ov);
  try{
    const [br, ur] = await Promise.all([fetch(API_BASE + '/api/slack/bindings', {cache: 'no-store'}), fetch(API_BASE + '/api/slack/users', {cache: 'no-store'})]);
    const b = await br.json(), u = await ur.json();
    if(!br.ok) throw new Error(b.error || br.status);
    if(!b.configured || !u.configured){
      document.getElementById('sbBox').innerHTML = sbHead() + '<div class="login-note">後端還沒有設定 Slack 機器人（Render 環境變數 SLACK_BOT_TOKEN）。</div>';
      return;
    }
    if(u.error) throw new Error('讀取 Slack 人員失敗：' + u.error);
    SB = {people: b.people || [], users: u.users || [], def: b.default || {id: '', name: ''}};
    sbRender();
  }catch(e){
    document.getElementById('sbBox').innerHTML = sbHead() + '<div style="color:#B42318;margin-top:10px;">載入失敗：' + escHtml(e.message) + '</div>';
  }
}

function sbHead(){
  return `<div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-size:17px;font-weight:800;">💬 Slack、LINE 綁定</div>
    <button type="button" onclick="document.getElementById('sbOverlay').remove()" style="border:none;background:#F1F3F8;border-radius:50%;width:30px;height:30px;cursor:pointer;">✕</button></div>`;
}

function sbRender(){
  const box = document.getElementById('sbBox');
  if(!box) return;
  const unbound = SB.people.filter(p => !p.slack_id).length;
  box.innerHTML = sbHead() + `
    <div style="font-size:12.5px;color:#6B7280;margin:6px 0 12px;line-height:1.7;"><b>Slack</b>：從下拉選單打字搜尋就能綁定，綁好後機器人通知會 LINE 與 Slack 同步私訊（Slack 沒有額度限制，LINE 爆了至少 Slack 看得到）。<b>LINE</b>：這裡顯示有沒有綁定；還沒綁的，按「複製 LINE 綁定連結」傳給他，他用手機 LINE 打開、綁一次就好。</div>
    <div style="background:#F4F7FF;border-radius:12px;padding:12px 14px;margin-bottom:14px;">
      <div style="font-weight:800;font-size:13.5px;">🙋 我的通知</div>
      <div style="font-size:12px;color:#6B7280;margin:2px 0 8px;line-height:1.6;">明日行程總覽、出貨日期更新、廠商預約申請…這些「給你」的通知，同步到下面這個 Slack 帳號。</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        ${sbInput(SB.def.id, SB.def.name, 'sbSetDefault(this)', 'id="sbDefault" style="flex:1;min-width:200px;margin:0;"')}
        <button class="btn btn-ghost" style="padding:6px 12px;font-size:12px;" onclick="sbTest(SB.def.id)">傳測試訊息</button>
      </div></div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
      <div style="font-weight:800;font-size:13.5px;">👥 人員（${SB.people.length} 位，未綁 Slack ${unbound} 位）</div>
      <button class="btn btn-ghost" style="padding:5px 12px;font-size:12px;" onclick="sbAutoMatch()">🔎 自動配對</button>
    </div>
    <datalist id="sbUsers">${SB.users.map(u => `<option value="${escHtml(sbUserLabel(u))}"></option>`).join('')}</datalist>
    <div id="sbRows">${SB.people.map((p, i) => sbRow(p, i)).join('')}</div>
    <div style="display:flex;gap:8px;margin-top:12px;">
      <input id="sbNewName" class="quick-mark-input" placeholder="找不到的人：輸入名字新增" style="flex:1;margin:0;">
      <button class="btn btn-ghost" style="padding:6px 14px;font-size:12.5px;white-space:nowrap;" onclick="sbAddPerson()">＋ 新增</button>
    </div>`;
}

function sbRow(p, i){
  return `<div style="display:flex;gap:8px;align-items:center;padding:8px 0;border-top:1px solid #EEE;flex-wrap:wrap;">
    <div style="flex:0 0 120px;min-width:90px;"><b>${escHtml(p.name)}</b><div style="font-size:11px;color:${p.line ? '#16A34A' : '#D97706'};font-weight:700;">${p.line ? '✓ 已綁 LINE' : '⚠ 未綁 LINE'}${p.scheduler ? '・安排人員' : ''}</div>
      ${p.line ? '' : `<button class="btn btn-ghost" style="padding:3px 8px;font-size:11px;margin-top:4px;white-space:nowrap;" onclick="sbCopyLineLink(${i})">📋 複製 LINE 綁定連結</button>`}</div>
    ${sbInput(p.slack_id, p.slack_name, `sbBind(${i}, this)`, 'style="flex:1;min-width:180px;margin:0;"')}
    <button class="btn btn-ghost" style="padding:5px 10px;font-size:12px;${p.slack_id ? '' : 'visibility:hidden;'}" onclick="sbTest('${escHtml(p.slack_id)}')">測試</button>
  </div>`;
}

// 產生這個人的 LINE 綁定連結（LIFF，名字已帶入）並複製一段可以直接傳給他的訊息
async function sbCopyLineLink(i){
  const p = SB.people[i];
  try{
    const d = await (await fetch(API_BASE + '/api/line/rep-bind-url?name=' + encodeURIComponent(p.name), {cache: 'no-store'})).json();
    if(!d.url){ showToast('LINE 綁定功能尚未設定（LIFF_ID）'); return; }
    const text = `${p.name} 您好，請用手機 LINE 打開下面的連結，綁定陽光機器人通知（只要綁一次）：
${d.url}
綁定後，預約確認、期限提醒、明日行程等通知會傳到你的 LINE。`;
    try{ await navigator.clipboard.writeText(text); }
    catch(e){
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    showToast('已複製「' + p.name + '」的 LINE 綁定連結，請傳給他');
  }catch(e){ showToast('複製失敗：' + e.message); }
}

async function sbPost(path, body){
  const res = await fetch(API_BASE + path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const d = await res.json().catch(() => ({}));
  if(!res.ok) throw new Error(d.error || ('HTTP ' + res.status));
  return d;
}
function sbUserName(id){ const u = SB.users.find(x => x.id === id); return u ? u.name : ''; }

async function sbBind(i, el){
  const p = SB.people[i];
  const r = sbResolve(el.value);
  if(!r.empty && !r.user){
    showToast(r.many ? '有 ' + r.many + ' 位符合，請多打幾個字，或從清單選' : '找不到這個 Slack 帳號，請從清單選');
    el.value = sbLabelOf(p.slack_id, p.slack_name);
    return;
  }
  const id = r.empty ? '' : r.user.id;
  if(id === p.slack_id) { el.value = sbLabelOf(p.slack_id, p.slack_name); return; }
  try{
    await sbPost('/api/slack/bindings', {name: p.name, slack_id: id, slack_name: sbUserName(id)});
    p.slack_id = id; p.slack_name = sbUserName(id);
    showToast(id ? '已綁定 ' + p.name + ' → ' + sbUserName(id) : '已解除 ' + p.name + ' 的 Slack 綁定');
    sbRender();
  }catch(e){ showToast('綁定失敗：' + e.message); sbRender(); }
}
async function sbSetDefault(el){
  const r = sbResolve(el.value);
  if(!r.empty && !r.user){
    showToast(r.many ? '有 ' + r.many + ' 位符合，請多打幾個字，或從清單選' : '找不到這個 Slack 帳號，請從清單選');
    el.value = sbLabelOf(SB.def.id, SB.def.name);
    return;
  }
  const id = r.empty ? '' : r.user.id;
  try{
    await sbPost('/api/slack/default-user', {slack_id: id, slack_name: sbUserName(id)});
    SB.def = {id, name: sbUserName(id)};
    showToast(id ? '「我的通知」會同步到 ' + sbUserName(id) + ' 的 Slack' : '已關閉「我的通知」的 Slack 同步');
  }catch(e){ showToast('設定失敗：' + e.message); }
}
async function sbTest(id){
  if(!id){ showToast('請先選擇 Slack 帳號'); return; }
  try{ await sbPost('/api/slack/test', {slack_id: id}); showToast('已傳測試訊息到 ' + (sbUserName(id) || 'Slack') + '，請到 Slack 確認'); }
  catch(e){ showToast('測試失敗：' + e.message); }
}
function sbAddPerson(){
  const el = document.getElementById('sbNewName');
  const name = (el.value || '').trim();
  if(!name) return;
  if(SB.people.some(p => p.name === name)){ showToast('名單上已經有「' + name + '」'); return; }
  SB.people.push({name, line: false, slack_id: '', slack_name: '', record_id: '', scheduler: false});
  sbRender();
}
async function sbAutoMatch(){
  const pairs = SB.people.filter(p => !p.slack_id).map(p => [p, sbGuess(p.name)]).filter(x => x[1]);
  if(!pairs.length){ showToast('沒有可以自動配對的（名字要跟 Slack 名稱唯一相符）'); return; }
  if(!confirm('依名字自動配對以下 ' + pairs.length + ' 位並綁定，確定嗎？\n\n' + pairs.map(([p, u]) => p.name + ' → ' + sbUserLabel(u)).join('\n'))) return;
  let ok = 0;
  for(const [p, u] of pairs){
    try{ await sbPost('/api/slack/bindings', {name: p.name, slack_id: u.id, slack_name: u.name}); p.slack_id = u.id; p.slack_name = u.name; ok++; }catch(e){ console.error(e); }
  }
  showToast('已綁定 ' + ok + ' 位');
  sbRender();
}
