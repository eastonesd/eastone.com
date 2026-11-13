// ============================================================
// 新增／修改保單（一頁完成）
// 網址：policy.html?id=<客戶ID>[&i=<第幾張保單，從 0 開始>]
// 保單存在客戶資料的 policies 陣列裡：
//   原本的摘要欄位（policy_no、main_code、main_name、currency、total_premium）照舊，
//   詳細內容放在 life 物件，客戶卡片上的「保單號碼總表」仍然看得到。
// ============================================================

const COMPANIES = [
  "富邦人壽", "國泰人壽", "南山人壽", "新光人壽", "台灣人壽", "中國人壽", "凱基人壽", "全球人壽",
  "遠雄人壽", "三商美邦人壽", "安聯人壽", "台銀人壽", "宏泰人壽", "元大人壽", "保誠人壽", "第一金人壽",
  "合作金庫人壽", "法國巴黎人壽", "安達人壽", "友邦人壽", "康健人壽", "保德信人壽", "中華郵政", "其他",
];
// 類別清單（主約、附約各一套）、年期選項與拆分規則在 db.js：CAT_LISTS、TERM_OPTIONS、splitCategory()
// 代號表沒有類別時，依險種名稱出現的字猜主要類別（可以再手動改）
const CAT_KEYWORDS = [
  ["重疾", "重大疾病"], ["重傷", "重大傷病"], ["特傷", "特定傷病"], ["長照", "長照"], ["失智", "長照"], ["失能", "長照"],
  ["實支", "實支醫療"], ["醫療", "定額醫療"], ["防癌", "防癌"], ["癌", "防癌"], ["意外", "意外"],
  ["利變", "利變"], ["分紅", "分紅"], ["還本", "還本壽險"], ["增額", "增額壽險"], ["壽險", "壽險"], ["豁免", "豁免"],
];
const SA_UNITS = ["萬", "元", "單位", "計劃", "附加"];
const BANKS = [
  "004 臺灣銀行", "005 土地銀行", "006 合作金庫", "007 第一銀行", "008 華南銀行", "009 彰化銀行",
  "011 上海商銀", "012 台北富邦", "013 國泰世華", "016 高雄銀行", "017 兆豐銀行", "048 王道銀行",
  "050 臺灣企銀", "052 渣打銀行", "053 台中銀行", "054 京城銀行", "081 匯豐銀行", "101 瑞興銀行",
  "102 華泰銀行", "103 新光銀行", "108 陽信銀行", "118 板信銀行", "147 三信銀行", "700 中華郵政",
  "803 聯邦銀行", "805 遠東商銀", "806 元大銀行", "807 永豐銀行", "808 玉山銀行", "809 凱基銀行",
  "810 星展銀行", "812 台新銀行", "816 安泰銀行", "822 中國信託", "823 將來銀行", "824 連線銀行",
  "826 樂天銀行", "其他",
];
const AGENT_KEY = "eastone.policy.agent"; // 記住上次填的服務人員（只存在這台裝置）

let client = null;      // 目前這位客戶
let allClients = [];    // 這位業務員的所有客戶（要保人／被保人下拉用）
let codes = {};         // 保單代號 { CODE: 名稱 }
let codeKinds = {};     // { CODE: 'main' | 'rider' }
let codeCats = {};      // { CODE: { cat1, cat2 } }（代號表的險種類別）
let editIndex = null;   // null = 新增；數字 = 修改第幾張
let riders = [];        // 附約清單

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.hidden = true), 2400);
}

document.addEventListener("DOMContentLoaded", async () => {
  await requireLogin("../");
  const params = new URLSearchParams(location.search);
  const id = (params.get("id") || "").toUpperCase();
  if (!id) { location.href = "index.html"; return; }

  let rows;
  [client, allClients, rows] = await Promise.all([clientGet(id), clientList(), codeRows()]);
  rows.forEach((r) => { codes[r.code] = r.name; codeKinds[r.code] = r.kind; if (r.cat1) codeCats[r.code] = { cat1: r.cat1, cat2: r.cat2 }; });
  if (!client) { alert("查無此客戶"); location.href = "index.html"; return; }
  // 返回時直接打開這位客戶的資料卡
  document.querySelectorAll(".pf-back").forEach((a) => { a.href = `index.html#client=${encodeURIComponent(client.id)}`; a.textContent = "← 返回客戶資料卡"; });
  // 保單知識庫：讀不到（例如還沒建好）也不影響填表，只是不能自動帶入與試算
  try {
    await KB.load();
    KB.products.forEach((p) => {
      if (!codes[p.code]) codes[p.code] = p.name;
      if (!codeKinds[p.code]) codeKinds[p.code] = p.kind === "rider" ? "rider" : "main";
    });
  } catch (err) { console.warn("知識庫讀取失敗", err); }

  eraDateInput("pf-effective");
  eraDateInput("pf-r-effective");
  buildStaticOptions();
  bindForm();
  renderClient();

  const i = params.get("i");
  if (i !== null && client.policies && client.policies[+i]) loadPolicy(+i);
  else newPolicy();
});

// ---------------- 下拉選單 ----------------
function fillSelect(sel, items, selected) {
  sel.innerHTML = items.map((v) => {
    const [value, label] = Array.isArray(v) ? v : [v, v];
    return `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(label)}</option>`;
  }).join("");
}

