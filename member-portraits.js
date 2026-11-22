// 活動照片找人・第一步：社友大頭照（報名系統的執秘畫面）。
//   - 由執秘統一建置（使用者 2026-11-22 決定）：社友把照片傳給執秘，執秘在這裡上傳；社友不在 LINE 自己上傳。
//   - 大頭照是敏感個資：只經過雲端小程式 line-checkin，存在不公開的儲存空間；絕不寫進 app_storage／localStorage，
//     這個檔案的任何操作都不呼叫 saveToStorage()。
//   - 名單只有「誰有、幾張」；要看照片時按「查看」，一次只向雲端取一個人的（10 分鐘有效的簽名網址），不存下來。
//   - 開放與否：地區設定檔 photoEnabled（畫面）＋行事曆後台「⑦ 活動照片找人」逐社開放（雲端把關），預設全部關閉。
//   - 全域名稱 mp*／portrait*，視窗 #memberPortraitOverlay 動態建立。
var PORTRAIT_SIDE = 1600;          // 上傳前先縮到最長邊 1600（之後人臉比對用，太小會不準）
var PORTRAIT_MIN_SIDE = 300;
var PORTRAIT_ERR = {
    PHOTO_CLUB_OFF: '貴社尚未開放這個功能，請洽地區系統管理者。',
    PHOTO_TABLE_MISSING: '雲端尚未建立大頭照的資料表，請系統管理者執行 supabase/sql/member_portraits.sql。',
    PHOTO_NO_CONSENT: '要先確認已取得本人同意，才能上傳。',
    PHOTO_TOO_MANY: '已經有 3 張了。請先刪除一張，再上傳新的。',
    PHOTO_TOO_LARGE: '這張照片太大，請換一張再試。',
    PHOTO_BAD_IMAGE: '這張照片無法讀取，請換一張（建議用手機直接拍，或選 JPG 照片）。',
    PHOTO_NOT_FOUND: '找不到這張照片，可能已經刪除了。',
    MEMBER_NOT_FOUND: '社友庫裡找不到這個人，請重新整理後再試。',
    CLUB_AUTH_FAILED: '無法確認貴社身分。貴社若還沒有設定登入密碼，請先完成首次登入設定後再試。',
    LINE_NOT_CONFIGURED: '雲端小程式尚未啟用。',
    NETWORK: '網路連線不穩，請稍後再試。'
};
function portraitErr(code) { return PORTRAIT_ERR[code] || '雲端暫時無法處理，請稍後再試。'; }
function portraitE(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function portraitDate(ts) { try { return new Date(ts).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric' }); } catch (e) { return ''; } }

// 把使用者選的照片縮小並轉成 JPEG（回傳 data:image/jpeg;base64,...）。讀不了（例如電腦上的 HEIC）會 reject
function portraitPrepare(file) {
    return new Promise(function (resolve, reject) {
        if (!file) { reject(new Error('PHOTO_BAD_IMAGE')); return; }
        var url = URL.createObjectURL(file), img = new Image();
        img.onload = function () {
            try {
                var w = img.naturalWidth, h = img.naturalHeight;
                if (!w || !h) throw new Error('PHOTO_BAD_IMAGE');
                if (Math.max(w, h) < PORTRAIT_MIN_SIDE) throw new Error('PHOTO_TOO_SMALL');
                var s = Math.min(1, PORTRAIT_SIDE / Math.max(w, h));
                var c = document.createElement('canvas');
                c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
                var g = c.getContext('2d');
                g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);      // 透明背景的 PNG 轉 JPEG 時補白底
                g.drawImage(img, 0, 0, c.width, c.height);
                var q = 0.88, data = c.toDataURL('image/jpeg', q);
                while (data.length > 1700000 && q > 0.5) { q -= 0.1; data = c.toDataURL('image/jpeg', q); }   // base64 約 1.7MB ≈ 檔案 1.25MB
                URL.revokeObjectURL(url);
                if (data.indexOf('data:image/jpeg') !== 0) throw new Error('PHOTO_BAD_IMAGE');
                resolve(data);
            } catch (e) { URL.revokeObjectURL(url); reject(e); }
        };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('PHOTO_BAD_IMAGE')); };
        img.src = url;
    });
}
function portraitPrepareErr(e) { return e && e.message === 'PHOTO_TOO_SMALL' ? '這張照片太小了，請換一張比較清楚的。' : PORTRAIT_ERR.PHOTO_BAD_IMAGE; }
var PORTRAIT_TIPS = '正面、臉清楚、只有本人；最好 2～3 張（例如有戴眼鏡、沒戴眼鏡各一張）。請用近幾年的照片。';

