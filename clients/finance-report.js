// ============================================================
// 資產負債報表（A4 直式、民國年）：讀一份凍結的快照（fin_snapshots）
// 數字一律由快照存下的原始資料重算（行情、匯率、餘額都是存檔當下的），不讀最新行情
// 網址：finance-report.html?snap=<快照 id>；客戶專區 my/report.html 走 portal_report
// 版面：封面｜總覽｜資產明細｜負債明細｜估計可動用資金｜未來 12 個月收支日曆｜借款、擔保品與資金用途
// 每一節第一頁放大標，放不下自動分頁（續頁也保留大標與欄位列）
// ============================================================
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const C = FinCalc;
  const STOCK_SITE = 'https://eastonesd.github.io/eastone.stock/';
  const CATS = { cash: '活存／現金', deposit: '定存', fund: '基金', stock: '股票／ETF', mcn: '境外結構性商品', investment_policy: '投資型保單／年金', savings_policy: '儲蓄險', house: '房屋（含基地）', land: '土地', equity: '公司股權／未上市', vehicle: '車輛', other: '其他' };
  const LIAB = { mortgage: '房貸', policy_loan: '保單借款', securities_loan: '基金質借', other: '其他借款' };
  const PURPOSE = { hot: '熱錢', cold: '冷錢', none: '未分類' };
  const RESTRICT = { none: '未設限', pledged: '質押', locked: '鎖定', repay: '需還款解押', unknown: '待確認' };
  const ST = { unvalued: '未估值・未納入', no_fx: '缺匯率・未納入', no_currency: '缺幣別', net_unreconciled: '扣貸口徑待核對', no_balance: '未填餘額・未納入' };
  const CCY = { TWD: '台幣', USD: '美元', JPY: '日圓', ZAR: '南非幣', EUR: '歐元', CNY: '人民幣', AUD: '澳幣', HKD: '港幣', GBP: '英鎊' };
  const US_NAME = { AVGO: '博通', ORCL: '甲骨文', NKE: 'Nike', SMCI: '美超微', HOOD: 'Robinhood', UBER: 'Uber', CMCM: '獵豹移動', NVDA: '輝達', AAPL: '蘋果', MSFT: '微軟', TSLA: '特斯拉', GOOGL: 'Alphabet', AMZN: '亞馬遜', META: 'Meta', TSM: '台積電 ADR', AMD: '超微', SOXX: '半導體 ETF', QQQ: '那斯達克 100 ETF', SPY: '標普 500 ETF' };

  // ---------- 格式 ----------
  const N = (b) => (b === null || b === undefined ? null : C.toNum(b));
  const dp = (ccy) => (['TWD', 'JPY'].includes(ccy) ? 0 : 2);
  const fmt = (big, ccy = 'TWD') => (big === null || big === undefined ? '—' : N(big).toLocaleString('zh-TW', { minimumFractionDigits: dp(ccy), maximumFractionDigits: dp(ccy) }));
  const num = (x, d = 0) => Number(x).toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d });
  const units = (q) => { const v = Number(q); return Number.isFinite(v) ? v.toLocaleString('zh-TW', { maximumFractionDigits: 4 }) : ''; };
  const roc = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return y ? `${y - 1911}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}` : ''; };
  const rocLong = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return `民國 ${y - 1911} 年 ${m} 月 ${d} 日`; };
  // 文字裡的西元日期一律改成民國（例：對帳單 2026/11/12、20260512 進場）
  const rocText = (s) => String(s || '')
    .replace(/(19|20)(\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})/g, (m, a, b, mm, dd) => `${Number(a + b) - 1911}/${mm.padStart(2, '0')}/${dd.padStart(2, '0')}`)
    .replace(/\b(19|20)(\d{2})(\d{2})(\d{2})\b/g, (m, a, b, mm, dd) => `${Number(a + b) - 1911}/${mm}/${dd}`);
  const srcShort = (s) => (/東石診股/.test(s || '') ? '東石診股' : /對帳單/.test(s || '') ? '對帳單' : rocText(s || '').replace(/（手動）/, ''));
  const pctOf = (a, b) => (b ? `${(N(a) / N(b) * 100).toFixed(1)}%` : '—');
  const todayIso = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

  let SNAP, P, R, A, AVX, ASSET, LIABS, AGENT, CLIENT, TODAY;

  // ---------- 版面（與家辦報告相同：固定 A4，放不下就分頁，續頁保留大標與欄位列） ----------
  let pageNo = 0;
  function page(eyebrow, title, body, opts = {}) {
    pageNo += 1;
    return `<section class="page${opts.cls ? ' ' + opts.cls : ''}" data-flow="0"${opts.key ? ` data-key="${opts.key}"` : ''}>
      <header class="pg-head"><span>EASTONE｜資產負債報表</span><span>${esc(CLIENT.name)}　基準日 ${roc(P.asOf)}</span></header>
      <div class="pg-title"><div class="pg-num">${String(pageNo).padStart(2, '0')}</div><div><div class="pg-eyebrow">${eyebrow}</div><h2>${title}</h2></div></div>
      ${opts.need ? `<div class="pg-need">${opts.need}</div>` : ''}
      ${opts.thead ? `<table class="rp-table fb-t fb-head ${opts.tcls || ''}">${opts.thead}</table>` : ''}
      <div class="pg-body"><div class="pg-fit">${body}</div></div>
      <footer class="pg-foot"><span>本報表依客戶提供之資料與存檔當下的行情整理，金額為估算、僅供規劃參考，不構成投資建議或收益保證。</span><span>${pageNo}</span></footer>
    </section>`;
  }
  const overflow = (pg) => pg.querySelector('.pg-fit').getBoundingClientRect().height > pg.querySelector('.pg-body').getBoundingClientRect().height + 0.5;
  function contPage(first) {
    const pg = first.cloneNode(true);
    pg.querySelector('.pg-need')?.remove();
    const h = pg.querySelector('.pg-title h2'); if (h && !/（續）$/.test(h.textContent)) h.textContent += '（續）';
    pg.querySelector('.pg-fit').innerHTML = '';
    return pg;
  }
  function paginate(first) {
    const items = [...first.querySelector('.pg-fit').children];
    const pages = [first];
    let pg = first, fit = pg.querySelector('.pg-fit');
    fit.innerHTML = '';
    while (items.length) {
      const it = items.shift();
      fit.appendChild(it);
      if (!overflow(pg) || fit.children.length === 1) continue;
      it.remove();
      pg = contPage(first); fit = pg.querySelector('.pg-fit');
      pages[pages.length - 1].after(pg); pages.push(pg);
      items.unshift(it);
    }
    return pages;
  }
  function layout() {
    const root = document.documentElement, old = root.style.getPropertyValue('--rp-scale');
    root.style.setProperty('--rp-scale', '1');
    document.querySelectorAll('.page[data-flow]').forEach((first) => paginate(first));
    [...document.querySelectorAll('.rp-pages > .page')].forEach((p, i) => {
      const n = p.querySelector('.pg-num'); if (n) n.textContent = String(i + 1).padStart(2, '0');
      const f = p.querySelector('.pg-foot span:last-child'); if (f) f.textContent = i + 1;
    });
    if (old) root.style.setProperty('--rp-scale', old);
  }
  const fitScreen = () => document.documentElement.style.setProperty('--rp-scale', (Math.min(window.innerWidth - 16, 794) / 794).toFixed(4));

  // 一列一個小表格（欄寬固定），分頁時才能逐列切開、欄位仍對齊
  const cols = (w) => `<colgroup>${w.map((x) => `<col style="width:${x}">`).join('')}</colgroup>`;
  const tbl = (w, rows, cls = '') => `<table class="rp-table fb-t ${cls}">${cols(w)}<tbody>${rows}</tbody></table>`;
  const group = (label, extra = '') => `<div class="fb-group"><b>${label}</b>${extra ? `<span>${extra}</span>` : ''}</div>`;

  // ---------- 資產敘述 ----------
  const meta = (a) => (a && a.meta) || {};
  const fundName = (a) => meta(a).fund_name || a.name;
  function assetTitle(a) {
    const m = meta(a), inst = a.institution || '';
    switch (a.category) {
      case 'cash': case 'deposit': case 'mcn': case 'other': return `<b>${esc(inst)}</b>　${esc(a.name)}`;
      case 'fund': return `${esc(fundName(a))}`;
      case 'stock': { const generic = /^(股票|股市|ETF)$/.test(a.name.trim()); return `<b>${esc(inst)}</b>　${esc(a.identifier || '')}　${generic ? (US_NAME[a.identifier] || '') : esc(a.name)}`; }
      case 'savings_policy': case 'investment_policy': return `<b>${esc(inst)}</b>　${esc(a.name)}${m.product ? `　${esc(m.product)}` : ''}${a.policy_ref && a.category === 'investment_policy' ? `<span class="code">保單 ${esc(a.policy_ref)}</span>` : ''}`;
      default: return esc(a.name);
    }
  }
  function assetSub(a, row) {
    const m = meta(a), bits = [];
    if (a.category === 'fund') { bits.push(`<b>${esc(a.institution)}</b>`); if (a.name !== fundName(a)) bits.push(`帳號 ${esc(a.name)}`); }
    if (m.buy_date) bits.push(`申購 ${roc(m.buy_date)}`);
    if (['fund', 'stock', 'mcn'].includes(a.category) && a.quantity != null) bits.push(`${units(a.quantity)} ${a.category === 'stock' ? '股' : '單位'}`);
    if (a.category === 'deposit') { if (m.start || m.end) bits.push(`${roc(m.start)}～${roc(m.end)}`); if (m.interest) bits.push(esc(m.interest)); }
    if (a.policy_ref && a.category !== 'investment_policy') bits.push(`保單 ${esc(a.policy_ref)}`);
    if (a.category === 'mcn' && m.fcn) bits.push(`到期 ${roc(m.fcn.final)}・年息 ${(m.fcn.coupon * 100).toFixed(1)}%`);
    return bits.join('・');
  }

  // ---------- 1 封面 ----------
  function cover() {
    const bs = R.bs;
    return `<section class="page cover">
      <div class="cv-top">
        <div class="cv-brand"><img src="../icons/logo.png?v=3" alt=""><div><b>EASTONE</b><span>東石家族辦公室</span></div></div>
        <div class="cv-eyebrow">BALANCE SHEET REPORT</div>
        <h1>資產負債報表</h1>
        <div class="cv-client">${esc(CLIENT.name)}</div>
        <div class="cv-meta">資料基準日 ${rocLong(P.asOf)}　報表產生 ${rocLong(TODAY)}</div>
      </div>
      <div class="cv-body">
        <div class="cv-kpis">
          <div><span>淨資產</span><b>${fmt(bs.net)}</b><em>元</em></div>
          <div><span>估計可動用資金</span><b>${fmt(AVX.total)}</b><em>元</em></div>
          <div><span>資產合計</span><b>${fmt(bs.assetsTotal)}</b><em>元</em></div>
          <div><span>負債合計（含試算利息）</span><b>${fmt(bs.liabTotal)}</b><em>元</em></div>
        </div>
        <div class="cv-say">「把散在各銀行、保險公司的資產與借款放在同一張表上，才看得清楚真正能動用多少、每個月進出多少。」</div>
        <div class="cv-contents">${['總覽', '資產明細', '負債明細', '估計可動用資金', '未來 12 個月收支', '借款與擔保品'].map((t, i) => `<div><b>${String(i + 1).padStart(2, '0')}</b>${t}</div>`).join('')}</div>
        <div class="cv-agent"><div><span>服務業務員</span><b>${esc(AGENT ? AGENT.name : '—')}</b>${AGENT && AGENT.license ? `<small>壽險登錄 ${esc(AGENT.license)}</small>` : ''}</div>
          <div><span>客戶</span><b>${esc(CLIENT.name)}</b></div></div>
        <p class="cv-note">金額以新臺幣表示（外幣依存檔當日參考匯率換算），日期以民國年表示。本報表為存檔當下的凍結版本，僅供財務整理與規劃參考。</p>
      </div>
    </section>`;
  }

  // ---------- 2 總覽 ----------
  function overview() {
    const bs = R.bs;
    // 投資型保單底下的標的歸回「投資型保單」，與資產明細的分類一致
    const byCat = {};
    bs.assetRows.filter((r) => r.counted && r.status === 'ok').forEach((r) => { const a = ASSET.get(r.id) || {}; const p = a.parent_id && ASSET.get(a.parent_id); const k = p && p.category === 'investment_policy' ? 'investment_policy' : r.category; byCat[k] = (byCat[k] || 0n) + r.base; });
    const cats = Object.keys(CATS).filter((k) => byCat[k]).map((k) => ({ k, v: byCat[k] })).sort((a, b) => (b.v > a.v ? 1 : -1));
    const max = cats.length ? cats[0].v : 1n;
    const fxUsed = new Map();
    [...bs.assetRows, ...bs.liabRows].forEach((x) => { if (x.fx && x.fx.date && x.currency !== 'TWD') fxUsed.set(x.currency, x.fx); });
    const miss = [];
    Object.values(bs.missing).forEach((arr) => arr.forEach((x) => miss.push(`${x.name || '（未命名）'}：${ST[x.status] || '待補'}`)));
    const liabCats = {};
    bs.liabRows.filter((r) => r.status === 'ok').forEach((r) => { liabCats[r.category] = (liabCats[r.category] || 0n) + r.base; });
    return page('SUMMARY', '總覽', `
      <div class="fr-kpis fb-kpis">
        <div><span>資產合計</span><b>${fmt(bs.assetsTotal)}</b><em>已估值 ${bs.valuedCount} 項</em></div>
        <div><span>負債合計</span><b>${fmt(bs.liabTotal)}</b><em>本金＋試算未付利息</em></div>
        <div class="em"><span>淨資產</span><b>${fmt(bs.net)}</b><em>負債比 ${pctOf(bs.liabTotal, bs.assetsTotal)}</em></div>
        <div><span>估計可動用資金</span><b>${fmt(AVX.total)}</b><em>熱錢扣除解押須償還的借款</em></div>
      </div>
      <h3>資產配置</h3>
      <div class="fb-bars">${cats.map((c) => `<div><span>${CATS[c.k]}</span><i><em style="width:${(N(c.v) / N(max) * 100).toFixed(1)}%"></em></i><b>${fmt(c.v)}</b><small>${pctOf(c.v, bs.assetsTotal)}</small></div>`).join('')}</div>
      <div class="cols2">
        <div><h3>冷錢／熱錢</h3><table class="rp-table"><thead><tr><th>用途</th><th class="num">台幣</th><th class="num">占比</th></tr></thead><tbody>
          ${['hot', 'cold', 'none'].filter((k) => bs.byPurpose[k]).map((k) => `<tr><td>${PURPOSE[k]}</td><td class="num">${fmt(bs.byPurpose[k])}</td><td class="num">${pctOf(bs.byPurpose[k], bs.assetsTotal)}</td></tr>`).join('')}
          <tr><td>熱錢中受質押限制</td><td class="num">${fmt(AVX.restricted)}</td><td class="num">${pctOf(AVX.restricted, bs.assetsTotal)}</td></tr></tbody></table></div>
        <div><h3>負債組成</h3><table class="rp-table"><thead><tr><th>類別</th><th class="num">台幣</th><th class="num">占比</th></tr></thead><tbody>
          ${Object.entries(liabCats).map(([k, v]) => `<tr><td>${LIAB[k] || k}</td><td class="num">${fmt(v)}</td><td class="num">${pctOf(v, bs.liabTotal)}</td></tr>`).join('') || '<tr><td colspan="3">無負債</td></tr>'}</tbody></table></div>
      </div>
      <div class="cols2">
        <div><h3>幣別分布（原幣）</h3><table class="rp-table"><thead><tr><th>幣別</th><th class="num">資產</th><th class="num">負債</th></tr></thead><tbody>
          ${Object.entries(bs.byCcy).map(([k, v]) => `<tr><td>${CCY[k] || k}</td><td class="num">${fmt(v.assets, k)}</td><td class="num">${fmt(v.liabilities, k)}</td></tr>`).join('')}</tbody></table></div>
        <div><h3>換算匯率</h3><table class="rp-table"><thead><tr><th>幣別</th><th class="num">1 外幣＝台幣</th><th class="nw">日期</th></tr></thead><tbody>
          ${[...fxUsed.entries()].map(([k, f]) => `<tr><td>${CCY[k] || k}</td><td class="num">${N(f.rate)}</td><td class="nw">${roc(f.date)}</td></tr>`).join('') || '<tr><td colspan="3">僅台幣</td></tr>'}</tbody></table>
          <p class="rp-note">臺灣銀行牌告等參考匯率，僅供估值，不代表實際換匯成交價。</p></div>
      </div>
      ${cashBox()}
      <p class="rp-note">股票為最近收盤價、基金為最新公告淨值，不是即時行情；成本與保額不作為現值；投資型保單的價值＝所連結標的現值加總。</p>
      ${miss.length ? `<p class="rp-note warn">未納入總額、待補資料：${miss.map(esc).join('；')}</p>` : '<p class="rp-note">資料完整：所有部位均已估值並換算。</p>'}`, { key: 'overview' });
  }

  // 未來 12 個月收支（約當台幣）
  function cash12() {
    let tin = 0n, tout = 0n;
    (R.upcoming || []).forEach((u) => { const v = u.amount === null ? null : C.toBase(u.amount, u.currency, P.fx || [], P.asOf).value; if (v === null) return; if (u.direction === 'in') tin += v; else tout += v; });
    return { tin, tout, net: tin - tout };
  }
  function cashBox() {
    const c = cash12();
    if (!c.tin && !c.tout) return '';
    return `<h3>未來 12 個月收支</h3><div class="rp-sum fb-sum"><div><span>預計收入</span><b>${fmt(c.tin)}</b></div><div><span>預計支出</span><b>${fmt(c.tout)}</b></div>
      <div><span>淨額</span><b class="${c.net < 0n ? 'out' : 'in'}">${c.net < 0n ? '−' : '+'}${fmt(c.net < 0n ? -c.net : c.net)}</b></div><div><span>平均每月淨額</span><b class="${c.net < 0n ? 'out' : 'in'}">${c.net < 0n ? '−' : '+'}${fmt((c.net < 0n ? -c.net : c.net) / 12n)}</b></div></div>`;
  }

  // ---------- 3 資產明細 ----------
  const AW = ['41%', '6%', '15%', '11%', '9%', '10%', '8%'];
  function assetsPage() {
    const rows = R.bs.assetRows;
    const rowOf = new Map(rows.map((r) => [r.id, r]));
    const kidsOf = (id) => P.assets.filter((a) => a.parent_id === id && a.status !== 'archived');
    const isKid = (a) => a.parent_id && ASSET.get(a.parent_id) && ASSET.get(a.parent_id).category === 'investment_policy';
    const sortKey = (a) => `${a.institution || ''}|${a.category === 'fund' ? fundName(a) : ''}|${a.name}`;
    const status = (a, r) => {
      const bits = [];
      if (r.restriction !== 'none' || ['cash', 'deposit', 'fund', 'stock', 'mcn', 'investment_policy'].includes(a.category)) bits.push(`<span class="fb-st ${r.restriction === 'none' ? '' : 'lock'}">${RESTRICT[r.restriction] || r.restriction}</span>`);
      if (ST[r.status]) bits.push(`<span class="warn">${ST[r.status]}</span>`);
      return bits.join(' ');
    };
    const line = (a, r, kids) => {
      const val = r.status === 'funds_sum' ? r.fundsTotal : r.base;
      const vd = r.valueDate || (kids && kids.length ? (rowOf.get(kids[0].id) || {}).valueDate : '');
      const vs = r.valueSource || (kids && kids.length ? (rowOf.get(kids[0].id) || {}).valueSource : '');
      const kidRows = kids ? kids.map((k) => { const kr = rowOf.get(k.id) || {}; return `<tr class="kid"><td>${esc(fundName(k))}<span class="code">${units(k.quantity)} 單位</span></td><td></td>
        <td class="num">${fmt(kr.original, k.currency)}<small class="ccy">${CCY[k.currency] || k.currency}</small></td><td class="num">${fmt(kr.base)}</td><td class="nw">${roc(kr.valueDate)}</td><td class="src">${esc(srcShort(kr.valueSource))}</td><td></td></tr>`; }).join('') : '';
      return `<tr class="${kidRows ? 'has-kids' : ''}"><td>${assetTitle(a)}${assetSub(a, r) ? `<div class="sub">${assetSub(a, r)}</div>` : ''}</td>
        <td class="c">${r.purpose === 'none' ? '—' : PURPOSE[r.purpose]}</td>
        <td class="num">${r.status === 'funds_sum' ? '' : r.original !== null ? `${fmt(r.original, a.currency)}<small class="ccy">${CCY[a.currency] || a.currency}</small>` : '—'}</td>
        <td class="num">${r.status === 'funds_sum' ? `<b>${fmt(val)}</b>` : fmt(val)}</td>
        <td class="nw">${kidRows ? '' : roc(vd)}</td><td class="src">${kidRows ? '' : esc(srcShort(vs))}</td><td>${status(a, r)}</td></tr>${kidRows}`;
    };
    let body = '';
    Object.keys(CATS).forEach((cat) => {
      const list = P.assets.filter((a) => a.category === cat && a.status !== 'archived' && !isKid(a)).sort((x, y) => (sortKey(x) < sortKey(y) ? -1 : 1));
      if (!list.length) return;
      const tot = list.reduce((s, a) => { const r = rowOf.get(a.id); const v = r && (r.status === 'funds_sum' ? r.fundsTotal : r.counted && r.status === 'ok' ? r.base : null); return v ? s + v : s; }, 0n);
      list.forEach((a, i) => {
        const r = rowOf.get(a.id); if (!r) return;
        const kids = a.category === 'investment_policy' ? kidsOf(a.id) : null;
        body += `<div class="fb-item">${i === 0 ? group(CATS[cat], `${list.length} 項・小計 ${fmt(tot)}`) : ''}${tbl(AW, line(a, r, kids))}</div>`;
      });
    });
    body += `<div class="fb-item">${tbl(AW, `<tr class="total"><td>資產合計</td><td></td><td></td><td class="num">${fmt(R.bs.assetsTotal)}</td><td colspan="3"></td></tr>`)}</div>`;
    return page('ASSETS', '資產明細', body, { thead: `${cols(AW)}<thead><tr><th>項目</th><th class="c">用途</th><th class="num">原幣現值</th><th class="num">台幣</th><th class="nw">估值日</th><th>估值來源</th><th>狀態</th></tr></thead>` });
  }

  // ---------- 4 負債明細 ----------
  const LW = ['47%', '14%', '14%', '14%', '11%'];
  function liabPage() {
    const rows = R.bs.liabRows.slice().sort((a, b) => ((a.category + a.institution + a.name) < (b.category + b.institution + b.name) ? -1 : 1));
    let body = '';
    let lastCat = null;
    rows.forEach((r) => {
      const l = LIABS.get(r.id) || {};
      const head = r.category !== lastCat ? group(LIAB[r.category] || '其他借款') : '';
      lastCat = r.category;
      const sub = [l.rate != null && l.rate !== '' ? `年利率 ${Number(l.rate)}%` : '', l.frequency ? `${esc(l.frequency)}繳息` : '', l.maturity ? `到期 ${roc(l.maturity)}` : '', l.credit_limit ? `額度 ${num(l.credit_limit)}` : '', r.currency !== 'TWD' ? CCY[r.currency] || r.currency : ''].filter(Boolean).join('・');
      body += `<div class="fb-item">${head}${tbl(LW, `<tr><td><b>${esc(r.institution)}</b>　${esc(r.name)}${sub ? `<div class="sub">${sub}</div>` : ''}</td>
        <td class="num">${fmt(r.principal, r.currency)}</td>
        <td class="num">${fmt(r.interest, r.currency)}${r.interestEstimated ? `<div class="sub">自 ${roc(r.interestFrom)} 起試算</div>` : ''}</td>
        <td class="num">${fmt(r.base)}</td><td class="nw">${roc(r.balanceDate)}</td></tr>`)}</div>`;
    });
    body += `<div class="fb-item">${tbl(LW, `<tr class="total"><td>負債合計</td><td></td><td></td><td class="num">${fmt(R.bs.liabTotal)}</td><td></td></tr>`)}</div>`;
    body += `<p class="rp-note">未付利息＝資料更新日記錄的未付利息，加上依年利率按日試算到基準日（${roc(P.asOf)}）的利息；上次繳息日在資料更新日之後者，自上次繳息日起算。實際金額以銀行、保險公司通知為準。</p>`;
    return page('LIABILITIES', '負債明細', body, { thead: `${cols(LW)}<thead><tr><th>借款</th><th class="num">剩餘本金</th><th class="num">未付利息（試算）</th><th class="num">台幣合計</th><th class="nw">資料更新日</th></tr></thead>` });
  }

  // ---------- 5 估計可動用資金 ----------
  // 熱錢部位分成「未設限」與「質押」：質押部位依擔保關聯分群，每群須清償對應借款本息後才能解押
  // 每群解押後可動用＝擔保品市值－應還本息（不足以 0 計，不拿別群去補）
  function availModel() {
    const bs = R.bs;
    const parent = new Map();
    const find = (x) => { while (parent.get(x) !== x) x = parent.get(x); return x; };
    const node = (x) => { if (!parent.has(x)) parent.set(x, x); };
    bs.assetRows.forEach((r) => node('A' + r.id)); bs.liabRows.forEach((r) => node('L' + r.id));
    (P.collateralLinks || []).forEach((k) => { if (parent.has('A' + k.asset_id) && parent.has('L' + k.liability_id)) { const x = find('A' + k.asset_id), y = find('L' + k.liability_id); if (x !== y) parent.set(x, y); } });
    const hot = bs.assetRows.filter((r) => r.purpose === 'hot' && r.counted && r.status === 'ok');
    const free = [], tied = new Map();
    hot.forEach((r) => {
      const g = find('A' + r.id); const ls = bs.liabRows.filter((l) => find('L' + l.id) === g);
      if (ls.length && r.restriction !== 'none') { if (!tied.has(g)) tied.set(g, { rows: [], liabs: ls }); tied.get(g).rows.push(r); } else free.push(r);
    });
    const groups = [...tied.values()].map((g) => {
      const sumV = g.rows.reduce((s, r) => s + r.base, 0n);
      const ready = g.liabs.every((l) => l.status === 'ok');
      const need = g.liabs.reduce((s, l) => s + (l.base || 0n), 0n);
      const net = ready && sumV > need ? sumV - need : 0n;
      return { ...g, sumV, need, net, ready, key: g.liabs.map((l) => l.name).sort().join() };
    }).sort((x, y) => (x.key < y.key ? -1 : 1));
    const freeTotal = free.reduce((s, r) => s + r.base, 0n);
    const tiedNet = groups.reduce((s, g) => s + g.net, 0n);
    const pending = groups.filter((g) => !g.ready).reduce((s, g) => s + g.sumV, 0n);
    return { free, groups, freeTotal, tiedNet, total: freeTotal + tiedNet, pending, restricted: groups.reduce((s, g) => s + g.sumV, 0n) };
  }
  const VW = ['58%', '11%', '17%', '14%'];
  function availPage() {
    const AV = AVX;
    const posLabel = (a) => {
      if (a.category === 'fund') return `<b>${esc(a.institution)}</b>　${esc(fundName(a))}${a.name !== fundName(a) ? `<span class="code">${esc(a.name)}</span>` : ''}`;
      return assetTitle(a);
    };
    const buy = (a) => roc(meta(a).buy_date);
    const ORDER = ['cash', 'deposit', 'mcn', 'fund', 'stock', 'investment_policy', 'savings_policy', 'other'];
    const polOf = (a) => { const p = a.parent_id && ASSET.get(a.parent_id); return p && p.category === 'investment_policy' ? p : null; };
    let body = '';
    ORDER.forEach((cat) => {
      const list = AV.free.filter((r) => { const a = ASSET.get(r.id) || {}; return (polOf(a) ? 'investment_policy' : a.category) === cat; });
      if (!list.length) return;
      let lines;
      if (cat === 'investment_policy') {
        const byPol = new Map();
        list.forEach((r) => { const p = polOf(ASSET.get(r.id)); if (!byPol.has(p.id)) byPol.set(p.id, { p, rs: [] }); byPol.get(p.id).rs.push(r); });
        lines = [...byPol.values()].map(({ p, rs }) => ({ html: `<b>${esc(p.institution)}</b>　${esc(p.name)}${p.policy_ref ? `<span class="code">保單 ${esc(p.policy_ref)}</span>` : ''}<div class="sub">連結標的：${rs.map((r) => esc(fundName(ASSET.get(r.id)))).join('、')}</div>`, buy: buy(p), v: rs.reduce((s, r) => s + r.base, 0n), st: '未設限', key: `${p.institution}${p.name}${p.policy_ref || ''}` }));
      } else {
        lines = list.map((r) => { const a = ASSET.get(r.id) || {}; return { html: posLabel(a), buy: buy(a), v: r.base, st: RESTRICT[r.restriction], key: `${a.institution}|${a.category === 'stock' ? a.identifier : fundName(a)}|${meta(a).buy_date || ''}|${a.name}` }; });
      }
      lines.sort((x, y) => (x.key < y.key ? -1 : 1));
      const sub = lines.reduce((s, x) => s + x.v, 0n);
      lines.forEach((x, i) => { body += `<div class="fb-item">${i === 0 ? group(CATS[cat], `小計 ${fmt(sub)}`) : ''}${tbl(VW, `<tr><td>${x.html}</td><td class="nw">${x.buy}</td><td class="num">${fmt(x.v)}</td><td><span class="fb-st">${x.st}</span></td></tr>`)}</div>`; });
    });
    AV.groups.forEach((g) => {
      const ln = g.liabs.map((l) => `${esc(l.institution)} ${esc(l.name)}`).join('、');
      g.rows.slice().sort((x, y) => ((ASSET.get(x.id) || {}).name < (ASSET.get(y.id) || {}).name ? -1 : 1)).forEach((r, i) => {
        const a = ASSET.get(r.id) || {};
        body += `<div class="fb-item">${i === 0 ? group(`質押｜${ln}`, `應還本息 ${fmt(g.need)}`) : ''}${tbl(VW, `<tr><td>${posLabel(a)}</td><td class="nw">${buy(a)}</td><td class="num">${fmt(r.base)}</td><td><span class="fb-st lock">${RESTRICT[r.restriction]}</span></td></tr>`)}</div>`;
      });
      body += `<div class="fb-item">${tbl(VW, `<tr class="fb-calc em"><td>擔保品 ${fmt(g.sumV)} − 應還本息 ${fmt(g.need)}${g.sumV < g.need ? '（擔保品不足以清償，以 0 計）' : ''}</td><td class="nw">解押後</td><td class="num">${g.ready ? fmt(g.net) : '待確認'}</td><td></td></tr>`)}</div>`;
    });
    body += `<div class="fb-item">${tbl(VW, `<tr class="total"><td>未設限部位合計</td><td></td><td class="num">${fmt(AV.freeTotal)}</td><td></td></tr>
      ${AV.groups.length ? `<tr class="total"><td>質押部位解押後合計（${AV.groups.length} 組）</td><td></td><td class="num">${fmt(AV.tiedNet)}</td><td></td></tr>` : ''}
      <tr class="total grand"><td>估計可動用資金</td><td></td><td class="num">${fmt(AV.total)}</td><td></td></tr>`)}</div>`;
    if (AV.pending) body += `<p class="rp-note warn">另有 ${fmt(AV.pending)} 元的質押部位借款餘額未填，未計入。</p>`;
    body += `<p class="rp-note">只計入標示為「熱錢」的部位；冷錢（房屋、儲蓄險等）不列入。質押部位須先清償對應借款本息才能解押，各組分開計算。可動用資金為估計值，不是銀行承諾的可提領金額；贖回、解約可能另有費用與入帳天數。</p>`;
    return page('LIQUIDITY', '估計可動用資金', body, { thead: `${cols(VW)}<thead><tr><th>部位</th><th class="nw">申購日</th><th class="num">估計金額（台幣）</th><th>狀態</th></tr></thead>` });
  }

  // ---------- 6 未來 12 個月收支日曆 ----------
  const CW = ['13%', '57%', '16%', '14%'];
  function calItem(u) {
    const l = u.liability_id && LIABS.get(u.liability_id);
    if (u.kind === 'loan_interest' && l) return `借款利息｜<b>${esc(l.institution)}</b> ${esc(l.name)}${LIAB[l.category] ? `（${LIAB[l.category]}）` : ''}`;
    const a = u.asset_id && ASSET.get(u.asset_id);
    if (u.kind === 'survival' && a) return `生存金｜<b>${esc(a.institution)}</b> ${esc(a.name)}`;
    const t = rocText(u.note || u.label);
    const [h, ...rest] = t.split('｜');
    return rest.length ? `${esc(h)}｜${esc(rest.join('｜'))}` : esc(t);
  }
  function calendarPage() {
    const fx = P.fx || [];
    const toTwd = (amt, ccy) => (amt === null ? null : C.toBase(amt, ccy, fx, P.asOf).value);
    const months = new Map();
    (R.upcoming || []).forEach((u) => { const k = u.date.slice(0, 7); if (!months.has(k)) months.set(k, []); months.get(k).push(u); });
    let body = '';
    let tin = 0n, tout = 0n;
    [...months.entries()].forEach(([k, list]) => {
      let mi = 0n, mo = 0n;
      const rows = list.map((u) => {
        const twd = toTwd(u.amount, u.currency);
        if (twd !== null) { if (u.direction === 'in') mi += twd; else mo += twd; }
        const calc = u.calc && u.calc.parts ? `<div class="sub">依 ${u.calc.parts.length} 筆持有單位數 × 每單位配息試算</div>` : '';
        return `<tr><td class="nw">${roc(u.date)}</td><td>${calItem(u)}${calc}</td>
          <td class="num ${u.direction === 'in' ? 'in' : 'out'}">${u.direction === 'in' ? '+' : '−'}${u.amount === null ? '金額未定' : fmt(u.amount, u.currency)}<small class="ccy">${CCY[u.currency] || u.currency}</small></td>
          <td class="num">${twd === null ? '—' : (u.direction === 'in' ? '+' : '−') + fmt(twd)}</td></tr>`;
      });
      tin += mi; tout += mo;
      const [y, m] = k.split('-').map(Number);
      const net = mi - mo;
      rows.forEach((row, i) => { body += `<div class="fb-item">${i === 0 ? group(`${y - 1911} 年 ${m} 月`, `收入 ${fmt(mi)}・支出 ${fmt(mo)}・淨額 <b class="${net < 0n ? 'out' : 'in'}">${net < 0n ? '−' : '+'}${fmt(net < 0n ? -net : net)}</b>`) : ''}${tbl(CW, row)}</div>`; });
    });
    const net = tin - tout;
    body += `<div class="fb-item">${tbl(CW, `<tr class="total"><td colspan="2">12 個月合計　收入 ${fmt(tin)}・支出 ${fmt(tout)}</td><td></td><td class="num">${net < 0n ? '−' : '+'}${fmt(net < 0n ? -net : net)}</td></tr>`)}</div>`;
    body += `<p class="rp-note">期間 ${roc(P.asOf)}～${roc(R.upcomingTo)}。外幣依基準日匯率約當台幣；基金配息依持有單位數 × 最近一次每單位配息試算，實際依基金公告為準；周年繳息依目前本金估算。</p>`;
    return page('CASH CALENDAR', '未來 12 個月收支日曆', body || '<p class="rp-empty">尚無收支排程。</p>', { thead: `${cols(CW)}<thead><tr><th class="nw">日期</th><th>項目</th><th class="num">金額（原幣）</th><th class="num">約當台幣</th></tr></thead>` });
  }

  // ---------- 7 借款、擔保品與資金用途 ----------
  const TW = ['26%', '37%', '37%'];
  function tracePage() {
    const rowOf = new Map(R.bs.assetRows.map((r) => [r.id, r]));
    const liabRow = new Map(R.bs.liabRows.map((r) => [r.id, r]));
    const code = (a) => (a ? (a.category === 'fund' ? a.name : a.category === 'stock' ? a.identifier : a.name) : '（已刪除）');
    const list = (R.trace || []).filter((t) => t.collateral.length || t.uses.length)
      .sort((a, b) => ((a.liability.category + a.liability.name) < (b.liability.category + b.liability.name) ? -1 : 1));
    let body = '';
    list.forEach((t) => {
      const l = t.liability, lr = liabRow.get(l.id) || {};
      const coll = t.collateral.map((c) => { const a = c.asset && ASSET.get(c.asset.id); const r = a && rowOf.get(a.id); return `<span class="chip"><b>${esc(code(a))}</b>${r && r.original !== null ? ` ${fmt(r.original, a.currency)}${a.currency !== 'TWD' ? ' ' + (CCY[a.currency] || a.currency) : ''}` : ''}</span>`; }).join('');
      const uses = t.uses.map((u) => { const a = u.asset && ASSET.get(u.asset.id); return `<span class="chip"><b>${esc(code(a))}</b>${u.link.amount != null ? ` ${num(u.link.amount, dp(u.link.currency || 'TWD'))}${u.link.currency && u.link.currency !== 'TWD' ? ' ' + (CCY[u.link.currency] || u.link.currency) : ''}` : ''}${u.link.link_date ? `<i>${roc(u.link.link_date)}</i>` : ''}</span>`; }).join('');
      body += `<div class="fb-item">${tbl(TW, `<tr><td><b>${esc(l.institution || '')}</b> ${esc(l.name || '')}<div class="sub">${LIAB[l.category] || ''}${lr.principal != null ? `・本金 ${fmt(lr.principal, l.currency)}` : ''}${l.rate_from ? `・${roc(l.rate_from)} 起` : ''}</div></td><td>${coll || '—'}</td><td>${uses || '—'}</td></tr>`)}</div>`;
    });
    // 標的對照：代碼看不出基金名稱時，列一次名稱
    const used = new Set();
    list.forEach((t) => [...t.collateral, ...t.uses].forEach((x) => { const a = x.asset && ASSET.get(x.asset.id); if (a && a.category === 'fund') used.add(fundName(a)); }));
    if (used.size) body += `<p class="rp-note">基金帳號對照：${[...used].map((n) => { const ids = P.assets.filter((a) => fundName(a) === n && [...list].some((t) => [...t.collateral, ...t.uses].some((x) => x.asset && x.asset.id === a.id))).map((a) => a.name.split('-').pop()); return `${esc(n)}（尾號 ${ids.join('、')}）`; }).join('；')}</p>`;
    body += `<p class="rp-note">擔保品金額為基準日原幣現值；資金投入為申購金額與日期。中信信託質借須清償對應借款本息後才能解除質押；各銀行維持率採整戶合併計算。</p>`;
    body += `<div class="fb-item fb-sign">
      <p>以上資料由服務業務員依客戶提供之對帳單、保單與口述資料整理，並經業務員核對。</p>
      <div class="fb-sign-row">
        <div><span>服務業務員簽名</span><i></i></div>
        <div><span>業務員</span><b>${esc(AGENT ? AGENT.name : '')}</b>${AGENT && AGENT.license ? `<small>壽險登錄 ${esc(AGENT.license)}</small>` : ''}</div>
        <div><span>日期</span><b>${rocLong(todayIso())}</b></div>
      </div></div>`;
    return page('LOANS & COLLATERAL', '借款、擔保品與資金用途', body, { thead: `${cols(TW)}<thead><tr><th>借款</th><th>擔保品（代碼與現值）</th><th>資金投入（代碼、金額與日期）</th></tr></thead>` });
  }

  // ---------- 讀取 ----------
  async function divRatesFor(p) {
    if (p.divRates && Object.keys(p.divRates).length) return p.divRates;
    const ids = new Set();
    (p.cashSchedules || []).forEach((s) => { const m = s.meta || {}; if (m.calc === 'units_div') (m.assets || []).forEach((id) => { const a = (p.assets || []).find((x) => x.id === id); if (a && a.identifier) ids.add(a.identifier); }); });
    const out = {};
    await Promise.all([...ids].map(async (id) => {
      try {
        const res = await fetch(`${STOCK_SITE}data/funds/div/${encodeURIComponent(id)}.csv`);
        if (!res.ok) return;
        out[id] = (await res.text()).trim().split('\n').slice(1).map((l) => { const [date, amount] = l.split(','); return { date, amount: Number(amount) }; }).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.amount > 0);
      } catch { /* 讀不到就用排程金額 */ }
    }));
    return out;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const PORTAL = !!window.FIN_REPORT_PORTAL;
    if (!PORTAL) await requireLogin('../');
    const id = new URLSearchParams(location.search).get('snap');
    try {
      const { data, error } = PORTAL ? await sb.rpc('portal_report', { p_id: id }) : await sb.from('fin_snapshots').select('*').eq('id', id).maybeSingle();
      if (error || !data) throw new Error('找不到這份報表，或您沒有權限查看。');
      SNAP = data;
      P = C.revive(data.payload);
      P.asOf = P.asOf || data.as_of;
      CLIENT = P.client || { name: data.client_id, id: data.client_id };
      AGENT = P.agent || null;
      if (!AGENT && !PORTAL && data.owner) {
        const { data: t } = await sb.from('team_members').select('name, life_license').eq('user_id', data.owner).maybeSingle();
        if (t) AGENT = { name: t.name, license: t.life_license || '' };
      }
      TODAY = String(data.created_at || '').slice(0, 10) ? new Date(new Date(data.created_at).getTime() + 8 * 3600e3).toISOString().slice(0, 10) : todayIso();
      P.divRates = await divRatesFor(P);
      R = C.compute(P);
      A = R.av;
      ASSET = new Map((P.assets || []).map((a) => [a.id, a]));
      LIABS = new Map((P.liabilities || []).map((l) => [l.id, l]));
      AVX = availModel();
      pageNo = 0;
      $('rp-pages').innerHTML = [cover(), overview(), assetsPage(), liabPage(), availPage(), calendarPage(), tracePage()].join('');
      document.title = `${CLIENT.name}｜資產負債報表 ${roc(P.asOf)}`;
      if (PORTAL) document.querySelectorAll('.fb-sign').forEach((x) => x.classList.add('portal'));
      await document.fonts.ready;
      layout(); fitScreen();
      window.addEventListener('resize', fitScreen);
      $('rp-print').disabled = false;
      $('rp-print').addEventListener('click', () => window.print());
      window.__FB = { P, R };
    } catch (e) {
      console.error(e);
      $('rp-pages').innerHTML = `<p class="rp-loading">${esc(e.message || e)}</p>`;
    }
  });
})();
