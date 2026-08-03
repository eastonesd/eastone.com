// ============================================================
// IndexedDB 本機資料庫（取代原本 Flask + SQLite 的 /api/clients、/api/insurance-codes）
// 每台裝置各自獨立一份資料。
// ============================================================

const CDB_NAME = 'clientsDB';
const CDB_VERSION = 1;

function openClientsDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CDB_NAME, CDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('clients')) {
        db.createObjectStore('clients', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('insurance_codes')) {
        db.createObjectStore('insurance_codes', { keyPath: 'code' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------- 保單代號（insurance_codes） ----------

// 第一次使用時，把 INSURANCE_CODES_SEED（來自 data.js）灌進 IndexedDB
async function seedInsuranceCodesIfEmpty() {
  const db = await openClientsDB();
  const count = await new Promise((resolve, reject) => {
    const req = db.transaction('insurance_codes', 'readonly').objectStore('insurance_codes').count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (count > 0) return;
  await new Promise((resolve, reject) => {
    const tx = db.transaction('insurance_codes', 'readwrite');
    const store = tx.objectStore('insurance_codes');
    Object.entries(INSURANCE_CODES_SEED).forEach(([code, name]) => {
      store.put({ code: code.toUpperCase(), name });
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function codeList() {
  const db = await openClientsDB();
  const rows = await new Promise((resolve, reject) => {
    const req = db.transaction('insurance_codes', 'readonly').objectStore('insurance_codes').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  rows.sort((a, b) => (a.code < b.code ? -1 : 1));
  const map = {};
  rows.forEach((r) => { map[r.code] = r.name; });
  return map;
}

async function codeAdd(code, name) {
  const db = await openClientsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('insurance_codes', 'readwrite');
    tx.objectStore('insurance_codes').put({ code, name });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function codeDelete(code) {
  const db = await openClientsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('insurance_codes', 'readwrite');
    tx.objectStore('insurance_codes').delete(code);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- 客戶（clients，含內嵌的 policies 陣列） ----------

async function clientList() {
  const db = await openClientsDB();
  const rows = await new Promise((resolve, reject) => {
    const req = db.transaction('clients', 'readonly').objectStore('clients').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

async function clientGet(id) {
  const db = await openClientsDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('clients', 'readonly').objectStore('clients').get((id || '').toUpperCase());
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function clientAdd(payload) {
  const id = (payload.id || '').trim().toUpperCase();
  const name = (payload.name || '').trim();
  if (!id || !name) throw new Error('客戶ID與姓名為必填');

  const existing = await clientGet(id);
  if (existing) throw new Error(`客戶ID「${id}」已存在`);

  let zodiac = null, actual_age = null, insurance_age = null;
  if (payload.birthday) {
    const [y, m, d] = payload.birthday.split('-').map(Number);
    zodiac = getZodiac(m, d);
    actual_age = calcActualAge(y, m, d);
    insurance_age = calcInsuranceAge(y, m, d);
  }

  const now = new Date().toISOString().slice(0, 19);
  const record = {
    id, name,
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
    created_at: now,
    updated_at: now,
  };

  const db = await openClientsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('clients', 'readwrite');
    tx.objectStore('clients').add(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
  });
}

async function clientDelete(id) {
  const db = await openClientsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('clients', 'readwrite');
    tx.objectStore('clients').delete((id || '').toUpperCase());
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
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
