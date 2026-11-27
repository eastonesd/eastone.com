// ============================================================
// 不動產移轉與二次遺產稅（純函式，瀏覽器與 node 測試共用；需要 EastoneTax）
//   landIncrementTax：土地增值稅（土地稅法第 33 條，一般稅率 20/30/40%、長期持有減徵、自用住宅 10%）
//   houseLandTax   ：房地合一稅 2.0（個人，持有 2/5/10 年：45/35/20/15%；自住 400 萬免稅、超過 10%）
//   compareTransfer：同一筆不動產「現在贈與／現在買賣／將來繼承」的移轉稅負＋子女將來出售的稅
//   secondDeath    ：夫妻先後身故的兩次遺產稅（主張剩餘財產差額分配與否、配偶繼承或拋棄）
// 金額：元
// ============================================================
(function (root) {
  'use strict';
  const T = root.EastoneTax || (typeof require !== 'undefined' ? require('./tax-calc.js') : null);
  const W = 10000;
  const n = (x) => Number(x) || 0;
  const r0 = (x) => Math.round(x);
  const RULES = Object.freeze({
    deed: 0.06,            // 契稅：買賣、贈與 6%（契價＝房屋評定現值）；繼承免
    stamp: 0.001,          // 印花稅：所有權移轉契據 0.1%（契價：房屋評定現值＋公告土地現值）；繼承免
    regFee: 0.001,         // 登記規費 0.1%（申報地價＋房屋評定現值，此處以移轉價值概算）
    hlRates: [[2, 0.45], [5, 0.35], [10, 0.2], [Infinity, 0.15]],
    selfUseExempt: 400 * W, selfUseRate: 0.1,
    expenseRate: 0.03, expenseCap: 30 * W,
  });

  // 土增稅：base＝原規定地價或前次移轉現值 × 物價指數／100；gain＝申報移轉現值 − base − 改良費用
  function landIncrementTax({ value, prev, cpi = 100, improve = 0, years = 0, selfUse = false }) {
    const base = n(prev) * n(cpi) / 100;
    const gain = Math.max(0, n(value) - base - n(improve));
    if (!gain) return { base: r0(base), gain: 0, tax: 0, rate: 0, multiple: 0 };
    if (selfUse) return { base: r0(base), gain: r0(gain), tax: r0(gain * 0.1), rate: 0.1, multiple: base ? gain / base : null, selfUse: true };
    // 長期持有減徵：第二、三級稅率
    const [r2, r3] = years >= 40 ? [0.26, 0.32] : years >= 30 ? [0.27, 0.34] : years >= 20 ? [0.28, 0.36] : [0.3, 0.4];
    const k2 = r2 - 0.2, k3 = r3 - 0.2 + (r2 - 0.2); // 累進差額係數：0.1/0.3、0.08/0.24、0.07/0.21、0.06/0.18
    const mult = base ? gain / base : Infinity;
    let tax;
    if (mult < 1) tax = gain * 0.2;
    else if (mult < 2) tax = gain * r2 - base * k2;
    else tax = gain * r3 - base * k3;
    return { base: r0(base), gain: r0(gain), tax: r0(tax), rate: mult < 1 ? 0.2 : mult < 2 ? r2 : r3, multiple: mult };
  }

  // 房地合一稅（105 年以後取得）：所得＝成交價 − 成本 − 費用 − 土地漲價總數額
  function houseLandTax({ price, cost, expense, landGain = 0, years, selfUse = false }) {
    const R = RULES;
    const fee = expense != null && expense !== '' ? n(expense) : Math.min(R.expenseCap, n(price) * R.expenseRate);
    const income = Math.max(0, n(price) - n(cost) - fee - n(landGain));
    let rate = R.hlRates.find(([y]) => n(years) <= y)[1];
    let tax;
    if (selfUse) { tax = Math.max(0, income - R.selfUseExempt) * R.selfUseRate; rate = R.selfUseRate; }
    else tax = income * rate;
    return { income: r0(income), fee: r0(fee), rate, tax: r0(tax) };
  }

  // 邊際遺產稅／贈與稅：加上這筆財產後多繳多少
  const marginalEstate = (otherNet, add) => T.progressive(Math.max(0, n(otherNet) + n(add)), T.RULES.estate.brackets).tax - T.progressive(Math.max(0, n(otherNet)), T.RULES.estate.brackets).tax;
  function giftTax(value, usedThisYear = 0) {
    const R = T.RULES.gift;
    const before = Math.max(0, n(usedThisYear) - R.exemption), after = Math.max(0, n(usedThisYear) + n(value) - R.exemption);
    return T.progressive(after, R.brackets).tax - T.progressive(before, R.brackets).tax;
  }

  // p：{ land（公告土地現值，持分後總額）, bldg（房屋評定現值）, prev（前次移轉現值或原規定地價總額）, cpi, improve,
  //      parentYears（父母已持有年數）, parentAfter105（父母 105 年後取得）, parentCost（父母取得成本）, market（現在市價）,
  //      parentSelfUse（父母符合自用住宅 10%）, buyPrice（賣給子女的價格）, giftUsed（今年已贈與）, otherEstate（其他遺產課稅淨額）,
  //      inheritIn（幾年後繼承）, sellIn（子女幾年後出售，從現在起算）, salePrice（將來售價）, growth（公告現值年漲幅）, childSelfUse（子女出售時符合自住） }
  function compareTransfer(p) {
    const g = n(p.growth), grow = (v, y) => n(v) * Math.pow(1 + g, y);
    const land = n(p.land), bldg = n(p.bldg), contract = land + bldg;
    const sellIn = Math.max(0, n(p.sellIn)), inheritIn = Math.min(Math.max(0, n(p.inheritIn)), sellIn);
    const saleLand = grow(land, sellIn), salePrice = n(p.salePrice) || grow(n(p.market), sellIn);
    const lit = (o) => landIncrementTax({ improve: p.improve, ...o });
    const childSale = ({ landBase, cost, years }) => {
      const li = lit({ value: saleLand, prev: landBase, cpi: 100, years });
      const hl = houseLandTax({ price: salePrice, cost, landGain: li.gain, years, selfUse: !!p.childSelfUse });
      return { lit: li, hl, total: li.tax + hl.tax };
    };
    const out = [];
    // A. 現在贈與：贈與稅（父母）＋土增稅（受贈人）＋契稅＋印花稅＋規費
    {
      const li = lit({ value: land, prev: p.prev, cpi: p.cpi, years: p.parentYears, selfUse: false });
      const now = [
        { k: 'gift', label: '贈與稅（父母繳）', amt: giftTax(contract, p.giftUsed) },
        { k: 'lit', label: `土地增值稅（子女繳，${Math.round(li.rate * 100)}%）`, amt: li.tax },
        { k: 'deed', label: '契稅 6%（子女繳）', amt: r0(bldg * RULES.deed) },
        { k: 'stamp', label: '印花稅 0.1%', amt: r0(contract * RULES.stamp) },
        { k: 'fee', label: '登記規費', amt: r0(contract * RULES.regFee) },
      ];
      const later = childSale({ landBase: land, cost: contract, years: sellIn });
      out.push({ k: 'gift', label: '現在贈與', now, nowTotal: now.reduce((s, x) => s + x.amt, 0), later, notes: ['子女將來出售：成本只能用贈與時的公告現值＋評定現值（很低），房地合一稅會偏高；持有期間從受贈日起算。', '配偶之間贈與土地可申請不課徵土增稅（下次移轉再一起課）。'] });
    }
    // B. 現在買賣：父母繳土增稅（可用自用 10%）、房地合一（105 後取得）；子女繳契稅；需要資金證明
    {
      const price = n(p.buyPrice) || n(p.market);
      const li = lit({ value: land, prev: p.prev, cpi: p.cpi, years: p.parentYears, selfUse: !!p.parentSelfUse });
      const hl = p.parentAfter105 ? houseLandTax({ price, cost: p.parentCost, landGain: li.gain, years: p.parentYears, selfUse: false }) : null;
      const now = [
        { k: 'lit', label: `土地增值稅（父母繳，${Math.round(li.rate * 100)}%${li.selfUse ? '自用' : ''}）`, amt: li.tax },
        ...(hl ? [{ k: 'hl', label: `房地合一稅（父母繳，${Math.round(hl.rate * 100)}%）`, amt: hl.tax }] : []),
        { k: 'deed', label: '契稅 6%（子女繳）', amt: r0(bldg * RULES.deed) },
        { k: 'stamp', label: '印花稅 0.1%', amt: r0(contract * RULES.stamp) },
        { k: 'fee', label: '登記規費', amt: r0(contract * RULES.regFee) },
      ];
      // 父母收到的價金留在遺產裡，將來仍課遺產稅（若子女的錢本來就是父母給的，等於沒有移出遺產）
      const cashLeft = Math.max(0, price - li.tax - (hl ? hl.tax : 0));
      now.push({ k: 'estate', label: `價金留在父母遺產（${inheritIn} 年後遺產稅）`, amt: r0(marginalEstate(p.otherEstate, cashLeft)) });
      const later = childSale({ landBase: land, cost: price, years: sellIn });
      out.push({ k: 'buy', label: '現在買賣', now, nowTotal: now.reduce((s, x) => s + x.amt, 0), later, price,
        notes: ['子女必須有真實的資金來源並實際付款，否則國稅局會視同贈與（遺贈稅法第 5 條），補課贈與稅。', '父母收到的價金仍在遺產裡，將來一樣課遺產稅；買賣只是把不動產換成現金。', p.parentAfter105 ? '父母 105 年後取得：出售要繳房地合一稅。' : '父母 105 年前取得：適用舊制，房屋交易所得併入綜合所得稅（金額通常不大，未列入），土地免所得稅。'] });
    }
    // C. 將來繼承：不課土增稅、契稅；遺產稅（邊際）；子女出售時成本＝繼承時現值，持有期間可合併被繼承人
    {
      const landAt = grow(land, inheritIn), value = landAt + bldg;
      const estate = r0(marginalEstate(p.otherEstate, value));
      const now = [
        { k: 'estate', label: `遺產稅（增加的部分，${inheritIn} 年後）`, amt: estate },
        { k: 'fee', label: '繼承登記規費', amt: r0(value * RULES.regFee) },
      ];
      const later = childSale({ landBase: landAt, cost: value, years: sellIn + n(p.parentYears) });
      out.push({ k: 'inherit', label: `${inheritIn ? inheritIn + ' 年後' : ''}繼承`, now, nowTotal: now.reduce((s, x) => s + x.amt, 0), later,
        notes: ['繼承不課土地增值稅、契稅；父母持有期間的土地漲價就此歸零。', '子女出售時持有期間可以合併父母的持有期間，房地合一稅率通常最低。', '要繼承人間協議分割；共有不動產將來處分較麻煩。'] });
    }
    out.forEach((s) => { s.total = s.nowTotal + s.later.total; });
    const best = [...out].sort((a, b) => a.total - b.total)[0];
    return { scenarios: out, best: best.k, salePrice: r0(salePrice), saleLand: r0(saleLand), contract };
  }

  // 二次遺產稅：A 先身故、B 後身故（gap 年後）
  // a, b：各自的財產淨額（元）；aPre/aFree/bPre/bFree：婚前財產、婚後無償取得；kids：子女人數（第二次只剩子女）
  // strategy：claim（B 主張差額分配）| noClaim（不主張）| renounce（B 拋棄繼承、仍主張差額）
  function secondDeath({ a, b, aPre = 0, aFree = 0, bPre = 0, bFree = 0, kids = 1, gap = 10, growth = 0, kidAges = [] }, strategy) {
    const aPost = Math.max(0, n(a) - n(aPre) - n(aFree)), bPost = Math.max(0, n(b) - n(bPre) - n(bFree));
    const claim = strategy === 'noClaim' ? 0 : Math.max(0, (aPost - bPost) / 2);
    const desc = Array.from({ length: Math.max(0, kids) }, (_, i) => ({ age: kidAges[i] ?? 30 }));
    const first = T.estate({ gross: n(a), exemption: true, funeral: true, spouse: { on: true }, descendants: desc, claim });
    const afterTax = n(a) - claim - first.tax;
    // 配偶繼承：應繼分＝1／(子女數＋1)；拋棄則全部由子女繼承
    const spouseShare = strategy === 'renounce' ? 0 : 1 / (Math.max(0, kids) + 1);
    const spouseGets = afterTax * spouseShare;
    const bEstate = (n(b) + claim + spouseGets) * Math.pow(1 + n(growth), n(gap));
    // 死亡前 5 年內繼承的財產已納遺產稅者不計入；6～9 年按 80/60/40/20% 扣除（遺贈稅法第 16、17 條）
    const inheritedPart = spouseGets * Math.pow(1 + n(growth), n(gap));
    const g = n(gap);
    const exclude = g <= 5 ? inheritedPart : 0;
    const deductRate = g <= 5 ? 0 : g <= 6 ? 0.8 : g <= 7 ? 0.6 : g <= 8 ? 0.4 : g <= 9 ? 0.2 : 0;
    const second = T.estate({ gross: Math.max(0, r0(bEstate - exclude - inheritedPart * deductRate)), exemption: true, funeral: true, spouse: { on: false }, descendants: desc.map((d) => ({ age: (d.age || 30) + g })) });
    return { strategy, claim: r0(claim), first, firstTax: first.tax, spouseGets: r0(spouseGets), bEstate: r0(bEstate), exclude: r0(exclude), deduct: r0(inheritedPart * deductRate), second, secondTax: second.tax,
      total: first.tax + second.tax, toKids: r0(n(a) - claim - first.tax - spouseGets + bEstate - second.tax) };
  }
  function compareSecondDeath(p) {
    const list = ['claim', 'noClaim', 'renounce'].map((s) => secondDeath(p, s));
    return { list, best: [...list].sort((x, y) => x.total - y.total)[0].strategy };
  }

  const api = Object.freeze({ RULES, landIncrementTax, houseLandTax, giftTax, marginalEstate, compareTransfer, secondDeath, compareSecondDeath });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EastoneTransfer = api;
})(typeof window !== 'undefined' ? window : globalThis);
