// 財經日報 前端邏輯
// 每 60 秒更新一次：四大指數、即時匯率（來自 Supabase 的 market-data 服務，代抓 Yahoo Finance）、財經頭條。
// market-data 抓不到匯率時，自動改用 open.er-api.com（每日更新一次）當備援。

const REFRESH_MS = 60 * 1000; // 60 秒

// ?story=1：IG 限時動態版面（9:16，內容收在安全區），每日截圖用
if (new URLSearchParams(location.search).has("story")) document.documentElement.classList.add("story");

// 行情服務（四大指數 + 台幣匯率），公開資料、不需登入
const MARKET_URL = "https://kocyedkngpxckixtudku.supabase.co/functions/v1/market-data";

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

function setTodayDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  document.getElementById("today-date").textContent = `${y}.${m}.${d} News`;
}

// ---------------- 匯率 ----------------
function showRates(data) {
  document.querySelectorAll("#rates-grid .card").forEach((card) => {
    const valueEl = card.querySelector(".card-value");
    if (data[card.dataset.key] !== undefined) valueEl.textContent = data[card.dataset.key];
  });
}

// 備援：open.er-api.com（每日更新）
async function refreshRatesFallback() {
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
      if (usdToCode) data[label] = round3(usdToTwd / usdToCode);
    });
    showRates(data);
  } catch (err) {
    console.error("匯率更新失敗", err);
  }
}

// ---------------- 四大指數 ----------------
const fmtPrice = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function showIndices(indices) {
  (indices || []).forEach((q) => {
    const card = document.querySelector(`#indices-grid .card[data-key="${q.key}"]`);
    if (!card) return;
    if (q.error || typeof q.price !== "number") return; // 抓不到就保留上一次的數字

    card.querySelector(".card-value").textContent = fmtPrice(q.price);
    const changeEl = card.querySelector(".card-change");
    const pctEl = card.querySelector(".card-pct");
    card.classList.remove("is-up", "is-down");
    if (typeof q.change === "number") {
      const sign = q.change > 0 ? "+" : q.change < 0 ? "−" : "";
      changeEl.textContent = `${sign}${fmtPrice(Math.abs(q.change))}`;
      pctEl.textContent = typeof q.changePct === "number" ? `(${sign}${Math.abs(q.changePct).toFixed(2)}%)` : "";
      if (q.change > 0) card.classList.add("is-up");
      if (q.change < 0) card.classList.add("is-down");
    } else {
      changeEl.textContent = "";
      pctEl.textContent = "";
    }
  });
}

// 指數與匯率一起向 market-data 服務要
async function refreshMarket() {
  try {
    const res = await fetch(MARKET_URL);
    const data = await res.json();
    showIndices(data.indices);

    const fx = data.fx || {};
    const rates = {};
    Object.entries(RATE_SYMBOLS).forEach(([label, code]) => {
      if (typeof fx[code] === "number") rates[label] = round3(fx[code]);
    });
    if (Object.keys(rates).length === Object.keys(RATE_SYMBOLS).length) showRates(rates);
    else await refreshRatesFallback();
  } catch (err) {
    console.error("行情更新失敗", err);
    await refreshRatesFallback();
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
    fitHeadlines();
  } catch (err) {
    console.error("新聞更新失敗", err);
    list.innerHTML = '<li class="news-item skeleton">目前無法取得新聞，稍後再試</li>';
  }
}

// 標題太長時先把字縮小一點（最多縮到 78%）讓整行顯示；真的放不下才用「…」
function fitHeadlines() {
  document.querySelectorAll(".news-item a").forEach((a) => {
    a.style.fontSize = "";
    const base = parseFloat(getComputedStyle(a).fontSize);
    let size = base;
    while (a.scrollWidth > a.clientWidth && size > base * 0.78) {
      size -= 0.5;
      a.style.fontSize = `${size}px`;
    }
  });
}
let fitTimer;
window.addEventListener("resize", () => {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(fitHeadlines, 150);
});
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitHeadlines);

// ---------------- 啟動 ----------------
setTodayDate();
refreshMarket();
refreshNews();
setInterval(refreshMarket, REFRESH_MS);
setInterval(refreshNews, REFRESH_MS);
