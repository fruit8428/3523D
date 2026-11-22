// 活動照片找人・第二、三步：貼 Google 雲端硬碟資料夾連結 → 運算程式比對 → 按「發送通知」→ 社友在 LINE 看自己的照片。
// 規格與使用者的決定見相片專案的「交接_3523報名系統.md」。資料表見 supabase/sql/photo_jobs.sql。
//   - 這裡不做人臉運算：只建立「工作」（photo_jobs），並啟動相片專案放在 GitHub 的運算程式（ctx.dispatch）。
//     運算程式用私密金鑰直接讀大頭照、寫 photo_matches 與工作進度，不經過這支小程式。
//   - 地區管理者（行事曆後台密碼）貼的連結＝比對所有開放的社；執秘（社密碼）貼的＝只比對自己的社。
//   - 比對完不會自動推播：要按「發送通知」（使用者決定先這樣試辦）。按了之後社友才看得到這個活動的照片。
//   - 社友（LINE 驗證過的身分）只看得到自己、以及「沒綁 LINE 的寶尊眷」的照片。
//     程式「確定」的直接列出；「不太確定」的由本人按是／不是（使用者選的做法 A）。
//   - 照片留在攝影師的 Google 雲端硬碟，這裡只回傳檔案代號，畫面自己組出顯示用的網址。
//   - 比對結果是個資：不進 app_storage；執秘只看得到自己社「誰有幾張」，看不到別社。
// deno-lint-ignore-file no-explicit-any
type Any = any;
export interface JobCtx {
  admin: Any;
  fail: (code: string, message?: string) => never;
  members: () => Promise<Record<string, Any[]>>;                       // 全地區的社友庫
  family: (list: Any[], key: string, name: string) => string[];        // 社友庫裡互為寶(尊)眷的人（lib.ts 的 familyKeys）
  send?: (to: string, messages: Any[]) => Promise<void>;               // 沒有＝這個地區沒有官方帳號 token
  dispatch?: (inputs: Record<string, string>) => Promise<void>;        // 啟動 GitHub 上的運算程式；沒有＝還沒設定
  now?: number;
}
const JOB_COLS = "id,scope,club_name,title,folder_id,status,progress,total_photos,error,created_by,created_at,started_at,finished_at,sent_at";
const STUCK_MS = 60 * 60_000;          // 「比對中」超過一小時視為卡住，可以重新比對
const personKey = (p: Any) => `${(p && p.name) || ""}|${(p && p.nickname) || ""}`;
const missing = (error: Any) => /does not exist|schema cache|could not find|PGRST20[25]|42P01/i.test(((error && error.message) || "") + " " + ((error && error.code) || ""));
function dbFail(ctx: JobCtx, error: Any): never {
  if (missing(error)) ctx.fail("PHOTO_TABLE_MISSING");
  return ctx.fail("SERVER_ERROR", (error && error.message) || "");
}
// 從使用者貼的網址取出資料夾代號。支援 /folders/<id>（含 /drive/mobile/、/u/0/）與 ?id=<id>
export function parseFolder(url: unknown): string {
  const s = String(url || "").trim();
  if (s.length > 500) return "";
  const m = s.match(/drive\.google\.com\/.*\/folders\/([A-Za-z0-9_-]{10,80})/) || s.match(/drive\.google\.com\/.*[?&]id=([A-Za-z0-9_-]{10,80})/);
  return m ? m[1] : "";
}
async function enabledClubs(ctx: JobCtx): Promise<Set<string>> {
  const { data, error } = await ctx.admin.from("photo_club_enabled").select("club_name");
  if (error) dbFail(ctx, error);
  return new Set((data || []).map((r: Any) => String(r.club_name)));
}
async function pageAll(ctx: JobCtx, make: () => Any): Promise<Any[]> {
  const out: Any[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    if (error) dbFail(ctx, error);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
async function matchRows(ctx: JobCtx, jobIds: string[], club?: string): Promise<Any[]> {
  if (!jobIds.length) return [];
  return await pageAll(ctx, () => {
    let q = ctx.admin.from("photo_matches").select("id,job_id,club_name,person_key,status").in("job_id", jobIds);
    if (club) q = q.eq("club_name", club);
    return q.order("id", { ascending: true });
  });
}
// 每個工作的統計。people＝有照片的人數；sure＝確定的張數（含本人按「是」的）；pending＝等本人確認的張數
function summarize(rows: Any[]) {
  const by = new Map<string, { people: Set<string>; sure: number; pending: number; persons: Map<string, { club: string; key: string; sure: number; pending: number }> }>();
  for (const r of rows) {
    if (r.status === "no") continue;
    const j = by.get(r.job_id) || { people: new Set<string>(), sure: 0, pending: 0, persons: new Map() };
    const pk = `${r.club_name}\u0001${r.person_key}`;
    const p = j.persons.get(pk) || { club: r.club_name, key: r.person_key, sure: 0, pending: 0 };
    if (r.status === "pending") { j.pending++; p.pending++; } else { j.sure++; p.sure++; }
    j.people.add(pk); j.persons.set(pk, p); by.set(r.job_id, j);
  }
  return by;
}
function jobView(j: Any, sum: Any, now: number, withPersons: boolean) {
  const s = sum.get(j.id);
  const out: Any = {
    id: j.id, scope: j.scope, club: j.club_name || "", title: j.title, folderId: j.folder_id, status: j.status,
    progress: j.progress && typeof j.progress === "object" ? { stage: String(j.progress.stage || "").slice(0, 40), done: Number(j.progress.done) || 0, total: Number(j.progress.total) || 0 } : {},
    totalPhotos: Number(j.total_photos) || 0, error: String(j.error || "").slice(0, 300), createdBy: j.created_by || "", createdAt: j.created_at, finishedAt: j.finished_at, sentAt: j.sent_at,
    stuck: j.status === "running" && now - Date.parse(j.started_at || j.created_at) > STUCK_MS,
    people: s ? s.people.size : 0, sure: s ? s.sure : 0, pending: s ? s.pending : 0,
  };
  if (withPersons) out.persons = s ? [...s.persons.values()].map((p: Any) => ({ key: p.key, sure: p.sure, pending: p.pending })) : [];
  return out;
}
async function listJobs(ctx: JobCtx, club?: string): Promise<Any> {
  let jobs: Any[];
  if (club) {
    // 執秘：地區的活動＋自己社貼的活動（分兩次查，避免社名裡的符號弄壞查詢）
    const a = await ctx.admin.from("photo_jobs").select(JOB_COLS).eq("scope", "district").order("created_at", { ascending: false }).limit(100);
    if (a.error) dbFail(ctx, a.error);
    const b = await ctx.admin.from("photo_jobs").select(JOB_COLS).eq("scope", "club").eq("club_name", club).order("created_at", { ascending: false }).limit(100);
    if (b.error) dbFail(ctx, b.error);
    jobs = [...(a.data || []), ...(b.data || [])].sort((x, y) => (x.created_at < y.created_at ? 1 : -1));
  } else {
    const a = await ctx.admin.from("photo_jobs").select(JOB_COLS).order("created_at", { ascending: false }).limit(200);
    if (a.error) dbFail(ctx, a.error);
    jobs = a.data || [];
  }
  const sum = summarize(await matchRows(ctx, jobs.map((j) => j.id), club));
  const now = ctx.now || Date.now();
  return { ok: true, canRun: !!ctx.dispatch, canSend: !!ctx.send, jobs: jobs.map((j) => jobView(j, sum, now, !!club)) };
}
async function getJob(ctx: JobCtx, id: unknown, club?: string): Promise<Any> {
  const jid = String(id || "");
  if (!/^[0-9a-f-]{36}$/i.test(jid)) ctx.fail("PHOTO_JOB_NOT_FOUND");
  const { data, error } = await ctx.admin.from("photo_jobs").select(JOB_COLS).eq("id", jid).maybeSingle();
  if (error) dbFail(ctx, error);
  // 執秘只能動「自己社貼的」工作；地區的工作只有管理者能動
  if (!data || (club && !(data.scope === "club" && data.club_name === club))) ctx.fail("PHOTO_JOB_NOT_FOUND");
  return data;
}
async function start(ctx: JobCtx, district: unknown, jobId: string): Promise<boolean> {
  if (!ctx.dispatch) return false;
  const d = /^\d{3,5}$/.test(String(district || "")) ? String(district) : "";
  try { await ctx.dispatch({ district: d, job_id: jobId }); return true; }
  catch (e) { console.error("啟動比對失敗", String((e && (e as Any).message) || "").slice(0, 120)); return false; }
}

// 一則通知的卡片：活動名稱、找到幾張、看照片的按鈕
export function buildPhotoMessage(title: string, name: string, sure: number, pending: number, others: string[], url: string): Any {
  const lines: Any[] = [
    { type: "text", text: title, weight: "bold", size: "lg", color: "#0F172A", wrap: true },
    { type: "text", text: `${name} 您好`, size: "md", color: "#334155", margin: "md", wrap: true },
  ];
  if (sure) lines.push({ type: "text", text: `找到 ${sure} 張有您${others.length ? "（或家人）" : ""}的活動照片。`, size: "md", color: "#0F172A", margin: "sm", wrap: true });
  if (pending) lines.push({ type: "text", text: `${sure ? "另有" : "有"} ${pending} 張不太確定，請您點開幫忙確認是不是您。`, size: "sm", color: "#B45309", margin: "sm", wrap: true });
  if (others.length) lines.push({ type: "text", text: `包含：${others.slice(0, 5).join("、")}`, size: "sm", color: "#64748B", margin: "sm", wrap: true });
  return {
    type: "flex", altText: `📷 ${title}：找到有您的活動照片`.slice(0, 390),
    contents: { type: "bubble", size: "mega",
      header: { type: "box", layout: "vertical", backgroundColor: "#1E3A8A", paddingAll: "14px", contents: [{ type: "text", text: "📷 活動照片", color: "#FFFFFF", weight: "bold", size: "md" }] },
      body: { type: "box", layout: "vertical", paddingAll: "16px", contents: lines },
      footer: { type: "box", layout: "vertical", paddingAll: "12px", contents: [{ type: "button", style: "primary", color: "#1D4ED8", action: { type: "uri", label: "看照片", uri: url } }] } },
  };
}

// 誰會收到通知：有照片的人本人有綁 LINE 就傳給本人；沒綁的寶尊眷併給對應的社友（使用者決定）。只算已開放的社；至少要有一張「確定」的才通知
async function plan(ctx: JobCtx, job: Any, club?: string) {
  const on = await enabledClubs(ctx);
  const rows = (await matchRows(ctx, [job.id], club)).filter((r) => r.status !== "no" && on.has(r.club_name));
  const all = await ctx.members();
  const binds = await pageAll(ctx, () => ctx.admin.from("line_bindings").select("line_user_id,club_name,person_key").order("line_user_id", { ascending: true }));
  const uidOf = new Map<string, string>(binds.map((b: Any) => [`${b.club_name}\u0001${b.person_key}`, String(b.line_user_id)]));
  const done = await pageAll(ctx, () => ctx.admin.from("photo_notified").select("club_name,person_key").eq("job_id", job.id).order("person_key", { ascending: true }));
  const sentTo = new Set(done.map((d: Any) => `${d.club_name}\u0001${d.person_key}`));
  const people = new Map<string, { club: string; key: string; sure: number; pending: number }>();
  rows.forEach((r) => { const k = `${r.club_name}\u0001${r.person_key}`; const p = people.get(k) || { club: r.club_name, key: r.person_key, sure: 0, pending: 0 }; if (r.status === "pending") p.pending++; else p.sure++; people.set(k, p); });
  const targets = new Map<string, { uid: string; club: string; key: string; name: string; sure: number; pending: number; others: string[] }>();
  const unbound: { club: string; name: string }[] = [];
  for (const p of people.values()) {
    const list: Any[] = Array.isArray(all[p.club]) ? all[p.club] : [];
    const nameOf = (k: string) => { const m = list.find((x) => personKey(x) === k); return m ? String(m.name) : k.split("|")[0]; };
    let to = uidOf.has(`${p.club}\u0001${p.key}`) ? p.key : "";
    if (!to) to = ctx.family(list, p.key, p.key.split("|")[0]).find((k) => uidOf.has(`${p.club}\u0001${k}`)) || "";
    if (!to) { if (p.sure > 0) unbound.push({ club: p.club, name: nameOf(p.key) }); continue; }      // 只有「不太確定」的人本來就不通知，不用列在收不到的名單
    const tk = `${p.club}\u0001${to}`;
    const t = targets.get(tk) || { uid: uidOf.get(tk)!, club: p.club, key: to, name: nameOf(to), sure: 0, pending: 0, others: [] };
    t.sure += p.sure; t.pending += p.pending;
    if (to !== p.key) t.others.push(nameOf(p.key));
    targets.set(tk, t);
  }
  // 使用者 2026-11-23 的規定：至少要有一張「確定」的照片才推播（含本人按過「是」的，以及併進來的寶尊眷的）。
  // 只有「不太確定」的人不通知，避免社友點開卻全都不是他；之後有了確定的照片，再按一次發送就會通知到。
  const all2 = [...targets.values()];
  const list = all2.filter((t) => t.sure > 0);
  const isSent = (t: Any) => sentTo.has(`${t.club}\u0001${t.key}`);
  return { fresh: list.filter((t) => !isSent(t)), already: list.filter(isSent).length, unbound, people: people.size,
    maybeOnly: all2.filter((t) => t.sure === 0 && !isSent(t)).length };
}

// ---------- 管理者（行事曆後台密碼，club 不給）與執秘（社密碼，club＝自己的社）共用 ----------
export async function photoJobs(action: string, body: Any, ctx: JobCtx, club: string | undefined, by: string): Promise<Any> {
  const now = ctx.now || Date.now();
  if (action === "list") return await listJobs(ctx, club);

  if (action === "add") {
    const title = String(body.title || "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!title) ctx.fail("PHOTO_NO_TITLE");
    const folder = parseFolder(body.url);
    if (!folder) ctx.fail("PHOTO_BAD_URL");
    if (club && !(await enabledClubs(ctx)).has(club)) ctx.fail("PHOTO_CLUB_OFF");
    let dq = ctx.admin.from("photo_jobs").select("id,status").eq("folder_id", folder).eq("scope", club ? "club" : "district");
    if (club) dq = dq.eq("club_name", club);
    const dup = await dq.limit(5);
    if (dup.error) dbFail(ctx, dup.error);
    if ((dup.data || []).length) ctx.fail("PHOTO_DUPLICATE");         // 同一個資料夾已經貼過：請用「重新比對」
    const ins = await ctx.admin.from("photo_jobs").insert({ scope: club ? "club" : "district", club_name: club || "", title, folder_id: folder, status: "queued", created_by: by.slice(0, 60), created_at: new Date(now).toISOString() }).select("id").maybeSingle();
    if (ins.error) dbFail(ctx, ins.error);
    const started = await start(ctx, body.district, String((ins.data && ins.data.id) || ""));
    return { ...(await listJobs(ctx, club)), started };
  }

  const job = await getJob(ctx, body.id, club);

  if (action === "delete") {
    const { error } = await ctx.admin.from("photo_jobs").delete().eq("id", job.id);
    if (error) dbFail(ctx, error);
    return await listJobs(ctx, club);
  }
  // 重新比對（例如後來又補了大頭照、或上次失敗）。運算程式只會新增結果，不會動社友已經按過「是／不是」的照片
  if (action === "rerun") {
    if (job.status === "running" && now - Date.parse(job.started_at || job.created_at) <= STUCK_MS) ctx.fail("PHOTO_RUNNING");
    const { error } = await ctx.admin.from("photo_jobs").update({ status: "queued", error: "", progress: {}, started_at: null, finished_at: null }).eq("id", job.id);
    if (error) dbFail(ctx, error);
    const started = await start(ctx, body.district, job.id);
    return { ...(await listJobs(ctx, club)), started };
  }
  if (action === "preview" || action === "send") {
    if (job.status !== "done") ctx.fail("PHOTO_NOT_READY");
    const p = await plan(ctx, job, club);
    const base = { ok: true, title: job.title, people: p.people, targets: p.fresh.length, already: p.already, maybeOnly: p.maybeOnly, unbound: p.unbound.slice(0, 200) };
    if (action === "preview") return { ...base, canSend: !!ctx.send };
    if (!ctx.send) ctx.fail("PUSH_DISABLED");
    const liffId = String(body.liffId || "");
    if (!/^[\w-]{5,80}$/.test(liffId)) ctx.fail("BAD_REQUEST");
    // 先標成「已發送」，社友點開連結時才看得到照片
    if (!job.sent_at) {
      const up = await ctx.admin.from("photo_jobs").update({ sent_at: new Date(now).toISOString(), sent_by: by.slice(0, 60) }).eq("id", job.id);
      if (up.error) dbFail(ctx, up.error);
    }
    const url = `https://liff.line.me/${liffId}?p=photos&job=${job.id}`;
    let sent = 0, failed = 0;
    for (let i = 0; i < p.fresh.length; i += 8) {
      await Promise.all(p.fresh.slice(i, i + 8).map(async (t) => {
        try {
          await ctx.send!(t.uid, [buildPhotoMessage(job.title, t.name, t.sure, t.pending, t.others, url)]);
          sent++;
          const rec = await ctx.admin.from("photo_notified").upsert({ job_id: job.id, club_name: t.club, person_key: t.key, sent_at: new Date(now).toISOString() }, { onConflict: "job_id,club_name,person_key" });
          if (rec.error) console.error("照片通知紀錄寫入失敗", String(rec.error.message || "").slice(0, 80));
        } catch (e) { failed++; console.error("照片通知失敗", String((e && (e as Any).message) || "").slice(0, 80)); }
      }));
    }
    console.log("活動照片通知", JSON.stringify({ job: job.id, targets: p.fresh.length, sent, failed, unbound: p.unbound.length }));
    return { ...base, sent, failed, jobs: (await listJobs(ctx, club)).jobs };
  }
  return ctx.fail("BAD_REQUEST");
}

// ---------- 社友（LINE）：我的活動照片 ----------
// 我看得到的人＝我自己＋社友庫裡互為寶(尊)眷、而且「沒有綁 LINE」的家人（有綁的家人自己看自己的）
async function myPeople(ctx: JobCtx, me: { club: string; key: string; name: string }) {
  const list: Any[] = ((await ctx.members())[me.club] || []).filter((m: Any) => m && m.name);
  const fam = ctx.family(list, me.key, me.name);
  let bound = new Set<string>();
  if (fam.length) {
    const { data, error } = await ctx.admin.from("line_bindings").select("person_key").eq("club_name", me.club);
    if (error) dbFail(ctx, error);
    bound = new Set((data || []).map((r: Any) => String(r.person_key)));
  }
  const nameOf = (k: string) => { const m = list.find((x) => personKey(x) === k); return m ? String(m.name) : k.split("|")[0]; };
  return [{ key: me.key, name: me.name, me: true }].concat(fam.filter((k) => k !== me.key && !bound.has(k)).map((k) => ({ key: k, name: nameOf(k), me: false })));
}
export async function photoMine(action: string, body: Any, ctx: JobCtx, me: { club: string; key: string; name: string }): Promise<Any> {
  const people = await myPeople(ctx, me);
  const keys = people.map((p) => p.key);

  if (action === "photo_my_answer") {
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0 || typeof body.yes !== "boolean") ctx.fail("BAD_REQUEST");
    const { data: row, error } = await ctx.admin.from("photo_matches").select("id,job_id,club_name,person_key").eq("id", id).maybeSingle();
    if (error) dbFail(ctx, error);
    if (!row || row.club_name !== me.club || !keys.includes(row.person_key)) ctx.fail("PHOTO_NOT_FOUND");      // 只能回答自己（或沒綁 LINE 的家人）的照片
    const up = await ctx.admin.from("photo_matches").update({ status: body.yes ? "yes" : "no", decided_at: new Date(ctx.now || Date.now()).toISOString() }).eq("id", id);
    if (up.error) dbFail(ctx, up.error);
    return { ok: true, id, status: body.yes ? "yes" : "no" };
  }
  if (action !== "photo_my") ctx.fail("BAD_REQUEST");

  let on = false;
  try { on = (await enabledClubs(ctx)).has(me.club); } catch (e) { if ((e as Any).code !== "PHOTO_TABLE_MISSING") throw e; }
  if (!on) return { ok: true, enabled: false, jobs: [] };
  const rows = await pageAll(ctx, () => ctx.admin.from("photo_matches").select("id,job_id,person_key,file_id,file_name,status,face").eq("club_name", me.club).in("person_key", keys).order("id", { ascending: true }));
  const jobIds = [...new Set(rows.map((r) => String(r.job_id)))];
  let jobs: Any[] = [];
  if (jobIds.length) {
    const { data, error } = await ctx.admin.from("photo_jobs").select("id,title,created_at,sent_at,folder_id").in("id", jobIds);
    if (error) dbFail(ctx, error);
    jobs = (data || []).filter((j: Any) => !!j.sent_at).sort((a: Any, b: Any) => (a.created_at < b.created_at ? 1 : -1));     // 還沒按「發送通知」的活動不顯示
  }
  const face = (f: Any) => (f && typeof f === "object" ? { x: Number(f.x) || 0, y: Number(f.y) || 0, w: Number(f.w) || 0, h: Number(f.h) || 0 } : null);
  return {
    ok: true, enabled: true,
    jobs: jobs.map((j) => ({
      id: j.id, title: j.title, at: j.created_at,
      people: people.map((p) => {
        const mine = rows.filter((r) => r.job_id === j.id && r.person_key === p.key && r.status !== "no");
        return {
          key: p.key, name: p.name, me: p.me,
          photos: mine.filter((r) => r.status !== "pending").map((r) => ({ id: r.id, file: r.file_id, name: r.file_name || "" })),
          ask: mine.filter((r) => r.status === "pending").map((r) => ({ id: r.id, file: r.file_id, name: r.file_name || "", face: face(r.face) })),
        };
      }).filter((p) => p.me || p.photos.length || p.ask.length),
    })),
  };
}

// ---------- 運算程式比對完成後呼叫：地區的活動通知系統管理者（行事曆後台「⑥」指定的人）去按發送 ----------
export async function photoJobDone(ctx: JobCtx, id: unknown): Promise<Any> {
  const job = await getJob(ctx, id);
  if (job.scope !== "district" || !ctx.send) return { ok: true, sent: 0 };
  const { data, error } = await ctx.admin.from("calendar_settings").select("value").eq("key", "backup_notify").maybeSingle();
  if (error) return { ok: true, sent: 0 };
  let list: Any[] = [];
  try { list = JSON.parse(String((data && data.value) || "[]")); } catch (_e) { list = []; }
  if (!Array.isArray(list) || !list.length) return { ok: true, sent: 0 };
  const sum = summarize(await matchRows(ctx, [job.id])).get(job.id);
  const text = job.status === "failed"
    ? `📷 活動照片比對失敗：「${job.title}」\n${String(job.error || "").slice(0, 200)}\n\n請到行事曆後台「⑦ 活動照片找人」查看，可以按「重新比對」。`
    : `📷 活動照片比對完成：「${job.title}」\n共 ${Number(job.total_photos) || 0} 張照片，找到 ${sum ? sum.people.size : 0} 位社友。\n\n請到行事曆後台「⑦ 活動照片找人」確認後按「發送通知」，社友才會收到。`;
  let sent = 0;
  for (const p of list.slice(0, 20)) {
    const b = await ctx.admin.from("line_bindings").select("line_user_id").eq("club_name", String((p && p.club) || "")).eq("person_key", String((p && p.key) || "")).maybeSingle();
    const uid = b && b.data ? String(b.data.line_user_id || "") : "";
    if (!uid) continue;
    try { await ctx.send(uid, [{ type: "text", text }]); sent++; } catch (e) { console.error("比對完成通知失敗", String((e && (e as Any).message) || "").slice(0, 80)); }
  }
  return { ok: true, sent };
}
