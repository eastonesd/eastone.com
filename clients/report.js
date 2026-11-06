// ============================================================
// 東石｜人生保障全景報告（A4 直式，可下載 PDF 或直接列印）
// 網址：report.html?id=<被保人的客戶ID>
// 依顧問規格的 12 頁核心敘事排版；有理財保單時，在第 3 頁後多一頁「理財保單」。
// 所有數字都來自 kbCompute（同一份計算結果），不另外計算。
// ============================================================
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => Math.round(Number(n) || 0).toLocaleString();
const AGENT_KEY = "eastone.policy.agent";

// 保障六大領域（第 4 頁）與每個給付項目的歸屬
const ATLAS = [
  { key: "duty", name: "人生責任", desc: "身故與家庭責任", items: ["death", "tpd", "funeral", "acc_death", "cancer_death"] },
  { key: "medical", name: "醫療", desc: "住院、雜費、手術、門診", items: ["hosp_daily", "hosp_nursing", "surgery_nursing", "post_discharge", "surgery_in", "surgery_out", "elderly_hosp", "room_limit", "misc_limit", "reimb_surgery_in", "reimb_surgery_out", "acc_reimb", "acc_hosp"] },
  { key: "critical", name: "重大疾病", desc: "癌症、重大傷病、特定疾病", items: ["cancer_major", "cancer_minor", "cancer_hosp", "cancer_post", "cancer_outpatient", "cancer_chemo", "cancer_radio", "cancer_surgery", "cancer_surgery_out", "cancer_target", "cancer_care", "cancer_reimb_in", "cancer_reimb_out", "major_injury", "critical_illness", "specific_lump", "specific_monthly", "specific_yearly"] },
  { key: "accident", name: "意外", desc: "意外身故、傷害與失能", items: ["acc_death", "acc_disability", "acc_reimb", "acc_hosp"] },
  { key: "income", name: "收入中斷", desc: "失能及定期生活給付", items: ["tpd", "acc_disability", "dis_lump", "dis_monthly", "dis_yearly"] },
  { key: "ltc", name: "長期照顧", desc: "一次金、月給付及年給付", items: ["ltc_lump", "ltc_monthly", "ltc_yearly"] },
];
// 保費配置（第 3 頁）：商品類別 → 分類
const PREMIUM_GROUPS = [
  { key: "life", name: "壽險與責任", color: "#1B2A4A", cats: ["壽險"] },
  { key: "medical", name: "醫療", color: "#3E6FA8", cats: ["醫療", "實支實付"] },
  { key: "critical", name: "重大疾病", color: "#B8892B", cats: ["重大傷病", "癌症"] },
  { key: "accident", name: "意外", color: "#6E8FB5", cats: ["意外"] },
  { key: "ltc", name: "失能長照", color: "#8C6A2A", cats: ["失能扶助", "長期照顧"] },
  { key: "wealth", name: "理財", color: "#C9B27A", cats: [] },
  { key: "other", name: "複合／未拆分", color: "#B7B2A6", cats: [] },
];

let RES = null, INSURED = null;

document.addEventListener("DOMContentLoaded", async () => {
  await requireLogin("../");
  const id = (new URLSearchParams(location.search).get("id") || "").toUpperCase();
  $("rp-back").href = `checkup.html?id=${encodeURIComponent(id)}`;
  let agent = {};
  try { agent = JSON.parse(localStorage.getItem(AGENT_KEY) || "{}"); } catch { /* 沒存過 */ }
  try {
    const [all, , fx] = await Promise.all([clientList(), KB.load(), kbFetchFx()]);
    INSURED = all.find((c) => c.id === id);
    if (!INSURED) { $("rp-pages").innerHTML = `<p class="rp-loading">查無此客戶</p>`; return; }
    RES = kbCompute({ allClients: all, insured: INSURED, fx });
    // 業務員：先用這台裝置上次填的服務人員，沒有就用這位客戶最近一張保單上的服務人員
    if (!agent.name) {
      const withAgent = RES.contracts.filter((c) => !c.pending).map((c) => all.find((x) => x.id === c.holderId).policies[c.policyIndex].life.agent).find((a) => a && a.name);
      if (withAgent) agent = withAgent;
    }
    $("rp-agent-name").value = agent.name || "";
    $("rp-agent-contact").value = agent.contact || "";
    render();
    ["rp-agent-name", "rp-agent-contact"].forEach((k) => $(k).addEventListener("input", () => {
      document.querySelectorAll(".rp-agent-name").forEach((e) => (e.textContent = $("rp-agent-name").value || "—"));
      document.querySelectorAll(".rp-agent-contact").forEach((e) => (e.textContent = $("rp-agent-contact").value || "—"));
    }));
    $("rp-print").disabled = false;
    $("rp-print").addEventListener("click", printReport);
    fitScreen();
    window.addEventListener("resize", fitScreen);
  } catch (err) {
    $("rp-pages").innerHTML = `<p class="rp-loading">報告產生失敗：${esc(err.message || err)}</p>`;
  }
});

