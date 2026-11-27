// ============================================================
// 電子簽署（業務員的手機、平板當面簽）
//   EastoneSign.pad({ title, note })           → 簽名板，回傳 PNG dataURL（取消回傳 null）
//   EastoneSign.consent({ client, agent, root }) → 個資同意書：勾選＋簽名＋填入身分證字號、日期、業務員 → 回傳 JPEG Blob
//   EastoneSign.snapshot(element)              → 把畫面元素轉成 JPEG Blob（報告簽名頁存檔用）
// html2canvas 由 cdnjs 延遲載入
// ============================================================
(function () {
  'use strict';
  const H2C = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tpe = () => new Date(Date.now() + 8 * 3600e3);
  const rocDate = (d = tpe()) => `${d.getUTCFullYear() - 1911} 年 ${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日`;
  const stamp = () => tpe().toISOString().slice(0, 16).replace('T', ' ');

  function css() {
    if (document.getElementById('es-style')) return;
    const s = document.createElement('style'); s.id = 'es-style';
    s.textContent = `.es-ov{position:fixed;inset:0;z-index:4000;background:rgba(12,18,32,.86);display:flex;align-items:center;justify-content:center;padding:12px;font-family:'Noto Sans TC',sans-serif}
.es-box{background:#fffdf8;color:#1b2a4a;border-radius:16px;width:min(760px,100%);max-height:100%;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.45)}
.es-head{padding:14px 18px 6px}.es-head h3{margin:0;font:900 19px/1.3 'Noto Serif TC',serif}.es-head p{margin:4px 0 0;font-size:13px;color:#6b6457}
.es-pad{position:relative;margin:8px 18px;border:2px dashed #cfc5ad;border-radius:12px;background:#fff;touch-action:none;height:min(46vh,300px)}
.es-pad canvas{width:100%;height:100%;display:block;cursor:crosshair}.es-pad span{position:absolute;left:16px;bottom:10px;right:16px;border-top:1px solid #d9cfba;font-size:12px;color:#a59c8a;padding-top:4px;pointer-events:none}
.es-act{display:flex;gap:8px;justify-content:flex-end;padding:10px 18px 16px;flex-wrap:wrap}.es-act button{font:700 15px 'Noto Sans TC',sans-serif;padding:10px 18px;border-radius:10px;border:1px solid #d9cfba;background:#fff;color:#1b2a4a;cursor:pointer}
.es-act .go{background:#1b2a4a;color:#f3d58a;border-color:transparent}.es-act .go:disabled{opacity:.5}
.es-doc{flex:1;min-height:0;overflow:auto;background:#e9e4d8;padding:10px}.es-doc iframe{width:794px;height:1123px;border:0;background:#fff;transform-origin:0 0;display:block}
.es-form{padding:10px 18px;display:grid;gap:8px;border-top:1px solid #e4dccb;max-height:42vh;overflow:auto;font-size:14px}
.es-q{display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;padding:6px 0;border-bottom:1px dashed #e4dccb}.es-q label{display:flex;gap:4px;align-items:center;white-space:nowrap}
.es-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.es-row input[type=text]{flex:1;min-width:140px;height:38px;padding:0 10px;border:1px solid #d9cfba;border-radius:8px;font:inherit}
.es-sig{display:flex;align-items:center;gap:10px}.es-sig img{height:44px;max-width:180px;border-bottom:1px solid #1b2a4a}.es-sig button{font:inherit;font-weight:700;padding:8px 14px;border-radius:9px;border:1px solid #b8892b;background:#fff8e6;color:#8c6a2a;cursor:pointer}
.es-err{color:#b3412e;font-size:13px;min-height:18px}`;
    document.head.appendChild(s);
  }

  // ---------- 簽名板 ----------
  function pad({ title = '請簽名', note = '用手指或觸控筆在框內簽名' } = {}) {
    css();
    return new Promise((resolve) => {
      const ov = document.createElement('div'); ov.className = 'es-ov';
      ov.innerHTML = `<div class="es-box" role="dialog" aria-modal="true"><div class="es-head"><h3>${esc(title)}</h3><p>${esc(note)}</p></div>
        <div class="es-pad"><canvas></canvas><span>簽名處</span></div>
        <div class="es-act"><button type="button" data-a="clear">清除重簽</button><button type="button" data-a="cancel">取消</button><button type="button" class="go" data-a="ok" disabled>確認簽名</button></div></div>`;
      document.body.appendChild(ov);
      const cv = ov.querySelector('canvas'), ctx = cv.getContext('2d'), ok = ov.querySelector('[data-a=ok]');
      const fit = () => { const r = cv.getBoundingClientRect(), k = window.devicePixelRatio || 1; cv.width = r.width * k; cv.height = r.height * k; ctx.scale(k, k); ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0d1630'; };
      fit();
      let drawing = false, last = null, inked = false;
      const pt = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      cv.addEventListener('pointerdown', (e) => { drawing = true; last = pt(e); cv.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.arc(last.x, last.y, 1.2, 0, 7); ctx.fillStyle = '#0d1630'; ctx.fill(); });
      cv.addEventListener('pointermove', (e) => { if (!drawing) return; const p = pt(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; inked = true; ok.disabled = false; });
      const up = () => { drawing = false; }; cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
      const done = (v) => { ov.remove(); resolve(v); };
      ov.addEventListener('click', (e) => {
        const a = e.target.dataset && e.target.dataset.a;
        if (a === 'clear') { ctx.clearRect(0, 0, cv.width, cv.height); inked = false; ok.disabled = true; }
        if (a === 'cancel') done(null);
        if (a === 'ok' && inked) done(trim(cv));
      });
    });
  }
  // 裁掉空白邊
  function trim(cv) {
    const ctx = cv.getContext('2d'), { width: w, height: h } = cv, d = ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (d[(y * w + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 <= x0) return cv.toDataURL('image/png');
    const m = 12, o = document.createElement('canvas');
    o.width = x1 - x0 + m * 2; o.height = y1 - y0 + m * 2;
    o.getContext('2d').drawImage(cv, x0 - m, y0 - m, o.width, o.height, 0, 0, o.width, o.height);
    return o.toDataURL('image/png');
  }

  function loadH2C(win) {
    return new Promise((res, rej) => {
      if (win.html2canvas) return res(win.html2canvas);
      const s = win.document.createElement('script'); s.src = H2C; s.crossOrigin = 'anonymous';
      s.onload = () => res(win.html2canvas); s.onerror = () => rej(new Error('無法載入截圖元件，請確認網路後再試'));
      win.document.head.appendChild(s);
    });
  }
  async function snapshot(el, win = window) {
    const h2c = await loadH2C(win);
    const c = await h2c(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
    return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  }

  // ---------- 個資同意書 ----------
  // client：{ id, name, birthday }；agent：{ name, license }；root：網站根目錄相對路徑（例 '../'）
  function consent({ client, agent = {}, root = '../' }) {
    css();
    const age = client.birthday ? Math.floor((Date.now() - Date.parse(client.birthday)) / (365.25 * 864e5)) : null;
    const minor = age != null && age < 18;
    return new Promise((resolve) => {
      const ov = document.createElement('div'); ov.className = 'es-ov';
      const Q = ['同意蒐集、處理及利用個人資料（必要）', '同意蒐集、處理及利用健康及醫療資料', '同意提供予委託之律師、會計師、地政士等專業人士', '同意接收商品與活動資訊（行銷）'];
      ov.innerHTML = `<div class="es-box" role="dialog" aria-modal="true" style="height:100%">
        <div class="es-head"><h3>個資同意書・電子簽署</h3><p>${esc(client.name)}　請客戶閱讀下方同意書後，逐項勾選並簽名</p></div>
        <div class="es-doc"><iframe title="個資同意書" src="${root}forms/privacy-consent-v1.0.html"></iframe></div>
        <div class="es-form">
          ${Q.map((q, i) => `<div class="es-q"><span>${i + 1}. ${q}</span><label><input type="radio" name="q${i}" value="y" ${i === 0 ? 'checked' : ''}>同意</label><label><input type="radio" name="q${i}" value="n">不同意</label></div>`).join('')}
          <div class="es-row">身分證統一編號<input type="text" id="es-idno" value="${esc(/^[A-Z][12]\d{8}$/i.test(client.id) ? client.id.toUpperCase() : '')}" autocomplete="off"></div>
          <div class="es-sig"><b>立同意書人</b><img id="es-s1" alt="" hidden><button type="button" data-sig="s1">簽名</button></div>
          ${minor ? `<div class="es-row">法定代理人與立同意書人的關係<input type="text" id="es-rel" placeholder="例：父、母"></div>
            <div class="es-sig"><b>法定代理人</b><img id="es-s2" alt="" hidden><button type="button" data-sig="s2">簽名</button></div>` : ''}
          <label class="es-row"><input type="checkbox" id="es-ch4" checked> 一併簽署第四章（代為提供家族成員資料聲明）</label>
          <div class="es-err" id="es-err"></div>
        </div>
        <div class="es-act"><button type="button" data-a="cancel">取消</button><button type="button" class="go" data-a="ok">完成簽署並存檔</button></div></div>`;
      document.body.appendChild(ov);
      const ifr = ov.querySelector('iframe'), wrap = ov.querySelector('.es-doc');
      const scale = () => { const k = Math.min(1, (wrap.clientWidth - 20) / 794); ifr.style.transform = `scale(${k})`; ifr.style.marginBottom = `${-(1 - k) * 1123}px`; ifr.style.marginRight = `${-(1 - k) * 794}px`; };
      ifr.addEventListener('load', scale); window.addEventListener('resize', scale);
      const sig = {};
      const done = (v) => { window.removeEventListener('resize', scale); ov.remove(); resolve(v); };
      ov.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-sig],[data-a]'); if (!b) return;
        if (b.dataset.sig) {
          const url = await pad({ title: b.dataset.sig === 's1' ? `${client.name} 簽名` : '法定代理人簽名' });
          if (url) { sig[b.dataset.sig] = url; const im = ov.querySelector(`#es-${b.dataset.sig}`); im.src = url; im.hidden = false; b.textContent = '重簽'; }
          return;
        }
        if (b.dataset.a === 'cancel') return done(null);
        if (b.dataset.a !== 'ok') return;
        const err = ov.querySelector('#es-err');
        const ans = Q.map((_, i) => (ov.querySelector(`input[name=q${i}]:checked`) || {}).value || '');
        if (ans.some((x) => !x)) { err.textContent = `第 ${ans.findIndex((x) => !x) + 1} 項還沒勾選同意或不同意。`; return; }
        if (ans[0] !== 'y') { err.textContent = '第 1 項是提供服務的必要項目，需要同意才能簽署。'; return; }
        if (!sig.s1) { err.textContent = '請立同意書人簽名。'; return; }
        if (minor && !sig.s2) { err.textContent = '未成年人需要法定代理人簽名。'; return; }
        b.disabled = true; err.textContent = '產生簽署檔中…';
        try {
          const doc = ifr.contentDocument;
          // 勾選
          const rows = [...doc.querySelectorAll('table')].find((t) => /同意依第一章/.test(t.textContent)).querySelectorAll('tbody tr');
          rows.forEach((tr, i) => { const c = tr.querySelectorAll('td.c'); c[0].textContent = ans[i] === 'y' ? '■' : '□'; c[1].textContent = ans[i] === 'n' ? '■' : '□'; });
          // 簽名欄
          const img = (u) => `<img src="${u}" style="height:8mm;max-width:58mm;vertical-align:middle">`;
          const st = doc.querySelectorAll('table.sign tr');
          st[0].children[1].innerHTML = img(sig.s1); st[0].children[3].textContent = ov.querySelector('#es-idno').value.trim().toUpperCase();
          if (minor) { st[1].children[1].innerHTML = img(sig.s2); st[1].children[3].textContent = ov.querySelector('#es-rel').value.trim(); }
          st[2].children[1].textContent = rocDate();
          st[2].children[3].textContent = [agent.name, agent.license].filter(Boolean).join('／');
          if (ov.querySelector('#es-ch4').checked) {
            const ln = doc.querySelectorAll('.box .line');
            if (ln[0]) ln[0].outerHTML = img(sig.s1);
            if (ln[1]) ln[1].outerHTML = `<span>${rocDate()}</span>`;
          }
          const foot = doc.createElement('p');
          foot.style.cssText = 'margin-top:3mm;font-size:8pt;color:#6b6457;text-align:right';
          foot.textContent = `本同意書以電子方式當面簽署｜簽署時間 ${stamp()}（台北）｜服務業務員 ${agent.name || ''}`;
          doc.body.appendChild(foot);
          await new Promise((r) => setTimeout(r, 120));
          const blob = await snapshot(doc.body, ifr.contentWindow);
          done({ blob, answers: ans, minor });
        } catch (x) { b.disabled = false; err.textContent = `存檔失敗：${x.message || x}`; }
      });
    });
  }

  window.EastoneSign = { pad, consent, snapshot, rocDate };
})();
