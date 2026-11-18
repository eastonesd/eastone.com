// ============================================================
// 稅務規劃頁：遺產稅（勾選免稅扣除額＋人員清單）、贈與稅（逐筆記帳）
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
  const est = { exemption: true, necessities: false, tools: false, spouse: false, funeral: false, descendants: [], parents: [], dependents: [] };

  function personRow(list, p, i) {
    const withAge = list !== 'parents';
    const withDis = list !== 'dependents';
    return `<div class="tax-person" data-list="${list}" data-i="${i}">
      <span class="tp-no">${i + 1}</span>
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

  // ---------- 啟動 ----------
  async function init() {
    try { await requireLogin('../'); } catch { $('tax-load').textContent = '目前無法確認登入，請重新整理後再試。'; return; }

    document.querySelectorAll('.tax-mode').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('.tax-mode').forEach((x) => x.classList.toggle('active', x === b));
      $('mode-estate').hidden = b.dataset.mode !== 'estate';
      $('mode-gift').hidden = b.dataset.mode !== 'gift';
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

    renderPeople(); renderEstate(); renderGifts();
    $('tax-load').hidden = true;
    $('tax-main').hidden = false;
  }
  init();
})();
