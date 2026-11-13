// ============================================================
// 保單知識庫＋保障計算引擎（知識庫頁、新增保單頁、保單健診都用這一份）
// 需要先載入 supabase-client.js（sb、sbThrow）
// ------------------------------------------------------------
// 計算原則（跟顧問規格一致）：
//   - 數字只來自「已建檔的商品給付表 × 保單單位數」，查不到就標「未建檔」，不猜
//   - 實支實付、限額類項目可以列出各張合計，但標註「實際依理賠協調」
//   - 區間（例如失能依等級）、至少（例如身故取三者最大值）照實顯示
// ============================================================

const KB = {
  items: [],        // 給付項目字典
  products: [],     // 商品（含 benefits、latestRate）
  _rates: {},       // product_id -> 費率列
  loaded: false,

  async load(force) {
    if (this.loaded && !force) return this;
    const [it, pr, be, dr] = await Promise.all([
      sb.from('kb_benefit_items').select('*').order('sort'),
      sb.from('kb_products').select('*').order('code'),
      sb.from('kb_product_benefits').select('*').order('sort'),
      sb.from('kb_declared_rates').select('*').order('month', { ascending: false }),
    ]);
    sbThrow(it.error || pr.error || be.error || dr.error, '讀取保單知識庫');
    this.items = it.data || [];
    this.products = (pr.data || []).map((p) => ({
      ...p,
      benefits: (be.data || []).filter((b) => b.product_id === p.id),
      declared: (dr.data || []).filter((d) => d.product_id === p.id),
    }));
    this._rates = {};
    this.loaded = true;
    return this;
  },

  item(code) { return this.items.find((i) => i.code === code); },

  // 依代號找商品；同代號多個版本時，取生效日當時適用（目前先取最新一筆）
  product(code, company) {
    const c = String(code || '').trim().toUpperCase();
    if (!c) return null;
    const list = this.products.filter((p) => p.code.toUpperCase() === c && (!company || p.company === company));
    return list.sort((a, b) => (b.version || '').localeCompare(a.version || ''))[0] || null;
  },

  async rates(productId) {
    if (!this._rates[productId]) {
      const { data, error } = await sb.from('kb_rates').select('*').eq('product_id', productId);
      sbThrow(error, '讀取費率表');
      this._rates[productId] = data || [];
    }
    return this._rates[productId];
  },
};

// ---------------- 匯率（外幣保單換算新臺幣） ----------------
// 用財經日報同一個服務（Yahoo 即時匯率，60 秒快取）；拿不到就回傳只有 TWD 的表，外幣金額會標示「未換算」
const KB_FX_URL = 'https://kocyedkngpxckixtudku.supabase.co/functions/v1/market-data';
async function kbFetchFx() {
  try {
    const res = await fetch(KB_FX_URL);
    const data = await res.json();
    const fx = { TWD: 1 };
    Object.entries(data.fx || {}).forEach(([k, v]) => { if (typeof v === 'number') fx[k] = v; });
    return { rates: fx, at: data.fetchedAt || Date.now() };
  } catch {
    return { rates: { TWD: 1 }, at: null };
  }
}

// ---------------- 年齡與期間 ----------------
function kbParseDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
function kbAddYears(d, n) { const x = new Date(d); x.setFullYear(x.getFullYear() + n); return x; }
function kbAddMonths(d, n) { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }
function kbIso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

// 保險年齡：足歲計算，未滿一歲的零數超過六個月者加算一歲
function kbInsuranceAge(birthIso, atIso) {
  const b = kbParseDate(birthIso), at = kbParseDate(atIso);
  if (!b || !at) return null;
  let y = at.getFullYear() - b.getFullYear();
  if (kbAddYears(b, y) > at) y -= 1;
  if (at > kbAddMonths(kbAddYears(b, y), 6)) y += 1;
  return y;
}

// 第幾個保單年度（生效日當天起算第 1 年度）
function kbPolicyYear(effIso, atIso) {
  const e = kbParseDate(effIso), at = kbParseDate(atIso);
  if (!e || !at || at < e) return 0;
  let y = at.getFullYear() - e.getFullYear();
  if (kbAddYears(e, y) > at) y -= 1;
  return y + 1;
}

