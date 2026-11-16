// =====================================================================
// 報名系統裡的「📅 行事曆管理」（電腦版操作畫面）。由 index.html 載入。
//   - 本社行程：執秘用本社的登入密碼（與 LINE 綁定名單同一做法，程式自動帶入，不用再輸入）
//   - 地區行程：要再輸入一次「行事曆後台密碼」（只放記憶體，關掉網頁就忘記）
//   - 權限與類型（最高管理員）：直接嵌入 admin-calendar.html
//   - 私人行程不在這裡（只有本人在 LINE 裡看得到）
// 後端是雲端小程式 line-checkin 的 cal_desk_* 動作。依賴 index.html 的全域：
//   SUPABASE_URL、SUPABASE_ANON_KEY、appAuthData、DEFAULT_CLUB_PASSWORD、selectedClubName、loggedInUser、divisionsData、
//   showToast、escapeHtmlText、DISTRICT
// 時間一律用台灣時間（UTC+8）。
// =====================================================================
const CDESK_ERR = {
    CLUB_AUTH_FAILED: '本社的登入密碼驗證失敗，請重新登入後再試。',
    CAL_ADMIN_DISABLED: '行事曆後台尚未啟用（雲端小程式沒有設定後台密碼）。',
    CAL_ADMIN_AUTH_FAILED: '行事曆後台密碼不正確。',
    CAL_FORBIDDEN: '您沒有權限執行這個操作。',
    CAL_NOT_FOUND: '找不到這筆行程，可能已被刪除，請重新整理。',
    CAL_NEED_TITLE: '請填寫行程標題。',
    CAL_BAD_TIME: '時間格式不正確，請檢查日期與時間。',
    CAL_END_BEFORE_START: '結束時間不能早於開始時間。',
    CAL_BAD_LAYER: '行程層級不正確。',
    CAL_TABLE_MISSING: '行事曆資料表還沒建立，請先在 Supabase 執行 supabase/sql/calendar.sql。',
    LINE_NOT_CONFIGURED: '行事曆雲端小程式尚未部署。',
    NETWORK: '網路連線不穩，請再試一次。',
    SERVER_ERROR: '系統忙碌中，請稍後再試。'
};
const CDESK_WD = ['日', '一', '二', '三', '四', '五', '六'];
let cdeskTab = 'club';          // 'club' | 'district' | 'admin'
var cdeskAdminPw = '';          // 行事曆後台密碼（只放記憶體）。用 var 才會掛在 window 上，嵌入的 admin-calendar.html 才讀得到
let cdeskClub = '';             // 正在管理的社
let cdeskEvents = [];
let cdeskTypes = [];
let cdeskBusy = false;
let cdeskSeq = 0;

