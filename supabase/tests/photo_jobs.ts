// 活動照片找人・第二、三步：貼連結建立工作、啟動運算、執秘只能動自己社的、發送通知（沒綁 LINE 的寶尊眷併給社友、不重複）、
// 社友只看得到自己的照片、「這是您嗎」、重新比對、刪大頭照連同比對結果、比對完成通知管理者。假資料庫、假的 LINE 與 GitHub。
// 執行：deno run --no-check --node-modules-dir=none -A supabase/tests/photo_jobs.ts
import { handle } from "../functions/line-checkin/lib.ts";
import { parseFolder } from "../functions/line-checkin/photos.ts";
const ok = (name: string, cond: boolean) => { console.log((cond ? "✅ " : "❌ ") + name); if (!cond) Deno.exitCode = 1; };
const MEMBERS: any = {
  松山社: [
    { id: 1, name: "王小明", nickname: "Tony", role: "社友" },
    { id: 2, name: "李大華", nickname: "David", role: "社友" },
    { id: 3, name: "李太太", nickname: "Amy", role: "寶(尊)眷", spouseOfId: 2 },
    { id: 4, name: "陳", nickname: "C", role: "社友" },
  ],
  北區社: [{ id: 1, name: "趙", nickname: "Z", role: "社友" }],
};
const T: Record<string, any[]> = {
  photo_club_enabled: [{ club_name: "松山社" }],
  photo_jobs: [], photo_matches: [], photo_notified: [], member_portraits: [],
  line_bindings: [
    { line_user_id: "U王", club_name: "松山社", person_key: "王小明|Tony", full_name: "王小明", nickname: "Tony" },
    { line_user_id: "U李", club_name: "松山社", person_key: "李大華|David", full_name: "李大華", nickname: "David" },
    { line_user_id: "U趙", club_name: "北區社", person_key: "趙|Z", full_name: "趙", nickname: "Z" },
  ],
  calendar_settings: [{ key: "cron_secret", value: "CRON" }, { key: "backup_notify", value: JSON.stringify([{ club: "松山社", key: "王小明|Tony" }, { club: "松山社", key: "陳|C" }]) }],
};
let seq = 1;
function fake() {
  return {
    storage: { from() { return { async upload() { return { error: null }; }, async remove() { return { error: null }; }, async createSignedUrls(p: string[]) { return { data: p.map((x) => ({ path: x, signedUrl: "s" })), error: null }; } }; } },
    from(t: string) {
      T[t] ||= []; const f: any[] = []; let one = false, op = "select", payload: any = null, opt: any = null, rng: number[] | null = null, lim = 0, ord: any = null, ret = false;
      const hit = (r: any) => f.every((x) => x(r));
      const b: any = {
        select() { if (op !== "select") ret = true; return b; },
        eq(k: string, v: any) { f.push((r: any) => r[k] === v); return b; }, in(k: string, vs: any[]) { f.push((r: any) => vs.includes(r[k])); return b; },
        order(k: string, o: any) { ord = [k, !!(o && o.ascending === false)]; return b; }, limit(n: number) { lim = n; return b; }, range(a: number, z: number) { rng = [a, z]; return b; },
        maybeSingle() { one = true; return b; },
        insert(p: any) { op = "insert"; payload = p; return b; }, upsert(p: any, o: any) { op = "upsert"; payload = p; opt = o; return b; },
        update(p: any) { op = "update"; payload = p; return b; }, delete() { op = "delete"; return b; },
        then(res: any) {
          if (t === "app_storage") return res({ data: { cats: [], divs: [{ id: 1, name: "第一分區", clubs: [{ name: "松山社" }, { name: "北區社" }] }], orders: {}, members: MEMBERS, auth: { clubPasswords: { 松山社: "pw1", 北區社: "pw2" } } }, error: null });
          if (op === "delete") {
            const gone = T[t].filter(hit); T[t] = T[t].filter((r: any) => !hit(r));
            if (t === "photo_jobs") for (const g of gone) { T.photo_matches = T.photo_matches.filter((m) => m.job_id !== g.id); T.photo_notified = T.photo_notified.filter((m) => m.job_id !== g.id); }   // on delete cascade
            return res({ data: null, error: null });
          }
          if (op === "update") { T[t].filter(hit).forEach((r: any) => Object.assign(r, payload)); return res({ data: null, error: null }); }
          if (op === "insert" || op === "upsert") {
            const keys = opt && opt.onConflict ? opt.onConflict.split(",") : []; const added: any[] = [];
            for (const row of Array.isArray(payload) ? payload : [payload]) {
              const i = keys.length ? T[t].findIndex((r: any) => keys.every((k: string) => r[k] === row[k])) : -1;
              if (i < 0) { const n = { id: t === "photo_jobs" ? crypto.randomUUID() : seq++, progress: {}, total_photos: 0, error: "", sent_at: null, started_at: null, finished_at: null, ...row }; T[t].push(n); added.push(n); } else { T[t][i] = { ...T[t][i], ...row }; added.push(T[t][i]); }
            }
            return res({ data: ret ? (one ? added[0] : added) : null, error: null });
          }
          let d = T[t].filter(hit);
          if (ord) d = d.slice().sort((x: any, y: any) => (x[ord[0]] === y[ord[0]] ? 0 : (x[ord[0]] < y[ord[0]] ? -1 : 1) * (ord[1] ? -1 : 1)));
          if (rng) d = d.slice(rng[0], rng[1] + 1); else if (lim) d = d.slice(0, lim);
          res({ data: one ? d[0] || null : d, error: null });
        },
      }; return b;
    },
  };
}
const sent: any[] = [], runs: any[] = [];
let ghFail = false;
const deps: any = {
  admin: fake(), defaultClubPassword: "", calendarAdminPassword: "adminpw", liffId: "1234-abcd",
  verify: async (tok: string) => { if (!tok) throw Object.assign(new Error("x"), { code: "LINE_TOKEN_INVALID" }); return { sub: tok, name: "LINE" }; },
  push: { token: "t", sendMessages: async (to: string, m: any[]) => { sent.push({ to, m }); } },
  photoDispatch: async (i: any) => { if (ghFail) throw new Error("GitHub 401"); runs.push(i); },
};
const call = async (body: any, d: any = deps) => { try { return await handle(body, d); } catch (e) { return { ok: false, code: (e as any).code || String(e) }; } };
const adm = (a: string, o: any = {}) => call({ action: "photo_admin_job_" + a, adminPassword: "adminpw", district: "3521", ...o });
const desk = (a: string, o: any = {}, club = "松山社", pw = "pw1") => call({ action: "photo_desk_job_" + a, club, clubPassword: pw, district: "3521", ...o });
const line = (action: string, o: any = {}, tok = "U王") => call({ action, idToken: tok, ...o });
const J = (x: any) => JSON.stringify(x);
const URL1 = "https://drive.google.com/drive/mobile/folders/1GYhy19wKuxQhunvcLA0FU58-gN01ILXn?usp=sharing";
const URL2 = "https://drive.google.com/drive/u/0/folders/2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

