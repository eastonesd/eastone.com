// 資產負債計算核心測試（全部使用虛構資料）
// 執行：node --test tools/finance-calc.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../clients/finance-calc.js');

const N = (x) => C.toNum(x);
const W = 10000; // 萬
const asset = (id, extra = {}) => ({ id, name: id, category: 'other', currency: 'TWD', include_in_total: true, status: 'active', purpose: 'none', restriction: 'none', share_pct: 100, ...extra });
const val = (asset_id, value, extra = {}) => ({ asset_id, as_of: '2026-11-01', value, is_manual: true, value_basis: 'market', ...extra });
const liab = (id, extra = {}) => ({ id, name: id, category: 'other', currency: 'TWD', status: 'active', ...extra });
const bal = (liability_id, principal, extra = {}) => ({ liability_id, as_of: '2026-11-01', principal, accrued_interest: 0, ...extra });
const run = (input) => C.compute({ asOf: '2026-11-15', fx: [], ...input });

test('01 房屋 1000 萬、房貸 600 萬 → 淨值 400 萬', () => {
  const r = run({ assets: [asset('house', { category: 'house' })], assetValues: [val('house', 1000 * W)],
    liabilities: [liab('m', { category: 'mortgage' })], liabilityBalances: [bal('m', 600 * W)] });
  assert.equal(N(r.bs.assetsTotal), 1000 * W);
  assert.equal(N(r.bs.liabTotal), 600 * W);
  assert.equal(N(r.bs.net), 400 * W);
  assert.equal(r.bs.complete, true);
});

test('02 基金 A 100 萬質借 60 萬買基金 B → 資產 160、負債 60、淨值 100，沒有虛構現金', () => {
  const r = run({ assets: [asset('A', { category: 'fund' }), asset('B', { category: 'fund' })],
    assetValues: [val('A', 100 * W), val('B', 60 * W)],
    liabilities: [liab('L')], liabilityBalances: [bal('L', 60 * W)],
    collateralLinks: [{ liability_id: 'L', asset_id: 'A' }], fundingLinks: [{ liability_id: 'L', asset_id: 'B', amount: 60 * W }] });
  assert.equal(N(r.bs.assetsTotal), 160 * W);
  assert.equal(N(r.bs.liabTotal), 60 * W);
  assert.equal(N(r.bs.net), 100 * W);
  assert.equal(r.bs.assetRows.length, 2);
});

test('03 兩個擔保品對一筆 60 萬借款 → 負債只列一次，可動用只扣一次', () => {
  const r = run({ assets: [asset('A', { purpose: 'hot', restriction: 'pledged', exit_cost: 0 }), asset('B', { purpose: 'hot', restriction: 'pledged', exit_cost: 0 })],
    assetValues: [val('A', 100 * W), val('B', 50 * W)], liabilities: [liab('L')], liabilityBalances: [bal('L', 60 * W)],
    collateralLinks: [{ liability_id: 'L', asset_id: 'A' }, { liability_id: 'L', asset_id: 'B' }] });
  assert.equal(N(r.bs.liabTotal), 60 * W);
  assert.equal(N(r.av.confirmed), 90 * W);
});

test('04 保單扣貸前 100 萬、貸款 30 萬 → 淨值 70 萬', () => {
  const r = run({ assets: [asset('P', { category: 'savings_policy' })], assetValues: [val('P', 100 * W, { value_basis: 'gross' })],
    liabilities: [liab('PL', { category: 'policy_loan' })], liabilityBalances: [bal('PL', 30 * W)] });
  assert.equal(N(r.bs.net), 70 * W);
});

test('05 只有扣貸後淨額 70 萬＋貸款 30 萬 → 不會算成 40 萬；未核對時標待核對', () => {
  const base = { assets: [asset('P', { category: 'savings_policy' })], liabilities: [liab('PL')], liabilityBalances: [bal('PL', 30 * W)] };
  const un = run({ ...base, assetValues: [val('P', 70 * W, { value_basis: 'net_of_loan' })] });
  assert.notEqual(N(un.bs.net), 40 * W);
  assert.equal(un.bs.missing.netUnreconciled.length, 1);
  assert.equal(un.bs.complete, false);
  const ok = run({ ...base, assetValues: [val('P', 70 * W, { value_basis: 'net_of_loan', loan_deducted: 30 * W, loan_reconciled: true })] });
  assert.equal(N(ok.bs.assetsTotal), 100 * W);
  assert.equal(N(ok.bs.net), 70 * W);
});

test('06 投資型保單與底層基金都有明細 → 以基金加總、不重複', () => {
  const r = run({ assets: [asset('IP', { category: 'investment_policy' }), asset('F1', { parent_id: 'IP' }), asset('F2', { parent_id: 'IP' })],
    assetValues: [val('IP', 200 * W), val('F1', 120 * W), val('F2', 80 * W)] });
  assert.equal(N(r.bs.assetsTotal), 200 * W);
  assert.equal(r.bs.assetRows.find((x) => x.id === 'IP').status, 'funds_sum');
});

