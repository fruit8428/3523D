// =====================================================================
// 扶輪行事曆（社友在 LINE 裡看的畫面，階段 1）。由 line.html 載入，網址：line.html?p=calendar
// （LIFF 的網址只能指到一頁，所以行事曆放在同一頁裡面，用 ?p=calendar 切換。）
// 依賴 line.html 提供的全域：$、E、api、toast、show、errText、binding、busy。
// 所有時間一律用台灣時間（Asia/Taipei，UTC+8）計算與顯示，不受手機時區影響。
// =====================================================================
const CAL_LAYERS = {
    district: { name: '地區', color: '#17458F', text: '#17458F', bg: '#E8EEF8' },
    club: { name: '社內', color: '#F7A81B', text: '#9A6700', bg: '#FEF3DC' },
    private: { name: '私人', color: '#2E7D32', text: '#2E7D32', bg: '#E6F2E7' }
};
const CAL_PREF_KEY = 'rotary_cal_prefs_v1';
const CAL_WD = ['日', '一', '二', '三', '四', '五', '六'];
const CAL_ERR = {
    NOT_BOUND: '您還沒有綁定身分，請先完成綁定。',
    CAL_FORBIDDEN: '您沒有權限執行這個操作。',
    CAL_NOT_FOUND: '找不到這筆行程，可能已被刪除，請重新整理。',
    CAL_NEED_TITLE: '請填寫行程標題。',
    CAL_BAD_TIME: '時間格式不正確，請檢查日期與時間。',
    CAL_END_BEFORE_START: '結束時間不能早於開始時間。',
    CAL_BAD_LAYER: '請選擇行程層級。',
    CAL_TABLE_MISSING: '行事曆尚未啟用（雲端資料表未建立），請洽地區辦公室。'
};

let calRoles = { district: false, clubs: [], governor: false };
let calTypes = [];
let calPrefs = { layer: 'all', range: 'week' };
let calOffset = 0;                 // 往前／往後翻幾個「單位」（今天＝天、三天＝3 天、本週＝週、本月＝月）
let calEvents = [];                // 目前畫面範圍內的行程
let calSelDay = '';                // 月曆格模式下被點選的日期 YYYY-MM-DD
let calFetchSeq = 0;               // 丟棄過期的回應
let calCurrent = null;             // 詳細頁正在看的行程

// ---------- 台灣時間工具 ----------
const TP = 8 * 3600e3;
function tpParts(ms) { const d = new Date(ms + TP); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay(), h: d.getUTCHours(), mi: d.getUTCMinutes() }; }
function tpMs(y, m, d, h, mi) { return Date.UTC(y, m - 1, d, (h || 0) - 8, mi || 0); }   // 月、日溢位時 Date.UTC 會自動進位
const p2 = n => String(n).padStart(2, '0');
function ymd(ms) { const t = tpParts(ms); return `${t.y}-${p2(t.m)}-${p2(t.d)}`; }
function dayStartMs(s) { const a = s.split('-').map(Number); return tpMs(a[0], a[1], a[2], 0, 0); }
function todayStartMs() { const t = tpParts(Date.now()); return tpMs(t.y, t.m, t.d, 0, 0); }
function fmtHM(ms) { const t = tpParts(ms); return `${p2(t.h)}:${p2(t.mi)}`; }
function fmtDayTitle(s) { const a = s.split('-').map(Number), wd = tpParts(dayStartMs(s)).wd; return `${a[1]}/${a[2]}（${CAL_WD[wd]}）`; }
function fmtFull(ms) { const t = tpParts(ms); return `${t.y}/${p2(t.m)}/${p2(t.d)}（${CAL_WD[t.wd]}）${p2(t.h)}:${p2(t.mi)}`; }

