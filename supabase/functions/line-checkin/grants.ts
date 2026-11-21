// 全球獎助金查詢：讀取共用專案 Rotary-Shared 的 global_grants（全世界扶輪社正在募款的 Global Grants 計畫）。
// 規格見專案根目錄「讀取Rotary-Shared資料說明.md」。
//   - 只讀不寫：這個檔案只用 select，不可以新增、修改、刪除 global_grants（下次爬蟲執行會覆蓋）。
//   - 連線（ctx.shared）用的是 Rotary-Shared 的公開金鑰（publishable）：資料表已設成公開唯讀，寫入會被資料庫擋下。null＝這個地區關閉。
//   - 身分由 lib.ts 先用社的登入密碼確認過才會進來；資料只經過這裡傳給畫面，不寫進任何資料表或紀錄檔。
//   - 查詢失敗時不把原始錯誤訊息傳給前端（可能含網址或金鑰片段），只回固定代碼。
// deno-lint-ignore-file no-explicit-any
type Any = any;

export interface GrantsCtx {
  shared: Any;                                         // supabase-js（Rotary-Shared）；沒設定 secrets 時是 null／undefined
  fail: (code: string, message?: string) => never;
}

// 清單用的欄位：不含長篇說明（單筆最長約 28,000 字），含聯絡人（負責人決定清單上直接顯示）
const LIST_COLUMNS =
  "project_id,title,country,country_zh,region_zh,areas_of_focus_zh,district,host_club," +
  "total_budget,status_zh,remaining_amount,intl_partner,intl_partner_district,listed_date,removed_from_list," +
  "host_contact_name,host_contact_email,intl_contact_name,intl_contact_email";
// 詳細頁與匯出 Excel 用的欄位：清單的欄位，再加上長篇說明與認捐明細
const DETAIL_COLUMNS = LIST_COLUMNS +
  ",rotary_year,location,region,areas_of_focus,status,description,description_zh," +
  "host_partner,pledges,pledge_count,trf_requested,detail_url,last_changed,updated_at";

const PAGE = 1000;              // Supabase 單次查詢上限
export const EXPORT_PAGE = 100; // 匯出含長篇說明，一次 100 筆、由前端分批取（避免單次回應太大）

