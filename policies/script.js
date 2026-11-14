// ============================================================
// 產險管理（客戶保單管理）- 前端邏輯
// ============================================================

const CURRENT_ROC_YEAR = new Date().getFullYear() - 1911;
const CURRENT_AD_YEAR = new Date().getFullYear();

const state = {
  category: null, // 'vehicle' | 'personal' | 'business'（今天只做 vehicle 與 personal）
  plate: '', vehicleType: '',
  hasCompulsory: false, compulsoryPolicyNo: '',
  hasVoluntary: false, voluntaryPolicyNo: '',
  volRows: {}, // 任意險每一列：rowId -> {checked, variant, amounts: {代號: 保額}}
  legacyVoluntary: [], // 舊版才有、新清單已拿掉的任意險項目（原樣保留，不會因為編輯而消失）
  personalItems: {}, // id -> {checked, plans: []}
  insuredName: '',
  totalPremium: '',
  periodStart: { y: null, m: 1, d: 1 },
  periodEnd: { y: null, m: 1, d: 1 },
  // 汽/機車：強制險與任意險各自的保期；任意險可勾「同強制險」
  volStart: { y: null, m: 1, d: 1 },
  volEnd: { y: null, m: 1, d: 1 },
  volSameAsComp: true,
  license: { y: null, m: 1, d: 1 },
  mfg: { y: null, m: 1 },
  displacement: '', seatingCapacity: 2,
  engineNumber: '', brandModel: '',
  insuredIdNumber: '',
  birth: { y: null, m: 1, d: 1 },
  phoneSuffix: '',
  emailLocal: '', emailDomain: 'gmail.com', emailDomainCustom: '',
  zipcode: '', city: '', district: '', addressDetail: '',
  employer: '', jobTitle: '', // 個人保險專用：在職公司／職稱
};

const CATEGORIES = [
  { id: 'vehicle', label: '汽/機車保險', enabled: true },
  { id: 'personal', label: '個人保險', enabled: true },
];

const VEHICLE_TYPES = ['汽車', '普重', '大重'];

// ------------------------------------------------------------
// 任意險：每個代號的名稱與常用保額
// old：舊版用過的名稱，讀舊資料時對得回來
// ------------------------------------------------------------
const P_BODY = ['每人100萬/每一事故200萬', '每人200萬/每一事故400萬', '每人300萬/每一事故600萬'];
const P_PROP = ['30萬', '50萬', '100萬', '200萬'];
const P_EXCESS = ['300萬', '500萬', '1000萬'];
const P_PASSENGER = ['每人100萬/每一事故100萬', '每人200萬/每一事故200萬'];
const VOL_CODES = {
  // ----- 車損險（保額選填） -----
  '0G':       { name: '機車火災事故險', presets: [], optional: true },
  '0J':       { name: '車體免追償', presets: [], optional: true },
  '0K':       { name: '交通費用附加險', presets: [], optional: true },
  '0L':       { name: '汽車限額車碰車對撞', presets: [], optional: true },
  '0X':       { name: '特定事故汽機車代車費用補償險', presets: [], optional: true },
  '18':       { name: '機車整車失竊損失險', presets: [], optional: true },
  // ----- 附加條款（不需保額） -----
  'KP02':     { name: '車隊附加條款（法人專用｜100台以上）', noAmount: true },
  'KP05':     { name: '教練車使用附加條款', noAmount: true },
  'KP12':     { name: '車隊附加條款（法人專用｜5台以上）', noAmount: true },
  'KP17':     { name: '營業機車附加條款', noAmount: true },
  // ----- 責任險 -----
  '27A':      { name: '慰問金保險-乙型', presets: ['5萬'], old: ['慰問金保險'] },
  '27A1':     { name: '慰問金保險-甲型', presets: ['5萬'] },
  '31':       { name: '第三人責任險-體傷', presets: P_BODY },
  '32':       { name: '第三人責任險-財損', presets: P_PROP },
  '30G':      { name: '超額責任險-甲式', presets: P_EXCESS, old: ['超額責任險 甲式'] },
  '30G1':     { name: '超額責任險-乙式(保險期間)', presets: P_EXCESS, old: ['超額責任險 乙式(保險期間)'] },
  '30G2':     { name: '超額責任險-乙式(每一事故)', presets: P_EXCESS, old: ['超額責任險 乙式(每一事故)'] },
  '3B27':     { name: '機車第三人責任-慰問金', presets: ['5萬'], old: ['機車第三人責任險-慰問金'] },
  '3B31':     { name: '機車第三人責任-傷害', presets: P_BODY, old: ['機車第三人責任險-傷害'] },
  '3B32':     { name: '機車第三人責任-財損', presets: P_PROP, old: ['機車第三人責任險-財損'] },
  '3FA':      { name: '機車第三人責任保險-單一保額型', presets: ['500萬', '800萬', '1000萬'], old: ['機車第三人責任險-單一保額型'] },
  '38':       { name: '刑事訴訟律師費用補償險', presets: ['5萬'] },
  '50B':      { name: '駕傷實支', presets: ['5萬/200萬'], old: ['駕駛人傷害險-實支實付'] },
  '59':       { name: '駕傷（機車單一事故）', presets: ['20萬/200萬', '20萬/300萬'], old: ['單一事故駕駛人傷害險-機車'] },
  '51A':      { name: '乘客體傷責任險', presets: P_PASSENGER },
  '51A+275A': { name: '乘客體傷責任險＋附加慰問金甲型', presets: P_PASSENGER },
  '51A+275B': { name: '乘客體傷責任險＋附加慰問金乙型', presets: P_PASSENGER },
  '77C':      { name: '道路救援費用險', presets: ['30公里/3萬', '50公里/5萬', '100公里/10萬'], old: ['道路救援費用保險'] },
  '6AA1':     { name: '租賃電池損失責任保險', presets: ['2.5萬', '3萬', '4萬', '5萬'] },
  '83F1':     { name: '享安心家庭綜合保險-家庭財物被竊', presets: ['5000/50%/5萬', '10000/50%/10萬', '10000/100%/15萬'] },
  '83F2':     { name: '享安心家庭綜合保險-家庭日常生活責任', presets: ['50萬', '100萬', '150萬', '200萬'] },
};
// 畫面上的列（依這個順序顯示）
//   variants：勾選後用下拉選其中一種
//   bundle：勾選就是整組一起投保（不能拆開）
//   group：同一組的任一項被勾起來時（且同組都還沒勾），其他項一併勾選；之後可以個別取消
const VOL_SECTIONS = [
  { key: 'damage', title: '車損險' },
  { key: 'liab',   title: '責任險' },
  { key: 'clause', title: '附加條款' },
];
const VOL_ROWS = [
  { row: '0G', codes: ['0G'], section: 'damage' },
  { row: '0J', codes: ['0J'], section: 'damage' },
  { row: '0K', codes: ['0K'], section: 'damage' },
  { row: '0L', codes: ['0L'], section: 'damage' },
  { row: '0X', codes: ['0X'], section: 'damage' },
  { row: '18', codes: ['18'], section: 'damage' },
  { row: '27', label: '慰問金保險', variants: ['27A', '27A1'], group: 'tp', section: 'liab' },
  { row: '31', codes: ['31'], group: 'tp', section: 'liab' },
  { row: '32', codes: ['32'], group: 'tp', section: 'liab' },
  { row: '30', label: '超額責任險', variants: ['30G', '30G1', '30G2'], section: 'liab' },
  { row: '3B', label: '機車第三人責任（慰問金＋傷害＋財損）', bundle: ['3B27', '3B31', '3B32'], section: 'liab' },
  { row: '3FA', codes: ['3FA'], section: 'liab' },
  { row: '38', codes: ['38'], section: 'liab' },
  { row: '50B', codes: ['50B'], section: 'liab' },
  { row: '59', codes: ['59'], section: 'liab' },
  { row: '51A', label: '乘客體傷責任險', variants: ['51A', '51A+275A', '51A+275B'], section: 'liab' },
  { row: '77C', codes: ['77C'], section: 'liab' },
  { row: '6AA1', codes: ['6AA1'], section: 'liab' },
  { row: '83', label: '享安心家庭綜合保險', variants: ['83F1', '83F2'], section: 'liab' },
  { row: 'KP02', codes: ['KP02'], section: 'clause' },
  { row: 'KP05', codes: ['KP05'], section: 'clause' },
  { row: 'KP12', codes: ['KP12'], section: 'clause' },
  { row: 'KP17', codes: ['KP17'], section: 'clause' },
];
// 這一列目前要投保的代號（變體列只算選中的那一個）
function rowCodes(def, st) {
  if (def.variants) return [st.variant || def.variants[0]];
  return def.bundle || def.codes;
}
function rowOfCode(code) {
  return VOL_ROWS.find(d => (d.variants || d.bundle || d.codes).includes(code));
}
function codeFromSaved(v) {
  if (v.id && VOL_CODES[v.id]) return v.id;
  return Object.keys(VOL_CODES).find(c => VOL_CODES[c].name === v.item || (VOL_CODES[c].old || []).includes(v.item)) || null;
}
// 目前勾選的任意險（給確認頁與存檔用）
function selectedVoluntary() {
  const out = [];
  VOL_ROWS.forEach(def => {
    const st = state.volRows[def.row];
    if (!st || !st.checked) return;
    rowCodes(def, st).forEach(code => out.push({ id: code, item: VOL_CODES[code].name, amount: (st.amounts || {})[code] || '' }));
  });
  return out;
}

