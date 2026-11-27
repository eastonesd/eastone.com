const assert = require('assert');
const F = require('../clients/family-calc.js');
const W = 10000;
let n = 0; const t = (name, fn) => { fn(); n++; console.log('✓', name); };

t('剩餘財產差額：法定財產制', () => {
  const r = F.maritalClaim({ regime: 'legal', headNet: 5000 * W, headPre: 500 * W, headFree: 500 * W, spouseNet: 1000 * W, spousePre: 0, spouseFree: 0 });
  assert.equal(r.headPost, 4000 * W); assert.equal(r.claim, 1500 * W);
});
t('剩餘財產差額：配偶較多 → 0；分別財產制不適用', () => {
  assert.equal(F.maritalClaim({ headNet: 100 * W, spouseNet: 900 * W }).claim, 0);
  assert.equal(F.maritalClaim({ regime: 'separate', headNet: 900 * W, spouseNet: 0 }).applicable, false);
  assert.equal(F.maritalClaim({ headNet: 900 * W, spouseNet: null }).applicable, false);
});
t('贈與：配偶不計入、免稅額、2 年內併入', () => {
  const g = F.giftSummary([
    { date: '2026-03-01', from: 'H', toRel: 'child', amount: 200 * W },
    { date: '2026-06-01', from: 'H', toRel: 'spouse', amount: 1000 * W },
    { date: '2026-08-01', from: 'H', toRel: 'child', amount: 100 * W },
    { date: '2024-11-27', from: 'H', toRel: 'child', amount: 50 * W },
    { date: '2024-11-26', from: 'H', toRel: 'child', amount: 70 * W },
    { date: '2026-01-05', from: 'H', toRel: 'other', amount: 30 * W },
    { date: '2026-02-01', from: 'S', toRel: 'child', amount: 10 * W },
  ], 'H', '2026-11-27');
  assert.equal(g.byGiver.H[2026].taxable, 330 * W);
  assert.equal(g.byGiver.H[2026].over, 86 * W);
  assert.equal(g.thisYear.H.left, 0);
  assert.equal(g.thisYear.S.left, 234 * W);
  assert.equal(g.addBack, (200 + 1000 + 100 + 50) * W); // 2024-11-26 超過 2 年、other 非繼承人
});
t('保單風險特徵', () => {
  const f = F.policyFlags({ kind: 'main', issueAge: 72, pay_mode: '年繳', term: '躉繳', effective: '2026-01-01', sa: 1000, saUnit: '萬', annualPremium: 1000 * W, payYears: 1 }, '2026-11-27');
  assert.deepStrictEqual(f, ['高齡投保', '躉繳', '投保未滿 2 年', '保額≈保費']);
  assert.deepStrictEqual(F.policyFlags({ kind: 'main', issueAge: 40, pay_mode: '年繳', term: '20年', effective: '2015-01-01', sa: 500, saUnit: '萬', annualPremium: 5 * W, payYears: 20 }, '2026-11-27'), []);
});
t('燈號', () => {
  const L = F.lights({ estateTax: 500 * W, liquid: 100 * W, insToHeirs: 300 * W, coverage: [{ name: '甲', earner: true, death: false, medical: true, critical: true }], retire: null, assets: 1000 * W, liabilities: 600 * W, income: 100 * W, expense: 120 * W, hasWill: false });
  const lv = Object.fromEntries(L.map((x) => [x.k, x.lv]));
  assert.deepStrictEqual(lv, { tax: 'r', cover: 'r', retire: 'n', debt: 'r', cash: 'r', legacy: 'y' });
});
console.log(`${n} passed`);