test('07 USD 10,000、1 USD = 32 → 320,000，原幣保留', () => {
  const r = run({ assets: [asset('S', { currency: 'USD' })], assetValues: [val('S', 10000)], fx: [{ currency: 'USD', quote_date: '2026-11-10', rate: 32 }] });
  assert.equal(N(r.bs.assetsTotal), 320000);
  assert.equal(N(r.bs.assetRows[0].original), 10000);
  assert.equal(N(r.bs.byCcy.USD.assets), 10000);
});

test('08 缺 USD 匯率 → 不填 0 或 1，台幣總額標不完整', () => {
  const r = run({ assets: [asset('S', { currency: 'USD' }), asset('T')], assetValues: [val('S', 10000), val('T', 5000)] });
  assert.equal(N(r.bs.assetsTotal), 5000);
  assert.equal(r.bs.missing.assetNoFx.length, 1);
  assert.equal(r.bs.complete, false);
  assert.equal(r.bs.assetRows[0].base, null);
});

test('10 基準日之後的估值與匯率不能回填', () => {
  const r = C.compute({ asOf: '2026-10-01', assets: [asset('S', { currency: 'USD' })],
    assetValues: [val('S', 10000, { as_of: '2026-11-01' })], fx: [{ currency: 'USD', quote_date: '2026-11-01', rate: 32 }] });
  assert.equal(r.bs.missing.unvalued.length, 1);
});

test('11 分配款 1 萬來源未知 → 列收款，但標未確認收益', () => {
  const r = run({ cashEvents: [{ id: 'e', event_date: '2026-11-05', kind: 'fund_dist', direction: 'in', amount: 10000, currency: 'TWD', nature: 'unknown' }] });
  assert.equal(N(r.cf.income), 10000);
  assert.equal(N(r.cf.unknownDist), 10000);
});

test('12 借款撥入與還本 → 融資流量，不是收入或利息', () => {
  const r = run({ cashEvents: [
    { id: 'a', event_date: '2026-11-02', kind: 'loan_draw', direction: 'in', amount: 500000, currency: 'TWD' },
    { id: 'b', event_date: '2026-11-03', kind: 'loan_repay', direction: 'out', amount: 100000, currency: 'TWD' }] });
  assert.equal(N(r.cf.income), 0);
  assert.equal(N(r.cf.interest), 0);
  assert.equal(N(r.cf.finIn), 500000);
  assert.equal(N(r.cf.finOut), 100000);
});

test('13 每月繳 2 萬（本金 1.5 萬＋利息 0.5 萬）→ 拆分正確', () => {
  const r = run({ cashEvents: [{ id: 'p', event_date: '2026-11-10', kind: 'loan_payment', direction: 'out', amount: 20000, principal_part: 15000, interest_part: 5000, currency: 'TWD' }] });
  assert.equal(N(r.cf.finOut), 15000);
  assert.equal(N(r.cf.interest), 5000);
  assert.equal(N(r.cf.expense), 5000);
  assert.equal(N(r.cf.netChange), -20000);
});

test('14 自有帳戶轉帳／換匯兩腿 → 不增加收入，手續費獨立', () => {
  const r = run({ fx: [{ currency: 'USD', quote_date: '2026-11-01', rate: 32 }], cashEvents: [
    { id: 'o', event_date: '2026-11-05', kind: 'fx_exchange', direction: 'out', amount: 320000, currency: 'TWD', transfer_pair: 'X1' },
    { id: 'i', event_date: '2026-11-05', kind: 'fx_exchange', direction: 'in', amount: 10000, amount_twd: 320000, currency: 'USD', transfer_pair: 'X1' },
    { id: 'f', event_date: '2026-11-05', kind: 'fee', direction: 'out', amount: 100, currency: 'TWD' }] });
  assert.equal(N(r.cf.income), 0);
  assert.equal(N(r.cf.expense), 100);
  assert.equal(r.cf.unpairedTransfers.length, 0);
  assert.equal(N(r.cf.netChange), -100);
});

test('15 股票設熱錢但已質押 → 用途保留，不全額算可動用', () => {
  const r = run({ assets: [asset('S', { category: 'stock', purpose: 'hot', restriction: 'pledged' })], assetValues: [val('S', 100 * W)],
    liabilities: [liab('L')], liabilityBalances: [bal('L', 40 * W)], collateralLinks: [{ liability_id: 'L', asset_id: 'S' }] });
  assert.equal(r.bs.assetRows[0].purpose, 'hot');
  assert.ok(N(r.av.confirmed) < 100 * W);
  assert.equal(N(r.av.hotRestricted), 100 * W);
});

