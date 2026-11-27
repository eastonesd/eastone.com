// ============================================================
// 家辦整合報告：以「家族」為單位，A4 直式（畫面＝列印＝PDF）
//   總覽（紅黃綠燈＋最重要的三件事）→ 家族 → 資產負債 → 現金流 → 保障 → 稅務 → 傳承 → 退休 → 結論與待辦 → 附錄
// 資料：fo_plans（家辦資料）、家族成員與關係、clientList（保單）＋kbCompute、fin_*（資產負債與收支）、retire_plans
// 計算：family-calc.js、tax-calc.js、legacy-calc.js、retire-calc.js、finance-calc.js
// 版面：沿用 report.css（固定 A4、放不下自動縮小或分頁）
// ============================================================
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const C = FinCalc, T = EastoneTax, L = EastoneLegacy, F = EastoneFamily, RC = EastoneRetire, W = 10000;
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const wan = (y) => { if (y == null || !isFinite(y)) return '—'; const v = Math.round(y) / W; return (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('zh-TW') : v.toLocaleString('zh-TW', { maximumFractionDigits: 1 })) + ' 萬'; };
  const money = (n) => Math.round(Number(n) || 0).toLocaleString('zh-TW');
  const pct = (x) => `${Math.round(x * 1000) / 10}%`;
  const roc = (iso) => (iso ? `${+iso.slice(0, 4) - 1911} 年 ${+iso.slice(5, 7)} 月 ${+iso.slice(8, 10)} 日` : '');
  const fullAge = (b) => { if (!b) return null; const [y, m, d] = b.split('-').map(Number), [ty, tm, td] = today.split('-').map(Number); return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0); };
  const frac = (x) => { for (const d of [1, 2, 3, 4, 6, 8, 9, 12, 16, 18, 24]) { const n = Math.round(x * d); if (n && Math.abs(n / d - x) < 1e-9) return d === 1 ? '全部' : `${n}/${d}`; } return pct(x); };
  const num = (b) => (b == null ? 0 : Math.round(C.toNum(b)));
  const LIQ = ['cash', 'deposit', 'fund', 'stock'];
  const INVEST = ['deposit', 'cash', 'fund', 'stock', 'mcn', 'savings_policy', 'investment_policy'];
  const CATS = { house: '房屋', land: '土地', savings_policy: '儲蓄險', investment_policy: '投資型／年金', fund: '基金', stock: '股票／ETF', deposit: '定存', cash: '活存／現金', mcn: '結構型商品', equity: '公司股權', vehicle: '車輛', other: '其他' };
  const CAT_COLOR = { house: '#1B2A4A', land: '#3E6FA8', savings_policy: '#B8892B', investment_policy: '#C9B27A', fund: '#6E8FB5', stock: '#8C6A2A', deposit: '#4F7A5A', cash: '#7FA88A', mcn: '#A2402D', equity: '#5B3F8C', vehicle: '#8A8F9A', other: '#B7B2A6' };
  const LEGAL = { will_notary: '公證遺囑', will_self: '自書遺囑', will_other: '代筆／密封遺囑', trust: '信託', ins_trust: '保險金信託', guardian: '意定監護', marital: '夫妻財產制約定', medical: '預立醫療決定', poa: '授權書', other: '其他' };
  const GOAL = { education: '子女教育金', house: '購屋', retire: '退休生活', care: '照顧長輩', legacy: '財富傳承', business: '事業交棒', medical: '醫療長照', other: '其他' };
  const LV = { g: '良好', y: '注意', r: '優先處理', n: '資料不足' };

  let FAM = null, PLAN = {}, PEOPLE = [], RELS = [], M = [], HEAD = null, AGENT = null, X = {};

  // ---------------- 讀資料 ----------------
  async function load(fid) {
    const q = (t) => sb.from(t).select('*');
    const [fa, fm, pp, rl, pl, ag, tm] = await Promise.all([
      sb.from('families').select('*').eq('id', fid).maybeSingle(), q('family_members').eq('family_id', fid), q('fo_people'), q('person_relations'),
      sb.from('fo_plans').select('data, updated_at').eq('family_id', fid).maybeSingle(), q('family_agents').eq('family_id', fid), q('team_members'),
    ]);
    const err = [fa, fm, pp, rl, ag].find((r) => r.error);
    if (err) throw err.error;
    if (!fa.data) throw new Error('找不到這個家族，或您沒有權限查看。');
    FAM = fa.data; PLAN = (pl.data && pl.data.data) || {};
    const ids = new Set((fm.data || []).map((m) => m.person_id));
    PEOPLE = (pp.data || []).filter((p) => ids.has(p.id)).map((p) => ({ ...p, title: ((fm.data || []).find((m) => m.person_id === p.id) || {}).title || '' }));
    RELS = (rl.data || []).filter((r) => ids.has(r.a) && ids.has(r.b));
    const prim = (ag.data || []).sort((a) => (a.role === 'primary' ? -1 : 1))[0];
    AGENT = prim ? (tm.data || []).find((t) => t.user_id === prim.user_id) : null;

    const CLIENTS = await clientList();
    const fx = await kbFetchFx().catch(() => null);
    await KB.load().catch(() => null);
    M = PEOPLE.map((p) => ({ p, client: p.client_id ? CLIENTS.find((c) => c.id === p.client_id && (!p.owner || p.owner === APP_UID)) || null : null, otherAgent: !!(p.client_id && p.owner && p.owner !== APP_UID) }));
    const cids = M.filter((m) => m.client).map((m) => m.client.id);
    const pick = async (t) => { if (!cids.length) return []; const { data, error } = await sb.from(t).select('*').in('client_id', cids); if (error) throw error; return data || []; };
    const [assets, assetValues, liabilities, liabilityBalances, cashEvents, cashSchedules, retire, fxRes] = await Promise.all([
      pick('fin_assets'), pick('fin_asset_values'), pick('fin_liabilities'), pick('fin_liability_balances'), pick('fin_cash_events'), pick('fin_cash_schedules'), pick('retire_plans'),
      sb.from('fin_fx_quotes').select('*').order('quote_date', { ascending: false }).limit(2000),
    ]);
    const fxq = fxRes.data || [];
    M.forEach((m) => {
      const c = m.client, cash = (PLAN.cash || {})[m.p.id] || {};
      m.age = fullAge(m.p.birthday || (c && c.birthday));
      if (c) {
        const by = (arr) => arr.filter((x) => x.client_id === c.id);
        const input = { assets: by(assets), assetValues: by(assetValues), liabilities: by(liabilities), liabilityBalances: by(liabilityBalances), cashEvents: by(cashEvents), cashSchedules: by(cashSchedules), collateralLinks: [], fundingLinks: [], fx: fxq, asOf: today };
        m.fin = input;
        m.hasFin = input.assets.length + input.liabilities.length > 0;
        const r = C.compute(input);
        m.bs = r.bs;
        m.assets = num(r.bs.assetsTotal); m.liab = num(r.bs.liabTotal); m.net = m.assets - m.liab;
        const rowCat = (row) => (input.assets.find((a) => a.id === row.id) || {}).category;
        m.byCat = {};
        r.bs.assetRows.filter((x) => x.counted && x.base != null).forEach((x) => { const k = rowCat(x) || 'other'; m.byCat[k] = (m.byCat[k] || 0) + num(x.base); });
        m.liquid = LIQ.reduce((s, k) => s + (m.byCat[k] || 0), 0);
        m.invest = INVEST.reduce((s, k) => s + (m.byCat[k] || 0), 0);
        m.equity = r.bs.assetRows.filter((x) => rowCat(x) === 'equity');
        m.missing = r.bs.missingCount || 0;
        // 未來 12 個月固定收支
        let inc = 0, exp = 0, work = 0;
        r.upcoming.forEach((u) => {
          const g = (C.KINDS[u.kind] || {}).group;
          if (u.amount === null) return;
          const t = C.toBase(u.amount, u.currency, fxq, u.date);
          if (t.value === null) return;
          if (u.direction === 'in' && g === 'income') { inc += num(t.value); if (u.kind === 'salary') work += num(t.value); }
          if (u.direction === 'out' && (g === 'expense' || g === 'split')) exp += num(t.value);
        });
        m.incomeAuto = inc; m.expenseAuto = exp; m.workAuto = work;
        // 保單
        try { m.kb = kbCompute({ allClients: CLIENTS, insured: c, fx }); } catch (e) { m.kbErr = e.message || String(e); }
        const rp = retire.find((x) => x.client_id === c.id);
        m.retireSaved = rp ? rp.params : null;
      }
      m.income = cash.income !== '' && cash.income != null ? Number(cash.income) * W : (m.incomeAuto || 0);
      m.expense = cash.expense !== '' && cash.expense != null ? Number(cash.expense) * W : (m.expenseAuto || 0);
      m.cashKnown = (cash.income !== '' && cash.income != null) || (cash.expense !== '' && cash.expense != null) || !!(m.fin && m.fin.cashSchedules.length);
      m.premium = m.kb ? m.kb.premium.thisYear : 0;
    });
    HEAD = M.find((m) => m.p.id === PLAN.head) || [...M].filter((m) => m.client).sort((a, b) => (b.age || 0) - (a.age || 0))[0] || M[0] || null;
  }

  // ---------------- 規劃對象的繼承人（同 legacy.js，只用家族名單）----------------
  function heirsOf(head) {
    const by = new Map(PEOPLE.map((p) => [p.id, p]));
    const me = new Set([head.p.id]);
    const childrenOf = (ids) => [...new Set(RELS.filter((r) => r.kind === 'parent' && ids.has(r.a)).map((r) => r.b))].map((id) => by.get(id)).filter(Boolean);
    const parentsOf = (ids) => [...new Set(RELS.filter((r) => r.kind === 'parent' && ids.has(r.b)).map((r) => r.a))].map((id) => by.get(id)).filter(Boolean);
    const mk = (p, rel, extra = {}) => ({ id: p.id, pid: p.id, name: p.name, rel, age: fullAge(p.birthday), alive: true, renounce: false, ...extra });
    const out = [];
    RELS.filter((r) => r.kind === 'spouse' && (me.has(r.a) || me.has(r.b))).forEach((r) => { const p = by.get(me.has(r.a) ? r.b : r.a); if (p && !out.some((h) => h.pid === p.id)) out.push(mk(p, 'spouse')); });
    childrenOf(me).forEach((k) => { const h = mk(k, 'child'); out.push(h); childrenOf(new Set([k.id])).forEach((g) => out.push(mk(g, 'grandchild', { id: g.id, via: h.id }))); });
    const parents = parentsOf(me);
    parents.forEach((p) => out.push(mk(p, 'parent')));
    const sib = new Set();
    RELS.filter((r) => r.kind === 'sibling' && (me.has(r.a) || me.has(r.b))).forEach((r) => sib.add(me.has(r.a) ? r.b : r.a));
    childrenOf(new Set(parents.map((p) => p.id))).forEach((p) => { if (!me.has(p.id)) sib.add(p.id); });
    [...sib].map((id) => by.get(id)).filter(Boolean).forEach((p) => out.push(mk(p, 'sibling')));
    return out;
  }
  const relToHead = (pid) => {
    if (!HEAD) return '';
    if (pid === HEAD.p.id) return '規劃對象';
    const h = X.heirs.find((x) => x.pid === pid);
    if (h) return L.REL[h.rel].replace('（代位或次親等）', '');
    const r = RELS.find((x) => (x.a === pid && x.b === HEAD.p.id) || (x.b === pid && x.a === HEAD.p.id));
    return r ? ({ in_law: '姻親', partner: '伴侶', grandparent: '祖孫', other: r.label || '其他' }[r.kind] || '') : '';
  };

  // ---------------- 計算 ----------------
  function compute() {
    const H = HEAD;
    X.heirs = H ? heirsOf(H) : [];
    // 家族合計
    X.assets = M.reduce((s, m) => s + (m.assets || 0), 0);
    X.liab = M.reduce((s, m) => s + (m.liab || 0), 0);
    X.net = X.assets - X.liab;
    X.income = M.reduce((s, m) => s + m.income, 0);
    X.expense = M.reduce((s, m) => s + m.expense, 0);
    X.premium = M.reduce((s, m) => s + m.premium, 0);
    X.cashKnown = M.some((m) => m.cashKnown);
    X.byCat = {};
    M.forEach((m) => Object.entries(m.byCat || {}).forEach(([k, v]) => { X.byCat[k] = (X.byCat[k] || 0) + v; }));
    X.equity = M.flatMap((m) => (m.equity || []).map((e) => ({ ...e, who: m.p.name })));

    // 規劃對象的遺產稅
    X.est = null;
    if (H && H.client && H.hasFin) {
      let gross = H.assets, reTax = 0, reMiss = 0;
      H.fin.assets.filter((a) => ['house', 'land'].includes(a.category) && a.status !== 'archived').forEach((a) => {
        const row = H.bs.assetRows.find((r) => r.id === a.id);
        if (!row || !row.counted) return;
        const t = C.reTaxValue(a);
        if (!t.complete) { reMiss++; return; }
        gross += t.total - num(row.base); reTax++;
      });
      // 剩餘財產差额
      const spouseH = X.heirs.find((h) => h.rel === 'spouse');
      const spM = spouseH ? M.find((m) => m.p.id === spouseH.pid) : null;
      const mr = PLAN.marital || {};
      const v = (x) => (x === '' || x == null ? null : Number(x) * W);
      X.marital = F.maritalClaim({ regime: mr.regime || 'legal', headNet: v(mr.headNet) ?? H.net, headPre: v(mr.headPre) || 0, headFree: v(mr.headFree) || 0,
        spouseNet: v(mr.spouseNet) ?? (spM && spM.hasFin ? spM.net : null), spousePre: v(mr.spousePre) || 0, spouseFree: v(mr.spouseFree) || 0 });
      if (!spouseH) X.marital = { applicable: false, claim: 0, note: '沒有配偶，不適用。' };
      // 贈與
      const relOf = (g) => g.toRel || 'other';
      X.gift = F.giftSummary((PLAN.gifts || []).map((g) => ({ ...g, toRel: relOf(g), amount: (Number(g.amount) || 0) * W })), H.p.id, today);
      // 扣除額
      let desc = X.heirs.filter((h) => h.rel === 'child');
      if (!desc.length) desc = X.heirs.filter((h) => h.rel === 'grandchild');
      const parents = X.heirs.filter((h) => h.rel === 'parent').slice(0, 2);
      X.est = T.estate({ gross: Math.max(0, gross), addBack: X.gift.addBack, exemption: true, funeral: true, spouse: { on: !!spouseH },
        descendants: desc.map((h) => ({ age: h.age })), parents: parents.map(() => ({})), debts: H.liab, claim: X.marital.claim });
      X.reTax = reTax; X.reMiss = reMiss;
      // 保險金
      const pols = [], seen = new Map();
      if (H.kb && H.kb.values.death) H.kb.values.death.rows.forEach((r) => {
        const k = `${r.ct.holderId}|${r.ct.policyIndex}`;
        const p = seen.get(k) || { amount: 0, applicant: r.ct.applicant || H.p.name, beneficiaries: r.ct.beneficiaries || [], label: `${r.ct.company || ''} ${r.ct.name || r.ct.code || ''}`.trim(), ct: r.ct };
        p.amount += r.value; seen.set(k, p);
      });
      seen.forEach((p) => pols.push(p));
      X.pols = pols;
      X.shares = L.legalShares(X.heirs);
      const nameOf = (id) => (X.heirs.find((h) => h.id === id) || {}).name || '（未填）';
      X.ins = L.allocateInsurance(pols, X.shares.rows, nameOf);
      X.insToHeirs = X.ins.people.reduce((s, p) => s + p.amount, 0);
      X.claimPaid = Math.min(X.marital.claim || 0, Math.max(0, H.net - X.est.tax));
      X.spouseId = spouseH ? spouseH.id : null;
      X.dist = L.distribute(Math.max(0, H.net - X.est.tax - X.claimPaid + X.ins.estateIn), X.shares, null);
      X.amtRows = X.ins.people.map((p) => { const over = p.amtCounted > T.RULES.amt.deathExempt; return { ...p, over, due: over ? T.amt({ netIncome: 0, deathBenefit: p.amtCounted }).due : 0 }; });
    }
    // 保障矩陣
    const has = (m, codes) => (m.kb ? codes.map((c) => m.kb.values[c]).find((v) => v && (v.total || v.item.pay_type === 'flag')) : null);
    const COV = [
      ['death', '壽險身故', ['death']],
      ['dis', '失能', ['tpd', 'dis_monthly', 'dis_lump', 'dis_yearly', 'acc_disability']],
      ['critical', '重疾／癌症', ['cancer_major', 'critical_illness', 'major_injury', 'specific_lump', 'cancer_hosp']],
      ['ltc', '長照', ['ltc_monthly', 'ltc_lump', 'ltc_yearly']],
      ['reimb', '實支醫療', ['misc_limit', 'room_limit', 'reimb_surgery_in']],
      ['daily', '住院日額', ['hosp_daily']],
      ['acc', '意外', ['acc_death', 'acc_reimb']],
    ];
    X.COV = COV;
    X.cov = M.filter((m) => m.client && m.kb).map((m) => {
      const row = { m, name: m.p.name };
      COV.forEach(([k, , codes]) => { row[k] = has(m, codes); });
      row.earner = m.income > 0 || (m.age != null && m.age >= 25 && m.age < 65 && !m.cashKnown);
      return row;
    });
    // 保單實質課稅風險（有身故給付的保單）
    X.risk = [];
    M.filter((m) => m.kb && m.kb.values.death).forEach((m) => {
      const seen = new Set();
      m.kb.values.death.rows.forEach((r) => {
        const k = `${r.ct.holderId}|${r.ct.policyIndex}`; if (seen.has(k)) return; seen.add(k);
        const f = F.policyFlags(r.ct, today);
        if (f.length) X.risk.push({ who: m.p.name, ct: r.ct, flags: f });
      });
    });
    // 退休（規劃對象）
    X.retire = null;
    if (H && H.client) {
      const s = H.retireSaved || {};
      const age = H.age ?? 45;
      const r1 = (y) => Math.round(y / 12 / W * 10) / 10;
      // 薪資算工作收入（退休就停）；租金、股息、利息等被動收入退休後繼續有。65 歲以上視為已退休
      const manual = ((PLAN.cash || {})[H.p.id] || {}).income;
      const work = manual !== '' && manual != null ? (age >= 65 ? 0 : H.income) : (H.workAuto || 0);
      const passive = Math.max(0, H.income - work);
      const retireAge = age >= 65 ? age : 65;
      const raw = {
        age, retireAge, lifeAge: Math.max(90, age + 5), ret: 3, infl: 2, assets: Math.round((H.invest || 0) / W * 10) / 10,
        monthlyIncome: r1(work), monthlyExpense: r1(H.expense), retireRatio: age >= 65 ? 100 : 80, pension: 0, pensionAge: 65, lumpSum: 0,
        otherIncome: passive ? [{ fromAge: age, toAge: '', monthly: r1(passive), label: '租金、股息等被動收入' }] : [], ...s,
      };
      if (H.retireSaved || H.hasFin || H.cashKnown) {
        const p = {};
        ['age', 'retireAge', 'lifeAge', 'ret', 'infl'].forEach((k) => { p[k] = Number(raw[k]); });
        ['assets', 'monthlyIncome', 'monthlyExpense', 'pension', 'lumpSum'].forEach((k) => { p[k] = (Number(raw[k]) || 0) * W; });
        p.pensionAge = Number(raw.pensionAge) || 65;
        p.retireRatio = Number.isFinite(Number(raw.retireRatio)) ? Number(raw.retireRatio) / 100 : 0.8;
        p.otherIncome = (raw.otherIncome || []).map((o) => ({ fromAge: Number(o.fromAge), toAge: Number(o.toAge) || null, monthly: (Number(o.monthly) || 0) * W }));
        p.bigs = (raw.bigs || []).map((b) => ({ age: Number(b.age), amount: (Number(b.amount) || 0) * W, label: b.label }));
        if (p.lifeAge > p.age) {
          const sim = RC.simulate(p);
          X.retire = { p, sim, extra: RC.extraSaving(p), saved: !!H.retireSaved, depleted: sim.depleted, lifeAge: p.lifeAge, monthlyIncome: p.monthlyIncome };
        }
      }
    }
    const legal = PLAN.legal || [];
    const done = (re) => legal.some((l) => l.status === 'done' && re.test(l.kind || '') && (!l.pid || !HEAD || l.pid === HEAD.p.id));
    X.lights = F.lights({
      estateTax: X.est ? X.est.tax : null, liquid: HEAD ? HEAD.liquid || 0 : 0, insToHeirs: X.insToHeirs || 0,
      coverage: X.cov.map((c) => ({ name: c.name, earner: c.earner, death: !!c.death, medical: !!(c.reimb || c.daily), critical: !!c.critical })),
      retire: X.retire, assets: X.assets, liabilities: X.liab, income: X.cashKnown ? X.income : null, expense: X.expense,
      hasWill: done(/^will/), hasTrust: done(/trust/), policyRisk: X.risk.length, reserveViolated: false,
    });
    X.actions = actions();
  }

  function actions() {
    const out = [];
    const L1 = Object.fromEntries(X.lights.map((l) => [l.k, l]));
    const add = (lv, text) => out.push({ lv, text });
    if (L1.tax.lv === 'r') add('r', `補足遺產稅源缺口約 <b>${wan(Math.max(0, X.est.tax - (HEAD.liquid || 0) - X.insToHeirs))}</b>：增加壽險保額（受益人安排為負責繳稅的人），或及早分年贈與降低遺產。`);
    if (L1.tax.lv === 'y') add('y', '遺產稅要靠身故保險金墊繳：先跟受益人說清楚用途，或用保險金信託確保資金用在繳稅。');
    const noDeath = X.cov.filter((c) => c.earner && !c.death).map((c) => c.name);
    if (noDeath.length) add('r', `${esc(noDeath.join('、'))} 有收入但沒有壽險：先補足家庭責任保障（建議至少 ${wan(Math.max(X.expense * 5, X.liab))}）。`);
    const noMed = X.cov.filter((c) => !(c.reimb || c.daily) || !c.critical).map((c) => c.name);
    if (noMed.length) add('y', `補強 ${esc(noMed.join('、'))} 的醫療或重疾保障。`);
    if (X.retire && X.retire.depleted != null) add(L1.retire.lv, `退休準備不足：${X.retire.extra ? `退休前每月多存 <b>${wan(X.retire.extra)}</b>，` : ''}或延後退休、用年金險建立終身現金流。`);
    if (L1.debt.lv !== 'g' && L1.debt.lv !== 'n') add(L1.debt.lv, `負債比 ${esc(L1.debt.text.replace('負債占資產 ', ''))}：優先償還利率最高的借款，房貸壽險確保負債不留給家人。`);
    if (L1.cash.lv === 'r') add('r', '每年收支不足：檢視固定支出與保費結構，先建立正結餘。');
    if (X.est && X.est.tax > 0 && L1.legacy.text.includes('遺囑')) add('y', '立公證遺囑，明確分配不動產與公司股權，避免共有與爭產；同時確認不侵害特留分。');
    if (X.risk.length) add('y', `檢視 ${X.risk.length} 張有實質課稅風險特徵的保單（高齡、躉繳、短期投保等），必要時調整要保人或受益人。`);
    if (X.marital && X.marital.claim) add('g', `身故時記得由配偶主張剩餘財產差額分配請求權（約 ${wan(X.marital.claim)}），可少繳遺產稅；需要婚前財產證明。`);
    if (X.gift && X.gift.thisYear[HEAD && HEAD.p.id] && X.gift.thisYear[HEAD.p.id].left > 0 && X.est && X.est.tax > 0) add('g', `今年還有 ${wan(X.gift.thisYear[HEAD.p.id].left)} 贈與免稅額，可以搭配逐年移轉。`);
    (PLAN.goals || []).filter((g) => g.priority === 'high').forEach((g) => add('y', `家族目標：${esc(GOAL[g.kind] || '')}${g.title ? '－' + esc(g.title) : ''}${g.amount ? `，需要 ${esc(g.amount)} 萬` : ''}${g.year ? `（${esc(g.year)} 年）` : ''}。`));
    const rank = { r: 0, y: 1, g: 2, n: 3 };
    return out.sort((a, b) => rank[a.lv] - rank[b.lv]);
  }

  // ---------------- 版面 ----------------
  let pageNo = 0;
  function page(eyebrow, title, need, body, opts = {}) {
    pageNo += 1;
    const attrs = opts.flow != null ? ` data-flow="${opts.flow}"` : ' data-fit';
    return `<section class="page${opts.cls ? ' ' + opts.cls : ''}"${attrs}${opts.key ? ` data-key="${opts.key}"` : ''}>
      <header class="pg-head"><span>EASTONE｜家辦整合報告</span><span>${esc(FAM.name)}　${roc(today)}</span></header>
      <div class="pg-title"><div class="pg-num">${String(pageNo).padStart(2, '0')}</div><div><div class="pg-eyebrow">${eyebrow}</div><h2>${title}</h2></div></div>
      ${need ? `<div class="pg-need">${need}</div>` : ''}
      <div class="pg-body"><div class="pg-fit">${body}</div></div>
      <footer class="pg-foot"><span>本報告依客戶提供之資料整理，數字為估算、僅供規劃參考；稅務與法律事項請以主管機關規定及專業意見為準。</span><span>${pageNo}</span></footer>
    </section>`;
  }
  const dot = (lv) => `<i class="fr-dot ${lv}" aria-hidden="true"></i>`;
  const kpi = (label, value, sub, cls = '') => `<div class="${cls}"><span>${label}</span><b>${value}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;

  function cover() {
    const head = HEAD ? HEAD.p.name : '—';
    return `<section class="page cover" data-fit>
      <div class="cv-top">
        <div class="cv-brand"><img src="../icons/logo.png?v=3" alt=""><div><b>EASTONE</b><span>東石家族辦公室</span></div></div>
        <div class="cv-eyebrow">FAMILY OFFICE REPORT</div>
        <h1>家辦整合報告</h1>
        <div class="cv-client">${esc(FAM.name)}</div>
        <div class="cv-meta">規劃對象 ${esc(head)}　資料基準日 ${roc(today)}　成員 ${M.length} 位</div>
      </div>
      <div class="cv-body">
        <div class="cv-say">「把保單、資產、稅務放在同一張桌上看，才看得出一個家族真正的缺口與機會。」</div>
        <div class="fr-toc">${['一頁總覽', '家族與安排', '資產負債', '現金流', '保障', '稅務', '傳承', '退休', '結論與待辦'].map((t, i) => `<div><b>${String(i + 1).padStart(2, '0')}</b>${t}</div>`).join('')}</div>
        <div class="cv-agent"><div><span>服務業務員</span><b>${esc(AGENT ? AGENT.name : '—')}</b>${AGENT && AGENT.life_license ? `<small>壽險登錄 ${esc(AGENT.life_license)}</small>` : ''}</div>
          <div><span>家族窗口</span><b>${esc(head)}</b></div></div>
        <p class="cv-note">本報告依客戶提供之保單、資產與家族資料整理，數字為估算、僅供規劃參考，非保險給付承諾或稅務、法律意見。</p>
      </div>
    </section>`;
  }

  function overview() {
    const lights = X.lights.map((l) => `<div class="fr-light ${l.lv}">${dot(l.lv)}<div><b>${l.label}</b><span>${esc(l.text)}</span></div><em>${LV[l.lv]}</em></div>`).join('');
    const top = X.actions.slice(0, 3);
    const goals = (PLAN.goals || []).slice(0, 4);
    return page('SUMMARY', '一頁總覽', '只看這一頁，也能掌握這個家族最重要的事。', `
      <div class="fr-kpis">
        ${kpi('家族淨資產', wan(X.net), `資產 ${wan(X.assets)}・負債 ${wan(X.liab)}`)}
        ${kpi('每年結餘', X.cashKnown ? wan(X.income - X.expense) : '—', X.cashKnown ? `收入 ${wan(X.income)}・支出 ${wan(X.expense)}` : '尚無收支資料', X.cashKnown && X.income < X.expense ? 'bad' : '')}
        ${kpi('遺產稅估算', X.est ? wan(X.est.tax) : '—', HEAD ? `規劃對象：${esc(HEAD.p.name)}` : '')}
        ${kpi('全家年繳保費', wan(X.premium), X.income ? `占收入 ${pct(X.premium / X.income)}` : '')}
      </div>
      <h3>六大面向</h3>
      <div class="fr-lights">${lights}</div>
      <h3>最重要的三件事</h3>
      ${top.length ? `<ol class="fr-top">${top.map((a) => `<li class="${a.lv}">${a.text}</li>`).join('')}</ol>` : '<p class="rp-empty">目前沒有需要優先處理的項目。</p>'}
      ${goals.length ? `<h3>家族目標</h3><div class="fr-goals">${goals.map((g) => `<div><b>${esc(GOAL[g.kind] || '目標')}</b><span>${esc(g.title || '')}</span><em>${g.amount ? esc(g.amount) + ' 萬' : ''}${g.year ? `・${esc(g.year)} 年` : ''}</em></div>`).join('')}</div>` : ''}`);
  }

  function familyPage() {
    const rows = M.map((m) => `<tr><td><b>${esc(m.p.name)}</b>${m.p.title ? `<div class="sub">${esc(m.p.title)}</div>` : ''}</td><td>${esc(relToHead(m.p.id))}</td><td class="num">${m.age ?? '—'}</td>
      <td>${m.client ? '客戶' : m.otherAgent ? '其他業務員的客戶' : '非客戶'}</td><td class="num">${m.client && m.hasFin ? wan(m.net) : '—'}</td><td class="num">${m.kb ? (m.kb.contracts || []).filter((c) => !c.pending && c.kind === 'main').length : '—'}</td></tr>`).join('');
    const legal = PLAN.legal || [];
    const name = (pid) => (PEOPLE.find((p) => p.id === pid) || {}).name || '';
    const st = { done: '已完成', planned: '規劃中', none: '還沒有' };
    const must = ['will_notary', 'trust', 'guardian'];
    const miss = HEAD ? must.filter((k) => !legal.some((l) => (l.kind === k || (k === 'will_notary' && /^will/.test(l.kind || ''))) && l.status === 'done' && (!l.pid || l.pid === HEAD.p.id))) : [];
    return page('FAMILY', '家族與安排', '誰在這個家族裡、彼此的關係，以及目前已經做好的法律安排。', `
      <table class="rp-table"><thead><tr><th>成員</th><th>與規劃對象關係</th><th class="num">年齡</th><th>資料</th><th class="num">淨資產</th><th class="num">保單</th></tr></thead><tbody>${rows}</tbody></table>
      ${M.some((m) => m.otherAgent) ? '<p class="rp-note">「其他業務員的客戶」：資料屬於其他業務員，本報告沒有納入其資產與保單。</p>' : ''}
      <h3>法律安排</h3>
      ${legal.length ? `<table class="rp-table"><thead><tr><th>對象</th><th>類別</th><th>狀態</th><th>日期</th><th>內容</th></tr></thead><tbody>
        ${legal.map((l) => `<tr><td>${esc(name(l.pid))}</td><td>${esc(LEGAL[l.kind] || '')}</td><td class="${l.status === 'done' ? 'ok' : 'warn'}">${st[l.status] || ''}</td><td>${esc(l.date || '')}</td><td>${esc(l.note || '')}</td></tr>`).join('')}</tbody></table>`
        : '<p class="rp-empty">尚未記錄任何遺囑、信託或意定監護。</p>'}
      ${miss.length ? `<p class="fr-callout">規劃對象尚未完成：${miss.map((k) => LEGAL[k]).join('、')}。高資產家族建議至少備妥公證遺囑；擔心失智或失能時，意定監護可以事先指定由誰照顧與管理財產。</p>` : ''}
      ${PLAN.wishes ? `<h3>傳承意願</h3><p class="fr-quote">${esc(PLAN.wishes)}</p>` : ''}`);
  }

  function bar(byCat, total) {
    if (!total) return '';
    const parts = Object.entries(byCat).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    return `<div class="alloc-bar">${parts.map(([k, v]) => `<i style="width:${v / total * 100}%;background:${CAT_COLOR[k] || '#999'}" title="${CATS[k] || k}"></i>`).join('')}</div>
      <div class="fr-legend">${parts.map(([k, v]) => `<span><i style="background:${CAT_COLOR[k] || '#999'}"></i>${CATS[k] || k} ${wan(v)}（${pct(v / total)}）</span>`).join('')}</div>`;
  }

  function balancePage() {
    const fin = M.filter((m) => m.client && m.hasFin);
    const tot = Object.values(X.byCat).reduce((s, v) => s + v, 0);
    const liq = LIQ.reduce((s, k) => s + (X.byCat[k] || 0), 0);
    const re = (X.byCat.house || 0) + (X.byCat.land || 0);
    return page('BALANCE SHEET', '資產負債', '家族資產放在哪裡、有多少可以馬上動用，以及負債壓力。', `
      <div class="rp-sum">${kpi('家族總資產', wan(X.assets))}${kpi('總負債', wan(X.liab), X.assets ? `負債比 ${pct(X.liab / X.assets)}` : '')}${kpi('淨資產', wan(X.net))}${kpi('可動用現金', wan(liq), tot ? `占 ${pct(liq / tot)}` : '')}</div>
      <h3>資產配置</h3>${tot ? bar(X.byCat, tot) : '<p class="rp-empty">尚無資產資料。</p>'}
      ${tot && re / tot > 0.6 ? `<p class="fr-callout">不動產占 ${pct(re / tot)}：資產集中在不動產、現金偏少，繼承時容易出現「有房沒錢繳稅」，也不好平均分配。</p>` : ''}
      <h3>各成員</h3>
      ${fin.length ? `<table class="rp-table"><thead><tr><th>成員</th><th class="num">資產</th><th class="num">負債</th><th class="num">淨資產</th><th class="num">可動用現金</th><th>備註</th></tr></thead><tbody>
        ${fin.map((m) => `<tr><td><b>${esc(m.p.name)}</b></td><td class="num">${wan(m.assets)}</td><td class="num">${wan(m.liab)}</td><td class="num">${wan(m.net)}</td><td class="num">${wan(m.liquid)}</td><td class="sub">${m.missing ? `${m.missing} 項未估值或缺匯率、未計入` : ''}</td></tr>`).join('')}
        <tr class="total"><td>合計</td><td class="num">${wan(X.assets)}</td><td class="num">${wan(X.liab)}</td><td class="num">${wan(X.net)}</td><td class="num">${wan(liq)}</td><td></td></tr></tbody></table>` : '<p class="rp-empty">家族成員都還沒有資產負債資料，請先到「資產負債」建立。</p>'}
      <h3>公司股權</h3>
      ${X.equity.length ? `<table class="rp-table"><thead><tr><th>持有人</th><th>公司</th><th class="num">估值</th></tr></thead><tbody>${X.equity.map((e) => `<tr><td>${esc(e.who)}</td><td>${esc(e.name)}</td><td class="num">${e.base != null ? wan(num(e.base)) : '未估值'}</td></tr>`).join('')}</tbody></table>
        <p class="rp-note">未上市股權以公司資產淨值估價課遺產稅，通常是最大、最難分、也最缺現金的一塊；接班人選與股權移轉時程要及早定。</p>` : '<p class="rp-empty">沒有登錄公司股權。有經營事業的家族請在資產負債新增「公司股權／未上市」。</p>'}`, { flow: 2 });
  }

  function cashPage() {
    const rows = M.filter((m) => m.income || m.expense || m.premium);
    return page('CASH FLOW', '現金流', '每年進來多少、出去多少，保費負擔是否合理。', `
      <div class="rp-sum">${kpi('全家年收入', X.cashKnown ? wan(X.income) : '—')}${kpi('全家年支出', X.cashKnown ? wan(X.expense) : '—')}${kpi('每年結餘', X.cashKnown ? wan(X.income - X.expense) : '—')}${kpi('年繳保費', wan(X.premium), X.income ? `占收入 ${pct(X.premium / X.income)}` : '')}</div>
      ${rows.length ? `<table class="rp-table"><thead><tr><th>成員</th><th class="num">年收入</th><th class="num">年支出</th><th class="num">結餘</th><th class="num">年繳保費（被保險人）</th><th class="num">保費／收入</th></tr></thead><tbody>
        ${rows.map((m) => `<tr><td><b>${esc(m.p.name)}</b></td><td class="num">${wan(m.income)}</td><td class="num">${wan(m.expense)}</td><td class="num ${m.income - m.expense < 0 ? 'warn' : ''}">${wan(m.income - m.expense)}</td><td class="num">${wan(m.premium)}</td><td class="num">${m.income ? pct(m.premium / m.income) : '—'}</td></tr>`).join('')}</tbody></table>` : '<p class="rp-empty">還沒有收支資料。請在家族頁「家辦資料 → 收支」填寫，或在資產負債建立固定收支。</p>'}
      ${X.income && X.premium / X.income > 0.25 ? '<p class="fr-callout">保費超過收入的 25%：負擔偏重，萬一收入中斷可能繳不下去。建議區分保障型與儲蓄型，必要時調整。</p>' : ''}
      ${X.income && X.premium / X.income < 0.05 && X.cov.some((c) => c.earner && !c.death) ? '<p class="fr-callout">保費占收入不到 5%，而且有家庭經濟支柱沒有壽險：保障可能不足。</p>' : ''}
      <p class="rp-note">收入、支出優先採用「家辦資料 → 收支」填寫的金額；沒有填就用資產負債的固定收支（未來 12 個月）。保費以年繳化計算，已扣折扣。</p>`);
  }

  function coverText(v) {
    if (!v) return '<span class="fr-no">✕</span>';
    if (v.item.pay_type === 'flag') return '<span class="fr-yes">有</span>';
    const u = v.item.unit_label || '';
    if (/日/.test(u)) return `<span class="fr-yes">${money(v.total)}</span><small>/日</small>`;
    if (/月/.test(u)) return `<span class="fr-yes">${wan(v.total)}</span><small>/月</small>`;
    if (/年/.test(u) && !/萬/.test(u)) return `<span class="fr-yes">${wan(v.total)}</span><small>/年</small>`;
    return `<span class="fr-yes">${wan(v.total)}</span>`;
  }

  function coverPage() {
    const bens = (b) => (b || []).map((x) => `${x.type === 'legal' || x.name === '法定繼承人' ? '法定繼承人' : esc(x.name)}${x.ratio && !x.equal ? ` ${esc(x.ratio)}%` : ''}`).join('、') || '<span class="warn">未指定</span>';
    return page('PROTECTION', '保障', '全家族的保障一張表看完；空白的格子就是缺口。', `
      ${X.cov.length ? `<table class="rp-table fr-matrix"><thead><tr><th>成員</th>${X.COV.map(([, l]) => `<th class="c">${l}</th>`).join('')}<th class="num">年繳保費</th></tr></thead><tbody>
        ${X.cov.map((c) => `<tr><td><b>${esc(c.name)}</b>${c.m.age != null ? `<div class="sub">${c.m.age} 歲${c.earner ? '・經濟支柱' : ''}</div>` : ''}</td>${X.COV.map(([k]) => `<td class="c">${coverText(c[k])}</td>`).join('')}<td class="num">${wan(c.m.premium)}</td></tr>`).join('')}</tbody></table>
        <p class="rp-note">數字為目前有效保單的給付合計（依保單知識庫計算）；✕＝目前沒有這類保障。知識庫未建檔的商品不計入。</p>` : '<p class="rp-empty">家族成員還沒有保單資料。</p>'}
      ${X.pols && X.pols.length ? `<h3>${esc(HEAD.p.name)} 的身故保險金安排</h3>
        <table class="rp-table"><thead><tr><th>保單</th><th>要保人</th><th>受益人</th><th class="num">身故保險金</th></tr></thead><tbody>
        ${X.pols.map((p) => `<tr><td>${esc(p.label)}</td><td>${esc(p.applicant || '')}</td><td>${bens(p.beneficiaries)}</td><td class="num">${wan(p.amount)}</td></tr>`).join('')}</tbody></table>
        <p class="rp-note">受益人寫「法定繼承人」時保險金依應繼分分配，無法照顧特定的人；沒有指定受益人，保險金會列入遺產課稅。</p>` : ''}
      <h3>保單實質課稅風險</h3>
      ${X.risk.length ? `<table class="rp-table"><thead><tr><th>被保險人</th><th>保單</th><th>風險特徵</th></tr></thead><tbody>${X.risk.map((r) => `<tr><td>${esc(r.who)}</td><td>${esc(`${r.ct.company || ''} ${r.ct.name || r.ct.code || ''}`)}<div class="sub">${esc(r.ct.effective || '')} 生效</div></td><td class="warn">${r.flags.map(esc).join('、')}</td></tr>`).join('')}</tbody></table>
        <p class="rp-note">國稅局常見的認定特徵：高齡、短期、躉繳、鉅額、帶病、舉債投保、保額≈保費。符合越多，身故保險金越可能被併入遺產課稅。「帶病投保」系統無法判斷，請自行確認。</p>` : '<p class="rp-empty">有身故給付的保單沒有發現常見的實質課稅特徵。</p>'}`, { flow: 2 });
  }

  function taxPage() {
    if (!X.est) return page('TAX', '稅務', '', `<p class="rp-empty">${HEAD ? `規劃對象 ${esc(HEAD.p.name)} 還沒有資產負債資料，無法估算遺產稅。` : '請先在家辦資料選擇規劃對象。'}</p>`);
    const g = X.gift, name = (id) => (PEOPLE.find((p) => p.id === id) || {}).name || '（未選）';
    const giftRows = Object.entries(g.byGiver).flatMap(([id, ys]) => Object.entries(ys).sort((a, b) => b[0] - a[0]).map(([y, b]) => ({ id, y, ...b })));
    return page('TAX', '稅務', `以 ${esc(HEAD.p.name)} 今天身故估算遺產稅，並檢查贈與與最低稅負。`, `
      <div class="rp-sum">${kpi('遺產總額（課稅價值）', wan(X.est.gross))}${kpi('扣除合計', wan(X.est.totalOff))}${kpi('課稅淨額', wan(X.est.net))}${kpi('應納遺產稅', wan(X.est.tax), X.est.gross ? `有效稅率 ${pct(X.est.effectiveRate)}` : '', 'em')}</div>
      <table class="rp-table fr-est"><tbody>
        <tr><td>資產（不動產${X.reTax ? '以公告現值＋評定現值' : '暫以市價'}）</td><td class="num">${wan(X.est.gross - X.est.addBack)}</td></tr>
        ${X.est.addBack ? `<tr><td>加：死亡前 2 年內贈與（視為遺產）</td><td class="num">${wan(X.est.addBack)}</td></tr>` : ''}
        ${X.est.items.map((x) => `<tr><td>減：${esc(x.label)}</td><td class="num">−${wan(x.amount)}</td></tr>`).join('')}
        <tr class="total"><td>應納遺產稅</td><td class="num">${wan(X.est.tax)}</td></tr></tbody></table>
      ${X.reMiss ? `<p class="rp-note warn">${X.reMiss} 筆房屋／土地缺公告現值或評定現值，暫以市價計稅，遺產稅會高估。</p>` : ''}
      <h3>剩餘財產差額分配</h3>
      <p class="fr-line">${X.marital.applicable ? `規劃對象婚後財產 ${wan(X.marital.headPost)}、配偶 ${wan(X.marital.spousePost)}；配偶可請求 <b>${wan(X.marital.claim)}</b>。` : ''}${esc(X.marital.note)}</p>
      <h3>贈與紀錄</h3>
      ${giftRows.length ? `<table class="rp-table"><thead><tr><th>贈與人</th><th>年度</th><th class="num">贈與合計</th><th class="num">計入免稅額</th><th>判斷</th></tr></thead><tbody>
        ${giftRows.map((r) => `<tr><td>${esc(name(r.id))}</td><td>${r.y}</td><td class="num">${wan(r.total)}</td><td class="num">${wan(r.taxable)}</td><td class="${r.over ? 'warn' : 'ok'}">${r.over ? `超過 ${wan(r.over)}，應申報` : `在 ${wan(g.exempt)} 以內`}</td></tr>`).join('')}</tbody></table>`
        : `<p class="rp-empty">沒有贈與紀錄。每位贈與人每年有 ${wan(g.exempt)} 免稅額，可以搭配逐年移轉。</p>`}
      <h3>受益人最低稅負</h3>
      ${X.amtRows.length ? `<table class="rp-table"><thead><tr><th>受益人</th><th class="num">身故保險金</th><th class="num">計入基本所得額</th><th>判斷</th></tr></thead><tbody>
        ${X.amtRows.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${wan(p.amount)}</td><td class="num">${wan(p.amtCounted)}</td><td class="${p.over ? 'warn' : 'ok'}">${p.over ? `超過 ${wan(T.RULES.amt.deathExempt)}，約補 ${wan(p.due)}` : '免稅額以內'}</td></tr>`).join('')}</tbody></table>`
        : '<p class="rp-empty">沒有可計算的壽險身故給付。</p>'}`);
  }

  function legacyPage() {
    if (!X.est) return page('LEGACY', '傳承', '', '<p class="rp-empty">資料不足，無法試算傳承。</p>');
    const H = HEAD, tax = X.est.tax, liq = H.liquid || 0;
    const maxBar = Math.max(tax, liq + X.insToHeirs, 1);
    const status = tax === 0 ? 'none' : liq >= tax ? 'ok' : liq + X.insToHeirs >= tax ? 'ins' : 'gap';
    const nameOf = (id) => (X.heirs.find((h) => h.id === id) || {}).name || '';
    const insOf = (id) => (X.ins.people.find((p) => p.name === nameOf(id)) || { amount: 0 }).amount;
    return page('LEGACY', '傳承', '遺產稅繳得出來嗎？財產會怎麼分？', `
      <h3>稅源</h3>
      <div class="fr-src">
        <div><span>遺產稅</span><div class="fr-bar"><i class="t" style="width:${tax / maxBar * 100}%"></i></div><b>${wan(tax)}</b></div>
        <div><span>可動用現金</span><div class="fr-bar"><i class="c" style="width:${liq / maxBar * 100}%"></i></div><b>${wan(liq)}</b></div>
        <div><span>身故保險金</span><div class="fr-bar"><i class="s" style="width:${X.insToHeirs / maxBar * 100}%"></i></div><b>${wan(X.insToHeirs)}</b></div>
      </div>
      <p class="fr-verdict ${status}">${{
        none: '目前不用繳遺產稅（扣除額已足夠）。',
        ok: `可動用現金足以繳遺產稅，繳完還剩 ${wan(liq - tax)}。`,
        ins: `現金不夠繳稅，差 ${wan(tax - liq)}，要靠受益人拿身故保險金先墊繳。保險金屬於受益人、不是遺產，請事先說清楚用途，或用保險金信託。`,
        gap: `現金加保險金仍不夠繳稅，<b>缺口 ${wan(tax - liq - X.insToHeirs)}</b>。繼承人可能得先借錢或賣不動產；建議增加壽險保額，或申請分期、實物抵繳。`,
      }[status]}</p>
      <p class="rp-note">遺產稅繳清（或核准分期、實物抵繳）後才能辦不動產繼承登記；銀行存款在完稅前通常會被凍結，實際可動用的現金可能更少。</p>
      <h3>法定繼承　<small>${esc(X.shares.orderLabel || '')}</small></h3>
      ${X.dist.rows.length ? (() => { const cp = (id) => (id === X.spouseId ? X.claimPaid : 0); const hasC = X.claimPaid > 0; return `<table class="rp-table"><thead><tr><th>繼承人</th><th>應繼分</th><th>特留分</th>${hasC ? '<th class="num">剩餘財產分配</th>' : ''}<th class="num">法定分得</th><th class="num">身故保險金</th><th class="num">合計</th></tr></thead><tbody>
        ${X.dist.rows.map((r) => `<tr><td><b>${esc(nameOf(r.id))}</b><div class="sub">${esc(r.why)}</div></td><td>${frac(r.share)}</td><td>${frac(r.reserve)}</td>${hasC ? `<td class="num">${cp(r.id) ? wan(cp(r.id)) : '—'}</td>` : ''}<td class="num">${wan(r.amount)}</td><td class="num">${wan(insOf(r.id))}</td><td class="num"><b>${wan(cp(r.id) + r.amount + insOf(r.id))}</b></td></tr>`).join('')}</tbody></table>
        <p class="rp-note">可分配遺產（市價）＝淨資產 − 遺產稅${hasC ? ' − 配偶剩餘財產分配' : ''}${X.ins.estateIn ? '＋沒有指定受益人的保險金' : ''}＝${wan(X.dist.rows.reduce((s, r) => s + r.amount, 0))}。想多照顧某人，可以用指定受益人的保險金，不受特留分限制。</p>`; })() : '<p class="rp-empty">家族名單裡找不到繼承人，請確認家族關係。</p>'}`);
  }

  function retireChart(sim, p) {
    const rows = sim.rows; if (!rows.length) return '';
    const Wd = 700, H = 170, L0 = 54, B = 22, T0 = 10;
    const vals = rows.map((r) => r.end / Math.pow(1 + p.infl / 100, r.age - rows[0].age));
    const max = Math.max(...vals, 0), min = Math.min(...vals, 0), span = max - min || 1;
    const x = (i) => L0 + (Wd - L0 - 10) * (rows.length === 1 ? 0 : i / (rows.length - 1));
    const y = (v) => T0 + (H - T0 - B) * (1 - (v - min) / span);
    const ri = rows.findIndex((r) => r.age === p.retireAge);
    return `<svg class="fr-chart" viewBox="0 0 ${Wd} ${H}" role="img" aria-label="可投資資產走勢">
      ${[max, min].map((v) => `<text x="${L0 - 6}" y="${y(v) + 4}" text-anchor="end">${wan(v)}</text><line x1="${L0}" x2="${Wd - 10}" y1="${y(v)}" y2="${y(v)}" class="g"/>`).join('')}
      ${min < 0 ? `<line x1="${L0}" x2="${Wd - 10}" y1="${y(0)}" y2="${y(0)}" class="z"/>` : ''}
      ${ri > 0 ? `<line x1="${x(ri)}" x2="${x(ri)}" y1="${T0}" y2="${H - B}" class="r"/><text x="${x(ri) + 4}" y="${T0 + 10}">${p.retireAge} 歲退休</text>` : ''}
      <polyline points="${vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}" class="ln"/>
      ${rows.filter((r, i) => i % 10 === 0 || i === rows.length - 1).map((r) => `<text x="${x(rows.indexOf(r))}" y="${H - 5}" text-anchor="middle">${r.age}</text>`).join('')}</svg>`;
  }

  function retirePage() {
    const R = X.retire;
    if (!R) return page('RETIREMENT', '退休', '', `<p class="rp-empty">${HEAD ? `${esc(HEAD.p.name)} 還沒有收支或資產資料，無法試算退休。` : '請先選擇規劃對象。'}</p>`);
    const { p, sim } = R, f = (a) => Math.pow(1 + p.infl / 100, a - p.age), ok = sim.depleted == null;
    return page('RETIREMENT', '退休', `${esc(HEAD.p.name)} 的退休金夠不夠用（金額換算成今天的幣值）。`, `
      <div class="rp-sum">${kpi(`${p.retireAge} 歲退休時資產`, sim.atRetire == null ? '—' : wan(sim.atRetire / f(p.retireAge)))}${kpi('資產可以撐到', ok ? `${p.lifeAge} 歲以後` : `${sim.depleted - 1} 歲`, '', ok ? '' : 'em')}${kpi('退休前每月需加存', R.extra == null ? '—' : R.extra === 0 ? '不用' : wan(R.extra))}${kpi(`${p.lifeAge} 歲時剩下`, wan(sim.finalReal))}</div>
      ${retireChart(sim, p)}
      <p class="fr-verdict ${ok ? 'ok' : 'gap'}">${ok ? `依目前假設，資產可以支應到 ${p.lifeAge} 歲，最後還剩約 ${wan(sim.finalReal)}，可以納入傳承規劃。` : `資產會在 <b>${sim.depleted} 歲</b>那年不夠用。${R.extra ? `從現在到退休每月多存 <b>${wan(R.extra)}</b> 可以補足；` : ''}也可以延後退休、降低退休後支出，或用年金險建立終身現金流。`}</p>
      <table class="rp-table fr-est"><tbody>
        <tr><td>目前年齡／退休年齡／規劃到</td><td class="num">${p.age}／${p.retireAge}／${p.lifeAge} 歲</td></tr>
        <tr><td>可投資資產（不含不動產）</td><td class="num">${wan(p.assets)}</td></tr>
        <tr><td>每月收入／支出</td><td class="num">${wan(p.monthlyIncome)}／${wan(p.monthlyExpense)}</td></tr>
        <tr><td>退休後支出比例</td><td class="num">${Math.round(p.retireRatio * 100)}%</td></tr>
        <tr><td>退休金（每月）</td><td class="num">${wan(p.pension)}</td></tr>
        <tr><td>投資報酬率／通膨</td><td class="num">${p.ret}%／${p.infl}%</td></tr></tbody></table>
      ${p.otherIncome.length ? `<p class="rp-note">另有被動收入（租金、股息等）每月 ${wan(p.otherIncome.reduce((s, o) => s + o.monthly, 0))}，退休後繼續計入。</p>` : ''}
      <p class="rp-note">${R.saved ? '採用「退休規劃」頁儲存的設定。' : `尚未在「退休規劃」頁儲存設定，以資產負債自動估算（${p.age >= 65 ? '已退休' : '65 歲退休'}、規劃到 ${p.lifeAge} 歲、報酬 3%、通膨 2%；不含不動產與公司股權）。`}</p>`);
  }

  function endPage() {
    const acts = X.actions;
    return page('ACTION PLAN', '結論與待辦', '依優先順序排列；確認後請簽名，作為下一次檢視的依據。', `
      ${acts.length ? `<ol class="fr-acts">${acts.map((a) => `<li class="${a.lv}">${dot(a.lv)}<div>${a.text}</div><span class="fr-check">□ 已完成</span></li>`).join('')}</ol>` : '<p class="rp-empty">目前沒有待辦事項。</p>'}
      <h3>補充說明</h3><div class="notes-lines">${'<i></i>'.repeat(5)}</div>
      <div class="fr-sign"><div><span>客戶簽名</span></div><div><span>服務業務員</span><b>${esc(AGENT ? AGENT.name : '')}</b></div><div><span>日期</span></div></div>
      <p class="rp-note">下次檢視建議：一年後，或家庭成員、資產、稅法有重大變動時。</p>`, { key: 'end' });
  }

  function appendix() {
    const list = M.filter((m) => m.client && m.hasFin).flatMap((m) => m.bs.assetRows.map((r) => ({ who: m.p.name, r, cat: (m.fin.assets.find((a) => a.id === r.id) || {}).category })));
    const liabs = M.filter((m) => m.client && m.hasFin).flatMap((m) => m.bs.liabRows.map((r) => ({ who: m.p.name, r })));
    if (!list.length && !liabs.length) return '';
    return page('APPENDIX', '附錄：資產負債明細', '', `
      <table class="rp-table"><thead><tr><th>持有人</th><th>類別</th><th>名稱</th><th class="num">台幣價值</th><th>備註</th></tr></thead><tbody>
      ${list.map((x) => `<tr><td>${esc(x.who)}</td><td>${CATS[x.cat] || ''}</td><td>${esc(x.r.name)}<div class="sub">${esc(x.r.institution || '')}</div></td><td class="num">${x.r.base != null ? wan(num(x.r.base)) : '—'}</td><td class="sub">${x.r.counted ? '' : '未計入'}</td></tr>`).join('')}</tbody></table>
      ${liabs.length ? `<h3>負債</h3><table class="rp-table"><thead><tr><th>借款人</th><th>名稱</th><th class="num">台幣餘額</th></tr></thead><tbody>${liabs.map((x) => `<tr><td>${esc(x.who)}</td><td>${esc(x.r.name)}<div class="sub">${esc(x.r.institution || '')}</div></td><td class="num">${x.r.base != null ? wan(num(x.r.base)) : '—'}</td></tr>`).join('')}</tbody></table>` : ''}`, { flow: 0 });
  }

  // ---------------- 排版（同健診報告：固定 A4，放不下就縮小或分頁）----------------
  const MIN_ZOOM = 0.62;
  const overflow = (pg) => pg.querySelector('.pg-fit').getBoundingClientRect().height > pg.querySelector('.pg-body').getBoundingClientRect().height + 0.5;
  function shrinkToFit(pg) { const f = pg.querySelector('.pg-fit'); let z = 1; f.style.zoom = ''; while (overflow(pg) && z > MIN_ZOOM) { z = Math.round((z - 0.02) * 100) / 100; f.style.zoom = String(z); } }
  function contPage(first) { const pg = first.cloneNode(true); pg.removeAttribute('data-flow'); pg.querySelector('.pg-need')?.remove(); const h = pg.querySelector('.pg-title h2'); if (h) h.textContent += '（續）'; pg.querySelector('.pg-fit').innerHTML = ''; return pg; }
  function paginate(first, zoom) {
    const items = [...first.querySelector('.pg-fit').children];
    const pages = [first];
    let pg = first, fit = pg.querySelector('.pg-fit');
    fit.innerHTML = ''; fit.style.zoom = zoom === 1 ? '' : String(zoom);
    while (items.length) {
      const it = items.shift();
      fit.appendChild(it);
      if (!overflow(pg) || fit.children.length === 1) continue;
      it.remove();
      pg = contPage(first); fit = pg.querySelector('.pg-fit'); fit.style.zoom = zoom === 1 ? '' : String(zoom);
      pages[pages.length - 1].after(pg); pages.push(pg);
      items.unshift(it);
    }
    return pages;
  }
  function layout() {
    const root = document.documentElement, old = root.style.getPropertyValue('--rp-scale');
    root.style.setProperty('--rp-scale', '1');
    document.querySelectorAll('.page[data-fit]:not(.cover)').forEach(shrinkToFit);
    document.querySelectorAll('.page[data-flow]').forEach((first) => {
      const max = Number(first.dataset.flow) || 0;
      const original = [...first.querySelector('.pg-fit').children].map((n) => n.cloneNode(true));
      let z = 1, pages = paginate(first, z);
      while (max && pages.length > max && z > MIN_ZOOM) { pages.slice(1).forEach((p) => p.remove()); first.querySelector('.pg-fit').replaceChildren(...original.map((n) => n.cloneNode(true))); z = Math.round((z - 0.04) * 100) / 100; pages = paginate(first, z); }
      pages.forEach((p) => { if (overflow(p)) shrinkToFit(p); });
    });
    [...document.querySelectorAll('.rp-pages > .page')].forEach((p, i) => {
      const n = p.querySelector('.pg-num'); if (n) n.textContent = String(i + 1).padStart(2, '0');
      const f = p.querySelector('.pg-foot span:last-child'); if (f) f.textContent = i + 1;
    });
    if (old) root.style.setProperty('--rp-scale', old);
  }
  const fitScreen = () => document.documentElement.style.setProperty('--rp-scale', (Math.min(window.innerWidth - 16, 794) / 794).toFixed(4));

  // ---------- 待辦、簽名 ----------
  const plain = (h) => String(h).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const keyOf = (t) => { let h = 0; for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) | 0; return `report:${(h >>> 0).toString(36)}`; };
  async function addTasks(fid) {
    const btn = $('fr-tasks'); btn.disabled = true;
    try {
      const { data: have, error } = await sb.from('fo_tasks').select('source_key').eq('family_id', fid).eq('source', 'report');
      if (error) throw error;
      const seen = new Set((have || []).map((x) => x.source_key));
      const due = (d) => new Date(Date.now() + (8 * 3600 + d * 86400) * 1e3).toISOString().slice(0, 10);
      const rows = X.actions.map((a) => { const title = plain(a.text); return { family_id: fid, title: title.slice(0, 300), source: 'report', source_key: keyOf(title), priority: a.lv === 'r' ? 'high' : a.lv === 'y' ? 'mid' : 'low', due: due(a.lv === 'r' ? 14 : a.lv === 'y' ? 30 : 60) }; })
        .filter((r) => !seen.has(r.source_key));
      if (rows.length) { const { error: e2 } = await sb.from('fo_tasks').insert(rows); if (e2) throw e2; }
      btn.textContent = rows.length ? `✅ 已加入 ${rows.length} 項待辦` : '✅ 建議都已在待辦中';
    } catch (e) { alert(`加入待辦失敗：${e.message || e}`); btn.disabled = false; }
  }
  async function signReport(fid) {
    const url = await EastoneSign.pad({ title: '客戶簽名', note: '確認報告內容與待辦事項後，請在框內簽名' });
    if (!url) return;
    const end = document.querySelector('.page[data-key="end"]');
    const box = end && end.querySelector('.fr-sign > div');
    if (!box) return;
    box.querySelector('img')?.remove();
    box.insertAdjacentHTML('beforeend', `<img src="${url}" alt="客戶簽名" class="fr-sig-img">`);
    const dateBox = end.querySelectorAll('.fr-sign > div')[2];
    if (dateBox && !dateBox.querySelector('b')) dateBox.insertAdjacentHTML('beforeend', `<b>${EastoneSign.rocDate()}</b>`);
    if (!confirm('已簽名。要把簽名頁存進這個家族的文件保險箱嗎？')) return;
    try {
      const blob = await EastoneSign.snapshot(end);
      const d = today, path = `${fid}/report-signed-${Date.now()}.jpg`;
      const up = await sb.storage.from('fo-vault').upload(path, blob, { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
      const { error } = await sb.from('fo_documents').insert({ family_id: fid, kind: 'report', title: `家辦整合報告簽名頁 ${d}`, file_path: path, mime: 'image/jpeg', size: blob.size, signed: true, note: '客戶當面電子簽署' });
      if (error) { await sb.storage.from('fo-vault').remove([path]); throw error; }
      $('fr-sign').textContent = '✅ 已簽名並存檔';
    } catch (e) { alert(`存檔失敗：${e.message || e}`); }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await requireLogin('../');
    const fid = new URLSearchParams(location.search).get('f') || '';
    $('rp-back').href = `family.html?f=${encodeURIComponent(fid)}`;
    try {
      await load(fid);
      compute();
      pageNo = 0;
      $('rp-pages').innerHTML = [cover(), overview(), familyPage(), balancePage(), cashPage(), coverPage(), taxPage(), legacyPage(), retirePage(), endPage(), appendix()].join('');
      document.title = `${FAM.name}｜家辦整合報告`;
      await document.fonts.ready;
      layout(); fitScreen();
      window.addEventListener('resize', fitScreen);
      $('rp-print').disabled = false;
      $('rp-print').addEventListener('click', () => window.print());
      $('fr-tasks').disabled = !X.actions.length;
      $('fr-tasks').addEventListener('click', () => addTasks(fid));
      $('fr-sign').disabled = false;
      $('fr-sign').addEventListener('click', () => signReport(fid));
      window.__FR = { X, M, PLAN };
    } catch (e) {
      console.error(e);
      $('rp-pages').innerHTML = `<p class="rp-loading">報告產生失敗：${esc(e.message || e)}</p>`;
    }
  });
})();
