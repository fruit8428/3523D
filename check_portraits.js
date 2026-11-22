// 活動照片找人・大頭照的畫面：① 社友在 LINE 的「我的大頭照」② 執秘在報名系統的「📷 大頭照」名單。
// 需先啟動 8000 埠：python3 -m http.server 8000。雲端小程式用假的回應；所有寫入 Supabase 的請求都擋下。
const puppeteer = require('puppeteer');
const fs = require('fs'), os = require('os'), path = require('path');
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const ok = (n, c) => { console.log((c ? '✅ ' : '❌ ') + n); if (!c) process.exitCode = 1; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portrait-'));

  // 先用瀏覽器畫出測試用的照片檔（大圖 4000×3000、太小的圖 200×200、PNG）
  const gen = await b.newPage();
  const make = async (w, h, type, name) => {
    const data = await gen.evaluate((w, h, type) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#f2c9a0'); gr.addColorStop(1, '#3b5b8c'); g.fillStyle = gr; g.fillRect(0, 0, w, h); for (let i = 0; i < 400; i++) { g.fillStyle = `hsl(${i * 7 % 360} 60% 50%)`; g.fillRect((i * 97) % w, (i * 53) % h, 40, 40); } return c.toDataURL(type, 0.92); }, w, h, type);
    const f = path.join(dir, name); fs.writeFileSync(f, Buffer.from(data.split(',')[1], 'base64')); return f;
  };
  const BIG = await make(4000, 3000, 'image/jpeg', 'big.jpg'), SMALL = await make(200, 200, 'image/jpeg', 'small.jpg'), PNG = await make(900, 1200, 'image/png', 'p.png');
  const TXT = path.join(dir, 'not-image.jpg'); fs.writeFileSync(TXT, '這不是圖片');
  await gen.close();

  // ============ ① LINE：我的大頭照 ============
  {
    const src = fs.readFileSync(__dirname + '/member-portraits.js', 'utf8');
    const html = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><body>
<h1 id=hdTitle></h1><div id=viewBind class=hidden></div><main><div id=viewPhoto class=hidden></div></main><style>.hidden{display:none!important}</style>
<script>
function show(id){['viewBind','viewPhoto'].forEach(v=>document.getElementById(v).classList.toggle('hidden',v!==id));}
function toast(m){window.__toast=m}; function renderIdCard(){}; function showBind(m){window.__bind=m;show('viewBind')}
var binding={name:'王小明',club:'甲社',key:'王小明|Tony'}; window.__calls=[]; var S={enabled:true,photos:[],fail:''};
async function api(a,x){window.__calls.push([a,x]);
  if(S.fail){return{ok:false,code:S.fail};}
  if(a==='photo_me_upload'){ if(!S.enabled) return {ok:false,code:'PHOTO_CLUB_OFF'}; if(S.photos.length>=3) return {ok:false,code:'PHOTO_TOO_MANY'}; S.photos.push({id:'p'+(S.photos.length+1)+Date.now(),url:x.image,at:'2026-11-22T03:00:00Z',by:'self'}); }
  if(a==='photo_me_delete'){ S.photos = x.all ? [] : S.photos.filter(p=>p.id!==x.id); }
  return {ok:true,enabled:S.enabled,max:3,me:{club:'甲社',name:'王小明',nickname:'Tony'},photos:S.photos.slice()}; }
</script><script>${src.replace(/<\/script>/g, '<\\/script>')}</script></body>`;
    const p = await b.newPage(); await p.setViewport({ width: 390, height: 800 });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    const dialogs = []; p.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
    await p.setContent(html, { waitUntil: 'load' });
    const text = () => p.$eval('#viewPhoto', e => e.innerText);
    const pick = async file => { const [fc] = await Promise.all([p.waitForFileChooser(), p.click('#lpBtn')]); await fc.accept([file]); };
    await p.evaluate(() => photoStart()); await wait(200);
    let s = await text();
    ok('LINE：標題「我的大頭照」、說明用途、還沒有照片', await p.$eval('#hdTitle', e => e.innerText) === '我的大頭照' && s.includes('找出有您的照片') && s.includes('還沒有上傳大頭照'));
    ok('LINE：同意文字寫明只用來比對、不公開、可隨時刪除', s.includes('只用來比對扶輪活動照片') && s.includes('不會公開') && s.includes('隨時在這裡更換或刪除'));
    await p.click('#lpBtn'); await wait(100);
    ok('LINE：沒勾同意按「選擇照片」＝提示先勾選，不會上傳', (await p.$eval('#lpMsg', e => e.innerText)).includes('請先勾選同意') && !(await p.evaluate(() => __calls.some(c => c[0] === 'photo_me_upload'))));
    await p.click('#lpAgree');
    await pick(SMALL); await wait(400);
    ok('LINE：太小的照片＝提示換一張，不會上傳', (await p.$eval('#lpMsg', e => e.innerText)).includes('太小') && !(await p.evaluate(() => __calls.some(c => c[0] === 'photo_me_upload'))));
    await pick(TXT); await wait(400);
    ok('LINE：讀不了的檔案＝提示換一張，不會上傳', (await p.$eval('#lpMsg', e => e.innerText)).includes('無法讀取') && !(await p.evaluate(() => __calls.some(c => c[0] === 'photo_me_upload'))));
    await pick(BIG); await p.waitForSelector('#viewPhoto img'); await wait(200);
    const up = await p.evaluate(async () => { const c = __calls.find(c => c[0] === 'photo_me_upload')[1]; const im = new Image(); await new Promise(r => { im.onload = r; im.src = c.image; }); return { consent: c.consent, jpeg: c.image.indexOf('data:image/jpeg;base64,') === 0, w: im.naturalWidth, h: im.naturalHeight, len: c.image.length }; });
    ok('LINE：上傳時帶同意、轉成 JPEG、4000×3000 縮成最長邊 1600', up.consent === true && up.jpeg && up.w === 1600 && up.h === 1200 && up.len < 1700000);
    s = await text();
    ok('LINE：上傳後顯示照片、日期與刪除按鈕；提示「上傳完成」', (await p.$$eval('#viewPhoto img', a => a.length)) === 1 && s.includes('2026/11/22') && s.includes('刪除') && await p.evaluate(() => __toast === '上傳完成'));
    await pick(PNG); await wait(500);
    const up2 = await p.evaluate(() => __calls.filter(c => c[0] === 'photo_me_upload')[1][1].image.slice(0, 23));
    ok('LINE：PNG 也會轉成 JPEG 再上傳', up2 === 'data:image/jpeg;base64,' && (await p.$$eval('#viewPhoto img', a => a.length)) === 2);
    await pick(BIG); await wait(600);
    s = await text();
    ok('LINE：滿 3 張後不再出現上傳按鈕，提示要先刪除', (await p.$$eval('#viewPhoto img', a => a.length)) === 3 && !(await p.$('#lpBtn')) && s.includes('最多 3 張'));
    await p.evaluate(() => lpDelete(0)); await wait(200);
    ok('LINE：刪除一張要先確認，刪除後剩 2 張', dialogs.some(d => d.includes('要刪除這張大頭照嗎')) && (await p.$$eval('#viewPhoto img', a => a.length)) === 2);
    await p.evaluate(() => { S.photos[0].by = 'proxy'; return photoStart(); }); await wait(200);
    ok('LINE：執秘代傳的照片有標示', (await text()).includes('執秘代傳'));
    await p.evaluate(() => { S.enabled = false; return photoStart(); }); await wait(200);
    s = await text();
    ok('LINE：社關閉後不能上傳，但仍可刪除自己的照片', s.includes('尚未開放') && !(await p.$('#lpBtn')) && s.includes('全部刪除'));
    await p.evaluate(() => lpDeleteAll()); await wait(200);
    ok('LINE：全部刪除要先確認（說明不再比對），刪完沒有照片', dialogs.some(d => d.includes('不會再用您的臉比對')) && (await p.$$eval('#viewPhoto img', a => a.length)) === 0);
    await p.evaluate(() => { S.fail = 'NOT_BOUND'; return photoStart(); }); await wait(200);
    ok('LINE：沒綁定身分＝先帶去綁定', await p.evaluate(() => /請先綁定身分/.test(window.__bind || '')));
    await p.evaluate(() => { S.fail = 'PHOTO_TABLE_MISSING'; return photoStart(); }); await wait(200);
    ok('LINE：雲端出錯時有看得懂的提示與重新整理', (await text()).includes('暫時無法使用') && (await text()).includes('重新整理'));
    ok('LINE：沒有用到 localStorage', await p.evaluate(() => { try { return Object.keys(localStorage).length === 0; } catch (e) { return true; } }));
    ok('LINE：過程中沒有程式錯誤', errs.length === 0); if (errs.length) console.log(errs);
    await p.close();
  }

  // ============ ② 報名系統：執秘的大頭照名單 ============
  {
    const p = await b.newPage(); await p.setViewport({ width: 1300, height: 900 });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    const dialogs = []; let accept = true; p.on('dialog', d => { dialogs.push(d.message()); accept ? d.accept() : d.dismiss(); });
    const calls = []; let enabled = false, restWrites = 0, people = [], uploadReply = null;
    await p.setRequestInterception(true);
    p.on('request', r => {
      const u = r.url(), m = r.method();
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (m === 'OPTIONS' && (u.includes('/functions/v1/') || u.includes('/rest/v1/'))) return r.respond({ status: 204, headers: cors });
      if (u.includes('/functions/v1/')) {
        let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (e) {}
        calls.push(body);
        let out = { ok: true, events: [], people: [], enabled: false };
        const list = () => ({ ok: true, enabled: true, max: 3, people, bound: ['王小明|Tony'] });
        if (body.action === 'photo_desk_status') out = { ok: true, enabled };
        if (body.action === 'photo_desk_list') out = enabled ? list() : { ok: false, code: 'PHOTO_CLUB_OFF' };
        if (body.action === 'photo_desk_upload') {
          if (uploadReply) out = uploadReply;
          else { const x = people.find(q => q.key === body.personKey); if (x) x.count++; else people.push({ key: body.personKey, count: 1, self: 0, at: '2026-11-22T03:00:00Z' }); out = Object.assign(list(), { notified: body.personKey === '王小明|Tony' }); }
        }
        if (body.action === 'photo_desk_delete') { people = people.filter(q => q.key !== body.personKey); out = Object.assign(list(), { removed: 1 }); }
        return r.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(out) });
      }
      if (u.includes('/rest/v1/') && m !== 'GET' && m !== 'HEAD') { restWrites++; return r.respond({ status: 200, contentType: 'application/json', headers: cors, body: '[]' }); }
      r.continue();
    });
    const CLUB = '台北松山扶輪社';
    await p.goto('http://localhost:8000/index.html'); await wait(2500);
    await p.evaluate(c => { document.getElementById('loginClubSelect').value = c; document.getElementById('loginPassword').value = 'fruit8428'; document.getElementById('loginForm').dispatchEvent(new Event('submit')); }, CLUB);
    await wait(2000);
    const hidden = () => p.$eval('#memberPortraitBtn', e => e.classList.contains('hidden'));
    ok('地區沒開（photoEnabled=false）：按鈕不顯示，也不問雲端', await hidden() && !calls.some(c => c.action === 'photo_desk_status'));
    await p.evaluate(() => { DISTRICT.photoEnabled = true; mpBtnState.at = 0; return mpRefreshButton(); }); await wait(300);
    ok('地區有開但這個社沒開放：有問雲端，按鈕不顯示', calls.some(c => c.action === 'photo_desk_status' && c.club === CLUB && 'clubPassword' in c) && await hidden());
    const n1 = calls.filter(c => c.action === 'photo_desk_status').length;
    await p.evaluate(() => { updateRolePermissionsUI(); updateRolePermissionsUI(); }); await wait(300);
    ok('同一社短時間內不重複問雲端', calls.filter(c => c.action === 'photo_desk_status').length === n1);
    enabled = true;
    await p.evaluate(() => { mpBtnState.at = 0; return mpRefreshButton(); }); await wait(300);
    ok('這個社開放後：「📷 大頭照」按鈕出現', !(await hidden()));
    await p.evaluate(() => {
      window.pullRemoteState = async () => {};
      clubMemberDatabase[selectedClubName] = [
        { id: 1, name: '王小明', nickname: 'Tony', role: '社友' }, { id: 2, name: '李大華', nickname: 'David', role: '社友' },
        { id: 3, name: '李太太', nickname: 'Amy', role: '寶(尊)眷', spouseOfId: 2 }, { id: 4, name: '<b>怪名</b>', nickname: 'X', role: '社友' }];
    });
    people = [{ key: '王小明|Tony', count: 2, self: 2, at: '2026-11-20T03:00:00Z' }, { key: '已離社|Old', count: 1, self: 0, at: '2026-10-01T03:00:00Z' }];
    restWrites = 0;
    await p.evaluate(() => openMemberPortraits()); await p.waitForSelector('#mpRows tr'); await wait(200);
    const txt = () => p.$eval('#memberPortraitOverlay', e => e.innerText);
    let s = await txt();
    ok('名單：列出全社（含寶尊眷），顯示已有 1／4 人', (await p.$$eval('#mpRows tr', a => a.length)) === 4 && (await p.$eval('#mpSummary', e => e.innerText.replace(/\s/g, ''))) === '已有大頭照：1／4人' && s.includes('李太太'));
    ok('名單：有照片的人顯示張數、日期、本人上傳；有綁 LINE 的有標記', /王小明[\s\S]*已綁 LINE[\s\S]*✅ 2 張[\s\S]*2026\/11\/20・本人上傳/.test(s) && s.includes('尚未上傳'));
    ok('名單：畫面上沒有任何照片（執秘看不到大頭照），並有說明', (await p.$$eval('#memberPortraitOverlay img', a => a.length)) === 0 && s.includes('不顯示照片本身'));
    ok('名單：已不在社友庫但還有大頭照的人另外列出，可刪除', s.includes('已不在社友庫的人（1）') && s.includes('已離社'));
    ok('名單：奇怪的名字不會變成網頁標籤', !(await p.$('#mpRows b')) && s.includes('<b>怪名</b>'));
    // 代傳：取消確認＝不上傳
    const pickRow = async (i, file) => { const [fc] = await Promise.all([p.waitForFileChooser(), p.evaluate(i => mpPick(i), i)]); await fc.accept([file]); };
    const order = await p.evaluate(() => window.__mpKeys.slice());
    const iLi = order.indexOf('李大華|David'), iWang = order.indexOf('王小明|Tony'), iOld = order.indexOf('已離社|Old');
    accept = false; await pickRow(iLi, BIG); await wait(400); accept = true;
    ok('代傳：會先問「已取得本人同意」；按取消就不上傳', dialogs.some(d => d.includes('已經取得「李大華」本人同意')) && !calls.some(c => c.action === 'photo_desk_upload'));
    await pickRow(iLi, BIG); await p.waitForFunction(() => /已幫「李大華」上傳/.test(document.getElementById('memberPortraitOverlay').innerText));
    const up = calls.find(c => c.action === 'photo_desk_upload');
    s = await txt();
    ok('代傳：送出社名、社密碼、姓名|Nick Name、同意、JPEG；名單變成 2／4', up.club === CLUB && 'clubPassword' in up && up.personKey === '李大華|David' && up.consent === true && up.image.indexOf('data:image/jpeg;base64,') === 0 && up.image.length < 1700000 && (await p.$eval('#mpSummary', e => e.innerText.replace(/\s/g, ''))) === '已有大頭照：2／4人');
    ok('代傳：沒綁 LINE 的人＝提醒要當面告知', s.includes('還沒有綁定 LINE，所以沒有通知') && /李大華[\s\S]*✅ 1 張[\s\S]*執秘代傳/.test(s));
    await pickRow(iWang, PNG); await p.waitForFunction(() => /已幫「王小明」上傳/.test(document.getElementById('memberPortraitOverlay').innerText));
    ok('代傳：有綁 LINE 的人＝顯示已通知本人；本人＋代傳都有時有標示', (await txt()).includes('已用 LINE 通知本人') && (await txt()).includes('本人＋執秘代傳'));
    ok('滿 3 張的人不再出現「代為上傳」', await p.evaluate(i => !document.querySelectorAll('#mpRows tr')[i].querySelector('.mp-up'), iWang));
    await pickRow(iLi, TXT); await wait(500);
    ok('代傳：讀不了的檔案＝提示換一張，沒有送到雲端', (await txt()).includes('無法讀取') && calls.filter(c => c.action === 'photo_desk_upload').length === 2);
    uploadReply = { ok: false, code: 'PHOTO_TOO_MANY' };
    await pickRow(iLi, BIG); await p.waitForFunction(() => /已經有 3 張了/.test(document.getElementById('memberPortraitOverlay').innerText)); uploadReply = null;
    ok('代傳：雲端拒絕時顯示看得懂的原因', true);
    await p.evaluate(i => mpDelete(i), iOld); await wait(400);
    ok('刪除：先確認，刪掉已離社的人，名單不再列出', dialogs.some(d => d.includes('要刪除「已離社」全部的大頭照嗎')) && calls.some(c => c.action === 'photo_desk_delete' && c.personKey === '已離社|Old') && !(await txt()).includes('已不在社友庫'));
    ok('有「複製請社友自己上傳的 LINE 訊息」按鈕（地區有 LIFF 時）', (await txt()).includes('複製「請社友自己上傳」的 LINE 訊息') === await p.evaluate(() => !!LINE_LIFF_ID));
    await p.evaluate(() => mpClose());
    // 從社友庫刪除社友 → 順便刪掉他的大頭照
    const before = calls.filter(c => c.action === 'photo_desk_delete').length;
    await p.evaluate(() => { window.findSubmittedRegistrationsOf = () => []; window.saveToStorage = async () => true; return deleteMember(2); }); await wait(500);
    ok('刪除社友：自動刪掉他的大頭照', calls.filter(c => c.action === 'photo_desk_delete').length === before + 1 && calls.some(c => c.action === 'photo_desk_delete' && c.personKey === '李大華|David'));
    ok('大頭照的操作沒有寫入報名系統的資料庫（app_storage）', restWrites === 0);
    ok('沒有用 localStorage 存任何大頭照資料', await p.evaluate(() => !Object.keys(localStorage).some(k => /portrait|photo|大頭/i.test(k))));
    ok('報名系統：過程中沒有程式錯誤', errs.length === 0); if (errs.length) console.log(errs);
    await p.close();
  }
  fs.rmSync(dir, { recursive: true, force: true });
  await b.close();
})();
