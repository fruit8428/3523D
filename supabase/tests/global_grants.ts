// 全球獎助金查詢：社密碼把關、未設定 secrets、篩選、和本地區有關、單一計畫、匯出分批、只讀不寫、錯誤不外洩。
// 用假的 Rotary-Shared（deps.shared）跑同一份邏輯。
// 執行：deno run --no-check --node-modules-dir=none -A supabase/tests/global_grants.ts
import { handle } from "../functions/line-checkin/lib.ts";
const ok = (name: string, cond: boolean) => { console.log((cond ? "✅ " : "❌ ") + name); if (!cond) Deno.exitCode = 1; };

// ---- 假的地區資料庫：只需要回社密碼 ----
const admin = { from(_t: string) { const b: any = { select: () => b, eq: () => b, maybeSingle: () => b,
  then(res: any) { res({ data: { cats: [], divs: [], orders: {}, members: {}, auth: { clubPasswords: { 松山社: "pw1" } } }, error: null }); } }; return b; } };

// ---- 假的 Rotary-Shared：看得懂 grants.ts 用到的查詢語法；任何寫入都記下來 ----
const writes: string[] = [];
let breakRead = false;
const selected: string[] = [];
function fakeShared(rows: any[]) {
  return { from(t: string) {
    const f: ((r: any) => boolean)[] = []; const orders: [string, boolean][] = []; let rng: [number, number] | null = null, lim = 0, one = false, cols = "";
    const like = (v: any, pat: string) => String(v ?? "").toLowerCase().includes(pat.replace(/%/g, "").toLowerCase());
    const b: any = {
      select(c: string) { cols = c; selected.push(c); return b; },
      is(k: string, v: any) { f.push((r) => (r[k] ?? null) === v); return b; },
      gt(k: string, v: any) { f.push((r) => r[k] > v); return b; },
      eq(k: string, v: any) { f.push((r) => r[k] === v); return b; },
      ilike(k: string, p: string) { f.push((r) => like(r[k], p)); return b; },
      or(expr: string) {
        const parts = expr.split(",").map((s) => { const i = s.indexOf("."), j = s.indexOf(".", i + 1); return [s.slice(0, i), s.slice(i + 1, j), s.slice(j + 1)]; });
        f.push((r) => parts.some(([c, op, v]) => op === "eq" ? String(r[c]) === v : like(r[c], v))); return b;
      },
      filter(k: string, op: string, v: string) { if (op !== "cs") throw new Error("unsupported"); const want = JSON.parse(v);
        f.push((r) => want.every((w: any) => (r[k] || []).some((p: any) => Object.keys(w).every((x) => p[x] === w[x])))); return b; },
      order(k: string, o: any) { orders.push([k, !(o && o.ascending === false)]); return b; },
      range(a: number, z: number) { rng = [a, z]; return b; }, limit(n: number) { lim = n; return b; }, maybeSingle() { one = true; return b; },
      insert() { writes.push("insert"); return b; }, update() { writes.push("update"); return b; }, upsert() { writes.push("upsert"); return b; }, delete() { writes.push("delete"); return b; },
      then(res: any) {
        if (breakRead) return res({ data: null, error: { code: "XX000", message: "connect https://secret.example sb_secret_abc failed" } });
        if (t !== "global_grants") return res({ data: null, error: { code: "42P01", message: "no table" } });
        let d = rows.filter((r) => f.every((x) => x(r)));
        d = d.slice().sort((x, y) => { for (const [k, asc] of orders) { if (x[k] === y[k]) continue; return (x[k] < y[k] ? -1 : 1) * (asc ? 1 : -1); } return 0; });
        if (rng) d = d.slice(rng[0], rng[1] + 1); if (lim) d = d.slice(0, lim);
        const pick = (r: any) => { const o: any = {}; for (const c of cols.split(",")) o[c] = r[c]; return o; };
        res({ data: one ? (d[0] ? pick(d[0]) : null) : d.map(pick), error: null });
      },
    }; return b; } };
}
const G = (n: number, o: any = {}) => ({
  project_id: "G-" + n, rotary_year: "2026-27", title: "Project " + n, country: "Nepal", country_zh: "尼泊爾", location: "Illam", region: "Asia", region_zh: "亞洲",
  areas_of_focus: "Water", areas_of_focus_zh: "水資源、衛生設施與個人衛生", description: "English text " + n, description_zh: "中文說明 " + n, detail_url: "https://www.matchinggrants.org/global/project" + n + ".html",
  total_budget: 100000, status: "Need $50,000", status_zh: "尚缺 $50,000", remaining_amount: 50000, trf_requested: 0, pledge_count: 0, pledges: [],
  district: "3292", host_club: "Dhulikhel", host_partner: "Rotary Club of Dhulikhel, District 3292", intl_partner: "", intl_partner_district: "",
  host_contact_name: "Host " + n, host_contact_email: "host" + n + "@example.org", intl_contact_name: "", intl_contact_email: "",
  listed_date: "2026-11-" + String(10 + (n % 10)).padStart(2, "0"), first_seen: "2026-11-21", last_changed: "2026-11-21", removed_from_list: null, updated_at: "2026-11-21T02:00:00Z", ...o,
});
const ROWS = [
  G(1), G(2, { country: "Uganda", country_zh: "烏干達", region_zh: "非洲", areas_of_focus_zh: "疾病預防與治療、母親與兒童健康", remaining_amount: 0, status_zh: "已足額認捐" }),
  G(3, { title: "School for girls", description_zh: "興建女子學校", areas_of_focus_zh: "基礎教育與識字", country: "Uganda", country_zh: "烏干達", region_zh: "非洲" }),
  G(4, { removed_from_list: "2026-11-20" }),
  G(5, { district: "3523", host_club: "Taipei Songshan", updated_at: "2026-11-22T05:00:00Z" }),
  G(6, { intl_partner: "Rotary Club of Taipei, District 3523", intl_partner_district: "3523", intl_contact_name: "Intl 6", intl_contact_email: "intl6@example.org" }),
  G(7, { pledges: [{ "認捐社": "District 3523 DDF", "地區": "3523", "日期": "2026-02-01", "現金": 0, "DDF": 10000, "合計": 10000 }], pledge_count: 1 }),
];
const shared = fakeShared(ROWS);
const deps: any = { admin, shared, defaultClubPassword: "", verify: async () => { throw new Error("no"); }, broadcast: async () => {} };
const call = async (action: string, extra: any = {}, d: any = deps) => { try { return await handle({ action, club: "松山社", clubPassword: "pw1", ...extra }, d); } catch (e: any) { return { ok: false, code: e.code || "THROW" }; } };
const ids = (r: any) => (r.grants || []).map((g: any) => g.project_id).join();

