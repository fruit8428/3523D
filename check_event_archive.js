// 驗證「📦 歷屆備份與清空本活動」：用真的 index.html 與線上資料（只讀），所有寫入 Supabase 的請求都被攔下、不會真的寫入。需先啟動 8000 埠。
const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: 'new' }); const p = await b.newPage();
  let fail = 0; const ok = (n, c) => { console.log((c ? '✅ ' : '❌ ') + n); if (!c) fail++; };
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const writes = [], archives = []; let failInsert = true; const dialogs = [];
  p.on('dialog', d => { dialogs.push(d.type() + ':' + d.message().slice(0, 40)); d.accept(d.type() === 'prompt' ? '測試屆' : undefined); });
  await p.setRequestInterception(true);
  p.on('request', r => {
    const u = r.url(), m = r.method();
    if (!u.includes('.supabase.co/')) return r.continue();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (m === 'OPTIONS') return r.respond({ status: 204, headers: cors });
    const json = (status, body) => r.respond({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    const one = (r.headers()['accept'] || '').includes('vnd.pgrst.object');
    if (u.includes('/rest/v1/event_archives')) {
      if (m === 'POST') {
        if (failInsert) return json(404, { code: 'PGRST205', message: "Could not find the table 'public.event_archives' in the schema cache" });
        const row = Object.assign({ id: 100 + archives.length, archived_at: new Date().toISOString() }, JSON.parse(r.postData())); archives.push(row);
        return json(201, one ? { id: row.id } : [{ id: row.id }]);
      }
      const idm = u.match(/id=eq\.(\d+)/);
      if (idm) { const row = archives.find(a => a.id === Number(idm[1])); return row ? json(200, one ? row : [row]) : json(406, { message: 'none' }); }
      const km = decodeURIComponent(((u.match(/event_key=eq\.([^&]+)/) || [])[1] || '').replace(/\+/g, ' '));
      return json(200, archives.filter(a => a.event_key === km).map(a => Object.assign({}, a, { data: undefined })));
    }
    if (m === 'GET' || m === 'HEAD') return r.continue();
    if (u.includes('/rest/v1/rpc/checkin_event_status')) return r.continue();
    writes.push({ m, u, body: r.postData() ? JSON.parse(r.postData()) : null });      // 其餘寫入一律攔下
    return json(m === 'POST' ? 201 : 200, []);
  });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await p.goto('http://localhost:8000/index.html'); await wait(2500);
  await p.evaluate(() => { document.getElementById('loginClubSelect').value = '台北松山扶輪社'; document.getElementById('loginPassword').value = 'fruit8428'; document.getElementById('loginForm').dispatchEvent(new Event('submit')); });
  await wait(2500);
  // 找一個有繳費紀錄的活動與一個有報名表的活動（線上現有資料）
  const pick = await p.evaluate(() => {
    const out = {};
    categoriesData.forEach(c => (c.subEvents || []).forEach((s, i) => {
      const key = c.id + '::' + s;
      if (!out.pay && Object.keys((chairPaymentRecords || {})[key] || {}).length) out.pay = { cat: c.id, i, key, sub: s, n: Object.keys(chairPaymentRecords[key]).length };
      if (!out.ord && ((registrationOrders || {})[s] || []).length) out.ord = { cat: c.id, i, key, sub: s, n: registrationOrders[s].length };
    }));
    out.role = currentRole; out.payKeys = Object.keys(chairPaymentRecords || {}).length; out.ordKeys = Object.keys(registrationOrders || {}).filter(k => (registrationOrders[k] || []).length).length;
    return out;
  });
  ok('以最高管理員登入，線上有可測的資料', pick.role === 'super_admin' && !!pick.pay && !!pick.ord);
  const go = async (x) => { await p.evaluate((x) => { selectCategory(x.cat); changeSubEvent(x.i); }, x); await wait(1200); };
  await go(pick.pay);
  ok('面板出現、顯示尚無備份，最高管理員有「備份並清空」按鈕', await p.evaluate(() => { renderArchivePanel(); return !document.getElementById('eventArchiveSection').classList.contains('hidden') && document.getElementById('archiveBadge').innerText === '尚無備份' && document.getElementById('archivePanelBody').innerHTML.includes('archiveAndResetCurrentEvent'); }));
  ok('面板文字帶出目前選到的子活動名稱（標題說明、清單、清空按鈕）', await p.evaluate((sub) => { const sec = document.getElementById('eventArchiveSection'), t = sec.textContent, n = '「' + sub + '」'; return [...sec.querySelectorAll('.archive-event-name')].every(e => e.textContent === n) && t.includes(n + '還沒有任何備份') && t.includes('備份並清空' + n) && !t.includes('這個活動') && !t.includes('這一個活動'); }, pick.pay.sub));
  ok('活動主委看得到備份清單，但沒有清空按鈕', await p.evaluate(() => { const r = currentRole; currentRole = 'chair'; renderArchivePanel(); const h = document.getElementById('archivePanelBody').innerHTML; currentRole = r; renderArchivePanel(); return h.includes('歷屆備份') && !h.includes('archiveAndResetCurrentEvent'); }));
  const preWrites = writes.map(w => w.m + ' ' + w.u.split('.supabase.co')[1].slice(0, 60)); if (preWrites.length) console.log('（登入與切換活動時頁面原本就會送出的寫入，已攔下）', preWrites);
  writes.length = 0;
  ok('不是最高管理員直接呼叫也被擋', await p.evaluate(async () => { const r = currentRole; currentRole = 'chair'; await archiveAndResetCurrentEvent(); currentRole = r; return true; }) && dialogs.pop().includes('權限限制') && writes.length === 0);
  const remotePayKeys = await p.evaluate(async () => Object.keys(((await supabaseClient.from('app_storage').select('value').eq('key', 'rotary_3523_payment_records_v1').maybeSingle()).data || {}).value || {}));
  // 備份寫入失敗 → 不清空
  writes.length = 0;
  await p.evaluate(() => archiveAndResetCurrentEvent()); await wait(1500);
  ok('備份寫入失敗時：不清空、不存檔', writes.length === 0 && await p.evaluate((k) => Object.keys(chairPaymentRecords[k] || {}).length, pick.pay.key) === pick.pay.n && dialogs.some(d => d.includes('備份失敗')));
  // 正常流程：有繳費紀錄的活動
  failInsert = false; writes.length = 0;
  await p.evaluate(() => archiveAndResetCurrentEvent()); await wait(2500);
  const a1 = archives[0];
  ok('備份內容：活動、名稱、繳費紀錄筆數、統計與分區快照', !!a1 && a1.event_key === pick.pay.key && a1.label === '測試屆' && Object.keys(a1.data.payments).length === pick.pay.n && a1.summary.paymentCount === pick.pay.n && a1.summary.stats.ok === true && a1.data.divisions.length > 0 && a1.archived_by === '最高管理員');
  const payW = writes.find(w => w.u.includes('app_storage') && w.body && w.body.key === 'rotary_3523_payment_records_v1');
  const mainW = writes.filter(w => w.u.includes('app_storage') && w.body && w.body.key === 'rotary_3523_spa_data_v3').pop();
  ok('清空：只拿掉這個活動的繳費紀錄，其他活動的保留', !!payW && !(pick.pay.key in payW.body.value) && Object.keys(payW.body.value).length === remotePayKeys.length - 1 && remotePayKeys.filter(k => k !== pick.pay.key).every(k => k in payW.body.value));
  ok('清空：其他活動的報名表、費用設定、主委指派都還在', !!mainW && (mainW.body.value.registrationOrders[pick.ord.sub] || []).length === pick.ord.n && !!mainW.body.value.chairConfig && !!mainW.body.value.appAuthData && Object.keys(mainW.body.value.clubMemberDatabase || {}).length > 0);
  ok('清空後面板顯示 1 份備份與摘要', await p.evaluate(() => document.getElementById('archiveBadge').innerText === '已有 1 份備份' && document.getElementById('archivePanelBody').innerText.includes('測試屆') && document.getElementById('archivePanelBody').innerText.includes('已繳')));
  await p.evaluate((id) => viewEventArchive(id), a1.id); await wait(600);
  ok('查看備份：列出各社與繳費狀態', await p.evaluate((n) => { const ov = document.getElementById('archiveViewerOverlay'); return !!ov && ov.querySelectorAll('tbody tr').length === n && ov.innerText.includes('已繳'); }, pick.pay.n));
  await p.evaluate(() => closeEventArchiveViewer());
  // 有報名表的活動
  await go(pick.ord);
  ok('切換子活動後，面板上的活動名稱跟著換', await p.evaluate((sub) => { const sec = document.getElementById('eventArchiveSection'); return [...sec.querySelectorAll('.archive-event-name')].every(e => e.textContent === '「' + sub + '」') && sec.textContent.includes('備份並清空「' + sub + '」'); }, pick.ord.sub));
  writes.length = 0;
  await p.evaluate(() => archiveAndResetCurrentEvent()); await wait(2500);
  const a2 = archives[1], mainW2 = writes.filter(w => w.u.includes('app_storage') && w.body && w.body.key === 'rotary_3523_spa_data_v3').pop();
  ok('有報名表的活動：備份含報名表與人數，清空後只少這個活動', !!a2 && a2.data.orders.length === pick.ord.n && a2.summary.stats.people > 0 && !!mainW2 && !(pick.ord.sub in mainW2.body.value.registrationOrders) && Object.keys(mainW2.body.value.registrationOrders).filter(k => (mainW2.body.value.registrationOrders[k] || []).length).length === pick.ordKeys - 1);
  await p.evaluate((id) => viewEventArchive(id), a2.id); await wait(600);
  ok('查看備份：列出報名名單', await p.evaluate(() => { const ov = document.getElementById('archiveViewerOverlay'); return !!ov && ov.querySelectorAll('tbody tr').length > 0 && /\d/.test(ov.querySelector('tbody tr td:nth-child(3)').innerText); }));
  await p.evaluate(() => closeEventArchiveViewer());
  const xl = await p.evaluate(async (id) => { let got = null; const orig = XLSX.writeFile; XLSX.writeFile = (wb, name) => { got = { name, sheets: wb.SheetNames, detail: XLSX.utils.sheet_to_json(wb.Sheets['報名明細'], { header: 1 }).length }; }; await exportEventArchiveExcel(id); XLSX.writeFile = orig; return got; }, a2.id);
  ok('Excel：六個工作表，報名明細有資料', !!xl && xl.sheets.join() === '摘要,各社彙總,報名明細,繳費紀錄,銀行入帳,報到紀錄' && xl.detail > 1 && xl.name.includes('測試屆'));
  // 沒有任何資料的活動：提示不需要清空（線上找一個空的活動）
  const empty = await p.evaluate(() => { let r = null; categoriesData.forEach(c => (c.subEvents || []).forEach((s, i) => { if (!r && !((registrationOrders || {})[s] || []).length && !Object.keys((chairPaymentRecords || {})[c.id + '::' + s] || {}).length && /社慶|桌球|羽毛球/.test(s)) r = { cat: c.id, i }; })); return r; });
  if (empty) { await go(empty); writes.length = 0; const n0 = archives.length; await p.evaluate(() => archiveAndResetCurrentEvent()); await wait(1500);
    ok('沒有資料的活動：提示不需要清空、不備份也不寫入', writes.length === 0 && archives.length === n0 && dialogs.some(d => d.includes('不需要清空'))); }
  ok('無 JS 錯誤', errs.length === 0); if (errs.length) console.log(errs);
  console.log(fail ? `有 ${fail} 項失敗` : '全部通過');
  await b.close();
})();
