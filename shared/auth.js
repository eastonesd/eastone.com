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
    <button type="button" class="auth-link" data-act="line">LINE 提醒</button>
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
  bar.querySelector('[data-act="line"]').addEventListener('click', openLineDialog);
}

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
    const { data, error } = await sb.from('line_links').select('linked_at').maybeSingle();
    if (error) { body.textContent = '讀取失敗：' + error.message; return; }

    if (data) {
      const d = new Date(data.linked_at);
      body.innerHTML = `
        <p class="line-status line-on">已綁定 LINE（${d.getFullYear() - 1911}/${d.getMonth() + 1}/${d.getDate()}）</p>
        <p class="line-note">保單到期前 30 天內，每天早上 9 點會把快到期的保單整理成一則訊息傳到你的 LINE。</p>
        <button type="button" class="auth-btn auth-btn-ghost" data-act="unlink">解除綁定</button>`;
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
        <li>用手機 LINE 加入東石系統官方帳號好友<div>${addFriend}</div></li>
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
