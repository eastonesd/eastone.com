// ========================= 全域狀態 =========================
let postalData = {};       // { "100": ["台北市","中正區"], ... }
let cityDistrictMap = {};  // { "台北市": { "中正區": "100", ... }, ... }
let insuranceCodes = {};   // { "WL": "終身壽險", ... }
let currentStep = 1;
let selectedGender = "";
let selectedBirthday = "";
let editingClientId = null; // 非null時代表目前正在編輯這個客戶ID，送出時要用更新而不是新增
const TOTAL_STEPS = 5;

// ========================= 初始化 =========================
document.addEventListener("DOMContentLoaded", async () => {
  // 沒登入會被導到登入頁；資料改存在雲端資料庫，不再需要要求瀏覽器保留本機資料
  const user = await requireLogin("../");

  await seedInsuranceCodesIfEmpty();
  await loadPostalData();
  await loadInsuranceCodes();
  buildGenderWheel();
  buildBirthdayWheels();
  bindTabs();
  bindWizardNav();
  bindEmailDomain();
  bindZipAndCity();
  bindPolicyTable();
  bindFormSubmit();
  bindFileList();
  bindCodeMaintenance();
  bindModal();
  bindBackup();
  bindEraSwitch();

  addPolicyRow(); // 預設一列
  // 從保單頁「← 返回客戶資料」回來時，直接打開檔案區
  const backTo = decodeURIComponent((location.hash.match(/^#client=([\w-]+)/) || [])[1] || "");
  if (location.hash === "#filelist" || backTo) document.querySelector('.tab-btn[data-tab="filelist"]').click();
  await refreshFileList();
  if (backTo) {
    history.replaceState(null, "", location.pathname + location.search + "#filelist");
    openDetail(backTo);
  }
  await refreshCodeList();

  // 這台裝置如果還有舊版存在本機的客戶資料，詢問是否搬到雲端（連同自訂的保單代號）
  await offerLocalMigration({
    dbName: "clientsDB", storeName: "clients", label: "客戶資料", user,
    importFn: async (rows) => {
      const count = await clientImportAll(rows);
      const codes = await readLocalStore("clientsDB", "insurance_codes");
      if (codes.length) {
        const map = {};
        codes.forEach((c) => { if (c && c.code) map[c.code] = c.name; });
        await codeImportAll(map);
      }
      return count;
    },
    onDone: async () => {
      await loadInsuranceCodes();
      await refreshFileList();
      await refreshCodeList();
    },
  });
});

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.hidden = true), 2200);
}

// ========================= Tabs =========================
function bindTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "filelist") refreshFileList();
      if (btn.dataset.tab === "codes") refreshCodeList();
    });
  });
}

// ========================= 郵遞區號資料 =========================
async function loadPostalData() {
  postalData = POSTAL_DATA;
  cityDistrictMap = {};
  for (const [zip, [city, district]] of Object.entries(postalData)) {
    if (!cityDistrictMap[city]) cityDistrictMap[city] = {};
    cityDistrictMap[city][district] = zip;
  }
  const citySelect = document.getElementById("f-city");
  Object.keys(cityDistrictMap).forEach((city) => {
    const opt = document.createElement("option");
    opt.value = city;
    opt.textContent = city;
    citySelect.appendChild(opt);
  });
}

function bindZipAndCity() {
  const zipInput = document.getElementById("f-zip");
  const citySelect = document.getElementById("f-city");
  const districtSelect = document.getElementById("f-district");

  zipInput.addEventListener("input", () => {
    const zip = zipInput.value.trim();
    if (postalData[zip]) {
      const [city, district] = postalData[zip];
      citySelect.value = city;
      fillDistrictOptions(city, district);
    }
  });

  citySelect.addEventListener("change", () => {
    fillDistrictOptions(citySelect.value, null);
    zipInput.value = "";
  });

  districtSelect.addEventListener("change", () => {
    const city = citySelect.value;
    const district = districtSelect.value;
    if (city && district && cityDistrictMap[city] && cityDistrictMap[city][district]) {
      zipInput.value = cityDistrictMap[city][district];
    }
  });
}

