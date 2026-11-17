// 驗證 Excel 匯入行程的讀檔規則（calendar-desk.js 的 cdImpParse／cdImpDate／cdImpTime），純 node，不需 8000 埠。
const fs = require('fs'), vm = require('vm');
const ctx = { console, Date, Math, Number, String, Array, Object, JSON, Set, Map, RegExp, setTimeout };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/calendar-desk.js', 'utf8') + '\n;this.P = { cdImpParse, cdImpDate, cdImpTime, cdImpBool };', ctx);
const { cdImpParse, cdImpDate, cdImpTime } = ctx.P;
let fail = 0; const ok = (n, c) => { console.log((c ? '✅ ' : '❌ ') + n); if (!c) fail++; };
ok('日期：2026/12/5、2026-12-05、2026.12.5、民國 115/12/5、2026年12月5日、20261205', ['2026/12/5', '2026-12-05', '2026.12.5', '115/12/5', '民國115/12/05', '2026年12月5日', '20261205', '２０２６／１２／５'].every(v => cdImpDate(v) === '2026-12-05'));
ok('日期：Excel 日期數字 46361 ＝ 2026/12/05', cdImpDate(46361) === '2026-12-05');
ok('日期：帶星期「2026/12/5（六）」也看得懂', cdImpDate('2026/12/5（六）') === '2026-12-05');
ok('日期：不存在的日期、亂寫 → null；空白 → 空字串', cdImpDate('2026/2/30') === null && cdImpDate('明天') === null && cdImpDate('12/5') === null && cdImpDate('') === '');
ok('時間：19:00、7:00 PM、下午7:00、晚上7點、1900、19、19時30分、7點半', cdImpTime('19:00') === '19:00' && cdImpTime('7:00 PM') === '19:00' && cdImpTime('下午7:00') === '19:00' && cdImpTime('晚上7點') === '19:00' && cdImpTime('1900') === '19:00' && cdImpTime(19) === '19:00' && cdImpTime('19時30分') === '19:30' && cdImpTime('7點半') === '07:30');
ok('時間：Excel 時間 0.791666 ＝ 19:00；上午12:00 ＝ 00:00；中午12:30', cdImpTime(19 / 24) === '19:00' && cdImpTime('上午12:00') === '00:00' && cdImpTime('中午12:30') === '12:30');
ok('時間：25:00、亂寫 → null', cdImpTime('25:00') === null && cdImpTime('晚餐後') === null);
const types = [{ id: 1, name: '例會' }, { id: 4, name: '授證典禮' }, { id: 10, name: '其他' }];
const head = ['日期', '開始時間', '結束時間', '全天', '標題', '活動類型', '地點', '地址', '服裝', '聯絡人', '聯絡電話', '備註', '結束日期（多天活動才填）', '開放我要參加'];
const r = cdImpParse([
  ['行程匯入'],                                    // 標題列前面有說明文字也找得到
  head,
  ['2026/12/05', '19:00', '21:00', '否', '授證典禮', '授證典禮', '飯店', '台北市', '正式', '王', '0912', '', '', ''],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', ''],          // 空白列略過
  ['2026/12/12', '', '', '', '淨灘', '社區服務', '八里', '', '', '', '', '', '', '否'],
  ['2027/01/16', '09:00', '17:00', '', '地區年會', '', '', '', '', '', '', '', '2027/01/17', ''],
  ['2026/13/01', '19:00', '', '', '', '', '', '', '', '', '', '', '', ''],
  ['2026/12/20', '21:00', '19:00', '', '時間顛倒', '', '', '', '', '', '', '', '', ''],
  [46361, 19 / 24, '', '是', '全天但有時間', '例會', '', '', '', '', '', '', '', ''],
], types);
const R = n => r.rows.find(x => x.row === n);
ok('找到標題列（第 2 列）、空白列略過，共 6 筆', r.ok && r.rows.length === 6 && r.rows[0].row === 3);
ok('第 3 列：19:00–21:00、類型＝授證典禮、預設開放我要參加', !R(3).errors.length && R(3).ev.start === '2026-12-05T19:00:00+08:00' && R(3).ev.end === '2026-12-05T21:00:00+08:00' && R(3).ev.typeId === 4 && R(3).ev.rsvpEnabled === true && !R(3).ev.allDay);
ok('第 5 列：沒填時間＝全天（00:00～23:59）、找不到類型歸「其他」並提醒、我要參加填否', R(5).ev.allDay && R(5).ev.start === '2026-12-12T00:00:00+08:00' && R(5).ev.end === '2026-12-12T23:59:00+08:00' && R(5).ev.typeId === 10 && R(5).warns.join().includes('社區服務') && R(5).ev.rsvpEnabled === false);
ok('第 6 列：跨天活動，結束＝隔天 17:00；類型空白＝未分類', R(6).ev.end === '2027-01-17T17:00:00+08:00' && R(6).ev.typeId === null && !R(6).errors.length);
ok('第 7 列：日期錯誤＋缺少標題，兩個原因都列出', R(7).errors.length === 2 && R(7).errors[0].includes('日期看不懂') && R(7).errors[1] === '缺少標題');
ok('第 8 列：結束時間早於開始時間', R(8).errors.join() === '結束時間早於開始時間');
ok('第 9 列：Excel 數字日期＋全天填是 → 全天，並提醒時間不採用', R(9).ev.allDay && R(9).ev.start === '2026-12-05T00:00:00+08:00' && R(9).warns.join().includes('全天'));
ok('沒有「日期」「標題」欄位 → 清楚的錯誤訊息', cdImpParse([['名稱', '時間'], ['x', '1']], types).error.includes('日期'));
ok('只有標題列 → 沒有資料的錯誤訊息', cdImpParse([head], types).error.includes('沒有任何行程'));
ok('欄位名稱有別名也認得（活動名稱、類別、電話）', (() => { const x = cdImpParse([['活動日期', '活動名稱', '類別', '電話'], ['2026/12/5', 'A', '例會', '02']], types); return x.ok && x.rows[0].ev.title === 'A' && x.rows[0].ev.typeId === 1 && x.rows[0].ev.contactPhone === '02'; })());
console.log(fail ? `❌ ${fail} 項失敗` : '全部通過'); process.exit(fail ? 1 : 0);
