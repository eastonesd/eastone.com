// ============================================================
// 客戶資料 / 保單代號 —— 雲端資料庫（Supabase）版
// 取代原本存在瀏覽器裡的 IndexedDB。函式名稱、參數、回傳格式都跟舊版相同，
// 所以 script.js 不需要跟著改。
// 每個人只看得到自己建立的客戶（由資料庫的 Row Level Security 保證）；
// 保單代號全公司共用。
// 需要先載入 ../shared/supabase-client.js（提供 sb、sbThrow）。
// ============================================================

const PAGE_SIZE = 1000; // Supabase 單次最多回傳 1000 筆，超過要分頁抓

// 分頁把整張表抓完
async function fetchAllRows(table, columns, action) {
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + PAGE_SIZE - 1);
    sbThrow(error, action);
    all.push(...data);
    if (data.length < PAGE_SIZE) return all;
  }
}

// 分批寫入（避免一次送太大包）
async function upsertInChunks(table, rows, onConflict, action) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    sbThrow(error, action);
  }
}

function nowStamp() {
  return new Date().toISOString().slice(0, 19);
}

// ---------- 保單代號（insurance_codes，全公司共用） ----------

// 預設代號已經由 schema.sql 寫進資料庫；這裡只是保險起見，萬一資料表是空的才補上
async function seedInsuranceCodesIfEmpty() {
  const { count, error } = await sb.from('insurance_codes').select('code', { count: 'exact', head: true });
  sbThrow(error, '讀取保單代號');
  if (count > 0) return;
  const rows = Object.entries(INSURANCE_CODES_SEED).map(([code, name]) => ({ code: code.toUpperCase(), name }));
  const { error: e2 } = await sb.from('insurance_codes').upsert(rows, { onConflict: 'code', ignoreDuplicates: true });
  sbThrow(e2, '建立預設保單代號');
}

async function codeList() {
  const rows = await fetchAllRows('insurance_codes', 'code,name', '讀取保單代號');
  rows.sort((a, b) => (a.code < b.code ? -1 : 1));
  const map = {};
  rows.forEach((r) => { map[r.code] = r.name; });
  return map;
}

async function codeAdd(code, name) {
  const { error } = await sb.from('insurance_codes').upsert({ code, name }, { onConflict: 'code' });
  sbThrow(error, '儲存保單代號');
}

async function codeDelete(code) {
  const { error } = await sb.from('insurance_codes').delete().eq('code', code);
  sbThrow(error, '刪除保單代號');
}

// ---------- 客戶（clients，含內嵌的 policies 陣列） ----------
// 資料表結構：owner（建立者，自動帶入）、id（客戶ID）、data（整筆客戶資料 JSON）

