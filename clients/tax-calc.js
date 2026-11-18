// 115 年公告金額與 115 年 9 月 13 日生效的擬制遺產規則分開管理。
(function (root) {
  'use strict';

  const RULES = Object.freeze({
    year: 2026,
    deemedEstateEffective: '2026-09-13',
    gift: Object.freeze({ exemption: 2440000, thresholds: Object.freeze([28110000, 56210000]) }),
    estate: Object.freeze({
      exemption: 13330000, thresholds: Object.freeze([56210000, 112420000]),
      spouse: 5530000, child: 560000, parent: 1380000, funeral: 1380000,
    }),
  });
  // 計算到分供試算，保留精確的分段金額。
  const LIMIT = 1000000000000;

  function amount(value) {
    if (!Number.isSafeInteger(value) || value < 0 || value > LIMIT) {
      throw new Error('請輸入 0 至 1 兆元之間的整數，並確認加總未超過範圍。');
    }
    return value;
  }

  function optionalAmount(value) {
    return value == null ? null : amount(value);
  }

  function validateDate(date) {
    const iso = typeof date === 'string' && /^2026-\d{2}-\d{2}$/.test(date);
    const timestamp = iso ? Date.parse(date) : NaN;
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) {
      throw new Error('請填寫有效的民國 115 年（2026）日期。');
    }
    return date;
  }

  function estimate(gross, deductions, rules, credits) {
    const net = Math.max(0, gross - deductions - rules.exemption);
    const [first, second] = rules.thresholds;
    const bands = [
      { base: Math.min(net, first), rate: 10 },
      { base: Math.max(0, Math.min(net, second) - first), rate: 15 },
      { base: Math.max(0, net - second), rate: 20 },
    ].map(({ base, rate }) => ({ base, rate, cents: base * rate }));
    const taxCents = bands.reduce((sum, band) => sum + band.cents, 0);
    return {
      gross, deductions, exemption: rules.exemption, net, bands, taxCents,
      dueCents: credits === null ? null : Math.max(0, taxCents - credits * 100),
    };
  }

  function gift({ events, deductions, credits }) {
    if (!events.length) throw new Error('請新增至少一筆贈與紀錄。');
    let previous = '';
    let gross = 0;
    let pending = 0;
    let excluded = 0;
    let firstOver = null;
    for (const event of events) {
      const date = validateDate(event.date);
      if (date < previous) throw new Error('請依日期由早到晚填寫贈與紀錄。');
      previous = date;
      const value = amount(event.value);
      if (value === 0) throw new Error('每筆贈與金額須大於零。');
      switch (event.treatment) {
        case 'taxable': gross = amount(gross + value); break;
        case 'excluded': excluded = amount(excluded + value); break;
        case 'pending': pending = amount(pending + value); break;
        default: throw new Error('請確認贈與紀錄的列計方式。');
      }
      if (firstOver === null && gross > RULES.gift.exemption) firstOver = date;
    }
    const deductible = amount(deductions);
    if (deductible > gross) throw new Error('可扣除額不得大於目前計入的贈與總額。');
    return {
      ...estimate(gross, deductible, RULES.gift, pending ? null : optionalAmount(credits)),
      pending, excluded, firstOver, date: previous,
      remaining: Math.max(0, RULES.gift.exemption - Math.max(0, gross - deductible)),
    };
  }

  function estate({ date, gross, includedGifts, spouse, children, parents, debts, otherDeductions, credits }) {
    validateDate(date);
    const current = amount(gross);
    const gifts = optionalAmount(includedGifts);
    if (amount(parents) > 2) throw new Error('父母扣除人數最多為 2 人。');
    const rules = RULES.estate;
    const details = {
      spouse: spouse ? rules.spouse : 0,
      children: amount(amount(children) * rules.child),
      parents: parents * rules.parent,
      funeral: rules.funeral,
      debts: amount(debts),
      other: amount(otherDeductions),
    };
    const deductions = amount(Object.values(details).reduce((sum, value) => sum + value, 0));
    return {
      ...estimate(amount(current + (gifts ?? 0)), deductions, rules, gifts === null ? null : optionalAmount(credits)),
      date, current, gifts, details, newDeemedEstateRules: date >= RULES.deemedEstateEffective,
    };
  }

  const api = Object.freeze({ RULES, gift, estate });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EastoneTax = api;
})(globalThis);
