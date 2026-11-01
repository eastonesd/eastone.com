// ============================================================
// Supabase 連線設定（全系統共用）
// URL 和 publishable key 本來就是設計給網頁公開使用的，放在這裡沒問題；
// 真正的資料保護靠資料庫裡的 Row Level Security 規則（見 supabase/schema.sql）。
// ⚠ 絕對不要把 service_role / secret key 放進任何網頁檔案。
// ============================================================

const SUPABASE_URL = 'https://kocyedkngpxckixtudku.supabase.co';
const SUPABASE_KEY = 'sb_publishable_n309GkhFeBRtg7thi9cSdQ_m6MiBpoU';

// supabase-js 的 UMD 版會建立全域變數 supabase，這裡建立連線物件 sb 給其他檔案使用
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// 把 Supabase 回傳的錯誤轉成看得懂的中文訊息後丟出
function sbThrow(error, action) {
  if (!error) return;
  console.error(`[${action}]`, error);
  const msg = String(error.message || '');
  if (/fetch|network|Failed to fetch|NetworkError/i.test(msg)) {
    throw new Error(`${action}失敗：無法連線到資料庫。請確認網路正常；如果系統超過一週沒人使用，可能需要到 Supabase 後台恢復專案。`);
  }
  if (/JWT|token|not authenticated|row-level security/i.test(msg)) {
    throw new Error(`${action}失敗：登入狀態已失效，請重新登入。`);
  }
  throw new Error(`${action}失敗：${msg}`);
}
