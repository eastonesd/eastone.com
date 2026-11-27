// ============================================================
// 客戶管理系統：第二層模組列（客戶總覽／人壽管理／產險管理／家族辦公室）
// 用法：<body data-cm="overview|life|pc|fo" data-cm-root="../">，載入本檔即可；
//       clients/index.html 一頁含兩個模組，會用 window.cmSetModule() 切換高亮
// ============================================================
(function () {
  const root = document.body.dataset.cmRoot ?? '../';
  const MODS = [
    ['overview', '客戶總覽', `${root}clients/index.html#filelist`],
    ['life', '人壽管理', `${root}clients/index.html#codes`],
    ['pc', '產險管理', `${root}policies/index.html`],
    ['fo', '家族辦公室', `${root}clients/family.html`],
  ];
  const bar = document.createElement('nav');
  bar.className = 'cm-bar';
  bar.setAttribute('aria-label', '客戶管理');
  bar.innerHTML = `<span class="cm-title">客戶管理</span>${MODS.map(([k, l, h]) => `<a class="cm-tab" data-m="${k}" href="${h}">${l}</a>`).join('')}
    <button type="button" class="cm-era" title="切換日期顯示"><span class="a">西元</span><i></i><span class="r">民國</span></button>`;
  // 西元／民國：全系統共用（localStorage eastone.dateEra，預設民國）
  const ERA = 'eastone.dateEra';
  const era = () => { try { return localStorage.getItem(ERA) === 'ad' ? 'ad' : 'roc'; } catch { return 'roc'; } };
  const eraBtn = bar.querySelector('.cm-era');
  const paintEra = () => eraBtn.classList.toggle('is-roc', era() === 'roc');
  paintEra();
  eraBtn.addEventListener('click', () => {
    try { localStorage.setItem(ERA, era() === 'roc' ? 'ad' : 'roc'); } catch { /* 無痕 */ }
    paintEra();
    if (typeof window.onEraChange === 'function') window.onEraChange(); else location.reload();
  });
  const hdr = document.querySelector('.ghdr-wrap');
  (hdr ? hdr.after(bar) : document.body.prepend(bar));
  window.cmSetModule = (m) => {
    document.body.dataset.cm = m;
    bar.querySelectorAll('.cm-tab').forEach((a) => a.classList.toggle('active', a.dataset.m === m));
    // 同一頁裡的分頁：只顯示屬於目前模組的（data-cm-of="overview life"）
    document.querySelectorAll('[data-cm-of]').forEach((el) => { el.hidden = !el.dataset.cmOf.split(' ').includes(m); });
  };
  window.cmSetModule(document.body.dataset.cm || 'overview');
  // 團隊主管多一個「團隊」分頁（唯讀檢視成員的客戶）
  (async () => {
    try {
      if (typeof sb === 'undefined') return;
      const { data: s } = await sb.auth.getSession();
      if (!s || !s.session) return;
      const { data: mgr } = await sb.rpc('fo_is_manager'); // 主管（含主管的助理）
      if (mgr !== true) return;
      const a = document.createElement('a');
      a.className = 'cm-tab' + (document.body.dataset.cm === 'team' ? ' active' : '');
      a.dataset.m = 'team'; a.href = `${root}clients/team.html`; a.textContent = '團隊';
      bar.insertBefore(a, eraBtn); bar.classList.add('has-team');
    } catch { /* 讀不到就不顯示 */ }
  })();
})();
