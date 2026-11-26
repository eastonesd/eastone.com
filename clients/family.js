// ============================================================
// 家族與關係網絡（東石家族辦公室）
// 資料表：families／family_members／fo_people／person_relations／family_agents／team_members
// 權限（資料庫 RLS）：主管看全部；其他人只看自己建立或擔任窗口的家族
// 關係記在「人與人」之間（fo_people），同一個人可同時屬於多個家族
// ============================================================
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KIND = { spouse: '配偶', parent: '父母→子女', sibling: '兄弟姊妹', grandparent: '祖父母→孫', in_law: '姻親', partner: '伴侶', other: '其他' };
  const EDGE_LABEL = { spouse: '配偶', parent: '親子', sibling: '手足', grandparent: '祖孫', in_law: '姻親', partner: '伴侶', other: '' };
  const ROLE = { primary: '主要窗口', co: '協同窗口' };

  let me = null;
  const S = { families: [], members: [], people: [], rels: [], agents: [], team: [], staffClients: [], current: null };
  let cy = null;

  const toast = (m) => { const t = document.createElement('div'); t.className = 'fo-toast'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); };
  const fail = (e, what) => { console.error(e); toast(`${what}失敗：${(e && e.message) || e}`); };
  const person = (id) => S.people.find((p) => p.id === id);
  const membersOf = (fid) => S.members.filter((m) => m.family_id === fid);
  const familiesOf = (pid) => S.members.filter((m) => m.person_id === pid).map((m) => S.families.find((f) => f.id === m.family_id)).filter(Boolean);
  const teamName = (uid) => (S.team.find((t) => t.user_id === uid) || {}).name || '（非團隊成員）';

  document.addEventListener('DOMContentLoaded', async () => {
    me = await requireLogin('../');
    bind();
    await reload();
    const want = new URLSearchParams(location.search).get('f');
    if (want && S.families.some((f) => f.id === want)) select(want);
  });

  async function reload() {
    const [fa, fm, pp, rl, ag, tm, sc] = await Promise.all([
      sb.from('families').select('*').order('name'),
      sb.from('family_members').select('*'),
      sb.from('fo_people').select('*'),
      sb.from('person_relations').select('*'),
      sb.from('family_agents').select('*'),
      sb.from('team_members').select('*'),
      sb.rpc('fo_staff_clients'),
    ]);
    const err = [fa, fm, pp, rl, ag, tm, sc].find((r) => r.error);
    if (err) { fail(err.error, '讀取家族資料'); return; }
    Object.assign(S, { families: fa.data, members: fm.data, people: pp.data, rels: rl.data, agents: ag.data, team: tm.data, staffClients: sc.data || [] });
    if (!S.team.some((t) => t.user_id === me.id)) {
      $('fo-empty').innerHTML = '您的帳號還不在服務團隊裡，請聯絡主管加入後才能使用家族功能。';
      $('fo-new').disabled = true;
    }
    renderList();
    if (S.current && S.families.some((f) => f.id === S.current)) renderDetail(); else { S.current = null; $('fo-detail').hidden = true; $('fo-empty').hidden = false; }
  }

  // ---------- 家族清單 ----------
  function renderList() {
    const kw = $('fo-search').value.trim();
    const list = S.families.filter((f) => !kw || f.name.includes(kw) || membersOf(f.id).some((m) => (person(m.person_id) || {}).name?.includes(kw)));
    $('fo-list').innerHTML = list.length ? list.map((f) => {
      const ms = membersOf(f.id).map((m) => person(m.person_id)).filter(Boolean);
      const mine = S.agents.filter((a) => a.family_id === f.id).map((a) => teamName(a.user_id));
      return `<button type="button" class="fo-item${f.id === S.current ? ' on' : ''}" data-f="${f.id}">
        <b>${esc(f.name)}</b><span>${ms.length} 位成員${mine.length ? '・' + esc(mine.join('、')) : ''}</span>
        <small>${esc(ms.slice(0, 5).map((p) => p.name).join('、'))}${ms.length > 5 ? '…' : ''}</small></button>`;
    }).join('') : `<div class="fo-none">${S.families.length ? '找不到符合的家族' : '還沒有家族'}</div>`;
    $('fo-list').querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => select(b.dataset.f)));
  }

  function select(fid) {
    S.current = fid;
    history.replaceState(null, '', `?f=${fid}`);
    renderList();
    renderDetail();
  }

  // ---------- 家族明細 ----------
  function renderDetail() {
    const f = S.families.find((x) => x.id === S.current);
    if (!f) return;
    $('fo-empty').hidden = true;
    $('fo-detail').hidden = false;
    $('fo-name').textContent = f.name;
    const ags = S.agents.filter((a) => a.family_id === f.id).sort((a, b) => (a.role === 'primary' ? -1 : 1));
    $('fo-meta').innerHTML = `${ags.length ? ags.map((a) => `${ROLE[a.role]}：${esc(teamName(a.user_id))}`).join('　') : '尚未指定服務窗口'}${f.note ? `<br>${esc(f.note)}` : ''}`;

    const ms = membersOf(f.id);
    $('fo-members').innerHTML = ms.length ? `<table class="fo-table"><tbody>${ms.map((m) => {
      const p = person(m.person_id) || {};
      const other = familiesOf(m.person_id).filter((x) => x.id !== f.id);
      return `<tr><td><b>${esc(p.name)}</b>${m.title ? `<span class="fo-title">${esc(m.title)}</span>` : ''}
          <div class="fo-mini">${p.client_id ? '客戶' : '非客戶（只記姓名）'}${p.gender ? '・' + esc(p.gender) : ''}${p.birthday ? '・' + esc(p.birthday) : ''}
          ${other.length ? `・也屬於 ${other.map((x) => `<a href="?f=${x.id}" data-jump="${x.id}">${esc(x.name)}</a>`).join('、')}` : ''}</div></td>
        <td class="fo-act"><button type="button" class="fo-link" data-title="${m.person_id}">稱謂</button><button type="button" class="fo-link danger" data-rm="${m.person_id}">移出</button></td></tr>`;
    }).join('')}</tbody></table>` : '<div class="fo-none">還沒有成員，按「＋ 加入成員」從客戶清單挑選，或直接輸入姓名。</div>';

    const ids = new Set(ms.map((m) => m.person_id));
    const rels = S.rels.filter((r) => ids.has(r.a) || ids.has(r.b));
    $('fo-rels').innerHTML = rels.length ? `<table class="fo-table"><tbody>${rels.map((r) => `<tr>
      <td>${relText(r)}${r.label ? `<div class="fo-mini">${esc(r.label)}</div>` : ''}</td>
      <td class="fo-act"><button type="button" class="fo-link danger" data-rel="${r.id}">刪除</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="fo-none">還沒有關係。成員之間的配偶、親子、手足等關係，建好後會畫成網絡圖。</div>';

    $('fo-members').querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => removeMember(b.dataset.rm)));
    $('fo-members').querySelectorAll('[data-title]').forEach((b) => b.addEventListener('click', () => editTitle(b.dataset.title)));
    $('fo-members').querySelectorAll('[data-jump]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); select(a.dataset.jump); }));
    $('fo-rels').querySelectorAll('[data-rel]').forEach((b) => b.addEventListener('click', () => removeRel(b.dataset.rel)));
    drawGraph();
  }

  function relText(r) {
    const a = esc((person(r.a) || {}).name || '（不可見）'), b = esc((person(r.b) || {}).name || '（不可見）');
    if (r.kind === 'parent') return `${a} 是 ${b} 的父母`;
    if (r.kind === 'grandparent') return `${a} 是 ${b} 的祖父母`;
    return `${a} ↔ ${b}：${KIND[r.kind]}`;
  }

  // ---------- 關係網絡圖（cytoscape） ----------
  function drawGraph() {
    const f = S.current;
    const own = new Set(membersOf(f).map((m) => m.person_id));
    const cross = $('fo-cross').checked;
    const nodes = new Set(own);
    // 跨家族：把和本家族成員有關係的外部人物也畫出來（一層）
    if (cross) S.rels.forEach((r) => { if (own.has(r.a) && person(r.b)) nodes.add(r.b); if (own.has(r.b) && person(r.a)) nodes.add(r.a); });
    const edges = S.rels.filter((r) => nodes.has(r.a) && nodes.has(r.b));
    const dark = document.documentElement.dataset.theme === 'dark';
    const els = [
      ...[...nodes].map((id) => {
        const p = person(id);
        const multi = familiesOf(id).length > 1;
        const title = (S.members.find((m) => m.family_id === f && m.person_id === id) || {}).title;
        return { data: { id, label: `${p.name}${title ? `\n${title}` : ''}` }, classes: [own.has(id) ? (p.client_id ? 'client' : 'ext') : 'other', multi ? 'multi' : ''].join(' ') };
      }),
      ...edges.map((r) => ({ data: { id: r.id, source: r.a, target: r.b, label: r.label || EDGE_LABEL[r.kind] }, classes: r.kind })),
    ];
    if (cy) cy.destroy();
    cy = cytoscape({
      container: $('fo-graph'),
      elements: els,
      wheelSensitivity: 0.25,
      style: [
        { selector: 'node', style: { label: 'data(label)', 'text-wrap': 'wrap', 'text-valign': 'bottom', 'text-margin-y': 6, 'font-size': 12, 'font-weight': 700,
          color: dark ? '#E8E4DA' : '#1B2A4A', width: 38, height: 38, 'background-color': '#1B2A4A', 'border-width': 3, 'border-color': '#B8892B' } },
        { selector: 'node.ext', style: { 'background-color': '#8A8F9A', 'border-color': '#C9C2AF' } },
        { selector: 'node.other', style: { 'background-color': '#6E8FB5', 'border-color': '#C9D2E6', opacity: 0.85, 'border-style': 'dashed' } },
        { selector: 'node.multi', style: { 'border-width': 5, 'border-color': '#D9534F' } },
        { selector: 'edge', style: { width: 2, 'line-color': dark ? '#6B7385' : '#B9B3A3', 'curve-style': 'bezier', label: 'data(label)', 'font-size': 10,
          color: dark ? '#C9C2AF' : '#6B6656', 'text-background-color': dark ? '#1E2433' : '#FFFFFF', 'text-background-opacity': 1, 'text-background-padding': 2 } },
        { selector: 'edge.spouse, edge.partner', style: { 'line-color': '#B8892B', width: 3 } },
        { selector: 'edge.parent, edge.grandparent', style: { 'target-arrow-shape': 'triangle', 'target-arrow-color': dark ? '#6B7385' : '#B9B3A3' } },
        { selector: 'edge.in_law', style: { 'line-style': 'dashed' } },
        { selector: ':selected', style: { 'overlay-opacity': 0.12 } },
      ],
      layout: { name: nodes.size > 1 ? 'cose' : 'grid', animate: false, padding: 30, nodeRepulsion: 9000, idealEdgeLength: 90 },
    });
    cy.on('tap', 'node', (e) => showPop(e.target.id(), e.renderedPosition));
    cy.on('tap', (e) => { if (e.target === cy) $('fo-pop').hidden = true; });
  }

  async function showPop(pid, pos) {
    const p = person(pid);
    const pop = $('fo-pop');
    const fams = familiesOf(pid);
    pop.hidden = false;
    pop.style.left = `${Math.min(pos.x + 12, $('fo-graph').clientWidth - 230)}px`;
    pop.style.top = `${pos.y + 60}px`;
    pop.innerHTML = `<b>${esc(p.name)}</b><div class="fo-mini">讀取中…</div>`;
    const { data } = await sb.rpc('fo_person_brief', { pid });
    const link = p.client_id && p.owner === me.id ? `<a href="index.html#client=${encodeURIComponent(p.client_id)}">打開客戶資料卡 →</a>` : '';
    pop.innerHTML = `<b>${esc(p.name)}</b>
      <div class="fo-mini">${p.client_id ? '客戶' : '非客戶'}${data && data.age ? `・保險年齡 ${esc(data.age)} 歲` : ''}</div>
      ${data && data.client ? `<div>保單 ${data.policies} 張・年繳約 ${Number(data.premium || 0).toLocaleString('zh-TW')} 元</div>` : ''}
      ${data && data.phone ? `<div>電話 ${esc(data.phone)}</div>` : ''}
      <div class="fo-mini">所屬家族：${fams.map((x) => `<a href="?f=${x.id}" data-jump="${x.id}">${esc(x.name)}</a>`).join('、') || '—'}</div>
      ${link}`;
    pop.querySelectorAll('[data-jump]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); pop.hidden = true; select(a.dataset.jump); }));
  }

  // ---------- 視窗 ----------
  function modal(title, html, onSubmit) {
    $('fo-modal-title').textContent = title;
    $('fo-form').innerHTML = html + `<div class="fo-form-act"><button type="button" class="btn-secondary" id="fo-cancel">取消</button><button type="submit" class="btn-primary">儲存</button></div>`;
    $('fo-modal').hidden = false;
    $('fo-cancel').onclick = close;
    $('fo-form').onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('fo-form').querySelector('[type=submit]'); btn.disabled = true;
      try { if ((await onSubmit(new FormData($('fo-form')))) !== false) { close(); await reload(); } } catch (err) { fail(err, '儲存'); } finally { btn.disabled = false; }
    };
  }
  function close() { $('fo-modal').hidden = true; }

  function familyForm(f) {
    modal(f ? '編輯家族' : '新家族', `
      <label>家族名稱<input name="name" required value="${esc(f ? f.name : '')}" placeholder="例：陳家、王家（娘家）"></label>
      <label>備註<textarea name="note" rows="3">${esc(f ? f.note || '' : '')}</textarea></label>
      ${f ? `<p class="fo-mini"><button type="button" class="fo-link danger" id="fo-del">刪除這個家族</button>（只刪家族與成員歸屬，客戶資料不受影響）</p>` : ''}`,
    async (fd) => {
      const row = { name: fd.get('name').trim(), note: fd.get('note').trim() || null };
      if (f) { const { error } = await sb.from('families').update({ ...row, updated_at: new Date().toISOString() }).eq('id', f.id); if (error) throw error; return; }
      const { data, error } = await sb.from('families').insert({ ...row, created_by: me.id }).select('id').single();
      if (error) throw error;
      const { error: e2 } = await sb.from('family_agents').insert({ family_id: data.id, user_id: me.id, role: 'primary' });
      if (e2) throw e2;
      S.current = data.id;
    });
    const del = $('fo-del');
    if (del) del.onclick = async () => {
      if (!confirm(`確定刪除「${f.name}」？`)) return;
      const { error } = await sb.from('families').delete().eq('id', f.id);
      if (error) return fail(error, '刪除');
      close(); S.current = null; history.replaceState(null, '', location.pathname); await reload();
    };
  }

  function agentsForm() {
    const fid = S.current;
    const cur = S.agents.filter((a) => a.family_id === fid);
    modal('服務窗口', `<p class="fo-mini">主要窗口負責這個家族，協同窗口一起服務；只有窗口和主管看得到這個家族。</p>
      ${S.team.map((t) => { const a = cur.find((x) => x.user_id === t.user_id); return `<label class="fo-row">${esc(t.name)}${t.role === 'manager' ? '（主管）' : ''}
        <select name="r_${t.user_id}"><option value="">不參與</option><option value="primary"${a && a.role === 'primary' ? ' selected' : ''}>主要窗口</option><option value="co"${a && a.role === 'co' ? ' selected' : ''}>協同窗口</option></select></label>`; }).join('')}`,
    async (fd) => {
      const want = S.team.map((t) => ({ user_id: t.user_id, role: fd.get(`r_${t.user_id}`) })).filter((x) => x.role);
      if (!want.some((x) => x.role === 'primary')) { toast('請至少指定一位主要窗口'); return false; }
      const { error } = await sb.from('family_agents').delete().eq('family_id', fid);
      if (error) throw error;
      const { error: e2 } = await sb.from('family_agents').insert(want.map((x) => ({ family_id: fid, ...x })));
      if (e2) throw e2;
    });
  }

  function memberForm() {
    const fid = S.current;
    const inFam = new Set(membersOf(fid).map((m) => m.person_id));
    const opts = S.staffClients.map((c) => `<option value="${esc(c.owner)}|${esc(c.id)}">${esc(c.name)}（${esc(c.id)}${c.owner !== me.id ? '・' + esc(c.owner_name || '') : ''}）</option>`).join('');
    const others = S.people.filter((p) => !inFam.has(p.id));
    modal('加入成員', `
      <label>從客戶清單選<select name="client"><option value="">—</option>${opts}</select></label>
      ${others.length ? `<label>或從其他家族已有的人選<select name="pid"><option value="">—</option>${others.map((p) => `<option value="${p.id}">${esc(p.name)}${p.client_id ? '' : '（非客戶）'}</option>`).join('')}</select></label>` : ''}
      <fieldset class="fo-fs"><legend>或新增非客戶（只記姓名）</legend>
        <label>姓名<input name="name"></label>
        <div class="fo-2"><label>性別<select name="gender"><option value="">—</option><option>男</option><option>女</option></select></label>
        <label>生日<input type="date" name="birthday"></label></div></fieldset>
      <label>在這個家族的稱謂（選填）<input name="title" placeholder="例：家長、長子、媳婦"></label>`,
    async (fd) => {
      let pid = fd.get('pid') || '';
      const client = fd.get('client');
      const name = (fd.get('name') || '').trim();
      if (!pid && client) {
        const [owner, cid] = client.split('|');
        const hit = S.people.find((p) => p.owner === owner && p.client_id === cid);
        if (hit) pid = hit.id;
        else {
          const c = S.staffClients.find((x) => x.owner === owner && x.id === cid);
          const { data, error } = await sb.from('fo_people').insert({ owner, client_id: cid, name: c.name, gender: c.gender || null, birthday: c.birthday || null, created_by: me.id }).select('id').single();
          if (error) throw error;
          pid = data.id;
        }
      } else if (!pid && name) {
        const { data, error } = await sb.from('fo_people').insert({ owner: null, client_id: null, name, gender: fd.get('gender') || null, birthday: fd.get('birthday') || null, created_by: me.id }).select('id').single();
        if (error) throw error;
        pid = data.id;
      }
      if (!pid) { toast('請選一位客戶、既有人物，或輸入姓名'); return false; }
      if (inFam.has(pid)) { toast('這個人已經在家族裡'); return false; }
      const { error } = await sb.from('family_members').insert({ family_id: fid, person_id: pid, title: (fd.get('title') || '').trim() || null });
      if (error) throw error;
    });
  }

  function editTitle(pid) {
    const m = S.members.find((x) => x.family_id === S.current && x.person_id === pid);
    modal(`${(person(pid) || {}).name} 的稱謂`, `<label>稱謂<input name="title" value="${esc(m.title || '')}" placeholder="例：家長、長子、媳婦"></label>`, async (fd) => {
      const { error } = await sb.from('family_members').update({ title: (fd.get('title') || '').trim() || null }).eq('family_id', S.current).eq('person_id', pid);
      if (error) throw error;
    });
  }

  async function removeMember(pid) {
    if (!confirm(`把 ${(person(pid) || {}).name} 移出這個家族？（人物與關係會保留，其他家族不受影響）`)) return;
    const { error } = await sb.from('family_members').delete().eq('family_id', S.current).eq('person_id', pid);
    if (error) return fail(error, '移出');
    await reload();
  }

  function relForm() {
    const ms = membersOf(S.current).map((m) => person(m.person_id)).filter(Boolean);
    const all = [...ms, ...S.people.filter((p) => !ms.includes(p))];
    if (ms.length < 1 || all.length < 2) { toast('至少要有兩個人才能建立關係'); return; }
    const sel = (n, list) => `<select name="${n}" required>${list.map((p) => `<option value="${p.id}">${esc(p.name)}${ms.includes(p) ? '' : '（其他家族）'}</option>`).join('')}</select>`;
    modal('新增關係', `
      <div class="fo-2"><label>甲${sel('a', ms)}</label><label>乙${sel('b', all)}</label></div>
      <label>關係<select name="kind">${Object.entries(KIND).map(([k, v]) => `<option value="${k}">${v}${k === 'parent' ? '（甲是乙的父母）' : k === 'grandparent' ? '（甲是乙的祖父母）' : ''}</option>`).join('')}</select></label>
      <label>說明（選填）<input name="label" placeholder="例：岳父、前配偶、養子"></label>`,
    async (fd) => {
      const a = fd.get('a'), b = fd.get('b');
      if (a === b) { toast('甲乙不能是同一個人'); return false; }
      const { error } = await sb.from('person_relations').insert({ a, b, kind: fd.get('kind'), label: (fd.get('label') || '').trim() || null, created_by: me.id });
      if (error) throw (/duplicate/.test(error.message) ? new Error('這段關係已經存在') : error);
    });
  }

  async function removeRel(id) {
    if (!confirm('刪除這段關係？')) return;
    const { error } = await sb.from('person_relations').delete().eq('id', id);
    if (error) return fail(error, '刪除關係');
    await reload();
  }

  function bind() {
    $('fo-new').addEventListener('click', () => familyForm(null));
    $('fo-edit').addEventListener('click', () => familyForm(S.families.find((f) => f.id === S.current)));
    $('fo-agents-btn').addEventListener('click', agentsForm);
    $('fo-add-member').addEventListener('click', memberForm);
    $('fo-add-rel').addEventListener('click', relForm);
    $('fo-search').addEventListener('input', renderList);
    $('fo-cross').addEventListener('change', drawGraph);
    $('fo-fit').addEventListener('click', () => cy && cy.fit(undefined, 30));
    $('fo-modal-close').addEventListener('click', close);
    $('fo-modal').addEventListener('click', (e) => { if (e.target === $('fo-modal')) close(); });
  }
})();
