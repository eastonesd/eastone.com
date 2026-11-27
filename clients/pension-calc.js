// ============================================================
// 社會保險／退休金計算核心（純函式，瀏覽器與 node 測試共用）
//   勞保、勞退、國民年金、公教人員退撫（年改後）、公保、軍保、農保（含老農津貼、農民退休儲金）
// 規則數字集中在 RULES，政府公告調整時只改這裡；金額一律「元」
// 資料基準：2026 年（民國 115 年）
// ============================================================
(function (root) {
  'use strict';
  const RULES = Object.freeze({
    year: 2026,
    labor: { wageMax: 45800, wageMin: 29500, rateA: 0.00775, addA: 3000, rateB: 0.0155, lumpMax: 45, lumpMaxAfter60: 50,
      adjPerYear: 0.04, adjMaxYears: 5, survivorMin: 3000, disabilityMin: 4000, funeralMonths: 5, bump: 0.25, bumpMax: 0.5 },
    laborPension: { wageMax: 150000, empRate: 0.06, selfMax: 0.06, claimAge: 60 },
    national: { insured: 21103, rateA: 0.0065, addA: 4049, rateB: 0.013, disabilityMin: 5437, survivorMin: 4049, funeralMonths: 5, claimAge: 65 },
    // 公教人員年改：35 年資的替代率 107 年 75%，每年降 1.5%，117 年起 60%；少 1 年 −1.5%、多 1 年 +0.5%（最多 40 年）
    civil: { rate35Start: 75, rate35Floor: 60, startYear: 107, step: 1.5, perYearBelow: 1.5, perYearAbove: 0.5, minYears: 15, maxYears: 40,
      floor: 33140, avgYearsStart: 5, avgYearsMax: 15, newRate: 0.02, claimAge: 65 },
    govIns: { lumpPerYear: 1.2, lumpMax: 36, annuityMaxYears: 35, deathIllness: 30, deathDuty: 36 },
    military: { death: { combat: 48, duty: 42, illness: 36 }, disability: { combat: [40, 30, 20, 10], duty: [36, 24, 16, 8], illness: [30, 20, 12, 6] } },
    farmer: { insured: 10200, funeral: 153000, allowance: 8110, allowanceHalf: 4055, retireWage: 29500, rateMin: 0.01, rateMax: 0.10, govShare: 0.6, claimAge: 65 },
  });
  const n = (x) => Number(x) || 0;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const r0 = (x) => Math.round(x);

  // 每月年金 ←→ 專戶餘額：在 years 年內、年利率 rate 平均領完（勞退、農退儲金的月退估算）
  function annuityMonthly(balance, years, rate) {
    const m = Math.max(1, Math.round(n(years) * 12)), i = n(rate) / 12;
    return i ? balance * i / (1 - Math.pow(1 + i, -m)) : balance / m;
  }
  // 逐年累積個人專戶：每年提繳 contrib（第一年）、薪資成長 g、報酬率 ret
  function accumulate({ balance = 0, yearly = 0, years = 0, ret = 0, growth = 0 }) {
    let b = n(balance), c = n(yearly);
    const rows = [];
    for (let y = 1; y <= Math.max(0, Math.round(years)); y++) { b = b * (1 + ret) + c * (1 + ret / 2); rows.push(b); c *= 1 + growth; }
    return { balance: b, rows };
  }

  // ---------------- 勞保 ----------------
  // 法定請領年齡：民國 46 年次以前 60 歲，47 年次 61……51 年次以後 65 歲
  function laborClaimAge(birthYear) {
    const roc = n(birthYear) > 1911 ? n(birthYear) - 1911 : n(birthYear);
    return roc <= 46 ? 60 : roc >= 51 ? 65 : 60 + (roc - 46);
  }
  // avgWage：最高 60 個月平均月投保薪資；years：投保年資（可有小數）；oldYears：97 年前的年資（決定可否選一次請領老年給付）
  function labor({ avgWage, years, birthYear, claimAge, oldYears = 0, yearsAfter60 = 0, dependents = 0 }) {
    const R = RULES.labor;
    const w = clamp(n(avgWage), 0, R.wageMax), y = Math.max(0, n(years));
    const legal = laborClaimAge(birthYear);
    const age = claimAge ? n(claimAge) : legal;
    const diff = clamp(age - legal, -R.adjMaxYears, R.adjMaxYears);
    const A = w * y * R.rateA + R.addA, B = w * y * R.rateB;
    const base = Math.max(A, B);
    const monthly = y >= 15 ? r0(base * (1 + diff * R.adjPerYear)) : 0;
    // 一次請領老年給付（有 97 年前年資才能選）：60 歲前年資前 15 年每年 1 個月、之後每年 2 個月，最高 45 個月；60 歲後年資最多再計 5 年（合計 50 個月）
    const yb = Math.max(0, y - n(yearsAfter60));
    let months = Math.min(yb, 15) + Math.max(0, yb - 15) * 2;
    months = Math.min(months, R.lumpMax) + Math.min(n(yearsAfter60), 5);
    months = Math.min(months, R.lumpMaxAfter60);
    const lumpOld = n(oldYears) > 0 ? r0(w * months) : null;
    // 年資未滿 15 年：老年一次金（每滿 1 年 1 個月）
    const lumpSmall = y < 15 ? r0(w * y) : null;
    const bump = Math.min(R.bumpMax, Math.max(0, n(dependents) - 1) * R.bump);
    const survivor = r0(Math.max(R.survivorMin, w * y * R.rateB) * (1 + bump));
    const disability = r0(Math.max(R.disabilityMin, w * y * R.rateB) * (1 + Math.min(R.bumpMax, n(dependents) * R.bump)));
    // 損益平衡：月領 vs 一次領，幾年後月領總額超過一次領
    const breakEven = lumpOld && monthly ? Math.ceil(lumpOld / monthly / 12 * 10) / 10 : null;
    return { wage: w, years: y, legalAge: legal, claimAge: age, adjust: diff * R.adjPerYear, A: r0(A), B: r0(B), formula: A >= B ? 'A' : 'B', monthly, eligibleAnnuity: y >= 15,
      lumpMonths: months, lumpOld, lumpSmall, breakEven, funeral: r0(w * R.funeralMonths), survivor, survivorAfterAnnuity: monthly ? r0(Math.max(R.survivorMin, monthly * 0.5)) : null, disability };
  }

  // 勞保「一次請領老年給付」（舊制，98 年前有年資者才能選）的請領條件
  // years：勞保年資；age：退職時年齡；female；sameUnitYears：同一投保單位年資；special：特殊性質工作年資
  function laborOldEligible({ years, age, female = false, sameUnitYears = 0, special = 0 }) {
    const y = n(years), a = n(age);
    const ok = [
      [y >= 1 && (a >= 60 || (female && a >= 55)), `年資滿 1 年、年滿 ${female ? 55 : 60} 歲`],
      [y >= 15 && a >= 55, '年資滿 15 年、年滿 55 歲'],
      [n(sameUnitYears) >= 25, '同一投保單位年資滿 25 年'],
      [y >= 25 && a >= 50, '年資滿 25 年、年滿 50 歲'],
      [n(special) >= 5 && a >= 55, '特殊性質工作滿 5 年、年滿 55 歲'],
    ].find(([c]) => c);
    return ok ? { ok: true, why: ok[1] } : { ok: false, why: '不符合任何舊制請領條件（例：年資滿 1 年且年滿 60 歲）' };
  }

  // ---------------- 勞基法舊制退休金（94 年 7 月前的年資，由雇主一次給付）----------------
  // 年資零頭：未滿半年以半年計、滿半年以一年計（勞基法第 55 條）
  function stdYears(y) { const v = Math.max(0, n(y)), f = v - Math.floor(v); return Math.floor(v) + (f <= 1e-9 ? 0 : f < 0.5 ? 0.5 : 1); }
  function stdBases(y) { const v = stdYears(y); return Math.min(45, Math.min(15, v) * 2 + Math.max(0, v - 15)); }
  // oldYears：保留的舊制年資；totalYears：同一雇主新舊制合計年資（判斷退休條件）；avgWage：退休前 6 個月平均工資
  function laborStd({ oldYears, totalYears, avgWage, retireAge, settled = false }) {
    const ty = Math.max(n(totalYears), n(oldYears)), a = n(retireAge);
    const cond = [
      [ty >= 15 && a >= 55, '工作 15 年以上、年滿 55 歲（自請退休）'],
      [ty >= 25, '工作 25 年以上（自請退休）'],
      [ty >= 10 && a >= 60, '工作 10 年以上、年滿 60 歲（自請退休）'],
      [a >= 65, '年滿 65 歲（雇主可強制退休）'],
    ].find(([c]) => c);
    const bases = stdBases(oldYears);
    return { counted: stdYears(oldYears), bases, amount: settled ? 0 : r0(bases * n(avgWage)), eligible: !!cond, why: cond ? cond[1] : '還不符合退休條件（15 年＋55 歲、25 年、或 10 年＋60 歲）', settled };
  }

  // ---------------- 勞退新制（個人專戶）----------------
  function laborPension({ age, wage, selfRate = 0, balance = 0, ret = 0.03, growth = 0.01, claimAge, lifeYears = 24, annuityRate = 0.015 }) {
    const R = RULES.laborPension;
    const w = clamp(n(wage), 0, R.wageMax), ca = claimAge ? n(claimAge) : R.claimAge;
    const years = Math.max(0, ca - n(age));
    const rate = R.empRate + clamp(n(selfRate), 0, R.selfMax);
    const acc = accumulate({ balance, yearly: w * rate * 12, years, ret, growth });
    const monthly = r0(annuityMonthly(acc.balance, lifeYears, annuityRate));
    // 自提 6% 節稅：自提金額不計入當年度薪資所得
    const selfYearly = r0(w * clamp(n(selfRate), 0, R.selfMax) * 12);
    return { wage: w, years, claimAge: ca, rate, balance: r0(acc.balance), monthly, selfYearly, rows: acc.rows };
  }

  // ---------------- 國民年金 ----------------
  // otherSocial：同時有勞保、公教保等其他社會保險老年給付（就不能用 A 式加計）
  // 國保老年年金 65 歲起領，沒有提前減額或延後增額
  function national({ years, otherSocial = false, dependents = 0 }) {
    const R = RULES.national;
    const y = Math.max(0, n(years)), w = R.insured;
    const A = w * y * R.rateA + R.addA, B = w * y * R.rateB;
    const useA = !otherSocial && A > B;
    const bump = Math.min(0.5, Math.max(0, n(dependents) - 1) * 0.25);
    return { insured: w, years: y, A: r0(A), B: r0(B), formula: useA ? 'A' : 'B', monthly: r0(useA ? A : B), claimAge: R.claimAge,
      disability: r0(Math.max(R.disabilityMin, w * y * R.rateB)), survivor: r0(Math.max(R.survivorMin, w * y * R.rateB) * (1 + bump)), funeral: r0(w * R.funeralMonths) };
  }

  // ---------------- 公教人員退撫（年改後）----------------
  function civilRate(retireYearRoc, years) {
    const C = RULES.civil;
    const roc = n(retireYearRoc) > 1911 ? n(retireYearRoc) - 1911 : n(retireYearRoc);
    const t = clamp(roc - C.startYear, 0, (C.rate35Start - C.rate35Floor) / C.step);
    const base35 = C.rate35Start - C.step * t;
    const y = clamp(Math.floor(n(years)), C.minYears, C.maxYears);
    return y <= 35 ? base35 - C.perYearBelow * (35 - y) : base35 + C.perYearAbove * (y - 35);
  }
  // salary：均俸期間的平均本俸（月）；years：任職年資；retireYear：退休年度（西元或民國）
  function civil({ salary, years, retireYear }) {
    const C = RULES.civil;
    const roc = n(retireYear) > 1911 ? n(retireYear) - 1911 : n(retireYear);
    const avgYears = clamp(C.avgYearsStart + (roc - C.startYear), C.avgYearsStart, C.avgYearsMax);
    const y = Math.max(0, n(years));
    const base = n(salary) * 2; // 本俸 × 2
    const rate = y >= C.minYears ? civilRate(roc, y) : null;
    const cap = rate == null ? null : base * rate / 100;
    // 新制月退休金：本俸×2 × 2% × 年資（35 年 70%，36～40 年每年 +1%，最高 75%）
    const pct = Math.min(35, y) * 2 + Math.max(0, Math.min(40, y) - 35) * 1;
    const raw = base * pct / 100;
    let monthly = cap == null ? 0 : Math.min(raw, cap);
    const floored = cap != null && monthly < C.floor && raw >= C.floor;
    if (floored) monthly = C.floor;
    if (cap != null && raw < C.floor) monthly = raw; // 原本就低於樓地板：照原數額
    return { base, years: y, retireYearRoc: roc, avgYears, rate, cap: cap == null ? null : r0(cap), raw: r0(raw), rawPct: pct, monthly: r0(monthly), floored, eligible: y >= C.minYears, claimAge: C.claimAge };
  }

  // ---------------- 公保 ----------------
  // salary：保險俸額（平均）；rate：養老年金給付率（每年 0.75%～1.3%，依退撫制度）
  function govIns({ salary, years, rate = 0.013 }) {
    const G = RULES.govIns, s = n(salary), y = Math.max(0, n(years));
    const lumpMonths = Math.min(G.lumpMax, y * G.lumpPerYear);
    const annuityPct = Math.min(G.annuityMaxYears, y) * clamp(n(rate), 0.0075, 0.013);
    return { salary: s, years: y, lumpMonths: Math.round(lumpMonths * 10) / 10, lump: r0(s * lumpMonths), annuityPct, annuity: r0(s * annuityPct),
      deathIllness: r0(s * G.deathIllness), deathDuty: r0(s * G.deathDuty) };
  }

  // ---------------- 軍保 ----------------
  function militaryBases(years) {
    const y = Math.floor(Math.max(0, n(years)));
    if (y < 5) return 0;
    let b = 5 + Math.min(5, y - 5);                       // 6～10 年 +1
    if (y > 10) b += 2 * Math.min(5, y - 10);             // 11～15 年 +2
    if (y > 15) b += 3 * Math.min(5, y - 15);             // 16～20 年 +3
    if (y > 20) b += y - 20;                              // 21 年起 +1
    return Math.min(45, b);
  }
  function military({ salary, years }) {
    const M = RULES.military, s = n(salary);
    const bases = militaryBases(years);
    return { salary: s, years: n(years), bases, discharge: r0(s * bases),
      death: Object.fromEntries(Object.entries(M.death).map(([k, v]) => [k, { bases: v, amount: r0(s * v) }])),
      disability: Object.fromEntries(Object.entries(M.disability).map(([k, arr]) => [k, arr.map((v) => ({ bases: v, amount: r0(s * v) }))])) };
  }

  // ---------------- 農保、老農津貼、農民退休儲金 ----------------
  function farmer({ age, farmYears, rate = 0.1, balance = 0, ret = 0.03, claimAge, lifeYears = 20, annuityRate = 0.015, allowance }) {
    const F = RULES.farmer, ca = claimAge ? n(claimAge) : F.claimAge;
    const r = clamp(n(rate), F.rateMin, F.rateMax);
    const total = F.retireWage * r;                       // 每月提繳總額（農民＋政府）
    const self = r0(total * (1 - F.govShare)), gov = r0(total * F.govShare);
    const years = Math.max(0, ca - n(age));
    const acc = accumulate({ balance, yearly: total * 12, years, ret, growth: 0 });
    const fy = n(farmYears), full = n(allowance) || F.allowance;
    const allow = fy >= 15 ? full : fy >= 0.5 ? r0(full / 2) : 0;
    return { rate: r, self, gov, total: r0(total), years, claimAge: ca, balance: r0(acc.balance), monthly: r0(annuityMonthly(acc.balance, lifeYears, annuityRate)), allowance: allow,
      allowanceFull: fy >= 15, funeral: F.funeral, insured: F.insured };
  }

  const api = Object.freeze({ RULES, annuityMonthly, accumulate, laborClaimAge, labor, laborOldEligible, stdYears, stdBases, laborStd, laborPension, national, civilRate, civil, govIns, militaryBases, military, farmer });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EastonePension = api;
})(typeof window !== 'undefined' ? window : globalThis);
