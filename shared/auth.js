// ============================================================
// 登入檢查（客戶資料、產險管理兩頁共用）
// requireLogin('../')：沒登入就導到登入頁；有登入就在頁首下方顯示「帳號／修改密碼／登出」列。
// ============================================================

async function requireLogin(rootPrefix) {
  const { data } = await sb.auth.getSession();
  const session = data && data.session;
  if (!session) {
    // 記住目前這頁（例如 clients/index.html），登入後導回來
    const parts = location.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] || '';
    const here = (/\.html$/.test(last) ? parts.slice(-2).join('/') : `${last}/index.html`) + location.hash;
    location.replace(`${rootPrefix}login.html?next=${encodeURIComponent(here)}`);
    return new Promise(() => {}); // 停在這裡，不要繼續執行頁面初始化
  }
  renderAuthBar(session.user, rootPrefix);

  // 在其他分頁登出、或登入過期時，這頁也跟著回到登入頁
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') location.replace(`${rootPrefix}login.html`);
  });
  return session.user;
}

function renderAuthBar(user, rootPrefix) {
  if (document.querySelector('.auth-bar')) return;
  const bar = document.createElement('div');
  bar.className = 'auth-bar';
  bar.innerHTML = `
    <span class="auth-user"></span>
    <button type="button" class="auth-link" data-act="pw">修改密碼</button>
    <button type="button" class="auth-link" data-act="logout">登出</button>`;
  bar.querySelector('.auth-user').textContent = user.email || '';
  const header = document.querySelector('.ghdr-wrap');
  if (header) header.insertAdjacentElement('afterend', bar);
  else document.body.prepend(bar);

  bar.querySelector('[data-act="logout"]').addEventListener('click', async () => {
    await sb.auth.signOut();
    location.replace(`${rootPrefix}login.html`);
  });
  bar.querySelector('[data-act="pw"]').addEventListener('click', openPasswordDialog);
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