ok("網址解析：手機版、一般版、?id= 都認得；不是 Google 雲端硬碟資料夾的不收", parseFolder(URL1) === "1GYhy19wKuxQhunvcLA0FU58-gN01ILXn" && parseFolder("https://drive.google.com/drive/folders/1GYhy19wKuxQhunvcLA0FU58-gN01ILXn") === "1GYhy19wKuxQhunvcLA0FU58-gN01ILXn" && parseFolder("https://drive.google.com/open?id=1GYhy19wKuxQhunvcLA0FU58-gN01ILXn") === "1GYhy19wKuxQhunvcLA0FU58-gN01ILXn" && parseFolder("https://example.com/folders/1GYhy19wKuxQhunvcLA0FU58-gN01ILXn") === "" && parseFolder("https://drive.google.com/file/d/abc/view") === "" && parseFolder("") === "" && parseFolder("javascript:alert(1)") === "");

// ---------- 管理者貼連結 ----------
ok("後台密碼錯誤：擋下", (await call({ action: "photo_admin_job_list", adminPassword: "x" })).code === "CAL_ADMIN_AUTH_FAILED" && (await call({ action: "photo_admin_job_add", adminPassword: "x", title: "a", url: URL1 })).code === "CAL_ADMIN_AUTH_FAILED");
ok("沒填活動名稱／網址不對：擋下，不會建立工作", (await adm("add", { title: " ", url: URL1 })).code === "PHOTO_NO_TITLE" && (await adm("add", { title: "年會", url: "https://flickr.com/x" })).code === "PHOTO_BAD_URL" && T.photo_jobs.length === 0);
let r = await adm("add", { title: "  地區年會  ", url: URL1 });
const JOB = T.photo_jobs[0];
ok("管理者貼連結：建立一筆地區工作（排隊中），並啟動 GitHub 運算（帶地區代號與工作代號）", r.ok && r.started === true && r.jobs.length === 1 && JOB.scope === "district" && JOB.club_name === "" && JOB.title === "地區年會" && JOB.folder_id === "1GYhy19wKuxQhunvcLA0FU58-gN01ILXn" && JOB.status === "queued" && JOB.created_by === "行事曆後台" && runs.length === 1 && runs[0].district === "3521" && runs[0].job_id === JOB.id);
ok("同一個資料夾再貼一次：擋下（請用重新比對）", (await adm("add", { title: "年會2", url: URL1 })).code === "PHOTO_DUPLICATE" && T.photo_jobs.length === 1);
ok("比對還沒完成：不能預覽與發送", (await adm("preview", { id: JOB.id })).code === "PHOTO_NOT_READY" && (await adm("send", { id: JOB.id, liffId: "1234-abcd" })).code === "PHOTO_NOT_READY");

