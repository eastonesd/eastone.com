const test = require('node:test');
const assert = require('node:assert');
const T = require('../clients/transfer-calc.js');
const W = 10000;

test('土增稅：三級累進與長期持有減徵', () => {
  // 原地價 100 萬 × 物價指數 150 → 150 萬；申報 500 萬：漲價 350 萬，倍數 2.33（第三級）
  assert.equal(T.landIncrementTax({ value: 500 * W, prev: 100 * W, cpi: 150 }).tax, 95 * W);        // 350×40% − 150×30%
  assert.equal(T.landIncrementTax({ value: 500 * W, prev: 100 * W, cpi: 150, years: 25 }).tax, 90 * W); // 350×36% − 150×24%
  assert.equal(T.landIncrementTax({ value: 500 * W, prev: 100 * W, cpi: 150, years: 45 }).tax, 85 * W); // 350×32% − 150×18%
  // 第二級：漲價 150 萬、原地價 100 萬（倍數 1.5）→ 150×30% − 100×10% = 35 萬
  assert.equal(T.landIncrementTax({ value: 250 * W, prev: 100 * W }).tax, 35 * W);
  // 第一級：漲價 50 萬 → 20%
  assert.equal(T.landIncrementTax({ value: 150 * W, prev: 100 * W }).tax, 10 * W);
  assert.equal(T.landIncrementTax({ value: 500 * W, prev: 100 * W, cpi: 150, selfUse: true }).tax, 35 * W);
});
test('房地合一稅：持有期間稅率、自住 400 萬', () => {
  const base = { price: 2000 * W, cost: 1500 * W, expense: 0, landGain: 100 * W };
  assert.equal(T.houseLandTax({ ...base, years: 1.5 }).tax, 400 * W * 0.45);
  assert.equal(T.houseLandTax({ ...base, years: 3 }).tax, 400 * W * 0.35);
  assert.equal(T.houseLandTax({ ...base, years: 10 }).tax, 400 * W * 0.2);
  assert.equal(T.houseLandTax({ ...base, years: 11 }).tax, 400 * W * 0.15);
  assert.equal(T.houseLandTax({ ...base, years: 11, selfUse: true }).tax, 0);
  assert.equal(T.houseLandTax({ price: 2000 * W, cost: 1500 * W, years: 11 }).fee, 30 * W); // 3% 上限 30 萬
});
test('贈與稅邊際、遺產稅邊際', () => {
  assert.equal(T.giftTax(244 * W), 0);
  assert.equal(T.giftTax(344 * W), 10 * W);
  assert.equal(T.giftTax(100 * W, 244 * W), 10 * W);
  assert.equal(T.marginalEstate(0, 1000 * W), 100 * W);
});
test('移轉比較：繼承免土增稅、契稅；贈與出售成本低', () => {
  const r = T.compareTransfer({ land: 1500 * W, bldg: 200 * W, prev: 300 * W, cpi: 180, parentYears: 25, market: 3000 * W, otherEstate: 2000 * W, inheritIn: 10, sellIn: 15, growth: 0.02 });
  const by = Object.fromEntries(r.scenarios.map((s) => [s.k, s]));
  assert.ok(!by.inherit.now.some((x) => x.k === 'lit' || x.k === 'deed'));
  assert.ok(by.gift.now.find((x) => x.k === 'lit').amt > 0);
  assert.ok(by.gift.later.hl.tax > by.buy.later.hl.tax); // 贈與取得成本較低 → 出售所得較高
  assert.equal(by.inherit.later.hl.rate, 0.15);          // 持有期間合併父母 → 超過 10 年
  assert.ok(['gift', 'buy', 'inherit'].includes(r.best));
});
test('二次遺產稅：主張差額降低第一次，第二次增加；5 年內再繼承不計入', () => {
  const p = { a: 30000 * W, b: 2000 * W, kids: 2, gap: 10 };
  const c = T.compareSecondDeath(p);
  const by = Object.fromEntries(c.list.map((x) => [x.strategy, x]));
  assert.ok(by.claim.firstTax < by.noClaim.firstTax);
  assert.ok(by.claim.secondTax > by.renounce.secondTax - by.renounce.claim); // 有比較意義
  assert.equal(by.claim.claim, 14000 * W);
  const near = T.secondDeath({ ...p, gap: 3 }, 'noClaim');
  assert.equal(near.exclude, near.spouseGets);
  const far = T.secondDeath({ ...p, gap: 7 }, 'noClaim');
  assert.equal(far.deduct, Math.round(far.spouseGets * 0.6));
});
