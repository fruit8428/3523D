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
    CAL_IMPORT_TOO_MANY: '一次最多匯入 300 筆，請把檔案分成幾份。',
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
    cdeskTab = tab; cdImp = null;
    const T = [['club', '🏠 本社行程'], ['stats', '📊 例會統計'], ['report', '📈 出席率'], ['district', '🌐 地區行程']];
    if (cdIsSuper()) T.push(['admin', '🔑 管理者與活動類型']);
    document.getElementById('cdeskTabs').innerHTML = T.map(t => `<button type="button" onclick="cdeskSwitch('${t[0]}')" class="px-3.5 py-2 rounded-lg text-sm font-bold border ${cdeskTab === t[0] ? 'bg-blue-700 text-white border-blue-700' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}">${t[1]}</button>`).join('');
    if (tab === 'admin') return cdeskRenderAdmin();
    if (tab === 'stats') return cdeskRenderStats();
    if (tab === 'report') return cdeskRenderReport();
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
            <div class="flex flex-wrap gap-2"><button type="button" onclick="cdImpOpen()" class="px-3 py-2 bg-white border border-emerald-400 text-emerald-800 hover:bg-emerald-50 font-bold rounded-lg text-sm">📥 Excel 匯入</button>
            <button type="button" onclick="cdeskOpenForm()" class="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white font-bold rounded-lg text-sm shadow-sm">＋ 新增行程</button></div>
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
                    ${(e.rsvpEnabled || e.registrationKey || (cdeskTab === 'club' && e.layer === 'club')) ? `<div class="mt-1 text-xs flex flex-wrap gap-1.5">${(e.rsvpEnabled || e.registrationKey) ? `<button type="button" onclick="cdeskShowRsvp(${i})" class="px-2 py-0.5 bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-full font-bold hover:bg-emerald-100">🙋 表示參加 ${e.rsvpCount || 0} 人（含寶尊眷）・看名單</button>` : ''}${cdeskTab === 'club' && e.layer === 'club' && (e.rsvpEnabled || e.registrationKey) && !cancelled ? `<button type="button" onclick="cdeskProxy('${cdE(e.id)}')" class="px-2 py-0.5 bg-violet-50 border border-violet-300 text-violet-800 rounded-full font-bold hover:bg-violet-100">🙋 代為登記參加</button>` : ''}${cdeskTab === 'club' && e.layer === 'club' ? `<button type="button" onclick="cdeskAttend('${cdE(e.id)}','club')" class="px-2 py-0.5 bg-sky-50 border border-sky-300 text-sky-800 rounded-full font-bold hover:bg-sky-100">✅ 記錄實際出席</button>` : ''}</div>` : ''}
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

// ---------- 對應報名活動 ----------
// 行程對應到報名系統的某個活動（大類id::子活動名稱）後，社友在 LINE 看到這個行程就有「我要參加」，
// 並看得到本社誰已報名。分攤金／配合款不需要報名，不列入。
function cdeskRegOptions(current) {
    const opts = [];
    const isApp = (typeof CheckinCore !== 'undefined' && CheckinCore.isApportionEvent) ? CheckinCore.isApportionEvent : () => false;
    (typeof categoriesData !== 'undefined' ? categoriesData : []).forEach(cat => (cat.subEvents || []).forEach(sub => {
        if (isApp(cat.name, sub)) return;
        opts.push({ key: `${cat.id}::${sub}`, label: `${cat.name} › ${sub}` });
    }));
    if (current && !opts.some(o => o.key === current)) opts.push({ key: current, label: `（報名活動已不存在）${current}` });
    return opts;
}

