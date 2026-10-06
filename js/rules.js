/* camp-pack 규칙 엔진 — 브라우저(window.CampRules)와 Node(require) 양쪽에서 동작 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CampRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var RULES = ['고정', '가족당', '전체인원당', '어른당', '아이당', '반려견당', '박당', '가족×박', '전체×박'];
  var RULE_SOURCES = { '규칙': 1, '장소': 1, '재고': 1, '수납함': 1 };
  var STAGES = [
    { key: 'todo', label: '할 일', field: 'done' },
    { key: 'pack', label: '짐싸기', field: 'pack' },
    { key: 'load', label: '싣기', field: 'load' },
    { key: 'back', label: '철수', field: 'back' },
  ];

  function list(s) {
    if (Array.isArray(s)) return s.filter(Boolean);
    return String(s == null ? '' : s).split(/[,，\n]/).map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function yes(v) { return String(v).trim().toUpperCase() === 'Y'; }
  function active(r) { return String(r.active == null ? '' : r.active).trim().toUpperCase() !== 'N'; }
  function num(v, d) { var n = Number(v); return isFinite(n) && String(v).trim() !== '' ? n : d; }

  function parseDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  }
  function daysBetween(a, b) {
    var x = parseDate(a), y = parseDate(b);
    return x && y ? Math.round((y - x) / 86400000) : 0;
  }
  function addDays(s, n) {
    var d = parseDate(s); if (!d) return '';
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function seasonTag(dateStr) {
    var d = parseDate(dateStr); if (!d) return null;
    var m = d.getUTCMonth() + 1;
    if (m >= 6 && m <= 8) return '하계';
    if (m === 12 || m <= 2) return '동계';
    return '봄가을';
  }

  /** 캠핑 조건 → 인원·박수·태그 컨텍스트 */
  function deriveContext(trip, members, place) {
    var ids = list(trip.members);
    var c = { adults: 0, kids: 0, infants: 0, pets: 0 };
    (members || []).forEach(function (m) {
      if (ids.indexOf(m.id) < 0) return;
      if (m.type === '아이') c.kids++;
      else if (m.type === '영유아') c.infants++;
      else if (m.type === '반려견') c.pets++;
      else c.adults++;
    });
    var comp = parseCompanions(trip.companions);
    c.guestAdults = comp.length ? comp.reduce(function (s, x) { return s + num(x.adults, 0); }, 0) : num(trip.guestAdults, 0);
    c.guestKids = comp.length ? comp.reduce(function (s, x) { return s + num(x.kids, 0); }, 0) : num(trip.guestKids, 0);
    c.companions = comp;
    c.family = c.adults + c.kids + c.infants;
    c.total = c.family + c.guestAdults + c.guestKids;
    c.nights = Math.max(0, daysBetween(trip.start, trip.end));

    var auto = [];
    list(place && place.tags).forEach(function (t) { auto.push(t); });
    var s = seasonTag(trip.start); if (s) auto.push(s);
    if (c.kids + c.guestKids > 0) auto.push('아이');
    if (c.infants > 0) auto.push('영유아');
    if (c.pets > 0) auto.push('반려견');
    if (c.guestAdults + c.guestKids > 0) auto.push('손님');
    auto.push(c.nights <= 1 ? '1박' : '연박');
    var w = parseWeather(trip.weather);
    if (w && w.tags) w.tags.forEach(function (t) { auto.push(t); });

    auto = uniq(auto);
    var add = list(trip.tagsAdd), remove = list(trip.tagsRemove);
    var tags = uniq(auto.concat(add)).filter(function (t) { return remove.indexOf(t) < 0; });
    c.autoTags = auto; c.tags = tags;
    return c;
  }

  /** 동행 가족: [{name, adults, kids}] (시트에는 JSON 문자열) */
  function parseCompanions(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    try { var a = JSON.parse(v); return Array.isArray(a) ? a.filter(function (x) { return x && x.name; }) : []; } catch (e) { return []; }
  }
  /** 다른 가족 담당이면 우리 짐 목록에서 제외 */
  function isOtherParty(l) { return !!(l.party && l.party !== '우리' && l.party !== '미정'); }

  function uniq(a) { var s = {}; return a.filter(function (x) { if (s[x]) return false; s[x] = 1; return true; }); }

  function parseWeather(w) {
    if (!w) return null;
    if (typeof w === 'object') return w;
    try { return JSON.parse(w); } catch (e) { return null; }
  }

  function multiplier(rule, c) {
    var n = Math.max(1, c.nights);
    switch (rule) {
      case '가족당': return c.family;
      case '전체인원당': return c.total;
      case '어른당': return c.adults;
      case '아이당': return c.kids;
      case '반려견당': return c.pets;
      case '박당': return n;
      case '가족×박': return c.family * n;
      case '전체×박': return c.total * n;
      default: return 1;
    }
  }

  function tokenMatch(token, tagSet) {
    return token.split('&').every(function (p) { return tagSet[p.trim()]; });
  }

  /** 준비물 1개 판정 → {included, qty, reason} */
  function evalItem(item, c, tagSet, placeItems) {
    if (!active(item)) return { included: false, reason: '보관됨' };
    var byPlace = placeItems && placeItems.indexOf(item.id) >= 0;
    var exc = list(item.exclude).filter(function (t) { return tokenMatch(t, tagSet); });
    if (!byPlace && exc.length) return { included: false, reason: '제외 조건: ' + exc.join(', ') };
    var inc = list(item.include);
    if (!byPlace && inc.length && !inc.some(function (t) { return tokenMatch(t, tagSet); }))
      return { included: false, reason: '포함 조건 없음: ' + inc.join(', ') };
    var rule = item.rule || '고정';
    var qty = num(item.base, 1) * multiplier(rule, c);
    if (qty <= 0) return { included: false, reason: '해당 인원 없음 (' + rule + ')' };
    return { included: true, qty: qty, byPlace: byPlace };
  }

  /** 과거 회고로부터 학습 정보 계산 */
  function learn(trips, reviews, beforeDate) {
    var done = (trips || []).filter(function (t) {
      return t.status !== '보관' && t.end && (!beforeDate || t.end < beforeDate);
    }).sort(function (a, b) { return a.end < b.end ? 1 : -1; });
    var byTrip = {};
    (reviews || []).forEach(function (r) { (byTrip[r.tripId] = byTrip[r.tripId] || []).push(r); });
    var forgot = {}, short = {};
    done.slice(0, 3).forEach(function (t) {
      (byTrip[t.id] || []).forEach(function (r) {
        if (r.result === '깜빡함' && r.itemId && !forgot[r.itemId]) forgot[r.itemId] = t.start;
      });
    });
    if (done[0]) (byTrip[done[0].id] || []).forEach(function (r) {
      if (r.result === '부족' && r.itemId) short[r.itemId] = Math.max(1, num(r.qty, 1));
    });
    return { forgot: forgot, short: short };
  }

  function md(s) { var d = parseDate(s); return d ? (d.getUTCMonth() + 1) + '/' + d.getUTCDate() : ''; }

  /**
   * 체크리스트 생성.
   * in: {trip, items, boxes, members, place, trips, reviews}
   * out: {ctx, lines:[...], excluded:[{item, reason}]}
   */
  function buildLines(o) {
    var c = deriveContext(o.trip, o.members, o.place);
    var tagSet = {}; c.tags.forEach(function (t) { tagSet[t] = 1; });
    var placeItems = list(o.place && o.place.items);
    var L = learn(o.trips, o.reviews, o.trip.start);
    var lines = [], excluded = [];

    (o.items || []).forEach(function (it) {
      var r = evalItem(it, c, tagSet, placeItems);
      if (!r.included) { if (active(it)) excluded.push({ item: it, reason: r.reason }); return; }
      var qty = r.qty, notes = [];
      if (L.short[it.id]) { qty += L.short[it.id]; notes.push('지난번 부족 → +' + L.short[it.id]); }
      if (L.forgot[it.id]) notes.push('⚠️ ' + md(L.forgot[it.id]) + ' 캠핑에서 깜빡함');
      if (it.memo) notes.push(it.memo);
      lines.push({
        kind: it.kind === '할일' ? '할일' : '물건', itemId: it.id, name: it.name,
        category: it.category || '', box: it.kind === '할일' ? '' : (it.box || ''), qty: qty,
        owner: it.owner || '', leave: yes(it.leave) ? 'Y' : '',
        warn: L.forgot[it.id] ? 'Y' : '', note: notes.join(' · '),
        source: r.byPlace ? '장소' : '규칙',
        shared: yes(it.shared) ? 'Y' : '',
        party: yes(it.shared) && c.companions.length ? '미정' : '',
      });
    });

    (o.items || []).forEach(function (it) {
      if (!active(it) || !yes(it.consumable)) return;
      if (it.stock === '부족' || it.stock === '없음') lines.push({
        kind: '할일', itemId: it.id, name: '구매: ' + it.name, category: '할 일', box: '', qty: 1,
        owner: '', leave: '', warn: '', note: '재고 ' + it.stock, source: '재고',
      });
    });

    boxLinesFor(lines, o.boxes).forEach(function (b) { lines.push(b); });
    return { ctx: c, lines: lines, excluded: excluded };
  }

  function boxLinesFor(lines, boxes) {
    var used = [], seen = {};
    lines.forEach(function (l) {
      if (l.kind === '물건' && l.box && l.deleted !== 'Y' && !isOtherParty(l) && !seen[l.box]) { seen[l.box] = 1; used.push(l.box); }
    });
    var order = {};
    (boxes || []).forEach(function (b, i) { order[b.name] = { id: b.id, i: num(b.order, i) }; });
    used.sort(function (a, b) { return (order[a] ? order[a].i : 999) - (order[b] ? order[b].i : 999); });
    return used.map(function (name) {
      return {
        kind: '수납함', itemId: order[name] ? order[name].id : 'box:' + name, name: name,
        category: '수납함', box: name, qty: 1, owner: '', leave: '', warn: '', note: '', source: '수납함',
      };
    });
  }

  function lineKey(l) {
    if (l.source === '수납함' || l.kind === '수납함') return 'box:' + l.itemId;
    if (l.source === '재고') return 'restock:' + l.itemId;
    if (!l.itemId || String(l.itemId).indexOf('T-') === 0) return null;
    return 'item:' + l.itemId;
  }

  /**
   * 조건 변경 시 기존 체크리스트와 새 계산 결과 비교.
   * 체크 상태는 건드리지 않고 추가·수량변경·제거 제안만 만든다.
   */
  function diffLines(existing, fresh) {
    var ex = {}, fr = {};
    existing.forEach(function (l) { var k = lineKey(l); if (k) ex[k] = l; });
    fresh.forEach(function (l) { var k = lineKey(l); if (k) fr[k] = l; });
    var add = [], qty = [], remove = [];
    fresh.forEach(function (l) {
      var k = lineKey(l); if (!k) return;
      var e = ex[k];
      if (!e) add.push(l);
      else if (e.deleted !== 'Y' && l.kind !== '수납함' && RULE_SOURCES[e.source] && num(e.qty, 1) !== l.qty)
        qty.push({ line: e, from: num(e.qty, 1), to: l.qty });
    });
    existing.forEach(function (l) {
      var k = lineKey(l);
      if (k && l.deleted !== 'Y' && RULE_SOURCES[l.source] && !fr[k]) remove.push(l);
    });
    return { add: add, qty: qty, remove: remove, count: add.length + qty.length + remove.length };
  }

  /** 단계별로 보여줄 항목 */
  function stageLines(lines, stage) {
    var live = lines.filter(function (l) { return l.deleted !== 'Y' && !isOtherParty(l); });
    switch (stage) {
      case 'todo': return live.filter(function (l) { return l.kind === '할일' || l.kind === '장보기'; });
      case 'pack': return live.filter(function (l) { return l.kind === '물건'; });
      case 'load': return live.filter(function (l) { return l.kind === '수납함' || (l.kind === '물건' && !l.box); });
      case 'back': return live.filter(function (l) {
        return l.kind === '수납함' || (l.kind === '물건' && (!l.box || yes(l.leave)));
      });
    }
    return [];
  }
  function stageField(stage) {
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i].key === stage) return STAGES[i].field;
    return 'pack';
  }
  function progress(lines, stage) {
    var s = stageLines(lines, stage), f = stageField(stage);
    var done = s.filter(function (l) { return !!l[f]; }).length;
    return { done: done, total: s.length };
  }

  /** 시트 직접 편집 실수 점검 */
  function lint(items, boxes, tagDict, categories) {
    var known = {}; (tagDict || []).forEach(function (t) { known[t] = 1; });
    var cats = {}; (categories || []).forEach(function (t) { cats[t] = 1; });
    var bx = {}; (boxes || []).forEach(function (b) { if (active(b)) bx[b.name] = 1; });
    var names = {}, out = [];
    (items || []).forEach(function (it) {
      if (!active(it)) return;
      var p = [];
      if (!String(it.name || '').trim()) p.push('이름 없음');
      list(it.include).concat(list(it.exclude)).forEach(function (tok) {
        tok.split('&').forEach(function (t) { t = t.trim(); if (t && !known[t]) p.push('모르는 태그 "' + t + '"'); });
      });
      if (it.rule && RULES.indexOf(it.rule) < 0) p.push('모르는 수량규칙 "' + it.rule + '"');
      if (!(num(it.base, NaN) > 0)) p.push('기본수량이 숫자가 아님');
      if (it.category && categories && !cats[it.category]) p.push('모르는 카테고리 "' + it.category + '"');
      if (it.box && boxes && !bx[it.box]) p.push('모르는 수납함 "' + it.box + '"');
      var n = String(it.name || '').trim();
      if (n && names[n]) p.push('이름 중복'); names[n] = 1;
      if (p.length) out.push({ item: it, problems: p });
    });
    return out;
  }

  /** Open-Meteo daily 예보 → 태그·요약 */
  function weatherTags(daily) {
    if (!daily || !daily.time || !daily.time.length) return { tags: [], text: '' };
    var maxP = Math.max.apply(null, (daily.precipitation_probability_max || [0]).map(function (x) { return x || 0; }));
    var minT = Math.min.apply(null, (daily.temperature_2m_min || [99]).map(function (x) { return x == null ? 99 : x; }));
    var maxT = Math.max.apply(null, (daily.temperature_2m_max || [-99]).map(function (x) { return x == null ? -99 : x; }));
    var wind = Math.max.apply(null, (daily.wind_speed_10m_max || [0]).map(function (x) { return x || 0; }));
    var tags = [];
    if (maxP >= 60) tags.push('우천');
    if (minT <= -5) tags.push('혹한');
    if (minT <= 5) tags.push('동계');
    if (maxT >= 28) tags.push('하계');
    if (wind >= 30) tags.push('강풍');
    var text = '강수 ' + maxP + '% · 최저 ' + Math.round(minT) + '℃ · 최고 ' + Math.round(maxT) + '℃ · 바람 ' + Math.round(wind / 3.6) + 'm/s';
    return { tags: tags, text: text };
  }

  /** 연속 '안씀' → 보관 제안 */
  function unusedSuggestions(items, trips, reviews, threshold) {
    threshold = threshold || 3;
    var reviewed = (trips || []).filter(function (t) { return yes(t.reviewed) && t.status !== '보관'; })
      .sort(function (a, b) { return a.end < b.end ? 1 : -1; }).slice(0, threshold);
    if (reviewed.length < threshold) return [];
    var sets = reviewed.map(function (t) {
      var s = {}; (reviews || []).forEach(function (r) { if (r.tripId === t.id && r.result === '안씀') s[r.itemId] = 1; });
      return s;
    });
    return (items || []).filter(function (it) {
      return active(it) && sets.every(function (s) { return s[it.id]; });
    });
  }

  /** 같이 챙기기 대상: 공용 짐 + 장보기 + 정산 항목 */
  function sharedLines(lines) {
    return lines.filter(function (l) {
      return l.deleted !== 'Y' && (yes(l.shared) || l.kind === '장보기' || l.kind === '정산' || isOtherParty(l));
    });
  }

  /**
   * 정산. parties: [{name, people}] (첫 번째가 우리). rule: '가족' | '인원'
   * 결제자 이름은 '우리' 또는 동행 가족 이름. 10원 단위 반올림.
   */
  function settle(lines, parties, rule) {
    var names = parties.map(function (p) { return p.name; });
    var paid = {}, total = 0, items = [];
    names.forEach(function (n) { paid[n] = 0; });
    lines.forEach(function (l) {
      var a = Math.round(num(String(l.amount || '').replace(/[^\d.-]/g, ''), 0));
      if (l.deleted === 'Y' || !a || !l.payer || paid[l.payer] === undefined) return;
      paid[l.payer] += a; total += a; items.push(l);
    });
    var w = parties.map(function (p) { return rule === '인원' ? Math.max(0, num(p.people, 0)) : 1; });
    var sw = w.reduce(function (s, x) { return s + x; }, 0) || 1;
    var share = {}, bal = {};
    parties.forEach(function (p, i) {
      share[p.name] = Math.round(total * w[i] / sw / 10) * 10;
      bal[p.name] = paid[p.name] - share[p.name];
    });
    // 반올림 차액은 가장 많이 낸 사람이 흡수
    var diff = total - names.reduce(function (s, n) { return s + share[n]; }, 0);
    if (diff && names.length) {
      var top = names.slice().sort(function (a, b) { return paid[b] - paid[a]; })[0];
      share[top] += diff; bal[top] -= diff;
    }
    var cred = names.filter(function (n) { return bal[n] > 0; }).map(function (n) { return { n: n, v: bal[n] }; });
    var debt = names.filter(function (n) { return bal[n] < 0; }).map(function (n) { return { n: n, v: -bal[n] }; });
    cred.sort(function (a, b) { return b.v - a.v; }); debt.sort(function (a, b) { return b.v - a.v; });
    var transfers = [], i = 0, j = 0;
    while (i < debt.length && j < cred.length) {
      var x = Math.min(debt[i].v, cred[j].v);
      if (x > 0) transfers.push({ from: debt[i].n, to: cred[j].n, amount: x });
      debt[i].v -= x; cred[j].v -= x;
      if (!debt[i].v) i++;
      if (!cred[j].v) j++;
    }
    return { total: total, paid: paid, share: share, balance: bal, transfers: transfers, items: items };
  }

  return {
    RULES: RULES, STAGES: STAGES, list: list, yes: yes, active: active, num: num,
    daysBetween: daysBetween, addDays: addDays, seasonTag: seasonTag, deriveContext: deriveContext,
    multiplier: multiplier, evalItem: evalItem, learn: learn, buildLines: buildLines,
    boxLinesFor: boxLinesFor, lineKey: lineKey, diffLines: diffLines, stageLines: stageLines,
    stageField: stageField, progress: progress, lint: lint, weatherTags: weatherTags,
    parseWeather: parseWeather, unusedSuggestions: unusedSuggestions,
    parseCompanions: parseCompanions, isOtherParty: isOtherParty, settle: settle, sharedLines: sharedLines,
  };
});
