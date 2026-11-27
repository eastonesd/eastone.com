// ============================================================
// 投資監控計算核心（純函式，瀏覽器與 node 測試共用；需要 FinCalc）
//   holdings ：同一標的多筆合併；台幣市值、成本、未實現損益、占比
//   history  ：依估值紀錄還原每天的投資部位總值（走勢）
//   allocation / drift：配置 vs 目標（依風險屬性預設，可自訂）
//   alerts   ：集中度、虧損、風險等級超過屬性、報價過期、缺成本
// 金額：元（台幣）；比例 0～1
// ============================================================
(function (root) {
  'use strict';
  const C = root.FinCalc || (typeof require !== 'undefined' ? require('./finance-calc.js') : null);
  const INVEST = ['fund', 'stock', 'mcn', 'deposit', 'cash', 'savings_policy', 'investment_policy'];
  // 資產類別 → 配置桶：cash 現金、income 固定收益／平衡、equity 股票、alt 另類（結構型）
  const BUCKET = { cash: '現金存款', income: '固定收益／平衡', equity: '股票', alt: '結構型商品' };
  // 風險屬性：可承受的最高風險等級（RR）與預設目標配置
  const PROFILES = {
    conservative: { label: '保守型', maxRR: 2, targets: { cash: 0.3, income: 0.6, equity: 0.1, alt: 0 } },
    balanced: { label: '穩健型', maxRR: 3, targets: { cash: 0.15, income: 0.45, equity: 0.4, alt: 0 } },
    growth: { label: '成長型', maxRR: 4, targets: { cash: 0.1, income: 0.3, equity: 0.55, alt: 0.05 } },
    aggressive: { label: '積極型', maxRR: 5, targets: { cash: 0.05, income: 0.15, equity: 0.7, alt: 0.1 } },
  };
  const num = (b) => (b == null ? null : C.toNum(b));
  const rrOf = (a) => { const m = /(\d)/.exec(String((a.meta || {}).class || (a.meta || {}).rr || '')); return m ? Number(m[1]) : (a.category === 'stock' ? 5 : a.category === 'mcn' ? 4 : null); };
  function bucketOf(a) {
    if (a.category === 'deposit' || a.category === 'cash') return 'cash';
    if (a.category === 'stock') return 'equity';
    if (a.category === 'mcn') return 'alt';
    if (a.category === 'fund') { const rr = rrOf(a); return rr != null && rr >= 4 ? 'equity' : 'income'; }
    return 'income';
  }

  // input：FinCalc 的 compute 輸入（assets, assetValues, fx, asOf…）
  function holdings(input) {
    const bs = C.balanceSheet(input);
    const byId = new Map(input.assets.map((a) => [a.id, a]));
    const rows = bs.assetRows.filter((r) => r.counted && INVEST.includes(r.category) && r.base != null);
    const groups = new Map();
    rows.forEach((r) => {
      const a = byId.get(r.id);
      const key = a.identifier ? `${a.category}|${String(a.identifier).toUpperCase()}` : `id|${a.id}`;
      const g = groups.get(key) || { key, name: (a.meta && a.meta.fund_name) || (a.category === 'stock' && a.identifier) || a.name, identifier: a.identifier || '', category: a.category,
        currency: a.currency, rr: rrOf(a), bucket: bucketOf(a), value: 0, cost: 0, costKnown: true, qty: 0, lots: 0, valueDate: r.valueDate, ids: [] };
      g.value += num(r.base); g.lots += 1; g.ids.push(a.id);
      if (a.quantity != null) g.qty += Number(a.quantity);
      // 成本：有數量時 cost 是單位成本；沒有數量時 cost 是投入總額
      const c = a.cost == null || a.cost === '' ? null : Number(a.cost) * (a.quantity != null ? Number(a.quantity) : 1);
      if (g.bucket === 'cash') { /* 現金存款不算損益 */ } else if (c == null) g.costKnown = false;
      else { const t = C.toBase(C.D(String(c)), a.currency, input.fx, input.asOf); if (t.value == null) g.costKnown = false; else g.cost += num(t.value); }
      if (r.valueDate && (!g.valueDate || r.valueDate < g.valueDate)) g.valueDate = r.valueDate; // 取最舊的估值日（判斷過期）
      groups.set(key, g);
    });
    const list = [...groups.values()];
    const total = list.reduce((s, g) => s + g.value, 0);
    list.forEach((g) => { g.weight = total ? g.value / total : 0; g.pnl = g.bucket !== 'cash' && g.costKnown && g.cost ? g.value - g.cost : null; g.pnlPct = g.pnl != null ? g.pnl / g.cost : null; });
    list.sort((a, b) => b.value - a.value);
    const known = list.filter((g) => g.pnl != null);
    return { list, total, cost: known.reduce((s, g) => s + g.cost, 0), pnl: known.reduce((s, g) => s + g.pnl, 0), knownValue: known.reduce((s, g) => s + g.value, 0), missingCost: list.filter((g) => g.bucket !== 'cash' && !g.costKnown).length };
  }

  // 走勢：所有估值日期，各資產取當日（含）以前最新估值，換成台幣加總
  // 只看有市場報價的部位（不含存款、現金：它們沒有波動，新登錄時會造成假性跳升）
  function history(input, maxPoints = 120) {
    const assets = input.assets.filter((a) => a.status !== 'archived' && INVEST.includes(a.category) && bucketOf(a) !== 'cash');
    input = { ...input, assets };
    const ids = new Set(assets.map((a) => a.id));
    const dates = [...new Set((input.assetValues || []).filter((v) => ids.has(v.asset_id)).map((v) => v.as_of))].sort().slice(-maxPoints);
    // 比最早匯率還早的日期：用最早的匯率（避免外幣資產消失、走勢假性下跌）
    const fx = [...(input.fx || [])];
    [...new Set(fx.map((q) => q.currency))].forEach((ccy) => {
      const first = fx.filter((q) => q.currency === ccy).sort((a, b) => (a.quote_date < b.quote_date ? -1 : 1))[0];
      if (first) fx.push({ ...first, quote_date: '1900-01-01' });
    });
    return dates.map((d) => {
      const h = holdings({ ...input, fx, asOf: d });
      return { date: d, value: h.total };
    }).filter((p) => p.value > 0);
  }

  function allocation(h, targets) {
    const act = { cash: 0, income: 0, equity: 0, alt: 0 };
    h.list.forEach((g) => { act[g.bucket] += g.value; });
    return Object.keys(BUCKET).map((k) => {
      const w = h.total ? act[k] / h.total : 0, t = Number((targets || {})[k]) || 0;
      return { k, label: BUCKET[k], value: act[k], weight: w, target: t, drift: w - t };
    });
  }
  const groupBy = (h, fn) => { const m = new Map(); h.list.forEach((g) => { const k = fn(g); m.set(k, (m.get(k) || 0) + g.value); }); return [...m.entries()].map(([k, v]) => ({ k, value: v, weight: h.total ? v / h.total : 0 })).sort((a, b) => b.value - a.value); };

  // profile：PROFILES 的 key；band：偏離門檻（0.05＝5%）；today：YYYY-MM-DD
  function alerts(h, alloc, { profile = 'balanced', band = 0.05, today, staleDays = 7, conc = 0.2, loss = -0.15 } = {}) {
    const out = [];
    const P = PROFILES[profile] || PROFILES.balanced;
    alloc.filter((x) => Math.abs(x.drift) > band).forEach((x) => out.push({ lv: 'y', k: 'drift', text: `${x.label}占 ${Math.round(x.weight * 100)}%，目標 ${Math.round(x.target * 100)}%，${x.drift > 0 ? '超出' : '不足'} ${Math.abs(Math.round(x.drift * 100))}%，需再平衡` }));
    h.list.filter((g) => g.weight > conc && g.bucket !== 'cash').forEach((g) => out.push({ lv: 'y', k: 'conc', text: `${g.name} 占投資部位 ${Math.round(g.weight * 100)}%，單一標的過度集中（建議 ${Math.round(conc * 100)}% 以下）` }));
    h.list.filter((g) => g.rr != null && g.rr > P.maxRR).forEach((g) => out.push({ lv: 'r', k: 'rr', text: `${g.name} 風險等級 RR${g.rr}，超過${P.label}可承受的 RR${P.maxRR}（適合度）` }));
    h.list.filter((g) => g.pnlPct != null && g.pnlPct <= loss).forEach((g) => out.push({ lv: 'r', k: 'loss', text: `${g.name} 未實現虧損 ${Math.round(g.pnlPct * 100)}%，請檢視是否停損或攤平` }));
    if (today) {
      const old = h.list.filter((g) => g.bucket !== 'cash' && g.valueDate && (Date.parse(today) - Date.parse(g.valueDate)) / 864e5 > staleDays);
      if (old.length) out.push({ lv: 'y', k: 'stale', text: `${old.length} 檔報價超過 ${staleDays} 天沒更新：${old.slice(0, 3).map((g) => g.name).join('、')}${old.length > 3 ? '…' : ''}` });
    }
    if (h.missingCost) out.push({ lv: 'n', k: 'cost', text: `${h.missingCost} 檔沒有成本資料，損益無法計算` });
    const rank = { r: 0, y: 1, n: 2 };
    return out.sort((a, b) => rank[a.lv] - rank[b.lv]);
  }

  const api = Object.freeze({ INVEST, BUCKET, PROFILES, rrOf, bucketOf, holdings, history, allocation, groupBy, alerts });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EastoneInvest = api;
})(typeof window !== 'undefined' ? window : globalThis);
