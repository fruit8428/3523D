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

    root.CheckinCore = {
        norm, personKey, makeEventKey, parseEventKey, isApportionEvent, isPelsEvent, PELS_SHORT,
        buildClubIndex, prizeMealGuests, buildRoster, mergeCheckins, computeStats, matchEntry
    };
})(typeof window !== 'undefined' ? window : globalThis);
