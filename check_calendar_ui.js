const puppeteer = require('puppeteer');
const fs = require('fs');
const src = fs.readFileSync('' + __dirname + '/calendar.js', 'utf8');
const html = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><script src="https://cdn.tailwindcss.com"></script><body class="bg-slate-100 px-4 py-4">
<h1 id=hdTitle></h1><div id=idCard></div><div id=viewMessage class=hidden></div><div id=viewBind class=hidden></div><div id=toast></div>
<main><div id=viewCalendar class=hidden></div></main>
<style>.hidden{display:none!important}</style>
<script>
const $=id=>document.getElementById(id);
const E=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function show(id){['viewMessage','viewBind','viewCalendar'].forEach(v=>$(v).classList.toggle('hidden',v!==id));}
function toast(m){window.__toast=m}; function errText(c){return c}; function showMessage(){}; function showBind(){}
let busy=false; const binding={name:'王小明',club:'甲社',key:'王小明|'};
const now=Date.now(); const iso=(o,h)=>{const d=new Date(now+o*86400e3+8*3600e3);return d.toISOString().slice(0,10)+'T'+String(h).padStart(2,'0')+':00:00+08:00'};
let store=[{id:'1',layer:'district',club:'',joined:null,registrationKey:'k::高球賽',title:'地區大會',start:iso(0,9),end:iso(0,17),allDay:false,typeId:1,location:'某飯店',address:'台北市信義路1號',dressCode:'正式',contactPerson:'王',contactPhone:'0912-345-678',notes:'備註\\n第二行',status:'confirmed',canEdit:true},
{id:'2',layer:'club',club:'甲社',title:'甲社例會',start:iso(1,19),end:iso(1,21),allDay:false,typeId:null,location:'',address:'',dressCode:'',contactPerson:'',contactPhone:'',notes:'',status:'cancelled',canEdit:false},
{id:'3',layer:'private',club:'甲社',title:'<b>私人</b>',start:iso(2,0),end:iso(2,0).replace('T00','T23'),allDay:true,typeId:null,location:'',address:'',dressCode:'',contactPerson:'',contactPhone:'',notes:'',status:'confirmed',canEdit:true}];
store.push({id:'far',layer:'district',club:'',joined:null,title:'十天後的行程',start:iso(10,9),end:iso(10,10),allDay:false,typeId:null,location:'',address:'',dressCode:'',contactPerson:'',contactPhone:'',notes:'',status:'confirmed',canEdit:false});
store.push({id:'meet',layer:'club',club:'甲社',joined:null,rsvpEnabled:true,registrationKey:'',title:'甲社例會',start:iso(0,19),end:iso(0,21),allDay:false,typeId:null,location:'',address:'',dressCode:'',contactPerson:'',contactPhone:'',notes:'',status:'confirmed',canEdit:false});
window.__calls=[];
async function api(a,x){window.__calls.push([a,x]);
 if(a==='cal_init')return{ok:true,me:binding,roles:{district:true,clubs:['甲社'],governor:false},types:[{id:1,name:'地區活動'}]};
 if(a==='cal_list')return{ok:true,events:store};
 if(a==='cal_save'){const e=x.event;const n=Object.assign({id:e.id||'n'+store.length,layer:e.layer||'private',club:e.club||'',status:'confirmed',canEdit:true},e);if(e.id)store=store.map(s=>s.id===e.id?n:s);else store.push(n);return{ok:true,event:n};}
 if(a==='cal_rsvp_status'||a==='cal_rsvp_set'){
   if(a==='cal_rsvp_set'){__rs.mine=x.join?'interested':null; __rs.guests=x.join?(x.guestKeys||[]):[];}
   const isMeet = x.id==='meet';
   const people=(isMeet?[]:[{key:'趙|',name:'趙',nickname:'',status:'registered',guestOf:'',role:''}]).concat(__rs.others).concat(__rs.mine?[{key:binding.key,name:'王小明',nickname:'',status:__rs.mine,guestOf:'',role:''}]:[]).concat((__rs.guests||[]).map(k=>({key:k,name:'王太太',nickname:'',status:'interested',guestOf:binding.key,role:'寶(尊)眷'})));
   const out={ok:true,linked:true,title:isMeet?'甲社例會':'高球賽',open:true,mine:__rs.mine,people,registeredCount:isMeet?0:1,interestedCount:people.filter(p=>p.status==='interested').length,myGuests:__rs.guests||[]};
   if(!x.poll) out.family=[{key:'妻|',name:'王太太',nickname:'',role:'寶(尊)眷',registered:false}];
   return out; }
 if(a==='cal_attend_report'){ if(x.scope==='club'&&!__arCan) return {ok:false,code:'CAL_FORBIDDEN'};
   const S=(h,at,mk,man)=>({held:h,attended:at,makeup:mk+(man||0),district:mk,manual:man||0,effective:at+mk+(man||0),rate:h?(at+mk+(man||0))/h:null,meetRate:h?at/h:null,rsvp:0});
   const me={key:binding.key,name:'王小明',nickname:'Ming',role:'社友',guest:false,left:false,att:['a'],rsvp:[],dist:['s::地區高球'],mk:[5],sum:{h1:S(2,1,1,1),year:S(3,1,1,1)}};
   const others=[{key:'李|Amy',name:'李大華',nickname:'Amy',role:'社友',guest:false,left:false,att:['b'],rsvp:[],dist:[],sum:{h1:S(2,1,0),year:S(3,1,0)}},{key:'妻|',name:'王太太',nickname:'',role:'寶(尊)眷',guest:true,left:false,att:[],rsvp:[],dist:[],sum:{h1:S(2,0,0),year:S(3,0,0)}}];
   return {ok:true,club:'甲社',scope:x.scope,canClub:__arCan,me:binding.key,periods:[{id:'h1',held:2},{id:'year',held:3}],
     meetings:[{id:'a',title:'一月例會',start:'2027-01-06T11:00:00.000Z',recorded:true},{id:'b',title:'二月例會',start:'2027-02-03T11:00:00.000Z',recorded:true},{id:'c',title:'三月例會',start:'2027-03-03T11:00:00.000Z',recorded:false}],
     district:[{key:'s::地區高球',title:'地區高球',date:'2027-02-10T01:00:00.000Z'}], manual:[{id:5,key:binding.key,name:'王小明',date:'2027-03-10',kind:'友社例會',note:'台北東區扶輪社例會'}], people:x.scope==='club'?[me].concat(others):[me]}; }
 if(a==='cal_ics_status')return Object.assign({ok:true},__ics);
 if(a==='cal_ics_set'){__ics=x.enabled?{enabled:true,token:__ics.token||'tok1_'+'a'.repeat(30)}:{enabled:false,token:null};return Object.assign({ok:true},__ics);}
 if(a==='cal_ics_rotate'){__ics={enabled:true,token:'tok2_'+'b'.repeat(30)};return Object.assign({ok:true},__ics);}
 if(a==='cal_cancel'){store=store.map(s=>s.id===x.id?Object.assign(s,{status:x.cancelled===false?'confirmed':'cancelled'}):s);return{ok:true};}
 return{ok:true};}