// ---------- 新增／編輯／複製 ----------
function cdeskOpenForm(mode, i) {
    const src = (mode === 'edit' || mode === 'copy') ? cdeskEvents[i] : null;
    let v;
    if (src) {
        const s = Date.parse(src.start), e = Date.parse(src.end);
        v = { id: mode === 'edit' ? src.id : '', title: src.title, typeId: src.typeId, registrationKey: src.registrationKey || '', rsvpEnabled: !!src.rsvpEnabled, allDay: src.allDay, sd: cdYmd(s), st: src.allDay ? '09:00' : cdHm(s), ed: cdYmd(e), et: src.allDay ? '10:00' : cdHm(e), location: src.location, address: src.address, dressCode: src.dressCode, contactPerson: src.contactPerson, contactPhone: src.contactPhone, notes: src.notes };
    } else {
        const d = cdYmd(Date.now());
        v = { id: '', title: '', typeId: null, registrationKey: '', rsvpEnabled: true, allDay: false, sd: d, st: '09:00', ed: d, et: '10:00', location: '', address: '', dressCode: '', contactPerson: '', contactPhone: '', notes: '' };
    }
    const inp = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white', lab = 'block text-xs font-bold text-slate-600 mb-1 mt-3';
    const where = cdeskTab === 'district' ? '地區行程' : `${cdMyClub()} 社內行程`;
    document.getElementById('cdeskBody').innerHTML = `<button type="button" onclick="cdeskReload()" class="text-sm font-bold text-blue-700">‹ 返回列表（不儲存）</button>
        <div class="mt-2 max-w-2xl">
            <h4 class="font-black text-lg text-slate-900">${mode === 'edit' ? '編輯' : mode === 'copy' ? '複製' : '新增'}${cdE(where)}</h4>
            ${mode === 'copy' ? '<p class="text-xs text-slate-500 mt-1">已帶入原行程的資料，請修改日期等欄位後儲存。</p>' : ''}
            <label class="${lab}" for="cdTitle">標題 <span class="text-rose-600">*</span></label><input id="cdTitle" type="text" maxlength="100" value="${cdE(v.title)}" class="${inp}" placeholder="例：松景社授證典禮">
            <label class="${lab}" for="cdType">活動類型</label><select id="cdType" class="${inp}"><option value="">未分類</option>${cdeskTypes.map(t => `<option value="${t.id}" ${v.typeId === t.id ? 'selected' : ''}>${cdE(t.name)}</option>`).join('')}</select>
            <label class="${lab}" for="cdReg">對應報名活動（選填）</label><select id="cdReg" class="${inp}"><option value="">不對應（社友只能查看，沒有「我要參加」）</option>${cdeskRegOptions(v.registrationKey).map(o => `<option value="${cdE(o.key)}" ${v.registrationKey === o.key ? 'selected' : ''}>${cdE(o.label)}</option>`).join('')}</select><p class="text-[11px] text-slate-500 mt-1">選了之後，社友在 LINE 看到這個行程會有「我要參加」按鈕，並看得到本社誰已報名。</p>
            <label class="flex items-start gap-2 mt-3 text-sm font-bold text-slate-700 border border-emerald-300 bg-emerald-50 rounded-lg px-3 py-2"><input id="cdRsvpOn" type="checkbox" class="w-4 h-4 mt-0.5" ${v.rsvpEnabled ? 'checked' : ''}><span>開放社友按「我要參加」<span class="block text-[11px] font-normal text-slate-600">新增行程預設開啟（例會、運動賽事、研討會…都一樣）。社友在 LINE 按了就看得到社內名單，並可一起勾選寶尊眷（名字從社友庫帶出）。選了上面的「對應報名活動」時，也可以開啟。</span></span></label>
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
    const ev = { title: g('cdTitle'), typeId: g('cdType') ? Number(g('cdType')) : null, allDay: allDay, registrationKey: g('cdReg'), rsvpEnabled: document.getElementById('cdRsvpOn').checked, start: start, end: end, location: g('cdLoc'), address: g('cdAddr'), dressCode: g('cdDress'), contactPerson: g('cdCP'), contactPhone: g('cdPh'), notes: g('cdNotes') };
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

// ---------- 執秘端：社友在 LINE 按了「我要參加」的名單 ----------
// 顯示在報名表上方（#calRsvpBox）。每位社友可一鍵「加入報名名單」＝勾進目前的報名表（不會自動送出，
// 執秘仍要確認欄位後按「送出本社報名表」）。已經在報名表（或已送出的報名）裡的人不會再列出。
// 這個提示只讀取、不寫入；renderCalRsvpBox() 由 renderSelectedMembersTable() 呼叫，所以只用快取畫，過期才重新連網。
let cdRsvp = { key: '', club: '', at: 0, loading: false, people: [], linked: false, err: '' };
function cdRsvpKey() { try { return getActivePaymentKey(); } catch (e) { return ''; } }
function cdRsvpAuth(club) {
    if (cdIsSuper() && cdeskAdminPw) return { adminPassword: cdeskAdminPw, targetClub: club };
    return { club: club, clubPassword: ((typeof appAuthData !== 'undefined' && appAuthData.clubPasswords) || {})[club] || (typeof DEFAULT_CLUB_PASSWORD !== 'undefined' ? DEFAULT_CLUB_PASSWORD : '') || '' };
}
async function cdRsvpFetch(force) {
    const key = cdRsvpKey(), club = (typeof selectedClubName === 'string') ? selectedClubName : '';
    if (!key || !club || !(DISTRICT && DISTRICT.calendarEnabled)) return;
    if (cdRsvp.loading && cdRsvp.key === key && cdRsvp.club === club) return;      // 同一個活動正在讀取中
    if (!force && cdRsvp.key === key && cdRsvp.club === club && Date.now() - cdRsvp.at < 30000) return;
    const mine = cdRsvp = { key: key, club: club, at: Date.now(), loading: true, people: [], linked: false, err: '' };
    try {
        const res = await fetch(SUPABASE_URL + '/functions/v1/line-checkin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
            body: JSON.stringify(Object.assign({ action: 'cal_desk_rsvp', key: key }, cdRsvpAuth(club)))
        });
        const j = res.status === 404 ? { ok: false } : await res.json();
        mine.people = j.ok ? (j.people || []) : []; mine.linked = !!(j.ok && j.linked); mine.err = j.ok ? '' : (j.code || 'ERR');
    } catch (e) { mine.err = 'NETWORK'; }
    mine.loading = false;       // 只更新「這一次」的狀態：回來時如果已經換了活動，舊結果不會污染新的
    if (cdRsvp === mine) renderCalRsvpBox();
}
function cdRsvpPending() {   // 還沒進報名表的人
    const club = cdRsvp.club;
    const sub = (cdRsvp.key.split('::')[1]) || '';
    const submitted = (((typeof registrationOrders !== 'undefined' && registrationOrders[sub]) || []).find(o => o && o.clubName === club) || {}).items || [];
    const has = p => (typeof currentFormSelectedMembers !== 'undefined' ? currentFormSelectedMembers : []).concat(submitted).some(m => m && (m.name || '') === p.name && (m.nickname || '') === (p.nickname || ''));
    return cdRsvp.people.filter(p => !has(p));
}
function renderCalRsvpBox() {
    const box = document.getElementById('calRsvpBox');
    if (!box) return;
    if (!(DISTRICT && DISTRICT.calendarEnabled)) { box.classList.add('hidden'); return; }
    const key = cdRsvpKey(), club = (typeof selectedClubName === 'string') ? selectedClubName : '';
    if (cdRsvp.key !== key || cdRsvp.club !== club || Date.now() - cdRsvp.at >= 30000) cdRsvpFetch(false);
    const list = (cdRsvp.key === key && cdRsvp.club === club) ? cdRsvpPending() : [];
    if (!list.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.classList.remove('hidden');
    box.innerHTML = `<div class="border border-amber-300 bg-amber-50 rounded-lg px-3 py-2.5">
        <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="text-xs font-bold text-amber-900">📱 社友在 LINE 行事曆按了「我要參加」（${list.length} 位，尚未進報名表）</div>
            <button type="button" onclick="cdRsvpAddAll()" class="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-xs font-bold">全部加入報名名單</button>
        </div>
        <div class="mt-2 flex flex-wrap gap-1.5">${list.map(p => `<button type="button" data-key="${cdE(p.key)}" onclick="cdRsvpAdd(this.dataset.key)" class="px-2.5 py-1 bg-white border border-amber-300 hover:bg-amber-100 rounded-full text-xs font-bold text-slate-800" title="加入報名名單">＋ ${cdE(p.name)}${p.nickname ? ' ' + cdE(p.nickname) : ''}</button>`).join('')}</div>
        <p class="text-[11px] text-amber-800 mt-1.5">加入後請確認參賽／葷素等欄位，再按「送出本社報名表」才算正式報名。</p>
    </div>`;
}
function cdRsvpAdd(key) { cdRsvpAddMany([key]); }
function cdRsvpAddAll() { cdRsvpAddMany(cdRsvpPending().map(p => p.key)); }
function cdRsvpAddMany(keys) {
    if (typeof isEventLockedToday !== 'undefined' && isEventLockedToday) { alert('⚠️ 本活動今日已封存（唯讀狀態），無法增刪人員！'); return; }
    const members = (clubMemberDatabase[selectedClubName] || []);
    let added = 0; const missing = [];
    keys.forEach(k => {
        const p = cdRsvp.people.find(x => x.key === k); if (!p) return;
        const t = members.find(m => m.name === p.name && (m.nickname || '') === (p.nickname || ''));
        if (!t) { missing.push(p.name); return; }
        if (currentFormSelectedMembers.some(sm => sm.name === t.name && sm.nickname === t.nickname)) return;
        // 欄位與 toggleMemberSelection 新增時一致
        currentFormSelectedMembers.push({ role: t.role, nickname: t.nickname, name: t.name, diet: t.diet, veganNote: t.veganNote, handicap: t.handicap !== undefined ? t.handicap : '', participation: '參賽' });
        added++;
    });
    renderMemberMasterTable(); renderSelectedMembersTable(); updateLinePreviewText();
    cdToast(`已加入 ${added} 位到報名名單，請確認欄位後按「送出本社報名表」` + (missing.length ? `（${missing.join('、')} 不在社友庫，請先新增）` : ''));
}

// ---------- 執秘把人從已送出的報名表移除後：他在行事曆上留下的舊登記一併清掉 ----------
// 由 index.html 的 submitRegistrationInner()（重新送出時少了誰）與 deleteMember()（刪除社友並一併移除報名）在存檔成功後呼叫。
// 2026-11-24 起，社友在 LINE 報名＝直接進報名表，所以執秘把人拿掉後手機就不再顯示已報名（手機只看報名表）。
// 這裡只是把更早以前留下的「表示參加」紀錄（或 PELS 的舊紀錄）順手清掉，才不會又出現在報名表上方的提示裡。
// 使用者要求同步、不必再問執秘；沒有舊紀錄就什麼都不做，連不上雲端也不打擾（報名表已經存好）。
async function cdRsvpCall(action, key, club, extra) {
    try {
        const res = await fetch(SUPABASE_URL + '/functions/v1/line-checkin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
            body: JSON.stringify(Object.assign({ action: action, key: key }, cdRsvpAuth(club), extra || {}))
        });
        if (res.status === 404) return { ok: false, code: 'NOT_DEPLOYED' };
        const j = await res.json();
        return j && typeof j.ok === 'boolean' ? j : { ok: false, code: 'SERVER_ERROR' };
    } catch (e) { return { ok: false, code: 'NETWORK' }; }
}
async function cdRsvpOfferCancel(key, club, removed, eventName) {
    if (!(typeof DISTRICT !== 'undefined' && DISTRICT && DISTRICT.calendarEnabled) || !key || !club || !removed || !removed.length) return;
    const r = await cdRsvpCall('cal_desk_rsvp', key, club);
    if (!r.ok || !(r.people || []).length) return;
    const hit = r.people.filter(p => removed.some(m => (m.name || '') === p.name && (m.nickname || '') === (p.nickname || '')));
    if (!hit.length) return;
    const c = await cdRsvpCall('cal_desk_rsvp_cancel', key, club, { keys: hit.map(p => p.key) });
    if (c.ok && c.removed) cdToast(`已同步取消 ${hit.length} 位在 LINE 行事曆上的登記`);
    if (cdRsvp.key === key && cdRsvp.club === club) cdRsvpFetch(true);
}

// ---------- 主委的「活動日期」→ 同步成行事曆的地區行程 ----------
// 由 index.html 的 saveChairSettings() 在存檔後呼叫。只送「這個活動」的日期時間，不碰報名資料；
// 失敗不影響主委設定的儲存（日期已經存進報名系統），只提示「尚未同步到行事曆」。
// 認證：最高管理員用行事曆後台密碼（第一次會詢問）；主委社用本社登入密碼（雲端會確認這一社確實是該活動的主委）。
async function syncEventDateToCalendar(key, ev) {
    if (!(DISTRICT && DISTRICT.calendarEnabled) || !key) return;
    let auth;
    if (cdIsSuper()) {
        if (!cdeskAdminPw) {
            const v = window.prompt('活動日期要同步到行事曆，請輸入「行事曆後台密碼」\n（按取消＝日期只存在報名系統，不同步）');
            if (!v) { cdToast('日期已儲存，但尚未同步到行事曆', '⚠️'); return; }
            cdeskAdminPw = v;
        }
        auth = { adminPassword: cdeskAdminPw };
    } else {
        const club = (loggedInUser && loggedInUser.club) || '';
        auth = { club: club, clubPassword: ((typeof appAuthData !== 'undefined' && appAuthData.clubPasswords) || {})[club] || (typeof DEFAULT_CLUB_PASSWORD !== 'undefined' ? DEFAULT_CLUB_PASSWORD : '') || '' };
    }
    const hint = document.getElementById('cfgEventDateHint');
    try {
        const res = await fetch(SUPABASE_URL + '/functions/v1/line-checkin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
            body: JSON.stringify(Object.assign({ action: 'cal_desk_sync', key: key, date: ev.date || '', startTime: ev.start || '', endTime: ev.end || '' }, auth))
        });
        const r = res.status === 404 ? { ok: false, code: 'LINE_NOT_CONFIGURED' } : await res.json();
        if (r.ok) {
            const msg = r.removed ? '已從行事曆移除這個活動' : (ev.date ? (r.created ? '已建立行事曆行程' : '已更新行事曆行程') : '');
            if (msg) cdToast('📅 ' + msg + '，社友在 LINE 行事曆看得到');
            if (hint) hint.textContent = ev.date ? `✅ ${msg}（${ev.date}${ev.start ? ' ' + ev.start : '（全天）'}）。` : '填了活動日期，按「儲存主委設定」後，會自動出現在 LINE 行事曆，社友可在那裡按「我要參加」。';
        } else if (r.code === 'CAL_REG_UNAVAILABLE') {
            /* 分攤金／配合款等不需要報名的項目，不同步 */
        } else {
            if (r.code === 'CAL_ADMIN_AUTH_FAILED') cdeskAdminPw = '';
            cdToast('日期已儲存，但同步行事曆失敗：' + cdErr(r.code === 'CAL_FORBIDDEN' ? 'CAL_FORBIDDEN' : r.code), '⚠️');
        }
    } catch (e) { cdToast('日期已儲存，但同步行事曆失敗：網路連線不穩', '⚠️'); }
}

// ---------- 某個行程的「表示參加」名單（含寶尊眷），可複製貼到 LINE ----------
async function cdeskShowRsvp(i) {
    const e = cdeskEvents[i]; if (!e) return;
    const box = document.getElementById('cdeskBody');
    box.innerHTML = '<div class="text-sm text-slate-500 py-6 text-center">讀取名單中…</div>';
    const r = await cdApi('cal_desk_event_rsvp', cdeskTab, { id: e.id });
    if (!r.ok) { cdToast(cdErr(r.code), '⚠️'); return cdeskReload(); }
    const people = r.people || [];
    const line = p => `${p.name}${p.nickname ? ' ' + p.nickname : ''}${p.guest ? `（${/眷/.test(p.role) ? '寶尊眷' : (p.role || '眷屬')}）` : ''}${p.proxy ? '（執秘代登記）' : ''}`;
    const byClub = {}; people.forEach(p => { (byClub[p.club] = byClub[p.club] || []).push(p); });
    const text = `${r.title} 參加名單（${people.length} 人）\n` + Object.keys(byClub).map(c => (cdeskTab === 'district' ? `【${c}】\n` : '') + byClub[c].map((p, n) => `${n + 1}. ${line(p)}`).join('\n')).join('\n');
    window.__cdeskRsvpText = text;
    box.innerHTML = `<button type="button" onclick="cdeskReload()" class="text-sm font-bold text-blue-700">‹ 返回列表</button>
        <div class="mt-2 flex flex-wrap items-center justify-between gap-2"><h4 class="font-black text-lg text-slate-900">🙋 ${cdE(r.title)}　參加名單（${people.length} 人）</h4>
        <button type="button" onclick="cdeskCopyRsvp()" class="px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-xs font-bold">複製名單</button></div>
        ${people.length ? Object.keys(byClub).map(c => `<div class="mt-3">${cdeskTab === 'district' ? `<div class="text-xs font-black text-slate-700">${cdE(c)}（${byClub[c].length}）</div>` : ''}<div class="mt-1 flex flex-wrap gap-1.5">${byClub[c].map(p => `<span class="px-2.5 py-1 rounded-full text-sm font-bold ${p.guest ? 'bg-pink-50 border border-pink-200 text-pink-900' : 'bg-amber-50 border border-amber-200 text-amber-900'}">${cdE(line(p))}</span>`).join('')}</div></div>`).join('') : '<div class="mt-4 text-sm text-slate-500 border border-dashed border-slate-300 rounded-lg px-3 py-6 text-center">目前還沒有人表示參加。</div>'}
        <p class="text-[11px] text-slate-500 mt-4">這是社友在 LINE 按「我要參加」（或執秘代為登記）的名單；有對應報名活動的行程，正式報名仍以報名表為準。</p>`;
}
function cdeskCopyRsvp() {
    const t = window.__cdeskRsvpText || '';
    try { navigator.clipboard.writeText(t).then(() => cdToast('已複製名單'), () => cdToast('無法自動複製，請手動選取', '⚠️')); } catch (e) { cdToast('無法自動複製，請手動選取', '⚠️'); }
}

// =====================================================================
// 社內例會：記錄實際出席 ＋ 例會統計（每位社友的參加次數、匯出 Excel）
// 「表示參加」是社友在 LINE 自己按的意願；「實際出席」是執秘在這裡勾選後儲存的紀錄（calendar_attendance）。
// 出席率＝實際出席次數 ÷ 期間內「已記錄出席」的例會場數（還沒記錄的場次不列入分母）。
// =====================================================================
let cdStats = null;            // 最近一次讀到的統計資料
let cdStatsPeriod = 'year';    // year／lastyear／month／lastmonth／custom
let cdStatsCustom = { from: '', to: '' };
const cdIsGuestMember = m => !!(m && (m.spouseOfId || /眷/.test(String(m.role || ''))));
const cdPk = m => `${(m && m.name) || ''}|${(m && m.nickname) || ''}`;

// 社友庫依「P（社長）→ S（秘書）→ Nick Name」排序，寶尊眷緊接在社友下方，方便勾選與閱讀
function cdOrderedMembers(club) {
    const list = ((typeof clubMemberDatabase !== 'undefined' && clubMemberDatabase[club]) || []).filter(m => m && m.name);
    if (typeof sortMembersForDisplay === 'function') return sortMembersForDisplay(list);   // P → S → Nick Name，寶尊眷跟在社友下方（index.html）
    const heads = list.filter(m => !cdIsGuestMember(m)), out = [];
    heads.forEach(h => { out.push(h); list.filter(m => cdIsGuestMember(m) && m.spouseOfId === h.id).forEach(g => out.push(g)); });
    list.filter(m => cdIsGuestMember(m) && !out.includes(m)).forEach(g => out.push(g));   // 找不到對應社友的寶尊眷放最後
    return out;
}

// ---------- 執秘代為登記參加（不會用 LINE 的長輩等） ----------
// 勾選＝代為登記。社友自己在 LINE 登記的人（含他帶的寶尊眷）鎖住不能改，要取消請本人在 LINE 按「取消參加」。
// 儲存後這些人會出現在 LINE 的參加名單（標「執秘代登記」），也算進表示參加人數、出席勾選預設與例會統計。
// 同行的非社友（子女、外勞、朋友，或社友庫沒有資料的寶尊眷）：存在 cdPx.guests＝[{host, type, name}]，host＝帶他來的社友 key。
// 「貼上 LINE 接龍」：用 index.html 的 parseLineRelay 找出社友，再依「+1／+2／夫婦／3位」判斷帶幾位：
//   第 1 位＝該社友的寶尊眷（社友庫有就直接勾，沒有就留一個寶尊眷欄位讓執秘填名字）；第 2 位起＝下拉選單選 子女／外勞／朋友／其他。
const CD_GUEST_TYPES = ['寶(尊)眷', '子女', '外勞', '朋友', '其他'];
let cdPx = null;      // { id, club, members, self:Set, guests:[], relay:null }
const cdIsExtKey = k => String(k || '').startsWith('guest:');
async function cdeskProxy(id) {
    const box = document.getElementById('cdeskBody');
    box.innerHTML = '<div class="text-sm text-slate-500 py-6 text-center">讀取中…</div>';
    const r = await cdApi('cal_desk_proxy_get', 'club', { id: id });
    if (!r.ok) { cdToast(r.code === 'CAL_REG_UNAVAILABLE' ? '這個行程沒有開放參加，請先在「編輯」勾選「開放社友按我要參加」。' : cdErr(r.code), '⚠️'); return cdeskReload(); }
    const members = cdOrderedMembers(r.club);
    const people = r.people || [];
    const by = new Map(people.filter(p => !p.ext).map(p => [p.key, p]));
    const t = cdParts(Date.parse(r.start));
    const known = new Set(members.map(cdPk));
    const outside = people.filter(p => !p.ext && !known.has(p.key));     // 已不在社友庫，但名單上還有
    cdPx = { id: id, club: r.club, members: members, self: new Set(people.filter(p => !p.proxy).map(p => p.key)),
        guests: people.filter(p => p.ext && p.proxy).map(p => ({ host: p.guestOf, type: CD_GUEST_TYPES.includes(p.role) ? p.role : '其他', name: p.name })),
        selfGuests: people.filter(p => p.ext && !p.proxy).length + outside.filter(p => !p.proxy).length, relay: null };
    box.innerHTML = `<button type="button" onclick="cdeskReload()" class="text-sm font-bold text-blue-700">‹ 返回（不儲存）</button>
        <div class="mt-2 flex flex-wrap items-start justify-between gap-2"><div><h4 class="font-black text-lg text-slate-900">🙋 代為登記參加：${cdE(r.title)}</h4>
        <div class="text-xs text-slate-500 mt-0.5">${t.y}/${cdP2(t.m)}/${cdP2(t.d)}（${CDESK_WD[t.wd]}）・${cdE(r.club)}</div></div>
        <button type="button" onclick="cdPxRelayToggle()" class="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold shadow-sm">💬 貼上 LINE 接龍</button></div>
        <p class="text-xs text-slate-600 mt-1 leading-relaxed">幫沒有用 LINE 的社友（例如長輩）登記參加。勾選後按「儲存」，社友在 LINE 看到的參加名單就會有他們（標「執秘代登記」）。<br>灰色鎖住的是社友<b>自己在 LINE 登記</b>的，要取消請本人在 LINE 按「取消參加」。</p>
        <div id="cdPxRelay" class="hidden mt-3 border border-emerald-300 bg-emerald-50/50 rounded-xl p-3">
            <div class="text-sm font-black text-slate-900">💬 貼上 LINE 群組的接龍</div>
            <p class="text-[11px] text-slate-600 mt-0.5 leading-relaxed">在 LINE 接龍訊息上長按 →「複製」，貼到下面再按「分析」。寫「+1」＝帶寶尊眷（社友庫沒有寶尊眷資料時，會留欄位給您填名字）；「+2」以上，第 2 位起請在下拉選單選子女／外勞／朋友。寫「取消」「請假」的會略過。</p>
            <textarea id="cdPxRelayText" rows="6" class="mt-2 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white" placeholder="例：&#10;1. P Robert&#10;2. PP Fruit +1&#10;3. 崔敬福 +2"></textarea>
            <div class="mt-2 flex gap-2"><button type="button" onclick="cdPxRelayAnalyze()" class="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-sm font-bold">分析</button><button type="button" onclick="cdPxRelayToggle(false)" class="px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm font-bold">收起</button></div>
            <div id="cdPxRelayResult" class="mt-2"></div>
        </div>
        <div class="mt-3 text-xs text-slate-600">目前參加 <b id="cdProxyTotal">0</b> 人（其中執秘代登記 <b id="cdProxyN">0</b> 人）</div>
        ${members.length ? `<div class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">${members.map(m => {
            const k = cdPk(m), g = cdIsGuestMember(m), p = by.get(k), self = p && !p.proxy;
            return `<label class="flex items-center gap-2 border ${g ? 'border-pink-200 bg-pink-50/50 ml-4' : 'border-slate-200 bg-white'} rounded-lg px-2.5 py-1.5 text-sm ${self ? 'opacity-60' : 'cursor-pointer'}"><input type="checkbox" class="w-4 h-4 ${self ? 'cd-pxself' : 'cd-px'}" data-key="${cdE(k)}" ${p ? 'checked' : ''} ${self ? 'disabled' : ''} onchange="cdPxGuestsRender()"><span class="font-bold">${cdE(m.name)}</span>${m.nickname ? `<span class="text-slate-500">${cdE(m.nickname)}</span>` : ''}${g ? '<span class="text-[11px] text-pink-700">寶尊眷</span>' : (m.role ? `<span class="text-[11px] text-slate-400">${cdE(m.role)}</span>` : '')}${self ? '<span class="ml-auto text-[11px] text-emerald-700 font-bold">📱 本人已在 LINE 登記</span>' : p ? '<span class="ml-auto text-[11px] text-violet-700 font-bold">執秘代登記</span>' : ''}</label>`;
        }).join('')}</div>` : '<div class="mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-3">這個社的社友庫是空的，請先在報名系統建立社友名單。</div>'}
        ${outside.length ? `<div class="mt-2 text-xs text-slate-500">另有已不在社友庫的登記：${outside.map(p => cdE(p.name + (p.nickname ? ' ' + p.nickname : ''))).join('、')}${outside.some(p => p.proxy) ? '（執秘代登記的這幾位，儲存後會一併移除）' : ''}</div>` : ''}
        <div class="mt-4 border border-pink-200 bg-pink-50/40 rounded-xl p-3">
            <div class="flex flex-wrap items-center justify-between gap-2"><div class="font-black text-sm text-slate-900">👨‍👩‍👧 同行的非社友（子女、外勞、朋友，或社友庫沒有資料的寶尊眷）</div>
            <div class="flex items-center gap-1.5 text-xs"><select id="cdPxAddHost" class="border border-slate-300 rounded px-1.5 py-1 bg-white max-w-[12rem]"><option value="">選擇帶他來的社友</option>${members.filter(m => !cdIsGuestMember(m)).map(m => `<option value="${cdE(cdPk(m))}">${cdE(m.nickname || m.name)}（${cdE(m.name)}）</option>`).join('')}</select><button type="button" onclick="cdPxGuestAdd()" class="px-2.5 py-1 bg-white border border-pink-300 text-pink-800 rounded-md font-bold">＋ 新增同行者</button></div></div>
            <div id="cdPxGuests" class="mt-2"></div>
        </div>
        <div id="cdPxError" class="hidden mt-3 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2"></div>
        <button type="button" id="cdProxySave" onclick="cdeskProxySave('${cdE(id)}')" class="mt-4 px-8 py-2.5 bg-blue-700 hover:bg-blue-800 text-white font-bold rounded-lg text-sm shadow-sm">儲存</button>`;
    cdPxGuestsRender();
}
function cdPxHostLabel(key) { const m = (cdPx && cdPx.members || []).find(x => cdPk(x) === key); return m ? `${m.nickname || m.name}（${m.name}）` : key.split('|')[0]; }
function cdPxIsAttending(key) {
    if (cdPx && cdPx.self.has(key)) return true;
    const c = document.querySelector(`.cd-px[data-key="${CSS.escape(key)}"]`);
    return !!(c && c.checked);
}
function cdPxGuestsRender() {
    const box = document.getElementById('cdPxGuests'); if (!box || !cdPx) return;
    if (!cdPx.guests.length) { box.innerHTML = '<div class="text-xs text-slate-500">目前沒有。社友帶了社友庫以外的人（例如子女、外勞、朋友）時，在上面選社友後按「＋ 新增同行者」，或用「💬 貼上 LINE 接龍」自動帶入。</div>'; cdProxyCount(); return; }
    box.innerHTML = cdPx.guests.map((g, i) => `<div class="flex flex-wrap items-center gap-1.5 py-1 border-b border-pink-100 text-sm">
            <span class="text-xs text-slate-600 min-w-[9rem]">${cdE(cdPxHostLabel(g.host))} 帶的</span>
            <select class="cd-pxg-type border ${g.type ? 'border-slate-300' : 'border-rose-400 bg-rose-50'} rounded px-1.5 py-1 text-sm bg-white" onchange="cdPxGuestSet(${i},'type',this.value)"><option value="" ${g.type ? '' : 'selected'}>請選擇身分</option>${CD_GUEST_TYPES.map(t => `<option value="${cdE(t)}" ${g.type === t ? 'selected' : ''}>${t === '寶(尊)眷' ? '寶尊眷' : t}</option>`).join('')}</select>
            <input type="text" maxlength="30" value="${cdE(g.name)}" oninput="cdPxGuestSet(${i},'name',this.value)" class="border border-slate-300 rounded px-2 py-1 text-sm w-40" placeholder="${g.type === '寶(尊)眷' ? '寶尊眷姓名' : '姓名（可不填）'}">
            ${cdPxIsAttending(g.host) ? '' : '<span class="text-[11px] text-rose-700 font-bold">⚠️ 帶他的社友還沒勾選</span>'}
            <button type="button" onclick="cdPxGuestDel(${i})" class="ml-auto text-slate-400 hover:text-rose-600 font-bold px-1" title="移除">✕</button>
        </div>`).join('');
    cdProxyCount();
}
function cdPxGuestSet(i, field, v) {
    if (!cdPx || !cdPx.guests[i]) return;
    cdPx.guests[i][field] = v;
    if (field === 'type') cdPxGuestsRender();     // 換身分時更新提示（姓名欄打字時不重畫，避免游標跳走）
}
function cdPxGuestDel(i) { if (cdPx) { cdPx.guests.splice(i, 1); cdPxGuestsRender(); } }
function cdPxCheck(key) { const c = document.querySelector(`.cd-px[data-key="${CSS.escape(key)}"]`); if (c) c.checked = true; }
function cdPxGuestAdd() {
    const sel = document.getElementById('cdPxAddHost'); const host = sel && sel.value;
    if (!host) return cdToast('請先選擇帶他來的社友', '⚠️');
    cdPxCheck(host);                                                       // 帶人的社友本人一定也參加
    cdPx.guests.push({ host: host, type: '', name: '' });
    cdPxGuestsRender();
}
function cdProxyCount() {
    const n = Array.from(document.querySelectorAll('.cd-px')).filter(c => c.checked).length + (cdPx ? cdPx.guests.length : 0);
    const self = document.querySelectorAll('.cd-pxself').length + (cdPx ? cdPx.selfGuests : 0);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('cdProxyTotal', n + self); set('cdProxyN', n);
}

// ---------- 貼上 LINE 接龍 ----------
function cdPxRelayToggle(show) {
    const el = document.getElementById('cdPxRelay'); if (!el) return;
    const on = show === undefined ? el.classList.contains('hidden') : show;
    el.classList.toggle('hidden', !on);
    if (on) { const t = document.getElementById('cdPxRelayText'); if (t) t.focus(); }
}
// 這一行除了本人還帶了幾位：「+2」＝2；「3位／三人」＝本人以外 2；「夫婦、伉儷、攜眷、+夫人」＝1
function cdRelayExtraCount(line) {
    const half = v => String(v).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    const body = half(String(line || '')).replace(/^\s*(\d{1,3}\s*[.、．)）:：]|[①-⑳]|(\d️?⃣)+|[-•●▪◆✅☑✔])\s*/, '');
    let m = body.match(/[+＋]\s*(\d{1,2})(?!\d)/);
    if (m) return Math.min(10, parseInt(m[1], 10));
    m = body.match(/([1-9]|[一二兩三四五六七八九])\s*(位|人|大人)/);
    if (m) { const n = /\d/.test(m[1]) ? parseInt(m[1], 10) : '一二三四五六七八九'.indexOf(m[1].replace('兩', '二')) + 1; return Math.max(0, Math.min(10, n - 1)); }
    if (/[+＋&＆]\s*(夫人|寶眷|尊眷|眷屬|眷|太太|先生|另一半|老婆|老公)|夫婦|伉儷|攜眷|偕眷/.test(body)) return 1;
    return 0;
}
// 分析接龍：回傳 { checks:[社友 key], guests:[{host,type,name}], rows:[顯示用], unmatched, ambiguous, skipped }
function cdPxRelayPlan(text, list) {
    const r = parseLineRelay(text, list);
    const checks = [], guests = [], rows = [];
    const addCheck = k => { if (!checks.includes(k)) checks.push(k); };
    const lines = [];
    r.matched.forEach(x => { if (!lines.includes(x.line)) lines.push(x.line); });
    lines.forEach(line => {
        const hits = r.matched.filter(x => x.line === line);
        hits.forEach(x => addCheck(cdPk(x.member)));
        const host = (hits.find(x => !x.viaSpouse) || {}).member;
        if (!host) return;
        const extra = cdRelayExtraCount(line), hk = cdPk(host), notes = [];
        if (extra >= 1) {
            const sp = cdIsGuestMember(host) ? null : list.find(m => m.spouseOfId === host.id);
            if (sp) { addCheck(cdPk(sp)); notes.push(`寶尊眷 ${sp.name}`); }
            else { guests.push({ host: hk, type: '寶(尊)眷', name: '' }); notes.push('寶尊眷（社友庫沒有資料，請填名字）'); }
            for (let n = 2; n <= extra; n++) { guests.push({ host: hk, type: '', name: '' }); notes.push(`第 ${n} 位（請選身分）`); }
        }
        rows.push({ line: line, names: hits.filter(x => !x.viaSpouse).map(x => x.member), extra: extra, notes: notes });
    });
    return { checks, guests, rows, unmatched: r.unmatched, ambiguous: r.ambiguous, skipped: r.skipped };
}
function cdPxRelayAnalyze() {
    const text = (document.getElementById('cdPxRelayText') || {}).value || '';
    const box = document.getElementById('cdPxRelayResult');
    if (!text.trim()) { box.innerHTML = '<div class="text-xs font-bold text-rose-700">請先貼上 LINE 接龍的文字。</div>'; return; }
    if (typeof parseLineRelay !== 'function') { box.innerHTML = '<div class="text-xs font-bold text-rose-700">接龍分析元件尚未載入，請重新整理後再試。</div>'; return; }
    const list = ((typeof clubMemberDatabase !== 'undefined' && clubMemberDatabase[cdPx.club]) || []).filter(m => m && m.name);
    const plan = cdPx.relay = cdPxRelayPlan(text, list);
    const L = (title, cls, items) => items.length ? `<div class="mt-2"><div class="text-xs font-bold ${cls}">${title}</div><ul class="mt-0.5 space-y-0.5 text-xs text-slate-700">${items.join('')}</ul></div>` : '';
    box.innerHTML = `${L(`✅ 找到 ${plan.rows.length} 行`, 'text-emerald-800', plan.rows.map(x => `<li class="border-b border-emerald-100 py-0.5"><b>${x.names.map(m => cdE(m.nickname || m.name)).join('、')}</b>${x.extra ? ` <span class="text-pink-700 font-bold">＋${x.extra}：${x.notes.map(cdE).join('、')}</span>` : ''}<span class="text-slate-400">　← ${cdE(x.line)}</span></li>`))}
        ${L('⚠️ 找不到對應社友的行（請手動勾選）', 'text-rose-700', plan.unmatched.map(l => `<li>${cdE(l)}</li>`))}
        ${L('⚠️ 同名無法判斷是哪一位（請手動勾選）', 'text-rose-700', plan.ambiguous.map(a => `<li>${cdE(a.line)} → 可能是：${a.names.map(cdE).join('、')}</li>`))}
        ${L('略過（取消／請假）', 'text-slate-500', plan.skipped.map(l => `<li class="text-slate-500">${cdE(l)}</li>`))}
        ${plan.rows.length ? `<button type="button" onclick="cdPxRelayApply()" class="mt-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold">✅ 套用到下方名單</button><span class="ml-2 text-[11px] text-slate-500">套用後請檢查，再按「儲存」。</span>` : '<div class="mt-2 text-xs text-slate-500">沒有找到社友庫裡的人。</div>'}`;
}
function cdPxRelayApply() {
    const plan = cdPx && cdPx.relay; if (!plan) return;
    plan.checks.forEach(cdPxCheck);
    // 同一位社友已經有幾個同行者就不重複加（重貼同一份接龍不會變兩倍）
    const hosts = [...new Set(plan.guests.map(g => g.host))];
    let added = 0;
    hosts.forEach(h => {
        const want = plan.guests.filter(g => g.host === h), have = cdPx.guests.filter(g => g.host === h).length;
        want.slice(have).forEach(g => { cdPx.guests.push(Object.assign({}, g)); added++; });
    });
    cdPxGuestsRender();
    cdPxRelayToggle(false);
    const need = cdPx.guests.filter(g => !g.type || (g.type === '寶(尊)眷' && !g.name)).length;
    cdToast(`已依接龍勾選 ${plan.checks.length} 位社友${added ? `、新增 ${added} 位同行者` : ''}${need ? `；有 ${need} 位同行者要補身分或名字` : ''}，確認後請按「儲存」`, '💬');
}
async function cdeskProxySave(id) {
    if (cdeskBusy) return;
    const keys = Array.from(document.querySelectorAll('.cd-px')).filter(c => c.checked).map(c => c.dataset.key);
    const err = m => { const b = document.getElementById('cdPxError'); if (b) { b.textContent = m; b.classList.remove('hidden'); b.scrollIntoView({ block: 'center' }); } };
    const guests = (cdPx ? cdPx.guests : []).map(g => ({ host: g.host, type: g.type, name: String(g.name || '').trim() }));
    if (guests.some(g => !g.type)) return err('有同行者還沒選身分（子女／外勞／朋友…），請在紅框的下拉選單選擇。');
    const orphan = guests.find(g => !cdPxIsAttending(g.host));
    if (orphan) return err(`${cdPxHostLabel(orphan.host)} 帶了同行者，但他本人沒有勾選參加。請勾選他，或把同行者移除。`);
    const btn = document.getElementById('cdProxySave'); cdeskBusy = true; btn.disabled = true; btn.textContent = '儲存中…';
    const r = await cdApi('cal_desk_proxy_save', 'club', { id: id, keys: keys, guests: guests });
    cdeskBusy = false;
    if (!r.ok) { btn.disabled = false; btn.textContent = '儲存'; return cdToast(r.code === 'CAL_EVENT_CANCELLED' ? '這個行程已取消，無法再登記。' : cdErr(r.code), '⚠️'); }
    cdToast(`已儲存，目前參加 ${(r.people || []).length} 人（社友在 LINE 立刻看得到）`, '✅');
    cdeskReload();
}

// ---------- 記錄實際出席 ----------
let cdAttendBack = 'club';
async function cdeskAttend(id, back) {
    cdAttendBack = back || 'club';
    const box = document.getElementById('cdeskBody');
    box.innerHTML = '<div class="text-sm text-slate-500 py-6 text-center">讀取中…</div>';
    const r = await cdApi('cal_desk_attend_get', 'club', { id: id });
    if (!r.ok) { cdToast(cdErr(r.code), '⚠️'); return cdeskBackFromAttend(); }
    const members = cdOrderedMembers(r.club);
    const rsvpBy = new Map((r.rsvp || []).map(x => [x.key, x]));
    const pre = new Set(r.recorded ? r.attended : (r.rsvp || []).map(x => x.key));   // 還沒記錄過時，先帶入「表示參加」的人
    // 分兩組：上面＝有報名（社友自己在 LINE 登記＋執秘代登記），以及之前已記錄為出席的人；下面＝其他社友（臨時出席時勾選）
    const top = new Set([...rsvpBy.keys(), ...(r.attended || [])]);
    const g1 = members.filter(m => top.has(cdPk(m))), g2 = members.filter(m => !top.has(cdPk(m)));
    // 執秘代登記的同行者（不在社友庫）：放在上面一組、帶他來的社友下方
    (r.rsvp || []).filter(x => x.ext).forEach(x => {
        const pm = { name: x.name, nickname: '', role: x.role === '寶(尊)眷' ? '寶(尊)眷' : (x.role || '同行'), spouseOfId: 'ext', __key: x.key, __ext: true };
        let at = g1.findIndex(m => cdPk(m) === x.guestOf);
        if (at < 0) { g1.push(pm); return; }
        // 跳過已經排在這位社友下方的寶尊眷與同行者，插在他們後面
        while (at + 1 < g1.length && cdIsGuestMember(g1[at + 1])) at++;
        g1.splice(at + 1, 0, pm);
    });
    const t = cdParts(Date.parse(r.start));
    const row = m => { const k = m.__key || cdPk(m), g = cdIsGuestMember(m), x = rsvpBy.get(k); return `<label class="flex items-center gap-2 border ${g ? 'border-pink-200 bg-pink-50/50 ml-4' : 'border-slate-200 bg-white'} rounded-lg px-2.5 py-1.5 text-sm cursor-pointer"><input type="checkbox" class="w-4 h-4 cd-att" data-key="${cdE(k)}" data-guest="${g ? 1 : 0}" ${pre.has(k) ? 'checked' : ''} onchange="cdAttendCount()"><span class="font-bold">${cdE(m.name)}</span>${m.nickname ? `<span class="text-slate-500">${cdE(m.nickname)}</span>` : ''}${m.__ext ? `<span class="text-[11px] text-pink-700">${cdE(m.role === '寶(尊)眷' ? '寶尊眷' : m.role)}（非社友）</span>` : g ? '<span class="text-[11px] text-pink-700">寶尊眷</span>' : (m.role ? `<span class="text-[11px] text-slate-400">${cdE(m.role)}</span>` : '')}${x ? `<span class="ml-auto text-[11px] font-bold ${x.proxy ? 'text-violet-700' : 'text-emerald-700'}">${x.proxy ? '🙋 執秘代登記' : '🙋 LINE 報名'}</span>` : ''}</label>`; };
    const grp = (id, title, hint, list, cls, empty) => `<div class="mt-4 border ${cls} rounded-xl p-3">
            <div class="flex flex-wrap items-center justify-between gap-2"><div class="font-black text-sm text-slate-900">${title}（${list.length} 人・已勾 <span id="${id}N">0</span>）</div>
            ${list.length ? `<div class="flex gap-1.5 text-xs"><button type="button" onclick="cdAttendGroup('${id}',true)" class="px-2.5 py-1 bg-white border border-slate-300 rounded-md font-bold">本組全選</button><button type="button" onclick="cdAttendGroup('${id}',false)" class="px-2.5 py-1 bg-white border border-slate-300 rounded-md font-bold">本組清除</button></div>` : ''}</div>
            <div class="text-[11px] text-slate-500 mt-0.5">${hint}</div>
            ${list.length ? `<div id="${id}" class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">${list.map(row).join('')}</div>` : `<div class="mt-2 text-xs text-slate-500">${empty}</div>`}
        </div>`;
    box.innerHTML = `<button type="button" onclick="cdeskBackFromAttend()" class="text-sm font-bold text-blue-700">‹ 返回（不儲存）</button>
        <div class="mt-2"><h4 class="font-black text-lg text-slate-900">✅ 記錄實際出席：${cdE(r.title)}</h4>
        <div class="text-xs text-slate-500 mt-0.5">${t.y}/${cdP2(t.m)}/${cdP2(t.d)}（${CDESK_WD[t.wd]}）・${cdE(r.club)}　${r.recorded ? '<b class="text-emerald-700">已記錄過，可修改後重新儲存</b>' : '<b class="text-amber-700">尚未記錄，已先勾選有報名的人</b>'}</div></div>
        <div class="mt-3 text-xs text-slate-600">總共勾選 <b id="cdAttendCount">0</b> 人（社友 <b id="cdAttendM">0</b>、寶尊眷 <b id="cdAttendG">0</b>）</div>
        ${members.length ? grp('cdAttG1', '📋 有報名的人', '社友自己在 LINE 報名，或執秘代為登記的人。沒來的請取消勾選。', g1, 'border-emerald-300 bg-emerald-50/40', '這次還沒有人報名。')
            + grp('cdAttG2', '👥 其他社友（沒有報名）', '沒有報名但臨時出席的人，在這裡勾選。', g2, 'border-slate-200 bg-slate-50', '社友庫裡的人都已經在上面一組。')
            : '<div class="mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-3">這個社的社友庫是空的，請先在報名系統建立社友名單。</div>'}
        <button type="button" id="cdAttendSave" onclick="cdeskAttendSave('${cdE(id)}')" class="mt-4 px-8 py-2.5 bg-blue-700 hover:bg-blue-800 text-white font-bold rounded-lg text-sm shadow-sm">儲存出席紀錄</button>`;
    cdAttendCount();
}
function cdAttendGroup(id, on) { document.querySelectorAll(`#${id} .cd-att`).forEach(c => { c.checked = on; }); cdAttendCount(); }
function cdAttendCount() {
    const on = Array.from(document.querySelectorAll('.cd-att')).filter(c => c.checked);
    const g = on.filter(c => c.dataset.guest === '1').length;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('cdAttendCount', on.length); set('cdAttendM', on.length - g); set('cdAttendG', g);
    ['cdAttG1', 'cdAttG2'].forEach(id => set(id + 'N', document.querySelectorAll(`#${id} .cd-att:checked`).length));
}
async function cdeskAttendSave(id) {
    if (cdeskBusy) return;
    const keys = Array.from(document.querySelectorAll('.cd-att')).filter(c => c.checked).map(c => c.dataset.key);
    const btn = document.getElementById('cdAttendSave'); cdeskBusy = true; btn.disabled = true; btn.textContent = '儲存中…';
    const r = await cdApi('cal_desk_attend_save', 'club', { id: id, keys: keys });
    cdeskBusy = false;
    if (!r.ok) { btn.disabled = false; btn.textContent = '儲存出席紀錄'; return cdToast(cdErr(r.code), '⚠️'); }
    cdToast(`已儲存出席紀錄（${r.attended.length} 人）`, '✅');
    cdeskBackFromAttend();
}
function cdeskBackFromAttend() { if (cdAttendBack === 'stats') cdeskRenderStats(true); else cdeskReload(); }

// ---------- 例會統計 ----------
function cdStatsRange() {
    const now = cdParts(Date.now());
    const ymdMs = (y, m, d, end) => Date.parse(`${y}-${cdP2(m)}-${cdP2(d)}T${end ? '23:59:59' : '00:00:00'}+08:00`);
    const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
    const ry = now.m >= 7 ? now.y : now.y - 1;          // 扶輪年度：7/1 ～ 隔年 6/30
    if (cdStatsPeriod === 'lastyear') return { from: ymdMs(ry - 1, 7, 1), to: ymdMs(ry, 6, 30, true), label: `${ry - 1}-${String(ry).slice(2)} 扶輪年度` };
    if (cdStatsPeriod === 'month') return { from: ymdMs(now.y, now.m, 1), to: ymdMs(now.y, now.m, lastDay(now.y, now.m), true), label: `${now.y} 年 ${now.m} 月` };
    if (cdStatsPeriod === 'lastmonth') { const y = now.m === 1 ? now.y - 1 : now.y, m = now.m === 1 ? 12 : now.m - 1; return { from: ymdMs(y, m, 1), to: ymdMs(y, m, lastDay(y, m), true), label: `${y} 年 ${m} 月` }; }
    if (cdStatsPeriod === 'custom' && cdStatsCustom.from && cdStatsCustom.to) return { from: Date.parse(cdStatsCustom.from + 'T00:00:00+08:00'), to: Date.parse(cdStatsCustom.to + 'T23:59:59+08:00'), label: `${cdStatsCustom.from.replace(/-/g, '/')} ～ ${cdStatsCustom.to.replace(/-/g, '/')}` };
    return { from: ymdMs(ry, 7, 1), to: ymdMs(ry + 1, 6, 30, true), label: `${ry}-${String(ry + 1).slice(2)} 扶輪年度` };
}
function cdStatsSetPeriod(v) { cdStatsPeriod = v; document.getElementById('cdStatsCustomBox').classList.toggle('hidden', v !== 'custom'); if (v !== 'custom') cdeskRenderStats(true); }
function cdStatsApplyCustom() {
    const f = document.getElementById('cdStatsFrom').value, t = document.getElementById('cdStatsTo').value;
    if (!f || !t) return cdToast('請選擇起訖日期', '⚠️');
    if (t < f) return cdToast('結束日期不能早於開始日期', '⚠️');
    if (Date.parse(t) - Date.parse(f) > 395 * 86400e3) return cdToast('期間最長約一年，請縮短範圍', '⚠️');
    cdStatsCustom = { from: f, to: t }; cdeskRenderStats(true);
}
async function cdeskRenderStats(keepHeader) {
    const box = document.getElementById('cdeskBody'), rg = cdStatsRange(), club = cdMyClub();
    const picker = cdIsSuper() ? `<select onchange="cdeskClub=this.value; cdeskRenderStats(true)" class="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm bg-white max-w-full">${cdAllClubs().map(c => `<option value="${cdE(c.name)}" ${c.name === club ? 'selected' : ''}>${cdE(c.division)} ${cdE(c.code)} ${cdE(c.name)}</option>`).join('')}</select>` : `<b>${cdE(club)}</b>`;
    const P = [['year', '本扶輪年度'], ['lastyear', '上個扶輪年度'], ['month', '本月'], ['lastmonth', '上個月'], ['custom', '自訂期間']];
    box.innerHTML = `<div class="flex flex-wrap items-center justify-between gap-2">
            <div class="font-black text-slate-900">📊 例會統計　${picker}</div>
            <button type="button" onclick="cdStatsExport()" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-sm shadow-sm">⬇️ 匯出 Excel</button>
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-1.5 text-xs">${P.map(x => `<button type="button" onclick="cdStatsSetPeriod('${x[0]}')" class="px-2.5 py-1 rounded-md border font-bold ${cdStatsPeriod === x[0] ? 'bg-blue-700 text-white border-blue-700' : 'bg-white text-slate-700 border-slate-300'}">${x[1]}</button>`).join('')}
            <span id="cdStatsCustomBox" class="${cdStatsPeriod === 'custom' ? '' : 'hidden'} flex items-center gap-1"><input id="cdStatsFrom" type="date" value="${cdStatsCustom.from}" class="border border-slate-300 rounded px-1.5 py-0.5"> ～ <input id="cdStatsTo" type="date" value="${cdStatsCustom.to}" class="border border-slate-300 rounded px-1.5 py-0.5"><button type="button" onclick="cdStatsApplyCustom()" class="px-2 py-0.5 bg-slate-800 text-white rounded font-bold">查詢</button></span>
        </div>
        <div class="text-xs text-slate-500 mt-1">期間：${cdE(rg.label)}。統計本社「社內行程」中開放參加、有人表示參加或已記錄出席的場次（已取消的不算）。</div>
        <div id="cdStatsBody" class="mt-3"><div class="text-sm text-slate-500 py-6 text-center">讀取中…</div></div>`;
    const r = await cdApi('cal_desk_stats', 'club', { targetClub: club, from: new Date(rg.from).toISOString(), to: new Date(rg.to).toISOString() });
    const body = document.getElementById('cdStatsBody'); if (!body) return;
    if (!r.ok) { body.innerHTML = `<div class="text-sm font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-3">${cdE(cdErr(r.code))}</div>`; cdStats = null; return; }
    cdStats = Object.assign(cdStatsCompute(r), { label: rg.label });
    cdStatsRender();
}
// 把雲端回傳的「每場名單」彙整成每位社友的次數（社友庫裡的人都列出，含 0 次；已不在社友庫但有紀錄的人也列出）
function cdStatsCompute(r) {
    const members = cdOrderedMembers(r.club), rows = [], seen = new Set();
    const recordedEvents = r.events.filter(e => e.recorded);
    const add = (key, info) => {
        if (seen.has(key)) return; seen.add(key);
        const rsvp = r.events.filter(e => e.rsvp.includes(key)).length;
        const att = r.events.filter(e => e.attended.includes(key)).length;
        rows.push({ key, name: info.name, nickname: info.nickname || '', role: info.role || '', guest: !!info.guest, rsvp, attended: att, rate: recordedEvents.length ? att / recordedEvents.length : null, left: !!info.left });
    };
    members.forEach(m => add(cdPk(m), { name: m.name, nickname: m.nickname, role: m.role, guest: cdIsGuestMember(m) }));
    Object.keys(r.people || {}).filter(k => !cdIsExtKey(k)).forEach(k => add(k, Object.assign({ left: true }, r.people[k])));   // 同行的非社友只計入人數，不列個人
    return { club: r.club, events: r.events, recordedCount: recordedEvents.length, rows, types: r.types || [] };
}
function cdStatsRender() {
    const s = cdStats, body = document.getElementById('cdStatsBody'); if (!s || !body) return;
    const isG = k => cdIsExtKey(k) || !!(s.rows.find(x => x.key === k) || {}).guest;     // 寶尊眷或同行的非社友
    const cnt = (keys) => { const g = keys.filter(isG).length; return `${keys.length - g}${g ? ` <span class="text-pink-700">+${g}</span>` : ''}`; };
    const pct = v => v === null ? '－' : `${Math.round(v * 100)}%`;
    const evRows = s.events.map(e => { const t = cdParts(Date.parse(e.start)); return `<tr class="border-b border-slate-100"><td class="py-1.5 pr-2 whitespace-nowrap">${t.m}/${t.d}（${CDESK_WD[t.wd]}）</td><td class="pr-2">${cdE(e.title)}</td><td class="text-center">${cnt(e.rsvp)}</td><td class="text-center">${e.recorded ? cnt(e.attended) : '<span class="text-amber-700">尚未記錄</span>'}</td><td class="text-right"><button type="button" onclick="cdeskAttend('${cdE(e.id)}','stats')" class="px-2 py-0.5 bg-sky-50 border border-sky-300 text-sky-800 rounded font-bold">${e.recorded ? '修改出席' : '記錄出席'}</button></td></tr>`; }).join('');
    const memRows = s.rows.map(x => `<tr class="border-b border-slate-100 ${x.guest ? 'bg-pink-50/40' : ''}"><td class="py-1.5 pr-2 font-bold ${x.guest ? 'pl-4' : ''}">${cdE(x.name)}${x.left ? ' <span class="text-[10px] text-slate-400">（已不在社友庫）</span>' : ''}</td><td class="pr-2 text-slate-500">${cdE(x.nickname)}</td><td class="pr-2 text-slate-500">${x.guest ? '<span class="text-pink-700">寶尊眷</span>' : cdE(x.role)}</td><td class="text-center">${x.rsvp}</td><td class="text-center font-bold">${x.attended}</td><td class="text-center">${pct(x.rate)}</td></tr>`).join('');
    body.innerHTML = `<div class="grid grid-cols-3 gap-2 text-center">
            <div class="border border-slate-200 rounded-lg py-2"><div class="text-xs text-slate-500">例會場數</div><div class="text-xl font-black">${s.events.length}</div></div>
            <div class="border border-slate-200 rounded-lg py-2"><div class="text-xs text-slate-500">已記錄出席</div><div class="text-xl font-black">${s.recordedCount}</div></div>
            <div class="border border-slate-200 rounded-lg py-2"><div class="text-xs text-slate-500">平均出席（社友）</div><div class="text-xl font-black">${s.recordedCount ? Math.round(s.events.filter(e => e.recorded).reduce((a, e) => a + e.attended.filter(k => !isG(k)).length, 0) / s.recordedCount * 10) / 10 : '－'}</div></div>
        </div>
        <h5 class="mt-4 font-black text-sm text-slate-800">各次例會</h5>
        ${s.events.length ? `<div class="overflow-x-auto"><table class="w-full text-xs mt-1"><thead><tr class="text-left text-slate-500 border-b"><th class="py-1">日期</th><th>名稱</th><th class="text-center">表示參加</th><th class="text-center">實際出席</th><th></th></tr></thead><tbody>${evRows}</tbody></table></div><p class="text-[11px] text-slate-500 mt-1">人數為「社友」，<span class="text-pink-700">+N</span> 為寶尊眷與同行者。</p>` : '<div class="text-sm text-slate-500 border border-dashed border-slate-300 rounded-lg px-3 py-6 text-center mt-1">這段期間沒有例會。新增社內行程時記得勾選「開放社友按我要參加」。</div>'}
        <h5 class="mt-4 font-black text-sm text-slate-800">每位社友的參加次數</h5>
        <div class="overflow-x-auto"><table class="w-full text-xs mt-1"><thead><tr class="text-left text-slate-500 border-b"><th class="py-1">姓名</th><th>Nick Name</th><th>職務</th><th class="text-center">表示參加</th><th class="text-center">實際出席</th><th class="text-center">出席率</th></tr></thead><tbody>${memRows}</tbody></table></div>
        <p class="text-[11px] text-slate-500 mt-1">出席率＝實際出席次數 ÷ 已記錄出席的例會場數（${s.recordedCount} 場）。尚未記錄出席的場次不列入計算。</p>`;
}
function cdStatsExport() {
    const s = cdStats;
    if (!s) return cdToast('請先等統計讀取完成', '⚠️');
    if (typeof XLSX === 'undefined') return cdToast('Excel 元件尚未載入，請重新整理後再試', '⚠️');
    const day = e => { const t = cdParts(Date.parse(e.start)); return `${t.y}/${cdP2(t.m)}/${cdP2(t.d)}`; };
    const pct = v => v === null ? '' : Math.round(v * 100) + '%';
    const guestOf = k => cdIsExtKey(k) || !!(s.rows.find(x => x.key === k) || {}).guest;
    const sheet1 = s.rows.map(x => ({ '姓名': x.name, 'Nick Name': x.nickname, '身分': x.guest ? '寶尊眷' : (x.role || '社友'), '表示參加次數': x.rsvp, '實際出席次數': x.attended, '出席率': pct(x.rate), '備註': x.left ? '已不在社友庫' : '' }));
    const sheet2 = s.events.map(e => ({ '日期': day(e), '名稱': e.title, '表示參加（社友）': e.rsvp.filter(k => !guestOf(k)).length, '表示參加（寶尊眷／同行者）': e.rsvp.filter(guestOf).length, '實際出席（社友）': e.recorded ? e.attended.filter(k => !guestOf(k)).length : '', '實際出席（寶尊眷／同行者）': e.recorded ? e.attended.filter(guestOf).length : '', '出席紀錄': e.recorded ? '已記錄' : '尚未記錄' }));
    // 出席明細：每位社友一列、每場例會一欄（同一天同名的場次自動加編號，避免欄位互相覆蓋）
    const used = new Set(), heads = s.events.map(e => { let h = `${day(e).slice(5)} ${e.title}`.slice(0, 60), n = 2; while (used.has(h)) h = `${h.replace(/（\d+）$/, '')}（${n++}）`; used.add(h); return h; });
    const sheet3 = s.rows.map(x => { const o = { '姓名': x.name, 'Nick Name': x.nickname, '身分': x.guest ? '寶尊眷' : (x.role || '社友') }; s.events.forEach((e, n) => { o[heads[n]] = e.attended.includes(x.key) ? '出席' : (e.rsvp.includes(x.key) ? '表示參加' : ''); }); return o; });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet1.length ? sheet1 : [{ '姓名': '（沒有資料）' }]), '每位社友統計');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet2.length ? sheet2 : [{ '日期': '（這段期間沒有例會）' }]), '各次例會');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet3.length ? sheet3 : [{ '姓名': '（沒有資料）' }]), '出席明細');
    XLSX.writeFile(wb, `${s.club}_例會統計_${s.label.replace(/[\/:*?"<>| ]/g, '')}.xlsx`);
    cdToast('已下載 Excel');
}


