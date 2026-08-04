// ============================================================
// 保單建檔系統 - 前端邏輯
// ============================================================

const CURRENT_ROC_YEAR = new Date().getFullYear() - 1911;
const CURRENT_AD_YEAR = new Date().getFullYear();

const state = {
  plate: '', vehicleType: '',
  hasCompulsory: false, compulsoryPolicyNo: '',
  hasVoluntary: false, voluntaryPolicyNo: '',
  voluntaryItems: {}, // id -> {checked, amount}
  insuredName: '',
  totalPremium: '',
  periodStart: { y: null, m: 1, d: 1 },
  periodEnd: { y: null, m: 1, d: 1 },
  license: { y: null, m: 1, d: 1 },
  mfg: { y: null, m: 1 },
  displacement: '', seatingCapacity: 2,
  engineNumber: '', brandModel: '',
  insuredIdNumber: '',
  birth: { y: null, m: 1, d: 1 },
  phoneSuffix: '',
  emailLocal: '', emailDomain: 'gmail.com', emailDomainCustom: '',
  zipcode: '', city: '', district: '', addressDetail: '',
};

const VEHICLE_TYPES = ['汽車', '普重', '大重'];

const VOLUNTARY_ITEMS = [
  { id: 'body_a', name: '車體損失險 甲式', presets: ['50萬', '80萬', '100萬', '150萬', '200萬'] },
  { id: 'body_b', name: '車體損失險 乙式', presets: ['50萬', '80萬', '100萬', '150萬', '200萬'] },
  { id: 'body_c', name: '車體損失險 丙式', presets: ['50萬', '80萬', '100萬', '150萬', '200萬'] },
  { id: 'theft', name: '竊盜損失險', presets: ['50萬', '80萬', '100萬', '150萬'] },
  { id: 'liab_injury', name: '第三人責任險（傷害）', presets: ['每人100萬/每一事故200萬', '每人200萬/每一事故400萬', '每人300萬/每一事故600萬'] },
  { id: 'liab_property', name: '第三人責任險（財損）', presets: ['30萬', '50萬', '100萬', '200萬'] },
  { id: 'excess_liab', name: '超額責任險', presets: ['500萬', '1000萬', '2000萬'] },
  { id: 'passenger', name: '乘客傷害險', presets: ['每人100萬/每一事故200萬', '每人200萬/每一事故400萬'] },
  { id: 'driver', name: '駕駛人傷害險', presets: ['100萬', '200萬', '300萬'] },
  { id: 'accessory_theft', name: '零配件被竊損失險', presets: ['5萬', '10萬'] },
  { id: 'glass', name: '玻璃單獨破損險', presets: ['2萬', '3萬'] },
  { id: 'deductible_waiver', name: '免自負額險', presets: [], noAmount: true },
];

const EMAIL_DOMAINS = ['gmail.com', 'yahoo.com.tw','kimo.com', 'outlook.com', 'hotmail.com', 'icloud.com', '其他'];

// ---------- helpers ----------
function pad2(n) { return String(n).padStart(2, '0'); }
function rocToIso(y, m, d) {
  if (!y) return null;
  const iso = `${Number(y) + 1911}-${pad2(m || 1)}-${pad2(d || 1)}`;
  return iso;
}
function range(a, b) { const arr = []; for (let i = a; i <= b; i++) arr.push(i); return arr; }

// ---------- wheel picker ----------
// Item height must match static/style.css .wheel-col .opt { height:40px; }
const WHEEL_ITEM_H = 40;
// Higher = less sensitive (more scroll distance needed to move one row).
const WHEEL_STEP_THRESHOLD = 90;

function renderWheelGroup(container, columns) {
  container.innerHTML = `
    <div class="wheel-group">
      <div class="wheel-frame"></div>
      ${columns.map(col => `
        <div class="wheel-col" data-col="${col.id}">
          <div class="pad"></div>
          ${col.items.map((it, idx) => `<div class="opt" data-index="${idx}">${it.label}</div>`).join('')}
          <div class="pad"></div>
        </div>
      `).join('')}
    </div>
    <div class="wheel-captions">
      ${columns.map(col => `<div class="wheel-caption">${col.caption}</div>`).join('')}
    </div>
  `;
  columns.forEach(col => {
    const colEl = container.querySelector(`.wheel-col[data-col="${col.id}"]`);
    let initIdx = col.items.findIndex(it => it.value === col.initialValue);
    if (initIdx < 0) initIdx = 0;
    let currentIndex = initIdx;

    function clampIdx(idx) { return Math.max(0, Math.min(col.items.length - 1, idx)); }
    function goTo(idx, smooth) {
      idx = clampIdx(idx);
      currentIndex = idx;
      colEl.scrollTo({ top: idx * WHEEL_ITEM_H, behavior: smooth === false ? 'auto' : 'smooth' });
      updateWheelCenter(colEl, idx);
      col.onChange && col.onChange(col.items[idx].value);
    }

    goTo(initIdx, false);

    // Native scroll (touch drag / trackpad momentum) — settle to nearest row when it stops.
    let settleTimer = null;
    colEl.addEventListener('scroll', () => {
      const roughIdx = clampIdx(Math.round(colEl.scrollTop / WHEEL_ITEM_H));
      updateWheelCenter(colEl, roughIdx);
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => goTo(roughIdx), 140);
    });

    // Mouse wheel: move exactly one row per accumulated threshold, instead of
    // letting raw deltaY (which varies wildly by device) fling past the target.
    let wheelAccum = 0;
    colEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      wheelAccum += e.deltaY;
      if (Math.abs(wheelAccum) >= WHEEL_STEP_THRESHOLD) {
        const dir = wheelAccum > 0 ? 1 : -1;
        wheelAccum = 0;
        goTo(currentIndex + dir);
      }
    }, { passive: false });

    // Tap/click any visible row to jump straight to it.
    colEl.querySelectorAll('.opt').forEach(opt => {
      opt.addEventListener('click', () => goTo(parseInt(opt.dataset.index, 10)));
    });
  });
}
function updateWheelCenter(colEl, idx) {
  colEl.querySelectorAll('.opt').forEach(o => o.classList.remove('center'));
  const t = colEl.querySelector(`.opt[data-index="${idx}"]`);
  if (t) t.classList.add('center');
}

