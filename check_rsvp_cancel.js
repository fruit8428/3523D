// 驗證「從報名表移除後，詢問要不要一併取消 LINE 的我要參加」（需先啟動 8000 埠）。雲端回應是假的，所有寫入 Supabase 的請求一律擋下。
const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  let calls = []; let people = []; let cancelOut = { ok: true, removed: 1 };
  await p.setRequestInterception(true);
  p.on('request', r => {
    const u = r.url(), m = r.method(), cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (m === 'OPTIONS' && u.includes('/functions/v1/')) return r.respond({ status: 204, headers: cors });
    if (u.includes('/functions/v1/line-checkin')) {
      const body = JSON.parse(r.postData() || '{}'); calls.push(body);
      const out = body.action === 'cal_desk_rsvp' ? { ok: true, linked: true, people } : body.action === 'cal_desk_rsvp_cancel' ? cancelOut : { ok: true };
      return r.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(out) });
    }
    if (u.includes('/rest/v1/') && m !== 'GET' && m !== 'HEAD') return r.respond({ status: 200, contentType: 'application/json', headers: cors, body: '[]' });
    r.continue();
  });
  p.on('dialog', d => d.dismiss());
  const ok = (n, c) => { console.log((c ? '✅ ' : '❌ ') + n); if (!c) process.exitCode = 1; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await p.goto('http://localhost:8000/index.html'); await wait(2500);
  await p.evaluate(() => { document.getElementById('loginClubSelect').value = '台北松山扶輪社'; document.getElementById('loginPassword').value = 'fruit8428'; document.getElementById('loginForm').dispatchEvent(new Event('submit')); });
  await wait(1500);
  const run = (answer, removed) => p.evaluate(async (answer, removed) => {
    window.__asked = []; window.confirm = t => { window.__asked.push(t); return answer; }; window.__alerts = []; window.alert = t => window.__alerts.push(t);
    await cdRsvpOfferCancel('sports::高球賽', '台北松山扶輪社', removed, '高球賽');
    return { asked: window.__asked, alerts: window.__alerts };
  }, answer, removed);
  const of = a => calls.filter(c => c.action === a);

  calls = []; people = [];
  let r = await run(true, [{ name: '王', nickname: 'Tom' }]);
  ok('沒有人按過「我要參加」：不詢問、不取消', r.asked.length === 0 && of('cal_desk_rsvp_cancel').length === 0);

  calls = []; people = [{ key: '李|Amy', name: '李', nickname: 'Amy' }];
  r = await run(true, [{ name: '王', nickname: 'Tom' }]);
  ok('被移除的人沒按過（按過的是別人）：不詢問', r.asked.length === 0 && of('cal_desk_rsvp_cancel').length === 0);

  calls = []; people = [{ key: '王|Tom', name: '王', nickname: 'Tom' }, { key: '李|Amy', name: '李', nickname: 'Amy' }];
  r = await run(false, [{ name: '王', nickname: 'Tom' }]);
  ok('有按過：會詢問，文字列出姓名與活動', r.asked.length === 1 && r.asked[0].includes('王 Tom') && r.asked[0].includes('高球賽') && !r.asked[0].includes('李 Amy'));
  ok('執秘按「取消」：不呼叫雲端取消', of('cal_desk_rsvp_cancel').length === 0);

  calls = [];
  r = await run(true, [{ name: '王', nickname: 'Tom' }]);
  const c = of('cal_desk_rsvp_cancel')[0];
  ok('執秘按「確定」：只送被移除者的 key，並帶活動代號與社', !!c && JSON.stringify(c.keys) === '["王|Tom"]' && c.key === 'sports::高球賽' && (c.club === '台北松山扶輪社' || c.targetClub === '台北松山扶輪社'));
  ok('成功時不跳警告', r.alerts.length === 0);

  calls = []; cancelOut = { ok: false, code: 'CLUB_AUTH_FAILED' };
  r = await run(true, [{ name: '王', nickname: 'Tom' }]);
  ok('取消失敗：提示報名表已更新、請社友自己取消', r.alerts.length === 1 && r.alerts[0].includes('報名表已經更新') && r.alerts[0].includes('取消參加'));

  calls = [];
  await p.evaluate(async () => { await cdRsvpOfferCancel('sports::高球賽', '台北松山扶輪社', [], '高球賽'); });
  ok('沒有人被移除：完全不連網', calls.length === 0);
  ok('無頁面錯誤', errs.length === 0); if (errs.length) console.log(errs);
  await b.close();
})();
