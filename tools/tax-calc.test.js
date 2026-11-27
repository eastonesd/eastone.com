// 稅務規劃試算測試（虛構資料）：node --test tools/tax-calc.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../clients/tax-calc.js');
const W = 10000;
const base = { exemption: true, necessities: false, tools: false, funeral: false, spouse: { on: false }, descendants: [], parents: [], dependents: [], debts: 0 };

test('遺產：只勾免稅額，淨額＝總額−1333萬，10% 級距', () => {
  const r = T.estate({ ...base, gross: 3333 * W });
  assert.equal(r.net, 2000 * W);
  assert.equal(r.tax, 200 * W);
});

test('遺產：配偶、成年子女、父母、喪葬費、不計入項目', () => {
  const r = T.estate({ ...base, gross: 5000 * W, necessities: true, tools: true, funeral: true, spouse: { on: true },
    descendants: [{ age: '' }, { age: 30 }], parents: [{}] });
  // 1333 + 100 + 56 + 553 + 56×2 + 138 + 138 = 2430
  assert.equal(r.totalOff, 2430 * W);
  assert.equal(r.net, 2570 * W);
});

test('遺產：未滿 18 歲每差 1 歲加 56 萬、重度身障加 693 萬', () => {
  const r = T.estate({ ...base, exemption: false, gross: 10000 * W, descendants: [{ age: 5, disabled: true }], spouse: { on: true, disabled: true } });
  // 子女 5 歲：56 ×(1+13) = 784；身障 693；配偶 553＋693
  assert.equal(r.totalOff, (784 + 693 + 553 + 693) * W);
});

test('遺產：受扶養兄弟姊妹未滿 18 歲加扣；父母最多 2 人', () => {
  const r = T.estate({ ...base, exemption: false, gross: 1000 * W, dependents: [{ age: 16 }, { age: 70 }] });
  assert.equal(r.totalOff, (56 * 3 + 56) * W);
  assert.throws(() => T.estate({ ...base, gross: 1, parents: [{}, {}, {}] }), /最多 2 人/);
});

test('遺產：級距邊界 5621 萬、1 億 1242 萬', () => {
  const at = (net) => T.estate({ ...base, exemption: false, gross: net }).tax;
  assert.equal(at(5621 * W), 562.1 * W);
  assert.equal(at(11242 * W), 562.1 * W + 843.15 * W);
  assert.equal(at(12242 * W), 562.1 * W + 843.15 * W + 200 * W);
});

test('贈與：244 萬以內免稅，超過部分依淨額 2811／5621 萬分段', () => {
  assert.equal(T.gift([{ form: 'cash', amount: 244 * W }]).tax, 0);
  const r = T.gift([{ recipient: '長子', form: 'cash', amount: 200 * W }, { recipient: '長子', form: 'policy', amount: 300 * W }]);
  assert.equal(r.total, 500 * W);
  assert.equal(r.net, 256 * W);
  assert.equal(r.tax, 25.6 * W);
  assert.equal(r.byRecipient['長子'], 500 * W);
  // 總額 3055 萬＝淨額 2811 萬：全部 10%
  assert.equal(T.gift([{ form: 'securities', amount: 3055 * W }]).tax, 281.1 * W);
  // 總額 6865 萬：淨額 6621 萬
  assert.equal(T.gift([{ form: 'property', amount: 6865 * W }]).tax, 281.1 * W + 421.5 * W + 200 * W);
});

test('贈與：形式必選、金額大於 0', () => {
  assert.throws(() => T.gift([{ form: 'x', amount: 1 }]), /贈與形式/);
  assert.throws(() => T.gift([{ form: 'cash', amount: 0 }]), /大於 0/);
});

test('綜所稅：115 年度級距（累進差額驗算）', () => {
  assert.equal(T.incomeTax(61 * W), 30500);
  assert.equal(T.incomeTax(100 * W), 100 * W * 0.12 - 42700);
  assert.equal(T.incomeTax(300 * W), 300 * W * 0.3 - 430100);
  assert.equal(T.incomeTax(800 * W), 800 * W * 0.4 - 949100);
});

test('最低稅負：身故保險金 3,740 萬以內免計入，超過部分計入基本所得額', () => {
  const a = T.amt({ netIncome: 0, deathBenefit: 3740 * W });
  assert.equal(a.base, 0); assert.equal(a.due, 0);
  // 身故金 6,000 萬、無其他所得：基本所得額 2,260 萬 − 750 萬 = 1,510 萬 × 20% = 302 萬
  const b = T.amt({ netIncome: 0, deathBenefit: 6000 * W });
  assert.equal(b.base, 2260 * W); assert.equal(b.basicTax, 302 * W); assert.equal(b.due, 302 * W);
  // 不用補稅的身故金上限：3,740 + 750 = 4,490 萬
  assert.equal(b.safeDeath, 4490 * W);
  assert.equal(T.amt({ netIncome: 0, deathBenefit: 4490 * W }).due, 0);
  assert.equal(T.amt({ netIncome: 0, deathBenefit: 4491 * W }).due, 2000);
});

test('最低稅負：一般所得稅額可抵；海外所得未達 100 萬免計入；可手動指定一般稅額', () => {
  const r = T.amt({ netIncome: 300 * W, deathBenefit: 5000 * W, overseas: 99 * W });
  const regular = 300 * W * 0.3 - 430100;
  assert.equal(r.regularTax, regular);
  assert.equal(r.base, (300 + 1260) * W);
  assert.equal(r.basicTax, (1560 - 750) * W * 0.2);
  assert.equal(r.due, (1560 - 750) * W * 0.2 - regular);
  const m = T.amt({ netIncome: 300 * W, regularTax: 0, deathBenefit: 0, overseas: 100 * W, other: 400 * W });
  assert.equal(m.base, 800 * W); assert.equal(m.due, 10 * W); assert.equal(m.autoTax, false);
});