// ============================================================
// STEP DEFINITIONS
// ============================================================
function getSteps() {
  const steps = [
    stepPlate(),
    stepInsuranceTypes(),
  ];
  if (state.hasVoluntary) steps.push(stepVoluntaryItems());
  steps.push(stepInsuredName());
  steps.push(stepPremium());
  steps.push(stepPeriod());
  steps.push(stepInsuredInfo());
  steps.push(stepVehicleInfo());
  steps.push(stepReview());
  return steps;
}

function stepPlate() {
  return {
    eyebrow: '車輛基本資料', title: '車牌號碼與車種',
    render() {
      return `
        <div class="field">
          <label>車牌號碼</label>
          <input type="text" class="plate-input" id="f_plate" placeholder="ABC-1234" value="${state.plate}" maxlength="10">
        </div>
        <div class="field">
          <label>車種</label>
          <div class="option-grid" id="f_vtype">
            ${VEHICLE_TYPES.map(v => `<div class="option-card ${state.vehicleType === v ? 'selected' : ''}" data-v="${v}">${v}</div>`).join('')}
          </div>
        </div>`;
    },
    afterRender(root) {
      const plateInput = root.querySelector('#f_plate');
      plateInput.addEventListener('input', () => {
        const pos = plateInput.selectionStart;
        plateInput.value = plateInput.value.toUpperCase();
        plateInput.setSelectionRange(pos, pos);
      });
      root.querySelectorAll('#f_vtype .option-card').forEach(card => {
        card.addEventListener('click', () => {
          root.querySelectorAll('#f_vtype .option-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
          state.vehicleType = card.dataset.v;
        });
      });
    },
    collect(root) {
      state.plate = root.querySelector('#f_plate').value.trim().toUpperCase();
      if (!state.plate) { alert('請輸入車牌號碼'); return false; }
      if (!state.vehicleType) { alert('請選擇車種'); return false; }
      return true;
    }
  };
}

function stepInsuranceTypes() {
  return {
    eyebrow: '保險內容', title: '險種與保單號碼',
    render() {
      return `
        <div class="check-row ${state.hasCompulsory ? 'checked' : ''}" id="row_compulsory">
          <input type="checkbox" id="chk_compulsory" ${state.hasCompulsory ? 'checked' : ''}>
          <label class="label" for="chk_compulsory">強制險</label>
          <div class="detail">
            <input type="text" id="f_compulsory_no" placeholder="保單號碼" value="${state.compulsoryPolicyNo}">
          </div>
        </div>
        <div class="check-row ${state.hasVoluntary ? 'checked' : ''}" id="row_voluntary">
          <input type="checkbox" id="chk_voluntary" ${state.hasVoluntary ? 'checked' : ''}>
          <label class="label" for="chk_voluntary">任意險</label>
          <div class="detail">
            <input type="text" id="f_voluntary_no" placeholder="保單號碼" value="${state.voluntaryPolicyNo}">
          </div>
        </div>`;
    },
    afterRender(root) {
      const wireCheck = (rowId, chkId, key) => {
        const row = root.querySelector(rowId), chk = root.querySelector(chkId);
        chk.addEventListener('change', () => {
          state[key] = chk.checked;
          row.classList.toggle('checked', chk.checked);
        });
      };
      wireCheck('#row_compulsory', '#chk_compulsory', 'hasCompulsory');
      wireCheck('#row_voluntary', '#chk_voluntary', 'hasVoluntary');

      const wireUppercase = (inputEl) => {
        inputEl.addEventListener('input', () => {
          const pos = inputEl.selectionStart;
          inputEl.value = inputEl.value.toUpperCase();
          inputEl.setSelectionRange(pos, pos);
        });
      };
      wireUppercase(root.querySelector('#f_compulsory_no'));
      wireUppercase(root.querySelector('#f_voluntary_no'));
    },
    collect(root) {
      state.hasCompulsory = root.querySelector('#chk_compulsory').checked;
      state.hasVoluntary = root.querySelector('#chk_voluntary').checked;
      state.compulsoryPolicyNo = root.querySelector('#f_compulsory_no').value.trim();
      state.voluntaryPolicyNo = root.querySelector('#f_voluntary_no').value.trim();
      if (!state.hasCompulsory && !state.hasVoluntary) { alert('請至少選擇一項險種'); return false; }
      if (state.hasCompulsory && !state.compulsoryPolicyNo) { alert('請輸入強制險保單號碼'); return false; }
      if (state.hasVoluntary && !state.voluntaryPolicyNo) { alert('請輸入任意險保單號碼'); return false; }
      return true;
    }
  };
}

function stepVoluntaryItems() {
  return {
    eyebrow: '任意險明細', title: '投保內容與保額',
    render() {
      return VOLUNTARY_ITEMS.map(item => {
        const cur = state.voluntaryItems[item.id] || { checked: false, amount: '' };
        const isCustom = cur.checked && cur.amount && !item.presets.includes(cur.amount);
        return `
        <div class="check-row ${cur.checked ? 'checked' : ''}" id="row_${item.id}">
          <input type="checkbox" class="v-chk" data-id="${item.id}" ${cur.checked ? 'checked' : ''}>
          <label class="label">${item.name}</label>
          ${!item.noAmount ? `
          <div class="detail">
            <div class="amount-row">
              ${item.presets.map(p => `<div class="amount-chip ${cur.amount === p ? 'selected' : ''}" data-id="${item.id}" data-val="${p}">${p}</div>`).join('')}
              <div class="amount-chip ${isCustom ? 'selected' : ''}" data-id="${item.id}" data-val="__other__">其他</div>
            </div>
            <input type="text" class="amount-custom ${isCustom ? 'show' : ''}" id="custom_${item.id}" placeholder="請輸入保額" value="${isCustom ? cur.amount : ''}">
          </div>` : ''}
        </div>`;
      }).join('');
    },
    afterRender(root) {
      root.querySelectorAll('.v-chk').forEach(chk => {
        chk.addEventListener('change', () => {
          const id = chk.dataset.id;
          if (!state.voluntaryItems[id]) state.voluntaryItems[id] = { checked: false, amount: '' };
          state.voluntaryItems[id].checked = chk.checked;
          root.querySelector(`#row_${id}`).classList.toggle('checked', chk.checked);
        });
      });
      root.querySelectorAll('.amount-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const id = chip.dataset.id;
          const row = root.querySelector(`#row_${id}`);
          row.querySelectorAll('.amount-chip').forEach(c => c.classList.remove('selected'));
          chip.classList.add('selected');
          const customInput = root.querySelector(`#custom_${id}`);
          if (chip.dataset.val === '__other__') {
            customInput.classList.add('show');
            state.voluntaryItems[id].amount = customInput.value.trim();
            customInput.focus();
          } else {
            customInput.classList.remove('show');
            state.voluntaryItems[id].amount = chip.dataset.val;
          }
        });
      });
      root.querySelectorAll('.amount-custom').forEach(inp => {
        inp.addEventListener('input', () => {
          const id = inp.id.replace('custom_', '');
          state.voluntaryItems[id].amount = inp.value.trim();
        });
      });
    },
    collect() {
      const anyChecked = Object.values(state.voluntaryItems).some(v => v.checked);
      if (!anyChecked) { alert('請至少勾選一項任意險投保內容'); return false; }
      for (const item of VOLUNTARY_ITEMS) {
        const v = state.voluntaryItems[item.id];
        if (v && v.checked && !item.noAmount && !v.amount) {
          alert(`請設定「${item.name}」的保額`); return false;
        }
      }
      return true;
    }
  };
}

