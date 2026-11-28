// ============================================================
// 保單截圖／文件 AI 判讀：保險公司行動辦公室截圖、保單首頁、保單明細表
// 呼叫者：clients/policy.html、clients/team.html（業務員登入），帶使用者 JWT
// body: { doc_ids: [...] }（同一批可多張，例如一張保單跨兩張截圖）→ 只讀得到自己上傳的文件
// 回傳: { policies, warnings }，同時寫回每份 fin_documents.extracted
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

const ITEM = {
  type: "object",
  properties: {
    code: { type: "string", description: "險種代號（例 XLT、PCC1、HS3）；沒有就空字串" },
    name: { type: "string", description: "險種名稱，照文件寫，去掉多餘空白" },
    sa_text: { type: "string", description: "保險金額欄原文，例「新台幣 2,000,000 元」「新台幣 15.00單位」" },
    sa_value: { type: "number", description: "保險金額的數字（元或單位數）" },
    sa_kind: { type: "string", enum: ["amount", "unit"], description: "amount＝金額（元）；unit＝單位／計劃" },
    start_date: { type: "string", description: "契約始期，西元 YYYY-MM-DD（民國請加 1911）" },
    pay_end_date: { type: "string", description: "繳費期滿日，西元 YYYY-MM-DD；沒有就空字串" },
    cover_end: { type: "string", description: "保障期滿日，西元 YYYY-MM-DD；「終身」就填 lifetime；沒有就空字串" },
    premium: { type: "number", description: "保險費（原幣）；看不到或被截掉就填 0" },
  },
  required: ["code", "name", "sa_text", "sa_value", "sa_kind", "start_date", "pay_end_date", "cover_end", "premium"],
};
const TOOL = {
  name: "save_policies",
  description: "把保險公司保單畫面或文件上的每一張保單整理成結構化資料",
  input_schema: {
    type: "object",
    properties: {
      company: { type: "string", description: "保險公司全名，例 富邦人壽、國泰人壽；看不出來就空字串" },
      policies: { type: "array", items: { type: "object", properties: {
        policy_no: { type: "string", description: "保單號碼，照文件寫（含 -00 之類的尾碼）" },
        company: { type: "string", description: "這張保單的保險公司（跟整份相同可留空）" },
        currency: { type: "string", description: "幣別三碼：TWD、USD、AUD…（新台幣＝TWD）" },
        applicant_name: { type: "string" }, insured_name: { type: "string" },
        pay_mode: { type: "string", description: "年繳、半年繳、季繳、月繳、躉繳；看不到就空字串" },
        status: { type: "string", description: "有效、繳清、停效…；看不到就空字串" },
        main: ITEM,
        riders: { type: "array", items: ITEM },
      }, required: ["policy_no", "currency", "applicant_name", "insured_name", "main", "riders"] } },
      warnings: { type: "array", items: { type: "string" }, description: "被截掉、看不清楚、需要人工確認的地方（例：某張保單保費欄被截掉）" },
    },
    required: ["company", "policies", "warnings"],
  },
};
const PROMPT = `你是台灣保險業務員的助理。以下是同一位客戶的保單畫面截圖或文件（可能有好幾張，同一張保單可能被切在兩張截圖裡，請合併、不要重複）。
請用 save_policies 工具，把每一張保單的主約與附約都整理出來。
規則：
1. 只照畫面上寫的填，不要推測；被截掉、看不清楚的欄位留空或填 0，並寫進 warnings（要寫出是哪一張保單的哪一欄）。
2. 民國日期加 1911 換成西元 YYYY-MM-DD（例 107/03/03 → 2018-03-03）。
3. 保障期滿是「終身」就填 lifetime。
4. 金額去掉逗號與「元」；保險金額是「單位」或「計劃」的，sa_kind 填 unit。
5. 浮水印（例如日期、員工編號、「個資文件，嚴禁外流」）不是保單內容，請忽略。
6. warnings 用繁體中文、台灣用語。
請直接呼叫 save_policies 工具，不要回覆其他文字。`;

function b64(buf: Uint8Array) {
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const db = adminClient();
  const auth = req.headers.get("authorization") ?? "";
  const { data: u } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (!u?.user) return json({ error: "請先登入" }, 401);
  let uid = u.user.id;
  const { data: sa } = await db.from("staff_assistants").select("principal").eq("assistant", uid).maybeSingle();
  if (sa?.principal) uid = sa.principal;
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ error: "伺服器尚未設定 ANTHROPIC_API_KEY" }, 503);
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.doc_ids) ? body.doc_ids.map(String).slice(0, 10) : [];
  if (!ids.length) return json({ error: "沒有要判讀的文件" }, 400);
  const { data: docs } = await db.from("fin_documents").select("*").in("id", ids);
  const mine = (docs || []).filter((d) => d.owner === uid);
  if (mine.length !== ids.length) return json({ error: "找不到文件，或不是您上傳的" }, 404);
  const parts: unknown[] = [];
  let total = 0;
  for (const doc of ids.map((id) => mine.find((d) => d.id === id)!)) {
    const { data: file, error } = await db.storage.from("fin-docs").download(doc.file_path);
    if (error || !file) return json({ error: `下載文件失敗：${doc.file_name || doc.id}` }, 500);
    const buf = new Uint8Array(await file.arrayBuffer());
    total += buf.length;
    if (total > 25 * 1024 * 1024) return json({ error: "一次上傳的檔案太大，請分批判讀" }, 400);
    const isPdf = doc.mime === "application/pdf" || String.fromCharCode(...buf.slice(0, 4)) === "%PDF";
    const mime = isPdf ? "application/pdf" : (["image/png", "image/webp", "image/gif"].includes(doc.mime) ? doc.mime : "image/jpeg");
    if (!isPdf && buf.length > 5 * 1024 * 1024) return json({ error: `圖片超過 5MB：${doc.file_name || ""}` }, 400);
    parts.push(isPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64(buf) } }
      : { type: "image", source: { type: "base64", media_type: mime, data: b64(buf) } });
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "", "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL(), max_tokens: 8000, tools: [TOOL], tool_choice: { type: "auto" },
      messages: [{ role: "user", content: [...parts, { type: "text", text: PROMPT }] }] }),
    signal: AbortSignal.timeout(140_000),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("claude", res.status, JSON.stringify(out).slice(0, 500));
    return json({ error: `Claude API ${res.status}: ${out?.error?.message ?? ""}` }, 502);
  }
  const use = (out.content ?? []).find((c: { type: string }) => c.type === "tool_use");
  if (!use) { console.error("no tool_use", JSON.stringify(out).slice(0, 500)); return json({ error: "AI 沒有回傳結構化結果" }, 502); }
  const result = { ...use.input, model: MODEL() };
  await db.from("fin_documents").update({ extracted: result, kind: "policy", read_at: new Date().toISOString() }).in("id", ids);
  return json(result);
});
