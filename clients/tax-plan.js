// ============================================================
// 稅務規劃頁：「不動產移轉」與「二次遺產稅」兩個模式（計算：transfer-calc.js）
// 輸入以「萬元」為單位，即時試算；不存檔
// ============================================================
(() => {
  'use strict';
  const X = EastoneTransfer;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const W = 10000;
  const wan = (y) => (y == null || !isFinite(y) ? '—' : `${(Math.round(y / 1000) / 10).toLocaleString('zh-TW')} 萬`);
  const pct = (x) => `${Math.round(x * 1000) / 10}%`;

  // ---------- 表單工具 ----------
  const S = { tp: {}, sd: {} };
  function form(el, ns, fields) {
    $(el).innerHTML = fields.map((f) => {
      const v = S[ns][f.k] ?? f.def;
      S[ns][f.k] = v;
      if (f.type === 'check') return `<label class="tp-check"><input type="checkbox" data-ns="${ns}" data-k="${f.k}" ${v ? 'checked' : ''}> ${f.label}${f.hint ? `<small>${f.hint}</small>` : ''}</label>`;
      if (f.type === 'select') return `<label>${f.label}<select data-ns="${ns}" data-k="${f.k}">${Object.entries(f.opts).map(([k, t]) => `<option value="${k}"${String(v) === k ? ' selected' : ''}>${t}</option>`).join('')}</select>${f.hint ? `<small>${f.hint}</small>` : ''}</label>`;
      return `<label>${f.label}<input type="number" step="any" inputmode="decimal" data-ns="${ns}" data-k="${f.k}" value="${v ?? ''}" placeholder="${f.ph || ''}">${f.hint ? `<small>${f.hint}</small>` : ''}</label>`;
    }).join('');
  }
  const val = (ns, k) => { const v = S[ns][k]; return v === '' || v == null ? null : Number(v); };

  // ---------- 不動產移轉 ----------
  const TP_PROP = [
    { k: 'land', label: '公告土地現值（萬）', def: 1500, hint: '持分後的總額；也是移轉申報現值' },
    { k: 'bldg', label: '房屋評定現值（萬）', def: 150 },
    { k: 'market', label: '現在市價（萬）', def: 3500 },
    { k: 'prev', label: '前次移轉現值或原規定地價（萬）', def: 400, hint: '父母取得時的公告現值總額' },
    { k: 'cpi', label: '物價指數（%）', def: 160, hint: '財政部每月公告，依前次移轉年月查表' },
    { k: 'improve', label: '土地改良費用（萬）', def: 0 },
    { k: 'parentYears', label: '父母已持有（年）', def: 22 },
    { k: 'after105', label: '父母取得時間', type: 'select', opts: { 0: '民國 105 年以前（舊制）', 1: '民國 105 年以後（房地合一）' }, def: '0' },
    { k: 'parentCost', label: '父母取得成本（萬）', def: '', ph: '105 年後取得才需要', hint: '房地合一用：買價＋取得費用' },
    { k: 'parentSelfUse', label: '父母出售符合自用住宅（土增稅 10%）', type: 'check', def: false, hint: '一生一次；都市土地 300 平方公尺內' },
  ];
  const TP_PLAN = [
    { k: 'giftUsed', label: '父母今年已贈與（萬）', def: 0, hint: '每人每年免稅 244 萬' },
    { k: 'otherEstate', label: '父母其他遺產課稅淨額（萬）', def: 3000, hint: '算繼承時這筆房產多繳的遺產稅' },
    { k: 'inheritIn', label: '幾年後繼承', def: 15 },
    { k: 'sellIn', label: '子女幾年後出售（從現在起）', def: 20 },
    { k: 'growth', label: '公告現值、房價年漲幅（%）', def: 2 },
    { k: 'salePrice', label: '將來售價（萬）', def: '', ph: '留空＝市價依漲幅推估' },
    { k: 'buyPrice', label: '賣給子女的價格（萬）', def: '', ph: '留空＝市價' },
    { k: 'childSelfUse', label: '子女出售時符合自住（設籍持有滿 6 年）', type: 'check', def: false, hint: '房地合一 400 萬免稅、超過 10%' },
  ];
  function renderTransfer() {
    const v = (k) => val('tp', k);
    let r;
    try {
      r = X.compareTransfer({
        land: (v('land') || 0) * W, bldg: (v('bldg') || 0) * W, market: (v('market') || 0) * W, prev: (v('prev') || 0) * W, cpi: v('cpi') || 100, improve: (v('improve') || 0) * W,
        parentYears: v('parentYears') || 0, parentAfter105: String(S.tp.after105) === '1', parentCost: (v('parentCost') || 0) * W, parentSelfUse: !!S.tp.parentSelfUse,
        giftUsed: (v('giftUsed') || 0) * W, otherEstate: (v('otherEstate') || 0) * W, inheritIn: v('inheritIn') || 0, sellIn: v('sellIn') || 0, growth: (v('growth') || 0) / 100,
        salePrice: (v('salePrice') || 0) * W, buyPrice: (v('buyPrice') || 0) * W, childSelfUse: !!S.tp.childSelfUse,
      });
    } catch (e) { $('tp-result').innerHTML = `<p class="tax-err">${esc(e.message)}</p>`; return; }
    const card = (s) => `<div class="tp-col ${s.k === r.best ? 'best' : ''}">
      <h3>${esc(s.label)}${s.k === r.best ? '<em>稅最少</em>' : ''}</h3>
      <div class="tp-sum"><span>兩階段合計</span><b>${wan(s.total)}</b></div>
      <h4>移轉時</h4><ul>${s.now.map((x) => `<li><span>${esc(x.label)}</span><b>${wan(x.amt)}</b></li>`).join('')}<li class="sub"><span>小計</span><b>${wan(s.nowTotal)}</b></li></ul>
      <h4>子女 ${v('sellIn') || 0} 年後以 ${wan(r.salePrice)} 出售</h4><ul>
        <li><span>土地增值稅（${pct(s.later.lit.rate)}）</span><b>${wan(s.later.lit.tax)}</b></li>
        <li><span>房地合一稅（${pct(s.later.hl.rate)}，所得 ${wan(s.later.hl.income)}）</span><b>${wan(s.later.hl.tax)}</b></li>
        <li class="sub"><span>小計</span><b>${wan(s.later.total)}</b></li></ul>
      <ul class="tp-notes">${s.notes.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
    $('tp-result').innerHTML = `<h2>三種方式比較<small class="tax-h-sub">「移轉時」由誰繳已註明；「出售時」由子女繳</small></h2>
      <div class="tp-cols">${r.scenarios.map(card).join('')}</div>
      <p class="tax-note">試算未含代書費、仲介費與地價稅、房屋稅等持有稅；買賣若父母 105 年前取得，房屋交易所得併入綜所稅未列入。不動產的移轉時點、分割方式與資金安排會大幅影響結果，執行前請與地政士、會計師確認。</p>`;
  }

  // ---------- 二次遺產稅 ----------
  const SD = [
    { k: 'a', label: '先身故者財產淨額（萬）', def: 30000 },
    { k: 'aPre', label: '先身故者婚前財產（萬）', def: 0 },
    { k: 'aFree', label: '先身故者婚後繼承、受贈（萬）', def: 0 },
    { k: 'b', label: '後身故者財產淨額（萬）', def: 3000 },
    { k: 'bPre', label: '後身故者婚前財產（萬）', def: 0 },
    { k: 'bFree', label: '後身故者婚後繼承、受贈（萬）', def: 0 },
    { k: 'kids', label: '子女人數', def: 2 },
    { k: 'gap', label: '兩人身故相隔（年）', def: 10, hint: '5 年內再繼承的財產不計入；6～9 年按 80/60/40/20% 扣除' },
    { k: 'growth', label: '後身故者財產年成長（%）', def: 0 },
  ];
  const STRAT = { claim: '配偶主張剩餘財產差額分配', noClaim: '配偶不主張差額分配', renounce: '配偶主張差額、拋棄繼承' };
  function renderSecond() {
    const v = (k) => val('sd', k) || 0;
    let r;
    try {
      r = X.compareSecondDeath({ a: v('a') * W, aPre: v('aPre') * W, aFree: v('aFree') * W, b: v('b') * W, bPre: v('bPre') * W, bFree: v('bFree') * W, kids: Math.max(0, Math.round(v('kids'))), gap: v('gap'), growth: v('growth') / 100 });
    } catch (e) { $('sd-result').innerHTML = `<p class="tax-err">${esc(e.message)}</p>`; return; }
    const by = Object.fromEntries(r.list.map((x) => [x.strategy, x]));
    const row = (label, f) => `<tr><td>${label}</td>${r.list.map((x) => `<td class="num${x.strategy === r.best ? ' best' : ''}">${f(x)}</td>`).join('')}</tr>`;
    const save = by.noClaim.total - by[r.best].total;
    $('sd-result').innerHTML = `<h2>兩次遺產稅比較</h2>
      <div class="tp-tw"><table class="tp-table"><thead><tr><th></th>${r.list.map((x) => `<th class="${x.strategy === r.best ? 'best' : ''}">${STRAT[x.strategy]}${x.strategy === r.best ? '<em>稅最少</em>' : ''}</th>`).join('')}</tr></thead><tbody>
        ${row('剩餘財產差額分配', (x) => wan(x.claim))}
        ${row('第一次遺產稅', (x) => wan(x.firstTax))}
        ${row('配偶繼承取得', (x) => wan(x.spouseGets))}
        ${row(`第二次：後身故者遺產（${v('gap')} 年後）`, (x) => wan(x.bEstate))}
        ${row('　5 年內再繼承不計入／6～9 年扣除', (x) => (x.exclude || x.deduct ? `−${wan(x.exclude || x.deduct)}` : '—'))}
        ${row('第二次遺產稅', (x) => wan(x.secondTax))}
        <tr class="total"><td>兩次合計</td>${r.list.map((x) => `<td class="num${x.strategy === r.best ? ' best' : ''}"><b>${wan(x.total)}</b></td>`).join('')}</tr>
        ${row('子女最後取得', (x) => wan(x.toKids))}
      </tbody></table></div>
      <p class="tp-verdict">${save > 0 ? `「${STRAT[r.best]}」比不主張差額分配少繳 <b>${wan(save)}</b>。` : '主張差額分配在第二次又被課回去，整體沒有省稅。'}只看第一次遺產稅會高估效果：差額分配給配偶的財產，第二次身故時會再課一次。</p>
      <ul class="tp-notes"><li>配偶即使拋棄繼承，仍可主張剩餘財產差額分配；拋棄後由子女直接繼承，可以避開第二次課稅。</li>
        <li>試算假設兩人都在 115 年規則下身故、子女都已成年、只有一位配偶；保險金、生前贈與另計。</li>
        <li>主張差額分配要有婚前財產證明；請求權自知悉起 2 年、法定財產制關係消滅起 5 年內行使。</li></ul>`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('mode-transfer')) return;
    form('tp-prop', 'tp', TP_PROP); form('tp-plan', 'tp', TP_PLAN); form('sd-form', 'sd', SD);
    document.addEventListener('input', (e) => { const el = e.target; if (!el.dataset || !el.dataset.ns) return; S[el.dataset.ns][el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; el.dataset.ns === 'tp' ? renderTransfer() : renderSecond(); });
    document.addEventListener('change', (e) => { const el = e.target; if (!el.dataset || !el.dataset.ns || el.type !== 'checkbox' && el.tagName !== 'SELECT') return; S[el.dataset.ns][el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; el.dataset.ns === 'tp' ? renderTransfer() : renderSecond(); });
    renderTransfer(); renderSecond();
  });
})();
