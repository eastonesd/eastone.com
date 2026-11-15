// ============================================================
// 產險管理：保單條款（AI 讀取條款，只有條款、沒有費率）
// 資料表 pc_clauses：所有登入者可讀，管理員（kb_roles admin）可寫
// 流程：上傳條款 PDF 或貼網址 → Edge Function pc-extract（Claude 讀條款）→ 草稿 → 核對修改 → 儲存
// 之後做車險健診時，從這張表拿每個險種的保障內容、注意事項、不保事項
// ============================================================
(function () {
  const PC_EXTRACT_URL = `${SUPABASE_URL}/functions/v1/pc-extract`;
  const SECTIONS = ['強制險', '車損險', '責任險', '附加條款', '個人險', '其他'];
  let clauses = [];
  let isAdmin = false;
  let loaded = false;

  const e = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function load() {
    const [{ data }, role] = await Promise.all([
      sb.from('pc_clauses').select('*').order('section').order('code'),
      sb.rpc('kb_my_role').then((r) => r.data).catch(() => null),
    ]);
    clauses = data || [];
    isAdmin = role === 'admin';
    loaded = true;
  }

  function panel() {
    let box = document.getElementById('clausePanel');
    if (!box) {
      box = document.createElement('div');
      box.id = 'clausePanel';
      document.querySelector('#codesWrap .card').appendChild(box);
    }
    return box;
  }

  // 保單條款頁畫完之後：補「條款」欄、上方按鈕、下方已建檔清單
  window.pcClausesAfter = async function () {
    if (!loaded) await load();
    document.querySelectorAll('#codesHolder .cl-cell').forEach((td) => {
      const hit = clauses.filter((c) => c.code === td.dataset.code);
      td.innerHTML = hit.length
        ? hit.map((c) => `<button type="button" class="cl-link" data-id="${c.id}">查看${c.verified ? '' : '<i>待核對</i>'}</button>`).join('')
        : '';
    });
    const box = panel();
    box.innerHTML = `
      <div class="cl-head">
        <div class="step-title" style="margin:0;">已建檔條款 <small>${clauses.length} 份</small></div>
        ${isAdmin ? '<button type="button" class="btn btn-primary cl-ai" id="clAiOpen">AI 讀取條款</button>' : ''}
      </div>
      <div id="clAiBox"></div>
      ${clauses.length ? `<div class="cl-list">${clauses.map((c) => `
        <button type="button" class="cl-item" data-id="${c.id}">
          <b>${e(c.code || '—')}</b><span>${e(c.name)}</span>
          <em>${e(c.section)}${c.verified ? '' : '・待核對'}</em>
        </button>`).join('')}</div>` : '<p class="fl-empty">還沒有條款。管理員可以按「AI 讀取條款」上傳條款 PDF。</p>'}
      <div id="clView"></div>`;
    document.querySelectorAll('.cl-link, .cl-item').forEach((b) => b.addEventListener('click', () => view(+b.dataset.id)));
    const ai = document.getElementById('clAiOpen');
    if (ai) ai.addEventListener('click', openAi);
  };

  // ---------- 查看 ----------
  function view(id) {
    const c = clauses.find((x) => x.id === id);
    if (!c) return;
    const lines = (arr) => (arr || []).map((n) => `<li>${e(n.text)}${n.clause ? `<small>${e(n.clause)}</small>` : ''}</li>`).join('');
    const box = document.getElementById('clView');
    box.innerHTML = `
      <div class="cl-view">
        <div class="cl-view-head">
          <div><span class="fl-card-kicker">${e(c.company)}・${e(c.section)}${c.version ? '・' + e(c.version) : ''}</span>
            <b>${e(c.code)}　${e(c.name)}</b></div>
          <span>${c.verified ? '<span class="cl-ok">已核對</span>' : '<span class="cl-wait">待核對</span>'}
            ${isAdmin ? `<button type="button" class="link-btn" id="clEdit">編輯</button><button type="button" class="icon-btn" id="clDel">刪除</button>` : ''}</span>
        </div>
        ${c.summary ? `<p class="cl-summary">${e(c.summary)}</p>` : ''}
        ${(c.coverage || []).length ? `<div class="cl-sub">保障內容</div>
          <div class="records-scroll"><table class="codes-table"><thead><tr><th>項目</th><th>給付／上限</th><th>自負額</th><th>出處</th></tr></thead><tbody>
          ${c.coverage.map((r) => `<tr><td>${e(r.item)}</td><td>${e(r.limit)}</td><td>${e(r.deductible)}</td><td class="presets">${e(r.clause)}</td></tr>`).join('')}
          </tbody></table></div>` : ''}
        ${(c.notes || []).length ? `<div class="cl-sub">注意事項</div><ul class="cl-ul">${lines(c.notes)}</ul>` : ''}
        ${(c.exclusions || []).length ? `<div class="cl-sub">不保事項</div><ul class="cl-ul">${lines(c.exclusions)}</ul>` : ''}
        ${c.source ? `<p class="hint">來源：${e(c.source)}</p>` : ''}
      </div>`;
    if (isAdmin) {
      document.getElementById('clEdit').addEventListener('click', () => edit(c));
      document.getElementById('clDel').addEventListener('click', async () => {
        if (!confirm(`刪除「${c.code} ${c.name}」這份條款？`)) return;
        const { error } = await sb.from('pc_clauses').delete().eq('id', c.id);
        if (error) { alert('刪除失敗：' + error.message); return; }
        await load(); window.pcClausesAfter();
      });
    }
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- AI 讀取 ----------
  const fileToBase64 = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

  function openAi() {
    const box = document.getElementById('clAiBox');
    box.innerHTML = `
      <div class="cl-ai-form">
        <p class="hint">上傳產險條款 PDF（或貼條款網址），AI 會整理保障內容、注意事項與不保事項。結果不會直接存檔，核對修改後按「儲存」才會建檔。</p>
        <div class="field"><label>保險公司</label><input type="text" id="clCompany" value="富邦產險"></div>
        <div class="field"><label>條款 PDF</label><input type="file" id="clFile" accept="application/pdf,.pdf"></div>
        <div class="field"><label>或條款網址</label><input type="text" id="clUrl" placeholder="https://…pdf"></div>
        <div class="cl-row"><span class="hint" id="clStatus"></span>
          <span><button type="button" class="btn btn-ghost" id="clCancel">取消</button>
          <button type="button" class="btn btn-primary" id="clGo">開始讀取</button></span></div>
      </div>`;
    document.getElementById('clCancel').addEventListener('click', () => (box.innerHTML = ''));
    document.getElementById('clGo').addEventListener('click', run);
  }

  async function run() {
    const file = document.getElementById('clFile').files[0];
    const url = document.getElementById('clUrl').value.trim();
    if (!file && !url) { alert('請選擇條款 PDF 或貼網址'); return; }
    if (file && file.size > 20 * 1024 * 1024) { alert('PDF 超過 20MB'); return; }
    const btn = document.getElementById('clGo'), status = document.getElementById('clStatus');
    btn.disabled = true;
    const t0 = Date.now();
    const tick = setInterval(() => { status.textContent = `AI 讀取中… ${Math.round((Date.now() - t0) / 1000)} 秒（通常 1～2 分鐘，請不要關閉頁面）`; }, 500);
    try {
      const body = { company: document.getElementById('clCompany').value.trim() };
      if (file) body.clause_pdf = await fileToBase64(file); else body.clause_url = url;
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch(PC_EXTRACT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}`, apikey: SUPABASE_KEY },
        body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.clause) throw new Error(out.error || `伺服器錯誤 ${res.status}`);
      const c = out.clause;
      edit({
        company: c.company || body.company, code: (c.code || '').toUpperCase(), name: c.name || '', version: c.version || '',
        section: c.section || '其他', summary: c.summary || '', coverage: c.coverage || [], notes: c.notes || [], exclusions: c.exclusions || [],
        source: `AI 讀取${file ? '：' + file.name : '：' + url}（${new Date().toISOString().slice(0, 10)}，待人工核對）`, verified: false,
      }, out.warnings || [], file ? URL.createObjectURL(file) : url);
      document.getElementById('clAiBox').innerHTML = '';
    } catch (err) {
      status.textContent = '讀取失敗：' + (err.message || err);
    } finally {
      clearInterval(tick);
      btn.disabled = false;
    }
  }

  // ---------- 編輯（AI 草稿或既有條款）----------
  // 注意事項、不保事項：一行一條，「內容｜出處」；保障內容：一行一項，「項目｜給付上限｜自負額｜出處」
  const toLines = (arr) => (arr || []).map((n) => [n.text, n.clause].filter((x) => x != null).join('｜')).join('\n');
  const fromLines = (txt) => txt.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [text, clause = ''] = l.split('｜'); return { text: text.trim(), clause: clause.trim() }; });
  const covToLines = (arr) => (arr || []).map((r) => [r.item, r.limit, r.deductible, r.clause].map((x) => x || '').join('｜')).join('\n');
  const covFromLines = (txt) => txt.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [item = '', limit = '', deductible = '', clause = ''] = l.split('｜').map((x) => x.trim()); return { item, limit, deductible, clause }; });

  function edit(c, warnings = [], pdfUrl = '') {
    const box = document.getElementById('clView');
    box.innerHTML = `
      <div class="cl-view cl-edit">
        <div class="cl-view-head"><b>${c.id ? '編輯條款' : 'AI 草稿（尚未存檔）'}</b>
          ${pdfUrl ? `<a class="link-btn" href="${e(pdfUrl)}" target="_blank" rel="noopener">開啟原始條款對照</a>` : ''}</div>
        ${warnings.length ? `<div class="cl-warn"><b>AI 提醒需要確認：</b><ul>${warnings.map((w) => `<li>${e(w)}</li>`).join('')}</ul></div>` : ''}
        <div class="cl-grid">
          <div class="field"><label>保險公司</label><input type="text" id="ceCompany" value="${e(c.company)}"></div>
          <div class="field"><label>險種代號</label><input type="text" id="ceCode" value="${e(c.code)}" placeholder="例 31、50B、0J"></div>
          <div class="field"><label>分類</label><select id="ceSection">${SECTIONS.map((s) => `<option ${s === c.section ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
          <div class="field"><label>版本</label><input type="text" id="ceVersion" value="${e(c.version)}"></div>
        </div>
        <div class="field"><label>條款名稱</label><input type="text" id="ceName" value="${e(c.name)}"></div>
        <div class="field"><label>白話說明</label><textarea id="ceSummary" rows="2">${e(c.summary)}</textarea></div>
        <div class="field"><label>保障內容（一行一項：項目｜給付上限｜自負額｜出處）</label><textarea id="ceCoverage" rows="5">${e(covToLines(c.coverage))}</textarea></div>
        <div class="field"><label>注意事項（一行一條：內容｜出處）</label><textarea id="ceNotes" rows="6">${e(toLines(c.notes))}</textarea></div>
        <div class="field"><label>不保事項（一行一條：內容｜出處）</label><textarea id="ceExcl" rows="5">${e(toLines(c.exclusions))}</textarea></div>
        <label class="cl-check"><input type="checkbox" id="ceVerified" ${c.verified ? 'checked' : ''}> 已對照原始條款核對無誤</label>
        <div class="cl-row"><span></span><span>
          <button type="button" class="btn btn-ghost" id="ceCancel">取消</button>
          <button type="button" class="btn btn-primary" id="ceSave">儲存</button></span></div>
      </div>`;
    document.getElementById('ceCancel').addEventListener('click', () => (c.id ? view(c.id) : (box.innerHTML = '')));
    document.getElementById('ceSave').addEventListener('click', async () => {
      const v = (id) => document.getElementById(id).value.trim();
      const row = {
        company: v('ceCompany'), code: v('ceCode').toUpperCase(), name: v('ceName'), version: v('ceVersion'),
        section: v('ceSection'), summary: v('ceSummary'),
        coverage: covFromLines(document.getElementById('ceCoverage').value),
        notes: fromLines(document.getElementById('ceNotes').value),
        exclusions: fromLines(document.getElementById('ceExcl').value),
        source: c.source || '', verified: document.getElementById('ceVerified').checked, updated_at: new Date().toISOString(),
      };
      if (!row.name) { alert('請填條款名稱'); return; }
      const q = c.id ? sb.from('pc_clauses').update(row).eq('id', c.id).select().single() : sb.from('pc_clauses').insert(row).select().single();
      const { data, error } = await q;
      if (error) { alert('儲存失敗：' + error.message); return; }
      await load();
      await window.pcClausesAfter();
      view(data.id);
    });
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
})();