function printReport() {
  try { localStorage.setItem(AGENT_KEY, JSON.stringify({ ...JSON.parse(localStorage.getItem(AGENT_KEY) || "{}"), name: $("rp-agent-name").value.trim(), contact: $("rp-agent-contact").value.trim() })); } catch { /* 記不住也沒關係 */ }
  // 存 PDF 時的預設檔名
  const old = document.title;
  document.title = `東石人生保障全景報告_${INSURED.name}_${RES.asOf}`;
  window.print();
  setTimeout(() => (document.title = old), 1000);
}

// 手機上把 A4 頁面縮到螢幕寬度
function fitScreen() {
  const w = Math.min(window.innerWidth - 16, 794);
  document.documentElement.style.setProperty("--rp-scale", (w / 794).toFixed(4));
}

// ---------------- 共用小工具 ----------------
const val = (code) => RES.values[code];
function valueText(v) {
  if (!v) return "—";
  if (v.item.pay_type === "flag") return "有";
  const range = v.hasLow && v.low !== v.total ? `${money(v.low)}～${money(v.total)}` : money(v.total);
  return `${v.min ? "至少 " : ""}${range}`;
}
function unitText(v) { return v && v.item.pay_type !== "flag" ? v.item.unit_label : ""; }
function sources(v) {
  return [...new Set(v.rows.map((r) => `${r.ct.code}`))].join("、");
}
function conds(v) {
  const list = [...new Set(v.rows.map((r) => [r.cond, r.max_times].filter(Boolean).join("；")).filter(Boolean))];
  return list.join("／");
}
function honorific(c) { return c.gender === "女" ? "女士" : c.gender === "男" ? "先生" : ""; }
function mask(no) { return String(no || ""); }

let pageNo = 0;
function page(num, eyebrow, title, need, body, opts = {}) {
  pageNo += 1;
  return `<section class="page${opts.cls ? " " + opts.cls : ""}">
    <header class="pg-head"><span>EAST STONE｜人生保障全景報告</span><span>${esc(INSURED.name)}　${fmtDate(RES.asOf)}</span></header>
    <div class="pg-title">
      <div class="pg-num">${num}</div>
      <div><div class="pg-eyebrow">${eyebrow}</div><h2>${title}</h2></div>
    </div>
    ${need ? `<div class="pg-need">${need}</div>` : ""}
    <div class="pg-body">${body}</div>
    <footer class="pg-foot"><span>本報告依已提供之保單資料整理，僅供說明參考，非理賠承諾；實際給付以保險契約條款及保險公司核定為準。</span><span>${pageNo}</span></footer>
  </section>`;
}

