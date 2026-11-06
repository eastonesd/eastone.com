// ============================================================
// 保單健診（試算版）：以「被保人」為單位，跨所有客戶抓主約與附約，
// 依保單知識庫算出當年度保障數值、時間軸、保費摘要與條款提醒。
// 網址：checkup.html?id=<被保人的客戶ID>
// 這一頁是計算引擎的驗收畫面；正式 A4 報告之後以同一份計算結果排版。
// ============================================================
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => Math.round(Number(n) || 0).toLocaleString();

const DOMAINS = [
  ["life", "壽險保障（留愛給家人）"], ["accident", "意外保障"], ["medical", "醫療保障"],
  ["critical", "癌症・重大疾病・重大傷病"], ["ltc", "失能・長期照顧"], ["waiver", "保費豁免"], ["wealth", "理財"],
];
const PHASES = [["duty", "人生責任"], ["before", "前｜診斷確定"], ["during", "中｜治療期間"], ["after", "後｜後期照顧"]];

document.addEventListener("DOMContentLoaded", async () => {
  await requireLogin("../");
  const id = (new URLSearchParams(location.search).get("id") || "").toUpperCase();
  try {
    const [all, , fx] = await Promise.all([clientList(), KB.load(), kbFetchFx()]);
    const insured = all.find((c) => c.id === id);
    if (!insured) { $("ck-main").innerHTML = `<p class="ck-loading">查無此客戶</p>`; return; }
    render(kbCompute({ allClients: all, insured, fx }), insured);
  } catch (err) {
    $("ck-main").innerHTML = `<p class="ck-loading">無法計算：${esc(err.message || err)}<br>（保單知識庫可能尚未建立）</p>`;
  }
});

function valueText(v) {
  if (v.item.pay_type === "flag") return "有";
  const main = `${money(v.total)}`;
  const range = v.hasLow && v.low !== v.total ? `${money(v.low)}～${main}` : main;
  return `${v.min ? "至少 " : ""}${range}`;
}
function contractLabel(ct) { return `${ct.code || ""} ${ct.name || ""}`.trim() || "（未填商品）"; }

