// ============================================================
// 保單知識庫：AI 讀取條款／費率表建檔（管理員專用）
// 流程：選 PDF（或貼網址）→ 送到 kb-extract（Claude 讀條款與費率表）→ 開成「草稿」編輯畫面
//      → 管理員對照原始 PDF 核對、修改 → 按儲存才真正寫進知識庫
// 需要先載入 ../shared/supabase-client.js（sb、SUPABASE_URL）與 kb.js 的 editProduct
// ============================================================
const KB_EXTRACT_URL = `${SUPABASE_URL}/functions/v1/kb-extract`;

function openImport() {
  const box = $("kb-detail");
  box.hidden = false;
  box.innerHTML = `
    <div class="kb-detail-head"><h2>AI 讀取條款建檔</h2>
      <div class="kb-actions"><button type="button" class="btn-secondary kb-small" id="ai-close">關閉</button></div></div>
    <p class="kb-sub">上傳保險公司的條款 PDF（必要）和費率表 PDF（選填），AI 會整理成知識庫格式。結果不會直接存檔，你核對、修改後按「儲存」才會建檔。</p>
    <div class="kb-form ai-form">
      <label>保險公司<input id="ai-company" value="富邦人壽"></label>
      <label class="kb-wide">條款 PDF<input type="file" id="ai-clause" accept="application/pdf,.pdf"></label>
      <label>或條款網址<input id="ai-clause-url" placeholder="https://…pdf"></label>
      <label class="kb-wide">費率表 PDF<input type="file" id="ai-rate" accept="application/pdf,.pdf"></label>
      <label class="kb-wide">或費率表網址<input id="ai-rate-url" placeholder="https://…pdf"></label>
    </div>
    <div class="kb-save-row">
      <span class="ai-status" id="ai-status"></span>
      <button type="button" class="btn-primary kb-small" id="ai-go">開始讀取</button>
    </div>`;
  $("ai-close").addEventListener("click", () => (box.hidden = true));
  $("ai-go").addEventListener("click", runExtract);
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1] || "");
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