async function clientList() {
  const rows = await fetchAllRows('clients', 'data', '讀取客戶列表');
  return rows
    .map((r) => r.data)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

async function clientGet(id) {
  const { data, error } = await sb.from('clients')
    .select('data')
    .eq('id', (id || '').toUpperCase())
    .maybeSingle();
  sbThrow(error, '讀取客戶資料');
  return data ? data.data : null;
}

// 新增／更新共用：把表單送來的 payload 整理成要存的客戶資料
function buildClientRecord(payload) {
  let zodiac = null, actual_age = null, insurance_age = null;
  if (payload.birthday) {
    const [y, m, d] = payload.birthday.split('-').map(Number);
    zodiac = getZodiac(m, d);
    actual_age = calcActualAge(y, m, d);
    insurance_age = calcInsuranceAge(y, m, d);
  }
  return {
    name: (payload.name || '').trim(),
    gender: payload.gender || '',
    birthday: payload.birthday || null,
    zodiac, actual_age, insurance_age,
    email_local: payload.email_local || '',
    email_domain: payload.email_domain || '',
    phone: payload.phone || '',
    zip_code: payload.zip_code || '',
    city: payload.city || '',
    district: payload.district || '',
    address_detail: payload.address_detail || '',
    policies: (payload.policies || []).map((p) => ({
      policy_no: p.policy_no || '',
      main_code: (p.main_code || '').toUpperCase(),
      main_name: p.main_name || '',
      currency: p.currency || 'TWD',
      total_premium: p.total_premium || 0,
    })),
  };
}

async function clientAdd(payload) {
  const id = (payload.id || '').trim().toUpperCase();
  const name = (payload.name || '').trim();
  if (!id || !name) throw new Error('客戶ID與姓名為必填');

  const existing = await clientGet(id);
  if (existing) throw new Error(`客戶ID「${id}」已存在`);

  const now = nowStamp();
  const record = { id, ...buildClientRecord(payload), created_at: now, updated_at: now };

  const { error } = await sb.from('clients').insert({ id, data: record });
  if (error && error.code === '23505') throw new Error(`客戶ID「${id}」已存在`);
  sbThrow(error, '建檔');
  return record;
}

// 更新既有客戶（供「編輯資料」功能使用；客戶ID視為不可變的主鍵，不會被改掉）
async function clientUpdate(id, payload) {
  const key = (id || '').trim().toUpperCase();
  const existing = await clientGet(key);
  if (!existing) throw new Error('查無此客戶');
  if (!(payload.name || '').trim()) throw new Error('姓名為必填');

  const record = { ...existing, ...buildClientRecord(payload), id: key, updated_at: nowStamp() };

  const { error } = await sb.from('clients')
    .update({ data: record, updated_at: new Date().toISOString() })
    .eq('id', key);
  sbThrow(error, '更新客戶資料');
  return record;
}

async function clientDelete(id) {
  const { error } = await sb.from('clients').delete().eq('id', (id || '').toUpperCase());
  sbThrow(error, '刪除客戶');
}

// 匯入客戶備份：整批寫入（同客戶ID的舊資料會被覆蓋）。
// 舊版本機系統匯出的 JSON 也能直接匯入，資料會歸到目前登入的人名下。
async function clientImportAll(records) {
  const rows = (records || [])
    .filter((r) => r && r.id)
    .map((r) => {
      const id = String(r.id).trim().toUpperCase();
      return { id, data: { ...r, id }, updated_at: new Date().toISOString() };
    });
  await upsertInChunks('clients', rows, 'owner,id', '匯入客戶資料');
  return rows.length;
}

// 匯入保單代號備份
async function codeImportAll(codesMap) {
  const rows = Object.entries(codesMap || {}).map(([code, name]) => ({ code, name }));
  await upsertInChunks('insurance_codes', rows, 'code', '匯入保單代號');
}

// ============================================================
// 星座 / 實際年齡 / 保險年齡（原本 Flask app.py 的計算邏輯，原樣移植成 JS）
// ============================================================

function getZodiac(month, day) {
  const boundaries = [
    [1, 20, '水瓶座'], [2, 19, '雙魚座'], [3, 21, '牡羊座'], [4, 20, '金牛座'],
    [5, 21, '雙子座'], [6, 22, '巨蟹座'], [7, 23, '獅子座'], [8, 23, '處女座'],
    [9, 23, '天秤座'], [10, 24, '天蠍座'], [11, 23, '射手座'], [12, 22, '摩羯座'],
  ];
  let current = '摩羯座';
  for (const [m, d, name] of boundaries) {
    if (month > m || (month === m && day >= d)) current = name;
  }
  return current;
}

function calcActualAge(y, m, d, today) {
  today = today || new Date();
  let age = today.getFullYear() - y;
  const beforeBirthdayThisYear =
    (today.getMonth() + 1 < m) || (today.getMonth() + 1 === m && today.getDate() < d);
  if (beforeBirthdayThisYear) age -= 1;
  return age;
}

function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function safeDate(year, month, day) {
  if (month === 2 && day === 29 && !isLeapYear(year)) day = 28;
  return new Date(year, month - 1, day);
}

// 保險年齡：以最近一次生日為基準，超過約半年（183天）則實際年齡 +1
function calcInsuranceAge(y, m, d, todayDate) {
  const today = todayDate || new Date();
  const actualAge = calcActualAge(y, m, d, today);

  let lastBirthday = safeDate(today.getFullYear(), m, d);
  if (lastBirthday > today) {
    lastBirthday = safeDate(today.getFullYear() - 1, m, d);
  }
  const daysSince = Math.floor((today - lastBirthday) / 86400000);
  if (daysSince > 182) return actualAge + 1;
  return actualAge;
}
