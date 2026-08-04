// ============================================================
// IndexedDB 本機資料庫（取代原本 Flask + SQLite 的 /api/policies）
// 每台裝置各自獨立一份資料，直接存在瀏覽器的 IndexedDB 裡。
// ============================================================

const DB_NAME = 'policiesDB';
const DB_VERSION = 1;
const STORE = 'policies';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// 新增一筆保單（payload 就是原本 buildPayload() 產生的物件）
async function dbAdd(payload) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const rec = { created_at: new Date().toISOString().slice(0, 19), ...payload };
    const req = tx.objectStore(STORE).add(rec);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// 回傳所有保單，依 id 新到舊排序 — 對應原本 GET /api/policies
async function dbGetAll() {
  const db = await openDB();
  const rows = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return rows.slice().sort((a, b) => b.id - a.id);
}

// 取單筆 — 對應原本 GET /api/policies/<id>
async function dbGet(id) {
  const db = await openDB();
  const row = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(Number(id));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return row || null;
}

// 刪除一筆 — 對應原本 DELETE /api/policies/<id>
async function dbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(Number(id));
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
