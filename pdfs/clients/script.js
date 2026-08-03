// ========================= 全域狀態 =========================
let postalData = {};       // { "100": ["台北市","中正區"], ... }
let cityDistrictMap = {};  // { "台北市": { "中正區": "100", ... }, ... }
let insuranceCodes = {};   // { "WL": "終身壽險", ... }
let currentStep = 1;
let selectedGender = "";
let selectedBirthday = "";
const TOTAL_STEPS = 5;

// ========================= 初始化 =========================
document.addEventListener("DOMContentLoaded", async () => {
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

  addPolicyRow(); // 預設一列
  await refreshFileList();
  await refreshCodeList();
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

async function refreshCodeList() {
  await loadInsuranceCodes();
  const tbody = document.getElementById("code-list-body");
  tbody.innerHTML = "";
  Object.entries(insuranceCodes).forEach(([code, name]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${code}</td><td>${name}</td>
      <td><button class="icon-btn" data-code="${code}">刪除</button></td>`;
    tr.querySelector(".icon-btn").addEventListener("click", async () => {
      await codeDelete(code);
      showToast(`已刪除代號 ${code}`);
      refreshCodeList();
    });
    tbody.appendChild(tr);
  });
}

function bindCodeMaintenance() {
  document.getElementById("btn-add-code").addEventListener("click", async () => {
    const code = document.getElementById("code-input").value.trim().toUpperCase();
    const name = document.getElementById("code-name-input").value.trim();
    if (!code || !name) {
      showToast("請輸入代號與險種名稱");
      return;
    }
    await codeAdd(code, name);
    document.getElementById("code-input").value = "";
    document.getElementById("code-name-input").value = "";
    showToast(`已儲存代號 ${code}`);
    refreshCodeList();
  });
}

// ========================= 滾輪選單：性別 =========================
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
  fillWheel(yearWheel, years.map((y) => `${y}`));

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

async function onBirthdayWheelChange() {
  const y = getWheelSelectedText(document.getElementById("wheel-year"));
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
      policies.push({ policy_no, main_code, main_name, currency, total_premium: 0 });
    }
  });
  return policies;
}

// ========================= Wizard 導覽 =========================
function bindWizardNav() {
  document.getElementById("f-id").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase();
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
        await clientAdd(payload);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    })();
    if (!res.ok) {
      showToast(res.error || "建檔失敗");
      return;
    }
    showToast("建檔成功！");
    resetForm();
    document.querySelector('.tab-btn[data-tab="filelist"]').click();
  });
}

function resetForm() {
  document.getElementById("client-form").reset();
  selectedGender = "";
  selectedBirthday = "";
  document.getElementById("f-email-custom").hidden = true;
  document.getElementById("policy-tbody").innerHTML = "";
  addPolicyRow();
  document.getElementById("out-zodiac").textContent = "—";
  document.getElementById("out-actual-age").textContent = "—";
  document.getElementById("out-insurance-age").textContent = "—";
  fillDistrictOptions("", null);
  goToStep(1);
}

// ========================= 檔案區 =========================
function bindFileList() {
  document.getElementById("search-box").addEventListener("input", refreshFileList);
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
    tbody.innerHTML = `<tr><td colspan="3" style="color:#999;text-align:center;">尚無資料</td></tr>`;
    return;
  }
  filtered.forEach((c) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${c.id}</td><td>${c.name}</td><td>${c.gender || ""}</td>`;
    tr.addEventListener("click", () => openDetail(c.id));
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

async function openDetail(clientId) {
  const c = await clientGet(clientId);
  if (!c) {
    showToast("查無此客戶");
    return;
  }
  const email = c.email_local ? `${c.email_local}@${c.email_domain || ""}` : "—";
  const fullAddress = [c.zip_code, c.city, c.district, c.address_detail].filter(Boolean).join(" ");

  let policiesHtml = `<p style="color:#999;">尚無保單資料</p>`;
  if (c.policies && c.policies.length) {
    policiesHtml = `
      <table>
        <thead><tr><th>保單號碼</th><th>主約</th><th>幣別</th></tr></thead>
        <tbody>
          ${c.policies
            .map(
              (p) => `<tr>
                <td>${p.policy_no || ""}</td>
                <td>${p.main_code || ""}${p.main_name ? " " + p.main_name : ""}</td>
                <td>${p.currency || "TWD"}</td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>`;
  }

  document.getElementById("detail-content").innerHTML = `
    <div class="detail-row">
      <div class="detail-cell"><span>客戶ID</span><strong>${c.id}</strong></div>
      <div class="detail-cell"><span>姓名</span><strong>${c.name}</strong></div>
      <div class="detail-cell"><span>性別</span><strong>${c.gender || "—"}</strong></div>
    </div>
    <div class="detail-row">
      <div class="detail-cell"><span>生日</span><strong>${c.birthday || "—"}</strong></div>
      <div class="detail-cell"><span>星座</span><strong>${c.zodiac || "—"}</strong></div>
      <div class="detail-cell"><span>實際年齡</span><strong>${c.actual_age ?? "—"}</strong></div>
      <div class="detail-cell"><span>保險年齡</span><strong>${c.insurance_age ?? "—"}</strong></div>
    </div>
    <div class="detail-row">
      <div class="detail-cell"><span>信箱</span><strong>${email}</strong></div>
      <div class="detail-cell"><span>電話</span><strong>${c.phone || "—"}</strong></div>
    </div>
    <div class="detail-row">
      <div class="detail-cell detail-full">
        <span>地址</span><strong>${fullAddress || "—"}</strong>
      </div>
    </div>
    <div class="detail-section-title">保單號碼總表</div>
    ${policiesHtml}
    <div class="wizard-nav" style="margin-top:20px;">
      <button type="button" class="btn-secondary" id="btn-delete-client">刪除此客戶</button>
    </div>
  `;

  document.getElementById("btn-delete-client").addEventListener("click", async () => {
    if (!confirm(`確定要刪除客戶「${c.id} ${c.name}」嗎？此動作無法復原。`)) return;
    await clientDelete(c.id);
    showToast("已刪除");
    closeModal();
    refreshFileList();
  });

  document.getElementById("detail-modal").hidden = false;
}