function fillDistrictOptions(city, selectedDistrict) {
  const districtSelect = document.getElementById("f-district");
  districtSelect.innerHTML = '<option value="">請選擇鄉鎮市區</option>';
  if (!city || !cityDistrictMap[city]) return;
  Object.keys(cityDistrictMap[city]).forEach((district) => {
    const opt = document.createElement("option");
    opt.value = district;
    opt.textContent = district;
    if (district === selectedDistrict) opt.selected = true;
    districtSelect.appendChild(opt);
  });
}

// ========================= 保單代號 =========================
async function loadInsuranceCodes() {
  insuranceCodes = await codeList();
}

let codeKind = "main";      // 保單代號維護目前顯示主約或附約
let codeRowsCache = [];

async function refreshCodeList() {
  codeRowsCache = await codeRows();
  insuranceCodes = {};
  codeRowsCache.forEach((r) => { insuranceCodes[r.code] = r.name; });
  renderCodeList();
}

function renderCodeList() {
  const label = codeKind === "rider" ? "附約" : "主約";
  const other = codeKind === "rider" ? "主約" : "附約";
  document.querySelectorAll(".code-kind").forEach((b) => b.classList.toggle("active", b.dataset.kind === codeKind));
  document.getElementById("btn-add-code").textContent = `新增/更新${label}`;
  const rows = codeRowsCache.filter((r) => r.kind === codeKind);
  // 依商品（去掉版本數字的代號）分組
  const fams = new Map();
  rows.forEach((r) => { const f = codeFamily(r.code); if (!fams.has(f)) fams.set(f, []); fams.get(f).push(r); });
  const tbody = document.getElementById("code-list-body");
  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="code-empty">還沒有${label}代號，請在上方新增。</td></tr>`;
    return;
  }
  fams.forEach((list, fam) => {
    list.forEach((r, i) => {
      const tr = document.createElement("tr");
      tr.className = i === 0 ? "fam-first" : "fam-more";
      tr.innerHTML = `<td>${i === 0 ? `<b>${escHtml(fam)}</b>${list.length > 1 ? `<span class="fam-count">${list.length} 版</span>` : ""}` : ""}</td>
        <td>${escHtml(r.code)}</td><td>${escHtml(r.name)}</td>
        <td class="code-acts"><button type="button" class="link-btn" data-move>改為${other}</button><button type="button" class="icon-btn" data-del>刪除</button></td>`;
      tr.querySelector("[data-del]").addEventListener("click", async () => {
        if (!confirm(`確定刪除代號 ${r.code}？`)) return;
        await codeDelete(r.code);
        showToast(`已刪除代號 ${r.code}`);
        refreshCodeList();
      });
      tr.querySelector("[data-move]").addEventListener("click", async () => {
        await codeAdd(r.code, r.name, codeKind === "rider" ? "main" : "rider");
        showToast(`${r.code} 已改為${other}`);
        refreshCodeList();
      });
      tbody.appendChild(tr);
    });
  });
}

function bindCodeMaintenance() {
  document.querySelectorAll(".code-kind").forEach((b) => b.addEventListener("click", () => {
    codeKind = b.dataset.kind;
    renderCodeList();
  }));
  document.getElementById("btn-add-code").addEventListener("click", async () => {
    const code = document.getElementById("code-input").value.trim().toUpperCase();
    const name = document.getElementById("code-name-input").value.trim();
    if (!code || !name) {
      showToast("請輸入代號與險種名稱");
      return;
    }
    await codeAdd(code, name, codeKind);
    document.getElementById("code-input").value = "";
    document.getElementById("code-name-input").value = "";
    showToast(`已儲存${codeKind === "rider" ? "附約" : "主約"}代號 ${code}`);
    refreshCodeList();
  });
}

// ========================= 滾輪選單：性別 =========================
// 依客戶ID第一碼數字（字母後的第1個數字）自動帶出性別滾輪：1→男、2→女、其他→其他
function autoFillGenderFromId(idValue) {
  const firstDigit = idValue.charAt(1); // 第0碼是英文字母，第1碼是第一個數字
  if (!/^[0-9]$/.test(firstDigit)) return; // 還沒打到數字就先不動

  const genderIndex = firstDigit === "1" ? 0 : firstDigit === "2" ? 1 : 2; // 男/女/其他
  const wheel = document.getElementById("wheel-gender");
  setWheel(wheel, genderIndex);
  selectedGender = getWheelSelectedText(wheel);
}

function buildGenderWheel() {
  setupWheel(document.getElementById("wheel-gender"), () => {
    selectedGender = getWheelSelectedText(document.getElementById("wheel-gender"));
  });
}

// ========================= 滾輪選單：生日 =========================
function buildBirthdayWheels() {
  const yearWheel = document.getElementById("wheel-year");
  const monthWheel = document.getElementById("wheel-month");
  const dayWheel = document.getElementById("wheel-day");

  const thisYear = new Date().getFullYear();
  const years = [];
  for (let y = thisYear; y >= thisYear - 100; y--) years.push(y);
  fillYearWheel(yearWheel, years); // 畫面顯示民國年，內部仍以西元年計算

  fillWheel(monthWheel, Array.from({ length: 12 }, (_, i) => `${i + 1}月`));

  fillWheel(dayWheel, Array.from({ length: 31 }, (_, i) => `${i + 1}日`));

  [yearWheel, monthWheel, dayWheel].forEach((wheel) => {
    setupWheel(wheel, onBirthdayWheelChange);
  });
}

function fillWheel(wheelEl, items) {
  const track = wheelEl.querySelector(".wheel-track");
  track.innerHTML = "";
  items.forEach((text) => {
    const div = document.createElement("div");
    div.className = "wheel-item";
    div.textContent = text;
    track.appendChild(div);
  });
}

// 年份滾輪專用：畫面依「西元／民國」切換顯示，但每個項目用 data-year 屬性
// 保留真正的西元年，給星座／年齡計算與存檔使用，兩邊互不影響。
function fillYearWheel(wheelEl, westernYears) {
  const track = wheelEl.querySelector(".wheel-track");
  track.innerHTML = "";
  westernYears.forEach((y) => {
    const div = document.createElement("div");
    div.className = "wheel-item";
    div.textContent = fmtYear(y);
    div.dataset.year = y;
    track.appendChild(div);
  });
}

function setupWheel(wheelEl, onChange) {
  const items = wheelEl.querySelectorAll(".wheel-item");
  const itemHeight = 34;

  function updateSelected() {
    const scrollTop = wheelEl.scrollTop;
    const index = Math.round(scrollTop / itemHeight);
    items.forEach((it, i) => it.classList.toggle("selected", i === index));
    if (onChange) onChange();
  }

  wheelEl.addEventListener("scroll", () => {
    clearTimeout(wheelEl._scrollTimer);
    wheelEl._scrollTimer = setTimeout(updateSelected, 80);
  });

  items.forEach((item, i) => {
    item.addEventListener("click", () => {
      wheelEl.scrollTo({ top: i * itemHeight, behavior: "smooth" });
    });
  });

  // 預設捲到第一項
  setTimeout(updateSelected, 50);
}

function getWheelSelectedIndex(wheelEl) {
  const itemHeight = 34;
  return Math.round(wheelEl.scrollTop / itemHeight);
}

function getWheelSelectedText(wheelEl) {
  const items = wheelEl.querySelectorAll(".wheel-item");
  const idx = getWheelSelectedIndex(wheelEl);
  return items[idx] ? items[idx].textContent : "";
}

// 年份滾輪專用：回傳目前選到的「西元年」（讀 data-year，不是畫面上顯示的民國年文字）
function getWheelSelectedYear(wheelEl) {
  const items = wheelEl.querySelectorAll(".wheel-item");
  const idx = getWheelSelectedIndex(wheelEl);
  return items[idx] ? Number(items[idx].dataset.year) : null;
}

// 直接把滾輪捲到指定的項目索引（不做平滑捲動），編輯資料要預先帶入現有值時用
function setWheel(wheelEl, index) {
  if (index < 0) return;
  const itemHeight = 34;
  wheelEl.scrollTop = index * itemHeight;
  const items = wheelEl.querySelectorAll(".wheel-item");
  items.forEach((it, i) => it.classList.toggle("selected", i === index));
}

async function onBirthdayWheelChange() {
  const y = getWheelSelectedYear(document.getElementById("wheel-year"));
  const m = getWheelSelectedText(document.getElementById("wheel-month")).replace("月", "");
  const d = getWheelSelectedText(document.getElementById("wheel-day")).replace("日", "");
  if (!y || !m || !d) return;

  const mm = m.padStart(2, "0");
  const dd = d.padStart(2, "0");
  const birthday = `${y}-${mm}-${dd}`;
  selectedBirthday = birthday;

  try {
    const zodiac = getZodiac(Number(m), Number(d));
    const actualAge = calcActualAge(Number(y), Number(m), Number(d));
    const insuranceAge = calcInsuranceAge(Number(y), Number(m), Number(d));
    document.getElementById("out-zodiac").textContent = zodiac;
    document.getElementById("out-actual-age").textContent = actualAge + " 歲";
    document.getElementById("out-insurance-age").textContent = insuranceAge + " 歲";
  } catch (e) { /* 無效日期忽略 */ }
}

function getBirthdayValue() {
  return selectedBirthday;
}

// ========================= Email 網域自訂 =========================
function bindEmailDomain() {
  const domainSelect = document.getElementById("f-email-domain");
  const customInput = document.getElementById("f-email-custom");
  domainSelect.addEventListener("change", () => {
    customInput.hidden = domainSelect.value !== "__custom__";
  });
}

// ========================= 保單表格 =========================
function bindPolicyTable() {
  document.getElementById("btn-add-policy").addEventListener("click", addPolicyRow);
}

function addPolicyRow() {
  const tbody = document.getElementById("policy-tbody");
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="p-policy-no" placeholder="保單號碼"></td>
    <td><input type="text" class="p-main-code" placeholder="主約代號" style="text-transform:uppercase"></td>
    <td><input type="text" class="p-main-name" placeholder="自動帶入" readonly></td>
    <td>
      <select class="p-currency">
        <option value="TWD" selected>TWD</option>
        <option value="USD">USD</option>
        <option value="AUD">AUD</option>
      </select>
    </td>
    <td><button type="button" class="icon-btn p-remove">✕</button></td>
  `;
  tbody.appendChild(tr);

  const codeInput = tr.querySelector(".p-main-code");
  const nameInput = tr.querySelector(".p-main-name");
  codeInput.addEventListener("input", () => {
    const code = codeInput.value.trim().toUpperCase();
    codeInput.value = code;
    nameInput.value = insuranceCodes[code] || "";
  });
  tr.querySelector(".p-remove").addEventListener("click", () => tr.remove());
}

