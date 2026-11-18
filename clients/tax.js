(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const format = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 2 });
  const money = value => value === null ? '待確認' : `NT$ ${format.format(value)}`;
  const giftForm = $('tax-gift');
  const estateForm = $('tax-estate');
  const gifts = $('tax-gifts');
  const resultBox = $('tax-result');

  function addGift() {
    const row = $('tax-gift-template').content.firstElementChild.cloneNode(true);
    row.querySelector('.tax-remove').addEventListener('click', () => {
      row.remove();
      renumberGifts();
      clearResult();
    });
    gifts.append(row);
    renumberGifts();
    return row;
  }

  function renumberGifts() {
    [...gifts.children].forEach((row, index, rows) => {
      row.querySelector('legend').textContent = `贈與紀錄 ${index + 1}`;
      row.querySelector('.tax-remove').hidden = rows.length === 1;
    });
  }

  function clearResult() {
    resultBox.replaceChildren();
    resultBox.hidden = true;
  }

  function element(tag, value) {
    const node = document.createElement(tag);
    node.textContent = value;
    return node;
  }

  function render(title, rows, notes) {
    resultBox.replaceChildren(element('h2', title));
    const list = document.createElement('dl');
    list.className = 'tax-numbers';
    for (const [label, value] of rows) {
      const row = document.createElement('div');
      row.append(element('dt', label), element('dd', value));
      list.append(row);
    }
    resultBox.append(list);
    for (const note of notes) resultBox.append(element('p', note));
    const print = element('button', '列印／另存 PDF');
    print.className = 'btn-secondary';
    print.id = 'tax-print';
    print.type = 'button';
    print.addEventListener('click', () => window.print());
    resultBox.append(print);
    resultBox.hidden = false;
  }

  function taxRows(r, credits, dueLabel) {
    const rows = [
      ['扣除額', money(r.deductions)],
      ['免稅額', money(r.exemption)],
      ['課稅淨額', money(r.net)],
    ];
    for (const band of r.bands.filter(band => band.base > 0)) {
      rows.push([`${money(band.base)} × ${band.rate}%`, money(band.cents / 100)]);
    }
    rows.push(['扣抵前稅額', money(r.taxCents / 100)], ['輸入的扣抵額', money(credits)],
      [dueLabel, money(r.dueCents === null ? null : r.dueCents / 100)]);
    return rows;
  }

  const number = (data, key) => Number(data.get(key));
  const optional = (data, key) => data.get(key) === '' ? null : number(data, key);
  const rulesNote = '依民國 115 年公告參數試算。實際應納稅額以稽徵機關核定為準。';

  function giftResult() {
    const data = new FormData(giftForm);
    const credits = optional(data, 'credits');
    const events = [...gifts.children].map(row => {
      const get = name => row.querySelector(`[name="${name}"]`).value;
      return { date: get('date'), recipient: get('recipient').trim(), value: Number(get('value')), treatment: get('treatment') };
    });
    const r = EastoneTax.gift({ events, deductions: number(data, 'deductions'), credits });
    const treatment = { taxable: '計入', excluded: '不計入', pending: '待覆核' };
    const notes = [rulesNote];
    if (r.firstOver) notes.push(`已知計入贈與總額首次超過免稅額：${r.firstOver}。一般案件自超額贈與日起 30 日內申報，請核對實際期限。`);
    if (r.pending) notes.push('有待覆核的贈與，以下金額只反映已確認部分。');
    render('贈與稅試算', [
      ...events.map(e => [`${e.date} ${e.recipient}（${treatment[e.treatment]}）`, money(e.value)]),
      ['已計入年度贈與總額', money(r.gross)],
      ['不計入贈與總額', money(r.excluded)],
      ['待覆核金額', money(r.pending)],
      ['剩餘免稅額（按已確認資料）', money(r.remaining)],
      ...taxRows(r, credits, '本次預估稅額'),
    ], notes);
  }

  function estateResult() {
    const data = new FormData(estateForm);
    const credits = optional(data, 'credits');
    const r = EastoneTax.estate({
      date: data.get('date'), gross: number(data, 'gross'), includedGifts: optional(data, 'includedGifts'),
      spouse: data.has('spouse'), children: number(data, 'children'), parents: number(data, 'parents'),
      debts: number(data, 'debts'), otherDeductions: number(data, 'otherDeductions'), credits,
    });
    const notes = [rulesNote, '一般申報期限為死亡日起六個月。假設日期僅供情境試算。'];
    if (r.gifts === null) notes.push('死亡前兩年贈與尚未確認。以下只計入已知遺產。');
    if (r.gifts !== 0) {
      notes.push(r.newDeemedEstateRules
        ? '基準日在 2026-09-13 起。符合條件的受贈人可能須負擔相應稅額，分攤另行覆核。'
        : '基準日在 2026-09-13 前。如涉及擬制遺產，須查核舊制及過渡處理，分攤另行覆核。');
    }
    render('遺產稅試算', [
      ['基準日', r.date], ['應計入的現存遺產', money(r.current)], ['應併入的贈與', money(r.gifts)],
      ['已計入遺產總額', money(r.gross)], ['配偶扣除額', money(r.details.spouse)],
      ['直系血親卑親屬扣除額', money(r.details.children)], ['父母扣除額', money(r.details.parents)],
      ['喪葬費扣除額', money(r.details.funeral)], ['確認可扣除債務', money(r.details.debts)],
      ['其他已覆核扣除額', money(r.details.other)], ...taxRows(r, credits, '預估遺產稅總額'),
    ], notes);
  }

  function calculate(event) {
    event.preventDefault();
    try {
      if (event.target === giftForm) giftResult();
      else estateResult();
    } catch (error) {
      resultBox.replaceChildren(element('p', error.message));
      resultBox.hidden = false;
    }
  }

  async function init() {
    try {
      await requireLogin('../');
    } catch {
      $('tax-load').textContent = '目前無法確認登入，請重新整理後再試。';
      return;
    }
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
    if (today.startsWith(`${EastoneTax.RULES.year}-`)) {
      estateForm.elements.date.value = today;
      addGift().querySelector('[name="date"]').value = today;
    } else addGift();

    $('tax-add').addEventListener('click', () => {
      clearResult();
      addGift().querySelector('[name="date"]').focus();
    });
    for (const form of [giftForm, estateForm]) {
      form.addEventListener('submit', calculate);
      form.addEventListener('input', clearResult);
    }
    for (const button of document.querySelectorAll('[data-mode]')) {
      button.addEventListener('click', () => {
        const gift = button.dataset.mode === 'gift';
        giftForm.hidden = !gift;
        estateForm.hidden = gift;
        for (const tab of document.querySelectorAll('[data-mode]')) {
          tab.setAttribute('aria-pressed', String(tab === button));
        }
        clearResult();
      });
    }
    $('tax-load').hidden = true;
    $('tax-main').hidden = false;
  }

  init();
})();
