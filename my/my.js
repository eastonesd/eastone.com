// ============================================================
// 客戶專區「我的保單」：客戶用業務員給的邀請碼註冊，登入後唯讀查看自己的保單
// 資料只透過資料庫函式 portal_policies() 讀取（只回傳自己的保單、不含扣款帳號等內部欄位）
// ============================================================
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const VIEWS = ['v-login', 'v-signup', 'v-forgot', 'v-reset', 'v-bind', 'v-list'];
  const show = (v) => VIEWS.forEach((x) => { $(x).hidden = x !== v; });
  const KEY = 'eastone-portal-invite';
  const store = { get: () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } },
    set: (v) => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* 無痕 */ } } };
  const errText = (e) => {
    const m = String((e && e.message) || e || '');
    if (/invalid login credentials/i.test(m)) return '信箱或密碼錯誤';
    if (/email not confirmed/i.test(m)) return '信箱還沒確認，請到信箱點確認信後再登入';
    if (/already registered|already been registered/i.test(m)) return '這個信箱已經註冊過，請直接登入';
    if (/signups not allowed|signup is disabled/i.test(m)) return '目前暫停開放註冊，請透過 LINE 聯繫東石';
    if (/password/i.test(m) && /least|short|weak/i.test(m)) return '密碼太簡單，請至少 8 碼並混合英數字';
    if (/fetch|network/i.test(m)) return '無法連線，請確認網路後再試';
    return m.replace(/^.*?ERROR:\s*/, '') || '發生錯誤，請稍後再試';
  };
  const lineUrl = `https://line.me/R/ti/p/${encodeURIComponent(LINE_OA_ID || '')}`;
  $('my-line').href = lineUrl;

  const invite = (new URLSearchParams(location.search).get('invite') || '').trim().toUpperCase();
  if (invite) store.set(invite);

  async function redeem(code) {
    const { data, error } = await sb.rpc('portal_redeem', { p_code: code });
    if (error) throw error;
    store.set('');
    if (invite) history.replaceState(null, '', location.pathname);
    return data;
  }

  async function enter() {
    const { data, error } = await sb.rpc('portal_policies');
    if (error) throw error;
    if (data) {
      render(data);
      const { data: reps } = await sb.rpc('portal_reports');
      const ymd = (d) => { const [y, m, dd] = String(d).split('-').map(Number); return `${y} 年 ${m} 月 ${dd} 日`; };
      $('my-reports').innerHTML = (reps || []).length ? `<h2 class="my-h2">我的資產負債報表</h2>${reps.map((r) =>
        `<a class="my-rep" href="report.html?snap=${encodeURIComponent(r.id)}"><b>${esc(r.title || '資產負債報表')}</b><span>${ymd(r.as_of)} 的資料</span></a>`).join('')}<h2 class="my-h2">我的保單</h2>` : '';
      return;
    }
    const pending = store.get();
    if (pending) {
      try { await redeem(pending); return enter(); } catch (e) { $('bd-code').value = pending; $('bd-msg').textContent = errText(e); store.set(''); }
    }
    show('v-bind');
  }

  const money = (v, ccy) => {
    const n = Number(v);
    if (!isFinite(n) || !v) return '—';
    return `${n.toLocaleString('zh-TW')}${!ccy || ccy === 'TWD' ? ' 元' : ' ' + ccy}`;
  };
  const sa = (x) => {
    const n = x && x.sum_assured;
    if (!x || x.sa_unit === '附加' || !n || Number(n) === 0) return '—';
    const u = x.sa_unit || '';
    if (u === '萬') return `${Number(n).toLocaleString('zh-TW')} 萬元`;
    if (u === '元') return `${Number(n).toLocaleString('zh-TW')} 元`;
    return `${n} ${u}`;
  };

  function render(d) {
    $('my-name').textContent = `${d.name || ''} 您好`;
    const list = d.policies || [];
    $('my-policies').innerHTML = list.length ? list.map((p) => {
      const m = p.main || {};
      const riders = (p.riders || []).map((r) => `<tr><td>${esc(r.name || r.code)}<div class="my-mini">${esc(r.code || '')}${r.insured_name ? '・被保人 ' + esc(r.insured_name) : ''}</div></td>
        <td>${sa(r)}</td><td>${esc(r.coverage || r.term || '—')}</td><td class="num">${money(r.premium)}</td></tr>`).join('');
      const bens = (p.beneficiaries || []).filter((b) => b.name).map((b) => `${esc(b.name)}${b.ratio ? ` ${esc(b.ratio)}%` : ''}`).join('、');
      const ag = p.agent || {};
      return `<article class="my-card">
        <header><div><b>${esc(m.name || m.code || '保單')}</b><span class="my-co">${esc(p.company || '')}</span></div>
          <span class="my-st ${p.status && p.status !== '正常' ? 'warn' : ''}">${esc(p.status || '正常')}</span></header>
        <dl>
          <div><dt>保單號碼</dt><dd>${esc(p.policy_no || '—')}</dd></div>
          <div><dt>生效日</dt><dd>${esc(p.effective_date || '—')}</dd></div>
          <div><dt>要保人</dt><dd>${esc(p.applicant_name || '—')}</dd></div>
          <div><dt>被保人</dt><dd>${esc(p.insured_name || '—')}</dd></div>
          <div><dt>主約保額</dt><dd>${sa(m)}</dd></div>
          <div><dt>繳費年期／保障</dt><dd>${esc(m.term || '—')}／${esc(m.coverage || '—')}</dd></div>
          <div><dt>繳別</dt><dd>${esc(p.pay_mode || '—')}</dd></div>
          <div><dt>總保費</dt><dd>${money(p.total_premium, p.currency)}</dd></div>
          <div class="wide"><dt>受益人</dt><dd>${bens || '—'}</dd></div>
          ${ag.name ? `<div class="wide"><dt>服務業務員</dt><dd>${esc(ag.name)}${ag.license_no ? `（登錄字號 ${esc(ag.license_no)}）` : ''}</dd></div>` : ''}
        </dl>
        ${riders ? `<table><thead><tr><th>附約</th><th>保額</th><th>保障</th><th class="num">保費</th></tr></thead><tbody>${riders}</tbody></table>` : ''}
      </article>`;
    }).join('') : '<div class="my-empty">目前沒有建檔的保單。如有疑問請透過 LINE 聯繫東石。</div>';
    show('v-list');
  }

  async function boot() {
    const { data } = await sb.auth.getSession();
    if (/type=recovery/.test(location.hash)) return show('v-reset');
    if (data && data.session) {
      try { await enter(); } catch (e) { show('v-bind'); $('bd-msg').textContent = errText(e); }
    } else if (invite) { $('su-code').value = invite; show('v-signup'); } else show('v-login');
  }
  sb.auth.onAuthStateChange((ev) => { if (ev === 'PASSWORD_RECOVERY') show('v-reset'); });

  const busy = (form, on) => { const b = form.querySelector('button[type=submit]'); b.disabled = on; };
  const go = (v) => (e) => { e.preventDefault(); show(v); };
  $('to-signup').addEventListener('click', go('v-signup'));
  $('to-login').addEventListener('click', go('v-login'));
  $('to-forgot').addEventListener('click', go('v-forgot'));
  document.querySelectorAll('.back-login').forEach((a) => a.addEventListener('click', go('v-login')));
  document.querySelectorAll('.do-logout').forEach((a) => a.addEventListener('click', async (e) => { e.preventDefault(); await sb.auth.signOut({ scope: 'local' }); show('v-login'); }));

  $('v-login').addEventListener('submit', async (e) => {
    e.preventDefault(); busy(e.target, true); $('li-msg').textContent = '';
    try {
      const { error } = await sb.auth.signInWithPassword({ email: $('li-email').value.trim(), password: $('li-pass').value });
      if (error) throw error;
      await enter();
    } catch (err) { $('li-msg').textContent = errText(err); } finally { busy(e.target, false); }
  });

  $('v-signup').addEventListener('submit', async (e) => {
    e.preventDefault(); busy(e.target, true); $('su-msg').textContent = '';
    const code = $('su-code').value.trim().toUpperCase();
    try {
      if (!/^[A-Z0-9]{6,12}$/.test(code)) throw new Error('邀請碼格式不正確');
      // 不開放公開註冊：由後端函式驗證邀請碼後才建立帳號並綁定
      const email = $('su-email').value.trim(), password = $('su-pass').value;
      const { data, error } = await sb.functions.invoke('portal-signup', { body: { code, email, password } });
      if (error) {
        let m = '註冊失敗，請稍後再試';
        try { m = (await error.context.json()).error || m; } catch { /* 讀不到原因 */ }
        throw new Error(m);
      }
      if (!data || !data.ok) throw new Error((data && data.error) || '註冊失敗');
      store.set('');
      if (invite) history.replaceState(null, '', location.pathname);
      const { error: e2 } = await sb.auth.signInWithPassword({ email, password });
      if (e2) throw e2;
      await enter();
    } catch (err) { $('su-msg').textContent = errText(err); } finally { busy(e.target, false); }
  });

  $('v-bind').addEventListener('submit', async (e) => {
    e.preventDefault(); busy(e.target, true); $('bd-msg').textContent = '';
    try { await redeem($('bd-code').value.trim()); await enter(); } catch (err) { $('bd-msg').textContent = errText(err); } finally { busy(e.target, false); }
  });

  $('v-forgot').addEventListener('submit', async (e) => {
    e.preventDefault(); busy(e.target, true);
    const { error } = await sb.auth.resetPasswordForEmail($('fg-email').value.trim(), { redirectTo: `${location.origin}${location.pathname}` });
    $('fg-msg').textContent = error ? errText(error) : '已寄出重設信，請到信箱點連結設定新密碼。';
    busy(e.target, false);
  });

  $('v-reset').addEventListener('submit', async (e) => {
    e.preventDefault(); busy(e.target, true);
    const { error } = await sb.auth.updateUser({ password: $('rs-pass').value });
    if (error) { $('rs-msg').textContent = errText(error); busy(e.target, false); return; }
    history.replaceState(null, '', location.pathname);
    try { await enter(); } catch { show('v-login'); }
    busy(e.target, false);
  });

  boot();
})();