function buildStaticOptions() {
  fillSelect($("pf-company"), COMPANIES, "富邦人壽");
  // 點選面板的選項來源（picker.js）
  PICK_SOURCES["main-cat"] = () => CAT_LISTS.main;
  PICK_SOURCES["rider-cat"] = () => CAT_LISTS.rider;
  PICK_SOURCES["main-term"] = () => isLifeCat($("pf-cat1").value.trim(), $("pf-cat2").value.trim())
    ? [{ label: "壽險類繳費年期", options: TERM_OPTIONS.life }]
    : [{ label: "主約繳費年期", options: TERM_OPTIONS.main }];
  PICK_SOURCES["cover"] = () => COVER_OPTIONS;
  PICK_SOURCES["rider-term"] = () => [{ label: "附約繳費年期", options: TERM_OPTIONS.rider }];
  PICK_SOURCES["bene-rel"] = () => BENE_RELATIONS;
  // 受益人：先列跟被保人同住址、同群組的客戶，其他客戶打字才列出
  PICK_SOURCES["bene"] = (input) => {
    const insured = personRecord($("pf-insured").value) || client;
    const hk = addressKey(insured);
    const used = new Set([insured.id]);
    const pick = (list) => list.filter((c) => c.name && !used.has(c.id)).map((c) => { used.add(c.id); return c.name; });
    const house = hk ? pick(allClients.filter((c) => addressKey(c) === hk)) : [];
    const myGroups = insured.groups || [];
    const group = myGroups.length ? pick(allClients.filter((c) => (c.groups || []).some((g) => myGroups.includes(g)))) : [];
    const kw = input.value.trim();
    const others = kw ? pick(allClients.filter((c) => (c.name || "").includes(kw))).slice(0, 30) : [];
    return [
      house.length && { label: `同住址・${addressText(insured)}`, options: house },
      group.length && { label: `同群組・${myGroups.join("、")}`, options: group },
      others.length && { label: `其他客戶（符合「${kw}」）`, options: others },
      !kw && { label: "其他客戶：直接打名字搜尋", options: [] },
    ].filter(Boolean);
  };
  document.querySelectorAll(".pf-bank-select").forEach((s) => fillSelect(s, [["", "請選擇銀行"], ...BANKS], ""));
  const y0 = new Date().getFullYear();
  // 跟卡片背面一樣顯示 MM / YY（年份存四碼西元）
  fillSelect($("pf-card-y"), [["", "YY"], ...Array.from({ length: 12 }, (_, k) => [String(y0 + k), String(y0 + k).slice(2)])], "");
  fillSelect($("pf-card-m"), [["", "MM"], ...Array.from({ length: 12 }, (_, k) => String(k + 1).padStart(2, "0"))], "");

  // 人員下拉：本人排第一，其他客戶在後面
  const others = allClients.filter((c) => c.id !== client.id).sort((a, b) => (a.name || "").localeCompare(b.name || "", "zh-Hant"));
  const people = [[client.id, `${client.name}（本人）`], ...others.map((c) => [c.id, `${c.name}（${c.id}）`])];
  document.querySelectorAll(".pf-person").forEach((s) => fillSelect(s, people, client.id));

  // 商品代號／名稱提示
  // 主約：同一商品的各版本整合成一個商品（IAT、IAT1、IAT2 → IAT）
  const mains = Object.entries(codes).filter(([c]) => codeKinds[c] !== "rider");
  const fams = mainFamilies();
  $("pf-code-list").innerHTML = [...fams.entries()].map(([f, list]) => `<option value="${esc(f)}">${esc(codes[list[list.length - 1]])}${list.length > 1 ? `（${list.length} 版）` : ""}</option>`).join("");
  $("pf-name-list").innerHTML = mains.map(([c, n]) => `<option value="${esc(n)}">${esc(c)}</option>`).join("");
  $("pf-rel-list").innerHTML = BENE_RELATIONS.map((n) => `<option value="${n}">`).join("");
  $("pf-bene-list").innerHTML = [...new Set(allClients.map((c) => c.name).filter(Boolean))].map((n) => `<option value="${esc(n)}">`).join("");
}

// ---------------- 主約：商品 → 版本 ----------------
function mainFamilies() {
  const fams = new Map();
  Object.keys(codes).filter((c) => codeKinds[c] !== "rider").sort().forEach((c) => {
    const f = codeFamily(c);
    if (!fams.has(f)) fams.set(f, []);
    fams.get(f).push(c);
  });
  return fams;
}

// 依商品欄填出版本選單；pick 指定要選哪一版，沒指定就選最新版
function fillVersions(typed, pick) {
  const sel = $("pf-main-ver");
  if (!typed) { sel.innerHTML = `<option value="">先選商品</option>`; return; }
  const fam = mainFamilies().get(typed) || mainFamilies().get(codeFamily(typed)) || [];
  const list = fam.length ? [...fam] : [typed];
  if (pick && !list.includes(pick)) list.push(pick);
  sel.innerHTML = list.map((c) => `<option value="${esc(c)}">${esc(c)}${codes[c] ? "　" + esc(codes[c]) : fam.length ? "" : "（代號庫沒有）"}</option>`).join("");
  // 打商品代號（IAT）→ 預設最新版；直接打完整版本代號（IAT1）→ 選那一版
  sel.value = pick || (!mainFamilies().has(typed) && list.includes(typed) ? typed : list[list.length - 1]);
}

// 主約代號不在保單資料庫：提示儲存時會自動建檔
function syncMainNew() {
  const c = $("pf-main-code").value.trim().toUpperCase();
  const isNew = !!c && !codes[c];
  $("pf-main-new").hidden = !isNew;
  $("pf-main-new").innerHTML = isNew ? `<b>${esc(c)}</b> 是新的主約代號：填好險種名稱與主要類別，儲存保單時會自動建進保單資料庫。` : "";
}

// 版本確定後：帶出名稱、類別、知識庫資料
function onMainCode() {
  const c = $("pf-main-ver").value;
  $("pf-main-code").value = c;
  syncMainNew();
  if (codes[c]) { $("pf-main-name").value = codes[c]; if (codeCats[c]) setCats(codeCats[c]); else guessCategory(codes[c]); }
  applyKbMain(true);
}

// 程式設定主約代號（讀取舊保單、用名稱反查）
function setMainCode(code) {
  const c = (code || "").toUpperCase();
  $("pf-main-code").value = c;
  const fam = c ? (mainFamilies().has(codeFamily(c)) ? codeFamily(c) : c) : "";
  $("pf-main-family").value = fam;
  fillVersions(fam, c || undefined);
  syncMainNew();
}

function personName(id) {
  const c = allClients.find((x) => x.id === id) || (id === client.id ? client : null);
  return c ? c.name : "";
}

// ---------------- 繳費人：要保人 → 同住址 → 其他客戶 ----------------
let payerFollows = true;
function fillPayerOptions(pick) {
  const sel = $("pf-payer");
  const keep = pick || sel.value || $("pf-applicant").value;
  const appId = $("pf-applicant").value;
  const app = personRecord(appId);
  const ins = personRecord($("pf-insured").value);
  const keys = new Set([addressKey(app), addressKey(ins)].filter(Boolean));
  const label = (c) => `${c.name}（${c.id === client.id ? "本人" : c.id}）`;
  const everyone = [client, ...allClients.filter((c) => c.id !== client.id)];
  const house = everyone.filter((c) => c.id !== appId && keys.has(addressKey(c)));
  const houseIds = new Set(house.map((c) => c.id));
  const rest = everyone.filter((c) => c.id !== appId && !houseIds.has(c.id))
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "zh-Hant"));
  const opt = (c) => `<option value="${esc(c.id)}">${esc(label(c))}</option>`;
  sel.innerHTML = (app ? `<optgroup label="要保人">${opt(app)}</optgroup>` : "")
    + (house.length ? `<optgroup label="同住址">${house.map(opt).join("")}</optgroup>` : "")
    + `<optgroup label="其他客戶">${rest.map(opt).join("")}</optgroup>`;
  sel.value = [...sel.options].some((o) => o.value === keep) ? keep : appId;
}

