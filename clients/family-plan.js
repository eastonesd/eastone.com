// ============================================================
// 家辦資料（每個家族一筆，存在 fo_plans.data）：給「家辦整合報告」用
//   基本：規劃對象、夫妻財產制、婚前／無償取得財產、傳承意願
//   收支：每位成員每年收入、支出（留空＝用資產負債的固定收支）
//   贈與紀錄、法律安排（遺囑、信託、意定監護…）、家族目標
// 金額輸入以「萬元」為單位；自動存檔
// family.js 選到家族時呼叫 FoPlan.show(familyId, people, rels)
// ============================================================
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const REL = { spouse: '配偶', child: '子女', grandchild: '孫子女', parent: '父母', sibling: '兄弟姊妹', in_law: '女婿／媳婦', other: '其他（非繼承人）' };
  const LISTS = {
    gifts: { title: '贈與紀錄', hint: '每位贈與人每年免稅 244 萬（配偶之間互贈不計入）；死亡前 2 年內贈與配偶、子女等繼承人的財產會併入遺產。', add: '＋ 新增贈與',
      cols: [
        { k: 'date', label: '日期', type: 'date' },
        { k: 'from', label: '贈與人', type: 'person' },
        { k: 'to', label: '受贈人', type: 'person', other: true },
        { k: 'toRel', label: '受贈人是贈與人的', type: 'select', opts: REL },
        { k: 'amount', label: '金額（萬）', type: 'number' },
        { k: 'form', label: '形式', type: 'select', opts: { cash: '現金', property: '不動產', securities: '股票／基金', policy: '保單', other: '其他' } },
        { k: 'filed', label: '已申報', type: 'check' },
        { k: 'note', label: '備註', type: 'text' },
      ] },
    legal: { title: '法律安排', hint: '有沒有遺囑、信託、意定監護，會直接改變傳承規劃的結論。', add: '＋ 新增安排',
      cols: [
        { k: 'pid', label: '對象', type: 'person' },
        { k: 'kind', label: '類別', type: 'select', opts: { will_notary: '公證遺囑', will_self: '自書遺囑', will_other: '代筆／密封遺囑', trust: '信託', ins_trust: '保險金信託', guardian: '意定監護', marital: '夫妻財產制約定', medical: '預立醫療決定', poa: '授權書', other: '其他' } },
        { k: 'status', label: '狀態', type: 'select', opts: { done: '已完成', planned: '規劃中', none: '還沒有' } },
        { k: 'date', label: '日期', type: 'date' },
        { k: 'note', label: '內容摘要', type: 'text' },
      ] },
    goals: { title: '家族目標', hint: '報告的建議會對著這些目標寫。', add: '＋ 新增目標',
      cols: [
        { k: 'kind', label: '類別', type: 'select', opts: { education: '子女教育金', house: '購屋', retire: '退休生活', care: '照顧長輩', legacy: '財富傳承', business: '事業交棒', medical: '醫療長照', other: '其他' } },
        { k: 'title', label: '說明', type: 'text' },
        { k: 'pid', label: '對象', type: 'person' },
        { k: 'amount', label: '需要金額（萬）', type: 'number' },
        { k: 'year', label: '目標年（西元）', type: 'number' },
        { k: 'priority', label: '優先', type: 'select', opts: { high: '高', mid: '中', low: '低' } },
      ] },
  };
  const TABS = [['base', '基本・夫妻財產'], ['cash', '收支'], ['gifts', '贈與紀錄'], ['legal', '法律安排'], ['goals', '家族目標']];

  let FID = null, PEOPLE = [], RELS = [], D = {}, tab = 'base', timer = null;

  const relBetween = (a, b) => {
    const r = RELS.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
    if (!r) return '';
    if (r.kind === 'spouse') return 'spouse';
    if (r.kind === 'parent') return r.a === a ? 'child' : 'parent';
    if (r.kind === 'grandparent') return r.a === a ? 'grandchild' : 'other';
    if (r.kind === 'sibling') return 'sibling';
    if (r.kind === 'in_law') return 'in_law';
    return '';
  };
  const age = (b) => { if (!b) return 0; const t = new Date(), d = new Date(b); return t.getFullYear() - d.getFullYear() - (t < new Date(t.getFullYear(), d.getMonth(), d.getDate()) ? 1 : 0); };
  const defaultHead = () => [...PEOPLE].filter((p) => p.client_id).sort((a, b) => age(b.birthday) - age(a.birthday))[0] || PEOPLE[0];

  async function show(fid, people, rels) {
    const card = $('fo-plan');
    if (!card) return;
    FID = fid; PEOPLE = people; RELS = rels;
    $('fp-report').href = `family-report.html?f=${encodeURIComponent(fid)}`;
    $('fp-body').innerHTML = '<p class="fo-none">讀取中…</p>';
    const { data, error } = await sb.from('fo_plans').select('data, updated_at').eq('family_id', fid).maybeSingle();
    if (FID !== fid) return;
    if (error) { $('fp-body').innerHTML = `<p class="fo-none">讀取失敗：${esc(error.message)}</p>`; return; }
    D = (data && data.data) || {};
    ['gifts', 'legal', 'goals'].forEach((k) => { D[k] = D[k] || []; });
    D.marital = D.marital || {}; D.cash = D.cash || {};
    if (!D.head && defaultHead()) D.head = defaultHead().id;
    $('fp-saved').textContent = data ? `上次更新 ${new Date(data.updated_at).toLocaleDateString('zh-TW')}` : '';
    render();
  }

  function save() {
    clearTimeout(timer);
    $('fp-saved').textContent = '儲存中…';
    timer = setTimeout(async () => {
      const { error } = await sb.from('fo_plans').upsert({ family_id: FID, data: D, updated_at: new Date().toISOString() });
      $('fp-saved').textContent = error ? `儲存失敗：${error.message}` : `已儲存 ${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
    }, 700);
  }

  const personOpts = (sel, other) => `<option value="">（選擇）</option>${PEOPLE.map((p) => `<option value="${p.id}"${p.id === sel ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}${other ? `<option value="__other"${sel === '__other' ? ' selected' : ''}>家族以外的人</option>` : ''}`;
  const opts = (o, sel) => `<option value="">（選擇）</option>${Object.entries(o).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(v)}</option>`).join('')}`;
  const num = (v) => (v === '' || v == null ? '' : v);

  function render() {
    $('fp-tabs').innerHTML = TABS.map(([k, v]) => `<button type="button" data-tab="${k}" class="${k === tab ? 'on' : ''}">${v}${LISTS[k] && D[k].length ? `<i>${D[k].length}</i>` : ''}</button>`).join('');
    const body = $('fp-body');
    if (tab === 'base') {
      const head = PEOPLE.find((p) => p.id === D.head);
      const sp = head ? RELS.filter((r) => r.kind === 'spouse' && (r.a === head.id || r.b === head.id)).map((r) => PEOPLE.find((p) => p.id === (r.a === head.id ? r.b : r.a))).find(Boolean) : null;
      const m = D.marital;
      body.innerHTML = `<div class="fp-form">
        <label>規劃對象（主要被繼承人）<select data-k="head">${personOpts(D.head)}</select><small>遺產稅、傳承、退休以這個人為主；資產負債、保障會整個家族一起看。</small></label>
        <label>夫妻財產制<select data-k="marital.regime">${opts({ legal: '法定財產制（沒有約定）', separate: '分別財產制', joint: '共同財產制' }, m.regime || 'legal')}</select><small>${sp ? `配偶：${esc(sp.name)}` : '<span class="warn">家族關係裡找不到規劃對象的配偶</span>'}</small></label>
        <fieldset class="fp-fs"><legend>剩餘財產差額分配（萬元）</legend>
          <div class="fp-3"><span></span><b>${esc(head ? head.name : '規劃對象')}</b><b>${esc(sp ? sp.name : '配偶')}</b>
          <span>婚前財產</span><input type="number" step="any" inputmode="decimal" data-k="marital.headPre" value="${num(m.headPre)}"><input type="number" step="any" inputmode="decimal" data-k="marital.spousePre" value="${num(m.spousePre)}">
          <span>婚後繼承、受贈</span><input type="number" step="any" inputmode="decimal" data-k="marital.headFree" value="${num(m.headFree)}"><input type="number" step="any" inputmode="decimal" data-k="marital.spouseFree" value="${num(m.spouseFree)}">
          <span>現有財產淨額</span><input type="number" step="any" inputmode="decimal" data-k="marital.headNet" value="${num(m.headNet)}" placeholder="自動帶入"><input type="number" step="any" inputmode="decimal" data-k="marital.spouseNet" value="${num(m.spouseNet)}" placeholder="自動帶入"></div>
          <small>「現有財產淨額」留空＝用資產負債算出的淨資產。配偶可以請求婚後財產差額的一半，這部分不課遺產稅。</small></fieldset>
        <label>傳承意願、家族特殊狀況<textarea data-k="wishes" rows="3" placeholder="例：長子接手公司股權、次女出國不回台、希望照顧到孫子女教育費…">${esc(D.wishes || '')}</textarea></label>
        <p class="fp-tip">公司股權請到<a href="finance.html">資產負債</a>新增「公司股權／未上市」，報告會獨立列出。</p></div>`;
    } else if (tab === 'cash') {
      body.innerHTML = `<p class="fp-hint">每年收入、支出（萬元）。留空＝用<a href="finance.html">資產負債</a>的固定收支自動計算；非客戶的成員請在這裡填。</p>
        <div class="fp-cash">${PEOPLE.map((p) => { const c = D.cash[p.id] || {}; return `<div class="fp-cash-row"><b>${esc(p.name)}</b>
          <label>年收入<input type="number" step="any" inputmode="decimal" data-cash="${p.id}" data-f="income" value="${num(c.income)}" placeholder="${p.client_id ? '自動' : '萬'}"></label>
          <label>年支出<input type="number" step="any" inputmode="decimal" data-cash="${p.id}" data-f="expense" value="${num(c.expense)}" placeholder="${p.client_id ? '自動' : '萬'}"></label></div>`; }).join('')}</div>`;
    } else {
      const L = LISTS[tab];
      const rows = D[tab];
      const cell = (c, r, i) => {
        const v = r[c.k];
        if (c.type === 'person') return `<select data-l="${i}" data-f="${c.k}">${personOpts(v, c.other)}</select>${c.other && v === '__other' ? `<input data-l="${i}" data-f="toName" value="${esc(r.toName || '')}" placeholder="姓名">` : ''}`;
        if (c.type === 'select') return `<select data-l="${i}" data-f="${c.k}">${opts(c.opts, v)}</select>`;
        if (c.type === 'check') return `<input type="checkbox" data-l="${i}" data-f="${c.k}" ${v ? 'checked' : ''}>`;
        return `<input type="${c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'}" ${c.type === 'number' ? 'step="any" inputmode="decimal"' : ''} data-l="${i}" data-f="${c.k}" value="${esc(v ?? '')}">`;
      };
      let summary = '';
      if (tab === 'gifts' && rows.length && window.EastoneFamily) {
        const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
        const g = EastoneFamily.giftSummary(rows.map((r) => ({ ...r, amount: (Number(r.amount) || 0) * 10000 })), D.head, today);
        const name = (id) => (PEOPLE.find((p) => p.id === id) || {}).name || '（未選）';
        summary = `<div class="fp-sum">${Object.entries(g.thisYear).map(([id, x]) => `<span><b>${esc(name(id))}</b> 今年已用 ${Math.round(x.used / 1e4)} 萬、還剩 <b>${Math.round(x.left / 1e4)} 萬</b>免稅額</span>`).join('')}
          ${g.addBack ? `<span class="warn">規劃對象 2 年內贈與 ${Math.round(g.addBack / 1e4)} 萬，若身故會併入遺產</span>` : ''}
          ${Object.entries(g.byGiver).flatMap(([id, ys]) => Object.entries(ys).filter(([, b]) => b.over).map(([y, b]) => `<span class="warn">${esc(name(id))} ${y} 年超過免稅額 ${Math.round(b.over / 1e4)} 萬，需申報贈與稅</span>`)).join('')}</div>`;
      }
      body.innerHTML = `<p class="fp-hint">${L.hint}</p>${summary}
        ${rows.length ? `<div class="fp-list">${rows.map((r, i) => `<div class="fp-item">${L.cols.map((c) => `<label class="fp-c-${c.type}${c.k === 'note' || c.k === 'title' ? ' fp-wide' : ''}"><span>${c.label}</span>${cell(c, r, i)}</label>`).join('')}
          <button type="button" class="fo-link danger" data-del="${i}">刪除</button></div>`).join('')}</div>` : '<p class="fo-none">還沒有資料。</p>'}
        <button type="button" class="btn-secondary fo-sm" data-add>${L.add}</button>`;
    }
  }

  function bind() {
    const card = $('fo-plan');
    if (!card) return;
    $('fp-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (!b) return; tab = b.dataset.tab; render(); });
    $('fp-body').addEventListener('input', onEdit);
    $('fp-body').addEventListener('change', onEdit);
    $('fp-body').addEventListener('click', (e) => {
      if (e.target.closest('[data-add]')) {
        const row = { id: uid() };
        if (tab === 'gifts') Object.assign(row, { date: new Date().toISOString().slice(0, 10), from: D.head || '', form: 'cash' });
        if (tab === 'legal') Object.assign(row, { pid: D.head || '', status: 'done' });
        if (tab === 'goals') Object.assign(row, { priority: 'mid' });
        D[tab].push(row); save(); render(); return;
      }
      const d = e.target.closest('[data-del]');
      if (d && confirm('刪除這一筆？')) { D[tab].splice(+d.dataset.del, 1); save(); render(); }
    });
  }

  function onEdit(e) {
    const el = e.target;
    if (el.dataset.k) {
      const v = el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
      const [a, b] = el.dataset.k.split('.');
      if (b) D[a][b] = v; else D[a] = v;
      save();
      if (e.type === 'change' && el.tagName === 'SELECT') render();
      return;
    }
    if (el.dataset.cash) {
      const c = (D.cash[el.dataset.cash] = D.cash[el.dataset.cash] || {});
      c[el.dataset.f] = el.value === '' ? '' : Number(el.value);
      save(); return;
    }
    if (el.dataset.l !== undefined) {
      const r = D[tab][+el.dataset.l], f = el.dataset.f;
      r[f] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
      // 選了受贈人 → 依家族關係自動帶「受贈人是贈與人的」
      if (tab === 'gifts' && (f === 'to' || f === 'from') && r.from && r.to && r.to !== '__other') { const k = relBetween(r.from, r.to); if (k) r.toRel = k; }
      if (tab === 'gifts' && f === 'to' && r.to === '__other') r.toRel = 'other';
      save();
      if (e.type === 'change' && (el.tagName === 'SELECT' || f === 'amount' || f === 'date')) render();
    }
  }

  document.addEventListener('DOMContentLoaded', bind);
  window.FoPlan = { show };
})();
