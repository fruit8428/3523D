// LINE 聊天室關鍵字回覆（Webhook）：關鍵字判斷、回覆內容、簽章驗證、事件處理。假資料庫、假的 LINE 回覆。
// 執行：deno run --no-check --node-modules-dir=none -A supabase/tests/line_webhook.ts
import { parseAgendaKeyword, agendaReply } from "../functions/line-checkin/calendar.ts";
import { handleWebhook, verifyLineSignature } from "../functions/line-checkin/lib.ts";
const ok = (name: string, cond: boolean) => { console.log((cond ? "✅ " : "❌ ") + name); if (!cond) Deno.exitCode = 1; };
function fake(tables: Record<string, any[]>) {
  return { from(t: string) {
    tables[t] ||= []; const f: any[] = []; let one = "";
    const b: any = {
      select() { return b; }, eq(k: string, v: any) { f.push((r: any) => r[k] === v); return b; }, neq(k: string, v: any) { f.push((r: any) => r[k] !== v); return b; },
      gte(k: string, v: any) { f.push((r: any) => r[k] >= v); return b; }, lte(k: string, v: any) { f.push((r: any) => r[k] <= v); return b; },
      order() { return b; }, limit() { return b; }, maybeSingle() { one = "maybe"; return b; },
      then(res: any) { const d = tables[t].filter((r: any) => f.every((x) => x(r))); res({ data: one ? d[0] || null : d, error: null }); },
    }; return b; } };
}
// 關鍵字
ok("關鍵字：行事曆／行程／今天／明天／本週（全形、空白、問號都容忍）", parseAgendaKeyword("行事曆") === "two" && parseAgendaKeyword(" 行程？") === "two" && parseAgendaKeyword("今天") === "today" && parseAgendaKeyword("明天的行程") === "tomorrow" && parseAgendaKeyword("本周") === "week" && parseAgendaKeyword("ＴＯＤＡＹ") === "today");
ok("不是整句關鍵字不觸發（明天見、今天天氣好、請問行事曆在哪）", parseAgendaKeyword("明天見") === null && parseAgendaKeyword("今天天氣好") === null && parseAgendaKeyword("請問行事曆在哪裡") === null && parseAgendaKeyword("") === null);

