// ============================================================
// 稅務規劃：遺產稅、贈與稅試算核心（純函式，金額一律用「元」整數計算）
// 參數：民國 115 年（2026）。115 年財政部公告免稅額、扣除額、級距均未調整，沿用前次金額。
// 每年 11～12 月財政部公告新年度金額後，更新下面的 RULES 即可。
// ============================================================
(function (root) {
  'use strict';
  const W = 10000;

  const RULES = Object.freeze({
    year: 2026,
    estate: Object.freeze({
      exemption: 1333 * W,            // 免稅額
      necessities: 100 * W,           // 不計入遺產總額：被繼承人日常生活必需之器具及用具
      tools: 56 * W,                  // 不計入遺產總額：職業上之工具
      spouse: 553 * W,                // 配偶扣除額
      descendant: 56 * W,             // 直系血親卑親屬每人；未滿 18 歲每差 1 歲加扣 56 萬
      parent: 138 * W,                // 父母每人
      disability: 693 * W,            // 配偶、直系血親卑親屬、父母為重度以上身心障礙者每人加扣
      dependent: 56 * W,              // 受扶養之兄弟姊妹、祖父母每人；兄弟姊妹未滿 18 歲每差 1 歲加扣 56 萬
      funeral: 138 * W,               // 喪葬費
      brackets: Object.freeze([[5621 * W, 10], [11242 * W, 15], [Infinity, 20]]),
    }),
    gift: Object.freeze({
      exemption: 244 * W,             // 每位贈與人每年免稅額
      brackets: Object.freeze([[2811 * W, 10], [5621 * W, 15], [Infinity, 20]]), // 以「贈與淨額」（扣除免稅額後）計
    }),
  });

  const int = (x, label) => {
    const n = Number(x || 0);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${label}必須是 0 以上的數字`);
    return Math.round(n);
  };
  const age = (a, label) => {
    if (a === '' || a === null || a === undefined) return null;
    const n = Number(a);
    if (!Number.isInteger(n) || n < 0 || n > 130) throw new Error(`${label}的年齡請填 0～130 的整數`);
    return n;
  };
  // 未滿 18 歲：每差 1 歲加扣一份（例：5 歲 → 加 13 份）
  const minorYears = (a) => (a === null || a >= 18 ? 0 : 18 - a);

  // 累進稅額：回傳每一段的課稅金額與稅額（元，四捨五入到元）
  function progressive(net, brackets) {
    let prev = 0;
    const bands = brackets.map(([top, rate]) => {
      const base = Math.max(0, Math.min(net, top) - prev);
      const band = { from: prev, to: top, rate, base, tax: Math.round(base * rate / 100) };
      prev = top;
      return band;
    });
    return { bands, tax: bands.reduce((s, b) => s + b.tax, 0) };
  }

  // ---------- 遺產稅 ----------
  // input: { gross, exemption, necessities, tools, spouse:{on,disabled}, descendants:[{age,disabled}],
  //          parents:[{disabled}], dependents:[{age}], funeral, debts }
  function estate(input) {
    const R = RULES.estate;
    const gross = int(input.gross, '遺產總額');
    const items = [];
    const add = (label, amount, kind) => { if (amount > 0) items.push({ label, amount, kind }); };
    if (input.exemption) add('免稅額', R.exemption, 'exemption');
    if (input.necessities) add('不計入：日常生活必需器具及用具', R.necessities, 'excluded');
    if (input.tools) add('不計入：職業上之工具', R.tools, 'excluded');
    if (input.spouse && input.spouse.on) {
      add('配偶扣除額', R.spouse, 'deduction');
      if (input.spouse.disabled) add('配偶重度以上身心障礙加扣', R.disability, 'deduction');
    }
    (input.descendants || []).forEach((p, i) => {
      const a = age(p.age, `第 ${i + 1} 位直系血親卑親屬`);
      const extra = minorYears(a);
      add(`直系血親卑親屬 ${i + 1}${a !== null ? `（${a} 歲）` : ''}`, R.descendant * (1 + extra), 'deduction');
      if (p.disabled) add(`直系血親卑親屬 ${i + 1} 重度以上身心障礙加扣`, R.disability, 'deduction');
    });
    if ((input.parents || []).length > 2) throw new Error('父母最多 2 人');
    (input.parents || []).forEach((p, i) => {
      add(`父母 ${i + 1}`, R.parent, 'deduction');
      if (p.disabled) add(`父母 ${i + 1} 重度以上身心障礙加扣`, R.disability, 'deduction');
    });
    (input.dependents || []).forEach((p, i) => {
      const a = age(p.age, `第 ${i + 1} 位受扶養兄弟姊妹／祖父母`);
      add(`受扶養兄弟姊妹／祖父母 ${i + 1}${a !== null ? `（${a} 歲）` : ''}`, R.dependent * (1 + minorYears(a)), 'deduction');
    });
    if (input.funeral) add('喪葬費', R.funeral, 'deduction');
    const debts = int(input.debts, '其他扣除額');
    add('其他扣除額（未償債務等）', debts, 'deduction');
    const totalOff = items.reduce((s, x) => s + x.amount, 0);
    const net = Math.max(0, gross - totalOff);
    const { bands, tax } = progressive(net, R.brackets);
    return { gross, items, totalOff, net, bands, tax, effectiveRate: gross ? tax / gross : 0 };
  }

  // ---------- 贈與稅（同一位贈與人、同一年度）----------
  // gifts: [{ recipient, form, amount }]
  const FORMS = Object.freeze({ cash: '現金贈與', policy: '保單贈與', securities: '股票／基金贈與', property: '實物贈與' });
  function gift(gifts) {
    const R = RULES.gift;
    const list = (gifts || []).map((g, i) => {
      if (!FORMS[g.form]) throw new Error(`第 ${i + 1} 筆請選擇贈與形式`);
      const amount = int(g.amount, `第 ${i + 1} 筆贈與金額`);
      if (amount <= 0) throw new Error(`第 ${i + 1} 筆贈與金額必須大於 0`);
      return { recipient: String(g.recipient || '').trim(), form: g.form, formLabel: FORMS[g.form], amount };
    });
    const total = list.reduce((s, g) => s + g.amount, 0);
    const net = Math.max(0, total - R.exemption);
    const { bands, tax } = progressive(net, R.brackets);
    const byRecipient = {};
    list.forEach((g) => { const k = g.recipient || '（未填受贈人）'; byRecipient[k] = (byRecipient[k] || 0) + g.amount; });
    const byForm = {};
    list.forEach((g) => { byForm[g.formLabel] = (byForm[g.formLabel] || 0) + g.amount; });
    return { list, total, exemption: R.exemption, remaining: Math.max(0, R.exemption - total), net, bands, tax, byRecipient, byForm };
  }

  const api = Object.freeze({ RULES, FORMS, estate, gift, progressive, W });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EastoneTax = api;
})(globalThis);
