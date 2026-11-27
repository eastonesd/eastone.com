// ============================================================
// 資產文件 AI 判讀：權狀、登記謄本、房屋稅單、地價稅單
// 呼叫者：clients/finance.html（業務員登入），帶使用者 JWT
// body: { doc_id }  → 只讀得到自己上傳的文件（owner 檢查）
// 維護：帶 x-cron-token 可判讀任何一份（除錯用）
// 回傳: { extracted }，同時寫回 fin_documents.extracted
// Secrets：ANTHROPIC_API_KEY；選填 KB_MODEL
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
function adminClient() {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  const key = keys ? JSON.parse(keys)["default"] : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false } });
}
const MODEL = () => Deno.env.get("KB_MODEL") || "claude-sonnet-5-5";

const share = () => ({ type: "object", description: "權利範圍，例 10000分之123 → num 123, den 10000；全部 → 1/1；讀不到就 0/0", properties: { num: { type: "number" }, den: { type: "number" } }, required: ["num", "den"] });
const TOOL = {
  name: "save_document",
  description: "把台灣不動產相關文件的內容整理成結構化資料",
  input_schema: {
    type: "object",
    properties: {
      doc_type: { type: "string", enum: ["land_deed", "bldg_deed", "land_transcript", "bldg_transcript", "house_tax", "land_tax", "other"], description: "土地所有權狀、建物所有權狀、土地登記謄本、建物登記謄本、房屋稅單、地價稅單、其他" },
      owner_name: { type: "string", description: "所有權人／納稅義務人姓名" },
      cert_no: { type: "string", description: "權狀字號或稅單編號" },
      register_date: { type: "string", description: "登記日期，西元 YYYY-MM-DD；民國請換算" },
      register_reason: { type: "string", description: "登記原因，例 買賣、繼承、贈與、第一次登記" },
      address: { type: "string", description: "建物門牌或坐落" },
      land: { type: "array", description: "每一筆土地", items: { type: "object", properties: {
        district: { type: "string", description: "縣市＋鄉鎮市區" },
        section: { type: "string", description: "地段（含小段）" },
        lot_no: { type: "string", description: "地號" },
        area_m2: { type: "number", description: "面積（平方公尺）" },
        share: share(),
        announced_value: { type: "number", description: "當期公告土地現值（元／平方公尺）；文件上沒有就 0" },
        announced_date: { type: "string", description: "公告土地現值的年月，例 2026-01" },
        declared_price: { type: "number", description: "申報地價（元／平方公尺）；沒有就 0" },
      }, required: ["district", "section", "lot_no", "area_m2", "share", "announced_value", "announced_date", "declared_price"] } },
      building: { type: "object", description: "建物（沒有就各欄空白／0）", properties: {
        district: { type: "string" }, section: { type: "string" }, bldg_no: { type: "string", description: "建號" },
        main_area_m2: { type: "number", description: "主建物面積" }, annex_area_m2: { type: "number", description: "附屬建物面積合計" },
        common_area_m2: { type: "number", description: "共有部分持分面積合計" }, total_area_m2: { type: "number", description: "總面積" },
        share: share(), use: { type: "string", description: "主要用途" }, floors: { type: "string", description: "層次／總樓層" }, completed: { type: "string", description: "建築完成日期 YYYY-MM-DD" },
      }, required: ["bldg_no", "total_area_m2", "share"] },
      house_tax: { type: "object", description: "房屋稅單（沒有就 0）", properties: { year: { type: "string" }, taxable_value: { type: "number", description: "課稅現值（元）" }, tax: { type: "number", description: "應納稅額" }, owner_share: { type: "string", description: "稅單上的持分" } }, required: ["taxable_value"] },
      land_tax: { type: "object", description: "地價稅單（沒有就 0）", properties: { year: { type: "string" }, assessed_value: { type: "number", description: "課稅地價總額" }, tax: { type: "number" } }, required: ["assessed_value"] },
      summary: { type: "string", description: "一兩句白話說明這份文件是什麼、重點數字" },
      warnings: { type: "array", items: { type: "string" }, description: "看不清楚、被遮蔽或需要人工確認的地方" },
    },
    required: ["doc_type", "owner_name", "cert_no", "register_date", "register_reason", "address", "land", "summary", "warnings"],
  },
};
const PROMPT = `你是台灣地政士的助理，請閱讀這份文件（可能是土地／建物所有權狀、登記謄本、房屋稅單或地價稅單），用 save_document 工具整理。
規則：
1. 只照文件上寫的填，不要推測或自行計算；看不清楚的欄位填空字串或 0，並寫進 warnings。
2. 面積一律平方公尺；權利範圍拆成分子分母（全部＝1/1）。
3. 民國日期換算成西元 YYYY-MM-DD。
4. 金額為新臺幣元，去掉逗號。
5. summary、warnings 用繁體中文、台灣用語。
請直接呼叫 save_document 工具，不要回覆其他文字。`;

function b64(buf: Uint8Array) {
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const db = adminClient();
  let uid = "";
  const cron = req.headers.get("x-cron-token");
  if (cron !== null) {
    const { data: ok } = await db.rpc("check_reminder_token", { t: cron });
    if (!ok) return json({ error: "unauthorized" }, 401);
    uid = "*";
  } else {
    const auth = req.headers.get("authorization") ?? "";
    const { data: u } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
    if (!u?.user) return json({ error: "請先登入" }, 401);
    uid = u.user.id;
  }
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ error: "伺服器尚未設定 ANTHROPIC_API_KEY" }, 503);
  const body = await req.json().catch(() => ({}));
  const { data: doc } = await db.from("fin_documents").select("*").eq("id", String(body.doc_id || "")).maybeSingle();
  if (!doc || (uid !== "*" && doc.owner !== uid)) return json({ error: "找不到這份文件" }, 404);
  const { data: file, error: dlErr } = await db.storage.from("fin-docs").download(doc.file_path);
  if (dlErr || !file) return json({ error: "下載文件失敗" }, 500);
  const buf = new Uint8Array(await file.arrayBuffer());
  const isPdf = doc.mime === "application/pdf" || String.fromCharCode(...buf.slice(0, 4)) === "%PDF";
  const mime = isPdf ? "application/pdf" : (["image/png", "image/webp", "image/gif"].includes(doc.mime) ? doc.mime : "image/jpeg");
  if (!isPdf && buf.length > 5 * 1024 * 1024) return json({ error: "圖片超過 5MB，請重新上傳（系統會自動縮小）" }, 400);
  const part = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64(buf) } }
    : { type: "image", source: { type: "base64", media_type: mime, data: b64(buf) } };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "", "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL(), max_tokens: 4000, tools: [TOOL], tool_choice: { type: "auto" },
      messages: [{ role: "user", content: [part, { type: "text", text: PROMPT }] }] }),
    signal: AbortSignal.timeout(120_000),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("claude", res.status, JSON.stringify(out).slice(0, 500));
    return json({ error: `Claude API ${res.status}: ${out?.error?.message ?? ""}` }, 502);
  }
  const use = (out.content ?? []).find((c: { type: string }) => c.type === "tool_use");
  if (!use) { console.error("no tool_use", JSON.stringify(out).slice(0, 500)); return json({ error: "AI 沒有回傳結構化結果" }, 502); }
  const extracted = { ...use.input, model: MODEL() };
  await db.from("fin_documents").update({ extracted, kind: use.input.doc_type || doc.kind, read_at: new Date().toISOString() }).eq("id", doc.id);
  return json({ extracted });
});