// =====================================================================
// 📈 出席率（例會＋補出席）：全社每位社友的上半年／全年出席率與明細，可搜尋、匯出 Excel。
// 計算在雲端（cal_desk_attend_report，與社友在 LINE 看到的同一套）：
//   出席率＝(例會出席＋補出席) ÷ 已記錄例會場數（分母固定是本社例會，可以超過 100%）；另附純例會出席率。
//   補出席＝地區活動報到（自動）＋執秘手動登記（友社例會等，cal_desk_makeup_add／cal_desk_makeup_delete）。
// =====================================================================
let cdAr = null, cdArYear = 0, cdArQuery = '', cdArOpen = '', cdArGuests = false, cdArSeq = 0;
// 扶輪年度（7/1～隔年 6/30）：offset 0＝本年度、-1＝上年度。回傳上半年與全年兩段。
function cdRotaryPeriods(offset) {
    const now = cdParts(Date.now()), ry = (now.m >= 7 ? now.y : now.y - 1) + (offset || 0);
    const iso = (y, m, d, end) => `${y}-${cdP2(m)}-${cdP2(d)}T${end ? '23:59:59' : '00:00:00'}+08:00`;
    return { label: `${ry}-${String(ry + 1).slice(2)} 扶輪年度`, periods: [{ id: 'h1', from: iso(ry, 7, 1), to: iso(ry, 12, 31, true) }, { id: 'year', from: iso(ry, 7, 1), to: iso(ry + 1, 6, 30, true) }] };
}
const cdPct = v => v === null || v === undefined ? '－' : `${Math.round(v * 100)}%`;
async function cdeskRenderReport() {
    const box = document.getElementById('cdeskBody'), club = cdMyClub(), rp = cdRotaryPeriods(cdArYear), seq = ++cdArSeq;
    const picker = cdIsSuper() ? `<select onchange="cdeskClub=this.value; cdeskRenderReport()" class="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm bg-white max-w-full">${cdAllClubs().map(c => `<option value="${cdE(c.name)}" ${c.name === club ? 'selected' : ''}>${cdE(c.division)} ${cdE(c.code)} ${cdE(c.name)}</option>`).join('')}</select>` : `<b>${cdE(club)}</b>`;
    box.innerHTML = `<div class="flex flex-wrap items-center justify-between gap-2">
            <div class="font-black text-slate-900">📈 出席率　${picker}</div>
            <div class="flex flex-wrap gap-2"><button type="button" onclick="cdVwToggle()" class="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 font-bold rounded-lg text-sm">⚙️ LINE 上誰可以看全社</button>
            <button type="button" onclick="cdArExport()" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-sm shadow-sm">⬇️ 匯出 Excel</button></div>
        </div>
        <div id="cdVwBox" class="${cdVwOpen ? '' : 'hidden'} mt-3 border border-slate-300 bg-slate-50 rounded-xl p-3"></div>
        <div class="mt-2 flex flex-wrap items-center gap-1.5 text-xs">${[[0, '本扶輪年度'], [-1, '上個扶輪年度']].map(x => `<button type="button" onclick="cdArYear=${x[0]}; cdArOpen=''; cdeskRenderReport()" class="px-2.5 py-1 rounded-md border font-bold ${cdArYear === x[0] ? 'bg-blue-700 text-white border-blue-700' : 'bg-white text-slate-700 border-slate-300'}">${x[1]}</button>`).join('')}
            <span class="text-slate-500 ml-1">${cdE(rp.label)}　上半年＝7/1～12/31</span></div>
        <div class="mt-2 flex flex-wrap items-center gap-2"><input id="cdArSearch" type="search" value="${cdE(cdArQuery)}" oninput="cdArQuery=this.value; cdArRenderTable()" class="flex-1 min-w-[12rem] border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="🔍 搜尋姓名、Nick Name、職務">
            <label class="text-xs text-slate-600 flex items-center gap-1"><input type="checkbox" ${cdArGuests ? 'checked' : ''} onchange="cdArGuests=this.checked; cdArRenderTable()" class="w-4 h-4"> 含寶尊眷</label></div>
        <div id="cdArBody" class="mt-3"><div class="text-sm text-slate-500 py-6 text-center">讀取中…</div></div>
        <p class="text-[11px] text-slate-500 mt-3 leading-relaxed">出席率＝(例會出席＋補出席) ÷ 已記錄出席的例會場數，分母固定是本社例會，所以可以超過 100%；「純例會」不含補出席。例會要在「本社行程」按「✅ 記錄實際出席」儲存後才列入。補出席＝地區活動報到（LINE 掃碼或櫃台點名，自動計入）＋執秘手動登記（例如參加友社例會：點社友姓名後登記）。</p>`;
    if (cdVwOpen) cdVwLoad();
    const r = await cdApi('cal_desk_attend_report', 'club', { periods: rp.periods, targetClub: club });
    if (seq !== cdArSeq) return;
    const body = document.getElementById('cdArBody'); if (!body) return;
    if (!r.ok) { body.innerHTML = `<div class="text-sm font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-3">${cdE(cdErr(r.code))}</div>`; cdAr = null; return; }
    cdAr = Object.assign(r, { label: rp.label });
    cdArRenderTable();
}
function cdArVisible() {
    if (!cdAr) return [];
    const q = cdArQuery.trim().toLowerCase();
    return cdAr.people.filter(p => (cdArGuests || !p.guest) && (!q || [p.name, p.nickname, p.role].some(v => String(v || '').toLowerCase().includes(q))));
}
function cdArCell(x) {
    if (!x || !x.held) return '<td class="text-center text-slate-400" colspan="3">尚無已記錄的例會</td>';
    return `<td class="text-center">${x.attended}/${x.held}</td><td class="text-center" title="地區活動 ${x.district || 0}、執秘登記 ${x.manual || 0}">${x.makeup || ''}</td><td class="text-center"><b class="${x.rate >= 0.6 ? 'text-emerald-700' : 'text-rose-700'}">${cdPct(x.rate)}</b>${x.makeup ? `<div class="text-[10px] text-slate-400">純例會 ${cdPct(x.meetRate)}</div>` : ''}</td>`;
}
function cdArRenderTable() {
    const body = document.getElementById('cdArBody'); if (!body || !cdAr) return;
    const list = cdArVisible(), P = id => cdAr.periods.find(p => p.id === id) || { held: 0 };
    const rows = list.map(p => `<tr class="border-b border-slate-100 cursor-pointer hover:bg-blue-50/40 ${p.guest ? 'bg-pink-50/30' : ''}" onclick="cdArToggle(this.dataset.key)" data-key="${cdE(p.key)}">
            <td class="py-1.5 pr-2"><b>${cdE(p.name)}</b>${p.left ? ' <span class="text-[10px] text-slate-400">（已不在社友庫）</span>' : ''}<div class="text-[11px] text-slate-500">${cdE(p.nickname)}${p.guest ? ' <span class="text-pink-700">寶尊眷</span>' : ''}</div></td>
            ${cdArCell(p.sum.h1)}${cdArCell(p.sum.year)}</tr>${cdArOpen === p.key ? `<tr><td colspan="7" class="bg-slate-50 px-3 py-2">${cdArDetail(p)}</td></tr>` : ''}`).join('');
    body.innerHTML = `<div class="text-xs text-slate-600">已記錄出席的例會：上半年 <b>${P('h1').held}</b> 場、全年 <b>${P('year').held}</b> 場；地區活動 <b>${cdAr.district.length}</b> 場有本社社友報到。顯示 ${list.length} 人，點一下姓名看明細。</div>
        ${list.length ? `<div class="overflow-x-auto mt-2"><table class="w-full text-xs"><thead><tr class="text-slate-500 border-b"><th rowspan="2" class="text-left py-1">姓名</th><th colspan="3" class="text-center border-l border-slate-200">上半年</th><th colspan="3" class="text-center border-l border-slate-200">全年</th></tr>
            <tr class="text-slate-500 border-b"><th class="border-l border-slate-200">例會</th><th>補出席</th><th>出席率</th><th class="border-l border-slate-200">例會</th><th>補出席</th><th>出席率</th></tr></thead><tbody>${rows}</tbody></table></div>`
            : '<div class="mt-2 text-sm text-slate-500 border border-dashed border-slate-300 rounded-lg px-3 py-6 text-center">沒有符合的社友。</div>'}`;
}
function cdArToggle(key) { cdArOpen = cdArOpen === key ? '' : key; cdArRenderTable(); }
function cdArDetail(p) {
    const day = iso => { const t = cdParts(Date.parse(iso)); return `${t.y}/${cdP2(t.m)}/${cdP2(t.d)}（${CDESK_WD[t.wd]}）`; };
    const ms = cdAr.meetings.map(m => `<li class="flex gap-2 py-0.5"><span class="w-28 shrink-0 text-slate-500">${day(m.start)}</span><span class="flex-1">${cdE(m.title)}</span><span class="font-bold ${!m.recorded ? 'text-slate-400' : p.att.includes(m.id) ? 'text-emerald-700' : 'text-rose-600'}">${!m.recorded ? '尚未記錄' : p.att.includes(m.id) ? '✅ 出席' : '✕ 缺席'}</span></li>`).join('');
    const items = cdAr.district.filter(d => p.dist.includes(d.key)).map(d => ({ date: d.date, html: `<span class="flex-1">${cdE(d.title)}</span><span class="font-bold text-blue-700">🎫 地區活動報到</span>` }))
        .concat((cdAr.manual || []).filter(x => x.key === p.key).map(x => ({ date: x.date + 'T12:00:00+08:00', html: `<span class="flex-1">${cdE(x.kind)}${x.note ? '：' + cdE(x.note) : ''}</span><span class="font-bold text-violet-700">📝 執秘登記</span><button type="button" onclick="event.stopPropagation(); cdArMakeupDel(${Number(x.id)})" class="text-slate-400 hover:text-rose-600 font-bold px-1" title="刪除">✕</button>` })))
        .sort((a, b) => a.date.localeCompare(b.date));
    const ds = items.map(x => `<li class="flex items-center gap-2 py-0.5"><span class="w-28 shrink-0 text-slate-500">${day(x.date)}</span>${x.html}</li>`).join('');
    const today = cdYmd(Date.now());
    return `<div class="grid sm:grid-cols-2 gap-3 text-xs"><div><div class="font-black text-slate-700">例會（${cdAr.meetings.length} 場）</div><ul class="mt-1">${ms || '<li class="text-slate-400">這段期間沒有例會</li>'}</ul></div>
        <div><div class="font-black text-slate-700">補出席（${items.length} 次）</div><ul class="mt-1">${ds || '<li class="text-slate-400">沒有補出席紀錄</li>'}</ul>
        ${p.left ? '' : `<div class="mt-2 border border-violet-200 bg-white rounded-lg p-2" onclick="event.stopPropagation()"><div class="font-bold text-violet-800">＋ 登記補出席（例如參加友社例會）</div>
            <div class="mt-1 flex flex-wrap items-center gap-1.5"><input id="cdMkDate" type="date" value="${today}" class="border border-slate-300 rounded px-1.5 py-1">
            <select id="cdMkKind" class="border border-slate-300 rounded px-1.5 py-1 bg-white"><option>友社例會</option><option>地區活動</option><option>其他</option></select>
            <input id="cdMkNote" type="text" maxlength="100" class="flex-1 min-w-[8rem] border border-slate-300 rounded px-2 py-1" placeholder="說明，例：台北東區扶輪社例會">
            <button type="button" data-key="${cdE(p.key)}" onclick="cdArMakeupAdd(this.dataset.key)" class="px-2.5 py-1 bg-violet-700 hover:bg-violet-800 text-white rounded font-bold">登記</button></div>
            <div class="text-[10px] text-slate-500 mt-1">地區活動有現場報到的會自動計入，不用另外登記。</div></div>`}</div></div>`;
}
function cdArExport() {
    if (!cdAr) return cdToast('請先等資料讀取完成', '⚠️');
    if (typeof XLSX === 'undefined') return cdToast('Excel 元件尚未載入，請重新整理後再試', '⚠️');
    const list = cdArVisible(), day = iso => { const t = cdParts(Date.parse(iso)); return `${t.y}/${cdP2(t.m)}/${cdP2(t.d)}`; };
    const pct = v => v === null || v === undefined ? '' : Math.round(v * 100) + '%';
    const seg = (x, n) => ({ [`${n}例會場數`]: x.held, [`${n}例會出席`]: x.attended, [`${n}補出席`]: x.makeup, [`${n}出席率`]: pct(x.rate), [`${n}純例會出席率`]: pct(x.meetRate) });   // 出席率可以超過 100%
    const s1 = list.map(p => Object.assign({ '姓名': p.name, 'Nick Name': p.nickname, '職務': p.guest ? '寶尊眷' : p.role }, seg(p.sum.h1, '上半年'), seg(p.sum.year, '全年'), { '備註': p.left ? '已不在社友庫' : '' }));
    const uniq = (arr) => { const used = new Set(); return arr.map(h => { let x = h.slice(0, 60), n = 2; while (used.has(x)) x = `${h.slice(0, 55)}（${n++}）`; used.add(x); return x; }); };
    const mh = uniq(cdAr.meetings.map(m => `${day(m.start).slice(5)} ${m.title}`));
    const s2 = list.map(p => { const o = { '姓名': p.name, 'Nick Name': p.nickname }; cdAr.meetings.forEach((m, i) => { o[mh[i]] = !m.recorded ? '未記錄' : p.att.includes(m.id) ? '出席' : '缺席'; }); return o; });
    const s3 = [];
    list.forEach(p => {
        cdAr.district.filter(d => p.dist.includes(d.key)).forEach(d => s3.push({ sort: d.date, row: { '姓名': p.name, 'Nick Name': p.nickname, '日期': day(d.date), '類別': '地區活動', '說明': d.title, '來源': '報到系統' } }));
        (cdAr.manual || []).filter(x => x.key === p.key).forEach(x => s3.push({ sort: x.date, row: { '姓名': p.name, 'Nick Name': p.nickname, '日期': x.date.replace(/-/g, '/'), '類別': x.kind, '說明': x.note, '來源': '執秘登記' } }));
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s1.length ? s1 : [{ '姓名': '（沒有資料）' }]), '出席率總表');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s2.length ? s2 : [{ '姓名': '（沒有資料）' }]), '例會出席明細');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s3.length ? s3.map(x => x.row) : [{ '姓名': '（沒有資料）' }]), '補出席明細');
    XLSX.writeFile(wb, `${cdAr.club}_出席率_${cdAr.label}.xlsx`);
    cdToast('已匯出 Excel', '⬇️');
}