function render(res, insured) {
  const { contracts, values, events, premium, notes } = res;
  const ok = contracts.filter((c) => !c.pending);
  const pending = contracts.filter((c) => c.pending);
  const noKb = ok.filter((c) => !c.product);
  const age = ok.length ? null : null;
  const nowAge = kbInsuranceAge(insured.birthday, res.asOf);
  const policies = [...new Set(ok.map((c) => c.policy_no))];

  // 依保單分組（主約在前，附約縮排）
  const byPolicy = {};
  ok.forEach((c) => (byPolicy[c.policy_no] = byPolicy[c.policy_no] || []).push(c));

  const contractRow = (c) => `
    <tr class="${c.kind === "rider" ? "ck-rider" : ""}${c.covered ? "" : " ck-off"}">
      <td>${c.kind === "rider" ? "↳ 附約" : "主約"}</td>
      <td><b>${esc(c.code || "")}</b> ${esc(c.name || "")}
        <div class="ck-sub">${c.product ? `<span class="ck-tag ok">知識庫${c.product.verified ? " ✓" : ""}</span>` : `<span class="ck-tag warn">未建檔</span>`}
        <span class="ck-tag ${c.nature === "wealth" ? "gold" : ""}">${c.nature === "wealth" ? "理財" : "保障"}</span>
        ${c.covered ? "" : `<span class="ck-tag warn">${c.py < 1 ? "尚未生效" : "目前無保障"}</span>`}</div></td>
      <td>${esc(c.term || "—")}</td>
      <td>${esc(c.coverageText || "—")}</td>
      <td>${c.sa !== "" && c.sa != null ? esc(c.sa) + esc(c.saUnit || "") : "—"}</td>
      <td class="num">${money(c.premium)}</td>
    </tr>`;

  const domainBlocks = DOMAINS.map(([d, title]) => {
    const list = Object.values(values).filter((v) => v.item.domain === d).sort((a, b) => a.item.sort - b.item.sort);
    if (!list.length) return "";
    let lastGrp = "";
    return `<section class="ck-domain"><h3>${title}</h3>
      ${list.map((v) => {
        const grp = v.item.grp !== lastGrp && v.item.grp !== title ? `<div class="ck-grp">${esc(v.item.grp)}</div>` : "";
        lastGrp = v.item.grp;
        const limitNote = v.item.pay_type === "limit" && v.rows.length > 1 ? `<div class="ck-cond warn">多張限額合計，實際依理賠協調，不等於保證可領金額</div>` : "";
        return `${grp}<details class="ck-val">
          <summary><span>${esc(v.item.name)}</span><b>${valueText(v)}<small>${v.item.pay_type === "flag" ? "" : esc(v.item.unit_label)}</small></b></summary>
          ${limitNote}
          ${v.rows.map((r) => `<div class="ck-src"><span>${esc(r.ct.policy_no)}｜${esc(contractLabel(r.ct))}</span>
              <span>${r.basis === "paid_premium" ? `已繳保費 ${r.ct.paidYears} 年` : r.ct.product && r.ct.product.unit !== "附加" ? `${r.ct.units} ${esc(r.ct.product.unit)}` : ""}${v.item.pay_type === "flag" ? "" : " → " + (r.currency !== "TWD" ? `${esc(r.currency)} ${money(r.orig)} ≈ ` : "") + money(r.value)}</span></div>
            <div class="ck-cond">${esc(r.cond)}${r.max_times ? "；" + esc(r.max_times) : ""}${r.clause ? `<i>${esc(r.clause)}</i>` : ""}</div>`).join("")}
        </details>`;
      }).join("")}</section>`;
  }).join("");

  const phaseBlocks = PHASES.map(([p, title]) => {
    const list = Object.values(values).filter((v) => v.item.phase === p && v.item.pay_type !== "flag").sort((a, b) => a.item.sort - b.item.sort);
    return `<div class="ck-phase"><h4>${title}</h4>${list.length
      ? list.map((v) => `<div class="ck-pv"><span>${esc(v.item.name)}</span><b>${valueText(v)}</b></div>`).join("")
      : `<div class="ck-empty">目前沒有對應保障</div>`}</div>`;
  }).join("");

  const diff = premium.nextYear - premium.thisYear;
  const fxNote = res.foreign.length ? `<p class="ck-fx">單位：新臺幣。外幣保單以 ${res.foreign.map((f) => f.rate ? `${esc(f.currency)}/TWD ${f.rate.toFixed(3)}` : `${esc(f.currency)}（查無匯率，未換算）`).join("、")} 換算${res.fxAt ? `（${new Date(res.fxAt).toLocaleString("zh-TW", { hour12: false })}）` : ""}，匯率變動會影響金額。</p>` : "";
  $("ck-main").innerHTML = `
    <section class="card ck-head">
      <div>
        <div class="ck-name">${esc(insured.name)}</div>
        <div class="ck-meta">${esc(insured.gender || "")}　保險年齡 ${nowAge ?? "—"} 歲　資料基準日 ${fmtDate(res.asOf)}</div>
      </div>
      <div class="ck-kpis">
        <div><span>有效保單</span><b>${policies.length}</b></div>
        <div><span>今年總繳保費</span><b>${money(premium.thisYear)}</b></div>
        <div><span>明年預計總繳</span><b>${money(premium.nextYear)}</b><em>${diff === 0 ? "今年 +0" : `今年 ${diff > 0 ? "+" : "−"}${money(Math.abs(diff))}`}</em></div>
      </div>
    </section>

    ${fxNote}
    ${pending.length || noKb.length ? `<section class="card ck-warn">
      <b>資料待確認</b>
      ${pending.length ? `<div>${pending.length} 張保單尚未補齊詳細資料：${pending.map((c) => esc(c.policy_no || "（未填號碼）")).join("、")}</div>` : ""}
      ${noKb.length ? `<div>${noKb.length} 個商品尚未建入知識庫（不列入保障數值）：${noKb.map((c) => esc(contractLabel(c))).join("、")}</div>` : ""}
    </section>` : ""}

    <section class="card">
      <h2 class="ck-h2">保單目錄</h2>
      ${Object.entries(byPolicy).map(([no, list]) => {
        const m = list[0];
        return `<div class="ck-policy">
          <div class="ck-policy-head"><b>${esc(no)}</b><span>${esc(m.company)}・${esc(m.pay_mode)}・生效 ${fmtDate(m.effective)}${m.applicant && m.applicant !== insured.name ? "・要保人 " + esc(m.applicant) : ""}${m.discount ? `・折扣 ${m.discount}%` : ""}</span>
            <a href="policy.html?id=${encodeURIComponent(m.holderId)}&i=${m.policyIndex}">修改</a></div>
          <div class="ck-scroll"><table class="ck-table"><thead><tr><th></th><th>商品</th><th>繳費年期</th><th>保障期間</th><th>保額</th><th class="num">保費</th></tr></thead>
          <tbody>${list.map(contractRow).join("")}</tbody></table></div></div>`;
      }).join("") || `<p class="ck-empty">沒有以 ${esc(insured.name)} 為被保人的保單</p>`}
      <div class="ck-premium">
        <span>今年總繳（年繳化、已扣折扣）<b>${money(premium.thisYear)}</b></span>
        <span>保障 <b>${money(premium.protection)}</b></span>
        <span>理財 <b>${money(premium.wealth)}</b></span>
        <span>明年預計 <b>${money(premium.nextYear)}</b>（${diff === 0 ? "+0" : (diff > 0 ? "+" : "−") + money(Math.abs(diff))}）</span>
      </div>
      ${premium.unknownNext.length ? `<p class="ck-cond warn">含 ${premium.unknownNext.length} 個依年齡逐年調整保費的商品，明年金額暫以今年計算。</p>` : ""}
    </section>

    <section class="card">
      <h2 class="ck-h2">保障旅圖（人生責任＋醫療前中後）</h2>
      <div class="ck-phases">${phaseBlocks}</div>
    </section>

    <section class="card">
      <h2 class="ck-h2">當年度保障數值 <small>點一下可看來源保單與條件</small></h2>
      ${domainBlocks || `<p class="ck-empty">沒有可計算的保障（商品需先建入保單知識庫）</p>`}
    </section>

    <section class="card">
      <h2 class="ck-h2">保障時間軸 <small>未來的重要節點</small></h2>
      ${events.length ? `<ol class="ck-events">${events.map((e) => `<li class="ck-ev-${e.kind}"><b>${fmtDate(e.date)}</b><span>${e.age} 歲</span><div>${esc(e.text)}</div></li>`).join("")}</ol>` : `<p class="ck-empty">沒有未來節點</p>`}
    </section>

    <section class="card">
      <h2 class="ck-h2">條款重點與權益提醒</h2>
      ${notes.length ? `<ul class="ck-notes">${notes.map((n) => `<li><b>${esc(n.product.code)}</b> ${esc(n.text)}${n.clause ? `<i>${esc(n.clause)}</i>` : ""}</li>`).join("")}</ul>` : `<p class="ck-empty">—</p>`}
    </section>

    <p class="ck-disclaimer">本頁數值依保單知識庫所建條款與費率計算，僅供說明參考，非理賠承諾；實際給付以保險契約條款及保險公司核定為準。</p>
  `;
}