const EMAIL_DOMAINS = ['gmail.com', 'yahoo.com.tw','kimo.com', 'outlook.com', 'hotmail.com', 'icloud.com', '其他'];

// 個人保險商品清單。presets 是可選的「計畫」；沒有 presets 時看 note：
// note 含「請輸入」→ 顯示一個文字輸入框（例如憑證號碼）；
// 其他 note（例如單一方案說明）→ 純提示文字，不需要額外輸入。
const PERSONAL_ITEMS = [
  { id: 'accident015', name: '十全兒童2.0', presets: ['計畫A', '計畫B', '計畫C','傷害加值一', '傷害加值二', '醫療加值一', '醫療加值二'] },
  { id: 'accident123', name: '十全大補增安心', presets: ['計畫A', '計畫B', '計畫C', '計畫D', '加值一', '加值二', '加值三', '加值四'] },
  { id: 'accident004', name: '十全大補勞安型-四類', presets: ['計畫A', '計畫B', '計畫C', '加值一', '加值二', '加值三'] },
  { id: 'accident056', name: '十全大補勞安型-五、六類', presets: ['計畫A', '計畫B', '加值一', '加值二',] },
  { id: 'accident085', name: '璀璨人生', presets: ['計畫A', '計畫B', '計畫C'] },
  { id: 'accident111', name: '三星報喜', presets: ['計畫A', '計畫B', '計畫C', '計畫D', '加值一', '加值二'] },
  { id: 'medical060', name: '健康守護+3.0', presets: ['計畫A', '計畫B', '計畫C'] },
  { id: 'cancer064', name: '愛藥即時', presets: ['計畫A', '計畫B', '加值一', '加值二'] },
  { id: 'cancer065', name: '防癌無憂', presets: [], note: '此商品為單一方案，無法選擇計畫' },
  { id: 'travel001', name: '一期逐夢', presets: ['計畫A', '計畫B', '計畫C', '計畫D申根', '計畫E申根'] },
  { id: 'travel002', name: '快樂旅平卡', presets: [], note: '請輸入憑證號碼' },
  { id: 'travel003', name: '公教旅平卡', presets: [], note: '請輸入憑證號碼' },
];

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
  const steps = [stepCategory()];
  if (state.category === 'vehicle') {
    steps.push(stepPlate());
    steps.push(stepInsuranceTypes());
    if (state.hasVoluntary) steps.push(stepVoluntaryItems());
    steps.push(stepInsuredName());
    steps.push(stepPremium());
    steps.push(stepPeriod());
    steps.push(stepInsuredInfo());
    steps.push(stepVehicleInfo());
    steps.push(stepReview());
  } else if (state.category === 'personal') {
    steps.push(stepPersonalProducts());
    steps.push(stepInsuredName());
    steps.push(stepPremium());
    steps.push(stepPeriod());
    steps.push(stepInsuredInfo());
    steps.push(stepReview());
  }
  return steps;
}