// ---- 身分把關 ----
for (const a of ["grants_list", "grants_related", "grants_get", "grants_export"]) {
  ok(`${a}：不帶社密碼被拒絕`, (await call(a, { clubPassword: "" })).code === "CLUB_AUTH_FAILED");
  ok(`${a}：帶錯密碼被拒絕`, (await call(a, { clubPassword: "wrong" })).code === "CLUB_AUTH_FAILED");
}
ok("沒有這個社：被拒絕", (await call("grants_list", { club: "不存在社" })).code === "CLUB_AUTH_FAILED");
// ---- 未設定 secrets ----
ok("沒設定 Rotary-Shared 的 secrets：回 GRANTS_NOT_CONFIGURED", (await call("grants_list", {}, { ...deps, shared: null })).code === "GRANTS_NOT_CONFIGURED");
ok("沒設定 secrets 時密碼錯仍先回身分錯誤（不透露是否開放）", (await call("grants_list", { clubPassword: "x" }, { ...deps, shared: null })).code === "CLUB_AUTH_FAILED");

// ---- 清單與篩選 ----
let r: any = await call("grants_list", { withOptions: true });
ok("清單：排除已從來源網站下架的計畫（7 筆中列 6 筆）", r.ok && r.grants.length === 6 && !ids(r).includes("G-4"));
ok("清單：上架日期新的在前", r.grants[0].project_id === "G-7" && r.grants[5].project_id === "G-1");
ok("清單：含聯絡人，不含長篇說明", r.grants[0].host_contact_email === "host7@example.org" && !("description" in r.grants[0]) && !("description_zh" in r.grants[0]));
ok("選項：國家（依計畫數多到少）、區域、總數、資料更新時間", r.countries[0].value === "Nepal" && r.countries[0].label === "尼泊爾" && r.countries[0].count === 4 && r.countries[1].count === 2 && r.regions.length === 2 && r.total === 6 && r.updatedAt === "2026-11-22T05:00:00Z");
r = await call("grants_list", { onlyOpen: true });
ok("只看還在募款：用尚缺金額 > 0 判斷", r.grants.length === 5 && !ids(r).includes("G-2"));
ok("沒要求選項時不多查", !("countries" in r));
r = await call("grants_list", { country: "Uganda" });
ok("國家篩選", ids(r) === "G-3,G-2" || ids(r) === "G-2,G-3");
r = await call("grants_list", { region: "非洲", focus: "基礎教育與識字" });
ok("區域＋服務重點篩選", ids(r) === "G-3");
r = await call("grants_list", { focus: "水資源、衛生設施與個人衛生" });
ok("服務重點名稱裡有頓號也能篩選", r.grants.length === 4);
r = await call("grants_list", { keyword: "女子學校" });
ok("關鍵字：找中文說明", ids(r) === "G-3");
r = await call("grants_list", { keyword: "songshan" });
ok("關鍵字：找主辦社（不分大小寫）", ids(r) === "G-5");
r = await call("grants_list", { keyword: "x,remaining_amount.gt.0)" });
ok("關鍵字含逗號、括號：被清掉，不會改變查詢條件", r.ok && r.grants.length === 0);

