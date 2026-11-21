// 全球獎助金查詢（畫面）：入口按鈕、清單、篩選、詳細頁、和本地區有關（空白畫面）、匯出 Excel、尚未開放、不落地。
// 需先啟動 8000 埠：python3 -m http.server 8000。雲端小程式用假的回應；所有寫入 Supabase 的請求都擋下。
const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: 'new' }); const p = await b.newPage();
  await p.setViewport({ width: 1300, height: 900 });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const dialogs = []; p.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  const G = (n, o) => Object.assign({
    project_id: 'G-' + n, rotary_year: '2026-27', title: 'Project ' + n, country: 'Nepal', country_zh: '尼泊爾', location: 'Illam', region: 'Asia', region_zh: '亞洲',
    areas_of_focus: 'Water', areas_of_focus_zh: '水資源、衛生設施與個人衛生', description: 'English text ' + n, description_zh: '中文說明 ' + n,
    detail_url: 'https://www.matchinggrants.org/global/project' + n + '.html', total_budget: 100000, status: 'Need $50,000', status_zh: '尚缺 $50,000', remaining_amount: 50000,
    trf_requested: 20000, pledge_count: 0, pledges: [], district: '3292', host_club: 'Dhulikhel', host_partner: 'Rotary Club of Dhulikhel, District 3292',
    intl_partner: '', intl_partner_district: '', host_contact_name: 'Host ' + n, host_contact_email: 'host' + n + '@example.org', intl_contact_name: '', intl_contact_email: '',
    listed_date: '2026-11-19', last_changed: '2026-11-21', removed_from_list: null, updated_at: '2026-11-21T02:00:00Z' }, o || {});
  const ALL = [
    G(1, { title: '<img src=x onerror="window.__xss=1">Water', host_contact_email: 'javascript:alert(1)', detail_url: 'javascript:alert(2)' }),
    G(2, { country: 'Uganda', country_zh: '烏干達', region_zh: '非洲', remaining_amount: 0, status_zh: '已足額認捐', intl_partner: 'Rotary Club of Boulder, District 5450', intl_partner_district: '5450', intl_contact_name: 'Intl Two', intl_contact_email: 'two@example.org',
      pledges: [{ '認捐社': 'Kololo-Kampala', '地區': '9213', '日期': '2026-02-01', '現金': 37400, 'DDF': 10000, '合計': 47400 }, { '認捐社': 'District 6600 DDF', '地區': '6600', '日期': '2026-03-01', '現金': 0, 'DDF': 5000, '合計': 5000 }], pledge_count: 2 }),
    G(3, { country: 'Uganda', country_zh: '烏干達', region_zh: '非洲', description: 'E'.repeat(40000), description_zh: '', host_contact_name: '', host_contact_email: '' }),
  ];
  const LIST_COLS = ['project_id', 'title', 'country', 'country_zh', 'region_zh', 'areas_of_focus_zh', 'district', 'host_club', 'total_budget', 'status_zh', 'remaining_amount', 'intl_partner', 'intl_partner_district', 'listed_date', 'removed_from_list', 'host_contact_name', 'host_contact_email', 'intl_contact_name', 'intl_contact_email'];
  const lite = g => { const o = {}; LIST_COLS.forEach(c => o[c] = g[c]); return o; };
  const pick = body => ALL.filter(g => (!body.onlyOpen || g.remaining_amount > 0) && (!body.country || g.country === body.country) && (!body.keyword || (g.title + g.description_zh + g.host_club).toLowerCase().includes(body.keyword.toLowerCase())));
  const calls = []; let mode = 'ok', related = { asPartner: [], asDonor: [] }, restWrites = 0;
  await p.setRequestInterception(true);
  p.on('request', r => {
    const u = r.url(), m = r.method();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (m === 'OPTIONS' && (u.includes('/functions/v1/') || u.includes('/rest/v1/'))) return r.respond({ status: 204, headers: cors });
    if (u.includes('/functions/v1/')) {
      let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (e) {}
      calls.push(body);
      let out = { ok: true, events: [], people: [], enabled: false };
      if (String(body.action).startsWith('grants_')) {
        if (mode !== 'ok') out = { ok: false, code: mode };
        else if (body.action === 'grants_list') out = Object.assign({ ok: true, grants: pick(body).map(lite) }, body.withOptions ? { total: 3, updatedAt: '2026-11-21T02:00:00Z', countries: [{ value: 'Uganda', label: '烏干達', count: 2 }, { value: 'Nepal', label: '尼泊爾', count: 1 }], regions: [{ value: '非洲', count: 2 }, { value: '亞洲', count: 1 }] } : {});
        else if (body.action === 'grants_get') { const g = ALL.find(x => x.project_id === body.projectId); out = g ? { ok: true, grant: g } : { ok: false, code: 'GRANTS_NOT_FOUND' }; }
        else if (body.action === 'grants_related') out = Object.assign({ ok: true, district: body.district }, related);
        else if (body.action === 'grants_export') { const rows = pick(body), off = body.offset || 0; out = { ok: true, grants: rows.slice(off, off + 2), next: off + 2 < rows.length ? off + 2 : null }; }   // 假裝一批 2 筆，測分批
      }
      return r.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(out) });
    }
    if (u.includes('/rest/v1/') && m !== 'GET' && m !== 'HEAD') { restWrites++; return r.respond({ status: 200, contentType: 'application/json', headers: cors, body: '[]' }); }
    r.continue();
  });
  const ok = (n, c) => { console.log((c ? '✅ ' : '❌ ') + n); if (!c) process.exitCode = 1; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const gcalls = a => calls.filter(c => c.action === a);
  const count = () => p.$eval('#ggCount', e => e.innerText).catch(() => null);

  await p.goto('http://localhost:8000/index.html'); await wait(2500);
  await p.evaluate(() => { window.pullRemoteState = async () => {}; document.getElementById('loginClubSelect').value = '台北松山扶輪社'; document.getElementById('loginPassword').value = 'fruit8428'; document.getElementById('loginForm').dispatchEvent(new Event('submit')); });
  await wait(2000);
  ok('地區設定檔開啟時，快捷列出現「🌍 全球獎助金」', await p.$eval('#globalGrantsBtn', e => !e.classList.contains('hidden')));
  await p.evaluate(() => { DISTRICT.grantsEnabled = false; initRagAssistantButton(); });
  ok('地區設定檔關閉時，按鈕不顯示', await p.$eval('#globalGrantsBtn', e => e.classList.contains('hidden')));
  await p.evaluate(() => { DISTRICT.grantsEnabled = true; initRagAssistantButton(); });
  const lsBefore = await p.evaluate(() => JSON.stringify(Object.keys(localStorage).sort()));

  // ---- 清單 ----
  await p.click('#globalGrantsBtn'); await p.waitForSelector('.gg-card'); restWrites = 0;
  let c0 = gcalls('grants_list')[0];
  if (process.env.DBG) console.log(JSON.stringify(Object.assign({}, c0, { clubPassword: typeof c0.clubPassword })));
  ok('打開：帶社名與社密碼向雲端查詢，預設只看還在募款中', c0 && c0.club === '台北松山扶輪社' && 'clubPassword' in c0 && c0.onlyOpen === true && c0.withOptions === true);
  ok('清單：2 個募款中的計畫，顯示「全部 3 個」與資料更新日期', await count() === '2' && (await p.$eval('#ggResults', e => e.innerText)).includes('全部 3 個') && (await p.$eval('#ggUpdated', e => e.innerText)).includes('2026-11-21'));
  ok('外部文字有跳脫：計畫名稱裡的 HTML 不會執行', await p.evaluate(() => !window.__xss && !document.querySelector('.gg-card img') && document.querySelector('.gg-title').innerText.includes('<img')));
  await p.click('#ggOpen'); await wait(400);
  ok('取消「只看還在募款中」：3 個計畫', await count() === '3');
  ok('聯絡人直接顯示在清單，Email 是 mailto 連結', await p.$$eval('.gg-card', cs => cs[1].innerText.includes('Host 2') && cs[1].innerText.includes('Intl Two') && !!cs[1].querySelector('a[href="mailto:host2@example.org"]') && !!cs[1].querySelector('a[href="mailto:two@example.org"]')));
  ok('奇怪的 Email（javascript:…）不做成連結；沒留聯絡人的計畫不出錯', await p.$$eval('.gg-card', cs => !cs[0].querySelector('a[href^="mailto"]') && !document.querySelector('.gg-card a[href^="javascript"]') && cs[2].querySelectorAll('.gg-contact').length === 0));
  ok('沒有國際夥伴社顯示「尚無」', await p.$$eval('.gg-card', cs => cs[0].innerText.includes('尚無')));

  // ---- 篩選 ----
  await p.select('#ggCountry', 'Uganda'); await wait(400);
  ok('國家篩選：送出條件並更新結果', gcalls('grants_list').slice(-1)[0].country === 'Uganda' && await count() === '2');
  const nBefore = gcalls('grants_list').length;
  await p.type('#ggKw', 'Project 3'); await wait(900);
  ok('關鍵字：停止輸入後只查一次，輸入框沒有被重畫打斷', gcalls('grants_list').length === nBefore + 1 && gcalls('grants_list').slice(-1)[0].keyword === 'Project 3' && await p.evaluate(() => document.activeElement.id === 'ggKw' && document.activeElement.value === 'Project 3') && await count() === '1');

  // ---- 匯出 Excel（目前篩選：烏干達＋Project 3 → 先清關鍵字，留烏干達 2 筆） ----
  await p.evaluate(() => { const i = document.getElementById('ggKw'); i.value = ''; ggKeyword(''); }); await wait(900);
  await p.evaluate(() => { window.__wb = null; XLSX.writeFile = (wb, name) => { window.__wb = { name, aoa: XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true }), cols: wb.Sheets[wb.SheetNames[0]]['!cols'].length }; }; });
  const eBefore = gcalls('grants_export').length;
  await p.click('#ggExportBtn'); await p.waitForFunction(() => window.__wb, { timeout: 5000 });
  const wb = await p.evaluate(() => window.__wb), shown = Number(await count());
  const H = wb.aoa[0], col = n => H.indexOf(n), r2 = wb.aoa.find(r => r[0] === 'G-2'), r3 = wb.aoa.find(r => r[0] === 'G-3');
  ok('匯出：帶和畫面相同的篩選條件、分批取完', gcalls('grants_export').length === eBefore + 1 && gcalls('grants_export').slice(-1)[0].country === 'Uganda' && !gcalls('grants_export').slice(-1)[0].onlyOpen);
  ok('匯出：筆數和畫面相同（2 筆）', wb.aoa.length - 1 === shown && shown === 2);
  ok('匯出：25 個欄位，標題與順序比照爬蟲的 Excel', H.length === 25 && wb.cols === 25 && H[0] === '計畫編號' && H[6] === '總金額' && H[17] === '已認捐明細' && H[24] === '國際夥伴聯絡Email');
  ok('匯出：金額是數字', typeof r2[col('總金額')] === 'number' && r2[col('總金額')] === 100000 && r2[col('尚缺金額')] === 0 && typeof r2[col('向扶輪基金會申請金額')] === 'number' && r2[col('已認捐筆數')] === 2);
  ok('匯出：認捐明細一筆一行', r2[col('已認捐明細')] === 'Kololo-Kampala｜地區 9213｜2026-02-01｜$47,400\nDistrict 6600 DDF｜地區 6600｜2026-03-01｜$5,000');
  ok('匯出：中文正常、聯絡人欄位有內容', r2[col('國家')] === '烏干達' && r2[col('計畫說明（中文）')] === '中文說明 2' && r2[col('主辦聯絡人')] === 'Host 2' && r2[col('國際夥伴聯絡Email')] === 'two@example.org');
  ok('匯出：超過 Excel 上限的說明會截斷並註明', r3[col('計畫說明')].length <= 32000 && r3[col('計畫說明')].endsWith('…（內容過長，請至原始網站查看）'));
  ok('匯出：檔名＝全球獎助金_年度_今天日期.xlsx', /^全球獎助金_2026-27_\d{4}-\d{2}-\d{2}\.xlsx$/.test(wb.name));
  ok('匯出按鈕旁有使用提醒', (await p.$eval('#ggResults', e => e.innerText)).includes('請勿用於群發信件'));

  // ---- 詳細頁 ----
  await p.evaluate(() => ggResetFilters()); await wait(500);
  await p.evaluate(() => { document.getElementById('globalGrantsOverlay').scrollTop = 120; });
  await p.$$eval('.gg-card button', bs => bs[1].click()); await p.waitForSelector('#ggDesc');
  ok('詳細頁：預設顯示中文說明並註明機器翻譯', await p.$eval('#ggDesc', e => e.innerText) === '中文說明 2' && (await p.$eval('#ggDetail', e => e.innerText)).includes('中文為機器翻譯，僅供參考'));
  await p.click('#ggLangBtn');
  ok('詳細頁：可切換看英文原文', await p.$eval('#ggDesc', e => e.innerText) === 'English text 2');
  ok('詳細頁：認捐明細表、聯絡人、前往原始網站', await p.$$eval('#ggPledges tbody tr', t => t.length) === 2 && (await p.$eval('#ggPledges', e => e.innerText)).includes('$47,400') && await p.$eval('#ggDHost', e => e.innerText.includes('Host 2') && !!e.querySelector('a[href="mailto:host2@example.org"]')) && await p.$eval('#ggSrc', e => e.href === 'https://www.matchinggrants.org/global/project2.html' && e.target === '_blank'));
  await p.click('button[onclick="ggBack()"]');
  ok('回到清單：清單還在、不重新查詢', await count() === '3' && await p.$eval('#ggMain', e => !e.classList.contains('hidden')));
  await p.$$eval('.gg-card button', bs => bs[0].click()); await p.waitForSelector('#ggDesc');
  ok('詳細頁：不是 http 開頭的來源網址不做成連結，標題的 HTML 不執行', await p.evaluate(() => !document.getElementById('ggSrc') && !window.__xss && !document.querySelector('#ggDetail img')));
  await p.click('button[onclick="ggBack()"]');
  await p.$$eval('.gg-card button', bs => bs[2].click()); await p.waitForSelector('#ggDesc');
  ok('詳細頁：沒有中文翻譯時顯示英文、沒有聯絡人不出錯', await p.$eval('#ggDesc', e => e.innerText.startsWith('EEEE')) && await p.evaluate(() => !document.getElementById('ggLangBtn')));
  await p.click('button[onclick="ggBack()"]');

  // ---- 和本地區有關 ----
  await p.$$eval('.gg-tab', t => t[1].click()); await wait(400);
  ok('和本地區有關：用設定檔的地區代號查詢；沒有資料時顯示說明而不是錯誤', gcalls('grants_related')[0].district === '3523' && (await p.$eval('#ggResults', e => e.innerText)).includes('目前沒有和 3523 地區有關的計畫') && !(await p.$('#ggFilters select')));
  related = { asPartner: [lite(G(8, { intl_partner_district: '3523', intl_partner: 'Rotary Club of Taipei, District 3523' }))], asDonor: [lite(G(8, { intl_partner_district: '3523' })), lite(G(9))] };
  await p.evaluate(() => { gg.related = null; return ggLoadRelated(); }); await wait(300);
  ok('和本地區有關：同一計畫合併成一筆並標出角色', await count() === '2' && await p.$$eval('.gg-card', cs => cs[0].innerText.includes('本地區為國際夥伴') && cs[0].innerText.includes('本地區有認捐') && cs[1].innerText.includes('本地區有認捐')));
  await p.$$eval('.gg-tab', t => t[0].click()); await wait(200);
  ok('切回全部計畫：篩選列回來', !!(await p.$('#ggCountry')) && await count() === '3');

  // ---- 不落地、不寫入 ----
  ok('沒有把獎助金或聯絡人資料存進 localStorage', await p.evaluate(b4 => JSON.stringify(Object.keys(localStorage).sort()) === b4 && !JSON.stringify(Object.values(localStorage)).includes('example.org'), lsBefore));
  ok('整個過程沒有寫入 Supabase（不碰 app_storage）', restWrites === 0);

  // ---- 手機 ----
  await p.setViewport({ width: 390, height: 800 }); await wait(300);
  ok('手機寬度：清單不需要橫向捲動', await p.evaluate(() => { const o = document.getElementById('globalGrantsOverlay'); return o.scrollWidth <= o.clientWidth + 1 && [...document.querySelectorAll('.gg-card')].every(c => c.scrollWidth <= c.clientWidth + 1); }));
  await p.setViewport({ width: 1300, height: 900 });

  // ---- 關閉再開：沿用記憶體裡的結果 ----
  const nList = gcalls('grants_list').length;
  await p.evaluate(() => ggClose()); await p.click('#globalGrantsBtn'); await wait(300);
  ok('關閉後再打開：沿用記憶體裡的結果，不重新讀取', gcalls('grants_list').length === nList && await count() === '3');

  // ---- 尚未開放／讀取失敗 ----
  mode = 'GRANTS_NOT_CONFIGURED';
  await p.evaluate(() => { ggClose(); gg = null; }); await p.click('#globalGrantsBtn'); await p.waitForFunction(() => { const m = document.querySelector('#ggResults .gg-msg'); return m && !m.innerText.includes('讀取中'); }, { timeout: 5000 });
  ok('雲端沒設定 secrets：顯示「本地區尚未開放全球獎助金查詢」', (await p.$eval('#ggResults', e => e.innerText)).includes('本地區尚未開放全球獎助金查詢'));
  mode = 'GRANTS_READ_FAILED';
  await p.evaluate(() => { ggClose(); gg = null; }); await p.click('#globalGrantsBtn'); await p.waitForFunction(() => { const m = document.querySelector('#ggResults .gg-msg'); return m && !m.innerText.includes('讀取中'); }, { timeout: 5000 });
  ok('Rotary-Shared 讀取失敗：顯示稍後再試', (await p.$eval('#ggResults', e => e.innerText)).includes('獎助金資料暫時無法讀取'));
  await p.evaluate(() => ggClose());
  ok('獎助金出問題時其他功能照常（報名表畫面還在、可切換）', await p.evaluate(() => !document.getElementById('viewSecretary').classList.contains('hidden') && typeof updateRolePermissionsUI === 'function' && (updateRolePermissionsUI(), true)));
  ok('沒有 JavaScript 錯誤、沒有跳出警告視窗', errs.length === 0 && dialogs.length === 0);
  if (errs.length || dialogs.length) console.log(errs, dialogs);
  await b.close();
})();