window.confirm=()=>true; const FN_URL='https://x.supabase.co/functions/v1/line-checkin'; let __ics={enabled:false,token:null}; let __rs={mine:null,others:[],guests:[]}; let __arCan=false;
</script><script>${src}</script></body>`;
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage(); await p.setViewport({ width: 390, height: 800 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.setContent(html, {waitUntil:'networkidle0'}); await p.evaluate(() => calendarStart()); await new Promise(r => setTimeout(r, 300));
  const t = () => p.evaluate(() => document.getElementById('viewCalendar').innerText);
  const ok = (n, c) => { console.log((c ? '✅ ' : '❌ ') + n); if (!c) process.exitCode = 1; };
  let s = await t(); ok('本週列表顯示地區大會', s.includes('地區大會'));
  ok('XSS 標題被跳脫', !(await p.evaluate(() => document.querySelector('#calBody b'))));
  ok('預設畫面：所有行程＋今天', await p.evaluate(() => calPrefs.layer === 'all' && calPrefs.range === 'today'));
  await p.evaluate(() => calSetRange('week')); await new Promise(r => setTimeout(r, 200));
  await p.evaluate(() => calSetLayer('private')); s = await t(); ok('只看私人：沒有地區大會', !s.includes('地區大會') && s.includes('私人'));
  await p.evaluate(() => calSetLayer('club')); s = await t(); ok('社內：已取消標示', s.includes('已取消') && s.includes('甲社例會'));
  await p.evaluate(() => { calSetLayer('all'); calSetRange('month'); }); await new Promise(r => setTimeout(r, 200));
  ok('月曆格有 7 欄日期列', (await p.evaluate(() => document.querySelectorAll('#calBody .grid-cols-7 button').length)) >= 28);
  await p.evaluate(() => calSetRange('today')); await new Promise(r => setTimeout(r, 200)); s = await t(); ok('今天：看到地區大會', s.includes('地區大會'));
  await p.evaluate(() => calSetRange('three')); await new Promise(r => setTimeout(r, 200)); s = await t(); ok('三天：看到多筆', s.includes('甲社例會'));
  await p.evaluate(() => calOpenDetail('1')); s = await t();
  ok('詳細頁：地圖、電話、編輯按鈕', s.includes('在 Google 地圖開啟') && s.includes('0912-345-678') && s.includes('編輯') && s.includes('複製'));
  ok('電話連結 tel:', await p.evaluate(() => !!document.querySelector('a[href="tel:0912345678"]')));
  await p.evaluate(() => calBack()); await p.evaluate(() => calOpenDetail('1')); await new Promise(r => setTimeout(r, 300)); s = await t();
  ok('有對應報名的行程：顯示社內報名狀況、已報名的人與「我要參加」', s.includes('報名狀況') && s.includes('趙') && s.includes('我要參加'));
  await p.evaluate(() => calRsvp(true)); await new Promise(r => setTimeout(r, 300)); s = await t();
  ok('按「我要參加」後：名單出現自己（我）、顯示已表示參加與取消按鈕', s.includes('您已表示要參加') && s.includes('王小明') && s.includes('（我）') && s.includes('取消參加'));
  await p.evaluate(() => calRsvp(false)); await new Promise(r => setTimeout(r, 300)); s = await t();
  ok('取消參加後回到「我要參加」', s.includes('我要參加') && !s.includes('您已表示要參加'));
  // 我參加的活動 → 私人頁
  await p.evaluate(() => { calBack(); calSetRange('week'); calSetLayer('private'); }); await new Promise(r => setTimeout(r, 300)); s = await t();
  ok('私人頁：還沒參加的地區行程不會出現', !s.includes('地區大會'));
  await p.evaluate(() => { calSetLayer('all'); calOpenDetail('1'); }); await new Promise(r => setTimeout(r, 300));
  await p.evaluate(() => calRsvp(true)); await new Promise(r => setTimeout(r, 300));
  await p.evaluate(() => { calBack(); calSetLayer('private'); }); await new Promise(r => setTimeout(r, 300)); s = await t();
  ok('按了「我要參加」後：私人頁看得到這個地區活動，標 🔗 與「已表示參加」', s.includes('地區大會') && s.includes('🔗') && s.includes('已表示參加'));
  ok('私人頁的地區活動保留原層級顏色（藍色）', await p.evaluate(() => { const bar = document.querySelector('#calBody button span[style*="background"]'); return !!bar && /rgb\(23, 69, 143\)|#17458f/i.test(bar.style.background); }));
  await p.evaluate(() => { calOpenDetail('1'); }); await new Promise(r => setTimeout(r, 300));
  await p.evaluate(() => calRsvp(false)); await new Promise(r => setTimeout(r, 300));
  await p.evaluate(() => { calBack(); }); await new Promise(r => setTimeout(r, 300)); s = await t();
  ok('取消參加後：私人頁不再顯示', !s.includes('地區大會'));
  await p.evaluate(() => { calSetLayer('all'); calSetRange('two'); }); await new Promise(r => setTimeout(r, 300)); s = await t();
  ok('範圍列有「今天／三天／本週／二週／本月」五個，順序正確', await p.evaluate(() => Array.from(document.querySelectorAll('#calRangeTabs button')).map(b => b.innerText.trim()).join() === '今天,三天,本週,二週,本月'));
  ok('二週：涵蓋 14 天，10 天後的行程看得到（本週看不到）', s.includes('十天後的行程') && await p.evaluate(() => { const r = calRange(); return (r.to - r.from) === 14 * 86400e3; }));
  await p.evaluate(() => calSetRange('week')); await new Promise(r => setTimeout(r, 300));
  ok('本週：看不到 10 天後的行程', !(await t()).includes('十天後的行程'));
  await p.evaluate(() => { calSetRange('two'); calShift(1); }); await new Promise(r => setTimeout(r, 300));
  ok('二週按 › 一次翻兩週', await p.evaluate(() => { const r = calRange(); return (r.from - (todayStartMs() - ((tpParts(todayStartMs()).wd + 6) % 7) * 86400e3)) === 14 * 86400e3; }));
  await p.evaluate(() => { calGoToday(); calSetRange('two'); calSetLayer('all'); }); await new Promise(r => setTimeout(r, 300));
  await p.screenshot({ path: require('os').tmpdir() + '/cal_two.png' });
  await p.evaluate(() => { calGoToday(); calSetRange('today'); });
  // 社內例會：開放參加（沒有對應報名活動）＋ 寶尊眷
  await p.evaluate(() => { calBack(); calSetLayer('all'); calSetRange('today'); }); await new Promise(r => setTimeout(r, 300));
  await p.evaluate(() => calOpenDetail('meet')); await new Promise(r => setTimeout(r, 400)); s = await t();
  ok('例會（開放參加、沒有對應報名活動）：有「參加狀況」與「我要參加」', s.includes('參加狀況') && s.includes('我要參加') && !s.includes('報名狀況'));
  ok('顯示社友庫帶出的寶尊眷選項（王太太）', s.includes('寶尊眷一起參加') && s.includes('王太太'));
  await p.evaluate(() => { const c = document.querySelector('#calReg input[type=checkbox][data-key="妻|"]'); c.checked = true; calGuestToggle('妻|', true); });
  await p.evaluate(() => calRsvp(true)); await new Promise(r => setTimeout(r, 400)); s = await t();
  const gk = await p.evaluate(() => window.__calls.filter(c => c[0] === 'cal_rsvp_set').pop()[1].guestKeys);
  ok('勾選寶眷後送出：guestKeys 含該寶眷', gk.length === 1 && gk[0] === '妻|');
  ok('參加後：名單有本人與「王太太（寶尊眷）」，人數含寶尊眷，並有「更新寶尊眷」「取消參加」', s.includes('您已表示要參加') && s.includes('王太太') && s.includes('寶尊眷）') && s.includes('表示參加 2 人') && s.includes('更新寶尊眷') && s.includes('取消參加'));
  await p.evaluate(() => { document.getElementById('calReg').scrollIntoView(); }); await p.screenshot({ path: require('os').tmpdir() + '/cal_guest.png' });
  ok('寶眷的勾選保持勾選', await p.evaluate(() => document.querySelector('#calReg input[data-key="妻|"]').checked));
  // 自動更新（不含家人名單）時，寶尊眷選項仍在；使用者正在改的勾選不被洗掉
  await p.evaluate(() => { calGuestToggle('妻|', false); __rs.others = [{ key: '甲|', name: '甲社友', nickname: '', status: 'interested', guestOf: '', role: '' }]; }); await p.evaluate(() => calRegPoll()); await new Promise(r => setTimeout(r, 300));
  ok('自動更新後：新名單出現、寶尊眷選項仍在、使用者取消勾選的狀態保留', (await t()).includes('甲社友') && await p.evaluate(() => { const c = document.querySelector('#calReg input[data-key="妻|"]'); return !!c && c.checked === false; }));
  await p.evaluate(() => { __rs.others = []; calRsvp(false); }); await new Promise(r => setTimeout(r, 400)); s = await t();
  ok('取消參加：本人與寶尊眷都消失，回到「我要參加」', s.includes('我要參加') && !s.includes('王太太（') && !s.includes('您已表示要參加'));
  // 表單：開放參加
  await p.evaluate(() => { calBack(); calOpenForm(); });
  await p.evaluate(() => { document.getElementById('cfLayer').value = 'club'; calFormLayerChanged(); });
  ok('新增社內行程：預設勾選「開放社友按我要參加」', await p.evaluate(() => document.getElementById('cfRsvp').checked && !document.getElementById('cfRsvpBox').classList.contains('hidden')));
  await p.evaluate(() => { document.getElementById('cfLayer').value = 'private'; calFormLayerChanged(); });
  ok('私人行程：不顯示開放參加選項', await p.evaluate(() => document.getElementById('cfRsvpBox').classList.contains('hidden')));
  await p.evaluate(() => { document.getElementById('cfLayer').value = 'club'; calFormLayerChanged(); document.getElementById('cfTitle').value = '週三例會'; calSaveForm(''); }); await new Promise(r => setTimeout(r, 400));
  ok('儲存時送出 rsvpEnabled=true', await p.evaluate(() => window.__calls.filter(c => c[0] === 'cal_save').pop()[1].event.rsvpEnabled === true));
  // 自動更新：別人報名後，停在詳細頁的畫面會跟著更新
  await p.evaluate(() => calBack()); await p.evaluate(() => calOpenDetail('1')); await new Promise(r => setTimeout(r, 300));
  ok('停在詳細頁時已啟動自動更新', await p.evaluate(() => !!calRegTimer));
  await p.evaluate(() => { __rs.others = [{ key: '錢|', name: '錢大明', nickname: '', status: 'interested' }]; }); 
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); }); await p.evaluate(() => calRegPoll()); await new Promise(r => setTimeout(r, 200));
  ok('LINE 在背景時不更新（省流量）', !(await t()).includes('錢大明'));
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); }); await p.evaluate(() => calRegPoll()); await new Promise(r => setTimeout(r, 300));
  ok('別的社友按了我要參加 → 自動出現在名單', (await t()).includes('錢大明'));
  const n0 = await p.evaluate(() => window.__calls.filter(c => c[0] === 'cal_rsvp_status').length);
  await p.evaluate(() => calBack()); await p.evaluate(() => calRegPoll());
  await p.evaluate(() => calRegPoll()); await new Promise(r => setTimeout(r, 200));
  ok('離開詳細頁後停止自動更新、不再連網', (await p.evaluate(() => calRegTimer === null)) && (await p.evaluate(() => window.__calls.filter(c => c[0] === 'cal_rsvp_status').length)) === n0);
  await p.evaluate(() => { __rs.others = []; });
  await p.evaluate(() => calBack()); await p.evaluate(() => calOpenDetail('2')); await new Promise(r => setTimeout(r, 200));
  ok('沒對應報名的行程沒有報名區塊', !(await p.evaluate(() => !!document.getElementById('calReg'))));
  await p.evaluate(() => calBack()); await p.evaluate(() => calOpenDetail('2')); s = await t(); ok('無權限的行程沒有編輯按鈕', !s.includes('刪除'));
  await p.evaluate(() => { calBack(); calOpenDetail('1'); calOpenForm('copy'); }); s = await p.evaluate(() => document.getElementById('cfTitle').value); ok('複製：帶入標題', s === '地區大會');
  await p.evaluate(() => { document.getElementById('cfTitle').value = ''; }); await p.evaluate(() => calSaveForm('')); ok('沒標題被擋', (await t()).includes('請填寫行程標題'));
  await p.evaluate(() => { document.getElementById('cfTitle').value = '新行程'; document.getElementById('cfSt').value = '10:00'; document.getElementById('cfEt').value = '08:00'; }); await p.evaluate(() => calSaveForm('')); ok('結束早於開始被擋', (await t()).includes('結束時間不能早於'));
  await p.evaluate(() => { document.getElementById('cfEt').value = '11:00'; }); await p.evaluate(() => calSaveForm('')); await new Promise(r => setTimeout(r, 300));
  const sv = await p.evaluate(() => window.__calls.filter(c => c[0] === 'cal_save').pop()[1].event);
  ok('儲存送出台灣時間 +08:00', sv.start.endsWith('10:00:00+08:00') && sv.end.endsWith('11:00:00+08:00') && sv.layer === 'district');
  ok('儲存後回到列表', (await p.evaluate(() => !document.getElementById('calMain').classList.contains('hidden'))));
  await p.evaluate(() => { calOpenForm(); }); ok('新增表單層級選項含 地區/社內/私人', (await p.evaluate(() => document.querySelectorAll('#cfLayer option').length)) === 3);
  await p.evaluate(() => { document.getElementById('cfLayer').value = 'private'; calFormLayerChanged(); }); await p.screenshot({ path: require('os').tmpdir() + '/cal_form.png' });
  await p.evaluate(() => calBack()); await p.evaluate(() => calSetRange('week')); await new Promise(r => setTimeout(r, 200)); await p.screenshot({ path: require('os').tmpdir() + '/cal_week.png' });
  await p.evaluate(() => calBack()); await p.evaluate(() => calOpenSettings()); await new Promise(r => setTimeout(r, 200)); s = await t();
  ok('設定：預設關閉、沒有網址', s.includes('目前關閉') && !(await p.evaluate(() => !!document.getElementById('icsUrl'))));
  await p.evaluate(() => calIcsToggle()); await new Promise(r => setTimeout(r, 200)); s = await t();
  const u1 = await p.evaluate(() => document.getElementById('icsUrl') && document.getElementById('icsUrl').value);
  ok('開啟後顯示專屬網址與私人行程警告', s.includes('已開啟') && /line-checkin\?ics=tok1_/.test(u1 || '') && s.includes('不要傳給別人'));
  await p.evaluate(() => calIcsRotate()); await new Promise(r => setTimeout(r, 200));
  ok('重新產生後網址改變', /ics=tok2_/.test(await p.evaluate(() => document.getElementById('icsUrl').value)));
  await p.evaluate(() => calIcsToggle()); await new Promise(r => setTimeout(r, 200)); s = await t();
  ok('關閉後網址消失', s.includes('目前關閉') && !(await p.evaluate(() => !!document.getElementById('icsUrl'))));
  await p.evaluate(() => calIcsToggle()); await new Promise(r => setTimeout(r, 200));
  await p.screenshot({ path: require('os').tmpdir() + '/cal_settings.png' });
  await p.evaluate(() => calBack());
  // 📊 出席率
  ok('主畫面有「📊 出席」按鈕', (await t()).includes('出席'));
  await p.evaluate(() => calOpenAttend('me')); await new Promise(r => setTimeout(r, 200)); s = await t();
  const arCall = await p.evaluate(() => window.__calls.filter(c => c[0] === 'cal_attend_report').pop()[1]);
  ok('我的出席：送出上半年與全年兩段（扶輪年度）', arCall.scope === 'me' && arCall.periods.map(x => x.id).join() === 'h1,year' && arCall.periods[0].from.includes('-07-01T00:00:00+08:00') && arCall.periods[1].to.includes('-06-30T23:59:59+08:00'));
  ok('我的出席：上半年 150%（例會 1/2＋補出席 2，可超過 100%）、全年 100%、純例會出席率', s.includes('我的出席') && s.includes('150%') && s.includes('100%') && s.includes('例會 1/2・補出席 2') && s.includes('純例會 50%'));
  ok('我的出席：例會明細（出席／缺席／尚未記錄）與補出席（地區活動報到、執秘登記的友社例會）', s.includes('✅ 出席') && s.includes('✕ 缺席') && s.includes('尚未記錄') && s.includes('地區高球') && s.includes('已報到') && s.includes('友社例會：台北東區扶輪社例會') && s.includes('執秘登記'));
  ok('一般社友沒有「看全社出席率」按鈕', !s.includes('看全社出席率'));
  await p.evaluate(() => { __arCan = true; calOpenAttend('me'); }); await new Promise(r => setTimeout(r, 200));
  ok('社長／秘書有「看全社出席率」按鈕', (await t()).includes('看全社出席率'));
  await p.evaluate(() => calOpenAttend('club')); await new Promise(r => setTimeout(r, 200)); s = await t();
  ok('全社出席率：列出社友（不列寶尊眷）與上半年／全年出席率', s.includes('全社出席率') && s.includes('李大華') && s.includes('王小明') && !s.includes('王太太') && s.includes('返回我的出席'));
  await p.evaluate(() => { const i = document.getElementById('calArSearch'); i.value = 'amy'; i.dispatchEvent(new Event('input')); });
  ok('全社出席率：搜尋 Nick Name', await p.evaluate(() => { const t = document.getElementById('calArList').innerText; return t.includes('李大華') && !t.includes('王小明'); }));
  await p.evaluate(() => document.querySelector('#calArList button').click()); await new Promise(r => setTimeout(r, 100)); s = await t();
  ok('全社出席率：點社友看他的明細，可返回名單', s.includes('李大華') && s.includes('二月例會') && s.includes('返回全社名單') && s.includes('50%'));
  await p.evaluate(() => { calArView = ''; calArRender(); });
  await p.evaluate(() => { window.__copied = ''; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied = t; } } }); return calArCopy(); }); await new Promise(r => setTimeout(r, 100));
  ok('全社出席率：可複製文字貼到 LINE', await p.evaluate(() => window.__copied.includes('甲社') && window.__copied.includes('出席率') && window.__copied.includes('Amy　上半年 50%')));
  await p.evaluate(() => calBack());
  // 總監推播卡片的「查看詳情」：帶 ev、d 直接打開那筆行程（不在目前範圍內時會另外讀那一天）
  const nList = await p.evaluate(() => { calEvents = calEvents.filter(e => e.id !== 'far'); window.__calls.length = 0; return calEvents.length; });
  await p.evaluate(() => calOpenDeep('far', ymd(Date.now() + 10 * 86400e3))); await new Promise(r => setTimeout(r, 200));
  s = await t();
  ok('推播的查看詳情：讀那一天的行程並打開詳細頁', s.includes('十天後的行程') && await p.evaluate(() => calCurrent && calCurrent.id === 'far' && window.__calls.some(c => c[0] === 'cal_list')));
  await p.evaluate(() => calBack());
  await p.evaluate(() => calOpenDeep('不存在', '')); await new Promise(r => setTimeout(r, 100));
  ok('推播的查看詳情：行程已刪除時停在列表，不出錯', await p.evaluate(() => calCurrent === null || calCurrent.id !== '不存在'));
  // ---------- 總監秘書代管總監的行事曆 ----------
  ok('不是總監秘書：沒有「管理總監行事曆」按鈕', await p.evaluate(() => document.getElementById('calGovBar').innerHTML === ''));
  await p.evaluate(() => { calRoles = { district: false, clubs: [], governor: false, secretary: true, govs: [{ club: '乙社', key: '陳|Gov', name: '陳總監', nickname: 'DG Gov' }] }; calRenderGovBar(); calSetLayer('all'); calSetRange('week'); });
  await new Promise(r => setTimeout(r, 200));
  ok('總監秘書：出現「管理總監 … 的行事曆」按鈕', (await p.evaluate(() => document.getElementById('calGovBar').innerText)).includes('管理總監 DG Gov 的行事曆'));
  await p.evaluate(() => { window.__calls.length = 0; calSetGov(0); }); await new Promise(r => setTimeout(r, 200));
  ok('切換後：讀行程時帶上要代管的總監', await p.evaluate(() => { const c = window.__calls.find(c => c[0] === 'cal_list'); return !!c && c[1].forGov && c[1].forGov.key === '陳|Gov' && c[1].forGov.club === '乙社'; }));
  ok('切換後：顯示「您正在代管」提示與「回我的行事曆」，分頁改成「總監私人」', await p.evaluate(() => document.getElementById('calGovBar').innerText.includes('您正在代管') && document.getElementById('calGovBar').innerText.includes('回我的行事曆') && document.getElementById('calLayerTabs').innerText.includes('總監私人')));
  await p.evaluate(() => calOpenDetail('meet'));
  ok('代管時：行程詳細頁不顯示「我要參加」', await p.evaluate(() => !document.getElementById('calReg')));
  await p.evaluate(() => calBack()); await p.evaluate(() => calOpenForm());
  ok('代管時新增：層級只有「總監的私人行程」', await p.evaluate(() => { const o = document.getElementById('cfLayer').options; return o.length === 1 && o[0].value === 'private' && o[0].textContent.includes('總監 DG Gov 的私人行程'); }));
  await p.evaluate(() => { document.getElementById('cfTitle').value = '拜會市長'; window.__calls.length = 0; }); await p.evaluate(() => calSaveForm('')); await new Promise(r => setTimeout(r, 300));
  ok('代管時儲存：帶上要代管的總監', await p.evaluate(() => { const c = window.__calls.find(c => c[0] === 'cal_save'); return !!c && c[1].forGov && c[1].forGov.key === '陳|Gov' && c[1].event.layer === 'private' && c[1].event.title === '拜會市長'; }));
  await p.evaluate(() => { window.__calls.length = 0; calSetGov(-1); }); await new Promise(r => setTimeout(r, 200));
  ok('回我的行事曆：不再帶總監、分頁恢復「私人」', await p.evaluate(() => { const c = window.__calls.find(c => c[0] === 'cal_list'); return !!c && !c[1].forGov && document.getElementById('calLayerTabs').innerText.includes('私人') && !document.getElementById('calLayerTabs').innerText.includes('總監私人') && document.getElementById('calGovBar').innerText.includes('管理總監'); }));
  await p.evaluate(() => calOpenForm());
  ok('秘書在自己的行事曆新增私人行程：出現「同時加入總監行事曆」且預設勾選', await p.evaluate(() => { const c = document.getElementById('cfShare'); return !!c && c.checked && !document.getElementById('cfShareBox').classList.contains('hidden') && document.getElementById('cfShareBox').innerText.includes('DG Gov'); }));
  await p.evaluate(() => { document.getElementById('cfTitle').value = '陪同授證'; window.__calls.length = 0; }); await p.evaluate(() => calSaveForm('')); await new Promise(r => setTimeout(r, 300));
  ok('勾選時儲存：帶上要同步的總監（不是代管）', await p.evaluate(() => { const c = window.__calls.find(c => c[0] === 'cal_save'); return !!c && c[1].shareGov && c[1].shareGov.key === '陳|Gov' && !c[1].forGov; }));
  await p.evaluate(() => calOpenForm()); await p.evaluate(() => { document.getElementById('cfShare').checked = false; document.getElementById('cfTitle').value = '看牙'; window.__calls.length = 0; }); await p.evaluate(() => calSaveForm('')); await new Promise(r => setTimeout(r, 300));
  ok('取消勾選：不同步', await p.evaluate(() => { const c = window.__calls.find(c => c[0] === 'cal_save'); return !!c && !c[1].shareGov; }));
  await p.evaluate(() => { calSetGov(0); }); await new Promise(r => setTimeout(r, 200)); await p.evaluate(() => calOpenForm());
  ok('代管總監時的新增畫面沒有同步勾選', await p.evaluate(() => !document.getElementById('cfShare')));
  await p.evaluate(() => { calCancelForm(); calSetGov(-1); }); await new Promise(r => setTimeout(r, 200));
  ok('無 JS 錯誤', errs.length === 0); if (errs.length) console.log(errs);
  await b.close();
})();