// ---------- ⚙️ LINE 上誰可以看全社出席率（執秘設定自己的社；最高管理員可設定選到的社） ----------
// 預設＝社長（P）、秘書（S）；勾選後儲存＝只有勾選的人；恢復預設＝回到 P、S。社友看自己的出席率不受影響。
let cdVw = null, cdVwOpen = false, cdVwSeq = 0;
function cdVwToggle() {
    cdVwOpen = !cdVwOpen;
    const box = document.getElementById('cdVwBox'); if (!box) return;
    box.classList.toggle('hidden', !cdVwOpen);
    if (cdVwOpen) cdVwLoad();
}
async function cdVwLoad() {
    const box = document.getElementById('cdVwBox'), club = cdMyClub(), seq = ++cdVwSeq;
    if (!box) return;
    cdVw = null;
    box.innerHTML = '<div class="text-sm text-slate-500">讀取中…</div>';
    const r = await cdApi('cal_desk_viewers_get', 'club', { targetClub: club });
    if (seq !== cdVwSeq || !document.getElementById('cdVwBox')) return;
    if (!r.ok) { box.innerHTML = `<div class="text-sm font-bold text-rose-700">${cdE(cdErr(r.code))}</div>`; return; }
    cdVw = r; cdVwRender();
}
function cdVwRender(msg) {
    const box = document.getElementById('cdVwBox'); if (!box || !cdVw) return;
    const list = cdVw.members;
    const status = cdVw.custom
        ? `<span class="text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-0.5 font-bold">目前：自訂（${list.filter(m => m.allowed).length} 人）</span>${cdVw.updatedBy ? `<span class="text-slate-400">由 ${cdE(cdVw.updatedBy)} 設定</span>` : ''}`
        : '<span class="text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5 font-bold">目前：預設（社長、秘書）</span>';
    box.innerHTML = `<div class="font-black text-slate-800 text-sm">⚙️ 誰可以在 LINE 看「${cdE(cdVw.club)}」的全社出席率</div>
        <p class="text-[11px] text-slate-500 mt-0.5 leading-relaxed">每位社友在 LINE 都能看自己的出席率；打勾的人另外可以看全社每個人的出席率。預設是社長（P）、秘書（S），可依貴社習慣加上前社長、理事等。儲存後立刻生效。</p>
        <div class="mt-2 flex flex-wrap items-center gap-2 text-xs">${status}</div>
        ${list.length ? `<div class="mt-2 bg-white border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-72 overflow-y-auto">${list.map((m, i) => `<label class="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-slate-50 text-sm ${m.spouse ? 'pl-7 text-slate-500' : ''}">
            <input type="checkbox" class="cd-vw w-4 h-4" data-i="${i}" ${m.allowed ? 'checked' : ''} onchange="cdVwDirty()">
            <span class="min-w-0 flex-1"><b>${cdE(m.nickname || m.name)}</b>${m.nickname ? ` <span class="text-slate-500">${cdE(m.name)}</span>` : ''}${m.role ? ` <span class="text-[11px] text-slate-400">${cdE(m.role)}</span>` : ''}</span>
            ${m.isDefault ? '<span class="text-[11px] text-emerald-700 font-bold">預設</span>' : ''}</label>`).join('')}</div>
        <div class="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" id="cdVwSave" onclick="cdVwSave()" class="px-4 py-1.5 bg-blue-700 hover:bg-blue-800 text-white font-bold rounded-lg text-sm">儲存</button>
            <button type="button" onclick="cdVwReset()" class="px-3 py-1.5 border border-slate-300 bg-white font-bold rounded-lg text-sm" ${cdVw.custom ? '' : 'disabled style="opacity:.4"'}>恢復預設（社長、秘書）</button>
            <span id="cdVwMsg" class="text-xs font-bold ${msg ? 'text-emerald-700' : ''}">${cdE(msg || '')}</span></div>`
        : '<div class="mt-2 text-sm text-slate-500">社友庫還沒有資料，請先建立社友名單。</div>'}`;
}
function cdVwDirty() { const m = document.getElementById('cdVwMsg'); if (m) { m.className = 'text-xs font-bold text-amber-700'; m.textContent = '尚未儲存'; } }
async function cdVwSave() {
    if (cdeskBusy || !cdVw) return;
    const keys = Array.from(document.querySelectorAll('.cd-vw')).filter(x => x.checked).map(x => cdVw.members[Number(x.dataset.i)].key);
    if (!keys.length && !confirm('一個人都沒勾，貴社就沒有人能在 LINE 看全社出席率（每個人仍可看自己的）。確定要這樣儲存嗎？')) return;
    cdeskBusy = true;
    const btn = document.getElementById('cdVwSave'); if (btn) { btn.disabled = true; btn.textContent = '儲存中…'; }
    const r = await cdApi('cal_desk_viewers_save', 'club', { targetClub: cdVw.club, keys: keys });
    cdeskBusy = false;
    if (!r.ok) { if (btn) { btn.disabled = false; btn.textContent = '儲存'; } return cdToast(cdErr(r.code), '⚠️'); }
    cdVw = r; cdVwRender('✅ 已儲存，立刻生效');
    cdToast('已更新 LINE 上可看全社出席率的人', '✅');
}
async function cdVwReset() {
    if (cdeskBusy || !cdVw || !confirm('確定恢復預設嗎？之後只有社長（P）、秘書（S）可以在 LINE 看全社出席率。')) return;
    cdeskBusy = true;
    const r = await cdApi('cal_desk_viewers_save', 'club', { targetClub: cdVw.club, reset: true });
    cdeskBusy = false;
    if (!r.ok) return cdToast(cdErr(r.code), '⚠️');
    cdVw = r; cdVwRender('✅ 已恢復預設');
}

