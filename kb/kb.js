// ============================================================
// 保單知識庫管理頁
// 所有登入者都能查看；只有管理員（dkyp2377@gmail.com）能新增、修改（資料庫也有同樣的權限控管）
// ============================================================
const ADMIN_EMAIL = "dkyp2377@gmail.com";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NATURE = { protection: "保障型", wealth: "理財型" };
const KIND = { main: "主約", rider: "附約" };
const RATE_MODE = { level: "平準（依投保年齡）", attained: "逐年調整（依到達年齡）", none: "無費率表" };
let isAdmin = false;
let current = null; // 目前打開的商品 id

function showToast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(t._t); t._t = setTimeout(() => (t.hidden = true), 2400);
}

document.addEventListener("DOMContentLoaded", async () => {
  const user = await requireLogin("../");
  isAdmin = (user.email || "").toLowerCase() === ADMIN_EMAIL;
  $("kb-role").innerHTML = isAdmin
    ? `<span class="kb-badge admin">管理員：可編輯</span>`
    : `<span class="kb-badge">唯讀</span> 發現資料有誤？請從右上角頭像「聯絡我們」告訴管理員`;
  $("kb-new").hidden = !isAdmin;
  $("kb-new").addEventListener("click", () => editProduct(null));
  $("kb-search").addEventListener("input", renderList);
  try { await KB.load(); } catch (err) { $("kb-list").textContent = "讀取失敗：" + (err.message || err); return; }
  renderList();
  const hash = decodeURIComponent(location.hash.slice(1));
  const p = hash && KB.product(hash);
  if (p) openProduct(p.id);
});

function renderList() {
  const q = $("kb-search").value.trim().toUpperCase();
  const list = KB.products.filter((p) => !q || [p.code, p.name, p.company].some((x) => String(x).toUpperCase().includes(q)));
  $("kb-list").innerHTML = list.length ? `<div class="kb-scroll"><table class="kb-table">
    <thead><tr><th>代號</th><th>名稱</th><th>主／附</th><th>類型</th><th>保障至</th><th>狀態</th></tr></thead>
    <tbody>${list.map((p) => `<tr data-id="${p.id}" class="${p.id === current ? "active" : ""}">
      <td><b>${esc(p.code)}</b></td><td>${esc(p.name)}<div class="kb-sub">${esc(p.company)}・${esc(p.version)}</div></td>
      <td>${KIND[p.kind] || p.kind}</td><td>${NATURE[p.nature] || p.nature}</td><td>${esc(p.coverage_to)}</td>
      <td>${p.verified ? `<span class="kb-ok">已驗證</span>` : `<span class="kb-todo">待驗證</span>`}</td></tr>`).join("")}</tbody></table></div>`
    : `<p class="kb-empty">沒有符合的商品</p>`;
  $("kb-list").querySelectorAll("tr[data-id]").forEach((tr) => tr.addEventListener("click", () => openProduct(Number(tr.dataset.id))));
}

const benefitValue = (b, item) => {
  const unit = item ? item.unit_label : "";
  if (item && item.pay_type === "flag") return "有";
  if (b.basis === "paid_premium") return `${b.min_label ? "至少 " : ""}已繳保費總和${Number(b.amount) !== 1 ? " × " + b.amount : ""}`;
  const v = Number(b.amount).toLocaleString();
  return `${b.min_label ? "至少 " : ""}${b.amount_low != null ? Number(b.amount_low).toLocaleString() + "～" : ""}${v} ${esc(unit)}`;
};
const rangeText = (b) => [
  b.from_year != null || b.to_year != null ? `第 ${b.from_year ?? 1}～${b.to_year ?? "∞"} 保單年度` : "",
  b.from_age != null || b.to_age != null ? `${b.from_age ?? 0}～${b.to_age ?? "∞"} 歲` : "",
].filter(Boolean).join("，") || "全期";

