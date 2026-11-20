// 社費推播：執秘填共同品項與個別品項，用 LINE 把「每位社友自己的社費明細」推給他。規格見 社費.md。
//   - 開放與否沿用行事曆後台「④-2 各社推播開放」；沒開放的社看不到按鈕，雲端也會擋。
//   - 每人的金額是個資：絕不寫進 app_storage，這個檔案的任何操作都不呼叫 saveToStorage()。
//     上次的內容與發送紀錄存在雲端前端讀不到的資料表（經雲端小程式 line-checkin）；填到一半的草稿只存在這台電腦的瀏覽器。
//   - 每人明細與小計的算法只有一份：checkin-core.js 的 duesCompute（雲端實際推出去的也是它算的）。
// 全域名稱以 dues 開頭（index.html 的按鈕用 onclick 呼叫，所以都必須是全域函式）。
var duesBtnState = { club: '', enabled: false, at: 0 };
var dues = null;          // 目前開著的填寫畫面的資料；沒開＝null
var duesIdSeq = 1;

var DUES_ERR = {
    CLUB_AUTH_FAILED: '無法確認貴社身分。貴社若還沒有設定登入密碼，請先完成首次登入設定後再試。',
    DUES_CLUB_OFF: '貴社尚未開放社費推播，請洽地區系統管理者開放。',
    DUES_TABLE_MISSING: '雲端尚未建立社費推播的資料表，請系統管理者執行 supabase/sql/club_dues.sql。',
    DUES_NO_PERIOD: '請先填寫「期別」（例如：115 年度上半年社費）。',
    DUES_NO_TARGET: '目前每位社友的小計都是 0，沒有可以推播的對象。請先填共同品項或個別品項。',
    DUES_NO_BOUND: '有金額的社友都還沒有綁定 LINE，沒有人收得到。可以在預覽裡用「複製明細文字」改用其他方式通知。',
    DUES_DUPLICATE: '剛剛已經送出過一模一樣的內容（60 秒內），為了避免重複，這次沒有發送。',
    PUSH_DISABLED: '這個地區還沒開放 LINE 推播（雲端沒有設定官方帳號的 token）。',
    LINE_NOT_CONFIGURED: '雲端小程式尚未啟用。',
    NETWORK: '網路連線不穩，請稍後再試。'
};
function duesErr(code) { return DUES_ERR[code] || '雲端暫時無法處理，請稍後再試。'; }
function duesE(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function duesMoney(n) { return CheckinCore.duesMoney(n); }
function duesNum(v) { var s = String(v == null ? '' : v).replace(/[,，\s]/g, '').replace(/[－−]/g, '-').replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 65248); }); if (!/^-?\d+$/.test(s)) return NaN; return parseInt(s, 10); }
function duesDraftKey(club) { return 'rotary_dues_draft::' + club; }

// ---------- 快捷列按鈕：開放的社才顯示 ----------
// 由 updateRolePermissionsUI() 呼叫（很頻繁），所以同一社 5 分鐘內只問雲端一次
async function duesRefreshButton() {
    var btn = document.getElementById('clubDuesBtn');
    if (!btn) return;
    var club = typeof selectedClubName === 'string' ? selectedClubName : '';
    if (!club || club === '地區辦公室' || typeof lineBindingsApi !== 'function') { btn.classList.add('hidden'); return; }
    if (duesBtnState.club === club && Date.now() - duesBtnState.at < 300000) { btn.classList.toggle('hidden', !duesBtnState.enabled); return; }
    duesBtnState = { club: club, enabled: false, at: Date.now() };
    btn.classList.add('hidden');
    var r = await lineBindingsApi('club_dues_status');
    if (duesBtnState.club !== club || selectedClubName !== club) return;      // 等待期間換了社＝這次結果不採用
    duesBtnState.enabled = !!(r && r.ok && r.enabled);
    if (!(r && r.ok)) duesBtnState.at = Date.now() - 240000;                  // 沒問到（例如網路不穩）＝1 分鐘後再問
    btn.classList.toggle('hidden', !duesBtnState.enabled);
}