// 使用者輸入的文字放進 .or() / .ilike() 之前先清掉特殊符號，避免逗號、括號、百分比符號改變查詢條件
function safeText(text: unknown) {
  return String(text == null ? "" : text).replace(/[,()%*\\"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 50);
}

// 篩選條件只有這一份：清單（grants_list）與匯出（grants_export）共用，確保「畫面上看到幾筆，就匯出幾筆」
function applyFilters(q: Any, body: Any) {
  q = q.is("removed_from_list", null);                           // 已從來源網站下架的不列
  if (body.onlyOpen) q = q.gt("remaining_amount", 0);            // 只看還在募款的（不要比對狀態文字）
  const country = safeText(body.country);
  if (country) q = q.eq("country", country);
  const region = safeText(body.region);
  if (region) q = q.eq("region_zh", region);
  const focus = safeText(body.focus);
  if (focus) q = q.ilike("areas_of_focus_zh", `%${focus}%`);
  const k = safeText(body.keyword);
  if (k) {
    q = q.or(["project_id", "title", "country_zh", "location", "host_club", "description_zh", "description"]
      .map((c) => `${c}.ilike.%${k}%`).join(","));
  }
  return q;
}
// 固定的排序（上架日期新的在前，同一天依計畫編號），分批取時順序才不會亂
const sorted = (q: Any) => q.order("listed_date", { ascending: false, nullsFirst: false }).order("project_id", { ascending: true });

export async function handleGrants(action: string, body: Any, ctx: GrantsCtx) {
  const { shared, fail } = ctx;
  if (!shared) fail("GRANTS_NOT_CONFIGURED");
  const readFail = (error: Any): never => {
    console.error("讀取 Rotary-Shared 失敗", String((error && error.code) || ""));      // 只記代碼，不記訊息內容
    return fail("GRANTS_READ_FAILED");
  };
  const run = async (q: Any) => {
    try { const r = await q; if (r.error) readFail(r.error); return r.data; }
    catch (e) { if (e && (e as Any).code && typeof (e as Any).code === "string" && /^GRANTS_/.test((e as Any).code)) throw e; return readFail(null); }
  };

  // ---------- 清單（可帶篩選）；withOptions 時另外回傳下拉選單的選項與資料更新時間 ----------
  if (action === "grants_list") {
    const grants: Any[] = [];
    for (let from = 0; ; from += PAGE) {
      const rows = await run(sorted(applyFilters(shared.from("global_grants").select(LIST_COLUMNS), body)).range(from, from + PAGE - 1));
      grants.push(...(rows || []));
      if (!rows || rows.length < PAGE) break;
    }
    const out: Any = { ok: true, grants };
    if (body.withOptions) {
      const opt: Any[] = [];
      for (let from = 0; ; from += PAGE) {
        const rows = await run(shared.from("global_grants").select("country,country_zh,region_zh").is("removed_from_list", null).order("project_id", { ascending: true }).range(from, from + PAGE - 1));
        opt.push(...(rows || []));
        if (!rows || rows.length < PAGE) break;
      }
      const countries = new Map<string, { value: string; label: string; count: number }>();
      const regions = new Map<string, number>();
      for (const r of opt) {
        if (r.country) { const c = countries.get(r.country) || { value: r.country, label: r.country_zh || r.country, count: 0 }; c.count++; countries.set(r.country, c); }
        if (r.region_zh) regions.set(r.region_zh, (regions.get(r.region_zh) || 0) + 1);
      }
      out.total = opt.length;
      out.countries = [...countries.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "zh-Hant"));
      out.regions = [...regions.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
      const last = await run(shared.from("global_grants").select("updated_at").order("updated_at", { ascending: false }).limit(1));
      out.updatedAt = (last && last[0] && last[0].updated_at) || null;
    }
    return out;
  }

  // ---------- 匯出 Excel 用：與清單相同的篩選條件，回傳完整欄位；一次 100 筆，next 不是 null 就再取下一批 ----------
  if (action === "grants_export") {
    const offset = Math.max(0, Math.floor(Number(body.offset) || 0));
    const rows = await run(sorted(applyFilters(shared.from("global_grants").select(DETAIL_COLUMNS), body)).range(offset, offset + EXPORT_PAGE - 1));
    const grants = rows || [];
    return { ok: true, grants, next: grants.length === EXPORT_PAGE ? offset + EXPORT_PAGE : null };
  }

  // ---------- 和本地區有關的計畫：主辦社／國際夥伴社屬於這個地區，或這個地區有認捐 ----------
  if (action === "grants_related") {
    const district = String(body.district || "");
    if (!/^\d{3,5}$/.test(district)) fail("GRANTS_BAD_DISTRICT");          // 地區號碼是文字，只接受數字
    const asPartner = await run(sorted(shared.from("global_grants").select(LIST_COLUMNS)
      .or(`district.eq.${district},intl_partner_district.eq.${district}`)).range(0, PAGE - 1));
    // pledges 是 JSON 陣列，鍵名是中文「地區」
    const asDonor = await run(sorted(shared.from("global_grants").select(LIST_COLUMNS)
      .filter("pledges", "cs", JSON.stringify([{ "地區": district }]))).range(0, PAGE - 1));
    return { ok: true, district, asPartner: asPartner || [], asDonor: asDonor || [] };
  }

  // ---------- 單一計畫（詳細頁） ----------
  if (action === "grants_get") {
    const id = String(body.projectId || "");
    if (!/^G-\d{1,10}$/.test(id)) fail("GRANTS_BAD_ID");
    const data = await run(shared.from("global_grants").select(DETAIL_COLUMNS).eq("project_id", id).maybeSingle());
    if (!data) fail("GRANTS_NOT_FOUND");
    return { ok: true, grant: data };
  }

  return fail("BAD_REQUEST");
}