// 「20年」「95歲」「終身」「躉繳」→ 繳費／保障結束的保險年齡（不含）
function kbEndAge(text, issueAge) {
  const t = String(text || '').trim();
  if (!t) return null;
  if (/終身/.test(t)) return 999;
  if (/躉繳/.test(t)) return issueAge + 1;
  let m = /(\d+)\s*歲/.exec(t); if (m) return Number(m[1]);
  m = /(\d+)\s*年/.exec(t); if (m) return issueAge + Number(m[1]);
  return null;
}
function kbPayYears(text, issueAge) {
  const end = kbEndAge(text, issueAge);
  return end == null ? null : Math.max(0, end - issueAge);
}

const KB_MODE_PERIODS = { 年繳: 1, 半年繳: 2, 季繳: 4, 月繳: 12 };

// 保單上填的保額 → 商品的單位數
function kbUnits(product, sa, saUnit) {
  const n = Number(sa);
  if (product && product.unit === '附加') return 1;
  if (!isFinite(n) || n <= 0) return null;
  if (!product) return n;
  if (product.unit === '萬') return saUnit === '元' ? n / 10000 : n;
  return n; // 單位、計劃
}

// 依費率表試算保費（未扣折扣）
async function kbCalcPremium(product, { sex, issueAge, term, mode, sa, saUnit }) {
  if (!product) return { error: '知識庫沒有這個商品' };
  if (product.rate_mode === 'none') return { error: '這個商品的保費無法用費率表直接試算' };
  if (!sex || !['男', '女'].includes(sex)) return { error: '被保人性別需為男或女' };
  if (issueAge == null) return { error: '缺少被保人生日或生效日' };
  const units = kbUnits(product, sa, saUnit);
  if (!units) return { error: '請先填保額' };
  const rows = await KB.rates(product.id);
  const termKey = term || (product.pay_terms && product.pay_terms.length === 1 ? product.pay_terms[0] : '');
  const row = rows.find((r) => r.term === termKey && r.sex === sex && r.age === issueAge);
  if (!row) return { error: `費率表查無：${termKey || '（未選年期）'}／${sex}／${issueAge} 歲` };
  const factor = (product.modal_factors || {})[mode || '年繳'] ?? 1;
  const annual = Number(row.rate) * units;
  return { annual: Math.round(annual), modal: Math.round(annual * factor), rate: Number(row.rate), units, term: termKey, factor };
}

// ---------------- 保障計算 ----------------
const KB_WEALTH_CATS = ['分紅', '利率變動', '年金', '投資型', '儲蓄', '增額', '還本', '利變', '投資U', '增額壽險', '還本壽險', '養老保險', '利變年金', '利變即期年金'];

// 豁免附約「同主約繳費期滿日」：換算成從附約生效起算還要繳幾年（主約繳費期滿日 − 附約生效日）
function kbWaiverTerm(allClients, L, M, r) {
  if (!/^同主約/.test(String(r.term || ''))) return null;
  const mainInsured = allClients.find((x) => x.id === L.insured_id);
  const mainAge = mainInsured ? kbInsuranceAge(mainInsured.birthday, L.effective_date) : null;
  const mainPay = mainAge == null ? null : kbPayYears(M.term, mainAge);
  if (mainPay == null) return '';
  const start = new Date(r.effective_date || L.effective_date);
  const mainStart = new Date(L.effective_date);
  if (isNaN(start) || isNaN(mainStart)) return `${mainPay}年`;
  const elapsed = Math.floor((start - mainStart) / (365.2425 * 864e5));
  return `${Math.max(0, mainPay - Math.max(0, elapsed))}年`;
}

// 把所有客戶的保單攤平成「契約」清單，只取被保人是 insuredId 的主約／附約
function kbCollectContracts(allClients, insuredId) {
  const out = [];
  allClients.forEach((c) => (c.policies || []).forEach((p, pi) => {
    const L = p.life;
    if (!L) {
      // 舊資料沒有詳細內容：保單存在本人底下才列出，標示待補
      if (c.id === insuredId) out.push({ pending: true, holderId: c.id, policyIndex: pi, policy_no: p.policy_no, code: p.main_code, name: p.main_name, kind: 'main' });
      return;
    }
    const M = L.main || {};
    const base = {
      holderId: c.id, policyIndex: pi, policy_no: p.policy_no, company: M.company || '',
      applicant: L.applicant_name || '', applicant_id: L.applicant_id || '', effective: L.effective_date,
      pay_mode: L.pay_mode || '年繳', status: L.status || '正常', currency: M.currency || 'TWD',
      discount: L.discount && L.discount.on ? Number(L.discount.pct) || 0 : 0, riderCount: (L.riders || []).length,
      beneficiaries: L.beneficiaries || [],
    };
    if ((L.insured_id || c.id) === insuredId) out.push({ ...base, kind: 'main', code: M.code, name: M.name, cat1: M.cat1, cat2: M.cat2,
      term: M.term, coverage: M.coverage || '', sa: M.sum_assured, saUnit: M.sa_unit, premium: Number(M.premium) || 0 });
    (L.riders || []).forEach((r) => {
      if ((r.insured_id || L.insured_id) !== insuredId) return;
      const waiver = kbWaiverTerm(allClients, L, M, r);
      out.push({ ...base, kind: 'rider', code: r.code, name: r.name, cat1: r.cat1 || '', cat2: r.cat2 || '', effective: r.effective_date || L.effective_date,
        term: waiver || r.term, coverage: waiver || r.coverage || '', sa: r.sum_assured, saUnit: r.sa_unit, premium: Number(r.premium) || 0 });
    });
  }));
  return out;
}