// ---------------- 上方：客戶與保單清單 ----------------
function renderClient() {
  $("pf-client-name").textContent = `${client.name}`;
  const meta = [client.id, client.gender, client.birthday && fmtDate(client.birthday), client.insurance_age != null ? `保險年齡 ${client.insurance_age}` : ""].filter(Boolean);
  $("pf-client-meta").textContent = meta.join("　");
  const list = client.policies || [];
  $("pf-chips").innerHTML = list.length
    ? list.map((p, i) => `<button type="button" class="pf-chip${i === editIndex ? " active" : ""}${p.life ? "" : " todo"}" data-i="${i}">
        <b>${esc(p.policy_no || "（未填號碼）")}</b><span>${esc([p.main_code, p.main_name].filter(Boolean).join(" ") || "—")}</span>${p.life ? "" : "<i>待補詳細資料</i>"}
      </button>`).join("")
    : `<p class="pf-note">這位客戶還沒有保單，直接在下面填寫即可。</p>`;
  $("pf-chips").querySelectorAll(".pf-chip").forEach((b) => b.addEventListener("click", () => {
    loadPolicy(+b.dataset.i);
    window.scrollTo({ top: $("pf-form").offsetTop - 10, behavior: "smooth" });
  }));
}

// ---------------- 表單互動 ----------------
function bindForm() {
  $("pf-new").addEventListener("click", () => { newPolicy(); window.scrollTo({ top: $("pf-form").offsetTop - 10, behavior: "smooth" }); });

  // 保單號碼：只收數字，滿 10 碼自動加「-」
  $("pf-no").addEventListener("input", (e) => {
    const d = e.target.value.replace(/\D/g, "").slice(0, 12);
    e.target.value = d.length > 10 ? `${d.slice(0, 10)}-${d.slice(10)}` : d;
    e.target.classList.remove("pf-invalid");
  });

  $("pf-disc-on").addEventListener("change", syncDiscount);
  $("pf-disc-pct").addEventListener("input", updateTotal);

  // 基本資料的被保人／職等／生效日，順手帶到附約的預設值
  $("pf-insured").addEventListener("change", () => { $("pf-r-person").value = $("pf-insured").value; fillPayerOptions(); });
  // 繳費人預設同要保人；手動改成別人之後，就不再跟著要保人變
  $("pf-applicant").addEventListener("change", () => fillPayerOptions(payerFollows ? $("pf-applicant").value : undefined));
  $("pf-payer").addEventListener("change", () => { payerFollows = $("pf-payer").value === $("pf-applicant").value; });
  $("pf-occ").addEventListener("change", () => { $("pf-r-occ").value = $("pf-occ").value; });
  $("pf-effective").addEventListener("change", () => { $("pf-r-effective").value = $("pf-effective").value; });

  // 主約代號 ↔ 名稱
  $("pf-main-family").addEventListener("input", (e) => {
    const v = e.target.value.trim().toUpperCase();
    e.target.value = v;
    fillVersions(v);
    onMainCode();
  });
  $("pf-main-ver").addEventListener("change", onMainCode);
  $("pf-main-name").addEventListener("change", (e) => {
    const name = e.target.value.trim();
    const hit = Object.entries(codes).find(([c, n]) => n === name && codeKinds[c] !== "rider") || Object.entries(codes).find(([, n]) => n === name);
    if (hit) setMainCode(hit[0]);
    if (hit && codeCats[hit[0]]) setCats(codeCats[hit[0]]); else guessCategory(name);
    applyKbMain(true);
  });
  $("pf-main-calc").addEventListener("click", calcMainPremium);
  document.querySelectorAll(".pf-cat").forEach((s) => s.addEventListener("change", syncDividend));

  $("pf-main-premium").addEventListener("input", updateTotal);

  // 附約查詢
  $("pf-r-search").addEventListener("click", searchRiders);
  document.querySelectorAll(".pf-kw").forEach((k) => k.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); searchRiders(); } }));
  $("pf-r-add").addEventListener("click", addCheckedRiders);
  $("pf-nr-cat").addEventListener("input", syncNewRiderSplit);
  $("pf-nr-add").addEventListener("click", addNewRider);
  $("pf-nr-cat2").addEventListener("input", syncNewRiderSplit);
  ["pf-nr-code", "pf-nr-name", "pf-nr-cat", "pf-nr-cat2"].forEach((id) => $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addNewRider(); } }));

  $("pf-channel").addEventListener("change", syncChannel);
  // 卡號：只收數字，每 4 碼自動空一格，最多 16 碼；游標維持在原本的位置
  // 游標剛好在空格後面按退格：連同前一個數字一起刪，不會卡在空格上
  $("pf-card-no").addEventListener("keydown", (e) => {
    const el = e.target;
    if (e.key !== "Backspace" || el.selectionStart !== el.selectionEnd || el.value[el.selectionStart - 1] !== " ") return;
    e.preventDefault();
    const at = el.selectionStart - 2;
    el.value = el.value.slice(0, at) + el.value.slice(at + 1);
    el.setSelectionRange(at, at);
    el.dispatchEvent(new Event("input"));
  });
  $("pf-card-no").addEventListener("input", (e) => {
    const el = e.target;
    const digitsBefore = el.value.slice(0, el.selectionStart).replace(/\D/g, "").length;
    el.value = fmtCardNo(el.value);
    let pos = 0, seen = 0;
    while (pos < el.value.length && seen < digitsBefore) { if (/\d/.test(el.value[pos])) seen++; pos++; }
    el.setSelectionRange(pos, pos);
  });
  $("pf-bene-add").addEventListener("click", () => addBene({ type: "named", name: "", ratio: "", equal: true }));

  $("pf-form").addEventListener("submit", (e) => { e.preventDefault(); savePolicy(); });
  $("pf-delete").addEventListener("click", deletePolicy);
}