// ---------- 開啟填寫畫面 ----------
function duesMembersOf(club) { return (typeof clubMemberDatabase === 'object' && clubMemberDatabase && clubMemberDatabase[club]) || []; }
function duesBlank(club) { return { club: club, info: { period: '', due: '', method: '', note: '' }, common: [{ id: duesIdSeq++, name: '', amount: '' }], members: {}, bound: {}, history: [], canSend: true, adding: null, source: '', lastAt: null, preview: false, sending: false }; }
// 雲端存的「上次內容」→ 畫面用的資料（共同品項給一個編號；個別品項標「沿用上次」）
function duesFromSaved(d, saved, carried) {
    var f = CheckinCore.duesNormalize(saved, true);
    d.info = f.info;
    d.common = f.common.map(function (c) { return { id: duesIdSeq++, name: c.name, amount: String(c.amount) }; });
    if (!d.common.length) d.common = [{ id: duesIdSeq++, name: '', amount: '' }];
    d.members = {};
    Object.keys(f.members).forEach(function (k) {
        var m = f.members[k];
        d.members[k] = { off: m.off.map(function (i) { return d.common[i].id; }), extra: m.extra.map(function (x) { var o = { name: x.name, amount: x.amount }; if (carried || x.carried) o.carried = true; return o; }) };
    });
}
// 畫面的資料 → 送給雲端／拿來計算的表單（沒填完的共同品項不算；取消勾選改成用序號）
function duesFormOut(keepCarried) {
    var idx = {}, common = [];
    dues.common.forEach(function (c) { var a = duesNum(c.amount), n = String(c.name || '').trim(); if (n && Number.isFinite(a) && a !== 0) { idx[c.id] = common.length; common.push({ name: n, amount: a }); } });
    var members = {};
    Object.keys(dues.members).forEach(function (k) {
        var m = dues.members[k];
        members[k] = { off: (m.off || []).filter(function (id) { return id in idx; }).map(function (id) { return idx[id]; }), extra: (m.extra || []).map(function (x) { var o = { name: x.name, amount: x.amount }; if (keepCarried && x.carried) o.carried = true; return o; }) };
    });
    return CheckinCore.duesNormalize({ info: dues.info, common: common, members: members }, keepCarried);
}
function duesPeople() { return CheckinCore.duesCompute(duesMembersOf(dues.club), duesFormOut(false)); }
function duesSaveDraft() {
    if (!dues) return;
    try { localStorage.setItem(duesDraftKey(dues.club), JSON.stringify({ form: duesFormOut(true), savedAt: Date.now() })); } catch (e) { /* 存不了草稿不影響操作 */ }
}
function duesMemberOf(key) { if (!dues.members[key]) dues.members[key] = { off: [], extra: [] }; return dues.members[key]; }

async function openClubDues() {
    var club = typeof selectedClubName === 'string' ? selectedClubName : '';
    if (!club) { alert('請先選擇社別。'); return; }
    dues = duesBlank(club);
    var ov = document.getElementById('clubDuesOverlay');
    if (!ov) {
        ov = document.createElement('div');
        ov.id = 'clubDuesOverlay';
        ov.className = 'fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 overflow-y-auto';
        document.body.appendChild(ov);
    }
    ov.classList.remove('hidden');
    ov.innerHTML = '<div class="min-h-full flex items-start justify-center p-2 sm:p-4"><div class="bg-white rounded-2xl shadow-2xl w-full max-w-6xl my-2">' +
        '<div class="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-slate-200 sticky top-0 bg-white rounded-t-2xl z-10">' +
        '<div class="min-w-0"><div class="font-black text-lg text-slate-900">💰 推播社費</div><div class="text-xs text-slate-500 truncate">' + duesE(club) + '　用 LINE 把每位社友「自己的社費明細」推給他</div></div>' +
        '<button type="button" onclick="duesClose()" class="shrink-0 w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-lg" aria-label="關閉">×</button></div>' +
        '<div id="duesBody" class="px-4 sm:px-6 py-4"><div class="text-sm text-slate-500">讀取中…</div></div></div></div>';
    var r = await lineBindingsApi('club_dues_get');
    if (!dues || dues.club !== club) return;
    if (!r.ok) { document.getElementById('duesBody').innerHTML = '<div class="text-sm font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">' + duesE(duesErr(r.code)) + '</div>'; return; }
    dues.canSend = !!r.canSend; dues.history = r.history || []; dues.lastAt = r.lastAt || null; dues.last = r.last || null;
    (r.bound || []).forEach(function (k) { dues.bound[k] = true; });
    var draft = null;
    try { draft = JSON.parse(localStorage.getItem(duesDraftKey(club)) || 'null'); } catch (e) { draft = null; }
    if (draft && draft.form) { duesFromSaved(dues, draft.form, false); dues.source = 'draft'; }
    else if (r.last) { duesFromSaved(dues, r.last, true); dues.source = 'last'; }
    duesRenderAll();
}
function duesClose() {
    if (dues && !dues.sending && dues.dirty) duesSaveDraft();      // 有改過才留草稿（沒改就讓下次照常帶出「上次發送的內容」）
    dues = null;
    var ov = document.getElementById('clubDuesOverlay');
    if (ov) { ov.classList.add('hidden'); ov.innerHTML = ''; }
}
// 放棄這台電腦上的草稿，改回上次發送時的內容
function duesUseLast() {
    if (!dues) return;
    if (!confirm(dues.last ? '要放棄目前填的內容，改回「上次發送」時的內容嗎？' : '要清空目前填的內容嗎？')) return;
    try { localStorage.removeItem(duesDraftKey(dues.club)); } catch (e) { /* 沒關係 */ }
    var keep = { bound: dues.bound, history: dues.history, canSend: dues.canSend, lastAt: dues.lastAt, last: dues.last };
    dues = Object.assign(duesBlank(dues.club), keep);
    if (dues.last) { duesFromSaved(dues, dues.last, true); dues.source = 'last'; }
    duesRenderAll();
}

