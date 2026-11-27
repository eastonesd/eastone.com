// ============================================================
// 現金流與退休規劃計算核心（純函式，瀏覽器與 node 測試共用）
// 逐年模擬：可投資資產 × (1＋報酬率) ＋ 當年收入 − 當年支出 − 大額支出；金額以「今天的幣值」輸入，依通膨逐年放大
// ============================================================
(function (root) {
  'use strict';
  // p: { age, retireAge, lifeAge, assets, monthlyIncome, monthlyExpense, retireRatio(0~1), pension（退休後每月）, pensionAge,
  //      lumpSum（退休時一次領）, otherIncome:[{fromAge,toAge,monthly}], bigs:[{age, amount, label}], ret（年報酬%）, infl（通膨%）, extraSave（退休前每月加存）}
  function simulate(p) {
    const r = (Number(p.ret) || 0) / 100, i = (Number(p.infl) || 0) / 100;
    const age0 = Math.round(Number(p.age) || 0), R = Math.round(Number(p.retireAge) || 65), END = Math.round(Number(p.lifeAge) || 90);
    let bal = Number(p.assets) || 0;
    const rows = [];
    let depleted = null;
    for (let a = age0; a <= END; a++) {
      const f = Math.pow(1 + i, a - age0);
      const working = a < R;
      let inc = 0, exp = 0;
      if (working) { inc += (Number(p.monthlyIncome) || 0) * 12 * f + (Number(p.extraSave) || 0) * 12; exp += (Number(p.monthlyExpense) || 0) * 12 * f; }
      else exp += (Number(p.monthlyExpense) || 0) * (p.retireRatio == null ? 0.8 : Number(p.retireRatio)) * 12 * f;
      if (a >= (Number(p.pensionAge) || R)) inc += (Number(p.pension) || 0) * 12 * f;
      if (a === R) inc += (Number(p.lumpSum) || 0) * f;
      (p.otherIncome || []).forEach((o) => { if (a >= Number(o.fromAge) && a <= (Number(o.toAge) || END)) inc += (Number(o.monthly) || 0) * 12 * (o.fixed ? 1 : f); });
      const big = (p.bigs || []).filter((b) => Math.round(Number(b.age)) === a).reduce((s, b) => s + (Number(b.amount) || 0) * f, 0);
      const growth = bal > 0 ? bal * r : 0;
      const start = bal;
      bal = bal + growth + inc - exp - big;
      if (depleted === null && bal < 0 && a >= age0) depleted = a;
      rows.push({ age: a, start, growth, income: inc, expense: exp, big, end: bal, real: bal / f, working });
    }
    const atRetire = rows.find((x) => x.age === R) || null;
    return { rows, depleted, atRetire: atRetire ? atRetire.start : null, final: bal, finalReal: rows.length ? rows[rows.length - 1].real : 0 };
  }
  // 要讓資產撐到預期壽命，退休前每月還要多存多少（今天幣值、固定金額）；已足夠回傳 0；退休後才開始算則回傳 null
  function extraSaving(p) {
    if (Math.round(Number(p.age)) >= Math.round(Number(p.retireAge))) return null;
    if (simulate({ ...p, extraSave: 0 }).depleted === null) return 0;
    let lo = 0, hi = 1e5;
    while (simulate({ ...p, extraSave: hi }).depleted !== null && hi < 1e9) hi *= 2;
    for (let k = 0; k < 50; k++) { const mid = (lo + hi) / 2; if (simulate({ ...p, extraSave: mid }).depleted === null) hi = mid; else lo = mid; }
    return Math.ceil(hi / 100) * 100;
  }
  const api = Object.freeze({ simulate, extraSaving });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EastoneRetire = api;
})(typeof window !== 'undefined' ? window : globalThis);
