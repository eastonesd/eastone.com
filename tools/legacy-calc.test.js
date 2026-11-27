// node --test tools/legacy-calc.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../clients/legacy-calc.js');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
const share = (r, id) => r.rows.find((x) => x.id === id);

test('配偶＋兩名子女：三人平均；特留分為應繼分 1/2', () => {
  const r = L.legalShares([{ id: 's', rel: 'spouse' }, { id: 'a', rel: 'child' }, { id: 'b', rel: 'child' }]);
  assert.equal(r.order, 1);
  ['s', 'a', 'b'].forEach((id) => { near(share(r, id).share, 1 / 3); near(share(r, id).reserve, 1 / 6); });
});

test('子女先過世，兩名孫子女代位分該房', () => {
  const r = L.legalShares([{ id: 's', rel: 'spouse' }, { id: 'a', rel: 'child' }, { id: 'b', rel: 'child', alive: false },
    { id: 'g1', rel: 'grandchild', via: 'b' }, { id: 'g2', rel: 'grandchild', via: 'b' }]);
  near(share(r, 'a').share, 1 / 3); near(share(r, 'g1').share, 1 / 6); near(share(r, 'g2').share, 1 / 6);
});

test('子女拋棄不代位；全部拋棄改由孫子女', () => {
  const r1 = L.legalShares([{ id: 'a', rel: 'child' }, { id: 'b', rel: 'child', renounce: true }, { id: 'g', rel: 'grandchild', via: 'b' }]);
  near(share(r1, 'a').share, 1); assert.equal(share(r1, 'g'), undefined);
  const r2 = L.legalShares([{ id: 's', rel: 'spouse' }, { id: 'a', rel: 'child', renounce: true }, { id: 'g1', rel: 'grandchild', via: 'a' }, { id: 'g2', rel: 'grandchild', via: 'a' }]);
  near(share(r2, 's').share, 1 / 3); near(share(r2, 'g1').share, 1 / 3);
});

test('沒有子女：配偶與父母各半、配偶與祖父母 2/3；兄弟姊妹特留分 1/3', () => {
  const r = L.legalShares([{ id: 's', rel: 'spouse' }, { id: 'f', rel: 'parent' }, { id: 'm', rel: 'parent' }]);
  assert.equal(r.order, 2); near(share(r, 's').share, 1 / 2); near(share(r, 'f').share, 1 / 4);
  const r3 = L.legalShares([{ id: 's', rel: 'spouse' }, { id: 'x', rel: 'sibling' }]);
  near(share(r3, 'x').share, 1 / 2); near(share(r3, 'x').reserve, 1 / 6);
  const r4 = L.legalShares([{ id: 's', rel: 'spouse' }, { id: 'gp', rel: 'grandparent' }]);
  near(share(r4, 's').share, 2 / 3); near(share(r4, 'gp').reserve, 1 / 9);
  const r0 = L.legalShares([{ id: 's', rel: 'spouse' }, { id: 'f', rel: 'parent', alive: false }]);
  near(share(r0, 's').share, 1);
});

test('遺囑分配侵害特留分會被標出', () => {
  const sh = L.legalShares([{ id: 's', rel: 'spouse' }, { id: 'a', rel: 'child' }, { id: 'b', rel: 'child' }]);
  const d = L.distribute(9000000, sh, { s: 0.2, a: 0.8, b: 0 });
  assert.equal(d.violated.map((x) => x.id).sort().join(), 'b');
  assert.equal(share(d, 'b').reserveAmt, 1500000);
  assert.equal(share(d, 'b').short, 1500000);
});

test('身故保險金：指定受益人按比例、法定繼承人依應繼分、無受益人列入遺產；要保人＝受益人不計最低稅負', () => {
  const sh = L.legalShares([{ id: 's', rel: 'spouse' }, { id: 'a', rel: 'child' }]);
  const nameOf = (id) => ({ s: '王太太', a: '王小明' }[id]);
  const r = L.allocateInsurance([
    { amount: 10000000, applicant: '王先生', label: 'A', beneficiaries: [{ name: '王太太', type: 'named', order: 1, ratio: 60 }, { name: '王小明', type: 'named', order: 1, ratio: 40 }, { name: '法定繼承人', type: 'legal', order: 2 }] },
    { amount: 2000000, applicant: '王太太', label: 'B', beneficiaries: [{ name: '法定繼承人', type: 'legal', order: 1, equal: true }] },
    { amount: 500000, applicant: '王先生', label: 'C', beneficiaries: [] },
  ], sh.rows, nameOf);
  const p = (n) => r.people.find((x) => x.name === n);
  assert.equal(p('王太太').amount, 7000000); assert.equal(p('王太太').amtCounted, 6000000);
  assert.equal(p('王小明').amount, 5000000); assert.equal(p('王小明').amtCounted, 5000000);
  assert.equal(r.estateIn, 500000);
});
