// ============================================================
// 傳承規劃頁：稅源（遺產稅 vs 可動用現金＋身故保險金）、法定應繼分與特留分、遺囑分配模擬、
// 受益人身故金與最低稅負
// 資料：clientList（保單）＋KB／kbCompute（身故給付）＋fin_*（資產負債）＋fo_people／person_relations（家族）
// 計算：legacy-calc.js（應繼分、分配、保險金）、tax-calc.js（遺產稅、最低稅負）、finance-calc.js（資產負債）
// 本頁不存檔；重新整理會清空
// ============================================================
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const T = EastoneTax, L = EastoneLegacy, W = T.W;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const wan = (yuan) => { const v = Math.round(yuan) / W; return (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('zh-TW') : v.toLocaleString('zh-TW', { maximumFractionDigits: 1 })) + ' 萬'; };
  const pct = (x) => `${(Math.round(x * 10000) / 100).toLocaleString('zh-TW')}%`;
  const frac = (x) => { for (const d of [1, 2, 3, 4, 6, 8, 9, 12, 16, 18, 24]) { const n = Math.round(x * d); if (n && Math.abs(n / d - x) < 1e-9) return d === 1 ? '全部' : `${n}/${d}`; } return pct(x); };
  const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const fullAge = (b, t) => { if (!b) return ''; const [y, m, d] = b.split('-').map(Number), [ty, tm, td] = t.split('-').map(Number); return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0); };
  let uid = 0; const nid = () => 'h' + (++uid);

  let CLIENTS = [], ME = null, heirs = [], DATA = null;

  // ---------- 家族名單 → 繼承人 ----------
  async function loadHeirs(clientId) {
    const [pr, rr] = await Promise.all([sb.from('fo_people').select('id,client_id,name,birthday'), sb.from('person_relations').select('a,b,kind')]);
    if (pr.error) throw pr.error; if (rr.error) throw rr.error;
    const people = pr.data || [], rels = rr.data || [], t = today();
    const by = new Map(people.map((p) => [p.id, p]));
    const me = new Set(people.filter((p) => p.client_id === clientId).map((p) => p.id));
    if (!me.size) return { heirs: [], note: '家族名單裡還沒有這位客戶，請在下方手動新增繼承人（或先到「家族」建立關係）。' };
    const mk = (p, rel, extra = {}) => ({ id: nid(), pid: p.id, name: p.name || '', rel, age: fullAge(p.birthday, t), alive: true, renounce: false, plan: '', ...extra });
    const childrenOf = (ids) => [...new Set(rels.filter((r) => r.kind === 'parent' && ids.has(r.a)).map((r) => r.b))].map((id) => by.get(id)).filter(Boolean);
    const parentsOf = (ids) => [...new Set(rels.filter((r) => r.kind === 'parent' && ids.has(r.b)).map((r) => r.a))].map((id) => by.get(id)).filter(Boolean);
    const out = [];
    rels.filter((r) => r.kind === 'spouse' && (me.has(r.a) || me.has(r.b))).forEach((r) => { const p = by.get(me.has(r.a) ? r.b : r.a); if (p && !out.some((h) => h.pid === p.id)) out.push(mk(p, 'spouse')); });
    const kids = childrenOf(me).sort((a, b) => String(a.birthday || '9').localeCompare(String(b.birthday || '9')));
    kids.forEach((k) => {
      const h = mk(k, 'child'); out.push(h);
      childrenOf(new Set([k.id])).forEach((g) => out.push(mk(g, 'grandchild', { via: h.id })));
    });
    const parents = parentsOf(me);
    parents.forEach((p) => out.push(mk(p, 'parent', { alive: !(p.birthday && fullAge(p.birthday, t) >= 100) })));
    const sib = new Set();
    rels.filter((r) => r.kind === 'sibling' && (me.has(r.a) || me.has(r.b))).forEach((r) => sib.add(me.has(r.a) ? r.b : r.a));
    childrenOf(new Set(parents.map((p) => p.id))).forEach((p) => { if (!me.has(p.id)) sib.add(p.id); });
    [...sib].map((id) => by.get(id)).filter(Boolean).forEach((p) => out.push(mk(p, 'sibling')));
    parentsOf(new Set(parents.map((p) => p.id))).forEach((p) => out.push(mk(p, 'grandparent', { alive: !(p.birthday && fullAge(p.birthday, t) >= 100) })));
    return { heirs: out, note: '' };
  }

  // ---------- 帶入 ----------
  async function load() {
    const id = ($('lg-client').value.split('｜')[1] || '').trim();
    if (!id) { $('lg-client').focus(); return; }
    ME = CLIENTS.find((c) => c.id === id);
    if (!ME) { $('lg-note').innerHTML = '<p class="tax-err">找不到這位客戶。</p>'; return; }
    $('lg-note').innerHTML = '<p class="tax-note">讀取中…</p>';
    try {
      // 團隊主管檢視成員的客戶：資產負債改用 team_fin（唯讀、留紀錄）
      let team = null;
      if (VIEW_OWNER) { const { data, error } = await sb.rpc('team_fin', { p_owner: VIEW_OWNER, p_client: id }); if (error) throw error; team = data || {}; }
      const pick = async (t) => {
        if (team) return team[{ fin_assets: 'assets', fin_asset_values: 'assetValues', fin_liabilities: 'liabilities', fin_liability_balances: 'liabilityBalances' }[t]] || [];
        const { data, error } = await sb.from(t).select('*').eq('client_id', id); if (error) throw error; return data || [];
      };
      const [fam, assets, assetValues, liabilities, liabilityBalances, fxRes, fx] = await Promise.all([
        loadHeirs(id).catch((e) => ({ heirs: [], note: `家族名單讀取失敗：${e.message || e}` })),
        pick('fin_assets'), pick('fin_asset_values'), pick('fin_liabilities'), pick('fin_liability_balances'),
        sb.from('fin_fx_quotes').select('*').order('quote_date', { ascending: false }).limit(2000),
        kbFetchFx().catch(() => null),
      ]);
      heirs = fam.heirs;
      const bs = FinCalc.balanceSheet({ assets, assetValues, liabilities, liabilityBalances, fx: fxRes.data || [], asOf: today() });
      const num = (b) => Math.round(FinCalc.toNum(b));
      // 課稅價值：房屋、土地有完整公告現值＋評定現值就取代市價
      let gross = num(bs.assetsTotal), reTax = 0, reMiss = 0;
      assets.filter((a) => ['house', 'land'].includes(a.category) && a.status !== 'archived').forEach((a) => {
        const row = bs.assetRows.find((r) => r.id === a.id);
        if (!row || !row.counted) return;
        const t = FinCalc.reTaxValue(a);
        if (!t.complete) { reMiss++; return; }
        if (row.base !== null && row.base !== undefined) gross -= num(row.base);
        gross += t.total; reTax++;
      });
      const LIQ = ['cash', 'deposit', 'fund', 'stock'];
      const liquid = bs.assetRows.filter((r) => r.counted && r.base != null && LIQ.includes((assets.find((a) => a.id === r.id) || {}).category)).reduce((s, r) => s + num(r.base), 0);
      // 保單：被繼承人是被保險人的壽險身故給付
      let res = null, kbErr = '';
      try { await KB.load(); res = kbCompute({ allClients: CLIENTS, insured: ME, fx }); } catch (e) { kbErr = e.message || String(e); }
      const policies = [], seen = new Map();
      if (res && res.values.death) res.values.death.rows.forEach((r) => {
        const k = `${r.ct.holderId}|${r.ct.policyIndex}`;
        const p = seen.get(k) || { amount: 0, applicant: r.ct.applicant, beneficiaries: r.ct.beneficiaries, label: `${r.ct.company || ''} ${r.ct.policy_no || ''}`.trim() || '保單' };
        p.amount += r.value; seen.set(k, p);
      });
      seen.forEach((p) => policies.push(p));
      const accDeath = res && res.values.acc_death ? res.values.acc_death.total : 0;
      const noKb = res ? res.contracts.filter((c) => !c.pending && !c.product && c.covered !== false && /壽/.test(`${c.cat1 || ''}${c.name || ''}`)).length + res.contracts.filter((c) => c.pending).length : 0;
      // 被繼承人當要保人、被保險人是別人的保單：保單價值列入遺產
      const asApplicant = CLIENTS.flatMap((c) => (c.policies || []).filter((p) => p.life && p.life.applicant_id === ME.id && (p.life.insured_id || c.id) !== ME.id).map((p) => `${c.name} ${p.policy_no || ''}`));
      DATA = { gross, marketNet: num(bs.assetsTotal) - num(bs.liabTotal), liab: num(bs.liabTotal), liquid, reTax, reMiss, miss: bs.missingCount, policies, accDeath, noKb, kbErr, asApplicant, hasFin: assets.length + liabilities.length > 0 };
      $('lg-note').innerHTML = `<div class="tax-imported"><ul>
        ${DATA.hasFin ? `<li>資產負債：資產 ${wan(num(bs.assetsTotal))}（市價）、負債 ${wan(DATA.liab)}；遺產稅以課稅價值 ${wan(gross)} 計算。</li>` : '<li class="warn">這位客戶在資產負債還沒有資料，遺產與稅源都會是 0；請先到「資產負債」建立。</li>'}
        ${reTax ? `<li>${reTax} 筆房屋／土地已改用公告土地現值＋房屋評定現值計稅。</li>` : ''}
        ${reMiss ? `<li class="warn">${reMiss} 筆房屋／土地缺課稅價值，暫以市價計稅（會高估遺產稅）。</li>` : ''}
        ${DATA.miss ? `<li class="warn">資產負債有 ${DATA.miss} 項未估值或缺匯率，未計入。</li>` : ''}
        <li>保單：${policies.length} 張有壽險身故給付${accDeath ? `；意外身故另有 ${wan(accDeath)}（本頁不計）` : ''}。${noKb ? `<span class="warn">另有 ${noKb} 張保單知識庫未建檔，身故金未計入。</span>` : ''}${kbErr ? `<span class="warn">保單計算失敗：${esc(kbErr)}</span>` : ''}</li>
        ${asApplicant.length ? `<li class="warn">被繼承人是要保人、但被保險人是別人的保單 ${asApplicant.length} 張（${asApplicant.map(esc).join('、')}）：其保單價值準備金屬於遺產，請確認已列在資產負債。</li>` : ''}
        ${fam.note ? `<li class="warn">${esc(fam.note)}</li>` : `<li>從家族名單帶入 ${heirs.length} 位親屬；請確認<b>是否在世</b>、有沒有人要<b>拋棄繼承</b>。</li>`}
      </ul></div>`;
      $('lg-body').hidden = false;
      renderHeirs(); render();
    } catch (e) { $('lg-note').innerHTML = `<p class="tax-err">讀取失敗：${esc(e.message || e)}</p>`; }
  }

  // ---------- 繼承人表格 ----------
  function renderHeirs() {
    const kids = heirs.filter((h) => h.rel === 'child');
    $('lg-heirs').innerHTML = heirs.length ? `<div class="lg-heir-table"><table class="tax-table"><thead><tr><th>姓名</th><th>關係</th><th>年齡</th><th>在世</th><th>拋棄繼承</th><th>遺囑分配 %</th><th></th></tr></thead><tbody>
      ${heirs.map((h, i) => `<tr data-i="${i}" class="${h.alive === false || h.renounce ? 'dim' : ''}">
        <td><input data-f="name" value="${esc(h.name)}" placeholder="姓名"></td>
        <td><select data-f="rel">${Object.entries(L.REL).map(([k, v]) => `<option value="${k}"${k === h.rel ? ' selected' : ''}>${v}</option>`).join('')}</select>
          ${h.rel === 'grandchild' ? `<select data-f="via" class="lg-via"><option value="">（其父母是？）</option>${kids.map((k) => `<option value="${k.id}"${k.id === h.via ? ' selected' : ''}>${esc(k.name || '子女')} 的子女</option>`).join('')}</select>` : ''}</td>
        <td><input data-f="age" type="number" min="0" max="130" inputmode="numeric" value="${esc(h.age)}" class="lg-age"></td>
        <td><input data-f="alive" type="checkbox" ${h.alive !== false ? 'checked' : ''}></td>
        <td><input data-f="renounce" type="checkbox" ${h.renounce ? 'checked' : ''}></td>
        <td><input data-f="plan" type="number" min="0" max="100" step="any" inputmode="decimal" value="${esc(h.plan)}" class="lg-plan" placeholder="法定"></td>
        <td><button type="button" class="tp-del" data-del="${i}" title="移除">✕</button></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="tax-empty">尚未有繼承人，請用下方按鈕新增。</p>';
  }

  // ---------- 計算與畫面 ----------
  function render() {
    if (!DATA) return;
    const box = $('lg-result');
    const nameOf = (id) => (heirs.find((h) => h.id === id) || {}).name || '（未填姓名）';
    const shares = L.legalShares(heirs);
    // 遺產稅扣除額：配偶（在世即可扣）、直系血親卑親屬（為繼承人者；子女拋棄由孫子女繼承時以原子女人數為限）、父母（在世）
    const heirRows = shares.rows.map((r) => ({ ...r, h: heirs.find((x) => x.id === r.id) }));
    let desc = heirRows.filter((r) => ['child', 'grandchild'].includes(r.h.rel));
    const kidsAll = heirs.filter((h) => h.rel === 'child');
    if (desc.length && desc.every((r) => r.h.rel === 'grandchild') && kidsAll.length && kidsAll.every((k) => k.renounce)) desc = desc.slice(0, kidsAll.length);
    const spouse = heirs.find((h) => h.rel === 'spouse' && h.alive !== false);
    const parents = heirs.filter((h) => h.rel === 'parent' && h.alive !== false).slice(0, 2);
    let est;
    try {
      est = T.estate({ gross: DATA.gross, exemption: true, funeral: true, spouse: { on: !!spouse }, descendants: desc.map((r) => ({ age: r.h.age === '' ? null : r.h.age })),
        parents: parents.map(() => ({})), debts: DATA.liab });
    } catch (e) { box.innerHTML = `<p class="tax-err">${esc(e.message)}</p>`; return; }
    const tax = est.tax;
    // 身故保險金
    const ins = L.allocateInsurance(DATA.policies, shares.rows, nameOf);
    const insToPeople = ins.people.reduce((s, p) => s + p.amount, 0);
    // 稅源
    const cashAfter = DATA.liquid - tax;
    const status = tax === 0 ? 'none' : DATA.liquid >= tax ? 'ok' : DATA.liquid + insToPeople >= tax ? 'ins' : 'gap';
    const gap = Math.max(0, tax - DATA.liquid - insToPeople);
    // 分配（市價淨額 − 遺產稅 ＋ 無受益人保險金）
    const distNet = Math.max(0, DATA.marketNet - tax + ins.estateIn);
    const plan = {}; heirs.forEach((h) => { if (h.plan !== '' && h.plan != null) plan[h.id] = Number(h.plan) / 100; });
    const dist = L.distribute(distNet, shares, plan);
    const insOf = (id) => (ins.people.find((p) => p.name === nameOf(id)) || { amount: 0 }).amount;
    const R = T.RULES.amt;
    const amtRows = ins.people.map((p) => {
      const over = p.amtCounted > R.deathExempt;
      const a = over ? T.amt({ netIncome: 0, deathBenefit: p.amtCounted }) : null;
      return { ...p, over, due: a ? a.due : 0 };
    });
    const maxBar = Math.max(tax, DATA.liquid + insToPeople, 1);
    box.innerHTML = `
      <h2>傳承規劃試算<small class="tax-h-sub">${esc(ME.name)}・以 ${today()} 身故試算</small></h2>
      <div class="lg-kpis">
        <div><span>遺產總額（課稅價值）</span><b>${wan(est.gross)}</b></div>
        <div class="em"><span>應納遺產稅（估）</span><b>${wan(tax)}</b><em>${est.gross ? `有效稅率 ${pct(est.effectiveRate)}` : ''}</em></div>
        <div><span>可動用現金</span><b>${wan(DATA.liquid)}</b><em>存款、現金、基金、股票</em></div>
        <div><span>身故保險金（給受益人）</span><b>${wan(insToPeople)}</b><em>不計入遺產</em></div>
      </div>

      <h3>一、稅源：遺產稅繳得出來嗎？</h3>
      <div class="lg-src">
        <div class="lg-src-row"><span>遺產稅</span><div class="lg-bar"><i class="t" style="width:${tax / maxBar * 100}%"></i></div><b>${wan(tax)}</b></div>
        <div class="lg-src-row"><span>現金＋保險金</span><div class="lg-bar"><i class="c" style="width:${Math.min(DATA.liquid, maxBar) / maxBar * 100}%"></i><i class="s" style="width:${insToPeople / maxBar * 100}%"></i></div><b>${wan(DATA.liquid + insToPeople)}</b></div>
      </div>
      <p class="lg-verdict ${status}">${{
        none: '目前不用繳遺產稅（扣除額已足夠）。',
        ok: `可動用現金足以繳遺產稅，繳完還剩 ${wan(cashAfter)}。`,
        ins: `現金不夠繳稅，差 ${wan(-cashAfter)}；要靠受益人拿身故保險金先墊繳。<b>保險金屬於受益人、不是遺產</b>，請事先跟受益人說清楚用途，或考慮把受益人安排成負責繳稅的人。`,
        gap: `現金加保險金仍不夠繳稅，<b>缺口 ${wan(gap)}</b>。繼承人可能得先借錢或賣不動產；可以考慮增加壽險保額、申請以實物抵繳或分期繳納。`,
      }[status]}</p>
      <p class="tax-note">遺產稅要在繳清（或核准分期、實物抵繳）後才能辦理不動產繼承登記；銀行存款在完稅前通常也會被凍結，實際可動用的現金可能更少。</p>

      <h3>二、繼承人與分配　<small>${esc(shares.orderLabel)}</small></h3>
      <p class="tax-note">可分配遺產（市價）＝資產 − 負債 − 遺產稅${ins.estateIn ? ' ＋ 沒有指定受益人的保險金' : ''}＝ <b>${wan(distNet)}</b>${dist.usePlan ? `；遺囑分配合計 ${pct(dist.planSum)}${Math.abs(dist.planSum - 1) > 0.0001 ? '<span class="warn">（不是 100%）</span>' : ''}` : '；尚未填遺囑分配，以法定應繼分計算'}。</p>
      ${dist.rows.length ? `<div class="lg-scroll"><table class="tax-table lg-dist"><thead><tr><th>繼承人</th><th>應繼分</th><th>特留分</th><th class="num">${dist.usePlan ? '遺囑分得' : '法定分得'}</th><th class="num">身故保險金</th><th class="num">合計</th><th>特留分檢查</th></tr></thead><tbody>
        ${dist.rows.map((r) => `<tr class="${r.violated ? 'bad' : ''}"><td><b>${esc(nameOf(r.id))}</b><small>${esc(r.why)}</small></td><td>${frac(r.share)}</td><td>${frac(r.reserve)}<small>${wan(r.reserveAmt)}</small></td>
          <td class="num">${wan(r.amount)}${dist.usePlan ? `<small>${pct(r.ratio)}</small>` : ''}</td><td class="num">${wan(insOf(r.id))}</td><td class="num"><b>${wan(r.amount + insOf(r.id))}</b></td>
          <td>${r.violated ? `<span class="warn">侵害，差 ${wan(r.short)}</span>` : '<span class="ok">✓</span>'}</td></tr>`).join('')}
        ${dist.others.map((o) => `<tr><td><b>${esc(nameOf(o.id))}</b><small>非繼承人（遺贈）</small></td><td>—</td><td>—</td><td class="num">${wan(o.amount)}<small>${pct(o.ratio)}</small></td><td class="num">${wan(insOf(o.id))}</td><td class="num"><b>${wan(o.amount + insOf(o.id))}</b></td><td>—</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="tax-empty">沒有繼承人。</p>'}
      ${dist.violated.length ? `<p class="lg-verdict gap">遺囑分配侵害 ${dist.violated.map((r) => esc(nameOf(r.id))).join('、')} 的特留分；他們可以行使扣減權，遺囑在這部分會被打折。若想多照顧某人，用<b>指定受益人的保險金</b>補足，不受特留分限制。</p>` : ''}
      ${shares.notes.map((n) => `<p class="tax-note">${esc(n)}</p>`).join('')}

      <h3>三、受益人與最低稅負</h3>
      ${amtRows.length ? `<div class="lg-scroll"><table class="tax-table"><thead><tr><th>受益人</th><th class="num">身故保險金</th><th class="num">計入最低稅負</th><th>判斷</th></tr></thead><tbody>
        ${amtRows.map((p) => `<tr class="${p.over ? 'bad' : ''}"><td><b>${esc(p.name)}</b><small>${p.items.map((x) => esc(x.label)).join('、')}</small></td><td class="num">${wan(p.amount)}</td><td class="num">${wan(p.amtCounted)}</td>
          <td>${p.over ? `<span class="warn">超過 ${wan(R.deathExempt)}，至少約補 ${wan(p.due)}</span>` : `<span class="ok">✓ 在 ${wan(R.deathExempt)} 以內</span>`}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="tax-note">要保人與受益人不同人時，身故保險金才計入受益人的基本所得額；每一申報戶全年 ${wan(R.deathExempt)} 以內免計。「至少約補」只算保險金、未含受益人本身的所得；要精算請到<a href="tax.html">稅務規劃 → 最低稅負</a>。</p>`
      : '<p class="tax-empty">沒有可計算的壽險身故給付。</p>'}
      ${ins.estateIn ? `<p class="lg-verdict ins">有 ${wan(ins.estateIn)} 的保險金沒有指定受益人，會列入遺產、一起課遺產稅，也要照應繼分分配。建議補指定受益人。</p>` : ''}
      <p class="tax-note">高齡、短期、躉繳或帶病投保、鉅額保費等情形，國稅局可能依實質課稅原則把保險金列入遺產；規劃時請避開這些特徵。</p>

      <details class="tax-detail"><summary>遺產稅計算明細（扣除 ${wan(est.totalOff)}、課稅淨額 ${wan(est.net)}）</summary>
        <table class="tax-table"><tbody>${est.items.map((x) => `<tr><td>${esc(x.label)}</td><td class="num">${wan(x.amount)}</td></tr>`).join('')}</tbody></table>
      </details>
      <div class="tax-actions"><button type="button" class="btn-secondary" onclick="window.print()">列印／另存 PDF</button></div>`;
  }

  // ---------- 啟動 ----------
  async function init() {
    try { await requireLogin('../'); } catch { $('tax-load').textContent = '目前無法確認登入，請重新整理後再試。'; return; }
    try { CLIENTS = await clientList(); } catch (e) { $('tax-load').textContent = '讀取客戶失敗：' + (e.message || e); return; }
    PICK_SOURCES['lg-client'] = (input) => {
      const kw = input.value.split('｜')[0].trim().toLowerCase();
      return [{ label: '客戶', layout: 'list', options: CLIENTS.filter((c) => !kw || `${c.name}${c.id}`.toLowerCase().includes(kw)).slice(0, 60)
        .map((c) => ({ value: `${c.name}｜${c.id}`, label: c.name || c.id, sub: c.id })) }];
    };
    $('lg-load').addEventListener('click', load);
    $('lg-client').addEventListener('change', load);
    const tb = $('lg-heirs');
    tb.addEventListener('input', (e) => {
      const tr = e.target.closest('tr[data-i]'); if (!tr) return;
      const h = heirs[+tr.dataset.i], f = e.target.dataset.f;
      if (!f) return;
      h[f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      if (['rel', 'via', 'alive', 'renounce'].includes(f)) renderHeirs();
      render();
    });
    tb.addEventListener('click', (e) => { const d = e.target.dataset.del; if (d === undefined) return; const gone = heirs[+d]; heirs.splice(+d, 1); heirs.forEach((h) => { if (h.via === gone.id) h.via = ''; }); renderHeirs(); render(); });
    document.querySelectorAll('[data-addrel]').forEach((b) => b.addEventListener('click', () => { heirs.push({ id: nid(), name: '', rel: b.dataset.addrel, age: '', alive: true, renounce: false, plan: '' }); renderHeirs(); render(); }));
    const pre = new URLSearchParams(location.search).get('id');
    if (pre) { const c = CLIENTS.find((x) => x.id === pre.toUpperCase()); if (c) { $('lg-client').value = `${c.name}｜${c.id}`; load(); } }
    $('tax-load').hidden = true;
    $('tax-main').hidden = false;
  }
  document.addEventListener('DOMContentLoaded', init);
})();