function stepInsuredName() {
  return {
    eyebrow: '被保人', title: '被保人姓名',
    render() {
      return `<div class="field"><label>被保人姓名</label>
        <input type="text" id="f_name" value="${state.insuredName}" placeholder="請輸入姓名"></div>`;
    },
    afterRender() {},
    collect(root) {
      state.insuredName = root.querySelector('#f_name').value.trim();
      if (!state.insuredName) { alert('請輸入被保人姓名'); return false; }
      return true;
    }
  };
}

function stepPremium() {
  return {
    eyebrow: '保費', title: '總保費',
    render() {
      return `<div class="field"><label>總保費（新台幣）</label>
        <input type="text" inputmode="numeric" id="f_premium" value="${state.totalPremium}" placeholder="例如：12500"></div>`;
    },
    afterRender() {},
    collect(root) {
      state.totalPremium = root.querySelector('#f_premium').value.trim();
      if (!state.totalPremium) { alert('請輸入總保費'); return false; }
      return true;
    }
  };
}

function stepPeriod() {
  return {
    eyebrow: '保險期間', title: '起保日與迄保日',
    subtitle: '以滾輪選擇保險期間的起訖日期（民國年／月／日）',
    render() {
      return `
        <div class="field"><label>起保日</label><div id="wheel_period_start"></div></div>
        <div class="field"><label>迄保日</label><div id="wheel_period_end"></div></div>
      `;
    },
    afterRender(root) {
      const years = range(CURRENT_ROC_YEAR - 3, CURRENT_ROC_YEAR + 3).map(v => ({ label: `民國${v}`, value: v }));
      renderWheelGroup(root.querySelector('#wheel_period_start'), [
        { id: 'psy', caption: '年', items: years, initialValue: state.periodStart.y || CURRENT_ROC_YEAR, onChange: v => state.periodStart.y = v },
        { id: 'psm', caption: '月', items: range(1, 12).map(v => ({ label: v, value: v })), initialValue: state.periodStart.m, onChange: v => state.periodStart.m = v },
        { id: 'psd', caption: '日', items: range(1, 31).map(v => ({ label: v, value: v })), initialValue: state.periodStart.d, onChange: v => state.periodStart.d = v },
      ]);
      renderWheelGroup(root.querySelector('#wheel_period_end'), [
        { id: 'pey', caption: '年', items: years, initialValue: state.periodEnd.y || CURRENT_ROC_YEAR + 1, onChange: v => state.periodEnd.y = v },
        { id: 'pem', caption: '月', items: range(1, 12).map(v => ({ label: v, value: v })), initialValue: state.periodEnd.m, onChange: v => state.periodEnd.m = v },
        { id: 'ped', caption: '日', items: range(1, 31).map(v => ({ label: v, value: v })), initialValue: state.periodEnd.d, onChange: v => state.periodEnd.d = v },
      ]);
    },
    collect() {
      const startIso = rocToIso(state.periodStart.y, state.periodStart.m, state.periodStart.d);
      const endIso = rocToIso(state.periodEnd.y, state.periodEnd.m, state.periodEnd.d);
      if (!startIso || !endIso) { alert('請設定起保日與迄保日'); return false; }
      if (endIso <= startIso) { alert('迄保日必須晚於起保日'); return false; }
      return true;
    }
  };
}

