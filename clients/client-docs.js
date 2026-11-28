// ============================================================
// 客戶文件區＋上傳保單截圖自動建檔（policy.html、team.html 共用）
// 文件：存在 fin-docs（路徑 <業務員>/<客戶>/…）與 fin_documents（client_id 綁客戶）
// 判讀：edge function policy-doc-read（同一批可多張截圖，AI 合併成一張張保單）
// 建檔：自己的客戶直接寫 clients；主管代成員建檔走 team_client_save_policies（會留紀錄）
// 用法：ClientDocs.mount(el, { clientId, owner })；ClientDocs.importPolicies({ clientId, owner, onDone })
// ============================================================
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const roc = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return y ? `${y - 1911}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}` : ''; };
  const KIND = { policy: '保單', statement: '對帳單', deed: '權狀', id: '證件', consent: '同意書', other: '其他' };
  const uidNow = () => (typeof APP_UID !== 'undefined' && APP_UID) || null;

  async function callFn(name, body) {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}`, apikey: SUPABASE_KEY },
      body: JSON.stringify(body || {}),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.ok === false) throw new Error(out.error || `伺服器錯誤 ${res.status}`);
    return out;
  }
  async function shrink(file) {
    if (!/^image\//.test(file.type) || file.type === 'image/gif') return file;
    const img = await createImageBitmap(file).catch(() => null);
    if (!img) return file;
    const k = Math.min(1, 2400 / Math.max(img.width, img.height));
    if (k === 1 && file.size < 3.5e6 && file.type === 'image/jpeg') return file;
    const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.85));
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  }
  async function upload(file, clientId, kind) {
    if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} 超過 25MB`);
    const f = await shrink(file);
    const { data: { user } } = await sb.auth.getUser();
    const ext = f.type === 'application/pdf' ? 'pdf' : (f.type.split('/')[1] || 'jpg');
    const path = `${uidNow() || user.id}/${clientId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await sb.storage.from('fin-docs').upload(path, f, { contentType: f.type });
    if (error) throw new Error('上傳失敗：' + error.message);
    const { data: row, error: e2 } = await sb.from('fin_documents').insert({ client_id: clientId, file_path: path, file_name: file.name, mime: f.type, size: f.size, kind }).select().single();
    if (e2) { await sb.storage.from('fin-docs').remove([path]); throw new Error('存檔失敗：' + e2.message); }
    return row;
  }

  // ---------- 客戶資料（自己的客戶直接讀；主管檢視成員走 team_clients） ----------
  async function loadClient(clientId, owner) {
    if (owner) {
      const { data, error } = await sb.rpc('team_clients', { p_owner: owner });
      if (error) throw error;
      return (data || []).find((c) => c && String(c.id).toUpperCase() === clientId.toUpperCase()) || null;
    }
    const { data, error } = await sb.from('clients').select('data').eq('id', clientId.toUpperCase()).maybeSingle();
    if (error) throw error;
    return data ? data.data : null;
  }
  async function agentOf(owner) {
    const { data } = await sb.from('team_members').select('name, life_license').eq('user_id', owner || uidNow()).maybeSingle();
    return data ? { name: data.name, license_no: data.life_license || '', contact: '' } : { name: '', license_no: '', contact: '' };
  }

  // ---------- 判讀結果 → 系統保單格式 ----------
  const parse = (iso) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + 'T00:00:00') : null);
  function insAge(birth, at) {
    const b = parse(birth), t = parse(at); if (!b || !t) return null;
    let y = t.getFullYear() - b.getFullYear();
    const ann = new Date(b); ann.setFullYear(b.getFullYear() + y);
    if (ann > t) { y -= 1; ann.setFullYear(b.getFullYear() + y); }
    const half = new Date(ann); half.setMonth(half.getMonth() + 6);
    return t > half ? y + 1 : y;
  }
  function periodText(start, end, birth) {
    if (end === 'lifetime') return '終身';
    const s = parse(start), e = parse(end); if (!s || !e) return '';
    const years = Math.round((e - s) / (365.25 * 864e5));
    const age = insAge(birth, start);
    return years > 30 && age !== null ? `${age + years}歲` : `${years}年`;
  }
  const guessCat = (name, kind) => {
    const n = String(name || '');
    if (/防癌|癌症/.test(n)) return ['防癌', /定期/.test(n) ? '定期' : ''];
    if (/失能|照護|長期照顧|長照/.test(n)) return [/長期照顧|長照/.test(n) ? '長照' : '失能', /終身/.test(n) ? '終身' : ''];
    if (/住院|醫療/.test(n)) return ['住院醫療', /實支|費用(?!定額)/.test(n) && !/定額/.test(n) ? '實支實付' : /定額|日額/.test(n) ? '定額' : ''];
    if (/手術/.test(n)) return ['手術', ''];
    if (/意外|傷害/.test(n)) return ['意外', ''];
    if (/重大疾病|重疾|特定傷病/.test(n)) return ['重大疾病', ''];
    if (/豁免/.test(n)) return ['豁免', ''];
    if (/小額/.test(n)) return ['小額終老', ''];
    if (/年金/.test(n)) return [/變額/.test(n) ? '投資V' : '利變年金', ''];
    if (/變額|投資型|萬能/.test(n)) return ['投資U', ''];
    if (/利率變動|利變/.test(n)) return ['利變', '壽險'];
    if (/還本/.test(n)) return ['還本壽險', ''];
    if (/定期/.test(n) && kind === 'main') return ['壽險', '定期'];
    if (/壽險|終身/.test(n)) return ['壽險', '終身'];
    return ['', ''];
  };
  function toPolicy(p, company, client, agent, codes) {
    const ccy = /^[A-Z]{3}$/.test(p.currency || '') ? p.currency : 'TWD';
    const comp = p.company || company || '';
    const who = (name) => (name && client && name.replace(/\s/g, '') === String(client.name || '').replace(/\s/g, '') ? client.id : '');
    const item = (x, kind) => {
      const known = codes.get(`${comp}|${String(x.code || '').toUpperCase()}`);
      const [c1, c2] = known ? [known.cat1 || '', known.cat2 || ''] : guessCat(x.name, kind);
      const amount = x.sa_kind !== 'unit';
      return {
        code: String(x.code || '').toUpperCase(), name: x.name || '', cat1: c1, cat2: c2,
        term: periodText(x.start_date, x.pay_end_date, client && client.birthday),
        coverage: periodText(x.start_date, x.cover_end, client && client.birthday),
        sum_assured: x.sa_value ? String(amount ? Math.round(x.sa_value / 10000 * 10000) / 10000 : x.sa_value) : '',
        sa_unit: amount ? '萬' : '單位', premium: x.premium > 0 ? String(x.premium) : '', _known: !!known, _sa: x.sa_text,
      };
    };
    const main = item(p.main, 'main');
    const riders = (p.riders || []).map((r) => ({ ...item(r, 'rider'), occ_class: '1', insured_id: who(p.insured_name) || (client && client.id) || '', insured_name: p.insured_name || '', effective_date: r.start_date || p.main.start_date }));
    const clean = (o) => { const { _known, _sa, ...rest } = o; return rest; };
    const total = [main, ...riders].reduce((s, x) => s + (Number(x.premium) || 0), 0);
    const life = {
      main: { company: comp, currency: ccy, ...clean(main) }, riders: riders.map(clean),
      status: /繳清/.test(p.status || '') ? '繳清' : /停效/.test(p.status || '') ? '停效' : '正常',
      discount: { on: false, pct: 1 }, pay_mode: p.pay_mode || '年繳',
      applicant_id: who(p.applicant_name), applicant_name: p.applicant_name || '', insured_id: who(p.insured_name), insured_name: p.insured_name || '',
      payer_id: who(p.applicant_name), payer_name: p.applicant_name || '', occ_class: '1', effective_date: p.main.start_date || '',
      pay_channel: { type: '' }, beneficiaries: [], dividend_option: '', agent, discount_pct_applied: 0,
      updated_at: new Date().toISOString(), source: `AI 判讀上傳文件 ${roc(new Date(Date.now() + 8 * 3600e3).toISOString())}`,
    };
    return { policy: { policy_no: String(p.policy_no || '').trim(), main_code: main.code, main_name: main.name, currency: ccy, total_premium: total, life }, view: { main, riders, company: comp } };
  }

  // ---------- 彈窗 ----------
  function modal(title, html) {
    const wrap = document.createElement('div');
    wrap.className = 'cd-modal';
    wrap.innerHTML = `<div class="cd-box" role="dialog" aria-modal="true"><div class="cd-head"><b>${esc(title)}</b><button type="button" class="cd-x" aria-label="關閉">✕</button></div><div class="cd-body">${html}</div></div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.querySelector('.cd-x').addEventListener('click', close);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    return { el: wrap.querySelector('.cd-body'), close };
  }

  async function importPolicies({ clientId, owner, onDone }) {
    const m = modal('上傳保單截圖，自動建檔', `
      <p class="cd-hint">可以一次選多張：保險公司行動辦公室的保單畫面、保單首頁或明細表（照片、截圖、PDF 都可以）。同一張保單切成兩張截圖也沒關係，AI 會合併。</p>
      <label class="cd-drop"><input type="file" accept="image/*,application/pdf" multiple hidden><span>📎 點這裡選擇檔案</span><small>最多 10 個檔案</small></label>
      <div class="cd-files"></div>
      <div class="cd-actions"><button type="button" class="btn-primary cd-go" disabled>上傳並判讀</button></div>
      <div class="cd-out"></div>`);
    const input = m.el.querySelector('input[type=file]');
    let files = [];
    input.addEventListener('change', () => {
      files = [...input.files].slice(0, 10);
      m.el.querySelector('.cd-files').innerHTML = files.map((f) => `<span>${esc(f.name)}</span>`).join('');
      m.el.querySelector('.cd-go').disabled = !files.length;
    });
    m.el.querySelector('.cd-go').addEventListener('click', async (ev) => {
      const btn = ev.target; btn.disabled = true;
      const out = m.el.querySelector('.cd-out');
      try {
        out.innerHTML = '<p class="cd-wait">上傳中…</p>';
        const docs = [];
        for (const f of files) docs.push(await upload(f, clientId, 'policy'));
        out.innerHTML = '<p class="cd-wait">AI 判讀中（約 20～90 秒）…</p>';
        const x = await callFn('policy-doc-read', { doc_ids: docs.map((d) => d.id) });
        const [client, agent, codeRes] = await Promise.all([loadClient(clientId, owner), agentOf(owner),
          sb.from('insurance_codes').select('company, code, name, kind, cat1, cat2')]);
        if (!client) throw new Error('找不到這位客戶');
        const codes = new Map((codeRes.data || []).map((c) => [`${c.company}|${c.code}`, c]));
        const list = (x.policies || []).filter((p) => p && p.policy_no && p.main).map((p) => toPolicy(p, x.company, client, agent, codes));
        const have = new Set((client.policies || []).map((p) => p.policy_no));
        if (!list.length) { out.innerHTML = `<p class="cd-warn">沒有讀到保單。${(x.warnings || []).map(esc).join('；')}</p>`; return; }
        const line = (r) => `<tr><td>${esc(r.code)}</td><td>${esc(r.name)}${r._known ? '' : '<i class="cd-new">新代號</i>'}</td><td class="num">${esc(r._sa || '')}</td><td>${esc(r.term)}／${esc(r.coverage)}</td><td class="num">${r.premium ? Number(r.premium).toLocaleString('zh-TW') : '<i class="cd-miss">未讀到</i>'}</td></tr>`;
        out.innerHTML = `
          <p class="cd-ok">讀到 <b>${list.length}</b> 張保單（${esc(client.name || clientId)}）。請核對後勾選要建檔的保單：</p>
          ${(x.warnings || []).length ? `<ul class="cd-warns">${x.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
          ${list.map((r, i) => `<div class="cd-pol">
            <label class="cd-pick"><input type="checkbox" data-i="${i}" checked> <b>${esc(r.policy.policy_no)}</b>　${esc(r.view.company)}　${esc(r.policy.currency)}
              ${have.has(r.policy.policy_no) ? '<i class="cd-dup">已有這張保單，勾選會覆蓋</i>' : ''}<small>生效 ${roc(r.policy.life.effective_date)}・要保人 ${esc(r.policy.life.applicant_name)}・被保人 ${esc(r.policy.life.insured_name)}</small></label>
            <table class="cd-t"><thead><tr><th>代號</th><th>險種</th><th class="num">保額</th><th>繳費／保障</th><th class="num">保費</th></tr></thead>
              <tbody>${line(r.view.main)}${r.view.riders.map(line).join('')}</tbody></table></div>`).join('')}
          <p class="cd-hint">繳費與保障期間由日期換算（超過 30 年以保險年齡表示）；新代號會一併建進保單代號表。建檔後仍可在保單頁逐張修改。</p>
          <div class="cd-actions"><button type="button" class="btn-primary cd-save">建立勾選的保單</button></div>`;
        out.querySelector('.cd-save').addEventListener('click', async (e2) => {
          const b2 = e2.target; b2.disabled = true;
          const picked = [...out.querySelectorAll('input[data-i]:checked')].map((c) => list[Number(c.dataset.i)]);
          if (!picked.length) { b2.disabled = false; return; }
          try {
            const pols = picked.map((r) => r.policy);
            if (owner) {
              const { error } = await sb.rpc('team_client_save_policies', { p_owner: owner, p_client: clientId, p_policies: pols });
              if (error) throw error;
            } else {
              const cur = await loadClient(clientId);
              const arr = [...(cur.policies || [])];
              pols.forEach((p) => { const k = arr.findIndex((q) => q.policy_no === p.policy_no); if (k >= 0) arr[k] = { ...arr[k], ...p }; else arr.push(p); });
              const { error } = await sb.from('clients').update({ data: { ...cur, policies: arr, updated_at: new Date().toISOString().slice(0, 19) }, updated_at: new Date().toISOString() }).eq('id', clientId.toUpperCase());
              if (error) throw error;
            }
            // 新代號建檔（同一保險公司＋代號只建一次）
            const fresh = new Map();
            picked.forEach((r) => [['main', r.view.main], ...r.view.riders.map((x) => ['rider', x])].forEach(([k, x]) => { if (x.code && !x._known) fresh.set(`${r.view.company}|${x.code}`, { company: r.view.company || '富邦人壽', code: x.code, name: x.name, kind: k, cat1: x.cat1, cat2: x.cat2, auto_created: true }); }));
            if (fresh.size) await sb.from('insurance_codes').upsert([...fresh.values()], { onConflict: 'company,code', ignoreDuplicates: true });
            out.innerHTML = `<p class="cd-ok">✅ 已建立 ${pols.length} 張保單${fresh.size ? `，並新增 ${fresh.size} 個保單代號` : ''}。</p>`;
            if (onDone) onDone(pols);
          } catch (err) { alert('建檔失敗：' + (err.message || err)); b2.disabled = false; }
        });
      } catch (err) {
        out.innerHTML = `<p class="cd-warn">${esc(err.message || err)}</p><p class="cd-hint">已上傳的檔案會留在客戶文件區，可以稍後再判讀。</p>`;
        btn.disabled = false;
      }
    });
  }

  // ---------- 客戶文件區 ----------
  async function mount(el, { clientId, owner, onPolicies }) {
    if (!el || !clientId) return;
    const draw = async () => {
      const { data, error } = await sb.from('fin_documents').select('id, kind, file_name, file_path, mime, size, created_at, read_at').eq('client_id', clientId.toUpperCase()).order('created_at', { ascending: false });
      const docs = error ? [] : (data || []);
      el.innerHTML = `
        <div class="cd-bar"><b>📁 客戶文件</b><span>只跟這位客戶綁在一起</span>
          <button type="button" class="btn-secondary cd-up">＋ 上傳文件</button>
          <button type="button" class="btn-primary cd-imp">📎 上傳保單截圖・自動建檔</button></div>
        ${docs.length ? `<ul class="cd-list">${docs.map((d) => `<li><span class="cd-kind">${KIND[d.kind] || '文件'}</span><a href="#" data-open="${d.id}">${esc(d.file_name || '未命名')}</a><small>${roc(new Date(new Date(d.created_at).getTime() + 8 * 3600e3).toISOString())}${d.read_at ? '・已判讀' : ''}</small><button type="button" class="cd-del" data-del="${d.id}" title="刪除">刪除</button></li>`).join('')}</ul>` : '<p class="cd-empty">還沒有文件。保單截圖、對帳單、權狀、同意書都可以放這裡。</p>'}
        <input type="file" class="cd-file" multiple hidden accept="image/*,application/pdf">`;
      const pick = el.querySelector('.cd-file');
      el.querySelector('.cd-up').addEventListener('click', () => pick.click());
      pick.addEventListener('change', async () => {
        const kind = prompt('文件類別：保單、對帳單、權狀、證件、同意書、其他', '其他');
        if (kind === null) return;
        const k = Object.entries(KIND).find(([, v]) => v === kind.trim())?.[0] || 'other';
        try { for (const f of pick.files) await upload(f, clientId.toUpperCase(), k); } catch (e) { alert(e.message || e); }
        draw();
      });
      el.querySelector('.cd-imp').addEventListener('click', () => importPolicies({ clientId: clientId.toUpperCase(), owner, onDone: (p) => { draw(); if (onPolicies) onPolicies(p); } }));
      el.querySelectorAll('[data-open]').forEach((a) => a.addEventListener('click', async (e) => {
        e.preventDefault();
        const d = docs.find((x) => x.id === a.dataset.open);
        const { data: s, error: er } = await sb.storage.from('fin-docs').createSignedUrl(d.file_path, 300);
        if (er) { alert('開啟失敗：' + er.message); return; }
        window.open(s.signedUrl, '_blank', 'noopener');
      }));
      el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
        const d = docs.find((x) => x.id === b.dataset.del);
        if (!confirm(`刪除「${d.file_name}」？刪除後無法復原。`)) return;
        await sb.storage.from('fin-docs').remove([d.file_path]);
        const { error: er } = await sb.from('fin_documents').delete().eq('id', d.id);
        if (er) alert('刪除失敗：' + er.message);
        draw();
      }));
    };
    await draw();
  }

  window.ClientDocs = { mount, importPolicies, _toPolicy: toPolicy, _periodText: periodText };
})();
