// ============================================================
// 舊資料搬家：舊版系統把資料存在這台裝置瀏覽器的 IndexedDB 裡。
// 更新成雲端版後，那些資料還在原地，只是新版不再讀它。
// 這裡會在登入後檢查，如果這台裝置還有舊資料，就詢問要不要搬到雲端。
// 搬完後舊資料仍保留在本機，不會刪除。
// ============================================================

// 讀出舊版 IndexedDB 某個資料表的全部內容；不存在就回傳空陣列
async function readLocalStore(dbName, storeName) {
  if (!window.indexedDB) return [];
  if (indexedDB.databases) {
    try {
      const list = await indexedDB.databases();
      if (!list.some((d) => d.name === dbName)) return [];
    } catch (e) { /* 部分瀏覽器不支援，改用下面直接開啟 */ }
  }
  return new Promise((resolve) => {
    const req = indexedDB.open(dbName);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(storeName)) { db.close(); resolve([]); return; }
      const r = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      r.onsuccess = () => { db.close(); resolve(r.result || []); };
      r.onerror = () => { db.close(); resolve([]); };
    };
    req.onerror = () => resolve([]);
  });
}

async function offerLocalMigration({ dbName, storeName, label, user, importFn, onDone }) {
  const flag = `eastone-migrated:${dbName}:${user.email}`;
  try { if (localStorage.getItem(flag)) return; } catch (e) { /* ignore */ }

  const rows = await readLocalStore(dbName, storeName);
  if (!rows.length) return;

  const yes = confirm(
    `這台裝置上還有 ${rows.length} 筆舊版系統存在本機的${label}。\n\n` +
    `要把它們搬到雲端資料庫嗎？資料會歸到目前登入的帳號（${user.email}）名下。\n\n` +
    `按「取消」這次先不搬，下次開啟還會再問。`
  );
  if (!yes) return;

  try {
    const count = await importFn(rows);
    try { localStorage.setItem(flag, '1'); } catch (e) { /* ignore */ }
    alert(`已把 ${count} 筆${label}搬到雲端。舊的本機資料仍保留在這台裝置上，不會刪除。`);
    if (onDone) await onDone();
  } catch (err) {
    alert(`搬移失敗：${err && err.message ? err.message : '未知錯誤'}\n下次開啟頁面會再詢問一次。`);
  }
}