// ---------- 畫面 ----------
function duesFmtTime(iso) { var d = new Date(iso); if (isNaN(d)) return ''; var p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
function duesRenderAll() {
    var body = document.getElementById('duesBody');
    if (!body || !dues) return;
    var inp = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm';
    var hint = dues.source === 'last' ? '<div class="mb-3 text-sm font-bold text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">已帶出上次發送（' + duesE(duesFmtTime(dues.lastAt)) + '）的內容。請確認「期別」「繳費期限」，以及標黃色「沿用上次」的個別品項是否還適用。</div>'
        : dues.source === 'draft' ? '<div class="mb-3 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex flex-wrap items-center gap-2"><span>已帶出這台電腦上次填到一半的草稿。</span><button type="button" onclick="duesUseLast()" class="text-blue-700 font-bold underline">' + (dues.last ? '放棄草稿，改回上次發送的內容' : '清空重填') + '</button></div>' : '';
    body.innerHTML = hint +
        (dues.canSend ? '' : '<div class="mb-3 text-sm font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">' + duesE(DUES_ERR.PUSH_DISABLED) + ' 可以先填寫、預覽與複製文字，但無法發送。</div>') +
        '<div class="font-black text-slate-900">① 基本資訊</div>' +
        '<div class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">' +
        '<label class="block"><span class="text-xs font-bold text-slate-600">期別（必填，會顯示在卡片標題）</span><input id="duesPeriod" class="' + inp + '" maxlength="40" placeholder="例：115 年度上半年社費" value="' + duesE(dues.info.period) + '" oninput="duesInfo(\'period\', this.value)"></label>' +
        '<label class="block"><span class="text-xs font-bold text-slate-600">繳費期限</span><input id="duesDue" class="' + inp + '" maxlength="40" placeholder="例：12/31" value="' + duesE(dues.info.due) + '" oninput="duesInfo(\'due\', this.value)"></label>' +
        '<label class="block"><span class="text-xs font-bold text-slate-600">繳費方式</span><input id="duesMethod" class="' + inp + '" maxlength="200" placeholder="例：○○銀行 ○○分行 123-456-789 戶名○○扶輪社" value="' + duesE(dues.info.method) + '" oninput="duesInfo(\'method\', this.value)"></label>' +
        '<label class="block"><span class="text-xs font-bold text-slate-600">補充說明（選填）</span><input id="duesNote" class="' + inp + '" maxlength="300" placeholder="例：匯款後請告知執秘" value="' + duesE(dues.info.note) + '" oninput="duesInfo(\'note\', this.value)"></label>' +
        '</div>' +
        '<div class="mt-5 font-black text-slate-900">② 共同品項 <span class="font-normal text-xs text-slate-500">每位社友都要繳的項目；個別社友不用繳的，在下面的表格取消勾選</span></div>' +
        '<div id="duesCommon" class="mt-2"></div>' +
        '<div class="mt-5 font-black text-slate-900">③ 社友明細 <span class="font-normal text-xs text-slate-500">「＋加品項」可替這位社友加任何項目，金額可以是負數（例：溢繳折抵 -2000）。小計為 0 的人不會推播</span></div>' +
        '<div id="duesTable" class="mt-2"></div>' +
        '<div id="duesFoot" class="mt-3"></div>' +
        '<div id="duesPreview" class="mt-3"></div>' +
        '<div id="duesHistory" class="mt-5"></div>';
    duesRenderCommon(); duesRenderTable(); duesRenderHistory();
}
function duesRenderCommon() {
    var box = document.getElementById('duesCommon');
    if (!box) return;
    var max = CheckinCore.DUES_LIMITS.common;
    box.innerHTML = dues.common.map(function (c, i) {
        return '<div class="flex items-center gap-2 mb-1.5"><input class="duesCName min-w-0 flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" maxlength="30" placeholder="品項名稱，例：上半年社費" value="' + duesE(c.name) + '" oninput="duesCommonSet(' + i + ', \'name\', this.value)">' +
            '<input class="duesCAmt w-32 border border-slate-300 rounded-lg px-3 py-2 text-sm text-right" inputmode="numeric" placeholder="金額" value="' + duesE(c.amount) + '" oninput="duesCommonSet(' + i + ', \'amount\', this.value)">' +
            '<button type="button" onclick="duesCommonDel(' + i + ')" class="shrink-0 w-8 h-8 rounded-full border border-slate-300 text-slate-500 hover:bg-rose-50 hover:text-rose-700 font-bold" aria-label="刪除這個品項">×</button></div>';
    }).join('') + (dues.common.length < max ? '<button type="button" onclick="duesCommonAdd()" class="mt-1 px-3 py-1.5 border border-dashed border-slate-400 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-50">＋ 新增共同品項</button>' : '<div class="text-xs text-slate-500">共同品項最多 ' + max + ' 項。</div>');
}
// 有填名稱與金額的共同品項（表格的欄位）
function duesValidCommon() { return dues.common.filter(function (c) { var a = duesNum(c.amount); return String(c.name || '').trim() && Number.isFinite(a) && a !== 0; }); }
function duesRenderTable() {
    var box = document.getElementById('duesTable');
    if (!box || !dues) return;
    var people = duesPeople(), cols = duesValidCommon();
    dues.rows = people.map(function (p) { return p.key; });
    if (!people.length) { box.innerHTML = '<div class="text-sm text-slate-500 border border-dashed border-slate-300 rounded-lg px-3 py-6 text-center">社友庫還沒有社友。請先在社友庫新增社友。</div>'; duesRenderFoot(people); return; }
    var th = 'px-2 py-2 text-left text-xs font-bold text-slate-600 whitespace-nowrap';
    box.innerHTML = '<div class="overflow-x-auto border border-slate-200 rounded-lg"><table class="w-full text-sm"><thead class="bg-slate-50"><tr><th class="' + th + '">社友</th><th class="' + th + '">LINE</th>' +
        cols.map(function (c) { return '<th class="' + th + '">' + duesE(String(c.name).trim()) + '<div class="font-normal text-slate-500">' + duesMoney(duesNum(c.amount)) + '</div></th>'; }).join('') +
        '<th class="' + th + '">個別品項</th><th class="' + th + ' text-right">小計</th></tr></thead><tbody>' +
        people.map(function (p, i) {
            var m = dues.members[p.key] || { off: [], extra: [] };
            var adding = dues.adding && dues.adding.key === p.key;
            var extras = (m.extra || []).map(function (x, j) {
                return '<span class="inline-flex items-center gap-1 rounded-full pl-2.5 pr-1 py-0.5 mr-1 mb-1 text-xs border ' + (x.carried ? 'bg-amber-100 border-amber-400 text-amber-900' : 'bg-slate-100 border-slate-300 text-slate-800') + '">' +
                    duesE(x.name) + ' <b>' + duesMoney(x.amount) + '</b>' +
                    (x.carried ? '<button type="button" onclick="duesExtraConfirm(' + i + ',' + j + ')" class="duesCarried ml-0.5 px-1.5 rounded-full bg-amber-500 text-white font-bold" title="按一下＝確認這次也適用">沿用上次 ✓</button>' : '') +
                    '<button type="button" onclick="duesExtraDel(' + i + ',' + j + ')" class="w-5 h-5 rounded-full bg-white border border-slate-300 text-slate-600 font-bold leading-none" aria-label="移除">×</button></span>';
            }).join('');
            var addUi = adding
                ? '<span class="inline-flex flex-wrap items-center gap-1"><input id="duesAddName" class="w-28 border border-blue-400 rounded-md px-2 py-1 text-xs" maxlength="30" placeholder="品項名稱" value="' + duesE(dues.adding.name) + '" oninput="duesAddSet(\'name\', this.value)" onkeydown="if(event.key===\'Enter\'){event.preventDefault();duesAddOk();}">' +
                  '<input id="duesAddAmt" class="w-24 border border-blue-400 rounded-md px-2 py-1 text-xs text-right" inputmode="text" placeholder="金額（可負數）" value="' + duesE(dues.adding.amount) + '" oninput="duesAddSet(\'amount\', this.value)" onkeydown="if(event.key===\'Enter\'){event.preventDefault();duesAddOk();}">' +
                  '<button type="button" onclick="duesAddOk()" class="px-2 py-1 bg-blue-700 text-white rounded-md text-xs font-bold">加入</button><button type="button" onclick="duesAddCancel()" class="px-2 py-1 text-slate-600 text-xs">取消</button></span>'
                : ((m.extra || []).length < CheckinCore.DUES_LIMITS.extra ? '<button type="button" onclick="duesAddOpen(' + i + ')" class="duesAddBtn px-2 py-0.5 border border-dashed border-slate-400 rounded-full text-xs font-bold text-slate-700 hover:bg-slate-50 whitespace-nowrap">＋加品項</button>' : '');
            return '<tr class="border-t border-slate-100 ' + (p.total === 0 ? 'bg-slate-50 text-slate-400' : '') + '"><td class="px-2 py-2 whitespace-nowrap"><b class="' + (p.total === 0 ? '' : 'text-slate-900') + '">' + duesE(p.name) + '</b>' + (p.nickname ? ' <span class="text-slate-500">' + duesE(p.nickname) + '</span>' : '') + '</td>' +
                '<td class="px-2 py-2" title="' + (dues.bound[p.key] ? '已綁定 LINE' : '還沒綁定 LINE，收不到推播') + '">' + (dues.bound[p.key] ? '✅' : '❌') + '</td>' +
                cols.map(function (c) { var on = (m.off || []).indexOf(c.id) < 0; return '<td class="px-2 py-2 whitespace-nowrap"><label class="inline-flex items-center gap-1 cursor-pointer"><input type="checkbox" class="duesCk w-4 h-4" ' + (on ? 'checked' : '') + ' onchange="duesToggle(' + i + ',' + c.id + ', this.checked)"><span class="' + (on ? '' : 'line-through text-slate-400') + '">' + duesMoney(duesNum(c.amount)) + '</span></label></td>'; }).join('') +
                '<td class="px-2 py-2">' + extras + addUi + '</td>' +
                '<td class="duesSub px-2 py-2 text-right font-black whitespace-nowrap ' + (p.total === 0 ? '' : p.total < 0 ? 'text-rose-700' : 'text-slate-900') + '">' + duesMoney(p.total) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    duesRenderFoot(people);
}
function duesStats(people) {
    var t = people.filter(function (p) { return p.total !== 0; });
    return { targets: t, bound: t.filter(function (p) { return dues.bound[p.key]; }), unbound: t.filter(function (p) { return !dues.bound[p.key]; }), zero: people.length - t.length, total: t.reduce(function (n, p) { return n + p.total; }, 0) };
}
function duesRenderFoot(people) {
    var box = document.getElementById('duesFoot');
    if (!box) return;
    var s = duesStats(people || duesPeople());
    box.innerHTML = '<div class="flex flex-wrap items-center justify-between gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">' +
        '<div class="text-sm text-slate-800">本次推播 <b id="duesCount" class="text-lg text-blue-800">' + s.bound.length + '</b> 人，總金額 <b id="duesTotal" class="text-lg text-blue-800">NT$ ' + duesMoney(s.bound.reduce(function (n, p) { return n + p.total; }, 0)) + '</b>' +
        '<div class="text-xs text-slate-600 mt-0.5">有金額的社友共 ' + s.targets.length + ' 人（合計 NT$ ' + duesMoney(s.total) + '）' + (s.unbound.length ? '，其中 <b class="text-rose-700">' + s.unbound.length + ' 人沒綁定 LINE 收不到</b>' : '') + (s.zero ? '；小計為 0 不推播 ' + s.zero + ' 人' : '') + '</div></div>' +
        '<div class="flex flex-wrap gap-2"><button type="button" onclick="duesPreview()" class="px-4 py-2 bg-slate-800 text-white font-bold rounded-lg">預覽</button>' +
        '<button type="button" id="duesSendBtn" onclick="duesSend()" class="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white font-bold rounded-lg disabled:opacity-50" ' + (dues.canSend && !dues.sending ? '' : 'disabled') + '>📤 用 LINE 發送</button></div></div>';
    if (dues.preview) duesRenderPreview(people);
}
function duesRenderHistory() {
    var box = document.getElementById('duesHistory');
    if (!box) return;
    var h = dues.history || [];
    box.innerHTML = '<div class="font-black text-slate-900">本社發送紀錄</div>' + (h.length
        ? '<div class="mt-2 overflow-x-auto border border-slate-200 rounded-lg"><table class="w-full text-sm"><thead class="bg-slate-50 text-xs text-slate-600"><tr><th class="px-2 py-2 text-left">時間</th><th class="px-2 py-2 text-left">期別</th><th class="px-2 py-2 text-right">對象</th><th class="px-2 py-2 text-right">成功</th><th class="px-2 py-2 text-right">失敗</th><th class="px-2 py-2 text-right">沒綁定</th><th class="px-2 py-2 text-right">總金額</th></tr></thead><tbody>' +
          h.map(function (x) { return '<tr class="border-t border-slate-100"><td class="px-2 py-1.5 whitespace-nowrap">' + duesE(duesFmtTime(x.at)) + '</td><td class="px-2 py-1.5">' + duesE(x.period) + '</td><td class="px-2 py-1.5 text-right">' + x.targets + '</td><td class="px-2 py-1.5 text-right text-emerald-700 font-bold">' + x.sent + '</td><td class="px-2 py-1.5 text-right ' + (x.failed ? 'text-rose-700 font-bold' : '') + '">' + x.failed + '</td><td class="px-2 py-1.5 text-right">' + x.unbound + '</td><td class="px-2 py-1.5 text-right">' + duesMoney(x.total) + '</td></tr>'; }).join('') + '</tbody></table></div><div class="text-xs text-slate-500 mt-1">只顯示最近 10 次。紀錄不含每位社友的明細。</div>'
        : '<div class="mt-1 text-sm text-slate-500">還沒有發送過。</div>');
}

// ---------- 操作 ----------
function duesChanged(table) { dues.dirty = true; duesSaveDraft(); if (table) duesRenderTable(); }
function duesInfo(field, v) { if (!dues) return; dues.info[field] = v; dues.dirty = true; duesSaveDraft(); if (dues.preview) duesRenderPreview(); }
function duesCommonSet(i, field, v) { if (!dues || !dues.common[i]) return; dues.common[i][field] = v; duesChanged(true); }
function duesCommonAdd() { if (!dues || dues.common.length >= CheckinCore.DUES_LIMITS.common) return; dues.common.push({ id: duesIdSeq++, name: '', amount: '' }); duesRenderCommon(); var n = document.querySelectorAll('.duesCName'); if (n.length) n[n.length - 1].focus(); }
function duesCommonDel(i) {
    if (!dues || !dues.common[i]) return;
    var id = dues.common[i].id;
    dues.common.splice(i, 1);
    Object.keys(dues.members).forEach(function (k) { dues.members[k].off = (dues.members[k].off || []).filter(function (x) { return x !== id; }); });
    if (!dues.common.length) dues.common.push({ id: duesIdSeq++, name: '', amount: '' });
    duesRenderCommon(); duesChanged(true);
}
function duesToggle(i, cid, on) {
    if (!dues || !dues.rows || dues.rows[i] === undefined) return;
    var m = duesMemberOf(dues.rows[i]);
    m.off = (m.off || []).filter(function (x) { return x !== cid; });
    if (!on) m.off.push(cid);
    duesChanged(true);
}
function duesAddOpen(i) { if (!dues || dues.rows[i] === undefined) return; dues.adding = { key: dues.rows[i], name: '', amount: '' }; duesRenderTable(); var el = document.getElementById('duesAddName'); if (el) el.focus(); }
function duesAddSet(field, v) { if (dues && dues.adding) dues.adding[field] = v; }
function duesAddCancel() { if (!dues) return; dues.adding = null; duesRenderTable(); }
function duesAddOk() {
    if (!dues || !dues.adding) return;
    var name = String(dues.adding.name || '').trim(), amount = duesNum(dues.adding.amount);
    if (!name) { alert('請輸入品項名稱。'); return; }
    if (!Number.isFinite(amount) || amount === 0) { alert('請輸入金額（整數，不可以是 0；要扣款請輸入負數，例如 -2000）。'); return; }
    if (Math.abs(amount) > CheckinCore.DUES_LIMITS.amount) { alert('金額太大了，請確認。'); return; }
    duesMemberOf(dues.adding.key).extra.push({ name: name.slice(0, 30), amount: amount });
    dues.adding = null;
    duesChanged(true);
}
function duesExtraDel(i, j) { if (!dues || dues.rows[i] === undefined) return; var m = duesMemberOf(dues.rows[i]); m.extra.splice(j, 1); duesChanged(true); }
function duesExtraConfirm(i, j) { if (!dues || dues.rows[i] === undefined) return; var m = duesMemberOf(dues.rows[i]); if (m.extra[j]) delete m.extra[j].carried; duesChanged(true); }

// ---------- 預覽與發送 ----------
function duesPreview() { if (!dues) return; dues.preview = true; duesRenderPreview(); var el = document.getElementById('duesPreview'); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
function duesRenderPreview(peopleIn) {
    var box = document.getElementById('duesPreview');
    if (!box || !dues) return;
    var people = peopleIn || duesPeople(), s = duesStats(people), form = duesFormOut(false);
    dues.unboundKeys = s.unbound.map(function (p) { return p.key; });
    var sample = s.bound[0] || s.targets[0];
    box.innerHTML = '<div class="border border-slate-300 rounded-xl p-3 sm:p-4">' +
        '<div class="font-black text-slate-900">預覽</div>' +
        (form.info.period ? '' : '<div class="mt-1 text-sm font-bold text-rose-700">還沒填「期別」，填了才能發送。</div>') +
        '<div class="mt-1 text-sm text-slate-800">會收到 LINE 的社友：<b class="text-emerald-700">' + s.bound.length + '</b> 人' + (s.bound.length ? '（' + s.bound.map(function (p) { return duesE(p.nickname || p.name); }).join('、') + '）' : '') + '</div>' +
        (s.unbound.length ? '<div class="mt-2 text-sm font-bold text-rose-700">沒綁定 LINE、收不到的社友（' + s.unbound.length + ' 人）：</div><div class="mt-1 border border-rose-200 rounded-lg divide-y divide-rose-100">' +
            s.unbound.map(function (p, i) { return '<div class="flex items-center justify-between gap-2 px-3 py-1.5 text-sm"><span><b>' + duesE(p.name) + '</b>' + (p.nickname ? ' ' + duesE(p.nickname) : '') + '　NT$ ' + duesMoney(p.total) + '</span><button type="button" onclick="duesCopy(' + i + ')" class="duesCopyBtn shrink-0 px-2.5 py-1 border border-slate-300 rounded-md text-xs font-bold text-slate-700 hover:bg-slate-50">複製明細文字</button></div>'; }).join('') + '</div><div class="text-xs text-slate-500 mt-1">複製後可以貼到 LINE 個人聊天、簡訊或 Email 通知他。</div>' : '') +
        (sample ? '<div class="mt-3 text-sm font-bold text-slate-700">卡片內容範例（' + duesE(sample.name) + '）</div><pre class="mt-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 whitespace-pre-wrap font-sans">' + duesE(CheckinCore.duesPlainText(dues.club, form.info, sample)) + '</pre>' : '<div class="mt-2 text-sm text-slate-500">目前每位社友的小計都是 0，沒有可以推播的對象。</div>') +
        '</div>';
}
function duesCopy(i) {
    if (!dues || !dues.unboundKeys) return;
    var key = dues.unboundKeys[i], p = duesPeople().find(function (x) { return x.key === key; });
    if (!p) return;
    var text = CheckinCore.duesPlainText(dues.club, duesFormOut(false).info, p);
    var done = function () { if (typeof showToast === 'function') showToast('已複製「' + p.name + '」的明細文字', '📋'); };
    var fallback = function () { var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { alert(text); } document.body.removeChild(ta); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
}
async function duesSend() {
    if (!dues || dues.sending) return;
    var form = duesFormOut(false), s = duesStats(duesPeople());
    if (!form.info.period) { alert(DUES_ERR.DUES_NO_PERIOD); var el = document.getElementById('duesPeriod'); if (el) el.focus(); return; }
    if (dues.adding && (String(dues.adding.name || '').trim() || String(dues.adding.amount || '').trim())) { alert('有一筆個別品項還沒按「加入」，請先按「加入」或「取消」。'); return; }
    if (!s.targets.length) { alert(DUES_ERR.DUES_NO_TARGET); return; }
    if (!s.bound.length) { alert(DUES_ERR.DUES_NO_BOUND); return; }
    var carried = 0;
    Object.keys(dues.members).forEach(function (k) { (dues.members[k].extra || []).forEach(function (x) { if (x.carried) carried++; }); });
    if (!confirm('要推給 ' + s.bound.length + ' 位社友嗎？\n\n期別：' + form.info.period + '\n總金額：NT$ ' + duesMoney(s.bound.reduce(function (n, p) { return n + p.total; }, 0)) +
        (s.unbound.length ? '\n另有 ' + s.unbound.length + ' 位社友沒綁定 LINE，收不到。' : '') + (carried ? '\n\n⚠️ 還有 ' + carried + ' 筆「沿用上次」的個別品項沒有確認，會照樣發送。' : ''))) return;
    dues.sending = true; duesRenderFoot();
    var club = dues.club;
    var r = await lineBindingsApi('club_dues_send', { form: form });
    if (!dues || dues.club !== club) return;
    dues.sending = false;
    if (!r.ok) { duesRenderFoot(); alert('❌ 沒有發送：' + duesErr(r.code)); return; }
    try { localStorage.removeItem(duesDraftKey(club)); } catch (e) { /* 沒關係 */ }
    dues.history = r.history || dues.history; dues.source = ''; dues.dirty = false; dues.last = form; dues.lastAt = new Date().toISOString();
    Object.keys(dues.members).forEach(function (k) { (dues.members[k].extra || []).forEach(function (x) { delete x.carried; }); });
    duesRenderAll();
    var box = document.getElementById('duesPreview');
    if (box) box.innerHTML = '<div class="border rounded-xl px-4 py-3 ' + (r.failed ? 'border-amber-300 bg-amber-50' : 'border-emerald-300 bg-emerald-50') + '"><div class="font-black ' + (r.failed ? 'text-amber-800' : 'text-emerald-800') + '">已發送 ' + r.sent + ' 位社友' + (r.failed ? '，' + r.failed + ' 位發送失敗' : '') + '。</div>' +
        (r.failed ? '<div class="text-sm text-amber-800 mt-1">發送失敗：' + duesE((r.failedNames || []).join('、')) + '（可能是他封鎖了官方帳號，或官方帳號的推播額度用完）。</div>' : '') +
        ((r.unbound || []).length ? '<div class="text-sm text-slate-700 mt-1">沒綁定 LINE、沒有收到：' + r.unbound.map(function (p) { return duesE(p.nickname || p.name); }).join('、') + '。可按上方「預覽」用「複製明細文字」另外通知。</div>' : '') + '</div>';
    if (typeof showToast === 'function') showToast('社費明細已發送 ' + r.sent + ' 位社友', '💰');
}
