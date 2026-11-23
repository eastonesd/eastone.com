// ============================================================
// 深色／淺色模式
// 設定存在 localStorage「eastone-theme」：auto（跟隨系統，預設）／light／dark
// 放在 <head> 最前面載入，避免頁面先亮一下再變暗
// 畫面右上角（導覽列）會多一顆切換鈕：自動 → 淺色 → 深色
// ============================================================
(function () {
  const KEY = 'eastone-theme';
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const get = () => { try { return localStorage.getItem(KEY) || 'auto'; } catch { return 'auto'; } };
  const set = (v) => { try { localStorage.setItem(KEY, v); } catch {} };

  function apply() {
    const pref = get();
    const dark = pref === 'dark' || (pref === 'auto' && mq && mq.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelectorAll('.theme-toggle').forEach(paint);
  }
  const LABEL = { auto: '自動', light: '淺色', dark: '深色' };
  const svg = (d) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICON = {
    auto: svg('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>'),
    light: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    dark: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  };
  function paint(btn) {
    const pref = get();
    btn.innerHTML = `<span aria-hidden="true">${ICON[pref]}</span><b>${LABEL[pref]}</b>`;
    btn.title = `外觀：${LABEL[pref]}${pref === 'auto' ? '（跟隨系統）' : ''}，點一下切換`;
  }

  apply();
  if (mq) (mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply));
  window.addEventListener('storage', (e) => { if (e.key === KEY) apply(); });

  function place(header, btn) {
    const avatar = header.querySelector('.ghdr-avatar');
    const tools = header.querySelector('.ghdr-tools');
    if (tools) { if (tools.firstElementChild !== btn) tools.prepend(btn); }
    else if (avatar) { if (avatar.previousElementSibling !== btn) avatar.before(btn); }
    else if (btn.parentElement !== header) header.appendChild(btn);
  }
  function mount() {
    const header = document.querySelector('.ghdr-wrap');
    if (!header) return;
    const had = header.querySelector('.theme-toggle');
    if (had) { place(header, had); return; }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-toggle';
    btn.addEventListener('click', () => {
      const order = ['auto', 'light', 'dark'];
      set(order[(order.indexOf(get()) + 1) % 3]);
      apply();
    });
    paint(btn);
    // 放在頭像左邊；還沒有頭像時先放在頁首最後，等 auth.js 放好頭像再移過去
    place(header, btn);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { mount(); setTimeout(mount, 800); });
  else mount();
  // auth.js 會重排導覽列，重排後確保按鈕還在
  new MutationObserver(() => { if (document.querySelector('.ghdr-wrap')) mount(); })
    .observe(document.documentElement, { childList: true, subtree: true });
  window.EastoneTheme = { get, set: (v) => { set(v); apply(); } };
})();
