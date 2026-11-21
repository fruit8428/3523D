// 全球獎助金查詢：全世界扶輪社正在募款的 Global Grants 計畫（資料在共用專案 Rotary-Shared，來源 matchinggrants.org）。
// 規格見「讀取Rotary-Shared資料說明.md」。
//   - 瀏覽器不直接連 Rotary-Shared：一律呼叫本地區的雲端小程式 line-checkin（grants_* 動作，用社的登入密碼確認）。
//   - 只讀不寫。資料（含聯絡人姓名與 Email）只放在記憶體，不可存進 app_storage 或 localStorage；
//     這個檔案的任何操作都不呼叫 saveToStorage()。
//   - 所有文字都來自外部網站（任何人都能填寫），放進畫面前一律經過 ggE()。
// 全域名稱以 gg 開頭（按鈕用 onclick 呼叫，所以都必須是全域函式）。
var gg = null;            // 目前的查詢畫面資料（只在記憶體）；沒開過＝null
var ggKwTimer = null;

var GG_ERR = {
    CLUB_AUTH_FAILED: '無法確認貴社身分。貴社若還沒有設定登入密碼，請先完成首次登入設定後再試。',
    GRANTS_NOT_CONFIGURED: '本地區尚未開放全球獎助金查詢。',
    GRANTS_READ_FAILED: '獎助金資料暫時無法讀取，請稍後再試。',
    GRANTS_NOT_FOUND: '找不到這個計畫，可能已從來源網站移除。',
    GRANTS_BAD_ID: '查詢條件不正確。',
    GRANTS_BAD_DISTRICT: '查詢條件不正確。',
    BAD_REQUEST: '雲端小程式還不認得這個功能，請系統管理者重新部署。',
    LINE_NOT_CONFIGURED: '雲端小程式尚未啟用。',
    NETWORK: '網路連線不穩，請稍後再試。'
};
// 扶輪七大服務重點（資料裡的中文名稱是固定的；一個計畫可能有多個，用「包含」比對）
var GG_FOCUS = ['疾病預防與治療', '水資源、衛生設施與個人衛生', '基礎教育與識字', '社區經濟發展', '母親與兒童健康', '環境保護', '締造和平與預防衝突'];
// 匯出 Excel 的欄位（順序比照爬蟲產出的 Excel，方便兩邊對照）
var GG_XLSX_COLS = [
    ['計畫編號', 'project_id', 12], ['計畫名稱', 'title', 32], ['國家', 'country_zh', 12], ['地點', 'location', 18], ['地區', 'district', 8],
    ['主辦扶輪社', 'host_club', 26], ['總金額', 'total_budget', 12, 'num'], ['狀態', 'status_zh', 16], ['尚缺金額', 'remaining_amount', 12, 'num'],
    ['詳細頁網址', 'detail_url', 40], ['區域', 'region_zh', 10], ['服務重點', 'areas_of_focus_zh', 30], ['計畫說明', 'description', 60], ['計畫說明（中文）', 'description_zh', 60],
    ['主辦夥伴社', 'host_partner', 36], ['國際夥伴社', 'intl_partner', 36], ['國際夥伴地區', 'intl_partner_district', 12], ['已認捐明細', 'pledges', 46, 'pledges'],
    ['已認捐筆數', 'pledge_count', 10, 'num'], ['向扶輪基金會申請金額', 'trf_requested', 14, 'num'], ['上架日期', 'listed_date', 12],
    ['主辦聯絡人', 'host_contact_name', 20], ['主辦聯絡Email', 'host_contact_email', 30], ['國際夥伴聯絡人', 'intl_contact_name', 20], ['國際夥伴聯絡Email', 'intl_contact_email', 30]
];
var GG_CELL_MAX = 32000;      // Excel 單一儲存格上限 32,767 字

