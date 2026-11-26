// ============================================================================
// 報到系統共用邏輯：把「報名資料」整理成「應到名單」，並與報到紀錄合併、統計。
// index.html（主委後台的報到面板）與 checkin.html（櫃台報到頁）都載入這個檔案，
// 兩邊算出來的應到人數才會一致。這裡全部是不碰畫面的純函式，可以直接用 node 測試。
//
// 認人的方式：同一個社裡以「姓名|Nick Name」當 key（與報名表、旅平險名單相同）。
// 社友庫的 id 在匯入 Excel 時會整批重編，反而不穩定，所以不用 id。
// ============================================================================
(function (root) {
    'use strict';

    // 搜尋用：全形轉半形、轉小寫、去掉所有空白
    function norm(s) {
        return String(s == null ? '' : s)
            .replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
            .replace(/　/g, ' ')
            .toLowerCase()
            .replace(/\s+/g, '');
    }

    function personKey(p) { return `${(p && p.name) || ''}|${(p && p.nickname) || ''}`; }

    // 活動 key＝「大類id::子活動名稱」（與繳費表、活動 DM 相同）
    function makeEventKey(catId, subName) { return `${catId}::${subName || ''}`; }
    function parseEventKey(key) {
        const s = String(key || '');
        const i = s.indexOf('::');
        return i < 0 ? { catId: s, subName: '' } : { catId: s.slice(0, i), subName: s.slice(i + 2) };
    }

    function hasWord(txt, words) { return !!txt && words.some(w => String(txt).includes(w)); }
    // 分攤金／配合款只是繳款項目，沒有人要到場，所以不提供報到（判斷方式與 index.html 的 applyCurrentEventMode 相同）
    function isApportionEvent(catName, subName) {
        return hasWord(catName, ['分攤金', '配合款']) || hasWord(subName, ['分攤金', '配合款']);
    }
    function isPelsEvent(subName) { return /PELS|社長當選人/i.test(String(subName || '')); }

    const PELS_SHORT = { SHARED: '2人1房', FAMILY: '攜眷2人房', SINGLE: '單人房', ABSENT: '不克參加' };

    // 社名 → 所屬分區與排序位置
    function buildClubIndex(divisionsData) {
        const idx = {};
        (divisionsData || []).forEach((d, di) => {
            (d.clubs || []).forEach((c, ci) => {
                if (c && c.name && !idx[c.name]) idx[c.name] = { divId: d.id, divName: d.name || `第 ${d.id} 分區`, divOrder: di, clubOrder: ci };
            });
        });
        return idx;
    }
    const UNKNOWN_DIV = { divId: '__other', divName: '其他', divOrder: 9999, clubOrder: 9999 };

    // 贊助獎捐贈人有勾「用餐」、但本人不在報名名單內：也要列入應到名單（與 index.html 的 getPrizeMealGuests 相同）
    function prizeMealGuests(prizes, items) {
        const arr = Array.isArray(prizes) ? prizes : [];
        const roster = Array.isArray(items) ? items : [];
        return arr.filter(p => p && p.meal && p.memberId && !roster.some(it =>
            (it.id !== undefined && String(it.id) === String(p.memberId)) ||
            (it.name === p.name && (it.nickname || '') === (p.nickname || ''))
        ));
    }

    /**
     * 產生某個活動的應到名單。
     * state：{ categoriesData, divisionsData, registrationOrders }（就是 app_storage 主資料裡的同名欄位）
     * 回傳 { ok, reason, catId, catName, subName, title, isPels, persons[] }
     *   reason：'no_event'＝找不到這個活動；'apportionment'＝分攤金不需報到
     */
    function buildRoster(state, eventKey) {
        const st = state || {};
        const { catId, subName } = parseEventKey(eventKey);
        const cat = (st.categoriesData || []).find(c => c.id === catId);
        const out = { ok: false, reason: '', catId, catName: cat ? cat.name : '', subName, title: subName || (cat ? cat.name : ''), isPels: isPelsEvent(subName), persons: [] };
        if (!cat || !subName || !(cat.subEvents || []).includes(subName)) { out.reason = 'no_event'; return out; }
        if (isApportionEvent(cat.name, subName)) { out.reason = 'apportionment'; return out; }
        out.ok = true;
        // 「參賽／只用餐」只有運動賽事才有意義（研討會、社慶的報名資料裡也帶著預設值「參賽」，不能顯示出來）
        const isSports = !!cat.allowSponsors && !hasWord(cat.name, ['社慶']) && !hasWord(subName, ['社慶']);

        const clubIdx = buildClubIndex(st.divisionsData);
        const orders = ((st.registrationOrders || {})[subName]) || [];
        const seen = new Set();
        orders.forEach(o => {
            if (!o || !o.clubName) return;
            const div = clubIdx[o.clubName] || UNKNOWN_DIV;
            const push = (it, extra) => {
                if (!it || !(it.name || it.nickname)) return;
                const key = personKey(it);
                const uid = o.clubName + '\u0001' + key;
                if (seen.has(uid)) return; // 同一社同一人只列一次
                seen.add(uid);
                out.persons.push(Object.assign({
                    club: o.clubName, divId: div.divId, divName: div.divName, divOrder: div.divOrder, clubOrder: div.clubOrder,
                    key, name: it.name || '', nickname: it.nickname || '', role: it.role || '',
                    diet: it.diet === 'VEGAN' ? 'VEGAN' : 'MEAT', veganNote: it.veganNote || '',
                    participation: '', pelsOption: '', companions: 0, isPrizeGuest: false, seq: out.persons.length
                }, extra || {}));
            };
            (o.items || []).forEach(it => {
                if (out.isPels) {
                    const opt = it.pelsOption || 'SHARED';
                    if (opt === 'ABSENT') return; // 不克參加：不列入應到
                    push(it, { pelsOption: opt, companions: opt === 'FAMILY' ? 1 : 0 });
                } else {
                    push(it, { participation: isSports ? (it.participation === '只用餐' ? '只用餐' : (it.participation || '')) : '' });
                }
            });
            prizeMealGuests(o.prizeSponsors, o.items).forEach(p => push(p, { isPrizeGuest: true, participation: '贊助獎用餐' }));
        });
        out.persons.sort((a, b) => (a.divOrder - b.divOrder) || (a.clubOrder - b.clubOrder) || a.club.localeCompare(b.club, 'zh-Hant') || (a.seq - b.seq));
        return out;
    }

    /**
     * 把報到紀錄（event_checkins 的資料列）併進應到名單。
     * 回傳的每一筆 entry＝應到名單的人 + checkin（已報到的那筆紀錄，未到則為 null）。
     * 報到紀錄裡有、但應到名單裡沒有的人，會附加在後面：
     *   isWalkIn＝現場加報；isOrphan＝報到後該社又把他從報名表移除。
     * 現場加報有兩種：已到（status 'in'，checkin 有值）與尚未到場（status 'pending'，checkin 為 null、pendingRow 有值）。
     */
    function mergeCheckins(roster, rows, divisionsData) {
        const active = new Map();
        (rows || []).forEach(r => { if (r && (r.status === 'in' || r.status === 'pending')) active.set(r.club_name + '\u0001' + r.person_key, r); });
        const entries = (roster.persons || []).map(p => {
            const uid = p.club + '\u0001' + p.key;
            const row = active.get(uid) || null;
            if (row) active.delete(uid);
            // 名單內的人若留有「加報未到」的紀錄（加報後該社才補送報名表），視為一般未到
            return Object.assign({}, p, { checkin: row && row.status === 'in' ? row : null, pendingRow: null, isWalkIn: false, isOrphan: false, note: '' });
        });
        const clubIdx = buildClubIndex(divisionsData);
        let seq = entries.length;
        Array.from(active.values())
            .sort((a, b) => String(a.checked_in_at).localeCompare(String(b.checked_in_at)))
            .forEach(r => {
                const div = clubIdx[r.club_name] || UNKNOWN_DIV;
                entries.push({
                    club: r.club_name, divId: div.divId, divName: div.divName, divOrder: div.divOrder, clubOrder: div.clubOrder,
                    key: r.person_key, name: r.full_name || '', nickname: r.nickname || '', role: '',
                    diet: '', veganNote: '', participation: '', pelsOption: '', companions: 0, isPrizeGuest: false, seq: seq++,
                    checkin: r.status === 'in' ? r : null, pendingRow: r.status === 'pending' ? r : null,
                    isWalkIn: !!r.is_walk_in || r.status === 'pending', isOrphan: !r.is_walk_in && r.status !== 'pending', note: r.note || ''
                });
            });
        entries.sort((a, b) => (a.divOrder - b.divOrder) || (a.clubOrder - b.clubOrder) || a.club.localeCompare(b.club, 'zh-Hant') || (a.seq - b.seq));
        return entries;
    }

    // 統計：全體、各分區、各社。
    //   expected＝應到（報名名單內的人）、arrived＝名單內已到、extra＝現場加報且已到（含報到後被移出名單的人）、
    //   extraPending＝現場加報但尚未到場、walkTotal＝extra + extraPending、
    //   present＝現場實際人數（arrived + extra）。畫面上的「實到」一律用 present，才會與現場人數一致；
    //   absent（未到）＝(expected − arrived) + extraPending、出席率＝arrived ÷ expected（只看有報名的人來了多少）。
    //   全體／各分區／各社都有這些欄位。
    //   各社另有 people[]（整張名單含加報，依名單順序）給「各社名單」顯示已到／未到。
    function computeStats(entries) {
        const blank = () => ({ expected: 0, arrived: 0, extra: 0, extraPending: 0, companions: 0 });
        const total = Object.assign(blank(), { meat: 0, vegan: 0, dietUnknown: 0 });
        const divMap = new Map(), clubMap = new Map();
        (entries || []).forEach(e => {
            if (!divMap.has(e.divId)) divMap.set(e.divId, Object.assign(blank(), { divId: e.divId, divName: e.divName, divOrder: e.divOrder }));
            if (!clubMap.has(e.club)) clubMap.set(e.club, Object.assign(blank(), { club: e.club, divId: e.divId, divName: e.divName, divOrder: e.divOrder, clubOrder: e.clubOrder, absentNames: [], people: [] }));
            const d = divMap.get(e.divId), c = clubMap.get(e.club);
            const listed = !e.isWalkIn && !e.isOrphan;
            if (listed) {
                total.expected++; d.expected++; c.expected++;
                if (e.checkin) { total.arrived++; d.arrived++; c.arrived++; }
                else c.absentNames.push(e.name || e.nickname);
            } else if (e.checkin) {
                total.extra++; d.extra++; c.extra++;
            } else {
                total.extraPending++; d.extraPending++; c.extraPending++;
                c.absentNames.push((e.name || e.nickname) + '（加報）');
            }
            c.people.push({ name: e.name || e.nickname, arrived: !!e.checkin, walkIn: !listed });
            if (e.checkin) {
                if (e.companions) { total.companions += e.companions; d.companions += e.companions; c.companions += e.companions; }
                if (e.diet === 'VEGAN') total.vegan++; else if (e.diet === 'MEAT') total.meat++; else total.dietUnknown++;
            }
        });
        const finish = g => { g.present = g.arrived + g.extra; g.absent = g.expected - g.arrived + g.extraPending; g.walkTotal = g.extra + g.extraPending; };
        finish(total);
        total.rate = total.expected ? Math.round(total.arrived * 1000 / total.expected) / 10 : 0;
        divMap.forEach(finish);
        clubMap.forEach(finish);
        const byOrder = (a, b) => (a.divOrder - b.divOrder) || ((a.clubOrder || 0) - (b.clubOrder || 0));
        return {
            total,
            divisions: Array.from(divMap.values()).sort(byOrder),
            clubs: Array.from(clubMap.values()).sort(byOrder)
        };
    }

    // 搜尋：姓名、Nick Name、社名任一包含關鍵字即符合
    function matchEntry(e, keyword) {
        const k = norm(keyword);
        if (!k) return true;
        return norm(e.name).includes(k) || norm(e.nickname).includes(k) || norm(e.club).includes(k);
    }

    // 社友名單的顯示順序（報名系統社友庫、行事曆管理、LINE 綁定選名字共用）：
    //   1. 現任社長「P」 2. 現任秘書「S」 3. 其餘依 Nick Name（去掉開頭的扶輪職稱，例如「PP Fred」以 Fred 排；沒有 Nick Name 就用姓名；不分大小寫）
    //   P／S 的判斷：職務欄是 P／S（或「社長」「秘書」），或 Nick Name 開頭是「P 」「S 」（例如「P Robert」「S Three M」）。
    //   比對前全形轉半形、轉大寫，所以「Ｐ」「p」都算；PP、PE、IPP、執秘等不算。
    //   寶(尊)眷 緊接在對應社友（spouseOfId）下方；找不到對應社友的放最後。只排序、不改原陣列。
    const MEMBER_TITLE_RE = /^(IPDG|PDG|DGND|DGE|DGN|DG|PAG|AG|PDS|DS|IPP|PVP|PP|PE|PN|VP|CP|CS|RTN|P|S)$/;
    const halfUpper = v => String(v || '').replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\u3000/g, ' ').trim().toUpperCase();
    function nickParts(nick) {           // 「PP Fred」→ { title: 'PP', base: 'Fred' }
        const raw = String(nick || '').replace(/\u3000/g, ' ').trim(), parts = raw.split(/\s+/);
        if (parts.length >= 2 && MEMBER_TITLE_RE.test(halfUpper(parts[0]))) return { title: halfUpper(parts[0]), base: parts.slice(1).join(' ') };
        return { title: '', base: raw };
    }
    function memberRoleRank(m) {
        const r = halfUpper(m && m.role).replace(/\s+/g, ''), t = nickParts(m && m.nickname).title;
        if (r === 'P' || r === '社長' || t === 'P') return 0;
        if (r === 'S' || r === '秘書' || t === 'S') return 1;
        return 2;
    }
    let nameCollator = null;
    try { nameCollator = new Intl.Collator(['en', 'zh-Hant-TW'], { sensitivity: 'base', numeric: true }); } catch (e) { nameCollator = null; }
    function compareMembers(a, b) {
        const ra = memberRoleRank(a), rb = memberRoleRank(b);
        if (ra !== rb) return ra - rb;
        const key = m => (nickParts(m && m.nickname).base || String((m && m.name) || '')).trim();
        const ka = key(a), kb = key(b);
        const c = nameCollator ? nameCollator.compare(ka, kb) : ka.localeCompare(kb);
        return c || String((a && a.name) || '').localeCompare(String((b && b.name) || ''));
    }
    function isSpouseMember(m) { return !!(m && (m.spouseOfId || /眷/.test(String(m.role || '')))); }
    function sortMembers(list) {
        const all = (Array.isArray(list) ? list : []).filter(Boolean);
        const heads = all.filter(m => !isSpouseMember(m)).sort(compareMembers), out = [], used = new Set();
        heads.forEach(h => {
            out.push(h); used.add(h);
            all.filter(m => isSpouseMember(m) && m.spouseOfId != null && m.spouseOfId === h.id).sort(compareMembers).forEach(g => { out.push(g); used.add(g); });
        });
        all.filter(m => !used.has(m)).sort(compareMembers).forEach(g => out.push(g));   // 找不到對應社友的寶尊眷
        return out;
    }

    // =====================================================================
    // 報名／繳費統計（主委後台的分攤金圖表、LINE 行事曆的「📊 報名狀況」共用同一套算法）
    //   state：{ categoriesData, divisionsData, registrationOrders, chairConfig }；payments＝繳費紀錄（key＝大類id::子活動名稱 → 社名 → {status, amount}）
    // =====================================================================
    function isPaidStatus(s) { return s === 'PAID_EMAIL' || s === 'PAID_MANUAL' || s === 'EXEMPT'; }
    // 「地區辦公室」只為了能被指派為活動主委而存在，永遠不需繳費
    function isDistrictOfficeDivision(div) {
        if (!div) return false;
        const clubs = div.clubs || [];
        return div.name === '地區團隊' || (clubs.length > 0 && clubs.every(c => c.name === '地區辦公室'));
    }
    function paymentDivisions(divisions) { return (divisions || []).filter(d => !isDistrictOfficeDivision(d)); }
    // 各分區的繳款情形。isDue(社名)＝這一社要不要繳（沒給＝每一社都要繳）
    function divisionPayRows(divisions, records, isDue) {
        const recs = records || {};
        let tClubs = 0, tPaid = 0, tAmt = 0;
        const rows = paymentDivisions(divisions).map(div => {
            const paid = [], notified = [], unpaid = []; let amt = 0, total = 0;
            (div.clubs || []).forEach(club => {
                const rec = recs[club.name] || { status: 'UNPAID' };
                const done = isPaidStatus(rec.status);
                if (isDue && !isDue(club.name) && !done) return;
                total++;
                if (done) { paid.push(club.name); amt += Number(rec.amount) || 0; }
                else unpaid.push(club.name);
            });
            tClubs += total; tPaid += paid.length; tAmt += amt;
            return { div, total, paid, notified, unpaid, amt, rate: total ? paid.length / total : 0 };
        }).filter(r => r.total > 0);
        return { rows, tClubs, tPaid, tAmt };
    }
    function isPaymentTrackingCat(cat) {
        if (!cat) return false;
        const n = cat.name || '';
        return cat.id === 'seminars' || cat.id === 'conference' || n.includes('研討會') || n.includes('講習會') || n.includes('年會');
    }
    // 主委設定的「每社應繳金額」（與 index.html 的 getApportionmentFee 相同：該子活動 → 舊的全域值 → 3000）
    function configuredClubFee(chairConfig, eventKey) {
        const cfg = chairConfig || {};
        const e = (cfg.subEventFees || {})[eventKey];
        const num = v => v !== undefined && v !== null && v !== '' && !isNaN(Number(v));
        if (e && num(e.feeApportionment)) return Number(e.feeApportionment);
        if (num(cfg.feeApportionment)) return Number(cfg.feeApportionment);
        return 3000;
    }
    // 可以看統計的活動清單（依主選單順序）
    function listStatEvents(state) {
        const out = [];
        ((state || {}).categoriesData || []).forEach(cat => (cat.subEvents || []).forEach(sub => {
            if (typeof sub === 'string' && sub) out.push({ key: makeEventKey(cat.id, sub), catId: cat.id, catName: cat.name || '', subName: sub });
        }));
        return out;
    }
    /**
     * 某個活動的報名／繳費統計。
     * mode：'apportion'＝分攤金／配合款（每社都要繳，不算人數）｜'fixed'＝研討會、年會（每社繳固定金額）｜'order'＝依各社報名表金額（運動賽事、社慶、PELS…，有報名的社才要繳）
     */
    function eventStats(state, payments, eventKey) {
        const st = state || {};
        const { catId, subName } = parseEventKey(eventKey);
        const cat = (st.categoriesData || []).find(c => c.id === catId);
        if (!cat || !subName || !(cat.subEvents || []).includes(subName)) return { ok: false, key: eventKey };
        const mode = isApportionEvent(cat.name, subName) ? 'apportion' : (isPelsEvent(subName) || !isPaymentTrackingCat(cat)) ? 'order' : 'fixed';
        const orders = ((st.registrationOrders || {})[subName] || []).filter(o => o && o.clubName);
        const orderOf = {}; orders.forEach(o => { orderOf[o.clubName] = o; });
        const fee = configuredClubFee(st.chairConfig, eventKey);
        const fe = ((st.chairConfig || {}).subEventFees || {})[eventKey];
        const feeSet = !!(fe && fe.feeApportionment !== undefined && fe.feeApportionment !== null && fe.feeApportionment !== '' && !isNaN(Number(fe.feeApportionment)));   // 主委有沒有替這個活動設定過每社應繳金額
        const requiredOf = club => mode === 'order' ? (orderOf[club] ? (Number(orderOf[club].grandTotal) || 0) : 0) : fee;
        const records = (payments || {})[eventKey] || {};
        const pay = divisionPayRows(st.divisionsData, records, mode === 'order' ? (club => requiredOf(club) > 0) : null);
        let expected = 0;
        pay.rows.forEach(r => r.paid.concat(r.unpaid).forEach(c => { expected += requiredOf(c); }));
        // 報名人數：與報到的應到名單同一套（PELS 攜眷多算一位）
        let people = null, regClubs = null; const peopleOf = {};
        if (mode !== 'apportion') {
            const roster = buildRoster(st, eventKey);
            people = 0;
            roster.persons.forEach(p => { const n = 1 + (p.companions || 0); people += n; peopleOf[p.club] = (peopleOf[p.club] || 0) + n; });
            regClubs = Object.keys(peopleOf).length;
        }
        const allClubs = paymentDivisions(st.divisionsData).reduce((n, d) => n + (d.clubs || []).length, 0);
        return {
            ok: true, key: eventKey, catName: cat.name || '', subName, mode, fee: mode === 'order' ? null : fee, feeSet: mode === 'order' ? null : feeSet,
            allClubs, regClubs, people,
            dueClubs: pay.tClubs, paidClubs: pay.tPaid, paidAmt: pay.tAmt, expected, rate: pay.tClubs ? pay.tPaid / pay.tClubs : 0,
            rows: pay.rows.map(r => ({ name: r.div.name || ('第 ' + r.div.id + ' 分區'), total: r.total, paid: r.paid, unpaid: r.unpaid, amt: r.amt, rate: r.rate,
                people: mode === 'apportion' ? null : (r.div.clubs || []).reduce((n, c) => n + (peopleOf[c.name] || 0), 0) }))
        };
    }

    // ---------- 社友在 LINE 自己報名：直接寫進報名表（2026-11-24） ----------
    // 使用者決定：社友在手機按報名＝正式報名並送出，不需要執秘再確認；執秘把人從報名表拿掉，手機也就不再顯示已報名。
    // 這裡只算「這一社的報名表會變成什麼」，不碰資料庫；雲端小程式（lib.ts）負責讀寫，與 index.html 的 submitRegistrationInner 用同一套金額規則。
    // 不開放手機報名：分攤金／配合款（沒有人要到場）、社長當選人研討會 PELS（要選出席方式並填旅平險個資，仍由執秘報名）。
    function subEventFeeOf(chairConfig, eventKey, field, fallback) {      // 與 index.html 的 getSubEventFee 相同：該子活動 → 舊的全域值 → 預設
        const cfg = chairConfig || {}, e = (cfg.subEventFees || {})[eventKey];
        const num = v => v !== undefined && v !== null && !isNaN(Number(v));
        if (e && num(e[field])) return Number(e[field]);
        if (num(cfg[field])) return Number(cfg[field]);
        return fallback;
    }
    function isSportsLikeEvent(cat, subName) {     // 與 index.html 的 isCurrentEventSports 相同
        const n = (cat && cat.name) || '', sub = String(subName || '');
        return !!cat && (cat.id === 'sports' || hasWord(n, ['運動', '賽事', '體育', '球賽']) || hasWord(sub, ['球', '賽', '運動']));
    }
    // ---------- 報名截止（2026-11-26） ----------
    // 主委在「活動設定」填的截止時間存在 chairConfig.regDeadlines['大類id::子活動名稱']＝'YYYY-MM-DDTHH:mm'（台灣時間）。
    // 沒填截止時間、但有填活動日期＝活動當天 00:00 自動截止（保底）；兩個都沒填＝不截止。
    // 截止後：社友的手機、執秘都不能再報名／變更／取消；活動主委與最高管理員仍可修改（由畫面與雲端各自判斷身分）。
    function regDeadlineOf(chairConfig, eventKey) {
        const cfg = chairConfig || {};
        const d = (cfg.regDeadlines || {})[eventKey];
        if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d)) { const at = Date.parse(d + ':00+08:00'); if (Number.isFinite(at)) return { at, source: 'set' }; }
        const ev = (cfg.eventDates || {})[eventKey];
        if (ev && /^\d{4}-\d{2}-\d{2}$/.test(String(ev.date || ''))) { const at = Date.parse(ev.date + 'T00:00:00+08:00'); if (Number.isFinite(at)) return { at, source: 'eventDay' }; }
        return { at: null, source: '' };
    }
    function regClosed(chairConfig, eventKey, nowMs) {
        const d = regDeadlineOf(chairConfig, eventKey);
        return d.at !== null && (nowMs === undefined ? Date.now() : nowMs) >= d.at;
    }
    function regDeadlineText(at) {      // 例：12/3（四）18:00（台灣時間）
        if (at === null || at === undefined) return '';
        const t = new Date(at + 8 * 3600 * 1000);
        const p2 = n => String(n).padStart(2, '0');
        return `${t.getUTCMonth() + 1}/${t.getUTCDate()}（${'日一二三四五六'[t.getUTCDay()]}）${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}`;
    }

    function selfRegInfo(state, payments, eventKey, club, nowMs) {
        const st = state || {};
        const { catId, subName } = parseEventKey(eventKey);
        const cat = (st.categoriesData || []).find(c => c.id === catId);
        const out = { ok: false, reason: '', key: eventKey, subName, sports: false, anniv: false, perHead: false, seminar: false, fees: { compete: 0, mealOnly: 0, meal: 0, club: 0 }, paid: false, order: null };
        if (!cat || !subName || !(cat.subEvents || []).includes(subName)) { out.reason = 'no_event'; return out; }
        if (isApportionEvent(cat.name, subName)) { out.reason = 'apportionment'; return out; }
        if (isPelsEvent(subName)) { out.reason = 'pels'; return out; }
        out.ok = true;
        out.anniv = hasWord(cat.name, ['社慶']) || hasWord(subName, ['社慶']);
        out.sports = !out.anniv && isSportsLikeEvent(cat, subName);       // 要選「參賽／只用餐」
        out.perHead = out.sports || out.anniv;                              // 這個活動收人頭費（人數一變，該社應繳金額就變）
        out.seminar = !cat.allowSponsors;                                   // 研討會／年會：每社固定金額
        out.fees = {
            compete: subEventFeeOf(st.chairConfig, eventKey, 'feeCompete', 1200), mealOnly: subEventFeeOf(st.chairConfig, eventKey, 'feeMealOnly', 1000),
            meal: subEventFeeOf(st.chairConfig, eventKey, 'feeAnnivMeal', 1000), club: configuredClubFee(st.chairConfig, eventKey)
        };
        out.order = (((st.registrationOrders || {})[subName]) || []).find(o => o && o.clubName === club) || null;
        out.paid = isPaidStatus(((((payments || {})[eventKey]) || {})[club] || {}).status);
        const dl = regDeadlineOf(st.chairConfig, eventKey);
        out.deadlineAt = dl.at; out.deadlineSource = dl.source;
        out.closed = dl.at !== null && (nowMs === undefined ? Date.now() : nowMs) >= dl.at;      // 報名已截止：手機不能再報名／變更／取消
        return out;
    }
    function selfRegItemFee(info, participation) {
        return info.anniv ? info.fees.meal : (participation === '只用餐' ? info.fees.mealOnly : info.fees.compete);
    }
    /**
     * change＝{ ensure:[{ key, participation, guestOf, by }], remove:[key] }（key＝姓名|Nick Name）
     *   ensure：不在報名表就加入（只收社友庫裡的人）；已經在，而且是運動賽事、參加方式不同，就改參加方式。
     * 回傳 { ok, code, before, after, added, removed, updated, delta }；after＝null 代表整張報名表移除（沒有人也沒有贊助）。
     * code：REG_UNAVAILABLE／REG_SECRETARY_ONLY（PELS）／REG_CLOSED（報名已截止）／REG_PAID_LOCKED（該社已繳費，而這次變動會改變應繳金額）
     */
    function selfRegApply(info, members, club, change, nowStr) {
        if (!info || !info.ok) return { ok: false, code: info && info.reason === 'pels' ? 'REG_SECRETARY_ONLY' : 'REG_UNAVAILABLE' };
        if (info.closed) return { ok: false, code: 'REG_CLOSED' };
        const list = Array.isArray(members) ? members : [];
        const before = info.order ? JSON.parse(JSON.stringify(info.order)) : null;
        const order = info.order ? JSON.parse(JSON.stringify(info.order)) : {
            clubName: club, sponsorTier: 'PARTICIPANT', sponsorAmount: 0, participantFee: 0,
            apportionmentFee: info.seminar ? info.fees.club : 0, grandTotal: 0, submittedAt: nowStr, prizeSponsors: [], items: []
        };
        if (!Array.isArray(order.items)) order.items = [];
        const added = [], removed = [], updated = [];
        let delta = 0;
        const feeOf = it => Number(it.fee) || 0;
        ((change && change.remove) || []).forEach(k => {
            const i = order.items.findIndex(it => personKey(it) === k);
            if (i < 0) return;
            delta -= feeOf(order.items[i]); order.items.splice(i, 1); removed.push(k);
        });
        ((change && change.ensure) || []).forEach(w => {
            if (!w || !w.key || removed.includes(w.key)) return;
            const part = info.sports ? (w.participation === '只用餐' ? '只用餐' : '參賽') : '參賽';
            const ex = order.items.find(it => personKey(it) === w.key);
            if (ex) {
                if (info.sports && (ex.participation || '參賽') !== part && w.participation) {
                    const fee = selfRegItemFee(info, part);
                    delta += fee - feeOf(ex); ex.participation = part; ex.fee = fee; updated.push(w.key);
                }
                return;
            }
            const m = list.find(x => x && personKey(x) === w.key);
            if (!m) return;
            const it = { role: m.role, nickname: m.nickname, name: m.name, diet: m.diet, veganNote: m.veganNote, handicap: m.handicap !== undefined ? m.handicap : '', participation: part, fee: selfRegItemFee(info, part), via: 'line', lineBy: String(w.by || '') };
            if (w.guestOf) it.lineGuestOf = String(w.guestOf);
            order.items.push(it); delta += feeOf(it); added.push(w.key);
        });
        if (!added.length && !removed.length && !updated.length) return { ok: true, before, after: before, added, removed, updated, delta: 0, changed: false };
        if (!info.perHead) delta = 0;
        if (info.perHead && info.paid && delta !== 0) return { ok: false, code: 'REG_PAID_LOCKED' };
        if (info.perHead) {
            order.participantFee = (Number(order.participantFee) || 0) + delta;
            order.grandTotal = info.order ? (Number(order.grandTotal) || 0) + delta : (Number(order.sponsorAmount) || 0) + order.participantFee + (Number(order.apportionmentFee) || 0);
        } else if (!info.order) {
            order.grandTotal = (Number(order.sponsorAmount) || 0) + (Number(order.apportionmentFee) || 0);
        }
        order.submittedAt = nowStr;
        const empty = !order.items.length && (!order.sponsorTier || order.sponsorTier === 'PARTICIPANT') && !(Number(order.sponsorAmount) > 0) && !((order.prizeSponsors || []).length);
        return { ok: true, before, after: empty ? null : order, added, removed, updated, delta, changed: true };
    }

    // ---------- 社費推播：執秘填的表單 → 每位社友的明細（報名系統畫面與雲端小程式共用同一套算法） ----------
    // form＝{ info:{period,due,method,note}, common:[{name,amount}], members:{ '姓名|Nick Name': { off:[共同品項的序號…], extra:[{name,amount}] } } }
    // 金額是整數、可以是負數（例：溢繳折抵）；金額為 0 或沒有名稱的品項不算。
    const DUES_LIMITS = { common: 10, extra: 10, name: 30, amount: 9999999, period: 40, due: 40, method: 200, note: 300 };
    function duesText(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max); }
    function duesItems(list, max, keepCarried) {
        const out = [];
        (Array.isArray(list) ? list : []).forEach(it => {
            if (out.length >= max || !it) return;
            const name = duesText(it.name, DUES_LIMITS.name), amount = Math.round(Number(it.amount));
            if (!name || !Number.isFinite(amount) || amount === 0 || Math.abs(amount) > DUES_LIMITS.amount) return;
            const o = { name, amount };
            if (keepCarried && it.carried) o.carried = true;
            out.push(o);
        });
        return out;
    }
    // 整理表單：去掉不合法的內容。共同品項的「序號」以整理後的陣列為準，所以畫面要先整理再讓使用者取消勾選
    function duesNormalize(form, keepCarried) {
        const f = form || {}, info = f.info || {};
        const common = duesItems(f.common, DUES_LIMITS.common, false);
        const members = {};
        Object.keys(f.members && typeof f.members === 'object' ? f.members : {}).forEach(k => {
            const m = f.members[k] || {};
            const off = Array.from(new Set((Array.isArray(m.off) ? m.off : []).map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < common.length))).sort((a, b) => a - b);
            const extra = duesItems(m.extra, DUES_LIMITS.extra, keepCarried);
            if (off.length || extra.length) members[k] = { off, extra };
        });
        return { info: { period: duesText(info.period, DUES_LIMITS.period), due: duesText(info.due, DUES_LIMITS.due), method: duesText(info.method, DUES_LIMITS.method), note: duesText(info.note, DUES_LIMITS.note) }, common, members };
    }
    // 每位社友的明細與小計。只列社友庫裡的社友（寶(尊)眷不列），順序同社友名單（P → S → Nick Name）
    function duesCompute(memberList, form) {
        const f = duesNormalize(form);
        return sortMembers((Array.isArray(memberList) ? memberList : []).filter(m => m && m.name && !isSpouseMember(m))).map(m => {
            const key = personKey(m), mine = f.members[key] || { off: [], extra: [] };
            const items = f.common.filter((_, i) => !mine.off.includes(i)).map(it => ({ name: it.name, amount: it.amount })).concat(mine.extra.map(it => ({ name: it.name, amount: it.amount })));
            return { key, name: m.name, nickname: m.nickname || '', items, total: items.reduce((n, it) => n + it.amount, 0) };
        });
    }
    function duesMoney(n) { const v = Math.round(Number(n) || 0); return (v < 0 ? '-' : '') + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
    // 給沒綁定 LINE 的社友用的純文字明細（內容與 LINE 卡片相同）
    function duesPlainText(club, info, p) {
        const i = info || {};
        const lines = ['【' + club + '】' + (i.period || '社費'), (p.name + (p.nickname ? ' ' + p.nickname : '')) + ' 社友您好', '────────────'];
        (p.items || []).forEach(it => lines.push(it.name + '　' + duesMoney(it.amount)));
        lines.push('────────────', '合計　NT$ ' + duesMoney(p.total));
        if (i.due) lines.push('繳費期限：' + i.due);
        if (i.method) lines.push('繳費方式：' + i.method);
        if (i.note) lines.push(i.note);
        return lines.join('\n');
    }

    root.CheckinCore = {
        DUES_LIMITS, duesNormalize, duesCompute, duesMoney, duesPlainText,
        regDeadlineOf, regClosed, regDeadlineText,
        subEventFeeOf, isSportsLikeEvent, selfRegInfo, selfRegItemFee, selfRegApply,
        isPaidStatus, isDistrictOfficeDivision, paymentDivisions, divisionPayRows, isPaymentTrackingCat, configuredClubFee, listStatEvents, eventStats,
        norm, personKey, makeEventKey, parseEventKey, isApportionEvent, isPelsEvent, PELS_SHORT,
        buildClubIndex, prizeMealGuests, buildRoster, mergeCheckins, computeStats, matchEntry,
        memberRoleRank, compareMembers, isSpouseMember, sortMembers, nickParts
    };
})(typeof window !== 'undefined' ? window : globalThis);