// 目前選擇的「時間範圍」→ { from, to（不含）, label, gridFrom?, days? }
function calRange() {
    const base = todayStartMs(), DAY = 86400e3, t = tpParts(base);
    if (calPrefs.range === 'today') { const f = base + calOffset * DAY; return { from: f, to: f + DAY, label: calOffset === 0 ? '今天' : fmtDayTitle(ymd(f)) }; }
    if (calPrefs.range === 'three') { const f = base + calOffset * 3 * DAY; return { from: f, to: f + 3 * DAY, label: `${fmtDayTitle(ymd(f))} ～ ${fmtDayTitle(ymd(f + 2 * DAY))}` }; }
    if (calPrefs.range === 'week') {
        const back = (t.wd + 6) % 7;                      // 週一為一週的開始
        const f = base - back * DAY + calOffset * 7 * DAY;
        return { from: f, to: f + 7 * DAY, label: `${fmtDayTitle(ymd(f))} ～ ${fmtDayTitle(ymd(f + 6 * DAY))}` };
    }
    const mm = tpParts(tpMs(t.y, t.m + calOffset, 1, 0, 0));       // 本月：畫出完整的週（週一～週日）
    const first = tpMs(mm.y, mm.m, 1, 0, 0), next = tpMs(mm.y, mm.m + 1, 1, 0, 0);
    const gf = first - ((tpParts(first).wd + 6) % 7) * DAY;
    const lastWd = (tpParts(next - DAY).wd + 6) % 7;
    const gt = next + (6 - lastWd) * DAY;
    return { from: first, to: next, gridFrom: gf, gridTo: gt, label: `${mm.y} 年 ${mm.m} 月` };
}
function calDaysOf(ev) {       // 行程橫跨的每一天（YYYY-MM-DD 陣列）
    const out = [], s = Date.parse(ev.start), e = Date.parse(ev.end);
    let d = dayStartMs(ymd(s));
    const last = dayStartMs(ymd(Math.max(s, e - (ev.allDay ? 0 : 1))));   // 剛好結束在午夜 00:00 的行程不算到隔天
    for (let i = 0; d <= last && i < 400; i++, d += 86400e3) out.push(ymd(d));
    return out;
}
function calTimeText(ev, day) {
    if (ev.allDay) return '全天';
    const s = Date.parse(ev.start), e = Date.parse(ev.end);
    const sd = ymd(s), ed = ymd(e);
    if (sd === ed) return s === e ? fmtHM(s) : `${fmtHM(s)}–${fmtHM(e)}`;
    if (day === sd) return `${fmtHM(s)} 起`;
    if (day === ed) return `至 ${fmtHM(e)}`;
    return '全天';
}
function calPhone(s) { return String(s || '').replace(/[^0-9+#*]/g, ''); }

// ---------- 小工具 ----------
function calErrText(code) { return CAL_ERR[code] || (typeof errText === 'function' ? errText(code) : '系統忙碌中，請稍後再試。'); }
function calLoadPrefs() {
    try { const p = JSON.parse(localStorage.getItem(CAL_PREF_KEY) || '{}'); if (['all', 'district', 'club', 'private'].includes(p.layer)) calPrefs.layer = p.layer; if (['today', 'three', 'week', 'month'].includes(p.range)) calPrefs.range = p.range; } catch (e) { /* 沒有記憶也能用 */ }
}
function calSavePrefs() { try { localStorage.setItem(CAL_PREF_KEY, JSON.stringify(calPrefs)); } catch (e) { /* 忽略 */ } }
function calTypeName(id) { const t = calTypes.find(x => x.id === id); return t ? t.name : ''; }
function calLayerLabel(ev) { return ev.layer === 'club' ? (ev.club || '社內') : CAL_LAYERS[ev.layer].name; }
function calAllowedLayers() {
    const a = [];
    if (calRoles.district) a.push('district');
    if (calRoles.clubs.length) a.push('club');
    a.push('private');
    return a;
}

// ---------- 啟動 ----------
async function calendarStart() {
    $('hdTitle').textContent = '扶輪行事曆';
    $('idCard').classList.add('hidden');
    const r = await api('cal_init');
    if (!r.ok) {
        if (r.code === 'LINE_TOKEN_EXPIRED') return;
        if (r.code === 'NOT_BOUND') return showBind('請先完成綁定，才能使用行事曆。');
        return showMessage('⚠️', r.code === 'NETWORK' ? '網路連線不穩' : '暫時無法使用行事曆', r.code === 'NETWORK' ? '請確認網路後重新整理。' : calErrText(r.code), true);
    }
    calRoles = r.roles || calRoles;
    calTypes = r.types || [];
    calLoadPrefs();
    calOffset = 0;
    calSelDay = ymd(Date.now());
    calShell();
    show('viewCalendar');
    await calReload();
}

// ---------- 主畫面 ----------
function calShell() {
    $('viewCalendar').innerHTML = `
        <div id="calMain">
            <div class="flex items-center justify-between gap-2 mb-2">
                <div class="min-w-0 text-sm text-slate-600 truncate">${E(binding.name)}　${E(binding.club)}</div>
                <button type="button" onclick="calGoToday()" class="shrink-0 text-sm font-bold text-blue-700 border border-blue-200 bg-white rounded-lg px-3 py-1.5">回到今天</button>
            </div>
            <div id="calLayerTabs" class="grid grid-cols-4 gap-1.5"></div>
            <div id="calRangeTabs" class="grid grid-cols-4 gap-1.5 mt-2"></div>
            <div class="flex items-center justify-between mt-3 bg-white rounded-xl border border-slate-200">
                <button type="button" onclick="calShift(-1)" class="px-5 py-3 text-xl font-black text-slate-700" aria-label="上一段">‹</button>
                <div id="calLabel" class="font-black text-base text-center"></div>
                <button type="button" onclick="calShift(1)" class="px-5 py-3 text-xl font-black text-slate-700" aria-label="下一段">›</button>
            </div>
            <div id="calBody" class="mt-3"></div>
        </div>
        <div id="calSub" class="hidden"></div>
        <button type="button" id="calFab" onclick="calOpenForm()" class="fixed right-4 bottom-6 w-16 h-16 rounded-full bg-blue-700 active:bg-blue-800 text-white text-4xl font-light shadow-xl z-40" aria-label="新增行程">＋</button>`;
    calRenderTabs();
}
function calRenderTabs() {
    const L = [['all', '所有行程'], ['district', '地區'], ['club', '社內'], ['private', '私人']];
    $('calLayerTabs').innerHTML = L.map(x => `<button type="button" onclick="calSetLayer('${x[0]}')" class="rounded-xl py-3 text-base font-black border ${calPrefs.layer === x[0] ? 'bg-blue-700 text-white border-blue-700' : 'bg-white text-slate-700 border-slate-300'}">${x[1]}</button>`).join('');
    const R = [['today', '今天'], ['three', '三天'], ['week', '本週'], ['month', '本月']];
    $('calRangeTabs').innerHTML = R.map(x => `<button type="button" onclick="calSetRange('${x[0]}')" class="rounded-xl py-3 text-base font-black border ${calPrefs.range === x[0] ? 'bg-amber-400 text-slate-900 border-amber-400' : 'bg-white text-slate-700 border-slate-300'}">${x[1]}</button>`).join('');
}
function calSetLayer(l) { calPrefs.layer = l; calSavePrefs(); calRenderTabs(); calRenderBody(); }
function calSetRange(r) { calPrefs.range = r; calOffset = 0; calSelDay = ymd(Date.now()); calSavePrefs(); calRenderTabs(); calReload(); }
function calShift(n) { calOffset += n; if (calPrefs.range === 'month') calSelDay = ymd(calRange().from); calReload(); }
function calGoToday() { calOffset = 0; calSelDay = ymd(Date.now()); calReload(); }

async function calReload() {
    const rg = calRange(), seq = ++calFetchSeq;
    $('calLabel').textContent = rg.label;
    $('calBody').innerHTML = '<div class="text-center text-slate-500 py-10 font-bold">讀取中…</div>';
    const r = await api('cal_list', { from: new Date(rg.gridFrom || rg.from).toISOString(), to: new Date((rg.gridTo || rg.to) + 86400e3 - 1).toISOString() });
    if (seq !== calFetchSeq) return;      // 讀取期間又換了範圍
    if (!r.ok) {
        $('calBody').innerHTML = `<div class="bg-white rounded-2xl border border-rose-200 p-5 text-center"><div class="font-black text-rose-700">${E(r.code === 'NETWORK' ? '網路連線不穩，請再試一次。' : calErrText(r.code))}</div><button type="button" onclick="calReload()" class="mt-3 border border-slate-300 rounded-xl px-5 py-2.5 font-bold">重新整理</button></div>`;
        return;
    }
    calEvents = r.events || [];
    calRenderBody();
}
function calVisible() { return calEvents.filter(e => calPrefs.layer === 'all' || e.layer === calPrefs.layer); }

function calRenderBody() {
    const rg = calRange(), list = calVisible(), box = $('calBody');
    if (!box) return;
    if (calPrefs.range === 'month') return calRenderMonth(rg, list, box);
    const days = [];
    for (let d = rg.from; d < rg.to; d += 86400e3) days.push(ymd(d));
    const html = days.map(day => {
        const evs = list.filter(e => calDaysOf(e).includes(day));
        if (!evs.length && days.length > 1) return '';                 // 多天列表：沒行程的日子不顯示
        return calDayBlock(day, evs);
    }).join('');
    box.innerHTML = html || '<div class="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-500 font-bold">這段時間沒有行程</div>';
}
function calDayBlock(day, evs) {
    const isToday = day === ymd(Date.now());
    return `<div class="mb-4"><div class="font-black text-lg ${isToday ? 'text-blue-700' : 'text-slate-800'}">${fmtDayTitle(day)}${isToday ? '　<span class="text-sm bg-blue-700 text-white rounded-full px-2 py-0.5 align-middle">今天</span>' : ''}</div>
        <div class="mt-2 space-y-2">${evs.length ? evs.map(e => calCard(e, day)).join('') : '<div class="bg-white rounded-xl border border-slate-200 px-4 py-4 text-slate-500 font-bold text-center">這天沒有行程</div>'}</div></div>`;
}
function calCard(e, day) {
    const L = CAL_LAYERS[e.layer], cancelled = e.status === 'cancelled';
    return `<button type="button" onclick="calOpenDetail('${E(e.id)}')" class="w-full text-left bg-white rounded-xl border border-slate-200 shadow-sm active:bg-slate-50 flex overflow-hidden">
        <span class="shrink-0 w-2" style="background:${L.color}"></span>
        <span class="min-w-0 flex-1 px-3 py-3">
            <span class="block text-sm font-bold text-slate-500">${E(calTimeText(e, day))}　<span class="font-black" style="color:${L.text}">${E(calLayerLabel(e))}</span>${cancelled ? '　<span class="text-rose-600">已取消</span>' : ''}</span>
            <span class="block font-black text-lg leading-snug mt-0.5 ${cancelled ? 'line-through text-slate-400' : ''}">${E(e.title)}</span>
            ${e.location ? `<span class="block text-sm text-slate-600 mt-0.5 truncate">📍 ${E(e.location)}</span>` : ''}
        </span></button>`;
}
function calRenderMonth(rg, list, box) {
    const DAY = 86400e3, head = CAL_WD.slice(1).concat(CAL_WD[0]);
    const mon = tpParts(rg.from).m, today = ymd(Date.now());
    let cells = '';
    for (let d = rg.gridFrom; d < rg.gridTo + DAY; d += DAY) {
        const day = ymd(d), t = tpParts(d), inMonth = t.m === mon;
        const evs = list.filter(e => calDaysOf(e).includes(day));
        const layers = ['district', 'club', 'private'].filter(l => evs.some(e => e.layer === l));
        const sel = day === calSelDay;
        cells += `<button type="button" onclick="calPickDay('${day}')" class="relative h-14 rounded-lg border ${sel ? 'border-blue-700 bg-blue-50 border-2' : 'border-slate-200 bg-white'} ${inMonth ? '' : 'opacity-40'} flex flex-col items-center justify-start pt-1">
            <span class="text-base font-black ${day === today ? 'bg-blue-700 text-white rounded-full w-7 h-7 flex items-center justify-center' : 'text-slate-800'}">${t.d}</span>
            <span class="flex gap-1 mt-1">${layers.map(l => `<span class="w-2 h-2 rounded-full" style="background:${CAL_LAYERS[l].color}"></span>`).join('')}</span></button>`;
    }
    const selEvs = list.filter(e => calDaysOf(e).includes(calSelDay));
    box.innerHTML = `<div class="grid grid-cols-7 gap-1 text-center text-sm font-bold text-slate-500 mb-1">${head.map(h => `<div>${h}</div>`).join('')}</div>
        <div class="grid grid-cols-7 gap-1">${cells}</div>
        <div class="mt-4">${calDayBlock(calSelDay, selEvs)}</div>`;
}
function calPickDay(day) { calSelDay = day; calRenderBody(); }

// ---------- 詳細頁 ----------
function calSubShow(html) {
    $('calMain').classList.add('hidden'); $('calFab').classList.add('hidden');
    const s = $('calSub'); s.innerHTML = html; s.classList.remove('hidden');
    window.scrollTo({ top: 0 });
}
function calBack() {
    $('calSub').classList.add('hidden'); $('calSub').innerHTML = '';
    $('calMain').classList.remove('hidden'); $('calFab').classList.remove('hidden');
    calCurrent = null;
}
function calOpenDetail(id) {
    const e = calEvents.find(x => x.id === id);
    if (!e) return;
    calCurrent = e;
    const L = CAL_LAYERS[e.layer], cancelled = e.status === 'cancelled';
    const row = (icon, label, inner) => inner ? `<div class="flex gap-3 py-3 border-b border-slate-100"><div class="shrink-0 w-7 text-xl text-center">${icon}</div><div class="min-w-0"><div class="text-xs font-bold text-slate-500">${label}</div><div class="text-base leading-relaxed break-words">${inner}</div></div></div>` : '';
    const s = Date.parse(e.start), en = Date.parse(e.end);
    const when = e.allDay ? (ymd(s) === ymd(en) ? fmtFull(s).replace(/\d\d:\d\d$/, '') + ' 全天' : `${fmtFull(s).replace(/\d\d:\d\d$/, '')} ～ ${fmtFull(en).replace(/\d\d:\d\d$/, '')}（全天）`) : (s === en ? fmtFull(s) : `${fmtFull(s)}<br>～ ${ymd(s) === ymd(en) ? fmtHM(en) : fmtFull(en)}`);
    const ph = calPhone(e.contactPhone);
    const maps = e.address || e.location;
    calSubShow(`<button type="button" onclick="calBack()" class="text-base font-bold text-blue-700 py-2">‹ 返回行事曆</button>
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mt-1">
            <div class="h-2" style="background:${L.color}"></div>
            <div class="p-4">
                <div class="text-sm font-black" style="color:${L.text}">${E(calLayerLabel(e))}${calTypeName(e.typeId) ? `　<span class="text-slate-500">${E(calTypeName(e.typeId))}</span>` : ''}${cancelled ? '　<span class="text-rose-600">已取消</span>' : ''}</div>
                <h2 class="font-black text-2xl leading-snug mt-1 ${cancelled ? 'line-through text-slate-400' : ''}">${E(e.title)}</h2>
                <div class="mt-2">
                    ${row('🕒', '時間', when)}
                    ${row('📍', '地點', E(e.location))}
                    ${e.address ? row('🗺️', '地址', `${E(e.address)}<br><a class="inline-block mt-1 font-bold text-blue-700 underline" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.address)}" target="_blank" rel="noopener">在 Google 地圖開啟</a>`) : (e.location ? row('🗺️', '地圖', `<a class="font-bold text-blue-700 underline" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(maps)}" target="_blank" rel="noopener">在 Google 地圖搜尋「${E(e.location)}」</a>`) : '')}
                    ${row('👔', '服裝', E(e.dressCode))}
                    ${row('👤', '聯絡人', E(e.contactPerson))}
                    ${ph ? row('📞', '聯絡電話', `<a class="font-bold text-blue-700 underline" href="tel:${E(ph)}">${E(e.contactPhone)}</a>`) : ''}
                    ${row('📝', '備註', E(e.notes).replace(/\n/g, '<br>'))}
                </div>
            </div>
        </div>
        ${e.canEdit ? `<div class="grid grid-cols-2 gap-2 mt-4">
            <button type="button" onclick="calOpenForm('edit')" class="bg-blue-700 active:bg-blue-800 text-white font-black text-base rounded-xl py-3.5">編輯</button>
            <button type="button" onclick="calOpenForm('copy')" class="bg-white border border-slate-300 font-black text-base rounded-xl py-3.5">複製</button>
            <button type="button" onclick="calToggleCancel()" class="bg-white border border-amber-400 text-amber-800 font-black text-base rounded-xl py-3.5">${cancelled ? '恢復行程' : '取消行程'}</button>
            <button type="button" onclick="calDelete()" class="bg-white border border-rose-300 text-rose-700 font-black text-base rounded-xl py-3.5">刪除</button>
        </div>` : ''}`);
}
async function calToggleCancel() {
    const e = calCurrent; if (!e || busy) return;
    const cancelling = e.status !== 'cancelled';
    if (!confirm(cancelling ? `要取消「${e.title}」嗎？\n行程會保留，但標示為「已取消」。` : `要恢復「${e.title}」嗎？`)) return;
    busy = true; const r = await api('cal_cancel', { id: e.id, cancelled: cancelling }); busy = false;
    if (!r.ok) return toast(r.code === 'NETWORK' ? '網路連線不穩，請再試一次。' : calErrText(r.code));
    toast(cancelling ? '已取消行程' : '已恢復行程');
    calBack(); await calReload();
}
async function calDelete() {
    const e = calCurrent; if (!e || busy) return;
    if (!confirm(`確定要刪除「${e.title}」嗎？\n刪除後無法復原。（只是不辦了，建議用「取消行程」。）`)) return;
    busy = true; const r = await api('cal_delete', { id: e.id }); busy = false;
    if (!r.ok) return toast(r.code === 'NETWORK' ? '網路連線不穩，請再試一次。' : calErrText(r.code));
    toast('已刪除');
    calBack(); await calReload();
}

// ---------- 新增／編輯／複製 ----------
// mode：undefined＝新增；'edit'＝編輯目前的行程；'copy'＝以目前的行程為底稿新增
function calOpenForm(mode) {
    const src = (mode === 'edit' || mode === 'copy') ? calCurrent : null;
    const layers = calAllowedLayers();
    let v;
    if (src) {
        const s = Date.parse(src.start), e = Date.parse(src.end);
        v = { layer: src.layer, club: src.club, title: src.title, typeId: src.typeId, allDay: src.allDay, sd: ymd(s), st: fmtHM(s), ed: ymd(e), et: fmtHM(e), location: src.location, address: src.address, dressCode: src.dressCode, contactPerson: src.contactPerson, contactPhone: src.contactPhone, notes: src.notes };
        if (src.allDay) { v.st = '09:00'; v.et = '10:00'; }
    } else {
        const day = calPrefs.range === 'month' ? calSelDay : ymd(Date.now());
        const pre = calPrefs.layer !== 'all' && layers.includes(calPrefs.layer) ? calPrefs.layer : layers[0];
        v = { layer: pre, club: calRoles.clubs[0] || '', title: '', typeId: null, allDay: false, sd: day, st: '09:00', ed: day, et: '10:00', location: '', address: '', dressCode: '', contactPerson: '', contactPhone: '', notes: '' };
    }
    const editing = mode === 'edit';
    const inp = 'w-full border border-slate-300 rounded-xl px-3 py-3 text-base bg-white';
    const lab = 'block text-sm font-bold text-slate-700 mb-1 mt-4';
    calSubShow(`<button type="button" onclick="calCancelForm()" class="text-base font-bold text-blue-700 py-2">‹ 取消，不儲存</button>
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 mt-1">
            <h2 class="font-black text-xl">${editing ? '編輯行程' : (mode === 'copy' ? '複製行程' : '新增行程')}</h2>
            ${mode === 'copy' ? '<p class="text-sm text-slate-500 mt-1">已帶入原行程的資料，請修改日期等欄位後儲存。</p>' : ''}
            ${editing ? `<div class="mt-3 text-sm font-bold" style="color:${CAL_LAYERS[v.layer].text}">${E(v.layer === 'club' ? v.club : CAL_LAYERS[v.layer].name)}行程</div>` : `
            <label class="${lab}" for="cfLayer">行程層級</label>
            <select id="cfLayer" onchange="calFormLayerChanged()" class="${inp}">${layers.map(l => `<option value="${l}" ${v.layer === l ? 'selected' : ''}>${l === 'district' ? '地區行程（全地區社友看得到）' : l === 'club' ? '社內行程（本社社友看得到）' : '私人行程（只有我看得到）'}</option>`).join('')}</select>
            <div id="cfClubBox" class="${v.layer === 'club' && calRoles.clubs.length > 1 ? '' : 'hidden'}"><label class="${lab}" for="cfClub">哪一社</label><select id="cfClub" class="${inp}">${calRoles.clubs.map(c => `<option value="${E(c)}" ${v.club === c ? 'selected' : ''}>${E(c)}</option>`).join('')}</select></div>`}
            <label class="${lab}" for="cfTitle">標題 <span class="text-rose-600">*</span></label>
            <input id="cfTitle" type="text" maxlength="100" value="${E(v.title)}" class="${inp}" placeholder="例：松景社授證典禮">
            <label class="${lab}" for="cfType">活動類型</label>
            <select id="cfType" class="${inp}"><option value="">未分類</option>${calTypes.map(t => `<option value="${t.id}" ${v.typeId === t.id ? 'selected' : ''}>${E(t.name)}</option>`).join('')}</select>
            <label class="flex items-center gap-3 mt-4 border border-slate-200 rounded-xl px-3 py-3"><input id="cfAllDay" type="checkbox" onchange="calFormAllDay()" class="w-6 h-6" ${v.allDay ? 'checked' : ''}><span class="font-bold text-base">全天行程</span></label>
            <div class="grid grid-cols-2 gap-2">
                <div><label class="${lab}" for="cfSd">開始日期</label><input id="cfSd" type="date" value="${v.sd}" class="${inp}"></div>
                <div id="cfStBox"><label class="${lab}" for="cfSt">開始時間</label><input id="cfSt" type="time" value="${v.st}" class="${inp}"></div>
                <div><label class="${lab}" for="cfEd">結束日期</label><input id="cfEd" type="date" value="${v.ed}" class="${inp}"></div>
                <div id="cfEtBox"><label class="${lab}" for="cfEt">結束時間</label><input id="cfEt" type="time" value="${v.et}" class="${inp}"></div>
            </div>
            <label class="${lab}" for="cfLoc">地點</label><input id="cfLoc" type="text" maxlength="200" value="${E(v.location)}" class="${inp}" placeholder="例：○○飯店 3 樓">
            <label class="${lab}" for="cfAddr">地址（填了可一鍵開地圖）</label><input id="cfAddr" type="text" maxlength="300" value="${E(v.address)}" class="${inp}">
            <label class="${lab}" for="cfDress">服裝</label><input id="cfDress" type="text" maxlength="100" value="${E(v.dressCode)}" class="${inp}" placeholder="例：正式服裝">
            <div class="grid grid-cols-2 gap-2">
                <div><label class="${lab}" for="cfCP">聯絡人</label><input id="cfCP" type="text" maxlength="50" value="${E(v.contactPerson)}" class="${inp}"></div>
                <div><label class="${lab}" for="cfPh">聯絡電話</label><input id="cfPh" type="tel" maxlength="50" value="${E(v.contactPhone)}" class="${inp}"></div>
            </div>
            <label class="${lab}" for="cfNotes">備註</label><textarea id="cfNotes" rows="4" maxlength="2000" class="${inp}">${E(v.notes)}</textarea>
            <div id="cfError" class="hidden mt-4 text-sm font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2"></div>
            <button type="button" id="cfSave" onclick="calSaveForm('${editing ? E(src.id) : ''}')" class="mt-5 w-full bg-blue-700 active:bg-blue-800 text-white font-black text-lg rounded-xl py-4 shadow">儲存</button>
        </div>`);
    calFormAllDay();
}
function calFormLayerChanged() { const l = $('cfLayer').value; $('cfClubBox').classList.toggle('hidden', !(l === 'club' && calRoles.clubs.length > 1)); }
function calFormAllDay() { const a = $('cfAllDay').checked; $('cfStBox').classList.toggle('hidden', a); $('cfEtBox').classList.toggle('hidden', a); }
function calCancelForm() { if (calCurrent) calOpenDetail(calCurrent.id); else calBack(); }
async function calSaveForm(id) {
    if (busy) return;
    const g = x => $(x).value, allDay = $('cfAllDay').checked;
    const err = m => { const b = $('cfError'); b.textContent = m; b.classList.remove('hidden'); b.scrollIntoView({ block: 'center' }); };
    if (!g('cfTitle').trim()) return err('請填寫行程標題。');
    if (!g('cfSd')) return err('請選擇開始日期。');
    const ed = g('cfEd') || g('cfSd');
    if (!allDay && (!g('cfSt') || (g('cfEd') && !g('cfEt')))) return err('請填寫開始時間。');
    const start = allDay ? `${g('cfSd')}T00:00:00+08:00` : `${g('cfSd')}T${g('cfSt')}:00+08:00`;
    const end = allDay ? `${ed}T23:59:00+08:00` : `${ed}T${g('cfEt') || g('cfSt')}:00+08:00`;
    if (Date.parse(end) < Date.parse(start)) return err('結束時間不能早於開始時間。');
    const ev = { title: g('cfTitle'), typeId: g('cfType') ? Number(g('cfType')) : null, allDay: allDay, start: start, end: end, location: g('cfLoc'), address: g('cfAddr'), dressCode: g('cfDress'), contactPerson: g('cfCP'), contactPhone: g('cfPh'), notes: g('cfNotes') };
    if (id) ev.id = id; else { ev.layer = g('cfLayer'); if (ev.layer === 'club') ev.club = $('cfClub') ? g('cfClub') : calRoles.clubs[0]; }
    const btn = $('cfSave'); busy = true; btn.disabled = true; btn.textContent = '儲存中…';
    const r = await api('cal_save', { event: ev });
    busy = false;
    if (!r.ok) { btn.disabled = false; btn.textContent = '儲存'; return err(r.code === 'NETWORK' ? '網路連線不穩，請再按一次儲存。' : calErrText(r.code)); }
    toast('已儲存');
    calSelDay = ymd(Date.parse(r.event.start));
    calBack(); await calReload();
}
