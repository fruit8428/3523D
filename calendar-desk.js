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
    const T = [['club', '🏠 本社行程'], ['stats', '📊 例會統計'], ['district', '🌐 地區行程']];
    if (cdIsSuper()) T.push(['admin', '🔑 管理者與活動類型']);
    document.getElementById('cdeskTabs').innerHTML = T.map(t => `<button type="button" onclick="cdeskSwitch('${t[0]}')" class="px-3.5 py-2 rounded-lg text-sm font-bold border ${cdeskTab === t[0] ? 'bg-blue-700 text-white border-blue-700' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}">${t[1]}</button>`).join('');
    if (tab === 'admin') return cdeskRenderAdmin();
    if (tab === 'stats') return cdeskRenderStats();
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
        v = { id: '', title: '', typeId: null, registrationKey: '', rsvpEnabled: cdeskTab === 'club', allDay: false, sd: d, st: '09:00', ed: d, et: '10:00', location: '', address: '', dressCode: '', contactPerson: '', contactPhone: '', notes: '' };
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
            <label class="flex items-start gap-2 mt-3 text-sm font-bold text-slate-700 border border-emerald-300 bg-emerald-50 rounded-lg px-3 py-2"><input id="cdRsvpOn" type="checkbox" class="w-4 h-4 mt-0.5" ${v.rsvpEnabled ? 'checked' : ''}><span>開放社友按「我要參加」<span class="block text-[11px] font-normal text-slate-600">適合社內例會、聯誼等不需要報名的活動。社友在 LINE 按了就看得到社內名單，並可一起勾選寶尊眷（名字從社友庫帶出）。選了上面的「對應報名活動」時，也可以開啟。</span></span></label>
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
    const line = p => `${p.name}${p.nickname ? ' ' + p.nickname : ''}${p.guest ? `（${/眷/.test(p.role) ? '寶尊眷' : '眷屬'}）` : ''}${p.proxy ? '（執秘代登記）' : ''}`;
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

// 社友庫依「社友 → 該社友的寶尊眷」排序，方便勾選與閱讀
function cdOrderedMembers(club) {
    const list = ((typeof clubMemberDatabase !== 'undefined' && clubMemberDatabase[club]) || []).filter(m => m && m.name);
    const heads = list.filter(m => !cdIsGuestMember(m)), out = [];
    heads.forEach(h => { out.push(h); list.filter(m => cdIsGuestMember(m) && m.spouseOfId === h.id).forEach(g => out.push(g)); });
    list.filter(m => cdIsGuestMember(m) && !out.includes(m)).forEach(g => out.push(g));   // 找不到對應社友的寶尊眷放最後
    return out;
}