// 保障型或理財型：知識庫有標就照標；沒有就用規則（理財類別，或主約壽險且整張沒有附約＝儲蓄）
function kbNature(ct, product) {
  if (product) return product.nature;
  if ([ct.cat1, ct.cat2].some((c) => KB_WEALTH_CATS.includes(c))) return 'wealth';
  if (ct.kind === 'main' && ct.cat1 === '壽險' && !ct.riderCount) return 'wealth';
  return 'protection';
}

// 主計算：回傳契約明細、當年度保障數值、時間軸事件、保費摘要、條款提醒
function kbCompute({ allClients, insured, asOf, fx }) {
  asOf = asOf || kbIso(new Date());
  const fxRates = (fx && fx.rates) || { TWD: 1 };
  const contracts = kbCollectContracts(allClients, insured.id).map((ct) => {
    if (ct.pending) return ct;
    const product = KB.product(ct.code, ct.company || undefined) || KB.product(ct.code);
    const issueAge = kbInsuranceAge(insured.birthday, ct.effective);
    const py = kbPolicyYear(ct.effective, asOf);
    const age = issueAge == null ? null : issueAge + Math.max(0, py - 1);
    const coverageText = ct.coverage || (product && product.coverage_to) || '';
    const coverEnd = issueAge == null ? null : kbEndAge(coverageText === '繳費期滿' ? ct.term : coverageText, issueAge);
    const payYears = issueAge == null ? null : kbPayYears(ct.term, issueAge);
    const inactive = ['失效', '解約'].includes(ct.status);
    const started = py >= 1;
    const covered = started && !inactive && (coverEnd == null || age == null || age < coverEnd);
    const paying = started && !inactive && !['繳清', '躉繳', '展期'].includes(ct.status) && (payYears == null || py <= payYears);
    const payingNext = paying && (payYears == null || py + 1 <= payYears);
    const units = kbUnits(product, ct.sa, ct.saUnit);
    const periods = KB_MODE_PERIODS[ct.pay_mode] || 1;
    const currency = (product && product.currency) || ct.currency || 'TWD';
    const fxRate = fxRates[currency] ?? null; // null＝這個幣別沒有匯率，不換算
    // 年繳標準保費：分期繳的保費除以繳別係數還原（「年繳保費總和」用）
    const factor = (product && product.modal_factors && product.modal_factors[ct.pay_mode]) || (ct.pay_mode === '年繳' ? 1 : null);
    const annualStd = factor ? ct.premium / factor : ct.premium * periods;
    const paidYears = payYears == null ? Math.max(0, py) : Math.min(Math.max(0, py), payYears);
    return { ...ct, product, issueAge, py, age, coverageText, coverEnd, payYears, covered, paying, payingNext, units,
      currency, fxRate, annualStd, paidYears,
      annualPremium: Math.round(ct.premium * periods), nature: kbNature(ct, product) };
  });

  // 當年度保障數值
  const values = {}; // item_code -> {item, total, low, min, rows:[{ct, value, low, cond, max_times, clause}]}
  contracts.forEach((ct) => {
    if (ct.pending || !ct.product || !ct.covered || ct.units == null) return;
    ct.product.benefits.forEach((b) => {
      if (b.from_year != null && ct.py < b.from_year) return;
      if (b.to_year != null && ct.py > b.to_year) return;
      if (b.from_age != null && ct.age < b.from_age) return;
      if (b.to_age != null && ct.age > b.to_age) return;
      const item = KB.item(b.item_code);
      if (!item) return;
      const v = values[b.item_code] || (values[b.item_code] = { item, total: 0, low: 0, hasLow: false, min: false, unconverted: false, rows: [] });
      // 原幣金額：每單位 × 單位數，或「已繳保費總和 × amount」
      const orig = b.basis === 'paid_premium' ? Number(b.amount) * ct.annualStd * ct.paidYears : Number(b.amount) * ct.units;
      const origLow = b.amount_low != null ? Number(b.amount_low) * ct.units : null;
      const rate = ct.fxRate ?? 1;
      const value = Math.round(orig * rate);
      const low = origLow != null ? Math.round(origLow * rate) : null;
      v.total += value;
      v.low += low != null ? low : value;
      v.hasLow = v.hasLow || low != null;
      v.min = v.min || b.min_label;
      v.unconverted = v.unconverted || ct.fxRate == null;
      v.rows.push({ ct, value, low, orig: Math.round(orig), currency: ct.currency, basis: b.basis, cond: b.cond, max_times: b.max_times, clause: b.clause });
    });
  });

  // 時間軸事件：繳費期滿、保障終止、給付變動（未來才列）
  const events = [];
  const pushEvent = (date, age, text, ct, kind) => { if (date && date > asOf) events.push({ date, age, text, ct, kind }); };
  contracts.forEach((ct) => {
    if (ct.pending || ct.issueAge == null || ['失效', '解約'].includes(ct.status)) return;
    const eff = kbParseDate(ct.effective);
    const label = `${ct.code || ''} ${ct.name || ''}`.trim();
    if (ct.payYears != null && ct.payYears > 0 && ct.payYears < 900) pushEvent(kbIso(kbAddYears(eff, ct.payYears)), ct.issueAge + ct.payYears, `${label} 繳費期滿`, ct, 'pay');
    if (ct.coverEnd != null && ct.coverEnd < 900) pushEvent(kbIso(kbAddYears(eff, ct.coverEnd - ct.issueAge)), ct.coverEnd, `${label} 保障終止（${ct.coverageText}）`, ct, 'end');
    if (!ct.product || ct.units == null) return;
    ct.product.benefits.forEach((b) => {
      const item = KB.item(b.item_code);
      if (!item) return;
      if (b.basis === 'paid_premium') return; // 依已繳保費計算的不列節點
      const value = Math.round(Number(b.amount) * ct.units * (ct.fxRate ?? 1));
      if (b.from_year != null && b.from_year > 1) {
        pushEvent(kbIso(kbAddYears(eff, b.from_year - 1)), ct.issueAge + b.from_year - 1, `${item.name} 變為 ${value.toLocaleString()} ${item.unit_label}（第 ${b.from_year} 保單年度起）`, ct, 'change');
      }
      if (b.from_age != null) {
        pushEvent(kbIso(kbAddYears(eff, b.from_age - ct.issueAge)), b.from_age, `${item.name} 開始：${value.toLocaleString()} ${item.unit_label}${b.max_times ? '（' + b.max_times + '）' : ''}`, ct, 'start');
      }
    });
  });
  events.sort((a, b) => a.date.localeCompare(b.date));

  // 保費摘要（年繳化；同一張保單的折扣套用在整張）
  const premium = { thisYear: 0, nextYear: 0, protection: 0, wealth: 0, unknownNext: [] };
  contracts.forEach((ct) => {
    if (ct.pending || !ct.paying) return;
    const d = 1 - (ct.discount || 0) / 100;
    const yr = ct.annualPremium * d * (ct.fxRate ?? 1);
    premium.thisYear += yr;
    premium[ct.nature === 'wealth' ? 'wealth' : 'protection'] += yr;
    if (!ct.payingNext) return;
    if (ct.product && ct.product.rate_mode === 'attained') premium.unknownNext.push(ct); // 逐年調整：要查明年年齡的費率（下一步做）
    premium.nextYear += yr;
  });
  ['thisYear', 'nextYear', 'protection', 'wealth'].forEach((k) => (premium[k] = Math.round(premium[k])));

  // 條款提醒（只列目前有保障的商品）
  const notes = [];
  const seen = new Set();
  contracts.forEach((ct) => {
    if (ct.pending || !ct.product || seen.has(ct.product.id)) return;
    seen.add(ct.product.id);
    (ct.product.notes || []).forEach((n) => notes.push({ ...n, product: ct.product }));
  });

  const foreign = [...new Set(contracts.filter((c) => !c.pending && c.currency !== 'TWD').map((c) => c.currency))]
    .map((cur) => ({ currency: cur, rate: fxRates[cur] ?? null }));
  return { asOf, contracts, values, events, premium, notes, foreign, fxAt: fx && fx.at };
}
