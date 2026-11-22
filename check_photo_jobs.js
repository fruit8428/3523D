// 活動照片找人・第二、三步的畫面：① 社友在 LINE 的「我的活動照片」（my-photos.js）② 執秘在報名系統的「② 活動照片」分頁。
// 需先啟動 8000 埠：python3 -m http.server 8000。雲端小程式與 Google 雲端硬碟的圖片都用假的回應；寫入 Supabase 的請求都擋下。
const puppeteer = require('puppeteer');
const fs = require('fs');
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const ok = (n, c) => { console.log((c ? '✅ ' : '❌ ') + n); if (!c) process.exitCode = 1; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // 假的「攝影師照片」：1000×800
  const gen = await b.newPage();
  const IMG = Buffer.from((await gen.evaluate(() => { const c = document.createElement('canvas'); c.width = 1000; c.height = 800; const g = c.getContext('2d'); g.fillStyle = '#89a'; g.fillRect(0, 0, 1000, 800); g.fillStyle = '#fc9'; g.fillRect(400, 160, 100, 80); return c.toDataURL('image/jpeg', 0.8); })).split(',')[1], 'base64');
  await gen.close();

  // ============ ① LINE：我的活動照片 ============
  {
    const src = fs.readFileSync(__dirname + '/my-photos.js', 'utf8');
    const html = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><body>
<h1 id=hdTitle></h1><div id=viewBind class=hidden></div><main><div id=viewPhotos class=hidden></div></main>
<style>.hidden{display:none!important}.relative{position:relative}.absolute{position:absolute}.w-20{width:80px}.h-20{height:80px}.max-w-none{max-width:none}.overflow-hidden{overflow:hidden}</style>
<script>
const E=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function show(id){['viewBind','viewPhotos'].forEach(v=>document.getElementById(v).classList.toggle('hidden',v!==id));}
function toast(m){window.__toast=m}; function renderIdCard(){}; function showBind(m){window.__bind=m;show('viewBind')}
var binding={name:'王小明',club:'甲社',key:'王小明|Tony'}; window.__calls=[]; window.__opened=[]; window.open=u=>{window.__opened.push(u)};
const F=n=>'file_id_000000'+n;
var S={fail:'',enabled:true,jobs:[
 {id:'j1',title:'十月例會',at:'2026-10-05T03:00:00Z',people:[{key:'王小明|Tony',name:'王小明',me:true,photos:[{id:11,file:F(1),name:'a'}],ask:[]}]},
 {id:'j2',title:'地區年會<b>x</b>',at:'2026-11-19T03:00:00Z',people:[
   {key:'王小明|Tony',name:'王小明',me:true,photos:[{id:1,file:F(2),name:'a'},{id:2,file:F(3),name:'b'},{id:3,file:F(4),name:'c'}],ask:[{id:4,file:F(5),name:'d',face:{x:0.4,y:0.2,w:0.1,h:0.1}},{id:5,file:'壞的代號',name:'e',face:null}]},
   {key:'王太太|',name:'王太太',me:false,photos:[{id:6,file:F(6),name:'f'}],ask:[{id:7,file:F(7),name:'g',face:null}]}]}]};
async function api(a,x){window.__calls.push([a,x]); if(S.fail)return{ok:false,code:S.fail};
  if(a==='photo_my_answer') return {ok:true,id:x.id,status:x.yes?'yes':'no'};
  return JSON.parse(JSON.stringify({ok:true,enabled:S.enabled,jobs:S.jobs})); }
</script><script>${src.replace(/<\/script>/g, '<\\/script>')}</script></body>`;
    const p = await b.newPage(); await p.setViewport({ width: 390, height: 800 });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    const dialogs = []; let accept = true; p.on('dialog', d => { dialogs.push(d.message()); accept ? d.accept() : d.dismiss(); });
    const drive = [];
    await p.setRequestInterception(true);
    p.on('request', r => { const u = r.url();
      if (u.startsWith('https://test.local/')) return r.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
      if (u.includes('drive.google.com')) { drive.push(u); return r.respond({ status: 200, contentType: 'image/jpeg', body: IMG }); }
      r.continue(); });
    await p.goto('https://test.local/line.html?p=photos&job=j2', { waitUntil: 'load' });
    await p.evaluate(() => photosStart()); await wait(600);
    const text = () => p.$eval('#viewPhotos', e => e.innerText);
    let s = await text();
    ok('LINE：標題「我的活動照片」；從通知點進來的活動排在最前面', await p.$eval('#hdTitle', e => e.innerText) === '我的活動照片' && s.indexOf('地區年會') < s.indexOf('十月例會') && s.indexOf('地區年會') >= 0);
    ok('LINE：活動名稱裡的符號不會變成網頁標籤', !(await p.$('#viewPhotos .myp-job b')) && s.includes('地區年會<b>x</b>'));
    ok('LINE：自己的照片 3 張、寶眷另一區 1 張', s.includes('您的照片') && s.includes('（3 張') && s.includes('王太太 的照片') && (await p.$$eval('.myp-job', a => a[0].querySelectorAll('.myp-thumb').length)) === 4);
    ok('LINE：縮圖用 Google 雲端硬碟的檔案代號', drive.some(u => u === 'https://drive.google.com/thumbnail?id=file_id_0000002&sz=w400'));
    ok('LINE：「這幾張是您嗎？」有 2 張，寶眷的問「是王太太嗎」', s.includes('這幾張是您嗎？') && s.includes('這幾張是王太太嗎？') && (await p.$$eval('.myp-job', a => a[0].querySelectorAll('.myp-askrow').length)) === 3);
    const crop = await p.$eval('.myp-crop img', im => ({ w: parseFloat(im.style.width), l: parseFloat(im.style.left), t: parseFloat(im.style.top), o: im.style.opacity }));
    // 臉 100×80（在 1000×800 的圖上），中心 (450, 200)；取邊長 190 的方框縮到 80 → 倍率 0.42105
    ok('LINE：臉部特寫——把照片移到剛好露出那張臉', crop.o === '1' && Math.abs(crop.w - 421.05) < 1 && Math.abs(crop.l - (40 - 450 * 80 / 190)) < 1 && Math.abs(crop.t - (40 - 200 * 80 / 190)) < 1);
    ok('LINE：檔案代號格式不對的不會拿去組網址', !drive.some(u => u.includes('%') || u.includes('壞')));
    await p.evaluate(() => mypAnswer(0, 0, 0, true)); await wait(200);
    s = await text();
    ok('LINE：按「是我」→ 送出代號與 yes，照片歸到「您的照片」（4 張）', await p.evaluate(() => { const c = __calls.find(c => c[0] === 'photo_my_answer'); return c[1].id === 4 && c[1].yes === true; }) && s.includes('（4 張') && await p.evaluate(() => __toast === '已加入您的照片'));
    await p.evaluate(() => mypAnswer(0, 1, 0, false)); await wait(200);
    ok('LINE：幫寶眷按「不是」→ 送出 no，那張不再詢問', await p.evaluate(() => { const c = __calls.filter(c => c[0] === 'photo_my_answer')[1]; return c[1].id === 7 && c[1].yes === false; }) && !(await text()).includes('這幾張是王太太嗎？'));
    await p.evaluate(() => mypOpen(0, 0, 0)); await wait(300);
    ok('LINE：點照片放大（用大圖），顯示第 1／4 張', await p.$eval('#mypBig', e => e.src) === 'https://drive.google.com/thumbnail?id=file_id_0000002&sz=w1600' && (await p.$eval('#mypViewer', e => e.innerText)).includes('1／4'));
    await p.evaluate(() => mypStep(1)); await wait(100);
    await p.click('.myp-dl');
    ok('LINE：下一張；電腦上按「下載原圖」＝直接下載原始檔', (await p.$eval('#mypViewer', e => e.innerText)).includes('2／4') && await p.evaluate(() => __opened[0] === 'https://drive.google.com/uc?export=download&id=file_id_0000003'));
    // 手機：先把原圖載入到畫面上，再請社友長按儲存
    await p.evaluate(() => { window.mypIsMobile = () => true; mypShow(); }); await wait(200);
    ok('LINE（手機）：放大時先顯示 1600 的圖，按鈕是「載入原圖」', await p.$eval('#mypBig', e => e.src.endsWith('sz=w1600')) && (await p.$eval('.myp-dl', e => e.innerText)).includes('載入原圖'));
    const nOpen = await p.evaluate(() => __opened.length);
    await p.click('.myp-dl'); await p.waitForFunction(() => /已載入原圖/.test(document.getElementById('mypHint').innerText), { timeout: 8000 }).catch(() => {});
    ok('LINE（手機）：按了之後畫面換成原圖（sz=s0），並提示長按儲存；不會另開下載', await p.$eval('#mypBig', e => e.src === 'https://drive.google.com/thumbnail?id=file_id_0000003&sz=s0') && (await p.$eval('#mypHint', e => e.innerText)).includes('長按照片') && (await p.$eval('#mypHint', e => e.innerText)).includes('1000×800') && (await p.$eval('.myp-dl', e => e.innerText)).includes('已是原圖') && await p.evaluate(n => __opened.length === n, nOpen));
    await p.evaluate(() => mypOpenOutside());
    ok('LINE（手機）：長按沒反應時可以改用瀏覽器開啟原圖', await p.evaluate(() => __opened[__opened.length - 1] === 'https://drive.google.com/thumbnail?id=file_id_0000003&sz=s0'));
    await p.evaluate(() => { window.mypIsMobile = () => false; mypShow(); }); await wait(200);
    accept = false; await p.click('.myp-notme'); await wait(200); accept = true;
    const nAns = await p.evaluate(() => __calls.filter(c => c[0] === 'photo_my_answer').length);
    await p.click('.myp-notme'); await wait(300);
    ok('LINE：「這張不是我」要先確認；確認後移除（剩 3 張）並關閉放大', dialogs.some(d => d.includes('確定這張不是您嗎')) && nAns === 2 && await p.evaluate(() => { const c = __calls.filter(c => c[0] === 'photo_my_answer')[2]; return c[1].id === 2 && c[1].yes === false; }) && (await text()).includes('（3 張') && await p.$eval('#mypViewer', e => e.classList.contains('hidden')));
    await p.evaluate(() => { S.jobs = []; return photosStart(); }); await wait(200);
    ok('LINE：沒有照片時說明「比對完成後會通知」與「大頭照傳給執秘」', (await text()).includes('目前還沒有您的活動照片') && (await text()).includes('把大頭照傳給貴社執秘'));
    await p.evaluate(() => { S.enabled = false; return photosStart(); }); await wait(200);
    ok('LINE：社沒開放時顯示尚未開放', (await text()).includes('尚未開放'));
    await p.evaluate(() => { S.fail = 'NOT_BOUND'; return photosStart(); }); await wait(200);
    ok('LINE：沒綁定身分＝先帶去綁定', await p.evaluate(() => /請先綁定身分/.test(window.__bind || '')));
    await p.evaluate(() => { S.fail = 'SERVER_ERROR'; return photosStart(); }); await wait(200);
    ok('LINE：雲端出錯時有提示與重新整理', (await text()).includes('暫時無法使用') && (await text()).includes('重新整理'));
    ok('LINE：沒有用到 localStorage；沒有程式錯誤', await p.evaluate(() => Object.keys(localStorage).length === 0) && errs.length === 0); if (errs.length) console.log(errs);
    await p.close();
  }

  // ============ ② 報名系統：執秘的「活動照片」分頁 ============
  {
    const p = await b.newPage(); await p.setViewport({ width: 1300, height: 900 });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    const dialogs = []; let accept = true; p.on('dialog', d => { dialogs.push(d.message()); accept ? d.accept() : d.dismiss(); });
    const calls = []; let restWrites = 0, started = true, canRun = true;
    const mk = (id, scope, title, status, extra) => Object.assign({ id, scope, club: scope === 'club' ? '台北松山扶輪社' : '', title, folderId: 'f', status, progress: {}, totalPhotos: 0, error: '', createdAt: '2026-11-22T03:00:00Z', sentAt: null, stuck: false, people: 0, sure: 0, pending: 0, persons: [] }, extra || {});
    let jobs = [mk('d1', 'district', '地區年會', 'done', { totalPhotos: 523, people: 2, sure: 5, pending: 1, sentAt: '2026-11-22T05:00:00Z', persons: [{ key: '王小明|Tony', sure: 4, pending: 1 }, { key: '李太太|Amy', sure: 1, pending: 0 }] })];
    let preview = { ok: true, title: '', people: 2, targets: 2, already: 0, unbound: [{ club: '台北松山扶輪社', name: '陳' }], canSend: true };
    await p.setRequestInterception(true);
    p.on('request', r => {
      const u = r.url(), m = r.method();
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (m === 'OPTIONS' && (u.includes('/functions/v1/') || u.includes('/rest/v1/'))) return r.respond({ status: 204, headers: cors });
      if (u.includes('/functions/v1/')) {
        let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (e) {}
        calls.push(body);
        const a = body.action; let out = { ok: true, events: [], people: [], enabled: true, max: 3, bound: [] };
        const list = x => Object.assign({ ok: true, canRun, canSend: true, jobs }, x || {});
        if (a === 'photo_desk_status') out = { ok: true, enabled: true };
        if (a === 'photo_desk_job_list') out = list();
        if (a === 'photo_desk_job_add') { if (/flickr/.test(body.url)) out = { ok: false, code: 'PHOTO_BAD_URL' }; else { jobs = [mk('c' + (jobs.length + 1), 'club', body.title, 'queued')].concat(jobs); out = list({ started }); } }
        if (a === 'photo_desk_job_rerun') { jobs.find(j => j.id === body.id).status = 'queued'; out = list({ started }); }
        if (a === 'photo_desk_job_delete') { jobs = jobs.filter(j => j.id !== body.id); out = list(); }
        if (a === 'photo_desk_job_preview') out = preview;
        if (a === 'photo_desk_job_send') { jobs.find(j => j.id === body.id).sentAt = '2026-11-22T06:00:00Z'; out = list({ sent: 2, failed: 0 }); }
        return r.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(out) });
      }
      if (u.includes('/rest/v1/') && m !== 'GET' && m !== 'HEAD') { restWrites++; return r.respond({ status: 200, contentType: 'application/json', headers: cors, body: '[]' }); }
      r.continue();
    });
    const CLUB = '台北松山扶輪社';
    await p.goto('http://localhost:8000/index.html'); await wait(2500);
    await p.evaluate(c => { document.getElementById('loginClubSelect').value = c; document.getElementById('loginPassword').value = 'fruit8428'; document.getElementById('loginForm').dispatchEvent(new Event('submit')); }, CLUB);
    await wait(2000);
    await p.evaluate(() => { DISTRICT.photoEnabled = true; mpBtnState.at = 0; window.pullRemoteState = async () => {};
      clubMemberDatabase[selectedClubName] = [{ id: 1, name: '王小明', nickname: 'Tony', role: '社友' }, { id: 2, name: '李大華', nickname: 'David', role: '社友' }, { id: 3, name: '李太太', nickname: 'Amy', role: '寶(尊)眷', spouseOfId: 2 }];
      return mpRefreshButton(); }); await wait(300);
    restWrites = 0;
    await p.evaluate(() => openMemberPortraits()); await p.waitForSelector('#mpRows tr'); await wait(200);
    ok('視窗有兩個分頁：① 大頭照、② 活動照片', (await p.$$eval('.mp-tab', a => a.map(x => x.innerText).join('|'))) === '① 大頭照|② 活動照片');
    await p.evaluate(() => mpTab('jobs')); await p.waitForSelector('.mpj-row');
    const txt = () => p.$eval('#memberPortraitOverlay', e => e.innerText);
    const has = re => p.waitForFunction(re => new RegExp(re).test(document.getElementById('memberPortraitOverlay').innerText), { timeout: 8000 }, re).then(() => true, () => false);
    await has('本社找到');
    let s = await txt();
    const okList = calls.some(c => c.action === 'photo_desk_job_list' && c.club === CLUB) && s.includes('地區年會') && s.includes('本社找到 2 人（確定 5 張、待本人確認 1 張）') && s.includes('已發送');
    if (!okList) console.log('   [除錯]', JSON.stringify(s).slice(0, 600), JSON.stringify(calls.map(c => c.action + '/' + c.club).slice(-6)));
    ok('活動照片：列出地區的活動與本社結果（找到 2 人、確定 5 張、待確認 1 張、已發送）', calls.some(c => c.action === 'photo_desk_job_list' && c.club === CLUB) && s.includes('地區年會') && s.includes('本社找到 2 人（確定 5 張、待本人確認 1 張）') && s.includes('已發送'));
    ok('地區的活動：執秘沒有發送／重新比對／刪除按鈕，只說明由地區管理者發送', !(await p.$('.mpj-send')) && !(await p.$('.mpj-rerun')) && !(await p.$('.mpj-del')) && s.includes('由地區管理者發送通知'));
    await p.click('.mpj-who'); await wait(100);
    s = await p.$eval('.mpj-persons', e => e.innerText);
    ok('看誰有照片：只有姓名與張數（王小明 4 張＋1 待確認、李太太 1 張），沒有任何照片', /王小明[\s\S]*4[\s\S]*張[\s\S]*＋1 待確認/.test(s) && /李太太[\s\S]*1[\s\S]*張/.test(s) && (await p.$$eval('#memberPortraitOverlay img', a => a.length)) === 0);
    await p.click('#mpjAddBtn'); await wait(100);
    ok('沒填活動名稱：提示，不會送出', (await txt()).includes('請填活動名稱') && !calls.some(c => c.action === 'photo_desk_job_add'));
    await p.type('#mpjTitle', '十一月例會'); await p.type('#mpjUrl', 'https://flickr.com/abc'); await p.click('#mpjAddBtn');
    ok('不是 Google 雲端硬碟資料夾的連結：顯示看得懂的原因，輸入的字還在', await has('這不是 Google 雲端硬碟「資料夾」的連結') && await p.$eval('#mpjTitle', e => e.value) === '十一月例會');
    await p.$eval('#mpjUrl', e => { e.value = ''; }); await p.type('#mpjUrl', 'https://drive.google.com/drive/folders/1GYhy19wKuxQhunvcLA0FU58-gN01ILXn');
    await p.click('#mpjAddBtn');
    const add = () => calls.filter(c => c.action === 'photo_desk_job_add').pop();
    ok('貼連結：送出活動名稱、網址、地區代號；顯示已開始比對與「排隊中」，輸入框清空', await has('已開始比對') && add().title === '十一月例會' && /folders\/1GYhy/.test(add().url) && add().district === await p.evaluate(() => DISTRICT.code) && (await txt()).includes('排隊中') && await p.$eval('#mpjTitle', e => e.value) === '');
    ok('本社貼的活動：有「再啟動一次」與「刪除」，還沒完成所以沒有發送按鈕', !!(await p.$('.mpj-rerun')) && !!(await p.$('.mpj-del')) && !(await p.$('.mpj-send')));
    // 自動更新時不打斷輸入
    await p.type('#mpjTitle', '打到一半');
    jobs[0] = Object.assign(jobs[0], { status: 'running', progress: { stage: '比對中', done: 120, total: 523 } });
    await p.evaluate(() => mpjLoad(true)); await wait(300);
    ok('自動更新：顯示進度 120／523，正在輸入的字沒有被清掉', (await txt()).includes('比對中 120／523') && await p.$eval('#mpjTitle', e => e.value) === '打到一半');
    ok('比對中：沒有重新比對按鈕', !(await p.$('.mpj-rerun')));
    jobs[0] = Object.assign(jobs[0], { status: 'failed', error: '資料夾沒有開放，請攝影師改成「知道連結的任何人都能檢視」', progress: {} });
    await p.evaluate(() => mpjLoad(true)); await wait(300);
    ok('失敗：顯示白話原因，可以重新比對', (await txt()).includes('資料夾沒有開放') && !!(await p.$('.mpj-rerun')));
    started = false; await p.click('.mpj-rerun');
    ok('重新比對：先確認（說明已找到的會保留）；啟動不了時如實說明', await has('已排入，但運算程式暫時啟動不了') && dialogs.some(d => d.includes('都會保留')) && calls.some(c => c.action === 'photo_desk_job_rerun' && c.id === jobs[0].id));
    started = true;
    jobs[0] = Object.assign(jobs[0], { status: 'done', error: '', totalPhotos: 80, people: 2, sure: 3, pending: 0, persons: [{ key: '王小明|Tony', sure: 2, pending: 0 }, { key: '已離社|X', sure: 1, pending: 0 }] });
    await p.evaluate(() => mpjLoad(true)); await wait(300);
    ok('比對完成且尚未發送：有「發送通知」', (await txt()).includes('尚未發送') && (await p.$eval('.mpj-send', e => e.innerText)).includes('發送通知'));
    accept = false; await p.click('.mpj-send'); await wait(400); accept = true;
    ok('發送：先預覽並確認（人數、會用推播額度、誰收不到）；按取消就不發送', dialogs.some(d => d.includes('會用 LINE 通知 2 人') && d.includes('推播額度') && d.includes('・陳')) && !calls.some(c => c.action === 'photo_desk_job_send'));
    await p.click('.mpj-send');
    const snd = () => calls.find(c => c.action === 'photo_desk_job_send');
    ok('發送：帶活動代號與 LIFF 代號；顯示已發送 2 人，按鈕變成「再發送」', await has('已發送 2 人') && snd().id === jobs[0].id && snd().liffId === await p.evaluate(() => LINE_LIFF_ID) && (await p.$eval('.mpj-send', e => e.innerText)).includes('再發送'));
    preview = { ok: true, title: '', people: 2, targets: 0, already: 2, unbound: [], canSend: true };
    const nSend = calls.filter(c => c.action === 'photo_desk_job_send').length;
    await p.click('.mpj-send');
    ok('都通知過了：說明沒有需要通知的人，不會再發', await has('沒有需要通知的人。已通知過 2 人') && calls.filter(c => c.action === 'photo_desk_job_send').length === nSend);
    canRun = false; jobs[0] = Object.assign(jobs[0], { status: 'queued' });
    await p.evaluate(() => mpjLoad(true)); await wait(300);
    ok('運算程式還沒設定的地區：排隊中會說明暫時不會開始', (await txt()).includes('運算程式尚未設定'));
    await p.click('.mpj-del'); await wait(400);
    ok('刪除：先確認（說明社友會看不到、攝影師的照片不受影響）', dialogs.some(d => d.includes('攝影師雲端硬碟裡的照片不受影響')) && calls.some(c => c.action === 'photo_desk_job_delete') && !(await txt()).includes('十一月例會'));
    await p.evaluate(() => mpTab('people')); await p.waitForSelector('#mpRows tr');
    ok('切回「① 大頭照」分頁正常', (await p.$$eval('#mpRows tr.mp-row', a => a.length)) === 3);
    ok('活動照片的操作沒有寫入報名系統的資料庫（app_storage），也沒有用 localStorage 存資料', restWrites === 0 && await p.evaluate(() => !Object.keys(localStorage).some(k => /photo|portrait|job/i.test(k))));
    ok('報名系統：過程中沒有程式錯誤', errs.length === 0); if (errs.length) console.log(errs);
    await p.close();
  }
  await b.close();
})();
