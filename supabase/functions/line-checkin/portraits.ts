// 活動照片找人・第一步：社友大頭照（之後用來比對活動照片）。規格見相片專案的「交接_3523報名系統.md」。
//   - 開放方式：行事曆後台「⑦ 活動照片找人」逐社開放（photo_club_enabled 有那一列＝開放），預設全部關閉。
//   - 大頭照是敏感個資：檔案放在不公開的儲存空間（檔名是亂數），紀錄放在前端讀不到的資料表；絕不進 app_storage。
//   - 由執秘統一建置（使用者 2026-11-22 決定：社友把照片傳給執秘，不在 LINE 自己上傳）：
//     執秘用社的登入密碼，上傳時要確認「已取得本人同意」。上傳時不通知本人（使用者決定）。
//   - 執秘要看照片（確認有沒有傳錯、要刪哪一張）時，一次只取「一個人」的簽名網址（10 分鐘失效）；名單本身不含照片。
//     社密碼的保護力有限（clubPasswords 公開可讀），使用者已知並決定照這個模式、不另設密碼。
//   - 這個人沒有任何一張大頭照＝沒有同意、之後不比對。刪光＝收回同意。
//   - 認人用「社名＋姓名|Nick Name」；社友改名由資料庫函式 member_rename_move 一起搬。
// deno-lint-ignore-file no-explicit-any
type Any = any;
export interface PhotoCtx {
  admin: Any;
  fail: (code: string, message?: string) => never;
  now?: number;
}
export const PHOTO_BUCKET = "member-portraits";
export const PHOTO_MAX = 3;                    // 每人最多幾張
const MAX_BYTES = 1_500_000;                   // 單張上限（畫面會先縮到最長邊 1600 再傳，通常只有幾百 KB）
const MIN_BYTES = 3_000;
const SIGN_SECONDS = 600;                      // 簽名網址 10 分鐘後失效

const personKey = (p: Any) => `${(p && p.name) || ""}|${(p && p.nickname) || ""}`;
const missing = (error: Any) => /does not exist|schema cache|could not find|PGRST20[25]|42P01|bucket not found/i.test(((error && error.message) || "") + " " + ((error && error.code) || ""));
function dbFail(ctx: PhotoCtx, error: Any): never {
  if (missing(error)) ctx.fail("PHOTO_TABLE_MISSING");
  return ctx.fail("SERVER_ERROR", (error && error.message) || "");
}

