// ============================================================
// 資產負債與現金流：計算核心（純函式，畫面與報表共用，不碰資料庫與畫面）
// 金額一律用定點小數（BigInt，小數 10 位）計算，最後顯示才四捨五入
// 匯率方向固定：1 單位原幣 = rate 單位台幣；台幣對台幣 = 1；缺匯率 → null（不補 0、不補 1）
// 未知金額 = null（不是 0）；已確認為零才是 0
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FinCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const RULES_VERSION = 'fin-2026.11-1';
  const SCALE = 10n ** 10n;

  // ---------- 定點小數 ----------
  function D(x) {
    if (x === null || x === undefined || x === '') return null;
    if (typeof x === 'bigint') return x;
    let s = typeof x === 'number' ? (Number.isFinite(x) ? x.toFixed(10) : null) : String(x).replace(/[,\s]/g, '');
    if (s === null || !/^-?\d*(\.\d*)?$/.test(s) || s === '' || s === '-' || s === '.') return null;
    const neg = s.startsWith('-');
    if (neg) s = s.slice(1);
    const [i, f = ''] = s.split('.');
    const v = BigInt(i || '0') * SCALE + BigInt((f + '0000000000').slice(0, 10));
    return neg ? -v : v;
  }
  const add = (a, b) => (a === null || b === null ? null : a + b);
  const sub = (a, b) => (a === null || b === null ? null : a - b);
  function mul(a, b) {
    if (a === null || b === null) return null;
    const p = a * b;
    const q = p / SCALE, r = p % SCALE;
    // 四捨五入（遠離零）
    return (r * 2n >= SCALE) ? q + 1n : (r * 2n <= -SCALE ? q - 1n : q);
  }
  const pct = (a, percent) => mul(a, D(percent) / 100n);
  const toNum = (a) => (a === null ? null : Number(a) / Number(SCALE));
  const sum = (arr) => arr.reduce((s, x) => s + x, 0n);
  const max0 = (a) => (a < 0n ? 0n : a);

  // ---------- 日期 ----------
  const lte = (a, b) => String(a) <= String(b);

  // ---------- 匯率 ----------
  // fx: [{currency, quote_date, rate, owner, is_manual, source}]；同一天手動優先
  function fxRate(fx, ccy, date) {
    if (!ccy) return { rate: null, missing: true };
    if (ccy === 'TWD') return { rate: D(1), date: null, source: '台幣', missing: false };
    const list = (fx || []).filter((q) => q.currency === ccy && lte(q.quote_date, date))
      .sort((a, b) => (a.quote_date === b.quote_date ? (b.is_manual ? 1 : 0) - (a.is_manual ? 1 : 0) : (a.quote_date < b.quote_date ? 1 : -1)));
    const q = list[0];
    if (!q) return { rate: null, missing: true };
    return { rate: D(q.rate), date: q.quote_date, source: q.source || (q.is_manual ? '手動' : ''), manual: !!q.is_manual, missing: false };
  }
  function toBase(amount, ccy, fx, date) {
    if (amount === null) return { value: null, fx: null };
    const r = fxRate(fx, ccy, date);
    return { value: r.missing ? null : mul(amount, r.rate), fx: r };
  }

  // ---------- 估值選用 ----------
  // 基準日以前（含）最新的一筆；同一天以人工覆寫優先；不使用基準日之後的價格
  function pickValue(values, assetId, asOf) {
    const list = (values || []).filter((v) => v.asset_id === assetId && lte(v.as_of, asOf) && v.value !== null && v.value !== undefined && v.value !== '')
      .sort((a, b) => (a.as_of === b.as_of
        ? ((b.is_manual ? 1 : 0) - (a.is_manual ? 1 : 0)) || (String(b.created_at || '') > String(a.created_at || '') ? 1 : -1)
        : (a.as_of < b.as_of ? 1 : -1)));
    return list[0] || null;
  }
  function pickBalance(balances, liabilityId, asOf) {
    const list = (balances || []).filter((b) => b.liability_id === liabilityId && lte(b.as_of, asOf))
      .sort((a, b) => (a.as_of === b.as_of ? (String(b.created_at || '') > String(a.created_at || '') ? 1 : -1) : (a.as_of < b.as_of ? 1 : -1)));
    return list[0] || null;
  }

  // ---------- 資產負債 ----------
  function balanceSheet(input) {
    const asOf = input.asOf;
    const fx = input.fx || [];
    const warnings = [];
    const assets = (input.assets || []).filter((a) => a.status !== 'archived');
    const liabilities = (input.liabilities || []).filter((l) => l.status !== 'archived');
    const byId = new Map(assets.map((a) => [a.id, a]));

    // 父子部位：上層已計入總額時，底層只展示
    // 投資型保單只要有連結基金，一律「價值＝連結基金加總」：保單本身只展示，改由底下的基金各自計入（避免重複）
    const hasKids = new Set(assets.filter((x) => x.parent_id).map((x) => x.parent_id));
    const fromFunds = (x) => !!(x && (x.category === 'investment_policy' || (x.meta && x.meta.value_from_funds)) && hasKids.has(x.id));
    const counted = (a) => {
      if (!a.include_in_total) return false;
      if (fromFunds(a)) return false;
      let p = a.parent_id && byId.get(a.parent_id);
      const seen = new Set();
      while (p && !seen.has(p.id)) { if (p.include_in_total && !fromFunds(p)) return false; seen.add(p.id); p = p.parent_id && byId.get(p.parent_id); }
      return true;
    };

    const assetRows = assets.map((a) => {
      const row = { id: a.id, name: a.name, category: a.category, currency: a.currency, purpose: a.purpose || 'none',
        restriction: a.restriction || 'none', institution: a.institution || '', counted: counted(a), status: 'ok',
        original: null, base: null, valueDate: null, valueSource: '', fx: null, flags: [] };
      if (!a.currency) { row.status = 'no_currency'; row.flags.push('未填幣別'); return row; }
      if (!row.counted) { row.status = 'display_only'; }
      const v = pickValue(input.assetValues, a.id, asOf);
      if (a.category === 'mcn' && a.doc_status !== 'complete') row.flags.push('商品結構待確認');
      if (!v || D(v.value) === null) {
        if (row.counted) row.status = 'unvalued';
        if (D(a.cost) !== null) row.flags.push('只有投入成本，不當作現值');
        return row;
      }
      let value = D(v.value);
      row.valueDate = v.as_of; row.valueSource = v.source || (v.is_manual ? '手動' : '');
      row.manual = !!v.is_manual; row.basis = v.value_basis;
      // 保單「已扣貸後淨額」：只有同日、同口徑的貸款資料核對過，才還原成扣貸前價值；否則待核對、不納入標準總額
      if (v.value_basis === 'net_of_loan') {
        if (v.loan_reconciled && D(v.loan_deducted) !== null) {
          value = add(value, D(v.loan_deducted));
          row.flags.push('由扣貸後淨額還原扣貸前價值（已核對）');
        } else {
          row.status = row.counted ? 'net_unreconciled' : row.status;
          row.flags.push('扣貸後淨額，口徑待核對，未納入總額');
          row.netReference = toNum(value);
          return row;
        }
      }
      // 持分：輸入的是整體市值時，只換算一次
      if (D(a.share_pct) !== null && D(a.share_pct) !== D(100)) value = pct(value, a.share_pct);
      row.original = value;
      const b = toBase(value, a.currency, fx, asOf);
      row.fx = b.fx;
      if (b.value === null) { if (row.counted) row.status = 'no_fx'; row.flags.push(`缺 ${a.currency} 匯率`); return row; }
      row.base = b.value;
      return row;
    });

    // 「價值＝連結基金加總」的保單：顯示底下基金的台幣合計（不另外計入）
    assetRows.forEach((row) => {
      const a = byId.get(row.id);
      if (!fromFunds(a)) return;
      const kids = assetRows.filter((k) => byId.get(k.id).parent_id === a.id);
      row.status = 'funds_sum';
      row.fundsTotal = kids.every((k) => k.base !== null) ? sum(kids.map((k) => k.base)) : null;
      row.flags.push(`價值＝連結基金 ${kids.length} 檔加總`);
    });

    const liabRows = liabilities.map((l) => {
      const row = { id: l.id, name: l.name, category: l.category, currency: l.currency, institution: l.institution || '',
        status: 'ok', original: null, base: null, principal: null, interest: null, balanceDate: null, flags: [], fx: null,
        confirm: l.confirm_status };
      if (!l.currency) { row.status = 'no_currency'; row.flags.push('未填幣別'); return row; }
      const b = pickBalance(input.liabilityBalances, l.id, asOf);
      if (!b || D(b.principal) === null) { row.status = 'no_balance'; row.flags.push('未填剩餘本金'); return row; }
      const principal = D(b.principal);
      const interest = b.interest_capitalized ? D(0) : (D(b.accrued_interest) === null ? D(0) : D(b.accrued_interest));
      if (!b.interest_capitalized && D(b.accrued_interest) === null) row.flags.push('未付利息未填，暫以 0 計');
      row.principal = principal; row.interest = interest; row.balanceDate = b.as_of;
      row.original = add(principal, interest);
      const t = toBase(row.original, l.currency, fx, asOf);
      row.fx = t.fx;
      if (t.value === null) { row.status = 'no_fx'; row.flags.push(`缺 ${l.currency} 匯率`); return row; }
      row.base = t.value;
      return row;
    });

    const valued = assetRows.filter((r) => r.counted && r.status === 'ok');
    const assetsTotal = sum(valued.map((r) => r.base));
    const liabOk = liabRows.filter((r) => r.status === 'ok');
    const liabTotal = sum(liabOk.map((r) => r.base));
    const missing = {
      unvalued: assetRows.filter((r) => r.counted && r.status === 'unvalued'),
      netUnreconciled: assetRows.filter((r) => r.status === 'net_unreconciled'),
      assetNoFx: assetRows.filter((r) => r.counted && r.status === 'no_fx'),
      assetNoCcy: assetRows.filter((r) => r.status === 'no_currency'),
      liabNoBalance: liabRows.filter((r) => r.status === 'no_balance'),
      liabNoFx: liabRows.filter((r) => r.status === 'no_fx'),
      liabNoCcy: liabRows.filter((r) => r.status === 'no_currency'),
    };
    const missingCount = Object.values(missing).reduce((s, a) => s + a.length, 0);
    const complete = missingCount === 0;
    if (!complete) warnings.push('資料不完整：總額只含已估值、已換匯的項目');

    // 依幣別（原幣）彙總
    const byCcy = {};
    valued.forEach((r) => { byCcy[r.currency] = byCcy[r.currency] || { assets: 0n, liabilities: 0n }; byCcy[r.currency].assets += r.original; });
    liabOk.forEach((r) => { byCcy[r.currency] = byCcy[r.currency] || { assets: 0n, liabilities: 0n }; byCcy[r.currency].liabilities += r.original; });

    const groupSum = (key) => {
      const g = {};
      valued.forEach((r) => { g[r[key]] = (g[r[key]] || 0n) + r.base; });
      return g;
    };
    return {
      asOf, assetRows, liabRows, assetsTotal, liabTotal, net: assetsTotal - liabTotal, complete, missing, missingCount,
      byCcy, byCategory: groupSum('category'), byPurpose: groupSum('purpose'), warnings,
      valuedCount: valued.length, needValueCount: assetRows.filter((r) => r.counted).length,
      confirmedLiabCount: liabRows.filter((r) => r.confirm === 'confirmed').length,
    };
  }

  // ---------- 估計可自由動用資金（以「熱錢」為範圍）----------
  // 依擔保關聯把資產與借款分成群組；同一筆借款在群組內只扣一次
  function available(input, bs) {
    const links = (input.collateralLinks || []);
    const parent = new Map();
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    const node = (x) => { if (!parent.has(x)) parent.set(x, x); return x; };
    bs.assetRows.forEach((r) => node('A' + r.id));
    bs.liabRows.forEach((r) => node('L' + r.id));
    links.forEach((k) => { if (parent.has('A' + k.asset_id) && parent.has('L' + k.liability_id)) parent.set(find('A' + k.asset_id), find('L' + k.liability_id)); });
    const groups = new Map();
    const push = (key, kind, row) => { const g = find(key); if (!groups.has(g)) groups.set(g, { assets: [], liabs: [] }); groups.get(g)[kind].push(row); };
    bs.assetRows.forEach((r) => push('A' + r.id, 'assets', r));
    bs.liabRows.forEach((r) => push('L' + r.id, 'liabs', r));
    const assetMeta = new Map((input.assets || []).map((a) => [a.id, a]));

    let confirmed = 0n; let pending = 0n; let hotTotal = 0n; let hotRestricted = 0n;
    const detail = [];
    for (const g of groups.values()) {
      const hot = g.assets.filter((r) => r.purpose === 'hot' && r.counted);
      if (!hot.length) continue;
      const hotValued = hot.filter((r) => r.status === 'ok');
      const hotSum = sum(hotValued.map((r) => r.base));
      hotTotal += hotSum;
      const restricted = hotValued.filter((r) => r.restriction !== 'none');
      hotRestricted += sum(restricted.map((r) => r.base));
      const exitKnown = hot.every((r) => { const a = assetMeta.get(r.id); return a && (D(a.exit_cost) !== null || r.restriction === 'none'); });
      const exitCost = sum(hot.map((r) => { const a = assetMeta.get(r.id); const c = a && D(a.exit_cost); if (c === null || c === undefined) return 0n; const t = toBase(c, a.currency, input.fx, input.asOf); return t.value === null ? 0n : t.value; }));
      const hasUnvalued = hot.some((r) => r.status !== 'ok');
      if (!g.liabs.length && hot.every((r) => r.restriction === 'none')) {
        confirmed += max0(hotSum - exitCost);
        detail.push({ type: 'free', names: hot.map((r) => r.name), amount: max0(hotSum - exitCost), note: hasUnvalued ? '部分未估值，未計入' : '' });
        continue;
      }
      const liabsReady = g.liabs.every((l) => l.status === 'ok');
      const restrictionsReleasable = g.assets.every((r) => ['none', 'pledged'].includes(r.restriction));
      if (liabsReady && restrictionsReleasable && exitKnown && !hasUnvalued) {
        const need = sum(g.liabs.map((l) => l.base)); // 共同擔保的借款只扣一次
        const amt = max0(hotSum - need - exitCost);
        confirmed += amt;
        detail.push({ type: 'release', names: hot.map((r) => r.name), amount: amt, repay: need, note: '需先還款解押' });
      } else {
        pending += hotSum;
        detail.push({ type: 'pending', names: hot.map((r) => r.name), amount: hotSum, note: '受限制或解押條件不明，待確認' });
      }
    }
    return { confirmed, pending, hotTotal, hotRestricted, detail };
  }

  // ---------- 收支分類 ----------
  const KINDS = {
    rent: { label: '租金', group: 'income' }, survival: { label: '生存金', group: 'income' },
    fund_dist: { label: '基金分配', group: 'income' }, policy_dist: { label: '保單分配／提領', group: 'income' },
    dividend: { label: '股票股息', group: 'income' }, interest_income: { label: '存款利息', group: 'income' },
    premium: { label: '保費', group: 'expense' }, loan_interest: { label: '貸款利息', group: 'expense' },
    fee: { label: '費用', group: 'expense' }, property_expense: { label: '房屋支出', group: 'expense' }, tax: { label: '稅款', group: 'expense' },
    living: { label: '生活支出', group: 'expense' }, salary: { label: '薪資收入', group: 'income' }, other_income: { label: '其他收入', group: 'income' },
    buy: { label: '投資申購', group: 'investment' }, redeem: { label: '投資贖回', group: 'investment' }, principal_return: { label: '本金收回', group: 'investment' },
    loan_draw: { label: '借款撥入', group: 'financing' }, loan_repay: { label: '還本', group: 'financing' },
    loan_payment: { label: '貸款繳款（本金＋利息）', group: 'split' },
    transfer: { label: '自有帳戶轉帳', group: 'transfer' }, fx_exchange: { label: '換匯', group: 'transfer' },
    other_expense: { label: '其他支出', group: 'expense' },
    fixed_expense: { label: '固定支出', group: 'expense' }, medical: { label: '醫療費用', group: 'expense' },
    insurance_claim: { label: '保險理賠', group: 'income' },
  };
  const DIST_KINDS = ['fund_dist', 'policy_dist', 'survival'];

  function eventBase(e, fx) {
    const amt = D(e.amount);
    if (D(e.amount_twd) !== null) return { value: D(e.amount_twd), estimated: false };
    const t = toBase(amt, e.currency, fx, e.event_date);
    return { value: t.value, estimated: e.currency !== 'TWD' };
  }

  function cashFlow(input, from, to) {
    const fx = input.fx || [];
    const events = (input.cashEvents || []).filter((e) => lte(from, e.event_date) && lte(e.event_date, to));
    const out = { income: 0n, expense: 0n, interest: 0n, investIn: 0n, investOut: 0n, finIn: 0n, finOut: 0n, transferIn: 0n, transferOut: 0n,
      unknownDist: 0n, missingFx: [], estimatedCount: 0, rows: [], unpairedTransfers: [] };
    for (const e of events) {
      const k = KINDS[e.kind] || { label: e.kind, group: e.direction === 'in' ? 'income' : 'expense' };
      const b = eventBase(e, fx);
      const row = { ...e, label: k.label, group: k.group, base: b.value, estimated: b.estimated };
      out.rows.push(row);
      if (b.value === null) { out.missingFx.push(row); continue; }
      if (b.estimated) out.estimatedCount++;
      const v = b.value;
      const sign = e.direction === 'in' ? 1n : -1n;
      if (k.group === 'income') {
        if (sign > 0n) { out.income += v; if (DIST_KINDS.includes(e.kind) && e.nature !== 'income') out.unknownDist += v; }
        else out.expense += v;
      } else if (k.group === 'expense') {
        if (sign < 0n) { out.expense += v; if (e.kind === 'loan_interest') out.interest += v; } else out.income += v;
      } else if (k.group === 'investment') {
        if (sign > 0n) out.investIn += v; else out.investOut += v;
      } else if (k.group === 'financing') {
        if (sign > 0n) out.finIn += v; else out.finOut += v;
      } else if (k.group === 'split') {
        // 繳款拆成本金（融資流量）與利息（費用）
        const p = D(e.principal_part), i = D(e.interest_part);
        const tot = D(e.amount);
        if (p === null || i === null || p + i !== tot) { row.splitError = true; }
        const ratio = (x) => (x === null || tot === 0n ? null : mul(v, (x * SCALE) / tot));
        const pb = ratio(p), ib = ratio(i);
        if (pb !== null && ib !== null && !row.splitError) { out.finOut += pb; out.expense += ib; out.interest += ib; row.principalBase = pb; row.interestBase = ib; }
        else { out.expense += v; row.flags = ['本金／利息未拆分，暫列支出']; }
      } else if (k.group === 'transfer') {
        if (sign > 0n) out.transferIn += v; else out.transferOut += v;
      }
    }
    // 轉帳／換匯配對：同一個配對代碼要有一進一出
    const pairs = {};
    out.rows.filter((r) => r.group === 'transfer').forEach((r) => { const key = r.transfer_pair || ('#' + r.id); (pairs[key] = pairs[key] || []).push(r); });
    Object.entries(pairs).forEach(([key, rs]) => { const ins = rs.filter((r) => r.direction === 'in').length, outs = rs.filter((r) => r.direction === 'out').length; if (!ins || !outs) out.unpairedTransfers.push(key); });
    const transferGap = out.transferIn - out.transferOut; // 換匯差額／手續費之外的落差
    out.netChange = out.income - out.expense + out.investIn - out.investOut + out.finIn - out.finOut + transferGap;
    out.afterDebtService = out.income - out.expense - out.finOut; // 收入扣支出（含利息）與還本後
    out.transferGap = transferGap;
    return out;
  }

  // ---------- 未來收支排程（扣掉已入帳配對的期數）----------
  const STEP = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };
  const WEEKS = { weekly: 1, biweekly: 2, triweekly: 3, fourweekly: 4 };
  function addDays(iso, n) { const t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
  function addMonths(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1 + n, 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
  }
  function upcoming(input, from, to) {
    const out = [];
    const matched = (input.cashEvents || []).filter((e) => e.schedule_id);
    for (const s of (input.cashSchedules || []).filter((x) => x.status !== 'archived')) {
      let date = s.start_date; let n = 0;
      while (lte(date, to) && (!s.end_date || lte(date, s.end_date)) && n < 600) {
        if (lte(from, date)) {
          const month = date.slice(0, 7);
          // 週期以週計的排程，用「同一天前後 3 天」比對已入帳；以月計的用同一個月
          const done = matched.some((e) => e.schedule_id === s.id && (WEEKS[s.frequency]
            ? Math.abs((Date.parse(e.event_date) - Date.parse(date)) / 864e5) <= 3
            : e.event_date.slice(0, 7) === month));
          if (!done) out.push({ schedule_id: s.id, date, kind: s.kind, label: (KINDS[s.kind] || {}).label || s.kind, direction: s.direction,
            amount: D(s.amount), currency: s.currency, basis: s.basis, note: s.note });
        }
        if (s.frequency === 'once') break;
        n++; date = WEEKS[s.frequency] ? addDays(s.start_date, 7 * WEEKS[s.frequency] * n) : addMonths(s.start_date, STEP[s.frequency] * n);
      }
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  // ---------- 資金關聯追查 ----------
  function trace(input) {
    const assets = new Map((input.assets || []).map((a) => [a.id, a]));
    return (input.liabilities || []).filter((l) => l.status !== 'archived').map((l) => ({
      liability: l,
      collateral: (input.collateralLinks || []).filter((k) => k.liability_id === l.id).map((k) => ({ link: k, asset: assets.get(k.asset_id) })),
      uses: (input.fundingLinks || []).filter((k) => k.liability_id === l.id).map((k) => ({ link: k, asset: assets.get(k.asset_id) })),
    }));
  }

  // ---------- 全部算一次（畫面與快照共用）----------
  function compute(input) {
    const bs = balanceSheet(input);
    const av = available(input, bs);
    const from = input.periodFrom || input.asOf.slice(0, 8) + '01';
    const to = input.periodTo || input.asOf;
    const cf = cashFlow(input, from, to);
    const until = input.upcomingTo || addMonths(input.asOf, 12);
    const up = upcoming(input, input.asOf, until);
    return { rulesVersion: RULES_VERSION, bs, av, cf, upcoming: up, trace: trace(input), period: { from, to }, upcomingTo: until };
  }

  // 把 BigInt 轉成 JSON 可存的字串（快照用），讀回時用 revive
  function serialize(obj) { return JSON.parse(JSON.stringify(obj, (k, v) => (typeof v === 'bigint' ? { $d: v.toString() } : v))); }
  function revive(obj) { return JSON.parse(JSON.stringify(obj), (k, v) => (v && typeof v === 'object' && '$d' in v ? BigInt(v.$d) : v)); }

  return { RULES_VERSION, D, add, sub, mul, toNum, fxRate, toBase, pickValue, pickBalance, balanceSheet, available, cashFlow, upcoming, trace, compute, serialize, revive, KINDS, addMonths };
});
