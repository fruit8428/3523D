// 社費推播：開放把關、每人明細計算、小計 0 不推、沒綁定不推、60 秒內重複擋下、記住上次內容。假資料庫、假的 LINE 發送。
// 執行：deno run --no-check --node-modules-dir=none -A supabase/tests/club_dues.ts
import { handle } from "../functions/line-checkin/lib.ts";
const ok = (name: string, cond: boolean) => { console.log((cond ? "✅ " : "❌ ") + name); if (!cond) Deno.exitCode = 1; };
function fake(tables: Record<string, any[]>) {
  return { from(t: string) {
    tables[t] ||= []; const f: any[] = []; let one = "", op = "select", payload: any = null, opt: any = null, desc = "";
    const b: any = {
      select() { return b; }, eq(k: string, v: any) { f.push((r: any) => r[k] === v); return b; },
      order(k: string, o: any) { if (o && o.ascending === false) desc = k; return b; }, limit() { return b; }, maybeSingle() { one = "maybe"; return b; },
      insert(p: any) { op = "insert"; payload = p; return b; }, upsert(p: any, o: any) { op = "upsert"; payload = p; opt = o; return b; },
      then(res: any) {
        if (op !== "select") {
          const keys = opt && opt.onConflict ? opt.onConflict.split(",") : [];
          for (const row of Array.isArray(payload) ? payload : [payload]) {
            const i = keys.length ? tables[t].findIndex((r: any) => keys.every((k: string) => r[k] === row[k])) : -1;
            if (i < 0) tables[t].push({ ...row }); else tables[t][i] = { ...tables[t][i], ...row };
          }
          return res({ data: null, error: null });
        }
        let d = tables[t].filter((r: any) => f.every((x) => x(r)));
        if (desc) d = d.slice().sort((a: any, b: any) => (a[desc] < b[desc] ? 1 : -1));
        if (t === "app_storage") d = [{ cats: [], divs: [], orders: {}, members: MEMBERS, auth: { clubPasswords: { 松山社: "pw1", 北區社: "pw2" } } }];
        res({ data: one ? d[0] || null : d, error: null });
      },
    }; return b; } };
}
const MEMBERS: any = {
  松山社: [
    { id: 1, name: "王小明", nickname: "Tony", role: "社友" },
    { id: 2, name: "李大華", nickname: "David", role: "社友" },
    { id: 3, name: "李太太", nickname: "Amy", role: "寶(尊)眷", spouseOfId: 2 },
    { id: 4, name: "陳榮譽", nickname: "Paul", role: "社友" },
    { id: 5, name: "林未綁", nickname: "Ken", role: "社友" },
  ],
  北區社: [{ id: 1, name: "趙", nickname: "Z", role: "社友" }],
};
const T: Record<string, any[]> = {
  calendar_club_push: [{ club_name: "松山社", enabled: true, hour: 20 }],
  line_bindings: [
    { line_user_id: "U王", club_name: "松山社", person_key: "王小明|Tony", full_name: "王小明" },
    { line_user_id: "U李", club_name: "松山社", person_key: "李大華|David", full_name: "李大華" },
    { line_user_id: "U李太", club_name: "松山社", person_key: "李太太|Amy", full_name: "李太太" },
    { line_user_id: "U陳", club_name: "松山社", person_key: "陳榮譽|Paul", full_name: "陳榮譽" },
    { line_user_id: "U趙", club_name: "北區社", person_key: "趙|Z", full_name: "趙" },
  ],
  club_dues_state: [], club_dues_log: [],
};
const sent: any[] = [];
let failFor = "";
const deps: any = { admin: fake(T), defaultClubPassword: "", push: { token: "t", sendMessages: async (to: string, m: any[]) => { if (to === failFor) throw new Error("LINE 400"); sent.push({ to, m }); } } };
const call = async (action: string, o: any = {}, d: any = deps) => { try { return await handle({ action, club: "松山社", clubPassword: "pw1", ...o }, d); } catch (e) { return { ok: false, code: (e as any).code || String(e) }; } };
const J = (x: any) => JSON.stringify(x);
const FORM = {
  info: { period: "115 年度上半年社費", due: "12/31", method: "○○銀行 123-456", note: "謝謝" },
  common: [{ name: "上半年社費", amount: 12000 }, { name: "例會餐費", amount: 3000 }],
  members: { "李大華|David": { off: [], extra: [{ name: "認捐", amount: 5000 }, { name: "溢繳折抵", amount: -2000 }] }, "陳榮譽|Paul": { off: [0, 1], extra: [] }, "李太太|Amy": { extra: [{ name: "不該出現", amount: 999 }] }, "不存在|X": { extra: [{ name: "幽靈", amount: 1 }] } },
};