async function cdArMakeupAdd(key) {
    if (cdeskBusy || !cdAr) return;
    const date = (document.getElementById('cdMkDate') || {}).value, kind = (document.getElementById('cdMkKind') || {}).value, note = ((document.getElementById('cdMkNote') || {}).value || '').trim();
    if (!date) return cdToast('請選擇日期', '⚠️');
    if (kind === '友社例會' && !note) return cdToast('請填寫是哪一個社的例會', '⚠️');
    cdeskBusy = true;
    const r = await cdApi('cal_desk_makeup_add', 'club', { targetClub: cdAr.club, person: key, date: date, kind: kind, note: note });
    cdeskBusy = false;
    if (!r.ok) return cdToast(r.code === 'CAL_NOT_FOUND' ? '這位社友不在社友庫裡，無法登記。' : cdErr(r.code), '⚠️');
    cdToast('已登記補出席', '✅');
    cdArOpen = key; cdeskRenderReport();
}
async function cdArMakeupDel(id) {
    if (cdeskBusy || !cdAr) return;
    if (!confirm('要刪除這筆補出席紀錄嗎？')) return;
    cdeskBusy = true;
    const r = await cdApi('cal_desk_makeup_delete', 'club', { targetClub: cdAr.club, id: id });
    cdeskBusy = false;
    if (!r.ok) return cdToast(cdErr(r.code), '⚠️');
    cdToast('已刪除');
    cdeskRenderReport();
}