const NOW = Date.parse("2026-11-17T21:00:00+08:00");     // 11/17（二）晚上
const ev = (o: any) => ({ status: "confirmed", all_day: false, location: "", address: "", dress_code: "", club_name: "", owner_key: "", ...o });
const T: Record<string, any[]> = {
  line_bindings: [{ line_user_id: "U1", club_name: "松山社", person_key: "楊|Fruit", full_name: "楊富中", nickname: "PP Fruit" }],
  calendar_events: [
    ev({ id: "t1", layer: "club", club_name: "松山社", title: "今天的理事會", start_at: "2026-11-17T11:00:00.000Z", end_at: "2026-11-17T12:00:00.000Z" }),
    ev({ id: "m1", layer: "district", title: "明天地區活動", start_at: "2026-11-18T02:00:00.000Z", end_at: "2026-11-18T04:00:00.000Z", location: "君悅", dress_code: "正式" }),
    ev({ id: "p1", layer: "private", club_name: "松山社", owner_key: "楊|Fruit", title: "我的私人行程", start_at: "2026-11-18T06:00:00.000Z", end_at: "2026-11-18T07:00:00.000Z" }),
    ev({ id: "x1", layer: "private", club_name: "松山社", owner_key: "別人|", title: "別人的私人行程", start_at: "2026-11-18T06:00:00.000Z", end_at: "2026-11-18T07:00:00.000Z" }),
    ev({ id: "x2", layer: "club", club_name: "北區社", title: "別社行程", start_at: "2026-11-18T06:00:00.000Z", end_at: "2026-11-18T07:00:00.000Z" }),
    ev({ id: "w1", layer: "district", title: "五天後的活動", start_at: "2026-11-22T02:00:00.000Z", end_at: "2026-11-22T04:00:00.000Z" }),
    ev({ id: "c1", layer: "district", title: "已取消", status: "cancelled", start_at: "2026-11-18T02:00:00.000Z", end_at: "2026-11-18T04:00:00.000Z" }),
  ],
};
const db = fake(T);
const me = { club: "松山社", key: "楊|Fruit", name: "楊富中", nickname: "PP Fruit" };
const J = (m: any) => JSON.stringify(m);
const two = await agendaReply(db, me, "two", "LIFF-1", NOW);
ok("「行事曆」：今天＋明天，含本社、地區、本人私人；不含別人私人、別社、已取消、五天後", two[0].type === "flex" && ["今天的理事會", "明天地區活動", "我的私人行程"].every((t) => J(two).includes(t)) && !["別人的私人行程", "別社行程", "已取消", "五天後的活動"].some((t) => J(two).includes(t)));
ok("「行事曆」卡片：標題、本人名字與社名、日期分組（今天／明天）、地點服裝、查看詳情連結、提示其他關鍵字", J(two).includes("今天＋明天的行程") && J(two).includes("楊富中 PP Fruit・松山社") && J(two).includes("11/17（二） 今天") && J(two).includes("11/18（三） 明天") && J(two).includes("📍 君悅") && J(two).includes("https://liff.line.me/LIFF-1?p=calendar&ev=m1&d=2026-11-18") && J(two).includes("也可以傳：今天、明天、本週"));
ok("「今天」只有今天", J(await agendaReply(db, me, "today", "LIFF-1", NOW)).includes("今天的理事會") && !J(await agendaReply(db, me, "today", "LIFF-1", NOW)).includes("明天地區活動"));
const wk = await agendaReply(db, me, "week", "LIFF-1", NOW);
ok("「本週」：最近 7 天，含五天後的活動，跳過沒有行程的日子", J(wk).includes("五天後的活動") && J(wk).includes("最近 7 天的行程") && !J(wk).includes("11/19（四）"));
const empty = await agendaReply(fake({ calendar_events: [] }), me, "tomorrow", "LIFF-1", NOW);
ok("沒有行程：卡片寫「沒有行程」", J(empty).includes("沒有行程") && empty[0].altText.includes("沒有行程"));
const nb = await agendaReply(db, null, "two", "LIFF-1", NOW);
ok("還沒綁定：回文字說明與綁定連結", nb[0].type === "text" && nb[0].text.includes("https://liff.line.me/LIFF-1") && nb[0].text.includes("綁定"));

// 事件處理
const replies: any[] = [];
const deps: any = { admin: db, liffId: "LIFF-1", reply: async (tok: string, messages: any[]) => { replies.push({ tok, messages }); } };
const msg = (text: string, o: any = {}) => ({ type: "message", replyToken: "R-" + text, source: { type: "user", userId: "U1" }, message: { type: "text", text }, ...o });
const r = await handleWebhook([msg("行事曆"), msg("明天見"), msg("今天", { source: { type: "group", groupId: "G1", userId: "U1" } }), { type: "follow", replyToken: "F" }, msg("明天", { source: { type: "user", userId: "U-沒綁定" } }), { type: "message", replyToken: "S", source: { type: "user", userId: "U1" }, message: { type: "sticker" } }], deps);
ok("Webhook：只回覆關鍵字；一般聊天、群組、加好友、貼圖都不處理", r.replied === 2 && r.skipped === 4 && replies.map((x) => x.tok).join() === "R-行事曆,R-明天");
ok("Webhook：已綁定回行程卡片、沒綁定回綁定說明", replies[0].messages[0].type === "flex" && replies[1].messages[0].type === "text");
const r2 = await handleWebhook([msg("行事曆")], { ...deps, reply: async () => { throw new Error("LINE 400"); } });
ok("回覆失敗不會讓整個 Webhook 出錯", r2.replied === 0 && r2.skipped === 1);
const r3 = await handleWebhook([msg("行事曆")], { ...deps, liffId: "" });
ok("沒設定 LIFF ID：不回覆（記錄錯誤）", r3.replied === 0);
ok("LINE 驗證連線（events 是空的）：正常結束", (await handleWebhook([], deps)).replied === 0);

// 簽章
const body = JSON.stringify({ events: [] });
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("sec"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const good = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))));
ok("簽章正確才通過；內容被改、密碼錯、沒設密碼都不通過", await verifyLineSignature("sec", body, good) && !(await verifyLineSignature("sec", body + " ", good)) && !(await verifyLineSignature("wrong", body, good)) && !(await verifyLineSignature("", body, good)) && !(await verifyLineSignature("sec", body, "")));
