// 社友名單排序（CheckinCore.sortMembers）與 LINE 綁定選名字清單（line-checkin 的 members 動作）。
// 執行：deno run --no-check --node-modules-dir=none -A supabase/tests/member_sort.ts
import { handle } from "../functions/line-checkin/lib.ts";
const Core = (globalThis as any).CheckinCore;
const ok = (name: string, cond: boolean) => { console.log((cond ? "✅ " : "❌ ") + name); if (!cond) Deno.exitCode = 1; };

const MEMBERS = [
  { id: 1, name: "陳大文", nickname: "Zack", role: "社友" },
  { id: 2, name: "林秘書", nickname: "Yvonne", role: "Ｓ" },
  { id: 3, name: "王社長", nickname: "Xavier", role: "P" },
  { id: 4, name: "張三", nickname: "alex", role: "理事" },
  { id: 5, name: "李四", nickname: "Bob", role: "PP" },
  { id: 6, name: "王太太", nickname: "Amy", role: "寶(尊)眷", spouseOfId: 3 },
  { id: 7, name: "張太太", nickname: "Zoe", role: "寶(尊)眷", spouseOfId: 4 },
  { id: 8, name: "無名氏", nickname: "", role: "社友" },
  { id: 9, name: "孤單眷", nickname: "Ann", role: "寶(尊)眷", spouseOfId: 99 },
  { id: 10, name: "老秘書", nickname: "Ken", role: "秘書" },
];
const WANT = "王社長,王太太,老秘書,林秘書,張三,張太太,李四,陳大文,無名氏,孤單眷";

ok("職務判斷：P／Ｐ／p／社長＝0，S／Ｓ／秘書＝1，PP、PE、執秘＝2",
  ["P", "Ｐ", " p ", "社長"].every((r) => Core.memberRoleRank({ role: r }) === 0) &&
  ["S", "Ｓ", "秘書"].every((r) => Core.memberRoleRank({ role: r }) === 1) &&
  ["PP", "PE", "執秘", "社友", ""].every((r) => Core.memberRoleRank({ role: r }) === 2));
const before = MEMBERS.map((m) => m.id).join();
ok("排序：P、S 在前，其餘依 Nick Name（不分大小寫），寶尊眷跟在社友下方", Core.sortMembers(MEMBERS).map((m: any) => m.name).join() === WANT);
ok("排序不改原陣列", MEMBERS.map((m) => m.id).join() === before);

// 實際名單的寫法：P／S 寫在 Nick Name 開頭，職務欄是「社長」「社友」等
const REAL = [
  { id: 1, name: "李永曄", nickname: "P Robert", role: "社長" },
  { id: 2, name: "崔敬福", nickname: "PP Fred", role: "扶輪基金主委" },
  { id: 3, name: "楊富中", nickname: "PP Fruit", role: "理事" },
  { id: 4, name: "林玉芝", nickname: "Sherry", role: "寶(尊)眷", spouseOfId: 3 },
  { id: 5, name: "李瑞琦", nickname: "PP Rachel", role: "理事" },
  { id: 6, name: "李彥德", nickname: "S Three M", role: "社友" },
];
ok("Nick Name 開頭是 S（職務欄寫社友）也排第二", Core.sortMembers(REAL).map((m: any) => m.nickname).join(" / ") === "P Robert / S Three M / PP Fred / PP Fruit / Sherry / PP Rachel");
ok("Nick Name 開頭判斷：「Ｓ Kevin」「s kevin」＝S；「Sherry」「PP Fred」「IPP Tom」、只有「P」一個字都不算", Core.memberRoleRank({ nickname: "Ｓ Kevin" }) === 1 && Core.memberRoleRank({ nickname: "s kevin" }) === 1 && Core.memberRoleRank({ nickname: "Sherry" }) === 2 && Core.memberRoleRank({ nickname: "PP Fred" }) === 2 && Core.memberRoleRank({ nickname: "IPP Tom" }) === 2 && Core.memberRoleRank({ nickname: "P" }) === 2 && Core.memberRoleRank({ nickname: "P Robert" }) === 0);
ok("排序時去掉職稱字首：Adam 排在 PP Zed 之前、PE Bill 排在 Carl 之前", Core.sortMembers([{ id: 1, name: "z", nickname: "PP Zed" }, { id: 2, name: "c", nickname: "Carl" }, { id: 3, name: "a", nickname: "Adam" }, { id: 4, name: "b", nickname: "PE Bill" }]).map((m: any) => m.nickname).join() === "Adam,PE Bill,Carl,PP Zed");

// LINE 綁定選名字：雲端回傳的清單照同樣順序，已綁定的人仍標 taken
const admin = { from(t: string) {
  const q: any = { select() { return q; }, eq() { return q; },
    maybeSingle() { return Promise.resolve({ data: { cats: [], divs: [], orders: {}, members: { 甲社: MEMBERS }, auth: {} }, error: null }); },
    then(res: any) { res({ data: t === "line_bindings" ? [{ person_key: "李四|Bob" }] : [], error: null }); } };
  return q; } };
const r = await handle({ action: "members", club: "甲社" }, { admin, verify: async () => ({}) as any, broadcast: async () => {}, defaultClubPassword: "" } as any);
ok("LINE 綁定名單：照同樣順序", r.ok && r.members.map((m: any) => m.name).join() === WANT);
ok("LINE 綁定名單：已綁定的人標示 taken，其他欄位不變", r.members.find((m: any) => m.name === "李四").taken === true && r.members.find((m: any) => m.name === "王社長").key === "王社長|Xavier" && !("id" in r.members[0]));
