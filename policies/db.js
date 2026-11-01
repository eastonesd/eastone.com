// ============================================================
// 產險保單 —— 雲端資料庫（Supabase）版
// 取代原本存在瀏覽器裡的 IndexedDB。函式名稱、參數、回傳格式都跟舊版相同，
// 所以 script.js 不需要跟著改。
// 每個人只看得到自己建立的保單（由資料庫的 Row Level Security 保證）。
// 資料表結構：owner（建立者，自動帶入）、id（編號）、data（整筆保單資料 JSON）
// 需要先載入 ../shared/supabase-client.js（提供 sb、sbThrow）。
// ============================================================

const PAGE_SIZE = 1000; // Supabase 單次最多回傳 1000 筆，超過要分頁抓

function nowStamp() {
  return new Date().toISOString().slice(0, 19);
}

// 資料庫的一列 → 舊系統的保單物件格式（id 放回物件裡）
function rowToRecord(row) {
  return { ...row.data, id: Number(row.id) };
}

// 存進 data 欄位前把 id 拿掉（id 由資料表自己的欄位管理）
function stripId(rec) {
  const { id, ...rest } = rec;
  return rest;
}

// 新增一筆保單（payload 就是原本 buildPayload() 產生的物件），回傳新編號
async function dbAdd(payload) {
  const rec = { created_at: nowStamp(), ...stripId(payload) };
  const { data, error } = await sb.from('policies').insert({ data: rec }).select('id').single();
  sbThrow(error, '建檔');
  return Number(data.id);
}

// 回傳自己所有的保單，依編號新到舊排序
async function dbGetAll() {
  const all = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await sb.from('policies').select('id,data')
      .order('id', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    sbThrow(error, '讀取保單列表');
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return all.map(rowToRecord);
}

// 取單筆
async function dbGet(id) {
  const { data, error } = await sb.from('policies').select('id,data').eq('id', Number(id)).maybeSingle();
  sbThrow(error, '讀取保單');
  return data ? rowToRecord(data) : null;
}

async function dbUpdate(id, payload) {
  const existing = await dbGet(id);
  if (!existing) throw new Error('找不到這筆資料');
  const rec = { ...stripId(existing), ...stripId(payload), updated_at: nowStamp() };
  const { error } = await sb.from('policies')
    .update({ data: rec, updated_at: new Date().toISOString() })
    .eq('id', Number(id));
  sbThrow(error, '更新保單');
  return Number(id);
}

// 刪除一筆
async function dbDelete(id) {
  const { error } = await sb.from('policies').delete().eq('id', Number(id));
  sbThrow(error, '刪除保單');
  return true;
}

// 匯入備份：有編號的用編號覆蓋（同編號的舊資料會被取代），沒編號的當新資料新增。
// 舊版本機系統匯出的 JSON 也能直接匯入，資料會歸到目前登入的人名下。
async function dbImportAll(records) {
  const valid = (records || []).filter((r) => r && typeof r === 'object');
  const withId = valid
    .filter((r) => Number.isFinite(Number(r.id)) && r.id !== null && r.id !== '')
    .map((r) => ({ id: Number(r.id), data: stripId(r), updated_at: new Date().toISOString() }));
  const withoutId = valid
    .filter((r) => !(Number.isFinite(Number(r.id)) && r.id !== null && r.id !== ''))
    .map((r) => ({ data: stripId(r) }));

  for (let i = 0; i < withId.length; i += 500) {
    const { error } = await sb.from('policies').upsert(withId.slice(i, i + 500), { onConflict: 'owner,id' });
    sbThrow(error, '匯入保單');
  }
  for (let i = 0; i < withoutId.length; i += 500) {
    const { error } = await sb.from('policies').insert(withoutId.slice(i, i + 500));
    sbThrow(error, '匯入保單');
  }
  return withId.length + withoutId.length;
}
