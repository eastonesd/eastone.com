// ============================================================
// 社會保險計算器：勞保、勞退、國民年金、公教退撫、公保、軍保、農保
// 計算核心：pension-calc.js（EastonePension）；輸入即時試算
// 「帶入退休規劃」：把月領、起領年齡、一次領存到 sessionStorage，retire.js 讀取後填入
// ============================================================
(() => {
  'use strict';
  const P = EastonePension, R = P.RULES;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const yuan = (x) => (x == null || !isFinite(x) ? '—' : `${Math.round(x).toLocaleString('zh-TW')} 元`);
  const wan = (x) => (x == null || !isFinite(x) ? '—' : `${(Math.round(x / 1000) / 10).toLocaleString('zh-TW')} 萬`);
  const pct = (x) => `${Math.round(x * 10000) / 100}%`;
  const thisYear = new Date().getFullYear();
  const W = 10000;

  const SCHEMES = {
    labor: {
      name: '勞保', icon: '👷', sub: '勞工保險：老年年金（98 年起）、老年一次金、一次請領老年給付（舊制）；併計國保年資',
      fields: [
        { group: '基本資料' },
        { k: 'birthYear', label: '出生年（西元）', def: 1975 },
        { k: 'female', label: '性別', type: 'select', opts: { 0: '男', 1: '女' }, def: 0 },
        { k: 'avgWage', label: '平均月投保薪資（元）', def: R.labor.wageMax, hint: `年金：最高 60 個月平均；舊制一次請領：退保前 3 年平均。上限 ${R.labor.wageMax.toLocaleString()}` },
        { k: 'claimAge', label: '幾歲退休請領', def: '', hint: '留空＝法定年齡；年金最多提前或延後 5 年' },
        { k: 'dependents', label: '遺屬／眷屬人數', def: 1 },
        { group: '年資' },
        { k: 'years', label: '勞保年資合計（年）', def: 30, step: 0.1 },
        { k: 'oldYears', label: '其中民國 97 年底前的年資', def: 0, step: 0.1, hint: '有這段年資才能選「一次請領老年給付」（舊制）' },
        { k: 'yearsAfter60', label: '其中 60 歲以後的年資', def: 0, step: 0.1 },
        { k: 'sameUnitYears', label: '同一投保單位最長年資', def: 0, step: 0.1, hint: '滿 25 年不限年齡可一次請領' },
        { k: 'natYears', label: '國民年金年資（年）', def: 0, step: 0.1, hint: '勞保未滿 15 年時，可併計國保年資湊滿 15 年' },
      ],
      calc(v) {
        const r = P.labor(v);
        const y = r.years, nat = Number(v.natYears) || 0, female = Number(v.female) === 1;
        const merged = y < 15 && y + nat >= 15;
        const annAge = merged ? Math.max(65, r.claimAge) : r.claimAge;
        const annuity = r.eligibleAnnuity ? r.monthly : merged ? Math.max(r.A, r.B) : 0;
        const old = Number(v.oldYears) > 0 ? P.laborOldEligible({ years: y, age: r.claimAge, female, sameUnitYears: v.sameUnitYears }) : null;
        const opts = [
          { name: '老年年金（新制）', ok: !!annuity, amt: annuity ? `${yuan(annuity)}／月，${annAge} 歲起` : '—', why: r.eligibleAnnuity ? '勞保年資滿 15 年' : merged ? `勞保 ${y} 年＋國保 ${nat} 年合計滿 15 年，65 歲起領（只算勞保年資）` : '勞保年資未滿 15 年' },
          { name: '老年一次金（新制）', ok: y < 15 && y > 0 && r.claimAge >= r.legalAge, amt: y < 15 ? `${wan(r.lumpSmall)}（${y} 個月）` : '—', why: y >= 15 ? '年資已滿 15 年，只能選年金或舊制一次請領' : r.claimAge >= r.legalAge ? `年資未滿 15 年、年滿 ${r.legalAge} 歲` : `要年滿 ${r.legalAge} 歲才能請領（目前設定 ${r.claimAge} 歲）` },
          { name: '一次請領老年給付（舊制）', ok: !!(old && old.ok), amt: old ? `${wan(r.lumpOld)}（${r.lumpMonths} 個月）` : '—', why: !old ? '沒有民國 97 年底前的年資' : old.why },
        ];
        const best = opts.filter((o) => o.ok);
        const tiles = [];
        if (annuity) tiles.push({ l: `${annAge} 歲起每月領`, v: yuan(annuity), em: true, s: merged ? '併計國保年資' : `${r.formula} 式` });
        if (opts[2].ok) tiles.push({ l: '或舊制一次請領', v: wan(r.lumpOld), em: !annuity, s: `${r.lumpMonths} 個月` });
        if (opts[1].ok && !merged) tiles.push({ l: '老年一次金', v: wan(r.lumpSmall), em: !annuity, s: `${y} 個月` });
        if (annuity && opts[2].ok && r.breakEven) tiles.push({ l: '月領較划算的年齡', v: `${Math.ceil(annAge + r.lumpOld / annuity / 12)} 歲以後`, s: `領滿約 ${Math.ceil(r.lumpOld / annuity / 12 * 10) / 10} 年` });
        if (!tiles.length) tiles.push({ l: '目前沒有可請領的老年給付', v: '—', em: true });
        return {
          tiles,
          table: { head: ['請領方式', '可以選嗎', '金額', '說明'], rows: opts.map((o) => [o.name, o.ok ? '✅ 可以' : '✕ 不行', o.amt, o.why]) },
          rows: [
            ['法定請領年齡（依出生年）', `${r.legalAge} 歲`],
            ['A 式：薪資 × 年資 × 0.775% ＋ 3,000', yuan(r.A)],
            ['B 式：薪資 × 年資 × 1.55%', yuan(r.B)],
            ...(r.adjust && !merged ? [['提前／延後', `${r.adjust > 0 ? '延後增額' : '提前減額'} ${pct(Math.abs(r.adjust))}`]] : []),
            ['在保死亡：喪葬津貼', yuan(r.funeral)],
            ['在保死亡：遺屬年金（每月）', yuan(r.survivor)],
            ...(annuity ? [['領年金期間死亡：遺屬年金', `${yuan(Math.max(R.labor.survivorMin, annuity * 0.5))}（原領的一半）`]] : []),
            ['失能年金（完全不能工作，每月）', yuan(r.disability)],
          ],
          notes: ['三種方式只能擇一，核付後不能變更。選舊制一次請領要先離職退保；選年金或一次領後，往後的遺屬年金也跟著不同。', '舊制一次請領：60 歲前年資前 15 年每年 1 個月、之後每年 2 個月，最高 45 個月；60 歲後年資最多再計 5 年（合計 50 個月）。', '年金每年依物價指數累計成長 5% 時調整。'],
          handoff: annuity ? { monthly: annuity, age: annAge, lump: 0, label: '勞保老年年金' } : opts[2].ok ? { monthly: 0, age: r.claimAge, lump: r.lumpOld, label: '勞保一次請領老年給付' } : opts[1].ok ? { monthly: 0, age: r.legalAge, lump: r.lumpSmall, label: '勞保老年一次金' } : null,
        };
      },
    },
    lp: {
      name: '勞退（新舊制）', icon: '💼', sub: '94 年 7 月 1 日前的年資適用勞基法舊制（雇主一次給付），之後進個人專戶（新制）；兩段可以同時有',
      fields: [
        { group: '新制：個人專戶（94 年 7 月起）' },
        { k: 'age', label: '目前年齡', def: 50 },
        { k: 'wage', label: '月提繳工資（元）', def: 60000, hint: `上限 ${R.laborPension.wageMax.toLocaleString()}` },
        { k: 'selfPct', label: '自提比例（%）', def: 0, hint: '0～6，自提部分不計入當年所得' },
        { k: 'balanceWan', label: '目前專戶累積（萬）', def: 120, step: 0.1, hint: '勞保局 e 化服務系統可查' },
        { k: 'retPct', label: '預估年報酬率（%）', def: 3, step: 0.1, hint: '保證收益為 2 年期定存利率' },
        { k: 'growthPct', label: '薪資年成長（%）', def: 1, step: 0.1 },
        { k: 'claimAge', label: '幾歲開始領專戶', def: 60 },
        { k: 'lifeYears', label: '預估領取年數', def: 24, hint: '勞保局依年金生命表平均餘命計算' },
        { group: '舊制：勞基法退休金（94 年 7 月前、同一雇主的保留年資）' },
        { k: 'oldYears', label: '保留的舊制年資（年）', def: 0, step: 0.1, hint: '沒換過雇主、選新制時保留的年資；換過雇主或已結清就填 0' },
        { k: 'totalYears', label: '同一雇主新舊制合計年資', def: '', step: 0.1, hint: '判斷能否退休用；留空＝舊制年資＋到退休的年數' },
        { k: 'retireAge', label: '退休時年齡', def: 60 },
        { k: 'stdWage', label: '退休前 6 個月平均工資（元）', def: '', hint: '留空＝月提繳工資' },
        { k: 'settled', label: '舊制年資是否已結清', type: 'select', opts: { 0: '還沒結清', 1: '已結清（雇主已給付）' }, def: 0 },
      ],
      calc(v) {
        const r = P.laborPension({ ...v, selfRate: (v.selfPct || 0) / 100, balance: (v.balanceWan || 0) * W, ret: (v.retPct || 0) / 100, growth: (v.growthPct || 0) / 100, annuityRate: 0.015 });
        const oy = Number(v.oldYears) || 0;
        const ty = v.totalYears != null ? v.totalYears : oy + Math.max(0, (Number(v.retireAge) || 60) - (Number(v.age) || 0));
        const std = oy ? P.laborStd({ oldYears: oy, totalYears: ty, avgWage: v.stdWage || v.wage, retireAge: v.retireAge, settled: Number(v.settled) === 1 }) : null;
        const tiles = [{ l: `新制：${r.claimAge} 歲起月領約`, v: yuan(r.monthly), em: true, s: `專戶累積 ${wan(r.balance)}` }];
        if (std) tiles.push({ l: '舊制：雇主一次給付', v: std.settled ? '已結清' : wan(std.amount), em: !std.settled && std.eligible, s: std.settled ? '' : `${std.bases} 個基數${std.eligible ? '' : '・尚未符合退休條件'}` });
        if (std && !std.settled && std.eligible) tiles.push({ l: '新舊制合計（一次＋專戶）', v: wan(std.amount + r.balance) });
        return {
          tiles,
          rows: [
            ['新制提繳年數（到請領）', `${r.years} 年`],
            ['新制每月提繳', `${yuan(r.wage * r.rate)}（雇主 6%${r.rate > R.laborPension.empRate ? `＋自提 ${pct(r.rate - R.laborPension.empRate)}` : ''}）`],
            ...(r.selfYearly ? [['自提免稅額度（每年）', `${yuan(r.selfYearly)}，以 20% 稅率約省 ${yuan(r.selfYearly * 0.2)}`]] : []),
            ...(std ? [
              ['舊制年資（零頭：未滿半年算半年、滿半年算一年）', `${oy} 年 → 計 ${std.counted} 年`],
              ['舊制基數：前 15 年每年 2 個、之後每年 1 個（最高 45）', `${std.bases} 個基數`],
              ['退休前 6 個月平均工資', yuan(v.stdWage || v.wage)],
              ['舊制退休條件（新舊制年資合計 ' + ty + ' 年）', std.eligible ? `✅ ${std.why}` : `✕ ${std.why}`],
            ] : []),
          ],
          notes: [
            '舊制退休金由雇主一次給付，必須「在同一雇主」符合退休條件；中途離職（非資遣）舊制年資就領不到，資遣則依舊制年資計資遣費。',
            '判斷能否退休時，同一雇主的新舊制年資合併計算，但退休金只就舊制年資計算。',
            '新制專戶：年資滿 15 年可選月領或一次領，2026 年 8 月起選定後不得更改；未滿 15 年只能一次領。身故時餘額由遺屬領回。',
          ],
          handoff: { monthly: r.monthly, age: r.claimAge, lump: std && !std.settled && std.eligible ? std.amount : 0, label: std && std.amount ? '勞退新制月領＋舊制退休金' : '勞退月退休金' },
        };
      },
    },
    nat: {
      name: '國民年金', icon: '🏠', sub: '25～65 歲沒有其他社會保險的國民（家管、自營、無業）',
      fields: [
        { k: 'years', label: '國保年資（年）', def: 15, step: 0.1 },
        { k: 'otherSocial', label: '有沒有勞保、公教保等年資', type: 'select', opts: { 0: '沒有', 1: '有（只能用 B 式）' }, def: 0 },
        { k: 'dependents', label: '遺屬人數', def: 1 },
      ],
      calc(v) {
        const r = P.national({ ...v, otherSocial: Number(v.otherSocial) === 1 });
        return {
          tiles: [{ l: '65 歲起每月領', v: yuan(r.monthly), em: true }, { l: '一年', v: wan(r.monthly * 12) }, { l: '喪葬給付', v: yuan(r.funeral) }],
          rows: [
            ['月投保金額（115 年）', yuan(r.insured)],
            [`A 式：投保金額 × 年資 × 0.65% ＋ ${R.national.addA.toLocaleString()}`, yuan(r.A)],
            ['B 式：投保金額 × 年資 × 1.3%', yuan(r.B)],
            ['採用', `${r.formula} 式`],
            ['身心障礙年金（每月）', yuan(r.disability)],
            ['遺屬年金（每月）', yuan(r.survivor)],
          ],
          notes: ['A 式加計金額有排富條款（個人年所得、不動產超過標準只能 B 式），也不能同時領其他社會保險老年給付。', '月投保金額每 2 年依物價調整；115 年起 21,103 元。'],
          handoff: { monthly: r.monthly, age: 65, lump: 0, label: '國民年金老年年金' },
        };
      },
    },
    civil: {
      name: '公教退撫', icon: '🏛', sub: '公務人員、公立學校教職員月退休金（年改後）',
      fields: [
        { k: 'salary', label: '平均本俸（元／月）', def: 53075, hint: '均俸期間的平均本俸（不含專業加給）' },
        { k: 'years', label: '任職年資（年）', def: 30, step: 0.1 },
        { k: 'retireYear', label: '退休年度（西元）', def: thisYear },
      ],
      calc(v) {
        const r = P.civil(v);
        if (!r.eligible) return { tiles: [{ l: '年資未滿 15 年', v: '只能一次退休金', em: true }], rows: [], notes: ['月退休金需任職滿 15 年。'], handoff: null };
        return {
          tiles: [{ l: '月退休金（退休所得上限內）', v: yuan(r.monthly), em: true }, { l: '所得替代率上限', v: `${r.rate}%`, s: `民國 ${r.retireYearRoc} 年、${Math.floor(r.years)} 年資` }, { l: '起支年齡', v: `${r.claimAge} 歲` }],
          rows: [
            ['均俸計算期間', `最後 ${r.avgYears} 年平均本俸`],
            ['本俸 × 2', yuan(r.base)],
            [`新制公式：本俸 × 2 × ${r.rawPct}%`, yuan(r.raw)],
            [`退休所得上限：本俸 × 2 × ${r.rate}%`, yuan(r.cap)],
            ['樓地板', `${yuan(R.civil.floor)}${r.floored ? '（已補足到樓地板）' : ''}`],
          ],
          notes: ['替代率：35 年資民國 107 年 75%，每年降 1.5%，117 年起 60%；少 1 年 −1.5%、多 1 年 +0.5%（最多 40 年）。', '有 84 年 7 月前舊制年資、優惠存款的人，月退休金加優存利息合計不得超過上限；此處以上限估算。', '112 年 7 月後初任的公務人員改為個人專戶制，不適用本試算。'],
          handoff: { monthly: r.monthly, age: r.claimAge, lump: 0, label: '公教月退休金' },
        };
      },
    },
    gov: {
      name: '公保', icon: '📋', sub: '公教人員保險養老給付、死亡給付',
      fields: [
        { k: 'salary', label: '平均保險俸額（元／月）', def: 53075, hint: '通常等於本俸' },
        { k: 'years', label: '保險年資（年）', def: 30, step: 0.1 },
        { k: 'mode', label: '給付方式', type: 'select', opts: { lump: '一次養老給付（領月退者）', annuity: '養老年金（沒有月退者）' }, def: 'lump' },
        { k: 'ratePct', label: '養老年金給付率（每年 %）', def: 1.3, step: 0.05, hint: '0.75～1.3，依退撫制度而定' },
      ],
      calc(v) {
        const r = P.govIns({ ...v, rate: (v.ratePct || 1.3) / 100 });
        const an = v.mode === 'annuity';
        return {
          tiles: an ? [{ l: '65 歲起每月養老年金', v: yuan(r.annuity), em: true }, { l: '給付率', v: pct(r.annuityPct) }, { l: '一年', v: wan(r.annuity * 12) }]
            : [{ l: '一次養老給付', v: wan(r.lump), em: true }, { l: '給付月數', v: `${r.lumpMonths} 個月`, s: '每年 1.2 個月，最高 36 個月' }],
          rows: [
            ['一次養老給付', `${yuan(r.lump)}（${r.lumpMonths} 個月）`],
            ['養老年金（每月）', `${yuan(r.annuity)}（${pct(r.annuityPct)}）`],
            ['死亡給付：病故或意外', yuan(r.deathIllness)],
            ['死亡給付：因公', yuan(r.deathDuty)],
          ],
          notes: ['支領月退休金的人，公保通常只能領一次養老給付；私校教職員等沒有月退者才領養老年金。', '養老年金請領條件：65 歲＋保險年資 15 年。'],
          handoff: an ? { monthly: r.annuity, age: 65, lump: 0, label: '公保養老年金' } : { monthly: 0, age: 65, lump: r.lump, label: '公保一次養老給付' },
        };
      },
    },
    mil: {
      name: '軍保', icon: '🎖', sub: '軍人保險退伍給付、死亡給付、身心障礙給付（以月支本俸為基數）',
      fields: [
        { k: 'salary', label: '月支本俸（元）', def: 40000, hint: '1 個基數＝1 個月本俸' },
        { k: 'years', label: '保險年資（年）', def: 20 },
      ],
      calc(v) {
        const r = P.military(v);
        const lv = ['一等', '二等', '三等', '重機障'];
        return {
          tiles: [{ l: '退伍給付', v: wan(r.discharge), em: true, s: `${r.bases} 個基數` }, { l: '因病或意外死亡', v: wan(r.death.illness.amount), s: '36 個基數' }, { l: '因公死亡', v: wan(r.death.duty.amount), s: '42 個基數' }],
          rows: [
            ['退伍給付', `${r.bases} 個基數＝${yuan(r.discharge)}`],
            ['作戰死亡', `48 個基數＝${yuan(r.death.combat.amount)}`],
            ...['illness', 'duty', 'combat'].map((k) => [`身心障礙（${{ illness: '因病或意外', duty: '因公', combat: '作戰' }[k]}）`, r.disability[k].map((x, i) => `${lv[i]} ${wan(x.amount)}`).join('、')]),
          ],
          notes: ['退伍給付：滿 5 年 5 個基數；6～10 年每年 +1、11～15 年每年 +2、16 年起每年 +3、滿 20 年後每年 +1，最高 45 個基數。', '眷屬喪葬津貼：父母、配偶 3 個基數；12～25 歲子女 2 個基數；未滿 12 歲 1 個基數。', '軍職退除給與（月退俸）另依退除給與條例計算，不在本試算內。'],
          handoff: { monthly: 0, age: 0, lump: r.discharge, label: '軍保退伍給付' },
        };
      },
    },
    farm: {
      name: '農保', icon: '🌾', sub: '農民健康保險、老農津貼、農民退休儲金',
      fields: [
        { k: 'age', label: '目前年齡', def: 50 },
        { k: 'farmYears', label: '農保年資（年）', def: 20, step: 0.1 },
        { k: 'ratePct', label: '退休儲金提繳率（%）', def: 10, hint: '1～10，政府相對提繳 6 成' },
        { k: 'balanceWan', label: '退休儲金已累積（萬）', def: 0, step: 0.1 },
        { k: 'retPct', label: '預估年報酬率（%）', def: 3, step: 0.1 },
        { k: 'allowance', label: '老農津貼（元／月）', def: R.farmer.allowance, hint: '立法院已通過調為 15,000，尚待公告施行' },
      ],
      calc(v) {
        const r = P.farmer({ ...v, rate: (v.ratePct || 10) / 100, balance: (v.balanceWan || 0) * W, ret: (v.retPct || 0) / 100, lifeYears: 20 });
        return {
          tiles: [{ l: '65 歲起每月合計', v: yuan(r.allowance + r.monthly), em: true, s: '老農津貼＋退休儲金' }, { l: '老農津貼', v: yuan(r.allowance), s: r.allowanceFull ? '全額' : '年資未滿 15 年：半額' }, { l: '退休儲金月領', v: yuan(r.monthly), s: `累積 ${wan(r.balance)}` }],
          rows: [
            ['退休儲金每月提繳', `${yuan(r.total)}（農民 ${yuan(r.self)}＋政府 ${yuan(r.gov)}）`],
            ['提繳工資', `${yuan(R.farmer.retireWage)}（基本工資）× ${pct(r.rate)}`],
            ['提繳到 65 歲', `${r.years} 年`],
            ['農保喪葬津貼', yuan(r.funeral)],
            ['農保月投保金額', yuan(r.insured)],
          ],
          notes: ['老農津貼：65 歲、農保年資 15 年以上全額；103 年 7 月 17 日前加保且年資 6 個月以上未滿 15 年者半額；有排富條款。', '農民退休儲金政府提繳比例自 115 年 1 月 1 日起由 5 成提高為 6 成。', '退休儲金月領以 20 年平均領完估算（實際依年金生命表）。'],
          handoff: { monthly: r.allowance + r.monthly, age: 65, lump: 0, label: '老農津貼＋農民退休儲金' },
        };
      },
    },
  };

  let cur = 'labor';
  const vals = {};
  const field = (f, v) => f.group ? `<h3 class="ps-group">${f.group}</h3>` : f.type === 'select'
    ? `<label>${f.label}<select data-f="${f.k}">${Object.entries(f.opts).map(([k, t]) => `<option value="${k}"${String(v) === String(k) ? ' selected' : ''}>${t}</option>`).join('')}</select>${f.hint ? `<small>${f.hint}</small>` : ''}</label>`
    : `<label>${f.label}<input type="number" data-f="${f.k}" value="${esc(v)}" step="${f.step || 1}" inputmode="decimal">${f.hint ? `<small>${f.hint}</small>` : ''}</label>`;

  function show() {
    const S = SCHEMES[cur];
    $('ps-tabs').innerHTML = Object.entries(SCHEMES).map(([k, s]) => `<button type="button" data-k="${k}" class="${k === cur ? 'on' : ''}">${s.icon} ${s.name}</button>`).join('');
    vals[cur] = vals[cur] || Object.fromEntries(S.fields.filter((f) => f.k).map((f) => [f.k, f.def]));
    $('ps-title').innerHTML = `${S.icon} ${S.name}<small class="tax-h-sub">${S.sub}</small>`;
    $('ps-form').innerHTML = S.fields.map((f) => field(f, vals[cur][f.k])).join('');
    calc();
  }
  function calc() {
    const S = SCHEMES[cur];
    const v = {};
    S.fields.filter((f) => f.k).forEach((f) => { const x = vals[cur][f.k]; v[f.k] = f.type === 'select' ? x : x === '' || x == null ? undefined : Number(x); });
    let out;
    try { out = S.calc(v); } catch (e) { $('ps-result').innerHTML = `<p class="tax-err">${esc(e.message)}</p>`; return; }
    $('ps-result').innerHTML = `
      <div class="tax-eq">${out.tiles.map((t) => `<div class="${t.em ? 'em' : ''}"><span>${t.l}</span><b>${t.v}</b>${t.s ? `<small>${t.s}</small>` : ''}</div>`).join('')}</div>
      ${out.table ? `<div class="ps-cmp"><table><thead><tr>${out.table.head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${out.table.rows.map((r) => `<tr class="${r[1].startsWith('✅') ? 'ok' : 'no'}">${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''}
      ${out.rows.length ? `<table class="ps-table"><tbody>${out.rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</tbody></table>` : ''}
      <ul class="ps-notes">${out.notes.map((n) => `<li>${n}</li>`).join('')}</ul>
      ${out.handoff ? `<div class="ps-actions"><button type="button" class="btn-primary" id="ps-send">帶入退休規劃 →</button><small>會填入退休規劃的${out.handoff.monthly ? '「退休金每月」' : ''}${out.handoff.monthly && out.handoff.lump ? '與' : ''}${out.handoff.lump ? '「退休時一次領」' : ''}</small></div>` : ''}`;
    const b = $('ps-send');
    if (b) b.onclick = () => {
      const h = out.handoff;
      try { sessionStorage.setItem('eastone.pension', JSON.stringify({ monthly: h.monthly, age: h.age, lump: h.lump, label: h.label, at: Date.now() })); } catch { /* 無痕 */ }
      location.href = 'retire.html#pension';
    };
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await requireLogin('../');
    $('ps-main').hidden = false;
    const want = (location.hash || '').slice(1);
    if (SCHEMES[want]) cur = want;
    $('ps-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; cur = b.dataset.k; history.replaceState(null, '', '#' + cur); show(); });
    $('ps-form').addEventListener('input', (e) => { const f = e.target.dataset.f; if (!f) return; vals[cur][f] = e.target.value; calc(); });
    $('ps-year').textContent = `${R.year} 年（民國 ${R.year - 1911} 年）`;
    show();
  });
})();
