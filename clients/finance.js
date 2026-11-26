// ============================================================
// 資產負債與現金流（人壽管理 → 💼 資產負債）
// 資料表 fin_*（RLS：每位業務員只讀寫自己客戶）；計算一律交給 finance-calc.js
// 財務資料只放在記憶體，不寫入 localStorage；登出時 auth.js 會直接跳回登入頁
// ============================================================
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const C = FinCalc;
const todayIso = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

const CATS = {
  house: '房屋（含基地）', land: '土地', savings_policy: '儲蓄險', investment_policy: '投資型保單／年金', fund: '基金', stock: '股票／ETF',
  deposit: '定存', cash: '活存／現金', mcn: 'FCN 結構型商品', equity: '公司股權／未上市', vehicle: '車輛', other: '其他',
};
const VERIFY = { estimate: '估計', doc: '已補文件', verified: '已核實' };
const RE_CATS = ['house', 'land'];
const LIAB_CATS = { mortgage: '房貸', policy_loan: '保單貸款', securities_loan: '基金／股票質借', other: '其他借款' };
const PURPOSE = { hot: '熱錢', cold: '冷錢', none: '未分類' };
const RESTRICT = { none: '未設限', pledged: '質押', locked: '鎖定', repay: '需還款解押', unknown: '待確認' };
const BASIS = { market: '市價', gross: '扣貸前價值', net_of_loan: '扣貸後淨額', manual: '手動估值', statement: '對帳單', appraisal: '估價文件' };
const CCYS = ['TWD', 'USD', 'JPY', 'CNY', 'VND', 'EUR', 'AUD', 'HKD', 'GBP', 'SGD', 'CAD', 'CHF', 'NZD', 'ZAR'];
const CCY_NAMES = { TWD: '台幣', USD: '美元', JPY: '日圓', CNY: '人民幣', VND: '越南盾', EUR: '歐元', AUD: '澳幣', HKD: '港幣', GBP: '英鎊', SGD: '新加坡幣', CAD: '加幣', CHF: '瑞士法郎', NZD: '紐幣', ZAR: '南非幣' };
const FREQ = { once: '一次', weekly: '每週', biweekly: '每兩週', triweekly: '每三週', fourweekly: '每四週', monthly: '每月', quarterly: '每季', semiannual: '每半年', annual: '每年' };
const STATUS_TEXT = { ok: '', unvalued: '未估值', funds_sum: '', no_fx: '缺匯率', no_currency: '缺幣別', net_unreconciled: '待核對', display_only: '僅展示', no_balance: '未填餘額' };

let clients = [];
let client = null;      // 目前客戶
let data = null;        // 目前客戶的所有 fin_* 資料
let fx = [];
let result = null;
let section = 'overview';

