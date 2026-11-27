// ============================================================
// 投資監控：選客戶 → 讀資產負債（基金、股票、存款、結構型）→ 持倉、走勢、配置 vs 目標、提醒
// 目標設定存在 invest_profiles（每位客戶一筆）
// 計算：invest-calc.js（EastoneInvest）、finance-calc.js（FinCalc）
// ============================================================
(() => {
  'use strict';
  const I = EastoneInvest, C = FinCalc;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const W = 10000;
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const wan = (y) => (y == null || !isFinite(y) ? '—' : `${(Math.round(y / 1000) / 10).toLocaleString('zh-TW')} 萬`);
  const pct = (x, d = 1) => (x == null || !isFinite(x) ? '—' : `${(Math.round(x * 100 * 10 ** d) / 10 ** d).toLocaleString('zh-TW')}%`);
  const sgn = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : '');
  const CATS = { fund: '基金', stock: '股票／ETF', mcn: '結構型商品', deposit: '定存', cash: '活存／現金', savings_policy: '儲蓄險', investment_policy: '投資型保單' };
  let CLIENTS = [], cur = null, input = null, prof = null;

  async function fetchAll(t, id) { const { data, error } = await sb.from(t).select('*').eq('client_id', id); if (error) throw error; return data || []; }

  async function load() {
    const id = ($('iv-client').value.split('｜')[1] || '').trim();
    const c = CLIENTS.find((x) => x.id === id);
    if (!c) { $('iv-note').innerHTML = '<p class="tax-err">請先從清單選擇客戶。</p>'; return; }
    cur = c;
    $('iv-note').innerHTML = '<p class="tax-note">讀取中…</p>';
    try {
      const [assets, assetValues, fxRes, pr] = await Promise.all([
        fetchAll('fin_assets', id), fetchAll('fin_asset_values', id),
        sb.from('fin_fx_quotes').select('*').order('quote_date', { ascending: false }).limit(2000),
        sb.from('invest_profiles').select('*').eq('client_id', id).maybeSingle(),
      ]);
      input = { assets, assetValues, liabilities: [], liabilityBalances: [], cashEvents: [], cashSchedules: [], collateralLinks: [], fundingLinks: [], fx: fxRes.data || [], asOf: today };
      prof = pr.data || { profile: 'balanced', targets: {}, band: 5 };
      if (!prof.targets || !Object.keys(prof.targets).length) prof.targets = { ...I.PROFILES[prof.profile || 'balanced'].targets };
      $('iv-fin').href = `finance.html?id=${encodeURIComponent(id)}`; $('iv-fin').hidden = false;
      const n = assets.filter((a) => a.status !== 'archived' && I.INVEST.includes(a.category)).length;
      $('iv-note').innerHTML = n ? '' : `<p class="tax-note">${esc(c.name)} 在資產負債還沒有基金、股票或存款資料。</p>`;
      $('iv-body').hidden = !n;
      if (n) { renderTarget(); render(); renderFcn(); }
    } catch (e) { $('iv-note').innerHTML = `<p class="tax-err">讀取失敗：${esc(e.message || e)}</p>`; }
  }

  function renderTarget() {
    $('iv-profile').innerHTML = Object.entries(I.PROFILES).map(([k, p]) => `<option value="${k}"${k === prof.profile ? ' selected' : ''}>${p.label}（最高 RR${p.maxRR}）</option>`).join('') + `<option value="custom"${prof.profile === 'custom' ? ' selected' : ''}>自訂</option>`;
    $('iv-tg').innerHTML = Object.entries(I.BUCKET).map(([k, l]) => `<label>${l}（%）<input type="number" data-tg="${k}" value="${Math.round((prof.targets[k] || 0) * 1000) / 10}" min="0" max="100" step="1" inputmode="decimal"></label>`).join('');
    $('iv-band').value = prof.band ?? 5;
  }

  function chart(series) {
    if (series.length < 2) return '<p class="tax-note">至少要有兩次報價更新紀錄才畫得出走勢。</p>';
    const Wd = 720, H = 200, L = 64, B = 24, T = 12;
    const vals = series.map((p) => p.value), max = Math.max(...vals), min = Math.min(...vals), span = max - min || max * 0.05 || 1;
    const lo = min - span * 0.1, hi = max + span * 0.1;
    const x = (i) => L + (Wd - L - 12) * (i / (series.length - 1));
    const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
    const pts = series.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    const ticks = [0, Math.floor((series.length - 1) / 2), series.length - 1];
    const first = vals[0], last = vals[vals.length - 1];
    return `<svg class="iv-chart" viewBox="0 0 ${Wd} ${H}" role="img" aria-label="投資部位市值走勢">
      ${[hi, (hi + lo) / 2, lo].map((v) => `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${wan(v)}</text><line x1="${L}" x2="${Wd - 12}" y1="${y(v)}" y2="${y(v)}" class="g"/>`).join('')}
      <polygon points="${x(0)},${H - B} ${pts} ${x(series.length - 1)},${H - B}" class="area"/>
      <polyline points="${pts}" class="ln ${last >= first ? 'up' : 'down'}"/>
      <circle cx="${x(series.length - 1)}" cy="${y(last)}" r="4" class="dot"/>
      ${ticks.map((i, j) => `<text x="${x(i)}" y="${H - 6}" text-anchor="${['start', 'middle', 'end'][j]}">${series[i].date.slice(5).replace('-', '/')}</text>`).join('')}
    </svg>
    <p class="iv-chg">期間 ${series[0].date} → ${series[series.length - 1].date}：<b class="${sgn(last - first)}">${last >= first ? '+' : ''}${wan(last - first)}（${last >= first ? '+' : ''}${pct((last - first) / first)}）</b><small>含期間新增申購或贖回</small></p>`;
  }

  function render() {
    const h = I.holdings(input);
    const series = I.history(input);
    const alloc = I.allocation(h, prof.targets);
    const al = I.alerts(h, alloc, { profile: prof.profile === 'custom' ? 'aggressive' : prof.profile, band: (Number(prof.band) || 5) / 100, today });
    // 近 30 天
    const ago = new Date(Date.parse(today) - 30 * 864e5).toISOString().slice(0, 10);
    const base30 = [...series].reverse().find((p) => p.date <= ago) || series[0];
    const last = series.length ? series[series.length - 1].value : null;
    const d30 = base30 && last != null ? last - base30.value : null;
    $('iv-kpi').innerHTML = `<div class="tax-eq">
      <div class="em"><span>投資部位市值</span><b>${wan(h.total)}</b><small>${h.list.length} 檔</small></div>
      <div><span>投入成本</span><b>${wan(h.cost)}</b><small>${h.missingCost ? `${h.missingCost} 檔缺成本未計` : '有成本資料的部位'}</small></div>
      <div><span>未實現損益</span><b class="${sgn(h.pnl)}">${h.pnl >= 0 ? '+' : ''}${wan(h.pnl)}</b><small class="${sgn(h.pnl)}">${h.cost ? (h.pnl >= 0 ? '+' : '') + pct(h.pnl / h.cost) : ''}</small></div>
      <div><span>近 30 天變化（不含存款）</span><b class="${sgn(d30)}">${d30 == null ? '—' : (d30 >= 0 ? '+' : '') + wan(d30)}</b><small>${base30 ? `自 ${base30.date}` : ''}</small></div></div>`;
    $('iv-alerts').innerHTML = al.length ? `<ul class="iv-al">${al.map((a) => `<li class="${a.lv}"><i></i><div>${a.items && a.items.length ? `<details><summary>${esc(a.text)}</summary><p>${a.items.map(esc).join('、')}</p></details>` : esc(a.text)}</div></li>`).join('')}</ul>` : '<p class="iv-ok">✅ 配置在目標範圍內，沒有需要處理的提醒。</p>';
    $('iv-chart').innerHTML = chart(series);
    const ccy = I.groupBy(h, (g) => g.currency || '—'), rr = I.groupBy(h, (g) => (g.rr ? `RR${g.rr}` : g.bucket === 'cash' ? '存款' : '未標示'));
    const band = (Number(prof.band) || 5) / 100;
    $('iv-alloc').innerHTML = `<div class="iv-bars">${alloc.map((x) => `<div class="iv-bar"><span>${x.label}</span>
        <div class="iv-track"><i class="act" style="width:${Math.min(100, x.weight * 100)}%"></i>${x.target ? `<b class="tgt" style="left:${Math.min(100, x.target * 100)}%" title="目標 ${pct(x.target, 0)}"></b>` : ''}</div>
        <em>${pct(x.weight)}<small>目標 ${pct(x.target, 0)}</small></em><strong class="${Math.abs(x.drift) > band ? 'warn' : 'ok'}">${x.drift >= 0 ? '+' : ''}${pct(x.drift)}</strong></div>`).join('')}</div>
      <div class="iv-pills"><div><b>幣別</b>${ccy.map((g) => `<span>${esc(g.k)} ${pct(g.weight, 0)}</span>`).join('')}</div><div><b>風險等級</b>${rr.map((g) => `<span>${esc(g.k)} ${pct(g.weight, 0)}</span>`).join('')}</div></div>`;
    $('iv-hold').innerHTML = `<div class="iv-tw"><table class="iv-table"><thead><tr><th>標的</th><th>類別</th><th>RR</th><th class="num">市值</th><th class="num">占比</th><th class="num">成本</th><th class="num">損益</th><th>報價日</th></tr></thead><tbody>
      ${h.list.map((g) => `<tr><td><b>${esc(g.name)}</b><div class="sub">${esc([g.identifier, g.currency, g.lots > 1 ? `${g.lots} 筆合併` : ''].filter(Boolean).join('・'))}</div></td>
        <td>${CATS[g.category] || ''}</td><td>${g.rr ? `RR${g.rr}` : '—'}</td><td class="num">${wan(g.value)}</td><td class="num">${pct(g.weight)}</td>
        <td class="num">${g.bucket === 'cash' ? '—' : g.costKnown ? wan(g.cost) : '<span class="muted">缺成本</span>'}</td>
        <td class="num ${sgn(g.pnl)}">${g.pnl == null ? '—' : `${g.pnl >= 0 ? '+' : ''}${wan(g.pnl)}<div class="sub ${sgn(g.pnl)}">${g.pnl >= 0 ? '+' : ''}${pct(g.pnlPct)}</div>`}</td>
        <td class="${(Date.parse(today) - Date.parse(g.valueDate)) / 864e5 > 7 && g.bucket !== 'cash' ? 'warn' : ''}">${esc(g.valueDate || '')}</td></tr>`).join('')}
      <tr class="total"><td colspan="3">合計</td><td class="num">${wan(h.total)}</td><td class="num">100%</td><td class="num">${wan(h.cost)}</td><td class="num ${sgn(h.pnl)}">${h.pnl >= 0 ? '+' : ''}${wan(h.pnl)}</td><td></td></tr></tbody></table></div>`;
  }

  // ---------- FCN ----------
  const usdRate = () => { const q = (input.fx || []).filter((x) => x.currency === 'USD').sort((a, b) => (a.quote_date < b.quote_date ? 1 : -1))[0]; return q ? Number(q.rate) : 32; };
  const pxCache = new Map();
  async function usClose(sym) {
    if (pxCache.has(sym)) return pxCache.get(sym);
    const start = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
    const q = new URLSearchParams({ dataset: 'USStockPrice', data_id: sym, start_date: start });
    let token = ''; try { token = localStorage.getItem('eastone.finmindToken') || ''; } catch { /* 無痕 */ }
    if (token) q.set('token', token);
    const p = fetch(`https://api.finmindtrade.com/api/v4/data?${q}`).then((r) => r.json()).then((j) => { const d = (j && j.data) || []; const l = d[d.length - 1]; return l ? { px: Number(l.close ?? l.Close), date: l.date } : null; }).catch(() => null);
    pxCache.set(sym, p); return p;
  }
  async function renderFcn() {
    const list = input.assets.filter((a) => a.category === 'mcn' && a.status !== 'archived' && a.meta && a.meta.fcn);
    $('iv-fcn-card').hidden = !list.length;
    if (!list.length) return;
    $('iv-fcn').innerHTML = '<p class="tax-note">讀取連結標的價格中…</p>';
    const out = [];
    for (const a of list) {
      const f = a.meta.fcn, prices = {}, dates = {};
      for (const u of f.underlyings || []) { const r = await usClose(u.sym); if (r) { prices[u.sym] = r.px; dates[u.sym] = r.date; } }
      const s = I.fcnStatus(f, prices, today);
      const p100 = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`);
      const V = { ko: ['g', `下一次觀察（${s.next && s.next.obs}）如果維持現價，會提前出場：拿回本金＋當期利息`], safe: ['g', '目前離履約價還有距離，繼續每月領息'], near: ['y', `最差的標的（${s.worst && s.worst.sym}）離履約價只剩 ${p100(s.cushion)}，要留意`], below: ['r', `最差的標的（${s.worst && s.worst.sym}）已低於履約價：如果到期時還在這裡，會被轉成股票（約虧 ${wan(s.deliverLoss * usdRate())}）`], na: ['n', '暫時抓不到連結標的價格'] }[s.verdict];
      out.push(`<div class="fcn">
        <div class="fcn-h"><b>${esc(f.product || a.name)}</b><span>${esc(a.institution || '')}・${Number(f.notional).toLocaleString()} ${esc(f.currency)}・年息 ${(f.coupon * 100).toFixed(1)}%・到期 ${esc(f.final)}</span></div>
        <p class="fcn-v ${V[0]}">${V[1]}</p>
        <div class="iv-tw"><table class="iv-table fcn-t"><thead><tr><th>連結標的</th><th class="num">期初價</th><th class="num">最新價</th><th class="num">表現（現價÷期初）</th><th class="num">履約價</th><th class="num">下次提前出場價</th></tr></thead><tbody>
        ${s.und.map((u) => `<tr class="${s.worst && u.sym === s.worst.sym ? 'worst' : ''}"><td><b>${esc(u.sym)}</b> ${esc(u.name || '')}${u.adj > 1 ? `<div class="sub">已依分割換算（÷${u.adj}）</div>` : ''}${s.worst && u.sym === s.worst.sym ? '<div class="sub warn">表現最差，以它為準</div>' : ''}</td>
          <td class="num">${u.init.toFixed(2)}</td><td class="num">${u.px != null ? u.px.toFixed(2) : '—'}<div class="sub">${esc(dates[u.sym] || '')}</div></td><td class="num"><b>${p100(u.perf)}</b></td>
          <td class="num">${u.strikePx.toFixed(2)}<div class="sub">${p100(s.strike)}</div></td><td class="num">${s.next && s.next.ko != null ? (u.init * s.next.ko).toFixed(2) : '—'}<div class="sub">${s.next && s.next.ko != null ? p100(s.next.ko) : ''}</div></td></tr>`).join('')}</tbody></table></div>
        <div class="fcn-kpi"><div><span>每月利息</span><b>${Math.round(s.monthly).toLocaleString()} ${esc(f.currency)}</b><small>不論漲跌都會領</small></div>
          <div><span>已領 / 剩餘</span><b>${s.passed} / ${s.left} 期</b><small>${s.next ? `下次觀察 ${s.next.obs}` : '已到期'}</small></div>
          <div><span>最差標的距履約價</span><b class="${s.cushion != null && s.cushion < 0.1 ? 'warn' : ''}">${p100(s.cushion)}</b><small>跌破才會轉股票</small></div>
          <div><span>若轉成股票</span><b>${s.worst ? `${s.deliverShares.toLocaleString()} 股 ${esc(s.worst.sym)}` : '—'}</b><small>以履約價 ${s.worst ? s.worst.strikePx.toFixed(2) : ''} 承接</small></div></div>
        <details class="fcn-how"><summary>FCN 是什麼？（白話說明）</summary>
          <p>FCN（固定配息結構型商品）像一張「附條件的高利定存」：本金 ${Number(f.notional).toLocaleString()} ${esc(f.currency)}，每月固定領年息 ${(f.coupon * 100).toFixed(0)}% 的利息。代價是：<b>到期時如果連結的股票跌太多，就不還現金，改給股票</b>。</p>
          <ol><li><b>每月觀察一次（提前出場）</b>：所有連結標的都高於「提前出場價」，商品就提前結束，拿回本金＋利息。提前出場價從期初的 100% 開始，每月降 ${Math.round((f.step || 0.03) * 100)}%，最低到 70%。</li>
          <li><b>到期那天（${esc(f.final)}）</b>：看表現最差的那一檔。只要它不低於期初的 ${p100(s.strike)}（履約價），就拿回全部本金；低於履約價，就用履約價「買進」那檔股票，股票現值低於本金，就是虧損。</li>
          <li><b>無下限觀察（no KI）</b>：期間跌破履約價不會立刻出事，只看到期那天。</li></ol>
          <p>${esc((f.underlyings || []).filter((u) => u.adj_note).map((u) => u.adj_note).join('；'))}</p></details>
      </div>`);
    }
    $('iv-fcn').innerHTML = out.join('');
  }

  async function save() {
    $('iv-saved').textContent = '儲存中…';
    const { error } = await sb.from('invest_profiles').upsert({ client_id: cur.id, profile: prof.profile, targets: prof.targets, band: Number(prof.band) || 5, updated_at: new Date().toISOString() }, { onConflict: 'owner,client_id' });
    $('iv-saved').textContent = error ? `儲存失敗：${error.message}` : '已儲存';
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try { await requireLogin('../'); } catch { $('tax-load').textContent = '目前無法確認登入，請重新整理後再試。'; return; }
    try { CLIENTS = await clientList(); } catch (e) { $('tax-load').textContent = '讀取客戶失敗：' + (e.message || e); return; }
    PICK_SOURCES['iv-client'] = (inp) => {
      const kw = inp.value.split('｜')[0].trim().toLowerCase();
      return [{ label: '客戶', layout: 'list', options: CLIENTS.filter((c) => !kw || `${c.name}${c.id}`.toLowerCase().includes(kw)).slice(0, 60).map((c) => ({ value: `${c.name}｜${c.id}`, label: c.name || c.id, sub: c.id })) }];
    };
    $('iv-load').addEventListener('click', load);
    $('iv-client').addEventListener('change', load);
    $('iv-profile').addEventListener('change', (e) => {
      prof.profile = e.target.value;
      if (I.PROFILES[prof.profile]) prof.targets = { ...I.PROFILES[prof.profile].targets };
      renderTarget(); render(); $('iv-saved').textContent = '尚未儲存';
    });
    $('iv-tg').addEventListener('input', (e) => { const k = e.target.dataset.tg; if (!k) return; prof.targets[k] = (Number(e.target.value) || 0) / 100; prof.profile = I.PROFILES[prof.profile] ? prof.profile : 'custom'; render(); $('iv-saved').textContent = '尚未儲存'; });
    $('iv-band').addEventListener('input', (e) => { prof.band = Number(e.target.value) || 5; render(); });
    $('iv-save').addEventListener('click', save);
    $('tax-main').hidden = false; $('tax-load').hidden = true;
    const pre = new URLSearchParams(location.search).get('id');
    if (pre) { const c = CLIENTS.find((x) => x.id === pre.toUpperCase()); if (c) { $('iv-client').value = `${c.name}｜${c.id}`; load(); } }
  });
})();