function valueCard(code, opts = {}) {
  const v = val(code);
  const item = v ? v.item : KB.item(code);
  if (!item) return "";
  return `<div class="vc${v ? "" : " empty"}">
    <div class="vc-name">${esc(opts.label || item.name)}</div>
    <div class="vc-val">${v ? valueText(v) : "—"}<small>${v ? esc(unitText(v)) : ""}</small></div>
    ${v ? `<div class="vc-src">來源 ${esc(sources(v))}${conds(v) ? "｜" + esc(conds(v)) : ""}</div>` : `<div class="vc-src">目前沒有對應保障</div>`}
    ${v && v.item.pay_type === "limit" && v.rows.length > 1 ? `<div class="vc-warn">多張限額合計，實際依理賠協調</div>` : ""}
  </div>`;
}
function phaseCards(phase, extraFilter) {
  const list = Object.values(RES.values).filter((v) => v.item.phase === phase && v.item.pay_type !== "flag" && (!extraFilter || extraFilter(v)))
    .sort((a, b) => a.item.sort - b.item.sort);
  return list.length ? `<div class="vc-grid">${list.map((v) => valueCard(v.item.code)).join("")}</div>`
    : `<div class="rp-empty">目前已建檔的保單中，沒有這個階段的對應保障${RES.contracts.some((c) => c.pending || !c.product) ? "（尚有保單資料待確認）" : ""}。</div>`;
}

