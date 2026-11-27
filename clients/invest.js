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
      if (n) { renderTarget(); render(); }
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
    $('iv-alerts').innerHTML = al.length ? `<ul class="iv-al">${al.map((a) => `<li class="${a.lv}"><i></i>${esc(a.text)}</li>`).join('')}</ul>` : '<p class="iv-ok">✅ 配置在目標範圍內，沒有需要處理的提醒。</p>';
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