// ---------------- 保單知識庫：自動帶入與保費試算 ----------------
function kbProductOf(code) {
  try { return KB.loaded ? KB.product(code) : null; } catch { return null; }
}
function kbBadge(product) {
  if (!product) return "";
  return `<span class="pf-kb-tag${product.verified ? "" : " todo"}">知識庫${product.verified ? " ✓ 已驗證" : "（待驗證）"}</span>
    <span>${esc(product.company)}・${product.kind === "rider" ? "附約" : "主約"}・${product.nature === "wealth" ? "理財型" : "保障型"}・保障至 ${esc(product.coverage_to || "—")}</span>
    <a href="../kb/index.html#${encodeURIComponent(product.code)}" target="_blank" rel="noopener">查看給付內容</a>`;
}
// fill=true：剛選了商品，把知識庫的資料帶進表單（之後還是可以手動改）
function applyKbMain(fill) {
  const product = kbProductOf($("pf-main-code").value);
  $("pf-main-kb").hidden = !product;
  $("pf-main-kb").innerHTML = kbBadge(product);
  if (!product || !fill) return;
  $("pf-main-name").value = product.name;
  if (product.category && !codeCats[product.code]) $("pf-cat1").value = product.category;
  if (COMPANIES.includes(product.company)) $("pf-company").value = product.company;
  if (product.coverage_to) $("pf-main-cover").value = product.coverage_to;
  if (product.currency && [...$("pf-currency").options].some((o) => o.value === product.currency)) $("pf-currency").value = product.currency;
  if (SA_UNITS.includes(product.unit)) $("pf-main-sa-unit").value = product.unit;
  if (product.pay_terms && product.pay_terms.length === 1) $("pf-main-term").value = product.pay_terms[0];
  syncDividend();
}
function personRecord(id) {
  return allClients.find((x) => x.id === id) || (id === client.id ? client : null);
}
async function calcPremiumFor({ code, personId, effective, term, sa, saUnit }) {
  const product = kbProductOf(code);
  const person = personRecord(personId);
  const issueAge = person ? kbInsuranceAge(person.birthday, effective) : null;
  return kbCalcPremium(product, { sex: person && person.gender, issueAge, term, mode: $("pf-mode-pay").value, sa, saUnit });
}
async function calcMainPremium() {
  const r = await calcPremiumFor({ code: $("pf-main-code").value, personId: $("pf-insured").value, effective: $("pf-effective").value,
    term: $("pf-main-term").value.trim(), sa: $("pf-main-sa").value, saUnit: $("pf-main-sa-unit").value });
  if (r.error) { showToast(r.error); return; }
  $("pf-main-premium").value = r.modal;
  if (!$("pf-main-term").value) $("pf-main-term").value = r.term;
  const cur = (kbProductOf($("pf-main-code").value) || {}).currency || "TWD";
  $("pf-main-calc-note").textContent = `試算：費率 ${r.rate.toLocaleString()} × ${r.units} × ${$("pf-mode-pay").value} ${r.factor} ＝ ${r.modal.toLocaleString()} ${cur === "TWD" ? "元" : cur}（未扣折扣）`;
  updateTotal();
}

function syncDiscount() {
  const on = $("pf-disc-on").checked;
  $("pf-disc-pct").disabled = !on;
  $("pf-discount").classList.toggle("on", on);
  updateTotal();
}

function setCats({ cat1, cat2 }) {
  $("pf-cat1").value = cat1 || "";
  $("pf-cat2").value = cat2 || "";
  syncDividend();
}

function guessCategory(name) {
  const hit = CAT_KEYWORDS.find(([kw]) => name.includes(kw));
  if (hit) $("pf-cat1").value = hit[1];
  syncDividend();
}

// 紅利給付只在類別包含「分紅」時出現
function syncDividend() {
  const show = $("pf-cat1").value === "分紅" || $("pf-cat2").value === "分紅";
  $("pf-dividend-wrap").hidden = !show;
}

function syncChannel() {
  const v = $("pf-channel").value;
  $("pf-ch-bank").hidden = v !== "帳戶扣款";
  $("pf-ch-card").hidden = v !== "信用卡/金融卡";
}

// ---------------- 附約 ----------------
function searchRiders() {
  const kws = [...document.querySelectorAll(".pf-kw")].map((k) => k.value.trim().toUpperCase()).filter(Boolean);
  if (!kws.length) { showToast("請至少輸入一個關鍵字或代號"); return; }
  const hits = Object.entries(codes).filter(([c]) => codeKinds[c] === "rider").filter(([c, n]) => kws.some((k) => c.includes(k) || n.toUpperCase().includes(k)));
  $("pf-results").hidden = false;
  $("pf-results-count").textContent = `查詢結果共 ${hits.length} 筆`;
  $("pf-results-body").innerHTML = hits.length
    ? hits.map(([c, n]) => `<tr><td><input type="checkbox" class="pf-hit" data-code="${esc(c)}"></td><td>${esc(c)}</td><td>${esc(n)}</td></tr>`).join("")
    : `<tr><td colspan="3" class="pf-empty">查無附約，請在下方直接新增</td></tr>`;
  // 查無結果：把打的代號帶到「新增附約」，填名稱與類別就能加入
  $("pf-newrider").hidden = hits.length > 0;
  if (!hits.length) {
    const guess = kws.find((k) => /^[A-Z0-9]+$/.test(k)) || "";
    $("pf-nr-code").value = guess;
    $("pf-nr-name").value = guess ? "" : kws[0] || "";
    $("pf-nr-cat").value = "";
    $("pf-nr-cat2").value = "";
    syncNewRiderSplit();
    (guess ? $("pf-nr-name") : $("pf-nr-code")).focus();
  }
}

function addCheckedRiders() {
  const checked = [...document.querySelectorAll(".pf-hit:checked")];
  if (!checked.length) { showToast("請先勾選要加入的附約"); return; }
  const pid = $("pf-r-person").value;
  checked.forEach((cb) => {
    const product = kbProductOf(cb.dataset.code);
    riders.push({
      insured_id: pid, insured_name: personName(pid), occ_class: $("pf-r-occ").value,
      effective_date: $("pf-r-effective").value, code: cb.dataset.code, name: (product && product.name) || codes[cb.dataset.code] || "",
      cat1: (codeCats[cb.dataset.code] || {}).cat1 || "", cat2: (codeCats[cb.dataset.code] || {}).cat2 || "",
      term: product && product.pay_terms && product.pay_terms.length === 1 ? product.pay_terms[0] : "",
      coverage: (product && product.coverage_to) || "", sum_assured: product && product.unit === "附加" ? "1" : "",
      sa_unit: product && SA_UNITS.includes(product.unit) ? product.unit : "萬", premium: "",
    });
  });
  riders.forEach(applyWaiver);
  $("pf-results").hidden = true;
  $("pf-newrider").hidden = true;
  document.querySelectorAll(".pf-kw").forEach((k) => (k.value = ""));
  renderRiders();
  showToast(`已加入 ${checked.length} 個附約`);
}

// 代號表沒有的附約：直接加入，儲存保單時自動建檔（_new 標記）
// 豁免附約：繳費年期與保障期間跟著主約，一律「同主約繳費期滿日」
const isWaiver = (r) => r.cat1 === "豁免";
function applyWaiver(r) {
  if (isWaiver(r)) { r.term = WAIVER_TERM; r.coverage = WAIVER_TERM; }
  return r;
}

