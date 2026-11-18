const test = require('node:test');
const assert = require('node:assert/strict');
const { gift, estate } = require('../clients/tax-calc.js');

const event = (value, date = '2026-11-18', treatment = 'taxable') => ({ value, date, treatment });
const gifts = (events, credits = 0) => gift({ events, deductions: 0, credits });
const estateInput = {
  date: '2026-11-18', gross: 30000000, includedGifts: 0, spouse: true,
  children: 2, parents: 0, debts: 3000000, otherDeductions: 0, credits: 0,
};

test('贈與按同一人累計，前次應納稅額及不計入項目各自處理', () => {
  const r = gifts([event(2000000, '2026-01-01'), event(1000000), event(7000000, '2026-11-18', 'excluded')], 40000);
  assert.equal(r.gross, 3000000);
  assert.equal(r.excluded, 7000000);
  assert.equal(r.net, 560000);
  assert.equal(r.taxCents, 5600000);
  assert.equal(r.dueCents, 1600000);
  assert.equal(r.firstOver, '2026-11-18');
});

test('贈與在級距邊界只對超過部分加稅', () => {
  for (const [value, cents] of [[30550000, 281100000], [30550001, 281100015], [58650000, 702600000], [58650001, 702600020]]) {
    assert.equal(gifts([event(value)]).taxCents, cents);
  }
});

test('未知扣抵、待覆核贈與與未確認擬制遺產均只顯示小計', () => {
  assert.equal(gifts([event(3000000)], null).dueCents, null);
  const partial = gifts([event(3000000), event(1000000, '2026-11-18', 'pending')]);
  assert.equal(partial.taxCents, 5600000);
  assert.equal(partial.dueCents, null);
  assert.equal(estate({ ...estateInput, includedGifts: null }).dueCents, null);
});

test('遺產扣除額、級距及擬制遺產生效日', () => {
  assert.equal(estate(estateInput).dueCents, 56400000);
  assert.equal(estate({ ...estateInput, date: '2026-09-12' }).newDeemedEstateRules, false);
  assert.equal(estate({ ...estateInput, date: '2026-09-13' }).newDeemedEstateRules, true);
  assert.equal(estate({ ...estateInput, gross: 136780001 }).taxCents, 1405250020);
});

test('無效日期、年度及贈與順序不可混入試算', () => {
  assert.throws(() => gifts([event(1, '2026-02-30')]), /日期/);
  assert.throws(() => gifts([event(1, '2025-12-31')]), /日期/);
  assert.throws(() => gifts([event(1), event(1, '2026-10-01')]), /由早到晚/);
});
