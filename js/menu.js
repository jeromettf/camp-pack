/* 메뉴·식단표 계산 (화면 없이 동작 — 브라우저·노드 공용)
 * 메뉴 줄: lines.kind '메뉴' — name=메뉴 이름, itemId=레시피 id(직접 적기면 ''), meal='D1|저녁' 또는 'any',
 *          qty=인원, party=준비할 가족, note=직접 적기 종류(외식·사 먹기·메모)
 * 재료 줄: kind '장보기', source '메뉴재료', itemId 'T-ing-이름-가족' (같은 재료·같은 가족끼리 합침), menuId=메뉴 줄 id들
 * 도구 줄: kind '물건', source '메뉴도구', itemId=준비물 창고 id (이미 목록에 있으면 만들지 않음)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CampMenu = factory();
})(this, function () {
  var SLOTS = ['아침', '점심', '간식', '저녁', '야식·안주'];
  var SLOT_HOUR = { '아침': 8, '점심': 12, '간식': 15, '저녁': 18, '야식·안주': 21 };
  var AISLE = ['육류', '수산', '채소·과일', '냉장·가공', '면·밥·빵·떡', '소스·양념', '간식·음료', '소모품', '기타'];
  var CATS = ['고기·구이', '찌개·국·탕', '볶음·철판', '밥·죽', '면', '아침·브런치', '아이 메뉴', '안주·간식', '해산물', '디저트·음료'];
  var KINDS = ['외식', '사 먹기', '메모'];

  function num(v, d) { var n = parseFloat(v); return isNaN(n) ? d : n; }
  function list(v) { return Array.isArray(v) ? v : String(v || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean); }
  function json(v, d) { if (Array.isArray(v)) return v; try { var x = JSON.parse(v); return Array.isArray(x) ? x : d; } catch (e) { return d; } }

  /* ── 날짜·끼니 ── */
  function addDay(iso, n) {
    var d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  /** 캠핑 날짜 → [{key:'D1', n:1, date:'2026-10-09'}] (최대 14일) */
  function days(start, end) {
    if (!start) return [];
    var out = [], d = start, n = 1;
    end = end && end >= start ? end : start;
    while (d <= end && n <= 14) { out.push({ key: 'D' + n, n: n, date: d }); d = addDay(d, 1); n++; }
    return out;
  }
  function parseMeal(v) {
    var m = /^D(\d+)\|(.+)$/.exec(String(v || ''));
    return m && SLOTS.indexOf(m[2]) >= 0 ? { day: Number(m[1]), slot: m[2] } : null;
  }
  function mealKey(day, slot) { return day && slot ? 'D' + day + '|' + slot : 'any'; }
  /** 정렬용 숫자: 날짜·끼니 순, '아무 때'는 맨 뒤 */
  function mealOrder(v) { var p = parseMeal(v); return p ? p.day * 10 + SLOTS.indexOf(p.slot) : 9999; }
  /** 끼니 시각 (캠핑 시작일 기준 ISO 날짜 + 시) */
  function mealTime(start, v) {
    var p = parseMeal(v); if (!p || !start) return null;
    return { date: addDay(start, p.day - 1), hour: SLOT_HOUR[p.slot] };
  }
  /** 지금(날짜·시) 이후 첫 끼니의 메뉴들. 지난 끼니는 1시간 여유 */
  function nextMeal(meals, start, nowDate, nowHour) {
    var keys = {};
    meals.forEach(function (m) {
      var t = mealTime(start, m.meal); if (!t) return;
      if (t.date > nowDate || (t.date === nowDate && t.hour + 1 >= nowHour)) keys[m.meal] = 1;
    });
    var ks = Object.keys(keys).sort(function (a, b) { return mealOrder(a) - mealOrder(b); });
    if (!ks.length) return null;
    return { meal: ks[0], items: meals.filter(function (m) { return m.meal === ks[0]; }) };
  }
  function isPast(start, v, nowDate, nowHour) {
    var t = mealTime(start, v); if (!t) return false;
    return t.date < nowDate || (t.date === nowDate && t.hour + 2 < nowHour);
  }

  /* ── 레시피 ── */
  /** 시트에 저장된 우리 가족 레시피 행 → 레시피 객체 */
  function fromRow(r) {
    return {
      id: r.id, name: r.name, category: r.category || '안주·간식', slots: list(r.slots), time: num(r.time, 0), level: r.level || '',
      equipment: list(r.equipment), tags: list(r.tags), ingredients: json(r.ingredients, []), pantry: list(r.pantry),
      steps: json(r.steps, []), tip: r.tip || '', prep: r.prep || '', custom: true,
    };
  }
  function toRow(rc) {
    return {
      name: rc.name, category: rc.category, slots: (rc.slots || []).join(', '), time: String(rc.time || ''), level: rc.level || '',
      equipment: (rc.equipment || []).join(', '), tags: (rc.tags || []).join(', '), ingredients: JSON.stringify(rc.ingredients || []),
      pantry: (rc.pantry || []).join(', '), steps: JSON.stringify(rc.steps || []), tip: rc.tip || '', prep: rc.prep || '', active: 'Y',
    };
  }
  /** 기본 레시피 + 우리 가족 레시피(같은 id 면 덮어씀, 활성 N 이면 숨김) */
  function mergeRecipes(builtin, rows) {
    var map = {}, order = [];
    (builtin || []).forEach(function (r) { map[r.id] = r; order.push(r.id); });
    (rows || []).forEach(function (row) {
      if (!row || !row.id || !row.name) return;
      if (map[row.id] === undefined) order.push(row.id);
      map[row.id] = row.active === 'N' ? null : fromRow(row);
    });
    return order.map(function (id) { return map[id]; }).filter(Boolean);
  }
  function search(recipes, q, cat, noEquip) {
    q = String(q || '').trim().toLowerCase();
    return recipes.filter(function (r) {
      if (cat && r.category !== cat) return false;
      if (noEquip && noEquip.length && r.equipment.some(function (e) { return noEquip.indexOf(e) >= 0; })) return false;
      if (!q) return true;
      return (r.name + ' ' + r.tags.join(' ') + ' ' + r.ingredients.map(function (i) { return i.name; }).join(' ')).toLowerCase().indexOf(q) >= 0;
    });
  }

  /* ── 분량·장보기 단위 ── */
  function dictMap(dict) { var m = {}; ((dict && dict.items) || []).forEach(function (i) { m[i.name] = i; }); return m; }
  function fmtAmt(unit, q) {
    if (unit === 'g' || unit === 'ml') {
      var r = Math.round(q / 10) * 10 || Math.round(q);
      return r >= 1000 ? (+(r / 1000).toFixed(1)) + (unit === 'g' ? 'kg' : 'L') : r + unit;
    }
    var x = Math.round(q * 4) / 4, w = Math.floor(x), f = x - w, fr = { 0.25: '1/4', 0.5: '1/2', 0.75: '3/4' }[f] || '';
    return (w ? w : '') + (fr ? (w ? ' ' : '') + fr : '') + (x ? '' : '0') + (unit || '');
  }
  /** 장보기 표시: 포장 단위가 있으면 "3봉 · 약 54장" */
  function buyText(d, q) {
    var unit = (d && d.unit) || '';
    if (d && d.pack) { var n = Math.ceil(q / d.pack - 1e-9); return { qty: n, text: n + d.packName + ' · 약 ' + fmtAmt(unit, q) }; }
    if (unit === 'g' || unit === 'ml') return { qty: 1, text: fmtAmt(unit, q) };
    var c = Math.ceil(q - 1e-9);
    return { qty: Math.max(1, c), text: fmtAmt(unit, q) };
  }

  /**
   * 메뉴들로부터 필요한 재료·기본양념·도구 계산
   * ctx: { recipes: {id: recipe}, dict, defaultServings, hasComp }
   */
  function plan(meals, ctx) {
    var D = dictMap(ctx.dict), groc = {}, pantry = {}, equip = {};
    meals.forEach(function (m) {
      if (m.deleted === 'Y' || m.kind !== '메뉴' || !m.itemId) return;
      var r = ctx.recipes[m.itemId]; if (!r) return;
      var n = Math.max(1, num(m.qty, ctx.defaultServings || 1));
      var party = ctx.hasComp ? (m.party || '미정') : '';
      r.ingredients.forEach(function (i) {
        if (i.opt) return;
        var key = i.name + '-' + party;
        var g = groc[key] || (groc[key] = { key: key, name: i.name, party: party, total: 0, menus: [], menuIds: [] });
        g.total += num(i.qty, 0) * n;
        if (g.menus.indexOf(r.name) < 0) g.menus.push(r.name);
        if (g.menuIds.indexOf(m.id) < 0) g.menuIds.push(m.id);
      });
      r.pantry.forEach(function (p) { (pantry[p] = pantry[p] || []).indexOf(r.name) < 0 && pantry[p].push(r.name); });
      r.equipment.forEach(function (e) {
        var name = (ctx.dict && ctx.dict.equipment && ctx.dict.equipment[e]) || e;
        (equip[name] = equip[name] || []).indexOf(r.name) < 0 && equip[name].push(r.name);
      });
    });
    var groceries = Object.keys(groc).map(function (k) {
      var g = groc[k], d = D[g.name] || { unit: '', aisle: '기타' }, b = buyText(d, g.total);
      g.aisle = d.aisle || '기타'; g.qty = b.qty; g.text = b.text; g.noteExtra = d.note || '';
      return g;
    }).sort(function (a, b) { return AISLE.indexOf(a.aisle) - AISLE.indexOf(b.aisle) || (a.name < b.name ? -1 : 1); });
    return { groceries: groceries, pantry: pantry, equipment: equip };
  }

  /** 같은 캠핑·같은 키면 어느 기기에서 만들어도 같은 id (두 기기가 동시에 동기화해도 중복 줄이 생기지 않음) */
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }
  function genId(tripId, key) { return 'L-' + hash(tripId) + '-' + hash(key); }
  /**
   * 계획 → 체크 줄 변경(ops). 체크했거나 금액을 넣은 줄은 지우지 않음.
   * ctx: { tripId, lines(이 캠핑 전체), items(준비물 창고), hasComp }
   */
  function syncOps(p, ctx) {
    var ops = [], lines = ctx.lines || [], tid = ctx.tripId;
    var keep = function (l) { return !!(l.pack || l.done || l.amount); };
    var byId = {}; lines.forEach(function (l) { byId[l.id] = l; });
    // 재료 → 장보기: 같은 재료·같은 가족 줄을 먼저 찾고, 없으면 고정 id 로 만듦
    var gen = {};
    lines.forEach(function (l) {
      if (l.source !== '메뉴재료' || l.kind !== '장보기') return;
      var k = l.name + '-' + (l.party || '');
      (gen[k] = gen[k] || []).push(l);
    });
    var want = {};
    p.groceries.forEach(function (g) {
      var cands = gen[g.key] || [];
      var ex = cands.filter(function (l) { return l.deleted !== 'Y'; })[0] || cands[0] || byId[genId(tid, 'ing:' + g.key)];
      var note = g.text + ' · ' + g.menus.join(', ') + (g.noteExtra ? ' · ' + g.noteExtra : '');
      var set = { qty: String(g.qty), note: note, menuId: g.menuIds.join(',') };
      if (!ex) {
        var nid = genId(tid, 'ing:' + g.key); want[nid] = 1;
        ops.push({ t: 'lines', id: nid, set: { tripId: tid, kind: '장보기', itemId: 'T-ing', name: g.name, category: '음식·음료',
          qty: set.qty, note: note, menuId: set.menuId, source: '메뉴재료', shared: ctx.hasComp ? 'Y' : '', party: g.party, deleted: '' } });
        return;
      }
      want[ex.id] = 1;
      // 메뉴가 빠져서 자동으로 지운 줄(menuId 비움)만 되살림 — 사용자가 직접 뺀 재료는 그대로 둠
      if (ex.deleted === 'Y') { if (ex.menuId) return; set.deleted = ''; }
      if (keep(ex)) delete set.qty; // 이미 챙긴 것은 수량 그대로
      if (String(ex.party || '') !== g.party) set.party = g.party;
      var diff = Object.keys(set).some(function (k) { return String(ex[k] || '') !== String(set[k]); });
      if (diff) ops.push({ t: 'lines', id: ex.id, set: set });
    });
    lines.forEach(function (l) {
      if (l.source === '메뉴재료' && l.kind === '장보기' && !want[l.id] && l.deleted !== 'Y' && !keep(l))
        ops.push({ t: 'lines', id: l.id, set: { deleted: 'Y', menuId: '' } });
    });
    // 기본양념 챙기기 (할 일 1줄)
    var pk = Object.keys(p.pantry), pid = genId(tid, 'pantry'), pex = byId[pid];
    if (pk.length) {
      var pnote = pk.join(', ');
      if (!pex) ops.push({ t: 'lines', id: pid, set: { tripId: tid, kind: '할일', itemId: 'T-pantry', name: '기본양념 챙기기', category: '할 일',
        qty: '1', note: pnote, source: '메뉴재료', shared: '', party: '' } });
      else if (pex.note !== pnote || (pex.deleted === 'Y' && !pex.menuId)) ops.push({ t: 'lines', id: pid, set: { note: pnote, deleted: pex.deleted === 'Y' && pex.menuId ? 'Y' : '', menuId: 'p' } });
    } else if (pex && pex.deleted !== 'Y' && !keep(pex)) ops.push({ t: 'lines', id: pid, set: { deleted: 'Y', menuId: '' } });
    // 도구 → 준비물 (창고 항목과 연결, 이미 목록에 있으면 만들지 않음)
    var itemByName = {}; (ctx.items || []).forEach(function (i) { itemByName[i.name] = i; });
    var byItem = {}; lines.forEach(function (l) { if (l.itemId) (byItem[l.itemId] = byItem[l.itemId] || []).push(l); });
    var needItem = {};
    Object.keys(p.equipment).forEach(function (name) {
      var it = itemByName[name]; if (!it) return;
      needItem[it.id] = 1;
      var ls = byItem[it.id] || [], note = '메뉴: ' + p.equipment[name].join(', ');
      if (ls.some(function (l) { return l.deleted !== 'Y' && l.source !== '메뉴도구'; })) return; // 원래 목록에 있음
      var mine = ls.filter(function (l) { return l.source === '메뉴도구'; })[0];
      if (mine) {
        if (mine.deleted === 'Y' && mine.menuId) return; // 직접 뺀 도구
        if (mine.deleted === 'Y' || mine.note !== note) ops.push({ t: 'lines', id: mine.id, set: { deleted: '', note: note, menuId: 'e' } });
        return;
      }
      if (ls.length) return; // 직접 뺀 항목은 다시 넣지 않음
      ops.push({ t: 'lines', id: genId(tid, 'eq:' + it.id), set: { tripId: tid, kind: '물건', itemId: it.id, name: it.name, category: it.category || '조리·식기',
        qty: '1', note: note, menuId: 'e', source: '메뉴도구', shared: '', party: '' } });
    });
    lines.forEach(function (l) {
      if (l.source === '메뉴도구' && !needItem[l.itemId] && l.deleted !== 'Y' && !keep(l)) ops.push({ t: 'lines', id: l.id, set: { deleted: 'Y', menuId: '' } });
    });
    return ops;
  }

  return {
    SLOTS: SLOTS, AISLE: AISLE, CATS: CATS, KINDS: KINDS, days: days, parseMeal: parseMeal, mealKey: mealKey, mealOrder: mealOrder,
    mealTime: mealTime, nextMeal: nextMeal, isPast: isPast, fromRow: fromRow, toRow: toRow, mergeRecipes: mergeRecipes, search: search,
    dictMap: dictMap, fmtAmt: fmtAmt, buyText: buyText, plan: plan, syncOps: syncOps, genId: genId,
  };
});
