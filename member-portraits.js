// 活動照片找人・第一步：社友大頭照。line.html（社友自己上傳）與 index.html（執秘的名單）共用這個檔案。
//   - 大頭照是敏感個資：只經過雲端小程式 line-checkin，存在不公開的儲存空間；絕不寫進 app_storage／localStorage，
//     這個檔案的任何操作都不呼叫 saveToStorage()。
//   - 社友（LINE）：全域名稱 lp*，畫面在 line.html 的 #viewPhoto。看得到自己的照片（10 分鐘有效的簽名網址）。
//   - 執秘（報名系統）：全域名稱 mp*，視窗 #memberPortraitOverlay 動態建立。只看得到「誰有、誰還沒有」，看不到照片。
//   - 開放與否：地區設定檔 photoEnabled（畫面）＋行事曆後台「⑦ 活動照片找人」逐社開放（雲端把關），預設全部關閉。
var PORTRAIT_SIDE = 1600;          // 上傳前先縮到最長邊 1600（之後人臉比對用，太小會不準）
var PORTRAIT_MIN_SIDE = 300;
var PORTRAIT_ERR = {
    PHOTO_CLUB_OFF: '貴社尚未開放這個功能，請洽地區系統管理者。',
    PHOTO_TABLE_MISSING: '雲端尚未建立大頭照的資料表，請系統管理者執行 supabase/sql/member_portraits.sql。',
    PHOTO_NO_CONSENT: '請先勾選同意，才能上傳。',
    PHOTO_TOO_MANY: '已經有 3 張了。請先刪除一張，再上傳新的。',
    PHOTO_TOO_LARGE: '這張照片太大，請換一張再試。',
    PHOTO_BAD_IMAGE: '這張照片無法讀取，請換一張（建議用手機直接拍，或選 JPG 照片）。',
    PHOTO_NOT_FOUND: '找不到這張照片，可能已經刪除了。',
    MEMBER_NOT_FOUND: '社友庫裡找不到這個人，請重新整理後再試。',
    CLUB_AUTH_FAILED: '無法確認貴社身分。貴社若還沒有設定登入密碼，請先完成首次登入設定後再試。',
    NOT_BOUND: '您還沒有綁定身分。',
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

// ======================= 社友（LINE）：我的大頭照 =======================
var lp = null;                // 雲端回傳的 { enabled, max, photos:[{id,url,at,by}] }
var lpConsent = false;        // 這次開啟期間是否已勾選同意
var lpBusy = false;
async function photoStart() {
    document.getElementById('hdTitle').textContent = '我的大頭照';
    if (typeof renderIdCard === 'function') renderIdCard();
    var box = document.getElementById('viewPhoto');
    box.innerHTML = '<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center text-slate-500">讀取中…</div>';
    show('viewPhoto');
    var r = await api('photo_me');
    if (!r.ok) {
        if (r.code === 'NOT_BOUND') { binding = null; showBind('請先綁定身分，才能上傳大頭照。'); return; }
        box.innerHTML = '<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center"><div class="font-black text-lg">暫時無法使用</div><p class="text-slate-600 mt-2">' + portraitE(portraitErr(r.code)) + '</p><button type="button" onclick="photoStart()" class="mt-4 w-full border border-slate-300 font-bold rounded-xl py-3">重新整理</button></div>';
        return;
    }
    lp = r; lpRender();
}
function lpRender() {
    var box = document.getElementById('viewPhoto'), n = lp.photos.length, html = '';
    html += '<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">'
        + '<div class="font-black text-lg">📷 我的大頭照</div>'
        + '<p class="text-sm text-slate-600 mt-1 leading-relaxed">活動結束後，系統會用您的大頭照，從攝影師拍的活動照片裡找出有您的照片，再用 LINE 通知您。</p>';
    if (n) {
        html += '<div class="grid grid-cols-3 gap-2 mt-4">' + lp.photos.map(function (p, i) {
            return '<div class="text-center"><div class="aspect-square rounded-xl overflow-hidden bg-slate-100 border border-slate-200">'
                + (p.url ? '<img src="' + portraitE(p.url) + '" alt="大頭照 ' + (i + 1) + '" class="w-full h-full object-cover">' : '')
                + '</div><div class="text-xs text-slate-500 mt-1">' + portraitE(portraitDate(p.at)) + (p.by === 'proxy' ? '<br><span class="text-amber-700 font-bold">執秘代傳</span>' : '') + '</div>'
                + '<button type="button" onclick="lpDelete(' + i + ')" class="mt-1 text-xs font-bold text-rose-700 border border-rose-200 rounded-lg px-3 py-1.5">刪除</button></div>';
        }).join('') + '</div>';
    } else {
        html += '<div class="mt-4 text-center text-slate-500 bg-slate-50 border border-dashed border-slate-300 rounded-xl py-6">還沒有上傳大頭照</div>';
    }
    html += '</div>';
    if (!lp.enabled) {
        html += '<div class="mt-3 bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-900 leading-relaxed">貴社目前<b>尚未開放</b>這個功能，暫時不能上傳。' + (n ? '已上傳的照片您仍然可以刪除。' : '') + '</div>';
    } else if (n >= lp.max) {
        html += '<div class="mt-3 bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm text-slate-600">最多 ' + lp.max + ' 張。要換照片請先刪除一張。</div>';
    } else {
        html += '<div class="mt-3 bg-white rounded-2xl border border-slate-200 shadow-sm p-5">'
            + '<div class="font-bold">' + (n ? '再加一張' : '上傳大頭照') + '<span class="ml-2 text-xs font-normal text-slate-500">（最多 ' + lp.max + ' 張）</span></div>'
            + '<p class="text-sm text-slate-600 mt-1 leading-relaxed">' + PORTRAIT_TIPS + '</p>'
            + '<label class="flex items-start gap-3 mt-3 bg-blue-50 border border-blue-200 rounded-xl p-3"><input type="checkbox" id="lpAgree" class="w-6 h-6 mt-0.5 shrink-0"' + (lpConsent ? ' checked' : '') + ' onchange="lpConsent=this.checked">'
            + '<span class="text-sm leading-relaxed">我同意提供大頭照，<b>只用來比對扶輪活動照片、找出有我的照片</b>。大頭照不會公開，我可以隨時在這裡更換或刪除；刪除後就不再比對。</span></label>'
            + '<input type="file" id="lpFile" accept="image/*" class="hidden" onchange="lpPicked(this)">'
            + '<button type="button" id="lpBtn" onclick="lpPick()" class="mt-3 w-full bg-blue-600 active:bg-blue-700 text-white font-black text-lg rounded-xl py-4 shadow">選擇照片</button>'
            + '<div id="lpMsg" class="hidden mt-3 text-sm font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2"></div></div>';
    }
    if (n) html += '<button type="button" onclick="lpDeleteAll()" class="mt-4 w-full text-sm font-bold text-slate-500 border border-slate-300 rounded-xl py-3">全部刪除（不再比對我的照片）</button>';
    box.innerHTML = html;
}
function lpSay(text) { var m = document.getElementById('lpMsg'); if (!m) { if (text) toast(text); return; } m.textContent = text || ''; m.classList.toggle('hidden', !text); }
function lpPick() {
    if (lpBusy) return;
    if (!lpConsent) { lpSay(PORTRAIT_ERR.PHOTO_NO_CONSENT); return; }
    lpSay(''); document.getElementById('lpFile').click();
}
async function lpPicked(input) {
    var file = input.files && input.files[0];
    input.value = '';
    if (!file || lpBusy) return;
    var btn = document.getElementById('lpBtn');
    lpBusy = true; if (btn) { btn.disabled = true; btn.textContent = '處理中…'; }
    var data = null;
    try { data = await portraitPrepare(file); } catch (e) { lpSay(portraitPrepareErr(e)); }
    if (data) {
        if (btn) btn.textContent = '上傳中…';
        var r = await api('photo_me_upload', { image: data, consent: true });
        if (r.ok) { lp = r; lpBusy = false; lpRender(); toast('上傳完成'); return; }
        lpSay(portraitErr(r.code));
    }
    lpBusy = false; if (btn) { btn.disabled = false; btn.textContent = '選擇照片'; }
}
async function lpDelete(i) {
    var p = lp && lp.photos[i];
    if (!p || lpBusy) return;
    if (!confirm('要刪除這張大頭照嗎？')) return;
    lpBusy = true; var r = await api('photo_me_delete', { id: p.id }); lpBusy = false;
    if (!r.ok && r.code !== 'PHOTO_NOT_FOUND') { toast(portraitErr(r.code)); return; }
    if (r.ok) { lp = r; lpRender(); toast('已刪除'); } else photoStart();
}
async function lpDeleteAll() {
    if (lpBusy || !lp) return;
    if (!confirm('要刪除全部的大頭照嗎？\n\n刪除後，系統就不會再用您的臉比對活動照片。之後想再用，重新上傳即可。')) return;
    lpBusy = true; var r = await api('photo_me_delete', { all: true }); lpBusy = false;
    if (!r.ok) { toast(portraitErr(r.code)); return; }
    lp = r; lpConsent = false; lpRender(); toast('已全部刪除');
}

// ======================= 執秘（報名系統）：大頭照名單 =======================
var mpBtnState = { club: '', enabled: false, at: 0 };
var mp = null;                // 開著的視窗：{ club, people:{key:{count,self,at}}, bound:{key:true}, max, target, busy, msg }
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
}
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
    mp = { club: club, people: {}, bound: {}, max: 3, target: '', busy: false, msg: '', bad: false, loaded: false };
    ov.classList.remove('hidden');
    mpRender();
    var r = await lineBindingsApi('photo_desk_list');
    if (!mp || mp.club !== club) return;
    if (!r.ok) { mp.msg = portraitErr(r.code); mp.bad = true; mpRender(); return; }
    mp.loaded = true; mpApply(r); mpRender();
}
function mpClose() { var ov = document.getElementById('memberPortraitOverlay'); if (ov) ov.classList.add('hidden'); mp = null; }
function mpLiffUrl() { return typeof LINE_LIFF_ID === 'string' && LINE_LIFF_ID ? 'https://liff.line.me/' + LINE_LIFF_ID + '?p=photo' : ''; }
function mpCopyLink() {
    var url = mpLiffUrl(); if (!url) return;
    var text = '請用 LINE 點開下面的連結，上傳您的大頭照（正面、臉清楚、只有本人）。活動結束後，系統會幫您找出有您的活動照片：\n' + url;
    var done = function () { if (mp) { mp.msg = '已複製，可以貼到貴社的 LINE 群組。'; mp.bad = false; mpRender(); } };
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
    var url = mpLiffUrl();
    var row = function (m, i) {
        var k = mpKey(m), p = mp.people[k], spouse = !!m.spouseOfId;
        var status = p
            ? '<span class="font-bold text-emerald-700">✅ ' + p.count + ' 張</span><span class="ml-1 text-xs text-slate-500">' + E(portraitDate(p.at)) + (p.self === p.count ? '・本人上傳' : p.self ? '・本人＋執秘代傳' : '・執秘代傳') + '</span>'
            : '<span class="text-slate-400">尚未上傳</span>';
        return '<tr class="border-b border-slate-100' + (spouse ? ' bg-slate-50/60' : '') + '"><td class="py-2 pl-3 pr-2"><span class="font-bold">' + (spouse ? '└ ' : '') + E(m.name) + '</span>' + (m.nickname ? '<span class="ml-1.5 text-sm text-slate-500">' + E(m.nickname) + '</span>' : '')
            + (mp.bound[k] ? '<span class="ml-1.5 text-[11px] text-green-700 bg-green-50 border border-green-200 rounded px-1">已綁 LINE</span>' : '') + '</td>'
            + '<td class="py-2 px-2 text-sm">' + status + '</td>'
            + '<td class="py-2 pl-2 pr-3 text-right whitespace-nowrap">'
            + (!p || p.count < mp.max ? '<button type="button" onclick="mpPick(' + i + ')" class="mp-up text-xs font-bold text-blue-800 border border-blue-300 bg-blue-50 hover:bg-blue-100 rounded-lg px-2.5 py-1.5">代為上傳</button>' : '')
            + (p ? '<button type="button" onclick="mpDelete(' + i + ')" class="mp-del ml-1 text-xs font-bold text-rose-700 border border-rose-200 hover:bg-rose-50 rounded-lg px-2.5 py-1.5">刪除</button>' : '') + '</td></tr>';
    };
    ov.innerHTML = '<div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-2">'
        + '<div class="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200"><div><div class="font-black text-lg">📷 ' + E(mp.club) + ' 大頭照</div>'
        + '<div class="text-sm text-slate-600 mt-0.5">活動結束後，系統會用大頭照找出每位社友的活動照片。這裡只顯示誰已經上傳，<b>不顯示照片本身</b>。</div></div>'
        + '<button type="button" onclick="mpClose()" class="shrink-0 text-slate-500 hover:text-slate-800 text-2xl leading-none px-2">×</button></div>'
        + '<div class="px-5 py-4">'
        + (mp.msg ? '<div id="mpMsg" class="mb-3 text-sm font-bold rounded-lg px-3 py-2 ' + (mp.bad ? 'text-rose-700 bg-rose-50 border border-rose-200' : 'text-emerald-800 bg-emerald-50 border border-emerald-200') + '">' + E(mp.msg) + '</div>' : '')
        + (!mp.loaded ? (mp.msg ? '' : '<div class="text-slate-500 py-8 text-center">讀取中…</div>')
            : '<div class="flex flex-wrap items-center justify-between gap-2"><div id="mpSummary" class="font-bold">已有大頭照：<span class="text-emerald-700">' + have + '</span>／' + members.length + ' 人</div>'
            + (url ? '<button type="button" onclick="mpCopyLink()" class="text-sm font-bold text-green-800 border border-green-300 bg-green-50 hover:bg-green-100 rounded-lg px-3 py-1.5">📋 複製「請社友自己上傳」的 LINE 訊息</button>' : '') + '</div>'
            + '<p class="text-xs text-slate-500 mt-1.5 leading-relaxed">建議請社友自己用 LINE 上傳（本人按同意）。不方便操作的社友，可以在取得本人同意後由您代為上傳；他若有綁 LINE 會收到通知，並可自行更換或刪除。' + PORTRAIT_TIPS + '</p>'
            + '<input type="file" id="mpFile" accept="image/*" class="hidden" onchange="mpPicked(this)">'
            + '<div class="mt-3 border border-slate-200 rounded-xl overflow-hidden"><table class="w-full"><tbody id="mpRows">' + (members.length ? members.map(row).join('') : '<tr><td class="py-6 text-center text-slate-500">社友庫還沒有名單。</td></tr>') + '</tbody></table></div>'
            + (orphans.length ? '<div class="mt-4 text-sm font-bold text-amber-800">已不在社友庫的人（' + orphans.length + '）</div><p class="text-xs text-slate-500 mt-0.5">這些人已經從社友庫移除（或改了名字），大頭照還留著。確定不需要請刪除。</p><div class="mt-2 border border-amber-200 rounded-xl divide-y divide-amber-100">'
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
    var file = input.files && input.files[0];
    input.value = '';
    if (!file || !mp || mp.busy || !mp.target) return;
    var club = mp.club, key = mp.target, name = key.split('|')[0];
    if (!confirm('要幫「' + name + '」上傳這張大頭照嗎？\n\n請確認：您已經取得「' + name + '」本人同意，用這張照片比對扶輪活動照片。\n\n按「確定」＝已取得本人同意並上傳。他若有綁定 LINE 會收到通知。')) return;
    mp.busy = true; mp.msg = '處理中，請稍候…'; mp.bad = false; mpRender();
    var data = null, r = null;
    try { data = await portraitPrepare(file); } catch (e) { r = { ok: false, text: portraitPrepareErr(e) }; }
    if (data) r = await lineBindingsApi('photo_desk_upload', { personKey: key, image: data, consent: true });
    if (!mp || mp.club !== club) return;
    mp.busy = false;
    if (!r.ok) { mp.msg = r.text || portraitErr(r.code); mp.bad = true; mpRender(); return; }
    mpApply(r);
    mp.msg = '已幫「' + name + '」上傳。' + (r.notified ? '已用 LINE 通知本人。' : (mp.bound[key] ? '' : '（他還沒有綁定 LINE，所以沒有通知；請當面告知。）'));
    mp.bad = false; mpRender();
}
async function mpDelete(i) {
    if (!mp || mp.busy) return;
    var club = mp.club, key = (window.__mpKeys || [])[i] || '', name = key.split('|')[0];
    if (!key || !confirm('要刪除「' + name + '」全部的大頭照嗎？\n\n刪除後，系統就不會再比對他的活動照片。')) return;
    mp.busy = true;
    var r = await lineBindingsApi('photo_desk_delete', { personKey: key });
    if (!mp || mp.club !== club) return;
    mp.busy = false;
    if (!r.ok) { mp.msg = portraitErr(r.code); mp.bad = true; mpRender(); return; }
    mpApply(r); mp.msg = '已刪除「' + name + '」的大頭照。'; mp.bad = false; mpRender();
}
// 從社友庫刪除社友時順便刪掉他的大頭照（只在這個社有開放時才連網；失敗不影響刪除社友，名單裡的「已不在社友庫」可以補刪）
function mpForgetMember(club, member) {
    if (!member || mpBtnState.club !== club || !mpBtnState.enabled || typeof lineBindingsApi !== 'function') return;
    try { lineBindingsApi('photo_desk_delete', { personKey: mpKey(member) }); } catch (e) { /* 忽略 */ }
}