// =====================================================================
// 📥 Excel 匯入行程（本社行程用社的登入密碼；地區行程用行事曆後台密碼，與手動新增相同）
//   流程：下載範本 → 選檔案 → 預覽（有錯誤的列標紅色並說明原因、與現有行程重複的標黃色）→ 確認後才寫入。
//   日期接受 2026/12/5、2026-12-05、2026.12.5、民國 115/12/5、Excel 日期數字；時間接受 19:00、1900、下午7:00、Excel 時間。
//   沒填開始時間或「全天」填「是」＝全天行程。活動類型找不到時歸為「其他」。「開放我要參加」預設是。
//   讀檔與整理在前端（cdImpParse 是純函式），雲端 cal_desk_import 再逐筆檢查一次（dryRun＝只檢查不寫入）。
// =====================================================================
const CD_IMP_COLS = [
    ['date', '日期', ['日期', '開始日期', '活動日期']],
    ['start', '開始時間', ['開始時間', '時間', '開始']],
    ['end', '結束時間', ['結束時間', '結束']],
    ['allDay', '全天', ['全天', '整天', '全日']],
    ['title', '標題', ['標題', '活動名稱', '行程名稱', '名稱', '行程', '活動']],
    ['type', '活動類型', ['活動類型', '類型', '類別']],
    ['location', '地點', ['地點', '場地']],
    ['address', '地址', ['地址']],
    ['dress', '服裝', ['服裝', '服裝規定']],
    ['cp', '聯絡人', ['聯絡人']],
    ['ph', '聯絡電話', ['聯絡電話', '電話']],
    ['notes', '備註', ['備註', '說明']],
    ['endDate', '結束日期（多天活動才填）', ['結束日期']],
    ['rsvp', '開放我要參加', ['開放我要參加', '我要參加', '開放參加']],
];
const CD_IMP_MAX = 300;
let cdImp = null;   // {layer, club, fileName, rows, dup:{row:reason}, checking, result, err}
const cdImpHalf = v => String(v == null ? '' : v).replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ').trim();
function cdImpHeaderKey(h) {
    const t = cdImpHalf(h).replace(/[（(].*?[）)]/g, '').replace(/\s+/g, '');
    if (!t) return '';
    for (const c of CD_IMP_COLS) if (c[2].includes(t)) return c[0];
    for (const c of CD_IMP_COLS) if (c[2].some(n => n.length >= 2 && t.startsWith(n))) return c[0];
    return '';
}
// 日期 → 'YYYY-MM-DD'；空白回 ''；看不懂回 null
function cdImpDate(v) {
    if (v === null || v === undefined || v === '') return '';
    let y, m, d;
    if (v instanceof Date) { y = v.getFullYear(); m = v.getMonth() + 1; d = v.getDate(); }
    else if (typeof v === 'number') {
        if (!(v > 20000 && v < 80000)) return null;                     // Excel 日期數字（約 1954～2119 年）
        const t = new Date(Math.round((Math.floor(v) - 25569) * 86400e3));
        y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate();
    } else {
        const s = cdImpHalf(v).replace(/^民國\s*/, '').replace(/[年月]/g, '/').replace(/日/g, '').replace(/[.\-]/g, '/').replace(/\s*[（(][^）)]*[）)]\s*$/, '').replace(/\s+.*$/, '');
        const mm = s.match(/^(\d{2,4})\/(\d{1,2})\/(\d{1,2})$/) || s.match(/^(\d{4})(\d{2})(\d{2})$/);
        if (!mm) return null;
        y = Number(mm[1]); m = Number(mm[2]); d = Number(mm[3]);
        if (y < 1000) y += 1911;                                         // 民國年
    }
    if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
    const chk = new Date(Date.UTC(y, m - 1, d));
    if (chk.getUTCMonth() !== m - 1 || chk.getUTCDate() !== d) return null;  // 2/30 這種不存在的日期
    return `${y}-${cdP2(m)}-${cdP2(d)}`;
}
// 時間 → 'HH:MM'；空白回 ''；看不懂回 null
function cdImpTime(v) {
    if (v === null || v === undefined || v === '') return '';
    let h, mi;
    if (v instanceof Date) { h = v.getHours(); mi = v.getMinutes(); }
    else if (typeof v === 'number') {
        if (v >= 0 && v < 1) { const t = Math.round(v * 1440); h = Math.floor(t / 60); mi = t % 60; }   // Excel 時間（一天的幾分之幾）
        else if (Number.isInteger(v) && v >= 0 && v <= 23) { h = v; mi = 0; }
        else if (Number.isInteger(v) && v >= 100 && v <= 2359) { h = Math.floor(v / 100); mi = v % 100; }
        else if (v > 1 && v % 1) { const t = Math.round((v % 1) * 1440); h = Math.floor(t / 60); mi = t % 60; }   // 日期＋時間的數字
        else return null;
    } else {
        let s = cdImpHalf(v).toLowerCase().replace(/\s+/g, '');
        const pm = /下午|晚上|晚間|傍晚|pm|p\.m\./.test(s), am = /上午|早上|凌晨|清晨|am|a\.m\./.test(s), noon = /中午/.test(s);
        s = s.replace(/下午|晚上|晚間|傍晚|上午|早上|凌晨|清晨|中午|p\.?m\.?|a\.?m\.?/g, '').replace(/[時点點]/g, ':').replace(/分|半$/g, m => m === '半' ? '30' : '');
        let mm = s.match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/) || s.match(/^(\d{1,2}):?$/) || s.match(/^(\d{2})(\d{2})$/);
        if (!mm) return null;
        h = Number(mm[1]); mi = Number(mm[2] || 0);
        if ((pm || (noon && h < 6)) && h < 12) h += 12;
        if (am && h === 12) h = 0;
    }
    if (!(h >= 0 && h <= 23 && mi >= 0 && mi <= 59)) return null;
    return `${cdP2(h)}:${cdP2(mi)}`;
}
function cdImpBool(v, def) {
    const s = cdImpHalf(v).toUpperCase();
    if (!s) return def;
    if (['是', 'Y', 'YES', 'TRUE', '1', 'V', '✓', '✔', 'O', '○', '要', '開放', '全天'].includes(s)) return true;
    if (['否', 'N', 'NO', 'FALSE', '0', 'X', '✕', '×', '不要', '不開放'].includes(s)) return false;
    return def;
}
// aoa＝工作表的二維陣列（sheet_to_json header:1, raw:true）；types＝[{id,name}]
// 回傳 {ok, error, rows:[{row, ev, errors[], warns[], view{}}]}
function cdImpParse(aoa, types) {
    const rowsIn = Array.isArray(aoa) ? aoa : [];
    let hi = -1, map = {};
    for (let i = 0; i < Math.min(rowsIn.length, 15); i++) {
        const m = {};
        (rowsIn[i] || []).forEach((h, c) => { const k = cdImpHeaderKey(h); if (k && m[k] === undefined) m[k] = c; });
        if (m.date !== undefined && m.title !== undefined) { hi = i; map = m; break; }
    }
    if (hi < 0) return { ok: false, error: '找不到標題列：第一列要有「日期」和「標題」這兩個欄位，請用範本檔填寫。', rows: [] };
    const other = (types || []).find(t => t.name === '其他');
    const out = [];
    for (let i = hi + 1; i < rowsIn.length; i++) {
        const raw = rowsIn[i] || [];
        const g = k => map[k] === undefined ? '' : raw[map[k]];
        const txt = k => cdImpHalf(g(k)) === '' ? '' : String(g(k)).trim();
        if (!raw.some(x => cdImpHalf(x) !== '')) continue;               // 整列空白就略過
        const errors = [], warns = [];
        const date = cdImpDate(g('date')), endDate0 = cdImpDate(g('endDate'));
        const st = cdImpTime(g('start')), et = cdImpTime(g('end'));
        const title = txt('title');
        if (date === '') errors.push('缺少日期'); else if (date === null) errors.push(`日期看不懂「${cdImpHalf(g('date'))}」`);
        if (!title) errors.push('缺少標題'); else if (title.length > 100) errors.push('標題超過 100 字');
        if (st === null) errors.push(`開始時間看不懂「${cdImpHalf(g('start'))}」`);
        if (et === null) errors.push(`結束時間看不懂「${cdImpHalf(g('end'))}」`);
        if (endDate0 === null) errors.push(`結束日期看不懂「${cdImpHalf(g('endDate'))}」`);
        const allDay = cdImpBool(g('allDay'), false) || !st;
        const endDate = endDate0 || date;
        let typeId = null, typeName = txt('type');
        if (typeName) {
            const t = (types || []).find(x => x.name === typeName) || (types || []).find(x => x.name.toLowerCase() === typeName.toLowerCase());
            if (t) typeId = t.id;
            else { typeId = other ? other.id : null; warns.push(`找不到活動類型「${typeName}」，歸為「其他」`); }
        }
        let start = '', end = '';
        if (date && !errors.length) {
            start = allDay ? `${date}T00:00:00+08:00` : `${date}T${st}:00+08:00`;
            end = allDay ? `${endDate}T23:59:00+08:00` : (et ? `${endDate}T${et}:00+08:00` : (endDate !== date ? `${endDate}T${st}:00+08:00` : start));
            if (endDate < date) errors.push('結束日期早於開始日期');
            else if (Date.parse(end) < Date.parse(start)) errors.push('結束時間早於開始時間');
            if (allDay && (st || et) && cdImpBool(g('allDay'), false)) warns.push('「全天」填了是，時間不採用');
        }
        const ev = { row: i + 1, title, start, end, allDay, typeId, location: txt('location'), address: txt('address'), dressCode: txt('dress'), contactPerson: txt('cp'), contactPhone: txt('ph'), notes: txt('notes'), rsvpEnabled: cdImpBool(g('rsvp'), true) };
        out.push({ row: i + 1, ev, errors, warns, view: { date: date || cdImpHalf(g('date')), endDate: endDate0 || '', time: allDay ? '全天' : (st + (et ? '–' + et : '')), title, type: typeId ? ((types || []).find(t => t.id === typeId) || {}).name || '' : '', location: ev.location, rsvp: ev.rsvpEnabled } });
    }
    if (!out.length) return { ok: false, error: '檔案裡沒有任何行程資料（標題列下面是空的）。', rows: [] };
    return { ok: true, rows: out };
}
function cdImpOpen() {
    cdImp = { layer: cdeskTab === 'district' ? 'district' : 'club', club: cdMyClub(), fileName: '', rows: [], dup: {}, checking: false, result: null, err: '' };
    cdImpRender();
}
function cdImpTarget() { return cdImp.layer === 'district' ? '地區行程（全地區社友都看得到）' : `${cdImp.club} 的社內行程`; }
function cdImpTemplate() {
    if (typeof XLSX === 'undefined') return cdToast('Excel 元件尚未載入，請重新整理後再試', '⚠️');
    const head = CD_IMP_COLS.map(c => c[1]);
    const ex1 = ['2026/12/05', '19:00', '21:00', '否', '松景社授證典禮', '授證典禮', '○○飯店 3 樓宴會廳', '台北市○○路 1 號', '正式服裝', '王小明', '0912-345-678', '請準時入席', '', '是'];
    const ex2 = ['2026/12/12', '', '', '是', '社區淨灘服務', '社區服務', '八里海灘', '', '輕便服裝', '', '', '', '', '是'];
    const ex3 = ['2027/01/16', '09:00', '17:00', '否', '地區年會', '地區活動', '○○會議中心', '', '', '', '', '兩天活動：結束日期填第二天', '2027/01/17', '是'];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([head, ex1, ex2, ex3]);
    ws['!cols'] = head.map((h, i) => ({ wch: [12, 9, 9, 6, 26, 10, 20, 22, 10, 10, 14, 24, 14, 12][i] || 12 }));
    XLSX.utils.book_append_sheet(wb, ws, '行程');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['活動類型（請從這裡挑，找不到的會歸為「其他」）']].concat((cdeskTypes || []).map(t => [t.name]))), '活動類型');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['填寫說明'],
        ['1. 一列一筆行程，第一列的欄位名稱不要改。範例的三列請刪掉再填自己的資料。'],
        ['2. 必填：日期、標題。日期可寫 2026/12/5、2026-12-05、115/12/5（民國）。'],
        ['3. 時間寫 19:00 或 下午7:00。沒填開始時間、或「全天」填「是」＝全天行程。'],
        ['4. 結束時間沒填＝和開始時間相同。跨天的活動在「結束日期」填最後一天。'],
        ['5. 活動類型請用「活動類型」工作表裡的名稱，找不到的會歸為「其他」。'],
        ['6. 「開放我要參加」沒填＝是（社友可在 LINE 按我要參加）；不想開放請填「否」。'],
        ['7. 匯入前會先預覽，有錯誤的列會標出原因；和現有行程「標題＋開始時間」相同的會略過，重複匯入不會變兩筆。'],
        [`8. 一次最多 ${CD_IMP_MAX} 筆。`],
    ]), '填寫說明');
    XLSX.writeFile(wb, '行程匯入範本.xlsx');
    cdToast('已下載範本', '⬇️');
}
function cdImpFile(file) {
    if (!file || !cdImp) return;
    if (typeof XLSX === 'undefined') return cdToast('Excel 元件尚未載入，請重新整理後再試', '⚠️');
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const wb = XLSX.read(new Uint8Array(reader.result), { type: 'array' });
            const name = wb.SheetNames.includes('行程') ? '行程' : wb.SheetNames[0];
            const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
            const r = cdImpParse(aoa, cdeskTypes);
            cdImp.fileName = file.name; cdImp.rows = r.rows; cdImp.dup = {}; cdImp.result = null;
            cdImp.err = r.ok ? (r.rows.length > CD_IMP_MAX ? `一次最多匯入 ${CD_IMP_MAX} 筆，這個檔案有 ${r.rows.length} 筆，請分成幾個檔案。` : '') : r.error;
        } catch (e) { cdImp.fileName = file.name; cdImp.rows = []; cdImp.err = '讀不出這個檔案，請確認是 Excel（.xlsx）檔。'; }
        cdImpRender();
        if (!cdImp.err) cdImpCheck();
    };
    reader.readAsArrayBuffer(file);
}
const cdImpGood = () => cdImp.rows.filter(r => !r.errors.length && !cdImp.dup[r.row]);
const CD_IMP_REASON = { CAL_NEED_TITLE: '缺少標題', CAL_BAD_TIME: '日期或時間格式不正確', CAL_END_BEFORE_START: '結束時間早於開始時間', DUP_EXISTING: '已有相同的行程（標題＋開始時間相同），略過' };
const cdImpReason = c => String(c || '').startsWith('DUP_IN_FILE:') ? `和第 ${String(c).split(':')[1]} 列重複，略過` : (CD_IMP_REASON[c] || '無法匯入');
// 預覽時先問雲端：有沒有和現有行程重複（不寫入）
async function cdImpCheck() {
    const valid = cdImp.rows.filter(r => !r.errors.length);
    if (!valid.length) return;
    cdImp.checking = true; cdImpRender();
    const me = cdImp;
    const r = await cdApi('cal_desk_import', cdImp.layer, { layer: cdImp.layer, targetClub: cdImp.club, events: valid.map(x => x.ev), dryRun: true });
    if (me !== cdImp) return;
    cdImp.checking = false;
    if (!r.ok) cdImp.err = cdErr(r.code);
    else (r.skipped || []).forEach(x => { cdImp.dup[x.row] = cdImpReason(x.reason); });
    cdImpRender();
}
async function cdImpGo() {
    if (cdeskBusy || !cdImp || cdImp.checking) return;
    const good = cdImpGood();
    if (!good.length) return;
    if (!confirm(`要把 ${good.length} 筆行程匯入「${cdImpTarget()}」嗎？`)) return;
    cdeskBusy = true; cdImp.checking = true; cdImpRender();
    const me = cdImp;
    const r = await cdApi('cal_desk_import', cdImp.layer, { layer: cdImp.layer, targetClub: cdImp.club, events: good.map(x => x.ev) });
    cdeskBusy = false;
    if (me !== cdImp) { if (r.ok) cdToast(`成功匯入 ${r.imported || 0} 筆`, '✅'); return; }   // 匯入期間切換了分頁
    cdImp.checking = false;
    if (!r.ok) { cdImp.err = cdErr(r.code); return cdImpRender(); }
    const skipped = cdImp.rows.filter(x => x.errors.length).map(x => ({ row: x.row, reason: x.errors.join('、') }))
        .concat(cdImp.rows.filter(x => !x.errors.length && cdImp.dup[x.row]).map(x => ({ row: x.row, reason: cdImp.dup[x.row] })))
        .concat((r.skipped || []).map(x => ({ row: x.row, reason: cdImpReason(x.reason) })))
        .sort((a, b) => a.row - b.row);
    cdImp.result = { imported: r.imported || 0, skipped };
    cdImpRender();
    cdToast(`成功匯入 ${r.imported || 0} 筆`, '✅');
}
function cdImpRender() {
    const box = document.getElementById('cdeskBody'); if (!box || !cdImp) return;
    const back = `<button type="button" onclick="cdImp=null; cdeskReload()" class="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 font-bold rounded-lg text-sm">← 回到行程列表</button>`;
    const headHtml = `<div class="flex flex-wrap items-center justify-between gap-2"><div class="min-w-0"><div class="font-black text-slate-900">📥 Excel 匯入行程</div><div class="text-xs text-slate-500 mt-0.5">匯入到：<b class="text-slate-800">${cdE(cdImpTarget())}</b></div></div>${back}</div>`;
    if (cdImp.result) {
        const R = cdImp.result;
        box.innerHTML = headHtml + `<div class="mt-4 border border-emerald-300 bg-emerald-50 rounded-xl px-4 py-4"><div class="font-black text-emerald-800 text-lg">✅ 成功匯入 ${R.imported} 筆，略過 ${R.skipped.length} 筆</div>
            <div class="text-xs text-slate-600 mt-1">匯入的行程已預設開放社友在 LINE 按「我要參加」（檔案裡填「否」的除外）。回到行程列表就看得到。</div></div>
            ${R.skipped.length ? `<div class="mt-3 text-sm font-bold text-slate-700">略過的列</div><ul class="mt-1 text-sm space-y-0.5">${R.skipped.map(x => `<li><span class="font-mono text-slate-500">第 ${x.row} 列</span>　${cdE(x.reason)}</li>`).join('')}</ul>` : ''}`;
        return;
    }
    const steps = `<div class="mt-4 grid sm:grid-cols-2 gap-3">
        <div class="border border-slate-200 rounded-xl p-3"><div class="font-bold text-sm text-slate-800">① 下載範本</div><div class="text-xs text-slate-500 mt-1 leading-relaxed">欄位：日期、開始時間、結束時間、全天、標題、活動類型、地點、地址、服裝、聯絡人、聯絡電話、備註（另有結束日期、開放我要參加）。必填只有日期和標題。</div>
            <button type="button" onclick="cdImpTemplate()" class="mt-2 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 font-bold rounded-lg text-sm">⬇️ 下載範本（.xlsx）</button></div>
        <div class="border border-slate-200 rounded-xl p-3"><div class="font-bold text-sm text-slate-800">② 選擇填好的檔案</div><div class="text-xs text-slate-500 mt-1">選好後會先預覽，<b>確認後才寫入</b>。</div>
            <label class="mt-2 inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-sm cursor-pointer">📂 選擇 Excel 檔<input id="cdImpFile" type="file" accept=".xlsx,.xls,.csv" class="hidden" onchange="cdImpFile(this.files[0]); this.value=''"></label>
            ${cdImp.fileName ? `<span class="ml-2 text-xs text-slate-600">${cdE(cdImp.fileName)}</span>` : ''}</div></div>`;
    let body = '';
    if (cdImp.err) body = `<div class="mt-3 text-sm font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-3">${cdE(cdImp.err)}</div>`;
    if (cdImp.rows.length && !(cdImp.err && !cdImp.rows.some(r => !r.errors.length))) {
        const nErr = cdImp.rows.filter(r => r.errors.length).length, nDup = cdImp.rows.filter(r => !r.errors.length && cdImp.dup[r.row]).length, good = cdImpGood().length;
        const tr = cdImp.rows.map(r => {
            const bad = r.errors.length, dup = !bad && cdImp.dup[r.row];
            const st = bad ? `<span class="text-rose-700 font-bold">❌ ${cdE(r.errors.join('、'))}</span>` : dup ? `<span class="text-amber-700 font-bold">⚠️ ${cdE(dup)}</span>` : `<span class="text-emerald-700 font-bold">✅ 可匯入</span>${r.warns.length ? `<div class="text-[11px] text-amber-700">${cdE(r.warns.join('、'))}</div>` : ''}`;
            return `<tr class="border-b border-slate-100 ${bad ? 'bg-rose-50' : dup ? 'bg-amber-50' : ''}"><td class="py-1.5 pr-2 font-mono text-slate-500 whitespace-nowrap">${r.row}</td><td class="pr-2 whitespace-nowrap">${cdE(String(r.view.date).replace(/-/g, '/'))}${r.view.endDate && r.view.endDate !== r.view.date ? `<div class="text-[11px] text-slate-500">～${cdE(r.view.endDate.replace(/-/g, '/'))}</div>` : ''}</td><td class="pr-2 whitespace-nowrap">${cdE(r.view.time)}</td><td class="pr-2 font-bold">${cdE(r.view.title)}</td><td class="pr-2 whitespace-nowrap">${cdE(r.view.type)}</td><td class="pr-2">${cdE(r.view.location)}</td><td class="pr-2 text-center">${r.view.rsvp ? '是' : '否'}</td><td class="min-w-[9rem]">${st}</td></tr>`;
        }).join('');
        body += `<div class="mt-4 flex flex-wrap items-center gap-2 text-sm"><b>預覽：共 ${cdImp.rows.length} 列</b><span class="text-emerald-700 font-bold">可匯入 ${good}</span>${nErr ? `<span class="text-rose-700 font-bold">有錯誤 ${nErr}</span>` : ''}${nDup ? `<span class="text-amber-700 font-bold">重複 ${nDup}</span>` : ''}${cdImp.checking ? '<span class="text-slate-500">檢查中…</span>' : ''}</div>
            <div class="overflow-x-auto mt-2"><table class="w-full text-xs"><thead><tr class="text-left text-slate-500 border-b"><th class="py-1">列</th><th>日期</th><th>時間</th><th>標題</th><th>類型</th><th>地點</th><th class="text-center">我要參加</th><th>狀態</th></tr></thead><tbody>${tr}</tbody></table></div>
            <div class="mt-3 flex flex-wrap items-center gap-2"><button type="button" onclick="cdImpGo()" ${good && !cdImp.checking ? '' : 'disabled'} class="px-4 py-2 bg-blue-700 hover:bg-blue-800 disabled:bg-slate-300 text-white font-bold rounded-lg text-sm">確認匯入 ${good} 筆</button>
            ${nErr || nDup ? `<span class="text-xs text-slate-500">有錯誤或重複的列不會匯入；要匯入就修改 Excel 後重新選擇檔案。</span>` : ''}</div>`;
    }
    box.innerHTML = headHtml + steps + body;
}