function stepVehicleInfo() {
  return {
    eyebrow: '車籍資料', title: '車輛詳細資料',
    render() {
      const years = range(50, CURRENT_ROC_YEAR).map(v => ({ label: `民國${v}`, value: v }));
      const months = range(1, 12).map(v => ({ label: v, value: v }));
      const days = range(1, 31).map(v => ({ label: v, value: v }));
      return `
        <div class="inline-row">
          <div class="field"><label>車牌號碼</label><input type="text" value="${state.plate}" disabled></div>
          <div class="field"><label>車種</label><input type="text" value="${state.vehicleType}" disabled></div>
        </div>
        <div class="field"><label>原發照日（民國年／月／日）</label><div id="wheel_license"></div></div>
        <div class="field"><label>出廠年月（西元年／月）</label><div id="wheel_mfg"></div></div>
        <div class="inline-row">
          <div class="field"><label>排氣量（c.c.）</label><input type="text" inputmode="numeric" id="f_disp" value="${state.displacement}" placeholder="例如：1498"></div>
          <div class="field"><label>乘載人數</label><div id="wheel_seat"></div></div>
        </div>
        <div class="field"><label>引擎號碼</label><input type="text" id="f_engine" value="${state.engineNumber}"></div>
        <div class="field"><label>廠牌型式</label><input type="text" id="f_brand" value="${state.brandModel}" placeholder="例如：TOYOTA COROLLA ALTIS"></div>
      `;
    },
    afterRender(root) {
      const years = range(50, CURRENT_ROC_YEAR).map(v => ({ label: `民國${v}`, value: v }));
      renderWheelGroup(root.querySelector('#wheel_license'), [
        { id: 'ly', caption: '年', items: years, initialValue: state.license.y || CURRENT_ROC_YEAR - 5, onChange: v => state.license.y = v },
        { id: 'lm', caption: '月', items: range(1, 12).map(v => ({ label: v, value: v })), initialValue: state.license.m, onChange: v => state.license.m = v },
        { id: 'ld', caption: '日', items: range(1, 31).map(v => ({ label: v, value: v })), initialValue: state.license.d, onChange: v => state.license.d = v },
      ]);
      const adYears = range(1980, CURRENT_AD_YEAR).map(v => ({ label: v, value: v }));
      renderWheelGroup(root.querySelector('#wheel_mfg'), [
        { id: 'my', caption: '年', items: adYears, initialValue: state.mfg.y || CURRENT_AD_YEAR - 5, onChange: v => state.mfg.y = v },
        { id: 'mm', caption: '月', items: range(1, 12).map(v => ({ label: v, value: v })), initialValue: state.mfg.m, onChange: v => state.mfg.m = v },
      ]);
      renderWheelGroup(root.querySelector('#wheel_seat'), [
        { id: 'seat', caption: '人', items: range(1, 9).map(v => ({ label: v, value: v })), initialValue: state.seatingCapacity, onChange: v => state.seatingCapacity = v },
      ]);

      const wireUppercase = (inputEl) => {
        inputEl.addEventListener('input', () => {
          const pos = inputEl.selectionStart;
          inputEl.value = inputEl.value.toUpperCase();
          inputEl.setSelectionRange(pos, pos);
        });
      };
      wireUppercase(root.querySelector('#f_engine'));
      wireUppercase(root.querySelector('#f_brand'));
    },
    collect(root) {
      state.displacement = root.querySelector('#f_disp').value.trim();
      state.engineNumber = root.querySelector('#f_engine').value.trim();
      state.brandModel = root.querySelector('#f_brand').value.trim();
      if (!state.displacement) { alert('請輸入排氣量'); return false; }
      if (!state.engineNumber) { alert('請輸入引擎號碼'); return false; }
      if (!state.brandModel) { alert('請輸入廠牌型式'); return false; }
      return true;
    }
  };
}

