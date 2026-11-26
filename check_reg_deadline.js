// 驗證報名系統的「報名截止」：主委設定、執秘上鎖、主委仍可修改（需先啟動 8000 埠）。所有寫入 Supabase 的請求一律擋下。
const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  let writes = 0;
  await p.setRequestInterception(true);
  p.on('request', r => {
    const u = r.url(), m = r.method(), cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (m === 'OPTIONS' && (u.includes('/functions/v1/') || u.includes('/rest/v1/'))) return r.respond({ status: 204, headers: cors });
    if (u.includes('/functions/v1/')) return r.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, people: [] }) });
    if (u.includes('/rest/v1/') && m !== 'GET' && m !== 'HEAD') { writes++; return r.respond({ status: 200, contentType: 'application/json', headers: cors, body: '[]' }); }
    r.continue();
  });
  p.on('dialog', d => d.accept()); p.on('console', m => { if (m.text().startsWith('DBG')) console.log(m.text()); });
  const ok = (n, c) => { console.log((c ? '✅ ' : '❌ ') + n); if (!c) process.exitCode = 1; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await p.goto('http://localhost:8000/index.html'); await wait(2500);
  await p.evaluate(() => { document.getElementById('loginClubSelect').value = '台北松山扶輪社'; document.getElementById('loginPassword').value = 'fruit8428'; document.getElementById('loginForm').dispatchEvent(new Event('submit')); });
  await wait(1500);
  ok('「模擬封存」按鈕與函式已移除', await p.evaluate(() => typeof simulateEventDayLock === 'undefined' && !document.body.innerHTML.includes('模擬「活動當日 00:00」封存')));
  ok('主委設定有「報名截止日期／時間」欄位', await p.evaluate(() => !!document.getElementById('cfgRegDeadlineDate') && !!document.getElementById('cfgRegDeadlineTime')));
  // 選一個運動賽事（不是分攤金）
  await p.evaluate(() => { const c = categoriesData.find(x => x.id === 'sports') || categoriesData.find(x => x.allowSponsors); selectCategory(c.id); currentRole = 'super_admin'; });
  await wait(600);
  const key = await p.evaluate(() => getActivePaymentKey());
  const state = () => p.evaluate(() => ({ locked: isEventLockedToday, badge: document.getElementById('eventStatusBadge').innerText, label: document.getElementById('regStatusLabel').innerText, btn: document.getElementById('submitRegBtn').disabled, role: currentRole }));
  // 沒設定截止、沒活動日期
  await p.evaluate(k => { chairConfig.regDeadlines = {}; chairConfig.eventDates = chairConfig.eventDates || {}; delete chairConfig.eventDates[k]; refreshRegLock(); }, key);
  let s = await state();
  ok('沒設截止也沒活動日期：開放報名', !s.locked && s.badge.includes('開放報名中') && !s.btn);
  // 主委設定截止時間（欄位 → 儲存）
  await p.evaluate(() => { document.getElementById('cfgRegDeadlineDate').value = '2099-12-03'; document.getElementById('cfgRegDeadlineTime').value = '18:00'; saveChairSettings(); });
  await wait(300);
  ok('儲存後寫入 chairConfig.regDeadlines', await p.evaluate(k => chairConfig.regDeadlines[k] === '2099-12-03T18:00', key));
  s = await state();
  ok('截止時間還沒到：開放報名並顯示截止時間', !s.locked && s.badge.includes('截止') && s.badge.includes('12/3') && s.label.includes('截止 12/3'));
  await p.evaluate(() => { document.getElementById('cfgRegDeadlineTime').value = ''; saveChairSettings(); }); await wait(200);
  ok('沒填時間＝當天 23:59', await p.evaluate(k => chairConfig.regDeadlines[k] === '2099-12-03T23:59', key));
  await p.evaluate(() => refreshSubEventFeeInputs());
  ok('欄位帶回設定值（23:59 顯示為空白）', await p.evaluate(() => document.getElementById('cfgRegDeadlineDate').value === '2099-12-03' && document.getElementById('cfgRegDeadlineTime').value === ''));
  // 已截止
  await p.evaluate(k => { chairConfig.regDeadlines[k] = '2020-01-01T23:59'; refreshRegLock(); }, key);
  s = await state();
  ok('已截止＋最高管理員：顯示已截止，但仍可修改', s.role === 'super_admin' && !s.locked && s.badge.includes('報名已截止') && s.label.includes('仍可修改') && !s.btn);
  await p.evaluate(() => { currentRole = 'chair'; refreshRegLock(); }); s = await state();
  ok('已截止＋活動主委：仍可修改', !s.locked && !s.btn);
  await p.evaluate(() => { currentRole = 'secretary'; refreshRegLock(); }); s = await state();
  ok('已截止＋執秘：上鎖、送出按鈕停用', s.locked && s.btn && s.label.includes('報名已截止'));
  const before = await p.evaluate(() => { const m = (clubMemberDatabase[selectedClubName] || [])[0]; const n = currentFormSelectedMembers.length; window.__al = []; window.alert = t => window.__al.push(t); if (m) toggleMemberSelection(m.id); return { n: n, after: currentFormSelectedMembers.length, al: window.__al.join(), has: !!m }; });
  ok('已截止＋執秘：不能勾選社友', !before.has || (before.n === before.after && before.al.includes('報名已經截止')));
  const w0 = writes;
  const sub = await p.evaluate(async () => { window.__al = []; await submitRegistrationInner(); return window.__al.join(); });
  ok('已截止＋執秘：送出被擋，沒有寫入資料庫', sub.includes('報名已經截止') && writes === w0);
  // 沒設截止、活動日期已過＝自動截止
  await p.evaluate(k => { delete chairConfig.regDeadlines[k]; chairConfig.eventDates[k] = { date: '2020-01-01', start: '', end: '' }; refreshRegLock(); }, key);
  s = await state();
  ok('沒設截止、活動日期已過：自動截止（執秘上鎖）', s.locked && s.badge.includes('報名已截止'));
  await p.evaluate(k => { chairConfig.eventDates[k] = { date: '2099-01-01', start: '', end: '' }; refreshRegLock(); }, key);
  s = await state();
  ok('沒設截止、活動在未來：開放，顯示活動當天 00:00 截止', !s.locked && s.badge.includes('00:00'));
  // 分攤金：不顯示截止欄位
  const hid = await p.evaluate(() => { const c = categoriesData.find(x => /分攤金|配合款/.test(x.name || '')); if (!c) return null; selectCategory(c.id); refreshSubEventFeeInputs(); return document.body.getAttribute('data-mode') === 'apportionment' && document.getElementById('cfgEventDateRow').classList.contains('hidden') && !!document.getElementById('cfgRegDeadlineDate').closest('#cfgEventDateRow'); });
  ok('分攤金／配合款：不顯示活動日期與報名截止欄位', hid === null || hid === true);
  ok('無頁面錯誤', errs.length === 0); if (errs.length) console.log(errs);
  await b.close();
})();