export async function photoClubOn(ctx: PhotoCtx, club: string): Promise<boolean> {
  const { data, error } = await ctx.admin.from("photo_club_enabled").select("club_name").eq("club_name", club).maybeSingle();
  if (error) { if (missing(error)) return false; ctx.fail("SERVER_ERROR", error.message); }
  return !!data;
}
async function rowsOf(ctx: PhotoCtx, club: string, key?: string): Promise<Any[]> {
  let q = ctx.admin.from("member_portraits").select("id,club_name,person_key,path,consent_by,consent_at,created_at").eq("club_name", club);
  if (key !== undefined) q = q.eq("person_key", key);
  const { data, error } = await q.order("created_at", { ascending: true }).limit(5000);
  if (error) dbFail(ctx, error);
  return data || [];
}
// 前端送來的是 base64 的 JPEG（可以帶 data:image/jpeg;base64, 開頭）。只收真的 JPEG（看檔頭），大小要合理
function decodeJpeg(ctx: PhotoCtx, image: unknown): Uint8Array {
  const text = String(image || "").replace(/^data:image\/jpe?g;base64,/i, "");
  if (!text || text.length > MAX_BYTES * 1.4 || /[^A-Za-z0-9+/=]/.test(text)) ctx.fail(text.length > MAX_BYTES * 1.4 ? "PHOTO_TOO_LARGE" : "PHOTO_BAD_IMAGE");
  let bin = "";
  try { bin = atob(text); } catch (_e) { ctx.fail("PHOTO_BAD_IMAGE"); }
  if (bin.length > MAX_BYTES) ctx.fail("PHOTO_TOO_LARGE");
  if (bin.length < MIN_BYTES) ctx.fail("PHOTO_BAD_IMAGE");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) ctx.fail("PHOTO_BAD_IMAGE");
  return bytes;
}
async function addPhoto(ctx: PhotoCtx, club: string, key: string, image: unknown, by: string): Promise<void> {
  const bytes = decodeJpeg(ctx, image);
  if ((await rowsOf(ctx, club, key)).length >= PHOTO_MAX) ctx.fail("PHOTO_TOO_MANY");
  const path = `${crypto.randomUUID()}.jpg`;                   // 檔名不含社名與姓名
  const up = await ctx.admin.storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType: "image/jpeg", upsert: false, cacheControl: "0" });   // 不快取：刪除後，先前發出的簽名網址才會立刻失效
  if (up.error) dbFail(ctx, up.error);
  const at = new Date(ctx.now || Date.now()).toISOString();
  const ins = await ctx.admin.from("member_portraits").insert({ club_name: club, person_key: key, path, consent_by: by.slice(0, 80), consent_at: at, created_at: at });
  if (ins.error) {
    try { await ctx.admin.storage.from(PHOTO_BUCKET).remove([path]); } catch (_e) { /* 留下的孤兒檔案沒有任何紀錄指向它，前端也讀不到 */ }
    dbFail(ctx, ins.error);
  }
}
// 先刪紀錄（刪了就不會再被拿去比對），再刪檔案
async function removeRows(ctx: PhotoCtx, rows: Any[]): Promise<number> {
  if (!rows.length) return 0;
  const del = await ctx.admin.from("member_portraits").delete().in("id", rows.map((r) => r.id));
  if (del.error) dbFail(ctx, del.error);
  const rm = await ctx.admin.storage.from(PHOTO_BUCKET).remove(rows.map((r) => r.path));
  if (rm.error) console.error("大頭照檔案刪除失敗", String(rm.error.message || "").slice(0, 80));
  return rows.length;
}
// ---------- 執秘（報名系統，社的登入密碼）：誰有、誰還沒有；上傳；看某一個人的照片；刪除 ----------
export async function photoDesk(action: string, body: Any, ctx: PhotoCtx, club: string, members: Any[]): Promise<Any> {
  const enabled = await photoClubOn(ctx, club);
  if (action === "photo_desk_status") return { ok: true, enabled };
  const list: Any[] = (Array.isArray(members) ? members : []).filter((m) => m && m.name);

  if (action === "photo_desk_upload") {
    if (!enabled) ctx.fail("PHOTO_CLUB_OFF");
    const key = String(body.personKey || "");
    const m = list.find((x) => personKey(x) === key);
    if (!m) ctx.fail("MEMBER_NOT_FOUND");                       // 只能幫社友庫裡的人傳
    if (body.consent !== true) ctx.fail("PHOTO_NO_CONSENT");    // 執秘要確認「已取得本人同意」
    await addPhoto(ctx, club, key, body.image, `報名系統（${club}）`);     // 上傳時不通知本人（使用者決定）；之後找到活動照片才推播
    return await deskList(ctx, club, list, enabled);
  }
  if (action === "photo_desk_delete") {
    // 關閉後仍然可以刪（社友要求刪除、社友離社都不應該被擋）。有帶 id＝只刪那一張；沒帶＝這個人全部刪掉
    const mine = await rowsOf(ctx, club, String(body.personKey || ""));
    const target = body.id ? mine.filter((r) => r.id === String(body.id)) : mine;
    if (body.id && !target.length) ctx.fail("PHOTO_NOT_FOUND");
    const n = await removeRows(ctx, target);
    // 大頭照全部刪掉＝收回同意：他的活動照片比對結果也一起刪（資料表還沒建立就略過）
    if (target.length === mine.length && mine.length) {
      const dm = await ctx.admin.from("photo_matches").delete().eq("club_name", club).eq("person_key", String(body.personKey || ""));
      if (dm.error && !missing(dm.error)) console.error("比對結果刪除失敗", String(dm.error.message || "").slice(0, 80));
    }
    return { ...(await deskList(ctx, club, list, enabled)), removed: n };
  }
  // 看「一個人」的照片：一次只給這個人的簽名網址（10 分鐘失效），不提供整社一次取回
  if (action === "photo_desk_view") {
    const key = String(body.personKey || "");
    const rows = await rowsOf(ctx, club, key);
    let urls: Record<string, string> = {};
    if (rows.length) {
      const sg = await ctx.admin.storage.from(PHOTO_BUCKET).createSignedUrls(rows.map((r) => r.path), SIGN_SECONDS);
      if (sg.error) dbFail(ctx, sg.error);
      urls = Object.fromEntries((sg.data || []).filter((x: Any) => x && x.signedUrl).map((x: Any) => [x.path, x.signedUrl]));
    }
    return { ok: true, key, photos: rows.map((r) => ({ id: r.id, url: urls[r.path] || "", at: r.created_at })) };
  }
  if (action === "photo_desk_list") {
    if (!enabled) ctx.fail("PHOTO_CLUB_OFF");
    return await deskList(ctx, club, list, enabled);
  }
  return ctx.fail("BAD_REQUEST");
}
async function deskList(ctx: PhotoCtx, club: string, _members: Any[], enabled: boolean): Promise<Any> {
  const rows = await rowsOf(ctx, club);
  const by = new Map<string, { key: string; count: number; at: string }>();
  rows.forEach((r) => {
    const p = by.get(r.person_key) || { key: r.person_key, count: 0, at: "" };
    p.count++; if (String(r.created_at) > p.at) p.at = String(r.created_at);
    by.set(r.person_key, p);
  });
  // 誰綁了 LINE（之後找到活動照片時收得到推播）：只回傳名字的索引，不回傳 LINE 使用者代碼
  const lb = await ctx.admin.from("line_bindings").select("person_key").eq("club_name", club);
  const bound = lb.error ? [] : (lb.data || []).map((r: Any) => String(r.person_key));
  return { ok: true, enabled, max: PHOTO_MAX, people: [...by.values()], bound };
}