// ---------- 執秘貼自己社的連結 ----------
ok("執秘：社密碼錯誤擋下；沒開放的社不能貼", (await desk("list", {}, "松山社", "x")).code === "CLUB_AUTH_FAILED" && (await desk("add", { title: "例會", url: URL2 }, "北區社", "pw2")).code === "PHOTO_CLUB_OFF");
ghFail = true;
r = await desk("add", { title: "松山社例會", url: URL2 });
ghFail = false;
const CJOB = T.photo_jobs.find((j) => j.scope === "club");
ok("執秘貼連結：建立本社的工作；GitHub 啟動失敗時工作仍然排著（started=false）", r.ok && r.started === false && !!CJOB && CJOB.club_name === "松山社" && CJOB.created_by === "報名系統（松山社）" && CJOB.status === "queued");
ok("沒設定 GitHub token 的地區：一樣可以建立工作，回報 canRun=false", (await call({ action: "photo_admin_job_list", adminPassword: "adminpw" }, { ...deps, photoDispatch: undefined })).canRun === false && r.canRun === true);
T.photo_club_enabled.push({ club_name: "北區社" });
await desk("add", { title: "北區社例會", url: URL2 }, "北區社", "pw2");
T.photo_club_enabled = T.photo_club_enabled.filter((c) => c.club_name !== "北區社");
const NJOB = T.photo_jobs.find((j) => j.club_name === "北區社");
r = await desk("list");
ok("執秘：看得到地區的活動與自己社的活動，看不到別社的", r.jobs.length === 2 && r.jobs.some((j: any) => j.id === JOB.id) && r.jobs.some((j: any) => j.id === CJOB.id) && !J(r).includes("北區社例會") && (await adm("list")).jobs.length === 3);
ok("執秘：不能刪除／重新比對／發送「地區的」或「別社的」工作", (await desk("delete", { id: JOB.id })).code === "PHOTO_JOB_NOT_FOUND" && (await desk("rerun", { id: JOB.id })).code === "PHOTO_JOB_NOT_FOUND" && (await desk("send", { id: JOB.id, liffId: "1234-abcd" })).code === "PHOTO_JOB_NOT_FOUND" && (await desk("delete", { id: NJOB.id })).code === "PHOTO_JOB_NOT_FOUND" && (await desk("delete", { id: "不是代號" })).code === "PHOTO_JOB_NOT_FOUND" && T.photo_jobs.length === 3);

