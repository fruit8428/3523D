// 活動照片找人・社友在 LINE 看自己的活動照片（line.html?p=photos，畫面 #viewPhotos）。
//   - 只看得到自己、以及沒綁 LINE 的寶尊眷的照片（雲端用 LINE 驗證過的身分把關）。
//   - 程式「確定」的直接列出；「不太確定」的列在「這幾張是您嗎？」，由本人按是／不是（旁邊放那張臉的特寫，比較好認）。
//   - 照片留在攝影師的 Google 雲端硬碟：這裡只拿到檔案代號，用 Google 的網址顯示縮圖、大圖與下載原圖。
//     攝影師若關閉分享，圖片會顯示不出來（畫面會提示）。
//   - 不存任何東西到 localStorage。全域名稱以 myp 開頭；用到 line.html 的 api()、show()、toast()、E()、binding。
var myp = null;               // 雲端回傳的 { enabled, jobs:[{id,title,at,people:[{key,name,me,photos:[{id,file,name}],ask:[{id,file,name,face}]}]}] }
var mypBusy = false;
var mypView = null;           // 放大檢視中：{ j, p, i }
function mypOk(file) { return /^[A-Za-z0-9_-]{10,80}$/.test(String(file || '')); }
function mypThumb(file, w) { return mypOk(file) ? 'https://drive.google.com/thumbnail?id=' + file + '&sz=w' + w : ''; }
function mypDownloadUrl(file) { return mypOk(file) ? 'https://drive.google.com/uc?export=download&id=' + file : ''; }
function mypDate(ts) { try { return new Date(ts).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric' }); } catch (e) { return ''; } }
function mypBroken(img) { var d = document.createElement('div'); d.className = 'w-full h-full flex items-center justify-center text-[11px] text-slate-400 text-center p-1 bg-slate-100'; d.textContent = '照片無法顯示'; if (img.parentNode) img.parentNode.replaceChild(d, img); }

async function photosStart() {
    document.getElementById('hdTitle').textContent = '我的活動照片';
    if (typeof renderIdCard === 'function') renderIdCard();
    var box = document.getElementById('viewPhotos');
    box.innerHTML = '<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center text-slate-500">讀取中…</div>';
    show('viewPhotos');
    var r = await api('photo_my');
    if (!r.ok) {
        if (r.code === 'NOT_BOUND') { binding = null; showBind('請先綁定身分，才能看您的活動照片。'); return; }
        box.innerHTML = '<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center"><div class="font-black text-lg">暫時無法使用</div><p class="text-slate-600 mt-2">' + E(r.code === 'NETWORK' ? '網路連線不穩，請再試一次。' : '系統忙碌中，請稍後再試。') + '</p><button type="button" onclick="photosStart()" class="mt-4 w-full border border-slate-300 font-bold rounded-xl py-3">重新整理</button></div>';
        return;
    }
    myp = r;
    // 從通知卡片點進來時，把那個活動排在最前面
    var want = ''; try { want = new URLSearchParams(location.search).get('job') || ''; } catch (e) { want = ''; }
    if (want) myp.jobs.sort(function (a, b) { return (b.id === want) - (a.id === want); });
    mypRender();
}
function mypRender() {
    var box = document.getElementById('viewPhotos');
    if (!myp.enabled) { box.innerHTML = '<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center"><div class="text-4xl">📷</div><div class="font-black text-lg mt-2">尚未開放</div><p class="text-slate-600 mt-2 leading-relaxed">貴社目前還沒有開放「活動照片」功能。</p></div>'; return; }
    var jobs = myp.jobs.filter(function (j) { return j.people.some(function (p) { return p.photos.length || p.ask.length; }); });
    if (!jobs.length) { box.innerHTML = '<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center"><div class="text-4xl">📷</div><div class="font-black text-lg mt-2">目前還沒有您的活動照片</div><p class="text-slate-600 mt-2 leading-relaxed">活動結束、照片比對完成後，會用 LINE 通知您。<br>要讓系統找得到您，請先把大頭照傳給貴社執秘。</p></div>'; return; }
    box.innerHTML = jobs.map(function (job) {
        var j = myp.jobs.indexOf(job);
        return '<div class="myp-job bg-white rounded-2xl border border-slate-200 shadow-sm p-4 mb-4"><div class="font-black text-lg leading-tight">' + E(job.title) + '</div><div class="text-xs text-slate-500">' + E(mypDate(job.at)) + '</div>'
            + job.people.map(function (p, pi) {
                if (!p.photos.length && !p.ask.length) return '';
                var who = p.me ? '您' : p.name;
                return '<div class="mt-4">'
                    + (p.photos.length ? '<div class="font-bold text-slate-800">' + E(p.me ? '您的照片' : p.name + ' 的照片') + '<span class="ml-1 text-sm font-normal text-slate-500">（' + p.photos.length + ' 張，點一下可以放大、下載）</span></div>'
                        + '<div class="grid grid-cols-3 gap-1.5 mt-2">' + p.photos.map(function (ph, i) {
                            return '<button type="button" onclick="mypOpen(' + j + ',' + pi + ',' + i + ')" class="myp-thumb aspect-square rounded-lg overflow-hidden bg-slate-100 border border-slate-200">' + (mypOk(ph.file) ? '<img loading="lazy" src="' + mypThumb(ph.file, 400) + '" alt="" class="w-full h-full object-cover" onerror="mypBroken(this)">' : '') + '</button>';
                        }).join('') + '</div>' : '')
                    + (p.ask.length ? '<div class="myp-ask mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3"><div class="font-bold text-amber-900">這幾張是' + E(who) + '嗎？<span class="ml-1 text-sm font-normal">（' + p.ask.length + ' 張，系統不太確定）</span></div>'
                        + p.ask.map(function (a, i) {
                            return '<div class="myp-askrow flex items-center gap-2 mt-2 bg-white border border-amber-100 rounded-lg p-2">'
                                + '<div class="myp-crop relative w-20 h-20 shrink-0 rounded-lg overflow-hidden bg-slate-100 border border-slate-200" data-face="' + (a.face ? [a.face.x, a.face.y, a.face.w, a.face.h].join(',') : '') + '">' + (mypOk(a.file) ? '<img src="' + mypThumb(a.file, 1600) + '" alt="臉部特寫" class="absolute max-w-none" style="opacity:0" onload="mypCrop(this)" onerror="mypBroken(this)">' : '') + '</div>'
                                + '<button type="button" onclick="mypOpenAsk(' + j + ',' + pi + ',' + i + ')" class="w-20 h-20 shrink-0 rounded-lg overflow-hidden bg-slate-100 border border-slate-200">' + (mypOk(a.file) ? '<img loading="lazy" src="' + mypThumb(a.file, 400) + '" alt="整張照片" class="w-full h-full object-cover" onerror="mypBroken(this)">' : '') + '</button>'
                                + '<div class="flex-1 flex flex-col gap-1.5"><button type="button" onclick="mypAnswer(' + j + ',' + pi + ',' + i + ',true)" class="myp-yes bg-emerald-600 active:bg-emerald-700 text-white font-bold rounded-lg py-2 text-sm">是' + E(p.me ? '我' : '') + '</button>'
                                + '<button type="button" onclick="mypAnswer(' + j + ',' + pi + ',' + i + ',false)" class="myp-no border border-slate-300 text-slate-700 font-bold rounded-lg py-2 text-sm">不是</button></div></div>';
                        }).join('') + '<div class="text-xs text-amber-800 mt-2">左邊是那張臉的特寫，右邊是整張照片（點一下可放大）。</div></div>' : '')
                    + '</div>';
            }).join('') + '</div>';
    }).join('') + '<p class="text-xs text-slate-500 text-center leading-relaxed">照片由攝影師提供，請僅供個人留存。<br>有照片不是您本人時，點開照片按「不是我」即可移除。</p>';
}
// 把整張照片移到剛好只露出那張臉（face 是臉佔整張圖的比例）；沒有位置資料就顯示整張
function mypCrop(img) {
    var box = img.parentNode, f = (box.getAttribute('data-face') || '').split(',').map(Number), size = box.clientWidth || 80;
    var W = img.naturalWidth, H = img.naturalHeight;
    if (f.length !== 4 || !(f[2] > 0) || !(f[3] > 0) || !W || !H) { img.style.cssText = 'opacity:1;width:100%;height:100%;object-fit:cover;position:static'; return; }
    var side = Math.max(f[2] * W, f[3] * H) * 1.9;                  // 臉的四周多留一些，連頭髮、肩膀一起看比較好認
    var cx = (f[0] + f[2] / 2) * W, cy = (f[1] + f[3] / 2) * H, k = size / side;
    img.style.width = (W * k) + 'px'; img.style.height = (H * k) + 'px';
    img.style.left = (size / 2 - cx * k) + 'px'; img.style.top = (size / 2 - cy * k) + 'px';
    img.style.opacity = '1';
}
async function mypAnswer(j, pi, i, yes) {
    var p = myp && myp.jobs[j] && myp.jobs[j].people[pi], a = p && p.ask[i];
    if (!a || mypBusy) return;
    mypBusy = true; var r = await api('photo_my_answer', { id: a.id, yes: yes }); mypBusy = false;
    if (!r.ok) { toast(r.code === 'NETWORK' ? '網路連線不穩，請再按一次。' : '沒有成功，請重新整理後再試。'); return; }
    p.ask.splice(i, 1);
    if (yes) p.photos.push({ id: a.id, file: a.file, name: a.name });
    mypRender();
    toast(yes ? '已加入' + (p.me ? '您' : p.name) + '的照片' : '好的，已移除');
}

// ---------- 放大檢視（上一張／下一張、下載原圖、不是我） ----------
function mypOverlay() {
    var ov = document.getElementById('mypViewer');
    if (!ov) { ov = document.createElement('div'); ov.id = 'mypViewer'; ov.className = 'fixed inset-0 z-[80] bg-black flex flex-col'; document.body.appendChild(ov); }
    return ov;
}
function mypOpen(j, pi, i) { mypView = { j: j, p: pi, i: i, ask: false }; mypShow(); }
function mypOpenAsk(j, pi, i) { mypView = { j: j, p: pi, i: i, ask: true }; mypShow(); }
function mypShow() {
    var v = mypView, p = myp.jobs[v.j].people[v.p], list = v.ask ? p.ask : p.photos, ph = list[v.i];
    if (!ph) { mypCloseView(); return; }
    var ov = mypOverlay(); ov.classList.remove('hidden');
    ov.innerHTML = '<div class="flex items-center justify-between gap-2 px-3 py-2 text-white">'
        + '<button type="button" onclick="mypCloseView()" class="font-bold px-3 py-2">✕ 關閉</button>'
        + '<span class="text-sm opacity-80">' + (v.i + 1) + '／' + list.length + '</span>'
        + '<button type="button" onclick="mypDownload()" class="myp-dl bg-white text-slate-900 font-bold rounded-lg px-3 py-2 text-sm">⬇️ 下載原圖</button></div>'
        + '<div class="flex-1 min-h-0 flex items-center justify-center relative">'
        + '<img id="mypBig" src="' + mypThumb(ph.file, 1600) + '" alt="" class="max-w-full max-h-full object-contain" onerror="mypBroken(this)">'
        + (v.i > 0 ? '<button type="button" onclick="mypStep(-1)" class="absolute left-1 top-1/2 -translate-y-1/2 bg-black/50 text-white text-2xl rounded-full w-11 h-11">‹</button>' : '')
        + (v.i < list.length - 1 ? '<button type="button" onclick="mypStep(1)" class="absolute right-1 top-1/2 -translate-y-1/2 bg-black/50 text-white text-2xl rounded-full w-11 h-11">›</button>' : '')
        + '</div>'
        + (v.ask ? '' : '<div class="px-3 py-3 text-center"><button type="button" onclick="mypNotMe()" class="myp-notme text-sm text-white/80 underline">這張不是' + E(p.me ? '我' : p.name) + '</button></div>');
}
function mypStep(d) { mypView.i += d; mypShow(); }
function mypCloseView() { var ov = document.getElementById('mypViewer'); if (ov) { ov.classList.add('hidden'); ov.innerHTML = ''; } mypView = null; }
function mypDownload() {
    var v = mypView, p = myp.jobs[v.j].people[v.p], ph = (v.ask ? p.ask : p.photos)[v.i], url = ph ? mypDownloadUrl(ph.file) : '';
    if (!url) return;
    // 在 LINE 裡要用外部瀏覽器開，才下載得了
    try { if (window.liff && liff.isInClient && liff.isInClient() && liff.openWindow) { liff.openWindow({ url: url, external: true }); return; } } catch (e) { /* 改用一般方式 */ }
    window.open(url, '_blank');
}
async function mypNotMe() {
    var v = mypView, p = myp.jobs[v.j].people[v.p], ph = p.photos[v.i];
    if (!ph || mypBusy) return;
    if (!confirm('確定這張不是' + (p.me ? '您' : p.name) + '嗎？\n\n確定後會從' + (p.me ? '您' : '他') + '的照片移除。')) return;
    mypBusy = true; var r = await api('photo_my_answer', { id: ph.id, yes: false }); mypBusy = false;
    if (!r.ok) { toast(r.code === 'NETWORK' ? '網路連線不穩，請再按一次。' : '沒有成功，請重新整理後再試。'); return; }
    p.photos.splice(v.i, 1);
    mypCloseView(); mypRender(); toast('好的，已移除');
}
