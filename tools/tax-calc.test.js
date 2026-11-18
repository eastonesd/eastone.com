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

test('贈與：244 萬內 0%，244～2811 萬 10%，2811～5621 萬 15%，超過 5621 萬 20%（以年度總額分段）', () => {
  assert.equal(T.gift([{ form: 'cash', amount: 244 * W }]).tax, 0);
  const r = T.gift([{ recipient: '長子', form: 'cash', amount: 200 * W }, { recipient: '長子', form: 'policy', amount: 300 * W }]);
  assert.equal(r.total, 500 * W);
  assert.equal(r.tax, 25.6 * W);
  assert.equal(r.byRecipient['長子'], 500 * W);
  assert.equal(T.gift([{ form: 'securities', amount: 2811 * W }]).tax, 256.7 * W);
  assert.equal(T.gift([{ form: 'securities', amount: 5621 * W }]).tax, 256.7 * W + 421.5 * W);
  assert.equal(T.gift([{ form: 'property', amount: 6621 * W }]).tax, 256.7 * W + 421.5 * W + 200 * W);
});

test('贈與：形式必選、金額大於 0', () => {
  assert.throws(() => T.gift([{ form: 'x', amount: 1 }]), /贈與形式/);
  assert.throws(() => T.gift([{ form: 'cash', amount: 0 }]), /大於 0/);
});
