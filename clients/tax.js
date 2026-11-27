// ============================================================
// 稅務規劃頁：遺產稅（勾選免稅扣除額＋人員清單，可從家族名單帶入子女）、贈與稅（逐筆記帳）、
// 最低稅負（受益人領身故保險金時的基本稅額）
// 金額輸入以「萬元」為單位，計算交給 tax-calc.js（以元計）；結果即時更新，不存資料庫
// ============================================================
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const T = EastoneTax;
  const W = T.W;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toYuan = (v) => Math.round(Number(v || 0) * W);
  const wan = (yuan) => {
    const v = yuan / W;
    return (Number.isInteger(v) ? v.toLocaleString('zh-TW') : v.toLocaleString('zh-TW', { maximumFractionDigits: 4 })) + ' 萬';
  };
  const ntd = (yuan) => 'NT$ ' + Math.round(yuan).toLocaleString('zh-TW');

  // ---------- 進度條（課稅級距）----------
  // segs: [{ to, rate, label }]（最後一段 to = Infinity），value：放進去的金額（元）
  // 每個級距等寬顯示（避免 0% 那段太窄看不到），段內依金額比例填滿
  function bar(segs, value, valueLabel) {
    const finite = segs.filter((s) => s.to !== Infinity).map((s) => s.to);
    const lastTop = Math.max(value * 1.1, finite[finite.length - 1] * 1.5);
    const w = 100 / segs.length;
    let prev = 0, pos = 0;
    const blocks = segs.map((s, i) => {
      const to = s.to === Infinity ? lastTop : s.to;
      const ratio = Math.max(0, Math.min(value, to) - prev) / (to - prev);
      if (value > prev) pos = i * w + Math.min(1, ratio) * w;
      prev = to;
      return `<div class="tb-seg r${s.rate}" style="width:${w}%"><div class="tb-fill" style="width:${ratio * 100}%"></div><span class="tb-rate">${s.rate}%</span></div>`;
    }).join('');
    const ticks = finite.map((t, i) => `<span class="tb-tick" style="left:${(i + 1) * w}%">${wan(t)}</span>`).join('');
    return `<div class="tb">
      <div class="tb-marker" style="left:${Math.min(100, pos)}%"><b>${valueLabel}</b><i></i></div>
      <div class="tb-track">${blocks}</div>
      <div class="tb-ticks">${ticks}</div>
    </div>`;
  }

  // ---------- 遺產稅 ----------
  const est = { exemption: true, necessities: false, tools: false, spouse: false, funeral: true, descendants: [], parents: [], dependents: [] };

  function personRow(list, p, i) {
    const withAge = list !== 'parents';
    const withDis = list !== 'dependents';
    return `<div class="tax-person" data-list="${list}" data-i="${i}">
      <span class="tp-no">${i + 1}</span>
      ${p.name ? `<span class="tp-name">${esc(p.name)}${p.birthday ? `<small>${esc(p.birthday)} 生</small>` : ''}</span>` : ''}
      ${withAge ? `<label>年齡<input type="number" min="0" max="130" step="1" inputmode="numeric" data-f="age" value="${esc(p.age)}" placeholder="18 歲以上可留空"></label>` : ''}
      ${withDis ? `<label class="tax-check"><input type="checkbox" data-f="disabled" ${p.disabled ? 'checked' : ''}> 重度以上身心障礙（加 693 萬）</label>` : ''}
      <span class="tp-amt" data-amt></span>
      <button type="button" class="tp-del" title="移除">✕</button>
    </div>`;
  }
  function renderPeople() {
    ['descendants', 'parents', 'dependents'].forEach((k) => {
      $('list-' + k).innerHTML = est[k].map((p, i) => personRow(k, p, i)).join('') || '<p class="tax-empty">尚未新增</p>';
    });
    document.querySelector('.tax-add[data-list="parents"]').disabled = est.parents.length >= 2;
  }

  function estateInput() {
    return {
      gross: toYuan($('es-gross').value),
      exemption: est.exemption, necessities: est.necessities, tools: est.tools, funeral: est.funeral,
      spouse: { on: est.spouse, disabled: $('es-spouse-dis').querySelector('input').checked },
      descendants: est.descendants, parents: est.parents, dependents: est.dependents,
      debts: toYuan($('es-debts').value),
    };
  }

  function renderEstate() {
    const box = $('es-result');
    let r;
    try { r = T.estate(estateInput()); } catch (e) { box.innerHTML = `<p class="tax-err">${esc(e.message)}</p>`; return; }
    // 每位人員旁邊顯示可扣金額
    const R = T.RULES.estate;
    document.querySelectorAll('.tax-person').forEach((row) => {
      const p = est[row.dataset.list][+row.dataset.i];
      const a = p.age === '' || p.age === undefined || p.age === null ? null : Number(p.age);
      const extra = row.dataset.list === 'parents' ? 0 : (a !== null && a < 18 ? 18 - a : 0);
      const base = row.dataset.list === 'parents' ? R.parent : R.descendant;
      row.querySelector('[data-amt]').textContent = wan(base * (1 + extra) + (p.disabled ? R.disability : 0));
    });
    const segs = R.brackets.map(([to, rate]) => ({ to, rate }));
    box.innerHTML = `
      <h2>遺產稅試算</h2>
      <div class="tax-eq">
        <div><span>遺產總額</span><b>${wan(r.gross)}</b></div><em>−</em>
        <div><span>免稅額＋不計入＋扣除額</span><b>${wan(r.totalOff)}</b></div><em>＝</em>
        <div class="em"><span>課稅遺產淨額</span><b>${wan(r.net)}</b></div>
      </div>
      <h3>課稅級距</h3>
      ${bar(segs, r.net, wan(r.net))}
      <table class="tax-table"><tbody>
        ${r.bands.map((b) => `<tr class="${b.base ? '' : 'dim'}"><td>${b.to === Infinity ? `${wan(b.from)} 以上` : `${b.from ? wan(b.from) + '～' : ''}${wan(b.to)}${b.from ? '' : ' 以下'}`}</td><td>${b.rate}%</td><td class="num">${wan(b.base)}</td><td class="num">${ntd(b.tax)}</td></tr>`).join('')}
        <tr class="total"><td colspan="3">應納遺產稅（估）</td><td class="num">${ntd(r.tax)}</td></tr>
      </tbody></table>
      <details class="tax-detail"><summary>免稅額與扣除額明細（${r.items.length} 項，合計 ${wan(r.totalOff)}）</summary>
        <table class="tax-table"><tbody>${r.items.map((x) => `<tr><td>${esc(x.label)}</td><td class="num">${wan(x.amount)}</td></tr>`).join('') || '<tr><td>尚未勾選</td></tr>'}</tbody></table>
      </details>
      <div class="tax-actions"><button type="button" class="btn-secondary" onclick="window.print()">列印／另存 PDF</button></div>`;
  }

  // ---------- 贈與稅 ----------
  const gifts = [];
  let form = 'cash';

  function renderGifts() {
    $('gf-list').innerHTML = gifts.length ? `<table class="tax-table gift-table"><thead><tr><th>#</th><th>受贈人</th><th>形式</th><th class="num">金額</th><th></th></tr></thead><tbody>
      ${gifts.map((g, i) => `<tr><td>${i + 1}</td><td>${esc(g.recipient || '（未填）')}</td><td>${T.FORMS[g.form]}</td><td class="num">${wan(g.amount)}</td><td><button type="button" class="tp-del" data-del="${i}" title="刪除">✕</button></td></tr>`).join('')}
    </tbody></table>` : '<p class="tax-empty">還沒有贈與紀錄，從上面記第一筆。</p>';
    $('gf-list').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { gifts.splice(+b.dataset.del, 1); renderGifts(); }));
    const r = T.gift(gifts);
    const ex = r.exemption;
    // 進度條放「年度贈與總額」：前 244 萬免稅，之後依贈與淨額 2,811 萬、5,621 萬分段
    const segs = [{ to: ex, rate: 0 }, ...T.RULES.gift.brackets.map(([to, rate]) => ({ to: to === Infinity ? Infinity : to + ex, rate }))];
    $('gf-result').innerHTML = `
      <h2>贈與稅試算</h2>
      <div class="tax-eq">
        <div><span>年度贈與總額</span><b>${wan(r.total)}</b></div><em>−</em>
        <div><span>免稅額</span><b>${wan(ex)}</b></div><em>＝</em>
        <div class="em"><span>贈與淨額</span><b>${wan(r.net)}</b></div>
      </div>
      <p class="tax-note">${r.remaining > 0 ? `今年還可以免稅再送 <b>${wan(r.remaining)}</b>。` : '今年的 244 萬免稅額已用完，超過部分要課贈與稅。'}</p>
      <h3>課稅級距（以年度贈與總額顯示）</h3>
      ${bar(segs, r.total, wan(r.total))}
      <table class="tax-table"><tbody>
        <tr class="${r.total ? '' : 'dim'}"><td>${wan(ex)} 以下</td><td>0%</td><td class="num">${wan(Math.min(r.total, ex))}</td><td class="num">${ntd(0)}</td></tr>
        ${r.bands.map((b) => `<tr class="${b.base ? '' : 'dim'}"><td>${b.to === Infinity ? `${wan(b.from + ex)} 以上` : `${wan(b.from + ex)}～${wan(b.to + ex)}`}<small>（淨額 ${b.to === Infinity ? wan(b.from) + ' 以上' : wan(b.to) + (b.from ? '' : ' 以下')}）</small></td><td>${b.rate}%</td><td class="num">${wan(b.base)}</td><td class="num">${ntd(b.tax)}</td></tr>`).join('')}
        <tr class="total"><td colspan="3">應納贈與稅（估）</td><td class="num">${ntd(r.tax)}</td></tr>
      </tbody></table>
      ${gifts.length ? `<div class="tax-split">
        <div><h3>依受贈人</h3>${Object.entries(r.byRecipient).map(([k, v]) => `<p><span>${esc(k)}</span><b>${wan(v)}</b></p>`).join('')}</div>
        <div><h3>依贈與形式</h3>${Object.entries(r.byForm).map(([k, v]) => `<p><span>${k}</span><b>${wan(v)}</b></p>`).join('')}</div>
      </div>` : ''}
      <p class="tax-note">贈與總額超過 244 萬時，應在超過免稅額的那筆贈與後 30 日內申報。配偶間贈與、子女婚嫁時各 100 萬以內的贈與不計入贈與總額，這類請不要記進來。</p>
      <div class="tax-actions"><button type="button" class="btn-secondary" onclick="window.print()">列印／另存 PDF</button></div>`;
  }

  function addGift() {
    const amount = toYuan($('gf-amount').value);
    if (!(amount > 0)) { $('gf-amount').focus(); $('gf-amount').classList.add('bad'); return; }
    $('gf-amount').classList.remove('bad');
    gifts.push({ recipient: $('gf-recipient').value.trim(), form, amount });
    $('gf-amount').value = '';
    renderGifts();
    $('gf-amount').focus();
  }

  // ---------- 從資產負債帶入（以今天為基準日，等於「此刻身故」）----------
  async function importFromFinance() {
    const id = ($('es-client').value.split('｜')[1] || '').trim();
    const note = $('es-import-note');
    if (!id) { $('es-client').focus(); return; }
    note.innerHTML = '<p class="tax-note">讀取中…</p>';
    let famNote = '';
    try { famNote = await importFamily(id); } catch (e) { famNote = `<li class="warn">家族名單讀取失敗：${esc(e.message || e)}</li>`; }
    try {
      const pick = async (t) => { const { data, error } = await sb.from(t).select('*').eq('client_id', id); if (error) throw error; return data || []; };
      const [assets, assetValues, liabilities, liabilityBalances, fxRes] = await Promise.all([
        pick('fin_assets'), pick('fin_asset_values'), pick('fin_liabilities'), pick('fin_liability_balances'),
        sb.from('fin_fx_quotes').select('*').order('quote_date', { ascending: false }).limit(2000),
      ]);
      if (!assets.length && !liabilities.length) { note.innerHTML = `<div class="tax-imported"><p class="tax-err">這位客戶在資產負債還沒有資料，遺產總額請自行填寫。</p><ul>${famNote}</ul></div>`; renderPeople(); renderEstate(); return; }
      const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
      const bs = FinCalc.balanceSheet({ assets, assetValues, liabilities, liabilityBalances, fx: fxRes.data || [], asOf: today });
      const toWan = (big) => Math.round(FinCalc.toNum(big) / W * 10000) / 10000;
      // 房屋、土地：有完整課稅價值（公告現值＋評定現值）就用課稅價值取代市價
      let gross = bs.assetsTotal, reTax = 0, reMarket = 0;
      const reList = assets.filter((a) => ['house', 'land'].includes(a.category) && a.status !== 'archived');
      reList.forEach((a) => {
        const t = FinCalc.reTaxValue(a);
        if (!t.complete) return;
        const row = bs.assetRows.find((r) => r.id === a.id);
        if (!row || !row.counted) return;
        if (row.base !== null && row.base !== undefined) { gross -= row.base; reMarket++; }
        gross += FinCalc.D(t.total); reTax++;
      });
      $('es-gross').value = toWan(gross);
      $('es-debts').value = bs.liabTotal > 0n ? toWan(bs.liabTotal) : '';
      const miss = bs.missingCount;
      const houses = reList.length;
      const policies = assets.filter((a) => ['savings_policy', 'investment_policy'].includes(a.category) && a.status !== 'archived').length;
      note.innerHTML = `<div class="tax-imported">
        <p>已帶入 <b>${esc($('es-client').value.split('｜')[0])}</b> 截至 ${today} 的資料：資產 ${wan(Math.round(FinCalc.toNum(gross)))}（遺產總額）、負債 ${wan(Math.round(FinCalc.toNum(bs.liabTotal)))}（其他扣除額）。</p>
        <ul>
          ${miss ? `<li class="warn">資產負債有 ${miss} 項未估值或缺匯率，未包含在內。</li>` : ''}
          ${reTax ? `<li>${reTax} 筆房屋／土地已改用課稅價值（公告土地現值＋房屋評定現值）計入，不是市價。</li>` : ''}
          ${houses - reTax > 0 ? `<li class="warn">${houses - reTax} 筆房屋／土地缺課稅價值，暫以市價計入（會高估遺產稅）；請到資產負債上傳謄本或房屋稅單補齊。</li>` : ''}
          ${policies ? `<li>保單：指定受益人的身故保險金不計入遺產；被繼承人當要保人、但被保險人是別人的保單，才以保單價值列入遺產。請依實際情況調整。</li>` : ''}
          ${famNote}
          <li>帶入後仍可自行修改；扣除額請依家庭狀況在下方勾選。</li>
        </ul></div>`;
      renderPeople(); renderEstate();
    } catch (e) { note.innerHTML = `<p class="tax-err">讀取失敗：${esc(e.message || e)}</p>`; }
  }

  // ---------- 從家族名單帶入：子女（直系血親卑親屬）、配偶 ----------
  // 年齡以今天計算足歲；未滿 18 歲加扣的年數＝18 − 足歲（未滿一年以一年計，與足歲算法一致）
  const fullAge = (birthday, today) => {
    if (!birthday) return '';
    const [y, m, d] = birthday.split('-').map(Number), [ty, tm, td] = today.split('-').map(Number);
    return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
  };
  async function importFamily(clientId) {
    const [pr, rr] = await Promise.all([sb.from('fo_people').select('id,client_id,name,birthday'), sb.from('person_relations').select('a,b,kind')]);
    if (pr.error) throw pr.error; if (rr.error) throw rr.error;
    const people = pr.data || [], rels = rr.data || [];
    const byId = new Map(people.map((p) => [p.id, p]));
    const me = new Set(people.filter((p) => p.client_id === clientId).map((p) => p.id));
    if (!me.size) return '<li>家族名單裡還沒有這位客戶，直系血親卑親屬請手動新增（或先到「家族」建立關係）。</li>';
    const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    const kids = [...new Set(rels.filter((r) => r.kind === 'parent' && me.has(r.a)).map((r) => r.b))].map((id) => byId.get(id)).filter(Boolean)
      .sort((a, b) => String(a.birthday || '9').localeCompare(String(b.birthday || '9')));
    const kidIds = new Set(kids.map((k) => k.id));
    const grand = new Set(rels.filter((r) => r.kind === 'parent' && kidIds.has(r.a)).map((r) => r.b));
    const spouse = rels.some((r) => r.kind === 'spouse' && (me.has(r.a) || me.has(r.b)));
    const parents = new Set(rels.filter((r) => r.kind === 'parent' && me.has(r.b)).map((r) => r.a));
    est.descendants = kids.map((k) => ({ name: k.name, birthday: k.birthday || '', age: fullAge(k.birthday, today), disabled: false }));
    if (spouse && !est.spouse) {
      est.spouse = true;
      document.querySelector('#mode-estate .tax-chip[data-k="spouse"]').classList.add('on');
      $('es-spouse-dis').hidden = false;
    }
    const noBirth = kids.filter((k) => !k.birthday).length;
    return [
      `<li>從家族名單帶入子女 ${kids.length} 位${kids.length ? `（${kids.map((k) => esc(k.name)).join('、')}）` : ''}，年齡依生日算到今天，可直接修改。</li>`,
      noBirth ? `<li class="warn">${noBirth} 位子女沒有生日，年齡留空（以成年計）；未成年請補上年齡。</li>` : '',
      spouse ? '<li>家族名單有配偶，已勾選配偶扣除額；若已離婚或配偶過世，請取消。</li>' : '',
      grand.size ? `<li>孫子女 ${grand.size} 位未列入：孫子女要成為繼承人才能扣。子女先過世（代位繼承）時，代位的孫子女每人可扣 56 萬（未成年另加扣），請手動新增；子女拋棄繼承改由孫子女繼承時，扣除額仍以原本子女的人數為限，不增加。</li>` : '',
      parents.size ? `<li>家族名單有父母 ${parents.size} 位，未自動加入；仍在世者請在「父母」手動新增（每人 138 萬）。</li>` : '',
    ].join('');
  }

  // ---------- 最低稅負（受益人）----------
  function renderAmt() {
    const box = $('am-result');
    const auto = $('am-auto').checked;
    $('am-regular').disabled = auto;
    let r;
    try {
      r = T.amt({ netIncome: toYuan($('am-net').value), regularTax: auto ? null : toYuan($('am-regular').value),
        deathBenefit: toYuan($('am-death').value), otherBenefit: toYuan($('am-benefit').value), overseas: toYuan($('am-overseas').value), other: toYuan($('am-other').value) });
    } catch (e) { box.innerHTML = `<p class="tax-err">${esc(e.message)}</p>`; return; }
    if (auto) $('am-regular').value = r.regularTax ? Math.round(r.regularTax / W * 10000) / 10000 : '';
    const R = T.RULES.amt;
    box.innerHTML = `
      <h2>最低稅負試算</h2>
      <div class="tax-eq">
        <div><span>基本所得額</span><b>${wan(r.base)}</b></div><em>−</em>
        <div><span>扣除額</span><b>${wan(r.deduction)}</b></div><em>×</em>
        <div><span>稅率</span><b>${r.rate}%</b></div><em>＝</em>
        <div class="em"><span>基本稅額</span><b>${ntd(r.basicTax)}</b></div>
      </div>
      <table class="tax-table"><tbody>
        ${r.items.map((x) => `<tr class="${x.amount ? '' : 'dim'}"><td>${esc(x.label)}${x.note ? `<small>（${esc(x.note)}）</small>` : ''}</td><td class="num">${wan(x.amount)}</td></tr>`).join('')}
        <tr class="total"><td>基本所得額</td><td class="num">${wan(r.base)}</td></tr>
      </tbody></table>
      <table class="tax-table"><tbody>
        <tr><td>基本稅額（(基本所得額 − ${wan(r.deduction)}) × ${r.rate}%）</td><td class="num">${ntd(r.basicTax)}</td></tr>
        <tr><td>一般所得稅額${r.autoTax ? '（依綜所稅級距估算）' : ''}</td><td class="num">− ${ntd(r.regularTax)}</td></tr>
        <tr class="total"><td>應另繳基本稅額（估）</td><td class="num">${ntd(r.due)}</td></tr>
      </tbody></table>
      <p class="tax-note ${r.due ? 'warn' : ''}">${r.due
        ? `基本稅額高於一般所得稅額，差額 <b>${ntd(r.due)}</b> 要在當年度綜所稅結算時一併繳納。`
        : '基本稅額沒有超過一般所得稅額，不用另外繳最低稅負。'}
        其他條件不變下，這位受益人（申報戶）同一年領到的身故保險金在 <b>${wan(r.safeDeath)}</b> 以內，不會因為保險金多繳稅。</p>
      <ul class="tax-ul">
        <li>只計入「要保人與受益人不同人」的人壽、年金保險給付（93 年以後訂立的契約）；要保人＝受益人的不計入。</li>
        <li>身故給付以<b>受益人整個申報戶、全年合計</b>算 ${wan(R.deathExempt)} 免計額度：夫妻同一申報戶、同一年各領一筆，要合併計算。</li>
        <li>生存、滿期、年金給付沒有免計額度，全數計入。</li>
        <li>若被繼承人以「實質課稅」被核定要課遺產稅的保單，處理方式不同，本頁不涵蓋。</li>
      </ul>
      <div class="tax-actions"><button type="button" class="btn-secondary" onclick="window.print()">列印／另存 PDF</button></div>`;
  }

  // ---------- 啟動 ----------
  async function init() {
    try { await requireLogin('../'); } catch { $('tax-load').textContent = '目前無法確認登入，請重新整理後再試。'; return; }

    document.querySelectorAll('.tax-mode').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('.tax-mode').forEach((x) => x.classList.toggle('active', x === b));
      document.querySelectorAll('#tax-main > section[id^="mode-"]').forEach((sec) => { sec.hidden = sec.id !== `mode-${b.dataset.mode}`; });
    }));

    document.querySelectorAll('#mode-estate .tax-chip[data-k]').forEach((c) => c.addEventListener('click', () => {
      est[c.dataset.k] = !est[c.dataset.k];
      c.classList.toggle('on', est[c.dataset.k]);
      if (c.dataset.k === 'spouse') { $('es-spouse-dis').hidden = !est.spouse; if (!est.spouse) $('es-spouse-dis').querySelector('input').checked = false; }
      renderEstate();
    }));
    document.querySelectorAll('.tax-add').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.list;
      if (k === 'parents' && est.parents.length >= 2) return;
      est[k].push({ age: '', disabled: false });
      renderPeople(); renderEstate();
    }));
    ['list-descendants', 'list-parents', 'list-dependents'].forEach((id) => {
      const box = $(id);
      box.addEventListener('input', (e) => {
        const row = e.target.closest('.tax-person'); if (!row) return;
        const p = est[row.dataset.list][+row.dataset.i];
        if (e.target.dataset.f === 'age') p.age = e.target.value;
        if (e.target.dataset.f === 'disabled') p.disabled = e.target.checked;
        renderEstate();
      });
      box.addEventListener('click', (e) => {
        if (!e.target.classList.contains('tp-del')) return;
        const row = e.target.closest('.tax-person');
        est[row.dataset.list].splice(+row.dataset.i, 1);
        renderPeople(); renderEstate();
      });
    });
    ['es-gross', 'es-debts'].forEach((id) => $(id).addEventListener('input', renderEstate));
    $('es-spouse-dis').addEventListener('change', renderEstate);

    document.querySelectorAll('.gift-forms .tax-chip').forEach((c) => c.addEventListener('click', () => {
      form = c.dataset.form;
      document.querySelectorAll('.gift-forms .tax-chip').forEach((x) => x.classList.toggle('on', x === c));
    }));
    $('gf-add').addEventListener('click', addGift);
    $('gf-amount').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addGift(); } });

    try {
      const clients = await clientList();
      // 受贈人：贈與人的同住家人（同地址）＋同群組成員
      PICK_SOURCES['gift-recipient'] = () => {
        const id = ($('gf-donor').value.split('｜')[1] || '').trim();
        const donor = clients.find((c) => c.id === id);
        if (!donor) return [{ label: '先在上方選「贈與人」，這裡就會列出他的同住家人與群組成員；也可以直接打字', options: [] }];
        const groups = [];
        const k = addressKey(donor);
        const house = k ? clients.filter((c) => c.id !== donor.id && addressKey(c) === k) : [];
        if (house.length) groups.push({ label: '同住家人', layout: 'list', options: house.map((c) => ({ value: c.name, label: c.name, sub: addressText(c) })) });
        (donor.groups || []).forEach((g) => {
          const mem = clients.filter((c) => c.id !== donor.id && (c.groups || []).includes(g) && !house.includes(c));
          if (mem.length) groups.push({ label: `群組：${g}`, layout: 'list', options: mem.map((c) => ({ value: c.name, label: c.name, sub: g })) });
        });
        return groups.length ? groups : [{ label: '這位客戶沒有同住家人或群組成員，請直接輸入受贈人', options: [] }];
      };
      PICK_SOURCES['tax-client'] = (input) => {
        const kw = input.value.split('｜')[0].trim().toLowerCase();
        return [{ label: '客戶', layout: 'list', options: clients.filter((c) => !kw || `${c.name}${c.id}`.toLowerCase().includes(kw)).slice(0, 60)
          .map((c) => ({ value: `${c.name}｜${c.id}`, label: c.name || c.id, sub: c.id })) }];
      };
    } catch { /* 讀不到客戶清單時，帶入功能不可用，手動輸入照常 */ }
    $('es-import').addEventListener('click', importFromFinance);
    $('es-client').addEventListener('change', importFromFinance);

    ['am-death', 'am-benefit', 'am-net', 'am-regular', 'am-overseas', 'am-other'].forEach((id) => $(id).addEventListener('input', renderAmt));
    $('am-auto').addEventListener('change', renderAmt);
    renderPeople(); renderEstate(); renderGifts(); renderAmt();
    $('tax-load').hidden = true;
    $('tax-main').hidden = false;
  }
  init();
})();
