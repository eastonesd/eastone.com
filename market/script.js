// 財經日報 前端邏輯（純前端版）
// 每 60 秒直接向外部服務拉取一次 匯率 / 新聞 並更新畫面
// 指數（道瓊/標普/那指/台指）目前先不做 —— Yahoo Finance 不開放瀏覽器跨網域讀取，
// 之後如果要做，需要另外接一個有開放 CORS 的股票行情 API 或自架小代理伺服器。

const REFRESH_MS = 60 * 1000; // 60 秒

// 匯率目標幣別對應（1 單位外幣可兌換多少台幣 TWD）
const RATE_SYMBOLS = {
  "美元": "USD",
  "澳幣": "AUD",
  "日幣": "JPY",
  "人民幣": "CNY",
};

// Google 新聞 RSS（財經關鍵字，zh-TW）
const NEWS_RSS_URL =
  "https://news.google.com/rss/search?q=%E8%B2%A1%E7%B6%93&hl=zh-TW&gl=TW&ceid=TW:zh-Hant";

// rss2json：把 RSS 轉成有開放 CORS 的 JSON，讓瀏覽器可以直接讀（Google RSS 本身不開放 CORS）
// 免費方案有基本流量限制；如果同時使用的人數多、常常抓不到新聞，
// 可以到 https://rss2json.com 免費註冊一組 API key，把下面 RSS2JSON_API_KEY 填上即可提高額度。
const RSS2JSON_ENDPOINT = "https://api.rss2json.com/v1/api.json";
const RSS2JSON_API_KEY = ""; // 選填

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function formatTime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function setTodayDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  document.getElementById("today-date").textContent = `${y}.${m}.${d} News`;
}

// ---------------- 匯率 ----------------
async function refreshRates() {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const payload = await res.json();
    if (payload.result !== "success") throw new Error("匯率 API 回傳非成功狀態");

    const ratesUsdBase = payload.rates || {};
    const usdToTwd = ratesUsdBase["TWD"];
    if (!usdToTwd) throw new Error("回傳資料中找不到 TWD 匯率");

    const data = {};
    Object.entries(RATE_SYMBOLS).forEach(([label, code]) => {
      if (code === "USD") {
        data[label] = round3(usdToTwd);
        return;
      }
      const usdToCode = ratesUsdBase[code];
      if (usdToCode) {
        data[label] = round3(usdToTwd / usdToCode);
      }
    });

    document.querySelectorAll("#rates-grid .card").forEach((card) => {
      const key = card.dataset.key;
      const valueEl = card.querySelector(".card-value");
      if (data[key] !== undefined) valueEl.textContent = data[key];
    });
    document.getElementById("rates-updated").textContent = `(更新於 ${formatTime(new Date())})`;
  } catch (err) {
    console.error("匯率更新失敗", err);
  }
}

// ---------------- 新聞 ----------------
async function refreshNews() {
  const list = document.getElementById("news-list");
  try {
    const url =
      `${RSS2JSON_ENDPOINT}?rss_url=${encodeURIComponent(NEWS_RSS_URL)}` +
      (RSS2JSON_API_KEY ? `&api_key=${encodeURIComponent(RSS2JSON_API_KEY)}` : "");
    const res = await fetch(url);
    const json = await res.json();
    if (json.status !== "ok") throw new Error("新聞來源回傳失敗");

    const items = (json.items || []).slice(0, 5).map((item) => ({
      title: (item.title || "").trim(),
      link: item.link || "#",
    }));

    if (items.length === 0) {
      list.innerHTML = '<li class="news-item skeleton">目前無法取得新聞，稍後再試</li>';
      return;
    }

    list.innerHTML = items
      .map(
        (item) => `
        <li class="news-item">
          <a href="${item.link}" target="_blank" rel="noopener noreferrer">${item.title}</a>
        </li>`
      )
      .join("");

    document.getElementById("news-updated").textContent = `(更新於 ${formatTime(new Date())})`;
  } catch (err) {
    console.error("新聞更新失敗", err);
    list.innerHTML = '<li class="news-item skeleton">目前無法取得新聞，稍後再試</li>';
  }
}

// ---------------- 啟動 ----------------
function refreshAll() {
  refreshRates();
  refreshNews();
}

setTodayDate();
refreshAll();
setInterval(refreshRates, REFRESH_MS);
setInterval(refreshNews, REFRESH_MS);
