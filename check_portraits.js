// 活動照片找人・大頭照的畫面：執秘在報名系統社友庫的「📷 大頭照」（由執秘統一上傳；社友不在 LINE 自己上傳）。
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

  // LINE 頁面不應該再有大頭照入口（使用者決定由執秘統一建置）
  const lineHtml = fs.readFileSync(__dirname + '/line.html', 'utf8');
  ok('LINE 頁面沒有上傳大頭照的入口與程式（只能看活動照片）', !/member-portraits|type="file"|photo_me|photo_desk/i.test(lineHtml) && !/type="file"|photo_me_upload|photo_desk/i.test(fs.readFileSync(__dirname + '/my-photos.js', 'utf8')));

  {
    const p = await b.newPage(); await p.setViewport({ width: 1300, height: 900 });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    const dialogs = []; let accept = true; p.on('dialog', d => { dialogs.push(d.message()); accept ? d.accept() : d.dismiss(); });
    const calls = []; let enabled = false, restWrites = 0, people = [], uploadReply = null, store = {};
    const PIX = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
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
        const k = body.personKey;
        if (body.action === 'photo_desk_status') out = { ok: true, enabled };
        if (body.action === 'photo_desk_list') out = enabled ? list() : { ok: false, code: 'PHOTO_CLUB_OFF' };
        if (body.action === 'photo_desk_upload') {
          if (uploadReply) out = uploadReply;
          else { store[k] = (store[k] || []).concat([{ id: k + '#' + Date.now() + Math.random(), url: PIX, at: '2026-11-22T03:00:00Z' }]); const x = people.find(q => q.key === k); if (x) x.count++; else people.push({ key: k, count: 1, at: '2026-11-22T03:00:00Z' }); out = Object.assign(list(), { notified: k === '王小明|Tony' }); }
        }
        if (body.action === 'photo_desk_view') out = { ok: true, key: k, photos: store[k] || [] };
        if (body.action === 'photo_desk_delete') {
          if (body.id) { store[k] = (store[k] || []).filter(x => x.id !== body.id); const x = people.find(q => q.key === k); if (x) { x.count--; if (!x.count) people = people.filter(q => q.key !== k); } }
          else { people = people.filter(q => q.key !== k); delete store[k]; }
          out = Object.assign(list(), { removed: 1 });
        }
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
    people = [{ key: '王小明|Tony', count: 1, at: '2026-11-20T03:00:00Z' }, { key: '已離社|Old', count: 1, at: '2026-10-01T03:00:00Z' }];
    store = { '王小明|Tony': [{ id: 'w1', url: PIX, at: '2026-11-20T03:00:00Z' }], '已離社|Old': [{ id: 'o1', url: PIX, at: '2026-10-01T03:00:00Z' }] };
    restWrites = 0;
    await p.evaluate(() => openMemberPortraits()); await p.waitForSelector('#mpRows tr'); await wait(200);
    const txt = () => p.$eval('#memberPortraitOverlay', e => e.innerText);
    const has = re => p.waitForFunction(re => new RegExp(re).test(document.getElementById('memberPortraitOverlay').innerText), { timeout: 8000 }, re).then(() => true, () => false);
    let s = await txt();
    ok('名單：列出全社（含寶尊眷），顯示已有 1／4 人', (await p.$$eval('#mpRows tr.mp-row', a => a.length)) === 4 && (await p.$eval('#mpSummary', e => e.innerText.replace(/\s/g, ''))) === '已有大頭照：1／4人' && s.includes('李太太'));
    ok('名單：有照片的人顯示張數與日期；有綁 LINE 的有標記；沒有的顯示尚未上傳', /王小明[\s\S]*已綁 LINE[\s\S]*✅ 1 張[\s\S]*2026\/11\/20/.test(s) && s.includes('尚未上傳'));
    ok('名單：一打開不會載入任何照片；說明由執秘上傳、要先取得同意', (await p.$$eval('#memberPortraitOverlay img', a => a.length)) === 0 && !calls.some(c => c.action === 'photo_desk_view') && s.includes('請社友把大頭照傳給您') && s.includes('上傳前請先取得本人同意'));
    ok('名單：已不在社友庫但還有大頭照的人另外列出', s.includes('已不在社友庫的人（1）') && s.includes('已離社'));
    ok('名單：奇怪的名字不會變成網頁標籤', !(await p.$('#mpRows b')) && s.includes('<b>怪名</b>'));
    ok('沒有 LINE 自行上傳的連結；有「請社友傳大頭照給我」的訊息可複製', !s.includes('liff.line.me') && s.includes('複製「請社友傳大頭照給我」的訊息'));
    const pickRow = async (i, files) => { const [fc] = await Promise.all([p.waitForFileChooser(), p.evaluate(i => mpPick(i), i)]); await fc.accept(files); };
    const order = await p.evaluate(() => window.__mpKeys.slice());
    const iLi = order.indexOf('李大華|David'), iWang = order.indexOf('王小明|Tony'), iOld = order.indexOf('已離社|Old');
    const ups = () => calls.filter(c => c.action === 'photo_desk_upload');
    accept = false; await pickRow(iLi, [BIG]); await wait(400); accept = true;
    ok('上傳：會先問「已取得本人同意」；按取消就不上傳', dialogs.some(d => d.includes('已經取得「李大華」本人同意')) && ups().length === 0);
    await pickRow(iLi, [BIG, PNG]);
    ok('上傳：一次選 2 張都上傳，顯示結果', await has('已幫「李大華」上傳 2 張') && ups().length === 2);
    const up = ups()[0];
    const dim = await p.evaluate(async src => { const im = new Image(); await new Promise(r => { im.onload = r; im.src = src; }); return [im.naturalWidth, im.naturalHeight]; }, up.image);
    ok('上傳：送出社名、姓名|Nick Name、同意；轉成 JPEG、4000×3000 縮成最長邊 1600；PNG 也轉成 JPEG', up.club === CLUB && 'clubPassword' in up && up.personKey === '李大華|David' && up.consent === true && up.image.indexOf('data:image/jpeg;base64,') === 0 && dim[0] === 1600 && dim[1] === 1200 && up.image.length < 1700000 && ups()[1].image.indexOf('data:image/jpeg;base64,') === 0);
    ok('上傳後名單變成 2／4，李大華 ✅ 2 張', (await p.$eval('#mpSummary', e => e.innerText.replace(/\s/g, ''))) === '已有大頭照：2／4人' && /李大華[\s\S]*✅ 2 張/.test(await txt()));
    await pickRow(iWang, [BIG, PNG, BIG]);
    ok('超過 3 張上限：只上傳放得下的 2 張並說明；畫面與確認訊息都沒有提到通知本人', await has('已幫「王小明」上傳 2 張') && (await txt()).includes('有 1 張沒有上傳') && ups().length === 4 && !(await txt()).includes('通知本人') && !dialogs.some(d => d.includes('會收到')));
    ok('滿 3 張的人不再出現上傳按鈕', await p.evaluate(() => { const tr = [...document.querySelectorAll('#mpRows tr.mp-row')].find(t => t.innerText.includes('王小明')); return !tr.querySelector('.mp-up') && !!tr.querySelector('.mp-view'); }));
    await pickRow(iLi, [TXT, SMALL]);
    ok('讀不了的檔案：提示原因，沒有送到雲端', await has('第 1 張：這張照片無法讀取') && ups().length === 4);
    await p.evaluate(i => mpDelete(i), iLi); await wait(400); await pickRow(iLi, [SMALL, BIG]);
    ok('太小的照片跳過並說明，其餘照常上傳', await has('已幫「李大華」上傳 1 張') && (await txt()).includes('第 1 張：這張照片太小') && ups().length === 5);
    uploadReply = { ok: false, code: 'PHOTO_TABLE_MISSING' };
    await pickRow(iLi, [BIG]);
    ok('雲端拒絕時顯示看得懂的原因', await has('雲端尚未建立大頭照的資料表')); uploadReply = null;
    // 查看：一次一個人
    await p.evaluate(i => mpView(i), iWang); await p.waitForSelector('#mpRows img.mp-img');
    const views = () => calls.filter(c => c.action === 'photo_desk_view');
    ok('查看：按了才向雲端取，而且只取這一個人；顯示 3 張與「刪除這張」', views().length === 1 && views()[0].personKey === '王小明|Tony' && (await p.$$eval('#mpRows img.mp-img', a => a.length)) === 3 && (await p.$$eval('.mp-del1', a => a.length)) === 3);
    await p.evaluate(() => mpDeleteOne(0)); await wait(500);
    ok('刪除一張：先確認，帶照片代號；剩 2 張', dialogs.some(d => d.includes('要刪除「王小明」的這張大頭照嗎')) && calls.some(c => c.action === 'photo_desk_delete' && c.personKey === '王小明|Tony' && c.id === 'w1') && (await p.$$eval('#mpRows img.mp-img', a => a.length)) === 2 && /王小明[\s\S]*✅ 2 張/.test(await txt()));
    await p.evaluate(i => mpView(i), iWang); await wait(200);
    ok('收起後畫面上不留照片', (await p.$$eval('#memberPortraitOverlay img', a => a.length)) === 0);
    await p.evaluate(i => mpDelete(i), iOld); await wait(400);
    ok('全部刪除：先確認，刪掉已離社的人，名單不再列出', dialogs.some(d => d.includes('要刪除「已離社」全部的大頭照嗎')) && calls.some(c => c.action === 'photo_desk_delete' && c.personKey === '已離社|Old' && !c.id) && !(await txt()).includes('已不在社友庫'));
    await p.evaluate(i => mpView(i), iLi); await p.waitForSelector('#mpRows img.mp-img');
    await p.evaluate(() => mpClose());
    ok('關閉視窗後不留照片', (await p.$$eval('#memberPortraitOverlay img', a => a.length)) === 0 && await p.evaluate(() => mp === null));
    // 從社友庫刪除社友 → 順便刪掉他的大頭照
    const before = calls.filter(c => c.action === 'photo_desk_delete').length;
    await p.evaluate(() => { window.findSubmittedRegistrationsOf = () => []; window.saveToStorage = async () => true; return deleteMember(2); }); await wait(500);
    ok('刪除社友：自動刪掉他的大頭照', calls.filter(c => c.action === 'photo_desk_delete').length === before + 1 && calls.some(c => c.action === 'photo_desk_delete' && c.personKey === '李大華|David'));
    ok('大頭照的操作沒有寫入報名系統的資料庫（app_storage）', restWrites === 0);
    ok('沒有用 localStorage 存任何大頭照資料', await p.evaluate(() => !Object.keys(localStorage).some(k => /portrait|photo|大頭/i.test(k)) && !Object.values(localStorage).some(v => String(v).includes('data:image'))));
    ok('過程中沒有程式錯誤', errs.length === 0); if (errs.length) console.log(errs);
    await p.close();
  }
  fs.rmSync(dir, { recursive: true, force: true });
  await b.close();
})();
