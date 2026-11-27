// ============================================================
// 登入狀態與右上角頭像選單（所有有頁首的頁面共用）
// - 每一頁載入這個檔案，就會在頁首右上角放一個頭像：
//     沒登入 → 按下去到登入頁，登入完回到原本那頁
//     已登入 → 按下去彈出選單：信箱、LINE 提醒、修改密碼、登出
// - 客戶資料、產險管理等需要登入的頁面另外呼叫 requireLogin('../')，沒登入就導去登入頁。
// ============================================================

// 這個檔案相對於網站根目錄的位置（'' 或 '../'），頭像連到登入頁時要用
const AUTH_ROOT = ((document.currentScript && document.currentScript.getAttribute('src')) || '')
  .replace(/shared\/auth\.js.*$/, '');

// 目前這頁（相對於網站根目錄），登入後導回來用
function currentPageForLogin() {
  const parts = location.pathname.split('/').filter(Boolean);
  const last = parts[parts.length - 1] || '';
  let page;
  if (/\.html$/.test(last)) page = AUTH_ROOT ? parts.slice(-2).join('/') : last;
  else page = AUTH_ROOT ? `${last}/index.html` : 'index.html';
  return page + location.search + location.hash;
}
function loginUrl() {
  return `${AUTH_ROOT}login.html?next=${encodeURIComponent(currentPageForLogin())}`;
}

let AUTH_REQUIRED = false; // 這頁是否需要登入（requireLogin 呼叫過）

// 助理帳號：登入後在資料庫裡「代表」主要業務員（staff_assistants）；APP_UID 就是資料的擁有者
let APP_UID = null;

async function requireLogin(rootPrefix, opts = {}) {
  AUTH_REQUIRED = true;
  const { data } = await sb.auth.getSession();
  const session = data && data.session;
  if (!session) {
    location.replace(loginUrl());
    return new Promise(() => {}); // 停在這裡，不要繼續執行頁面初始化
  }
  const staff = await loadStaff(session.user);
  // 客戶帳號（綁定在客戶專區）不能進業務員頁面，導去「我的保單」；文件下載、診股這類共用頁面不擋（opts.allowPortal）
  if (!staff && !opts.allowPortal) try {
    const { data: me } = await sb.from('portal_links').select('user_id').eq('user_id', session.user.id).maybeSingle();
    if (me) { location.replace(`${AUTH_ROOT}my/index.html`); return new Promise(() => {}); }
  } catch { /* 查不到就照常 */ }
  // 團隊成員（含助理）一定要通過雙重驗證才繼續
  if (staff) await ensureMfa(session.user);
  renderAvatar(session.user);
  // 在其他分頁登出、或登入過期時，這頁也跟著回到登入頁
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') location.replace(loginUrl());
  });
  APP_UID = (staff && staff.principal) || session.user.id;
  // 回傳的 id 是「資料擁有者」：助理拿到的是主要業務員的 id（建立的資料都歸在主要業務員名下）
  return APP_UID === session.user.id ? session.user : { ...session.user, id: APP_UID, realId: session.user.id };
}

// ============================================================
// 雙重驗證（驗證 App 動態碼，TOTP）
// 還沒綁定 → 顯示 QR code 綁定；已綁定但這次登入還沒驗證 → 輸入 6 位數
// 資料庫也有把關（mfa_ok）：已綁定的帳號沒驗證就讀不到客戶資料
// ============================================================
async function ensureMfa(user) {
  try {
    const { data: aal, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) throw error;
    if (aal.currentLevel === 'aal2') return;
    const { data: f, error: e2 } = await sb.auth.mfa.listFactors();
    if (e2) throw e2;
    const verified = (f.totp || []).filter((x) => x.status === 'verified');
    if (verified.length) return mfaDialog('verify', { factorId: verified[0].id });
    // 清掉上次沒完成的綁定，再重新產生 QR code
    for (const x of (f.all || []).filter((x) => x.status !== 'verified')) { try { await sb.auth.mfa.unenroll({ factorId: x.id }); } catch { /* 略過 */ } }
    const { data: en, error: e3 } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: `東石家辦 ${new Date().toISOString().slice(0, 10)}` });
    if (e3) throw e3;
    return mfaDialog('enroll', { factorId: en.id, qr: en.totp.qr_code, secret: en.totp.secret, email: user.email });
  } catch (e) {
    console.error('[mfa]', e);
    return mfaDialog('error', { msg: (e && e.message) || String(e) });
  }
}