function collectPolicies() {
  const rows = document.querySelectorAll("#policy-tbody tr");
  const policies = [];
  rows.forEach((row) => {
    const policy_no = row.querySelector(".p-policy-no").value.trim();
    const main_code = row.querySelector(".p-main-code").value.trim().toUpperCase();
    const main_name = row.querySelector(".p-main-name").value.trim();
    const currency = row.querySelector(".p-currency").value;
    if (policy_no || main_code) {
      const orig = row._orig || {};
      policies.push({ ...orig, policy_no, main_code, main_name, currency, total_premium: orig.total_premium || 0 });
    }
  });
  return policies;
}

// ========================= Wizard 導覽 =========================
function bindWizardNav() {
  document.getElementById("f-id").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase();
    autoFillGenderFromId(e.target.value);
  });

  document.getElementById("btn-next").addEventListener("click", () => {
    if (!validateStep(currentStep)) return;
    goToStep(currentStep + 1);
  });
  document.getElementById("btn-prev").addEventListener("click", () => {
    goToStep(currentStep - 1);
  });
}

function validateStep(step) {
  if (step === 1) {
    const id = document.getElementById("f-id").value.trim();
    const name = document.getElementById("f-name").value.trim();
    if (!id || !name) {
      showToast("請輸入客戶ID與姓名");
      return false;
    }
  }
  return true;
}

