const test = require('node:test');
const assert = require('node:assert');
const I = require('../clients/invest-calc.js');

const fx = [{ currency: 'USD', quote_date: '2026-11-20', rate: 30, basis: 'mid', source: 't' }];
const A = [
  { id: 'f1', category: 'fund', name: 'AU32', identifier: 'F-X', quantity: 1000, cost: 10, currency: 'USD', include_in_total: true, status: 'active', meta: { class: 'P2', fund_name: '平衡基金' } },
  { id: 'f2', category: 'fund', name: 'AU32', identifier: 'F-X', quantity: 1000, cost: 12, currency: 'USD', include_in_total: true, status: 'active', meta: { class: 'P2', fund_name: '平衡基金' } },
  { id: 's1', category: 'stock', name: '股票', identifier: 'NVDA', market: 'US', quantity: 10, cost: 100, currency: 'USD', include_in_total: true, status: 'active', meta: {} },
  { id: 'd1', category: 'deposit', name: '定存', currency: 'TWD', include_in_total: true, status: 'active', meta: {} },
  { id: 'h1', category: 'house', name: '自宅', currency: 'TWD', include_in_total: true, status: 'active', meta: {} },
];
const V = [
  { asset_id: 'f1', as_of: '2026-11-01', value: 10000 }, { asset_id: 'f1', as_of: '2026-11-20', value: 11000 },
  { asset_id: 'f2', as_of: '2026-11-20', value: 11000 },
  { asset_id: 's1', as_of: '2026-11-20', value: 2000 },
  { asset_id: 'd1', as_of: '2026-11-01', value: 300000 },
  { asset_id: 'h1', as_of: '2026-11-01', value: 9000000 },
];
const input = { assets: A, assetValues: V, liabilities: [], liabilityBalances: [], cashEvents: [], cashSchedules: [], collateralLinks: [], fundingLinks: [], fx, asOf: '2026-11-27' };

test('同標的合併、台幣市值、成本與損益、不含不動產', () => {
  const h = I.holdings(input);
  assert.equal(h.list.length, 3);
  const f = h.list.find((g) => g.identifier === 'F-X');
  assert.equal(f.lots, 2); assert.equal(f.value, 660000); assert.equal(f.cost, 660000); assert.equal(f.pnl, 0);
  const s = h.list.find((g) => g.identifier === 'NVDA');
  assert.equal(s.value, 60000); assert.equal(s.cost, 30000); assert.equal(s.pnlPct, 1);
  assert.equal(h.total, 1020000);
});
test('配置與偏離、適合度、集中度', () => {
  const h = I.holdings(input);
  const al = I.allocation(h, I.PROFILES.conservative.targets);
  const eq = al.find((x) => x.k === 'equity');
  assert.ok(Math.abs(eq.weight - 60000 / 1020000) < 1e-9);
  const al2 = I.alerts(h, al, { profile: 'conservative', today: '2026-11-27' });
  assert.ok(al2.some((x) => x.k === 'rr' && /NVDA/.test(x.text)));      // 股票 RR5 > 保守 RR2
  assert.ok(al2.some((x) => x.k === 'conc' && /平衡基金/.test(x.text)));  // 64.7% 集中
  assert.ok(!al2.some((x) => x.k === 'drift'));                          // 保守型：差距都在 5% 內
  assert.ok(!al2.some((x) => x.k === 'cost'));                           // 定存不算缺成本
  const al3 = I.alerts(h, I.allocation(h, I.PROFILES.aggressive.targets), { profile: 'aggressive', today: '2026-11-27' });
  assert.ok(al3.some((x) => x.k === 'drift' && x.items.some((t) => /股票/.test(t))));    // 積極型股票目標 70%，實際 6%
  assert.ok(!al3.some((x) => x.k === 'rr'));
});
test('走勢：依日期還原總值', () => {
  const s = I.history(input);
  assert.deepStrictEqual(s.map((p) => p.date), ['2026-11-01', '2026-11-20']);
  assert.equal(s[0].value, 10000 * 30); // 11/01 早於最早匯率：用最早匯率；走勢不含存款
  assert.equal(s[1].value, 720000);
});
test('RR 與配置桶', () => {
  assert.equal(I.rrOf({ meta: { class: 'P4' } }), 4);
  assert.equal(I.bucketOf({ category: 'fund', meta: { class: 'P5' } }), 'equity');
  assert.equal(I.bucketOf({ category: 'fund', meta: { class: 'P2' } }), 'income');
});
test('結構型商品：cost 是投入總額，不乘數量', () => {
  const inp = { assets: [{ id: 'm1', category: 'mcn', name: 'DSNT', currency: 'USD', quantity: 10, cost: 100000, include_in_total: true, status: 'active', meta: {} }],
    assetValues: [{ asset_id: 'm1', as_of: '2026-11-19', value: 92890 }], liabilities: [], liabilityBalances: [], cashEvents: [], cashSchedules: [], collateralLinks: [], fundingLinks: [],
    fx: [{ currency: 'USD', quote_date: '2026-11-01', rate: 30 }], asOf: '2026-11-27' };
  const g = I.holdings(inp).list[0];
  assert.equal(g.cost, 3000000); assert.ok(Math.abs(g.pnlPct - (-0.0711)) < 1e-3);
});
test('台幣申購成本（meta.cost_twd）優先', () => {
  const inp = { assets: [{ id: 'f9', category: 'fund', name: 'X', identifier: 'F-X', currency: 'USD', quantity: 1000, cost: 9.34, include_in_total: true, status: 'active', meta: { cost_twd: 330000 } }],
    assetValues: [{ asset_id: 'f9', as_of: '2026-11-20', value: 9000 }], liabilities: [], liabilityBalances: [], cashEvents: [], cashSchedules: [], collateralLinks: [], fundingLinks: [],
    fx: [{ currency: 'USD', quote_date: '2026-11-01', rate: 32 }], asOf: '2026-11-27' };
  const g = I.holdings(inp).list[0];
  assert.equal(g.cost, 330000); assert.equal(g.value, 288000);
});
test('FCN 狀態：分割換算、最差標的、下一次觀察、距離履約價', () => {
  const fcn = { notional: 100000, coupon: 0.1, strike_pct: 0.6824, final: '2027-09-03',
    underlyings: [{ sym: 'AVGO', initial: 361.6, strike: 246.7558, adj: 1 }, { sym: 'SOXX', initial: 525.38, strike: 358.5193, adj: 3 }],
    schedule: [{ n: 2, obs: '2026-11-03', pay: '2026-11-05', ko: 1 }, { n: 3, obs: '2026-12-03', pay: '2026-12-07', ko: 0.97 }] };
  const r = I.fcnStatus(fcn, { AVGO: 300.86, SOXX: 127.98 }, '2026-11-28');
  assert.equal(r.worst.sym, 'SOXX');
  assert.ok(Math.abs(r.worst.perf - 0.7308) < 0.001);
  assert.equal(r.next.n, 3); assert.equal(r.verdict, 'near');
  assert.ok(Math.abs(r.monthly - 833.333) < 0.01);
  assert.ok(Math.abs(r.worst.strikePx - 119.506) < 0.01);
  assert.equal(I.fcnStatus(fcn, { AVGO: 300, SOXX: 100 }, '2026-11-28').verdict, 'below');
});