// ---------- 小工具 ----------
const cdE = s => (typeof escapeHtmlText === 'function' ? escapeHtmlText(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
const cdP2 = n => String(n).padStart(2, '0');
function cdParts(ms) { const d = new Date(ms + 8 * 3600e3); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay(), h: d.getUTCHours(), mi: d.getUTCMinutes() }; }
const cdYmd = ms => { const t = cdParts(ms); return `${t.y}-${cdP2(t.m)}-${cdP2(t.d)}`; };
const cdHm = ms => { const t = cdParts(ms); return `${cdP2(t.h)}:${cdP2(t.mi)}`; };
function cdWhen(ev) {
    const s = Date.parse(ev.start), e = Date.parse(ev.end), t = cdParts(s);
    const day = `${t.y}/${cdP2(t.m)}/${cdP2(t.d)}（${CDESK_WD[t.wd]}）`;
    if (ev.allDay) return day + (cdYmd(s) === cdYmd(e) ? ' 全天' : ` ～ ${cdYmd(e).replace(/-/g, '/')} 全天`);
    if (s === e) return `${day}${cdHm(s)}`;
    return cdYmd(s) === cdYmd(e) ? `${day}${cdHm(s)}–${cdHm(e)}` : `${day}${cdHm(s)} ～ ${cdYmd(e).replace(/-/g, '/')} ${cdHm(e)}`;
}
function cdErr(code) { return CDESK_ERR[code] || CDESK_ERR.SERVER_ERROR; }
function cdIsSuper() { return !!(typeof loggedInUser !== 'undefined' && loggedInUser && loggedInUser.isSuperAdmin); }
function cdAllClubs() { return (typeof divisionsData !== 'undefined' ? divisionsData : []).flatMap(d => (d.clubs || []).map(c => ({ name: c.name, division: d.name, code: c.code || '' }))); }
function cdMyClub() {
    if (cdIsSuper()) return cdeskClub || (typeof selectedClubName === 'string' ? selectedClubName : '');
    return loggedInUser && loggedInUser.club || '';
}
// 這次呼叫要帶的認證：有輸入後台密碼就用它；否則用本社的登入密碼
function cdAuth(layer) {
    if (layer === 'district') return { adminPassword: cdeskAdminPw };
    if (cdeskAdminPw) return { adminPassword: cdeskAdminPw };
    const club = cdMyClub();
    return { club: club, clubPassword: ((typeof appAuthData !== 'undefined' && appAuthData.clubPasswords) || {})[club] || (typeof DEFAULT_CLUB_PASSWORD !== 'undefined' ? DEFAULT_CLUB_PASSWORD : '') || '' };
}
async function cdApi(action, layer, extra) {
    try {
        const res = await fetch(SUPABASE_URL + '/functions/v1/line-checkin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
            body: JSON.stringify(Object.assign({ action: action }, cdAuth(layer), extra || {}))
        });
        if (res.status === 404) return { ok: false, code: 'LINE_NOT_CONFIGURED' };
        const j = await res.json();
        return j && typeof j.ok === 'boolean' ? j : { ok: false, code: 'SERVER_ERROR' };
    } catch (e) { return { ok: false, code: 'NETWORK' }; }
}
function cdToast(msg, icon) { if (typeof showToast === 'function') showToast(msg, icon || '📅'); }
const cdLiffUrl = () => (DISTRICT && DISTRICT.lineLiffId) ? `https://liff.line.me/${DISTRICT.lineLiffId}?p=calendar` : '';