function newRiderCats() {
  const c1 = $("pf-nr-cat").value.trim();
  const c2 = $("pf-nr-cat2").value.trim();
  if (!c1) return { cat1: "", cat2: "" };
  if (c2) return { cat1: splitCategory(c1, "rider").cat1, cat2: splitCategory(c2, "rider").cat1 };
  return splitCategory(c1, "rider"); // 也接受「意外/身故與失能」或舊寫法
}
function syncNewRiderSplit() {
  const { cat1, cat2 } = newRiderCats();
  $("pf-nr-split").textContent = cat1 ? `將建檔為　主要類別：${cat1}${cat2 ? `　次要類別：${cat2}` : ""}${cat1 === "豁免" ? "　（年期同主約繳費期滿日）" : ""}` : "";
}

function addNewRider() {
  const code = $("pf-nr-code").value.trim().toUpperCase();
  const name = $("pf-nr-name").value.trim();
  const cats = newRiderCats();
  if (!code) { $("pf-nr-code").focus(); showToast("請輸入險種代號"); return; }
  if (!/^[A-Z0-9]+$/.test(code)) { $("pf-nr-code").focus(); showToast("險種代號只能是英文和數字"); return; }
  if (!name) { $("pf-nr-name").focus(); showToast("請輸入險種名稱"); return; }
  if (!cats.cat1) { $("pf-nr-cat").focus(); showToast("請選擇主要類別"); return; }
  if (codes[code] && codeKinds[code] !== "rider") { showToast(`${code} 已經是主約代號，請改用主約或到代號維護調整`); return; }
  const pid = $("pf-r-person").value;
  riders.push(applyWaiver({
    insured_id: pid, insured_name: personName(pid), occ_class: $("pf-r-occ").value,
    effective_date: $("pf-r-effective").value, code, name, cat1: cats.cat1, cat2: cats.cat2,
    term: "", coverage: "", sum_assured: "", sa_unit: "萬", premium: "", _new: !codes[code],
  }));
  $("pf-newrider").hidden = true;
  $("pf-results").hidden = true;
  document.querySelectorAll(".pf-kw").forEach((k) => (k.value = ""));
  renderRiders();
  showToast(codes[code] ? `已加入 ${code}` : `已加入 ${code}，儲存保單時會自動建檔`);
}

// 儲存保單後：主約代號不在保單資料庫就自動建檔
async function autoCreateMainCode(p) {
  const M = p.life.main;
  if (!M.code || codes[M.code]) return null;
  const cats = M.cat2 ? { cat1: M.cat1, cat2: M.cat2 } : splitCategory(M.cat1, "main");
  await codeAdd(M.code, M.name || M.code, "main", cats, true);
  [M.code, ...codeEarlierVersions(M.code)].forEach((c) => { if (!codes[c]) { codes[c] = M.name || M.code; codeKinds[c] = "main"; codeCats[c] = cats; } });
  return M.code;
}

// 儲存保單後：把新附約寫進保單代號表（同一代號只建一次）
async function autoCreateRiderCodes(list) {
  const made = [];
  for (const r of list) {
    if (!r._new || !r.code || codes[r.code]) continue;
    await codeAdd(r.code, r.name, "rider", { cat1: r.cat1, cat2: r.cat2 }, true);
    [r.code, ...codeEarlierVersions(r.code)].forEach((c) => { if (!codes[c]) { codes[c] = r.name; codeKinds[c] = "rider"; codeCats[c] = { cat1: r.cat1, cat2: r.cat2 }; } });
    made.push(r.code);
  }
  return made;
}

function renderRiders() {
  const box = $("pf-riders");
  if (!riders.length) { box.innerHTML = `<p class="pf-note pf-empty-riders">尚未加入附約</p>`; updateTotal(); return; }
  box.innerHTML = riders.map((r, i) => `
    <div class="pf-rider" data-i="${i}">
      <div class="pf-rider-head">
        <div><b>${esc(r.code)}</b> ${esc(r.name)}${r.cat1 ? `<span class="pf-rider-cat">${esc([r.cat1, r.cat2].filter(Boolean).join("／"))}</span>` : ""}${r._new ? `<span class="pf-rider-new">新代號・儲存時建檔</span>` : ""}</div>
        <button type="button" class="icon-btn pf-rider-del" title="移除">✕</button>
      </div>
      <div class="pf-rider-meta">被保人 ${esc(r.insured_name)}　職等 ${esc(r.occ_class)} 級${r.effective_date ? "　生效 " + esc(fmtDate(r.effective_date)) : ""}</div>
      ${kbProductOf(r.code) ? `<div class="pf-kb">${kbBadge(kbProductOf(r.code))}</div>` : ""}
      <div class="pf-grid4">
        ${isWaiver(r)
          ? `<label>繳費年期<input type="text" value="${WAIVER_TERM}" disabled data-pick="none"></label>
        <label>保障期間<input type="text" value="${WAIVER_TERM}" disabled data-pick="none"></label>`
          : `<label>繳費年期<input type="text" data-f="term" data-pick="rider-term" autocomplete="off" value="${esc(r.term)}" placeholder="點選或輸入"></label>
        <label>保障期間<input type="text" data-f="coverage" data-pick="cover" autocomplete="off" value="${esc(r.coverage || "")}" placeholder="點選或輸入"></label>`}
        <label>保額
          <div class="pf-unit">
            <input type="number" data-f="sum_assured" min="0" step="any" value="${esc(r.sum_assured)}" placeholder="0">
            <select data-f="sa_unit">${SA_UNITS.map((u) => `<option${u === r.sa_unit ? " selected" : ""}>${u}</option>`).join("")}</select>
          </div>
        </label>
        <label>保費（元）
          <div class="pf-unit">
            <input type="number" data-f="premium" min="0" step="1" value="${esc(r.premium)}" placeholder="0" class="pf-premium">
            <button type="button" class="btn-secondary pf-calc pf-rider-calc" title="依知識庫費率表試算">試算</button>
          </div>
        </label>
      </div>
    </div>`).join("");
  box.querySelectorAll(".pf-rider").forEach((el) => {
    const i = +el.dataset.i;
    el.querySelectorAll("[data-f]").forEach((inp) => inp.addEventListener("input", () => {
      riders[i][inp.dataset.f] = inp.value;
      if (inp.dataset.f === "premium") updateTotal();
    }));
    el.querySelector(".pf-rider-del").addEventListener("click", () => { riders.splice(i, 1); renderRiders(); });
    el.querySelector(".pf-rider-calc").addEventListener("click", async () => {
      const r = riders[i];
      const res = await calcPremiumFor({ code: r.code, personId: r.insured_id, effective: r.effective_date || $("pf-effective").value,
        term: r.term, sa: r.sum_assured, saUnit: r.sa_unit });
      if (res.error) { showToast(res.error); return; }
      r.premium = String(res.modal);
      if (!r.term) r.term = res.term;
      renderRiders();
      showToast(`試算：費率 ${res.rate.toLocaleString()} × ${res.units} × ${res.factor} ＝ ${res.modal.toLocaleString()} 元`);
    });
  });
  updateTotal();
}

