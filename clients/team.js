// ============================================================
// 團隊頁（主管）：唯讀檢視成員的客戶——保單數、產險、上次健診、個資同意書、近期到期
// 資料走 security definer RPC：team_clients／team_overview（只有主管能呼叫，查看會寫入 team_access_log）
// 點「健診報告」「傳承規劃」會帶 ?owner=<成員 uid> 開啟唯讀頁面
// ============================================================
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const days = (iso) => Math.round((Date.parse(iso) - Date.parse(today)) / 864e5);
  const roc = (iso) => (iso ? `${+iso.slice(0, 4) - 1911}/${iso.slice(5, 7)}/${iso.slice(8, 10)}` : '');
  let me = null, members = [], cur = null, rows = [];

  async function init() {
    me = await requireLogin('../');
    const { data: team, error } = await sb.from('team_members').select('user_id, name, role, life_license, pc_license').order('created_at');
    const mine = (team || []).find((t) => t.user_id === me.id);
    if (error || !mine || mine.role !== 'manager') { $('tm-load').textContent = '這一頁只有團隊主管可以使用。'; return; }
    members = team.filter((t) => t.user_id !== me.id);
    if (!members.length) { $('tm-load').textContent = '團隊裡還沒有其他成員。'; return; }
    $('tm-members').innerHTML = members.map((m) => `<button type="button" data-u="${m.user_id}"><b>${esc(m.name)}</b><span>${m.role === 'manager' ? '主管' : '業務員'}${m.life_license ? `・壽 ${esc(m.life_license)}` : ''}${m.pc_license ? `・產 ${esc(m.pc_license)}` : ''}</span></button>`).join('');
    $('tm-members').hidden = false; $('tm-load').hidden = true;
    $('tm-members').addEventListener('click', (e) => { const b = e.target.closest('button[data-u]'); if (b) open(b.dataset.u); });
    $('tm-search').addEventListener('input', draw);
    loadMfa();
    const want = new URLSearchParams(location.search).get('member');
    open(members.some((m) => m.user_id === want) ? want : members[0].user_id);
  }

  // 雙重驗證：誰綁定了、主管可重設
  async function loadMfa() {
    const { data, error } = await sb.rpc('team_mfa_status');
    if (error) return;
    const KIND = { manager: '主管', member: '業務員', assistant: '助理' };
    $('tm-mfa').innerHTML = `<ul class="tm-mfa">${(data || []).map((r) => `<li><b>${esc(r.name)}</b><span>${KIND[r.kind] || ''}</span>
      <i class="${r.bound ? 'ok' : 'no'}">${r.bound ? '已綁定' : '尚未綁定'}</i>
      ${r.bound ? `<button type="button" class="link-btn" data-reset="${r.user_id}" data-name="${esc(r.name)}">重設</button>` : ''}</li>`).join('')}</ul>`;
    $('tm-mfa-card').hidden = false;
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-reset]'); if (!b) return;
    if (!confirm(`重設 ${b.dataset.name} 的驗證 App？對方下次登入要重新掃描綁定。`)) return;
    const { error } = await sb.rpc('team_mfa_reset', { p_user: b.dataset.reset });
    if (error) { alert(`重設失敗：${error.message}`); return; }
    loadMfa();
  });

  async function open(uid) {
    cur = members.find((m) => m.user_id === uid);
    document.querySelectorAll('#tm-members button').forEach((b) => b.classList.toggle('on', b.dataset.u === uid));
    history.replaceState(null, '', `?member=${uid}`);
    $('tm-body').hidden = false;
    $('tm-table').innerHTML = '<tbody><tr><td>讀取中…</td></tr></tbody>';
    const [cRes, oRes] = await Promise.all([sb.rpc('team_clients', { p_owner: uid }), sb.rpc('team_overview', { p_owner: uid })]);
    if (cRes.error || oRes.error) { $('tm-table').innerHTML = `<tbody><tr><td>讀取失敗：${esc((cRes.error || oRes.error).message)}</td></tr></tbody>`; return; }
    const ov = oRes.data || { pc: [], consents: [] };
    const signed = new Set((ov.consents || []).map((k) => k.client_id));
    const pcBy = new Map();
    (ov.pc || []).forEach((p) => { if (!p.insured) return; pcBy.set(p.insured, [...(pcBy.get(p.insured) || []), p]); });
    rows = (cRes.data || []).filter(Boolean).map((c) => {
      const life = (c.policies || []).filter((p) => !p.life || !['解約', '失效', '終止'].includes(p.life.status)).length;
      const pcs = pcBy.get(String(c.id).toUpperCase()) || [];
      const due = pcs.map((p) => p.end).filter((d) => d && days(d) >= 0 && days(d) <= 60).sort()[0] || '';
      const b = c.birthday; const age = b ? (() => { const [y, m, d] = b.split('-').map(Number), [ty, tm, td] = today.split('-').map(Number); return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0); })() : '';
      const nextCheck = c.last_checkup ? (() => { const d = new Date(c.last_checkup); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10); })() : '';
      return { c, life, pc: pcs.length, due, age, signed: signed.has(c.id), nextCheck };
    });
    draw();
    loadLog(uid);
  }

  function draw() {
    const kw = $('tm-search').value.trim().toLowerCase();
    const list = rows.filter((r) => !kw || `${r.c.name}${r.c.id}`.toLowerCase().includes(kw));
    const unsigned = rows.filter((r) => !r.signed).length, dueN = rows.filter((r) => r.due).length;
    const checkDue = rows.filter((r) => !r.c.last_checkup || days(r.nextCheck) <= 30).length;
    $('tm-stats').innerHTML = `<span><b>${rows.length}</b>位客戶</span><span><b>${dueN}</b>位 60 天內產險到期</span><span><b>${checkDue}</b>位該做健診</span><span><b>${unsigned}</b>位同意書未上傳</span>`;
    $('tm-table').innerHTML = `<thead><tr><th>客戶</th><th class="c">年齡</th><th class="c">壽險</th><th class="c">產險</th><th>健診</th><th class="c">同意書</th><th></th></tr></thead><tbody>
      ${list.map((r) => `<tr>
        <td><b>${esc(r.c.name || '（未填姓名）')}</b><small>${esc(r.c.id)}${r.due ? `<em class="warn">產險 ${roc(r.due)} 到期</em>` : ''}</small></td>
        <td class="c">${r.age}</td><td class="c">${r.life || '—'}</td><td class="c">${r.pc || '—'}</td>
        <td>${r.c.last_checkup ? `${roc(r.c.last_checkup)}${days(r.nextCheck) <= 30 ? '<em class="warn">該做健診</em>' : ''}` : '<em class="warn">未登錄</em>'}</td>
        <td class="c"><span class="tm-lamp ${r.signed ? 'on' : 'off'}" title="${r.signed ? '已上傳' : '未上傳'}"></span></td>
        <td class="tm-act">${r.life ? `<a href="report.html?id=${encodeURIComponent(r.c.id)}&owner=${cur.user_id}">健診報告</a>` : ''}<a href="legacy.html?id=${encodeURIComponent(r.c.id)}&owner=${cur.user_id}">傳承規劃</a><a href="policy.html?id=${encodeURIComponent(r.c.id)}&owner=${cur.user_id}">保單建檔</a><a href="#" data-imp="${esc(r.c.id)}">📎 截圖建檔</a></td>
      </tr>`).join('') || '<tr><td colspan="7">沒有符合的客戶</td></tr>'}</tbody>`;
    // 主管代成員建檔：上傳保單截圖 → AI 判讀 → 寫進成員的客戶（留紀錄）
    document.querySelectorAll('#tm-table [data-imp]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      const uid = cur.user_id;
      ClientDocs.importPolicies({ clientId: a.dataset.imp, owner: uid, onDone: () => { if (cur && cur.user_id === uid) open(uid); } });
    }));
  }

  async function loadLog(uid) {
    const { data } = await sb.from('team_access_log').select('client_id, action, at').eq('member', uid).order('at', { ascending: false }).limit(30);
    const name = new Map(rows.map((r) => [r.c.id, r.c.name]));
    const A = { list: '查看客戶清單', report: '開啟健診報告', fin: '開啟傳承規劃（資產負債）', policy_import: '代為建立保單（截圖）', policy_edit: '代為修改保單' };
    $('tm-log-card').hidden = false;
    $('tm-log').innerHTML = (data || []).length ? `<ul>${data.map((l) => `<li>${new Date(l.at).toLocaleString('zh-TW', { hour12: false })}　${A[l.action] || esc(l.action)}${l.client_id ? `：${esc(name.get(l.client_id) || l.client_id)}` : ''}</li>`).join('')}</ul>` : '<p>還沒有紀錄。</p>';
  }

  document.addEventListener('DOMContentLoaded', init);
})();
