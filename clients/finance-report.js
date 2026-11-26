// ============================================================
// 資產負債報表：只讀一份凍結的快照（fin_snapshots），不重新計算、不讀最新行情
// 網址：finance-report.html?snap=<快照 id>
// ============================================================
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const C = FinCalc;
  const CATS = { house: '房屋', savings_policy: '儲蓄險', investment_policy: '投資型保單／年金', fund: '基金', stock: '股票／ETF', deposit: '定存', cash: '活存／現金', mcn: 'FCN 結構型商品', other: '其他' };
  const LIAB = { mortgage: '房貸', policy_loan: '保單貸款', securities_loan: '基金／股票質借', other: '其他借款' };
  const PURPOSE = { hot: '熱錢', cold: '冷錢', none: '未分類' };
  const RESTRICT = { none: '未設限', pledged: '質押', locked: '鎖定', repay: '需還款解押', unknown: '待確認' };
  const ST = { ok: '', funds_sum: '價值＝連結基金加總', unvalued: '未估值・未納入', no_fx: '缺匯率・未納入', no_currency: '缺幣別', net_unreconciled: '扣貸口徑待核對・未納入', display_only: '僅展示（上層已計入）', no_balance: '未填餘額・未納入' };
  const fmt = (big, ccy = 'TWD') => {
    if (big === null || big === undefined) return '—';
    const dp = ['TWD', 'JPY'].includes(ccy) ? 0 : 2;
    return C.toNum(big).toLocaleString('zh-TW', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  };

  document.addEventListener('DOMContentLoaded', async () => {
    // 客戶專區（my/report.html）只能透過 portal_report 讀業務員分享出來的報表
    const PORTAL = !!window.FIN_REPORT_PORTAL;
    if (!PORTAL) await requireLogin('../');
    $('print').addEventListener('click', async () => { await document.fonts.ready; window.print(); });
    const id = new URLSearchParams(location.search).get('snap');
    const { data, error } = PORTAL ? await sb.rpc('portal_report', { p_id: id }) : await sb.from('fin_snapshots').select('*').eq('id', id).maybeSingle();
    if (error || !data) { $('doc').innerHTML = '<div id="loading">找不到這份報表，或您沒有權限查看。</div>'; return; }
    render(data, C.revive(data.result), C.revive(data.payload));
  });

  function render(snap, r, p) {
    const { bs, av, cf } = r;
    const fxUsed = new Map();
    [...bs.assetRows, ...bs.liabRows].forEach((x) => { if (x.fx && x.fx.date) fxUsed.set(x.currency, x.fx); });
    const miss = [];
    Object.entries(bs.missing).forEach(([k, arr]) => arr.forEach((x) => miss.push(`${x.name || '（未命名）'}：${ST[x.status] || k}`)));
    const assets = Object.keys(CATS).map((cat) => {
      const list = bs.assetRows.filter((x) => x.category === cat);
      if (!list.length) return '';
      return `<tr><td colspan="6"><b>${CATS[cat]}</b></td></tr>` + list.map((x) => `<tr>
        <td>${esc(x.name)}<div class="note">${esc(x.institution)}${x.flags.length ? '・' + esc(x.flags.join('、')) : ''}</div></td>
        <td>${PURPOSE[x.purpose]}／${RESTRICT[x.restriction]}</td>
        <td class="num">${x.original !== null ? fmt(x.original, x.currency) + ' ' + x.currency : '—'}</td>
        <td class="num">${x.base !== null ? fmt(x.base) : '—'}</td>
        <td style="white-space:nowrap">${x.valueDate || ''}<div class="note">${esc(x.valueSource || '')}</div></td>
        <td class="${x.status === 'ok' ? '' : 'warn'}">${ST[x.status] || ''}</td></tr>`).join('');
    }).join('');
    const liabs = bs.liabRows.map((x) => `<tr><td>${esc(x.name)}<div class="note">${LIAB[x.category] || ''}・${esc(x.institution)}</div></td>
      <td class="num">${x.principal !== null ? fmt(x.principal, x.currency) : '—'}</td><td class="num">${x.interest !== null ? fmt(x.interest, x.currency) : '—'}</td>
      <td class="num">${x.base !== null ? fmt(x.base) : '—'}</td><td style="white-space:nowrap">${x.balanceDate || ''}</td><td class="${x.status === 'ok' ? '' : 'warn'}">${ST[x.status] || ''}</td></tr>`).join('');
    const ccy = Object.entries(bs.byCcy).map(([k, v]) => `<tr><td>${k}</td><td class="num">${fmt(v.assets, k)}</td><td class="num">${fmt(v.liabilities, k)}</td></tr>`).join('');
    const trace = (r.trace || []).map((t) => `<tr><td>${esc(t.liability.name || '')}<div class="note">${esc(t.liability.institution || '')}</div></td>
      <td>${t.collateral.map((c) => esc(c.asset ? c.asset.name : '（已刪除）') + (c.link.confirm_status === 'confirmed' ? '' : '（待確認）')).join('、') || '—'}</td>
      <td>${t.uses.map((u) => esc(u.asset ? u.asset.name : '（已刪除）') + (u.link.amount ? ` ${fmt(C.D(u.link.amount), u.link.currency || 'TWD')} ${u.link.currency || ''}` : '')).join('、') || '—'}</td></tr>`).join('');
    const up = (r.upcoming || []).slice(0, 80).map((u) => `<tr><td>${u.date}</td><td>${esc(u.note || u.label)}</td>
      <td class="num">${u.direction === 'in' ? '+' : '−'}${u.amount === null ? '金額未知' : fmt(u.amount, u.currency) + ' ' + u.currency}</td></tr>`).join('');
    const avd = (av.detail || []).map((d) => `<tr><td>${esc(d.names.join('、'))}</td><td>${{ free: '未設限', release: '需還款解押', pending: '待確認' }[d.type]}</td>
      <td class="num">${fmt(d.amount)}</td><td class="note">${esc(d.note || '')}${d.repay ? `（需還款 ${fmt(d.repay)}）` : ''}</td></tr>`).join('');

    const [yy, mm, dd] = String(snap.as_of).split('-').map(Number);
    $('doc').innerHTML = `
      ${window.FIN_REPORT_PORTAL ? `<p class="asof-banner">本報表為 ${yy} 年 ${mm} 月 ${dd} 日（民國 ${yy - 1911} 年 ${mm} 月 ${dd} 日）的資料，之後的行情與資產變動不會反映在這份報表上。</p>` : ''}
      <h1>資產負債報表</h1>
      <div class="meta">${esc(p.client ? `${p.client.name}（${p.client.id}）` : snap.client_id)}・基準日 ${snap.as_of}・收支期間 ${r.period.from} ～ ${r.period.to}<br>
        報表名稱：${esc(snap.title)}・產生時間 ${new Date(snap.created_at).toLocaleString('zh-TW')}・計價幣別 TWD・計算規則 ${esc(snap.rules_version)}<br>
        資料完整度：<span class="flag ${bs.complete ? 'ok' : 'bad'}">${bs.complete ? '完整' : `不完整（${bs.missingCount} 項）`}</span></div>

      <h2>一、總覽</h2>
      <div class="stats">
        <div class="stat"><span>已估值資產</span><b>${fmt(bs.assetsTotal)}</b></div>
        <div class="stat"><span>已確認負債</span><b>${fmt(bs.liabTotal)}</b></div>
        <div class="stat em"><span>${bs.complete ? '淨資產' : '淨資產（部分）'}</span><b>${fmt(bs.net)}</b></div>
        <div class="stat"><span>估計可自由動用（熱錢）</span><b>${fmt(av.confirmed)}</b></div>
      </div>
      ${bs.complete ? '' : '<p class="note warn">資料不完整：總額只包含已估值、已換匯的項目，不代表完整淨值。缺漏清單見第七節。</p>'}
      <div class="grid2">
        <div><table><thead><tr><th>幣別</th><th class="num">資產（原幣）</th><th class="num">負債（原幣）</th></tr></thead><tbody>${ccy || '<tr><td colspan="3">—</td></tr>'}</tbody></table></div>
        <div><table><tbody>${Object.entries(PURPOSE).map(([k, l]) => `<tr><td>${l}</td><td class="num">${fmt(bs.byPurpose[k] || 0n)}</td></tr>`).join('')}
          <tr><td>熱錢中受限制</td><td class="num">${fmt(av.hotRestricted)}</td></tr></tbody></table></div>
      </div>

      <h2>二、資產明細</h2>
      <table><thead><tr><th>項目</th><th>用途／限制</th><th class="num">原幣現值</th><th class="num">台幣</th><th>估值日</th><th>狀態</th></tr></thead><tbody>${assets || '<tr><td colspan="6">—</td></tr>'}</tbody></table>
      <p class="note">股票、基金等標示「收盤價」或「最新公告淨值」者不是即時行情。成本與保額不作為現值。</p>

      <h2>三、負債明細</h2>
      <table><thead><tr><th>借款</th><th class="num">剩餘本金</th><th class="num">未付利息</th><th class="num">台幣合計</th><th>餘額日</th><th>狀態</th></tr></thead><tbody>${liabs || '<tr><td colspan="6">—</td></tr>'}</tbody></table>

      <h2>四、估計可自由動用資金</h2>
      <table><thead><tr><th>熱錢部位</th><th>狀態</th><th class="num">估計金額</th><th>說明</th></tr></thead><tbody>${avd || '<tr><td colspan="4">沒有標示為熱錢的部位</td></tr>'}</tbody></table>
      <p class="note">可動用資金為估計值，不是銀行承諾的可提款額；共同擔保的借款只扣一次；解押條件不明的部位列為待確認（${fmt(av.pending)}）。</p>

      <h2>五、未來 12 個月收支日曆（至 ${r.upcomingTo}）</h2>
      <table><thead><tr><th>日期</th><th>項目</th><th class="num">金額</th></tr></thead><tbody>${up || '<tr><td colspan="3">—</td></tr>'}</tbody></table>

      <h2>六、借款、擔保品與資金用途</h2>
      <table><thead><tr><th>借款</th><th>擔保品</th><th>資金投入</th></tr></thead><tbody>${trace || '<tr><td colspan="3">—</td></tr>'}</tbody></table>

      <h2>七、資料來源與缺漏</h2>
      <table><thead><tr><th>幣別</th><th class="num">匯率（1 外幣＝台幣）</th><th>日期</th><th>來源</th></tr></thead><tbody>
        ${[...fxUsed.entries()].filter(([k]) => k !== 'TWD').map(([k, f]) => `<tr><td>${k}</td><td class="num">${C.toNum(f.rate)}</td><td>${f.date}</td><td>${esc(f.source)}${f.manual ? '（手動）' : ''}</td></tr>`).join('') || '<tr><td colspan="4">僅台幣，無需換匯</td></tr>'}
      </tbody></table>
      ${miss.length ? `<p class="note warn">未納入或待核對：${miss.map(esc).join('；')}</p>` : '<p class="note">無缺漏項目。</p>'}

      <div class="foot">本報表為存檔當下的凍結版本，之後行情、匯率或資料修改不影響本報表數字。匯率為臺灣銀行牌告即期中價等參考匯率，僅供估值，不代表實際換匯成交價。
        本報表僅為財務整理，不構成投資建議、保證收益或商品推薦。東石家族辦公室</div>`;
  }
})();