// ---------- 模擬運算程式寫回結果 ----------
const put = (job: any, club: string, key: string, file: string, cls: string) => T.photo_matches.push({ id: seq++, job_id: job.id, club_name: club, person_key: key, file_id: file, file_name: file + ".JPG", score: cls === "sure" ? 0.6 : 0.4, cls, status: cls === "sure" ? "auto" : "pending", face: { x: 0.4, y: 0.2, w: 0.05, h: 0.08 } });
["f1", "f2", "f3"].forEach((f) => put(JOB, "松山社", "王小明|Tony", f, "sure")); put(JOB, "松山社", "王小明|Tony", "f9", "maybe");
["f1", "f4"].forEach((f) => put(JOB, "松山社", "李太太|Amy", f, "sure"));
put(JOB, "松山社", "陳|C", "f5", "sure");
["f6", "f7"].forEach((f) => put(JOB, "北區社", "趙|Z", f, "sure"));
Object.assign(JOB, { status: "done", total_photos: 523, finished_at: new Date().toISOString() });
r = await adm("list");
const jv = r.jobs.find((j: any) => j.id === JOB.id);
ok("管理者的清單：狀態完成、523 張、找到 4 人、確定 8 張、待確認 1 張；不列出個人", jv.status === "done" && jv.totalPhotos === 523 && jv.people === 4 && jv.sure === 8 && jv.pending === 1 && !("persons" in jv));
r = await desk("list");
const dv = r.jobs.find((j: any) => j.id === JOB.id);
ok("執秘的清單：只有自己社的統計與「誰幾張」，沒有別社的人", dv.people === 3 && dv.sure === 6 && dv.pending === 1 && dv.persons.length === 3 && dv.persons.find((p: any) => p.key === "王小明|Tony").sure === 3 && !J(r).includes("趙"));
ok("還沒按發送：社友在 LINE 看不到這個活動", (await line("photo_my")).jobs.length === 0);

// ---------- 發送通知 ----------
r = await adm("preview", { id: JOB.id });
ok("預覽：只算開放的社（3 人）；會通知 2 人（李太太沒綁 LINE＝併給李大華）；陳沒綁 LINE 也沒有家人＝列在收不到；預覽不發送", r.ok && r.people === 3 && r.targets === 2 && r.already === 0 && r.unbound.length === 1 && r.unbound[0].name === "陳" && r.canSend === true && sent.length === 0 && !JOB.sent_at);
ok("發送：沒帶 LIFF 代號擋下；這個地區沒有官方帳號 token＝PUSH_DISABLED", (await adm("send", { id: JOB.id })).code === "BAD_REQUEST" && (await call({ action: "photo_admin_job_send", adminPassword: "adminpw", id: JOB.id, liffId: "1234-abcd" }, { ...deps, push: { token: "" } })).code === "PUSH_DISABLED" && sent.length === 0);
r = await adm("send", { id: JOB.id, liffId: "1234-abcd" });
const mW = J((sent.find((s) => s.to === "U王") || {}).m), mL = J((sent.find((s) => s.to === "U李") || {}).m);
ok("發送：2 人各收到一則；沒開放的社（趙）不通知；記下已通知、活動標成已發送", r.ok && r.sent === 2 && r.failed === 0 && sent.length === 2 && !sent.some((s) => s.to === "U趙") && T.photo_notified.length === 2 && !!JOB.sent_at && JOB.sent_by === "行事曆後台");
ok("王的卡片：活動名稱、3 張、1 張請確認、看照片的連結帶活動代號", mW.includes("地區年會") && mW.includes("王小明 您好") && mW.includes("找到 3 張") && mW.includes("1 張不太確定") && mW.includes(`https://liff.line.me/1234-abcd?p=photos&job=${JOB.id}`));
ok("李的卡片：自己沒有照片，但包含寶眷李太太的 2 張", mL.includes("李大華 您好") && mL.includes("找到 2 張有您（或家人）") && mL.includes("包含：李太太"));
r = await adm("send", { id: JOB.id, liffId: "1234-abcd" });
ok("再按一次發送：已通知過的人不重複收到", r.ok && r.targets === 0 && r.already === 2 && r.sent === 0 && sent.length === 2);

