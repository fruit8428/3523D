// 社友改名後搬移紀錄（club_member_rename）：把關規則。真正的搬移在資料庫函式 member_rename_move（已在 3521 用交易實測）。
// 執行：deno run --no-check --node-modules-dir=none -A supabase/tests/member_rename.ts
import { handle } from "../functions/line-checkin/lib.ts";
const ok = (name: string, cond: boolean) => { console.log((cond ? "✅ " : "❌ ") + name); if (!cond) Deno.exitCode = 1; };
const calls: any[] = [];
let rpcError: any = null;
const state = { members: { 松山社: [{ id: 1, name: "楊富中", nickname: "DG Fruit" }, { id: 2, name: "林玉芝", nickname: "Sherry" }] }, auth: { clubPasswords: { 松山社: "pw1" } } };
const admin: any = {
  from() { const b: any = { select() { return b; }, eq() { return b; }, maybeSingle() { return b; }, then(res: any) { res({ data: { cats: [], divs: [], orders: {}, members: state.members, auth: state.auth }, error: null }); } }; return b; },
  rpc: async (fn: string, args: any) => { calls.push({ fn, args }); return rpcError ? { data: null, error: rpcError } : { data: { binding: 1, roles: 1 }, error: null }; },
};
const deps: any = { admin, defaultClubPassword: "" };
const call = async (o: any) => { try { return await handle({ action: "club_member_rename", club: "松山社", clubPassword: "pw1", ...o }, deps); } catch (e) { return { ok: false, code: (e as any).code || String(e) }; } };
const codeOf = (r: any) => r.code;

let r = await call({ oldKey: "楊富中|PP Fruit", newKey: "楊富中|DG Fruit" });
ok("正常：呼叫資料庫函式，帶社友庫裡的新姓名與 Nick Name，回傳搬了幾筆", r.ok && r.moved.binding === 1 && calls.length === 1 && calls[0].fn === "member_rename_move" && calls[0].args.p_old === "楊富中|PP Fruit" && calls[0].args.p_new === "楊富中|DG Fruit" && calls[0].args.p_name === "楊富中" && calls[0].args.p_nick === "DG Fruit" && calls[0].args.p_club === "松山社");
calls.length = 0;
r = await call({ oldKey: "楊富中|PP Fruit", newKey: "楊富中|DG Fruit", clubPassword: "wrong" });
ok("社密碼錯誤：擋下、不呼叫資料庫", codeOf(r) === "CLUB_AUTH_FAILED" && calls.length === 0);
r = await call({ oldKey: "楊富中|PP Fruit", newKey: "不存在|X" });
ok("新名字不在社友庫：擋下", codeOf(r) === "MEMBER_RENAME_INVALID" && calls.length === 0);
r = await call({ oldKey: "林玉芝|Sherry", newKey: "楊富中|DG Fruit" });
ok("舊名字還在社友庫（是另一位社友）：擋下，不能把別人的紀錄搬給自己", codeOf(r) === "MEMBER_RENAME_INVALID" && calls.length === 0);
r = await call({ oldKey: "楊富中|DG Fruit", newKey: "楊富中|DG Fruit" });
ok("新舊相同、或沒帶：擋下", codeOf(r) === "MEMBER_RENAME_INVALID" && codeOf(await call({ newKey: "楊富中|DG Fruit" })) === "MEMBER_RENAME_INVALID" && calls.length === 0);
rpcError = { message: "MEMBER_RENAME_CONFLICT" };
ok("兩個名字各自都綁了 LINE：回 MEMBER_RENAME_CONFLICT", codeOf(await call({ oldKey: "楊富中|PP Fruit", newKey: "楊富中|DG Fruit" })) === "MEMBER_RENAME_CONFLICT");
rpcError = { message: "Could not find the function public.member_rename_move", code: "PGRST202" };
ok("資料庫還沒安裝函式：回 TABLE_MISSING", codeOf(await call({ oldKey: "楊富中|PP Fruit", newKey: "楊富中|DG Fruit" })) === "TABLE_MISSING");