function goToStep(step) {
  if (step < 1 || step > TOTAL_STEPS) return;
  document.querySelectorAll(".step").forEach((s) => {
    s.hidden = Number(s.dataset.step) !== step;
  });
  document.querySelectorAll(".step-dot").forEach((dot) => {
    const n = Number(dot.dataset.step);
    dot.classList.toggle("active", n === step);
    dot.classList.toggle("done", n < step);
  });
  currentStep = step;

  document.getElementById("btn-prev").disabled = step === 1;
  document.getElementById("btn-next").hidden = step === TOTAL_STEPS;
  document.getElementById("btn-submit").hidden = step !== TOTAL_STEPS;
}

// ========================= 表單送出 =========================
function bindFormSubmit() {
  document.getElementById("client-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const domainSelect = document.getElementById("f-email-domain");
    const emailDomain =
      domainSelect.value === "__custom__"
        ? document.getElementById("f-email-custom").value.trim()
        : domainSelect.value;

    const payload = {
      id: document.getElementById("f-id").value.trim(),
      name: document.getElementById("f-name").value.trim(),
      gender: selectedGender,
      birthday: getBirthdayValue(),
      email_local: document.getElementById("f-email-local").value.trim(),
      email_domain: emailDomain,
      phone: document.getElementById("f-phone").value.trim(),
      zip_code: document.getElementById("f-zip").value.trim(),
      city: document.getElementById("f-city").value,
      district: document.getElementById("f-district").value,
      address_detail: document.getElementById("f-address-detail").value.trim(),
      policies: collectPolicies(),
    };

    const res = await (async () => {
      try {
        if (editingClientId) {
          await clientUpdate(editingClientId, payload);
        } else {
          await clientAdd(payload);
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    })();
    if (!res.ok) {
      showToast(res.error || (editingClientId ? "更新失敗" : "建檔失敗"));
      return;
    }
    showToast(editingClientId ? "更新成功！" : "建檔成功！");
    resetForm();
    document.querySelector('.tab-btn[data-tab="filelist"]').click();
  });
}

function resetForm() {
  document.getElementById("client-form").reset();
  selectedGender = "";
  selectedBirthday = "";
  editingClientId = null;
  const idInput = document.getElementById("f-id");
  idInput.readOnly = false;
  idInput.style.background = "";
  document.getElementById("btn-submit").textContent = "建檔";
  document.getElementById("f-email-custom").hidden = true;
  document.getElementById("policy-tbody").innerHTML = "";
  addPolicyRow();
  document.getElementById("out-zodiac").textContent = "—";
  document.getElementById("out-actual-age").textContent = "—";
  document.getElementById("out-insurance-age").textContent = "—";
  fillDistrictOptions("", null);
  goToStep(1);
}

// ========================= 編輯既有客戶 =========================
async function startEditClient(clientId) {
  const c = await clientGet(clientId);
  if (!c) {
    showToast("查無此客戶");
    return;
  }

  resetForm();
  editingClientId = c.id;

  const idInput = document.getElementById("f-id");
  idInput.value = c.id;
  idInput.readOnly = true; // 客戶ID是主鍵，編輯時不允許更改
  idInput.style.background = "#EFEDE5";

  document.getElementById("f-name").value = c.name || "";

  // 性別滾輪
  if (c.gender) {
    const wheel = document.getElementById("wheel-gender");
    const items = [...wheel.querySelectorAll(".wheel-item")];
    const idx = items.findIndex((it) => it.textContent === c.gender);
    if (idx >= 0) { setWheel(wheel, idx); selectedGender = c.gender; }
  }

  // 生日滾輪
  if (c.birthday) {
    const [y, m, d] = c.birthday.split("-").map(Number);
    const thisYear = new Date().getFullYear();
    setWheel(document.getElementById("wheel-year"), thisYear - y);
    setWheel(document.getElementById("wheel-month"), m - 1);
    setWheel(document.getElementById("wheel-day"), d - 1);
    await onBirthdayWheelChange();
  }

  // 聯絡方式
  document.getElementById("f-email-local").value = c.email_local || "";
  const domainSelect = document.getElementById("f-email-domain");
  const knownDomains = [...domainSelect.options].map((o) => o.value);
  if (c.email_domain && !knownDomains.includes(c.email_domain)) {
    domainSelect.value = "__custom__";
    document.getElementById("f-email-custom").hidden = false;
    document.getElementById("f-email-custom").value = c.email_domain;
  } else {
    domainSelect.value = c.email_domain || "gmail.com";
  }
  document.getElementById("f-phone").value = c.phone || "";

  // 地址
  document.getElementById("f-zip").value = c.zip_code || "";
  document.getElementById("f-city").value = c.city || "";
  fillDistrictOptions(c.city || "", c.district || "");
  document.getElementById("f-address-detail").value = c.address_detail || "";

  // 保單列表
  document.getElementById("policy-tbody").innerHTML = "";
  if (c.policies && c.policies.length) {
    c.policies.forEach((p) => {
      addPolicyRow();
      const rows = document.querySelectorAll("#policy-tbody tr");
      const row = rows[rows.length - 1];
      row._orig = p; // 保留詳細保單資料，存檔時不會被精靈蓋掉
      row.querySelector(".p-policy-no").value = p.policy_no || "";
      row.querySelector(".p-main-code").value = p.main_code || "";
      row.querySelector(".p-main-name").value = p.main_name || "";
      row.querySelector(".p-currency").value = p.currency || "TWD";
    });
  } else {
    addPolicyRow();
  }

  document.getElementById("btn-submit").textContent = "更新客戶資料";
  document.querySelector('.tab-btn[data-tab="wizard"]').click();
  goToStep(1);
}

// ========================= 檔案區 =========================
function bindFileList() {
  document.getElementById("search-box").addEventListener("input", refreshFileList);
}

// ========================= 匯出備份 / 匯入復原 =========================
function bindBackup() {
  document.getElementById("btnExportBackup").addEventListener("click", async () => {
    const clients = await clientList();
    const codes = await codeList();
    const payload = { clients, insurance_codes: codes };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const today = new Date().toISOString().slice(0, 10);
    a.download = `客戶資料備份_${today}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  document.getElementById("btnImportBackup").addEventListener("click", () => {
    document.getElementById("importFileInput").click();
  });

  document.getElementById("importFileInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const clients = Array.isArray(payload) ? payload : payload.clients; // 兼容單純陣列格式
      if (!Array.isArray(clients)) throw new Error("檔案格式不正確，應該是匯出時產生的 JSON 檔");
      if (!confirm(`確定要匯入 ${clients.length} 筆客戶資料嗎？如果資料庫裡已經有相同客戶ID的紀錄，內容會被匯入的資料覆蓋掉。`)) {
        e.target.value = "";
        return;
      }
      const count = await clientImportAll(clients);
      if (payload.insurance_codes) {
        await codeImportAll(payload.insurance_codes);
      }
      showToast(`匯入完成，共 ${count} 筆客戶資料`);
      await refreshFileList();
      await refreshCodeList();
    } catch (err) {
      alert("匯入失敗：" + (err && err.message ? err.message : "檔案格式不正確"));
    }
    e.target.value = "";
  });
}

async function refreshFileList() {
  const clients = await clientList();
  const keyword = document.getElementById("search-box").value.trim().toLowerCase();

  const filtered = clients.filter(
    (c) =>
      !keyword ||
      c.id.toLowerCase().includes(keyword) ||
      (c.name || "").toLowerCase().includes(keyword)
  );

  const tbody = document.getElementById("file-list-body");
  tbody.innerHTML = "";
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:#999;text-align:center;">尚無資料</td></tr>`;
    return;
  }
  filtered.forEach((c) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${c.id}</td><td>${c.name}</td><td>${c.gender || ""}</td>
      <td><span class="icon-btn delete-client-btn" data-id="${c.id}">刪除</span></td>`;
    // 點整列打開客戶資料卡（編輯資料在資料卡裡）
    tr.addEventListener("click", (e) => {
      if (e.target.classList.contains("delete-client-btn")) return;
      openDetail(c.id);
    });
    tr.querySelector(".delete-client-btn").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`確定要刪除客戶「${c.id} ${c.name}」嗎？此動作無法復原。`)) return;
      await clientDelete(c.id);
      showToast("已刪除");
      refreshFileList();
    });
    tbody.appendChild(tr);
  });
}

// ========================= 詳細資料 Modal =========================
function bindModal() {
  document.getElementById("btn-close-modal").addEventListener("click", closeModal);
  document.getElementById("detail-modal").addEventListener("click", (e) => {
    if (e.target.id === "detail-modal") closeModal();
  });
}

function closeModal() {
  document.getElementById("detail-modal").hidden = true;
}

// ========================= 西元／民國切換 =========================
function bindEraSwitch() {
  const sw = document.getElementById("era-switch");
  sw.checked = dateEra() === "roc";
  syncEraLabels();
  sw.addEventListener("change", () => {
    setDateEra(sw.checked ? "roc" : "ad");
    syncEraLabels();
    // 生日滾輪的年份標籤換掉（實際值存在 data-year，不受影響）
    document.querySelectorAll("#wheel-year .wheel-item").forEach((el) => (el.textContent = fmtYear(Number(el.dataset.year))));
    // 資料卡開著的話重畫
    if (!document.getElementById("detail-modal").hidden && currentDetailId) openDetail(currentDetailId);
  });
}
function syncEraLabels() {
  const roc = dateEra() === "roc";
  document.querySelector(".era-toggle").classList.toggle("is-roc", roc);
}

// ========================= 保單目錄 =========================
const CATALOG_KEY = "eastone.catalogExpanded";
function catalogExpanded() {
  try { return localStorage.getItem(CATALOG_KEY) === "1"; } catch { return false; }
}
const escHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const money = (n) => (Number(n) || 0).toLocaleString();
const saText = (v, unit) => (v === "" || v == null ? "" : `${v}${unit || ""}`);

function catalogCollapsed(policies) {
  return `
    <table>
      <thead><tr><th>保單號碼</th><th>主約</th><th>幣別</th></tr></thead>
      <tbody>
        ${policies.map((p, i) => `<tr class="detail-policy-row" data-i="${i}" title="點一下修改這張保單">
            <td>${escHtml(p.policy_no)}</td>
            <td>${escHtml(p.main_code)}${p.main_name ? " " + escHtml(p.main_name) : ""}</td>
            <td>${escHtml(p.currency || "TWD")}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

function catalogExpandedHtml(policies) {
  return `<div class="pc-list">${policies.map((p, i) => {
    const L = p.life;
    const M = (L && L.main) || {};
    const cur = M.currency || p.currency || "TWD";
    const mainMeta = L
      ? [M.company, L.insured_name && `被保人 ${L.insured_name}`, L.effective_date && `生效 ${fmtDate(L.effective_date)}`,
         L.pay_mode, M.term, saText(M.sum_assured, M.sa_unit) && `保額 ${saText(M.sum_assured, M.sa_unit)}`,
         M.premium !== "" && M.premium != null && `保費 ${money(M.premium)}`].filter(Boolean)
      : [];
    const riders = (L && L.riders) || [];
    const pct = L && L.discount && L.discount.on ? Number(L.discount.pct) || 0 : 0;
    const total = Number(p.total_premium) || 0;
    return `
      <div class="pc-policy detail-policy-row" data-i="${i}" title="點一下修改這張保單">
        <div class="pc-head">
          <b class="pc-no">${escHtml(p.policy_no || "（未填號碼）")}</b>
          ${L && L.status ? `<span class="pc-status${L.status === "正常" ? "" : " warn"}">${escHtml(L.status)}</span>` : ""}
          ${L ? "" : `<span class="pc-todo">待補詳細資料</span>`}
          <span class="pc-cur">${escHtml(cur)}</span>
        </div>
        <div class="pc-item pc-main">
          <span class="pc-tag">主約</span>
          <div><div class="pc-name">${escHtml([M.code || p.main_code, M.name || p.main_name].filter(Boolean).join(" ") || "—")}</div>
          ${mainMeta.length ? `<div class="pc-meta">${mainMeta.map(escHtml).join("　")}</div>` : ""}</div>
        </div>
        ${riders.map((r) => {
          const meta = [r.insured_name && `被保人 ${r.insured_name}`, r.term, saText(r.sum_assured, r.sa_unit) && `保額 ${saText(r.sum_assured, r.sa_unit)}`,
            r.premium !== "" && r.premium != null && `保費 ${money(r.premium)}`].filter(Boolean);
          return `<div class="pc-item pc-rider"><span class="pc-tag rider">附約</span>
            <div><div class="pc-name">${escHtml([r.code, r.name].filter(Boolean).join(" "))}</div>
            ${meta.length ? `<div class="pc-meta">${meta.map(escHtml).join("　")}</div>` : ""}</div></div>`;
        }).join("")}
        ${L ? `<div class="pc-total">每期保費合計 <b>${money(total)}</b>${pct ? `　折扣 ${pct}% 後 <b>${money(Math.round(total * (1 - pct / 100)))}</b>` : ""}</div>` : ""}
      </div>`;
  }).join("")}</div>`;
}

let currentDetailId = null;

async function openDetail(clientId) {
  const c = await clientGet(clientId);
  if (!c) {
    showToast("查無此客戶");
    return;
  }
  currentDetailId = c.id;
  const email = c.email_local ? `${c.email_local}@${c.email_domain || ""}` : "—";
  const fullAddress = [c.zip_code, c.city, c.district, c.address_detail].filter(Boolean).join(" ");
  const policies = c.policies || [];
  const expanded = catalogExpanded();

  document.getElementById("detail-content").innerHTML = `
    <div class="detail-row">
      <div class="detail-cell"><span>客戶ID</span><strong>${escHtml(c.id)}</strong></div>
      <div class="detail-cell"><span>姓名</span><strong>${escHtml(c.name)}</strong></div>
      <div class="detail-cell"><span>性別</span><strong>${escHtml(c.gender || "—")}</strong></div>
    </div>
    <div class="detail-row">
      <div class="detail-cell"><span>生日</span><strong>${c.birthday ? fmtDate(c.birthday) : "—"}</strong></div>
      <div class="detail-cell"><span>星座</span><strong>${escHtml(c.zodiac || "—")}</strong></div>
      <div class="detail-cell"><span>實際年齡</span><strong>${c.actual_age ?? "—"}</strong></div>
      <div class="detail-cell"><span>保險年齡</span><strong>${c.insurance_age ?? "—"}</strong></div>
    </div>
    <div class="detail-row">
      <div class="detail-cell"><span>信箱</span><strong>${escHtml(email)}</strong></div>
      <div class="detail-cell"><span>電話</span><strong>${escHtml(c.phone || "—")}</strong></div>
    </div>
    <div class="detail-row">
      <div class="detail-cell detail-full">
        <span>地址</span><strong>${escHtml(fullAddress || "—")}</strong>
      </div>
    </div>
    <div class="detail-section-title catalog-title">
      <span>保單目錄${policies.length ? `（${policies.length}）` : ""}</span>
      ${policies.length ? `<label class="catalog-toggle" title="收合／展開主附約內容">
        <span class="catalog-state">${expanded ? "展開" : "收合"}</span>
        <input type="checkbox" id="catalog-switch" class="switch-input"${expanded ? " checked" : ""}>
        <span class="switch" aria-hidden="true"></span>
      </label>` : ""}
    </div>
    <div id="catalog-body">${policies.length ? (expanded ? catalogExpandedHtml(policies) : catalogCollapsed(policies)) : `<p style="color:#999;">尚無保單資料</p>`}</div>
    <div class="detail-actions">
      <button type="button" class="btn-primary" id="btn-policy-client">新增／修改保單</button>
      <button type="button" class="btn-secondary" id="btn-edit-client">編輯資料</button>
      <button type="button" class="btn-secondary btn-checkup" id="btn-checkup">保單健診報告</button>
    </div>
  `;

  const policyUrl = (i) => `policy.html?id=${encodeURIComponent(c.id)}${i == null ? "" : "&i=" + i}`;
  const bindRows = () => document.querySelectorAll("#catalog-body .detail-policy-row").forEach((el) =>
    el.addEventListener("click", () => (location.href = policyUrl(el.dataset.i))));
  bindRows();

  const sw = document.getElementById("catalog-switch");
  if (sw) sw.addEventListener("change", () => {
    try { localStorage.setItem(CATALOG_KEY, sw.checked ? "1" : "0"); } catch { /* 記不住也沒關係 */ }
    document.querySelector(".catalog-state").textContent = sw.checked ? "展開" : "收合";
    document.getElementById("catalog-body").innerHTML = sw.checked ? catalogExpandedHtml(policies) : catalogCollapsed(policies);
    bindRows();
  });

  document.getElementById("btn-policy-client").addEventListener("click", () => {
    location.href = policyUrl(null);
  });
  document.getElementById("btn-edit-client").addEventListener("click", () => {
    closeModal();
    startEditClient(c.id);
  });
  // 保單健診報告：目前是試算版（以被保人為單位、跨客戶抓保單）
  document.getElementById("btn-checkup").addEventListener("click", () => {
    location.href = `checkup.html?id=${encodeURIComponent(c.id)}`;
  });

  document.getElementById("detail-modal").hidden = false;
}