async function openProduct(id) {
  current = id;
  renderList();
  const p = KB.products.find((x) => x.id === id);
  const rates = p.rate_mode === "none" ? [] : await KB.rates(p.id);
  const terms = [...new Set(rates.map((r) => r.term))];
  const box = $("kb-detail");
  box.hidden = false;
  box.innerHTML = `
    <div class="kb-detail-head">
      <div><div class="kb-code">${esc(p.code)}</div><h2>${esc(p.name)}</h2>
        <div class="kb-sub">${esc(p.company)}・條款版本 ${esc(p.version || "—")}・${KIND[p.kind]}・${NATURE[p.nature]}・類別 ${esc(p.category || "—")}</div></div>
      <div class="kb-actions">${isAdmin ? `<button type="button" class="btn-secondary kb-small" id="kb-edit">編輯</button>` : ""}
        <button type="button" class="btn-secondary kb-small" id="kb-close">關閉</button></div>
    </div>
    <div class="kb-facts">
      <div><span>保額單位</span><b>${esc(p.unit)}${p.currency && p.currency !== "TWD" ? "（" + esc(p.currency) + "）" : ""}</b></div>
      <div><span>保障期間</span><b>${esc(p.coverage_to || "—")}</b></div>
      <div><span>繳費年期</span><b>${esc((p.pay_terms || []).join("、") || "—")}</b></div>
      <div><span>費率型態</span><b>${RATE_MODE[p.rate_mode] || p.rate_mode}</b></div>
      ${p.assumed_rate != null ? `<div><span>預定利率</span><b>${p.assumed_rate}%</b></div>` : ""}
      ${p.best_dividend_rate != null ? `<div><span>最可能紅利情境</span><b>${p.best_dividend_rate}%</b></div>` : ""}
      <div><span>狀態</span><b>${p.verified ? `已驗證${p.verified_at ? "（" + String(p.verified_at).slice(0, 10) + "）" : ""}` : "待驗證"}</b></div>
    </div>

    <h3>給付內容 <small>每 1 ${esc(p.unit)}${p.currency && p.currency !== "TWD" ? "，金額單位 " + esc(p.currency) : ""}</small></h3>
    <div class="kb-scroll"><table class="kb-table">
      <thead><tr><th>給付項目</th><th>每單位</th><th>適用</th><th>條件／限制</th><th>條款</th></tr></thead>
      <tbody>${p.benefits.map((b) => { const it = KB.item(b.item_code); return `<tr>
        <td><b>${esc(it ? it.name : b.item_code)}</b></td><td class="num">${benefitValue(b, it)}</td><td>${rangeText(b)}</td>
        <td>${esc(b.cond)}${b.max_times ? `<div class="kb-sub">${esc(b.max_times)}</div>` : ""}</td><td>${esc(b.clause)}</td></tr>`; }).join("")
        || `<tr><td colspan="5" class="kb-empty">尚未建立給付內容</td></tr>`}</tbody></table></div>

    <h3>條款重點提醒</h3>
    ${(p.notes || []).length ? `<ul class="kb-notes">${p.notes.map((n) => `<li>${esc(n.text)}${n.clause ? `<i>${esc(n.clause)}</i>` : ""}</li>`).join("")}</ul>` : `<p class="kb-empty">—</p>`}

    <h3>費率表 <small>年繳、每 1 ${esc(p.unit)}${p.currency && p.currency !== "TWD" ? "（" + esc(p.currency) + "）" : ""}；半年 ×${p.modal_factors["半年繳"]}、季 ×${p.modal_factors["季繳"]}、月 ×${p.modal_factors["月繳"]}</small></h3>
    ${terms.length ? terms.map((t) => {
      const ages = [...new Set(rates.filter((r) => r.term === t).map((r) => r.age))].sort((a, b) => a - b);
      const get = (sex, age) => { const r = rates.find((x) => x.term === t && x.sex === sex && x.age === age); return r ? Number(r.rate).toLocaleString() : "—"; };
      return `<details class="kb-rates"><summary>繳費年期 ${esc(t)}（${ages[0]}～${ages[ages.length - 1]} 歲）</summary>
        <div class="kb-rate-grid">${ages.map((a) => `<div><span>${a}</span><b>${get("男", a)}</b><b>${get("女", a)}</b></div>`).join("")}</div>
        <p class="kb-sub">每格：投保年齡｜男｜女</p></details>`;
    }).join("") : `<p class="kb-empty">${p.rate_mode === "none" ? "此商品不以費率表試算" : "尚未建立費率表"}</p>`}

    ${p.nature === "wealth" || (p.declared || []).length ? `<h3>宣告利率</h3>
      ${(p.declared || []).length ? `<div class="kb-scroll"><table class="kb-table"><thead><tr><th>月份</th><th>宣告利率</th></tr></thead><tbody>
        ${p.declared.map((d) => `<tr><td>${esc(String(d.month).slice(0, 7))}</td><td>${d.rate}%</td></tr>`).join("")}</tbody></table></div>` : `<p class="kb-empty">尚未登錄</p>`}
      ${isAdmin ? `<div class="kb-inline"><input type="month" id="kb-dr-month"><input type="number" id="kb-dr-rate" step="0.001" placeholder="%"><button type="button" class="btn-secondary kb-small" id="kb-dr-add">登錄本月利率</button></div>` : ""}` : ""}

    <p class="kb-sub kb-source">資料來源：${esc(p.source || "—")}</p>`;
  $("kb-close").addEventListener("click", () => { box.hidden = true; current = null; renderList(); });
  if (isAdmin) {
    $("kb-edit").addEventListener("click", () => editProduct(p));
    const add = $("kb-dr-add");
    if (add) {
      const now = new Date();
      $("kb-dr-month").value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      add.addEventListener("click", async () => {
        const month = $("kb-dr-month").value, rate = Number($("kb-dr-rate").value);
        if (!month || !isFinite(rate)) { showToast("請填月份與利率"); return; }
        const { error } = await sb.from("kb_declared_rates").upsert({ product_id: p.id, month: month + "-01", rate });
        if (error) { showToast("儲存失敗：" + error.message); return; }
        await reload(p.id); showToast("已登錄");
      });
    }
  }
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function reload(id) {
  await KB.load(true);
  renderList();
  if (id) openProduct(id);
}

// ---------------- 管理員編輯 ----------------
function editProduct(p) {
  const isNew = !p;
  p = p || { company: "富邦人壽", code: "", name: "", version: "", kind: "main", nature: "protection", category: "", unit: "萬",
    coverage_to: "", pay_terms: [], rate_mode: "level", currency: "TWD", modal_factors: { 年繳: 1, 半年繳: 0.52, 季繳: 0.262, 月繳: 0.088 },
    assumed_rate: null, notes: [], source: "", verified: false, benefits: [] };
  const opt = (map, v) => Object.entries(map).map(([k, l]) => `<option value="${k}"${k === v ? " selected" : ""}>${l}</option>`).join("");
  const itemOpts = (v) => KB.items.map((i) => `<option value="${i.code}"${i.code === v ? " selected" : ""}>${esc(i.name)}</option>`).join("");
  const nul = (v) => (v == null ? "" : v);
  const box = $("kb-detail");
  box.hidden = false;
  box.innerHTML = `
    <div class="kb-detail-head"><h2>${isNew ? "新增商品" : "編輯 " + esc(p.code)}</h2>
      <div class="kb-actions"><button type="button" class="btn-secondary kb-small" id="kb-cancel">取消</button></div></div>
    <div class="kb-form">
      <label>保險公司<input id="e-company" value="${esc(p.company)}"></label>
      <label>商品代號<input id="e-code" value="${esc(p.code)}"></label>
      <label class="kb-wide">商品名稱<input id="e-name" value="${esc(p.name)}"></label>
      <label>條款版本<input id="e-version" value="${esc(p.version)}" placeholder="例 XWS51111201"></label>
      <label>主約／附約<select id="e-kind">${opt(KIND, p.kind)}</select></label>
      <label>保障型／理財型<select id="e-nature">${opt(NATURE, p.nature)}</select></label>
      <label>類別<input id="e-category" value="${esc(p.category)}" placeholder="例 壽險、癌症、醫療"></label>
      <label>幣別<select id="e-currency">${["TWD", "USD", "AUD", "CNY", "EUR", "JPY"].map((c) => `<option${c === (p.currency || "TWD") ? " selected" : ""}>${c}</option>`).join("")}</select></label>
      <label>保額單位<select id="e-unit">${["萬", "單位", "計劃", "附加"].map((u) => `<option${u === p.unit ? " selected" : ""}>${u}</option>`).join("")}</select></label>
      <label>保障期間<input id="e-coverage" value="${esc(p.coverage_to)}" placeholder="例 終身、95歲、繳費期滿"></label>
      <label>繳費年期（逗號分隔）<input id="e-terms" value="${esc((p.pay_terms || []).join(","))}" placeholder="例 6年,10年,20年"></label>
      <label>費率型態<select id="e-ratemode">${opt(RATE_MODE, p.rate_mode)}</select></label>
      <label>月繳係數<input id="e-f-m" type="number" step="0.001" value="${p.modal_factors["月繳"]}"></label>
      <label>季繳係數<input id="e-f-q" type="number" step="0.001" value="${p.modal_factors["季繳"]}"></label>
      <label>半年繳係數<input id="e-f-h" type="number" step="0.001" value="${p.modal_factors["半年繳"]}"></label>
      <label>預定利率（%）<input id="e-assumed" type="number" step="0.001" value="${nul(p.assumed_rate)}"></label>
      <label>最可能紅利情境（%）<input id="e-bestdiv" type="number" step="0.01" value="${nul(p.best_dividend_rate)}" placeholder="分紅商品才填"></label>
      <label class="kb-wide">資料來源<input id="e-source" value="${esc(p.source)}"></label>
      <label class="kb-wide">條款重點提醒（一行一條，「內容｜條款」）<textarea id="e-notes" rows="5">${esc((p.notes || []).map((n) => n.text + (n.clause ? "｜" + n.clause : "")).join("\n"))}</textarea></label>
    </div>

    <h3>給付內容 <small>金額是「每 1 個保額單位」給付多少</small></h3>
    <div class="kb-scroll"><table class="kb-table kb-edit-table"><thead><tr><th>項目</th><th>計算基礎</th><th>每單位／倍數</th><th>區間下限</th><th>保單年度</th><th>保險年齡</th><th>至少</th><th>條件</th><th>限制</th><th>條款</th><th></th></tr></thead>
      <tbody id="e-benefits">${p.benefits.map((b) => benefitRow(b, itemOpts, nul)).join("")}</tbody></table></div>
    <button type="button" class="btn-secondary kb-small" id="e-add-benefit">＋ 新增給付項目</button>

    ${isNew ? "" : `<h3>費率表（貼上取代）</h3>
    <div class="kb-inline"><input id="e-rate-term" placeholder="繳費年期，例 20年" value="${esc((p.pay_terms || [])[0] || "")}"></div>
    <textarea id="e-rate-text" rows="5" placeholder="每行：投保年齡 男 女（可直接從費率表 PDF 複製貼上）"></textarea>
    <button type="button" class="btn-secondary kb-small" id="e-rate-save">更新這個年期的費率表</button>`}

    <div class="kb-save-row">
      <label class="kb-check"><input type="checkbox" id="e-verified"${p.verified ? " checked" : ""}> 已核對條款，標為「已驗證」</label>
      ${isNew ? "" : `<button type="button" class="btn-secondary kb-small kb-danger" id="e-delete">刪除商品</button>`}
      <button type="button" class="btn-primary kb-small" id="e-save">儲存</button>
    </div>`;

  $("kb-cancel").addEventListener("click", () => (isNew ? (box.hidden = true) : openProduct(p.id)));
  $("e-add-benefit").addEventListener("click", () => $("e-benefits").insertAdjacentHTML("beforeend", benefitRow({ item_code: KB.items[0].code, amount: 0 }, itemOpts, nul)));
  $("e-benefits").addEventListener("click", (e) => { if (e.target.classList.contains("e-del")) e.target.closest("tr").remove(); });
  $("e-save").addEventListener("click", () => saveProduct(p, isNew));
  if (!isNew) {
    $("e-delete").addEventListener("click", async () => {
      if (!confirm(`確定刪除 ${p.code} ${p.name}？給付內容與費率表會一起刪除。`)) return;
      const { error } = await sb.from("kb_products").delete().eq("id", p.id);
      if (error) { showToast("刪除失敗：" + error.message); return; }
      box.hidden = true; current = null; await reload(); showToast("已刪除");
    });
    $("e-rate-save").addEventListener("click", () => saveRates(p));
  }
}

function benefitRow(b, itemOpts, nul) {
  return `<tr>
 <td><select class="e-item">${itemOpts(b.item_code)}</select></td>
    <td><select class="e-basis"><option value="unit"${b.basis !== "paid_premium" ? " selected" : ""}>每單位保額</option><option value="paid_premium"${b.basis === "paid_premium" ? " selected" : ""}>已繳保費總和</option></select></td>
    <td><input class="e-amount" type="number" step="any" value="${nul(b.amount)}"></td>
    <td><input class="e-low" type="number" step="any" value="${nul(b.amount_low)}"></td>
    <td><div class="kb-pair"><input class="e-fy" type="number" value="${nul(b.from_year)}" placeholder="起"><input class="e-ty" type="number" value="${nul(b.to_year)}" placeholder="迄"></div></td>
    <td><div class="kb-pair"><input class="e-fa" type="number" value="${nul(b.from_age)}" placeholder="起"><input class="e-ta" type="number" value="${nul(b.to_age)}" placeholder="迄"></div></td>
    <td><input class="e-min" type="checkbox"${b.min_label ? " checked" : ""}></td>
    <td><input class="e-cond" value="${esc(b.cond || "")}"></td>
    <td><input class="e-max" value="${esc(b.max_times || "")}"></td>
    <td><input class="e-clause" value="${esc(b.clause || "")}"></td>
    <td><button type="button" class="icon-btn e-del" title="移除">✕</button></td></tr>`;
}

async function saveProduct(p, isNew) {
  const num = (v) => (v === "" || v == null ? null : Number(v));
  const rec = {
    company: $("e-company").value.trim(), code: $("e-code").value.trim().toUpperCase(), name: $("e-name").value.trim(),
    version: $("e-version").value.trim(), kind: $("e-kind").value, nature: $("e-nature").value, category: $("e-category").value.trim(),
    unit: $("e-unit").value, currency: $("e-currency").value, coverage_to: $("e-coverage").value.trim(),
    pay_terms: $("e-terms").value.split(/[,，、\s]+/).map((x) => x.trim()).filter(Boolean),
    rate_mode: $("e-ratemode").value,
    modal_factors: { 年繳: 1, 半年繳: Number($("e-f-h").value), 季繳: Number($("e-f-q").value), 月繳: Number($("e-f-m").value) },
    assumed_rate: num($("e-assumed").value), best_dividend_rate: num($("e-bestdiv").value), source: $("e-source").value.trim(),
    notes: $("e-notes").value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [text, clause] = l.split("｜"); return { text: text.trim(), clause: (clause || "").trim() }; }),
    verified: $("e-verified").checked, verified_at: $("e-verified").checked ? (p.verified_at || new Date().toISOString()) : null,
    updated_at: new Date().toISOString(),
  };
  if (!rec.code || !rec.name) { showToast("請填代號與名稱"); return; }
  const rows = [...$("e-benefits").querySelectorAll("tr")].map((tr, i) => ({
    item_code: tr.querySelector(".e-item").value, basis: tr.querySelector(".e-basis").value, amount: Number(tr.querySelector(".e-amount").value) || 0,
    amount_low: num(tr.querySelector(".e-low").value), from_year: num(tr.querySelector(".e-fy").value), to_year: num(tr.querySelector(".e-ty").value),
    from_age: num(tr.querySelector(".e-fa").value), to_age: num(tr.querySelector(".e-ta").value), min_label: tr.querySelector(".e-min").checked,
    cond: tr.querySelector(".e-cond").value.trim(), max_times: tr.querySelector(".e-max").value.trim(), clause: tr.querySelector(".e-clause").value.trim(), sort: i,
  }));
  const btn = $("e-save"); btn.disabled = true;
  try {
    let id = p.id;
    if (isNew) {
      const { data, error } = await sb.from("kb_products").insert(rec).select("id").single();
      sbThrow(error, "新增商品"); id = data.id;
    } else {
      const { error } = await sb.from("kb_products").update(rec).eq("id", id);
      sbThrow(error, "更新商品");
      const { error: e2 } = await sb.from("kb_product_benefits").delete().eq("product_id", id);
      sbThrow(e2, "更新給付內容");
    }
    if (rows.length) {
      const { error: e3 } = await sb.from("kb_product_benefits").insert(rows.map((r) => ({ ...r, product_id: id })));
      sbThrow(e3, "儲存給付內容");
    }
    await reload(id);
    showToast("已儲存");
  } catch (err) {
    showToast(err.message || String(err));
  } finally { btn.disabled = false; }
}

async function saveRates(p) {
  const term = $("e-rate-term").value.trim();
  const lines = $("e-rate-text").value.split("\n").map((l) => l.replace(/,/g, "").trim().split(/\s+/)).filter((a) => a.length >= 3 && /^\d+$/.test(a[0]));
  if (!term || !lines.length) { showToast("請填繳費年期並貼上「年齡 男 女」"); return; }
  const rows = [];
  lines.forEach(([age, m, f]) => { rows.push({ product_id: p.id, term, sex: "男", age: Number(age), rate: Number(m) }); rows.push({ product_id: p.id, term, sex: "女", age: Number(age), rate: Number(f) }); });
  if (!confirm(`將以 ${lines.length} 個年齡取代「${term}」的費率表，確定？`)) return;
  const { error } = await sb.from("kb_rates").delete().eq("product_id", p.id).eq("term", term);
  if (error) { showToast("更新失敗：" + error.message); return; }
  const { error: e2 } = await sb.from("kb_rates").insert(rows);
  if (e2) { showToast("更新失敗：" + e2.message); return; }
  delete KB._rates[p.id];
  await reload(p.id); showToast("費率表已更新");
}
