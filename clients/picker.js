// ============================================================
// 一次看到全部選項的點選面板（取代瀏覽器內建的滾輪下拉）
// 用法：<input data-pick="來源名稱">，再到 PICK_SOURCES[來源名稱] = (input) => 選項
// 選項可以是字串陣列，或 [{ label: "分組標題", options: [...], layout: "list" }]
// 單一選項可以是字串，或 { value, label, sub }（label 粗體、sub 小字；layout "list" 時排成卡片格）
// 欄位仍然可以直接打字；點選項會填入並觸發 input / change
// ============================================================
const PICK_SOURCES = {};

(function () {
  let panel = null;
  let current = null;

  const escp = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function groupsOf(input) {
    const src = PICK_SOURCES[input.dataset.pick];
    const raw = src ? src(input) : [];
    if (!raw || !raw.length) return [];
    return typeof raw[0] === "string" ? [{ label: "", options: raw }] : raw;
  }

  function close() {
    if (panel) panel.remove();
    panel = null;
    if (current) current.classList.remove("pick-open");
    current = null;
  }

  function place() {
    if (!panel || !current) return;
    const r = current.getBoundingClientRect();
    const wide = panel.querySelector('.pick-list') ? 560 : 320;   // 卡片格清單給寬一點，一排能放 3～4 張
    const w = Math.min(Math.max(r.width, wide), window.innerWidth - 24);
    let left = r.left + window.scrollX;
    left = Math.min(left, window.scrollX + window.innerWidth - w - 12);
    panel.style.width = `${w}px`;
    panel.style.left = `${Math.max(window.scrollX + 12, left)}px`;
    // 下面放不下就放上面
    const below = window.innerHeight - r.bottom;
    const h = panel.offsetHeight;
    panel.style.top = below < h + 16 && r.top > h + 16
      ? `${r.top + window.scrollY - h - 8}px`
      : `${r.bottom + window.scrollY + 8}px`;
  }

  function render() {
    if (!panel || !current) return;
    const value = current.value.trim();
    const groups = groupsOf(current);
    const norm = (o) => (typeof o === "string" ? { value: o, label: o } : o);
    panel.innerHTML = groups.map((g) => `
      ${g.label ? `<div class="pick-label">${escp(g.label)}</div>` : ""}
      ${g.options.length ? `<div class="${g.layout === "list" ? "pick-list" : "pick-grid"}">${g.options.map(norm).map((o) => `<button type="button" class="pick-chip${o.sub ? " two" : ""}${o.value === value ? " on" : ""}" data-v="${escp(o.value)}">${o.sub ? `<b>${escp(o.label)}</b><small>${escp(o.sub)}</small>` : escp(o.label)}</button>`).join("")}</div>` : ""}`).join("")
      + `<div class="pick-foot">${value ? `<button type="button" class="pick-clear">清除</button>` : "<span></span>"}<span class="pick-hint">沒有的選項可以直接打字</span></div>`;
    place();
  }

  function open(input) {
    if (input.disabled || input.readOnly) return;
    if (current === input && panel) return;
    close();
    if (!groupsOf(input).length) return;
    current = input;
    input.classList.add("pick-open");
    panel = document.createElement("div");
    panel.className = "pick-panel";
    // 點面板不要讓欄位失去焦點
    panel.addEventListener("mousedown", (e) => e.preventDefault());
    panel.addEventListener("click", (e) => {
      const chip = e.target.closest(".pick-chip");
      const clear = e.target.closest(".pick-clear");
      if (!chip && !clear) return;
      const target = current;
      target.value = chip ? chip.dataset.v : "";
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      close();
    });
    document.body.appendChild(panel);
    render();
  }

  document.addEventListener("focusin", (e) => {
    const el = e.target.closest && e.target.closest("[data-pick]");
    if (el) open(el); else if (!(panel && panel.contains(e.target))) close();
  });
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-pick]");
    if (el) { open(el); return; }
    if (panel && !panel.contains(e.target)) close();
  });
  document.addEventListener("input", (e) => { if (e.target === current) render(); });
  document.addEventListener("keydown", (e) => {
    if (!current) return;
    if (e.key === "Escape" || e.key === "Tab") close();
  });
  window.addEventListener("resize", place);
  window.addEventListener("scroll", place, true);

  window.closePicker = close;
})();