function ggErr(code) { return GG_ERR[code] || '雲端暫時無法處理，請稍後再試。'; }
function ggE(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function ggUsd(n) { var v = Number(n); return Number.isFinite(v) ? '$' + Math.round(v).toLocaleString('en-US') : ''; }
function ggDistrictCode() { return String((typeof DISTRICT === 'object' && DISTRICT && DISTRICT.code) || ''); }
// Email 格式正常才做成 mailto 連結（內容來自外部網站，不能直接當網址用）
function ggMail(email) {
    var s = String(email || '').trim();
    if (!s) return '';
    if (!/^[^\s@<>"'`:,;()\\]+@[^\s@<>"'`:,;()\\]+\.[^\s@<>"'`:,;()\\]+$/.test(s)) return '<span class="break-all">' + ggE(s) + '</span>';
    return '<a href="mailto:' + ggE(s) + '" class="text-sky-700 underline break-all">' + ggE(s) + '</a>';
}
function ggContact(name, email) {
    var n = String(name || '').trim(), m = ggMail(email);
    if (!n && !m) return '';
    return '<span class="text-slate-500">聯絡人：</span>' + ggE(n) + (n && m ? '　' : '') + m;
}
function ggDay(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    try { return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }); } catch (e) { return d.toISOString().slice(0, 10); }
}
function ggBlank(club) {
    return { club: club, tab: 'all', f: { keyword: '', country: '', region: '', focus: '', onlyOpen: true }, list: null, countries: [], regions: [], total: null,
        updatedAt: null, loading: false, err: '', seq: 0, related: null, relLoading: false, relErr: '', shown: [], detail: null, zh: true, exporting: false, at: 0, scroll: 0 };
}

// ---------- 入口按鈕：地區設定檔 grantsEnabled 為 true 才顯示（真正的把關在雲端：secrets 有沒有設定） ----------
function ggInitButton() {
    var btn = document.getElementById('globalGrantsBtn');
    if (btn) btn.classList.toggle('hidden', !(typeof DISTRICT === 'object' && DISTRICT && DISTRICT.grantsEnabled));
}

// ---------- 開啟／關閉 ----------
function openGlobalGrants() {
    var club = typeof selectedClubName === 'string' ? selectedClubName : '';
    if (!club) { alert('請先選擇社別。'); return; }
    // 同一社、10 分鐘內再打開：沿用記憶體裡的結果（資料不常變動），不重新讀取
    var reuse = gg && gg.club === club && gg.list && Date.now() - gg.at < 600000;
    if (!reuse) gg = ggBlank(club);
    gg.detail = null;
    var ov = document.getElementById('globalGrantsOverlay');
    if (!ov) {
        ov = document.createElement('div');
        ov.id = 'globalGrantsOverlay';
        ov.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 overflow-y-auto';
        document.body.appendChild(ov);
    }
    ov.classList.remove('hidden');
    ov.innerHTML = '<div class="min-h-full flex items-start justify-center p-2 sm:p-4"><div class="bg-white rounded-2xl shadow-2xl w-full max-w-6xl my-2">' +
        '<div class="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-slate-200 sticky top-0 bg-white rounded-t-2xl z-10">' +
        '<div class="min-w-0"><div class="font-black text-lg text-slate-900">🌍 全球獎助金</div><div class="text-xs text-slate-500">全世界扶輪社正在募款的 Global Grants 計畫　<span id="ggUpdated"></span></div></div>' +
        '<button type="button" onclick="ggClose()" class="shrink-0 w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-lg" aria-label="關閉">×</button></div>' +
        '<div id="ggMain" class="px-4 sm:px-6 py-4"><div id="ggTabs"></div><div id="ggFilters"></div><div id="ggResults"></div></div>' +
        '<div id="ggDetail" class="hidden px-4 sm:px-6 py-4"></div></div></div>';
    ggRenderTabs(); ggRenderFilters();
    if (reuse) { ggRenderResults(); if (gg.tab === 'related' && !gg.related) ggLoadRelated(); }
    else ggLoad(true);
}
function ggClose() {
    if (ggKwTimer) { clearTimeout(ggKwTimer); ggKwTimer = null; }
    var ov = document.getElementById('globalGrantsOverlay');
    if (ov) { ov.classList.add('hidden'); ov.innerHTML = ''; }      // 資料留在記憶體（gg），畫面清掉
}

// ---------- 讀取 ----------
function ggFilterArgs() {
    var f = gg.f, a = {};
    if (f.onlyOpen) a.onlyOpen = true;
    if (f.country) a.country = f.country;
    if (f.region) a.region = f.region;
    if (f.focus) a.focus = f.focus;
    if (String(f.keyword || '').trim()) a.keyword = String(f.keyword).trim();
    return a;
}
async function ggLoad(withOptions) {
    if (!gg) return;
    var mine = ++gg.seq, me = gg, args = ggFilterArgs();
    if (withOptions) args.withOptions = true;
    gg.loading = true; gg.err = ''; ggRenderResults();
    var r = await lineBindingsApi('grants_list', args);
    if (gg !== me || gg.seq !== mine) return;                    // 等待期間又改了條件或關掉重開＝這次結果不採用
    gg.loading = false;
    if (!r.ok) { gg.err = ggErr(r.code); gg.list = null; ggRenderResults(); return; }
    gg.list = r.grants || []; gg.at = Date.now();
    if (withOptions) {
        gg.countries = r.countries || []; gg.regions = r.regions || []; gg.total = typeof r.total === 'number' ? r.total : null; gg.updatedAt = r.updatedAt || null;
        ggRenderFilters();
    }
    ggRenderResults();
}
async function ggLoadRelated() {
    if (!gg) return;
    var me = gg;
    gg.relLoading = true; gg.relErr = ''; ggRenderResults();
    var r = await lineBindingsApi('grants_related', { district: ggDistrictCode() });
    if (gg !== me) return;
    gg.relLoading = false;
    if (!r.ok) { gg.relErr = ggErr(r.code); gg.related = null; ggRenderResults(); return; }
    // 同一個計畫可能同時是夥伴又有認捐：合併成一筆，標出本地區的角色
    var code = ggDistrictCode(), map = {}, order = [];
    var add = function (g, tag) { if (!g || !g.project_id) return; if (!map[g.project_id]) { map[g.project_id] = { g: g, tags: [] }; order.push(g.project_id); } if (map[g.project_id].tags.indexOf(tag) < 0) map[g.project_id].tags.push(tag); };
    (r.asPartner || []).forEach(function (g) {
        if (String(g.district) === code) add(g, '本地區主辦');
        if (String(g.intl_partner_district) === code) add(g, '本地區為國際夥伴');
    });
    (r.asDonor || []).forEach(function (g) { add(g, '本地區有認捐'); });
    gg.related = order.map(function (id) { return map[id]; });
    ggRenderResults();
}

// ---------- 分頁與篩選列（篩選列只在選項變動時重畫；查詢結果另外畫，才不會打斷輸入） ----------
function ggRenderTabs() {
    var box = document.getElementById('ggTabs'); if (!box || !gg) return;
    var b = function (id, label) { return '<button type="button" onclick="ggSetTab(\'' + id + '\')" class="gg-tab px-3 py-1.5 rounded-lg text-sm font-bold border ' + (gg.tab === id ? 'bg-sky-600 text-white border-sky-700' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50') + '">' + label + '</button>'; };
    box.innerHTML = '<div class="flex flex-wrap gap-2 mb-3">' + b('all', '全部計畫') + b('related', '和 ' + ggE(ggDistrictCode()) + ' 地區有關的計畫') + '</div>';
}
function ggSetTab(tab) {
    if (!gg || (tab !== 'all' && tab !== 'related')) return;
    gg.tab = tab; ggRenderTabs(); ggRenderFilters(); ggRenderResults();
    if (tab === 'related' && !gg.related && !gg.relLoading) ggLoadRelated();
}
function ggRenderFilters() {
    var box = document.getElementById('ggFilters'); if (!box || !gg) return;
    var up = document.getElementById('ggUpdated');
    if (up) up.textContent = gg.updatedAt ? '資料更新於 ' + ggDay(gg.updatedAt) : '';
    if (gg.tab !== 'all') { box.innerHTML = ''; return; }
    var f = gg.f, inp = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white';
    var opt = function (v, label, cur) { return '<option value="' + ggE(v) + '"' + (v === cur ? ' selected' : '') + '>' + ggE(label) + '</option>'; };
    box.innerHTML = '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-2">' +
        '<input id="ggKw" type="search" class="' + inp + '" placeholder="🔍 關鍵字（名稱、說明、主辦社…）" value="' + ggE(f.keyword) + '" oninput="ggKeyword(this.value)">' +
        '<select id="ggCountry" class="' + inp + '" onchange="ggSet(\'country\', this.value)">' + opt('', '所有國家', f.country) + gg.countries.map(function (c) { return opt(c.value, c.label + '（' + c.count + '）', f.country); }).join('') + '</select>' +
        '<select id="ggRegion" class="' + inp + '" onchange="ggSet(\'region\', this.value)">' + opt('', '所有區域', f.region) + gg.regions.map(function (c) { return opt(c.value, c.value + '（' + c.count + '）', f.region); }).join('') + '</select>' +
        '<select id="ggFocus" class="' + inp + '" onchange="ggSet(\'focus\', this.value)">' + opt('', '所有服務重點', f.focus) + GG_FOCUS.map(function (x) { return opt(x, x, f.focus); }).join('') + '</select>' +
        '</div><div class="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3 text-sm">' +
        '<label class="inline-flex items-center gap-2 font-bold text-slate-700 cursor-pointer"><input id="ggOpen" type="checkbox" class="w-4 h-4"' + (f.onlyOpen ? ' checked' : '') + ' onchange="ggSet(\'onlyOpen\', this.checked)">只看還在募款中的計畫</label>' +
        '<button type="button" onclick="ggResetFilters()" class="text-sky-700 underline">清除條件</button></div>';
}
function ggSet(key, value) {
    if (!gg || !(key in gg.f)) return;
    gg.f[key] = key === 'onlyOpen' ? !!value : String(value || '');
    ggLoad(false);
}
function ggKeyword(value) {
    if (!gg) return;
    gg.f.keyword = String(value || '');
    if (ggKwTimer) clearTimeout(ggKwTimer);
    ggKwTimer = setTimeout(function () { ggKwTimer = null; ggLoad(false); }, 500);      // 停止輸入半秒才查
}
function ggResetFilters() {
    if (!gg) return;
    gg.f = { keyword: '', country: '', region: '', focus: '', onlyOpen: false };
    ggRenderFilters(); ggLoad(false);
}

// ---------- 查詢結果 ----------
function ggCard(g, i, tags) {
    var open = Number(g.remaining_amount) > 0;
    var badge = '<span class="inline-block px-2 py-0.5 rounded-full text-xs font-bold ' + (open ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-emerald-100 text-emerald-800 border border-emerald-300') + '">' + ggE(g.status_zh || (open ? '尚缺 ' + ggUsd(g.remaining_amount) : '')) + '</span>';
    var tagHtml = (tags || []).map(function (t) { return '<span class="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-sky-100 text-sky-800 border border-sky-300">' + ggE(t) + '</span>'; }).join(' ');
    var gone = g.removed_from_list ? ' <span class="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-slate-200 text-slate-600">已從來源網站下架</span>' : '';
    var host = ggE(g.host_club) + (g.district ? '（' + ggE(g.district) + ' 地區）' : '');
    var hc = ggContact(g.host_contact_name, g.host_contact_email), ic = ggContact(g.intl_contact_name, g.intl_contact_email);
    return '<div class="gg-card border border-slate-200 rounded-xl p-3 bg-white hover:border-sky-300 transition">' +
        '<div class="flex flex-wrap items-center gap-2 mb-1"><span class="text-xs font-mono text-slate-500">' + ggE(g.project_id) + '</span>' + badge + tagHtml + gone +
        '<span class="ml-auto text-xs text-slate-400">' + (g.listed_date ? '上架 ' + ggE(g.listed_date) : '') + '</span></div>' +
        '<div class="gg-title font-black text-slate-900 break-words">' + ggE(g.title || '（未命名）') + '</div>' +
        '<div class="text-sm text-slate-600 mt-0.5">' + ggE(g.country_zh || g.country) + (g.region_zh ? '．' + ggE(g.region_zh) : '') + (g.areas_of_focus_zh ? '　｜　' + ggE(g.areas_of_focus_zh) : '') + '</div>' +
        '<div class="text-sm text-slate-700 mt-1">總金額 <b>' + ggE(ggUsd(g.total_budget)) + '</b>' + (open ? '　尚缺 <b class="text-amber-700">' + ggE(ggUsd(g.remaining_amount)) + '</b>' : '') + '</div>' +
        '<div class="text-sm text-slate-700 mt-2 border-t border-slate-100 pt-2"><div><span class="text-slate-500">主辦社：</span>' + host + '</div>' + (hc ? '<div class="gg-contact">' + hc + '</div>' : '') +
        '<div class="mt-1"><span class="text-slate-500">國際夥伴：</span>' + (g.intl_partner ? ggE(g.intl_partner) : '<span class="text-slate-400">尚無</span>') + '</div>' + (ic ? '<div class="gg-contact">' + ic + '</div>' : '') + '</div>' +
        '<div class="mt-2"><button type="button" onclick="ggOpenDetail(' + i + ')" class="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold">查看詳情</button></div></div>';
}
function ggMsg(text, kind) {
    var cls = kind === 'err' ? 'font-bold text-rose-700 bg-rose-50 border border-rose-200' : 'text-slate-500 border border-dashed border-slate-300 text-center py-8';
    return '<div class="gg-msg text-sm rounded-lg px-3 py-2 ' + cls + '">' + text + '</div>';
}
function ggRenderResults() {
    var box = document.getElementById('ggResults'); if (!box || !gg) return;
    if (gg.tab === 'related') {
        var code = ggE(ggDistrictCode());
        if (gg.relLoading) { box.innerHTML = ggMsg('讀取中…'); return; }
        if (gg.relErr) { box.innerHTML = ggMsg(ggE(gg.relErr), 'err'); return; }
        var rel = gg.related || [];
        gg.shown = rel.map(function (x) { return x.g; });
        if (!rel.length) { box.innerHTML = ggMsg('目前沒有和 ' + code + ' 地區有關的計畫。<br><span class="text-xs">這裡會列出：主辦社或國際夥伴社屬於 ' + code + ' 地區，或 ' + code + ' 地區（含所屬扶輪社）有認捐的計畫。<br>想找合作對象，請到「全部計畫」瀏覽。</span>'); return; }
        box.innerHTML = '<div class="text-sm text-slate-600 mb-2">共 <b id="ggCount">' + rel.length + '</b> 個計畫</div><div class="grid grid-cols-1 lg:grid-cols-2 gap-3">' + rel.map(function (x, i) { return ggCard(x.g, i, x.tags); }).join('') + '</div>';
        return;
    }
    if (gg.err) { gg.shown = []; box.innerHTML = ggMsg(ggE(gg.err), 'err'); return; }
    if (!gg.list) { box.innerHTML = ggMsg('讀取中…'); return; }
    var list = gg.list; gg.shown = list;
    var need = list.reduce(function (s, g) { var v = Number(g.remaining_amount); return s + (v > 0 ? v : 0); }, 0);
    var head = '<div class="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3"><div class="text-sm text-slate-700">' + (gg.loading ? '<span class="text-slate-400">查詢中…　</span>' : '') +
        '符合 <b id="ggCount">' + list.length + '</b> 個計畫' + (gg.total != null ? '（全部 ' + gg.total + ' 個）' : '') + (need ? '　尚缺金額合計 <b>' + ggE(ggUsd(need)) + '</b>（美元）' : '') + '</div>' +
        '<div class="sm:ml-auto flex flex-wrap items-center gap-2"><span class="text-xs text-slate-500">聯絡資訊僅供洽談合作使用，請勿用於群發信件</span>' +
        '<button id="ggExportBtn" type="button" onclick="ggExport()" ' + (list.length && !gg.exporting ? '' : 'disabled ') + 'class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm font-bold">📥 匯出 Excel</button></div></div>' +
        '<div id="ggExportMsg" class="text-sm text-slate-600 mb-2"></div>';
    if (!list.length) { box.innerHTML = head + ggMsg('沒有符合條件的計畫。可以放寬條件，或按「清除條件」看全部。'); return; }
    box.innerHTML = head + '<div class="grid grid-cols-1 lg:grid-cols-2 gap-3">' + list.map(function (g, i) { return ggCard(g, i); }).join('') + '</div>';
}

// ---------- 詳細頁（蓋在清單上面；返回時清單與捲動位置都還在） ----------
async function ggOpenDetail(i) {
    if (!gg) return;
    var g = gg.shown[i]; if (!g) return;
    var ov = document.getElementById('globalGrantsOverlay'), main = document.getElementById('ggMain'), box = document.getElementById('ggDetail');
    if (!ov || !main || !box) return;
    gg.scroll = ov.scrollTop; gg.detail = { id: g.project_id, grant: null, err: '' }; gg.zh = true;
    main.classList.add('hidden'); box.classList.remove('hidden'); ov.scrollTop = 0;
    ggRenderDetail();
    var me = gg, d = gg.detail;
    var r = await lineBindingsApi('grants_get', { projectId: g.project_id });
    if (gg !== me || gg.detail !== d) return;
    if (!r.ok) d.err = ggErr(r.code); else d.grant = r.grant;
    ggRenderDetail();
}
function ggBack() {
    if (!gg) return;
    gg.detail = null;
    var ov = document.getElementById('globalGrantsOverlay'), main = document.getElementById('ggMain'), box = document.getElementById('ggDetail');
    if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
    if (main) main.classList.remove('hidden');
    if (ov) ov.scrollTop = gg.scroll || 0;
}
function ggToggleLang() { if (gg && gg.detail) { gg.zh = !gg.zh; ggRenderDetail(); } }
function ggPledgeRows(pledges) {
    return (Array.isArray(pledges) ? pledges : []).filter(function (p) { return p && typeof p === 'object'; });
}
function ggRenderDetail() {
    var box = document.getElementById('ggDetail'); if (!box || !gg || !gg.detail) return;
    var back = '<button type="button" onclick="ggBack()" class="mb-3 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-bold">← 回到清單</button>';
    var d = gg.detail, g = d.grant;
    if (d.err) { box.innerHTML = back + ggMsg(ggE(d.err), 'err'); return; }
    if (!g) { box.innerHTML = back + ggMsg('讀取中…'); return; }
    var open = Number(g.remaining_amount) > 0;
    var row = function (label, html) { return html ? '<div class="flex gap-2 py-1 border-b border-slate-100"><div class="w-28 shrink-0 text-slate-500">' + label + '</div><div class="min-w-0 break-words">' + html + '</div></div>' : ''; };
    var url = /^https?:\/\/[^\s"'<>]+$/i.test(String(g.detail_url || '')) ? String(g.detail_url) : '';
    var zhText = String(g.description_zh || '').trim(), enText = String(g.description || '').trim();
    var showZh = gg.zh && !!zhText, text = showZh ? zhText : enText;
    var pl = ggPledgeRows(g.pledges);
    var plHtml = pl.length ? '<div class="overflow-x-auto"><table id="ggPledges" class="min-w-full text-sm"><thead><tr class="text-left text-slate-500 border-b border-slate-200"><th class="py-1 pr-3">認捐社</th><th class="py-1 pr-3">地區</th><th class="py-1 pr-3">日期</th><th class="py-1 pr-3 text-right">現金</th><th class="py-1 pr-3 text-right">DDF</th><th class="py-1 text-right">合計</th></tr></thead><tbody>' +
        pl.map(function (p) { return '<tr class="border-b border-slate-100"><td class="py-1 pr-3">' + ggE(p['認捐社']) + '</td><td class="py-1 pr-3">' + ggE(p['地區']) + '</td><td class="py-1 pr-3 whitespace-nowrap">' + ggE(p['日期']) + '</td><td class="py-1 pr-3 text-right">' + ggE(ggUsd(p['現金'])) + '</td><td class="py-1 pr-3 text-right">' + ggE(ggUsd(p['DDF'])) + '</td><td class="py-1 text-right font-bold">' + ggE(ggUsd(p['合計'])) + '</td></tr>'; }).join('') +
        '</tbody></table></div><div class="text-xs text-slate-500 mt-1">DDF＝地區指定用途基金</div>' : '<div class="text-sm text-slate-400">目前還沒有認捐紀錄。</div>';
    box.innerHTML = back +
        '<div class="flex flex-wrap items-center gap-2 mb-1"><span class="text-xs font-mono text-slate-500">' + ggE(g.project_id) + '</span>' +
        '<span class="inline-block px-2 py-0.5 rounded-full text-xs font-bold ' + (open ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-emerald-100 text-emerald-800 border border-emerald-300') + '">' + ggE(g.status_zh) + '</span>' +
        (g.removed_from_list ? '<span class="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-slate-200 text-slate-600">已從來源網站下架</span>' : '') + '</div>' +
        '<h2 id="ggDTitle" class="text-xl font-black text-slate-900 break-words">' + ggE(g.title || '（未命名）') + '</h2>' +
        '<div class="text-xs text-slate-400 mb-3">計畫名稱來自來源網站，限 30 個字，可能被截短</div>' +
        '<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 text-sm"><div>' +
        row('國家／地點', ggE(g.country_zh || g.country) + (g.location ? '．' + ggE(g.location) : '') + (g.region_zh ? '（' + ggE(g.region_zh) + '）' : '')) +
        row('服務重點', ggE(g.areas_of_focus_zh || g.areas_of_focus)) +
        row('扶輪年度', ggE(g.rotary_year)) +
        row('總金額', '<b>' + ggE(ggUsd(g.total_budget)) + '</b>（美元）') +
        row('尚缺金額', open ? '<b class="text-amber-700">' + ggE(ggUsd(g.remaining_amount)) + '</b>' : '已足額') +
        row('向基金會申請', Number(g.trf_requested) > 0 ? ggE(ggUsd(g.trf_requested)) : '') +
        row('上架日期', ggE(g.listed_date)) + row('最後異動', ggE(g.last_changed)) +
        '</div><div>' +
        row('主辦夥伴社', ggE(g.host_partner || g.host_club)) +
        row('主辦聯絡人', '<span id="ggDHost">' + (ggE(String(g.host_contact_name || '').trim()) + ' ' + ggMail(g.host_contact_email)).trim() + '</span>') +
        row('國際夥伴社', g.intl_partner ? ggE(g.intl_partner) : '<span class="text-slate-400">尚無（歡迎洽談）</span>') +
        row('國際夥伴聯絡人', (ggE(String(g.intl_contact_name || '').trim()) + ' ' + ggMail(g.intl_contact_email)).trim()) +
        '<div class="text-xs text-slate-500 mt-2">聯絡資訊僅供洽談合作使用，請勿用於群發信件。</div>' +
        '</div></div>' +
        '<div class="mt-4"><div class="flex flex-wrap items-center gap-2 mb-1"><div class="font-black text-slate-900">計畫說明</div>' +
        (zhText && enText ? '<button id="ggLangBtn" type="button" onclick="ggToggleLang()" class="px-2 py-0.5 rounded border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50">' + (showZh ? '看英文原文' : '看中文翻譯') + '</button>' : '') +
        (showZh ? '<span class="text-xs text-amber-700">中文為機器翻譯，僅供參考</span>' : '') + '</div>' +
        '<div id="ggDesc" class="text-sm text-slate-800 whitespace-pre-wrap break-words bg-slate-50 border border-slate-200 rounded-lg p-3">' + (text ? ggE(text) : '<span class="text-slate-400">（來源網站沒有填寫說明）</span>') + '</div></div>' +
        '<div class="mt-4"><div class="font-black text-slate-900 mb-1">已認捐明細（' + pl.length + ' 筆）</div>' + plHtml + '</div>' +
        (url ? '<div class="mt-4"><a id="ggSrc" href="' + ggE(url) + '" target="_blank" rel="noopener noreferrer" class="inline-block px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold">🔗 前往原始網站（認捐請到原網站進行）</a></div>' : '');
}

// ---------- 匯出 Excel：目前篩選出來的計畫（含聯絡人）。檔案在這台電腦上產生，不上傳到任何地方 ----------
function ggPledgeText(pledges) {
    return ggPledgeRows(pledges).map(function (p) { return String(p['認捐社'] || '') + '｜地區 ' + String(p['地區'] || '') + '｜' + String(p['日期'] || '') + '｜' + ggUsd(p['合計']); }).join('\n');
}
function ggCell(g, col) {
    var v = g[col[1]];
    if (col[3] === 'num') { if (v == null || v === '') return ''; var n = Number(v); return Number.isFinite(n) ? n : ''; }      // 金額以數字寫入，才能在 Excel 加總、排序
    var s = col[3] === 'pledges' ? ggPledgeText(v) : String(v == null ? '' : v);
    if (s.length > GG_CELL_MAX) { var tail = '…（內容過長，請至原始網站查看）'; s = s.slice(0, GG_CELL_MAX - tail.length) + tail; }
    return s;
}
function ggBuildSheet(rows) {
    var aoa = [GG_XLSX_COLS.map(function (c) { return c[0]; })];
    rows.forEach(function (g) { aoa.push(GG_XLSX_COLS.map(function (c) { return ggCell(g, c); })); });
    return aoa;
}
async function ggExport() {
    if (!gg || gg.exporting || gg.tab !== 'all' || !gg.list || !gg.list.length) return;
    if (typeof XLSX === 'undefined') { alert('Excel 元件沒有載入成功，請重新整理頁面後再試。'); return; }
    var me = gg, args = ggFilterArgs(), expect = gg.list.length, rows = [];
    var say = function (t) { var m = document.getElementById('ggExportMsg'); if (m) m.textContent = t; };
    gg.exporting = true;
    var btn = document.getElementById('ggExportBtn'); if (btn) btn.disabled = true;
    try {
        for (var offset = 0, guard = 0; offset !== null && guard < 200; guard++) {
            say('正在準備匯出資料…（' + rows.length + '／' + expect + '）');
            var r = await lineBindingsApi('grants_export', Object.assign({}, args, { offset: offset }));
            if (gg !== me) return;
            if (!r.ok) { say(''); alert('匯出失敗：' + ggErr(r.code)); return; }
            rows = rows.concat(r.grants || []);
            offset = typeof r.next === 'number' ? r.next : null;
        }
        var aoa = ggBuildSheet(rows);
        var ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = GG_XLSX_COLS.map(function (c) { return { wch: c[2] }; });
        ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: GG_XLSX_COLS.length - 1 } }) };
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '全球獎助金');
        var year = String((rows[0] && rows[0].rotary_year) || (typeof DISTRICT === 'object' && DISTRICT && DISTRICT.rotaryYear) || '').replace(/[^0-9A-Za-z-]/g, '');
        var name = '全球獎助金_' + (year ? year + '_' : '') + ggDay(new Date()) + '.xlsx';
        XLSX.writeFile(wb, name);
        say('已匯出 ' + rows.length + ' 個計畫：' + name + (rows.length !== expect ? '（資料剛好有更新，筆數與畫面上的 ' + expect + ' 筆不同，請按「清除條件」或重新查詢）' : ''));
    } catch (e) {
        say(''); alert('匯出失敗，請稍後再試。');
    } finally {
        if (gg === me) { gg.exporting = false; var b2 = document.getElementById('ggExportBtn'); if (b2) b2.disabled = !(gg.list && gg.list.length); }
    }
}