// ---------- 社友在 LINE 看照片 ----------
ok("沒綁 LINE：NOT_BOUND；沒帶登入：擋下", (await line("photo_my", {}, "U陌生")).code === "NOT_BOUND" && (await line("photo_my", {}, "")).code === "LINE_TOKEN_INVALID");
r = await line("photo_my");
const mine = r.jobs[0].people[0];
ok("王：看到 1 個活動；自己的 3 張與 1 張待確認（含臉的位置）；看不到別人的", r.enabled && r.jobs.length === 1 && r.jobs[0].title === "地區年會" && r.jobs[0].people.length === 1 && mine.me && mine.photos.map((p: any) => p.file).join() === "f1,f2,f3" && mine.ask.length === 1 && mine.ask[0].file === "f9" && mine.ask[0].face.w === 0.05 && !J(r).includes("f4") && !J(r).includes("f5") && !J(r).includes("李太太"));
r = await line("photo_my", {}, "U李");
ok("李：自己 0 張，另有一區是沒綁 LINE 的寶眷李太太（2 張）", r.jobs[0].people.length === 2 && r.jobs[0].people[0].me && r.jobs[0].people[0].photos.length === 0 && r.jobs[0].people[1].name === "李太太" && r.jobs[0].people[1].photos.length === 2);
ok("沒開放的社（趙）：顯示尚未開放，沒有照片", (await line("photo_my", {}, "U趙")).enabled === false && (await line("photo_my", {}, "U趙")).jobs.length === 0);
const askId = mine.ask[0].id, amyId = T.photo_matches.find((m) => m.person_key === "李太太|Amy").id;
ok("回答格式不對：擋下；不能回答別人的照片", (await line("photo_my_answer", { id: askId })).code === "BAD_REQUEST" && (await line("photo_my_answer", { id: "x", yes: true })).code === "BAD_REQUEST" && (await line("photo_my_answer", { id: amyId, yes: false })).code === "PHOTO_NOT_FOUND" && (await line("photo_my_answer", { id: askId, yes: true }, "U趙")).code === "PHOTO_NOT_FOUND");
r = await line("photo_my_answer", { id: askId, yes: true });
ok("王按「是」：那張歸到他的照片，不再詢問", r.ok && r.status === "yes" && (await line("photo_my")).jobs[0].people[0].photos.length === 4 && (await line("photo_my")).jobs[0].people[0].ask.length === 0);
await line("photo_my_answer", { id: T.photo_matches.find((m) => m.person_key === "王小明|Tony" && m.file_id === "f2").id, yes: false });
ok("王對「確定」的照片按「不是我」：從他的照片拿掉", (await line("photo_my")).jobs[0].people[0].photos.map((p: any) => p.file).join() === "f1,f3,f9");
ok("李可以幫沒綁 LINE 的李太太回答", (await line("photo_my_answer", { id: amyId, yes: false }, "U李")).ok && (await line("photo_my", {}, "U李")).jobs[0].people[1].photos.length === 1);
T.line_bindings.push({ line_user_id: "U李太", club_name: "松山社", person_key: "李太太|Amy", full_name: "李太太", nickname: "Amy" });
r = await line("photo_my", {}, "U李");
ok("李太太自己綁了 LINE 之後：李不再看得到她的照片，她自己看得到", r.jobs.length === 0 && (await line("photo_my_answer", { id: amyId, yes: true }, "U李")).code === "PHOTO_NOT_FOUND" && (await line("photo_my", {}, "U李太")).jobs[0].people[0].photos.length === 1);
r = await adm("preview", { id: JOB.id });
ok("之後再預覽：新綁 LINE 的李太太是新的通知對象（1 人）；李自己沒有照片所以不再列入，已通知的剩王 1 人", r.targets === 1 && r.already === 1);

