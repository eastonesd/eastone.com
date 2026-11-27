// ============================================================
// 家辦整合計算核心（純函式，瀏覽器與 node 測試共用）
//   maritalClaim ：民法第 1030-1 條剩餘財產差額分配（法定財產制），遺贈稅法第 17 條之 1 可自遺產總額扣除
//   giftSummary  ：歷年贈與（每位贈與人每年免稅額）、死亡前 2 年內贈與併入遺產（遺贈稅法第 15 條）
//   policyFlags  ：保單實質課稅風險特徵（高齡、躉繳、短期、保額≈保費、鉅額）
//   lights       ：一頁總覽的紅黃綠燈
// 金額一律以「元」計
// ============================================================
(function (root) {
  'use strict';
  const W = 10000;
  const GIFT_EXEMPT = 244 * W;
  const n = (x) => Number(x) || 0;

  // regime: legal（法定財產制，沒有約定就是這個）| separate（分別財產制）| joint（共同財產制）
  // headNet/spouseNet：雙方現存財產淨額；pre：婚前財產；free：婚後繼承、受贈等無償取得（不列入分配）
  function maritalClaim({ regime = 'legal', headNet, headPre, headFree, spouseNet, spousePre, spouseFree }) {
    if (regime === 'separate') return { applicable: false, claim: 0, note: '分別財產制：沒有剩餘財產差額分配請求權。' };
    if (spouseNet == null) return { applicable: false, claim: 0, note: '缺配偶的財產資料，無法計算剩餘財產差額分配。' };
    const headPost = Math.max(0, n(headNet) - n(headPre) - n(headFree));
    const spousePost = Math.max(0, n(spouseNet) - n(spousePre) - n(spouseFree));
    const claim = Math.max(0, Math.round((headPost - spousePost) / 2));
    const note = regime === 'joint'
      ? '共同財產制：共同財產的一半屬於配偶，這裡用同樣方式估算，實際依約定的共同財產範圍。'
      : claim ? '配偶可請求婚後財產差額的一半，這部分不課遺產稅，可自遺產總額扣除（需配偶主張）。' : '規劃對象婚後財產沒有比配偶多，配偶沒有請求權。';
    return { applicable: true, headPost, spousePost, claim, note };
  }

  // gifts: [{ date:'YYYY-MM-DD', from（贈與人 id）, to（受贈人 id，可空）, toRel（spouse|child|...|other）, amount（元）, filed }]
  // 回傳 { byGiver: { id: { year: { total, taxable, over } } }, thisYear: { id: { used, left } }, addBack, addBackItems }
  function giftSummary(gifts, headId, today) {
    const y0 = Number(String(today).slice(0, 4));
    const byGiver = {}, thisYear = {};
    const cut = (() => { const [y, m, d] = String(today).split('-').map(Number); return `${y - 2}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; })();
    const addBackItems = [];
    (gifts || []).forEach((g) => {
      if (!g || !g.date || !n(g.amount)) return;
      const y = Number(g.date.slice(0, 4));
      const spouse = g.toRel === 'spouse';
      const b = ((byGiver[g.from] = byGiver[g.from] || {})[y] = byGiver[g.from][y] || { total: 0, taxable: 0, over: 0 });
      b.total += n(g.amount);
      if (!spouse) b.taxable += n(g.amount);   // 配偶相互贈與不計入贈與總額（遺贈稅法第 20 條）
      // 死亡前 2 年內贈與配偶、繼承人（及其配偶）的財產，視為遺產
      if (g.from === headId && g.date >= cut && g.date <= today && g.toRel !== 'other') addBackItems.push(g);
    });
    Object.values(byGiver).forEach((ys) => Object.values(ys).forEach((b) => { b.over = Math.max(0, b.taxable - GIFT_EXEMPT); }));
    Object.entries(byGiver).forEach(([id, ys]) => { const used = (ys[y0] || {}).taxable || 0; thisYear[id] = { used, left: Math.max(0, GIFT_EXEMPT - used) }; });
    const addBack = addBackItems.reduce((s, g) => s + n(g.amount), 0);
    return { byGiver, thisYear, addBack, addBackItems, exempt: GIFT_EXEMPT, cut };
  }

  // 保單（kbCompute 的 contract）是否有國稅局實質課稅原則常見的特徵
  // ct: { issueAge, pay_mode, status, term, effective, sa（數值）, saUnit, annualPremium, payYears, fxRate }
  const yearsBetween = (a, b) => { if (!a || !b) return null; const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number); return y2 - y1 - (m2 < m1 || (m2 === m1 && d2 < d1) ? 1 : 0); };
  function policyFlags(ct, today) {
    const f = [];
    if (ct.issueAge != null && ct.issueAge >= 70) f.push('高齡投保');
    const single = /躉/.test(`${ct.pay_mode || ''}${ct.status || ''}${ct.term || ''}`) || (ct.kind === 'main' && ct.payYears === 1);
    if (single) f.push('躉繳');
    const yrs = yearsBetween(ct.effective, today);
    if (yrs != null && yrs < 2) f.push('投保未滿 2 年');
    const unit = ct.saUnit === '萬' ? W : ct.saUnit === '千' ? 1000 : 1;
    const sa = n(ct.sa) * unit * (ct.fxRate ?? 1);
    const paid = n(ct.annualPremium) * (ct.fxRate ?? 1) * Math.max(1, n(ct.payYears) || 1);
    if (sa > 0 && paid > 0 && sa <= paid * 1.1) f.push('保額≈保費');
    if (paid >= 3000 * W) f.push('鉅額保費');
    return f;
  }

  // 紅黃綠燈：g 綠、y 黃、r 紅、n 資料不足
  function lights(s) {
    const out = [];
    // 1. 稅源
    if (s.estateTax == null) out.push({ k: 'tax', label: '預留稅源', lv: 'n', text: '規劃對象沒有資產資料' });
    else if (s.estateTax === 0) out.push({ k: 'tax', label: '預留稅源', lv: 'g', text: '目前不用繳遺產稅' });
    else if (s.liquid >= s.estateTax) out.push({ k: 'tax', label: '預留稅源', lv: 'g', text: '現金足以繳遺產稅' });
    else if (s.liquid + s.insToHeirs >= s.estateTax) out.push({ k: 'tax', label: '預留稅源', lv: 'y', text: '要靠保險金墊繳遺產稅' });
    else out.push({ k: 'tax', label: '預留稅源', lv: 'r', text: '現金加保險金仍不夠繳稅' });
    // 2. 保障
    if (!s.coverage || !s.coverage.length) out.push({ k: 'cover', label: '保障缺口', lv: 'n', text: '沒有保單資料' });
    else {
      const red = s.coverage.filter((c) => c.earner && !c.death);
      const gaps = s.coverage.filter((c) => !c.medical || !c.critical || (c.earner && !c.death));
      out.push(red.length ? { k: 'cover', label: '保障缺口', lv: 'r', text: `${red.map((c) => c.name).join('、')} 有收入但沒有壽險` }
        : gaps.length ? { k: 'cover', label: '保障缺口', lv: 'y', text: `${gaps.length} 位成員缺醫療或重疾保障` }
        : { k: 'cover', label: '保障缺口', lv: 'g', text: '主要保障齊全' });
    }
    // 3. 退休
    if (!s.retire) out.push({ k: 'retire', label: '退休準備', lv: 'n', text: '尚未做退休試算' });
    else if (s.retire.depleted == null) out.push({ k: 'retire', label: '退休準備', lv: 'g', text: `資產可支應到 ${s.retire.lifeAge} 歲` });
    else if (s.retire.extra && s.retire.monthlyIncome && s.retire.extra <= s.retire.monthlyIncome * 0.2) out.push({ k: 'retire', label: '退休準備', lv: 'y', text: `每月多存約 ${Math.round(s.retire.extra / W * 10) / 10} 萬可補足` });
    else out.push({ k: 'retire', label: '退休準備', lv: 'r', text: `${s.retire.depleted} 歲資產不夠用` });
    // 4. 負債比
    if (!s.assets) out.push({ k: 'debt', label: '負債比', lv: 'n', text: '沒有資產資料' });
    else { const r = s.liabilities / s.assets; out.push({ k: 'debt', label: '負債比', lv: r < 0.3 ? 'g' : r < 0.5 ? 'y' : 'r', text: `負債占資產 ${Math.round(r * 100)}%` }); }
    // 5. 現金流
    if (s.income == null) out.push({ k: 'cash', label: '每年結餘', lv: 'n', text: '沒有收支資料' });
    else { const sur = s.income - s.expense; out.push({ k: 'cash', label: '每年結餘', lv: sur >= 0 ? (s.income && sur / s.income < 0.1 ? 'y' : 'g') : 'r', text: sur >= 0 ? `每年結餘 ${Math.round(sur / W)} 萬` : `每年不足 ${Math.round(-sur / W)} 萬` }); }
    // 6. 傳承安排
    if (s.estateTax == null) out.push({ k: 'legacy', label: '傳承安排', lv: 'n', text: '資料不足' });
    else if (s.reserveViolated) out.push({ k: 'legacy', label: '傳承安排', lv: 'r', text: '遺囑分配侵害特留分' });
    else if (s.estateTax > 0 && !s.hasWill && !s.hasTrust) out.push({ k: 'legacy', label: '傳承安排', lv: 'y', text: '有遺產稅但還沒有遺囑或信託' });
    else if (s.policyRisk) out.push({ k: 'legacy', label: '傳承安排', lv: 'y', text: `${s.policyRisk} 張保單有實質課稅風險` });
    else out.push({ k: 'legacy', label: '傳承安排', lv: 'g', text: s.hasWill || s.hasTrust ? '已有遺囑／信託安排' : '目前不急' });
    return out;
  }

  const api = Object.freeze({ GIFT_EXEMPT, maritalClaim, giftSummary, policyFlags, lights, yearsBetween });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EastoneFamily = api;
})(typeof window !== 'undefined' ? window : globalThis);