function stepInsuredInfo() {
  return {
    eyebrow: '被保人資料', title: '被保人詳細資料',
    render() {
      return `
        <div class="field"><label>被保人姓名</label><input type="text" value="${state.insuredName}" disabled></div>
        <div class="field"><label>身分證字號</label><input type="text" id="f_id" value="${state.insuredIdNumber}" maxlength="10" placeholder="A123456789"></div>
        <div class="field"><label>出生日期（民國年／月／日）</label><div id="wheel_birth"></div></div>
        <div class="field"><label>聯絡電話</label>
          <div class="prefix-input"><div class="prefix">09</div><input type="text" id="f_phone" inputmode="numeric" maxlength="8" value="${state.phoneSuffix}" placeholder="12345678"></div>
        </div>
        <div class="field"><label>電子信箱</label>
          <div class="email-row">
            <input type="text" id="f_email_local" value="${state.emailLocal}" placeholder="your.name">
            <span class="at">@</span>
            <select id="f_email_domain">
              ${EMAIL_DOMAINS.map(d => `<option value="${d}" ${state.emailDomain === d ? 'selected' : ''}>${d}</option>`).join('')}
            </select>
          </div>
          <input type="text" id="f_email_domain_custom" class="amount-custom ${state.emailDomain === '其他' ? 'show' : ''}" placeholder="請輸入網域，例如 mycompany.com.tw" value="${state.emailDomainCustom}">
        </div>
        <div class="field"><label>住址</label>
          <div class="inline-row">
            <input type="text" id="f_zip" maxlength="3" inputmode="numeric" placeholder="郵遞區號3碼" value="${state.zipcode}">
            <select id="f_city"><option value="">縣市</option>${CITY_LIST.map(c => `<option value="${c}" ${state.city === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
            <select id="f_district"><option value="">鄉鎮市區</option></select>
          </div>
          <input type="text" id="f_addr_detail" style="margin-top:10px;" value="${state.addressDetail}" placeholder="請輸入詳細地址（路名、巷弄、門牌號）">
        </div>
      `;
    },
    afterRender(root) {
      const years = range(30, CURRENT_ROC_YEAR - 15).map(v => ({ label: `民國${v}`, value: v }));
      renderWheelGroup(root.querySelector('#wheel_birth'), [
        { id: 'by', caption: '年', items: years, initialValue: state.birth.y || CURRENT_ROC_YEAR - 35, onChange: v => state.birth.y = v },
        { id: 'bm', caption: '月', items: range(1, 12).map(v => ({ label: v, value: v })), initialValue: state.birth.m, onChange: v => state.birth.m = v },
        { id: 'bd', caption: '日', items: range(1, 31).map(v => ({ label: v, value: v })), initialValue: state.birth.d, onChange: v => state.birth.d = v },
      ]);

      const domainSelect = root.querySelector('#f_email_domain');
      const domainCustom = root.querySelector('#f_email_domain_custom');
      domainSelect.addEventListener('change', () => {
        domainCustom.classList.toggle('show', domainSelect.value === '其他');
      });

      const zipInput = root.querySelector('#f_zip');
      const citySelect = root.querySelector('#f_city');
      const districtSelect = root.querySelector('#f_district');

      function fillDistricts(city, preselect) {
        const districts = districtsForCity(city);
        districtSelect.innerHTML = `<option value="">鄉鎮市區</option>` +
          districts.map(d => `<option value="${d}" ${d === preselect ? 'selected' : ''}>${d}</option>`).join('');
      }
      if (state.city) fillDistricts(state.city, state.district);

      zipInput.addEventListener('input', () => {
        zipInput.value = zipInput.value.replace(/\D/g, '');
        if (zipInput.value.length === 3) {
          const matches = ZIP_BY_CODE[zipInput.value];
          if (matches && matches.length) {
            citySelect.value = matches[0].city;
            fillDistricts(matches[0].city, matches.length === 1 ? matches[0].district : '');
          }
        }
      });
      citySelect.addEventListener('change', () => {
        fillDistricts(citySelect.value, '');
        zipInput.value = '';
      });
      districtSelect.addEventListener('change', () => {
        const code = ZIP_BY_DISTRICT[citySelect.value + districtSelect.value];
        if (code) zipInput.value = code;
      });
    },
    collect(root) {
      state.insuredIdNumber = root.querySelector('#f_id').value.trim().toUpperCase();
      state.phoneSuffix = root.querySelector('#f_phone').value.trim();
      state.emailLocal = root.querySelector('#f_email_local').value.trim();
      state.emailDomain = root.querySelector('#f_email_domain').value;
      state.emailDomainCustom = root.querySelector('#f_email_domain_custom').value.trim();
      state.zipcode = root.querySelector('#f_zip').value.trim();
      state.city = root.querySelector('#f_city').value;
      state.district = root.querySelector('#f_district').value;
      state.addressDetail = root.querySelector('#f_addr_detail').value.trim();

      if (!state.insuredIdNumber) { alert('請輸入身分證字號'); return false; }
      if (!state.phoneSuffix) { alert('請輸入電話號碼'); return false; }
      if (!state.emailLocal) { alert('請輸入電子信箱'); return false; }
      if (state.emailDomain === '其他' && !state.emailDomainCustom) { alert('請輸入信箱網域'); return false; }
      if (!state.zipcode || !state.city || !state.district) { alert('請完成郵遞區號／縣市／鄉鎮市區'); return false; }
      if (!state.addressDetail) { alert('請輸入詳細地址'); return false; }
      return true;
    }
  };
}

function stepReview() {
  return {
    eyebrow: '確認建檔', title: '資料確認',
    render() {
      const domain = state.emailDomain === '其他' ? state.emailDomainCustom : state.emailDomain;
      const voluntaryLines = Object.entries(state.voluntaryItems)
        .filter(([, v]) => v.checked)
        .map(([id, v]) => {
          const def = VOLUNTARY_ITEMS.find(i => i.id === id);
          return `<div class="row"><span class="k">${def.name}</span><span class="v">${def.noAmount ? '已投保' : v.amount}</span></div>`;
        }).join('');
      return `
        <div class="review-list">
          <div class="grp-title">車輛與險種</div>
          <div class="row"><span class="k">車牌號碼</span><span class="v">${state.plate}</span></div>
          <div class="row"><span class="k">車種</span><span class="v">${state.vehicleType}</span></div>
          ${state.hasCompulsory ? `<div class="row"><span class="k">強制險保單號碼</span><span class="v">${state.compulsoryPolicyNo}</span></div>` : ''}
          ${state.hasVoluntary ? `<div class="row"><span class="k">任意險保單號碼</span><span class="v">${state.voluntaryPolicyNo}</span></div>` : ''}
          ${voluntaryLines ? `<div class="grp-title">任意險投保內容</div>${voluntaryLines}` : ''}

          <div class="grp-title">保費與期間</div>
          <div class="row"><span class="k">被保人</span><span class="v">${state.insuredName}</span></div>
          <div class="row"><span class="k">總保費</span><span class="v">NT$ ${state.totalPremium}</span></div>
          <div class="row"><span class="k">起保日</span><span class="v">民國${state.periodStart.y}年${state.periodStart.m}月${state.periodStart.d}日</span></div>
          <div class="row"><span class="k">迄保日</span><span class="v">民國${state.periodEnd.y}年${state.periodEnd.m}月${state.periodEnd.d}日</span></div>

          <div class="grp-title">車籍資料</div>
          <div class="row"><span class="k">原發照日</span><span class="v">民國${state.license.y}年${state.license.m}月${state.license.d}日</span></div>
          <div class="row"><span class="k">出廠年月</span><span class="v">${state.mfg.y} 年 ${state.mfg.m} 月</span></div>
          <div class="row"><span class="k">排氣量</span><span class="v">${state.displacement} c.c.</span></div>
          <div class="row"><span class="k">乘載人數</span><span class="v">${state.seatingCapacity} 人</span></div>
          <div class="row"><span class="k">引擎號碼</span><span class="v">${state.engineNumber}</span></div>
          <div class="row"><span class="k">廠牌型式</span><span class="v">${state.brandModel}</span></div>

          <div class="grp-title">被保人資料</div>
          <div class="row"><span class="k">身分證字號</span><span class="v">${state.insuredIdNumber}</span></div>
          <div class="row"><span class="k">出生日期</span><span class="v">民國${state.birth.y}年${state.birth.m}月${state.birth.d}日</span></div>
          <div class="row"><span class="k">電話</span><span class="v">09${state.phoneSuffix}</span></div>
          <div class="row"><span class="k">信箱</span><span class="v">${state.emailLocal}@${domain}</span></div>
          <div class="row"><span class="k">住址</span><span class="v">${state.zipcode} ${state.city}${state.district}${state.addressDetail}</span></div>
        </div>
      `;
    },
    afterRender() {},
    collect() { return true; },
    isFinal: true,
  };
}

// ============================================================
// CONTROLLER
// ============================================================
let currentIndex = 0;

function buildPayload() {
  const domain = state.emailDomain === '其他' ? state.emailDomainCustom : state.emailDomain;
  return {
    plate_number: state.plate,
    vehicle_type: state.vehicleType,
    has_compulsory: state.hasCompulsory,
    compulsory_policy_no: state.compulsoryPolicyNo,
    has_voluntary: state.hasVoluntary,
    voluntary_policy_no: state.voluntaryPolicyNo,
    voluntary_items: Object.entries(state.voluntaryItems).filter(([, v]) => v.checked).map(([id, v]) => {
      const def = VOLUNTARY_ITEMS.find(i => i.id === id);
      return { item: def.name, amount: def.noAmount ? null : v.amount };
    }),
    insured_name: state.insuredName,
    total_premium: state.totalPremium,
    policy_start_date: rocToIso(state.periodStart.y, state.periodStart.m, state.periodStart.d),
    policy_end_date: rocToIso(state.periodEnd.y, state.periodEnd.m, state.periodEnd.d),
    vehicle_license_date: rocToIso(state.license.y, state.license.m, state.license.d),
    vehicle_manufacture_date: state.mfg.y ? `${state.mfg.y}-${pad2(state.mfg.m)}` : null,
    displacement: state.displacement,
    seating_capacity: state.seatingCapacity,
    engine_number: state.engineNumber,
    brand_model: state.brandModel,
    insured_id_number: state.insuredIdNumber,
    insured_birthdate: rocToIso(state.birth.y, state.birth.m, state.birth.d),
    insured_phone: '09' + state.phoneSuffix,
    insured_email: `${state.emailLocal}@${domain}`,
    insured_zipcode: state.zipcode,
    insured_city: state.city,
    insured_district: state.district,
    insured_address_detail: state.addressDetail,
  };
}

function renderRail(steps) {
  const rail = document.getElementById('rail');
  rail.innerHTML = steps.map((s, i) => `<div class="seg ${i < currentIndex ? 'done' : (i === currentIndex ? 'active' : '')}"></div>`).join('');
  document.getElementById('stepTag').textContent = `STEP ${String(currentIndex + 1).padStart(2, '0')} / ${String(steps.length).padStart(2, '0')}`;
}

function renderStep() {
  const steps = getSteps();
  if (currentIndex >= steps.length) currentIndex = steps.length - 1;
  const step = steps[currentIndex];
  doneScreenActive = false;
  renderRail(steps);

  const finalLabel = state.editingId ? '更新資料' : '完成建檔';
  const card = document.getElementById('wizardCard');
  card.innerHTML = `
    <div class="step-eyebrow">${step.eyebrow}</div>
    <div class="step-title">${step.title}</div>
    ${step.subtitle ? `<div class="step-sub">${step.subtitle}</div>` : ''}
    <div id="stepBody"></div>
    <div class="nav-row">
      <button type="button" class="btn btn-ghost" id="btnPrev" ${currentIndex === 0 ? 'disabled' : ''}>上一步</button>
      <button type="button" class="btn ${step.isFinal ? 'btn-finish' : 'btn-primary'}" id="btnNext">${step.isFinal ? finalLabel : '下一步'}</button>
    </div>
  `;
  const body = card.querySelector('#stepBody');
  body.innerHTML = step.render();
  step.afterRender(card);

  card.querySelector('#btnPrev').addEventListener('click', () => {
    currentIndex = Math.max(0, currentIndex - 1);
    renderStep();
  });
  card.querySelector('#btnNext').addEventListener('click', async () => {
    if (!step.collect(card)) return;
    if (step.isFinal) {
      const isEdit = !!state.editingId;
      const btn = card.querySelector('#btnNext');
      const busyLabel = isEdit ? '更新中...' : '建檔中...';
      const idleLabel = isEdit ? '更新資料' : '完成建檔';
      btn.disabled = true; btn.textContent = busyLabel;
      try {
        if (isEdit) {
          await dbUpdate(state.editingId, buildPayload());
        } else {
          await dbAdd(buildPayload());
        }
        showDoneScreen(isEdit);
      } catch (e) {
        alert((isEdit ? '更新失敗：' : '建檔失敗：') + (e && e.message ? e.message : '未知錯誤'));
        btn.disabled = false; btn.textContent = idleLabel;
      }
      return;
    }
    currentIndex++;
    renderStep();
  });
}

function showDoneScreen(isEdit) {
  doneScreenActive = true;
  const card = document.getElementById('wizardCard');
  const title = isEdit ? '更新完成' : '建檔完成';
  const verb = isEdit ? '成功更新' : '成功建立';
  card.innerHTML = `
    <div style="text-align:center; padding:20px 0 6px;">
      <div class="done-icon">✓</div>
      <div class="step-title" style="text-align:center;">${title}</div>
      <div class="stub" style="text-align:left; margin:0 auto 26px; max-width:420px;">
        <b>${state.plate}</b>（${state.vehicleType}）已${verb}保單資料。<br>
        被保人：<b>${state.insuredName}</b>
      </div>
      <button type="button" class="btn btn-primary" id="btnAnother">建立下一筆</button>
      <button type="button" class="btn btn-ghost" id="btnGoList">查看已建檔案</button>
    </div>
  `;
  document.getElementById('rail').innerHTML = '';
  const tag = document.getElementById('stepTag');
  tag.textContent = 'DONE';
  tag.classList.add('clickable');
  card.querySelector('#btnAnother').addEventListener('click', resetWizard);
  card.querySelector('#btnGoList').addEventListener('click', () => { showList(); });
}

function resetWizard() {
  Object.assign(state, {
    plate: '', vehicleType: '',
    hasCompulsory: false, compulsoryPolicyNo: '',
    hasVoluntary: false, voluntaryPolicyNo: '',
    voluntaryItems: {},
    insuredName: '', totalPremium: '',
    periodStart: { y: null, m: 1, d: 1 },
    periodEnd: { y: null, m: 1, d: 1 },
    license: { y: null, m: 1, d: 1 },
    mfg: { y: null, m: 1 },
    displacement: '', seatingCapacity: 2,
    engineNumber: '', brandModel: '',
    insuredIdNumber: '',
    birth: { y: null, m: 1, d: 1 },
    phoneSuffix: '',
    emailLocal: '', emailDomain: 'gmail.com', emailDomainCustom: '',
    zipcode: '', city: '', district: '', addressDetail: '',
    editingId: null,
  });
  doneScreenActive = false;
  currentIndex = 0;
  showForm();
}

// ---------- list view ----------
async function showList() {
  document.getElementById('wizardWrap').style.display = 'none';
  document.getElementById('detailWrap').style.display = 'none';
  document.getElementById('listWrap').style.display = 'block';
  document.getElementById('rail').style.display = 'none';
  document.getElementById('navList').classList.add('active');
  document.getElementById('navForm').classList.remove('active');
  const holder = document.getElementById('recordsTableHolder');
  holder.textContent = '載入中...';
  const rows = await dbGetAll();
  if (!rows.length) { holder.innerHTML = '<p>目前尚無建檔資料。</p>'; return; }
  holder.innerHTML = `
    <table class="records">
      <thead><tr><th>車牌</th><th>保戶名字</th><th></th><th></th></tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr class="record-row" data-id="${r.id}" style="cursor:pointer;">
            <td>${r.plate_number}</td>
            <td>${r.insured_name || ''}</td>
            <td><span class="edit-btn" data-id="${r.id}" style="color:var(--navy); cursor:pointer; font-size:12px; font-weight:700;">編輯資料</span></td>
            <td><span class="del-btn" data-id="${r.id}">刪除</span></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  holder.querySelectorAll('.record-row').forEach(row => {
    row.addEventListener('click', () => showDetail(row.dataset.id));
  });
  holder.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      startEdit(btn.dataset.id);
    });
  });
  holder.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('確定要刪除這筆資料嗎？')) return;
      await dbDelete(btn.dataset.id);
      showList();
    });
  });
}