// ---------- 行事曆後台：逐社開放 ----------
export async function photoAdmin(action: string, body: Any, ctx: PhotoCtx, clubNames: string[]): Promise<Any> {
  if (action === "photo_admin_save") {
    const club = String(body.club || "");
    if (!clubNames.includes(club)) ctx.fail("BAD_REQUEST");
    const r = body.enabled === false
      ? await ctx.admin.from("photo_club_enabled").delete().eq("club_name", club)
      : await ctx.admin.from("photo_club_enabled").upsert({ club_name: club, updated_at: new Date(ctx.now || Date.now()).toISOString() }, { onConflict: "club_name" });
    if (r.error) dbFail(ctx, r.error);
  } else if (action !== "photo_admin_get") {
    ctx.fail("BAD_REQUEST");
  }
  const on = await ctx.admin.from("photo_club_enabled").select("club_name,updated_at").order("updated_at", { ascending: true });
  if (on.error) dbFail(ctx, on.error);
  const all = await ctx.admin.from("member_portraits").select("club_name,person_key").limit(20000);
  if (all.error) dbFail(ctx, all.error);
  const people = new Map<string, Set<string>>();
  (all.data || []).forEach((r: Any) => { const s = people.get(r.club_name) || new Set<string>(); s.add(r.person_key); people.set(r.club_name, s); });
  return { ok: true, clubs: (on.data || []).map((r: Any) => ({ club: r.club_name, people: (people.get(r.club_name) || new Set()).size, at: r.updated_at })) };
}