// ======================= 執秘（報名系統）：大頭照名單 =======================
var mpBtnState = { club: '', enabled: false, at: 0 };
var mp = null;                // 開著的視窗：{ club, people:{key:{count,at}}, bound:{key:true}, max, target, busy, msg, open:展開中的人, photos:那個人的照片 }
// 由 updateRolePermissionsUI() 呼叫（很頻繁），所以同一社 5 分鐘內只問雲端一次
async function mpRefreshButton() {
    var btn = document.getElementById('memberPortraitBtn');
    if (!btn) return;
    var club = typeof selectedClubName === 'string' ? selectedClubName : '';
    if (!(typeof DISTRICT === 'object' && DISTRICT && DISTRICT.photoEnabled) || !club || club === '地區辦公室' || typeof lineBindingsApi !== 'function') { btn.classList.add('hidden'); return; }
    if (mpBtnState.club === club && Date.now() - mpBtnState.at < 300000) { btn.classList.toggle('hidden', !mpBtnState.enabled); return; }
    mpBtnState = { club: club, enabled: false, at: Date.now() };
    btn.classList.add('hidden');
    var r = await lineBindingsApi('photo_desk_status');
    if (mpBtnState.club !== club || selectedClubName !== club) return;       // 等待期間換了社＝這次結果不採用
    mpBtnState.enabled = !!(r && r.ok && r.enabled);
    if (!(r && r.ok)) mpBtnState.at = Date.now() - 240000;                   // 沒問到＝1 分鐘後再問
    btn.classList.toggle('hidden', !mpBtnState.enabled);
}
function mpKey(m) { return (m.name || '') + '|' + (m.nickname || ''); }
function mpMembers() {
    var list = ((typeof clubMemberDatabase === 'object' && clubMemberDatabase && clubMemberDatabase[mp.club]) || []).filter(function (m) { return m && m.name; });
    return typeof sortMembersForDisplay === 'function' ? sortMembersForDisplay(list) : list;
}
function mpApply(r) {
    mp.people = {}; (r.people || []).forEach(function (p) { mp.people[p.key] = p; });
    mp.bound = {}; (r.bound || []).forEach(function (k) { mp.bound[k] = true; });
    mp.max = r.max || 3;
    if (mp.open && !mp.people[mp.open]) { mp.open = ''; mp.photos = null; }
}
function mpSay(text, bad) { mp.msg = text || ''; mp.bad = !!bad; }
async function openMemberPortraits() {
    var club = selectedClubName;
    if (!club) return;
    var ov = document.getElementById('memberPortraitOverlay');
    if (!ov) {
        ov = document.createElement('div');
        ov.id = 'memberPortraitOverlay';
        ov.className = 'fixed inset-0 z-[70] bg-slate-900/60 flex items-start justify-center overflow-y-auto p-3 sm:p-6';
        ov.onclick = function (e) { if (e.target === ov) mpClose(); };
        document.body.appendChild(ov);
    }
    mp = { club: club, people: {}, bound: {}, max: 3, target: '', busy: false, msg: '', bad: false, loaded: false, open: '', photos: null };
    ov.classList.remove('hidden');
    mpRender();
    var r = await lineBindingsApi('photo_desk_list');
    if (!mp || mp.club !== club) return;
    if (!r.ok) { mpSay(portraitErr(r.code), true); mpRender(); return; }
    mp.loaded = true; mpApply(r); mpRender();
}
function mpClose() { var ov = document.getElementById('memberPortraitOverlay'); if (ov) { ov.classList.add('hidden'); ov.innerHTML = ''; } mp = null; }
function mpCopyAsk() {
    var text = '各位社友好：為了在活動結束後幫大家找出自己的活動照片，請每位社友（含寶尊眷）傳 1～3 張大頭照給我。\n・正面、臉清楚、只有本人\n・請用近幾年的照片（有戴眼鏡、沒戴眼鏡各一張更好）\n大頭照只用來比對扶輪活動照片，不會公開；之後想更換或刪除，隨時跟我說。';
    var done = function () { if (mp) { mpSay('已複製，可以貼到貴社的 LINE 群組。'); mpRender(); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { prompt('請手動複製：', text); });
    else prompt('請手動複製：', text);
}
function mpRender() {
    var ov = document.getElementById('memberPortraitOverlay');
    if (!ov || !mp) return;
    var E = portraitE, members = mpMembers(), keys = {}, have = 0;
    members.forEach(function (m) { keys[mpKey(m)] = true; if (mp.people[mpKey(m)]) have++; });
    var orphans = Object.keys(mp.people).filter(function (k) { return !keys[k]; });
    window.__mpKeys = members.map(mpKey).concat(orphans);
    // 展開某個人時，在他的下方顯示照片（每張可單獨刪除）
    var photosRow = function (k) {
        if (mp.open !== k) return '';
        var inner = !mp.photos ? '<span class="text-sm text-slate-500">讀取中…</span>'
            : (mp.photos.length ? mp.photos.map(function (ph, n) {
                return '<div class="text-center"><div class="w-28 h-28 rounded-xl overflow-hidden bg-slate-100 border border-slate-200">' + (ph.url ? '<img src="' + E(ph.url) + '" alt="大頭照" class="mp-img w-full h-full object-cover">' : '') + '</div>'
                    + '<div class="text-[11px] text-slate-500 mt-1">' + E(portraitDate(ph.at)) + '</div><button type="button" onclick="mpDeleteOne(' + n + ')" class="mp-del1 mt-0.5 text-xs font-bold text-rose-700 border border-rose-200 hover:bg-rose-50 rounded-lg px-2 py-1">刪除這張</button></div>';
            }).join('') : '<span class="text-sm text-slate-500">沒有照片。</span>');
        return '<tr class="mp-photos bg-slate-50 border-b border-slate-100"><td colspan="3" class="px-3 py-3"><div class="flex flex-wrap gap-3">' + inner + '</div></td></tr>';
    };
    var buttons = function (k, i, p) {
        return (!p || p.count < mp.max ? '<button type="button" onclick="mpPick(' + i + ')" class="mp-up text-xs font-bold text-blue-800 border border-blue-300 bg-blue-50 hover:bg-blue-100 rounded-lg px-2.5 py-1.5">' + (p ? '再加一張' : '上傳') + '</button>' : '')
            + (p ? '<button type="button" onclick="mpView(' + i + ')" class="mp-view ml-1 text-xs font-bold text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg px-2.5 py-1.5">' + (mp.open === k ? '收起' : '查看') + '</button>'
                + '<button type="button" onclick="mpDelete(' + i + ')" class="mp-del ml-1 text-xs font-bold text-rose-700 border border-rose-200 hover:bg-rose-50 rounded-lg px-2.5 py-1.5">全部刪除</button>' : '');
    };
    var row = function (m, i) {
        var k = mpKey(m), p = mp.people[k], spouse = !!m.spouseOfId;
        var status = p ? '<span class="font-bold text-emerald-700">✅ ' + p.count + ' 張</span><span class="ml-1 text-xs text-slate-500">' + E(portraitDate(p.at)) + '</span>' : '<span class="text-slate-400">尚未上傳</span>';
        return '<tr class="mp-row border-b border-slate-100' + (spouse ? ' bg-slate-50/60' : '') + '"><td class="py-2 pl-3 pr-2"><span class="font-bold">' + (spouse ? '└ ' : '') + E(m.name) + '</span>' + (m.nickname ? '<span class="ml-1.5 text-sm text-slate-500">' + E(m.nickname) + '</span>' : '')
            + (mp.bound[k] ? '<span class="ml-1.5 text-[11px] text-green-700 bg-green-50 border border-green-200 rounded px-1">已綁 LINE</span>' : '') + '</td>'
            + '<td class="py-2 px-2 text-sm">' + status + '</td><td class="py-2 pl-2 pr-3 text-right whitespace-nowrap">' + buttons(k, i, p) + '</td></tr>' + photosRow(k);
    };
    ov.innerHTML = '<div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-2">'
        + '<div class="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200"><div><div class="font-black text-lg">📷 ' + E(mp.club) + ' 大頭照</div>'
        + '<div class="text-sm text-slate-600 mt-0.5">請社友把大頭照傳給您，由您在這裡上傳。活動結束後，系統會用大頭照找出每位社友的活動照片。</div></div>'
        + '<button type="button" onclick="mpClose()" class="shrink-0 text-slate-500 hover:text-slate-800 text-2xl leading-none px-2">×</button></div>'
        + '<div class="px-5 py-4">'
        + (mp.msg ? '<div id="mpMsg" class="mb-3 text-sm font-bold rounded-lg px-3 py-2 ' + (mp.bad ? 'text-rose-700 bg-rose-50 border border-rose-200' : 'text-emerald-800 bg-emerald-50 border border-emerald-200') + '">' + E(mp.msg) + '</div>' : '')
        + (!mp.loaded ? (mp.msg ? '' : '<div class="text-slate-500 py-8 text-center">讀取中…</div>')
            : '<div class="flex flex-wrap items-center justify-between gap-2"><div id="mpSummary" class="font-bold">已有大頭照：<span class="text-emerald-700">' + have + '</span>／' + members.length + ' 人</div>'
            + '<button type="button" onclick="mpCopyAsk()" class="text-sm font-bold text-green-800 border border-green-300 bg-green-50 hover:bg-green-100 rounded-lg px-3 py-1.5">📋 複製「請社友傳大頭照給我」的訊息</button></div>'
            + '<p class="text-xs text-slate-500 mt-1.5 leading-relaxed">每人最多 ' + mp.max + ' 張，可以一次選好幾張。' + PORTRAIT_TIPS + '上傳前請先取得本人同意；有綁定 LINE 的社友會收到一則通知。大頭照不會公開。</p>'
            + '<input type="file" id="mpFile" accept="image/*" multiple class="hidden" onchange="mpPicked(this)">'
            + '<div class="mt-3 border border-slate-200 rounded-xl overflow-hidden"><table class="w-full"><tbody id="mpRows">' + (members.length ? members.map(row).join('') : '<tr><td class="py-6 text-center text-slate-500">社友庫還沒有名單。</td></tr>') + '</tbody></table></div>'
            + (orphans.length ? '<div class="mt-4 text-sm font-bold text-amber-800">已不在社友庫的人（' + orphans.length + '）</div><p class="text-xs text-slate-500 mt-0.5">這些人已經從社友庫移除（或改了名字），大頭照還留著。確定不需要請刪除。</p><div id="mpOrphans" class="mt-2 border border-amber-200 rounded-xl divide-y divide-amber-100">'
                + orphans.map(function (k, j) { return '<div class="flex items-center justify-between gap-2 px-3 py-2"><span class="font-bold">' + E(k.split('|')[0]) + '<span class="ml-1.5 text-sm font-normal text-slate-500">' + E(k.split('|')[1] || '') + '</span></span><button type="button" onclick="mpDelete(' + (members.length + j) + ')" class="text-xs font-bold text-rose-700 border border-rose-200 rounded-lg px-2.5 py-1.5">刪除</button></div>'; }).join('') + '</div>' : ''))
        + '</div></div>';
}
function mpPick(i) {
    if (!mp || mp.busy) return;
    mp.target = (window.__mpKeys || [])[i] || '';
    var f = document.getElementById('mpFile');
    if (mp.target && f) f.click();
}
async function mpPicked(input) {
    var files = Array.prototype.slice.call(input.files || []);
    input.value = '';
    if (!files.length || !mp || mp.busy || !mp.target) return;
    var club = mp.club, key = mp.target, name = key.split('|')[0];
    var room = mp.max - ((mp.people[key] || {}).count || 0), skipped = Math.max(0, files.length - room);
    files = files.slice(0, Math.max(0, room));
    if (!files.length) { mpSay(PORTRAIT_ERR.PHOTO_TOO_MANY, true); mpRender(); return; }
    if (!confirm('要幫「' + name + '」上傳 ' + files.length + ' 張大頭照嗎？\n\n請確認：您已經取得「' + name + '」本人同意，用大頭照比對扶輪活動照片。\n\n按「確定」＝已取得本人同意並上傳。' + (mp.bound[key] ? '他有綁定 LINE，會收到一則通知。' : ''))) return;
    mp.busy = true;
    var done = 0, notified = false, err = '';
    for (var n = 0; n < files.length; n++) {
        mpSay('上傳中…（' + (n + 1) + '／' + files.length + '）'); mpRender();
        var data = null, r = null;
        try { data = await portraitPrepare(files[n]); } catch (e) { err = '第 ' + (n + 1) + ' 張：' + portraitPrepareErr(e); continue; }
        r = await lineBindingsApi('photo_desk_upload', { personKey: key, image: data, consent: true });
        if (!mp || mp.club !== club) return;
        if (!r.ok) { err = '第 ' + (n + 1) + ' 張：' + portraitErr(r.code); if (r.code !== 'PHOTO_BAD_IMAGE' && r.code !== 'PHOTO_TOO_LARGE') break; continue; }
        done++; if (r.notified) notified = true; mpApply(r);
    }
    if (!mp || mp.club !== club) return;
    mp.busy = false;
    if (mp.open === key) { mp.photos = null; mpLoadPhotos(key); }
    var text = done ? '已幫「' + name + '」上傳 ' + done + ' 張。' + (notified ? '已用 LINE 通知本人。' : (mp.bound[key] ? '' : '（他沒有綁定 LINE，所以沒有通知。）')) : '';
    if (skipped) text += '（超過 ' + mp.max + ' 張上限，有 ' + skipped + ' 張沒有上傳。）';
    mpSay((text + (err ? '　' + err : '')).trim(), !done);
    mpRender();
}
// 查看某一個人的照片：按了才向雲端取（一次一個人），收起或關閉視窗就丟掉
async function mpLoadPhotos(key) {
    var club = mp.club;
    var r = await lineBindingsApi('photo_desk_view', { personKey: key });
    if (!mp || mp.club !== club || mp.open !== key) return;
    if (!r.ok) { mp.open = ''; mp.photos = null; mpSay(portraitErr(r.code), true); mpRender(); return; }
    mp.photos = r.photos || []; mpRender();
}
function mpView(i) {
    if (!mp || mp.busy) return;
    var key = (window.__mpKeys || [])[i] || '';
    if (!key) return;
    if (mp.open === key) { mp.open = ''; mp.photos = null; mpRender(); return; }
    mp.open = key; mp.photos = null; mpRender(); mpLoadPhotos(key);
}
async function mpDeleteOne(n) {
    if (!mp || mp.busy || !mp.open || !mp.photos || !mp.photos[n]) return;
    var club = mp.club, key = mp.open, name = key.split('|')[0];
    if (!confirm('要刪除「' + name + '」的這張大頭照嗎？')) return;
    mp.busy = true;
    var r = await lineBindingsApi('photo_desk_delete', { personKey: key, id: mp.photos[n].id });
    if (!mp || mp.club !== club) return;
    mp.busy = false;
    if (!r.ok && r.code !== 'PHOTO_NOT_FOUND') { mpSay(portraitErr(r.code), true); mpRender(); return; }
    if (r.ok) mpApply(r);
    mpSay('已刪除一張。'); mp.photos = null; mpRender();
    if (mp.open === key) mpLoadPhotos(key);
}
async function mpDelete(i) {
    if (!mp || mp.busy) return;
    var club = mp.club, key = (window.__mpKeys || [])[i] || '', name = key.split('|')[0];
    if (!key || !confirm('要刪除「' + name + '」全部的大頭照嗎？\n\n刪除後，系統就不會再比對他的活動照片。')) return;
    mp.busy = true;
    var r = await lineBindingsApi('photo_desk_delete', { personKey: key });
    if (!mp || mp.club !== club) return;
    mp.busy = false;
    if (!r.ok) { mpSay(portraitErr(r.code), true); mpRender(); return; }
    mpApply(r); mpSay('已刪除「' + name + '」的大頭照。'); mpRender();
}
// 從社友庫刪除社友時順便刪掉他的大頭照（只在這個社有開放時才連網；失敗不影響刪除社友，名單裡的「已不在社友庫」可以補刪）
function mpForgetMember(club, member) {
    if (!member || mpBtnState.club !== club || !mpBtnState.enabled || typeof lineBindingsApi !== 'function') return;
    try { lineBindingsApi('photo_desk_delete', { personKey: mpKey(member) }); } catch (e) { /* 忽略 */ }
}
