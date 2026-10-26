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
    <button class="btn btn-ghost" style="padding:5px 8px;font-size:12px;color:#B42318;" title="這個人已離職：刪除，並可選職務代理人接手案件" onclick="sbResign(${i})">🗑 離職</button>
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


// ---- 離職人員：刪除，並可選「職務代理人」把他還沒完成的任務／預約轉過去 ----
async function sbResign(i){
  const p = SB.people[i];
  let pv = null;
  try{ pv = await sbPost('/api/people/resign-preview', {name: p.name}); }
  catch(e){ showToast('查詢失敗：' + e.message); return; }
  const others = SB.people.filter((x, j) => j !== i);
  const total = pv.tasks_as_rep + pv.tasks_as_creator + pv.bookings + pv.groups;
  const ov = document.createElement('div');
  ov.id = 'sbResignOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;';
  ov.innerHTML = `<div style="background:#fff;border-radius:16px;padding:22px;max-width:460px;width:100%;max-height:90vh;overflow-y:auto;color:#1B2333;">
    <div style="font-size:17px;font-weight:800;">🗑 ${escHtml(p.name)} 離職</div>
    <div style="font-size:13px;line-height:1.8;margin:10px 0;">
      會做這些事：<br>・解除 LINE／Slack 綁定（機器人不會再通知他）<br>・從業務名單、公文更名 PM 名單移除
    </div>
    <div style="background:${total ? '#FFF7E6' : '#F4F7FF'};border-radius:12px;padding:10px 12px;font-size:13px;line-height:1.8;">
      <b>目前還沒完成的資料</b><br>
      指派任務（他是業務）：<b>${pv.tasks_as_rep}</b> 筆　指派任務（他是安排人員）：<b>${pv.tasks_as_creator}</b> 筆<br>
      今天起的預約（登記人）：<b>${pv.bookings}</b> 筆　進行中的聯合排程（安排人員）：<b>${pv.groups}</b> 筆
      ${pv.samples.length ? `<div style="font-size:11.5px;color:#6B7280;margin-top:4px;">例如：${pv.samples.map(escHtml).join('、')}${total > pv.samples.length ? '…' : ''}</div>` : ''}
    </div>
    <div style="font-weight:800;font-size:13.5px;margin-top:14px;">這位同仁有職務代理人嗎？</div>
    <div style="font-size:12px;color:#6B7280;margin:2px 0 6px;line-height:1.6;">選了之後，上面這些資料會全部轉給代理人，舊名字也會記成代理人的別名；不選就只刪除，資料維持原樣（會變成沒人負責）。</div>
    <input id="sbReplInput" class="quick-mark-input" list="sbReplList" autocomplete="off" placeholder="輸入代理人名字搜尋（可不填）" style="margin:0;" onfocus="this.select()">
    <datalist id="sbReplList">${others.map(x => `<option value="${escHtml(x.name)}"></option>`).join('')}</datalist>
    <div id="sbReplErr" style="color:#B42318;font-size:12.5px;margin-top:6px;display:none;"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
      <button class="btn btn-ghost" style="padding:8px 16px;" onclick="document.getElementById('sbResignOverlay').remove()">取消</button>
      <button class="btn" id="sbResignGo" style="padding:8px 16px;background:#D64545;color:#fff;border:none;border-radius:10px;font-weight:800;cursor:pointer;" onclick="sbResignGo(${i})">確認離職</button>
    </div></div>`;
  document.body.appendChild(ov);
}
async function sbResignGo(i){
  const p = SB.people[i];
  const err = document.getElementById('sbReplErr');
  const raw = document.getElementById('sbReplInput').value.trim();
  let repl = '';
  if(raw){
    const hit = SB.people.find((x, j) => j !== i && x.name === raw) || SB.people.find((x, j) => j !== i && sbNorm(x.name) === sbNorm(raw));
    if(!hit){ err.textContent = '找不到「' + raw + '」，請從清單選一位現有同仁（或清空＝沒有代理人）'; err.style.display = 'block'; return; }
    repl = hit.name;
  }
  const msg = repl ? `確定 ${p.name} 離職，並把他的案件轉給 ${repl}？
（解除綁定、移出名單，這個動作不能還原）`
                   : `確定 ${p.name} 離職，而且沒有職務代理人？
他名下還沒完成的任務會維持原樣（沒人負責）。這個動作不能還原。`;
  if(!confirm(msg)) return;
  const btn = document.getElementById('sbResignGo');
  btn.disabled = true; btn.textContent = '處理中…';
  try{
    const d = await sbPost('/api/people/resign', {name: p.name, replacement: repl});
    document.getElementById('sbResignOverlay').remove();
    SB.people.splice(i, 1);
    const m = d.moved || {};
    showToast(`${p.name} 已離職` + (repl ? `：任務 ${m.tasks || 0}、預約 ${m.bookings || 0}、聯合排程 ${m.groups || 0} 筆已轉給 ${repl}` : '（沒有代理人）') + (d.errors && d.errors.length ? `；有 ${d.errors.length} 項失敗：${d.errors[0]}` : ''));
    sbRender();
  }catch(e){
    btn.disabled = false; btn.textContent = '確認離職';
    err.textContent = e.message; err.style.display = 'block';
  }
}
