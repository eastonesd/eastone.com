// ============================================================
// 家族頁：待辦追蹤、服務紀錄（含年度檢視）、文件保險箱
//   fo_tasks / fo_notes / fo_documents；檔案放私有 bucket fo-vault（<家族 id>/…）
// family.js 選到家族時呼叫 FoDesk.show(familyId, people)
// ============================================================
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const addDays = (iso, d) => new Date(Date.parse(iso) + d * 864e5).toISOString().slice(0, 10);
  const PRI = { high: '高', mid: '中', low: '低' };
  const NOTE = { meeting: '面談', call: '電話', line: 'LINE／訊息', email: 'Email', review: '年度檢視', other: '其他' };
  const DOC = { will: '遺囑', trust: '信託契約', deed: '權狀／謄本', policy: '保單', tax: '稅單／核定書', contract: '契約／協議', id: '身分證件', report: '報告（已簽名）', consent: '同意書', other: '其他' };

  let FID = null, PEOPLE = [], TEAM = [], tab = 'tasks', T = [], N = [], D = [];

  async function show(fid, people) {
    if (!$('fo-desk')) return;
    FID = fid; PEOPLE = people || [];
    $('fd-body').innerHTML = '<p class="fo-none">讀取中…</p>';
    if (!TEAM.length) { const { data } = await sb.from('team_members').select('user_id, name'); TEAM = data || []; }
    await reload();
  }
  async function reload() {
    const fid = FID;
    const [t, n, d] = await Promise.all([
      sb.from('fo_tasks').select('*').eq('family_id', fid).order('due', { ascending: true, nullsFirst: false }),
      sb.from('fo_notes').select('*').eq('family_id', fid).order('happened_on', { ascending: false }).limit(200),
      sb.from('fo_documents').select('*').eq('family_id', fid).order('created_at', { ascending: false }),
    ]);
    if (fid !== FID) return;
    const err = [t, n, d].find((r) => r.error);
    if (err) { $('fd-body').innerHTML = `<p class="fo-none">讀取失敗：${esc(err.error.message)}</p>`; return; }
    T = t.data || []; N = n.data || []; D = d.data || [];
    render();
  }

  const who = (uid) => (TEAM.find((t) => t.user_id === uid) || {}).name || '';
  const pname = (pid) => (PEOPLE.find((p) => p.id === pid) || {}).name || '';
  function reviewState() {
    const last = N.filter((x) => x.kind === 'review').map((x) => x.happened_on).sort().pop() || null;
    if (!last) return { last: null, due: null, lv: 'n', text: '還沒做過年度檢視' };
    const due = addDays(last, 365), left = Math.round((Date.parse(due) - Date.parse(today())) / 864e5);
    return { last, due, lv: left < 0 ? 'r' : left <= 30 ? 'y' : 'g', text: left < 0 ? `年度檢視已逾期 ${-left} 天` : `下次年度檢視 ${due}（還有 ${left} 天）` };
  }

  function render() {
    const open = T.filter((x) => x.status !== 'done'), over = open.filter((x) => x.due && x.due < today()).length;
    const rv = reviewState();
    $('fd-review').innerHTML = `<i class="fd-dot ${rv.lv}"></i>${esc(rv.text)}${rv.last ? `<small>上次 ${rv.last}</small>` : ''}<button type="button" class="fo-link" data-review>完成年度檢視</button>`;
    $('fd-tabs').innerHTML = [['tasks', `待辦${open.length ? `<i>${open.length}</i>` : ''}${over ? `<i class="r">${over} 逾期</i>` : ''}`], ['notes', `服務紀錄${N.length ? `<i>${N.length}</i>` : ''}`], ['docs', `文件保險箱${D.length ? `<i>${D.length}</i>` : ''}`]]
      .map(([k, l]) => `<button type="button" data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('');
    const teamOpts = (sel) => TEAM.map((t) => `<option value="${t.user_id}"${t.user_id === sel ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
    if (tab === 'tasks') {
      const row = (x) => `<div class="fd-task ${x.status === 'done' ? 'done' : ''} ${x.status !== 'done' && x.due && x.due < today() ? 'over' : ''}" data-id="${x.id}">
        <input type="checkbox" data-done ${x.status === 'done' ? 'checked' : ''} aria-label="完成">
        <input class="fd-title" data-f="title" value="${esc(x.title)}">
        <span class="fd-tags"><span class="fd-pri ${x.priority}">${PRI[x.priority]}</span>${x.source === 'report' ? '<span class="fd-src">報告</span>' : x.source === 'note' ? '<span class="fd-src">紀錄</span>' : ''}</span>
        <input type="date" data-f="due" value="${x.due || ''}">
        <select data-f="assignee">${teamOpts(x.assignee)}</select>
        <button type="button" class="fo-link danger" data-del-task>刪除</button></div>`;
      const done = T.filter((x) => x.status === 'done');
      $('fd-body').innerHTML = `<div class="fd-add"><input id="fd-new-title" placeholder="新增待辦，例：確認保險金信託受託銀行">
          <input type="date" id="fd-new-due" value="${addDays(today(), 14)}"><select id="fd-new-pri">${Object.entries(PRI).map(([k, v]) => `<option value="${k}"${k === 'mid' ? ' selected' : ''}>優先 ${v}</option>`).join('')}</select>
          <select id="fd-new-who">${teamOpts(APP_UID)}</select><button type="button" class="btn-primary fo-sm" data-add-task>加入</button></div>
        ${open.length ? open.map(row).join('') : '<p class="fo-none">沒有未完成的待辦。報告頁可以一鍵把建議加進來。</p>'}
        ${done.length ? `<details class="fd-done"><summary>已完成 ${done.length} 項</summary>${done.map(row).join('')}</details>` : ''}`;
    } else if (tab === 'notes') {
      $('fd-body').innerHTML = `<form class="fd-note-form" id="fd-note-form">
          <label>日期<input type="date" name="happened_on" value="${today()}"></label>
          <label>方式<select name="kind">${Object.entries(NOTE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
          <label class="w2">參與者<input name="people" placeholder="例：王大明、李美華"></label>
          <label class="w4">談了什麼<textarea name="summary" rows="2" required placeholder="重點摘要"></textarea></label>
          <label class="w2">決定事項<textarea name="decisions" rows="2"></textarea></label>
          <label class="w2">下一步<textarea name="next_step" rows="2"></textarea></label>
          <label class="fd-chk"><input type="checkbox" name="toTask" checked> 下一步加入待辦，期限 <input type="date" name="due" value="${addDays(today(), 14)}"></label>
          <button type="submit" class="btn-primary fo-sm">儲存紀錄</button></form>
        <div class="fd-timeline">${N.length ? N.map((x) => `<article class="fd-note ${x.kind}"><header><b>${esc(x.happened_on)}</b><span>${NOTE[x.kind] || ''}</span>${x.people ? `<small>${esc(x.people)}</small>` : ''}<button type="button" class="fo-link danger" data-del-note="${x.id}">刪除</button></header>
          <p>${esc(x.summary)}</p>${x.decisions ? `<p><em>決定</em>${esc(x.decisions)}</p>` : ''}${x.next_step ? `<p><em>下一步</em>${esc(x.next_step)}</p>` : ''}</article>`).join('') : '<p class="fo-none">還沒有服務紀錄。每次見面、通話記一筆，年底就是給客戶的服務成果。</p>'}</div>`;
    } else {
      const groups = Object.keys(DOC).map((k) => [k, D.filter((x) => x.kind === k)]).filter(([, l]) => l.length);
      $('fd-body').innerHTML = `<div class="fd-up"><select id="fd-doc-kind">${Object.entries(DOC).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
          <select id="fd-doc-person"><option value="">（全家族）</option>${PEOPLE.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
          <input id="fd-doc-note" placeholder="說明（選填），例：民國 115 年公證、正本在銀行保管箱">
          <button type="button" class="btn-primary fo-sm" data-upload>上傳檔案</button></div>
        <p class="fd-hint">檔案加密存放，只有負責這個家族的業務員與主管看得到。PDF、照片都可以，單檔 50MB 以內。</p>
        ${groups.length ? groups.map(([k, l]) => `<h4 class="fd-g">${DOC[k]}</h4>${l.map((x) => `<div class="fd-doc"><button type="button" class="fd-open" data-open="${x.id}">📄 ${esc(x.title)}</button>
          ${x.signed ? '<span class="fd-signed">電子簽署</span>' : ''}<small>${esc([pname(x.person_id), x.note, x.created_at.slice(0, 10)].filter(Boolean).join('・'))}</small>
          <button type="button" class="fo-link danger" data-del-doc="${x.id}">刪除</button></div>`).join('')}`).join('') : '<p class="fo-none">還沒有文件。遺囑、信託契約、權狀掃描檔都可以放這裡。</p>'}`;
    }
  }

  async function upload() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true; inp.accept = 'image/*,application/pdf,.doc,.docx,.xls,.xlsx';
    inp.onchange = async () => {
      const files = [...(inp.files || [])];
      if (!files.length) return;
      const kind = $('fd-doc-kind').value, person = $('fd-doc-person').value || null, note = $('fd-doc-note').value.trim() || null;
      $('fd-body').insertAdjacentHTML('afterbegin', '<p class="fo-none" id="fd-uping">上傳中…</p>');
      try {
        for (const f of files) {
          if (f.size > 50 * 1024 * 1024) throw new Error(`「${f.name}」超過 50MB`);
          const ext = (f.name.match(/\.(\w+)$/) || [, 'bin'])[1].toLowerCase();
          const path = `${FID}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const up = await sb.storage.from('fo-vault').upload(path, f, { contentType: f.type || 'application/octet-stream' });
          if (up.error) throw new Error(`上傳失敗：${up.error.message}`);
          const { error } = await sb.from('fo_documents').insert({ family_id: FID, person_id: person, kind, title: f.name.replace(/\.\w+$/, ''), file_path: path, mime: f.type, size: f.size, note });
          if (error) { await sb.storage.from('fo-vault').remove([path]); throw new Error(`存檔失敗：${error.message}`); }
        }
        await reload();
      } catch (e) { alert(e.message || e); $('fd-uping')?.remove(); }
    };
    inp.click();
  }

  async function onClick(e) {
    const t = e.target;
    const tb = t.closest('[data-tab]'); if (tb) { tab = tb.dataset.tab; render(); return; }
    if (t.closest('[data-review]')) {
      const s = prompt('這次年度檢視的重點（會記在服務紀錄）：', '年度檢視：更新保單、資產負債與家辦報告');
      if (s == null) return;
      const { error } = await sb.from('fo_notes').insert({ family_id: FID, kind: 'review', summary: s || '年度檢視' });
      if (error) { alert(error.message); return; }
      return reload();
    }
    if (t.closest('[data-add-task]')) {
      const title = $('fd-new-title').value.trim(); if (!title) { $('fd-new-title').focus(); return; }
      const { error } = await sb.from('fo_tasks').insert({ family_id: FID, title, due: $('fd-new-due').value || null, priority: $('fd-new-pri').value, assignee: $('fd-new-who').value || null });
      if (error) { alert(error.message); return; }
      return reload();
    }
    const row = t.closest('.fd-task');
    if (row && t.matches('[data-done]')) {
      const done = t.checked;
      await sb.from('fo_tasks').update({ status: done ? 'done' : 'open', done_at: done ? new Date().toISOString() : null }).eq('id', row.dataset.id);
      return reload();
    }
    if (row && t.closest('[data-del-task]')) { if (!confirm('刪除這項待辦？')) return; await sb.from('fo_tasks').delete().eq('id', row.dataset.id); return reload(); }
    const dn = t.closest('[data-del-note]'); if (dn) { if (!confirm('刪除這筆服務紀錄？')) return; await sb.from('fo_notes').delete().eq('id', dn.dataset.delNote); return reload(); }
    if (t.closest('[data-upload]')) return upload();
    const op = t.closest('[data-open]');
    if (op) {
      const x = D.find((d) => d.id === op.dataset.open);
      const w = window.open('', '_blank');
      const { data, error } = await sb.storage.from('fo-vault').createSignedUrl(x.file_path, 300);
      if (error) { w && w.close(); alert(`開啟失敗：${error.message}`); return; }
      if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
      return;
    }
    const dd = t.closest('[data-del-doc]');
    if (dd) {
      const x = D.find((d) => d.id === dd.dataset.delDoc);
      if (!confirm(`刪除「${x.title}」？檔案會一併刪除，無法復原。`)) return;
      await sb.storage.from('fo-vault').remove([x.file_path]);
      await sb.from('fo_documents').delete().eq('id', x.id);
      return reload();
    }
  }
  async function onChange(e) {
    const t = e.target, row = t.closest('.fd-task');
    if (row && t.dataset.f) {
      const v = t.value.trim();
      if (t.dataset.f === 'title' && !v) return;
      await sb.from('fo_tasks').update({ [t.dataset.f]: v || null }).eq('id', row.dataset.id);
      const x = T.find((y) => y.id === row.dataset.id); if (x) x[t.dataset.f] = v || null;
    }
  }
  async function onSubmit(e) {
    if (e.target.id !== 'fd-note-form') return;
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    if (!f.summary.trim()) return;
    const { error } = await sb.from('fo_notes').insert({ family_id: FID, happened_on: f.happened_on || today(), kind: f.kind, people: f.people || null, summary: f.summary.trim(), decisions: f.decisions || null, next_step: f.next_step || null });
    if (error) { alert(error.message); return; }
    if (f.toTask && f.next_step && f.next_step.trim()) await sb.from('fo_tasks').insert({ family_id: FID, title: f.next_step.trim().slice(0, 200), due: f.due || null, source: 'note' });
    reload();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const card = $('fo-desk'); if (!card) return;
    card.addEventListener('click', onClick);
    card.addEventListener('change', onChange);
    card.addEventListener('submit', onSubmit);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'fd-new-title') { e.preventDefault(); card.querySelector('[data-add-task]').click(); } });
  });
  window.FoDesk = { show, reload };
})();
