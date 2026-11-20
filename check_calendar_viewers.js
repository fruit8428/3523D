// 驗證行事曆後台「③ 誰可以在 LINE 看全社出席率」：用假的雲端小程式回應（不連正式資料庫）。需先啟動 8000 埠。
const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  let fail = 0; const ok = (n, c) => { console.log((c ? '✅ ' : '❌ ') + n); if (!c) fail++; };
  const saved = {}; const sent = []; let bnPeople = []; let svRows = [{ eventKey: 's::高爾夫', club: '乙社', key: '林|Lin', name: '林', nickname: 'Lin' }];
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
    if (b.action === 'cal_admin_backupnotify_save') bnPeople = b.people.map(x => ({ club: x.club, key: x.key, name: x.key.split('|')[0], nickname: x.key.split('|')[1] }));
    if (b.action && b.action.startsWith('cal_admin_backupnotify_')) { const test = b.action.endsWith('_test'); r = { ok: true, afterDays: 7, sent: test ? bnPeople.filter(x => x.name !== '陳').length : 0, due: test ? [] : [{ key: 's::高爾夫', subName: '高爾夫', date: '2026-11-13', regClubs: 2, people: 6, paidClubs: 1 }], recipients: bnPeople.map(x => Object.assign({}, x, { status: x.name === '陳' ? 'NOT_BOUND' : test ? 'SENT' : 'PREVIEW' })) }; }
    if (b.action === 'cal_admin_statviewers_save') svRows = svRows.filter(v => v.eventKey !== b.eventKey).concat(b.people.map(x => ({ eventKey: b.eventKey, club: x.club, key: x.key, name: x.key.split('|')[0], nickname: x.key.split('|')[1] })));
    if (b.action === 'cal_admin_statviewers_get' || b.action === 'cal_admin_statviewers_save') r = { ok: true, events: [{ key: 'app::分攤金', catName: '地辦分攤金', subName: '上半年分攤金' }, { key: 's::高爾夫', catName: '運動賽事', subName: '高爾夫' }], viewers: svRows };
    if (b.action === 'cal_admin_digest_preview' || b.action === 'cal_admin_digest_test') r = { ok: true, day: b.day, sent: b.action === 'cal_admin_digest_test' ? 2 : 0, governors: [{ name: '王總監', nickname: 'Gov', club: '甲社', events: [{ id: 'd1', layer: 'district', title: '授證典禮', time: '18:00–21:00', location: '君悅', dressCode: '正式' }], recipients: [{ as: '總監', name: '王總監', status: b.action === 'cal_admin_digest_test' ? 'SENT' : 'PREVIEW' }, { as: '總監秘書（副本）', name: '林秘書', status: 'NOT_BOUND' }] }] };
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
  // ④ 總監每日推播
  ok('推播：日期預設明天', await page.$eval('#dgDay', e => e.value) === new Date(Date.now() + 8 * 3600e3 + 86400e3).toISOString().slice(0, 10));
  ok('搜尋結果有「設為總監秘書」按鈕（程式）', (await page.content()).includes("grant(${i},'governor_cc')") || (await page.evaluate(() => typeof grant === 'function')));
  await page.click('button[onclick="digest(false)"]');
  await page.waitForFunction(() => document.getElementById('dgBox').innerText.includes('收件人'));
  const dg = await page.$eval('#dgBox', e => e.innerText);
  const pvCall = sent.filter(b => b.action === 'cal_admin_digest_preview').pop();
  ok('推播預覽：列出行程、收件人、沒綁定的提醒，送出 LIFF ID 與日期', dg.includes('授證典禮') && dg.includes('會收到') && dg.includes('還沒綁定 LINE') && pvCall.day && typeof pvCall.liffId === 'string');
  await page.click('button[onclick="digest(true)"]');
  await page.waitForFunction(() => document.getElementById('dgBox').innerText.includes('已發送'));
  ok('推播測試發送：顯示已發送 2 則', (await page.$eval('#dgBox', e => e.innerText)).includes('已發送 2 則'));
  await page.setViewport({ width: 390, height: 800 });
  ok('手機寬度沒有橫向捲動', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  ok('無 JS 錯誤', jsErr.length === 0);
  // ---------- ⑤ 誰可以看報名／繳費狀況 ----------
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await wait(300);
  ok('⑤ 活動選單：全部活動＋依主選單分組，標示已指定人數', await page.$eval('#svEvent', s => s.querySelectorAll('optgroup').length === 2 && s.textContent.includes('★ 全部活動') && s.textContent.includes('高爾夫（已指定 1 人）')));
  await page.select('#svEvent', 's::高爾夫'); await wait(100);
  ok('⑤ 選活動後列出已指定的人（別社的人）', (await page.$eval('#svChips', e => e.innerText)).includes('Lin') );
  await page.select('#svClub', '甲社'); await wait(400);
  await page.evaluate(() => { const c = document.querySelectorAll('#svMembers input[type=checkbox]'); c[0].click(); c[2].click(); }); await wait(100);
  ok('⑤ 勾選社友後加入名單（可跨社多選）並提示尚未儲存', await page.evaluate(() => document.querySelectorAll('#svChips > span').length === 3 && document.getElementById('svMsg').textContent === '尚未儲存'));
  await page.evaluate(() => svRemove(0)); await wait(100);
  await page.click('#svSave'); await wait(400);
  const sv1 = sent.filter(x => x.action === 'cal_admin_statviewers_save').pop();
  ok('⑤ 儲存：送出活動與勾選的人（只送社名與 key）', !!sv1 && sv1.eventKey === 's::高爾夫' && sv1.people.length === 2 && sv1.people.every(x => x.club === '甲社' && Object.keys(x).length === 2));
  ok('⑤ 儲存後顯示成功、選單人數更新', await page.evaluate(() => document.getElementById('svMsg').textContent.includes('已儲存（2 人）') && document.getElementById('svEvent').textContent.includes('高爾夫（已指定 2 人）') && document.getElementById('svEvent').value === 's::高爾夫'));
  // ---------- ⑥ 系統管理者（備份提醒收件人） ----------
  ok('⑥ 一開始沒有收件人會提醒，並列出目前到期的活動', await page.evaluate(() => document.getElementById('bnChips').innerText.includes('還沒有指定任何人') && document.getElementById('bnDue').innerText.includes('高爾夫（2026-11-13）')));
  await page.select('#bnClub', '甲社'); await wait(400);
  await page.evaluate(() => { const c = document.querySelectorAll('#bnMembers input[type=checkbox]'); c[0].click(); c[2].click(); }); await wait(100);
  ok('⑥ 可勾選多人（本人＋備援）', await page.evaluate(() => document.querySelectorAll('#bnChips > span').length === 2 && document.getElementById('bnMsg').textContent === '尚未儲存'));
  await page.click('#bnSave'); await wait(400);
  const bn1 = sent.filter(x => x.action === 'cal_admin_backupnotify_save').pop();
  ok('⑥ 儲存：送出兩位收件人，並標出誰還沒綁定 LINE', !!bn1 && bn1.people.length === 2 && await page.evaluate(() => { const t = document.getElementById('bnChips').innerText; return t.includes('已綁定 LINE') && t.includes('還沒綁定 LINE') && document.getElementById('bnMsg').textContent.includes('已儲存（2 人）'); }));
  await page.click('#bnTest'); await wait(400);
  ok('⑥ 測試發送：顯示每個人的結果', sent.some(x => x.action === 'cal_admin_backupnotify_test') && await page.evaluate(() => document.getElementById('bnChips').innerText.includes('已發送') && document.getElementById('bnMsg').textContent === '已發送 1 人'));
  ok('⑤ 無 JS 錯誤', jsErr.length === 0); if (jsErr.length) console.log(jsErr);
  await browser.close();
  console.log(fail ? `❌ ${fail} 項失敗` : '全部通過'); process.exit(fail ? 1 : 0);
})();