// ---------- 執秘代為登記參加（不會用 LINE 的長輩等） ----------
// 勾選＝代為登記。社友自己在 LINE 登記的人（含他帶的寶尊眷）鎖住不能改，要取消請本人在 LINE 按「取消參加」。
// 儲存後這些人會出現在 LINE 的參加名單（標「執秘代登記」），也算進表示參加人數、出席勾選預設與例會統計。
async function cdeskProxy(id) {
    const box = document.getElementById('cdeskBody');
    box.innerHTML = '<div class="text-sm text-slate-500 py-6 text-center">讀取中…</div>';
    const r = await cdApi('cal_desk_proxy_get', 'club', { id: id });
    if (!r.ok) { cdToast(r.code === 'CAL_REG_UNAVAILABLE' ? '這個行程沒有開放參加，請先在「編輯」勾選「開放社友按我要參加」。' : cdErr(r.code), '⚠️'); return cdeskReload(); }
    const members = cdOrderedMembers(r.club);
    const by = new Map((r.people || []).map(p => [p.key, p]));
    const t = cdParts(Date.parse(r.start));
    const known = new Set(members.map(cdPk));
    const outside = (r.people || []).filter(p => !known.has(p.key));     // 已不在社友庫，但名單上還有
    box.innerHTML = `<button type="button" onclick="cdeskReload()" class="text-sm font-bold text-blue-700">‹ 返回（不儲存）</button>
        <div class="mt-2"><h4 class="font-black text-lg text-slate-900">🙋 代為登記參加：${cdE(r.title)}</h4>
        <div class="text-xs text-slate-500 mt-0.5">${t.y}/${cdP2(t.m)}/${cdP2(t.d)}（${CDESK_WD[t.wd]}）・${cdE(r.club)}</div>
        <p class="text-xs text-slate-600 mt-1 leading-relaxed">幫沒有用 LINE 的社友（例如長輩）登記參加。勾選後按「儲存」，社友在 LINE 看到的參加名單就會有他們（標「執秘代登記」）。<br>灰色鎖住的是社友<b>自己在 LINE 登記</b>的，要取消請本人在 LINE 按「取消參加」。</p></div>
        <div class="mt-3 text-xs text-slate-600">目前參加 <b id="cdProxyTotal">0</b> 人（其中執秘代登記 <b id="cdProxyN">0</b> 人）</div>
        ${members.length ? `<div class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">${members.map(m => {
            const k = cdPk(m), g = cdIsGuestMember(m), p = by.get(k), self = p && !p.proxy;
            return `<label class="flex items-center gap-2 border ${g ? 'border-pink-200 bg-pink-50/50 ml-4' : 'border-slate-200 bg-white'} rounded-lg px-2.5 py-1.5 text-sm ${self ? 'opacity-60' : 'cursor-pointer'}"><input type="checkbox" class="w-4 h-4 ${self ? 'cd-pxself' : 'cd-px'}" data-key="${cdE(k)}" ${p ? 'checked' : ''} ${self ? 'disabled' : ''} onchange="cdProxyCount()"><span class="font-bold">${cdE(m.name)}</span>${m.nickname ? `<span class="text-slate-500">${cdE(m.nickname)}</span>` : ''}${g ? '<span class="text-[11px] text-pink-700">寶尊眷</span>' : (m.role ? `<span class="text-[11px] text-slate-400">${cdE(m.role)}</span>` : '')}${self ? '<span class="ml-auto text-[11px] text-emerald-700 font-bold">📱 本人已在 LINE 登記</span>' : p ? '<span class="ml-auto text-[11px] text-violet-700 font-bold">執秘代登記</span>' : ''}</label>`;
        }).join('')}</div>` : '<div class="mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-3">這個社的社友庫是空的，請先在報名系統建立社友名單。</div>'}
        ${outside.length ? `<div class="mt-2 text-xs text-slate-500">另有已不在社友庫的登記：${outside.map(p => cdE(p.name + (p.nickname ? ' ' + p.nickname : ''))).join('、')}${outside.some(p => p.proxy) ? '（執秘代登記的這幾位，儲存後會一併移除）' : ''}</div>` : ''}
        <button type="button" id="cdProxySave" onclick="cdeskProxySave('${cdE(id)}')" class="mt-4 px-8 py-2.5 bg-blue-700 hover:bg-blue-800 text-white font-bold rounded-lg text-sm shadow-sm">儲存</button>`;
    window.__cdProxyOutsideSelf = outside.filter(p => !p.proxy).length;
    cdProxyCount();
}
function cdProxyCount() {
    const n = Array.from(document.querySelectorAll('.cd-px')).filter(c => c.checked).length;
    const self = document.querySelectorAll('.cd-pxself').length + (window.__cdProxyOutsideSelf || 0);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('cdProxyTotal', n + self); set('cdProxyN', n);
}
async function cdeskProxySave(id) {
    if (cdeskBusy) return;
    const keys = Array.from(document.querySelectorAll('.cd-px')).filter(c => c.checked).map(c => c.dataset.key);
    const btn = document.getElementById('cdProxySave'); cdeskBusy = true; btn.disabled = true; btn.textContent = '儲存中…';
    const r = await cdApi('cal_desk_proxy_save', 'club', { id: id, keys: keys });
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
    const rsvp = new Set((r.rsvp || []).map(x => x.key));
    const pre = new Set(r.recorded ? r.attended : (r.rsvp || []).map(x => x.key));   // 還沒記錄過時，先帶入「表示參加」的人
    const t = cdParts(Date.parse(r.start));
    box.innerHTML = `<button type="button" onclick="cdeskBackFromAttend()" class="text-sm font-bold text-blue-700">‹ 返回（不儲存）</button>
        <div class="mt-2"><h4 class="font-black text-lg text-slate-900">✅ 記錄實際出席：${cdE(r.title)}</h4>
        <div class="text-xs text-slate-500 mt-0.5">${t.y}/${cdP2(t.m)}/${cdP2(t.d)}（${CDESK_WD[t.wd]}）・${cdE(r.club)}　${r.recorded ? '<b class="text-emerald-700">已記錄過，可修改後重新儲存</b>' : '<b class="text-amber-700">尚未記錄，已先勾選在 LINE 表示參加的人</b>'}</div></div>
        <div class="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <button type="button" onclick="cdAttendAll(true)" class="px-2.5 py-1 bg-white border border-slate-300 rounded-md font-bold">全選</button>
            <button type="button" onclick="cdAttendAll(false)" class="px-2.5 py-1 bg-white border border-slate-300 rounded-md font-bold">全部清除</button>
            <span class="text-slate-600">已勾選 <b id="cdAttendCount">0</b> 人（社友 <b id="cdAttendM">0</b>、寶尊眷 <b id="cdAttendG">0</b>）　🙋＝在 LINE 表示參加</span>
        </div>
        ${members.length ? `<div class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">${members.map(m => { const k = cdPk(m), g = cdIsGuestMember(m); return `<label class="flex items-center gap-2 border ${g ? 'border-pink-200 bg-pink-50/50 ml-4' : 'border-slate-200 bg-white'} rounded-lg px-2.5 py-1.5 text-sm cursor-pointer"><input type="checkbox" class="w-4 h-4 cd-att" data-key="${cdE(k)}" data-guest="${g ? 1 : 0}" ${pre.has(k) ? 'checked' : ''} onchange="cdAttendCount()"><span class="font-bold">${cdE(m.name)}</span>${m.nickname ? `<span class="text-slate-500">${cdE(m.nickname)}</span>` : ''}${g ? '<span class="text-[11px] text-pink-700">寶尊眷</span>' : (m.role ? `<span class="text-[11px] text-slate-400">${cdE(m.role)}</span>` : '')}${rsvp.has(k) ? '<span class="ml-auto">🙋</span>' : ''}</label>`; }).join('')}</div>`
            : '<div class="mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-3">這個社的社友庫是空的，請先在報名系統建立社友名單。</div>'}
        <button type="button" id="cdAttendSave" onclick="cdeskAttendSave('${cdE(id)}')" class="mt-4 px-8 py-2.5 bg-blue-700 hover:bg-blue-800 text-white font-bold rounded-lg text-sm shadow-sm">儲存出席紀錄</button>`;
    cdAttendCount();
}
function cdAttendAll(on) { document.querySelectorAll('.cd-att').forEach(c => { c.checked = on; }); cdAttendCount(); }
function cdAttendCount() {
    const on = Array.from(document.querySelectorAll('.cd-att')).filter(c => c.checked);
    const g = on.filter(c => c.dataset.guest === '1').length;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('cdAttendCount', on.length); set('cdAttendM', on.length - g); set('cdAttendG', g);
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
    Object.keys(r.people || {}).forEach(k => add(k, Object.assign({ left: true }, r.people[k])));
    return { club: r.club, events: r.events, recordedCount: recordedEvents.length, rows, types: r.types || [] };
}
function cdStatsRender() {
    const s = cdStats, body = document.getElementById('cdStatsBody'); if (!s || !body) return;
    const cnt = (keys) => { const g = keys.filter(k => (s.rows.find(x => x.key === k) || {}).guest).length; return `${keys.length - g}${g ? ` <span class="text-pink-700">+${g}</span>` : ''}`; };
    const pct = v => v === null ? '－' : `${Math.round(v * 100)}%`;
    const evRows = s.events.map(e => { const t = cdParts(Date.parse(e.start)); return `<tr class="border-b border-slate-100"><td class="py-1.5 pr-2 whitespace-nowrap">${t.m}/${t.d}（${CDESK_WD[t.wd]}）</td><td class="pr-2">${cdE(e.title)}</td><td class="text-center">${cnt(e.rsvp)}</td><td class="text-center">${e.recorded ? cnt(e.attended) : '<span class="text-amber-700">尚未記錄</span>'}</td><td class="text-right"><button type="button" onclick="cdeskAttend('${cdE(e.id)}','stats')" class="px-2 py-0.5 bg-sky-50 border border-sky-300 text-sky-800 rounded font-bold">${e.recorded ? '修改出席' : '記錄出席'}</button></td></tr>`; }).join('');
    const memRows = s.rows.map(x => `<tr class="border-b border-slate-100 ${x.guest ? 'bg-pink-50/40' : ''}"><td class="py-1.5 pr-2 font-bold ${x.guest ? 'pl-4' : ''}">${cdE(x.name)}${x.left ? ' <span class="text-[10px] text-slate-400">（已不在社友庫）</span>' : ''}</td><td class="pr-2 text-slate-500">${cdE(x.nickname)}</td><td class="pr-2 text-slate-500">${x.guest ? '<span class="text-pink-700">寶尊眷</span>' : cdE(x.role)}</td><td class="text-center">${x.rsvp}</td><td class="text-center font-bold">${x.attended}</td><td class="text-center">${pct(x.rate)}</td></tr>`).join('');
    body.innerHTML = `<div class="grid grid-cols-3 gap-2 text-center">
            <div class="border border-slate-200 rounded-lg py-2"><div class="text-xs text-slate-500">例會場數</div><div class="text-xl font-black">${s.events.length}</div></div>
            <div class="border border-slate-200 rounded-lg py-2"><div class="text-xs text-slate-500">已記錄出席</div><div class="text-xl font-black">${s.recordedCount}</div></div>
            <div class="border border-slate-200 rounded-lg py-2"><div class="text-xs text-slate-500">平均出席（社友）</div><div class="text-xl font-black">${s.recordedCount ? Math.round(s.events.filter(e => e.recorded).reduce((a, e) => a + e.attended.filter(k => !(s.rows.find(x => x.key === k) || {}).guest).length, 0) / s.recordedCount * 10) / 10 : '－'}</div></div>
        </div>
        <h5 class="mt-4 font-black text-sm text-slate-800">各次例會</h5>
        ${s.events.length ? `<div class="overflow-x-auto"><table class="w-full text-xs mt-1"><thead><tr class="text-left text-slate-500 border-b"><th class="py-1">日期</th><th>名稱</th><th class="text-center">表示參加</th><th class="text-center">實際出席</th><th></th></tr></thead><tbody>${evRows}</tbody></table></div><p class="text-[11px] text-slate-500 mt-1">人數為「社友」，<span class="text-pink-700">+N</span> 為寶尊眷。</p>` : '<div class="text-sm text-slate-500 border border-dashed border-slate-300 rounded-lg px-3 py-6 text-center mt-1">這段期間沒有例會。新增社內行程時記得勾選「開放社友按我要參加」。</div>'}
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
    const guestOf = k => (s.rows.find(x => x.key === k) || {}).guest;
    const sheet1 = s.rows.map(x => ({ '姓名': x.name, 'Nick Name': x.nickname, '身分': x.guest ? '寶尊眷' : (x.role || '社友'), '表示參加次數': x.rsvp, '實際出席次數': x.attended, '出席率': pct(x.rate), '備註': x.left ? '已不在社友庫' : '' }));
    const sheet2 = s.events.map(e => ({ '日期': day(e), '名稱': e.title, '表示參加（社友）': e.rsvp.filter(k => !guestOf(k)).length, '表示參加（寶尊眷）': e.rsvp.filter(guestOf).length, '實際出席（社友）': e.recorded ? e.attended.filter(k => !guestOf(k)).length : '', '實際出席（寶尊眷）': e.recorded ? e.attended.filter(guestOf).length : '', '出席紀錄': e.recorded ? '已記錄' : '尚未記錄' }));
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