async function runExtract() {
  const clauseFile = $("ai-clause").files[0], rateFile = $("ai-rate").files[0];
  const clauseUrl = $("ai-clause-url").value.trim(), rateUrl = $("ai-rate-url").value.trim();
  if (!clauseFile && !clauseUrl && !rateFile && !rateUrl) { showToast("請選擇條款或費率表 PDF"); return; }
  for (const f of [clauseFile, rateFile]) if (f && f.size > 20 * 1024 * 1024) { showToast(`${f.name} 超過 20MB`); return; }

  const btn = $("ai-go"), status = $("ai-status");
  btn.disabled = true;
  const t0 = Date.now();
  const tick = setInterval(() => { status.textContent = `AI 讀取中… ${Math.round((Date.now() - t0) / 1000)} 秒（通常 1～2 分鐘，請不要關閉頁面）`; }, 500);
  try {
    const body = { company: $("ai-company").value.trim() };
    if (clauseFile) body.clause_pdf = await fileToBase64(clauseFile); else if (clauseUrl) body.clause_url = clauseUrl;
    if (rateFile) body.rate_pdf = await fileToBase64(rateFile); else if (rateUrl) body.rate_url = rateUrl;
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(KB_EXTRACT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}`, apikey: SUPABASE_KEY },
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok && !out.product && !out.rates) throw new Error(out.error || (out.warnings || []).join("；") || `伺服器錯誤 ${res.status}`);
    const pdf = clauseFile ? { url: URL.createObjectURL(clauseFile), name: clauseFile.name } : clauseUrl ? { url: clauseUrl, name: "條款" } : null;
    openDraft(out, pdf, Math.round((Date.now() - t0) / 1000));
  } catch (err) {
    status.textContent = "讀取失敗：" + (err.message || err);
  } finally {
    clearInterval(tick);
    btn.disabled = false;
  }
}

// AI 結果 → 編輯畫面的草稿
function openDraft(out, pdf, secs) {
  const P = out.product || {};
  const R = out.rates || null;
  const warnings = [...(out.warnings || []), ...(P.warnings || []), ...((R && R.warnings) || [])];
  const code = String(P.code || (R && R.code) || "").trim().toUpperCase();
  const existing = code ? KB.product(code) : null;

  // 費率：每個年期一組 [[年齡, 男, 女]]；「每千元」費率換算成每萬元
  const rates = {};
  let factor = 1;
  const unit = P.unit || (R && R.unit) || "萬";
  if (R && /千/.test(R.table_unit || "") && unit === "萬") { factor = 10; warnings.push(`費率表單位是「${R.table_unit}」，已自動 ×10 換算成每萬元`); }
  for (const t of (R && R.tables) || []) {
    const rows = (t.rows || []).filter((r) => Array.isArray(r) && r.length >= 3 && r.every((x) => isFinite(x)))
      .map(([a, m, f]) => [Math.round(a), +(m * factor).toFixed(4), +(f * factor).toFixed(4)]);
    if (rows.length) rates[String(t.term || "").trim() || "未標示"] = rows;
  }
  // 費率表沒寫年期、條款只有一種繳費年期 → 直接套用
  if (rates["未標示"] && (P.pay_terms || []).length === 1 && !rates[P.pay_terms[0]]) {
    rates[P.pay_terms[0]] = rates["未標示"];
    delete rates["未標示"];
  }
  warnings.push(...rateChecks(rates));

  const mf = { 年繳: 1, 半年繳: 0.52, 季繳: 0.262, 月繳: 0.088, ...(existing ? existing.modal_factors : {}) };
  if (R && R.modal_factors) for (const k of ["半年繳", "季繳", "月繳"]) if (isFinite(R.modal_factors[k]) && R.modal_factors[k] > 0) mf[k] = R.modal_factors[k];
  const terms = [...new Set([...(P.pay_terms || []), ...Object.keys(rates)])];

  const p = {
    ...(existing || {}),
    company: P.company || $("ai-company")?.value || (existing && existing.company) || "富邦人壽",
    code: code || (existing && existing.code) || "",
    name: P.name || (existing && existing.name) || "",
    version: P.version || (existing && existing.version) || "",
    kind: P.kind || (existing && existing.kind) || "main",
    nature: P.nature || (existing && existing.nature) || "protection",
    category: P.category || (existing && existing.category) || "",
    unit,
    currency: P.currency || (existing && existing.currency) || "TWD",
    coverage_to: P.coverage_to || (existing && existing.coverage_to) || "",
    pay_terms: terms,
    rate_mode: R ? R.rate_mode || "level" : (existing && existing.rate_mode) || (Object.keys(rates).length ? "level" : "none"),
    modal_factors: mf,
    assumed_rate: P.assumed_rate ?? (existing && existing.assumed_rate) ?? null,
    best_dividend_rate: existing ? existing.best_dividend_rate : null,
    notes: P.notes && P.notes.length ? P.notes : (existing && existing.notes) || [],
    source: `AI 讀取${pdf ? "：" + pdf.name : ""}（${new Date().toISOString().slice(0, 10)}，待人工核對）`,
    benefits: P.benefits && P.benefits.length ? P.benefits.map((b) => ({ ...b, amount_low: b.amount_low ?? null })) : (existing && existing.benefits) || [],
    verified: false,
    verified_at: null,
  };
  if (!out.product && existing) warnings.push("這次只讀了費率表，商品資料沿用知識庫現有內容");
  editProduct(p, { draft: { rates, warnings, pdf, usage: out.usage, secs, model: out.model, existing: !!existing, hadProduct: !!out.product } });
}

// 費率表基本檢查：年齡要連續、費率應隨年齡增加（平準型）
function rateChecks(rates) {
  const w = [];
  for (const [term, rows] of Object.entries(rates)) {
    const ages = rows.map((r) => r[0]);
    const gaps = ages.filter((a, i) => i && a !== ages[i - 1] + 1);
    if (gaps.length) w.push(`費率 ${term}：年齡不連續（${gaps.slice(0, 5).join("、")} 歲前有缺），請對照原始費率表`);
    const drops = rows.filter((r, i) => i && (r[1] < rows[i - 1][1] * 0.9 || r[2] < rows[i - 1][2] * 0.9)).map((r) => r[0]);
    if (drops.length) w.push(`費率 ${term}：${drops.slice(0, 5).join("、")} 歲的費率比前一歲低很多，可能抄錯`);
  }
  return w;
}

function draftBanner(d, isNew) {
  const tok = d.usage ? `，用量 ${Number(d.usage.input_tokens || 0).toLocaleString()} ＋ ${Number(d.usage.output_tokens || 0).toLocaleString()} tokens` : "";
  return `<div class="ai-banner">
      <b>這是 AI 讀取的草稿，還沒存檔。</b>請對照原始條款核對每一列，確認無誤再按最下方「儲存」。
      ${d.existing ? `<div class="ai-exist">知識庫已有這個代號，儲存會<b>覆蓋</b>原本的商品資料、給付內容${Object.keys(d.rates).length ? "，以及下方這些年期的費率" : ""}。</div>` : ""}
      <div class="kb-sub">讀取 ${d.secs} 秒${tok}${d.model ? "（" + esc(d.model) + "）" : ""}</div>
      ${d.warnings.length ? `<ul class="ai-warn">${d.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
      ${d.pdf ? `<details class="ai-pdf" open><summary>原始條款（對照用）</summary>
        ${/^blob:/.test(d.pdf.url) ? `<iframe src="${esc(d.pdf.url)}" title="條款"></iframe>` : `<a href="${esc(d.pdf.url)}" target="_blank" rel="noopener">在新分頁開啟條款 PDF</a>`}</details>` : ""}
    </div>`;
}

function draftRatesHtml(d) {
  const terms = Object.entries(d.rates);
  return `<h3>費率表 <small>AI 讀取，每行「投保年齡 男 女」，年繳、每 1 個保額單位；可直接修改</small></h3>
    ${terms.length ? terms.map(([term, rows]) => `
      <div class="ai-rate">
        <div class="kb-inline"><label>繳費年期<input class="ai-rate-term" value="${esc(term)}"></label>
          <span class="kb-sub">${rows.length} 個年齡（${rows[0][0]}～${rows[rows.length - 1][0]} 歲）</span>
          <label class="kb-check ai-rate-keep"><input type="checkbox" checked> 一併儲存</label></div>
        <textarea class="ai-rate-text" rows="6">${rows.map((r) => r.join(" ")).join("\n")}</textarea>
      </div>`).join("") : `<p class="kb-empty">這次沒有讀到費率表${d.existing ? "，儲存不會動到原本的費率" : ""}</p>`}`;
}

function bindDraft() { /* 目前沒有額外互動；保留給之後的對照工具 */ }

// 儲存草稿裡勾選的費率表：同年期整批取代
async function saveDraftRates(productId) {
  let n = 0;
  for (const box of document.querySelectorAll(".ai-rate")) {
    if (!box.querySelector(".ai-rate-keep input").checked) continue;
    const term = box.querySelector(".ai-rate-term").value.trim();
    const rows = [];
    box.querySelector(".ai-rate-text").value.split("\n").map((l) => l.replace(/,/g, "").trim().split(/\s+/))
      .filter((a) => a.length >= 3 && /^\d+$/.test(a[0]) && isFinite(a[1]) && isFinite(a[2]))
      .forEach(([age, m, f]) => {
        rows.push({ product_id: productId, term, sex: "男", age: Number(age), rate: Number(m) });
        rows.push({ product_id: productId, term, sex: "女", age: Number(age), rate: Number(f) });
      });
    if (!term || !rows.length) continue;
    const { error } = await sb.from("kb_rates").delete().eq("product_id", productId).eq("term", term);
    sbThrow(error, `更新 ${term} 費率`);
    for (let i = 0; i < rows.length; i += 500) {
      const { error: e2 } = await sb.from("kb_rates").insert(rows.slice(i, i + 500));
      sbThrow(e2, `儲存 ${term} 費率`);
    }
    n += rows.length;
  }
  return n;
}