ok("狀態：開放的社 enabled=true、沒開放的社 false", (await call("club_dues_status")).enabled === true && (await call("club_dues_status", { club: "北區社", clubPassword: "pw2" })).enabled === false);
ok("社密碼錯誤：三個動作都擋下", (await call("club_dues_status", { clubPassword: "x" })).code === "CLUB_AUTH_FAILED" && (await call("club_dues_get", { clubPassword: "x" })).code === "CLUB_AUTH_FAILED" && (await call("club_dues_send", { clubPassword: "x", form: FORM })).code === "CLUB_AUTH_FAILED");
ok("沒開放的社：讀取與發送都擋下（DUES_CLUB_OFF），不會發送", (await call("club_dues_get", { club: "北區社", clubPassword: "pw2" })).code === "DUES_CLUB_OFF" && (await call("club_dues_send", { club: "北區社", clubPassword: "pw2", form: FORM })).code === "DUES_CLUB_OFF" && sent.length === 0);
let g = await call("club_dues_get");
ok("讀取：第一次沒有上次內容；回傳已綁定的社友（不含寶尊眷、不含 LINE 使用者代碼）", g.ok && g.last === null && g.canSend === true && g.bound.slice().sort().join() === ["李大華|David", "王小明|Tony", "陳榮譽|Paul"].sort().join() && !J(g).includes("U王") && g.history.length === 0);
ok("沒填期別：擋下", (await call("club_dues_send", { form: { ...FORM, info: { period: " " } } })).code === "DUES_NO_PERIOD");
ok("所有人小計都是 0：擋下", (await call("club_dues_send", { form: { info: { period: "x" }, common: [], members: {} } })).code === "DUES_NO_TARGET");
let r = await call("club_dues_send", { form: FORM });
ok("發送：王、李收到（2 則）；陳小計 0 不推；林沒綁定列在 unbound；寶尊眷與不存在的人不算", r.ok && r.sent === 2 && r.failed === 0 && r.targets === 3 && sent.map((s) => s.to).sort().join() === "U李,U王" && r.unbound.length === 1 && r.unbound[0].name === "林未綁");
const li = J(sent.find((s) => s.to === "U李")), wa = J(sent.find((s) => s.to === "U王"));
ok("李的卡片：社名期別、稱呼、四個品項（含負數）、合計 18,000、期限、繳費方式、補充說明", li.includes("【松山社】115 年度上半年社費") && li.includes("李大華 David 社友您好") && li.includes("12,000") && li.includes("3,000") && li.includes("認捐") && li.includes("-2,000") && li.includes("NT$ 18,000") && li.includes("繳費期限：12/31") && li.includes("繳費方式：○○銀行 123-456") && li.includes("謝謝"));
ok("王的卡片只有自己的明細：合計 15,000，看不到李的認捐", wa.includes("NT$ 15,000") && !wa.includes("認捐") && !wa.includes("李大華"));
ok("發送紀錄：一筆，人數、成功、沒綁定、總金額（15000+18000+15000）", T.club_dues_log.length === 1 && T.club_dues_log[0].target_count === 3 && T.club_dues_log[0].sent_count === 2 && T.club_dues_log[0].unbound_count === 1 && T.club_dues_log[0].total_amount === 48000 && r.history.length === 1 && r.history[0].period === "115 年度上半年社費");
ok("發送紀錄不含每個人的明細", !J(T.club_dues_log).includes("認捐") && !J(T.club_dues_log).includes("李大華"));
ok("60 秒內送一模一樣的內容：擋下（DUES_DUPLICATE），沒有多發", (await call("club_dues_send", { form: FORM })).code === "DUES_DUPLICATE" && sent.length === 2);
const F2 = { ...FORM, common: [{ name: "上半年社費", amount: 12000 }, { name: "例會餐費", amount: 3500 }] };
r = await call("club_dues_send", { form: F2 });
ok("內容不同就可以馬上再發（不限次數）", r.ok && r.sent === 2 && sent.length === 4 && T.club_dues_log.length === 2);
T.club_dues_log.forEach((x) => x.sent_at = new Date(Date.now() - 120_000).toISOString());
ok("超過 60 秒：同樣內容可以再發", (await call("club_dues_send", { form: F2 })).ok === true);
g = await call("club_dues_get");
ok("記住上次的內容：共同品項＋個別品項（不存在的人、空的設定不保留金額以外的東西）", g.last && g.last.common[1].amount === 3500 && g.last.members["李大華|David"].extra.length === 2 && g.last.members["陳榮譽|Paul"].off.join() === "0,1" && g.last.info.period === "115 年度上半年社費" && g.history.length === 3 && !g.last.members["不存在|X"] && !g.last.members["李太太|Amy"]);
failFor = "U李"; const n0 = sent.length;
r = await call("club_dues_send", { form: { ...F2, info: { ...F2.info, note: "再一次" } } });
ok("其中一人發送失敗：其他人照發，回報失敗人數與姓名", r.ok && r.sent === 1 && r.failed === 1 && r.failedNames.join() === "李大華" && sent.length === n0 + 1);
failFor = "";
ok("沒有官方帳號 token：PUSH_DISABLED", (await call("club_dues_send", { form: FORM }, { ...deps, push: undefined })).code === "PUSH_DISABLED");
ok("不合法的品項被忽略：金額 0、沒名稱、非數字、超過上限", (await call("club_dues_send", { form: { info: { period: "p" }, common: [{ name: "a", amount: 0 }, { name: "", amount: 5 }, { name: "b", amount: "abc" }, { name: "c", amount: 99999999 }], members: {} } })).code === "DUES_NO_TARGET");
