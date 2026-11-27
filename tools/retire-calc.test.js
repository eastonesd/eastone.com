// node --test tools/retire-calc.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../clients/retire-calc.js');

test('零報酬零通膨：資產只靠收支加減', () => {
  const s = R.simulate({ age: 60, retireAge: 61, lifeAge: 62, assets: 1000000, monthlyIncome: 50000, monthlyExpense: 30000, retireRatio: 1, ret: 0, infl: 0 });
  assert.equal(s.rows[0].end, 1000000 + 240000);          // 60 歲還在工作：+50k−30k ×12
  assert.equal(s.rows[1].end, 1240000 - 360000);          // 61 歲退休
  assert.equal(s.final, 880000 - 360000);
  assert.equal(s.depleted, null);
});

test('報酬與通膨：資產先成長再算收支；支出依通膨放大', () => {
  const s = R.simulate({ age: 65, retireAge: 65, lifeAge: 66, assets: 1000000, monthlyExpense: 10000, retireRatio: 1, ret: 5, infl: 2 });
  assert.equal(Math.round(s.rows[0].end), 1000000 + 50000 - 120000);
  assert.equal(Math.round(s.rows[1].expense), Math.round(120000 * 1.02));
});

test('錢用完的年齡、退休金與一次領、大額支出', () => {
  const s = R.simulate({ age: 65, retireAge: 65, lifeAge: 80, assets: 600000, monthlyExpense: 10000, retireRatio: 1, ret: 0, infl: 0 });
  assert.equal(s.depleted, 70);                            // 每年 12 萬：65～69 剛好用完，70 歲那年不夠
  const p = R.simulate({ age: 64, retireAge: 65, lifeAge: 66, assets: 0, monthlyExpense: 0, pension: 20000, lumpSum: 1000000, bigs: [{ age: 66, amount: 500000 }], ret: 0, infl: 0 });
  assert.equal(p.rows[1].income, 240000 + 1000000);
  assert.equal(p.rows[2].big, 500000);
});

test('補足缺口的每月加存金額：加存後剛好撐到壽命', () => {
  const p = { age: 55, retireAge: 65, lifeAge: 85, assets: 1000000, monthlyIncome: 40000, monthlyExpense: 40000, retireRatio: 1, ret: 0, infl: 0 };
  const x = R.extraSaving(p);
  assert.ok(x > 0);
  assert.equal(R.simulate({ ...p, extraSave: x }).depleted, null);
  assert.notEqual(R.simulate({ ...p, extraSave: x - 200 }).depleted, null);
  assert.equal(R.extraSaving({ ...p, assets: 1e9 }), 0);
});