// 反向操作：把一筆已存在的資料「灌回」state，讓精靈可以重複使用來編輯
function loadStateFromRecord(r) {
  const mfgParts = r.vehicle_manufacture_date ? r.vehicle_manufacture_date.split('-') : [null, '1'];

  const voluntaryItems = {};
  (r.voluntary_items || []).forEach(v => {
    const def = VOLUNTARY_ITEMS.find(i => i.name === v.item);
    if (def) voluntaryItems[def.id] = { checked: true, amount: v.amount || '' };
  });

  let emailLocal = '', emailDomain = 'gmail.com', emailDomainCustom = '';
  if (r.insured_email && r.insured_email.includes('@')) {
    const [local, domain] = r.insured_email.split('@');
    emailLocal = local;
    if (EMAIL_DOMAINS.includes(domain)) {
      emailDomain = domain;
    } else {
      emailDomain = '其他';
      emailDomainCustom = domain;
    }
  }

  Object.assign(state, {
    editingId: r.id,
    plate: r.plate_number || '',
    vehicleType: r.vehicle_type || '',
    hasCompulsory: !!r.has_compulsory,
    compulsoryPolicyNo: r.compulsory_policy_no || '',
    hasVoluntary: !!r.has_voluntary,
    voluntaryPolicyNo: r.voluntary_policy_no || '',
    voluntaryItems,
    insuredName: r.insured_name || '',
    totalPremium: r.total_premium || '',
    periodStart: isoToRoc(r.policy_start_date) || { y: null, m: 1, d: 1 },
    periodEnd: isoToRoc(r.policy_end_date) || { y: null, m: 1, d: 1 },
    license: isoToRoc(r.vehicle_license_date) || { y: null, m: 1, d: 1 },
    mfg: { y: mfgParts[0] ? Number(mfgParts[0]) : null, m: mfgParts[1] ? Number(mfgParts[1]) : 1 },
    displacement: r.displacement || '',
    seatingCapacity: r.seating_capacity || 2,
    engineNumber: r.engine_number || '',
    brandModel: r.brand_model || '',
    insuredIdNumber: r.insured_id_number || '',
    birth: isoToRoc(r.insured_birthdate) || { y: null, m: 1, d: 1 },
    phoneSuffix: (r.insured_phone || '').replace(/^09/, ''),
    emailLocal, emailDomain, emailDomainCustom,
    zipcode: r.insured_zipcode || '',
    city: r.insured_city || '',
    district: r.insured_district || '',
    addressDetail: r.insured_address_detail || '',
  });
}