function mfaDialog(mode, o) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'mfa-overlay';
    const codeBox = `<input class="mfa-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" placeholder="6 位數驗證碼">
      <button type="button" class="mfa-go">確認</button><div class="mfa-err" role="alert"></div>`;
    const body = {
      enroll: `<h2>設定雙重驗證</h2>
        <p>為了保護客戶資料，團隊帳號需要綁定手機驗證 App（只要設定一次）。</p>
        <ol><li>手機安裝 <b>Google Authenticator</b> 或 <b>Microsoft Authenticator</b>。</li>
        <li>打開 App，按「＋」→「掃描 QR 碼」，掃下面這張圖。</li>
        <li>輸入 App 顯示的 6 位數字。</li></ol>
        <div class="mfa-qr"><img alt="雙重驗證 QR code"></div>
        <details class="mfa-key"><summary>無法掃描？改用金鑰手動輸入</summary><code>${String(o.secret || '').replace(/[^A-Z2-7]/gi, '').replace(/(.{4})/g, '$1 ').trim()}</code></details>
        ${codeBox}`,
      verify: `<h2>雙重驗證</h2><p>請打開手機的驗證 App，輸入「東石家辦」顯示的 6 位數字。</p>${codeBox}
        <p class="mfa-help">手機遺失或換手機，請主管在「團隊」頁幫您重設。</p>`,
      error: `<h2>雙重驗證暫時無法使用</h2><p class="mfa-err">${String(o.msg || '').replace(/[<>&]/g, '')}</p>
        <p>請重新整理再試一次；一直失敗請聯絡主管。</p><button type="button" class="mfa-go" data-reload>重新整理</button>`,
    }[mode];
    wrap.innerHTML = `<div class="mfa-box" role="dialog" aria-modal="true">${body}<button type="button" class="mfa-out">登出</button></div>`;
    document.body.appendChild(wrap);
    // QR code：伺服器可能回傳原始 SVG 或未編碼的 data URI，一律重新編碼後用屬性設定（不能直接塞進 HTML）
    const img = wrap.querySelector('.mfa-qr img');
    if (img) {
      const q = String(o.qr || ''), i = q.indexOf('<svg');
      img.src = i >= 0 ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(q.slice(i))}` : q;
    }
    const input = wrap.querySelector('.mfa-code'), go = wrap.querySelector('.mfa-go'), err = wrap.querySelector('.mfa-err');
    wrap.querySelector('.mfa-out').addEventListener('click', async () => { await sb.auth.signOut({ scope: 'local' }); location.replace(loginUrl()); });
    if (mode === 'error') { go.addEventListener('click', () => location.reload()); return; }
    input.focus();
    const submit = async () => {
      const code = input.value.replace(/\D/g, '');
      if (code.length !== 6) { err.textContent = '請輸入 6 位數字'; return; }
      go.disabled = true; err.textContent = '驗證中…';
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: o.factorId, code });
      if (error) { go.disabled = false; err.textContent = '驗證碼不正確或已過期，請輸入 App 上最新的數字'; input.select(); return; }
      wrap.remove(); resolve();
    };
    go.addEventListener('click', submit);
    input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 6); if (input.value.length === 6) submit(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  });
}

const CONTACT_EMAIL = 'eastone.sd@gmail.com'; // 「聯絡我們」收信信箱

const ICONS = {
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="4.2"/><path d="M3.8 20.5c1.3-4 4.5-6 8.2-6s6.9 2 8.2 6"/></svg>',
  line: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5c-5 0-9 3.2-9 7.2 0 3.6 3.2 6.6 7.5 7.1l-.6 2.7 3.6-2.6c4.5-.5 7.5-3.5 7.5-7.2 0-4-4-7.2-9-7.2z"/></svg>',
  book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/></svg>',
  key: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3M21 12v2"/></svg>',
  chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/></svg>',
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>',
  out: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M3 12h11M10 8l4 4-4 4"/></svg>',
};

// 在頁首右上角放頭像（先放一個空的，知道登入狀態後再更新）
function ensureAvatar() {
  const header = document.querySelector('.ghdr-wrap');
  if (!header) return null;
  let btn = header.querySelector('.ghdr-avatar');
  if (btn) return btn;
  // 把導覽列跟頭像包在同一個右側區塊，電腦版排成一列
  const nav = header.querySelector('.ghdr-nav');
  const right = document.createElement('div');
  right.className = 'ghdr-right';
  if (nav) { nav.replaceWith(right); right.appendChild(nav); } else header.appendChild(right);
  btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ghdr-avatar is-guest';
  btn.setAttribute('aria-label', '登入');
  btn.title = '登入';
  btn.innerHTML = ICONS.user;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (btn.classList.contains('is-guest')) location.href = loginUrl();
    else toggleAccountMenu(btn);
  });
  right.appendChild(btn);
  return btn;
}

function renderAvatar(user) {
  const btn = ensureAvatar();
  if (!btn) return;
  closeAccountMenu();
  if (!user) {
    btn.className = 'ghdr-avatar is-guest';
    btn.innerHTML = ICONS.user;
    btn.title = '登入';
    btn.setAttribute('aria-label', '登入');
    btn._user = null;
    return;
  }
  const paint = (staff) => {
    const name = staff ? staff.name : accountName(user.email);
    btn.className = 'ghdr-avatar';
    btn.textContent = avatarChar(name);
    btn.title = name;
    btn.setAttribute('aria-label', `帳號選單（${name}）`);
    btn._user = user;
    btn._staff = staff || null;
  };
  paint(cachedStaff(user.id));
  loadStaff(user).then((staff) => { if (btn._user && btn._user.id === user.id) paint(staff); });
}

// 業務員名字：team_members 有這個帳號就顯示名字（例 陳東逵），沒有（客戶專區帳號）才顯示帳號
const STAFF_KEY = 'eastone.staff';
function cachedStaff(uid) { try { const c = JSON.parse(sessionStorage.getItem(STAFF_KEY) || 'null'); return c && c.uid === uid ? c.staff : null; } catch { return null; } }
async function loadStaff(user) {
  try {
    const { data } = await sb.from('team_members').select('name, role').eq('user_id', user.id).maybeSingle();
    let staff = data && data.name ? { name: data.name, role: data.role } : null;
    if (!staff) {
      // 助理：代表主要業務員
      const { data: a } = await sb.from('staff_assistants').select('principal, name').eq('assistant', user.id).maybeSingle();
      if (a) staff = { name: a.name || '助理', role: 'assistant', principal: a.principal };
    }
    try { sessionStorage.setItem(STAFF_KEY, JSON.stringify({ uid: user.id, staff })); } catch { /* 無痕 */ }
    return staff;
  } catch { return cachedStaff(user.id); }
}
// 頭像字：中文三字名取名字第一個字（陳東逵 → 東，避免同姓都顯示「陳」）；其他取第一個字
function avatarChar(name) {
  const n = String(name || '').trim();
  if (/^[\u4e00-\u9fff]{3}$/.test(n)) return n[1];
  return (n[0] || '?').toUpperCase();
}

// 帳號顯示名稱：只顯示 Email「@」前面那一段（例 dkyp2377）
function accountName(email) { return String(email || '').split('@')[0]; }

function closeAccountMenu() {
  const m = document.querySelector('.acct-menu');
  if (m) m.remove();
  document.removeEventListener('click', onDocClickForMenu);
  document.removeEventListener('keydown', onKeyForMenu);
  window.removeEventListener('scroll', closeAccountMenu);
  window.removeEventListener('resize', closeAccountMenu);
}
function onDocClickForMenu(e) { if (!e.target.closest('.acct-menu')) closeAccountMenu(); }
function onKeyForMenu(e) { if (e.key === 'Escape') closeAccountMenu(); }

function toggleAccountMenu(btn) {
  if (document.querySelector('.acct-menu')) { closeAccountMenu(); return; }
  const email = (btn._user && btn._user.email) || '';
  const menu = document.createElement('div');
  menu.className = 'acct-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <div class="acct-head">
      <div class="acct-badge"></div>
      <div class="acct-who"><div class="acct-email"></div><div class="acct-sub"></div></div>
    </div>
    <div class="acct-sep"></div>
    <button type="button" class="acct-item" data-act="line" role="menuitem">${ICONS.line}<span>LINE 提醒</span></button>
    <button type="button" class="acct-item" data-act="pw" role="menuitem">${ICONS.key}<span>修改密碼</span></button>
    <a class="acct-item" role="menuitem" href="${AUTH_ROOT}kb/index.html">${ICONS.book}<span>保單知識庫</span></a>
    <div class="acct-sep"></div>
    <div class="acct-label">聯絡我們</div>
    <a class="acct-item" role="menuitem" target="_blank" rel="noopener"
       href="https://line.me/R/ti/p/${encodeURIComponent(typeof LINE_OA_ID !== 'undefined' ? LINE_OA_ID : '@686icngd')}">${ICONS.chat}<span>LINE 官方帳號</span></a>
    <a class="acct-item" role="menuitem"
       href="mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('東石家族辦公室｜聯絡我們')}&body=${encodeURIComponent(`\n\n—\n帳號：${email}`)}">${ICONS.mail}<span>寄 Email 給我們</span></a>
    <div class="acct-sep"></div>
    <button type="button" class="acct-item" data-act="logout" role="menuitem">${ICONS.out}<span>登出</span></button>`;
  menu.querySelector('.acct-badge').textContent = btn.textContent;
  const staff = btn._staff;
  menu.querySelector('.acct-email').textContent = staff ? staff.name : accountName(email);
  menu.querySelector('.acct-sub').textContent = staff ? `${{ manager: '主管', assistant: '助理' }[staff.role] || '業務員'}・帳號 ${accountName(email)}` : '東石家族辦公室帳號';
  // 放在 body 最上層，用頭像的位置定位，不會被頁面內容蓋住
  const r = btn.getBoundingClientRect();
  menu.style.top = `${Math.round(r.bottom + 8)}px`;
  menu.style.right = `${Math.max(12, Math.round(document.documentElement.clientWidth - r.right))}px`;
  document.body.appendChild(menu);

  menu.querySelector('[data-act="line"]').addEventListener('click', () => { closeAccountMenu(); openLineDialog(); });
  menu.querySelector('[data-act="pw"]').addEventListener('click', () => { closeAccountMenu(); openPasswordDialog(); });
  menu.querySelector('[data-act="logout"]').addEventListener('click', async () => {
    closeAccountMenu();
    await sb.auth.signOut({ scope: 'local' }); // 只登出東石保險這邊，不影響亞瑟
    // 需要登入的頁面回到登入頁；公開頁面（理賠／契變）留在原地，頭像變回未登入
    if (AUTH_REQUIRED) location.replace(loginUrl());
    else renderAvatar(null);
  });
  setTimeout(() => {
    document.addEventListener('click', onDocClickForMenu);
    document.addEventListener('keydown', onKeyForMenu);
    window.addEventListener('scroll', closeAccountMenu, { passive: true });
    window.addEventListener('resize', closeAccountMenu);
  });
}

