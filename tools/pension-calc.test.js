const test = require('node:test');
const assert = require('node:assert');
const P = require('../clients/pension-calc.js');

test('勞保：請領年齡依出生年', () => {
  assert.equal(P.laborClaimAge(1957), 60); assert.equal(P.laborClaimAge(48), 62); assert.equal(P.laborClaimAge(1975), 65);
});
test('勞保：月領 B 式、一次請領 45 個月（官方範例 4 萬 30 年 180 萬）', () => {
  const r = P.labor({ avgWage: 45800, years: 35, birthYear: 1970 });
  assert.equal(r.formula, 'B'); assert.equal(r.monthly, Math.round(45800 * 35 * 0.0155));
  const l = P.labor({ avgWage: 40000, years: 30, birthYear: 1965, oldYears: 10 });
  assert.equal(l.lumpMonths, 45); assert.equal(l.lumpOld, 1800000);
});
test('勞保：低薪短年資用 A 式；提前 2 年減 8%、延後 5 年加 20%（最多 5 年）', () => {
  const a = P.labor({ avgWage: 20000, years: 15, birthYear: 1970 }); // 部分工時低投保薪資
  assert.equal(a.formula, 'A'); assert.equal(a.monthly, Math.round(20000 * 15 * 0.00775 + 3000));
  const e = P.labor({ avgWage: 45800, years: 30, birthYear: 1970, claimAge: 63 });
  assert.equal(e.monthly, Math.round(45800 * 30 * 0.0155 * 0.92));
  const d = P.labor({ avgWage: 45800, years: 30, birthYear: 1970, claimAge: 72 });
  assert.equal(d.monthly, Math.round(45800 * 30 * 0.0155 * 1.2));
});
test('勞保：未滿 15 年只能一次金；投保薪資超過上限以 45,800 計', () => {
  const r = P.labor({ avgWage: 60000, years: 10, birthYear: 1980 });
  assert.equal(r.monthly, 0); assert.equal(r.lumpSmall, 458000); assert.equal(r.wage, 45800);
});
test('國保：15 年 A 式 6,107（衛福部 115 年公告）；有勞保只能 B 式', () => {
  assert.equal(P.national({ years: 15 }).monthly, 6107);
  const b = P.national({ years: 15, otherSocial: true });
  assert.equal(b.formula, 'B'); assert.equal(b.monthly, Math.round(21103 * 15 * 0.013));
  assert.equal(P.national({ years: 1 }).funeral, 105515);
});
test('勞退：無提繳時月領＝餘額平均攤提', () => {
  const r = P.laborPension({ age: 60, wage: 50000, balance: 2880000, ret: 0, lifeYears: 24, annuityRate: 0 });
  assert.equal(r.years, 0); assert.equal(r.monthly, 10000);
  const g = P.laborPension({ age: 30, wage: 200000, selfRate: 0.1 });
  assert.equal(g.wage, 150000); assert.equal(g.rate, 0.12); assert.equal(g.selfYearly, 108000);
});
test('公教：115 年 35 年資替代率 63%、25 年 48%、40 年 65.5%；117 年後 60%', () => {
  assert.equal(P.civilRate(115, 35), 63); assert.equal(P.civilRate(115, 25), 48); assert.equal(P.civilRate(115, 40), 65.5);
  assert.equal(P.civilRate(120, 35), 60); assert.equal(P.civilRate(2018, 35), 75);
  const c = P.civil({ salary: 53075, years: 30, retireYear: 2026 });
  assert.equal(c.rate, 55.5); assert.equal(c.monthly, Math.round(53075 * 2 * 0.555)); assert.equal(c.avgYears, 13);
});
test('公教：低薪觸及樓地板 33,140', () => {
  const c = P.civil({ salary: 34000, years: 25, retireYear: 2026 });
  assert.equal(c.cap, 32640); assert.equal(c.monthly, 33140); assert.ok(c.floored);
  const lo = P.civil({ salary: 30000, years: 25, retireYear: 2026 });
  assert.equal(lo.monthly, 30000); // 原本就低於樓地板：照原數額
});
test('公保：一次養老給付每年 1.2 個月、最高 36 個月', () => {
  assert.equal(P.govIns({ salary: 50000, years: 30 }).lumpMonths, 36);
  assert.equal(P.govIns({ salary: 50000, years: 10 }).lump, 600000);
  assert.equal(P.govIns({ salary: 50000, years: 40, rate: 0.013 }).annuity, Math.round(50000 * 35 * 0.013));
});
test('軍保：退伍給付基數', () => {
  assert.deepStrictEqual([4, 5, 10, 15, 19, 20, 25, 30].map(P.militaryBases), [0, 5, 10, 20, 32, 35, 40, 45]);
  assert.equal(P.military({ salary: 40000, years: 20 }).death.illness.amount, 1440000);
});
test('農民：老農津貼 15 年全額、未滿半額；退儲金政府 6 成', () => {
  const f = P.farmer({ age: 65, farmYears: 20, rate: 0.1 });
  assert.equal(f.allowance, 8110); assert.equal(f.total, 2950); assert.equal(f.gov, 1770); assert.equal(f.self, 1180);
  assert.equal(P.farmer({ age: 65, farmYears: 10 }).allowance, 4055);
});

test('勞保舊制一次請領條件', () => {
  assert.equal(P.laborOldEligible({ years: 10, age: 58 }).ok, false);
  assert.equal(P.laborOldEligible({ years: 10, age: 56, female: true }).ok, true);
  assert.equal(P.laborOldEligible({ years: 16, age: 55 }).ok, true);
  assert.equal(P.laborOldEligible({ years: 26, age: 50 }).ok, true);
  assert.equal(P.laborOldEligible({ years: 26, age: 45, sameUnitYears: 25 }).ok, true);
});
test('勞基法舊制：年資零頭、基數、上限 45、退休條件新舊合計', () => {
  assert.deepStrictEqual([0.3, 0.5, 10.2, 10.6, 15, 20, 40].map(P.stdYears), [0.5, 1, 10.5, 11, 15, 20, 40]);
  assert.deepStrictEqual([10, 15, 20, 30, 40].map(P.stdBases), [20, 30, 35, 45, 45]);
  const r = P.laborStd({ oldYears: 8, totalYears: 26, avgWage: 50000, retireAge: 50 });
  assert.equal(r.eligible, true); assert.equal(r.amount, 800000);
  assert.equal(P.laborStd({ oldYears: 8, totalYears: 20, avgWage: 50000, retireAge: 50 }).eligible, false);
  assert.equal(P.laborStd({ oldYears: 8, totalYears: 26, avgWage: 50000, retireAge: 60, settled: true }).amount, 0);
});