async function startEdit(id) {
  const rec = await dbGet(id);
  if (!rec) { alert('找不到這筆資料'); return; }
  loadStateFromRecord(rec);
  doneScreenActive = false;
  currentIndex = 0;
  showForm();
}

function isoToRoc(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return { y: y - 1911, m, d };
}

function renderRecordDetail(r) {
  const start = isoToRoc(r.policy_start_date);
  const end = isoToRoc(r.policy_end_date);
  const license = isoToRoc(r.vehicle_license_date);
  const birth = isoToRoc(r.insured_birthdate);
  const mfg = r.vehicle_manufacture_date ? r.vehicle_manufacture_date.split('-') : null;
  const voluntaryLines = (r.voluntary_items || []).map(v =>
    `<div class="row"><span class="k">${v.item}</span><span class="v">${v.amount || '已投保'}</span></div>`
  ).join('');

  return `
    <div class="review-list">
      <div class="grp-title">車輛與險種</div>
      <div class="row"><span class="k">車牌號碼</span><span class="v">${r.plate_number}</span></div>
      <div class="row"><span class="k">車種</span><span class="v">${r.vehicle_type}</span></div>
      ${r.has_compulsory ? `<div class="row"><span class="k">強制險保單號碼</span><span class="v">${r.compulsory_policy_no || ''}</span></div>` : ''}
      ${r.has_voluntary ? `<div class="row"><span class="k">任意險保單號碼</span><span class="v">${r.voluntary_policy_no || ''}</span></div>` : ''}
      ${voluntaryLines ? `<div class="grp-title">任意險投保內容</div>${voluntaryLines}` : ''}

      <div class="grp-title">保費與期間</div>
      <div class="row"><span class="k">被保人</span><span class="v">${r.insured_name || ''}</span></div>
      <div class="row"><span class="k">總保費</span><span class="v">NT$ ${r.total_premium || ''}</span></div>
      <div class="row"><span class="k">起保日</span><span class="v">${start ? `民國${start.y}年${start.m}月${start.d}日` : ''}</span></div>
      <div class="row"><span class="k">迄保日</span><span class="v">${end ? `民國${end.y}年${end.m}月${end.d}日` : ''}</span></div>

      <div class="grp-title">車籍資料</div>
      <div class="row"><span class="k">原發照日</span><span class="v">${license ? `民國${license.y}年${license.m}月${license.d}日` : ''}</span></div>
      <div class="row"><span class="k">出廠年月</span><span class="v">${mfg ? `${mfg[0]} 年 ${Number(mfg[1])} 月` : ''}</span></div>
      <div class="row"><span class="k">排氣量</span><span class="v">${r.displacement || ''} c.c.</span></div>
      <div class="row"><span class="k">乘載人數</span><span class="v">${r.seating_capacity || ''} 人</span></div>
      <div class="row"><span class="k">引擎號碼</span><span class="v">${r.engine_number || ''}</span></div>
      <div class="row"><span class="k">廠牌型式</span><span class="v">${r.brand_model || ''}</span></div>

      <div class="grp-title">被保人資料</div>
      <div class="row"><span class="k">身分證字號</span><span class="v">${r.insured_id_number || ''}</span></div>
      <div class="row"><span class="k">出生日期</span><span class="v">${birth ? `民國${birth.y}年${birth.m}月${birth.d}日` : ''}</span></div>
      <div class="row"><span class="k">電話</span><span class="v">${r.insured_phone || ''}</span></div>
      <div class="row"><span class="k">信箱</span><span class="v">${r.insured_email || ''}</span></div>
      <div class="row"><span class="k">住址</span><span class="v">${r.insured_zipcode || ''} ${r.insured_city || ''}${r.insured_district || ''}${r.insured_address_detail || ''}</span></div>
    </div>
  `;
}