test('16 MCN 只有投入本金、沒有估值 → 不以成本當現值，列未納入估值', () => {
  const r = run({ assets: [asset('M', { category: 'mcn', cost: 300 * W })] });
  assert.equal(N(r.bs.assetsTotal), 0);
  assert.equal(r.bs.missing.unvalued.length, 1);
  assert.ok(r.bs.assetRows[0].flags.includes('商品結構待確認'));
});

test('17 MCN 文件未齊但有手動參考價值 → 計入，保留文件缺漏', () => {
  const r = run({ assets: [asset('M', { category: 'mcn', cost: 300 * W })], assetValues: [val('M', 280 * W, { source: '銀行對帳單' })] });
  assert.equal(N(r.bs.assetsTotal), 280 * W);
  assert.ok(r.bs.assetRows[0].flags.includes('商品結構待確認'));
});

test('18 快照序列化後數字不變', () => {
  const r = run({ assets: [asset('A')], assetValues: [val('A', '1234567.8912345678')] });
  const back = C.revive(C.serialize(r));
  assert.equal(back.bs.assetsTotal, r.bs.assetsTotal);
});

test('20 null 與 0 區分；未填幣別不計算', () => {
  const r = run({ assets: [asset('Z'), asset('U'), asset('X', { currency: '' })], assetValues: [val('Z', 0), val('U', null), val('X', 100)] });
  const z = r.bs.assetRows.find((x) => x.id === 'Z'), u = r.bs.assetRows.find((x) => x.id === 'U'), x = r.bs.assetRows.find((y) => y.id === 'X');
  assert.equal(z.status, 'ok');
  assert.equal(u.status, 'unvalued');
  assert.equal(x.status, 'no_currency');
});

test('21 同一天手動覆寫優先於自動值', () => {
  const r = run({ assets: [asset('S')], assetValues: [val('S', 100, { is_manual: false }), val('S', 90, { is_manual: true, override_reason: '除權息' })] });
  assert.equal(N(r.bs.assetsTotal), 90);
});

test('22 已入帳的排程期數不再列為待收', () => {
  const r = C.compute({ asOf: '2026-11-01', upcomingTo: '2027-01-31', fx: [],
    cashSchedules: [{ id: 's', kind: 'rent', direction: 'in', amount: 30000, currency: 'TWD', start_date: '2026-11-05', frequency: 'monthly' }],
    cashEvents: [{ id: 'e', event_date: '2026-11-06', kind: 'rent', direction: 'in', amount: 30000, currency: 'TWD', schedule_id: 's' }] });
  assert.deepEqual(r.upcoming.map((x) => x.date), ['2026-12-05', '2027-01-05']);
});

test('持分只換算一次', () => {
  const r = run({ assets: [asset('H', { category: 'house', share_pct: 50 })], assetValues: [val('H', 2000 * W)] });
  assert.equal(N(r.bs.assetsTotal), 1000 * W);
});

test('定點小數：0.1 + 0.2 = 0.3', () => {
  assert.equal(C.add(C.D('0.1'), C.D('0.2')), C.D('0.3'));
  assert.equal(N(C.mul(C.D('10000'), C.D('32.85'))), 328500);
});

test('每三週一次的排程（回診 6 萬、兩家理賠）依 21 天展開', () => {
  const r = C.compute({ asOf: '2026-11-20', upcomingTo: '2027-01-31', fx: [],
    cashSchedules: [
      { id: 'v', kind: 'medical', direction: 'out', amount: 60000, currency: 'TWD', start_date: '2026-11-25', frequency: 'triweekly' },
      { id: 'a', kind: 'insurance_claim', direction: 'in', amount: 29700, currency: 'TWD', start_date: '2026-11-25', frequency: 'triweekly' },
      { id: 'b', kind: 'insurance_claim', direction: 'in', amount: 12500, currency: 'TWD', start_date: '2026-11-25', frequency: 'triweekly' }] });
  assert.deepEqual([...new Set(r.upcoming.map((x) => x.date))], ['2026-11-25', '2026-12-16', '2027-01-06', '2027-01-27']);
  assert.equal(r.upcoming.length, 12);
});

test('投資型保單連結基金：一律改算基金、保單不重複', () => {
  const kids = [asset('F1', { parent_id: 'IP', currency: 'USD' }), asset('F2', { parent_id: 'IP' })];
  const vals = [val('IP', 300 * W), val('F1', 5000), val('F2', 100 * W)];
  const fx = [{ currency: 'USD', quote_date: '2026-11-01', rate: 32 }];
  const a = run({ fx, assets: [asset('IP', { category: 'investment_policy' })], assetValues: vals.slice(0, 1) });
  assert.equal(N(a.bs.assetsTotal), 300 * W);
  const b = run({ fx, assets: [asset('IP', { category: 'investment_policy' }), ...kids], assetValues: vals });
  assert.equal(N(b.bs.assetsTotal), 16 * W + 100 * W);
  const ip = b.bs.assetRows.find((r) => r.id === 'IP');
  assert.equal(ip.status, 'funds_sum');
  assert.equal(N(ip.fundsTotal), 116 * W);
});
