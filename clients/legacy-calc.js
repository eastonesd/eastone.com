// ============================================================
// 傳承規劃計算核心（純函式，瀏覽器與 node 測試共用）
//   legalShares：民法第 1138、1140、1144 條法定應繼分；第 1223 條特留分
//   distribute ：依遺囑／規劃比例分配，檢查特留分
//   allocateInsurance：身故保險金依受益人順位與比例分給每個人（「法定繼承人」依應繼分）
// 金額一律以「元」計；比例以 0～1 小數
// ============================================================
(function (root) {
  'use strict';

  // 關係代碼
  const REL = Object.freeze({
    spouse: '配偶', child: '子女', grandchild: '孫子女（代位或次親等）', parent: '父母', sibling: '兄弟姊妹', grandparent: '祖父母',
  });
  // 特留分比例（民法第 1223 條：直系血親卑親屬、父母、配偶為應繼分 1/2；兄弟姊妹、祖父母為 1/3）
  const RESERVE = { spouse: 1 / 2, child: 1 / 2, grandchild: 1 / 2, parent: 1 / 2, sibling: 1 / 3, grandparent: 1 / 3 };

  const live = (h) => h.alive !== false && !h.renounce;

  // heirs: [{ id, name, rel, alive=true, renounce=false, via（孫子女：其父或母，也就是被繼承人子女的 id） }]
  // 回傳 { order, orderLabel, rows:[{ id, share, reserveRate, reserve, why }], notes }
  function legalShares(heirs) {
    const list = heirs || [];
    const spouse = list.find((h) => h.rel === 'spouse' && live(h)) || null;
    const children = list.filter((h) => h.rel === 'child');
    const grand = list.filter((h) => h.rel === 'grandchild');
    const notes = [];
    // 第一順位：子女；子女先過世 → 由其子女代位（第 1140 條）；子女拋棄 → 不代位
    let units = []; // 每一「房」：[{h, part}]
    children.forEach((c) => {
      if (live(c)) units.push([{ h: c, part: 1, why: '子女' }]);
      else if (c.alive === false) {
        const subs = grand.filter((g) => g.via === c.id && live(g));
        if (subs.length) units.push(subs.map((g) => ({ h: g, part: 1 / subs.length, why: `代位繼承（${c.name || '子女'}已過世）` })));
      }
    });
    // 子女全部拋棄（且沒有代位）→ 由次親等的孫子女繼承（第 1176 條第 5 項）
    if (!units.length && children.length && children.every((c) => c.renounce || c.alive === false)) {
      const subs = grand.filter((g) => live(g));
      if (subs.length) { units = subs.map((g) => [{ h: g, part: 1, why: '子女拋棄，由孫子女繼承' }]); notes.push('子女全部拋棄繼承，改由孫子女繼承。'); }
    }
    let order = 0, rows = [];
    const put = (h, share, why) => rows.push({ id: h.id, share, why, reserveRate: RESERVE[h.rel] ?? 0 });
    if (units.length) {
      order = 1;
      const n = units.length + (spouse ? 1 : 0);
      units.forEach((u) => u.forEach((x) => put(x.h, x.part / n, x.why)));
      if (spouse) put(spouse, 1 / n, '配偶（與直系血親卑親屬平均）');
    } else {
      const tiers = [
        [2, 'parent', '父母', 1 / 2],
        [3, 'sibling', '兄弟姊妹', 1 / 2],
        [4, 'grandparent', '祖父母', 2 / 3],
      ];
      for (const [o, rel, label, spouseShare] of tiers) {
        const g = list.filter((h) => h.rel === rel && live(h));
        if (!g.length) continue;
        order = o;
        const sp = spouse ? spouseShare : 0;
        g.forEach((h) => put(h, (1 - sp) / g.length, label));
        if (spouse) put(spouse, sp, `配偶（與${label}同為繼承人，應繼分 ${spouseShare === 0.5 ? '1/2' : '2/3'}）`);
        break;
      }
      if (!order && spouse) { order = 0; put(spouse, 1, '配偶（沒有其他繼承人）'); }
    }
    if (!rows.length) notes.push('沒有繼承人：遺產依民法歸屬國庫（實務上請再確認是否有遺漏的親屬）。');
    rows = rows.map((r) => ({ ...r, reserve: r.share * r.reserveRate }));
    const orderLabel = { 0: spouse ? '只有配偶' : '無繼承人', 1: '第一順位：直系血親卑親屬', 2: '第二順位：父母', 3: '第三順位：兄弟姊妹', 4: '第四順位：祖父母' }[order];
    return { order, orderLabel, rows, notes };
  }

  // 規劃分配：plan = { heirId: 比例(0~1) }；沒給就用法定應繼分
  // net：可分配的遺產淨額（元）。回傳每人分到多少、特留分金額、是否被侵害
  function distribute(net, shares, plan) {
    const usePlan = plan && Object.keys(plan).length > 0;
    const planSum = usePlan ? Object.values(plan).reduce((s, v) => s + (Number(v) || 0), 0) : 1;
    const rows = shares.rows.map((r) => {
      const ratio = usePlan ? (Number(plan[r.id]) || 0) : r.share;
      const amount = Math.round(net * ratio);
      const reserveAmt = Math.round(net * r.reserve);
      return { ...r, ratio, amount, legalAmt: Math.round(net * r.share), reserveAmt, short: Math.max(0, reserveAmt - amount), violated: amount + 1 < reserveAmt };
    });
    // 規劃給「非繼承人」的部分（遺贈）
    const others = usePlan ? Object.entries(plan).filter(([id]) => !shares.rows.some((r) => r.id === id)).map(([id, v]) => ({ id, ratio: Number(v) || 0, amount: Math.round(net * (Number(v) || 0)) })) : [];
    return { usePlan, planSum, rows, others, violated: rows.filter((r) => r.violated) };
  }

  // 身故保險金分配
  // policies: [{ amount（元）, applicant（要保人姓名）, beneficiaries:[{ name, type:'named'|'legal', order, ratio, equal }], label }]
  // legalRows：legalShares().rows；nameOf(id) → 姓名
  // 回傳 { people: [{ name, amount, fromApplicantOther（要保人≠受益人，計入最低稅負的金額）, items:[...] }], estateIn: 無受益人時計入遺產的金額 }
  function allocateInsurance(policies, legalRows, nameOf) {
    const people = new Map();
    const add = (name, amt, counted, label) => {
      const k = String(name || '（未填姓名）').trim();
      const p = people.get(k) || { name: k, amount: 0, amtCounted: 0, items: [] };
      p.amount += amt; if (counted) p.amtCounted += amt; p.items.push({ label, amount: amt, counted });
      people.set(k, p);
    };
    let estateIn = 0;
    (policies || []).forEach((pol) => {
      const amount = Math.round(Number(pol.amount) || 0);
      if (!amount) return;
      const bens = (pol.beneficiaries || []).filter((b) => b && (b.name || b.type === 'legal'));
      if (!bens.length) { estateIn += amount; return; }        // 沒有指定受益人：保險金列入遺產
      const firstOrder = Math.min(...bens.map((b) => Number(b.order) || 1));
      const tier = bens.filter((b) => (Number(b.order) || 1) === firstOrder);
      const ratios = tier.some((b) => b.equal) || tier.every((b) => !Number(b.ratio))
        ? tier.map(() => 1 / tier.length)
        : (() => { const s = tier.reduce((a, b) => a + (Number(b.ratio) || 0), 0) || 1; return tier.map((b) => (Number(b.ratio) || 0) / s); })();
      tier.forEach((b, i) => {
        const part = amount * ratios[i];
        if (b.type === 'legal' || b.name === '法定繼承人') {
          // 法定繼承人：依應繼分分給每位繼承人
          if (!legalRows.length) { estateIn += part; return; }
          legalRows.forEach((r) => {
            const nm = nameOf(r.id);
            add(nm, Math.round(part * r.share), nm !== pol.applicant, `${pol.label}（法定繼承人，應繼分）`);
          });
        } else {
          add(b.name, Math.round(part), String(b.name).trim() !== String(pol.applicant || '').trim(), pol.label);
        }
      });
    });
    return { people: [...people.values()].sort((a, b) => b.amount - a.amount), estateIn };
  }

  const api = Object.freeze({ REL, RESERVE, legalShares, distribute, allocateInsurance });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EastoneLegacy = api;
})(typeof window !== 'undefined' ? window : globalThis);