// ---------------- 受益人 ----------------
const BENE_RELATIONS = ["配偶", "子女", "父母", "兄弟姊妹", "祖父母", "孫子女", "本人", "其他"];
const isLegalName = (n) => !n || /法定/.test(n);

function addBene(b = {}) {
  const legal = b.type ? b.type === "legal" : isLegalName(b.name);
  const order = b.order || String(Math.min(9, Math.max(0, ...beneRows().map((r) => +r.querySelector(".pf-bene-order select").value)) + 1));
  const row = document.createElement("div");
  row.className = "pf-bene";
  row.innerHTML = `
    <label class="pf-bene-order">順位<select>${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<option${String(n) === String(order) ? " selected" : ""}>${n}</option>`).join("")}</select></label>
    <label class="pf-bene-type">類型<select><option value="legal"${legal ? " selected" : ""}>法定繼承人</option><option value="named"${legal ? "" : " selected"}>指定受益人</option></select></label>
    <label class="pf-bene-name">受益人<input type="text" data-pick="bene" autocomplete="off" value="${legal ? "" : esc(b.name)}" placeholder="${legal ? "法定繼承人" : "選擇或輸入姓名"}"${legal ? " disabled" : ""}></label>
    <label class="pf-bene-rel">關係<input type="text" data-pick="bene-rel" autocomplete="off" value="${legal ? "" : esc(b.relation || "")}" placeholder="${legal ? "—" : "例 配偶"}"${legal ? " disabled" : ""}></label>
    <label class="pf-bene-ratio">比例 %<input type="number" min="0" max="100" step="any" value="${esc(b.ratio)}"${b.equal ? " disabled" : ""}></label>
    <label class="pf-check pf-bene-equal"><input type="checkbox"${b.equal ? " checked" : ""}> 均分</label>
    <button type="button" class="icon-btn pf-bene-del" title="移除">✕</button>`;
  const ratio = row.querySelector(".pf-bene-ratio input");
  const name = row.querySelector(".pf-bene-name input");
  const rel = row.querySelector(".pf-bene-rel input");
  row.querySelector(".pf-bene-equal input").addEventListener("change", (e) => { ratio.disabled = e.target.checked; if (e.target.checked) ratio.value = ""; });
  row.querySelector(".pf-bene-type select").addEventListener("change", (e) => {
    const isLegal = e.target.value === "legal";
    name.disabled = rel.disabled = isLegal;
    name.placeholder = isLegal ? "法定繼承人" : "選擇或輸入姓名";
    rel.placeholder = isLegal ? "—" : "例 配偶";
    if (isLegal) { name.value = ""; rel.value = ""; } else name.focus();
  });
  row.querySelector(".pf-bene-del").addEventListener("click", () => { row.remove(); renumberBenes(); });
  $("pf-benes").appendChild(row);
}

function beneRows() {
  return [...document.querySelectorAll(".pf-bene")];
}

// 刪掉某個順位後，後面的順位往前遞補（1、3 → 1、2；同順位的維持同順位）
function renumberBenes() {
  const sels = beneRows().map((r) => r.querySelector(".pf-bene-order select"));
  const used = [...new Set(sels.map((s) => +s.value))].sort((a, b) => a - b);
  sels.forEach((s) => { s.value = String(used.indexOf(+s.value) + 1); });
}

function collectBenes() {
  return beneRows().map((row) => {
    const legal = row.querySelector(".pf-bene-type select").value === "legal";
    const name = row.querySelector(".pf-bene-name input").value.trim();
    return {
      order: row.querySelector(".pf-bene-order select").value,
      type: legal || !name ? "legal" : "named",
      name: legal || !name ? "法定繼承人" : name,
      relation: legal ? "" : row.querySelector(".pf-bene-rel input").value.trim(),
      ratio: row.querySelector(".pf-bene-ratio input").value,
      equal: row.querySelector(".pf-bene-equal input").checked,
    };
  });
}

// ---------------- 合計 ----------------
function totals() {
  const main = Number($("pf-main-premium").value) || 0;
  const sum = main + riders.reduce((s, r) => s + (Number(r.premium) || 0), 0);
  const pct = $("pf-disc-on").checked ? Number($("pf-disc-pct").value) || 0 : 0;
  return { sum, net: Math.round(sum * (1 - pct / 100)), pct };
}

function updateTotal() {
  const { sum, net, pct } = totals();
  $("pf-total").textContent = sum.toLocaleString();
  $("pf-total-disc").textContent = pct ? `折扣 ${pct}% 後 ${net.toLocaleString()}` : "";
}

// ---------------- 新增／載入 ----------------
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function loadAgentDefault() {
  try { return JSON.parse(localStorage.getItem(AGENT_KEY) || "{}"); } catch { return {}; }
}

function fillForm(p) {
  const L = p.life || {};
  const M = L.main || {};
  $("pf-no").value = p.policy_no || "";
  $("pf-no").classList.remove("pf-invalid");
  $("pf-disc-on").checked = !!(L.discount && L.discount.on);
  $("pf-disc-pct").value = L.discount && L.discount.pct != null ? L.discount.pct : 1;
  syncDiscount();

  const setPerson = (sel, id) => { $(sel).value = id && [...$(sel).options].some((o) => o.value === id) ? id : client.id; };
  setPerson("pf-applicant", L.applicant_id);
  setPerson("pf-insured", L.insured_id);
  // 繳費人：沒填過或跟要保人同一人 → 之後換要保人時繳費人跟著換
  payerFollows = !L.payer_id || L.payer_id === $("pf-applicant").value;
  fillPayerOptions(L.payer_id || $("pf-applicant").value);
  $("pf-effective").value = L.effective_date || today();
  $("pf-occ").value = L.occ_class || "1";
  $("pf-mode-pay").value = L.pay_mode || "年繳";

  $("pf-company").value = M.company || "富邦人壽";
  $("pf-currency").value = M.currency || p.currency || "TWD";
  setMainCode(M.code || p.main_code || "");
  $("pf-main-name").value = M.name || p.main_name || codes[(p.main_code || "").toUpperCase()] || "";
  // 類別：保單有存就用保單的；沒有就用代號表；再沒有才依名稱猜（舊資料的「無」視為空白）
  const mc = (M.code || p.main_code || "").toUpperCase();
  const tableCats = codeCats[mc];
  if (M.cat1) setCats({ cat1: M.cat1, cat2: M.cat2 === "無" ? "" : M.cat2 });
  else if (tableCats) setCats(tableCats);
  else { setCats({ cat1: "", cat2: "" }); if ($("pf-main-name").value) guessCategory($("pf-main-name").value); }
  $("pf-main-term").value = M.term || "";
  $("pf-main-cover").value = M.coverage || "";
  $("pf-main-sa").value = M.sum_assured ?? "";
  $("pf-main-sa-unit").value = M.sa_unit || "萬";
  $("pf-main-premium").value = M.premium ?? "";
  applyKbMain(false);

  setPerson("pf-r-person", L.insured_id);
  $("pf-r-occ").value = L.occ_class || "1";
  $("pf-r-effective").value = L.effective_date || today();
  riders = (L.riders || []).map((r) => applyWaiver(r.cat1 || !codeCats[r.code] ? { ...r } : { ...r, ...codeCats[r.code] }));
  $("pf-results").hidden = true;
  $("pf-newrider").hidden = true;
  renderRiders();

  $("pf-status").value = L.status || "正常";
  $("pf-dividend").value = L.dividend_option || "抵繳保費";
  syncDividend();
  const ch = L.pay_channel || {};
  $("pf-channel").value = ch.type || "自行繳費";
  $("pf-bank").value = ch.bank || "";
  $("pf-branch").value = ch.branch || "";
  $("pf-account").value = ch.account || "";
  $("pf-card-bank").value = ch.card_bank || "";
  const [cy, cm] = (ch.card_exp || "").split("-");
  $("pf-card-y").value = cy || "";
  $("pf-card-m").value = cm || "";
  $("pf-card-no").value = fmtCardNo(ch.card_no);
  syncChannel();

  $("pf-benes").innerHTML = "";
  const benes = L.beneficiaries && L.beneficiaries.length ? L.beneficiaries : [{ order: "1", type: "legal", name: "法定繼承人", ratio: "", equal: true }];
  benes.forEach(addBene);

  const ag = L.agent || loadAgentDefault();
  $("pf-agent-name").value = ag.name || "";
  $("pf-agent-license").value = ag.license_no || "";
  $("pf-agent-contact").value = ag.contact || "";

  updateTotal();
}

function newPolicy() {
  editIndex = null;
  $("pf-mode").textContent = "新增保單";
  $("pf-delete").hidden = true;
  $("pf-save").textContent = "儲存保單";
  fillForm({});
  renderClient();
}

function loadPolicy(i) {
  editIndex = i;
  const p = client.policies[i];
  $("pf-mode").textContent = p.life ? `修改保單　${p.policy_no || ""}` : `補齊保單資料　${p.policy_no || ""}`;
  $("pf-delete").hidden = false;
  $("pf-save").textContent = "更新保單";
  fillForm(p);
  renderClient();
}

// ---------------- 儲存 ----------------
function collectPolicy() {
  const pid = (sel) => $(sel).value;
  const { sum, pct } = totals();
  const ch = $("pf-channel").value;
  const life = {
    discount: { on: $("pf-disc-on").checked, pct: Number($("pf-disc-pct").value) || 0 },
    applicant_id: pid("pf-applicant"), applicant_name: personName(pid("pf-applicant")),
    insured_id: pid("pf-insured"), insured_name: personName(pid("pf-insured")),
    payer_id: pid("pf-payer"), payer_name: personName(pid("pf-payer")),
    effective_date: $("pf-effective").value,
    occ_class: $("pf-occ").value,
    pay_mode: $("pf-mode-pay").value,
    main: {
      company: $("pf-company").value, currency: $("pf-currency").value,
      code: $("pf-main-code").value.trim().toUpperCase(), name: $("pf-main-name").value.trim(),
      cat1: CAT_ALIASES.main[$("pf-cat1").value.trim()] || $("pf-cat1").value.trim(),
      cat2: CAT_ALIASES.main[$("pf-cat2").value.trim()] || $("pf-cat2").value.trim(),
      term: $("pf-main-term").value.trim(), coverage: $("pf-main-cover").value.trim(), sum_assured: $("pf-main-sa").value, sa_unit: $("pf-main-sa-unit").value,
      premium: $("pf-main-premium").value,
    },
    riders: riders.map(({ _new, ...r }) => ({ ...r })),
    status: $("pf-status").value,
    dividend_option: $("pf-dividend-wrap").hidden ? "" : $("pf-dividend").value,
    pay_channel: ch === "帳戶扣款"
      ? { type: ch, bank: $("pf-bank").value, branch: $("pf-branch").value.trim(), account: $("pf-account").value.trim() }
      : ch === "信用卡/金融卡"
        ? { type: ch, card_bank: $("pf-card-bank").value, card_exp: [$("pf-card-y").value, $("pf-card-m").value].filter(Boolean).join("-"), card_no: $("pf-card-no").value.replace(/\D/g, "") }
        : { type: ch },
    beneficiaries: collectBenes(),
    agent: { name: $("pf-agent-name").value.trim(), license_no: $("pf-agent-license").value.trim(), contact: $("pf-agent-contact").value.trim() },
    discount_pct_applied: pct,
    updated_at: new Date().toISOString(),
  };
  return {
    policy_no: $("pf-no").value.trim(),
    main_code: life.main.code,
    main_name: life.main.name,
    currency: life.main.currency,
    total_premium: sum,
    life,
  };
}

async function savePolicy() {
  const p = collectPolicy();
  if (!/^\d{10}-\d{2}$/.test(p.policy_no)) {
    $("pf-no").classList.add("pf-invalid");
    $("pf-no").focus();
    showToast("保單號碼格式：10 碼數字 - 2 碼數字");
    return;
  }
  if (!p.main_code && !p.main_name) { $("pf-main-family").focus(); showToast("請填主約代號或險種名稱"); return; }
  if (p.main_code && !codes[p.main_code]) {
    if (!p.main_name) { $("pf-main-name").focus(); showToast(`${p.main_code} 是新代號，請填險種名稱`); return; }
    if (!p.life.main.cat1) { $("pf-cat1").focus(); showToast(`${p.main_code} 是新代號，請選主要類別`); return; }
  }
  // 保單歸在被保險人的資料卡：被保人是另一位客戶時，存到他的卡上
  const insuredId = p.life.insured_id;
  const moveTo = insuredId && insuredId !== client.id && allClients.some((c) => c.id === insuredId) ? insuredId : null;
  if (moveTo) { await savePolicyToInsured(p, moveTo); return; }
  const list = [...(client.policies || [])];
  const dup = list.findIndex((x, i) => i !== editIndex && x.policy_no === p.policy_no);
  if (dup >= 0) { showToast("這個保單號碼已經存在"); return; }

  const btn = $("pf-save");
  btn.disabled = true;
  const newRiders = riders.filter((r) => r._new);
  try {
    if (editIndex === null) list.push(p);
    else list[editIndex] = { ...list[editIndex], ...p };
    client = await clientSavePolicies(client.id, list);
    try { localStorage.setItem(AGENT_KEY, JSON.stringify(p.life.agent)); } catch { /* 無痕模式存不了也沒關係 */ }
    const idx = editIndex === null ? client.policies.length - 1 : editIndex;
    let made = [];
    try { const m = await autoCreateMainCode(p); made = [...(m ? [m] : []), ...(await autoCreateRiderCodes(newRiders))]; syncMainNew(); }
    catch (err) { alert("保單已儲存，但附約代號自動建檔失敗：" + (err && err.message ? err.message : err)); }
    showToast((editIndex === null ? "已新增保單" : "已更新保單") + (made.length ? `，並建檔 ${made.join("、")}` : ""));
    loadPolicy(idx);
  } catch (err) {
    alert("儲存失敗：" + (err && err.message ? err.message : err));
  } finally {
    btn.disabled = false;
  }
}

async function savePolicyToInsured(p, targetId) {
  const btn = $("pf-save");
  btn.disabled = true;
  const newRiders = riders.filter((r) => r._new);
  try {
    const target = await clientGet(targetId);
    const tlist = [...((target && target.policies) || [])];
    const at = tlist.findIndex((x) => x.policy_no === p.policy_no);
    if (at >= 0 && !confirm(`${target.name} 的資料卡已有保單 ${p.policy_no}，要用這次的內容覆蓋嗎？`)) { btn.disabled = false; return; }
    if (at >= 0) tlist[at] = { ...tlist[at], ...p }; else tlist.push(p);
    await clientSavePolicies(targetId, tlist);
    // 原本存在這張卡上的，搬走後從這裡移除
    if (editIndex !== null) client = await clientSavePolicies(client.id, client.policies.filter((_, i) => i !== editIndex));
    try { localStorage.setItem(AGENT_KEY, JSON.stringify(p.life.agent)); } catch { /* 無痕模式存不了也沒關係 */ }
    try { await autoCreateMainCode(p); await autoCreateRiderCodes(newRiders); }
    catch (err) { alert("保單已儲存，但附約代號自動建檔失敗：" + (err && err.message ? err.message : err)); }
    const idx = at >= 0 ? at : tlist.length - 1;
    alert(`被保險人是 ${target.name}，這張保單已存到 ${target.name} 的資料卡。`);
    location.href = `policy.html?id=${encodeURIComponent(targetId)}&i=${idx}`;
  } catch (err) {
    alert("儲存失敗：" + (err && err.message ? err.message : err));
    btn.disabled = false;
  }
}

async function deletePolicy() {
  if (editIndex === null) return;
  const p = client.policies[editIndex];
  if (!confirm(`確定要刪除保單「${p.policy_no || ""} ${p.main_name || ""}」嗎？`)) return;
  const list = client.policies.filter((_, i) => i !== editIndex);
  try {
    client = await clientSavePolicies(client.id, list);
    showToast("已刪除保單");
    newPolicy();
  } catch (err) {
    alert("刪除失敗：" + (err && err.message ? err.message : err));
  }
}

// ---------------- 日期欄：跟著客戶資料頁的「西元／民國」切換 ----------------
// 原本的 <input> 變成隱藏欄位，值一律存西元 YYYY-MM-DD（程式其他地方不用改）；
// 畫面上另外放一個文字框，民國模式輸入 115/11/07 或 1151107，西元模式輸入 2026-11-07 或 20261107。
function parseEraDate(text, era) {
  const t = String(text || "").trim();
  if (!t) return "";
  let y, m, d;
  const parts = t.split(/[^0-9]+/).filter(Boolean);
  if (parts.length === 3) [y, m, d] = parts.map(Number);
  else if (parts.length === 1 && /^\d{6,8}$/.test(parts[0])) {
    const n = parts[0];
    // 8 碼＝西元 YYYYMMDD；7 碼＝民國 YYYMMDD；6 碼＝民國 YYMMDD（民國 99 年以前）
    [y, m, d] = [Number(n.slice(0, n.length - 4)), Number(n.slice(-4, -2)), Number(n.slice(-2))];
  } else return null;
  if (y < 1000) y += 1911;           // 民國年（輸入三碼以內的年份一律當民國）
  else if (era === "roc" && y < 1912) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (!m || !d || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function eraDateInput(id) {
  const hidden = $(id);
  const era = dateEra();
  hidden.type = "hidden";
  const wrap = document.createElement("span");
  wrap.className = "pf-date";
  const text = document.createElement("input");
  text.type = "text";
  text.inputMode = "numeric";
  text.autocomplete = "off";
  text.placeholder = era === "roc" ? "例 115/11/07" : "例 2026-11-07";
  text.title = era === "roc" ? "民國年月日，可直接打 1151107" : "西元年月日，可直接打 20261107";
  const pick = document.createElement("input");     // 小月曆按鈕（用瀏覽器內建日期選擇器）
  pick.type = "date";
  pick.className = "pf-date-pick";
  pick.tabIndex = -1;
  pick.setAttribute("aria-label", "開啟月曆");
  wrap.append(text, pick);
  hidden.after(wrap);
  const label = hidden.closest("label");
  if (label && label.firstChild && label.firstChild.nodeType === 3) {
    const tag = document.createElement("em");
    tag.className = "pf-era-tag";
    tag.textContent = era === "roc" ? "民國" : "西元";
    label.insertBefore(tag, label.firstChild.nextSibling);
  }

  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const show = () => {
    const v = desc.get.call(hidden);
    text.value = v ? fmtDate(v) : "";
    pick.value = v || "";
    text.classList.remove("pf-invalid");
  };
  // 程式設定 hidden.value 時，畫面一起更新
  Object.defineProperty(hidden, "value", { get() { return desc.get.call(hidden); }, set(v) { desc.set.call(hidden, v); show(); } });
  const commit = (iso) => {
    if (iso === desc.get.call(hidden)) return;
    desc.set.call(hidden, iso);
    hidden.dispatchEvent(new Event("change", { bubbles: true }));
  };
  text.addEventListener("input", () => {
    const iso = parseEraDate(text.value, era);
    text.classList.toggle("pf-invalid", iso === null && text.value.replace(/\D/g, "").length >= 6);
    if (iso) commit(iso);
  });
  text.addEventListener("blur", () => {
    const iso = parseEraDate(text.value, era);
    if (iso === null) { text.classList.add("pf-invalid"); return; }
    commit(iso);
    show();
  });
  pick.addEventListener("change", () => { if (pick.value) { commit(pick.value); show(); } });
  show();
}

function fmtCardNo(v) {
  return String(v || "").replace(/\D/g, "").slice(0, 16).replace(/(\d{4})(?=\d)/g, "$1 ");
}
