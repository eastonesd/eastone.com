// ============================================================
// 每日財經日報截圖（由 GitHub Actions 每天早上 08:35 台北時間執行）
// 打開線上的財經日報頁面，等匯率、頭條、指數都載入後，拍一張 9:16 滿版截圖（1080×1920，IG 限時動態尺寸）。
// 輸出：<outDir>/market-YYYY-MM-DD.jpg（原圖）與 market-YYYY-MM-DD-preview.jpg（LINE 預覽用小圖）
// 用法：node tools/snapshot.mjs <outDir>   （可用 SITE_URL 環境變數改網址）
// ============================================================
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const outDir = process.argv[2] || "out";
const SITE_URL = process.env.SITE_URL || "https://eastonesd.github.io/eastone.com/market/index.html";

// 台北時間的今天（YYYY-MM-DD）
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  const shoot = async (scale, file, quality) => {
    const ctx = await browser.newContext({
      viewport: { width: 360, height: 640 },   // 9:16
      deviceScaleFactor: scale,
      timezoneId: "Asia/Taipei",
      locale: "zh-TW",
    });
    const page = await ctx.newPage();
    await page.goto(`${SITE_URL}?snapshot=${Date.now()}`, { waitUntil: "networkidle", timeout: 60_000 });

    // 等資料載入（最多 45 秒；某一區抓不到也照樣拍，不讓整張圖開天窗）
    const ready = await page
      .waitForFunction(() => {
        const idx = [...document.querySelectorAll("#indices-grid .card-value")].every((e) => e.textContent.trim() !== "--");
        const fx = [...document.querySelectorAll("#rates-grid .card-value")].every((e) => e.textContent.trim() !== "--");
        const news = document.querySelectorAll(".news-item a").length > 0;
        return idx && fx && news;
      }, null, { timeout: 45_000 })
      .then(() => true)
      .catch(() => false);
    if (!ready) console.warn("警告：部分資料 45 秒內沒有載入完成，仍然截圖");

    await page.evaluate(() => document.fonts && document.fonts.ready);
    // 截圖不需要「← 返回」
    await page.addStyleTag({ content: ".home-link{display:none!important}" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${outDir}/${file}`, type: "jpeg", quality });
    await ctx.close();
    return ready;
  };

  const ok = await shoot(3, `market-${today}.jpg`, 90);         // 1080×1920，IG 限時動態／LINE 原圖（上限 10MB）
  await shoot(1, `market-${today}-preview.jpg`, 80);             // 360×640，LINE 預覽圖（上限 1MB）
  console.log(`done: ${today} (data complete: ${ok})`);
} finally {
  await browser.close();
}
