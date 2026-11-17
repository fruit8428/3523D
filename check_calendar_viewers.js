// 驗證行事曆後台「③ 誰可以在 LINE 看全社出席率」：用假的雲端小程式回應（不連正式資料庫）。需先啟動 8000 埠。
const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  let fail = 0; const ok = (n, c) => { console.log((c ? '✅ ' : '❌ ') + n); if (!c) fail++; };
  const saved = {}; const sent = [];
  const members = [{ key: '王|P Robert', name: '王', nickname: 'P Robert', role: '社長', spouse: false, isDefault: true },
                   { key: '李|S Ken', name: '李', nickname: 'S Ken', role: '社友', spouse: false, isDefault: true },
                   { key: '陳|PP Fred', name: '陳', nickname: 'PP Fred', role: '社友', spouse: false, isDefault: false }];
  const view = (club) => ({ ok: true, club, custom: !!saved[club], members: members.map(m => ({ ...m, allowed: saved[club] ? saved[club].includes(m.key) : m.isDefault })) });
  await page.setRequestInterception(true);
  page.on('dialog', d => d.accept());
  const jsErr = []; page.on('pageerror', e => jsErr.push(e.message));
  page.on('request', req => {
    if (!req.url().includes('/functions/v1/line-checkin')) return req.continue();
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors });
    const b = JSON.parse(req.postData() || '{}'); sent.push(b);
    let r = { ok: false, code: 'BAD_REQUEST' };
    if (b.action === 'cal_admin_state') r = { ok: true, types: [], roles: [], clubs: ['甲社', '乙社'], clubsWithoutEditor: [], clubInfos: [{ name: '甲社', division: '第一分區', code: '01-1' }, { name: '乙社', division: '第二分區', code: '02-1' }], reportCustomClubs: Object.keys(saved).map(c => ({ club: c, count: saved[c].length })) };
    if (b.action === 'cal_admin_viewers_get') r = view(b.club);
    if (b.action === 'cal_admin_viewers_save') { if (b.reset) delete saved[b.club]; else saved[b.club] = b.keys; r = view(b.club); }
    req.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(r) });
  });
  await page.goto('http://localhost:8000/admin-calendar.html');
  await page.type('#pw', 'x'); await page.click('button[onclick="login()"]');
  await page.waitForSelector('#app:not(.hidden)');
  ok('社清單依分區分組、顯示社代號', await page.$eval('#vwClub', s => s.querySelectorAll('optgroup').length === 2 && s.textContent.includes('01-1 甲社')));
  ok('一開始顯示每社都是預設', (await page.$eval('#vwCustom', e => e.textContent)).includes('預設'));
  await page.select('#vwClub', '甲社');
  await page.waitForSelector('.vw-ck');
  ok('預設：社長、秘書打勾，PP 沒勾，狀態寫「預設」', JSON.stringify(await page.$$eval('.vw-ck', a => a.map(x => x.checked))) === '[true,true,false]' && (await page.$eval('#vwBox', e => e.textContent)).includes('目前：預設'));
  await page.click('.vw-ck[data-i="1"]'); await page.click('.vw-ck[data-i="2"]');
  ok('勾選後提示尚未儲存', (await page.$eval('#vwMsg', e => e.textContent)) === '尚未儲存');
  await page.click('#vwSave');
  await page.waitForFunction(() => document.getElementById('vwMsg') && document.getElementById('vwMsg').textContent.includes('已儲存'));
  const last = sent.filter(b => b.action === 'cal_admin_viewers_save').pop();
  ok('送出的是社長＋PP Fred（秘書被取消）', last.club === '甲社' && JSON.stringify(last.keys) === JSON.stringify(['王|P Robert', '陳|PP Fred']));
  ok('儲存後狀態改成「自訂」、社清單標「自訂 2 人」', (await page.$eval('#vwBox', e => e.textContent)).includes('目前：自訂') && (await page.$eval('#vwClub', s => s.textContent)).includes('甲社（自訂 2 人）') && (await page.$eval('#vwCustom', e => e.textContent)).includes('已自訂的社：甲社'));
  ok('換社後仍保留選取的社', await page.$eval('#vwClub', s => s.value) === '甲社');
  await page.click('button[onclick="resetViewers()"]');
  await page.waitForFunction(() => document.getElementById('vwMsg') && document.getElementById('vwMsg').textContent.includes('恢復預設'));
  ok('恢復預設後回到社長、秘書', JSON.stringify(await page.$$eval('.vw-ck', a => a.map(x => x.checked))) === '[true,true,false]' && sent.some(b => b.reset === true));
  await page.setViewport({ width: 390, height: 800 });
  ok('手機寬度沒有橫向捲動', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  ok('無 JS 錯誤', jsErr.length === 0);
  await browser.close();
  console.log(fail ? `❌ ${fail} 項失敗` : '全部通過'); process.exit(fail ? 1 : 0);
})();