// ---------------- 各頁 ----------------
function render() {
  pageNo = 0;
  const { contracts, premium } = RES;
  const ok = contracts.filter((c) => !c.pending);
  const pending = contracts.filter((c) => c.pending);
  const noKb = ok.filter((c) => !c.product);
  const policies = [...new Set(ok.filter((c) => c.covered || c.paying).map((c) => c.policy_no))];
  const lit = ATLAS.filter((a) => a.items.some((code) => val(code)));
  const wealth = ok.filter((c) => c.nature === "wealth");
  const age = kbInsuranceAge(INSURED.birthday, RES.asOf);
  const reportId = `ES-${RES.asOf.replace(/-/g, "")}-${String(Date.now()).slice(-4)}`;
  const fxLine = RES.foreign.length ? `外幣以 ${RES.foreign.map((f) => f.rate ? `${f.currency}/TWD ${f.rate.toFixed(3)}` : `${f.currency}（未換算）`).join("、")} 換算新臺幣。` : "";

  // P1 封面
  const cover = `<section class="page cover">
    <div class="cv-top">
      <div class="cv-brand"><img src="../icons/logo.png" alt=""><div><b>東石系統</b><span>EASTONE SYSTEM</span></div></div>
      <div class="cv-eyebrow">LIFE PROTECTION OVERVIEW</div>
      <h1>人生保障全景報告</h1>
      <p class="cv-motto">先看懂已經擁有什麼，再討論真正需要什麼。</p>
      <div class="cv-client">${esc(INSURED.name)} <small>${honorific(INSURED)}</small></div>
      <div class="cv-meta">健診日期 ${fmtDate(RES.asOf)}　資料基準日 ${fmtDate(RES.asOf)}　報告編號 ${reportId}</div>
    </div>
    <div class="cv-body">
      <div class="cv-kpis">
        <div><span>有效保單</span><b>${policies.length}</b><em>張</em></div>
        <div><span>目前年繳化保費</span><b>${money(premium.thisYear)}</b><em>元</em></div>
        <div><span>已辨識保障領域</span><b>${lit.length}</b><em>／6</em></div>
        <div><span>資料完整度</span><b>${ok.length - noKb.length}</b><em>項已確認${pending.length + noKb.length ? `，${pending.length + noKb.length} 項待核對` : ""}</em></div>
      </div>
      <div class="cv-say">「這份報告盤點了您目前提供的保單；我們先看現況，再談需求。」</div>
      <div class="cv-contents">
        <div><b>01</b> 保單與保費</div><div><b>02</b> 保障與權益</div><div><b>03</b> 需求與行動</div>
      </div>
      <div class="cv-agent"><div><span>服務業務員</span><b class="rp-agent-name">${esc($("rp-agent-name").value || "—")}</b></div>
        <div><span>聯絡方式</span><b class="rp-agent-contact">${esc($("rp-agent-contact").value || "—")}</b></div></div>
      <p class="cv-note">本報告依客戶提供之保單資料整理，數字僅供說明參考，非理賠承諾。${esc(fxLine)}</p>
    </div>
  </section>`;
  pageNo = 1;

  // P2 保單目錄與繳費總覽
  const byPolicy = {};
  ok.forEach((c) => (byPolicy[c.policy_no] = byPolicy[c.policy_no] || []).push(c));
  const paidUp = ok.filter((c) => c.kind === "main" && c.covered && !c.paying).length;
  const p2 = page("02", "POLICY INVENTORY", "保單目錄與繳費總覽", "我有哪些保單？主附約怎麼組成？目前每年繳多少？", `
    <table class="rp-table">
      <thead><tr><th>保險公司／保單號碼</th><th>主約・附約</th><th>保額</th><th>繳費／保障期間</th><th class="num">保費</th></tr></thead>
      <tbody>${Object.entries(byPolicy).map(([no, list]) => list.map((c, i) => `<tr class="${c.kind === "rider" ? "rider" : "main"}${c.covered ? "" : " off"}">
        <td>${i === 0 ? `<b>${esc(c.company || "—")}</b><div class="sub">${esc(mask(no))}・${esc(c.pay_mode)}・生效 ${fmtDate(c.effective)}${c.applicant && c.applicant !== INSURED.name ? `・要保人 ${esc(c.applicant)}` : ""}</div>` : ""}</td>
        <td>${c.kind === "rider" ? "↳ " : ""}<b>${esc(c.code || "")}</b> ${esc(c.name || "")}<div class="sub">${c.nature === "wealth" ? "理財" : "保障"}${c.status && c.status !== "正常" ? "・" + esc(c.status) : ""}${c.product ? "" : "・<span class='warn'>未建檔</span>"}</div></td>
        <td>${c.sa !== "" && c.sa != null ? esc(c.sa) + esc(c.saUnit || "") + (c.currency !== "TWD" ? " " + esc(c.currency) : "") : "—"}</td>
        <td>${esc(c.term || "—")}／${esc(c.coverageText || "—")}</td>
        <td class="num">${c.currency !== "TWD" ? esc(c.currency) + " " : ""}${money(c.premium)}</td></tr>`).join("")).join("")
        || `<tr><td colspan="5" class="rp-empty">沒有以 ${esc(INSURED.name)} 為被保人的保單</td></tr>`}</tbody>
    </table>
    ${pending.length ? `<div class="rp-pending">待補詳細資料：${pending.map((c) => esc(c.policy_no || "（未填號碼）") + " " + esc(c.code || "")).join("、")}</div>` : ""}
    <div class="rp-sum">
      <div><span>目前年繳化保費</span><b>${money(premium.thisYear)}</b></div>
      <div><span>明年預計總繳</span><b>${money(premium.nextYear)}</b><em>${premium.nextYear - premium.thisYear === 0 ? "今年 +0" : `今年 ${premium.nextYear > premium.thisYear ? "+" : "−"}${money(Math.abs(premium.nextYear - premium.thisYear))}`}</em></div>
      <div><span>已繳清保單</span><b>${paidUp}</b><em>張</em></div>
    </div>
    <p class="rp-note">年繳化保費＝每期保費 × 每年期數（月繳 ×12、季繳 ×4、半年繳 ×2），已扣保費折扣；外幣換算新臺幣。${esc(fxLine)}</p>`);

  // P3 保費配置分析
  const groups = Object.fromEntries(PREMIUM_GROUPS.map((g) => [g.key, { ...g, sum: 0, items: [] }]));
  ok.filter((c) => c.paying).forEach((c) => {
    const yr = c.annualPremium * (1 - (c.discount || 0) / 100) * (c.fxRate ?? 1);
    let key = "other";
    if (c.nature === "wealth") key = "wealth";
    else {
      const cat = (c.product && c.product.category) || c.cat1 || "";
      const g = PREMIUM_GROUPS.find((x) => x.cats.includes(cat));
      if (g) key = g.key;
    }
    groups[key].sum += yr;
    groups[key].items.push({ c, yr });
  });
  const total = Object.values(groups).reduce((s, g) => s + g.sum, 0) || 1;
  const usedGroups = Object.values(groups).filter((g) => g.sum > 0);
  const top = ok.filter((c) => c.paying).map((c) => ({ c, yr: c.annualPremium * (1 - (c.discount || 0) / 100) * (c.fxRate ?? 1) })).sort((a, b) => b.yr - a.yr).slice(0, 5);
  const p3 = page("03", "PREMIUM ALLOCATION", "保費配置分析", "讓您知道保費投入在哪些保障與商品，這一頁不評判分配好壞。", `
    <div class="alloc-total">年度保費配置　合計 <b>${money(premium.thisYear)}</b> 元　<span>保障 ${money(premium.protection)}　理財 ${money(premium.wealth)}</span></div>
    <div class="alloc-bar">${usedGroups.map((g) => `<i style="width:${(g.sum / total * 100).toFixed(2)}%;background:${g.color}"></i>`).join("")}</div>
    <div class="cols2">
      <table class="rp-table small"><thead><tr><th>分類</th><th class="num">年繳化保費</th><th class="num">占比</th></tr></thead>
        <tbody>${usedGroups.map((g) => `<tr><td><i class="dot" style="background:${g.color}"></i>${g.name}</td><td class="num">${money(g.sum)}</td><td class="num">${(g.sum / total * 100).toFixed(1)}%</td></tr>`).join("") || `<tr><td colspan="3" class="rp-empty">目前沒有繳費中的保單</td></tr>`}
        <tr class="total"><td>合計</td><td class="num">${money(total === 1 ? 0 : total)}</td><td class="num">100%</td></tr></tbody></table>
      <table class="rp-table small"><thead><tr><th>保費較高的主約／附約</th><th class="num">年繳化</th></tr></thead>
        <tbody>${top.map((t) => `<tr><td><b>${esc(t.c.code)}</b> ${esc(t.c.name)}<div class="sub">${t.c.product && t.c.product.rate_mode === "attained" ? "依年齡逐年調整" : "平準保費"}・${esc(t.c.term || "")}</div></td><td class="num">${money(t.yr)}</td></tr>`).join("")}</tbody></table>
    </div>
    <p class="rp-note">分類依商品類別歸屬；一張商品含多重保障時不另行拆分保費。「理財」包含儲蓄、分紅、利變、年金、投資型等商品。本頁只呈現支出結構，不以保費比例推論需求缺口。</p>`);

  // 理財保單（有才出現）
  const pWealth = wealth.length ? page("03+", "WEALTH POLICIES", "理財保單", "保障以外，為未來準備的資金在哪裡。", `
    <table class="rp-table">
      <thead><tr><th>商品</th><th>幣別</th><th class="num">年繳保費</th><th>繳費進度</th><th class="num">累積已繳（估）</th><th>利率</th></tr></thead>
      <tbody>${wealth.map((c) => {
        const paid = c.annualStd * c.paidYears * (1 - (c.discount || 0) / 100);
        const dr = c.product && (c.product.declared || [])[0];
        return `<tr><td><b>${esc(c.code)}</b> ${esc(c.name)}<div class="sub">${esc(c.policy_no)}・生效 ${fmtDate(c.effective)}</div></td><td>${esc(c.currency)}</td>
          <td class="num">${money(c.annualStd)}</td><td>第 ${c.paidYears}／${c.payYears ?? "—"} 年</td><td class="num">${money(paid)}${c.currency !== "TWD" && c.fxRate ? `<div class="sub">≈ ${money(paid * c.fxRate)} 元</div>` : ""}</td>
          <td>${c.product && c.product.assumed_rate != null ? `預定 ${c.product.assumed_rate}%` : ""}${dr ? `<div class="sub">宣告 ${dr.rate}%（${String(dr.month).slice(0, 7)}）</div>` : ""}</td></tr>`;
      }).join("")}</tbody></table>
    ${(() => {
      const ev = RES.events.filter((e) => wealth.includes(e.ct));
      return ev.length ? `<h3>領取與重要節點</h3><ul class="rp-list">${ev.map((e) => `<li><b>${fmtDate(e.date)}（${e.age} 歲）</b>${esc(e.text)}</li>`).join("")}</ul>` : "";
    })()}
    <p class="rp-note">累積已繳為依年繳保費 × 已繳年數估算；分紅保單紅利非保證給付，宣告利率每月變動。保單價值準備金、帳戶價值請以保險公司週年報告為準。</p>`) : "";

  // P4 保障全景地圖
  const pendingAny = pending.length || noKb.length;
  const seg = (i, n, on) => {
    const a0 = (i / n) * 2 * Math.PI - Math.PI / 2, a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
    const R = 92, r = 52, cx = 100, cy = 100, p = (a, rad) => `${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`;
    const am = (a0 + a1) / 2, [tx, ty] = p(am, 72).split(",");
    return `<path d="M${p(a0 + 0.02, R)} A${R},${R} 0 0 1 ${p(a1 - 0.02, R)} L${p(a1 - 0.02, r)} A${r},${r} 0 0 0 ${p(a0 + 0.02, r)} Z" fill="${on ? "#1B2A4A" : "#E7E2D6"}"/>
      <text x="${tx}" y="${(Number(ty) + 3).toFixed(2)}" text-anchor="middle" class="wh-l${on ? " on" : ""}">${ATLAS[i].name}</text>`;
  };
  const p4 = page("04", "COVERAGE ATLAS", "保障全景地圖", "先看哪些風險領域已有對應保單；亮燈不是理賠保證，也不是保障充足評分。", `
    <div class="atlas">
      <svg viewBox="0 0 200 200" class="wheel">${ATLAS.map((a, i) => seg(i, ATLAS.length, lit.includes(a))).join("")}
        <circle cx="100" cy="100" r="46" fill="#FFFDF8"/><text x="100" y="96" text-anchor="middle" class="wh-n">${lit.length}/6</text><text x="100" y="114" text-anchor="middle" class="wh-t">已辨識領域</text></svg>
      <div class="atlas-cards">${ATLAS.map((a) => {
        const on = lit.includes(a);
        const vs = a.items.map(val).filter(Boolean).filter((v) => v.item.pay_type !== "flag").slice(0, 3);
        const state = on ? "已辨識保障" : pendingAny ? "資料待確認" : "未找到對應保障";
        return `<div class="ac ${on ? "on" : pendingAny ? "wait" : "off"}"><div class="ac-h"><b>${a.name}</b><span>${on ? "●" : pendingAny ? "◐" : "○"} ${state}</span></div>
          <div class="ac-d">${a.desc}</div>${vs.map((v) => `<div class="ac-v"><span>${esc(v.item.name)}</span><b>${valueText(v)}</b></div>`).join("")}</div>`;
      }).join("")}</div>
    </div>
    <p class="rp-note">● 已辨識保障：至少一張有效保單有對應給付。◐ 資料待確認：尚有保單未補齊資料或商品未建檔。○ 未找到對應保障：目前提供的保單中沒有對應給付。本頁不輸出充足／不足評級。</p>`);

  // P5 人生責任
  const p5 = page("05", "LIFE & RESPONSIBILITY", "人生責任保障", "人生責任不只關於住院，更關乎家庭在風險發生後的生活安排。", `
    <h3>身故保障</h3><div class="vc-grid">${["death", "acc_death", "cancer_death", "funeral"].filter((c) => val(c) || c === "death").map((c) => valueCard(c)).join("")}</div>
    <h3>失能／收入中斷</h3><div class="vc-grid">${["tpd", "acc_disability", "dis_lump", "dis_monthly", "dis_yearly"].map((c) => valueCard(c)).join("")}</div>
    <h3>長期照顧</h3><div class="vc-grid">${["ltc_lump", "ltc_monthly", "ltc_yearly"].map((c) => valueCard(c)).join("")}</div>
    <p class="rp-note">不同觸發事故、給付條件或年期的金額，不能無條件加總成「總保障」。「至少」表示條款為多項取大，實際給付可能較高。</p>`);

  // P6–P8 醫療前中後
  const p6 = page("06", "MEDICAL / BEFORE", "醫療前期｜診斷與確診", "先了解確診後可能有哪些一次性資金，再看後續治療期間的費用安排。", phaseCards("before") + `<p class="rp-note">不同保單對「癌症」「重大疾病」的認定條件不一定相同；本頁不預測特定診斷一定理賠。</p>`);
  const p7 = page("07", "MEDICAL / DURING", "醫療中期｜住院與治療", "這一頁不是告訴您所有保額加起來多少，而是說明不同費用可能由哪些保單支援。", phaseCards("during") + `<p class="rp-note">實支實付的多張限額不代表單次事故必然可領取總和；同一筆醫療費用在不同保單之間的給付需依條款判定。每日、每次、每年度的單位請留意。</p>`);
  const p8 = page("08", "MEDICAL / AFTER", "醫療後期｜康復與照護", "治療告一段落後，還有哪些支出可能受到契約保障？", phaseCards("after") + `<p class="rp-note">同一治療可能觸發多項給付，也可能有擇一或限額條件；不是所有商品都涵蓋出院後療養。</p>`);

  // P9 時間軸
  const live = ok.filter((c) => c.issueAge != null && !["失效", "解約"].includes(c.status));
  const startAge = age ?? 0;
  const endAge = Math.min(110, Math.max(startAge + 10, ...live.map((c) => (c.coverEnd != null && c.coverEnd < 900 ? c.coverEnd : 110))));
  const X = (a) => Math.max(0, Math.min(100, ((a - startAge) / Math.max(1, endAge - startAge)) * 100));
  const ticks = []; for (let a = Math.ceil(startAge / 10) * 10; a <= endAge; a += 10) if (X(a) > 8) ticks.push(a);
  const p9 = page("09", "PROTECTION TIMELINE", "保障年齡時間軸", "保單不只看今天的保障，也要知道它何時可能改變或終止。", `
    <div class="tl">
      <div class="tl-axis">${ticks.map((a) => `<span style="left:${X(a)}%">${a} 歲</span>`).join("")}<span class="now" style="left:0%">現在 ${startAge}</span></div>
      ${live.map((c) => {
        const ce = c.coverEnd != null && c.coverEnd < 900 ? c.coverEnd : 110;
        const pe = c.payYears != null && c.payYears < 900 ? c.issueAge + c.payYears : null;
        return `<div class="tl-row"><div class="tl-name"><b>${esc(c.code)}</b> ${esc(c.name)}</div>
          <div class="tl-track"><div class="tl-cover" style="left:0;width:${X(ce)}%"></div>${pe && pe > startAge ? `<div class="tl-pay" style="left:0;width:${X(pe)}%"></div>` : ""}
          <span class="tl-end" style="left:${X(ce)}%">${c.coverEnd >= 900 ? "終身" : ce + " 歲"}</span></div></div>`;
      }).join("") || `<div class="rp-empty">沒有可呈現的保單</div>`}
      <div class="tl-legend"><span><i class="c"></i>保障期間</span><span><i class="p"></i>繳費期間</span></div>
    </div>
    <h3>未來重要節點</h3>
    <ul class="rp-list">${RES.events.slice(0, 14).map((e) => `<li><b>${fmtDate(e.date)}（${e.age} 歲）</b>${esc(e.text)}</li>`).join("") || "<li>—</li>"}</ul>
    <p class="rp-note">保障期間與繳費期間分開呈現：繳費期滿不代表保障終止。年齡為保險年齡；終身、定期與一年期續保商品型態不同。</p>`);

  // P10 條款重點
  const byProd = {};
  RES.notes.forEach((n) => (byProd[n.product.code] = byProd[n.product.code] || { p: n.product, list: [] }).list.push(n));
  const p10 = page("10", "RIGHTS & CONDITIONS", "條款重點與保單權益提醒", "不需要閱讀整份條款，我把真正可能影響權益的地方講清楚。", `
    ${Object.values(byProd).map(({ p, list }) => `<div class="rc"><div class="rc-h"><b>${esc(p.code)}</b> ${esc(p.name)}</div>
      <ul>${list.map((n) => `<li>${esc(n.text)}${n.clause ? `<i>${esc(n.clause)}</i>` : ""}</li>`).join("")}</ul></div>`).join("") || `<div class="rp-empty">尚無可提醒的條款重點</div>`}
    ${noKb.length || pending.length ? `<div class="rp-pending">仍待業務員確認：${[...pending.map((c) => (c.policy_no || "") + " 詳細資料"), ...noKb.map((c) => c.code + " 條款")].map(esc).join("、")}</div>` : ""}`);

  // P11 需求與缺口（現場討論用，可直接點欄位填寫）
  const p11 = page("11", "NEEDS & GAP ANALYSIS", "客戶需求與保障缺口", "有沒有缺口，不由市場平均決定，而由您的生活責任和選擇決定。", `
    <table class="rp-table needs"><thead><tr><th>保障領域</th><th>現有保障（事實）</th><th>客戶需求目標（共同確認）</th><th>差異與待討論</th></tr></thead>
      <tbody>${ATLAS.map((a) => {
        const vs = a.items.map(val).filter(Boolean).filter((v) => v.item.pay_type !== "flag").slice(0, 2);
        return `<tr><td><b>${a.name}</b></td><td>${vs.map((v) => `${esc(v.item.name)} ${valueText(v)}`).join("<br>") || "—"}</td>
          <td contenteditable="true" class="fill"></td><td contenteditable="true" class="fill"></td></tr>`;
      }).join("")}</tbody></table>
    <div class="fill-box"><b>家庭與財務現況</b>（扶養責任、收入、負債、預算、風險偏好）<div contenteditable="true" class="fill area"></div></div>
    <p class="rp-note">保障盤點是事實層；需求與缺口依雙方確認的假設判斷，兩者不混在一起。本頁是共同討論工具，不直接輸出應購買某商品的結論。</p>`);

  // P12 結論與下一步
  const keep = lit.map((a) => a.name);
  const confirm = [...pending.map((c) => `補齊 ${c.policy_no || ""} 保單詳細資料`), ...noKb.map((c) => `核對 ${c.code} ${c.name || ""} 條款`),
    ...RES.foreign.filter((f) => !f.rate).map((f) => `${f.currency} 匯率`)];
  const p12 = page("12", "CONCLUSION & ACTIONS", "健診結論與下一步", "哪些保障值得維持、哪些問題要確認、哪些需求值得後續討論？", `
    <div class="cols3">
      <div class="concl keep"><h4>維持的權益</h4><ul>${keep.map((k) => `<li>${k}保障</li>`).join("")}</ul><div contenteditable="true" class="fill area sm"></div></div>
      <div class="concl check"><h4>待確認的資料</h4><ul>${confirm.map((k) => `<li>${esc(k)}</li>`).join("") || "<li>目前無</li>"}</ul><div contenteditable="true" class="fill area sm"></div></div>
      <div class="concl next"><h4>優先討論的需求</h4><div contenteditable="true" class="fill area"></div></div>
    </div>
    <h3>共同確認的待辦事項</h3>
    <table class="rp-table todo"><thead><tr><th>事項</th><th>負責人</th><th>期限</th><th>狀態</th></tr></thead>
      <tbody>${[1, 2, 3, 4].map(() => `<tr><td contenteditable="true" class="fill"></td><td contenteditable="true" class="fill"></td><td contenteditable="true" class="fill"></td><td contenteditable="true" class="fill"></td></tr>`).join("")}</tbody></table>
    <div class="sign"><div>客戶簽名<span></span></div><div>業務員 <b class="rp-agent-name">${esc($("rp-agent-name").value || "—")}</b><span></span></div></div>
    <p class="rp-note">不因缺口指標自動建議解約或替換既有保單；涉及舊保單轉換時，應評估重新核保、等待期間、既有權益與成本。資料基準日 ${fmtDate(RES.asOf)}；本報告非理賠承諾。</p>`);

  $("rp-pages").innerHTML = cover + p2 + p3 + pWealth + p4 + p5 + p6 + p7 + p8 + p9 + p10 + p11 + p12;
}
