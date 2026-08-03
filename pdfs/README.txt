理賠文件下載中心 — 使用說明
================================

【資料夾結構】
claims-app/
  index.html      ← 網頁主檔案
  manifest.json   ← 讓網頁可被「加到主畫面/安裝」用的設定檔
  pdfs/           ← 請把 USB 裡 20 家壽險公司的 PDF 放進這個資料夾
  icons/          ← 放置 App 圖示（192x192、512x512 PNG）

【第一步：放入 PDF】
把 20 個 PDF 檔案複製進 pdfs/ 資料夾，並改成以下檔名（對應 index.html 內設定）：

  國泰人壽        → cathay.pdf
  富邦人壽        → fubon.pdf
  南山人壽        → nanshan.pdf
  新光人壽        → shinkong.pdf
  台灣人壽        → taiwanlife.pdf
  中國人壽        → chinalife.pdf
  三商美邦人壽    → massmutual.pdf
  全球人壽        → tglife.pdf
  保誠人壽        → prudential.pdf
  遠雄人壽        → farglory.pdf
  元大人壽        → yuanta.pdf
  安聯人壽        → allianz.pdf
  第一金人壽      → firstlife.pdf
  合作金庫人壽    → tacoop.pdf
  台銀人壽        → botlife.pdf
  宏泰人壽        → hontai.pdf
  中華郵政壽險    → postlife.pdf
  康健人壽        → cigna.pdf
  友邦人壽        → aia.pdf
  安達人壽        → chubb.pdf

如果你的 20 家公司名單不同，或想改變檔名，
打開 index.html，搜尋 "companies" 陣列，
修改 name（顯示名稱）與 file（檔名）即可，順序就是畫面上的順序。

【第二步：先在電腦上測試】
直接用瀏覽器（Chrome/Edge）打開 index.html 就能測試，
按下任一家公司的「下載理賠文件」按鈕，確認 PDF 有正確下載。

【關於「iOS + Windows 通用安裝包」】
技術上 iOS 和 Windows 是完全不同的系統，沒有辦法做出「同一個安裝檔」
同時裝在兩邊（這點與 App 的性質有關，不是這個網頁本身的限制）。
比較實際的做法通常是下面兩種，我們可以依你的需求挑一種繼續做：

  方案A：PWA（漸進式網頁應用）
    - 同一份網頁，iOS 用 Safari「加入主畫面」、
      Windows 用 Edge/Chrome「安裝此網站」，
      兩邊都會出現一個像 App 一樣的圖示，離線也能開啟已下載頁面。
    - 優點：一套程式碼、免上架 App Store、免簽署費用。
    - 缺點：iOS 上無法產生傳統的「安裝檔」給別人手動安裝，
      需要使用者自己在 Safari 按「加入主畫面」。

  方案B：Windows 安裝檔（.exe）+ iOS 另外處理
    - 用 Electron 把這份網頁包成 Windows 可雙擊安裝的 .exe。
    - iOS 若要有「安裝檔」的體驗，需要 Mac + Xcode + Apple 開發者
      帳號（年費 US$99），並透過 TestFlight 或企業憑證發佈，
      無法單靠這份網頁直接達成。

目前這個資料夾已經內建 manifest.json，是方案A的基礎，
可以直接測試「加入主畫面 / 安裝」的效果。