async function showDetail(id) {
  document.getElementById('wizardWrap').style.display = 'none';
  document.getElementById('listWrap').style.display = 'none';
  document.getElementById('detailWrap').style.display = 'block';
  document.getElementById('rail').style.display = 'none';
  const holder = document.getElementById('detailHolder');
  holder.textContent = '載入中...';
  const rec = await dbGet(id);
  if (!rec) { holder.innerHTML = '<p>找不到這筆資料。</p>'; return; }
  holder.innerHTML = renderRecordDetail(rec);
  const editBtn = document.getElementById('btnEditRecord');
  if (editBtn) editBtn.onclick = () => startEdit(id);
}

document.getElementById('btnBackToList').addEventListener('click', showList);

function showForm() {
  document.getElementById('listWrap').style.display = 'none';
  document.getElementById('detailWrap').style.display = 'none';
  document.getElementById('wizardWrap').style.display = 'block';
  document.getElementById('rail').style.display = 'flex';
  document.getElementById('navForm').classList.add('active');
  document.getElementById('navList').classList.remove('active');
  renderStep();
}

document.getElementById('navForm').addEventListener('click', (e) => {
  e.preventDefault();
  // 如果精靈目前停在「建檔完成／更新完成」畫面，點「新增建檔」要重新開始一份全新的，
  // 不然會殘留剛剛編輯過的舊資料。
  if (doneScreenActive) { resetWizard(); } else { showForm(); }
});
document.getElementById('navList').addEventListener('click', (e) => { e.preventDefault(); showList(); });
document.getElementById('stepTag').addEventListener('click', () => {
  if (doneScreenActive) resetWizard();
});

// init
showForm();