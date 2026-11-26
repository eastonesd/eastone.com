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
  const S = { families: [], members: [], people: [], rels: [], agents: [], team: [], staffClients: [], myClients: [], pcGroups: [], current: null };

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
    const [fa, fm, pp, rl, ag, tm, sc, cl, pc] = await Promise.all([
      sb.from('families').select('*').order('name'),
      sb.from('family_members').select('*'),
      sb.from('fo_people').select('*'),
      sb.from('person_relations').select('*'),
      sb.from('family_agents').select('*'),
      sb.from('team_members').select('*'),
      sb.rpc('fo_staff_clients'),
      // 待整理：客戶的地址、群組（客戶管理移過來的「同住址／群組」）與產險保單上的群組
      sb.from('clients').select('id, owner, name:data->>name, city:data->>city, district:data->>district, address_detail:data->>address_detail, groups:data->groups'),
      sb.from('policies').select('owner, id_no:data->>insured_id_number, groups:data->groups'),
    ]);
    const err = [fa, fm, pp, rl, ag, tm, sc].find((r) => r.error);
    if (err) { fail(err.error, '讀取家族資料'); return; }
    Object.assign(S, { families: fa.data, members: fm.data, people: pp.data, rels: rl.data, agents: ag.data, team: tm.data, staffClients: sc.data || [],
      myClients: cl.error ? [] : cl.data || [], pcGroups: pc.error ? [] : pc.data || [] });
    if (!S.team.some((t) => t.user_id === me.id)) {
      $('fo-empty').innerHTML = '您的帳號還不在服務團隊裡，請聯絡主管加入後才能使用家族功能。';
      $('fo-new').disabled = true;
    }
    renderList();
    renderTodo();
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

  // ---------- 家系圖（世代分層：夫妻以「＝」相連、子女從父母中點垂下） ----------
  const G = { w: 110, h: 150, r: 20 }; // 每人寬度、世代間距、圖形半徑
  const GEN_COLORS = ['#F07C93', '#FFD98A', '#8FE3C9', '#CDB4F0', '#C7C5AE', '#9EC5F0', '#F5B38A'];
  let zoom = 1;

  function drawGraph() {
    const f = S.current;
    const own = new Set(membersOf(f).map((m) => m.person_id));
    const cross = $('fo-cross').checked;
    const ids = new Set(own);
    if (cross) S.rels.forEach((r) => { if (own.has(r.a) && person(r.b)) ids.add(r.b); if (own.has(r.b) && person(r.a)) ids.add(r.a); });
    const rels = S.rels.filter((r) => ids.has(r.a) && ids.has(r.b));
    const nodes = [...ids];

    // 1. 關係整理：父母、配偶、手足
    const parents = new Map(nodes.map((n) => [n, new Set()]));
    const spouses = new Map(nodes.map((n) => [n, new Set()]));
    rels.forEach((r) => {
      if (r.kind === 'parent') parents.get(r.b).add(r.a);
      if (r.kind === 'spouse' || r.kind === 'partner') { spouses.get(r.a).add(r.b); spouses.get(r.b).add(r.a); }
    });
    // 手足沒登記父母時，借用對方的父母
    rels.filter((r) => r.kind === 'sibling').forEach((r) => {
      const pa = parents.get(r.a), pb = parents.get(r.b);
      if (!pa.size && pb.size) pb.forEach((x) => pa.add(x));
      if (!pb.size && pa.size) pa.forEach((x) => pb.add(x));
    });

    // 2. 世代：親子 +1、祖孫 +2，配偶／手足／姻親同一代
    const gen = new Map();
    const step = { parent: 1, grandparent: 2, spouse: 0, partner: 0, sibling: 0, in_law: 0 };
    nodes.forEach((start) => {
      if (gen.has(start)) return;
      gen.set(start, 0);
      const q = [start];
      while (q.length) {
        const x = q.shift();
        rels.forEach((r) => {
          if (!(r.kind in step)) return;
          let y = null, d = 0;
          if (r.a === x) { y = r.b; d = step[r.kind]; } else if (r.b === x) { y = r.a; d = -step[r.kind]; }
          if (y && !gen.has(y)) { gen.set(y, gen.get(x) + d); q.push(y); }
        });
      }
    });
    const minG = Math.min(...gen.values());
    nodes.forEach((n) => gen.set(n, gen.get(n) - minG));

    // 3. 排版：以「一家人單位」（本人＋配偶）為節點，子女排在下方置中
    const placed = new Map(); // id -> {x, y}
    const childrenOf = (unit) => nodes.filter((c) => !placed.has(c) && [...parents.get(c)].some((p) => unit.includes(p)))
      .sort((a, b) => String(person(a).birthday || '9').localeCompare(String(person(b).birthday || '9')));
    const unitOf = (p) => [p, ...[...spouses.get(p)].filter((s) => !placed.has(s))];
    const sizeCache = new Map();
    function width(p, seen = new Set()) {
      if (seen.has(p)) return 1;
      seen.add(p);
      const u = unitOf(p);
      const kids = nodes.filter((c) => c !== p && !u.includes(c) && [...parents.get(c)].some((x) => u.includes(x)) && !seen.has(c));
      const kw = kids.reduce((s, c) => s + width(c, seen), 0);
      return Math.max(u.length, kw);
    }
    function place(p, left) {
      const u = unitOf(p);
      u.forEach((x) => placed.set(x, null));
      const kids = childrenOf(u);
      let cursor = left;
      const kidXs = [];
      kids.forEach((c) => { if (placed.has(c)) return; const w = width(c); place(c, cursor); kidXs.push(c); cursor += w; });
      const span = Math.max(u.length, cursor - left);
      const center = left + span / 2;
      u.forEach((x, i) => placed.set(x, { x: (center - u.length / 2 + i + 0.5) * G.w, y: gen.get(p) * G.h + 60 }));
      return span;
    }
    // 根：沒有父母在圖上、而且不是「嫁娶進來」的人（配偶有父母者，跟著配偶排）
    const roots = nodes.filter((n) => !parents.get(n).size && ![...spouses.get(n)].some((s) => parents.get(s).size))
      .sort((a, b) => gen.get(a) - gen.get(b));
    let left = 0;
    roots.forEach((r) => { if (!placed.has(r)) left += place(r, left) + 0.5; });
    nodes.forEach((n) => { if (!placed.has(n)) left += place(n, left) + 0.5; });
    // 同一代對齊：place 已用世代算 y；配偶若世代不同，以本人為準
    nodes.forEach((n) => { const pt = placed.get(n); if (pt) pt.y = gen.get(n) * G.h + 60; });

    // 4. 畫 SVG
    const pts = [...placed.values()];
    const W = Math.max(...pts.map((p) => p.x)) + G.w, H = Math.max(...pts.map((p) => p.y)) + 90;
    const line = (x1, y1, x2, y2, cls = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="gl ${cls}"/>`;
    let svg = '';
    // 配偶：＝
    const doneCouple = new Set();
    rels.filter((r) => r.kind === 'spouse' || r.kind === 'partner').forEach((r) => {
      const a = placed.get(r.a), b = placed.get(r.b);
      if (!a || !b) return;
      const [l, rr] = a.x < b.x ? [a, b] : [b, a];
      const mx = (l.x + rr.x) / 2;
      if (Math.abs(a.y - b.y) < 1) {
        svg += line(l.x + G.r + 4, l.y - 4, rr.x - G.r - 4, rr.y - 4, r.kind) + line(l.x + G.r + 4, l.y + 4, rr.x - G.r - 4, rr.y + 4, r.kind);
      } else svg += line(a.x, a.y, b.x, b.y, 'dash');
      doneCouple.add([r.a, r.b].sort().join('|'));
      void mx;
    });
    // 親子：依「父母組合」分群，從父母中點垂下
    const groups = new Map();
    nodes.forEach((c) => { const ps = [...parents.get(c)].filter((p) => placed.get(p)); if (!ps.length) return; const k = ps.sort().join('|'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); });
    const lane = new Map(); // 同一層有好幾組父母時，橫線錯開高度，避免看起來接在一起
    groups.forEach((kids, k) => {
      const ps = k.split('|').map((p) => placed.get(p));
      const px = ps.reduce((s, p) => s + p.x, 0) / ps.length, py = Math.max(...ps.map((p) => p.y));
      const ks = kids.map((c) => placed.get(c));
      const row = Math.min(...ks.map((c) => c.y));
      const n = lane.get(row) || 0; lane.set(row, n + 1);
      const barY = row - G.h / 2 + 10 + n * 12;
      const startY = ps.length > 1 ? py : py + G.r + 18;
      svg += line(px, startY, px, barY);
      const xs = [px, ...ks.map((c) => c.x)];
      svg += line(Math.min(...xs), barY, Math.max(...xs), barY);
      ks.forEach((c) => { svg += line(c.x, barY, c.x, c.y - G.r - 2); });
    });
    // 祖孫（中間那代沒建檔）、姻親、其他：虛線
    rels.filter((r) => ['grandparent', 'in_law', 'other'].includes(r.kind)).forEach((r) => {
      const a = placed.get(r.a), b = placed.get(r.b);
      if (a && b) svg += `<path d="M${a.x},${a.y} C${a.x},${(a.y + b.y) / 2} ${b.x},${(a.y + b.y) / 2} ${b.x},${b.y}" class="gl dash"/>`
        + `<text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 4}" class="gt-rel">${esc(r.label || EDGE_LABEL[r.kind])}</text>`;
    });
    // 人物：男＝圓形、女＝三角形、未填＝圓角方形；顏色依世代
    nodes.forEach((id) => {
      const p = person(id), pt = placed.get(id);
      const col = own.has(id) ? GEN_COLORS[gen.get(id) % GEN_COLORS.length] : '#AFC3DA';
      const stroke = familiesOf(id).length > 1 ? '#D9534F' : shade(col);
      const sw = familiesOf(id).length > 1 ? 4 : 2;
      const { x, y } = pt, r = G.r;
      const shape = p.gender === '男' ? `<circle cx="${x}" cy="${y}" r="${r}"/>`
        : p.gender === '女' ? `<polygon points="${x},${y - r - 2} ${x + r + 2},${y + r - 2} ${x - r - 2},${y + r - 2}"/>`
        : `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" rx="8"/>`;
      const title = (S.members.find((m) => m.family_id === f && m.person_id === id) || {}).title;
      svg += `<g class="gn${own.has(id) ? '' : ' other'}${p.client_id ? '' : ' ext'}" data-p="${id}" fill="${col}" stroke="${stroke}" stroke-width="${sw}"${own.has(id) ? '' : ' stroke-dasharray="4 3"'}>${shape}
        <text x="${x}" y="${y + r + 18}" class="gt">${esc(p.name)}</text>${title ? `<text x="${x}" y="${y + r + 33}" class="gt-sub">${esc(title)}</text>` : ''}</g>`;
    });
    $('fo-graph').innerHTML = nodes.length
      ? `<svg class="geno" viewBox="0 0 ${W} ${H}" width="${W * zoom}" height="${H * zoom}" xmlns="http://www.w3.org/2000/svg">${svg}</svg>`
      : '<div class="fo-none" style="padding:20px">加入成員並建立關係後，這裡會畫出家系圖。</div>';
    $('fo-graph').querySelectorAll('.gn').forEach((g) => g.addEventListener('click', (e) => {
      const box = $('fo-graph').getBoundingClientRect();
      showPop(g.dataset.p, { x: e.clientX - box.left, y: e.clientY - box.top - 40 });
    }));
  }
  function shade(hex) { const n = parseInt(hex.slice(1), 16); const k = 0.72; return `rgb(${(n >> 16 & 255) * k | 0},${(n >> 8 & 255) * k | 0},${(n & 255) * k | 0})`; }

  async function showPop(pid, pos) {
    const p = person(pid);
    const pop = $('fo-pop');
    const fams = familiesOf(pid);
    pop.hidden = false;
    pop.style.left = `${Math.min(pos.x + 12, $('fo-graph').clientWidth - 230)}px`;
    pop.style.top = `${pos.y + 90}px`;
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
    const clientOpts = S.staffClients.map((c) => ({ value: `${c.owner}|${c.id}`, label: `${c.name}（${c.id}${c.owner !== me.id ? '・' + (c.owner_name || '') : ''}）` }));
    const others = S.people.filter((p) => !inFam.has(p.id));
    const otherOpts = others.map((p) => ({ value: p.id, label: `${p.name}${p.client_id ? '' : '（非客戶）'}${familiesOf(p.id).length ? '・' + familiesOf(p.id).map((f) => f.name).join('、') : ''}` }));
    modal('加入成員', `
      <label>從客戶清單選（可打字搜尋姓名或身分證字號）${pickInput('client', clientOpts)}</label>
      ${others.length ? `<label>或從其他家族已有的人選（可打字搜尋）${pickInput('pid', otherOpts)}</label>` : ''}
      <fieldset class="fo-fs"><legend>或新增非客戶（只記姓名）</legend>
        <label>姓名<input name="name"></label>
        <div class="fo-2"><label>性別<select name="gender"><option value="">—</option><option>男</option><option>女</option></select></label>
        <label>生日<input type="date" name="birthday"></label></div></fieldset>
      <label>在這個家族的稱謂（選填）<input name="title" placeholder="例：家長、長子、媳婦"></label>`,
    async (fd) => {
      let pid = pickValue(fd, 'pid', otherOpts);
      const client = pickValue(fd, 'client', clientOpts);
      if (pid === null || client === null) { toast('找不到打的這個人，請從下拉選單點選'); return false; }
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

  // ---------- 可打字搜尋的選單（input＋datalist；選到的文字對回值） ----------
  function pickInput(name, opts) {
    return `<input name="${name}" list="dl-${name}" placeholder="打字搜尋，或留空" autocomplete="off"><datalist id="dl-${name}">${opts.map((o) => `<option value="${esc(o.label)}">`).join('')}</datalist>`;
  }
  // 留空回 ''；打的字對不到任何選項回 null
  function pickValue(fd, name, opts) {
    const t = String(fd.get(name) || '').trim();
    if (!t) return '';
    const hit = opts.find((o) => o.label === t) || (opts.filter((o) => o.label.includes(t)).length === 1 ? opts.find((o) => o.label.includes(t)) : null);
    return hit ? hit.value : null;
  }

  // ---------- 待整理：同住址、群組（從客戶管理、產險管理移過來，在這裡統一建成家族） ----------
  const addrKey = (c) => !c.address_detail ? '' : `${c.city || ''}${c.district || ''}${c.address_detail}`
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/臺/g, '台').replace(/[\s,，、.。\-－]/g, '').toUpperCase();
  function todoSets() {
    const byKey = (c) => `${c.owner}|${c.id}`;
    const house = new Map(), group = new Map();
    for (const c of S.myClients) {
      const k = addrKey(c);
      if (k) { if (!house.has(k)) house.set(k, { title: `${c.city || ''}${c.district || ''}${c.address_detail}`, list: [] }); house.get(k).list.push(c); }
      for (const g of (Array.isArray(c.groups) ? c.groups : [])) { if (!group.has(g)) group.set(g, { title: g, list: [] }); group.get(g).list.push(c); }
    }
    // 產險保單上的群組：用被保人身分證字號對回客戶
    const byId = new Map(S.myClients.map((c) => [String(c.id).toUpperCase(), c]));
    for (const p of S.pcGroups) for (const g of (Array.isArray(p.groups) ? p.groups : [])) {
      const c = byId.get(String(p.id_no || '').toUpperCase());
      if (!c) continue;
      if (!group.has(g)) group.set(g, { title: g, list: [] });
      if (!group.get(g).list.some((x) => byKey(x) === byKey(c))) group.get(g).list.push(c);
    }
    const done = (set) => {
      // 全員都已經在同一個家族 → 已整理
      const pids = set.list.map((c) => (S.people.find((p) => p.owner === c.owner && p.client_id === c.id) || {}).id);
      if (pids.some((x) => !x)) return null;
      return S.families.find((f) => pids.every((pid) => S.members.some((m) => m.family_id === f.id && m.person_id === pid))) || null;
    };
    const pack = (m, min) => [...m.values()].filter((x) => x.list.length >= min).map((x) => ({ ...x, fam: done(x) })).sort((a, b) => !!a.fam - !!b.fam || b.list.length - a.list.length);
    return { house: pack(house, 2), group: pack(group, 1) };
  }
  function renderTodo() {
    const box = $('fo-todo');
    if (!box) return;
    const t = todoSets(), left = (a) => a.filter((x) => !x.fam).length;
    box.innerHTML = `<button type="button" class="fo-item" data-todo="house"><b>同住址</b><span>${t.house.length} 組・待建家族 ${left(t.house)} 組</span></button>
      <button type="button" class="fo-item" data-todo="group"><b>群組</b><span>${t.group.length} 組・待建家族 ${left(t.group)} 組</span></button>`;
    box.querySelectorAll('[data-todo]').forEach((b) => b.addEventListener('click', () => todoList(b.dataset.todo)));
  }
  function todoList(kind) {
    const sets = todoSets()[kind];
    const label = kind === 'house' ? '同住址' : '群組';
    modal(`待整理：${label}`, sets.length ? `<p class="fo-mini">${kind === 'house' ? '地址填得一樣的客戶。' : '客戶管理、產險管理裡設定過的群組。'}按「建立家族」就把這些人放進同一個家族。</p>
      <div class="fo-todo-list">${sets.map((x, i) => `<div class="fo-todo-card${x.fam ? ' done' : ''}"><b>${esc(x.title)}</b>
        <span>${x.list.map((c) => esc(c.name)).join('、')}</span>
        ${x.fam ? `<em>已在「${esc(x.fam.name)}」</em>` : `<button type="button" class="btn-primary fo-sm" data-i="${i}">建立家族</button>`}</div>`).join('')}</div>`
      : `<div class="fo-none">目前沒有${label}要整理。</div>`, async () => true);
    $('fo-form').querySelector('.fo-form-act [type=submit]').hidden = true;
    $('fo-cancel').textContent = '關閉';
    $('fo-form').querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => familyFromSet(sets[+b.dataset.i], kind)));
  }
  function familyFromSet(set, kind) {
    const surname = (set.list[0].name || '').slice(0, 1);
    modal('從待整理建立家族', `
      <label>家族名稱<input name="name" required value="${esc(kind === 'group' ? set.title : surname + '家')}"></label>
      <p class="fo-mini">要放進家族的人（取消勾選就不放）：</p>
      ${set.list.map((c, i) => `<label class="fo-chk fo-chk-row"><input type="checkbox" name="m${i}" checked>${esc(c.name)}</label>`).join('')}`,
    async (fd) => {
      const picked = set.list.filter((_, i) => fd.get(`m${i}`));
      if (!picked.length) { toast('至少要勾一個人'); return false; }
      const { data: fam, error } = await sb.from('families').insert({ name: fd.get('name').trim(), note: kind === 'house' ? `同住址：${set.title}` : `群組：${set.title}`, created_by: me.id }).select('id').single();
      if (error) throw error;
      const { error: e2 } = await sb.from('family_agents').insert({ family_id: fam.id, user_id: me.id, role: 'primary' });
      if (e2) throw e2;
      for (const c of picked) {
        let pid = (S.people.find((p) => p.owner === c.owner && p.client_id === c.id) || {}).id;
        if (!pid) {
          const sc = S.staffClients.find((x) => x.owner === c.owner && x.id === c.id) || {};
          const { data, error: e3 } = await sb.from('fo_people').insert({ owner: c.owner, client_id: c.id, name: c.name, gender: sc.gender || null, birthday: sc.birthday || null, created_by: me.id }).select('id').single();
          if (e3) throw e3;
          pid = data.id;
        }
        const { error: e4 } = await sb.from('family_members').insert({ family_id: fam.id, person_id: pid });
        if (e4) throw e4;
      }
      S.current = fam.id;
      toast(`已建立「${fd.get('name').trim()}」，${picked.length} 位成員`);
    });
  }

  function bind() {
    $('fo-new').addEventListener('click', () => familyForm(null));
    $('fo-edit').addEventListener('click', () => familyForm(S.families.find((f) => f.id === S.current)));
    $('fo-agents-btn').addEventListener('click', agentsForm);
    $('fo-add-member').addEventListener('click', memberForm);
    $('fo-add-rel').addEventListener('click', relForm);
    $('fo-search').addEventListener('input', renderList);
    $('fo-cross').addEventListener('change', drawGraph);
    $('fo-fit').addEventListener('click', () => { zoom = 1; drawGraph(); });
    $('fo-zin').addEventListener('click', () => { zoom = Math.min(2.5, zoom * 1.25); drawGraph(); });
    $('fo-zout').addEventListener('click', () => { zoom = Math.max(0.4, zoom / 1.25); drawGraph(); });
    $('fo-graph').addEventListener('click', (e) => { if (!e.target.closest('.gn')) $('fo-pop').hidden = true; });
    $('fo-modal-close').addEventListener('click', close);
    $('fo-modal').addEventListener('click', (e) => { if (e.target === $('fo-modal')) close(); });
  }
})();
