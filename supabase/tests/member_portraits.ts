// 活動照片找人・大頭照（由執秘統一建置）：逐社開放、要確認本人同意、最多 3 張、只收 JPEG、名單不含照片、一次只看一個人、通知本人、刪除、後台密碼。
// 假資料庫、假儲存空間、假的 LINE 驗證與發送。
// 執行：deno run --no-check --node-modules-dir=none -A supabase/tests/member_portraits.ts
import { handle } from "../functions/line-checkin/lib.ts";
const ok = (name: string, cond: boolean) => { console.log((cond ? "✅ " : "❌ ") + name); if (!cond) Deno.exitCode = 1; };
const MEMBERS: any = {
  松山社: [
    { id: 1, name: "王小明", nickname: "Tony", role: "社友" },
    { id: 2, name: "李大華", nickname: "David", role: "社友" },
    { id: 3, name: "李太太", nickname: "Amy", role: "寶(尊)眷", spouseOfId: 2 },
  ],
  北區社: [{ id: 1, name: "趙", nickname: "Z", role: "社友" }],
};
const T: Record<string, any[]> = {
  photo_club_enabled: [{ club_name: "松山社", updated_at: "2026-11-22T00:00:00Z" }],
  member_portraits: [],
  line_bindings: [
    { line_user_id: "U王", club_name: "松山社", person_key: "王小明|Tony", full_name: "王小明", nickname: "Tony" },
    { line_user_id: "U趙", club_name: "北區社", person_key: "趙|Z", full_name: "趙", nickname: "Z" },
  ],
};
const files = new Map<string, Uint8Array>();
let seq = 1;
function fake() {
  return {
    storage: { from(_b: string) { return {
      async upload(path: string, bytes: Uint8Array, o: any) { if (o.contentType !== "image/jpeg") return { error: { message: "mime" } }; files.set(path, bytes); return { data: { path }, error: null }; },
      async remove(paths: string[]) { paths.forEach((p) => files.delete(p)); return { data: [], error: null }; },
      async createSignedUrls(paths: string[], sec: number) { return { data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example/${p}?exp=${sec}` })), error: null }; },
    }; } },
    from(t: string) {
      T[t] ||= []; const f: any[] = []; let one = false, op = "select", payload: any = null, opt: any = null;
      const b: any = {
        select() { return b; }, eq(k: string, v: any) { f.push((r: any) => r[k] === v); return b; }, in(k: string, vs: any[]) { f.push((r: any) => vs.includes(r[k])); return b; },
        order() { return b; }, limit() { return b; }, maybeSingle() { one = true; return b; },
        insert(p: any) { op = "insert"; payload = p; return b; }, upsert(p: any, o: any) { op = "upsert"; payload = p; opt = o; return b; }, delete() { op = "delete"; return b; },
        then(res: any) {
          if (t === "app_storage") return res({ data: { cats: [], divs: [{ id: 1, name: "第一分區", clubs: [{ name: "松山社" }, { name: "北區社" }] }], orders: {}, members: MEMBERS, auth: { clubPasswords: { 松山社: "pw1", 北區社: "pw2" } } }, error: null });
          if (op === "delete") { T[t] = T[t].filter((r: any) => !f.every((x) => x(r))); return res({ data: null, error: null }); }
          if (op === "insert" || op === "upsert") {
            const keys = opt && opt.onConflict ? opt.onConflict.split(",") : [];
            for (const row of Array.isArray(payload) ? payload : [payload]) {
              const i = keys.length ? T[t].findIndex((r: any) => keys.every((k: string) => r[k] === row[k])) : -1;
              if (i < 0) T[t].push({ id: "id" + seq++, ...row }); else T[t][i] = { ...T[t][i], ...row };
            }
            return res({ data: null, error: null });
          }
          const d = T[t].filter((r: any) => f.every((x) => x(r)));
          res({ data: one ? d[0] || null : d, error: null });
        },
      }; return b;
    },
  };
}
const sent: any[] = [];
const deps: any = {
  admin: fake(), defaultClubPassword: "", calendarAdminPassword: "adminpw", liffId: "1234-abcd",
  verify: async (tok: string) => { if (!tok) throw Object.assign(new Error("x"), { code: "LINE_TOKEN_INVALID" }); return { sub: tok, name: "LINE 名稱" }; },
  push: { token: "t", sendMessages: async (to: string, m: any[]) => { sent.push({ to, m }); } },
};
const call = async (body: any) => { try { return await handle(body, deps); } catch (e) { return { ok: false, code: (e as any).code || String(e) }; } };
const desk = (action: string, o: any = {}) => call({ action, club: "松山社", clubPassword: "pw1", ...o });
const line = (action: string, o: any = {}, tok = "U王") => call({ action, idToken: tok, ...o });
const J = (x: any) => JSON.stringify(x);
// 假的 JPEG：FF D8 FF 開頭，長度夠
const jpeg = (n = 5000, head = [0xff, 0xd8, 0xff, 0xe0]) => { const b = new Uint8Array(n); b.set(head); let s = ""; b.forEach((c) => (s += String.fromCharCode(c))); return btoa(s); };
const IMG = jpeg();

let r: any;
ok("社友不能在 LINE 自己上傳：photo_me 系列動作已不存在", (await line("photo_me")).code === "BAD_REQUEST" && (await line("photo_me_upload", { image: IMG, consent: true })).code === "BAD_REQUEST" && (await line("photo_me_delete", { all: true })).code === "BAD_REQUEST" && files.size === 0);

// ---------- 執秘（報名系統） ----------
ok("社密碼錯誤：五個動作全部擋下", (await desk("photo_desk_status", { clubPassword: "x" })).code === "CLUB_AUTH_FAILED" && (await desk("photo_desk_list", { clubPassword: "x" })).code === "CLUB_AUTH_FAILED" && (await desk("photo_desk_upload", { clubPassword: "x", personKey: "李大華|David", image: IMG, consent: true })).code === "CLUB_AUTH_FAILED" && (await desk("photo_desk_view", { clubPassword: "x", personKey: "王小明|Tony" })).code === "CLUB_AUTH_FAILED" && (await desk("photo_desk_delete", { clubPassword: "x", personKey: "王小明|Tony" })).code === "CLUB_AUTH_FAILED");
ok("狀態：開放的社 true、沒開放的社 false", (await desk("photo_desk_status")).enabled === true && (await call({ action: "photo_desk_status", club: "北區社", clubPassword: "pw2" })).enabled === false);
ok("沒開放的社：不能看名單、不能上傳", (await call({ action: "photo_desk_list", club: "北區社", clubPassword: "pw2" })).code === "PHOTO_CLUB_OFF" && (await call({ action: "photo_desk_upload", club: "北區社", clubPassword: "pw2", personKey: "趙|Z", image: IMG, consent: true })).code === "PHOTO_CLUB_OFF" && files.size === 0);
ok("沒確認已取得本人同意：不能上傳", (await desk("photo_desk_upload", { personKey: "李大華|David", image: IMG })).code === "PHOTO_NO_CONSENT" && (await desk("photo_desk_upload", { personKey: "李大華|David", image: IMG, consent: "true" })).code === "PHOTO_NO_CONSENT" && files.size === 0);
ok("不在社友庫的人（含別社的人）：擋下", (await desk("photo_desk_upload", { personKey: "路人|X", image: IMG, consent: true })).code === "MEMBER_NOT_FOUND" && (await desk("photo_desk_upload", { personKey: "趙|Z", image: IMG, consent: true })).code === "MEMBER_NOT_FOUND");
ok("不是 JPEG（PNG 檔頭）：擋下", (await desk("photo_desk_upload", { personKey: "李大華|David", image: jpeg(5000, [0x89, 0x50, 0x4e, 0x47]), consent: true })).code === "PHOTO_BAD_IMAGE");
ok("亂碼／太小：擋下", (await desk("photo_desk_upload", { personKey: "李大華|David", image: "<script>", consent: true })).code === "PHOTO_BAD_IMAGE" && (await desk("photo_desk_upload", { personKey: "李大華|David", image: jpeg(100), consent: true })).code === "PHOTO_BAD_IMAGE");
ok("太大（超過 1.5MB）：擋下", (await desk("photo_desk_upload", { personKey: "李大華|David", image: jpeg(1_600_000), consent: true })).code === "PHOTO_TOO_LARGE" && files.size === 0);
r = await desk("photo_desk_upload", { personKey: "李太太|Amy", image: "data:image/jpeg;base64," + IMG, consent: true });
ok("上傳（寶尊眷、沒綁 LINE）：成功、沒有通知、名單多一人", r.ok && r.notified === false && sent.length === 0 && r.people.length === 1 && r.people[0].key === "李太太|Amy" && r.people[0].count === 1 && files.size === 1);
const row = T.member_portraits[0];
ok("紀錄：社名、姓名|Nick Name、記下是哪一社確認同意、有同意時間；檔名是亂數（不含姓名與社名）", row.club_name === "松山社" && row.person_key === "李太太|Amy" && row.consent_by === "報名系統（松山社）" && !!row.consent_at && /^[0-9a-f-]{36}\.jpg$/.test(row.path));
r = await desk("photo_desk_upload", { personKey: "王小明|Tony", image: IMG, consent: true });
ok("上傳（有綁 LINE）：通知本人，說明用途、不公開、要更換或刪除找執秘；不含任何連結", r.ok && r.notified === true && sent.length === 1 && sent[0].to === "U王" && J(sent[0].m).includes("松山社") && J(sent[0].m).includes("貴社執秘已經幫您建立大頭照") && J(sent[0].m).includes("不會公開") && J(sent[0].m).includes("請告訴貴社執秘") && !J(sent[0].m).includes("http"));
r = await desk("photo_desk_upload", { personKey: "王小明|Tony", image: IMG, consent: true });
ok("一小時內再傳第二張：不重複通知", r.ok && r.notified === false && sent.length === 1);
await desk("photo_desk_upload", { personKey: "王小明|Tony", image: IMG, consent: true });
ok("最多 3 張：第 4 張擋下", (await desk("photo_desk_upload", { personKey: "王小明|Tony", image: IMG, consent: true })).code === "PHOTO_TOO_MANY" && T.member_portraits.filter((x) => x.person_key === "王小明|Tony").length === 3 && files.size === 4);
r = await desk("photo_desk_list");
ok("名單：只有人與張數；不含照片網址、檔名、LINE 使用者代碼", r.ok && r.people.length === 2 && r.people.find((x: any) => x.key === "王小明|Tony").count === 3 && r.bound.join() === "王小明|Tony" && !J(r).includes("signed") && !J(r).includes(".jpg") && !J(r).includes("U王"));
r = await desk("photo_desk_view", { personKey: "王小明|Tony" });
ok("查看：只回這一個人的 3 張，簽名網址 10 分鐘失效", r.ok && r.key === "王小明|Tony" && r.photos.length === 3 && r.photos.every((x: any) => /^https:\/\/signed\.example\/.+\.jpg\?exp=600$/.test(x.url) && x.id && x.at));
ok("查看：沒有照片的人回空的；別社的人查不到", (await desk("photo_desk_view", { personKey: "李大華|David" })).photos.length === 0 && (await call({ action: "photo_desk_view", club: "北區社", clubPassword: "pw2", personKey: "王小明|Tony" })).photos.length === 0);
ok("沒有「一次取回全社照片」的動作", (await desk("photo_desk_view_all")).code === "BAD_REQUEST" && (await desk("photo_desk_view", {})).photos.length === 0);
const oneId = r.photos[0].id;
ok("刪除一張：別社拿同一個照片代號刪不到", (await call({ action: "photo_desk_delete", club: "北區社", clubPassword: "pw2", personKey: "王小明|Tony", id: oneId })).code === "PHOTO_NOT_FOUND" && (await desk("photo_desk_delete", { personKey: "李太太|Amy", id: oneId })).code === "PHOTO_NOT_FOUND" && files.size === 4);
r = await desk("photo_desk_delete", { personKey: "王小明|Tony", id: oneId });
ok("刪除一張：剩 2 張，檔案也刪掉", r.ok && r.removed === 1 && r.people.find((x: any) => x.key === "王小明|Tony").count === 2 && files.size === 3);
r = await desk("photo_desk_delete", { personKey: "王小明|Tony" });
ok("全部刪除：該社友的紀錄與檔案都刪掉，別人的不受影響", r.ok && r.removed === 2 && !T.member_portraits.some((x) => x.person_key === "王小明|Tony") && T.member_portraits.length === 1 && files.size === 1);

// ---------- 行事曆後台：逐社開放 ----------
const adm = (action: string, o: any = {}) => call({ action, adminPassword: "adminpw", ...o });
ok("後台：密碼錯誤擋下；沒設定後台密碼＝關閉", (await call({ action: "photo_admin_get", adminPassword: "x" })).code === "CAL_ADMIN_AUTH_FAILED" && (await (async () => { try { return await handle({ action: "photo_admin_get", adminPassword: "" }, { ...deps, calendarAdminPassword: "" }); } catch (e) { return { code: (e as any).code }; } })()).code === "CAL_ADMIN_DISABLED");
r = await adm("photo_admin_get");
ok("後台：列出已開放的社與已有大頭照的人數", r.ok && r.clubs.length === 1 && r.clubs[0].club === "松山社" && r.clubs[0].people === 1);
ok("後台：不存在的社名擋下", (await adm("photo_admin_save", { club: "幽靈社", enabled: true })).code === "BAD_REQUEST");
r = await adm("photo_admin_save", { club: "北區社", enabled: true });
ok("後台：開放北區社後，該社執秘可以上傳", r.ok && r.clubs.length === 2 && (await call({ action: "photo_desk_upload", club: "北區社", clubPassword: "pw2", personKey: "趙|Z", image: IMG, consent: true })).ok);
r = await adm("photo_admin_save", { club: "北區社", enabled: false });
ok("後台：關閉後不能再上傳，但執秘仍可查看與刪除（社友要求、離社）", r.clubs.length === 1 && (await call({ action: "photo_desk_upload", club: "北區社", clubPassword: "pw2", personKey: "趙|Z", image: IMG, consent: true })).code === "PHOTO_CLUB_OFF" && (await call({ action: "photo_desk_view", club: "北區社", clubPassword: "pw2", personKey: "趙|Z" })).photos.length === 1 && (await call({ action: "photo_desk_delete", club: "北區社", clubPassword: "pw2", personKey: "趙|Z" })).removed === 1);
