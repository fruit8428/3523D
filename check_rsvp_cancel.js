// 驗證「從報名表移除後同步清掉行事曆上的舊登記」與「社友在 LINE 報名／取消 → 併進執秘的報名表」（需先啟動 8000 埠）。雲端回應是假的，所有寫入 Supabase 的請求一律擋下。
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
  ok('沒有舊的登記紀錄：不呼叫取消', r.asked.length === 0 && of('cal_desk_rsvp_cancel').length === 0);

  calls = []; people = [{ key: '李|Amy', name: '李', nickname: 'Amy' }];
  r = await run(true, [{ name: '王', nickname: 'Tom' }]);
  ok('被移除的人沒有舊紀錄（有紀錄的是別人）：不呼叫取消', of('cal_desk_rsvp_cancel').length === 0);

  calls = []; people = [{ key: '王|Tom', name: '王', nickname: 'Tom' }, { key: '李|Amy', name: '李', nickname: 'Amy' }];
  r = await run(true, [{ name: '王', nickname: 'Tom' }]);
  const c = of('cal_desk_rsvp_cancel')[0];
  ok('有舊紀錄：直接同步取消，不再詢問執秘', r.asked.length === 0 && !!c);
  ok('只送被移除者的 key，並帶活動代號與社', !!c && JSON.stringify(c.keys) === '["王|Tom"]' && c.key === 'sports::高球賽' && (c.club === '台北松山扶輪社' || c.targetClub === '台北松山扶輪社'));
  ok('不跳警告', r.alerts.length === 0);

  calls = []; cancelOut = { ok: false, code: 'CLUB_AUTH_FAILED' };
  r = await run(true, [{ name: '王', nickname: 'Tom' }]);
  ok('取消失敗：不打擾執秘（報名表已經存好）', r.alerts.length === 0 && r.asked.length === 0);

  calls = [];
  await p.evaluate(async () => { await cdRsvpOfferCancel('sports::高球賽', '台北松山扶輪社', [], '高球賽'); });
  ok('沒有人被移除：完全不連網', calls.length === 0);

  // ---------- 社友在 LINE 報名／取消 → 併進執秘正在看的報名表（三方比對） ----------
  const m = await p.evaluate(() => {
    const cat = categoriesData.find(c => c.id === currentCatId), sub = cat.subEvents[currentSubEventIndex], club = selectedClubName;
    const it = (name, part) => ({ role: '社友', name: name, nickname: '', diet: 'MEAT', veganNote: '', handicap: '', participation: part || '參賽', fee: 100 });
    const setOrder = items => { registrationOrders[sub] = (registrationOrders[sub] || []).filter(o => o.clubName !== club); if (items) registrationOrders[sub].push({ clubName: club, sponsorTier: 'PARTICIPANT', sponsorAmount: 0, participantFee: 0, apportionmentFee: 0, grandTotal: 0, submittedAt: 'x', prizeSponsors: [], items: items }); };
    const form = () => currentFormSelectedMembers.map(x => x.name + (x.participation === '只用餐' ? '(餐)' : '')).join();
    const out = {};
    // 起點：報名表裡有甲、乙；執秘的表單載入後，自己又勾了丙（還沒送出）、取消了乙（還沒送出）
    setOrder([it('甲'), it('乙')]); currentFormSelectedMembers = [it('甲'), it('乙')]; setFormOrderBase();
    currentFormSelectedMembers = [it('甲'), it('丙')];
    // 雲端：丁在 LINE 報名
    setOrder([it('甲'), it('乙'), it('丁')]); mergeRemoteOrderIntoForm(); out.add = form();
    // 雲端：甲在 LINE 取消
    setOrder([it('乙'), it('丁')]); mergeRemoteOrderIntoForm(); out.remove = form();
    // 雲端：丁在 LINE 改成只用餐
    setOrder([it('乙'), it('丁', '只用餐')]); mergeRemoteOrderIntoForm(); out.part = form();
    // 雲端沒變：再比一次不應該有任何變化
    mergeRemoteOrderIntoForm(); out.same = form();
    // 雲端：最後的人也取消，整張報名表不見了
    setOrder(null); mergeRemoteOrderIntoForm(); out.gone = form();
    // 雲端：有人在 LINE 報名，重新出現一張報名表
    setOrder([it('戊')]); mergeRemoteOrderIntoForm(); out.back = form();
    setOrder(null); currentFormSelectedMembers = []; setFormOrderBase();
    return out;
  });
  ok('社友在 LINE 報名：加進表單，執秘自己勾的（丙）與自己取消的（乙）不受影響', m.add === '甲,丙,丁');
  ok('社友在 LINE 取消：從表單拿掉', m.remove === '丙,丁');
  ok('社友在 LINE 改成只用餐：表單跟著改', m.part === '丙,丁(餐)');
  ok('雲端沒變：表單不動', m.same === '丙,丁(餐)');
  ok('整張報名表被取消：LINE 加的人拿掉，執秘自己勾的保留', m.gone === '丙');
  ok('之後又有人在 LINE 報名：加回表單', m.back === '丙,戊');
  ok('無頁面錯誤', errs.length === 0); if (errs.length) console.log(errs);
  await b.close();
})();