function stepCategory() {
  return {
    eyebrow: '保單類別', title: '請選擇要建立的保單類別',
    render() {
      const locked = !!state.editingId;
      return `
        <div class="option-grid cat-grid" id="f_category">
          ${CATEGORIES.map(c => {
            const selected = state.category === c.id;
            const disabled = !c.enabled || locked;
            return `
            <div class="option-card ${selected ? 'selected' : ''}" data-cat="${c.id}"
                 style="${disabled ? 'opacity:.45; cursor:not-allowed;' : ''}">
              ${c.label}
              ${!c.enabled ? '<div style="font-weight:400; font-size:11px; margin-top:4px;">尚未開放</div>' : ''}
            </div>`;
          }).join('')}
        </div>
        ${locked ? '<p class="step-sub" style="margin-top:14px;">編輯既有資料時，保單類別不可更改。</p>' : ''}
      `;
    },
    afterRender(root) {
      if (state.editingId) return; // 編輯模式下鎖定類別，不能改
      root.querySelectorAll('#f_category .option-card').forEach(card => {
        const cat = CATEGORIES.find(c => c.id === card.dataset.cat);
        if (!cat.enabled) return;
        card.addEventListener('click', () => {
          if (state.category !== cat.id) {
            // 切換類別時，把另一類別專屬的欄位清掉，避免資料互相污染
            state.category = cat.id;
          }
          root.querySelectorAll('#f_category .option-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
        });
      });
    },
    collect() {
      if (!state.category) { alert('請選擇保單類別'); return false; }
      const cat = CATEGORIES.find(c => c.id === state.category);
      if (!cat.enabled) { alert('這個類別尚未開放'); return false; }
      return true;
    }
  };
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
  const amountPicker = (code, cur) => {
    const def = VOL_CODES[code];
    if (!def.presets.length) return `<input type="text" class="amount-custom show" data-code="${code}" placeholder="保額（選填）" value="${cur || ''}">`;
    const isCustom = cur && !def.presets.includes(cur);
    return `
      <div class="amount-row">
        ${def.presets.map(p => `<div class="amount-chip ${cur === p ? 'selected' : ''}" data-code="${code}" data-val="${p}">${p}</div>`).join('')}
        <div class="amount-chip ${isCustom ? 'selected' : ''}" data-code="${code}" data-val="__other__">其他</div>
      </div>
      <input type="text" class="amount-custom ${isCustom ? 'show' : ''}" data-code="${code}" placeholder="請輸入保額" value="${isCustom ? cur : ''}">`;
  };
  const rowState = (row) => (state.volRows[row] = state.volRows[row] || { checked: false, variant: '', amounts: {} });

  return {
    eyebrow: '投保內容明細', title: '投保內容與保額',
    render() {
      const panelOf = (def, st) => {
        if (def.variants && !st.variant) st.variant = def.variants[0];
        const title = def.label || VOL_CODES[def.codes[0]].name;
        if (!def.variants && !def.bundle && VOL_CODES[def.codes[0]].noAmount) return '';
        let detail;
        if (def.variants) {
          detail = `
            <select class="vol-variant" data-row="${def.row}">
              ${def.variants.map(c => `<option value="${c}" ${st.variant === c ? 'selected' : ''}>${c}　${VOL_CODES[c].name}</option>`).join('')}
            </select>
            <div class="vol-amount" data-row="${def.row}">${amountPicker(st.variant, st.amounts[st.variant])}</div>`;
        } else if (def.bundle) {
          detail = def.bundle.map(c => `
            <div class="vol-sub"><div class="vol-sub-name">${c}　${VOL_CODES[c].name}</div>${amountPicker(c, st.amounts[c])}</div>`).join('');
        } else {
          detail = amountPicker(def.codes[0], st.amounts[def.codes[0]]);
        }
        return `
        <div class="vol-panel ${st.checked ? 'show' : ''}" id="vpanel_${def.row}">
          <div class="vol-panel-head"><span class="vol-code">${def.row}</span><b>${title}</b>
            ${def.bundle ? '<span class="vol-hint">三項綁定</span>' : ''}
            ${!def.variants && !def.bundle && VOL_CODES[def.codes[0]].optional ? '<span class="vol-opt">保額選填</span>' : ''}
          </div>
          ${detail}
        </div>`;
      };
      // 強制險：只顯示，依前一步是否勾選強制險自動亮起（不算在任意險項目裡）
      const comp = `
        <section class="vol-section">
          <div class="vol-section-title">強制險<span class="vol-opt">依險種選擇自動帶入</span></div>
          <div class="vol-grid">
            <div class="vol-card vol-card-fixed ${state.hasCompulsory ? 'on' : ''}" title="${state.hasCompulsory ? '已投保強制險' : '未投保強制險'}">
              <b>21</b><small>強制險</small></div>
          </div>
        </section>`;
      return comp + VOL_SECTIONS.map(sec => {
        const defs = VOL_ROWS.filter(d => d.section === sec.key);
        const hint = sec.key === 'liab' ? '<span class="vol-hint">27／31／32 一組</span>' : sec.key === 'clause' ? '<span class="vol-opt">不需保額</span>' : '';
        return `
        <section class="vol-section">
          <div class="vol-section-title">${sec.title}${hint}</div>
          <div class="vol-grid">
            ${defs.map(def => {
              const st = rowState(def.row);
              const title = def.label || VOL_CODES[def.codes[0]].name;
              return `<button type="button" class="vol-card ${st.checked ? 'on' : ''}" id="vcard_${def.row}" data-row="${def.row}">
                <b>${def.row}</b><small>${title}</small></button>`;
            }).join('')}
          </div>
          <div class="vol-panels">${defs.map(def => panelOf(def, rowState(def.row))).join('')}</div>
        </section>`;
      }).join('');
    },
    afterRender(root) {
      const setChecked = (row, on) => {
        rowState(row).checked = on;
        root.querySelector(`#vcard_${row}`).classList.toggle('on', on);
        const panel = root.querySelector(`#vpanel_${row}`);
        if (panel) panel.classList.toggle('show', on);
      };
      root.querySelectorAll('.vol-card').forEach(card => {
        card.addEventListener('click', () => {
          const def = VOL_ROWS.find(d => d.row === card.dataset.row);
          const on = !rowState(def.row).checked;
          if (on && def.group) {
            // 27／31／32：同組都還沒勾時，勾任何一個就三個一起勾；之後可以個別取消
            const mates = VOL_ROWS.filter(d => d.group === def.group && d.row !== def.row);
            if (mates.every(m => !rowState(m.row).checked)) mates.forEach(m => setChecked(m.row, true));
          }
          setChecked(def.row, on);
        });
      });
      const wireAmounts = (scope) => {
        scope.querySelectorAll('.amount-chip').forEach(chip => {
          chip.addEventListener('click', () => {
            const code = chip.dataset.code;
            const st = rowState(rowOfCode(code).row);
            chip.parentElement.querySelectorAll('.amount-chip').forEach(c => c.classList.remove('selected'));
            chip.classList.add('selected');
            const custom = chip.parentElement.nextElementSibling;
            if (chip.dataset.val === '__other__') {
              custom.classList.add('show');
              st.amounts[code] = custom.value.trim();
              custom.focus();
            } else {
              custom.classList.remove('show');
              st.amounts[code] = chip.dataset.val;
            }
          });
        });
        scope.querySelectorAll('.amount-custom').forEach(inp => {
          inp.addEventListener('input', () => {
            rowState(rowOfCode(inp.dataset.code).row).amounts[inp.dataset.code] = inp.value.trim();
          });
        });
      };
      wireAmounts(root);
      // 變體下拉（27／30／51A／83）：換選項時保額也跟著換；同一個保額在新選項裡也有的話就保留
      root.querySelectorAll('.vol-variant').forEach(sel => {
        sel.addEventListener('change', () => {
          const st = rowState(sel.dataset.row);
          const prev = st.amounts[st.variant];
          st.variant = sel.value;
          st.amounts = { [sel.value]: prev && VOL_CODES[sel.value].presets.includes(prev) ? prev : (st.amounts[sel.value] || '') };
          const box = root.querySelector(`.vol-amount[data-row="${sel.dataset.row}"]`);
          box.innerHTML = amountPicker(sel.value, st.amounts[sel.value]);
          wireAmounts(box);
        });
      });
    },
    collect() {
      const picked = selectedVoluntary();
      if (!picked.length && !state.legacyVoluntary.length) { alert('請至少選擇一項投保內容'); return false; }
      const missing = picked.find(v => !v.amount && !VOL_CODES[v.id].optional && !VOL_CODES[v.id].noAmount);
      if (missing) { alert(`請設定「${missing.id} ${missing.item}」的保額`); return false; }
      return true;
    }
  };
}

function stepPersonalProducts() {
  return {
    eyebrow: '個人保險商品', title: '選擇投保商品與計畫',
    render() {
      return PERSONAL_ITEMS.map(item => {
        const cur = state.personalItems[item.id] || { checked: false, plans: [], policyNo: '' };
        const plans = cur.plans || [];
        const hasPresets = item.presets && item.presets.length > 0;
        const needsFreeInput = !hasPresets && item.note && item.note.includes('請輸入');
        // 自訂文字＝目前選取內容裡，不屬於任何預設計畫的那一個
        const customValue = plans.find(p => !item.presets.includes(p)) || '';
        const customOn = !!customValue;
        return `
        <div class="check-row ${cur.checked ? 'checked' : ''}" id="prow_${item.id}">
          <label class="label">
          <input type="checkbox" class="p-chk" data-id="${item.id}" ${cur.checked ? 'checked' : ''}>
          <p>${item.name}</p></label>
          <input type="text" class="p-policy-no" id="ppolicy_${item.id}" data-id="${item.id}" placeholder="保單號碼"
                 value="${cur.policyNo || ''}"
                 style="max-width:160px; margin-left:auto; padding:8px 10px; border:1.5px solid var(--line); border-radius:6px; font-size:13px; font-family:inherit; ${cur.checked ? '' : 'display:none;'}">
          ${hasPresets ? `
          <div class="detail">
            <div class="amount-row">
              ${item.presets.map(p => `<div class="amount-chip ${plans.includes(p) ? 'selected' : ''}" data-id="${item.id}" data-val="${p}">${p}</div>`).join('')}
              <div class="amount-chip ${customOn ? 'selected' : ''}" data-id="${item.id}" data-val="__other__">其他</div>
            </div>
            <input type="text" class="amount-custom ${customOn ? 'show' : ''}" id="pcustom_${item.id}" placeholder="請輸入計畫名稱" value="${customValue}">
            <div class="hint" style="margin-top:6px;">可複選多個計畫</div>
          </div>` : needsFreeInput ? `
          <div class="detail">
            <input type="text" class="amount-custom show" id="pcustom_${item.id}" placeholder="${item.note}" value="${plans[0] || ''}">
          </div>` : (item.note ? `<div class="detail"><span class="hint">${item.note}</span></div>` : '')}
        </div>`;
      }).join('');
    },
    afterRender(root) {
      root.querySelectorAll('.p-chk').forEach(chk => {
        chk.addEventListener('change', () => {
          const id = chk.dataset.id;
          if (!state.personalItems[id]) state.personalItems[id] = { checked: false, plans: [], policyNo: '' };
          state.personalItems[id].checked = chk.checked;
          root.querySelector(`#prow_${id}`).classList.toggle('checked', chk.checked);
          const policyInput = root.querySelector(`#ppolicy_${id}`);
          if (policyInput) policyInput.style.display = chk.checked ? '' : 'none';
        });
      });

      root.querySelectorAll('.p-policy-no').forEach(inp => {
        inp.addEventListener('input', () => {
          const id = inp.dataset.id;
          if (!state.personalItems[id]) state.personalItems[id] = { checked: false, plans: [], policyNo: '' };
          state.personalItems[id].policyNo = inp.value.trim();
        });
      });

      // 計畫 chip：可複選，點一下加入、再點一下移除
      root.querySelectorAll('.amount-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const id = chip.dataset.id;
          const val = chip.dataset.val;
          if (!state.personalItems[id]) state.personalItems[id] = { checked: false, plans: [], policyNo: '' };
          const cur = state.personalItems[id];
          if (!cur.plans) cur.plans = [];
          const customInput = root.querySelector(`#pcustom_${id}`);

          if (val === '__other__') {
            const turningOn = !chip.classList.contains('selected');
            chip.classList.toggle('selected', turningOn);
            customInput.classList.toggle('show', turningOn);
            if (turningOn) {
              customInput.focus();
            } else {
              // 取消「其他」：把目前的自訂文字從已選清單移除
              const item = PERSONAL_ITEMS.find(i => i.id === id);
              cur.plans = cur.plans.filter(p => item.presets.includes(p));
              customInput.value = '';
            }
            return;
          }

          const idx = cur.plans.indexOf(val);
          if (idx >= 0) {
            cur.plans.splice(idx, 1);
            chip.classList.remove('selected');
          } else {
            cur.plans.push(val);
            chip.classList.add('selected');
          }
        });
      });

      root.querySelectorAll('.amount-custom').forEach(inp => {
        inp.addEventListener('input', () => {
          const id = inp.id.replace('pcustom_', '');
          if (!state.personalItems[id]) state.personalItems[id] = { checked: false, plans: [], policyNo: '' };
          const cur = state.personalItems[id];
          if (!cur.plans) cur.plans = [];
          const item = PERSONAL_ITEMS.find(i => i.id === id);
          const hasPresets = item.presets && item.presets.length > 0;
          const typed = inp.value.trim();
          if (hasPresets) {
            // 只保留原本已選的預設計畫，自訂文字永遠只有一份、放在陣列最後
            cur.plans = cur.plans.filter(p => item.presets.includes(p));
            if (typed) cur.plans.push(typed);
          } else {
            // 沒有預設計畫的商品（例如需要輸入憑證號碼），單一文字欄位
            cur.plans = typed ? [typed] : [];
          }
        });
      });
    },
    collect() {
      const checkedCount = Object.values(state.personalItems).filter(v => v.checked).length;
      if (checkedCount === 0) { alert('請至少勾選一項投保商品'); return false; }
      for (const item of PERSONAL_ITEMS) {
        const v = state.personalItems[item.id];
        if (!v || !v.checked) continue;
        const hasPresets = item.presets && item.presets.length > 0;
        const needsFreeInput = !hasPresets && item.note && item.note.includes('請輸入');
        const plans = v.plans || [];
        if ((hasPresets || needsFreeInput) && plans.length === 0) {
          alert(`請設定「${item.name}」的${hasPresets ? '計畫' : '內容'}`); return false;
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
  // 個人保險：一組起訖日。汽/機車：強制險、任意險各一組，任意險可勾「同強制險」
  const vehicle = state.category === 'vehicle';
  const showComp = !vehicle || state.hasCompulsory;
  const showVol = vehicle && state.hasVoluntary;
  const canSame = showComp && showVol;
  const years = range(CURRENT_ROC_YEAR - 3, CURRENT_ROC_YEAR + 3).map(v => ({ label: `民國${v}`, value: v }));
  const wheels = (el, obj, idp, yearDefault) => renderWheelGroup(el, [
    { id: idp + 'y', caption: '年', items: years, initialValue: obj.y || yearDefault, onChange: v => obj.y = v },
    { id: idp + 'm', caption: '月', items: range(1, 12).map(v => ({ label: v, value: v })), initialValue: obj.m, onChange: v => obj.m = v },
    { id: idp + 'd', caption: '日', items: range(1, 31).map(v => ({ label: v, value: v })), initialValue: obj.d, onChange: v => obj.d = v },
  ]);
  return {
    eyebrow: '保險期間', title: vehicle ? '強制險與任意險保期' : '起保日與迄保日',
    subtitle: '以滾輪選擇保險期間的起訖日期（民國年／月／日）',
    render() {
      const compTitle = vehicle ? '<div class="period-title">強制險保期</div>' : '';
      return `
        ${showComp ? `
        <div class="period-block">
          ${compTitle}
          <div class="field"><label>起保日</label><div id="wheel_period_start"></div></div>
          <div class="field"><label>迄保日</label><div id="wheel_period_end"></div></div>
        </div>` : ''}
        ${showVol ? `
        <div class="period-block">
          <div class="period-title">任意險保期
            ${canSame ? `<label class="same-check"><input type="checkbox" id="chk_same" ${state.volSameAsComp ? 'checked' : ''}> 同強制險</label>` : ''}
          </div>
          <div id="vol_wheels" ${canSame && state.volSameAsComp ? 'hidden' : ''}>
            <div class="field"><label>起保日</label><div id="wheel_vol_start"></div></div>
            <div class="field"><label>迄保日</label><div id="wheel_vol_end"></div></div>
          </div>
          ${canSame ? `<p class="step-sub same-note" ${state.volSameAsComp ? '' : 'hidden'}>任意險保期與強制險相同。</p>` : ''}
        </div>` : ''}
      `;
    },
    afterRender(root) {
      if (showComp) {
        wheels(root.querySelector('#wheel_period_start'), state.periodStart, 'ps', CURRENT_ROC_YEAR);
        wheels(root.querySelector('#wheel_period_end'), state.periodEnd, 'pe', CURRENT_ROC_YEAR + 1);
      }
      if (showVol) {
        const drawVol = () => {
          wheels(root.querySelector('#wheel_vol_start'), state.volStart, 'vs', CURRENT_ROC_YEAR);
          wheels(root.querySelector('#wheel_vol_end'), state.volEnd, 've', CURRENT_ROC_YEAR + 1);
        };
        drawVol();
        const same = root.querySelector('#chk_same');
        if (same) same.addEventListener('change', () => {
          state.volSameAsComp = same.checked;
          root.querySelector('#vol_wheels').hidden = same.checked;
          root.querySelector('.same-note').hidden = !same.checked;
          if (!same.checked) {
            // 取消「同強制險」時，先帶入強制險的日期當起點再調整
            if (!state.volStart.y) Object.assign(state.volStart, state.periodStart);
            if (!state.volEnd.y) Object.assign(state.volEnd, state.periodEnd);
            drawVol();
          }
        });
      }
    },
    collect() {
      const check = (s, e, label) => {
        const a = rocToIso(s.y, s.m, s.d), b = rocToIso(e.y, e.m, e.d);
        if (!a || !b) { alert(`請設定${label}起保日與迄保日`); return false; }
        if (b <= a) { alert(`${label}迄保日必須晚於起保日`); return false; }
        return true;
      };
      if (showComp && !check(state.periodStart, state.periodEnd, vehicle ? '強制險' : '')) return false;
      if (showVol) {
        if (canSame && state.volSameAsComp) {
          state.volStart = { ...state.periodStart };
          state.volEnd = { ...state.periodEnd };
        } else if (!check(state.volStart, state.volEnd, '任意險')) return false;
        if (!showComp) { // 只有任意險：主要保期就是任意險保期
          state.periodStart = { ...state.volStart };
          state.periodEnd = { ...state.volEnd };
        }
      }
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
        ${state.category === 'personal' ? `
        <div class="inline-row">
          <div class="field"><label>在職公司</label><input type="text" id="f_employer" value="${state.employer}" placeholder="請輸入在職公司名稱"></div>
          <div class="field"><label>職稱</label><input type="text" id="f_job_title" value="${state.jobTitle}" placeholder="請輸入職稱"></div>
        </div>` : ''}
        <div class="field"><label>聯絡電話</label>
          <div class="prefix-input"><input type="text" id="f_phone" inputmode="numeric" maxlength="10" value="${state.phoneSuffix}" placeholder="0912345678"></div>
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
       const idInput = root.querySelector('#f_id');
        idInput.addEventListener('input', () => {
          const start = idInput.selectionStart;
          const end = idInput.selectionEnd;
          idInput.value = idInput.value.toUpperCase();
          idInput.setSelectionRange(start, end);
      });
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

      if (state.category === 'personal') {
        state.employer = root.querySelector('#f_employer').value.trim();
        state.jobTitle = root.querySelector('#f_job_title').value.trim();
        if (!state.employer) { alert('請輸入在職公司'); return false; }
        if (!state.jobTitle) { alert('請輸入職稱'); return false; }
      }

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

const rocText = (o) => (o && o.y ? `民國${o.y}年${o.m}月${o.d}日` : '');
function periodRows() {
  const row = (k, v) => `<div class="row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  if (state.category !== 'vehicle') return row('起保日', rocText(state.periodStart)) + row('迄保日', rocText(state.periodEnd));
  let out = '';
  if (state.hasCompulsory) out += row('強制險保期', `${rocText(state.periodStart)} ～ ${rocText(state.periodEnd)}`);
  if (state.hasVoluntary) {
    out += state.hasCompulsory && state.volSameAsComp
      ? row('任意險保期', '同強制險')
      : row('任意險保期', `${rocText(state.volStart)} ～ ${rocText(state.volEnd)}`);
  }
  return out;
}

function stepReview() {
  return {
    eyebrow: '確認建檔', title: '資料確認',
    render() {
      const domain = state.emailDomain === '其他' ? state.emailDomainCustom : state.emailDomain;

      let topBlock = '';
      if (state.category === 'vehicle') {
        const voluntaryLines = selectedVoluntary()
          .map(v => `<div class="row"><span class="k">${v.id}　${v.item}</span><span class="v">${v.amount || '已投保'}</span></div>`).join('')
          + state.legacyVoluntary.map(v => `<div class="row"><span class="k">${v.item}（舊項目）</span><span class="v">${v.amount || '已投保'}</span></div>`).join('');
        topBlock = `
          <div class="grp-title">車輛與險種</div>
          <div class="row"><span class="k">車牌號碼</span><span class="v">${state.plate}</span></div>
          <div class="row"><span class="k">車種</span><span class="v">${state.vehicleType}</span></div>
          ${state.hasCompulsory ? `<div class="row"><span class="k">強制險保單號碼</span><span class="v">${state.compulsoryPolicyNo}</span></div>` : ''}
          ${state.hasVoluntary ? `<div class="row"><span class="k">任意險保單號碼</span><span class="v">${state.voluntaryPolicyNo}</span></div>` : ''}
          ${voluntaryLines ? `<div class="grp-title">任意險投保內容</div>${voluntaryLines}` : ''}
        `;
      } else if (state.category === 'personal') {
        const personalLines = Object.entries(state.personalItems)
          .filter(([, v]) => v.checked)
          .map(([id, v]) => {
            const def = PERSONAL_ITEMS.find(i => i.id === id);
            const planText = (v.plans && v.plans.length) ? v.plans.join('、') : '已投保';
            const policyLine = v.policyNo ? `<div class="row"><span class="k">${def.name} 保單號碼</span><span class="v">${v.policyNo}</span></div>` : '';
            return `<div class="row"><span class="k">${def.name}</span><span class="v">${planText}</span></div>${policyLine}`;
          }).join('');
        topBlock = `
          <div class="grp-title">個人保險商品</div>
          ${personalLines}
        `;
      }

      const vehicleInfoBlock = state.category === 'vehicle' ? `
          <div class="grp-title">車籍資料</div>
          <div class="row"><span class="k">原發照日</span><span class="v">民國${state.license.y}年${state.license.m}月${state.license.d}日</span></div>
          <div class="row"><span class="k">出廠年月</span><span class="v">${state.mfg.y} 年 ${state.mfg.m} 月</span></div>
          <div class="row"><span class="k">排氣量</span><span class="v">${state.displacement} c.c.</span></div>
          <div class="row"><span class="k">乘載人數</span><span class="v">${state.seatingCapacity} 人</span></div>
          <div class="row"><span class="k">引擎號碼</span><span class="v">${state.engineNumber}</span></div>
          <div class="row"><span class="k">廠牌型式</span><span class="v">${state.brandModel}</span></div>
      ` : '';

      const employmentBlock = state.category === 'personal' ? `
          <div class="row"><span class="k">在職公司</span><span class="v">${state.employer}</span></div>
          <div class="row"><span class="k">職稱</span><span class="v">${state.jobTitle}</span></div>
      ` : '';

      return `
        <div class="review-list">
          ${topBlock}

          <div class="grp-title">保費與期間</div>
          <div class="row"><span class="k">被保人</span><span class="v">${state.insuredName}</span></div>
          <div class="row"><span class="k">總保費</span><span class="v">NT$ ${state.totalPremium}</span></div>
          ${periodRows()}
          ${vehicleInfoBlock}
          <div class="grp-title">被保人資料</div>
          ${employmentBlock}
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
  const common = {
    category: state.category,
    insured_name: state.insuredName,
    total_premium: state.totalPremium,
    policy_start_date: rocToIso(state.periodStart.y, state.periodStart.m, state.periodStart.d),
    policy_end_date: rocToIso(state.periodEnd.y, state.periodEnd.m, state.periodEnd.d),
    insured_id_number: state.insuredIdNumber,
    insured_birthdate: rocToIso(state.birth.y, state.birth.m, state.birth.d),
    insured_phone: '09' + state.phoneSuffix,
    insured_email: `${state.emailLocal}@${domain}`,
    insured_zipcode: state.zipcode,
    insured_city: state.city,
    insured_district: state.district,
    insured_address_detail: state.addressDetail,
  };

  if (state.category === 'personal') {
    return {
      ...common,
      personal_items: Object.entries(state.personalItems).filter(([, v]) => v.checked).map(([id, v]) => {
        const def = PERSONAL_ITEMS.find(i => i.id === id);
        return { item: def.name, plans: v.plans || [], policy_no: v.policyNo || '' };
      }),
      employer: state.employer,
      job_title: state.jobTitle,
    };
  }

  // 預設走車險（category === 'vehicle'）
  return {
    ...common,
    plate_number: state.plate,
    vehicle_type: state.vehicleType,
    has_compulsory: state.hasCompulsory,
    compulsory_policy_no: state.compulsoryPolicyNo,
    has_voluntary: state.hasVoluntary,
    voluntary_policy_no: state.voluntaryPolicyNo,
    voluntary_items: state.hasVoluntary ? [...selectedVoluntary(), ...state.legacyVoluntary] : [],
    // 強制險／任意險各自的保期（policy_start/end_date 仍是主要保期：有強制險就是強制險的）
    compulsory_start_date: state.hasCompulsory ? rocToIso(state.periodStart.y, state.periodStart.m, state.periodStart.d) : null,
    compulsory_end_date: state.hasCompulsory ? rocToIso(state.periodEnd.y, state.periodEnd.m, state.periodEnd.d) : null,
    voluntary_start_date: state.hasVoluntary ? rocToIso(state.volStart.y, state.volStart.m, state.volStart.d) : null,
    voluntary_end_date: state.hasVoluntary ? rocToIso(state.volEnd.y, state.volEnd.m, state.volEnd.d) : null,
    voluntary_same_period: state.hasCompulsory && state.hasVoluntary ? state.volSameAsComp : null,
    vehicle_license_date: rocToIso(state.license.y, state.license.m, state.license.d),
    vehicle_manufacture_date: state.mfg.y ? `${state.mfg.y}-${pad2(state.mfg.m)}` : null,
    displacement: state.displacement,
    seating_capacity: state.seatingCapacity,
    engine_number: state.engineNumber,
    brand_model: state.brandModel,
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
  const summary = state.category === 'personal'
    ? `個人保險（被保人：<b>${state.insuredName}</b>）`
    : `<b>${state.plate}</b>（${state.vehicleType}）`;
  card.innerHTML = `
    <div style="text-align:center; padding:20px 0 6px;">
      <div class="done-icon">✓</div>
      <div class="step-title" style="text-align:center;">${title}</div>
      <div class="stub" style="text-align:left; margin:0 auto 26px; max-width:420px;">
        ${summary}已${verb}保單資料。<br>
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
    category: null,
    plate: '', vehicleType: '',
    hasCompulsory: false, compulsoryPolicyNo: '',
    hasVoluntary: false, voluntaryPolicyNo: '',
    volRows: {}, legacyVoluntary: [],
    personalItems: {},
    insuredName: '', totalPremium: '',
    periodStart: { y: null, m: 1, d: 1 },
    periodEnd: { y: null, m: 1, d: 1 },
    volStart: { y: null, m: 1, d: 1 },
    volEnd: { y: null, m: 1, d: 1 },
    volSameAsComp: true,
    license: { y: null, m: 1, d: 1 },
    mfg: { y: null, m: 1 },
    displacement: '', seatingCapacity: 2,
    engineNumber: '', brandModel: '',
    insuredIdNumber: '',
    birth: { y: null, m: 1, d: 1 },
    phoneSuffix: '',
    emailLocal: '', emailDomain: 'gmail.com', emailDomainCustom: '',
    zipcode: '', city: '', district: '', addressDetail: '',
    employer: '', jobTitle: '',
    editingId: null,
  });
  doneScreenActive = false;
  currentIndex = 0;
  showForm();
}

// ---------- list view ----------
// ========================= 分頁切換 =========================
const VIEWS = { form: 'wizardWrap', list: 'listWrap', detail: 'detailWrap', codes: 'codesWrap' };
function setView(v) {
  Object.entries(VIEWS).forEach(([k, id]) => { document.getElementById(id).style.display = k === v ? 'block' : 'none'; });
  const tab = v === 'detail' ? 'list' : v;
  document.getElementById('navForm').classList.toggle('active', tab === 'form');
  document.getElementById('navList').classList.toggle('active', tab === 'list');
  document.getElementById('navCodes').classList.toggle('active', tab === 'codes');
  if (window.closePicker) window.closePicker();
}

// ========================= 保單彙總（比照人壽「客戶清單」） =========================
const escH = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let flView = 'all';         // all 全部／house 同住址／group 群組
let flKind = 'vehicle';     // 保單明細：vehicle 車險／personal 個人險
let flRecords = [];         // 最近一次讀到的保單

function recAddrText(r) { return [r.insured_city, r.insured_district, r.insured_address_detail].filter(Boolean).join(''); }
function recAddrKey(r) {
  if (!r || !r.insured_address_detail) return '';
  return `${r.insured_city || ''}${r.insured_district || ''}${r.insured_address_detail}`
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/臺/g, '台').replace(/[\s,，、.。\-－]/g, '').toUpperCase();
}
function recSummary(r) {
  return r.category === 'personal'
    ? ((r.personal_items || []).map(i => i.item).join('、') || '—')
    : (r.plate_number || '—');
}
function recHouseMap(rows) {
  const map = new Map();
  rows.forEach(r => { const k = recAddrKey(r); if (!k) return; if (!map.has(k)) map.set(k, []); map.get(k).push(r); });
  // 同一個地址要有兩位以上被保人才算「同住」
  [...map.keys()].forEach(k => { if (new Set(map.get(k).map(r => r.insured_name || r.id)).size < 2) map.delete(k); });
  return map;
}
function recGroupMap(rows) {
  const map = new Map();
  rows.forEach(r => (r.groups || []).forEach(g => { if (!map.has(g)) map.set(g, []); map.get(g).push(r); }));
  return map;
}
function recMatch(r, kw) {
  if (!kw) return true;
  return [r.plate_number, r.insured_name, recSummary(r), recAddrText(r), ...(r.groups || [])]
    .some(x => String(x || '').toLowerCase().includes(kw));
}
async function saveGroups(r, groups) {
  const clean = [...new Set(groups.map(g => g.trim()).filter(Boolean))];
  await dbUpdate(r.id, { groups: clean });
  r.groups = clean;
}

async function showList() {
  setView('list');
  const holder = document.getElementById('recordsTableHolder');
  if (!flRecords.length) holder.textContent = '載入中...';
  flRecords = await dbGetAll();
  refreshList();
}

function refreshList() {
  const kw = document.getElementById('search-box').value.trim().toLowerCase();
  document.querySelectorAll('.fl-view').forEach(b => b.classList.toggle('active', b.dataset.view === flView));
  document.querySelectorAll('#flAll .kind-tab').forEach(b => b.classList.toggle('active', b.dataset.kind === flKind));
  document.getElementById('flAll').hidden = flView !== 'all';
  document.getElementById('fl-cards').hidden = flView === 'all';
  const houses = recHouseMap(flRecords);
  if (flView === 'house') return renderHouseCards(houses, kw);
  if (flView === 'group') return renderGroupCards(kw);

  const holder = document.getElementById('recordsTableHolder');
  const rows = flRecords.filter(r => (r.category === 'personal' ? 'personal' : 'vehicle') === flKind && recMatch(r, kw));
  const sumHead = flKind === 'personal' ? '投保商品' : '車牌號';
  if (!rows.length) {
    holder.innerHTML = `<p class="fl-empty">${kw ? '找不到符合的保單' : (flKind === 'personal' ? '目前沒有個人險保單。' : '目前沒有車險保單。')}</p>`;
    return;
  }
  holder.innerHTML = `
    <div class="records-scroll">
    <table class="records">
      <thead><tr><th>${sumHead}</th><th>被保人</th><th>同住／群組</th><th>刪除</th></tr></thead>
      <tbody>
        ${rows.map(r => {
          const house = houses.get(recAddrKey(r));
          const people = house ? new Set(house.map(x => x.insured_name || x.id)).size : 0;
          const tags = [
            house ? `<span class="fl-tag house" title="${escH(recAddrText(r))}">同住 ${people} 人</span>` : '',
            ...(r.groups || []).map(g => `<span class="fl-tag">${escH(g)}</span>`),
          ].join('');
          const summary = recSummary(r);
          return `
          <tr class="record-row" data-id="${r.id}" style="cursor:pointer;">
            <td class="records-sum" title="${escH(summary)}">${escH(summary)}</td>
            <td>${escH(r.insured_name || '')}</td>
            <td class="fl-tags">${tags}</td>
            <td><span class="del-btn" data-id="${r.id}">刪除</span></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    </div>`;
  holder.querySelectorAll('.record-row').forEach(row => {
    row.addEventListener('click', () => showDetail(row.dataset.id));
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

function memberChip(r) {
  const personal = r.category === 'personal';
  return `<button type="button" class="fl-member" data-id="${r.id}">
    <b>${escH(r.insured_name || '（未填被保人）')}</b><span>${escH(recSummary(r))}</span>
    <em>${personal ? '個人險' : (r.vehicle_type || '車險')}</em></button>`;
}
function bindMemberChips(box) {
  box.querySelectorAll('.fl-member').forEach(b => b.addEventListener('click', () => showDetail(b.dataset.id)));
}

function renderHouseCards(houses, kw) {
  const box = document.getElementById('fl-cards');
  const list = [...houses.values()].filter(m => !kw || m.some(r => recMatch(r, kw))).sort((a, b) => b.length - a.length);
  if (!list.length) {
    box.innerHTML = `<p class="fl-empty">${kw ? '找不到符合的同住名單' : '目前沒有兩位以上被保人住在同一個地址。保單上的地址要填得一樣才會分在一起。'}</p>`;
    return;
  }
  box.innerHTML = list.map((m, i) => {
    const people = new Set(m.map(r => r.insured_name || r.id)).size;
    return `
    <div class="fl-card">
      <div class="fl-card-head">
        <div><span class="fl-card-kicker">同住址・${people} 人・${m.length} 張保單</span><b>${escH(recAddrText(m[0]))}</b></div>
        <button type="button" class="btn-outline fl-btn fl-make-group" data-i="${i}">設為群組</button>
      </div>
      <div class="fl-members">${m.map(memberChip).join('')}</div>
    </div>`;
  }).join('');
  bindMemberChips(box);
  box.querySelectorAll('.fl-make-group').forEach(b => b.addEventListener('click', async () => {
    const m = list[+b.dataset.i];
    const surname = (m[0].insured_name || '').slice(0, 1);
    const name = (prompt('群組名稱', surname ? `${surname}家` : '') || '').trim();
    if (!name) return;
    for (const r of m) await saveGroups(r, [...(r.groups || []), name]);
    alert(`已建立群組「${name}」（${m.length} 張保單）`);
    refreshList();
  }));
}

function renderGroupCards(kw) {
  const box = document.getElementById('fl-cards');
  const groups = [...recGroupMap(flRecords).entries()]
    .filter(([g, m]) => !kw || g.toLowerCase().includes(kw) || m.some(r => recMatch(r, kw)))
    .sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant'));
  const head = `<p class="fl-hint">在保單詳細資料的「群組」欄加入，或到「同住址」按「設為群組」。同一張保單可以在多個群組。</p>`;
  if (!groups.length) {
    box.innerHTML = head + `<p class="fl-empty">${kw ? '找不到符合的群組' : '還沒有自訂群組。'}</p>`;
    return;
  }
  box.innerHTML = head + groups.map(([g, m]) => `
    <div class="fl-card">
      <div class="fl-card-head">
        <div><span class="fl-card-kicker">群組・${m.length} 張保單</span><b>${escH(g)}</b></div>
        <span>
          <button type="button" class="link-btn fl-rename" data-g="${escH(g)}">改名</button>
          <button type="button" class="icon-btn fl-ungroup" data-g="${escH(g)}">解散</button>
        </span>
      </div>
      <div class="fl-members">${m.map(memberChip).join('')}</div>
    </div>`).join('');
  bindMemberChips(box);
  const members = (g) => flRecords.filter(r => (r.groups || []).includes(g));
  box.querySelectorAll('.fl-rename').forEach(b => b.addEventListener('click', async () => {
    const g = b.dataset.g;
    const name = (prompt('新的群組名稱', g) || '').trim();
    if (!name || name === g) return;
    for (const r of members(g)) await saveGroups(r, (r.groups || []).map(x => (x === g ? name : x)));
    refreshList();
  }));
  box.querySelectorAll('.fl-ungroup').forEach(b => b.addEventListener('click', async () => {
    const g = b.dataset.g;
    if (!confirm(`解散群組「${g}」？保單不會被刪除，只是不再分在這一組。`)) return;
    for (const r of members(g)) await saveGroups(r, (r.groups || []).filter(x => x !== g));
    refreshList();
  }));
}

document.getElementById('search-box').addEventListener('input', refreshList);
document.querySelectorAll('.fl-view').forEach(b => b.addEventListener('click', () => { flView = b.dataset.view; refreshList(); }));
document.querySelectorAll('#flAll .kind-tab').forEach(b => b.addEventListener('click', () => { flKind = b.dataset.kind; refreshList(); }));

// ========================= 保單條款 =========================
let codeKind = 'vehicle';
function showCodes() {
  setView('codes');
  document.querySelectorAll('#codeKindTabs .kind-tab').forEach(b => b.classList.toggle('active', b.dataset.kind === codeKind));
  const hint = document.getElementById('codeHint');
  const holder = document.getElementById('codesHolder');
  if (codeKind === 'vehicle') {
    hint.textContent = '汽／機車保險的險種代號與常用保額，與「投保內容明細」的卡片相同。';
    const sec = (title, rows) => `<tr class="sec"><td colspan="3">${title}</td></tr>` + rows.map(([code, name, presets]) =>
      `<tr><td class="code">${escH(code)}</td><td>${escH(name)}</td><td class="presets">${escH(presets)}</td></tr>`).join('');
    const rowsOf = (key) => VOL_ROWS.filter(d => d.section === key)
      .flatMap(d => d.variants || d.bundle || d.codes)
      .map(c => { const v = VOL_CODES[c]; return [c, v.name, v.noAmount ? '不需保額' : (v.presets || []).length ? v.presets.join('、') : '保額選填']; });
    holder.innerHTML = `<div class="records-scroll"><table class="codes-table">
      <thead><tr><th>代號</th><th>險種名稱</th><th>常用保額</th></tr></thead>
      <tbody>
        ${sec('強制險', [['21', '強制險', '依法定保額']])}
        ${VOL_SECTIONS.map(s => sec(s.title, rowsOf(s.key))).join('')}
      </tbody></table></div>`;
  } else {
    hint.textContent = '個人保險商品與可選的計畫。';
    holder.innerHTML = `<div class="records-scroll"><table class="codes-table">
      <thead><tr><th>商品名稱</th><th>計畫</th></tr></thead>
      <tbody>${PERSONAL_ITEMS.map(i => `<tr><td class="code">${escH(i.name)}</td>
        <td class="presets">${escH((i.presets || []).length ? i.presets.join('、') : (i.note || ''))}</td></tr>`).join('')}</tbody>
      </table></div>`;
  }
}
document.querySelectorAll('#codeKindTabs .kind-tab').forEach(b => b.addEventListener('click', () => { codeKind = b.dataset.kind; showCodes(); }));
document.getElementById('navCodes').addEventListener('click', showCodes);

// 反向操作：把一筆已存在的資料「灌回」state，讓精靈可以重複使用來編輯
function loadStateFromRecord(r) {
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

  const common = {
    editingId: r.id,
    category: r.category || 'vehicle', // 舊資料沒有 category 欄位時，當作車險處理
    insuredName: r.insured_name || '',
    totalPremium: r.total_premium || '',
    periodStart: isoToRoc(r.policy_start_date) || { y: null, m: 1, d: 1 },
    periodEnd: isoToRoc(r.policy_end_date) || { y: null, m: 1, d: 1 },
    insuredIdNumber: r.insured_id_number || '',
    birth: isoToRoc(r.insured_birthdate) || { y: null, m: 1, d: 1 },
    phoneSuffix: (r.insured_phone || '').replace(/^09/, ''),
    emailLocal, emailDomain, emailDomainCustom,
    zipcode: r.insured_zipcode || '',
    city: r.insured_city || '',
    district: r.insured_district || '',
    addressDetail: r.insured_address_detail || '',
  };

  if (common.category === 'personal') {
    const personalItems = {};
    (r.personal_items || []).forEach(v => {
      const def = PERSONAL_ITEMS.find(i => i.name === v.item);
      if (def) personalItems[def.id] = { checked: true, plans: v.plans || [], policyNo: v.policy_no || '' };
    });
    Object.assign(state, common, {
      personalItems,
      employer: r.employer || '',
      jobTitle: r.job_title || '',
    });
    return;
  }

  // 車險
  const mfgParts = r.vehicle_manufacture_date ? r.vehicle_manufacture_date.split('-') : [null, '1'];
  // 任意險：依代號（或舊名稱）放回對應的列；新清單沒有的舊項目原樣保留
  const volRows = {};
  const legacyVoluntary = [];
  (r.voluntary_items || []).forEach(v => {
    const code = codeFromSaved(v);
    const def = code && rowOfCode(code);
    if (!def) { legacyVoluntary.push(v); return; }
    const st = (volRows[def.row] = volRows[def.row] || { checked: true, variant: '', amounts: {} });
    if (def.variants) st.variant = code;
    st.amounts[code] = v.amount || '';
  });
  const compStart = isoToRoc(r.compulsory_start_date || r.policy_start_date);
  const compEnd = isoToRoc(r.compulsory_end_date || r.policy_end_date);
  const volStart = isoToRoc(r.voluntary_start_date || r.policy_start_date);
  const volEnd = isoToRoc(r.voluntary_end_date || r.policy_end_date);

  Object.assign(state, common, {
    plate: r.plate_number || '',
    vehicleType: r.vehicle_type || '',
    hasCompulsory: !!r.has_compulsory,
    compulsoryPolicyNo: r.compulsory_policy_no || '',
    hasVoluntary: !!r.has_voluntary,
    voluntaryPolicyNo: r.voluntary_policy_no || '',
    volRows, legacyVoluntary,
    periodStart: compStart || { y: null, m: 1, d: 1 },
    periodEnd: compEnd || { y: null, m: 1, d: 1 },
    volStart: volStart || { y: null, m: 1, d: 1 },
    volEnd: volEnd || { y: null, m: 1, d: 1 },
    volSameAsComp: r.voluntary_same_period != null ? !!r.voluntary_same_period
      : (r.voluntary_start_date || r.policy_start_date) === (r.compulsory_start_date || r.policy_start_date)
        && (r.voluntary_end_date || r.policy_end_date) === (r.compulsory_end_date || r.policy_end_date),
    license: isoToRoc(r.vehicle_license_date) || { y: null, m: 1, d: 1 },
    mfg: { y: mfgParts[0] ? Number(mfgParts[0]) : null, m: mfgParts[1] ? Number(mfgParts[1]) : 1 },
    displacement: r.displacement || '',
    seatingCapacity: r.seating_capacity || 2,
    engineNumber: r.engine_number || '',
    brandModel: r.brand_model || '',
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
  const birth = isoToRoc(r.insured_birthdate);
  const isPersonal = r.category === 'personal';

  let topBlock;
  if (isPersonal) {
    const personalLines = (r.personal_items || []).map(v => {
      const planText = (v.plans && v.plans.length) ? v.plans.join('、') : '已投保';
      const policyLine = v.policy_no ? `<div class="row"><span class="k">${v.item} 保單號碼</span><span class="v">${v.policy_no}</span></div>` : '';
      return `<div class="row"><span class="k">${v.item}</span><span class="v">${planText}</span></div>${policyLine}`;
    }).join('');
    topBlock = `
      <div class="grp-title">個人保險商品</div>
      ${personalLines}
    `;
  } else {
    const license = isoToRoc(r.vehicle_license_date);
    const mfg = r.vehicle_manufacture_date ? r.vehicle_manufacture_date.split('-') : null;
    const voluntaryLines = (r.voluntary_items || []).map(v => {
      const code = codeFromSaved(v);
      const label = code ? `${code}　${VOL_CODES[code].name}` : v.item;
      return `<div class="row"><span class="k">${label}</span><span class="v">${v.amount || '已投保'}</span></div>`;
    }).join('');
    const rt = (iso) => { const o = isoToRoc(iso); return o ? `民國${o.y}年${o.m}月${o.d}日` : ''; };
    const twoPeriods = r.compulsory_end_date || r.voluntary_end_date;
    const periodLines = twoPeriods ? `
      ${r.has_compulsory ? `<div class="row"><span class="k">強制險保期</span><span class="v">${rt(r.compulsory_start_date)} ～ ${rt(r.compulsory_end_date)}</span></div>` : ''}
      ${r.has_voluntary ? `<div class="row"><span class="k">任意險保期</span><span class="v">${r.has_compulsory && r.voluntary_same_period ? '同強制險' : `${rt(r.voluntary_start_date)} ～ ${rt(r.voluntary_end_date)}`}</span></div>` : ''}`
      : `
      <div class="row"><span class="k">起保日</span><span class="v">${start ? `民國${start.y}年${start.m}月${start.d}日` : ''}</span></div>
      <div class="row"><span class="k">迄保日</span><span class="v">${end ? `民國${end.y}年${end.m}月${end.d}日` : ''}</span></div>`;
    topBlock = `
      <div class="grp-title">車輛與險種</div>
      <div class="row"><span class="k">車牌號碼</span><span class="v">${r.plate_number}</span></div>
      <div class="row"><span class="k">車種</span><span class="v">${r.vehicle_type}</span></div>
      ${r.has_compulsory ? `<div class="row"><span class="k">強制險保單號碼</span><span class="v">${r.compulsory_policy_no || ''}</span></div>` : ''}
      ${r.has_voluntary ? `<div class="row"><span class="k">任意險保單號碼</span><span class="v">${r.voluntary_policy_no || ''}</span></div>` : ''}
      ${voluntaryLines ? `<div class="grp-title">任意險投保內容</div>${voluntaryLines}` : ''}

      <div class="grp-title">保費與期間</div>
      <div class="row"><span class="k">被保人</span><span class="v">${r.insured_name || ''}</span></div>
      <div class="row"><span class="k">總保費</span><span class="v">NT$ ${r.total_premium || ''}</span></div>
      ${periodLines}

      <div class="grp-title">車籍資料</div>
      <div class="row"><span class="k">原發照日</span><span class="v">${license ? `民國${license.y}年${license.m}月${license.d}日` : ''}</span></div>
      <div class="row"><span class="k">出廠年月</span><span class="v">${mfg ? `${mfg[0]} 年 ${Number(mfg[1])} 月` : ''}</span></div>
      <div class="row"><span class="k">排氣量</span><span class="v">${r.displacement || ''} c.c.</span></div>
      <div class="row"><span class="k">乘載人數</span><span class="v">${r.seating_capacity || ''} 人</span></div>
      <div class="row"><span class="k">引擎號碼</span><span class="v">${r.engine_number || ''}</span></div>
      <div class="row"><span class="k">廠牌型式</span><span class="v">${r.brand_model || ''}</span></div>
    `;
  }

  const employmentBlock = isPersonal ? `
      <div class="row"><span class="k">在職公司</span><span class="v">${r.employer || ''}</span></div>
      <div class="row"><span class="k">職稱</span><span class="v">${r.job_title || ''}</span></div>
  ` : '';

  const premiumBlock = isPersonal ? `
      <div class="grp-title">保費與期間</div>
      <div class="row"><span class="k">被保人</span><span class="v">${r.insured_name || ''}</span></div>
      <div class="row"><span class="k">總保費</span><span class="v">NT$ ${r.total_premium || ''}</span></div>
      <div class="row"><span class="k">起保日</span><span class="v">${start ? `民國${start.y}年${start.m}月${start.d}日` : ''}</span></div>
      <div class="row"><span class="k">迄保日</span><span class="v">${end ? `民國${end.y}年${end.m}月${end.d}日` : ''}</span></div>
  ` : '';

  return `
    <div class="review-list">
      ${topBlock}
      ${premiumBlock}
      <div class="grp-title">被保人資料</div>
      ${employmentBlock}
      <div class="row"><span class="k">身分證字號</span><span class="v">${r.insured_id_number || ''}</span></div>
      <div class="row"><span class="k">出生日期</span><span class="v">${birth ? `民國${birth.y}年${birth.m}月${birth.d}日` : ''}</span></div>
      <div class="row"><span class="k">電話</span><span class="v">${r.insured_phone || ''}</span></div>
      <div class="row"><span class="k">信箱</span><span class="v">${r.insured_email || ''}</span></div>
      <div class="row"><span class="k">住址</span><span class="v">${r.insured_zipcode || ''} ${r.insured_city || ''}${r.insured_district || ''}${r.insured_address_detail || ''}</span></div>
    </div>
  `;
}

async function showDetail(id) {
  setView('detail');
  const holder = document.getElementById('detailHolder');
  const gbox = document.getElementById('detailGroups');
  holder.textContent = '載入中...';
  gbox.innerHTML = '';
  const rec = await dbGet(id);
  if (!rec) { holder.innerHTML = '<p>找不到這筆資料。</p>'; return; }
  holder.innerHTML = renderRecordDetail(rec);
  renderDetailGroups(rec);
  const editBtn = document.getElementById('btnEditRecord');
  if (editBtn) editBtn.onclick = () => startEdit(id);
}

// 詳細資料上方的「群組」：可加入、移出
function renderDetailGroups(rec) {
  const gbox = document.getElementById('detailGroups');
  gbox.innerHTML = `
    <div class="dt-groups">
      <span class="dt-groups-label">群組</span>
      ${(rec.groups || []).map(g => `<span class="dt-group">${escH(g)}<button type="button" data-g="${escH(g)}" title="移出群組">✕</button></span>`).join('')}
      <span class="dt-group-add">
        <input type="text" id="dtGroupInput" data-pick="rec-group" placeholder="加入群組" autocomplete="off">
        <button type="button" class="btn-outline fl-btn" id="dtGroupAdd">加入</button>
      </span>
    </div>`;
  PICK_SOURCES['rec-group'] = () => [...recGroupMap(flRecords).keys()].filter(g => !(rec.groups || []).includes(g)).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  const update = async (groups) => {
    await saveGroups(rec, groups);
    const cached = flRecords.find(r => String(r.id) === String(rec.id));
    if (cached) cached.groups = rec.groups;
    renderDetailGroups(rec);
  };
  const add = () => {
    const g = gbox.querySelector('#dtGroupInput').value.trim();
    if (!g || (rec.groups || []).includes(g)) return;
    update([...(rec.groups || []), g]);
  };
  gbox.querySelector('#dtGroupAdd').addEventListener('click', add);
  gbox.querySelector('#dtGroupInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  gbox.querySelectorAll('.dt-group button').forEach(b => b.addEventListener('click', () => update((rec.groups || []).filter(g => g !== b.dataset.g))));
}

document.getElementById('btnBackToList').addEventListener('click', showList);

function showForm() {
  setView('form');
  document.getElementById('rail').style.display = 'flex';
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

// ========================= 匯出備份 / 匯入復原 =========================
document.getElementById('btnExportBackup').addEventListener('click', async () => {
  const rows = await dbGetAll();
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const today = new Date().toISOString().slice(0, 10);
  a.download = `車險保單備份_${today}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

document.getElementById('btnImportBackup').addEventListener('click', () => {
  document.getElementById('importFileInput').click();
});

document.getElementById('importFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const records = JSON.parse(text);
    if (!Array.isArray(records)) throw new Error('檔案格式不正確，應該是匯出時產生的 JSON 檔');
    if (!confirm(`確定要匯入 ${records.length} 筆資料嗎？如果資料庫裡已經有相同編號的紀錄，內容會被匯入的資料覆蓋掉。`)) {
      e.target.value = '';
      return;
    }
    const count = await dbImportAll(records);
    alert(`匯入完成，共 ${count} 筆資料。`);
    showList();
  } catch (err) {
    alert('匯入失敗：' + (err && err.message ? err.message : '檔案格式不正確'));
  }
  e.target.value = '';
});

// init：先確認登入（沒登入會被導到登入頁），再顯示表單
requireLogin('../').then((user) => {
  showForm();
  // 這台裝置如果還有舊版存在本機的保單，詢問是否搬到雲端
  offerLocalMigration({
    dbName: 'policiesDB', storeName: 'policies', label: '產險保單', user,
    importFn: dbImportAll,
  });
});