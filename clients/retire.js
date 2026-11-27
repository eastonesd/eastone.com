// ============================================================
// 現金流與退休規劃頁：帶入資產負債（可投資資產、未來 12 個月固定收支）→ 逐年模擬到規劃年齡
// 計算：retire-calc.js；設定存在 retire_plans（每位業務員 × 客戶一筆）
// 金額輸入以「萬元」為單位
// ============================================================
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const RC = EastoneRetire, C = FinCalc, W = 10000;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const wan = (y) => { const v = Math.round(y) / W; return (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('zh-TW') : v.toLocaleString('zh-TW', { maximumFractionDigits: 1 })) + ' 萬'; };
  const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const r1 = (n) => Math.round(n * 10) / 10;
  const FIELDS = ['age', 'retireAge', 'lifeAge', 'ret', 'infl', 'assets', 'monthlyIncome', 'monthlyExpense', 'retireRatio', 'pension', 'pensionAge', 'lumpSum'];
  const MONEY = new Set(['assets', 'monthlyIncome', 'monthlyExpense', 'pension', 'lumpSum']);
  const INVEST = ['deposit', 'cash', 'fund', 'stock', 'mcn', 'savings_policy', 'investment_policy'];
  let CLIENTS = [], ME = null, other = [], bigs = [], PREFILL = null;

  async function load() {
    const id = ($('rt-client').value.split('｜')[1] || '').trim();
    ME = CLIENTS.find((c) => c.id === id);
    if (!ME) { $('rt-client').focus(); return; }
    $('rt-note').innerHTML = '<p class="tax-note">讀取中…</p>';
    try {
      const pick = async (t) => { const { data, error } = await sb.from(t).select('*').eq('client_id', id); if (error) throw error; return data || []; };
      const [assets, assetValues, liabilities, liabilityBalances, cashEvents, cashSchedules, fxRes, saved] = await Promise.all([
        pick('fin_assets'), pick('fin_asset_values'), pick('fin_liabilities'), pick('fin_liability_balances'), pick('fin_cash_events'), pick('fin_cash_schedules'),
        sb.from('fin_fx_quotes').select('*').order('quote_date', { ascending: false }).limit(2000),
        sb.from('retire_plans').select('params, updated_at').eq('client_id', id).maybeSingle(),
      ]);
      const fx = fxRes.data || [];
      const res = C.compute({ assets, assetValues, liabilities, liabilityBalances, cashEvents, cashSchedules, collateralLinks: [], fundingLinks: [], fx, asOf: today() });
      const num = (b) => (b == null ? 0 : C.toNum(b));
      const invest = res.bs.assetRows.filter((r) => r.counted && r.base != null && INVEST.includes((assets.find((a) => a.id === r.id) || {}).category)).reduce((s, r) => s + num(r.base), 0);
      let inc = 0, exp = 0, miss = 0;
      res.upcoming.forEach((u) => {
        const g = (C.KINDS[u.kind] || {}).group;
        if (u.amount === null) return;
        const t = C.toBase(u.amount, u.currency, fx, u.date);
        if (t.value === null) { miss++; return; }
        if (u.direction === 'in' && g === 'income') inc += num(t.value);
        if (u.direction === 'out' && (g === 'expense' || g === 'split')) exp += num(t.value);
      });
      const b = ME.birthday ? ME.birthday.split('-').map(Number) : null, t = today().split('-').map(Number);
      const age = b ? t[0] - b[0] - (t[1] < b[1] || (t[1] === b[1] && t[2] < b[2]) ? 1 : 0) : 45;
      PREFILL = { age, retireAge: Math.max(65, age + 1), lifeAge: 90, ret: 3, infl: 2, assets: r1(invest / W), monthlyIncome: r1(inc / 12 / W), monthlyExpense: r1(exp / 12 / W), retireRatio: 80, pension: 0, pensionAge: 65, lumpSum: 0 };
      const p = saved.data && saved.data.params ? { ...PREFILL, ...saved.data.params } : PREFILL;
      FIELDS.forEach((k) => { $('rt-' + k).value = p[k] ?? ''; });
      other = (p.otherIncome || []).map((x) => ({ ...x })); bigs = (p.bigs || []).map((x) => ({ ...x }));
      $('rt-note').innerHTML = `<div class="tax-imported"><ul>
        <li>資產負債帶入：可投資資產 ${wan(invest)}（存款、基金、股票、儲蓄險、投資型等，不含房地產）；未來 12 個月固定收入平均每月 ${wan(inc / 12)}、固定支出每月 ${wan(exp / 12)}。</li>
        ${!cashSchedules.length ? '<li class="warn">資產負債還沒有固定收支，每月收入、支出請自行填寫。</li>' : ''}
        ${miss ? `<li class="warn">${miss} 筆收支缺匯率，未計入。</li>` : ''}
        ${!ME.birthday ? '<li class="warn">客戶沒有生日，目前年齡先填 45，請修改。</li>' : ''}
        ${saved.data ? `<li>已套用 ${new Date(saved.data.updated_at).toLocaleDateString('zh-TW')} 儲存的設定（帶入值僅供對照）。</li>` : ''}
      </ul></div>`;
      $('rt-body').hidden = false; $('rt-saved').textContent = '';
      applyPension();
      renderLists(); render();
    } catch (e) { $('rt-note').innerHTML = `<p class="tax-err">讀取失敗：${esc(e.message || e)}</p>`; }
  }

  // 社會保險計算器「帶入退休規劃」：月領加到退休金、一次領加到退休時一次領
  function applyPension() {
    let h = null;
    try { h = JSON.parse(sessionStorage.getItem('eastone.pension') || 'null'); } catch { /* 無痕 */ }
    if (!h || Date.now() - (h.at || 0) > 3600e3) return;
    try { sessionStorage.removeItem('eastone.pension'); } catch { /* 無痕 */ }
    const add = (id, v) => { const el = $(id); el.value = r1((Number(el.value) || 0) + v); };
    if (h.monthly) { add('rt-pension', h.monthly / W); if (h.age) $('rt-pensionAge').value = h.age; }
    if (h.lump) add('rt-lumpSum', h.lump / W);
    $('rt-note').insertAdjacentHTML('beforeend', `<p class="tax-note">已從社會保險計算器帶入「${esc(h.label)}」：${h.monthly ? `每月 ${wan(h.monthly)}、${h.age} 歲起` : ''}${h.lump ? `一次領 ${wan(h.lump)}` : ''}。有多種年金請回計算器再帶入一次，會自動相加。</p>`);
  }

  function params() {
    const p = {};
    FIELDS.forEach((k) => { const v = Number($('rt-' + k).value); p[k] = MONEY.has(k) ? (v || 0) * W : (k === 'retireRatio' ? (Number.isFinite(v) ? v / 100 : 0.8) : v); });
    p.otherIncome = other.map((o) => ({ fromAge: Number(o.fromAge), toAge: Number(o.toAge) || null, monthly: (Number(o.monthly) || 0) * W, label: o.label }));
    p.bigs = bigs.map((b) => ({ age: Number(b.age), amount: (Number(b.amount) || 0) * W, label: b.label }));
    return p;
  }

  function renderLists() {
    $('rt-other').innerHTML = other.map((o, i) => `<div class="rt-row" data-l="other" data-i="${i}">
      <input data-f="label" value="${esc(o.label)}" placeholder="名稱，例：還本金">
      <label>從<input data-f="fromAge" type="number" value="${esc(o.fromAge)}" inputmode="numeric">歲</label>
      <label>到<input data-f="toAge" type="number" value="${esc(o.toAge)}" inputmode="numeric" placeholder="終身">歲</label>
      <label>每月<input data-f="monthly" type="number" step="any" value="${esc(o.monthly)}" inputmode="decimal">萬</label>
      <button type="button" class="tp-del" data-rm="other" data-i="${i}">✕</button></div>`).join('');
    $('rt-bigs').innerHTML = bigs.map((b, i) => `<div class="rt-row" data-l="bigs" data-i="${i}">
      <input data-f="label" value="${esc(b.label)}" placeholder="名稱，例：子女出國留學">
      <label><input data-f="age" type="number" value="${esc(b.age)}" inputmode="numeric">歲時</label>
      <label><input data-f="amount" type="number" step="any" value="${esc(b.amount)}" inputmode="decimal">萬</label>
      <button type="button" class="tp-del" data-rm="bigs" data-i="${i}">✕</button></div>`).join('');
  }

  // 資產走勢（今天的幣值）
  function chart(sim, p) {
    const rows = sim.rows; if (!rows.length) return '';
    const Wd = 760, H = 230, L = 56, B = 26, T = 12;
    const vals = rows.map((r) => r.end / Math.pow(1 + p.infl / 100, r.age - rows[0].age));
    const max = Math.max(...vals, 0), min = Math.min(...vals, 0), span = max - min || 1;
    const x = (i) => L + (Wd - L - 10) * (rows.length === 1 ? 0 : i / (rows.length - 1));
    const y = (v) => T + (H - T - B) * (1 - (v - min) / span);
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const ri = rows.findIndex((r) => r.age === p.retireAge);
    const ticks = [max, (max + min) / 2, min].map((v) => `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${wan(v)}</text><line x1="${L}" x2="${Wd - 10}" y1="${y(v)}" y2="${y(v)}" class="g"/>`).join('');
    const ages = rows.filter((r, i) => i % 5 === 0 || i === rows.length - 1).map((r) => { const i = rows.indexOf(r); return `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${r.age}</text>`; }).join('');
    return `<svg class="rt-chart" viewBox="0 0 ${Wd} ${H}" role="img" aria-label="可投資資產走勢">
      ${ticks}${min < 0 ? `<rect x="${L}" y="${y(0)}" width="${Wd - L - 10}" height="${y(min) - y(0)}" class="neg"/>` : ''}
      ${ri >= 0 ? `<line x1="${x(ri)}" x2="${x(ri)}" y1="${T}" y2="${H - B}" class="ret"/><text x="${x(ri) + 4}" y="${T + 10}" class="rl">${p.retireAge} 歲退休</text>` : ''}
      <polyline points="${pts}" class="ln"/>${ages}</svg>`;
  }

  function render() {
    if (!ME) return;
    const p = params();
    const box = $('rt-result');
    if (!(p.lifeAge > p.age) || !(p.retireAge >= 0)) { box.innerHTML = '<p class="tax-err">請確認年齡設定（規劃到幾歲要大於目前年齡）。</p>'; return; }
    const sim = RC.simulate(p);
    const extra = RC.extraSaving(p);
    const fNow = (age) => Math.pow(1 + p.infl / 100, age - p.age);
    const retireNeedYears = p.lifeAge - p.retireAge + 1;
    const ok = sim.depleted === null;
    box.innerHTML = `
      <h2>退休規劃試算<small class="tax-h-sub">${esc(ME.name)}・金額換算成今天的幣值</small></h2>
      <div class="lg-kpis">
        <div><span>${p.retireAge} 歲退休時資產</span><b>${sim.atRetire == null ? '—' : wan(sim.atRetire / fNow(p.retireAge))}</b><em>名目 ${sim.atRetire == null ? '—' : wan(sim.atRetire)}</em></div>
        <div class="${ok ? '' : 'em'}"><span>資產可以撐到</span><b>${ok ? `${p.lifeAge} 歲以後` : `${sim.depleted - 1} 歲`}</b><em>${ok ? '規劃期間不會用完' : `${sim.depleted} 歲那年不夠用`}</em></div>
        <div><span>退休前每月需加存</span><b>${extra == null ? '—' : extra === 0 ? '不用' : wan(extra)}</b><em>${extra ? `連續 ${p.retireAge - p.age} 年` : '目前規劃已足夠'}</em></div>
        <div><span>${p.lifeAge} 歲時剩下</span><b>${wan(sim.finalReal)}</b><em>可留給下一代</em></div>
      </div>
      ${chart(sim, p)}
      <p class="lg-verdict ${ok ? 'ok' : 'gap'}">${ok
        ? `依目前假設，資產可以支應到 ${p.lifeAge} 歲，最後還剩約 ${wan(sim.finalReal)}（今天幣值）。可以評估把多出來的部分做傳承規劃，或提高退休生活品質。`
        : `依目前假設，資產會在 <b>${sim.depleted} 歲</b>那年不夠用，離規劃的 ${p.lifeAge} 歲還差 ${p.lifeAge - sim.depleted + 1} 年。${extra ? `從現在起到退休，每月多存 <b>${wan(extra)}</b>（以 ${p.ret}% 報酬率投入）就能補足；` : ''}也可以考慮延後退休、降低退休後支出，或用年金險、還本型保單建立終身現金流。`}</p>
      <p class="tax-note">退休後 ${retireNeedYears} 年的生活支出約每年 ${wan(p.monthlyExpense * p.retireRatio * 12)}（今天幣值）${p.pension ? `，退休金每年 ${wan(p.pension * 12)} 可以抵掉一部分` : '，目前沒有填退休金'}。長照、重大醫療等大額支出請加在「未來大額支出」。</p>
      <details class="tax-detail"><summary>逐年明細（名目金額）</summary>
        <div class="lg-scroll"><table class="tax-table"><thead><tr><th>年齡</th><th class="num">年初資產</th><th class="num">投資收益</th><th class="num">收入</th><th class="num">支出</th><th class="num">大額支出</th><th class="num">年底資產</th></tr></thead><tbody>
        ${sim.rows.map((r) => `<tr class="${r.end < 0 ? 'bad' : ''}${r.age === p.retireAge ? ' rt-mark' : ''}"><td>${r.age}${r.age === p.retireAge ? '（退休）' : ''}</td><td class="num">${wan(r.start)}</td><td class="num">${wan(r.growth)}</td><td class="num">${wan(r.income)}</td><td class="num">${wan(r.expense)}</td><td class="num">${r.big ? wan(r.big) : ''}</td><td class="num">${wan(r.end)}</td></tr>`).join('')}
        </tbody></table></div></details>
      <div class="tax-actions"><button type="button" class="btn-secondary" onclick="window.print()">列印／另存 PDF</button></div>`;
  }

  async function save() {
    if (!ME) return;
    const raw = {}; FIELDS.forEach((k) => { raw[k] = $('rt-' + k).value === '' ? null : Number($('rt-' + k).value); });
    raw.otherIncome = other; raw.bigs = bigs;
    const { error } = await sb.from('retire_plans').upsert({ owner: APP_UID, client_id: ME.id, params: raw, updated_at: new Date().toISOString() });
    $('rt-saved').textContent = error ? `儲存失敗：${error.message}` : `已儲存（${new Date().toLocaleTimeString('zh-TW')}）`;
  }

  async function init() {
    try { await requireLogin('../'); } catch { $('tax-load').textContent = '目前無法確認登入，請重新整理後再試。'; return; }
    try { CLIENTS = await clientList(); } catch (e) { $('tax-load').textContent = '讀取客戶失敗：' + (e.message || e); return; }
    PICK_SOURCES['rt-client'] = (input) => {
      const kw = input.value.split('｜')[0].trim().toLowerCase();
      return [{ label: '客戶', layout: 'list', options: CLIENTS.filter((c) => !kw || `${c.name}${c.id}`.toLowerCase().includes(kw)).slice(0, 60)
        .map((c) => ({ value: `${c.name}｜${c.id}`, label: c.name || c.id, sub: c.id })) }];
    };
    $('rt-load').addEventListener('click', load);
    $('rt-client').addEventListener('change', load);
    FIELDS.forEach((k) => $('rt-' + k).addEventListener('input', render));
    ['rt-other', 'rt-bigs'].forEach((id) => {
      $(id).addEventListener('input', (e) => { const row = e.target.closest('.rt-row'); if (!row) return; (row.dataset.l === 'other' ? other : bigs)[+row.dataset.i][e.target.dataset.f] = e.target.value; render(); });
      $(id).addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (!b) return; (b.dataset.rm === 'other' ? other : bigs).splice(+b.dataset.i, 1); renderLists(); render(); });
    });
    $('rt-add-other').addEventListener('click', () => { other.push({ label: '', fromAge: Number($('rt-retireAge').value) || 65, toAge: '', monthly: '' }); renderLists(); });
    $('rt-add-big').addEventListener('click', () => { bigs.push({ label: '', age: (Number($('rt-age').value) || 40) + 5, amount: '' }); renderLists(); });
    $('rt-save').addEventListener('click', save);
    const pre = new URLSearchParams(location.search).get('id');
    if (pre) { const c = CLIENTS.find((x) => x.id === pre.toUpperCase()); if (c) { $('rt-client').value = `${c.name}｜${c.id}`; load(); } }
    else { try { const h = JSON.parse(sessionStorage.getItem('eastone.pension') || 'null'); if (h) $('rt-note').innerHTML = `<p class="tax-note">「${esc(h.label)}」已準備好，選擇客戶後會自動帶入退休金。</p>`; } catch { /* 無痕 */ } }
    $('tax-load').hidden = true;
    $('tax-main').hidden = false;
  }
  document.addEventListener('DOMContentLoaded', init);
})();
