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
    mp = { club: club, people: {}, bound: {}, max: 3, target: '', busy: false, msg: '', bad: false, loaded: false, open: '', photos: null, tab: 'people', jobs: null, jobOpen: '', canRun: true, jobMsg: '', jobBad: false };
    ov.classList.remove('hidden');
    mpRender();
    var r = await lineBindingsApi('photo_desk_list');
    if (!mp || mp.club !== club) return;
    if (!r.ok) { mpSay(portraitErr(r.code), true); mpRender(); return; }
    mp.loaded = true; mpApply(r); mpRender();
}
function mpClose() { clearTimeout(mpjTimer); var ov = document.getElementById('memberPortraitOverlay'); if (ov) { ov.classList.add('hidden'); ov.innerHTML = ''; } mp = null; }
function mpCopyAsk() {
    var text = '各位社友好：為了在活動結束後幫大家找出自己的活動照片，請每位社友（含寶尊眷）傳 1～3 張大頭照給我。\n・正面、臉清楚、只有本人\n・請用近幾年的照片（有戴眼鏡、沒戴眼鏡各一張更好）\n大頭照只用來比對扶輪活動照片，不會公開；之後想更換或刪除，隨時跟我說。';
    var done = function () { if (mp) { mpSay('已複製，可以貼到貴社的 LINE 群組。'); mpRender(); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { prompt('請手動複製：', text); });
    else prompt('請手動複製：', text);
}
function mpRender() {
    var ov = document.getElementById('memberPortraitOverlay');
    if (!ov || !mp) return;
    if (mp.tab === 'jobs') { mpRenderJobs(); return; }
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
        + mpTabsHtml()
        + '<div class="px-5 py-4">'
        + (mp.msg ? '<div id="mpMsg" class="mb-3 text-sm font-bold rounded-lg px-3 py-2 ' + (mp.bad ? 'text-rose-700 bg-rose-50 border border-rose-200' : 'text-emerald-800 bg-emerald-50 border border-emerald-200') + '">' + E(mp.msg) + '</div>' : '')
        + (!mp.loaded ? (mp.msg ? '' : '<div class="text-slate-500 py-8 text-center">讀取中…</div>')
            : '<div class="flex flex-wrap items-center justify-between gap-2"><div id="mpSummary" class="font-bold">已有大頭照：<span class="text-emerald-700">' + have + '</span>／' + members.length + ' 人</div>'
            + '<button type="button" onclick="mpCopyAsk()" class="text-sm font-bold text-green-800 border border-green-300 bg-green-50 hover:bg-green-100 rounded-lg px-3 py-1.5">📋 複製「請社友傳大頭照給我」的訊息</button></div>'
            + '<p class="text-xs text-slate-500 mt-1.5 leading-relaxed">每人最多 ' + mp.max + ' 張，可以一次選好幾張。' + PORTRAIT_TIPS + '上傳前請先取得本人同意。大頭照不會公開。標「已綁 LINE」的社友，之後找到活動照片時才收得到 LINE 通知。</p>'
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
    if (!confirm('要幫「' + name + '」上傳 ' + files.length + ' 張大頭照嗎？\n\n請確認：您已經取得「' + name + '」本人同意，用大頭照比對扶輪活動照片。\n\n按「確定」＝已取得本人同意並上傳。')) return;
    mp.busy = true;
    var done = 0, err = '';
    for (var n = 0; n < files.length; n++) {
        mpSay('上傳中…（' + (n + 1) + '／' + files.length + '）'); mpRender();
        var data = null, r = null;
        try { data = await portraitPrepare(files[n]); } catch (e) { err = '第 ' + (n + 1) + ' 張：' + portraitPrepareErr(e); continue; }
        r = await lineBindingsApi('photo_desk_upload', { personKey: key, image: data, consent: true });
        if (!mp || mp.club !== club) return;
        if (!r.ok) { err = '第 ' + (n + 1) + ' 張：' + portraitErr(r.code); if (r.code !== 'PHOTO_BAD_IMAGE' && r.code !== 'PHOTO_TOO_LARGE') break; continue; }
        done++; mpApply(r);
    }
    if (!mp || mp.club !== club) return;
    mp.busy = false;
    if (mp.open === key) { mp.photos = null; mpLoadPhotos(key); }
    var text = done ? '已幫「' + name + '」上傳 ' + done + ' 張。' : '';
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

// ======================= 執秘：活動照片（貼本社活動的資料夾連結、看比對結果、發送通知） =======================
// 地區管理者貼的活動（地區年會等）這裡只看得到本社的結果，不能動；本社自己貼的（例會、社慶）可以重新比對、發送、刪除。
// 結果只有「誰幾張」，照片本身由社友在 LINE 自己看。這一頁同樣不寫 app_storage／localStorage。
var mpjTimer = null;
var MPJ_ERR = {
    PHOTO_NO_TITLE: '請填活動名稱。',
    PHOTO_BAD_URL: '這不是 Google 雲端硬碟「資料夾」的連結。請打開攝影師給的資料夾，複製網址列的網址再貼上。',
    PHOTO_DUPLICATE: '這個資料夾已經貼過了。要再比對一次，請在下面那一列按「重新比對」。',
    PHOTO_NOT_READY: '比對還沒完成，完成後才能發送。',
    PHOTO_RUNNING: '正在比對中，請等它完成。',
    PHOTO_JOB_NOT_FOUND: '找不到這個活動，可能已經刪除了；地區的活動要由地區管理者處理。',
    PUSH_DISABLED: '這個地區還沒開放 LINE 推播，無法發送通知。',
    BAD_REQUEST: '這個地區沒有設定 LINE，無法產生看照片的連結。'
};
function mpjErr(code) { return MPJ_ERR[code] || portraitErr(code); }
function mpTabsHtml() {
    var t = function (id, label) { return '<button type="button" onclick="mpTab(\'' + id + '\')" class="mp-tab px-4 py-2 text-sm font-bold border-b-2 ' + (mp.tab === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700') + '">' + label + '</button>'; };
    return '<div class="flex gap-1 px-4 border-b border-slate-200">' + t('people', '① 大頭照') + t('jobs', '② 活動照片') + '</div>';
}
function mpTab(id) {
    if (!mp || mp.busy) return;
    mp.tab = id; mp.open = ''; mp.photos = null; clearTimeout(mpjTimer);
    mpRender();
    if (id === 'jobs') mpjLoad();
}
function mpjDate(ts) { try { return new Date(ts).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }); } catch (e) { return ''; } }
function mpjStatus(j) {
    var E = portraitE;
    if (j.status === 'queued') return '<span class="text-amber-700 font-bold">排隊中</span>' + (mp.canRun ? '' : '<span class="text-xs text-slate-500">（運算程式尚未設定，暫時不會開始）</span>');
    if (j.status === 'running') return '<span class="text-blue-700 font-bold">' + (j.stuck ? '可能卡住了' : '比對中') + '</span>' + (j.progress && (j.progress.total || j.progress.stage) ? ' <span class="text-sm text-slate-600">' + E(j.progress.stage || '') + (j.progress.total ? ' ' + j.progress.done + '／' + j.progress.total : '') + '</span>' : '');
    if (j.status === 'failed') return '<span class="text-rose-700 font-bold">失敗</span> <span class="text-sm text-rose-700">' + E(j.error || '') + '</span>';
    return '<span class="text-emerald-700 font-bold">比對完成</span> <span class="text-sm text-slate-600">本社找到 ' + j.people + ' 人（確定 ' + j.sure + ' 張' + (j.pending ? '、待本人確認 ' + j.pending + ' 張' : '') + '）</span>'
        + (j.sentAt ? ' <span class="text-sm text-emerald-700">・已發送 ' + E(mpjDate(j.sentAt)) + '</span>' : ' <span class="text-sm text-amber-700 font-bold">・尚未發送</span>');
}
function mpjListHtml() {
    var E = portraitE;
    if (!mp.jobs) return '<div class="text-slate-500 py-6 text-center">讀取中…</div>';
    if (!mp.jobs.length) return '<div class="text-sm text-slate-500 py-4">還沒有任何活動照片。</div>';
    var names = {}; mpMembers().forEach(function (m) { names[mpKey(m)] = m; });
    window.__mpjIds = mp.jobs.map(function (j) { return j.id; });
    return '<div class="border border-slate-200 rounded-xl divide-y divide-slate-100">' + mp.jobs.map(function (j, i) {
        var own = j.scope === 'club';
        var persons = (j.persons || []).slice().sort(function (a, b) { return (b.sure + b.pending) - (a.sure + a.pending); });
        return '<div class="mpj-row px-3 py-2.5"><div class="flex flex-wrap items-center gap-x-2 gap-y-1"><span class="font-bold">' + E(j.title) + '</span>'
            + '<span class="text-xs rounded px-1.5 py-0.5 ' + (own ? 'bg-slate-100 text-slate-600 border border-slate-200' : 'bg-blue-50 text-blue-800 border border-blue-200') + '">' + (own ? '本社' : '地區') + '</span>'
            + '<span class="text-xs text-slate-500">' + E(mpjDate(j.createdAt)) + '</span></div>'
            + '<div class="mt-1">' + mpjStatus(j) + '</div>'
            + '<div class="mt-2 flex flex-wrap gap-2">'
            + (j.status === 'done' && persons.length ? '<button type="button" onclick="mpjToggle(' + i + ')" class="mpj-who border border-slate-300 font-bold rounded-lg px-3 py-1.5 text-sm">' + (mp.jobOpen === j.id ? '收起名單' : '看誰有照片') + '</button>' : '')
            + (own && j.status === 'done' ? '<button type="button" onclick="mpjSend(' + i + ')" class="mpj-send bg-emerald-600 text-white font-bold rounded-lg px-3 py-1.5 text-sm">📤 ' + (j.sentAt ? '再發送（只發給還沒通知過的人）' : '發送通知') + '</button>' : '')
            + (own && (j.status !== 'running' || j.stuck) ? '<button type="button" onclick="mpjRerun(' + i + ')" class="mpj-rerun border border-slate-300 font-bold rounded-lg px-3 py-1.5 text-sm">' + (j.status === 'queued' ? '再啟動一次' : '重新比對') + '</button>' : '')
            + (own ? '<button type="button" onclick="mpjDelete(' + i + ')" class="mpj-del text-rose-700 font-bold text-sm px-2">刪除</button>' : '<span class="self-center text-xs text-slate-500">由地區管理者發送通知</span>')
            + '</div>'
            + (mp.jobOpen === j.id ? '<div class="mpj-persons mt-2 flex flex-wrap gap-1.5">' + persons.map(function (p) { var m = names[p.key]; return '<span class="text-sm bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">' + E(m ? m.name : p.key.split('|')[0]) + (m && m.nickname ? ' <span class="text-slate-500">' + E(m.nickname) + '</span>' : '') + ' <b class="text-emerald-700">' + p.sure + '</b> 張' + (p.pending ? '<span class="text-amber-700">＋' + p.pending + ' 待確認</span>' : '') + '</span>'; }).join('') + '</div>' : '')
            + '</div>';
    }).join('') + '</div>';
}
function mpRenderJobs() {
    var ov = document.getElementById('memberPortraitOverlay'), E = portraitE;
    ov.innerHTML = '<div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-2">'
        + '<div class="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200"><div><div class="font-black text-lg">📷 ' + E(mp.club) + ' 活動照片</div>'
        + '<div class="text-sm text-slate-600 mt-0.5">活動結束後貼上攝影師的 Google 雲端硬碟資料夾連結，系統會用大頭照找出本社每個人的照片。</div></div>'
        + '<button type="button" onclick="mpClose()" class="shrink-0 text-slate-500 hover:text-slate-800 text-2xl leading-none px-2">×</button></div>'
        + mpTabsHtml()
        + '<div class="px-5 py-4">'
        + '<div class="font-bold">貼上本社活動的照片連結<span class="ml-2 text-xs font-normal text-slate-500">（例會、社慶等；地區活動由地區管理者貼）</span></div>'
        + '<div class="mt-2 grid gap-2 sm:grid-cols-[1fr_2fr_auto]">'
        + '<input id="mpjTitle" type="text" maxlength="60" class="border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="活動名稱（例：11 月例會）">'
        + '<input id="mpjUrl" type="url" class="border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="貼上 Google 雲端硬碟資料夾連結">'
        + '<button type="button" id="mpjAddBtn" onclick="mpjAdd()" class="bg-blue-700 hover:bg-blue-800 text-white font-bold rounded-lg px-4 py-2 text-sm whitespace-nowrap">開始找照片</button></div>'
        + '<p class="text-xs text-slate-500 mt-1.5 leading-relaxed">資料夾要請攝影師設成「知道連結的任何人都能檢視」。只會比對「① 大頭照」裡已經有大頭照的人。比對通常需要十幾到三十分鐘，完成後請按「發送通知」，社友才會在 LINE 收到看照片的連結（至少要有一張「確定」的照片才會通知）；沒綁 LINE 的寶尊眷會併在對應社友的訊息裡。</p>'
        + '<div id="mpjMsg" class="' + (mp.jobMsg ? '' : 'hidden ') + 'mt-2 text-sm font-bold rounded-lg px-3 py-2 ' + (mp.jobBad ? 'text-rose-700 bg-rose-50 border border-rose-200' : 'text-emerald-800 bg-emerald-50 border border-emerald-200') + '">' + E(mp.jobMsg) + '</div>'
        + '<div id="mpjList" class="mt-3">' + mpjListHtml() + '</div>'
        + '</div></div>';
}
// 只重畫清單與訊息，不動輸入框（自動更新時才不會打斷正在輸入的字）
function mpjRefresh() {
    if (!mp || mp.tab !== 'jobs') return;
    var l = document.getElementById('mpjList'), m = document.getElementById('mpjMsg');
    if (!l || !m) { mpRender(); return; }
    l.innerHTML = mpjListHtml();
    m.textContent = mp.jobMsg; m.className = (mp.jobMsg ? '' : 'hidden ') + 'mt-2 text-sm font-bold rounded-lg px-3 py-2 ' + (mp.jobBad ? 'text-rose-700 bg-rose-50 border border-rose-200' : 'text-emerald-800 bg-emerald-50 border border-emerald-200');
    clearTimeout(mpjTimer);
    if ((mp.jobs || []).some(function (j) { return j.status === 'queued' || j.status === 'running'; })) mpjTimer = setTimeout(function () { mpjLoad(true); }, 10000);
}
function mpjSay(text, bad) { mp.jobMsg = text || ''; mp.jobBad = !!bad; }
function mpjApply(r) { mp.jobs = r.jobs || []; mp.canRun = r.canRun !== false; }
async function mpjLoad(quiet) {
    if (!mp || mp.busy) return;
    var club = mp.club, r = await lineBindingsApi('photo_desk_job_list');
    if (!mp || mp.club !== club || mp.tab !== 'jobs') return;
    if (!r.ok) { if (!quiet) { mp.jobs = []; mpjSay(mpjErr(r.code), true); mpjRefresh(); } return; }
    mpjApply(r); mpjRefresh();
}
async function mpjCall(action, extra, okText) {
    if (!mp || mp.busy) return null;
    var club = mp.club;
    mp.busy = true;
    var r = await lineBindingsApi(action, Object.assign({ district: (typeof DISTRICT === 'object' && DISTRICT && DISTRICT.code) || '' }, extra || {}));
    if (!mp || mp.club !== club) return null;
    mp.busy = false;
    if (!r.ok) { mpjSay(mpjErr(r.code), true); mpjRefresh(); return null; }
    if (r.jobs) mpjApply(r);
    if (okText) mpjSay(typeof okText === 'function' ? okText(r) : okText);
    mpjRefresh();
    return r;
}
function mpjJob(i) { var id = (window.__mpjIds || [])[i]; return (mp && mp.jobs || []).filter(function (j) { return j.id === id; })[0] || null; }
function mpjToggle(i) { var j = mpjJob(i); if (!j) return; mp.jobOpen = mp.jobOpen === j.id ? '' : j.id; mpjRefresh(); }
async function mpjAdd() {
    var t = document.getElementById('mpjTitle'), u = document.getElementById('mpjUrl');
    var title = (t.value || '').trim(), url = (u.value || '').trim();
    if (!title) { mpjSay(MPJ_ERR.PHOTO_NO_TITLE, true); mpjRefresh(); return; }
    if (!url) { mpjSay('請貼上 Google 雲端硬碟資料夾連結。', true); mpjRefresh(); return; }
    var r = await mpjCall('photo_desk_job_add', { title: title, url: url }, function (r) { return r.started ? '已開始比對，完成後會顯示在下面（通常需要十幾到三十分鐘，不用停在這個畫面）。' : '已排入。運算程式尚未設定或暫時啟動不了，稍後可以按「再啟動一次」。'; });
    if (r) { t = document.getElementById('mpjTitle'); u = document.getElementById('mpjUrl'); if (t) t.value = ''; if (u) u.value = ''; }
}
async function mpjRerun(i) {
    var j = mpjJob(i); if (!j) return;
    if (!confirm('要重新比對「' + j.title + '」嗎？\n\n適合後來又補了大頭照、或上次失敗的時候。已經找到的照片與社友按過的「是／不是」都會保留。')) return;
    await mpjCall('photo_desk_job_rerun', { id: j.id }, function (r) { return r.started ? '已重新開始比對。' : '已排入，但運算程式暫時啟動不了。'; });
}
async function mpjDelete(i) {
    var j = mpjJob(i); if (!j) return;
    if (!confirm('要刪除「' + j.title + '」嗎？\n\n比對結果會一起刪掉，社友在 LINE 就看不到這個活動的照片了。攝影師雲端硬碟裡的照片不受影響。')) return;
    await mpjCall('photo_desk_job_delete', { id: j.id }, '已刪除。');
}
async function mpjSend(i) {
    var j = mpjJob(i); if (!j) return;
    var pv = await mpjCall('photo_desk_job_preview', { id: j.id });
    if (!pv) return;
    var mo = pv.maybeOnly ? '有 ' + pv.maybeOnly + ' 人只有「不太確定」的照片，依規定不通知。' : '';
    if (!pv.targets) { mpjSay('沒有需要通知的人。' + (pv.already ? '已通知過 ' + pv.already + ' 人。' : '') + mo + (pv.unbound.length ? '有 ' + pv.unbound.length + ' 人沒有綁定 LINE，收不到：' + pv.unbound.slice(0, 10).map(function (x) { return x.name; }).join('、') : ''), !pv.already && !pv.maybeOnly); mpjRefresh(); return; }
    var un = pv.unbound.length ? '\n\n有 ' + pv.unbound.length + ' 人有照片但沒有綁定 LINE（本人與家人都沒綁），收不到：\n' + pv.unbound.slice(0, 15).map(function (x) { return '・' + x.name; }).join('\n') : '';
    if (!confirm('要發送「' + j.title + '」的照片通知嗎？\n\n會用 LINE 通知 ' + pv.targets + ' 人（每人一則，會使用官方帳號的推播額度）。' + (pv.already ? '\n已通知過的 ' + pv.already + ' 人不會重複收到。' : '') + (pv.maybeOnly ? '\n另有 ' + pv.maybeOnly + ' 人只有「不太確定」的照片，不會通知。' : '') + un)) return;
    await mpjCall('photo_desk_job_send', { id: j.id, liffId: typeof LINE_LIFF_ID === 'string' ? LINE_LIFF_ID : '' }, function (r) { return '已發送 ' + r.sent + ' 人' + (r.failed ? '，失敗 ' + r.failed + ' 人' : '') + '。'; });
}