// ---------- 格式 ----------
function fmt(big, ccy = 'TWD') {
  if (big === null || big === undefined) return '—';
  const n = C.toNum(big);
  const dp = ['TWD', 'JPY'].includes(ccy) ? 0 : 2;
  return n.toLocaleString('zh-TW', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
const fmtRaw = (x, ccy) => (x === null || x === undefined || x === '' ? '—' : fmt(C.D(x), ccy));
const wan = (big) => (big === null ? '—' : (C.toNum(big) / 10000).toLocaleString('zh-TW', { maximumFractionDigits: 1 }) + ' 萬');
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
function setStatus(msg) { $('fin-status').textContent = msg || ''; }

// ---------- 資料存取 ----------
const TABLES = {
  assets: 'fin_assets', assetValues: 'fin_asset_values', liabilities: 'fin_liabilities', liabilityBalances: 'fin_liability_balances',
  collateralLinks: 'fin_collateral_links', fundingLinks: 'fin_funding_links', cashEvents: 'fin_cash_events',
  cashSchedules: 'fin_cash_schedules', snapshots: 'fin_snapshots', documents: 'fin_documents',
};
async function loadClientData(id) {
  const entries = await Promise.all(Object.entries(TABLES).map(async ([k, t]) => {
    let q = sb.from(t).select(k === 'snapshots' ? 'id,as_of,period_from,period_to,title,rules_version,created_at,result->summary' : '*').eq('client_id', id);
    q = k === 'snapshots' ? q.order('created_at', { ascending: false }) : q.order('created_at');
    const { data: rows, error } = await q;
    if (error) throw new Error(`讀取 ${t} 失敗：${error.message}`);
    return [k, rows || []];
  }));
  return Object.fromEntries(entries);
}
async function loadFx() {
  const { data: rows, error } = await sb.from('fin_fx_quotes').select('*').order('quote_date', { ascending: false }).limit(2000);
  if (error) throw error;
  return rows || [];
}
async function save(table, row, id) {
  const payload = { ...row };
  const q = id ? sb.from(table).update(payload).eq('id', id) : sb.from(table).insert({ ...payload, client_id: client.id });
  const { error } = await q;
  if (error) throw new Error(error.message);
}
async function remove(table, id) {
  const { error } = await sb.from(table).delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ---------- 計算 ----------
function inputFor(asOf, from, to) {
  return { ...data, fx, asOf, periodFrom: from, periodTo: to };
}
function recompute() {
  const asOf = $('fin-asof').value || todayIso();
  result = C.compute(inputFor(asOf, $('fin-from').value, $('fin-to').value));
  render();
}

// ---------- 啟動 ----------
document.addEventListener('DOMContentLoaded', async () => {
  await requireLogin('../');
  const t = todayIso();
  $('fin-asof').value = t;
  $('fin-from').value = t.slice(0, 8) + '01';
  $('fin-to').value = t;
  try {
    [clients, fx] = await Promise.all([clientList(), loadFx()]);
  } catch (e) { setStatus('讀取失敗：' + (e.message || e)); return; }
  PICK_SOURCES['fin-client'] = (input) => {
    const kw = input.value.trim().toLowerCase();
    return [{ label: '客戶', layout: 'list', options: clients
      .filter((c) => !kw || `${c.name}${c.id}`.toLowerCase().includes(kw))
      .slice(0, 60).map((c) => ({ value: `${c.name}｜${c.id}`, label: c.name || c.id, sub: c.id })) }];
  };
  PICK_SOURCES['fin-fund'] = (input) => {
    if (!fundIndex) { loadFundIndex().then(() => input.dispatchEvent(new Event('input'))).catch(() => {}); return [{ label: '讀取東石診股基金清單中…', options: [] }]; }
    const kw = input.value.split('｜')[0].trim().toLowerCase();
    if (kw.length < 2) return [{ label: '請輸入至少 2 個字（名稱、ISIN 或代碼）', options: [] }];
    return [{ label: `東石診股基金清單（淨值更新 ${fundIndex.updated}）`, layout: 'list', options: fundIndex.funds
      .filter((f) => `${f.name}${f.isin}${f.id}${f.ticker}`.toLowerCase().includes(kw)).slice(0, 40)
      .map((f) => ({ value: `${f.id}｜${f.name}`, label: f.name, sub: `${f.currency}・${f.date} 淨值 ${f.nav}${f.isin ? '・' + f.isin : ''}` })) }];
  };
  $('fin-client').addEventListener('change', () => {
    const id = ($('fin-client').value.split('｜')[1] || '').trim();
    if (id) openClient(id);
  });
  ['fin-asof', 'fin-from', 'fin-to'].forEach((k) => $(k).addEventListener('change', () => data && recompute()));
  document.querySelectorAll('.fin-tab').forEach((b) => b.addEventListener('click', () => { section = b.dataset.sec; render(); }));
  $('fin-fx-btn').addEventListener('click', refreshFx);
  $('fin-fx-manual').addEventListener('click', manualFxForm);
  $('fin-quote-btn').addEventListener('click', () => refreshQuotes(false));
  $('fin-snap-btn').addEventListener('click', saveSnapshot);
  $('fin-modal-close').addEventListener('click', closeModal);
  $('fin-modal').addEventListener('click', (e) => { if (e.target.id === 'fin-modal') closeModal(); });
  const want = new URLSearchParams(location.search).get('id');
  if (want) openClient(want.toUpperCase());
  showFxStatus();
});

async function openClient(id) {
  const c = clients.find((x) => x.id === id);
  if (!c) { toast('查無此客戶'); return; }
  client = c;
  $('fin-client').value = `${c.name}｜${c.id}`;
  history.replaceState(null, '', `finance.html?id=${encodeURIComponent(id)}`);
  setStatus('讀取中…');
  try { data = await loadClientData(id); } catch (e) { setStatus(e.message); return; }
  $('fin-empty').hidden = true; $('fin-body').hidden = false;
  showFxStatus();
  recompute();
  // 打開客戶就自動向東石診股更新一次行情；台股交易時段每 5 分鐘再更新
  refreshQuotes(true);
  clearInterval(quoteTimer);
  quoteTimer = setInterval(() => {
    const t = new Date(Date.now() + 8 * 3600e3), d = t.getUTCDay(), hm = t.getUTCHours() * 100 + t.getUTCMinutes();
    if (d >= 1 && d <= 5 && hm >= 900 && hm <= 1335 && !document.hidden) refreshQuotes(true);
  }, 5 * 60e3);
}
async function reload() { showFxStatus(); if (!client) return; data = await loadClientData(client.id); recompute(); }

function showFxStatus() {
  const usd = fx.filter((q) => q.currency === 'USD' && !q.owner)[0];
  let token = ''; try { token = localStorage.getItem('eastone.finmindToken') || ''; } catch { /* 無痕模式 */ }
  setStatus((usd ? `匯率：${usd.source}，${usd.quote_date}（1 USD = ${Number(usd.rate)} TWD）` : '尚無自動匯率，請按「更新匯率」')
    + `｜行情：已連接東石診股${token ? '' : '（未設定 FinMind 金鑰，美股查詢次數較少）'}${lastQuoteAt ? `，${lastQuoteAt.toTimeString().slice(0, 5)} 更新` : ''}`);
}

// ---------- 自動資料 ----------
async function callFn(name, body) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}`, apikey: SUPABASE_KEY },
    body: JSON.stringify(body || {}),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.ok === false) throw new Error(out.error || `伺服器錯誤 ${res.status}`);
  return out;
}
// 手動匯率：臺灣銀行沒有即期報價的幣別（例如越南盾）或要用自己的匯率時
function manualFxForm() {
  openModal('手動輸入匯率', [
    { k: 'currency', label: '幣別', type: 'select', opts: CCYS.filter((c) => c !== 'TWD').map((c) => [c, `${c} ${CCY_NAMES[c]}`]), req: true },
    { k: 'quote_date', label: '匯率日期', type: 'date', req: true, def: todayIso() },
    { k: 'rate', label: '1 單位外幣 ＝ 多少台幣', type: 'number', req: true, hint: '例：1 USD ＝ 32.85；1 VND ＝ 0.00125' },
    { k: 'source', label: '來源', ph: '例：銀行牌告、對帳單', wide: true },
  ], {}, async (row) => {
    if (!(Number(row.rate) > 0)) throw new Error('匯率必須大於 0');
    const { error } = await sb.from('fin_fx_quotes').insert({ ...row, source: row.source || '手動輸入', basis: 'manual', is_manual: true });
    if (error) throw new Error(error.message);
    fx = await loadFx();
  });
}
async function refreshFx() {
  setStatus('更新匯率中…');
  try {
    const out = await callFn('fin-fx');
    fx = await loadFx();
    toast(out.cached ? '匯率 30 分鐘內已更新過，沿用現有資料' : `已更新 ${out.count} 種幣別匯率`);
  } catch (e) { toast('匯率更新失敗，繼續使用上一次的匯率：' + e.message); }
  showFxStatus();
  if (data) recompute();
}
// ---------- 行情：接東石診股的資料來源 ----------
// 基金：東石診股每天收集的投信投顧公會（境內）／集保結算所（境外）淨值 → data/funds/index.json
// 股票：FinMind（台股 TaiwanStockPrice、美股 USStockPrice 收盤價），沿用東石診股存在本機的 FinMind 金鑰
// 只送商品代號，不送客戶、數量或金額；失敗時保留原本估值
const STOCK_SITE = 'https://eastonesd.github.io/eastone.stock/';
const FINMIND = 'https://api.finmindtrade.com/api/v4/data';
let fundIndex = null;
let lastQuoteAt = null;
let quoteTimer = null;
async function loadFundIndex() {
  if (fundIndex) return fundIndex;
  const res = await fetch(STOCK_SITE + 'data/funds/index.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('東石診股基金資料讀取失敗');
  const j = await res.json();
  const cols = j.columns;
  fundIndex = { updated: j.updated, funds: j.funds.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]]))) };
  return fundIndex;
}
async function finmindClose(market, symbol) {
  const dataset = market === 'US' ? 'USStockPrice' : 'TaiwanStockPrice';
  const start = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const q = new URLSearchParams({ dataset, data_id: symbol, start_date: start });
  let token = ''; try { token = localStorage.getItem('eastone.finmindToken') || ''; } catch { /* 無痕模式 */ }
  if (token) q.set('token', token);
  const res = await fetch(`${FINMIND}?${q}`);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || (body.status && body.status !== 200)) throw new Error((body && body.msg) || `FinMind ${res.status}`);
  const rows = (body.data || []).filter((r) => Number(r.close ?? r.Close) > 0);
  if (!rows.length) throw new Error('查無收盤價（請確認代號）');
  const last = rows[rows.length - 1];
  return { price: Number(last.close ?? last.Close), date: last.date, currency: market === 'US' ? 'USD' : 'TWD', source: `FinMind ${market === 'US' ? '美股' : '台股'}收盤價（東石診股）` };
}
// silent：開啟客戶時自動更新，不跳提示、找不到報價也不打擾
async function refreshQuotes(silent = false) {
  if (silent !== true) silent = false;
  if (!data) { if (!silent) toast('請先選擇客戶'); return; }
  const live = data.assets.filter((a) => a.status !== 'archived' && a.identifier);
  const stocks = live.filter((a) => a.category === 'stock' && ['TWSE', 'TPEX', 'US'].includes(a.market));
  const funds = live.filter((a) => a.category === 'fund' && /^[TFI]-/.test(a.identifier));
  if (!stocks.length && !funds.length) { if (!silent) toast('沒有可自動更新的部位（股票需填市場與代號；基金需從東石診股清單選取）'); return; }
  setStatus('從東石診股更新行情中…');
  let saved = 0; const fails = [];
  const store = async (a, q) => {
    if (q.currency !== a.currency) { fails.push(`${a.name}：報價幣別 ${q.currency} 與資產幣別 ${a.currency} 不同，未更新`); return; }
    if (C.D(a.quantity) === null) {
      // 數量可能填在估值紀錄裡：取最近一筆有數量的估值補回資產
      const { data: qv } = await sb.from('fin_asset_values').select('quantity').eq('asset_id', a.id).not('quantity', 'is', null).order('as_of', { ascending: false }).limit(1);
      if (qv && qv.length) { a.quantity = qv[0].quantity; await sb.from('fin_assets').update({ quantity: a.quantity }).eq('id', a.id); }
      else { fails.push(`${a.name}：未填數量，無法計算市值`); return; }
    }
    const value = C.toNum(C.mul(C.D(a.quantity), C.D(q.price)));
    const row = { asset_id: a.id, as_of: q.date, quantity: a.quantity, price: q.price, value, value_basis: 'market', source: q.source, is_manual: false };
    // 同一天的自動估值只留一筆：盤中更新就覆蓋成最新價（人工覆寫的那筆不動）
    const same = data.assetValues.find((v) => v.asset_id === a.id && v.as_of === q.date && !v.is_manual);
    if (same && Number(same.price) === Number(q.price) && same.source === q.source) return;
    await save('fin_asset_values', row, same && same.id);
    saved++;
  };
  // 基金
  if (funds.length) {
    try {
      const idx = await loadFundIndex();
      for (const a of funds) {
        const f = idx.funds.find((x) => x.id === a.identifier);
        if (!f || !(f.nav > 0)) { fails.push(`${a.name}：東石診股查無這檔基金的淨值`); continue; }
        await store(a, { price: f.nav, date: f.date, currency: f.currency, source: `${f.kind === '境外' ? '集保結算所' : f.kind === '類全委' ? (f.insurer || '保險公司') + '投資帳戶' : '投信投顧公會'}最新公告淨值（東石診股）` });
      }
    } catch (e) { fails.push('基金：' + e.message); }
  }
  // 台股：先查證交所基本市況報價（盤中最新成交價），查不到再用 FinMind、最後用證交所／櫃買中心收盤價
  const tw = stocks.filter((a) => a.market !== 'US');
  const rt = new Map();
  if (tw.length) {
    try {
      const out = await callFn('fin-quotes', { realtime: true, items: [...new Map(tw.map((a) => [a.market + a.identifier.toUpperCase(), { market: a.market, symbol: a.identifier }])).values()] });
      out.results.filter((q) => q.ok).forEach((q) => rt.set(q.market + q.symbol, q));
    } catch { /* 改用 FinMind */ }
  }
  // 股票（同一代號只查一次）
  const cache = new Map();
  for (const a of stocks) {
    const mk = a.market === 'US' ? 'US' : 'TW';
    const key = mk + a.identifier.toUpperCase();
    const live = rt.get(a.market + a.identifier.toUpperCase());
    if (live) { await store(a, { price: live.price, date: live.date, currency: live.currency, source: live.source }); continue; }
    try {
      if (!cache.has(key)) cache.set(key, await finmindClose(mk, a.identifier.toUpperCase()));
      await store(a, cache.get(key));
    } catch (e) {
      fails.push(`${a.name || a.identifier}：${e.message}`);
    }
  }
  lastQuoteAt = new Date();
  if (saved) await reload();
  if (!silent) {
    toast(`已更新 ${saved} 筆行情` + (fails.length ? `；${fails.length} 筆未更新` : ''));
    if (fails.length) alert('以下項目沒有自動更新（原本的估值保留不變）：\n\n' + fails.join('\n'));
  }
  showFxStatus();
}

// ---------- 畫面 ----------
function render() {
  document.querySelectorAll('.fin-tab').forEach((b) => b.classList.toggle('active', b.dataset.sec === section));
  document.querySelectorAll('.fin-sec').forEach((s) => { s.hidden = s.id !== 'sec-' + section; });
  ({ overview: renderOverview, assets: renderAssets, liabs: renderLiabs, cash: renderCash, links: renderLinks, snaps: renderSnaps })[section]();
}

function statBox(label, value, sub = '', cls = '') {
  return `<div class="fin-stat ${cls}"><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
}
function missingList(bs) {
  const m = bs.missing; const items = [];
  const add = (arr, text) => arr.forEach((r) => items.push(`${esc(r.name || '（未命名）')}：${text}`));
  add(m.unvalued, '未估值（未納入總額）'); add(m.netUnreconciled, '扣貸後淨額口徑待核對（未納入）');
  add(m.assetNoFx, '缺匯率'); add(m.assetNoCcy, '未填幣別'); add(m.liabNoBalance, '負債未填剩餘本金');
  add(m.liabNoFx, '負債缺匯率'); add(m.liabNoCcy, '負債未填幣別');
  return items;
}

function renderOverview() {
  const { bs, av, cf } = result;
  const miss = missingList(bs);
  const catRows = Object.entries(bs.byCategory).sort((a, b) => (b[1] > a[1] ? 1 : -1))
    .map(([k, v]) => `<tr><td>${CATS[k] || k}</td><td class="num">${fmt(v)}</td></tr>`).join('');
  const ccyRows = Object.entries(bs.byCcy).map(([k, v]) => `<tr><td>${k}</td><td class="num">${fmt(v.assets, k)}</td><td class="num">${fmt(v.liabilities, k)}</td></tr>`).join('');
  $('sec-overview').innerHTML = `
    <div class="fin-head"><h2>${esc(client.name)} 的資產負債</h2><span class="fin-asof">基準日 ${result.bs.asOf}・台幣計價・規則 ${result.rulesVersion}</span></div>
    ${bs.complete ? '' : `<div class="fin-warn">資料不完整：以下總額只含已估值、已換匯的項目（${miss.length} 項待補）。</div>`}
    <div class="fin-stats">
      ${statBox('已估值資產', fmt(bs.assetsTotal), wan(bs.assetsTotal))}
      ${statBox('已確認負債', fmt(bs.liabTotal), wan(bs.liabTotal))}
      ${statBox(bs.complete ? '淨資產' : '淨資產（部分）', fmt(bs.net), wan(bs.net), 'em')}
      ${statBox('估計可自由動用（熱錢）', fmt(av.confirmed), av.pending > 0n ? `另有 ${wan(av.pending)} 待確認（受質押或限制、解押條件未填齊）` : '估計值，非銀行承諾')}
    </div>
    <div class="fin-grid2">
      <div><h3>資料完整度</h3>
        <ul class="fin-ul">
          <li>已估值資產 ${bs.valuedCount} ／ 需估值 ${bs.needValueCount}</li>
          <li>已確認負債 ${bs.confirmedLiabCount} ／ ${bs.liabRows.length}</li>
          <li>缺匯率 ${bs.missing.assetNoFx.length + bs.missing.liabNoFx.length} 項</li>
          <li>待確認擔保連結 ${data.collateralLinks.filter((k) => k.confirm_status !== 'confirmed').length} 筆</li>
          <li>可信度：估計 ${countVerify('estimate')}・已補文件 ${countVerify('doc')}・已核實 ${countVerify('verified')}</li>
          ${reMissing() ? `<li class="warn">不動產缺課稅價值（遺產稅試算會改用市價）${reMissing()} 項</li>` : ''}
          <li>FCN 結構型商品文件未齊 ${data.assets.filter((a) => a.category === 'mcn' && a.doc_status !== 'complete' && a.status !== 'archived').length} 項</li>
        </ul>
        ${miss.length ? `<h3>待補項目</h3><ul class="fin-ul fin-miss">${miss.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}
      </div>
      <div><h3>熱錢／冷錢</h3>
        <table class="fin-table"><tbody>
          ${Object.entries(PURPOSE).map(([k, l]) => `<tr><td>${l}</td><td class="num">${fmt(bs.byPurpose[k] || 0n)}</td></tr>`).join('')}
          <tr><td>熱錢中受限制</td><td class="num">${fmt(av.hotRestricted)}</td></tr>
        </tbody></table>
        <h3>資產分類</h3><table class="fin-table"><tbody>${catRows || '<tr><td colspan="2">尚無已估值資產</td></tr>'}</tbody></table>
      </div>
    </div>
    <h3>幣別分布（原幣）</h3>
    <table class="fin-table"><thead><tr><th>幣別</th><th class="num">資產</th><th class="num">負債</th></tr></thead><tbody>${ccyRows || '<tr><td colspan="3">—</td></tr>'}</tbody></table>
`;
}

function cashSummary(cf) {
  return `<table class="fin-table"><tbody>
    <tr><td>收入類收款</td><td class="num">${fmt(cf.income)}</td></tr>
    <tr><td>　其中分配款來源未確認</td><td class="num">${fmt(cf.unknownDist)}</td></tr>
    <tr><td>日常／持有支出（含利息）</td><td class="num">−${fmt(cf.expense)}</td></tr>
    <tr><td>　其中利息費用</td><td class="num">${fmt(cf.interest)}</td></tr>
    <tr><td>投資流量（贖回−申購）</td><td class="num">${fmt(cf.investIn - cf.investOut)}</td></tr>
    <tr><td>融資流量（借入−還本）</td><td class="num">${fmt(cf.finIn - cf.finOut)}</td></tr>
    <tr class="em"><td>期間現金淨變動</td><td class="num">${fmt(cf.netChange)}</td></tr>
    <tr><td>扣除利息與還本後的現金餘額（非報酬率）</td><td class="num">${fmt(cf.afterDebtService)}</td></tr>
  </tbody></table>
  ${cf.missingFx.length ? `<p class="fin-note">有 ${cf.missingFx.length} 筆收支缺匯率，未計入。</p>` : ''}
  ${cf.estimatedCount ? `<p class="fin-note">${cf.estimatedCount} 筆外幣收支以事件日參考匯率估算。</p>` : ''}
  ${cf.unpairedTransfers.length ? `<p class="fin-note">有 ${cf.unpairedTransfers.length} 組轉帳／換匯只有單邊，請補另一腿或配對代碼。</p>` : ''}`;
}

// 資產
function renderAssets() {
  const rows = result.bs.assetRows;
  const archived = data.assets.filter((a) => a.status === 'archived');
  const byCat = Object.keys(CATS).map((cat) => {
    const list = rows.filter((r) => r.category === cat);
    if (!list.length) return '';
    return `<h3>${CATS[cat]}</h3><div class="fin-list">${list.map((r) => {
      const a = data.assets.find((x) => x.id === r.id);
      const tag = STATUS_TEXT[r.status] ? `<span class="fin-tag ${r.status}">${STATUS_TEXT[r.status]}</span>` : '';
      return `<button type="button" class="fin-item" data-asset="${r.id}">
        <div class="fin-item-main"><b>${esc(r.name || '（未命名）')}</b>
          <small>${esc([a.institution, a.identifier, a.policy_ref && '保單 ' + a.policy_ref].filter(Boolean).join('・'))}</small>
          <span class="fin-chips"><i class="vf-${a.verify || 'estimate'}">${VERIFY[a.verify || 'estimate']}</i>${RE_CATS.includes(a.category) ? reChip(a) : ''}${docCount(a.id) ? `<i class="soft">文件 ${docCount(a.id)}</i>` : ''}<i>${PURPOSE[r.purpose]}</i>${r.restriction !== 'none' ? `<i class="warn">${RESTRICT[r.restriction]}</i>` : ''}${tag}${r.flags.map((f) => `<i class="soft">${esc(f)}</i>`).join('')}</span></div>
        <div class="fin-item-val"><b>${r.status === 'funds_sum' ? (r.fundsTotal !== null ? fmt(r.fundsTotal) + ' TWD' : '基金未估值') : r.original !== null ? fmt(r.original, r.currency) + ' ' + r.currency : '—'}</b>
          <small>${r.base !== null && r.currency !== 'TWD' ? '≈ ' + fmt(r.base) + ' TWD' : ''}${r.valueDate ? ` ・${r.valueDate}` : ''}</small></div>
      </button>`;
    }).join('')}</div>`;
  }).join('');
  $('sec-assets').innerHTML = `
    <div class="fin-head"><h2>資產</h2><span><button type="button" class="btn-secondary fin-sm" id="fa-deed">📄 上傳權狀建立不動產</button> <button type="button" class="btn-primary fin-sm" id="fa-add">＋ 新增資產</button></span></div>
    <p class="fin-note">每一項資產都標示可信度：<b>估計</b>（先填數字，文件還沒拿到）→ <b>已補文件</b>（權狀、對帳單已上傳）→ <b>已核實</b>（您核對過文件與數字）。報表照樣能出，只是會標示哪些是估計。</p>
    <p class="fin-note">現值與成本分開記；保額、累計繳費不會被當成現值。每次估值是一筆紀錄，報表依基準日自動選用當時有效的那一筆（同一天以人工覆寫優先）。</p>
    ${byCat || '<p class="fin-empty-row">尚無資產。</p>'}
    ${(() => { const loose = (data.documents || []).filter((d) => !d.asset_id); return loose.length ? `<h3>未歸檔文件</h3><div class="fin-docs">${loose.map((d) => `<div class="fin-doc"><div><b>${esc(DOC_KINDS[d.kind] || d.kind)}</b><small>${esc(d.file_name)}・${new Date(d.created_at).toLocaleDateString('zh-TW')}</small></div><span><button type="button" class="link-btn" data-looseview="${d.id}">開啟</button><button type="button" class="link-btn danger" data-loosedel="${d.id}">刪除</button></span></div>`).join('')}</div>` : ''; })()}
    ${archived.length ? `<details class="fin-archived"><summary>已封存 ${archived.length} 項</summary>${archived.map((a) => `<button type="button" class="fin-item" data-asset="${a.id}"><b>${esc(a.name)}</b></button>`).join('')}</details>` : ''}`;
  $('fa-add').addEventListener('click', () => assetForm());
  $('fa-deed').addEventListener('click', () => pickFile((f) => newAssetFromDoc(f)));
  document.querySelectorAll('[data-looseview]').forEach((b) => b.addEventListener('click', () => viewDoc(b.dataset.looseview)));
  document.querySelectorAll('[data-loosedel]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('刪除這份文件？')) return;
    const d = data.documents.find((x) => x.id === b.dataset.loosedel);
    await sb.storage.from('fin-docs').remove([d.file_path]); await remove('fin_documents', d.id); await reload();
  }));
  document.querySelectorAll('[data-asset]').forEach((b) => b.addEventListener('click', () => assetDetail(b.dataset.asset)));
}

// 負債
function renderLiabs() {
  const rows = result.bs.liabRows;
  $('sec-liabs').innerHTML = `
    <div class="fin-head"><h2>負債</h2><button type="button" class="btn-primary fin-sm" id="fl-add">＋ 新增負債</button></div>
    <p class="fin-note">剩餘本金與未付利息分開記；利息已滾入本金時請勾選，避免重複。授信額度不是現金，未動用額度不計入任何總額。維持率只顯示銀行提供的數字與日期。</p>
    ${rows.length ? `<div class="fin-list">${rows.map((r) => {
      const l = data.liabilities.find((x) => x.id === r.id);
      const coll = data.collateralLinks.filter((k) => k.liability_id === r.id).length;
      return `<button type="button" class="fin-item" data-liab="${r.id}">
        <div class="fin-item-main"><b>${esc(r.name || LIAB_CATS[r.category])}</b>
          <small>${esc([LIAB_CATS[r.category], l.institution, l.rate !== null && l.rate !== undefined ? `年利率 ${Number(l.rate)}%` : '', l.maturity ? '到期 ' + l.maturity : ''].filter(Boolean).join('・'))}</small>
          <span class="fin-chips"><i>${coll ? `擔保品 ${coll} 項` : '無擔保連結'}</i>${l.confirm_status === 'confirmed' ? '' : '<i class="soft">待確認</i>'}${STATUS_TEXT[r.status] ? `<span class="fin-tag ${r.status}">${STATUS_TEXT[r.status]}</span>` : ''}${r.flags.map((f) => `<i class="soft">${esc(f)}</i>`).join('')}</span></div>
        <div class="fin-item-val"><b>${r.original !== null ? fmt(r.original, r.currency) + ' ' + r.currency : '—'}</b>
          <small>${r.balanceDate ? '餘額日 ' + r.balanceDate : ''}${l.maintenance_ratio ? `・維持率 ${Number(l.maintenance_ratio)}%（${l.maintenance_date || '日期未填'}）` : ''}</small></div>
      </button>`;
    }).join('')}</div>` : '<p class="fin-empty-row">尚無負債。</p>'}`;
  $('fl-add').addEventListener('click', () => liabForm());
  document.querySelectorAll('[data-liab]').forEach((b) => b.addEventListener('click', () => liabDetail(b.dataset.liab)));
}

// 收支
function renderCash() {
  const up = result.upcoming;
  // 依月份小計（換成台幣；缺匯率的另外標示）
  const months = new Map();
  up.forEach((u) => {
    const m = u.date.slice(0, 7);
    if (!months.has(m)) months.set(m, { in: 0n, out: 0n, missing: 0, rows: [] });
    const g = months.get(m); g.rows.push(u);
    if (u.amount === null) return;
    const t = C.toBase(u.amount, u.currency, fx, u.date);
    if (t.value === null) { g.missing++; return; }
    g[u.direction] += t.value;
  });
  const assetName = (id) => (data.assets.find((a) => a.id === id) || {}).name || '';
  $('sec-cash').innerHTML = `
    <div class="fin-head"><h2>未來 12 個月收支日曆</h2>
      <button type="button" class="btn-primary fin-sm" id="fs-add">＋ 新增固定收支</button></div>
    <p class="fin-note">記錄個人固定支出與固定收入，例如每三週回診 6 萬、保險每次理賠的金額。金額以台幣小計，外幣依最新匯率換算。</p>
    ${data.cashSchedules.length ? `<h3>固定收支項目</h3><div class="fin-list">${data.cashSchedules.map((s) => `
      <button type="button" class="fin-item" data-sch="${s.id}">
        <div class="fin-item-main"><b>${esc(s.note || (C.KINDS[s.kind] || {}).label || s.kind)}</b>
          <small>${esc((C.KINDS[s.kind] || {}).label || s.kind)}・${FREQ[s.frequency] || s.frequency}・${s.start_date} 起${s.end_date ? ' 至 ' + s.end_date : ''}${s.asset_id ? '・' + esc(assetName(s.asset_id)) : ''}</small></div>
        <div class="fin-item-val"><b class="${s.direction}">${s.direction === 'in' ? '+' : '−'}${s.amount === null ? '金額未知' : fmtRaw(s.amount, s.currency) + ' ' + s.currency}</b></div>
      </button>`).join('')}</div>` : ''}
    ${months.size ? [...months.entries()].map(([m, g]) => `
      <div class="fin-month">
        <div class="fin-month-head"><b>${m.replace('-', ' 年 ')} 月</b>
          <span>收入 <i class="in">+${fmt(g.in)}</i>　支出 <i class="out">−${fmt(g.out)}</i>　淨額 <i class="${g.in - g.out < 0n ? 'out' : 'in'}">${fmt(g.in - g.out)}</i>${g.missing ? `　<em>${g.missing} 筆缺匯率</em>` : ''}</span></div>
        <table class="fin-table"><tbody>${g.rows.map((u) => `<tr><td>${u.date.slice(5)}</td><td>${esc(u.note || u.label)}</td>
          <td class="num ${u.direction}">${u.direction === 'in' ? '+' : '−'}${u.amount === null ? '金額未知' : fmt(u.amount, u.currency) + ' ' + u.currency}</td></tr>`).join('')}</tbody></table>
      </div>`).join('') : '<p class="fin-empty-row">還沒有固定收支，按「新增固定收支」開始記。</p>'}`;
  $('fs-add').addEventListener('click', () => scheduleForm());
  document.querySelectorAll('[data-sch]').forEach((b) => b.addEventListener('click', () => scheduleForm(data.cashSchedules.find((s) => s.id === b.dataset.sch))));
}

// 資金關聯
function renderLinks() {
  const tr = result.trace;
  const assetLabel = (a) => (a ? `${esc(a.name)}（${CATS[a.category]}）` : '（已刪除）');
  const own = data.fundingLinks.filter((k) => !k.liability_id);
  $('sec-links').innerHTML = `
    <div class="fin-head"><h2>資金關聯</h2><span>
      <button type="button" class="btn-secondary fin-sm" id="fk-coll">＋ 擔保連結</button>
      <button type="button" class="btn-primary fin-sm" id="fk-fund">＋ 資金用途</button></span></div>
    <p class="fin-note">擔保連結：這筆借款由哪些資產擔保（可多對多）。資金用途：借來或自有的錢投入哪些部位。質押只代表限制，不會從資產市值扣款；負債只在負債側扣一次。</p>
    ${tr.length ? tr.map((t) => `
      <div class="fin-trace">
        <div class="fin-trace-l"><span>擔保品</span>${t.collateral.length ? t.collateral.map((c) => `<button type="button" class="fin-node" data-coll="${c.link.id}">${assetLabel(c.asset)}${c.link.confirm_status === 'confirmed' ? '' : '<i>待確認</i>'}${c.link.allocation ? `<small>${esc(c.link.allocation)}</small>` : ''}</button>`).join('') : '<em>未連結</em>'}</div>
        <div class="fin-trace-m"><span>借款</span><div class="fin-node main">${esc(t.liability.name || LIAB_CATS[t.liability.category])}<small>${esc(t.liability.institution || '')}${t.liability.credit_group ? '・授信群組 ' + esc(t.liability.credit_group) : ''}</small></div></div>
        <div class="fin-trace-r"><span>資金投入</span>${t.uses.length ? t.uses.map((u) => `<button type="button" class="fin-node" data-fund="${u.link.id}">${assetLabel(u.asset)}${u.link.amount !== null ? `<small>${fmtRaw(u.link.amount, u.link.currency)} ${u.link.currency || ''}</small>` : ''}${u.link.confirm_status === 'confirmed' ? '' : '<i>待確認</i>'}</button>`).join('') : '<em>未記錄用途</em>'}</div>
      </div>`).join('') : '<p class="fin-empty-row">尚無負債，無法建立關聯。</p>'}
    ${own.length ? `<h3>自有資金投入</h3><div class="fin-list">${own.map((k) => `<button type="button" class="fin-item" data-fund="${k.id}"><b>${assetLabel(data.assets.find((a) => a.id === k.asset_id))}</b><small>${fmtRaw(k.amount, k.currency)} ${k.currency || ''}${k.link_date ? '・' + k.link_date : ''}</small></button>`).join('')}</div>` : ''}`;
  $('fk-coll').addEventListener('click', () => collForm());
  $('fk-fund').addEventListener('click', () => fundForm());
  document.querySelectorAll('[data-coll]').forEach((b) => b.addEventListener('click', () => collForm(data.collateralLinks.find((k) => k.id === b.dataset.coll))));
  document.querySelectorAll('[data-fund]').forEach((b) => b.addEventListener('click', () => fundForm(data.fundingLinks.find((k) => k.id === b.dataset.fund))));
}

// 報表紀錄
function renderSnaps() {
  $('sec-snaps').innerHTML = `
    <div class="fin-head"><h2>報表紀錄</h2><button type="button" class="btn-primary fin-sm" id="fsn-add">存成報表</button></div>
    <p class="fin-note">報表是存檔當下的凍結版本：之後更新行情、匯率或修改資料，舊報表的數字都不會變。要反映新資料請另存新版本。</p>
    ${data.snapshots.length ? `<div class="fin-list">${data.snapshots.map((s) => `
      <div class="fin-item static"><div class="fin-item-main"><b>${esc(s.title || '資產負債報表')}</b>
        <small>基準日 ${s.as_of}・收支 ${s.period_from || ''} ～ ${s.period_to || ''}・存於 ${new Date(s.created_at).toLocaleString('zh-TW')}</small>
        ${s.summary ? `<span class="fin-chips"><i>淨資產 ${esc(s.summary.net)}</i>${s.summary.complete ? '' : '<i class="soft">資料不完整</i>'}</span>` : ''}</div>
        ${s.shared_at ? `<span class="fin-chips"><i>客戶可見（${new Date(s.shared_at).toLocaleDateString('zh-TW')} 分享）</i></span>` : ''}
        <div class="fin-item-val"><a class="btn-secondary fin-sm" href="finance-report.html?snap=${s.id}" target="_blank" rel="noopener">開啟報表</a>
          <button type="button" class="btn-secondary fin-sm" data-snapshare="${s.id}">${s.shared_at ? '取消分享' : '分享給客戶'}</button>
          <button type="button" class="icon-btn" data-snapdel="${s.id}">刪除</button></div></div>`).join('')}</div>` : '<p class="fin-empty-row">尚未存過報表。</p>'}`;
  $('fsn-add').addEventListener('click', saveSnapshot);
  document.querySelectorAll('[data-snapshare]').forEach((b) => b.addEventListener('click', async () => {
    const s = data.snapshots.find((x) => x.id === b.dataset.snapshare);
    const on = !s.shared_at;
    if (on && !confirm(`把「${s.title || '資產負債報表'}」（基準日 ${s.as_of}）分享到客戶的「我的保單」？\n客戶需已用邀請碼綁定才看得到。`)) return;
    const { error } = await sb.from('fin_snapshots').update({ shared_at: on ? new Date().toISOString() : null }).eq('id', s.id);
    if (error) { toast('更新失敗：' + error.message); return; }
    toast(on ? '已分享給客戶' : '已取消分享'); await reload();
  }));
  document.querySelectorAll('[data-snapdel]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('刪除這份報表快照？')) return;
    await remove('fin_snapshots', b.dataset.snapdel); await reload();
  }));
}

async function saveSnapshot() {
  if (!data) { toast('請先選擇客戶'); return; }
  const title = prompt('報表名稱', `${client.name} 資產負債報表 ${$('fin-asof').value}`);
  if (title === null) return;
  const input = inputFor($('fin-asof').value || todayIso(), $('fin-from').value, $('fin-to').value);
  const res = C.compute(input);
  const summary = { net: fmt(res.bs.net), assets: fmt(res.bs.assetsTotal), liabilities: fmt(res.bs.liabTotal), complete: res.bs.complete };
  const { snapshots, ...raw } = input;
  const { error } = await sb.from('fin_snapshots').insert({
    client_id: client.id, as_of: input.asOf, period_from: res.period.from, period_to: res.period.to, title,
    rules_version: C.RULES_VERSION,
    payload: C.serialize({ ...raw, client: { id: client.id, name: client.name }, generatedAt: new Date().toISOString() }),
    result: { ...C.serialize(res), summary },
  });
  if (error) { toast('存檔失敗：' + error.message); return; }
  await reload();
  section = 'snaps'; render();
  toast('已存成報表，可在「報表紀錄」開啟列印');
}

// ---------- 表單 ----------
let onSubmit = null;
function openModal(title, fields, values, submit, extraHtml = '', onDelete = null) {
  $('fin-modal-title').textContent = title;
  const v = values || {};
  const field = (f) => {
    const val = v[f.k] ?? f.def ?? '';
    const req = f.req ? ' required' : '';
    const show = f.when ? ` data-when="${esc(f.when)}"` : '';
    if (f.type === 'section') return `<div class="fin-form-sec"${show}>${f.label}</div>`;
    if (f.type === 'check') return `<label class="fin-check"${show}><input type="checkbox" name="${f.k}" ${val === true || val === 'true' ? 'checked' : ''}> ${f.label}</label>`;
    let input;
    if (f.type === 'select') input = `<select name="${f.k}"${req}>${f.opts.map(([o, l]) => `<option value="${esc(o)}" ${String(val) === String(o) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    else if (f.type === 'textarea') input = `<textarea name="${f.k}" rows="2">${esc(val)}</textarea>`;
    else input = `<input type="${f.type || 'text'}" name="${f.k}" value="${esc(val)}"${req}${f.pick ? ` data-pick="${f.pick}" autocomplete="off"` : ''}${f.type === 'number' ? ' step="any" inputmode="decimal"' : ''}${f.ph ? ` placeholder="${esc(f.ph)}"` : ''}${f.list ? ` list="${f.list}"` : ''}>`;
    return `<label class="${f.wide ? 'wide' : ''}"${show}>${f.label}${f.req ? ' *' : ''}${input}${f.hint ? `<small>${f.hint}</small>` : ''}</label>`;
  };
  $('fin-form').innerHTML = `<datalist id="fin-ccy">${CCYS.map((c) => `<option value="${c}">`).join('')}</datalist>
    <div class="fin-form-grid">${fields.map(field).join('')}</div>${extraHtml}
    <div class="fin-form-actions">${onDelete ? '<button type="button" class="icon-btn" id="fin-del">刪除</button>' : '<span></span>'}
      <span><button type="button" class="btn-secondary" id="fin-cancel">取消</button> <button type="submit" class="btn-primary">儲存</button></span></div>`;
  const form = $('fin-form');
  const sync = () => form.querySelectorAll('[data-when]').forEach((el) => {
    const [k, list] = el.dataset.when.split('=');
    const cur = form.elements[k] ? form.elements[k].value : '';
    el.hidden = !list.split('|').includes(cur);
  });
  form.addEventListener('change', sync); sync();
  $('fin-cancel').onclick = closeModal;
  if (onDelete) $('fin-del').onclick = async () => { try { await onDelete(); closeModal(); await reload(); } catch (e) { alert(e.message); } };
  onSubmit = async () => {
    const out = {};
    fields.forEach((f) => {
      if (!f.k || f.type === 'section') return;
      const el = form.elements[f.k];
      if (!el) return;
      if (f.type === 'check') { out[f.k] = el.checked; return; }
      let x = el.value.trim();
      if (f.type === 'number') x = x === '' ? null : x.replace(/,/g, '');
      else if (f.type === 'date') x = x || null;
      else if (f.nullable) x = x || null;
      if (f.upper && typeof x === 'string') x = x.toUpperCase();
      out[f.k] = x;
    });
    await submit(out, form);
  };
  $('fin-modal').hidden = false;
}
function closeModal() { $('fin-modal').hidden = true; $('fin-form').innerHTML = ''; onSubmit = null; if (window.closePicker) window.closePicker(); }
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'fin-form' || !onSubmit) return;
  e.preventDefault();
  const btn = e.target.querySelector('[type=submit]'); btn.disabled = true;
  try { await onSubmit(); closeModal(); await reload(); toast('已儲存'); }
  catch (err) { alert('儲存失敗：' + (err.message || err)); }
  finally { btn.disabled = false; }
});

const optsOf = (obj) => Object.entries(obj);
const ccyField = (def = 'TWD') => ({ k: 'currency', label: '幣別', req: true, def, type: 'select', opts: CCYS.map((c) => [c, `${c} ${CCY_NAMES[c]}`]) });
function validNumbers(row, keys) {
  for (const k of keys) {
    if (row[k] === null || row[k] === undefined) continue;
    if (C.D(row[k]) === null) throw new Error(`「${k}」不是有效數字`);
  }
}
function policyOptions() {
  const list = (client.policies || []).map((p) => [p.policy_no, `${p.policy_no} ${p.main_name || p.main_code || ''}`]);
  return [['', '（不連結）'], ...list];
}
function assetOptions(excludeId) {
  return data.assets.filter((a) => a.id !== excludeId && a.status !== 'archived').map((a) => [a.id, `${a.name}（${CATS[a.category]}）`]);
}
function liabOptions() { return data.liabilities.filter((l) => l.status !== 'archived').map((l) => [l.id, `${l.name || LIAB_CATS[l.category]}（${l.institution || ''}）`]); }

function assetForm(a, preset) {
  const isNew = !a;
  openModal(isNew ? '新增資產' : '編輯資產', [
    { k: 'category', label: '類別', type: 'select', opts: optsOf(CATS), req: true },
    { k: 'name', label: '名稱', req: true, ph: '例：信義區房屋、某某基金 A 級別' },
    { k: 'institution', label: '持有機構', ph: '例：中國信託、富邦人壽' },
    ccyField(),
    { k: 'policy_ref', label: '連結既有保單', type: 'select', opts: policyOptions(), when: 'category=savings_policy|investment_policy' },
    { k: 'market', label: '市場', type: 'select', opts: [['', '—'], ['TWSE', '台股上市'], ['TPEX', '台股上櫃'], ['US', '美股'], ['OTHER', '其他']], when: 'category=stock' },
    { k: 'identifier', label: '代號', ph: '股票代號（例 2330、AAPL）', upper: true, when: 'category=stock|mcn|other' },
    { k: 'fund_pick', label: '基金（從東石診股清單選，含完整級別與幣別）', when: 'category=fund', pick: 'fin-fund', hint: '可輸入名稱、ISIN 或代碼搜尋；選定後會自動填幣別，淨值每天自動更新' },
    { k: 'meta_class', label: '基金級別', ph: '例：A 累積 美元', when: 'category=fund' },
    { k: 'share_pct', label: '持分（%）', type: 'number', def: 100, when: 'category=house|land|equity', hint: '估值填整體市值時，系統只換算一次持分' },
    { k: 'meta_region', label: '地區描述', when: 'category=house|land' },
    { k: 'meta_plate', label: '車牌', when: 'category=vehicle' },
    { k: 'quantity', label: '持有數量（股數／單位數）', type: 'number', when: 'category=stock|fund|mcn|other' },
    { k: 'meta_start', label: '起日', type: 'date', when: 'category=deposit' },
    { k: 'meta_end', label: '到期日', type: 'date', when: 'category=deposit' },
    { k: 'meta_interest', label: '利息方式', when: 'category=deposit', ph: '例：年利率 1.7%，到期領息' },
    { k: 'cost', label: '原始成本（選填）', type: 'number', hint: '成本不會被當成現值' },
    { k: 'doc_status', label: '文件狀態', type: 'select', opts: [['', '未取得'], ['partial', '部分取得'], ['complete', '已取得並核對']], when: 'category=mcn' },
    { k: 'verify', label: '資料可信度', type: 'select', opts: optsOf(VERIFY), hint: '先填估計值沒關係，之後補文件再升級' },
    { type: 'section', label: '用途、流動性與限制' },
    { k: 'purpose', label: '用途', type: 'select', opts: optsOf(PURPOSE) },
    { k: 'restriction', label: '限制', type: 'select', opts: optsOf(RESTRICT) },
    { k: 'liquidity_days', label: '預計入帳天數', type: 'number', ph: '例：股票 2、基金 7' },
    { k: 'exit_cost', label: '提前退出成本（原幣）', type: 'number', hint: '未知請留空；已確認沒有就填 0' },
    { k: 'exit_note', label: '退出條件說明', wide: true },
    { type: 'section', label: '加總設定' },
    { k: 'parent_id', label: '上層部位（例：投資型保單的底層基金）', type: 'select', opts: [['', '（無）'], ...assetOptions(a && a.id)], nullable: true },
    { k: 'include_in_total', label: '計入資產總額（銀行總覽、帳戶彙總這類只看不加的，請取消勾選）', type: 'check', def: true },
    { k: 'note', label: '備註', type: 'textarea', wide: true },
  ], a ? { ...a, fund_pick: a.category === 'fund' && a.identifier ? `${a.identifier}｜${(a.meta || {}).fund_name || a.name}` : '', ...Object.fromEntries(Object.entries(a.meta || {}).map(([k, v]) => ['meta_' + k, v])) } : { include_in_total: true, purpose: 'none', restriction: 'none', verify: 'estimate', ...(preset || {}) }, async (row) => {
    validNumbers(row, ['share_pct', 'quantity', 'cost', 'liquidity_days', 'exit_cost']);
    if (row.category === 'fund') {
      const fid = (row.fund_pick || '').split('｜')[0].trim();
      if (fid) {
        const idx = await loadFundIndex().catch(() => null);
        const f = idx && idx.funds.find((x) => x.id === fid);
        if (!f) throw new Error('請從清單選取基金（找不到這個代碼）');
        row.identifier = f.id; row.meta_fund_name = f.name; row.meta_isin = f.isin || ''; row.meta_company = f.company || '';
        if (row.currency !== f.currency && !confirm(`這檔基金的計價幣別是 ${f.currency}，要把資產幣別改成 ${f.currency} 嗎？`)) throw new Error('幣別與基金不一致，未儲存');
        row.currency = f.currency;
      } else row.identifier = '';
    }
    delete row.fund_pick;
    if (!/^[A-Z]{3}$/.test(row.currency || '')) throw new Error('幣別請填三碼代號，例如 TWD、USD');
    const meta = {};
    if (a && a.meta) ['parcels', 'bldg'].forEach((k) => { if (a.meta[k] !== undefined && row['meta_' + k] === undefined) meta[k] = a.meta[k]; });
    Object.keys(row).filter((k) => k.startsWith('meta_')).forEach((k) => { if (row[k]) meta[k.slice(5)] = row[k]; delete row[k]; });
    if (row.category !== 'investment_policy') delete meta.value_from_funds;
    row.meta = meta;
    row.share_pct = row.share_pct || 100;
    row.parent_id = row.parent_id || null;
    if (row.parent_id) {
      let p = data.assets.find((x) => x.id === row.parent_id); const seen = new Set([a && a.id]);
      while (p) { if (seen.has(p.id)) throw new Error('上層部位不能形成循環'); seen.add(p.id); p = data.assets.find((x) => x.id === p.parent_id); }
    }
    await save('fin_assets', row, a && a.id);
  }, '', a ? async () => {
    if (!confirm('封存這項資產？（保留歷史估值與報表；要永久刪除請在封存後再刪）')) throw new Error('已取消');
    if (a.status === 'archived') { if (!confirm('這項已封存，確定永久刪除與它的估值紀錄？')) throw new Error('已取消'); await remove('fin_assets', a.id); }
    else await save('fin_assets', { status: 'archived' }, a.id);
  } : null);
}

function assetDetail(id) {
  const a = data.assets.find((x) => x.id === id);
  const vals = data.assetValues.filter((v) => v.asset_id === id).sort((x, y) => (x.as_of < y.as_of ? 1 : -1));
  const funding = data.fundingLinks.filter((k) => k.asset_id === id);
  const coll = data.collateralLinks.filter((k) => k.asset_id === id);
  const html = `
    <div class="fin-detail">
      <p>${CATS[a.category]}・${esc(a.institution)}・${a.currency}${a.identifier ? '・' + esc(a.identifier) : ''}${a.status === 'archived' ? '・<b>已封存</b>' : ''}</p>
      <p>用途：${PURPOSE[a.purpose]}・限制：${RESTRICT[a.restriction]}${a.exit_cost !== null ? `・退出成本 ${fmtRaw(a.exit_cost, a.currency)}` : ''}${a.cost !== null ? `・成本 ${fmtRaw(a.cost, a.currency)}` : ''}</p>
      ${coll.length ? `<p>擔保：${coll.map((k) => esc((data.liabilities.find((l) => l.id === k.liability_id) || {}).name || '')).join('、')}</p>` : ''}
      ${funding.length ? `<p>資金來源：${funding.map((k) => (k.liability_id ? esc((data.liabilities.find((l) => l.id === k.liability_id) || {}).name || '借款') : '自有資金') + (k.amount ? ` ${fmtRaw(k.amount, k.currency)}` : '')).join('、')}</p>` : ''}
      ${a.category === 'investment_policy' ? (() => {
        const kids = data.assets.filter((k) => k.parent_id === a.id && k.status !== 'archived');
        const rows = result.bs.assetRows;
        return `<div class="fin-form-sec">連結基金（投資標的）</div>
        ${kids.length ? `<table class="fin-table"><thead><tr><th>基金</th><th class="num">單位數</th><th class="num">現值</th><th></th></tr></thead><tbody>
          ${kids.map((k) => { const r = rows.find((x) => x.id === k.id) || {}; return `<tr><td>${esc(k.name)}<div class="fin-mini-sub">${esc((k.meta || {}).isin || k.identifier || '')}</div></td>
            <td class="num">${k.quantity === null ? '—' : fmtRaw(k.quantity, 'USD')}</td>
            <td class="num">${r.original != null ? fmt(r.original, k.currency) + ' ' + k.currency : '未估值'}</td>
            <td><button type="button" class="link-btn" data-kid="${k.id}">開啟</button></td></tr>`; }).join('')}</tbody></table>` : '<p class="fin-empty-row">還沒有連結基金。</p>'}
        <p class="fin-note">保單價值＝這些基金的合計（保單本身不另計）。基金淨值會跟著「更新行情」自動更新。</p>
        <div class="fin-form-actions"><span></span><button type="button" class="btn-secondary" id="fd-fund">＋ 連結基金</button></div>`;
      })() : ''}
      ${RE_CATS.includes(a.category) ? reSection(a) : ''}
      ${docSection(a)}
      <div class="fin-form-sec">估值紀錄</div>
      ${vals.length ? `<table class="fin-table"><thead><tr><th>日期</th><th>口徑</th><th class="num">現值</th><th>來源</th><th></th></tr></thead><tbody>
        ${vals.map((v) => `<tr><td>${v.as_of}</td><td>${BASIS[v.value_basis]}${v.is_manual ? '' : '<i class="fin-mini">自動</i>'}${v.override_reason ? `<i class="fin-mini">覆寫</i>` : ''}</td>
          <td class="num">${v.value === null ? '未知' : fmtRaw(v.value, a.currency)}</td><td>${esc(v.source)}</td>
          <td><button type="button" class="link-btn" data-val="${v.id}">編輯</button></td></tr>`).join('')}</tbody></table>` : '<p class="fin-empty-row">尚無估值。</p>'}
      <div class="fin-form-actions"><button type="button" class="btn-secondary" id="fd-edit">編輯資產資料</button><button type="button" class="btn-primary" id="fd-val">＋ 新增估值</button></div>
    </div>`;
  $('fin-modal-title').textContent = a.name;
  $('fin-form').innerHTML = html;
  $('fin-modal').hidden = false;
  onSubmit = null;
  $('fd-edit').onclick = () => assetForm(a);
  $('fd-val').onclick = () => valueForm(a);
  bindDocSection(a);
  if ($('fd-fund')) $('fd-fund').onclick = () => assetForm(null, { category: 'fund', parent_id: a.id, institution: a.institution, purpose: a.purpose, restriction: a.restriction, name: '' });
  $('fin-form').querySelectorAll('[data-kid]').forEach((b) => b.onclick = () => assetDetail(b.dataset.kid));
  $('fin-form').querySelectorAll('[data-val]').forEach((b) => b.onclick = () => valueForm(a, vals.find((v) => v.id === b.dataset.val)));
}

function valueForm(a, v) {
  const policy = ['savings_policy', 'investment_policy'].includes(a.category);
  openModal(`${a.name}：${v ? '編輯' : '新增'}估值`, [
    { k: 'as_of', label: '價值日期', type: 'date', req: true, def: todayIso() },
    { k: 'value_basis', label: '估值口徑', type: 'select', opts: policy ? [['gross', '扣貸前價值（建議）'], ['net_of_loan', '扣貸後可領淨額'], ['statement', '對帳單'], ['manual', '手動估值']] : optsOf(BASIS) },
    { k: 'quantity', label: '數量', type: 'number', def: a.quantity },
    { k: 'price', label: '單價／淨值', type: 'number', hint: '填數量與單價，現值可留空自動相乘' },
    { k: 'value', label: `現值（${a.currency}，未知請留空）`, type: 'number', hint: a.share_pct && Number(a.share_pct) !== 100 ? `請填整體市值，系統會乘上持分 ${Number(a.share_pct)}%` : '' },
    { k: 'loan_deducted', label: '已扣除的貸款與利息（同一日期）', type: 'number', when: 'value_basis=net_of_loan' },
    { k: 'loan_reconciled', label: '已核對：上面的扣除額與負債頁的保單貸款是同一日期、同一口徑', type: 'check', when: 'value_basis=net_of_loan' },
    { k: 'source', label: '來源', ph: '例：富邦人壽 11/01 對帳單', wide: true },
    { k: 'override_reason', label: '人工覆寫原因（覆寫自動價格時填）', wide: true },
    { k: 'note', label: '備註', type: 'textarea', wide: true },
  ], v || { value_basis: policy ? 'gross' : 'manual' }, async (row) => {
    validNumbers(row, ['quantity', 'price', 'value', 'loan_deducted']);
    if (row.value === null && row.quantity !== null && row.price !== null) row.value = String(C.toNum(C.mul(C.D(row.quantity), C.D(row.price))));
    if (row.value !== null && C.D(row.value) < 0n) throw new Error('現值不能是負數');
    if (row.as_of > todayIso()) throw new Error('價值日期不能是未來日期');
    await save('fin_asset_values', { ...row, asset_id: a.id, is_manual: true }, v && v.id);
  }, '', v ? async () => { await remove('fin_asset_values', v.id); } : null);
}

function liabForm(l) {
  openModal(l ? '編輯負債' : '新增負債', [
    { k: 'category', label: '類別', type: 'select', opts: optsOf(LIAB_CATS), req: true },
    { k: 'name', label: '帳戶別名', req: true, ph: '例：房貸（信義）、中信基金質借' },
    { k: 'institution', label: '機構' },
    ccyField(),
    { k: 'policy_ref', label: '對應保單', type: 'select', opts: policyOptions(), when: 'category=policy_loan' },
    { k: 'credit_group', label: '授信群組／額度代號' },
    { k: 'credit_limit', label: '授信額度（不是現金）', type: 'number' },
    { k: 'rate', label: '年利率（%）', type: 'number', hint: '未知請留空' },
    { k: 'rate_type', label: '利率型態', type: 'select', opts: [['', '未知'], ['fixed', '固定'], ['floating', '浮動']] },
    { k: 'rate_from', label: '利率生效日', type: 'date' },
    { k: 'repayment', label: '還款方式', type: 'select', opts: [['', '未知'], ['amortizing', '本息攤還'], ['interest_only', '只繳息'], ['other', '其他']] },
    { k: 'frequency', label: '付款頻率', ph: '例：每月' },
    { k: 'pay_day', label: '付款日', ph: '例：每月 5 日' },
    { k: 'maturity', label: '到期日', type: 'date' },
    { type: 'section', label: '銀行提供的維持率（只顯示，不推算）' },
    { k: 'maintenance_ratio', label: '維持率（%）', type: 'number' },
    { k: 'maintenance_date', label: '維持率日期', type: 'date' },
    { k: 'maintenance_note', label: '門檻與公式口徑', wide: true },
    { k: 'doc_ref', label: '依據文件', wide: true },
    { k: 'confirm_status', label: '確認狀態', type: 'select', opts: [['pending', '待確認'], ['confirmed', '已確認']] },
    { k: 'note', label: '備註', type: 'textarea', wide: true },
  ], l || {}, async (row) => {
    validNumbers(row, ['credit_limit', 'rate', 'maintenance_ratio']);
    if (!/^[A-Z]{3}$/.test(row.currency || '')) throw new Error('幣別請填三碼代號');
    if (row.rate !== null && (Number(row.rate) < 0 || Number(row.rate) > 30)) throw new Error('年利率看起來不合理（0～30%）');
    await save('fin_liabilities', row, l && l.id);
  }, '', l ? async () => {
    if (l.status === 'archived') { if (!confirm('永久刪除這筆負債與餘額紀錄？')) throw new Error('已取消'); await remove('fin_liabilities', l.id); }
    else { if (!confirm('封存這筆負債？')) throw new Error('已取消'); await save('fin_liabilities', { status: 'archived' }, l.id); }
  } : null);
}

function liabDetail(id) {
  const l = data.liabilities.find((x) => x.id === id);
  const bals = data.liabilityBalances.filter((b) => b.liability_id === id).sort((x, y) => (x.as_of < y.as_of ? 1 : -1));
  $('fin-modal-title').textContent = l.name || LIAB_CATS[l.category];
  $('fin-form').innerHTML = `<div class="fin-detail">
    <p>${LIAB_CATS[l.category]}・${esc(l.institution)}・${l.currency}${l.rate !== null ? `・年利率 ${Number(l.rate)}%` : '・利率未知'}${l.credit_limit !== null ? `・額度 ${fmtRaw(l.credit_limit, l.currency)}（未動用額度不是現金）` : ''}</p>
    <div class="fin-form-sec">餘額紀錄</div>
    ${bals.length ? `<table class="fin-table"><thead><tr><th>日期</th><th class="num">剩餘本金</th><th class="num">未付利息</th><th></th></tr></thead><tbody>
      ${bals.map((b) => `<tr><td>${b.as_of}</td><td class="num">${fmtRaw(b.principal, l.currency)}</td><td class="num">${b.interest_capitalized ? '已滾入本金' : fmtRaw(b.accrued_interest, l.currency)}</td>
        <td><button type="button" class="link-btn" data-bal="${b.id}">編輯</button></td></tr>`).join('')}</tbody></table>` : '<p class="fin-empty-row">尚無餘額。</p>'}
    <div class="fin-form-actions"><button type="button" class="btn-secondary" id="ld-edit">編輯負債資料</button><button type="button" class="btn-primary" id="ld-bal">＋ 新增餘額</button></div></div>`;
  $('fin-modal').hidden = false; onSubmit = null;
  $('ld-edit').onclick = () => liabForm(l);
  $('ld-bal').onclick = () => balForm(l);
  $('fin-form').querySelectorAll('[data-bal]').forEach((b) => b.onclick = () => balForm(l, bals.find((x) => x.id === b.dataset.bal)));
}
function balForm(l, b) {
  openModal(`${l.name}：${b ? '編輯' : '新增'}餘額`, [
    { k: 'as_of', label: '餘額日期', type: 'date', req: true, def: todayIso() },
    { k: 'principal', label: `剩餘本金（${l.currency}）`, type: 'number', req: true },
    { k: 'interest_capitalized', label: '利息已滾入本金（勾選後不另計未付利息）', type: 'check' },
    { k: 'accrued_interest', label: '應計未付利息', type: 'number' },
    { k: 'source', label: '來源', wide: true },
    { k: 'note', label: '備註', type: 'textarea', wide: true },
  ], b || {}, async (row) => {
    validNumbers(row, ['principal', 'accrued_interest']);
    if (C.D(row.principal) < 0n) throw new Error('本金不能是負數');
    await save('fin_liability_balances', { ...row, liability_id: l.id }, b && b.id);
  }, '', b ? async () => remove('fin_liability_balances', b.id) : null);
}

const KIND_OPTS = () => Object.entries(C.KINDS).map(([k, v]) => [k, v.label]);
const DEFAULT_DIR = { rent: 'in', survival: 'in', fund_dist: 'in', policy_dist: 'in', dividend: 'in', interest_income: 'in', salary: 'in', other_income: 'in', redeem: 'in', principal_return: 'in', loan_draw: 'in' };
function eventForm(e) {
  openModal(e ? '編輯收支' : '新增實際收支', [
    { k: 'event_date', label: '日期', type: 'date', req: true, def: todayIso() },
    { k: 'kind', label: '類型', type: 'select', opts: KIND_OPTS(), req: true },
    { k: 'direction', label: '流向', type: 'select', opts: [['in', '流入'], ['out', '流出']] },
    { k: 'amount', label: '原幣金額', type: 'number', req: true },
    ccyField(),
    { k: 'amount_twd', label: '實際台幣金額（換匯或入帳時有就填）', type: 'number' },
    { k: 'principal_part', label: '其中本金', type: 'number', when: 'kind=loan_payment' },
    { k: 'interest_part', label: '其中利息', type: 'number', when: 'kind=loan_payment' },
    { k: 'nature', label: '分配款性質', type: 'select', opts: [['unknown', '未知（不預設為收益）'], ['income', '收益'], ['principal', '本金'], ['mixed', '混合']], when: 'kind=fund_dist|policy_dist|survival' },
    { k: 'transfer_pair', label: '配對代碼（兩腿填同一個）', when: 'kind=transfer|fx_exchange', ph: '例：FX-1118' },
    { k: 'account', label: '帳戶' },
    { k: 'asset_id', label: '關聯資產', type: 'select', opts: [['', '（無）'], ...assetOptions()], nullable: true },
    { k: 'liability_id', label: '關聯負債', type: 'select', opts: [['', '（無）'], ...liabOptions()], nullable: true },
    { k: 'schedule_id', label: '對應排程（避免重複列待收）', type: 'select', opts: [['', '（無）'], ...data.cashSchedules.map((s) => [s.id, `${(C.KINDS[s.kind] || {}).label || s.kind} ${s.start_date}起 ${FREQ[s.frequency]}`])], nullable: true },
    { k: 'source', label: '來源', wide: true },
    { k: 'confirm_status', label: '確認狀態', type: 'select', opts: [['confirmed', '已確認'], ['pending', '待確認']] },
    { k: 'note', label: '備註', type: 'textarea', wide: true },
  ], e || { direction: 'in' }, async (row) => {
    validNumbers(row, ['amount', 'amount_twd', 'principal_part', 'interest_part']);
    if (C.D(row.amount) < 0n) throw new Error('金額請填正數，流入／流出用「流向」選');
    if (!/^[A-Z]{3}$/.test(row.currency || '')) throw new Error('幣別請填三碼代號');
    if (row.kind === 'loan_payment') {
      if (row.principal_part === null || row.interest_part === null) throw new Error('貸款繳款請拆成本金與利息');
      if (C.add(C.D(row.principal_part), C.D(row.interest_part)) !== C.D(row.amount)) throw new Error('本金＋利息要等於繳款總額');
    }
    await save('fin_cash_events', row, e && e.id);
  }, '', e ? async () => remove('fin_cash_events', e.id) : null);
  const form = $('fin-form');
  if (!e) form.elements.kind.addEventListener('change', () => { form.elements.direction.value = DEFAULT_DIR[form.elements.kind.value] || 'out'; });
}
// 收支日曆用的類型（個人固定收支）
const SCHED_KINDS = ['fixed_expense', 'medical', 'insurance_claim', 'premium', 'loan_payment', 'loan_interest', 'rent', 'living', 'tax', 'property_expense', 'salary', 'survival', 'dividend', 'fund_dist', 'policy_dist', 'interest_income', 'other_income', 'other_expense'];
const SCHED_DIR = { insurance_claim: 'in', rent: 'in', salary: 'in', survival: 'in', dividend: 'in', fund_dist: 'in', policy_dist: 'in', interest_income: 'in', other_income: 'in' };
function scheduleForm(s) {
  openModal(s ? '編輯未來排程' : '新增未來排程', [
    { k: 'kind', label: '類型', type: 'select', opts: SCHED_KINDS.map((k) => [k, C.KINDS[k].label]), req: true },
    { k: 'direction', label: '流向', type: 'select', opts: [['out', '支出'], ['in', '收入']] },
    { k: 'amount', label: '每期金額（未知可留空）', type: 'number' },
    ccyField(),
    { k: 'start_date', label: '第一期日期', type: 'date', req: true },
    { k: 'frequency', label: '頻率', type: 'select', opts: optsOf(FREQ) },
    { k: 'end_date', label: '結束日（選填）', type: 'date' },
    { k: 'note', label: '說明', wide: true, ph: '例：回診、A 公司實支理賠' },
  ], s || { direction: 'out', frequency: 'monthly', kind: 'fixed_expense' }, async (row) => {
    validNumbers(row, ['amount']);
    await save('fin_cash_schedules', row, s && s.id);
  }, '', s ? async () => remove('fin_cash_schedules', s.id) : null);
  const f = $('fin-form');
  f.elements.kind.addEventListener('change', () => { f.elements.direction.value = SCHED_DIR[f.elements.kind.value] || 'out'; });
}
function collForm(k) {
  if (!data.liabilities.length || !data.assets.length) { toast('需要先有負債與資產'); return; }
  openModal(k ? '編輯擔保連結' : '新增擔保連結', [
    { k: 'liability_id', label: '借款／授信', type: 'select', opts: liabOptions(), req: true },
    { k: 'asset_id', label: '擔保資產', type: 'select', opts: assetOptions(), req: true },
    { k: 'allocation', label: '分配或限制說明', wide: true, hint: '同一資產擔保多筆借款時，記錄如何分配；不假設可以重複足額設質' },
    { k: 'confirm_status', label: '核實狀態', type: 'select', opts: [['pending', '待確認'], ['confirmed', '已確認']] },
    { k: 'note', label: '備註', type: 'textarea', wide: true },
  ], k || {}, async (row) => {
    if (!k && data.collateralLinks.some((x) => x.liability_id === row.liability_id && x.asset_id === row.asset_id)) throw new Error('這個擔保連結已經存在');
    await save('fin_collateral_links', row, k && k.id);
  }, '', k ? async () => remove('fin_collateral_links', k.id) : null);
}
function fundForm(k) {
  if (!data.assets.length) { toast('需要先有資產'); return; }
  openModal(k ? '編輯資金用途' : '新增資金用途', [
    { k: 'source_type', label: '資金來源', type: 'select', opts: [['borrowed', '借款'], ['own', '自有資金']] },
    { k: 'liability_id', label: '借款', type: 'select', opts: [['', '（請選擇）'], ...liabOptions()], nullable: true, when: 'source_type=borrowed' },
    { k: 'asset_id', label: '投入部位', type: 'select', opts: assetOptions(), req: true },
    { k: 'amount', label: '原幣金額', type: 'number' },
    { k: 'currency', label: '幣別', type: 'select', opts: [['', '（同投入部位）'], ...CCYS.map((c) => [c, `${c} ${CCY_NAMES[c]}`])], nullable: true },
    { k: 'link_date', label: '日期', type: 'date' },
    { k: 'source', label: '來源', wide: true },
    { k: 'confirm_status', label: '核實狀態', type: 'select', opts: [['pending', '待確認'], ['confirmed', '已確認']] },
    { k: 'note', label: '備註', type: 'textarea', wide: true },
  ], k ? { ...k, source_type: k.liability_id ? 'borrowed' : 'own' } : { source_type: 'borrowed' }, async (row) => {
    validNumbers(row, ['amount']);
    if (row.source_type === 'borrowed' && !row.liability_id) throw new Error('請選擇借款');
    if (row.source_type === 'own') row.liability_id = null;
    if (row.currency && !/^[A-Z]{3}$/.test(row.currency)) throw new Error('幣別請填三碼代號');
    await save('fin_funding_links', row, k && k.id);
  }, '', k ? async () => remove('fin_funding_links', k.id) : null);
}

// ============================================================
// 全資產總表：可信度、不動產課稅價值、文件（權狀／謄本／稅單）上傳與 AI 判讀
// 檔案放在 Supabase Storage 私有 bucket「fin-docs」，路徑 <業務員 uid>/<客戶ID>/<檔名>，只有上傳的人讀得到
// ============================================================
const DOC_KINDS = {
  land_deed: '土地所有權狀', bldg_deed: '建物所有權狀', land_transcript: '土地登記謄本', bldg_transcript: '建物登記謄本',
  house_tax: '房屋稅單', land_tax: '地價稅單', statement: '對帳單', other: '其他文件',
};
const docCount = (assetId) => (data.documents || []).filter((d) => d.asset_id === assetId).length;
const countVerify = (v) => data.assets.filter((a) => a.status !== 'archived' && (a.verify || 'estimate') === v).length;
const reMissing = () => data.assets.filter((a) => a.status !== 'archived' && RE_CATS.includes(a.category) && !C.reTaxValue(a).complete).length;
const yuan = (n) => Math.round(Number(n) || 0).toLocaleString('zh-TW');
function reChip(a) {
  const t = C.reTaxValue(a);
  return t.complete ? `<i>課稅價值 ${wan(C.D(t.total))}</i>` : '<i class="warn">缺課稅價值</i>';
}
const shareText = (n, d) => (Number(n) > 0 && Number(d) > 0 ? (Number(n) === Number(d) ? '全部' : `${d}分之${n}`) : '—');

function reSection(a) {
  const m = a.meta || {}, t = C.reTaxValue(a);
  const parcels = m.parcels || [], b = m.bldg;
  return `<div class="fin-form-sec">不動產資料與課稅價值</div>
    <p class="fin-note">遺產稅、贈與稅不用市價，而是用「公告土地現值 × 面積 × 權利範圍」加上「房屋評定現值」。公告土地現值在<b>土地登記謄本</b>上，房屋評定現值在<b>房屋稅單</b>（課稅現值）上，權狀上沒有。</p>
    ${parcels.length ? `<table class="fin-table"><thead><tr><th>土地</th><th class="num">面積㎡</th><th>權利範圍</th><th class="num">公告現值／㎡</th><th class="num">課稅價值</th></tr></thead><tbody>
      ${parcels.map((p) => { const ok = p.area_m2 > 0 && p.share_den > 0 && p.announced_value > 0;
        return `<tr><td>${esc([p.district, p.section].filter(Boolean).join(' '))} ${esc(p.lot_no || '')}地號</td><td class="num">${p.area_m2 || '—'}</td><td>${shareText(p.share_num, p.share_den)}</td>
        <td class="num">${p.announced_value ? yuan(p.announced_value) : '<em class="warn">缺</em>'}${p.announced_date ? `<div class="fin-mini-sub">${esc(p.announced_date)}</div>` : ''}</td>
        <td class="num">${ok ? yuan(p.area_m2 * p.share_num / p.share_den * p.announced_value) : '—'}</td></tr>`; }).join('')}</tbody></table>` : '<p class="fin-empty-row">尚無土地資料。</p>'}
    ${b ? `<table class="fin-table"><tbody><tr><td>建物 ${esc(b.bldg_no || '')}建號${b.address ? '・' + esc(b.address) : ''}</td><td>總面積 ${b.total_area_m2 || '—'}㎡（約 ${b.total_area_m2 ? (b.total_area_m2 * 0.3025).toFixed(2) : '—'} 坪）・權利範圍 ${shareText(b.share_num, b.share_den)}</td>
      <td class="num">房屋評定現值 ${b.tax_value ? yuan(b.tax_value) : '<em class="warn">缺</em>'}</td></tr></tbody></table>` : (a.category === 'house' ? '<p class="fin-empty-row">尚無建物資料。</p>' : '')}
    <div class="fin-re-total ${t.complete ? 'ok' : ''}">課稅價值合計 <b>${yuan(t.total)}</b> 元${t.complete ? '' : '<span>（資料未齊，遺產稅試算會改用市價）</span>'}</div>
    <div class="fin-form-actions"><span></span><button type="button" class="btn-secondary" id="fd-re">編輯不動產資料</button></div>`;
}

function docSection(a) {
  const docs = (data.documents || []).filter((d) => d.asset_id === a.id);
  return `<div class="fin-form-sec">文件</div>
    ${docs.length ? `<div class="fin-docs">${docs.map((d) => { const x = d.extracted || {};
      return `<div class="fin-doc"><div><b>${esc(DOC_KINDS[d.kind] || d.kind)}</b><small>${esc(d.file_name)}・${new Date(d.created_at).toLocaleDateString('zh-TW')}</small>
        ${x.summary ? `<p>${esc(x.summary)}</p>` : ''}${(x.warnings || []).length ? `<p class="warn">⚠ ${x.warnings.map(esc).join('；')}</p>` : ''}</div>
        <span><button type="button" class="link-btn" data-docview="${d.id}">開啟</button>
          ${RE_CATS.includes(a.category) ? `<button type="button" class="link-btn" data-docread="${d.id}">${d.read_at ? '重新判讀' : 'AI 判讀'}</button>${d.read_at ? `<button type="button" class="link-btn" data-docapply="${d.id}">套用</button>` : ''}` : ''}
          <button type="button" class="link-btn danger" data-docdel="${d.id}">刪除</button></span></div>`; }).join('')}</div>` : '<p class="fin-empty-row">尚無文件。可上傳權狀、謄本、稅單、對帳單（拍照或 PDF）。</p>'}
    <div class="fin-form-actions"><span></span><button type="button" class="btn-secondary" id="fd-doc">＋ 上傳文件</button></div>`;
}

function bindDocSection(a) {
  const f = $('fin-form');
  if ($('fd-re')) $('fd-re').onclick = () => reForm(a);
  $('fd-doc').onclick = () => pickFile(async (file) => {
    const doc = await uploadDoc(file, a.id);
    if (RE_CATS.includes(a.category)) await readAndApply(doc, a);
    else { if ((a.verify || 'estimate') === 'estimate') await save('fin_assets', { verify: 'doc' }, a.id); await reload(); assetDetail(a.id); }
  });
  f.querySelectorAll('[data-docview]').forEach((b) => b.onclick = () => viewDoc(b.dataset.docview));
  f.querySelectorAll('[data-docread]').forEach((b) => b.onclick = () => readAndApply(data.documents.find((d) => d.id === b.dataset.docread), a));
  f.querySelectorAll('[data-docapply]').forEach((b) => b.onclick = async () => { const d = data.documents.find((x) => x.id === b.dataset.docapply); await applyExtract(a, d.extracted); });
  f.querySelectorAll('[data-docdel]').forEach((b) => b.onclick = async () => {
    if (!confirm('刪除這份文件？（檔案會一併刪除）')) return;
    const d = data.documents.find((x) => x.id === b.dataset.docdel);
    await sb.storage.from('fin-docs').remove([d.file_path]);
    await remove('fin_documents', d.id); await reload(); assetDetail(a.id);
  });
}

function pickFile(cb) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*,application/pdf';
  inp.onchange = async () => {
    const file = inp.files && inp.files[0]; if (!file) return;
    try { setStatus('上傳中…'); await cb(file); } catch (e) { alert(e.message || e); } finally { showFxStatus(); }
  };
  inp.click();
}

// 手機照片常常 5～10MB：先縮到長邊 2400px、JPEG，AI 讀得清楚也傳得快
async function shrinkImage(file) {
  if (!/^image\//.test(file.type) || file.type === 'image/gif') return file;
  const img = await createImageBitmap(file).catch(() => null);
  if (!img) return file;
  const k = Math.min(1, 2400 / Math.max(img.width, img.height));
  if (k === 1 && file.size < 3.5e6 && file.type === 'image/jpeg') return file;
  const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.85));
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}

async function uploadDoc(file, assetId) {
  if (file.size > 25 * 1024 * 1024) throw new Error('檔案超過 25MB');
  const f = await shrinkImage(file);
  const { data: { user } } = await sb.auth.getUser();
  const ext = f.type === 'application/pdf' ? 'pdf' : (f.type.split('/')[1] || 'jpg');
  const path = `${user.id}/${client.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage.from('fin-docs').upload(path, f, { contentType: f.type });
  if (error) throw new Error('上傳失敗：' + error.message);
  const { data: row, error: e2 } = await sb.from('fin_documents').insert({ client_id: client.id, asset_id: assetId || null, file_path: path, file_name: file.name, mime: f.type, size: f.size }).select().single();
  if (e2) throw new Error('存檔失敗：' + e2.message);
  return row;
}
async function viewDoc(id) {
  const d = data.documents.find((x) => x.id === id);
  const { data: s, error } = await sb.storage.from('fin-docs').createSignedUrl(d.file_path, 300);
  if (error) { alert('開啟失敗：' + error.message); return; }
  window.open(s.signedUrl, '_blank', 'noopener');
}

async function aiRead(doc) {
  setStatus('AI 判讀中（約 20～60 秒）…');
  try { return (await callFn('fin-doc-read', { doc_id: doc.id })).extracted; }
  finally { showFxStatus(); }
}
async function readAndApply(doc, a) {
  let x;
  try { x = await aiRead(doc); } catch (e) { alert('AI 判讀失敗：' + (e.message || e) + '\n文件已保存，可稍後再按「AI 判讀」。'); await reload(); assetDetail(a.id); return; }
  await reload();
  await applyExtract(data.assets.find((q) => q.id === a.id), x);
}

// 把判讀結果合併進資產：土地依地號合併、建物覆寫有值的欄位、房屋稅單帶入評定現值
function mergeExtract(meta, x) {
  const m = { ...meta };
  const parcels = [...(m.parcels || [])];
  (x.land || []).forEach((p) => {
    const row = { district: p.district || '', section: p.section || '', lot_no: p.lot_no || '', area_m2: p.area_m2 || 0,
      share_num: (p.share && p.share.num) || 0, share_den: (p.share && p.share.den) || 0,
      announced_value: p.announced_value || 0, announced_date: p.announced_date || '', declared_price: p.declared_price || 0 };
    const i = parcels.findIndex((q) => q.lot_no && q.lot_no === row.lot_no && (q.section || '') === (row.section || ''));
    if (i < 0) parcels.push(row);
    else Object.keys(row).forEach((k) => { if (row[k]) parcels[i][k] = row[k]; });
  });
  if (parcels.length) m.parcels = parcels;
  const b = x.building;
  if (b && (b.bldg_no || b.total_area_m2)) {
    m.bldg = { ...(m.bldg || {}) };
    const add = { district: b.district, section: b.section, bldg_no: b.bldg_no, total_area_m2: b.total_area_m2, main_area_m2: b.main_area_m2, annex_area_m2: b.annex_area_m2,
      common_area_m2: b.common_area_m2, share_num: b.share && b.share.num, share_den: b.share && b.share.den, use: b.use, floors: b.floors, completed: b.completed };
    Object.entries(add).forEach(([k, v]) => { if (v) m.bldg[k] = v; });
  }
  if (x.address) { m.bldg = m.bldg || {}; if (!m.bldg.address) m.bldg.address = x.address; }
  if (x.house_tax && Number(x.house_tax.taxable_value) > 0) { m.bldg = m.bldg || {}; m.bldg.tax_value = Number(x.house_tax.taxable_value); m.bldg.tax_year = x.house_tax.year || ''; }
  return m;
}
function extractPreview(x) {
  const land = (x.land || []).map((p) => `<li>${esc(p.section || '')} ${esc(p.lot_no || '')}地號：${p.area_m2 || '?'}㎡，權利範圍 ${shareText(p.share && p.share.num, p.share && p.share.den)}${p.announced_value ? `，公告現值 ${yuan(p.announced_value)} 元／㎡` : ''}</li>`).join('');
  const b = x.building && (x.building.bldg_no || x.building.total_area_m2) ? `<li>建物 ${esc(x.building.bldg_no || '')}建號：總面積 ${x.building.total_area_m2 || '?'}㎡，權利範圍 ${shareText(x.building.share && x.building.share.num, x.building.share && x.building.share.den)}</li>` : '';
  const ht = x.house_tax && Number(x.house_tax.taxable_value) > 0 ? `<li>房屋稅單課稅現值 ${yuan(x.house_tax.taxable_value)} 元</li>` : '';
  return `<p><b>${esc(DOC_KINDS[x.doc_type] || '文件')}</b>${x.owner_name ? `・所有權人 ${esc(x.owner_name)}` : ''}${x.register_date ? `・${esc(x.register_reason || '登記')} ${esc(x.register_date)}` : ''}</p>
    ${x.summary ? `<p>${esc(x.summary)}</p>` : ''}<ul class="fin-ul">${land}${b}${ht}</ul>
    ${(x.warnings || []).length ? `<p class="warn">⚠ ${x.warnings.map(esc).join('；')}</p>` : ''}`;
}
async function applyExtract(a, x) {
  if (!x || !x.doc_type) { alert('這份文件還沒有判讀結果'); return; }
  const owner = x.owner_name && client.name && !x.owner_name.includes(client.name) ? `<p class="warn">⚠ 文件上的所有權人「${esc(x.owner_name)}」和客戶「${esc(client.name)}」不同，請確認。</p>` : '';
  $('fin-modal-title').textContent = 'AI 判讀結果';
  $('fin-form').innerHTML = `<div class="fin-detail">${extractPreview(x)}${owner}
    <p class="fin-note">AI 判讀可能出錯，套用前請對照原文件。套用後可在「編輯不動產資料」修改。</p>
    <div class="fin-form-actions"><button type="button" class="btn-secondary" id="fx-skip">先不要</button><button type="button" class="btn-primary" id="fx-apply">套用到「${esc(a.name)}」</button></div></div>`;
  $('fin-modal').hidden = false; onSubmit = null;
  $('fx-skip').onclick = () => assetDetail(a.id);
  $('fx-apply').onclick = async () => {
    const row = { meta: mergeExtract(a.meta || {}, x) };
    if ((a.verify || 'estimate') === 'estimate') row.verify = 'doc';
    await save('fin_assets', row, a.id);
    await reload(); toast('已套用'); assetDetail(a.id);
  };
}

// 先上傳權狀 → AI 判讀 → 自動建立一筆不動產
async function newAssetFromDoc(file) {
  const doc = await uploadDoc(file, null);
  let x;
  try { x = await aiRead(doc); } catch (e) { await reload(); throw new Error('AI 判讀失敗：' + (e.message || e) + '\n文件已保存，請先手動新增資產。'); }
  const isLand = ['land_deed', 'land_transcript', 'land_tax'].includes(x.doc_type) && !(x.building && x.building.bldg_no);
  const p0 = (x.land || [])[0];
  const name = x.address || (p0 ? `${p0.section || ''}${p0.lot_no || ''}地號` : '不動產');
  const meta = mergeExtract({}, x);
  if (p0 && p0.district) meta.region = p0.district;
  const { data: row, error } = await sb.from('fin_assets').insert({ client_id: client.id, category: isLand ? 'land' : 'house', name, currency: 'TWD', meta, verify: 'doc' }).select().single();
  if (error) throw new Error('建立資產失敗：' + error.message);
  await sb.from('fin_documents').update({ asset_id: row.id }).eq('id', doc.id);
  await reload(); section = 'assets'; render();
  assetDetail(row.id);
  toast(`已建立「${name}」，市價請按「新增估值」填寫`);
}

// 手動編輯土地與建物
function reForm(a) {
  const m = a.meta || {};
  const parcels = (m.parcels || []).map((p) => ({ ...p }));
  if (!parcels.length && a.category === 'land') parcels.push({});
  const b = { ...(m.bldg || {}) };
  const inp = (k, v, ph, type = 'text') => `<input data-k="${k}" type="${type}" value="${esc(v ?? '')}" placeholder="${ph}"${type === 'number' ? ' step="any" inputmode="decimal"' : ''}>`;
  const draw = () => {
    $('fin-form').innerHTML = `<div class="fin-detail">
      <div class="fin-form-sec">土地（每一筆地號一列）</div>
      <div class="fin-re-rows">${parcels.map((p, i) => `<div class="fin-re-row" data-i="${i}">
        ${inp('section', p.section, '地段')}${inp('lot_no', p.lot_no, '地號')}${inp('area_m2', p.area_m2, '面積㎡', 'number')}
        ${inp('share_num', p.share_num, '權利範圍分子', 'number')}${inp('share_den', p.share_den, '分母（全部填 1/1）', 'number')}
        ${inp('announced_value', p.announced_value, '公告土地現值 元/㎡', 'number')}<button type="button" class="link-btn danger" data-rm="${i}">刪</button></div>`).join('')}</div>
      <div class="fin-form-actions"><span></span><button type="button" class="btn-secondary" id="re-addp">＋ 加一筆土地</button></div>
      ${a.category === 'house' ? `<div class="fin-form-sec">建物</div>
      <div class="fin-re-row bldg">${inp('bldg_no', b.bldg_no, '建號')}${inp('address', b.address, '門牌')}${inp('total_area_m2', b.total_area_m2, '總面積㎡', 'number')}
        ${inp('share_num', b.share_num, '權利範圍分子', 'number')}${inp('share_den', b.share_den, '分母', 'number')}${inp('tax_value', b.tax_value, '房屋評定現值（稅單課稅現值，本人持分）', 'number')}</div>` : ''}
      <div class="fin-form-actions"><button type="button" class="btn-secondary" id="re-cancel">取消</button><button type="button" class="btn-primary" id="re-save">儲存</button></div></div>`;
    const collect = () => {
      document.querySelectorAll('.fin-re-row[data-i]').forEach((r) => { const p = parcels[r.dataset.i]; r.querySelectorAll('input').forEach((x) => { p[x.dataset.k] = x.type === 'number' ? (x.value === '' ? 0 : Number(x.value)) : x.value.trim(); }); });
      const br = document.querySelector('.fin-re-row.bldg');
      if (br) br.querySelectorAll('input').forEach((x) => { b[x.dataset.k] = x.type === 'number' ? (x.value === '' ? 0 : Number(x.value)) : x.value.trim(); });
    };
    $('re-addp').onclick = () => { collect(); parcels.push({}); draw(); };
    document.querySelectorAll('[data-rm]').forEach((x) => x.onclick = () => { collect(); parcels.splice(Number(x.dataset.rm), 1); draw(); });
    $('re-cancel').onclick = () => assetDetail(a.id);
    $('re-save').onclick = async () => {
      collect();
      const meta = { ...m, parcels: parcels.filter((p) => p.lot_no || p.area_m2) };
      if (a.category === 'house' && Object.values(b).some(Boolean)) meta.bldg = b; else delete meta.bldg;
      try { await save('fin_assets', { meta }, a.id); await reload(); toast('已儲存'); assetDetail(a.id); } catch (e) { alert('儲存失敗：' + e.message); }
    };
  };
  $('fin-modal-title').textContent = `${a.name}｜不動產資料`;
  $('fin-modal').hidden = false; onSubmit = null;
  draw();
}
