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
    CAL_REG_UNAVAILABLE: '這個行程目前不能報名，請洽執秘。',
    CAL_EVENT_CANCELLED: '這個行程已取消，無法再報名。',
    CAL_RSVP_LOCKED: '執秘已經幫您送出正式報名，如要取消請洽執秘。',
    CAL_TABLE_MISSING: '行事曆尚未啟用（雲端資料表未建立），請洽地區辦公室。'
};

let calRoles = { district: false, clubs: [], governor: false };
let calTypes = [];
let calPrefs = { layer: 'all', range: 'today' };   // 第一次打開（或讀不到記憶）的預設畫面：所有行程＋今天
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
    if (calPrefs.range === 'two') {                       // 二週：本週一起算的連續 14 天；按 ‹ › 一次翻兩週
        const back = (t.wd + 6) % 7;
        const f = base - back * DAY + calOffset * 14 * DAY;
        return { from: f, to: f + 14 * DAY, label: `${fmtDayTitle(ymd(f))} ～ ${fmtDayTitle(ymd(f + 13 * DAY))}` };
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
    try { const p = JSON.parse(localStorage.getItem(CAL_PREF_KEY) || '{}'); if (['all', 'district', 'club', 'private'].includes(p.layer)) calPrefs.layer = p.layer; if (['today', 'three', 'week', 'two', 'month'].includes(p.range)) calPrefs.range = p.range; } catch (e) { /* 沒有記憶也能用 */ }
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
                <div class="shrink-0 flex gap-2"><button type="button" onclick="calGoToday()" class="text-sm font-bold text-blue-700 border border-blue-200 bg-white rounded-lg px-3 py-1.5">回到今天</button><button type="button" onclick="calOpenAttend('me')" class="text-sm font-bold text-emerald-800 border border-emerald-300 bg-emerald-50 rounded-lg px-3 py-1.5">📊 出席</button><button type="button" onclick="calOpenSettings()" class="text-lg border border-slate-300 bg-white rounded-lg px-2.5 py-1" aria-label="設定">⚙️</button></div>
            </div>
            <div id="calLayerTabs" class="grid grid-cols-4 gap-1.5"></div>
            <div id="calRangeTabs" class="grid grid-cols-5 gap-1.5 mt-2"></div>
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
    const R = [['today', '今天'], ['three', '三天'], ['week', '本週'], ['two', '二週'], ['month', '本月']];
    $('calRangeTabs').innerHTML = R.map(x => `<button type="button" onclick="calSetRange('${x[0]}')" class="rounded-xl py-3 text-[15px] font-black border ${calPrefs.range === x[0] ? 'bg-amber-400 text-slate-900 border-amber-400' : 'bg-white text-slate-700 border-slate-300'}">${x[1]}</button>`).join('');
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
// 「私人」頁＝我自己的私人行程＋我參加的地區／社內活動（已被執秘報名，或我按了「我要參加」），後者標 🔗 並保留原層級的顏色
function calVisible() {
    return calEvents.filter(e => calPrefs.layer === 'all' || e.layer === calPrefs.layer || (calPrefs.layer === 'private' && !!e.joined));
}

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
            <span class="block text-sm font-bold text-slate-500">${E(calTimeText(e, day))}　<span class="font-black" style="color:${L.text}">${calPrefs.layer === 'private' && e.layer !== 'private' ? '🔗 ' : ''}${E(calLayerLabel(e))}</span>${e.joined === 'registered' ? '　<span class="text-emerald-700">✅ 已報名</span>' : e.joined === 'interested' ? '　<span class="text-amber-700">🙋 已表示參加</span>' : ''}${cancelled ? '　<span class="text-rose-600">已取消</span>' : ''}</span>
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
    if ($('calBody') && calEvents.length) calRenderBody();      // 在詳細頁按了「我要參加」等之後，返回列表要立刻反映（不用重新連網）
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
    const hasReg = !!((e.registrationKey || e.rsvpEnabled) && e.layer !== 'private');
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
        ${(e.registrationKey || e.rsvpEnabled) && e.layer !== 'private' ? '<div id="calReg" class="mt-4"></div>' : ''}
        ${e.canEdit ? `<div class="grid grid-cols-2 gap-2 mt-4">
            <button type="button" onclick="calOpenForm('edit')" class="bg-blue-700 active:bg-blue-800 text-white font-black text-base rounded-xl py-3.5">編輯</button>
            <button type="button" onclick="calOpenForm('copy')" class="bg-white border border-slate-300 font-black text-base rounded-xl py-3.5">複製</button>
            <button type="button" onclick="calToggleCancel()" class="bg-white border border-amber-400 text-amber-800 font-black text-base rounded-xl py-3.5">${cancelled ? '恢復行程' : '取消行程'}</button>
            <button type="button" onclick="calDelete()" class="bg-white border border-rose-300 text-rose-700 font-black text-base rounded-xl py-3.5">刪除</button>
        </div>` : ''}`);
    if (hasReg) calLoadReg(e.id);
}
// ---------- 社內報名狀況、我要參加 ----------
// 行程有對應報名活動時，顯示「本社」誰已報名（執秘送出的正式報名）或表示要參加（社友在這裡按的），
// 讓社內的人都知道；別社的人看不到。社友按「我要參加」只是留下意願，正式報名由執秘在報名系統確認後送出。
let calRegTimer = null, calRegSig = '', calRegPolling = false;
const CAL_REG_POLL_MS = 10000;      // 停在行程詳細頁時，每 10 秒自動更新一次社內報名名單
let calFamily = [];            // 我的寶尊眷選項（社友庫帶出）；自動更新的回應不含這個欄位，沿用第一次讀到的
let calGuestSel = null;        // 使用者正在勾選的寶尊眷（Set）；null＝沒動過，以雲端記錄為準。避免自動更新時把正在勾的選項洗掉
async function calLoadReg(id) {
    const box = $('calReg'); if (!box) return;
    box.innerHTML = '<div class="bg-white rounded-2xl border border-slate-200 p-4 text-center text-slate-500 font-bold">讀取參加狀況…</div>';
    calFamily = []; calGuestSel = null; calRegSig = '';
    const r = await api('cal_rsvp_status', { id: id });
    calRegRender(id, r);
    calRegStartPolling();
}
// 自動更新：只在「還停在這個行程的詳細頁」而且「LINE 在前景」時進行；離開詳細頁（或開啟編輯表單）就自動停止。
// 背景更新失敗時不打擾使用者，畫面維持原樣，下一輪再試。
function calRegStartPolling() {
    if (calRegTimer) return;
    calRegTimer = setInterval(calRegPoll, CAL_REG_POLL_MS);
    if (!window.__calRegVis) { window.__calRegVis = true; document.addEventListener('visibilitychange', () => { if (!document.hidden) calRegPoll(); }); }   // 從別的 App 切回 LINE 時馬上更新
}
async function calRegPoll() {
    const e = calCurrent;
    if (!e || !$('calReg')) { clearInterval(calRegTimer); calRegTimer = null; return; }     // 已經離開詳細頁
    if (document.hidden || busy || calRegPolling) return;
    calRegPolling = true;
    try {
        const r = await api('cal_rsvp_status', { id: e.id, poll: true });       // poll：不用重讀家人名單
        if (r.ok && calCurrent && calCurrent.id === e.id && JSON.stringify([r.mine, r.open, r.people]) !== calRegSig) calRegRender(e.id, r);
    } finally { calRegPolling = false; }
}
function calGuestToggle(key, on) { if (!calGuestSel) calGuestSel = new Set(calGuestBase()); on ? calGuestSel.add(key) : calGuestSel.delete(key); }
function calGuestBase() { return (window.__calRegLast && window.__calRegLast.myGuests) || []; }
function calRegRender(id, r) {
    const box = $('calReg'); if (!box || !calCurrent || calCurrent.id !== id) return;
    if (!r.ok) { box.innerHTML = `<div class="bg-white rounded-2xl border border-rose-200 p-4 text-center text-rose-700 font-bold">${E(r.code === 'NETWORK' ? '網路連線不穩，無法讀取參加狀況。' : calErrText(r.code))}</div>`; return; }
    if (!r.linked) { box.innerHTML = ''; calRegSig = ''; return; }
    calRegSig = JSON.stringify([r.mine, r.open, r.people]);     // 自動更新時用來判斷名單有沒有變
    if (r.family) calFamily = r.family;
    window.__calRegLast = r;
    const ce = calEvents.find(x => x.id === id); if (ce) ce.joined = r.mine || null;   // 返回列表／「私人」頁時，立刻反映我是否參加
    const reg = (r.people || []).filter(p => p.status === 'registered'), want = (r.people || []).filter(p => p.status === 'interested');
    const withReg = !!(calCurrent.registrationKey);      // 有對應報名活動才有「已報名」，例會等只有「表示參加」
    const chip = (p, cls) => `<span class="inline-block rounded-full px-3 py-1 text-base font-bold ${cls} ${p.key === binding.key ? 'ring-2 ring-offset-1 ring-blue-600' : ''}">${E(p.name)}${p.nickname ? `<span class="ml-1 text-sm font-normal opacity-80">${E(p.nickname)}</span>` : ''}${p.key === binding.key ? ' （我）' : ''}${p.guestOf ? `<span class="ml-1 text-xs font-bold opacity-80">（${E(p.role && /眷/.test(p.role) ? '寶尊眷' : (p.role || '眷屬'))}）</span>` : ''}${p.proxy ? '<span class="ml-1 text-xs font-normal opacity-80">（執秘代登記）</span>' : ''}</span>`;
    // 寶尊眷：社友庫裡我的家人；已由執秘正式報名的不能再勾
    const selected = calGuestSel || new Set(r.myGuests || []);
    const canEditGuests = r.open && calFamily.length > 0;
    const guestBox = canEditGuests ? `<div class="mt-3 text-left border border-slate-200 rounded-xl px-3 py-2.5">
            <div class="text-sm font-bold text-slate-700">👪 寶尊眷一起參加（可複選）</div>
            ${calFamily.map(f => { const lock = f.registered || f.listed; return `<label class="flex items-center gap-3 py-2 ${lock ? 'opacity-60' : ''}"><input type="checkbox" class="w-6 h-6" ${selected.has(f.key) || lock ? 'checked' : ''} ${lock ? 'disabled' : ''} onchange="calGuestToggle(this.dataset.key, this.checked)" data-key="${E(f.key)}"><span class="text-base font-bold">${E(f.name)}${f.nickname ? `<span class="ml-1 text-sm font-normal text-slate-500">${E(f.nickname)}</span>` : ''}${f.registered ? '<span class="ml-2 text-xs text-emerald-700">已報名</span>' : f.listed ? '<span class="ml-2 text-xs text-amber-700">已登記</span>' : ''}</span></label>`; }).join('')}
        </div>` : '';
    let action = '';
    if (!r.open) action = '<div class="mt-3 text-center text-slate-500 font-bold">行程已取消，無法報名</div>';
    else if (r.mine === 'registered') action = `<div class="mt-3 text-center bg-emerald-50 border border-emerald-300 text-emerald-800 font-black rounded-xl py-3">✅ 您已報名</div>${canEditGuests ? guestBox + '<button type="button" onclick="calRsvp(true)" class="mt-2 w-full bg-emerald-600 active:bg-emerald-700 text-white font-black rounded-xl py-3">更新寶尊眷</button>' : ''}`;
    else if (r.mine === 'interested') action = `<div class="mt-3 text-center bg-amber-50 border border-amber-300 text-amber-900 font-black rounded-xl py-3">🙋 您已表示要參加</div>${withReg ? '<div class="mt-1 text-xs text-slate-500 text-center">正式報名由貴社執秘確認後送出。</div>' : ''}${canEditGuests ? guestBox + '<button type="button" onclick="calRsvp(true)" class="mt-2 w-full bg-emerald-600 active:bg-emerald-700 text-white font-black rounded-xl py-3">更新寶尊眷</button>' : ''}<button type="button" onclick="calRsvp(false)" class="mt-2 w-full bg-white border border-slate-300 text-slate-700 font-bold rounded-xl py-3">取消參加</button>`;
    else action = `${guestBox}<button type="button" onclick="calRsvp(true)" class="mt-3 w-full bg-emerald-600 active:bg-emerald-700 text-white font-black text-xl rounded-xl py-4 shadow">🙋 我要參加</button><div class="mt-1 text-xs text-slate-500 text-center">按下後，社內社友都看得到您要參加${withReg ? '；正式報名由貴社執秘確認後送出' : ''}。</div>`;
    const people = want.length + reg.length;
    box.innerHTML = `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
        <div class="font-black text-lg">📋 ${E(binding.club)} ${withReg ? '報名狀況' : '參加狀況'}</div>
        <div class="text-sm text-slate-600 mt-0.5">${withReg ? `活動：${E(r.title)}　已報名 <b>${r.registeredCount}</b> 人${want.length ? `　表示參加 <b>${want.length}</b> 人` : ''}` : `表示參加 <b>${want.length}</b> 人（含寶尊眷）`}</div>
        ${action}
        ${reg.length ? `<div class="mt-4 text-sm font-bold text-slate-700">✅ 已報名</div><div class="mt-1 flex flex-wrap gap-1.5">${reg.map(p => chip(p, 'bg-emerald-100 text-emerald-900')).join('')}</div>` : ''}
        ${want.length ? `<div class="mt-3 text-sm font-bold text-slate-700">🙋 表示要參加${withReg ? '（待執秘確認）' : ''}</div><div class="mt-1 flex flex-wrap gap-1.5">${want.map(p => chip(p, 'bg-amber-100 text-amber-900')).join('')}</div>` : ''}
        ${!people ? `<div class="mt-4 text-base text-slate-500 text-center py-2">目前社內還沒有人${withReg ? '報名' : '表示參加'}。</div>` : ''}
    </div>`;
}
async function calRsvp(join) {
    const e = calCurrent; if (!e || busy) return;
    if (!join && !confirm('要取消「表示參加」嗎？\n您帶的寶尊眷也會一併取消。')) return;
    const guests = join ? Array.from(calGuestSel || new Set(calGuestBase())) : [];
    busy = true; const r = await api('cal_rsvp_set', { id: e.id, join: join, guestKeys: guests }); busy = false;
    if (!r.ok) { toast(r.code === 'NETWORK' ? '網路連線不穩，請再試一次。' : calErrText(r.code)); return calLoadReg(e.id); }
    calGuestSel = null;
    toast(join ? (guests.length ? `已表示要參加（含 ${guests.length} 位寶尊眷），社內社友都看得到` : '已表示要參加，社內社友都看得到') : '已取消參加');
    calRegRender(e.id, r);
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
        v = { layer: src.layer, club: src.club, title: src.title, typeId: src.typeId, rsvpEnabled: !!src.rsvpEnabled, allDay: src.allDay, sd: ymd(s), st: fmtHM(s), ed: ymd(e), et: fmtHM(e), location: src.location, address: src.address, dressCode: src.dressCode, contactPerson: src.contactPerson, contactPhone: src.contactPhone, notes: src.notes };
        if (src.allDay) { v.st = '09:00'; v.et = '10:00'; }
    } else {
        const day = calPrefs.range === 'month' ? calSelDay : ymd(Date.now());
        const pre = calPrefs.layer !== 'all' && layers.includes(calPrefs.layer) ? calPrefs.layer : layers[0];
        v = { layer: pre, club: calRoles.clubs[0] || '', title: '', typeId: null, rsvpEnabled: true, allDay: false, sd: day, st: '09:00', ed: day, et: '10:00', location: '', address: '', dressCode: '', contactPerson: '', contactPhone: '', notes: '' };
    }
    const editing = mode === 'edit';
    calRsvpTouched = !!src;        // 編輯／複製時尊重原本的設定，不要自動改
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
            <div id="cfRsvpBox" class="${v.layer === 'private' ? 'hidden' : ''}"><label class="flex items-start gap-3 mt-4 border border-emerald-300 bg-emerald-50 rounded-xl px-3 py-3"><input id="cfRsvp" type="checkbox" onchange="calRsvpTouched = true" class="w-6 h-6 mt-0.5" ${v.rsvpEnabled ? 'checked' : ''}><span><span class="font-bold text-base">開放社友按「我要參加」</span><span class="block text-sm text-slate-600">適合例會、聯誼等不需要報名的活動；社友可一起勾選寶尊眷，名單社內都看得到。</span></span></label></div>
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
function calFormLayerChanged() {
    const l = $('cfLayer').value; $('cfClubBox').classList.toggle('hidden', !(l === 'club' && calRoles.clubs.length > 1));
    $('cfRsvpBox').classList.toggle('hidden', l === 'private');                 // 私人行程不能開放別人參加
    if (l !== 'private' && !calRsvpTouched) $('cfRsvp').checked = true;         // 地區、社內行程一律預設開放參加（私人行程沒有這個選項）
}
let calRsvpTouched = false;
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
    const ev = { title: g('cfTitle'), typeId: g('cfType') ? Number(g('cfType')) : null, allDay: allDay, start: start, end: end, rsvpEnabled: !!($('cfRsvp') && $('cfRsvp').checked && !($('cfRsvpBox') && $('cfRsvpBox').classList.contains('hidden'))), location: g('cfLoc'), address: g('cfAddr'), dressCode: g('cfDress'), contactPerson: g('cfCP'), contactPhone: g('cfPh'), notes: g('cfNotes') };
    if (id) ev.id = id; else { ev.layer = g('cfLayer'); if (ev.layer === 'club') ev.club = $('cfClub') ? g('cfClub') : calRoles.clubs[0]; }
    const btn = $('cfSave'); busy = true; btn.disabled = true; btn.textContent = '儲存中…';
    const r = await api('cal_save', { event: ev });
    busy = false;
    if (!r.ok) { btn.disabled = false; btn.textContent = '儲存'; return err(r.code === 'NETWORK' ? '網路連線不穩，請再按一次儲存。' : calErrText(r.code)); }
    toast('已儲存');
    calSelDay = ymd(Date.parse(r.event.start));
    calBack(); await calReload();
}

// ---------- 設定：訂閱到手機行事曆（.ics） ----------
// 開關存在雲端（calendar_ics）。開啟後有一組專屬網址，貼到 iPhone／Google 日曆就會自動同步；
// 關閉或重新產生網址後，舊網址立刻失效。
let calIcs = { enabled: false, token: null };
const calIcsUrl = t => (typeof FN_URL === 'string' ? FN_URL : '') + '?ics=' + encodeURIComponent(t);
async function calOpenSettings() {
    calSubShow('<button type="button" onclick="calBack()" class="text-base font-bold text-blue-700 py-2">‹ 返回行事曆</button><div class="text-center text-slate-500 py-10 font-bold">讀取中…</div>');
    const r = await api('cal_ics_status');
    if (!r.ok) { calBack(); return toast(r.code === 'NETWORK' ? '網路連線不穩，請再試一次。' : calErrText(r.code)); }
    calIcs = { enabled: !!r.enabled, token: r.token || null };
    calRenderSettings();
}
function calRenderSettings() {
    const on = calIcs.enabled && calIcs.token, url = on ? calIcsUrl(calIcs.token) : '';
    const step = (n, t) => `<li class="flex gap-2"><span class="shrink-0 w-6 h-6 rounded-full bg-blue-700 text-white text-sm font-black flex items-center justify-center">${n}</span><span>${t}</span></li>`;
    calSubShow(`<button type="button" onclick="calBack()" class="text-base font-bold text-blue-700 py-2">‹ 返回行事曆</button>
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 mt-1">
            <h2 class="font-black text-xl">設定</h2>
            <div class="mt-4 flex items-center justify-between gap-3">
                <div class="min-w-0"><div class="font-black text-lg">訂閱到手機行事曆</div><div class="text-sm text-slate-600 leading-relaxed">把扶輪行程同步到 iPhone 行事曆或 Google 日曆，由手機自己跳提醒。</div></div>
                <button type="button" role="switch" aria-checked="${on ? 'true' : 'false'}" onclick="calIcsToggle()" class="shrink-0 relative w-16 h-9 rounded-full ${on ? 'bg-emerald-500' : 'bg-slate-300'} transition-colors"><span class="absolute top-1 ${on ? 'left-8' : 'left-1'} w-7 h-7 bg-white rounded-full shadow transition-all"></span></button>
            </div>
            <div class="mt-2 text-sm font-bold ${on ? 'text-emerald-700' : 'text-slate-500'}">${on ? '✅ 已開啟' : '目前關閉'}</div>
            ${on ? `
            <div class="mt-4 text-sm font-bold text-slate-700">您的專屬訂閱網址</div>
            <input id="icsUrl" type="text" readonly value="${E(url)}" onclick="this.select()" class="mt-1 w-full border border-slate-300 rounded-xl px-3 py-3 text-sm bg-slate-50 font-mono">
            <button type="button" onclick="calIcsCopy()" class="mt-2 w-full bg-blue-700 active:bg-blue-800 text-white font-black rounded-xl py-3.5">複製網址</button>
            <div class="mt-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl px-3 py-3 text-sm font-bold leading-relaxed">⚠️ 這個網址包含您的<b>私人行程</b>，請不要傳給別人。萬一外流，按下方「重新產生網址」，舊網址就會失效。</div>
            <div class="mt-5 font-black">怎麼加入？</div>
            <div class="mt-2 text-sm font-bold text-slate-700">📱 iPhone</div>
            <ol class="mt-1 space-y-2 text-base leading-relaxed">
                ${step(1, '先按上方「複製網址」。')}
                ${step(2, '打開手機「設定」→「日曆」→「帳號」→「加入帳號」→「其他」。')}
                ${step(3, '點「加入已訂閱的日曆」，貼上網址，按「下一步」→「儲存」。')}
            </ol>
            <div class="mt-4 text-sm font-bold text-slate-700">🗓️ Google 日曆（用電腦操作）</div>
            <ol class="mt-1 space-y-2 text-base leading-relaxed">
                ${step(1, '把網址複製下來，用電腦打開 calendar.google.com。')}
                ${step(2, '左側「其他日曆」旁按 ＋ →「透過網址新增」，貼上網址。')}
            </ol>
            <p class="mt-3 text-sm text-slate-500 leading-relaxed">行程有異動時，手機會自動更新；iPhone 通常幾小時內，Google 日曆最長約 1 天。要在 LINE 裡看最新內容，以行事曆畫面為準。</p>
            <button type="button" onclick="calIcsRotate()" class="mt-4 w-full bg-white border border-rose-300 text-rose-700 font-black rounded-xl py-3">重新產生網址（舊網址失效）</button>` : `
            <p class="mt-3 text-sm text-slate-600 leading-relaxed">開啟後會產生一組只屬於您的網址。內容包含地區行程、本社行程和您的私人行程，今天前 30 天到未來一年。隨時可以關閉，關閉後網址立刻失效。</p>`}
        </div>`);
}
async function calIcsToggle() {
    if (busy) return;
    const turnOn = !(calIcs.enabled && calIcs.token);
    if (!turnOn && !confirm('要關閉訂閱嗎？\n關閉後，已經加入手機的行事曆會停止更新（日曆裡原本的行程可能保留或消失，視手機而定）。')) return;
    busy = true; const r = await api('cal_ics_set', { enabled: turnOn }); busy = false;
    if (!r.ok) return toast(r.code === 'NETWORK' ? '網路連線不穩，請再試一次。' : calErrText(r.code));
    calIcs = { enabled: !!r.enabled, token: r.token || null };
    calRenderSettings();
    toast(turnOn ? '已開啟訂閱' : '已關閉訂閱');
}
async function calIcsRotate() {
    if (busy) return;
    if (!confirm('要重新產生網址嗎？\n舊網址會立刻失效，已經加入手機的訂閱要用新網址重新加入。')) return;
    busy = true; const r = await api('cal_ics_rotate'); busy = false;
    if (!r.ok) return toast(r.code === 'NETWORK' ? '網路連線不穩，請再試一次。' : calErrText(r.code));
    calIcs = { enabled: true, token: r.token };
    calRenderSettings();
    toast('已產生新網址，舊網址已失效');
}
async function calIcsCopy() {
    const el = $('icsUrl'); if (!el) return;
    try { await navigator.clipboard.writeText(el.value); return toast('已複製網址'); } catch (e) { /* LINE 內建瀏覽器可能不允許，改用下面的做法 */ }
    try { el.focus(); el.select(); el.setSelectionRange(0, el.value.length); if (document.execCommand('copy')) return toast('已複製網址'); } catch (e) { /* 忽略 */ }
    toast('無法自動複製，請長按網址欄位選取後複製');
}


// =====================================================================
// 📊 出席率：社友看自己的上半年／全年出席率與明細；社長（P）、秘書（S）可以看全社。
// 計算在雲端（cal_attend_report，與執秘在報名系統看到的同一套）：
//   出席率＝(例會出席＋補出席) ÷ 已記錄例會場數（分母固定是本社例會，可以超過 100%）；另附純例會出席率。
//   補出席＝地區活動報到（自動）＋執秘手動登記（友社例會等）。
// =====================================================================
let calAr = null, calArYear = 0, calArScope = 'me', calArQuery = '', calArView = '', calArSeq = 0;
function calRotaryPeriods(offset) {
    const t = tpParts(Date.now()), ry = (t.m >= 7 ? t.y : t.y - 1) + (offset || 0);
    const iso = (y, m, d, end) => `${y}-${p2(m)}-${p2(d)}T${end ? '23:59:59' : '00:00:00'}+08:00`;
    return { label: `${ry}-${String(ry + 1).slice(2)} 扶輪年度`, periods: [{ id: 'h1', from: iso(ry, 7, 1), to: iso(ry, 12, 31, true) }, { id: 'year', from: iso(ry, 7, 1), to: iso(ry + 1, 6, 30, true) }] };
}
const calPct = v => v === null || v === undefined ? '－' : `${Math.round(v * 100)}%`;
async function calOpenAttend(scope) {
    calArScope = scope || 'me'; calArView = '';
    const rp = calRotaryPeriods(calArYear), seq = ++calArSeq;
    calSubShow(`<button type="button" onclick="calBack()" class="text-base font-bold text-blue-700 py-2">‹ 返回行事曆</button><div class="text-center text-slate-500 py-10 font-bold">讀取中…</div>`);
    const r = await api('cal_attend_report', { scope: calArScope, periods: rp.periods });
    if (seq !== calArSeq) return;
    if (!r.ok) { calBack(); return toast(r.code === 'NETWORK' ? '網路連線不穩，請再試一次。' : calErrText(r.code)); }
    calAr = Object.assign(r, { label: rp.label });
    calArRender();
}
function calArSetYear(v) { calArYear = v; calOpenAttend(calArScope); }
function calArSumCard(title, x) {
    if (!x || !x.held) return `<div class="bg-white rounded-2xl border border-slate-200 p-3 text-center"><div class="text-sm font-bold text-slate-500">${title}</div><div class="text-2xl font-black text-slate-400 mt-1">－</div><div class="text-xs text-slate-500 mt-1">還沒有已記錄的例會</div></div>`;
    return `<div class="bg-white rounded-2xl border ${x.rate >= 0.6 ? 'border-emerald-300' : 'border-rose-300'} p-3 text-center"><div class="text-sm font-bold text-slate-500">${title}</div>
        <div class="text-3xl font-black mt-1 ${x.rate >= 0.6 ? 'text-emerald-700' : 'text-rose-700'}">${calPct(x.rate)}</div>
        <div class="text-xs text-slate-600 mt-1">例會 ${x.attended}/${x.held}${x.makeup ? `・補出席 ${x.makeup}` : ''}</div>${x.makeup ? `<div class="text-[11px] text-slate-400">純例會 ${calPct(x.meetRate)}</div>` : ''}</div>`;
}
function calArDetailHtml(p) {
    const day = iso => { const t = tpParts(Date.parse(iso)); return `${t.m}/${t.d}（${CAL_WD[t.wd]}）`; };
    const ms = calAr.meetings.map(m => `<li class="flex items-center gap-2 py-2 border-b border-slate-100"><span class="w-20 shrink-0 text-sm text-slate-500">${day(m.start)}</span><span class="flex-1 text-base">${E(m.title)}</span><span class="text-sm font-black ${!m.recorded ? 'text-slate-400' : p.att.includes(m.id) ? 'text-emerald-700' : 'text-rose-600'}">${!m.recorded ? '尚未記錄' : p.att.includes(m.id) ? '✅ 出席' : '✕ 缺席'}</span></li>`).join('');
    const items = calAr.district.filter(d => p.dist.includes(d.key)).map(d => ({ date: d.date, title: d.title, tag: '<span class="text-sm font-black text-blue-700">🎫 已報到</span>' }))
        .concat((calAr.manual || []).filter(x => x.key === p.key).map(x => ({ date: x.date + 'T12:00:00+08:00', title: x.kind + (x.note ? '：' + x.note : ''), tag: '<span class="text-sm font-black text-violet-700">📝 執秘登記</span>' })))
        .sort((a, b) => a.date.localeCompare(b.date));
    const ds = items.map(x => `<li class="flex items-center gap-2 py-2 border-b border-slate-100"><span class="w-20 shrink-0 text-sm text-slate-500">${day(x.date)}</span><span class="flex-1 text-base">${E(x.title)}</span>${x.tag}</li>`).join('');
    return `<div class="grid grid-cols-2 gap-2 mt-3">${calArSumCard('上半年', p.sum.h1)}${calArSumCard('全年', p.sum.year)}</div>
        <div class="bg-white rounded-2xl border border-slate-200 p-4 mt-3"><div class="font-black text-lg">例會（${calAr.meetings.length} 場）</div><ul class="mt-1">${ms || '<li class="text-slate-500 py-2">這個年度還沒有例會</li>'}</ul></div>
        <div class="bg-white rounded-2xl border border-slate-200 p-4 mt-3"><div class="font-black text-lg">補出席（${items.length} 次）</div><ul class="mt-1">${ds || '<li class="text-slate-500 py-2">沒有補出席紀錄</li>'}</ul></div>
        <p class="text-xs text-slate-500 mt-3 leading-relaxed">出席率＝(例會出席＋補出席) ÷ 已記錄出席的例會場數，分母固定是本社例會，所以可以超過 100%。例會由執秘記錄出席後才列入；地區活動有現場報到（LINE 掃碼或櫃台點名）會自動算補出席；參加友社例會等，請告訴執秘幫您登記。</p>`;
}
function calArRender() {
    if (!calAr) return;
    const yearBtns = `<div class="grid grid-cols-2 gap-1.5 mt-2">${[[0, '本扶輪年度'], [-1, '上個扶輪年度']].map(x => `<button type="button" onclick="calArSetYear(${x[0]})" class="rounded-xl py-2.5 text-base font-black border ${calArYear === x[0] ? 'bg-blue-700 text-white border-blue-700' : 'bg-white text-slate-700 border-slate-300'}">${x[1]}</button>`).join('')}</div>`;
    const head = (back, backLabel, title) => `<button type="button" onclick="${back}" class="text-base font-bold text-blue-700 py-2">‹ ${backLabel}</button><h2 class="font-black text-xl mt-1">${title}</h2><div class="text-sm text-slate-500">${E(calAr.club)}・${E(calAr.label)}（上半年＝7/1～12/31）</div>`;
    if (calArScope === 'me') {
        const p = calAr.people[0];
        calSubShow(`${head('calBack()', '返回行事曆', '📊 我的出席')}${yearBtns}
            ${calAr.canClub ? `<button type="button" onclick="calOpenAttend('club')" class="mt-3 w-full bg-emerald-600 active:bg-emerald-700 text-white font-black rounded-xl py-3">👥 看全社出席率</button>` : ''}
            ${p ? calArDetailHtml(p) : '<div class="bg-white rounded-2xl border border-slate-200 p-5 mt-3 text-center text-slate-500">這個年度還沒有您的出席資料。</div>'}`);
        return;
    }
    if (calArView) {
        const p = calAr.people.find(x => x.key === calArView);
        if (p) { calSubShow(`${head('calArView=\'\'; calArRender()', '返回全社名單', E(p.name) + (p.nickname ? `<span class="ml-2 text-base font-bold text-slate-500">${E(p.nickname)}</span>` : ''))}${calArDetailHtml(p)}`); return; }
        calArView = '';
    }
    const H = id => (calAr.periods.find(x => x.id === id) || { held: 0 }).held;
    calSubShow(`${head('calOpenAttend(\'me\')', '返回我的出席', '👥 全社出席率')}${yearBtns}
        <div class="text-sm text-slate-600 mt-2">已記錄的例會：上半年 ${H('h1')} 場、全年 ${H('year')} 場</div>
        <input id="calArSearch" type="search" value="${E(calArQuery)}" oninput="calArQuery=this.value; calArList()" class="mt-2 w-full border border-slate-300 rounded-xl px-4 py-3 text-base" placeholder="🔍 搜尋姓名或 Nick Name">
        <div id="calArList" class="mt-2"></div>
        <button type="button" onclick="calArCopy()" class="mt-3 w-full bg-white border border-slate-300 font-bold rounded-xl py-3">📋 複製全社出席率（貼到 LINE）</button>`);
    calArList();
}
function calArList() {
    const box = $('calArList'); if (!box || !calAr) return;
    const q = calArQuery.trim().toLowerCase();
    const list = calAr.people.filter(p => !p.guest && (!q || [p.name, p.nickname, p.role].some(v => String(v || '').toLowerCase().includes(q))));
    const c = x => x && x.held ? `<b class="${x.rate >= 0.6 ? 'text-emerald-700' : 'text-rose-700'}">${calPct(x.rate)}</b>` : '<span class="text-slate-400">－</span>';
    box.innerHTML = list.length ? list.map(p => `<button type="button" data-key="${E(p.key)}" onclick="calArView=this.dataset.key; calArRender()" class="w-full flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-3 mb-1.5 text-left">
            <div class="flex-1 min-w-0"><div class="font-black text-base truncate">${E(p.name)}${p.left ? ' <span class="text-xs text-slate-400">（已不在社友庫）</span>' : ''}</div><div class="text-sm text-slate-500 truncate">${E(p.nickname)}</div></div>
            <div class="text-center w-16"><div class="text-[11px] text-slate-500">上半年</div><div class="text-base">${c(p.sum.h1)}</div></div>
            <div class="text-center w-16"><div class="text-[11px] text-slate-500">全年</div><div class="text-base">${c(p.sum.year)}</div></div></button>`).join('')
        : '<div class="text-center text-slate-500 py-6">沒有符合的社友。</div>';
}
async function calArCopy() {
    if (!calAr) return;
    const line = (p, id) => { const x = p.sum[id]; return x && x.held ? `${calPct(x.rate)}（例會 ${x.attended}/${x.held}${x.makeup ? `＋補 ${x.makeup}` : ''}）` : '－'; };
    const text = `${calAr.club} ${calAr.label} 出席率\n` + calAr.people.filter(p => !p.guest).map((p, i) => `${i + 1}. ${p.nickname || p.name}　上半年 ${line(p, 'h1')}　全年 ${line(p, 'year')}`).join('\n');
    try { await navigator.clipboard.writeText(text); return toast('已複製，可以貼到 LINE'); } catch (e) { /* LINE 內建瀏覽器可能不允許 */ }
    try { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); if (ok) return toast('已複製，可以貼到 LINE'); } catch (e) { /* 忽略 */ }
    toast('無法自動複製，請改用電腦版匯出 Excel');
}