// 檔案一載入就先放頭像，再依登入狀態更新（公開頁面也看得到）
(function initAvatar() {
  if (!ensureAvatar() || typeof sb === 'undefined') return;
  sb.auth.getSession().then(({ data }) => renderAvatar(data && data.session ? data.session.user : null));
  sb.auth.onAuthStateChange((_event, session) => renderAvatar(session ? session.user : null));
})();

// ---------- LINE 到期提醒：綁定狀態／產生綁定碼／解除綁定 ----------
function openLineDialog() {
  const overlay = document.createElement('div');
  overlay.className = 'auth-overlay';
  overlay.innerHTML = `
    <div class="auth-card auth-dialog line-dialog">
      <div class="auth-title">LINE 到期提醒</div>
      <div class="line-body">讀取中...</div>
      <div class="auth-msg"></div>
      <div class="auth-actions">
        <button type="button" class="auth-btn auth-btn-ghost" data-act="close">關閉</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const body = overlay.querySelector('.line-body');
  const msg = overlay.querySelector('.auth-msg');
  overlay.querySelector('[data-act="close"]').addEventListener('click', () => overlay.remove());

  const addFriend = LINE_OA_ID
    ? `<a class="auth-btn line-friend" href="https://line.me/R/ti/p/${encodeURIComponent(LINE_OA_ID)}" target="_blank" rel="noopener">加入官方帳號好友（${LINE_OA_ID}）</a>`
    : `<span class="line-muted">官方帳號尚未設定，請聯絡管理者。</span>`;

  async function render() {
    msg.textContent = '';
    const { data, error } = await sb.from('line_links').select('*').maybeSingle();
    if (error) { body.textContent = '讀取失敗：' + error.message; return; }

    if (data) {
      const d = new Date(data.linked_at);
      body.innerHTML = `
        <p class="line-status line-on">已綁定 LINE（${d.getFullYear() - 1911}/${d.getMonth() + 1}/${d.getDate()}）</p>
        <label class="line-days"${'remind_days' in data ? '' : ' hidden'}>提前提醒天數
          <select data-act="days">${[30, 60, 90].map((n) => `<option value="${n}"${n === (data.remind_days || 30) ? ' selected' : ''}>到期前 ${n} 天</option>`).join('')}</select>
        </label>
        <p class="line-note">保單到期前 <b class="line-days-n">${data.remind_days || 30}</b> 天內，每天早上 9 點會把快到期的保單整理成一則訊息傳到你的 LINE；到期前 10 天會再發一次最後提醒。</p>
        <button type="button" class="auth-btn auth-btn-ghost" data-act="unlink">解除綁定</button>`;
      body.querySelector('[data-act="days"]').addEventListener('change', async (ev) => {
        const n = Number(ev.target.value);
        const { error: e } = await sb.from('line_links').update({ remind_days: n }).not('owner', 'is', null);
        if (e) { msg.textContent = '儲存失敗：' + e.message; return; }
        body.querySelector('.line-days-n').textContent = n;
        msg.textContent = `已改成到期前 ${n} 天提醒`;
      });
      body.querySelector('[data-act="unlink"]').addEventListener('click', async () => {
        if (!confirm('確定要解除綁定嗎？之後就不會再收到 LINE 到期提醒。')) return;
        const { error: e } = await sb.from('line_links').delete().not('owner', 'is', null);
        if (e) { msg.textContent = '解除失敗：' + e.message; return; }
        render();
      });
      return;
    }

    body.innerHTML = `
      <p class="line-status">尚未綁定</p>
      <ol class="line-steps">
        <li>用手機 LINE 加入東石家族辦公室官方帳號好友<div>${addFriend}</div></li>
        <li>按下方按鈕產生綁定碼（30 分鐘內有效）
          <div><button type="button" class="auth-btn" data-act="code">產生綁定碼</button></div>
          <div class="line-code-wrap" hidden>
            <div class="line-code"></div>
            <button type="button" class="auth-btn auth-btn-ghost" data-act="copy">複製綁定碼</button>
          </div>
        </li>
        <li>把綁定碼傳給官方帳號，收到「綁定成功」後按
          <button type="button" class="auth-btn auth-btn-ghost" data-act="recheck">重新檢查</button></li>
      </ol>`;
    const codeWrap = body.querySelector('.line-code-wrap');
    const codeBox = body.querySelector('.line-code');
    body.querySelector('[data-act="code"]').addEventListener('click', async (e) => {
      e.target.disabled = true;
      const { data: code, error: e2 } = await sb.rpc('create_line_link_code');
      e.target.disabled = false;
      if (e2) { msg.textContent = '產生失敗：' + e2.message; return; }
      codeBox.textContent = code;
      codeWrap.hidden = false;
      e.target.textContent = '重新產生';
    });
    body.querySelector('[data-act="copy"]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(codeBox.textContent); msg.textContent = '已複製'; }
      catch (err) { msg.textContent = '無法自動複製，請手動選取綁定碼'; }
    });
    body.querySelector('[data-act="recheck"]').addEventListener('click', render);
  }
  render();
}

function openPasswordDialog() {
  const overlay = document.createElement('div');
  overlay.className = 'auth-overlay';
  overlay.innerHTML = `
    <form class="auth-card auth-dialog">
      <div class="auth-title">修改密碼</div>
      <label>新密碼<input type="password" name="p1" autocomplete="new-password" required></label>
      <label>再輸入一次<input type="password" name="p2" autocomplete="new-password" required></label>
      <div class="auth-msg"></div>
      <div class="auth-actions">
        <button type="button" class="auth-btn auth-btn-ghost" data-act="cancel">取消</button>
        <button type="submit" class="auth-btn">確認修改</button>
      </div>
    </form>`;
  document.body.appendChild(overlay);
  const form = overlay.querySelector('form');
  const msg = overlay.querySelector('.auth-msg');
  form.p1.focus();
  overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => overlay.remove());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p1 = form.p1.value, p2 = form.p2.value;
    if (p1.length < 6) { msg.textContent = '密碼至少要 6 個字元'; return; }
    if (p1 !== p2) { msg.textContent = '兩次輸入的密碼不一樣'; return; }
    msg.textContent = '處理中...';
    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) {
      msg.textContent = /different from the old/i.test(error.message)
        ? '新密碼不能跟舊密碼一樣'
        : '修改失敗：' + error.message;
      return;
    }
    overlay.remove();
    alert('密碼已更新，下次請用新密碼登入。');
  });
}

// 讀取／刪除等沒有自己處理錯誤的動作，如果連線失敗，統一在畫面下方顯示紅色提示
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason && e.reason.message ? e.reason.message : '發生未知錯誤';
  let box = document.querySelector('.auth-error');
  if (!box) {
    box = document.createElement('div');
    box.className = 'auth-error';
    document.body.appendChild(box);
  }
  box.textContent = msg;
  box.hidden = false;
  clearTimeout(box._t);
  box._t = setTimeout(() => { box.hidden = true; }, 10000);
});