// ---------- 重新比對、刪除 ----------
Object.assign(JOB, { status: "running", started_at: new Date().toISOString() });
ok("比對中：不能重新比對", (await adm("rerun", { id: JOB.id })).code === "PHOTO_RUNNING");
Object.assign(JOB, { started_at: new Date(Date.now() - 2 * 3600_000).toISOString() });
const before = T.photo_matches.length, nRuns = runs.length;
r = await adm("rerun", { id: JOB.id });
ok("卡住超過一小時：可以重新比對——回到排隊、再啟動一次、原有結果（含社友按過的是／不是）保留", r.ok && r.started === true && JOB.status === "queued" && runs.length === nRuns + 1 && runs[nRuns].job_id === JOB.id && T.photo_matches.length === before && T.photo_matches.find((m) => m.id === askId).status === "yes");
Object.assign(JOB, { status: "done" });
T.member_portraits.push({ id: "p1", club_name: "松山社", person_key: "王小明|Tony", path: "a.jpg", created_at: "2026-11-22T00:00:00Z" }, { id: "p2", club_name: "松山社", person_key: "王小明|Tony", path: "b.jpg", created_at: "2026-11-22T00:00:00Z" });
await call({ action: "photo_desk_delete", club: "松山社", clubPassword: "pw1", personKey: "王小明|Tony", id: "p1" });
ok("刪掉一張大頭照（還有別張）：比對結果保留", T.photo_matches.some((m) => m.person_key === "王小明|Tony"));
await call({ action: "photo_desk_delete", club: "松山社", clubPassword: "pw1", personKey: "王小明|Tony" });
ok("大頭照全部刪除（收回同意）：他的比對結果一起刪掉，別人的不受影響", !T.photo_matches.some((m) => m.person_key === "王小明|Tony") && T.photo_matches.some((m) => m.person_key === "李太太|Amy") && (await line("photo_my")).jobs.length === 0);

// ---------- 比對完成通知管理者 ----------
const n0 = sent.length;
ok("比對完成通知：密碼錯誤擋下", (await call({ action: "photo_job_done", secret: "x", id: JOB.id })).code === "CAL_CRON_AUTH_FAILED" && sent.length === n0);
r = await call({ action: "photo_job_done", secret: "CRON", id: JOB.id });
ok("比對完成通知：傳給後台「⑥」指定且有綁 LINE 的人，說明要去按發送", r.ok && r.sent === 1 && sent.length === n0 + 1 && sent[n0].to === "U王" && J(sent[n0].m).includes("比對完成") && J(sent[n0].m).includes("地區年會") && J(sent[n0].m).includes("發送通知"));
ok("執秘貼的活動比對完成：不通知管理者", (await call({ action: "photo_job_done", secret: "CRON", id: CJOB.id })).sent === 0 && sent.length === n0 + 1);
Object.assign(JOB, { status: "failed", error: "資料夾沒有開放，請攝影師改成知道連結的人都能看" });
r = await call({ action: "photo_job_done", secret: "CRON", id: JOB.id });
ok("比對失敗：通知管理者原因", r.sent === 1 && J(sent[sent.length - 1].m).includes("比對失敗") && J(sent[sent.length - 1].m).includes("資料夾沒有開放"));

// ---------- 執秘發送自己社的活動、刪除 ----------
put(CJOB, "松山社", "李大華|David", "g1", "sure"); Object.assign(CJOB, { status: "done" });
const n1 = sent.length;
r = await desk("send", { id: CJOB.id, liffId: "1234-abcd" });
ok("執秘可以發送自己社的活動", r.ok && r.sent === 1 && sent.length === n1 + 1 && sent[n1].to === "U李" && !!CJOB.sent_at && CJOB.sent_by === "報名系統（松山社）");
r = await desk("delete", { id: CJOB.id });
ok("執秘刪除自己社的活動：工作、比對結果、通知紀錄一起刪掉", r.ok && !T.photo_jobs.some((j) => j.id === CJOB.id) && !T.photo_matches.some((m) => m.job_id === CJOB.id) && !T.photo_notified.some((m) => m.job_id === CJOB.id));
r = await adm("delete", { id: JOB.id });
ok("管理者刪除地區的活動", r.ok && r.jobs.length === 1 && T.photo_matches.filter((m) => m.job_id === JOB.id).length === 0);