// ---------- 外框 ----------
function openCalendarDesk() {
    let el = document.getElementById('calDeskModal');
    if (!el) {
        el = document.createElement('div');
        el.id = 'calDeskModal';
        el.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4';
        el.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl h-[94vh] flex flex-col">
            <div class="flex justify-between items-center px-4 sm:px-6 py-3 border-b border-slate-100 shrink-0">
                <h3 class="font-bold text-slate-900 text-base">📅 行事曆管理</h3>
                <button type="button" onclick="closeCalendarDesk()" class="text-slate-400 hover:text-slate-600 font-bold text-2xl p-1 leading-none" aria-label="關閉">&times;</button>
            </div>
            <div id="cdeskTabs" class="px-4 sm:px-6 pt-3 flex flex-wrap gap-2 shrink-0"></div>
            <div id="cdeskBody" class="flex-1 overflow-y-auto px-4 sm:px-6 py-4"></div>
        </div>`;
        document.body.appendChild(el);
    }
    el.classList.remove('hidden');
    cdeskClub = cdIsSuper() ? (cdeskClub || (typeof selectedClubName === 'string' ? selectedClubName : '')) : '';
    cdeskSwitch(cdeskTab === 'admin' && !cdIsSuper() ? 'club' : cdeskTab);
}
function closeCalendarDesk() { const el = document.getElementById('calDeskModal'); if (el) el.classList.add('hidden'); }
function cdeskSwitch(tab) {
    cdeskTab = tab;
    const T = [['club', '🏠 本社行程'], ['district', '🌐 地區行程']];
    if (cdIsSuper()) T.push(['admin', '🔑 管理者與活動類型']);
    document.getElementById('cdeskTabs').innerHTML = T.map(t => `<button type="button" onclick="cdeskSwitch('${t[0]}')" class="px-3.5 py-2 rounded-lg text-sm font-bold border ${cdeskTab === t[0] ? 'bg-blue-700 text-white border-blue-700' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}">${t[1]}</button>`).join('');
    if (tab === 'admin') return cdeskRenderAdmin();
    if (tab === 'district' && !cdeskAdminPw) return cdeskRenderPwForm();
    cdeskReload();
}

// ---------- 地區行程：要輸入後台密碼 ----------
function cdeskRenderPwForm(msg) {
    document.getElementById('cdeskBody').innerHTML = `<div class="max-w-sm mx-auto mt-6 border border-slate-200 rounded-xl p-5">
        <div class="font-black text-slate-900">請輸入行事曆後台密碼</div>
        <p class="text-xs text-slate-500 mt-1 leading-relaxed">管理「地區行程」需要再確認一次身分。這組密碼由地區的系統管理者設定；輸入後只在這次開啟網頁期間有效。</p>
        <input id="cdeskPw" type="password" class="mt-3 w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm" placeholder="行事曆後台密碼" onkeydown="if(event.key==='Enter')cdeskSubmitPw()">
        ${msg ? `<div class="mt-2 text-xs font-bold text-rose-700">${cdE(msg)}</div>` : ''}
        <button type="button" onclick="cdeskSubmitPw()" class="mt-3 w-full bg-blue-700 hover:bg-blue-800 text-white font-bold rounded-lg py-2.5 text-sm">確認</button>
    </div>`;
}
async function cdeskSubmitPw() {
    const v = document.getElementById('cdeskPw').value;
    if (!v) return;
    cdeskAdminPw = v;
    const r = await cdApi('cal_desk_list', 'district', { layer: 'district', from: new Date().toISOString(), to: new Date(Date.now() + 86400e3).toISOString() });
    if (!r.ok) { cdeskAdminPw = ''; return cdeskRenderPwForm(cdErr(r.code)); }
    cdeskReload();
}

// ---------- 行程列表 ----------
async function cdeskReload() {
    const layer = cdeskTab, seq = ++cdeskSeq, box = document.getElementById('cdeskBody');
    let clubPicker = '';
    if (layer === 'club' && cdIsSuper()) {
        clubPicker = `<select onchange="cdeskPickClub(this.value)" class="border border-slate-300 rounded-lg px-2.5 py-2 text-sm bg-white max-w-full">${cdAllClubs().map(c => `<option value="${cdE(c.name)}" ${c.name === cdMyClub() ? 'selected' : ''}>${cdE(c.division)} ${cdE(c.code)} ${cdE(c.name)}</option>`).join('')}</select>`;
    }
    const title = layer === 'district' ? '地區行程（全地區社友都看得到）' : `${cdE(cdMyClub())} 的社內行程（只有本社社友看得到）`;
    box.innerHTML = `<div class="flex flex-wrap items-center justify-between gap-2">
            <div class="min-w-0"><div class="font-black text-slate-900">${layer === 'club' && cdIsSuper() ? '社內行程　' + clubPicker : title}</div><div class="text-xs text-slate-500 mt-0.5">顯示最近 30 天前～未來一年。社友在 LINE 行事曆裡看到的就是這裡的內容。</div></div>
            <button type="button" onclick="cdeskOpenForm()" class="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white font-bold rounded-lg text-sm shadow-sm">＋ 新增行程</button>
        </div>
        <div id="cdeskList" class="mt-4"><div class="text-sm text-slate-500 py-6 text-center">讀取中…</div></div>`;
    const r = await cdApi('cal_desk_list', layer, { layer: layer, targetClub: layer === 'club' ? cdMyClub() : '', from: new Date(Date.now() - 30 * 86400e3).toISOString(), to: new Date(Date.now() + 365 * 86400e3).toISOString() });
    if (seq !== cdeskSeq) return;
    const list = document.getElementById('cdeskList');
    if (!list) return;
    if (!r.ok) {
        if (r.code === 'CAL_ADMIN_AUTH_FAILED' && layer === 'district') { cdeskAdminPw = ''; return cdeskRenderPwForm(cdErr(r.code)); }
        list.innerHTML = `<div class="text-sm font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-3">${cdE(cdErr(r.code))}</div>`;
        return;
    }
    cdeskEvents = r.events || []; cdeskTypes = r.types || [];
    cdeskRenderList();
}
function cdeskPickClub(name) { cdeskClub = name; cdeskReload(); }
function cdeskTypeName(id) { const t = cdeskTypes.find(x => x.id === id); return t ? t.name : ''; }
function cdeskRenderList() {
    const list = document.getElementById('cdeskList');
    if (!cdeskEvents.length) { list.innerHTML = '<div class="text-sm text-slate-500 border border-dashed border-slate-300 rounded-lg px-3 py-8 text-center">這個範圍還沒有行程，按右上角「＋ 新增行程」開始建立。</div>'; return; }
    const now = Date.now();
    list.innerHTML = cdeskEvents.map((e, i) => {
        const cancelled = e.status === 'cancelled', past = Date.parse(e.end) < now;
        return `<div class="border border-slate-200 rounded-lg px-3 py-2.5 mb-2 ${past ? 'bg-slate-50' : 'bg-white'}">
            <div class="flex flex-wrap items-start justify-between gap-2">
                <div class="min-w-0">
                    <div class="text-xs font-bold text-slate-500">${cdE(cdWhen(e))}${cdeskTypeName(e.typeId) ? `　<span class="text-blue-700">${cdE(cdeskTypeName(e.typeId))}</span>` : ''}${cancelled ? '　<span class="text-rose-600">已取消</span>' : ''}${past && !cancelled ? '　<span class="text-slate-400">已過</span>' : ''}</div>
                    <div class="font-bold text-slate-900 ${cancelled ? 'line-through text-slate-400' : ''}">${cdE(e.title)}</div>
                    ${e.location ? `<div class="text-xs text-slate-600">📍 ${cdE(e.location)}</div>` : ''}
                </div>
                <div class="flex flex-wrap gap-1.5 shrink-0 text-xs font-bold">
                    <button type="button" onclick="cdeskOpenForm('edit',${i})" class="px-2.5 py-1.5 bg-white border border-slate-300 rounded-md hover:bg-slate-50">編輯</button>
                    <button type="button" onclick="cdeskOpenForm('copy',${i})" class="px-2.5 py-1.5 bg-white border border-slate-300 rounded-md hover:bg-slate-50">複製</button>
                    <button type="button" onclick="cdeskCancel(${i})" class="px-2.5 py-1.5 bg-white border border-amber-300 text-amber-800 rounded-md hover:bg-amber-50">${cancelled ? '恢復' : '取消行程'}</button>
                    <button type="button" onclick="cdeskDelete(${i})" class="px-2.5 py-1.5 bg-white border border-rose-300 text-rose-700 rounded-md hover:bg-rose-50">刪除</button>
                </div></div></div>`;
    }).join('');
}
async function cdeskCancel(i) {
    const e = cdeskEvents[i]; if (!e || cdeskBusy) return;
    const cancelling = e.status !== 'cancelled';
    if (!confirm(cancelling ? `要取消「${e.title}」嗎？\n行程會保留，但標示為「已取消」，社友在 LINE 看到的也是已取消。` : `要恢復「${e.title}」嗎？`)) return;
    cdeskBusy = true; const r = await cdApi('cal_desk_cancel', cdeskTab, { id: e.id, cancelled: cancelling }); cdeskBusy = false;
    if (!r.ok) return cdToast(cdErr(r.code), '⚠️');
    cdToast(cancelling ? '已取消行程' : '已恢復行程'); cdeskReload();
}
async function cdeskDelete(i) {
    const e = cdeskEvents[i]; if (!e || cdeskBusy) return;
    if (!confirm(`確定要刪除「${e.title}」嗎？\n刪除後無法復原。（只是不辦了，建議用「取消行程」。）`)) return;
    cdeskBusy = true; const r = await cdApi('cal_desk_delete', cdeskTab, { id: e.id }); cdeskBusy = false;
    if (!r.ok) return cdToast(cdErr(r.code), '⚠️');
    cdToast('已刪除'); cdeskReload();
}

// ---------- 新增／編輯／複製 ----------
function cdeskOpenForm(mode, i) {
    const src = (mode === 'edit' || mode === 'copy') ? cdeskEvents[i] : null;
    let v;
    if (src) {
        const s = Date.parse(src.start), e = Date.parse(src.end);
        v = { id: mode === 'edit' ? src.id : '', title: src.title, typeId: src.typeId, allDay: src.allDay, sd: cdYmd(s), st: src.allDay ? '09:00' : cdHm(s), ed: cdYmd(e), et: src.allDay ? '10:00' : cdHm(e), location: src.location, address: src.address, dressCode: src.dressCode, contactPerson: src.contactPerson, contactPhone: src.contactPhone, notes: src.notes };
    } else {
        const d = cdYmd(Date.now());
        v = { id: '', title: '', typeId: null, allDay: false, sd: d, st: '09:00', ed: d, et: '10:00', location: '', address: '', dressCode: '', contactPerson: '', contactPhone: '', notes: '' };
    }
    const inp = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white', lab = 'block text-xs font-bold text-slate-600 mb-1 mt-3';
    const where = cdeskTab === 'district' ? '地區行程' : `${cdMyClub()} 社內行程`;
    document.getElementById('cdeskBody').innerHTML = `<button type="button" onclick="cdeskReload()" class="text-sm font-bold text-blue-700">‹ 返回列表（不儲存）</button>
        <div class="mt-2 max-w-2xl">
            <h4 class="font-black text-lg text-slate-900">${mode === 'edit' ? '編輯' : mode === 'copy' ? '複製' : '新增'}${cdE(where)}</h4>
            ${mode === 'copy' ? '<p class="text-xs text-slate-500 mt-1">已帶入原行程的資料，請修改日期等欄位後儲存。</p>' : ''}
            <label class="${lab}" for="cdTitle">標題 <span class="text-rose-600">*</span></label><input id="cdTitle" type="text" maxlength="100" value="${cdE(v.title)}" class="${inp}" placeholder="例：松景社授證典禮">
            <label class="${lab}" for="cdType">活動類型</label><select id="cdType" class="${inp}"><option value="">未分類</option>${cdeskTypes.map(t => `<option value="${t.id}" ${v.typeId === t.id ? 'selected' : ''}>${cdE(t.name)}</option>`).join('')}</select>
            <label class="flex items-center gap-2 mt-3 text-sm font-bold text-slate-700"><input id="cdAllDay" type="checkbox" onchange="cdeskAllDay()" class="w-4 h-4" ${v.allDay ? 'checked' : ''}> 全天行程</label>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div><label class="${lab}" for="cdSd">開始日期</label><input id="cdSd" type="date" value="${v.sd}" class="${inp}"></div>
                <div id="cdStBox"><label class="${lab}" for="cdSt">開始時間</label><input id="cdSt" type="time" value="${v.st}" class="${inp}"></div>
                <div><label class="${lab}" for="cdEd">結束日期</label><input id="cdEd" type="date" value="${v.ed}" class="${inp}"></div>
                <div id="cdEtBox"><label class="${lab}" for="cdEt">結束時間</label><input id="cdEt" type="time" value="${v.et}" class="${inp}"></div>
            </div>
            <label class="${lab}" for="cdLoc">地點</label><input id="cdLoc" type="text" maxlength="200" value="${cdE(v.location)}" class="${inp}" placeholder="例：○○飯店 3 樓">
            <label class="${lab}" for="cdAddr">地址（填了社友可一鍵開地圖）</label><input id="cdAddr" type="text" maxlength="300" value="${cdE(v.address)}" class="${inp}">
            <label class="${lab}" for="cdDress">服裝</label><input id="cdDress" type="text" maxlength="100" value="${cdE(v.dressCode)}" class="${inp}" placeholder="例：正式服裝">
            <div class="grid grid-cols-2 gap-2"><div><label class="${lab}" for="cdCP">聯絡人</label><input id="cdCP" type="text" maxlength="50" value="${cdE(v.contactPerson)}" class="${inp}"></div><div><label class="${lab}" for="cdPh">聯絡電話</label><input id="cdPh" type="tel" maxlength="50" value="${cdE(v.contactPhone)}" class="${inp}"></div></div>
            <label class="${lab}" for="cdNotes">備註</label><textarea id="cdNotes" rows="4" maxlength="2000" class="${inp}">${cdE(v.notes)}</textarea>
            <div id="cdError" class="hidden mt-3 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2"></div>
            <button type="button" id="cdSave" onclick="cdeskSave('${cdE(v.id)}')" class="mt-4 px-8 py-2.5 bg-blue-700 hover:bg-blue-800 text-white font-bold rounded-lg text-sm shadow-sm">儲存</button>
        </div>`;
    cdeskAllDay();
}
function cdeskAllDay() { const a = document.getElementById('cdAllDay').checked; document.getElementById('cdStBox').classList.toggle('hidden', a); document.getElementById('cdEtBox').classList.toggle('hidden', a); }
async function cdeskSave(id) {
    if (cdeskBusy) return;
    const g = x => document.getElementById(x).value, allDay = document.getElementById('cdAllDay').checked;
    const err = m => { const b = document.getElementById('cdError'); b.textContent = m; b.classList.remove('hidden'); };
    if (!g('cdTitle').trim()) return err('請填寫行程標題。');
    if (!g('cdSd')) return err('請選擇開始日期。');
    if (!allDay && !g('cdSt')) return err('請填寫開始時間。');
    const ed = g('cdEd') || g('cdSd');
    const start = allDay ? `${g('cdSd')}T00:00:00+08:00` : `${g('cdSd')}T${g('cdSt')}:00+08:00`;
    const end = allDay ? `${ed}T23:59:00+08:00` : `${ed}T${g('cdEt') || g('cdSt')}:00+08:00`;
    if (Date.parse(end) < Date.parse(start)) return err('結束時間不能早於開始時間。');
    const ev = { title: g('cdTitle'), typeId: g('cdType') ? Number(g('cdType')) : null, allDay: allDay, start: start, end: end, location: g('cdLoc'), address: g('cdAddr'), dressCode: g('cdDress'), contactPerson: g('cdCP'), contactPhone: g('cdPh'), notes: g('cdNotes') };
    if (id) ev.id = id; else { ev.layer = cdeskTab; if (cdeskTab === 'club') ev.club = cdMyClub(); }
    const btn = document.getElementById('cdSave'); cdeskBusy = true; btn.disabled = true; btn.textContent = '儲存中…';
    const r = await cdApi('cal_desk_save', cdeskTab, { event: ev });
    cdeskBusy = false;
    if (!r.ok) { btn.disabled = false; btn.textContent = '儲存'; return err(cdErr(r.code)); }
    cdToast('已儲存，社友的 LINE 行事曆會立刻看到');
    cdeskReload();
}

// ---------- 管理者與活動類型（最高管理員） ----------
function cdeskRenderAdmin() {
    const url = cdLiffUrl();
    document.getElementById('cdeskBody').innerHTML = `
        ${url ? `<div class="border border-blue-200 bg-blue-50 rounded-lg px-3 py-2.5 text-xs text-slate-700"><b>社友行事曆網址</b>（貼到 LINE 官方帳號圖文選單的「行事曆」按鈕）
            <div class="flex gap-2 mt-1.5"><input id="cdeskLiff" readonly value="${cdE(url)}" onclick="this.select()" class="flex-1 border border-slate-300 rounded px-2 py-1.5 font-mono text-[11px] bg-white"><button type="button" onclick="cdeskCopyLiff()" class="shrink-0 px-3 bg-blue-700 text-white font-bold rounded">複製</button></div></div>` : ''}
        <iframe src="admin-calendar.html" title="行事曆管理者與活動類型" class="mt-3 w-full border border-slate-200 rounded-lg bg-slate-100" style="height:calc(94vh - 230px);min-height:420px"></iframe>`;
}
function cdeskCopyLiff() {
    const el = document.getElementById('cdeskLiff'); if (!el) return;
    el.select();
    try { navigator.clipboard.writeText(el.value).then(() => cdToast('已複製網址'), () => { document.execCommand('copy'); cdToast('已複製網址'); }); } catch (e) { try { document.execCommand('copy'); cdToast('已複製網址'); } catch (e2) { /* 手動複製 */ } }
}