// ---- 匯出：條件與清單相同、完整欄位、分批 ----
const list = await call("grants_list", { onlyOpen: true, country: "Nepal" });
r = await call("grants_export", { onlyOpen: true, country: "Nepal" });
ok("匯出：與清單同條件時筆數、順序相同", r.ok && ids(r) === ids(list) && r.next === null);
ok("匯出：含長篇說明、認捐明細、詳細頁網址、聯絡人", r.grants[0].description_zh && Array.isArray(r.grants[0].pledges) && r.grants[0].detail_url && r.grants[0].host_contact_name);
const many = fakeShared(Array.from({ length: 230 }, (_, i) => G(1000 + i)));
let got = 0, off: any = 0, rounds = 0;
while (off !== null && rounds < 10) { const x: any = await call("grants_export", { offset: off }, { ...deps, shared: many }); got += x.grants.length; off = x.next; rounds++; }
ok("匯出：230 筆分 3 批取完（100＋100＋30）", got === 230 && rounds === 3);

// ---- 和本地區有關 ----
r = await call("grants_related", { district: "3523" });
ok("本地區是主辦社或國際夥伴社", r.ok && r.asPartner.map((g: any) => g.project_id).sort().join() === "G-5,G-6");
ok("本地區有認捐（pledges 的中文鍵「地區」）", r.asDonor.map((g: any) => g.project_id).join() === "G-7");
r = await call("grants_related", { district: "9999" });
ok("沒有相關計畫：回空清單，不是錯誤", r.ok && r.asPartner.length === 0 && r.asDonor.length === 0);
ok("地區代號不是數字：GRANTS_BAD_DISTRICT", (await call("grants_related", { district: "3523,district.neq.0" })).code === "GRANTS_BAD_DISTRICT" && (await call("grants_related", {})).code === "GRANTS_BAD_DISTRICT");

// ---- 單一計畫 ----
r = await call("grants_get", { projectId: "G-6" });
ok("單一計畫：完整欄位（說明、原文、聯絡人）", r.ok && r.grant.description === "English text 6" && r.grant.description_zh === "中文說明 6" && r.grant.intl_contact_email === "intl6@example.org");
ok("查無此計畫：GRANTS_NOT_FOUND", (await call("grants_get", { projectId: "G-999" })).code === "GRANTS_NOT_FOUND");
ok("計畫編號格式不對：GRANTS_BAD_ID", (await call("grants_get", { projectId: "4151" })).code === "GRANTS_BAD_ID" && (await call("grants_get", { projectId: "G-1;drop" })).code === "GRANTS_BAD_ID");
ok("不認得的動作：BAD_REQUEST", (await call("grants_delete", { projectId: "G-1" })).code === "BAD_REQUEST");

// ---- 讀取失敗：固定代碼，不外洩原始訊息 ----
breakRead = true;
const logs: string[] = []; const origErr = console.error; console.error = (...a: any[]) => { logs.push(a.join(" ")); };
const bad: any[] = [await call("grants_list"), await call("grants_get", { projectId: "G-1" }), await call("grants_related", { district: "3523" }), await call("grants_export")];
console.error = origErr; breakRead = false;
ok("Rotary-Shared 讀取失敗：四個動作都回 GRANTS_READ_FAILED", bad.every((x) => x.ok === false && x.code === "GRANTS_READ_FAILED"));
ok("回應與紀錄都不含原始錯誤訊息（網址、金鑰片段）", !/secret|https:/.test(JSON.stringify(bad) + logs.join("")));

// ---- 只讀不寫 ----
ok("全程沒有對 Rotary-Shared 做任何寫入", writes.length === 0);
