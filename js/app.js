/* camp-pack 메인 앱 — 라우터와 화면들 */
(function () {
  'use strict';
  var S = window.Store, R = window.CampRules, U = window.UI, h = U.h;
  var APP_VERSION = '1.0.0';
  var DEFAULT_TAGS = {
    '장소유형': ['오토캠핑', '글램핑', '카라반', '노지', '차박'],
    '환경': ['계곡', '바다', '산', '전기없음', '개수대없음', '매점없음'],
    '계절날씨': ['봄가을', '하계', '동계', '혹한', '우천', '강풍'],
    '동반': ['아이', '영유아', '반려견', '손님'], '기간': ['1박', '연박'],
  };
  var TYPE_ICON = { '어른': '🧑', '아이': '🧒', '영유아': '👶', '반려견': '🐶' };

  var main = document.getElementById('main');
  var navEl = document.getElementById('nav');
  var cur = { name: '', live: false, hash: '' };
  var W = null; // 캠핑 만들기/조건 수정 상태
  var RV = null; // 회고 상태
  var E = null; // 편집 폼 상태
  var Q = { items: '', itemsFilter: '물건', history: '', archived: false };
  var local = loadLocal();
  var weatherCache = {};
  var pendingWeather = null;
  var loadingAt = 0;

  function loadLocal() { try { return JSON.parse(localStorage.getItem('cp.local')) || {}; } catch (e) { return {}; } }
  function saveLocal() { try { localStorage.setItem('cp.local', JSON.stringify(local)); } catch (e) {} }
  local.tab = local.tab || {}; local.dismiss = local.dismiss || {};

  /* ───────── 데이터 도우미 ───────── */
  function D() { return S.data; }
  function setting(key) { var r = D().settings.filter(function (s) { return s.key === key; })[0]; return r ? r.value : ''; }
  function tagGroups() {
    var out = [];
    D().settings.forEach(function (s) {
      if (s.key.indexOf('태그_') === 0 && R.list(s.value).length) out.push({ group: s.key.slice(3), tags: R.list(s.value) });
    });
    if (!out.length) Object.keys(DEFAULT_TAGS).forEach(function (g) { out.push({ group: g, tags: DEFAULT_TAGS[g] }); });
    return out;
  }
  function allTags() { return [].concat.apply([], tagGroups().map(function (g) { return g.tags; })); }
  function categories() {
    var c = R.list(setting('카테고리'));
    D().items.forEach(function (i) { if (i.category && c.indexOf(i.category) < 0) c.push(i.category); });
    return c;
  }
  function boxes() { return D().boxes.filter(R.active).sort(function (a, b) { return R.num(a.order, 99) - R.num(b.order, 99); }); }
  function members() { return D().members.filter(R.active); }
  function byId(t, id) { return D()[t].filter(function (x) { return x.id === id; })[0]; }
  function me() { return ourName(); }
  function phase(t) {
    if (t.status === '보관') return '보관';
    var td = U.today();
    if (t.start && td < t.start) return '예정';
    if (t.end && td > t.end) return '완료';
    return '진행중';
  }
  function dday(t) {
    var n = R.daysBetween(U.today(), t.start);
    if (n > 0) return 'D-' + n;
    var p = phase(t);
    return p === '진행중' ? '캠핑 중' : p === '완료' ? '다녀옴' : p;
  }
  function checkedBy(v) {
    if (!v) return '';
    var p = String(v).split('|'), t = (p[1] || '').slice(11);
    return p[0] + (t ? ' ' + t : '');
  }
  function itemOf(l) { return l && l.itemId ? byId('items', l.itemId) : null; }
  function productOf(it) { return it ? [it.brand, it.model].filter(Boolean).join(' ') : ''; }
  function shortOf(l) { return R.shortage(l, itemOf(l)); }
  function sameName(n) {
    var key = String(n).replace(/\s/g, '').toLowerCase();
    return D().members.filter(function (m) { return String(m.name).replace(/\s/g, '').toLowerCase() === key; })[0];
  }
  function lintProblems() { return R.lint(D().items, D().boxes, allTags(), categories()); }
  function go(hash) { location.hash = hash; }
  function placeOf(t) { return t && t.placeId ? byId('places', t.placeId) : null; }
  function sortByOrder(names, order) {
    return names.sort(function (a, b) {
      var x = order.indexOf(a), y = order.indexOf(b);
      return (x < 0 ? 999 : x) - (y < 0 ? 999 : y);
    });
  }
  function itemOptions(q, exclude) {
    q = q.toLowerCase();
    return D().items.filter(function (i) {
      return i.name.toLowerCase().indexOf(q) >= 0 && (!exclude || !exclude[i.id]);
    }).slice(0, 8).map(function (i) { return { label: i.name + (R.active(i) ? '' : ' (보관됨)'), item: i }; });
  }

  /* ───────── 날씨 (Open-Meteo, 키 불필요) ───────── */
  function geocode(q) {
    return fetch('https://geocoding-api.open-meteo.com/v1/search?count=6&language=ko&format=json&name=' + encodeURIComponent(q))
      .then(function (r) { return r.json(); }).then(function (j) {
        // 국내 결과만 (동명 북한 지명 제외)
        return (j.results || []).filter(function (g) { return !g.country_code || g.country_code === 'KR'; });
      });
  }
  function forecast(place, start, end) {
    var td = U.today(), last = R.addDays(td, 15);
    if (!place || !place.lat || !place.lng || !start) return Promise.resolve({ unavailable: 'nocoord' });
    if (start > last) return Promise.resolve({ unavailable: 'far' });
    if ((end || start) < td) return Promise.resolve({ unavailable: 'past' });
    var s = start < td ? td : start, e = (end || start) > last ? last : (end || start);
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + place.lat + '&longitude=' + place.lng +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max' +
      '&timezone=Asia%2FSeoul&start_date=' + s + '&end_date=' + e;
    return fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.daily) return { unavailable: 'error' };
      var w = R.weatherTags(j.daily); w.at = td; return w;
    }).catch(function () { return { unavailable: 'offline' }; });
  }

  /* ───────── 화면 골격 ───────── */
  function statusPill() {
    var st = S.status, q = S.queue.length, txt, cls = 'ok';
    if (st.authError) { txt = '⚠️ 연결 끊김'; cls = 'bad'; }
    else if (!st.online) { txt = '오프라인' + (q ? ' · 대기 ' + q : ''); cls = 'off'; }
    else if (q || st.busy) { txt = '저장 중' + (q ? ' ' + q : ''); cls = 'busy'; }
    else if (st.error) { txt = '⚠️ 오류'; cls = 'bad'; }
    else { txt = '✓ 동기화됨'; }
    return h('button.pill.' + cls, { id: 'pill', onclick: function () { S.flush(); S.sync(true); U.toast(st.error || '동기화 중…'); } }, txt);
  }
  function refreshPill() { var p = document.getElementById('pill'); if (p) p.replaceWith(statusPill()); }
  function top(title, opts) {
    opts = opts || {};
    return h('header.top',
      opts.back ? h('button.icon', { onclick: function () { opts.back === true ? history.back() : go(opts.back); }, 'aria-label': '뒤로' }, '‹') : null,
      h('div.ttl', h('h1', title), opts.sub ? h('div.sub', opts.sub) : null),
      opts.right || null, statusPill());
  }
  function empty(msg, action) { return h('div.empty', h('p', msg), action || null); }

  var NAV = [['#/', '🏕️', '홈'], ['#/history', '📖', '기록'], ['#/items', '🎒', '창고'], ['#/settings', '⚙️', '설정']];
  function renderNav(show, active) {
    navEl.innerHTML = '';
    navEl.hidden = !show;
    NAV.forEach(function (n) {
      navEl.appendChild(h('a', { href: n[0], class: active === n[0] ? 'on' : '' }, h('span.ic', n[1]), h('span', n[2])));
    });
  }

  /* ───────── 라우터 ───────── */
  function parseHash() {
    var raw = location.hash || '#/';
    var qi = raw.indexOf('?');
    var path = (qi >= 0 ? raw.slice(0, qi) : raw).replace(/^#/, '') || '/';
    var q = new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : '');
    return { raw: raw, parts: path.split('/').filter(Boolean), q: q };
  }

  function route(keepScroll) {
    var raw = location.hash || '';
    if (/^#(api|k)=/.test(raw)) return acceptInvite(raw);
    var r = parseHash();
    var sameView = r.raw === cur.hash;
    var y = window.scrollY;
    cur = { name: '', live: false, hash: r.raw };
    var el, navActive = null, showNav = true;
    var p = r.parts;

    if (p[0] === 's' && p[1]) { el = vGuest(p[1]); showNav = false; }
    else if (!S.connected() || S.status.authError) { el = vLogin(); showNav = false; }
    else if (!D().version) { el = vLoading(); showNav = false; }
    else if (!p.length) { el = vHome(); navActive = '#/'; }
    else if (p[0] === 'new') { el = vWizard('new', null, r.q); showNav = false; }
    else if (p[0] === 'trip' && p[2] === 'edit') { el = vWizard('edit', p[1], r.q); showNav = false; }
    else if (p[0] === 'trip' && p[2] === 'settle') { el = vSettle(p[1]); showNav = false; }
    else if (p[0] === 'trip') { el = vTrip(p[1]); showNav = false; }
    else if (p[0] === 'review') { location.replace('#/trip/' + p[1]); return; }
    else if (p[0] === 'history') { el = vHistory(); navActive = '#/history'; }
    else if (p[0] === 'stats') { el = vStats(); navActive = '#/history'; }
    else if (p[0] === 'items') { el = vItems(); navActive = '#/items'; }
    else if (p[0] === 'item') { el = vItemEdit(p[1]); showNav = false; }
    else if (p[0] === 'places') { el = vPlaces(); navActive = '#/items'; }
    else if (p[0] === 'place') { el = vPlaceEdit(p[1]); showNav = false; }
    else if (p[0] === 'boxes') { location.replace('#/items'); return; }
    else if (p[0] === 'split') { el = vSplitSetup(r.q.get('trip')); showNav = false; }
    else if (p[0] === 'settings') { el = vSettings(); navActive = '#/settings'; }
    else if (p[0] === 'log') { el = vLog(); navActive = '#/settings'; }
    else { el = empty('페이지를 찾을 수 없어요', h('a.btn', { href: '#/' }, '홈으로')); }

    if (D().meta && D().meta.familyName && S.cfg.meName !== D().meta.familyName) S.setCfg({ meName: D().meta.familyName });
    main.innerHTML = '';
    main.appendChild(el);
    renderNav(showNav, navActive);
    document.body.classList.toggle('has-nav', showNav);
    window.scrollTo(0, keepScroll || sameView ? y : 0);
    wake(cur.name === 'trip' && local.wake !== false);
  }
  function rerender() { route(true); }

  S.on(function (kind) {
    refreshPill();
    if (kind === 'status') {
      if ((S.status.authError && cur.name !== 'login') || cur.name === 'loading') rerender();
      return;
    }
    if (cur.live || cur.name === 'loading') rerender();
  });
  window.addEventListener('hashchange', function () { U.closeSheets(); route(false); });

  /* ───────── 화면 꺼짐 방지 ───────── */
  var wakeLock = null;
  function wake(on) {
    if (on && !wakeLock && navigator.wakeLock && document.visibilityState === 'visible') {
      navigator.wakeLock.request('screen').then(function (l) {
        wakeLock = l; l.addEventListener('release', function () { wakeLock = null; });
      }).catch(function () {});
    } else if (!on && wakeLock) { wakeLock.release(); wakeLock = null; }
  }
  document.addEventListener('visibilitychange', function () { if (cur.name === 'trip') wake(local.wake !== false); });

  /* ───────── 연결 · 나는 누구 ───────── */
  function acceptInvite(raw) {
    var q = new URLSearchParams(raw.slice(1));
    var api = q.get('api'), k = q.get('k');
    if (api && k) {
      if (S.cfg.api !== api || S.cfg.k !== k) {
        var keep = { me: S.cfg.me, meName: S.cfg.meName }, sameFamily = S.cfg.api === api;
        S.reset();
        if (sameFamily) S.setCfg(keep);
      }
      S.status.authError = false;
      S.setCfg({ api: api, k: k });
    }
    history.replaceState(null, '', location.pathname + '#/');
    route(false);
    S.sync(true);
  }

  var loginMeta = null;
  function vLogin() {
    cur.name = 'login';
    if (!loginMeta && S.api()) {
      loginMeta = { loading: true };
      S.publicPost({ op: 'meta' }).then(function (j) { loginMeta = j; if (cur.name === 'login') rerender(); })
        .catch(function () { loginMeta = { offline: true }; if (cur.name === 'login') rerender(); });
    }
    var fam = h('input', { type: 'text', placeholder: '가족 이름', autocomplete: 'username', value: local.lastFamily || '' });
    var pin = h('input', { type: 'password', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '6', placeholder: 'PIN 6자리', autocomplete: 'current-password', 'data-nofocus': '' });
    var err = h('p.err');
    function submit() {
      if (!fam.value.trim()) { fam.focus(); return; }
      if (!/^\d{6}$/.test(pin.value)) { err.textContent = 'PIN은 숫자 6자리예요'; pin.focus(); return; }
      err.textContent = '확인 중…';
      S.publicPost({ op: 'login', family: fam.value, pin: pin.value }).then(function (j) {
        if (!j.ok) { err.textContent = j.error + (j.left != null && j.left <= 3 ? ' (잠금까지 ' + j.left + '회)' : ''); pin.value = ''; return; }
        local.lastFamily = j.familyName; saveLocal();
        var keep = { me: S.cfg.me, meName: S.cfg.meName };
        S.reset(); S.setCfg(Object.assign(keep, { api: S.api(), k: j.k }));
        S.status.authError = false;
        rerender(); S.sync(true);
      }).catch(function () { err.textContent = '인터넷 연결을 확인하세요'; });
    }
    pin.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    var invite = h('input', { type: 'url', placeholder: '초대 링크 붙여넣기 (…#api=…&k=…)' });
    var noPin = loginMeta && loginMeta.ok && !loginMeta.pinSet;
    return h('div.page.narrow',
      h('div.hero', h('div.logo', '🏕️'), h('h1', '우리 가족 캠핑 준비'),
        h('p', S.status.authError ? 'PIN이 바뀌었거나 로그아웃되었어요. 다시 로그인해 주세요.' : '가족 이름과 PIN으로 로그인하세요.')),
      h('div.card',
        noPin ? h('p.hint', '아직 가족 PIN이 설정되지 않았어요. 이미 연결된 기기에서 [설정 → 가족 로그인]으로 정하거나, 시트 메뉴 [가족 이름·PIN 재설정]을 이용하세요.') : null,
        U.field('가족 이름', fam), U.field('PIN', pin), err,
        h('button.btn.primary.wide.big', { onclick: submit }, '로그인')),
      h('details.card', h('summary', '초대 링크로 연결'),
        invite,
        h('button.btn.wide', { onclick: function () {
          var v = invite.value.trim(), i = v.indexOf('#'), q = new URLSearchParams(i >= 0 ? v.slice(i + 1) : '');
          if (!q.get('api') || !q.get('k')) { U.toast('초대 링크 전체를 붙여넣어 주세요'); return; }
          acceptInvite('#api=' + encodeURIComponent(q.get('api')) + '&k=' + q.get('k'));
        } }, '연결')));
  }

  function vLoading() {
    cur.name = 'loading';
    if (S.status.online && Date.now() - loadingAt > 5000) { loadingAt = Date.now(); S.sync(true); }
    return h('div.page.narrow', h('div.hero', h('div.logo.spin', '⛺'), h('p', S.status.online ? '불러오는 중…' : '인터넷에 연결되면 불러올게요'),
      S.status.error ? h('p.err', S.status.error) : null));
  }

  /* ───────── 홈 ───────── */
  function vHome() {
    cur.name = 'home'; cur.live = true;
    var trips = D().trips.filter(function (t) { return t.status !== '보관'; });
    var upcoming = trips.filter(function (t) { var p = phase(t); return p === '예정' || p === '진행중'; })
      .sort(function (a, b) { return a.start < b.start ? -1 : 1; });
    var past = trips.filter(function (t) { return phase(t) === '완료'; }).sort(function (a, b) { return a.start < b.start ? 1 : -1; });
    var lint = lintProblems();
    var restock = D().items.filter(function (i) { return R.active(i) && R.yes(i.consumable) && (i.stock === '부족' || i.stock === '없음'); });
    var checks = [];
    if (restock.length) checks.push(h('a.chk', { href: '#/items' }, '🛒 사야 할 소모품 ' + restock.length + '개: ' + restock.slice(0, 3).map(function (i) { return i.name; }).join(', ') + (restock.length > 3 ? ' 외' : '')));
    if (lint.length) checks.push(h('a.chk.warn', { href: '#/items' }, '⚠️ 준비물 규칙 오류 ' + lint.length + '건 (목록에서 빠질 수 있어요)'));
    return h('div.page',
      top('캠핑 준비', { sub: ourName() }),
      upcoming[0] ? heroCard(upcoming[0]) : h('div.card.center', h('p', '예정된 캠핑이 없어요'), h('small.hint', '아래에서 새 캠핑을 만들어 보세요')),
      upcoming.slice(1).map(function (t) {
        return h('a.prow', { href: '#/trip/' + t.id }, h('div', h('b', t.title), h('small', U.range(t.start, t.end))), h('span.badge', dday(t)));
      }),
      checks.length ? h('details.card.checks', { open: true }, h('summary', '🔔 확인할 것 ', h('small', checks.length + '건')), h('div.list', checks)) : null,
      h('div.row2',
        h('a.btn.big' + (upcoming.length ? '' : '.primary'), { href: '#/new' }, '+ 새 캠핑'),
        past.length ? h('button.btn.big', { onclick: function () { pickPast(past); } }, '↻ 지난번처럼') : null),
      past.length ? h('section',
        h('div.sec-head', h('h2', '최근 캠핑'), h('a', { href: '#/history' }, '전체 보기')),
        past.slice(0, 3).map(function (t) { return pastRow(t); })) : null);
  }

  /** 홈 맨 위: 가장 가까운 캠핑의 준비 상황 */
  function heroCard(t) {
    var lines = S.linesOf(t.id), pl = placeOf(t), comps = R.parseCompanions(t.companions);
    var mine = R.ourLines(lines), done = mine.filter(R.isChecked).length, und = undecidedOf(lines);
    var fams = comps.map(function (c) {
      var ls = R.liveLines(lines).filter(function (l) { return l.party === c.name; });
      return h('span.fam' + famCls(comps, c.name), famIcon(comps, c.name) + ' ' + c.name + ' ' + ls.filter(R.isChecked).length + '/' + ls.length);
    });
    return h('div.card.hero-trip',
      h('div.trip-head', h('div', h('b', t.title), h('small', [pl ? pl.name : '', U.range(t.start, t.end)].filter(Boolean).join(' · '))),
        h('span.badge' + (phase(t) === '진행중' ? '.live' : ''), dday(t))),
      h('div.now', h('small', ourName()), h('b', mine.length ? (mine.length - done ? (mine.length - done) + '개 남음' : '모두 챙겼어요 ✓') : '목록 불러오는 중')),
      U.bar(done, mine.length),
      fams.length || und.length ? h('div.mini', fams,
        und.length ? h('span.warn', '미정 ' + und.length) : null) : null,
      h('div.row2',
        h('a.btn.primary.big', { href: '#/trip/' + t.id, onclick: function () { setTripTab(t.id, 'check'); } }, '체크리스트'),
        comps.length ? h('a.btn.big', { href: '#/trip/' + t.id, onclick: function () { setTripTab(t.id, und.length ? 'assign' : 'status', und.length ? 2 : null); } }, und.length ? '배정하기' : '현황') : null));
  }

  function pastRow(t) {
    var pl = placeOf(t);
    return h('a.prow', { href: '#/trip/' + t.id },
      h('div', h('b', t.title), h('small', (pl ? pl.name + ' · ' : '') + U.range(t.start, t.end))),
      h('span', R.num(t.rating, 0) ? '★'.repeat(R.num(t.rating, 0)) : '›'));
  }
  function pickPast(past) {
    var close = U.sheet('어느 캠핑처럼 준비할까요?', h('div.list', past.slice(0, 12).map(function (t) {
      var pl = placeOf(t);
      return h('button.prow', { onclick: function () { close(); go('#/new?from=' + t.id); } },
        h('div', h('b', t.title), h('small', (pl ? pl.name + ' · ' : '') + U.range(t.start, t.end))), h('span', '›'));
    })));
  }

  /* ───────── 캠핑 만들기 / 조건 수정 ───────── */
  function initWizard(mode, tripId, q) {
    var key = mode + ':' + (tripId || '') + ':' + (q.get('from') || '');
    if (W && W.key === key) return;
    var src = mode === 'edit' ? byId('trips', tripId) : q.get('from') ? byId('trips', q.get('from')) : null;
    var t = {
      title: '', start: '', end: '', placeId: '', guestAdults: '0', guestKids: '0', tagsAdd: '', tagsRemove: '', weather: '', companions: '',
      members: members().map(function (m) { return m.id; }).join(','),
    };
    if (src) ['title', 'start', 'end', 'placeId', 'members', 'guestAdults', 'guestKids', 'tagsAdd', 'tagsRemove', 'weather', 'memo', 'companions']
      .forEach(function (f) { t[f] = src[f] || ''; });
    W = { key: key, mode: mode, tripId: tripId, fromId: mode === 'new' && src ? src.id : null, step: 1, t: t,
      titleTouched: mode === 'edit', removed: {}, qty: {}, open: {}, useMem: true, forced: {}, extras: [], sel: null, weatherState: '' };
    if (W.fromId) {
      W.t.start = ''; W.t.end = ''; W.t.weather = ''; W.t.title = ''; W.titleTouched = false;
      S.ensureLines(W.fromId).then(function () {
        S.linesOf(W.fromId).forEach(function (l) {
          if (l.deleted === 'Y' && (l.source === '규칙' || l.source === '장소')) W.removed[l.itemId] = 1;
          if (l.deleted !== 'Y' && l.source === '수동' && (l.kind === '물건' || l.kind === '할일'))
            W.extras.push({ name: l.name, kind: l.kind, itemId: l.itemId, category: l.category, box: l.box, qty: R.num(l.qty, 1), save: false });
        });
        if (cur.name === 'wizard') rerender();
      }).catch(function () {});
    }
    if (mode === 'edit' && q.get('weather')) {
      W.step = 3; W.showTags = true;
      if (pendingWeather && pendingWeather.tripId === tripId) W.t.weather = JSON.stringify(pendingWeather.w);
      pendingWeather = null;
    }
    if (mode === 'edit' && q.get('step')) W.step = Math.min(3, R.num(q.get('step'), 1));
  }

  function vWizard(mode, tripId, q) {
    cur.name = 'wizard';
    if (mode === 'edit' && !byId('trips', tripId)) return empty('캠핑을 찾을 수 없어요');
    initWizard(mode, tripId, q);
    var steps = ['날짜·장소', '누가 가나요', mode === 'edit' ? '변경 확인' : '확인'];
    var body = [wizStep1, wizStep2, mode === 'edit' ? wizEditConfirm : wizConfirm][W.step - 1]();
    var title = mode === 'edit' ? '조건 수정' : W.fromId ? '지난번처럼 준비' : '새 캠핑';
    return h('div.page',
      top(title, { back: mode === 'edit' ? '#/trip/' + tripId : '#/' }),
      h('ol.steps', steps.map(function (s, i) {
        return h('li', { class: i + 1 === W.step ? 'on' : i + 1 < W.step ? 'done' : '', onclick: function () { if (i + 1 < W.step) { W.step = i + 1; rerender(); } } }, s);
      })),
      body);
  }
  function wizNav(nextLabel, onNext, valid) {
    return h('div.wiz-nav',
      W.step > 1 ? h('button.btn', { onclick: function () { W.step--; rerender(); } }, '이전') : h('span'),
      h('button.btn.primary', { disabled: valid === false, onclick: onNext }, nextLabel));
  }
  function autoTitle() {
    if (W.titleTouched) return;
    var pl = byId('places', W.t.placeId);
    W.t.title = (pl ? pl.name : '캠핑') + (W.t.start ? ' ' + U.md(W.t.start) : '');
  }

  function wizStep1() {
    var t = W.t;
    var start = h('input', { type: 'date', value: t.start, onchange: function () {
      t.start = start.value;
      if (!t.end || t.end < t.start) t.end = R.addDays(t.start, 1);
      t.weather = ''; autoTitle(); rerender();
    } });
    var end = h('input', { type: 'date', value: t.end, min: t.start, onchange: function () { t.end = end.value; t.weather = ''; rerender(); } });
    var title = h('input', { type: 'text', value: t.title, oninput: function () { t.title = title.value; W.titleTouched = true; } });
    var visits = {};
    D().trips.forEach(function (x) { if (x.placeId && (!visits[x.placeId] || visits[x.placeId] < x.start)) visits[x.placeId] = x.start; });
    var places = D().places.filter(R.active).sort(function (a, b) { return (visits[b.id] || '') > (visits[a.id] || '') ? 1 : -1; });
    var pl = byId('places', t.placeId);
    var nights = R.daysBetween(t.start, t.end);
    return h('div',
      h('div.card',
        h('div.row2', U.field('출발', start), U.field('도착', end)),
        t.start && t.end ? h('small.hint', nights > 0 ? nights + '박 ' + (nights + 1) + '일' : '당일') : null),
      h('div.card',
        h('h3', '어디로 가나요?'),
        U.chips(places.map(function (p) { return { value: p.id, label: p.name }; }).concat([{ value: '', label: '장소 미정' }]),
          [t.placeId], function (v) { t.placeId = v; t.weather = ''; autoTitle(); rerender(); }),
        h('button.btn.small', { onclick: function () { placeQuick(function (id) { t.placeId = id; autoTitle(); rerender(); }); } }, '+ 새 장소'),
        pl ? placeInfo(pl) : null),
      h('div.card', U.field('이름', title)),
      wizNav('다음', function () { autoTitle(); W.step = 2; rerender(); }, !!(t.start && t.end && t.end >= t.start)));
  }

  function placeInfo(pl) {
    var past = D().trips.filter(function (x) { return x.placeId === pl.id && x.id !== W.tripId && phase(x) === '완료'; })
      .sort(function (a, b) { return a.start < b.start ? 1 : -1; });
    var notes = [];
    if (past[0]) {
      var rv = D().reviews.filter(function (r) { return r.tripId === past[0].id && (r.result === '깜빡함' || r.result === '부족'); });
      notes.push('지난 방문 ' + U.md(past[0].start) + (rv.length ? ' — ' + rv.map(function (r) { return r.name + '(' + r.result + ')'; }).join(', ') : ''));
    }
    return h('div.place-info',
      R.list(pl.tags).length ? h('div.tags', R.list(pl.tags).map(function (x) { return h('span.tag', x); })) : null,
      pl.memo ? h('p', '📌 ' + pl.memo) : null,
      notes.map(function (n) { return h('small', n); }));
  }

  function placeQuick(onDone) {
    var name = h('input', { type: 'text', placeholder: '예: 가평 OO캠핑장' });
    var region = h('input', { type: 'text', placeholder: '날씨용 지역명 (예: 가평)', 'data-nofocus': '' });
    var tags = [];
    var tagBox = h('div');
    var groups = tagGroups().filter(function (g) { return g.group === '장소유형' || g.group === '환경'; });
    function draw() {
      tagBox.innerHTML = '';
      groups.forEach(function (g) {
        tagBox.appendChild(h('small.lbl', g.group));
        tagBox.appendChild(U.chips(g.tags, tags, function (v, on) { tags = on ? tags.concat(v) : tags.filter(function (x) { return x !== v; }); draw(); }));
      });
    }
    draw();
    var close = U.sheet('새 장소', [U.field('이름', name), U.field('지역', region, '날씨 예보에 사용 — 나중에 장소 편집에서 정확히 지정할 수 있어요'), tagBox], [
      h('button.btn.primary.wide', {
        onclick: function () {
          var n = name.value.trim(); if (!n) { name.focus(); return; }
          var id = S.uid('P'), set = { name: n, region: region.value.trim(), tags: tags.join(', '), active: 'Y' };
          S.mutate([{ t: 'places', id: id, set: set }]);
          close(); onDone(id);
          if (set.region) geocode(set.region).then(function (rs) {
            // 이름이 정확히 일치하는 국내 결과가 하나뿐일 때만 자동 지정 (나머지는 장소 편집에서 직접 선택)
            var exact = rs.filter(function (g) { return g.name === set.region || g.name === set.region + '군' || g.name === set.region + '시'; });
            if (exact.length === 1) S.mutate([{ t: 'places', id: id, set: { lat: exact[0].latitude.toFixed(4), lng: exact[0].longitude.toFixed(4) } }]);
          }).catch(function () {});
        },
      }, '저장')]);
  }

  function wizStep2() {
    var t = W.t, ids = R.list(t.members);
    var c = R.deriveContext(t, D().members, byId('places', t.placeId));
    return h('div',
      h('div.card', h('h3', '누가 가나요?'),
        U.chips(members().map(function (m) { return { value: m.id, label: (TYPE_ICON[m.type] || '') + ' ' + m.name }; }), ids, function (v, on) {
          ids = on ? ids.concat(v) : ids.filter(function (x) { return x !== v; }); t.members = ids.join(','); rerender();
        }),
        !members().length ? h('p.hint', '먼저 가족 구성원을 등록하세요. 인원수로 의자·침낭 같은 수량을 계산해요.') : null,
        h('button.btn.small', { onclick: function () { memberSheet(null, function (id) { ids = ids.concat(id); t.members = ids.join(','); rerender(); }); } }, '+ 구성원 추가')),
      companionsCard(t),
      h('p.summary', '가족 ' + c.family + '명' + (c.pets ? ' + 반려견 ' + c.pets : '') + (c.guestAdults + c.guestKids ? ' + 손님 ' + (c.guestAdults + c.guestKids) + '명' : '') + ' · ' + (c.nights || '당일') + (c.nights ? '박' : '')),
      wizNav('다음', function () { W.step = 3; rerender(); }, ids.length > 0));
  }

  var WEATHER_MSG = { nocoord: '장소에 지역(위치)을 등록하면 날씨를 자동 반영해요', far: '예보는 출발 16일 전부터 나와요. 가까워지면 다시 확인해 알려드릴게요',
    past: '', offline: '날씨를 불러오지 못했어요 (오프라인)', error: '날씨 정보를 불러오지 못했어요' };
  function ensureWeather() {
    var t = W.t, pl = byId('places', t.placeId), key = t.start + (pl ? pl.id : '');
    if (R.parseWeather(t.weather) || W.weatherState === 'loading' || W.weatherState === key) return;
    W.weatherState = 'loading';
    forecast(pl, t.start, t.end).then(function (w) {
      W.weatherState = key;
      if (!w.unavailable) t.weather = JSON.stringify(w); else W.weatherMsg = w.unavailable;
      if (cur.name === 'wizard' && W.step === 3) rerender();
    });
  }
  /** 조건 요약 (기본) — 바꿀 때만 칩 목록을 펼침 */
  function condSummary(ctx) {
    var wx = R.parseWeather(W.t.weather);
    return h('div.card',
      h('div.kv', h('h3', '🧭 이번 캠핑 조건'),
        h('button.btn.small', { onclick: function () { W.showTags = !W.showTags; rerender(); } }, W.showTags ? '접기 ▴' : '조건 바꾸기 ▾')),
      h('div.tags', ctx.tags.map(function (x) { return h('span.tag', x); })),
      h('small.hint', wx ? '🌤️ ' + wx.text + (wx.tags.length ? ' → ' + wx.tags.join(', ') + ' 자동 적용' : '')
        : W.weatherState === 'loading' ? '🌤️ 날씨 불러오는 중…' : (WEATHER_MSG[W.weatherMsg] ? '🌤️ ' + WEATHER_MSG[W.weatherMsg] : '')));
  }
  function conditionsEditor() {
    var t = W.t, pl = byId('places', t.placeId);
    var c = R.deriveContext(t, D().members, pl);
    function toggle(v, on) {
      var add = R.list(t.tagsAdd), rem = R.list(t.tagsRemove), isAuto = c.autoTags.indexOf(v) >= 0;
      if (on) { rem = rem.filter(function (x) { return x !== v; }); if (!isAuto && add.indexOf(v) < 0) add.push(v); }
      else { add = add.filter(function (x) { return x !== v; }); if (isAuto && rem.indexOf(v) < 0) rem.push(v); }
      t.tagsAdd = add.join(', '); t.tagsRemove = rem.join(', '); rerender();
    }
    return h('div.card',
      h('small.hint', '테두리 있는 칩 = 자동 판단. 탭해서 켜고 끌 수 있어요.'),
      tagGroups().map(function (g) { return h('div.tg', h('small.lbl', g.group), U.chips(g.tags, c.tags, toggle, { auto: c.autoTags })); }),
      R.parseWeather(t.weather) ? h('button.btn.small', { onclick: function () { t.weather = ''; W.weatherState = ''; rerender(); } }, '날씨 다시 불러오기') : null);
  }
  function wizConfirm() {
    ensureWeather();
    var res = compute();
    var forced = res.excluded.filter(function (e) { return W.forced[e.item.id]; });
    var lines = res.lines.filter(function (l) { return l.kind !== '수납함' && !W.removed[l.itemId]; });
    var nObj = lines.filter(function (l) { return l.kind === '물건'; }).length, nTodo = lines.filter(function (l) { return l.kind === '할일'; }).length;
    var nBox = res.lines.filter(function (l) { return l.kind === '수납함'; }).length, nExtra = W.extras.length + forced.length;
    var changed = Object.keys(W.removed).length + Object.keys(W.qty).length + nExtra;
    return h('div',
      condSummary(res.ctx),
      W.showTags ? conditionsEditor() : null,
      memoryCard(),
      h('div.card',
        h('div.kv', h('h3', '📋 준비물 목록'),
          h('button.btn.small', { onclick: function () { W.showList = !W.showList; rerender(); } }, W.showList ? '접기 ▴' : '목록 조정하기 ▾')),
        h('p', h('b', '물건 ' + nObj + ' · 할 일 ' + nTodo + ' · 수납함 ' + nBox), nExtra ? ' · 추가 ' + nExtra : ''),
        h('small.hint', changed ? '직접 조정한 항목 ' + changed + '개가 반영돼요.' : '조건에 맞게 자동으로 만들었어요. 대부분 그대로 만들면 돼요.')),
      W.showList ? listEditor(res) : null,
      wizNav('캠핑 만들기', function () { createTrip(res, forced); }));
  }
  function wizEditConfirm() {
    ensureWeather();
    return h('div',
      condSummary(R.deriveContext(W.t, D().members, byId('places', W.t.placeId))),
      W.showTags ? conditionsEditor() : null,
      wizDiff());
  }

  function compute() {
    var t = W.t;
    return R.buildLines({ trip: t, items: D().items, boxes: boxes(), members: D().members, place: byId('places', t.placeId),
      trips: D().trips.filter(function (x) { return x.id !== W.tripId; }), reviews: D().reviews });
  }

  function listEditor(res) {
    var lines = res.lines.filter(function (l) { return l.kind !== '수납함'; });
    var cats = categories();
    var groups = {};
    lines.forEach(function (l) { (groups[l.category || '기타'] = groups[l.category || '기타'] || []).push(l); });
    var included = lines.filter(function (l) { return !W.removed[l.itemId]; });
    var inIds = {}; lines.forEach(function (l) { inIds[l.itemId] = 1; });
    var forced = res.excluded.filter(function (e) { return W.forced[e.item.id]; });
    var addInput = h('input', { type: 'text', placeholder: '이번에만 챙길 것 (창고 검색 또는 새로 입력)' });
    var ac = U.autocomplete(addInput, function (q) { return itemOptions(q, inIds); }, function (o) {
      W.extras.push({ name: o.item.name, kind: o.item.kind === '할일' ? '할일' : '물건', itemId: o.item.id, category: o.item.category, box: o.item.box, qty: R.num(o.item.base, 1), save: false });
      rerender();
    });
    function addFree() {
      var n = addInput.value.trim(); if (!n) return;
      W.extras.push({ name: n, kind: '물건', itemId: '', category: '차량·기타', box: '', qty: 1, save: false });
      rerender();
    }
    return h('div',
      h('p.hint', '분류를 눌러 펼치면 항목을 빼거나 수량을 바꿀 수 있어요.'),
      h('p.summary', '물건 ' + included.filter(function (l) { return l.kind === '물건'; }).length + ' · 할 일 ' + included.filter(function (l) { return l.kind === '할일'; }).length +
        ' · 수납함 ' + res.lines.filter(function (l) { return l.kind === '수납함'; }).length + (W.extras.length + forced.length ? ' · 추가 ' + (W.extras.length + forced.length) : '')),
      sortByOrder(Object.keys(groups), cats).map(function (g) {
        var opened = !!W.open[g];
        var det = h('details.card.grp', { open: opened }, h('summary', g + ' ', h('small', groups[g].filter(function (l) { return !W.removed[l.itemId]; }).length + '/' + groups[g].length)),
          groups[g].map(function (l) {
            var off = !!W.removed[l.itemId];
            var q = W.qty[l.itemId] != null ? W.qty[l.itemId] : l.qty;
            return h('div.prev' + (off ? '.off' : ''),
              h('button.ck', { 'aria-label': off ? '다시 넣기' : '빼기', onclick: function () { if (off) delete W.removed[l.itemId]; else W.removed[l.itemId] = 1; rerender(); } }, off ? '' : '✓'),
              h('div.txt', h('div.nm', (l.warn ? '⚠️ ' : '') + l.name), l.note ? h('small', l.note) : null),
              off || l.kind === '할일' ? null : U.stepper(q, function (v) { W.qty[l.itemId] = v; rerender(); }, 1));
          }));
        det.addEventListener('toggle', function () { W.open[g] = det.open; });
        return det;
      }),
      h('details.card.excluded', h('summary', '조건 때문에 빠진 항목 ' + res.excluded.length + '개'),
        res.excluded.map(function (e) {
          var on = !!W.forced[e.item.id];
          return h('div.prev' + (on ? '' : '.off'),
            h('button.ck', { onclick: function () { if (on) delete W.forced[e.item.id]; else W.forced[e.item.id] = 1; rerender(); } }, on ? '✓' : '+'),
            h('div.txt', h('div.nm', e.item.name), h('small', e.reason)));
        })),
      h('div.card',
        h('h3', '이번에만 추가'),
        W.extras.map(function (x, i) {
          return h('div.prev',
            h('button.ck', { 'aria-label': '삭제', onclick: function () { W.extras.splice(i, 1); rerender(); } }, '✕'),
            h('div.txt', h('div.nm', x.name),
              !x.itemId ? h('label.inline', h('input', { type: 'checkbox', checked: x.save, onchange: function (e) { x.save = e.target.checked; } }), ' 창고에도 저장 (다음에도 포함)') : h('small', '창고 항목')),
            U.stepper(x.qty, function (v) { x.qty = v; rerender(); }, 1));
        }),
        h('div.addrow', addInput, h('button.btn', { onclick: addFree }, '추가')), ac),
      );
  }

  function lineSet(tripId, l) {
    return { tripId: tripId, kind: l.kind, itemId: l.itemId || '', name: l.name, category: l.category || '', box: l.box || '',
      qty: String(l.qty || 1), owner: l.owner || '', leave: l.leave || '', warn: l.warn || '', note: l.note || '', source: l.source || '수동',
      shared: l.shared || '', party: l.party || '', amount: l.amount || '', payer: l.payer || '' };
  }

  function createTrip(res, forced) {
    var id = S.uid('T'), ops = [], ctx = res.ctx, now = U.nowStr();
    ops.push({ t: 'trips', id: id, set: Object.assign({}, W.t, { tags: ctx.tags.join(', '), status: '', createdBy: me(), createdAt: now,
      guestAdults: String(ctx.guestAdults), guestKids: String(ctx.guestKids), splitRule: '인원' }) });
    var mem = W.useMem ? memoryParties() : {};
    var final = res.lines.filter(function (l) { return l.kind !== '수납함' && !W.removed[l.itemId]; }).map(function (l) {
      return Object.assign({}, l, { qty: W.qty[l.itemId] != null ? W.qty[l.itemId] : l.qty, party: l.party === '미정' && mem[l.itemId] ? mem[l.itemId] : l.party });
    });
    forced.forEach(function (e) {
      var it = e.item;
      final.push({ kind: it.kind === '할일' ? '할일' : '물건', itemId: it.id, name: it.name, category: it.category, box: it.kind === '할일' ? '' : it.box,
        qty: R.num(it.base, 1), owner: it.owner, leave: R.yes(it.leave) ? 'Y' : '', note: it.memo, source: '수동' });
    });
    W.extras.forEach(function (x) {
      var itemId = x.itemId;
      if (!itemId && x.save) {
        itemId = S.uid('I');
        ops.push({ t: 'items', id: itemId, set: { kind: x.kind, name: x.name, category: x.category, box: '', rule: '고정', base: '1', active: 'Y' } });
      }
      final.push({ kind: x.kind, itemId: itemId || S.uid('T'), name: x.name, category: x.category, box: x.box, qty: x.qty, source: '수동' });
    });
    final.forEach(function (l) { ops.push({ t: 'lines', id: S.uid('L'), set: lineSet(id, l) }); });
    S.mutate(ops);
    var hasComp = R.parseCompanions(W.t.companions).length > 0;
    W = null;
    setTripTab(id, hasComp ? 'assign' : 'check', 1);
    U.toast(hasComp ? '목록을 만들었어요. 우리 전용 준비물부터 구분해요' : '체크리스트를 만들었어요');
    go('#/trip/' + id);
  }

  function wizDiff() {
    var tripId = W.tripId, res = compute();
    var existing = S.linesOf(tripId);
    var d = R.diffLines(existing, res.lines);
    var dis = local.dismiss[tripId] || [];
    var notBox = function (l) { return l.kind !== '수납함'; };
    var add = d.add.filter(notBox), qty = d.qty, rem = d.remove.filter(notBox);
    if (!W.sel) {
      W.sel = {};
      add.forEach(function (l) { W.sel['a:' + R.lineKey(l)] = dis.indexOf('a:' + R.lineKey(l)) < 0; });
      qty.forEach(function (x) { W.sel['q:' + R.lineKey(x.line)] = dis.indexOf('q:' + R.lineKey(x.line)) < 0; });
      rem.forEach(function (l) { W.sel['r:' + R.lineKey(l)] = dis.indexOf('r:' + R.lineKey(l)) < 0; });
    }
    function row(key, main, sub) {
      var on = W.sel[key] !== false;
      return h('div.prev' + (on ? '' : '.off'),
        h('button.ck', { onclick: function () { W.sel[key] = !on; rerender(); } }, on ? '✓' : ''),
        h('div.txt', h('div.nm', main), sub ? h('small', sub) : null));
    }
    var total = add.length + qty.length + rem.length;
    return h('div',
      h('p.summary', total ? '바뀐 조건에 맞춰 ' + total + '건을 반영할 수 있어요. 이미 체크한 내용은 그대로 유지돼요.' : '체크리스트에 바꿀 항목이 없어요.'),
      add.length ? h('div.card', h('h3', '➕ 추가 ' + add.length), add.map(function (l) { return row('a:' + R.lineKey(l), l.name + (l.qty > 1 ? ' ×' + l.qty : ''), l.note); })) : null,
      qty.length ? h('div.card', h('h3', '🔢 수량 변경 ' + qty.length), qty.map(function (x) { return row('q:' + R.lineKey(x.line), x.line.name + '  ' + x.from + ' → ' + x.to); })) : null,
      rem.length ? h('div.card', h('h3', '➖ 빼기 ' + rem.length), rem.map(function (l) { return row('r:' + R.lineKey(l), l.name, l.pack ? '이미 챙김 (' + checkedBy(l.pack) + ')' : ''); })) : null,
      wizNav(total ? '반영하기' : '조건만 저장', function () { applyDiff(res, existing, add, qty, rem); }));
  }

  function applyDiff(res, existing, add, qty, rem) {
    var tripId = W.tripId, ops = [], dismissed = [];
    ops.push({ t: 'trips', id: tripId, set: Object.assign({}, W.t, { tags: res.ctx.tags.join(', '), guestAdults: String(res.ctx.guestAdults), guestKids: String(res.ctx.guestKids) }) });
    var live = existing.filter(function (l) { return l.deleted !== 'Y'; }).map(function (l) { return Object.assign({}, l); });
    add.forEach(function (l) {
      var k = 'a:' + R.lineKey(l);
      if (W.sel[k] === false) { dismissed.push(k); return; }
      var prev = existing.filter(function (e) { return R.lineKey(e) === R.lineKey(l); })[0];
      if (prev) { ops.push({ t: 'lines', id: prev.id, set: { deleted: '', qty: String(l.qty) } }); live.push(Object.assign({}, prev, { deleted: '' })); }
      else { var nl = lineSet(tripId, l); ops.push({ t: 'lines', id: S.uid('L'), set: nl }); live.push(nl); }
    });
    qty.forEach(function (x) {
      var k = 'q:' + R.lineKey(x.line);
      if (W.sel[k] === false) { dismissed.push(k); return; }
      ops.push({ t: 'lines', id: x.line.id, set: { qty: String(x.to) } });
    });
    rem.forEach(function (l) {
      var k = 'r:' + R.lineKey(l);
      if (W.sel[k] === false) { dismissed.push(k); return; }
      ops.push({ t: 'lines', id: l.id, set: { deleted: 'Y' } });
      live = live.filter(function (x) { return x.id !== l.id; });
    });
    local.dismiss[tripId] = (local.dismiss[tripId] || []).concat(dismissed); saveLocal();
    S.mutate(ops);
    W = null;
    U.toast('반영했어요');
    go('#/trip/' + tripId);
  }

  /* ───────── 체크리스트 ───────── */
  /* ───────── 캠핑 화면 v2: 배정 · 현황 · 체크리스트 ───────── */
  function chkVal() { return ourName() + '|' + U.nowStr(); }
  function undecidedOf(lines) { return R.liveLines(lines).filter(function (l) { return l.party === '미정'; }); }
  function tripTab(t, hasComp, lines) {
    if (!hasComp) return 'check';
    var v = local.ttab && local.ttab[t.id];
    if (v === 'assign' || v === 'status' || v === 'check') return v;
    return undecidedOf(lines).length ? 'assign' : 'check';
  }
  function setTripTab(id, v, step) {
    local.ttab = local.ttab || {}; local.ttab[id] = v;
    if (step) { local.astep = local.astep || {}; local.astep[id] = step; }
    SEL = null; saveLocal();
  }
  function byCategory(list) {
    var by = {};
    list.forEach(function (l) { var c = l.category || '안전·기타'; (by[c] = by[c] || []).push(l); });
    return sortByOrder(Object.keys(by), categories()).map(function (c) { return { name: c, lines: by[c] }; });
  }
  function names(list, n) {
    n = n || 3;
    return list.slice(0, n).map(function (l) { return l.name; }).join(', ') + (list.length > n ? ' 외 ' + (list.length - n) : '');
  }

  function vTrip(id) {
    var t = byId('trips', id);
    if (!t) return empty('캠핑을 찾을 수 없어요', h('a.btn', { href: '#/' }, '홈으로'));
    cur.name = 'trip'; cur.live = true;
    var lines = S.linesOf(id);
    if (!lines.length && !S.extra[id]) {
      S.ensureLines(id).catch(function () {});
      return h('div.page', top(t.title, { back: '#/' }), empty('체크리스트를 불러오는 중… (오프라인이면 연결 후 표시돼요)'));
    }
    var pl = placeOf(t), comps = R.parseCompanions(t.companions), hasComp = comps.length > 0;
    var tab = tripTab(t, hasComp, lines), und = undecidedOf(lines).length;
    var banners = tripBanners(t, lines);
    return h('div.page.trip-page',
      top(t.title, {
        back: '#/', sub: [pl ? pl.name : '', U.range(t.start, t.end), dday(t)].filter(Boolean).join(' · '),
        right: h('button.icon', { 'aria-label': '메뉴', onclick: function () { tripMenu(t); } }, '⋯'),
      }),
      hasComp ? h('nav.ttabs', [['assign', '배정'], ['status', '현황'], ['check', '체크리스트']].map(function (x) {
        return h('button', { class: x[0] === tab ? 'on' : '', onclick: function () { setTripTab(t.id, x[0]); rerender(); window.scrollTo(0, 0); } },
          x[1], x[0] === 'assign' && und ? h('span.dot', String(und)) : null);
      })) : null,
      banners.length ? h('details.card.checks', { open: banners.length === 1 }, h('summary', '🔔 확인할 것 ', h('small', banners.length + '건')), h('div.list', banners)) : null,
      tab === 'assign' ? assignView(t, lines) : tab === 'status' ? statusView(t, lines) : checkView(t, lines, hasComp),
      tab !== 'status' && !(SEL && SEL.on) ? h('button.fab', { 'aria-label': '추가하기', onclick: function () {
        fabMenu(t, tab === 'assign' ? { shared: (local.astep && local.astep[t.id]) === 2 } : null);
      } }, '+') : null,
      SEL && SEL.on ? selBar(t, lines) : null);
  }

  /* 체크리스트: 우리 가족 전체가 같은 목록 */
  function checkView(t, lines, hasComp) {
    var mine = R.ourLines(lines), und = hasComp ? undecidedOf(lines) : [];
    var done = mine.filter(R.isChecked).length, left = mine.length - done, onlyLeft = !!local.onlyLeft;
    var shown = onlyLeft ? mine.filter(function (l) { return !R.isChecked(l); }) : mine;
    return [
      h('div.stagehead',
        h('div', h('b', (hasComp ? ourName() + ' · ' : '') + (mine.length ? (left ? left + '개 남음' : '모두 챙겼어요 🎉') : '목록이 비어 있어요')),
          h('small', mine.length + '개 중 ' + done + '개 챙김 · 가족 누구 휴대폰에서 체크해도 같은 목록')),
        h('button.viewbtn', { onclick: function () { local.onlyLeft = !onlyLeft; saveLocal(); rerender(); } }, onlyLeft ? '남은 것만 ✓' : '전체 보기')),
      U.bar(done, mine.length),
      und.length ? h('a.alert.warn', { href: '#/trip/' + t.id, onclick: function () { setTripTab(t.id, 'assign', 2); } },
        '🤝 배정 안 된 공용 준비물 ' + und.length + '개 (' + names(und) + ') — 배정하기') : null,
      byCategory(shown).map(function (g) { return catGroup(g.name, g.lines); }),
      !shown.length && mine.length ? empty('남은 게 없어요. 다 챙겼어요!') : null,
      removedCard(lines)];
  }

  function catGroup(name, list) {
    var done = list.filter(R.isChecked).length, all = done === list.length;
    return h('section.grp',
      h('div.grp-head',
        h('button.gck' + (all ? '.full' : done ? '.part' : ''), { 'aria-label': name + (all ? ' 모두 해제' : ' 모두 챙김'), onclick: function () {
          var targets = list.filter(function (l) { return all ? R.isChecked(l) : !R.isChecked(l); });
          var val = all ? '' : chkVal();
          var prev = targets.map(function (l) { return { t: 'lines', id: l.id, set: { pack: l.pack || '', done: l.done || '' } }; });
          S.mutate(targets.map(function (l) { return { t: 'lines', id: l.id, set: { pack: val, done: '' } }; }));
          U.toast(name + ' ' + targets.length + '개 ' + (all ? '해제' : '챙김'), function () { S.mutate(prev); });
        } }, all ? '✓' : done ? '–' : ''),
        h('b', name), h('small', done + '/' + list.length)),
      list.map(lineRow));
  }

  function lineRow(l) {
    var on = R.isChecked(l), it = itemOf(l), sh = shortOf(l), meta = [];
    if (!on) {
      if (sh) meta.push(h('span.short', '⚠️ ' + sh + '개 부족'));
      if (l.source === '재고' && it && R.safeLink(it.link)) meta.push(h('a.buy', { href: R.safeLink(it.link), target: '_blank', rel: 'noopener', onclick: function (e) { e.stopPropagation(); } }, '🛒 구매 링크'));
      if (l.kind === '장보기') meta.push(h('span', '장보기'));
      if (l.note) meta.push(h('span', l.note));
      meta = meta.slice(0, 2);
    }
    return h('div.line' + (on ? '.done' : '') + (l.warn === 'Y' ? '.warnline' : ''), {
      onclick: function () {
        S.mutate([{ t: 'lines', id: l.id, set: { pack: on ? '' : chkVal(), done: '' } }]);
        if (on) U.toast(l.name + ' 체크 해제', function () { S.mutate([{ t: 'lines', id: l.id, set: { pack: l.pack || '', done: l.done || '' } }]); });
        if (navigator.vibrate) navigator.vibrate(10);
      },
    },
      h('span.ck', { 'aria-hidden': 'true' }, on ? '✓' : ''),
      h('div.txt', h('div.nm', (l.warn === 'Y' ? '⚠️ ' : '') + l.name, R.num(l.qty, 1) > 1 ? h('span.qty', '×' + l.qty) : null),
        meta.length ? h('div.meta', meta) : null),
      h('button.more', { 'aria-label': '편집', onclick: function (e) { e.stopPropagation(); editLine(l); } }, '⋯'));
  }

  /* 배정: ① 우리 전용 준비물 구분 → ② 공용 준비물 배정(가족 단위) */
  var SEL = null; // { tripId, step, on, ids }
  function selOf(tripId, step) { return SEL && SEL.tripId === tripId && SEL.step === step ? SEL : { tripId: tripId, step: step, on: false, ids: {} }; }
  function selToggle(sel) {
    return h('button.viewbtn', { onclick: function () {
      SEL = sel.on ? null : { tripId: sel.tripId, step: sel.step, on: true, ids: {} }; rerender();
    } }, sel.on ? '선택 취소' : '여러 개 선택');
  }
  function selRow(l, sel, right) {
    var on = !!sel.ids[l.id];
    return h('div.srow' + (on ? '.picked' : ''), { onclick: function () { if (on) delete SEL.ids[l.id]; else SEL.ids[l.id] = 1; rerender(); } },
      h('span.ck', on ? '✓' : ''), h('div.txt', h('div.nm', l.name, R.num(l.qty, 1) > 1 ? h('span.qty', '×' + l.qty) : null)), right || null);
  }
  function catHead(g, sel, extra) {
    var all = sel.on && g.lines.every(function (l) { return sel.ids[l.id]; });
    return h('div.grp-head',
      sel.on ? h('button.gck' + (all ? '.full' : ''), { 'aria-label': g.name + ' 모두 선택', onclick: function () {
        g.lines.forEach(function (l) { if (all) delete SEL.ids[l.id]; else SEL.ids[l.id] = 1; }); rerender();
      } }, all ? '✓' : '') : null,
      h('b', g.name), extra ? h('small', extra) : null);
  }
  function selBar(t, lines) {
    var ids = Object.keys(SEL.ids), chosen = R.liveLines(lines).filter(function (l) { return SEL.ids[l.id]; });
    var acts = SEL.step === 1
      ? [{ label: '🏠 우리 전용으로', fn: function (ls) { setTogether(ls, false); } }, { label: '🤝 공용으로', fn: function (ls) { setTogether(ls, true); } }]
      : partyList(t).map(function (p) { return { label: p.icon + ' ' + p.label, cls: p.cls, fn: function (ls) { assignTo(ls, p.name); } }; })
        .concat([{ label: '🤔 미정', fn: function (ls) { assignTo(ls, '미정'); } }]);
    acts.push({ label: '🗑️ 이번 캠핑에서 빼기', danger: true, silent: true, fn: removeLines });
    return h('div.selbar',
      h('div.kv', h('b', ids.length ? ids.length + '개 선택' : '항목을 고르세요'), h('button.btn.small', { onclick: function () { SEL = null; rerender(); } }, '닫기')),
      h('div.chips', acts.map(function (a) {
        return h('button.chip' + (a.danger ? '.danger' : '') + (a.cls || ''), { type: 'button', disabled: !chosen.length, onclick: function () {
          a.fn(chosen); if (!a.silent) U.toast(chosen.length + '개 → ' + a.label); SEL.ids = {}; rerender();
        } }, a.label);
      })));
  }
  /** 이번 캠핑에서 빼기 (체크리스트에서도 사라짐) — 되돌리기 가능 */
  function removeLines(ls) {
    if (!ls.length) return;
    S.mutate(ls.map(function (l) { return { t: 'lines', id: l.id, set: { deleted: 'Y' } }; }));
    U.toast((ls.length === 1 ? ls[0].name : ls.length + '개') + ' 뺐어요', function () {
      S.mutate(ls.map(function (l) { return { t: 'lines', id: l.id, set: { deleted: '' } }; }));
    });
  }
  /** 뺀 준비물 목록 (되살리기) */
  function removedCard(lines) {
    var gone = lines.filter(function (l) { return l.deleted === 'Y' && l.kind !== '수납함' && l.kind !== '정산'; });
    if (!gone.length) return null;
    return h('details.card.removed', h('summary', '🗑️ 이번 캠핑에서 뺀 준비물 ', h('small', gone.length + '개')),
      gone.map(function (l) {
        return h('div.kv', h('span.muted', l.name + (R.num(l.qty, 1) > 1 ? ' ×' + l.qty : '')),
          h('button.btn.small', { onclick: function () {
            S.mutate([{ t: 'lines', id: l.id, set: { deleted: '' } }]); U.toast(l.name + ' 되살렸어요');
          } }, '되살리기'));
      }));
  }
  function editBtn(l) {
    return h('button.rm.ed', { 'aria-label': l.name + ' 수정', title: '이름·수량·카테고리 수정', onclick: function (e) { e.stopPropagation(); editLine(l); } }, '✏️');
  }
  function rmBtn(l) {
    return h('button.rm', { 'aria-label': l.name + ' 빼기', title: '이번 캠핑에서 빼기', onclick: function (e) { e.stopPropagation(); removeLines([l]); } }, '✕');
  }
  function setTogether(ls, on) {
    S.mutate(ls.map(function (l) {
      if (!on) return { t: 'lines', id: l.id, set: { shared: '', party: '' } };
      var keep = l.party && l.party !== '우리';
      return { t: 'lines', id: l.id, set: { shared: 'Y', party: keep ? l.party : (R.isChecked(l) ? '우리' : '미정') } };
    }));
  }
  function assignTo(ls, party) { S.mutate(ls.map(function (l) { return { t: 'lines', id: l.id, set: { shared: 'Y', party: party } }; })); }

  function assignView(t, lines) {
    local.astep = local.astep || {};
    var step = local.astep[t.id] || 1;
    return [
      h('div.stepseg', [[1, '① 우리 전용 준비물 구분'], [2, '② 공용 준비물 배정']].map(function (x) {
        return h('button', { class: x[0] === step ? 'on' : '', onclick: function () { local.astep[t.id] = x[0]; SEL = null; saveLocal(); rerender(); } }, x[1]);
      })),
      step === 1 ? splitStep(t, lines) : whoStep(t, lines)];
  }

  function splitStep(t, lines) {
    var list = R.liveLines(lines).filter(function (l) { return l.kind !== '할일'; });
    var nT = list.filter(R.isTogether).length, sel = selOf(t.id, 1);
    var comps = R.parseCompanions(t.companions).map(function (c) { return c.name; }).join('·');
    return [
      h('p.hint', comps + '와(과) 함께 가요. 집마다 따로 챙기는 것은 "우리 전용", 한 집만 가져오면 되는 것은 "공용"으로 구분하세요. 공용은 다음 단계에서 어느 가족이 가져올지 정해요.'),
      h('div.splitsum', h('span.pill.ps', '🏠 우리 전용 ' + (list.length - nT)), h('span.pill', '🤝 공용 ' + nT), addBtn(t, false), selToggle(sel)),
      byCategory(list).map(function (g) {
        var nG = g.lines.filter(R.isTogether).length;
        return h('section.grp', catHead(g, sel, '공용 ' + nG + '/' + g.lines.length),
          g.lines.map(function (l) {
            var tog = R.isTogether(l);
            if (sel.on) return selRow(l, sel, h('span.pill' + (tog ? '' : '.ps'), tog ? '공용' : '우리 전용'));
            return h('div.srow', h('div.txt.tap', { onclick: function () { editLine(l); } }, h('div.nm', l.name, R.num(l.qty, 1) > 1 ? h('span.qty', '×' + l.qty) : null)),
              editBtn(l),
              h('div.seg2', h('button', { class: tog ? '' : 'on', onclick: function () { if (tog) setTogether([l], false); } }, '우리 전용'),
                h('button', { class: tog ? 'on' : '', onclick: function () { if (!tog) setTogether([l], true); } }, '공용')),
              rmBtn(l));
          }));
      }),
      sel.on ? null : removedCard(lines),
      sel.on ? null : h('button.btn.primary.wide.big', { onclick: function () { local.astep[t.id] = 2; saveLocal(); rerender(); window.scrollTo(0, 0); } }, '다음: ② 공용 준비물 배정 ›'),
      sel.on ? null : h('a.small', { href: '#/split?trip=' + t.id }, '다음 캠핑에도 쓰일 기본값 바꾸기 ›')];
  }

  function partyPill(l, parties) {
    var p = l.party === '미정' ? null : parties.filter(function (x) { return x.name === partyOf(l); })[0];
    return h('span.pill' + (!p ? '.pn' : p.name === '우리' ? '.ps' : p.cls), p ? p.icon + ' ' + p.label : '🤔 미정');
  }
  function whoStep(t, lines) {
    var parties = partyList(t), list = R.liveLines(lines).filter(R.isTogether);
    var und = list.filter(function (l) { return l.party === '미정'; }), sel = selOf(t.id, 2);
    return [
      h('div.splitsum', h('span', '공용 준비물 ' + list.length + '개 · 미정 ', h('b.warn', String(und.length))), addBtn(t, true), selToggle(sel)),
      !sel.on && und.length ? h('button.btn.small', { onclick: function () {
        assignTo(und, '우리');
        U.toast('미정 ' + und.length + '개를 ' + ourName() + '이(가) 가져가요', function () { assignTo(und, '미정'); });
      } }, '미정 모두 ' + ourName() + '으로') : null,
      !list.length ? empty('공용 준비물이 없어요. ① 우리 전용 준비물 구분에서 "공용"으로 바꾸거나 + 추가로 넣어 주세요.') : null,
      byCategory(list).map(function (g) {
        return h('section.grp', catHead(g, sel),
          g.lines.map(function (l) {
            if (sel.on) return selRow(l, sel, partyPill(l, parties));
            return h('div.srow', { onclick: function () { assignOne(l, parties); } },
              h('div.txt', h('div.nm', l.name, R.num(l.qty, 1) > 1 ? h('span.qty', '×' + l.qty) : null),
                R.isChecked(l) ? h('small', '✓ 챙김') : l.note ? h('small', l.note) : null),
              partyPill(l, parties), editBtn(l), rmBtn(l));
          }));
      }),
      sel.on ? null : askCard(t, lines),
      sel.on ? null : removedCard(lines)];
  }
  function assignOne(l, parties) {
    var close = U.sheet(l.name + ' — 어느 가족이?', h('div.chips',
      parties.map(function (p) { return { name: p.name, label: p.icon + ' ' + p.label, cls: p.cls }; })
        .concat([{ name: '미정', label: '🤔 미정' }, { name: '__edit', label: '✏️ 이름·수량·카테고리 수정' }, { name: '__mine', label: '🏠 우리 전용으로 옮기기' }, { name: '__del', label: '🗑️ 이번 캠핑에서 빼기' }]).map(function (p) {
          var on = p.name.indexOf('__') === 0 ? false : (l.party === '미정' ? p.name === '미정' : partyOf(l) === p.name);
          return h('button', { class: 'chip' + (on ? ' on' : '') + (p.name === '__del' ? ' danger' : '') + (p.cls ? ' ' + p.cls.slice(1) : ''), type: 'button', onclick: function () {
            close();
            if (p.name === '__edit') editLine(l); else if (p.name === '__mine') setTogether([l], false); else if (p.name === '__del') removeLines([l]); else assignTo([l], p.name);
          } }, p.label);
        })));
  }

  /* 현황: 가족별 카드 */
  function statusView(t, lines) {
    var parties = partyList(t), live = R.liveLines(lines);
    var cards = parties.map(function (p) {
      var ls = p.name === '우리' ? R.ourLines(lines) : live.filter(function (l) { return l.party === p.name; });
      return { p: p, ls: ls, done: ls.filter(R.isChecked).length };
    });
    var und = undecidedOf(lines);
    var total = cards.reduce(function (s, c) { return s + c.ls.length; }, 0) + und.length;
    var done = cards.reduce(function (s, c) { return s + c.done; }, 0);
    return [
      h('div.stagehead', h('div', h('b', '전체 ' + (total ? Math.round(done / total * 100) : 0) + '% 준비'), h('small', done + '/' + total + ' 챙김 · ' + dday(t)))),
      U.bar(done, total),
      cards.map(function (c) {
        var left = c.ls.filter(function (l) { return !R.isChecked(l); });
        return h('div.card.famcard' + c.p.cls, { onclick: function () { if (c.p.name === '우리') { setTripTab(t.id, 'check'); rerender(); } else famSheet(t, c); } },
          h('div.kv', h('b', c.p.icon + ' ' + c.p.label), h('span', c.done + '/' + c.ls.length)),
          U.bar(c.done, c.ls.length),
          h('small', !c.ls.length ? '맡은 게 없어요' : left.length ? '남음: ' + names(left) : '모두 챙겼어요 ✓'));
      }),
      und.length ? h('div.card.famcard.undec', { onclick: function () { setTripTab(t.id, 'assign', 2); rerender(); } },
        h('b', '🤔 미정 ' + und.length + '개'), h('small', names(und) + ' → 공용 준비물 배정하기')) : null,
      h('button.btn.wide', { onclick: function () { U.sheet('동행 가족 링크', linkCard(t, lines, parties)); } }, '🔗 동행 가족에게 링크 보내기')];
  }
  function famSheet(t, c) {
    U.sheet(c.p.icon + ' ' + c.p.label + ' (' + c.done + '/' + c.ls.length + ')', [
      h('p.hint', c.p.label + '이(가) 전용 링크로 체크하면 여기에 반영돼요.'),
      c.ls.map(function (l) { return h('div.srow' + (R.isChecked(l) ? '.done' : ''), h('span.ck', R.isChecked(l) ? '✓' : ''), h('div.txt', h('div.nm', l.name, R.num(l.qty, 1) > 1 ? h('span.qty', '×' + l.qty) : null))); }),
      h('button.btn.wide', { onclick: function () { U.closeSheets(); U.sheet('동행 가족 링크', linkCard(t, S.linesOf(t.id), partyList(t))); } }, '🔗 링크 보내기·끄기'),
    ]);
  }

  /* 정산: 동행 캠핑일 때 ⋯ 메뉴에서 */
  function vSettle(id) {
    var t = byId('trips', id);
    if (!t) return empty('캠핑을 찾을 수 없어요');
    cur.name = 'settle'; cur.live = true;
    var lines = S.linesOf(id), parties = partyList(t);
    return h('div.page', top('💰 정산', { back: '#/trip/' + id, sub: t.title }),
      settleCard(t, lines, parties, t.splitRule || '인원'),
      h('button.btn.wide', { onclick: function () { shareOut(t.title, null, shareText(t.title, U.range(t.start, t.end), lines, parties, t.splitRule || '인원')); } }, '📋 카톡용 정리 복사'));
  }

  /** 배정 화면의 "+ 추가" 버튼: 공용 배정 단계면 공용(미정)으로 바로 추가 */
  function addBtn(t, shared) {
    return h('button.viewbtn.addbtn', { onclick: function () { quickAdd(t, { shared: shared }); } }, '+ 준비물 추가');
  }
  function fabMenu(t, ctx) {
    var ph = phase(t);
    var close = U.sheet('추가하기', h('div.menu',
      h('button', { onclick: function () { close(); quickAdd(t, ctx); } }, '➕ 준비물·할 일·장보기 추가'),
      h('button', { onclick: function () { close(); pasteGroceries(t); } }, '🛒 장보기 목록 붙여넣기'),
      ph === '진행중' || ph === '완료' ? h('button', { onclick: function () { close(); forgotSheet(t); } }, '😱 깜빡했어요 (다음 캠핑에 꼭 챙기기)') : null));
  }

  function tripBanners(t, lines) {
    var out = [], ph = phase(t);
    if (ph === '완료' || ph === '보관') return out;
    // 날씨 재확인 (출발 3일 전부터)
    var pl = placeOf(t), dd = R.daysBetween(U.today(), t.start);
    if (pl && pl.lat && dd <= 3) {
      var wc = weatherCache[t.id];
      if (!wc) {
        weatherCache[t.id] = { loading: true };
        forecast(pl, t.start, t.end).then(function (w) { weatherCache[t.id] = w; if (cur.name === 'trip') rerender(); });
      } else if (!wc.loading && !wc.unavailable) {
        var old = (R.parseWeather(t.weather) || { tags: [] }).tags.slice().sort().join(',');
        if (old !== wc.tags.slice().sort().join(',')) {
          out.push(h('a.alert.warn', { href: '#/trip/' + t.id + '/edit?weather=1', onclick: function () { W = null; pendingWeather = { tripId: t.id, w: wc }; } },
            '🌦️ 예보가 바뀌었어요: ' + wc.text + (wc.tags.length ? ' → ' + wc.tags.join(', ') : '') + ' — 체크리스트 확인하기'));
        }
      }
    }
    // 보유 수량 부족
    var shorts = lines.filter(function (l) {
      return l.kind === '물건' && !l.pack && shortOf(l) > 0 &&
        !lines.some(function (x) { return x.itemId === 'T-ask-' + l.itemId && x.deleted !== 'Y'; });
    });
    if (shorts.length) {
      var hasComp = R.parseCompanions(t.companions).length > 0;
      out.push(h('a.alert.warn', { href: '#/trip/' + t.id, onclick: function () { if (hasComp) { setTripTab(t.id, 'assign', 2); setTimeout(rerender, 0); } } },
        '🙏 갖고 있는 것보다 더 필요해요: ' + shorts.map(function (l) { return l.name + ' ' + shortOf(l) + '개'; }).join(', ') +
        (hasComp ? ' — 동행 가족에게 부탁하기' : ' — 빌리거나 사야 해요')));
    }
    // 창고·조건 변경 감지
    var res = R.buildLines({ trip: t, items: D().items, boxes: boxes(), members: D().members, place: pl,
      trips: D().trips.filter(function (x) { return x.id !== t.id; }), reviews: D().reviews });
    var d = R.diffLines(lines, res.lines), dis = local.dismiss[t.id] || [];
    var n = d.add.filter(function (l) { return l.kind !== '수납함' && dis.indexOf('a:' + R.lineKey(l)) < 0; }).length +
      d.qty.filter(function (x) { return dis.indexOf('q:' + R.lineKey(x.line)) < 0; }).length +
      d.remove.filter(function (l) { return l.kind !== '수납함' && dis.indexOf('r:' + R.lineKey(l)) < 0; }).length;
    if (n) out.push(h('a.alert', { href: '#/trip/' + t.id + '/edit?step=4', onclick: function () { W = null; } }, '🔄 준비물 창고가 바뀌어 반영할 항목 ' + n + '건'));
    return out;
  }

  function tripMenu(t) {
    var hasComp = R.parseCompanions(t.companions).length > 0;
    var close = U.sheet(t.title, h('div.menu',
      h('button', { onclick: function () { close(); W = null; go('#/trip/' + t.id + '/edit'); } }, '✏️ 조건 수정 (날짜·인원·동행·날씨)'),
      hasComp ? h('button', { onclick: function () { close(); U.sheet('동행 가족 링크', linkCard(t, S.linesOf(t.id), partyList(t))); } }, '🔗 동행 가족 전용 링크 보내기·끄기') : null,
      hasComp ? h('button', { onclick: function () { close(); go('#/trip/' + t.id + '/settle'); } }, '💰 정산') : null,
      h('button', { onclick: function () { close(); editTrip(t); } }, '🏷️ 이름·메모·별점'),
      h('button', { onclick: function () { close(); W = null; go('#/new?from=' + t.id); } }, '↻ 이 캠핑처럼 새 캠핑 만들기'),
      h('button', { onclick: function () { local.wake = local.wake === false; saveLocal(); wake(local.wake !== false); close(); U.toast(local.wake !== false ? '체크리스트 화면이 꺼지지 않아요' : '화면 켜두기 해제'); } },
        (local.wake !== false ? '🔆 화면 켜두기: 켜짐' : '🔅 화면 켜두기: 꺼짐')),
      t.status === '보관'
        ? h('button', { onclick: function () { close(); S.mutate([{ t: 'trips', id: t.id, set: { status: '' } }]); U.toast('복원했어요'); } }, '♻️ 보관 해제')
        : h('button.danger', { onclick: function () { close(); U.ask('캠핑 보관', '홈과 기록에서 숨겨요. 기록 > 보관함에서 복원할 수 있어요.', '보관', function () { S.mutate([{ t: 'trips', id: t.id, set: { status: '보관' } }]); go('#/'); }, true); } }, '🗄️ 보관하기 (삭제 대신)')));
  }

  function editTrip(t) {
    var title = h('input', { type: 'text', value: t.title });
    var memo = h('textarea', { rows: 3, placeholder: '메모 (좋았던 점, 다음엔 이렇게)' }, t.memo || '');
    var rating = R.num(t.rating, 0), stars = h('div.stars');
    function draw() {
      stars.innerHTML = '';
      [1, 2, 3, 4, 5].forEach(function (n) { stars.appendChild(h('button', { type: 'button', class: n <= rating ? 'on' : '', onclick: function () { rating = rating === n ? 0 : n; draw(); } }, '★')); });
    }
    draw();
    var close = U.sheet('이름·메모', [U.field('이름', title), U.field('별점', stars), U.field('메모', memo)], [
      h('button.btn.primary.wide', { onclick: function () { S.mutate([{ t: 'trips', id: t.id, set: { title: title.value.trim() || t.title, memo: memo.value, rating: rating ? String(rating) : '' } }]); close(); } }, '저장')]);
  }

  function editLine(l) {
    var qty = R.num(l.qty, 1);
    var name = h('input', { type: 'text', value: l.name, 'data-nofocus': '' });
    var note = h('input', { type: 'text', value: l.note || '', placeholder: '메모', 'data-nofocus': '' });
    var qBox = h('div');
    function drawQ() { qBox.innerHTML = ''; qBox.appendChild(U.stepper(qty, function (v) { qty = v; drawQ(); }, 1)); }
    drawQ();
    var trip = byId('trips', l.tripId), comps = trip ? R.parseCompanions(trip.companions) : [];
    var party = !R.isTogether(l) ? '__mine' : (l.party === '미정' ? '미정' : partyOf(l)), pBox = h('div');
    function drawParty() {
      pBox.innerHTML = '';
      var opts = [{ value: '__mine', label: '🏠 우리 전용' }, { value: '우리', label: '🤝 공용 · ' + ourName() }]
        .concat(comps.map(function (c) { return { value: c.name, label: famIcon(comps, c.name) + ' 공용 · ' + c.name }; })).concat([{ value: '미정', label: '🤔 공용 · 미정' }]);
      pBox.appendChild(U.chips(opts, [party], function (v) { party = v; drawParty(); }));
    }
    drawParty();
    var cat = l.category || '안전·기타', cBox = h('div');
    function drawCat() {
      cBox.innerHTML = '';
      var cs = categories().filter(function (c) { return l.kind === '할일' || c !== '할 일'; });
      if (cs.indexOf(cat) < 0) cs.push(cat);
      cBox.appendChild(U.chips(cs, [cat], function (v) { cat = v; drawCat(); }));
    }
    drawCat();
    var it = itemOf(l);
    var close = U.sheet(l.name, [
      U.field('이름 (이번 캠핑만)', name),
      U.field('수량', qBox),
      l.kind === '할일' ? null : U.field('카테고리', cBox),
      comps.length && l.kind !== '할일' ? U.field('우리 전용 / 공용 배정', pBox, '우리 전용은 동행 가족에게 안 보여요. 공용은 가져올 가족을 고르세요.') : null,
      U.field('메모', note),
      productOf(it) ? h('p.hint', '제품: ' + productOf(it) + (it.owned ? ' · 보유 ' + it.owned + '개' : '')) : null,
      it && R.safeLink(it.link) ? h('a.small', { href: R.safeLink(it.link), target: '_blank', rel: 'noopener' }, '🛒 구매 링크 열기') : null,
      it ? h('a.small', { href: '#/item/' + l.itemId, onclick: function () { close(); } }, '창고에서 이 준비물 편집 ›') : null,
    ], [
      h('button.btn.danger', { onclick: function () { close(); removeLines([l]); } }, '이번 캠핑에서 빼기'),
      h('button.btn.primary', { onclick: function () {
        var set = { name: name.value.trim() || l.name, qty: String(qty), note: note.value };
        if (l.kind !== '할일') set.category = cat;
        if (comps.length && l.kind !== '할일') {
          if (party === '__mine') { set.shared = ''; set.party = ''; } else { set.shared = 'Y'; set.party = party; }
        }
        S.mutate([{ t: 'lines', id: l.id, set: set }]); close();
      } }, '저장')]);
  }

  function quickAdd(t, ctx) {
    var kind = '물건';
    var name = h('input', { type: 'text', placeholder: '이름 (창고에서 검색)' });
    var save = false, picked = null, category = categories()[1] || '안전·기타';
    var kindBox = h('div'), opt = h('div');
    var comps = R.parseCompanions(t.companions);
    // 동행 캠핑: 우리 전용 / 공용 선택 (공용 배정 단계에서 열면 공용이 기본)
    var shared = ctx && ctx.shared != null ? !!ctx.shared : null;
    function sharedNow() { return kind === '할일' ? false : shared != null ? shared : (kind === '장보기' || !!(picked && R.yes(picked.shared))); }
    function draw() {
      kindBox.innerHTML = '';
      kindBox.appendChild(U.seg(['물건', '할일', '장보기'], kind, function (v) { kind = v; if (v === '장보기') category = '음식·음료'; draw(); }));
      if (comps.length && kind !== '할일') kindBox.appendChild(U.seg([{ value: 'own', label: '🏠 우리 전용' }, { value: 'shared', label: '🤝 공용 (미정)' }],
        sharedNow() ? 'shared' : 'own', function (v) { shared = v === 'shared'; draw(); }));
      opt.innerHTML = '';
      if (!picked && kind !== '장보기') {
        opt.appendChild(h('label.inline', h('input', { type: 'checkbox', checked: save, onchange: function (e) { save = e.target.checked; draw(); } }), ' 준비물 창고에도 저장 (다음 캠핑에도 포함)'));
        if (save) opt.appendChild(U.field('카테고리', selectEl(categories(), category, function (v) { category = v; })));
      } else if (picked) opt.appendChild(h('small.hint', '창고 항목: ' + picked.name + ' · ' + picked.category));
    }
    var ac = U.autocomplete(name, function (q) { return itemOptions(q); }, function (o) { picked = o.item; name.value = o.item.name; kind = o.item.kind === '할일' ? '할일' : '물건'; draw(); });
    name.addEventListener('input', function () { if (picked && name.value !== picked.name) { picked = null; draw(); } });
    draw();
    var close = U.sheet('추가', [kindBox, name, ac, opt], [h('button.btn.primary.wide', { onclick: function () {
      var n = name.value.trim(); if (!n) { name.focus(); return; }
      var ops = [], itemId = picked ? picked.id : '';
      if (!picked && save && kind !== '장보기') {
        itemId = S.uid('I');
        ops.push({ t: 'items', id: itemId, set: { kind: kind, name: n, category: category, box: '', rule: '고정', base: '1', active: 'Y' } });
      }
      if (picked && !R.active(picked)) ops.push({ t: 'items', id: picked.id, set: { active: 'Y' } });
      var together = sharedNow();
      var l = { kind: kind, itemId: itemId || S.uid('T'), name: n, category: kind === '장보기' ? '음식·음료' : picked ? picked.category : category,
        box: '', qty: picked ? R.num(picked.base, 1) : 1, leave: '', source: kind === '장보기' ? '장보기' : '수동',
        shared: together ? 'Y' : '', party: together && comps.length ? '미정' : '' };
      ops.push({ t: 'lines', id: S.uid('L'), set: lineSet(t.id, l) });
      S.mutate(ops); close(); U.toast(n + ' 추가' + (comps.length && kind !== '할일' ? (together ? ' · 공용(미정)' : ' · 우리 전용') : ''));
    } }, '추가')]);
  }

  function selectEl(opts, value, onChange, labels) {
    var s = h('select', { onchange: function () { onChange(s.value); } }, opts.map(function (o) {
      return h('option', { value: o, selected: o === value }, (labels && labels[o]) || o || '—');
    }));
    return s;
  }

  function pasteGroceries(t) {
    var ta = h('textarea', { rows: 8, placeholder: '한 줄에 하나씩\n삼겹살 1kg\n상추\n라면 4개' });
    var prev = D().trips.filter(function (x) { return x.id !== t.id; }).sort(function (a, b) { return a.start < b.start ? 1 : -1; })
      .map(function (x) { return { trip: x, items: S.linesOf(x.id).filter(function (l) { return l.kind === '장보기' && l.deleted !== 'Y'; }) }; })
      .filter(function (x) { return x.items.length; })[0];
    var close = U.sheet('장보기 붙여넣기', [ta,
      prev ? h('button.btn.small', { onclick: function () { ta.value = prev.items.map(function (l) { return l.name; }).join('\n'); } }, '↻ ' + prev.trip.title + ' 장보기 불러오기 (' + prev.items.length + ')') : null,
    ], [h('button.btn.primary.wide', { onclick: function () {
      var names = ta.value.split('\n').map(function (s) { return s.replace(/^[\s\-•*·☐□▢\d.)]+/, '').trim(); }).filter(Boolean);
      if (!names.length) return;
      S.mutate(names.map(function (n) {
        return { t: 'lines', id: S.uid('L'), set: lineSet(t.id, { kind: '장보기', itemId: S.uid('T'), name: n, qty: 1, source: '장보기',
          shared: 'Y', party: R.parseCompanions(t.companions).length ? '미정' : '', category: '음식·음료' }) };
      }));
      close(); U.toast('장보기 ' + names.length + '개 추가');
      rerender();
    } }, '추가')]);
  }

  function forgotSheet(t) {
    var name = h('input', { type: 'text', placeholder: '무엇을 깜빡했나요?' });
    var picked = null, category = '차량·기타';
    var info = h('div');
    function draw() {
      info.innerHTML = '';
      if (picked) info.appendChild(h('small.hint', '창고에 있는 항목이에요. 다음 캠핑 목록 맨 위에 ⚠️로 표시할게요.'));
      else info.appendChild(U.field('카테고리', selectEl(categories(), category, function (v) { category = v; }), '창고에 새로 등록하고 다음 캠핑부터 포함해요'));
    }
    var ac = U.autocomplete(name, function (q) { return itemOptions(q); }, function (o) { picked = o.item; name.value = o.item.name; draw(); });
    name.addEventListener('input', function () { if (picked && name.value !== picked.name) { picked = null; draw(); } });
    draw();
    var close = U.sheet('😱 깜빡했어요', [name, ac, info], [h('button.btn.primary.wide', { onclick: function () {
      var n = name.value.trim(); if (!n) { name.focus(); return; }
      var ops = [], item = picked;
      if (!item) {
        item = { id: S.uid('I'), name: n };
        ops.push({ t: 'items', id: item.id, set: { kind: '물건', name: n, category: category, box: '', rule: '고정', base: '1', active: 'Y', memo: '' } });
      } else if (!R.active(item)) ops.push({ t: 'items', id: item.id, set: { active: 'Y' } });
      ops.push({ t: 'reviews', id: 'R-' + t.id + '-' + item.id + '-깜빡함', set: { tripId: t.id, itemId: item.id, name: n, result: '깜빡함', qty: '1', by: me(), at: U.nowStr() } });
      S.mutate(ops); close();
      U.toast('기록했어요. 다음 캠핑에서 꼭 알려드릴게요');
    } }, '기록')]);
  }

  /* ───────── 회고 ───────── */
  /* ───────── 기록 · 통계 ───────── */
  function histTabs(on) { return U.seg([{ value: '#/history', label: '기록' }, { value: '#/stats', label: '통계' }], on, go); }

  function vHistory() {
    cur.name = 'history';
    var list = h('div.list');
    var search = h('input', { type: 'search', placeholder: '이름·장소 검색', value: Q.history, oninput: function () { Q.history = search.value; draw(); } });
    function draw() {
      var q = Q.history.trim();
      var trips = D().trips.filter(function (t) { return Q.archived ? t.status === '보관' : t.status !== '보관'; })
        .filter(function (t) { var pl = placeOf(t); return !q || (t.title + ' ' + (pl ? pl.name : '')).indexOf(q) >= 0; })
        .sort(function (a, b) { return a.start < b.start ? 1 : -1; });
      list.innerHTML = '';
      if (!trips.length) list.appendChild(empty(Q.archived ? '보관된 캠핑이 없어요' : '아직 기록이 없어요'));
      trips.forEach(function (t) {
        var ph = phase(t);
        list.appendChild(h('div.hrow',
          h('a.prow', { href: '#/trip/' + t.id },
            h('div', h('b', t.title), h('small', [placeOf(t) ? placeOf(t).name : '', U.range(t.start, t.end), R.list(t.members).length + '명'].filter(Boolean).join(' · '))),
            h('span', ph === '완료' ? (R.num(t.rating, 0) ? '★'.repeat(R.num(t.rating, 0)) : '') : h('span.badge', ph === '보관' ? '보관' : dday(t)))),
          h('button.icon', { 'aria-label': '복제', title: '이 캠핑처럼', onclick: function () { W = null; go('#/new?from=' + t.id); } }, '↻')));
      });
    }
    draw();
    return h('div.page', top('기록'), histTabs('#/history'), search, list,
      h('label.inline.center', h('input', { type: 'checkbox', checked: Q.archived, onchange: function (e) { Q.archived = e.target.checked; draw(); } }), ' 보관함 보기'));
  }

  function count(arr, key) {
    var m = {}; arr.forEach(function (x) { var k = key(x); if (k) m[k] = (m[k] || 0) + 1; });
    return Object.keys(m).map(function (k) { return [k, m[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
  }
  function vStats() {
    cur.name = 'stats';
    var trips = D().trips.filter(function (t) { return t.status !== '보관' && phase(t) === '완료'; });
    var nights = trips.reduce(function (s, t) { return s + Math.max(0, R.daysBetween(t.start, t.end)); }, 0);
    var year = U.today().slice(0, 4);
    var places = count(trips, function (t) { var p = placeOf(t); return p && p.name; }).slice(0, 5);
    var rv = D().reviews.filter(function (r) { return r.result; });
    var forgot = count(rv.filter(function (r) { return r.result === '깜빡함'; }), function (r) { return r.name; }).slice(0, 5);
    function rank(title, rows, unit) {
      return h('div.card', h('h3', title), rows.length ? h('ol.rank', rows.map(function (r) { return h('li', h('span', r[0]), h('b', r[1] + unit)); })) : h('p.muted', '아직 데이터가 없어요'));
    }
    return h('div.page', top('통계'), histTabs('#/stats'),
      h('div.kpis',
        h('div', h('b', trips.length), h('small', '총 캠핑')),
        h('div', h('b', nights), h('small', '총 박')),
        h('div', h('b', trips.filter(function (t) { return t.start.slice(0, 4) === year; }).length), h('small', year + '년'))),
      rank('📍 자주 간 장소', places, '회'),
      rank('😱 자주 깜빡하는 것', forgot, '회'),
      h('p.hint.center', '캠핑 중 "깜빡했어요"로 남긴 기록이 다음 캠핑 목록 맨 위에 ⚠️로 나와요.'));
  }

  /* ───────── 준비물 창고 ───────── */
  function storeTabs(on) {
    return U.seg([{ value: '#/items', label: '준비물' }, { value: '#/places', label: '장소' }], on, go);
  }

  function vItems() {
    cur.name = 'items';
    var lint = lintProblems();
    var list = h('div');
    var search = h('input', { type: 'search', placeholder: '준비물 검색', value: Q.items, oninput: function () { Q.items = search.value; draw(); } });
    var filterBox = h('div');
    function draw() {
      filterBox.innerHTML = '';
      filterBox.appendChild(U.seg(['물건', '할일', '보관됨'], Q.itemsFilter, function (v) { Q.itemsFilter = v; draw(); }));
      var q = Q.items.trim();
      var items = D().items.filter(function (i) {
        if (Q.itemsFilter === '보관됨' ? R.active(i) : !R.active(i)) return false;
        if (Q.itemsFilter === '물건' && i.kind === '할일') return false;
        if (Q.itemsFilter === '할일' && i.kind !== '할일') return false;
        return !q || (i.name + ' ' + i.category + ' ' + i.include).indexOf(q) >= 0;
      });
      var by = {};
      items.forEach(function (i) { (by[i.category || '기타'] = by[i.category || '기타'] || []).push(i); });
      list.innerHTML = '';
      if (!items.length) list.appendChild(empty('항목이 없어요'));
      sortByOrder(Object.keys(by), categories()).forEach(function (c) {
        list.appendChild(h('section.grp', h('div.grp-head', h('b', c), h('small', by[c].length)),
          by[c].map(function (i) {
            var meta = [productOf(i), i.owned !== '' && i.owned != null ? '보유 ' + i.owned : '', i.rule && i.rule !== '고정' ? i.rule + ' ' + i.base : (R.num(i.base, 1) > 1 ? '×' + i.base : ''),
              i.include ? '+' + i.include : '', i.exclude ? '−' + i.exclude : '', R.yes(i.consumable) ? '소모품 ' + (i.stock || '') : ''].filter(Boolean).join(' · ');
            return h('a.irow', { href: '#/item/' + i.id }, h('div', h('b', i.name, R.yes(i.shared) ? h('span.sharetag', '🤝 분담') : null), meta ? h('small', meta) : null),
              i.stock === '부족' || i.stock === '없음' ? h('span.badge.warn', i.stock) : h('span', '›'));
          })));
      });
    }
    draw();
    return h('div.page', top('준비물 창고'), storeTabs('#/items'),
      lint.length ? h('div.card.lint', h('h3', '⚠️ 규칙 점검 ' + lint.length + '건'), h('small.hint', '이 항목들은 조건이 잘못되어 목록에서 빠질 수 있어요'),
        lint.map(function (p) { return h('a.irow', { href: '#/item/' + p.item.id }, h('div', h('b', p.item.name || '(이름 없음)'), h('small', p.problems.join(', '))), h('span', '›')); })) : null,
      h('div.row2', search, h('a.btn.primary', { href: '#/item/new' }, '+ 추가')),
      h('a.alert', { href: '#/split' }, '🤝 공용 준비물 기본값 정하기 (동행 캠핑용) — 지금 ' + D().items.filter(function (i) { return R.active(i) && R.yes(i.shared); }).length + '개 ›'),
      filterBox, list,
      h('div.foot-links',
        D().meta.sheetUrl ? h('a', { href: D().meta.sheetUrl, target: '_blank', rel: 'noopener' }, '📊 구글 시트에서 대량 편집') : null,
        h('a', { href: '#/log' }, '🕘 변경 이력')));
  }

  function vItemEdit(id) {
    cur.name = 'itemEdit';
    var isNew = id === 'new';
    var src = isNew ? null : byId('items', id);
    if (!isNew && !src) return empty('준비물을 찾을 수 없어요');
    if (!E || E._id !== id) {
      E = Object.assign({ kind: '물건', name: '', category: '차량·기타', box: '', rule: '고정', base: '1', include: '', exclude: '', leave: '', consumable: '', stock: '', owner: '', memo: '', active: 'Y',
        brand: '', model: '', link: '', owned: '', shared: '' }, src || {});
      E._id = id;
    }
    function set(f, v) { E[f] = v; rerender(); }
    function tagEditor(f) {
      var cur2 = R.list(E[f]);
      var singles = cur2.filter(function (x) { return x.indexOf('&') < 0; });
      var combos = cur2.filter(function (x) { return x.indexOf('&') >= 0; });
      var comboIn = h('input', { type: 'text', placeholder: '조합 (예: 아이&계곡)', 'data-nofocus': '' });
      return h('div',
        tagGroups().map(function (g) {
          return h('div.tg', h('small.lbl', g.group), U.chips(g.tags, singles, function (v, on) {
            var l = R.list(E[f]); l = on ? l.concat(v) : l.filter(function (x) { return x !== v; }); set(f, l.join(', '));
          }));
        }),
        combos.length ? h('div.chips', combos.map(function (c) { return h('button.chip.on', { type: 'button', onclick: function () { set(f, R.list(E[f]).filter(function (x) { return x !== c; }).join(', ')); } }, c + ' ✕'); })) : null,
        h('div.addrow', comboIn, h('button.btn.small', { type: 'button', onclick: function () {
          var v = comboIn.value.replace(/\s/g, ''); if (!v) return; set(f, R.list(E[f]).concat(v).join(', '));
        } }, '조합 추가')));
    }
    var name = h('input', { type: 'text', value: E.name, oninput: function (e) { E.name = e.target.value; } });
    var memo = h('input', { type: 'text', value: E.memo, placeholder: '체크할 때 표시', oninput: function (e) { E.memo = e.target.value; } });
    var inc = R.list(E.include), exc = R.list(E.exclude);
    var ruleSummary = (inc.length ? inc.join(' 또는 ') + '일 때' : '항상 챙겨요') + (exc.length ? ' · ' + exc.join(', ') + '이면 빼요' : '');
    var ex = { family: 4, adults: 2, kids: 2, infants: 0, pets: 0, total: 4, nights: 2 };
    var exQty = R.num(E.base, 1) * R.multiplier(E.rule, ex);
    return h('div.page',
      top(isNew ? '새 준비물' : E.name, { back: '#/items' }),
      h('div.card',
        U.seg(['물건', '할일'], E.kind || '물건', function (v) { set('kind', v); }),
        U.field('이름', name),
        U.field('카테고리', selectEl(categories(), E.category, function (v) { E.category = v; })),
        E.kind !== '할일' ? U.field('동행 가족과 함께 갈 때', U.seg([{ value: '', label: '🏠 우리 전용' }, { value: 'Y', label: '🤝 공용' }], R.yes(E.shared) ? 'Y' : '',
          function (v) { set('shared', v); }), R.yes(E.shared) ? '타프·버너처럼 한 집만 가져오면 되는 것 — 동행 캠핑에서 공용으로 시작해요' : '텐트·침낭처럼 집마다 따로 챙기는 것 — 우리 전용, 동행 가족에게 안 보여요') : null,
        h('div.row2',
          U.field('수량 규칙', selectEl(R.RULES, E.rule || '고정', function (v) { set('rule', v); })),
          U.field('기본 수량', U.stepper(R.num(E.base, 1), function (v) { set('base', String(v)); }, 1))),
        h('small.hint', '예) 가족 4명(어른2·아이2) 2박이면 → ' + exQty + '개')),
      h('div.card',
        h('div.kv', h('h3', '언제 챙기나요?'), h('button.btn.small', { onclick: function () { E._rules = !E._rules; rerender(); } }, E._rules ? '접기 ▴' : '조건 바꾸기 ▾')),
        h('p', h('b', ruleSummary)),
        E._rules ? [
          h('small.hint', '비워두면 항상 포함. 여러 개 고르면 하나라도 해당할 때 포함. 둘 다 필요하면 "조합"으로.'),
          tagEditor('include'),
          h('h3', '이럴 땐 빼요'), h('small.hint', '하나라도 해당하면 제외 (포함보다 우선)'), tagEditor('exclude')] : null),
      (function () {
        var more = h('details.card.more', { open: !!E._more },
          h('summary', '더 보기 ', h('small', '제품 정보 · 보유 수량 · 소모품 · 메모')),
          E.kind !== '할일' ? [
            h('div.row2',
              U.field('브랜드', h('input', { type: 'text', value: E.brand, placeholder: '예: 헬리녹스', 'data-nofocus': '', oninput: function (e) { E.brand = e.target.value; } })),
              U.field('제품명', h('input', { type: 'text', value: E.model, placeholder: '예: 체어원', 'data-nofocus': '', oninput: function (e) { E.model = e.target.value; } }))),
            U.field('보유 수량', h('input', { type: 'text', inputmode: 'numeric', value: E.owned, placeholder: '비워두면 확인 안 함', 'data-nofocus': '',
              oninput: function (e) { E.owned = e.target.value.replace(/[^\d]/g, ''); e.target.value = E.owned; } }), '필요 수량이 이보다 많으면 "부족" 알림'),
            U.field('구매 링크', h('input', { type: 'url', value: E.link, placeholder: 'https://… (재구매용)', 'data-nofocus': '', oninput: function (e) { E.link = e.target.value.trim(); } })),
            h('label.toggle', h('input', { type: 'checkbox', checked: R.yes(E.leave), onchange: function (e) { set('leave', e.target.checked ? 'Y' : ''); } }), ' 두고 오기 쉬운 물건 (철수 때 따로 확인)')] : null,
          h('label.toggle', h('input', { type: 'checkbox', checked: R.yes(E.consumable), onchange: function (e) { E.consumable = e.target.checked ? 'Y' : ''; if (E.consumable && !E.stock) E.stock = '충분'; rerender(); } }), ' 소모품 (재고 관리)'),
          R.yes(E.consumable) ? U.field('재고', U.seg(['충분', '부족', '없음'], E.stock || '충분', function (v) { set('stock', v); })) : null,
          U.field('메모', memo));
        more.addEventListener('toggle', function () { E._more = more.open; });
        return more;
      })(),
      h('div.wiz-nav',
        !isNew ? h('button.btn' + (R.active(E) ? '.danger' : ''), { onclick: function () {
          S.mutate([{ t: 'items', id: id, set: { active: R.active(E) ? 'N' : 'Y' } }]); E = null; U.toast(R.active(src) ? '보관했어요' : '복원했어요'); go('#/items');
        } }, R.active(E) ? '보관' : '복원') : h('span'),
        h('button.btn.primary', { onclick: function () {
          var n = E.name.trim(); if (!n) { name.focus(); return; }
          var dup = D().items.filter(function (i) { return i.name === n && i.id !== id; })[0];
          if (dup) { U.toast('같은 이름이 이미 있어요'); return; }
          var set2 = {};
          if (E.link && !R.safeLink(E.link)) { U.toast('구매 링크는 http로 시작해야 해요'); return; }
          ['kind', 'name', 'category', 'box', 'rule', 'base', 'include', 'exclude', 'leave', 'consumable', 'stock', 'owner', 'memo', 'active',
            'brand', 'model', 'link', 'owned', 'shared'].forEach(function (f) { set2[f] = f === 'name' ? n : (E[f] == null ? '' : E[f]); });
          set2.box = '';
          S.mutate([{ t: 'items', id: isNew ? S.uid('I') : id, set: set2 }]);
          E = null; U.toast('저장했어요'); go('#/items');
        } }, '저장')));
  }

  function vPlaces() {
    cur.name = 'places';
    var visits = {};
    D().trips.forEach(function (t) { if (t.placeId && t.status !== '보관') visits[t.placeId] = (visits[t.placeId] || 0) + 1; });
    var list = D().places.slice().sort(function (a, b) { return (visits[b.id] || 0) - (visits[a.id] || 0); });
    return h('div.page', top('장소'), storeTabs('#/places'),
      h('a.btn.primary.wide', { href: '#/place/new' }, '+ 새 장소'),
      list.length ? list.map(function (p) {
        return h('a.irow' + (R.active(p) ? '' : '.off'), { href: '#/place/' + p.id },
          h('div', h('b', p.name), h('small', [p.region, R.list(p.tags).join(', '), (visits[p.id] || 0) + '회 방문', p.lat ? '📍' : '위치 미등록'].filter(Boolean).join(' · '))), h('span', '›'));
      }) : empty('등록된 장소가 없어요'));
  }

  function vPlaceEdit(id) {
    cur.name = 'placeEdit';
    var isNew = id === 'new', src = isNew ? null : byId('places', id);
    if (!isNew && !src) return empty('장소를 찾을 수 없어요');
    if (!E || E._id !== 'P' + id) { E = Object.assign({ name: '', region: '', lat: '', lng: '', tags: '', items: '', memo: '', active: 'Y' }, src || {}); E._id = 'P' + id; E._geo = null; }
    function set(f, v) { E[f] = v; rerender(); }
    var name = h('input', { type: 'text', value: E.name, oninput: function (e) { E.name = e.target.value; } });
    var region = h('input', { type: 'text', value: E.region, placeholder: '예: 가평, 홍천, 태안', oninput: function (e) { E.region = e.target.value; } });
    var coord = h('input', { type: 'text', value: E.lat ? E.lat + ', ' + E.lng : '', placeholder: '위도, 경도 (직접 입력 시)', 'data-nofocus': '',
      onchange: function (e) { var m = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(e.target.value); if (m) { E.lat = m[1]; E.lng = m[2]; rerender(); } } });
    var memo = h('textarea', { rows: 3, placeholder: '예: 전기 있음, 개수대 멀어요, 매점에서 장작 판매', oninput: function (e) { E.memo = e.target.value; } }, E.memo);
    var ids = R.list(E.items), inIds = {}; ids.forEach(function (x) { inIds[x] = 1; });
    var addIn = h('input', { type: 'text', placeholder: '이 장소에 갈 때만 챙길 것', 'data-nofocus': '' });
    var ac = U.autocomplete(addIn, function (q) { return itemOptions(q, inIds); }, function (o) { set('items', ids.concat(o.item.id).join(',')); });
    var groups = tagGroups().filter(function (g) { return g.group === '장소유형' || g.group === '환경' || g.group === '사용자'; });
    var trips = isNew ? [] : D().trips.filter(function (t) { return t.placeId === id; }).sort(function (a, b) { return a.start < b.start ? 1 : -1; });
    return h('div.page',
      top(isNew ? '새 장소' : E.name, { back: '#/places' }),
      h('div.card', U.field('이름', name),
        U.field('지역 (날씨용)', h('div.addrow', region, h('button.btn.small', { type: 'button', onclick: function () {
          var q = region.value.trim() || name.value.trim(); if (!q) return;
          E._geo = 'loading'; rerender();
          geocode(q).then(function (rs) { E._geo = rs; rerender(); }).catch(function () { E._geo = []; rerender(); U.toast('검색 실패 (오프라인?)'); });
        } }, '위치 찾기'))),
        E._geo === 'loading' ? h('small.hint', '검색 중…') : Array.isArray(E._geo) ? (E._geo.length ? h('div.list', E._geo.map(function (g) {
          return h('button.prow', { type: 'button', onclick: function () { E.lat = g.latitude.toFixed(4); E.lng = g.longitude.toFixed(4); E._geo = null; rerender(); } },
            h('div', h('b', g.name), h('small', [g.admin1, g.admin2, g.country].filter(Boolean).join(' '))), h('span', '선택'));
        })) : h('small.hint', '결과가 없어요. 시·군 이름으로 검색하거나 지도 앱에서 위도·경도를 복사해 아래에 붙여넣으세요.')) : null,
        U.field('위치', coord, E.lat ? '날씨 예보 사용 가능 ✓' : '위치가 있어야 날씨를 자동 반영해요')),
      h('div.card', h('h3', '장소 특징'), h('small.hint', '이 장소로 가면 자동으로 적용되는 조건이에요'),
        groups.map(function (g) {
          return h('div.tg', h('small.lbl', g.group), U.chips(g.tags, R.list(E.tags), function (v, on) {
            var l = R.list(E.tags); l = on ? l.concat(v) : l.filter(function (x) { return x !== v; }); set('tags', l.join(', '));
          }));
        })),
      h('div.card', h('h3', '이 장소 전용 준비물'),
        ids.length ? h('div.chips', ids.map(function (iid) {
          var it = byId('items', iid);
          return h('button.chip.on', { type: 'button', onclick: function () { set('items', ids.filter(function (x) { return x !== iid; }).join(',')); } }, (it ? it.name : iid) + ' ✕');
        })) : h('small.hint', '없음'),
        addIn, ac),
      h('div.card', U.field('메모', memo)),
      trips.length ? h('div.card', h('h3', '방문 기록'), trips.map(function (t) { return pastRow(t); })) : null,
      h('div.wiz-nav',
        !isNew ? h('button.btn', { onclick: function () { S.mutate([{ t: 'places', id: id, set: { active: R.active(E) ? 'N' : 'Y' } }]); E = null; go('#/places'); } }, R.active(E) ? '보관' : '복원') : h('span'),
        h('button.btn.primary', { onclick: function () {
          var n = E.name.trim(); if (!n) { name.focus(); return; }
          S.mutate([{ t: 'places', id: isNew ? S.uid('P') : id, set: { name: n, region: E.region.trim(), lat: E.lat, lng: E.lng, tags: E.tags, items: E.items, memo: E.memo, active: E.active || 'Y' } }]);
          E = null; U.toast('저장했어요'); go('#/places');
        } }, '저장')));
  }

  /* ───────── 공용 준비물 기본값 설정 ───────── */
  var SP = null;
  function vSplitSetup(tripId) {
    cur.name = 'split';
    if (!SP || SP.tripId !== (tripId || '')) SP = { tripId: tripId || '', ch: {} };
    var trip = tripId ? byId('trips', tripId) : null;
    function val(i) { return SP.ch[i.id] != null ? SP.ch[i.id] : (R.yes(i.shared) ? 'Y' : ''); }
    var items = D().items.filter(function (i) { return R.active(i) && i.kind !== '할일'; });
    var by = {};
    items.forEach(function (i) { (by[i.category || '기타'] = by[i.category || '기타'] || []).push(i); });
    var nShared = items.filter(function (i) { return val(i) === 'Y'; }).length;
    var changed = Object.keys(SP.ch).filter(function (id) { var i = byId('items', id); return i && (R.yes(i.shared) ? 'Y' : '') !== SP.ch[id]; });
    function save() {
      var ops = changed.map(function (id) { return { t: 'items', id: id, set: { shared: SP.ch[id] } }; });
      var n = 0;
      if (trip) {
        // 이번 캠핑에도 반영: 아직 안 챙긴 것만 (이미 동행 가족에게 맡긴 것은 그대로)
        S.linesOf(trip.id).forEach(function (l) {
          if (l.deleted === 'Y' || l.kind !== '물건' || l.pack || changed.indexOf(l.itemId) < 0) return;
          if (SP.ch[l.itemId] === 'Y' && (!l.party || l.party === '우리')) { ops.push({ t: 'lines', id: l.id, set: { shared: 'Y', party: '미정' } }); n++; }
          if (SP.ch[l.itemId] !== 'Y' && (l.party === '미정' || l.party === '우리' || !l.party)) { ops.push({ t: 'lines', id: l.id, set: { shared: '', party: '' } }); n++; }
        });
      }
      S.mutate(ops);
      U.toast('저장했어요' + (trip ? ' · 이번 캠핑 ' + n + '개에도 반영' : ''));
      SP = null;
      go(trip ? '#/trip/' + trip.id : '#/items');
    }
    return h('div.page',
      top('공용 준비물 기본값', { back: trip ? '#/trip/' + trip.id : '#/items' }),
      h('div.card',
        h('p', '동행 가족과 함께 갈 때 ', h('b', '한 집만 가져오면 되는 것'), '을 고르세요.'),
        h('small.hint', '🤝 공용: 타프·버너·화로대처럼 — 동행 캠핑에서 "공용 준비물 배정"에 올라가고 동행 가족 링크에 보여요.'),
        h('small.hint', '🏠 우리 전용: 텐트·침낭·옷처럼 — 집마다 따로 챙기는 것이라 동행 가족에게 안 보여요.'),
        trip ? h('small.hint', '저장하면 "' + trip.title + '"에서 아직 안 챙긴 항목에도 바로 반영돼요.') : null),
      h('p.summary', '🤝 공용 ' + nShared + '개 · 🏠 우리 전용 ' + (items.length - nShared) + '개' + (changed.length ? ' · 바뀐 것 ' + changed.length + '개' : '')),
      sortByOrder(Object.keys(by), categories()).map(function (c) {
        var list = by[c], nS = list.filter(function (i) { return val(i) === 'Y'; }).length;
        return h('section.grp',
          h('div.grp-head', h('b', c), h('small', '🤝 ' + nS + '/' + list.length),
            h('button.btn.small', { onclick: function () { var to = nS === list.length ? '' : 'Y'; list.forEach(function (i) { SP.ch[i.id] = to; }); rerender(); } },
              nS === list.length ? '모두 우리 전용' : '모두 공용')),
          list.map(function (i) {
            var on = val(i) === 'Y';
            return h('div.splitrow' + (on ? '.on' : ''), { onclick: function () { SP.ch[i.id] = on ? '' : 'Y'; rerender(); } },
              h('div', h('b', i.name), i.box ? h('small', '📦 ' + i.box) : null),
              h('span.splitpill', on ? '🤝 공용' : '🏠 우리 전용'));
          }));
      }),
      h('div.wiz-nav', h('a.btn', { href: trip ? '#/trip/' + trip.id : '#/items', onclick: function () { SP = null; } }, '취소'),
        h('button.btn.primary', { disabled: !changed.length, onclick: save }, changed.length ? '저장 (' + changed.length + '개 변경)' : '바뀐 것 없음')));
  }


  /** 가족 구성원 (인원 계산용) 추가·수정 */
  function memberSheet(m, onDone) {
    var name = h('input', { type: 'text', value: m ? m.name : '', placeholder: '호칭 (예: 엄마, 첫째)' });
    var email = h('input', { type: 'email', value: m ? m.email : '', placeholder: '알림 받을 이메일 (선택)', 'data-nofocus': '' });
    var type = m ? m.type : '어른';
    var segBox = h('div');
    function draw() { segBox.innerHTML = ''; segBox.appendChild(U.seg(['어른', '아이', '영유아', '반려견'], type, function (v) { type = v; draw(); })); }
    draw();
    var close = U.sheet(m ? m.name : '구성원 추가', [U.field('이름', name), U.field('구분', segBox, '아이 = 초등 이상, 영유아 = 부모와 함께 자는 아이 · 인원수로 준비물 수량을 계산해요'),
      U.field('이메일', email, '출발 이틀 전 준비 알림 메일을 받아요')], [
      m ? h('button.btn', { onclick: function () { S.mutate([{ t: 'members', id: m.id, set: { active: R.active(m) ? 'N' : 'Y' } }]); close(); rerender(); } }, R.active(m) ? '숨기기' : '다시 표시') : null,
      h('button.btn.primary', { onclick: function () {
        var n = name.value.trim(); if (!n) { name.focus(); return; }
        var dup = sameName(n);
        if (dup && (!m || dup.id !== m.id)) { U.toast('"' + dup.name + '" 이름이 이미 있어요'); return; }
        var id = m ? m.id : S.uid('M');
        S.mutate([{ t: 'members', id: id, set: { name: n, type: type, email: email.value.trim(), active: m ? m.active || 'Y' : 'Y' } }]);
        close(); if (onDone) onDone(id); else rerender();
      } }, '저장')]);
  }

  /* ───────── 설정 ───────── */
  function vSettings() {
    cur.name = 'settings';
    var link = location.origin + location.pathname + '#api=' + encodeURIComponent(S.api()) + '&k=' + (S.cfg.k || '');
    function settingSheet(key, label, hint) {
      var ta = h('textarea', { rows: 4 }, setting(key));
      var close = U.sheet(label, [ta, hint ? h('small.hint', hint) : null], [h('button.btn.primary.wide', { onclick: function () {
        S.mutate([{ t: 'settings', id: key, set: { value: R.list(ta.value).join(', ') } }]); close(); rerender();
      } }, '저장')]);
    }
    var mail = setting('이메일알림') !== 'N';
    return h('div.page', top('설정'),
      h('div.card', h('h3', '가족 구성원'),
        D().members.map(function (m) {
          return h('button.irow' + (R.active(m) ? '' : '.off'), { onclick: function () { memberSheet(m); } },
            h('div', h('b', (TYPE_ICON[m.type] || '') + ' ' + m.name), h('small', [m.type, m.email].filter(Boolean).join(' · '))), h('span', '›'));
        }),
        h('button.btn.wide', { onclick: function () { memberSheet(null); } }, '+ 구성원 추가')),
      familyLoginCard(link),
      h('div.card', h('h3', '조건·분류'),
        h('button.irow', { onclick: function () { settingSheet('태그_사용자', '직접 만든 조건 태그', '쉼표로 구분. 예: 캠핑카, 낚시, 스키'); } }, h('div', h('b', '직접 만든 조건 태그'), h('small', setting('태그_사용자') || '없음')), h('span', '›')),
        h('button.irow', { onclick: function () { settingSheet('카테고리', '카테고리 (표시 순서)', '쉼표로 구분'); } }, h('div', h('b', '카테고리'), h('small', categories().length + '개')), h('span', '›')),
        h('a.irow', { href: '#/split' }, h('div', h('b', '🤝 공용 준비물 기본값'), h('small', D().items.filter(function (i) { return R.active(i) && R.yes(i.shared); }).length + '개')), h('span', '›'))),
      h('div.card', h('h3', '알림'),
        h('label.toggle', h('input', { type: 'checkbox', checked: mail, onchange: function (e) {
          S.mutate([{ t: 'settings', id: '이메일알림', set: { value: e.target.checked ? 'Y' : 'N' } }]);
        } }), ' 이메일 알림 (D-2 준비, D+1 회고)'),
        h('small.hint', '구성원에 이메일을 등록한 사람에게 보내요. 없으면 시트 소유자에게 보내요.')),
      h('div.card', h('h3', '동기화'),
        h('p.hint', '데이터 버전 ' + D().version + ' · 대기 중 ' + S.queue.length + '건' + (S.status.lastSync ? ' · 마지막 ' + new Date(S.status.lastSync).toLocaleTimeString('ko-KR') : '')),
        S.status.error ? h('p.err', S.status.error) : null,
        h('div.row2',
          h('button.btn', { onclick: function () { S.flush(); S.sync(true).then(function () { U.toast('최신 상태예요'); rerender(); }); } }, '지금 동기화'),
          D().meta.sheetUrl ? h('a.btn', { href: D().meta.sheetUrl, target: '_blank', rel: 'noopener' }, '구글 시트 열기') : null),
        h('a.small', { href: '#/log' }, '🕘 변경 이력 보기')),
      h('div.card',
        h('button.btn.danger.wide', { onclick: function () {
          U.ask('이 기기 연결 해제', S.queue.length ? '⚠️ 아직 전송 안 된 변경 ' + S.queue.length + '건이 사라져요. 계속할까요?' : '이 기기에서 연결 정보를 지워요. 데이터는 시트에 그대로 있어요.', '연결 해제', function () { S.reset(); location.reload(); }, true);
        } }, '이 기기 연결 해제')),
      h('p.ver', 'camp-pack v' + APP_VERSION));
  }

  function vLog() {
    cur.name = 'log';
    var box = h('div', empty('불러오는 중…'));
    S.history().then(function (rows) {
      box.innerHTML = '';
      if (!rows.length) box.appendChild(empty('변경 이력이 없어요'));
      rows.forEach(function (r) {
        box.appendChild(h('div.logrow', h('small', r.at + ' · ' + r.by + ' · ' + r.target + ' ' + r.action), h('div', r.detail)));
      });
    }).catch(function () { box.innerHTML = ''; box.appendChild(empty('인터넷 연결이 필요해요')); });
    return h('div.page', top('변경 이력', { back: '#/settings' }), box);
  }

  /* ───────── 동행 가족 (마법사) ───────── */
  function ourName() { return D().meta.familyName || '우리 가족'; }
  function won(n) { return Math.round(R.num(n, 0)).toLocaleString('ko-KR') + '원'; }
  function randToken() {
    var a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  /** 지난 캠핑에서 함께 간 가족 (최근 인원 기억) */
  function pastCompanions(exceptId) {
    var seen = {}, out = [];
    D().trips.slice().sort(function (a, b) { return a.start < b.start ? 1 : -1; }).forEach(function (x) {
      if (x.id === exceptId || x.status === '보관') return;
      R.parseCompanions(x.companions).forEach(function (c) {
        if (seen[c.name]) return;
        seen[c.name] = 1;
        out.push({ name: c.name, adults: R.num(c.adults, 0), kids: R.num(c.kids, 0), last: x.start });
      });
    });
    return out;
  }

  function companionsCard(t) {
    var comp = R.parseCompanions(t.companions).map(function (c) { return Object.assign({}, c); });
    var names = comp.map(function (c) { return c.name; });
    function save() { t.companions = comp.length ? JSON.stringify(comp) : ''; rerender(); }
    var known = pastCompanions(W && W.tripId).filter(function (c) { return names.indexOf(c.name) < 0; });
    function addSheet() {
      var n = h('input', { type: 'text', placeholder: '예: 철수네, 회사 동료' });
      var close = U.sheet('함께 가는 가족·손님', [U.field('이름', n, '가족 단위로 적으면 공용 짐을 나눠 챙기고 정산할 수 있어요')], [
        h('button.btn.primary.wide', { onclick: function () {
          var v = n.value.trim(); if (!v) { n.focus(); return; }
          if (v === '우리' || v === '미정' || names.indexOf(v) >= 0) { U.toast('사용할 수 없는 이름이에요'); return; }
          comp.push({ name: v, adults: 2, kids: 0 }); close(); save();
        } }, '추가')]);
    }
    return h('div.card', h('h3', '함께 가는 가족·손님'),
      known.length ? h('div', h('small.lbl', '지난번 함께 간 가족 (탭해서 추가)'), h('div.chips', known.map(function (c) {
        return h('button.chip', { type: 'button', onclick: function () { comp.push({ name: c.name, adults: c.adults, kids: c.kids }); save(); } },
          '+ ' + c.name + ' (' + (c.adults + c.kids) + '명)');
      }))) : null,
      comp.map(function (c, i) {
        return h('div.comp',
          h('div.comp-head', h('b', FAM_DOTS[i % 6] + ' ' + c.name), h('button.icon', { 'aria-label': '빼기', onclick: function () { comp.splice(i, 1); save(); } }, '✕')),
          h('div.kv', h('span', '어른'), U.stepper(R.num(c.adults, 0), function (v) { c.adults = v; save(); })),
          h('div.kv', h('span', '아이'), U.stepper(R.num(c.kids, 0), function (v) { c.kids = v; save(); })));
      }),
      h('button.btn.small', { onclick: addSheet }, '+ 가족·손님 추가'),
      h('small.hint', '동행 인원은 의자·식기처럼 "전체인원당" 준비물에 반영되고, 공용 짐(타프·버너 등)은 가족끼리 나눠 챙길 수 있어요.'));
  }

  /** 같은 동행 가족과 간 가장 최근 캠핑 */
  function memoryTrip() {
    if (!W || W.mode !== 'new') return null;
    var names = R.parseCompanions(W.t.companions).map(function (c) { return c.name; });
    if (!names.length) return null;
    return D().trips.filter(function (x) {
      return x.status !== '보관' && R.parseCompanions(x.companions).some(function (c) { return names.indexOf(c.name) >= 0; });
    }).sort(function (a, b) { return a.start < b.start ? 1 : -1; })[0] || null;
  }
  /** 지난 분담: 항목 → 담당 가족 (지금도 함께 가는 가족·우리만) */
  function memoryParties() {
    var mt = memoryTrip(); if (!mt) return {};
    var lines = S.linesOf(mt.id);
    if (!lines.length && !S.extra[mt.id]) { S.ensureLines(mt.id).then(function () { if (cur.name === 'wizard') rerender(); }).catch(function () {}); return {}; }
    var names = R.parseCompanions(W.t.companions).map(function (c) { return c.name; }), m = {};
    lines.forEach(function (l) {
      if (l.deleted === 'Y' || !l.itemId || !l.party || l.party === '미정') return;
      if (l.party === '우리' || names.indexOf(l.party) >= 0) m[l.itemId] = l.party;
    });
    return m;
  }
  function memoryCard() {
    var mt = memoryTrip(); if (!mt) return null;
    var n = Object.keys(memoryParties()).length;
    return h('div.card.memory',
      h('label.toggle', h('input', { type: 'checkbox', checked: W.useMem, onchange: function (e) { W.useMem = e.target.checked; } }),
        ' 🤝 ' + mt.title + (mt.title.indexOf(U.md(mt.start)) >= 0 ? '' : ' (' + U.md(mt.start) + ')') + ' 때 분담 그대로 적용'),
      h('small.hint', n ? '공용 짐 ' + n + '개의 담당 가족을 지난번처럼 정해 둘게요. 나머지는 "미정"으로 시작해요.' : '불러오는 중이거나 지난 분담 기록이 없어요.'));
  }

  /* ───────── 같이 챙기기 탭 ───────── */
  /* 동행 가족 색: 캠핑에 적힌 순서대로 🔵🟣🟢🟤🟡🔴 (우리 가족은 🏠) */
  var FAM_DOTS = ['🔵', '🟣', '🟢', '🟤', '🟡', '🔴'];
  function famIdx(comps, name) { for (var i = 0; i < comps.length; i++) if (comps[i].name === name) return i; return -1; }
  function famIcon(comps, name) { if (!name || name === '우리') return '🏠'; var i = famIdx(comps, name); return i < 0 ? '🤝' : FAM_DOTS[i % 6]; }
  function famCls(comps, name) { var i = !name || name === '우리' ? -1 : famIdx(comps, name); return i < 0 ? '' : '.fc' + (i % 6); }
  function partiesOf(ourLabel, ourPeople, comps) {
    return [{ name: '우리', label: ourLabel, people: ourPeople, icon: '🏠', cls: '' }].concat(comps.map(function (c) {
      return { name: c.name, label: c.name, people: R.num(c.adults, 0) + R.num(c.kids, 0), icon: famIcon(comps, c.name), cls: famCls(comps, c.name) };
    }));
  }
  function partyList(t) {
    var ids = R.list(t.members);
    var ours = D().members.filter(function (m) { return ids.indexOf(m.id) >= 0 && m.type !== '반려견'; }).length;
    return partiesOf(ourName(), ours, R.parseCompanions(t.companions));
  }
  function plabel(parties, name) { return !name || name === '우리' ? parties[0].label : name; }
  function partyOf(l) { return l.party || '우리'; }
  function isDone(l) { return !!(l.pack || l.done); }

  function shareOut(title, url, text) {
    var body = (text || '') + (url ? (text ? '\n\n' : '') + url : '');
    if (navigator.share) { navigator.share({ title: title, text: text || title, url: url || undefined }).catch(function () {}); return; }
    if (navigator.clipboard) { navigator.clipboard.writeText(body).then(function () { U.toast('복사했어요. 카톡에 붙여넣으세요'); }, function () { U.sheet(title, h('textarea', { rows: 10, readonly: true }, body)); }); return; }
    U.sheet(title, h('textarea', { rows: 10, readonly: true }, body));
  }

  function moneyLines(lines) {
    return lines.filter(function (l) { return l.deleted !== 'Y' && l.scope !== '우리만' && (l.kind === '장보기' || l.kind === '정산' || R.num(l.amount, 0) > 0); });
  }

  function shareText(title, range, lines, parties, rule) {
    var items = R.sharedLines(lines).filter(function (l) { return l.kind !== '정산' && l.scope !== '우리만'; });
    var out = ['🏕️ ' + title + ' (' + range + ') 같이 챙기기'];
    var und = items.filter(function (l) { return l.party === '미정'; });
    if (und.length) out.push('', '❓ 누가?: ' + und.map(function (l) { return l.name; }).join(', '));
    parties.forEach(function (p) {
      var mine = items.filter(function (l) { return partyOf(l) === p.name; });
      if (mine.length) out.push('', '[' + p.label + '] ' + mine.map(function (l) { return (isDone(l) ? '✓' : '') + l.name + (R.num(l.qty, 1) > 1 ? '×' + l.qty : ''); }).join(', '));
    });
    var res = R.settle(moneyLines(lines), parties, rule);
    if (res.total) {
      out.push('', '💰 정산 (' + (rule === '가족' ? '가족별 균등' : '인원 비례') + ') 총 ' + won(res.total));
      res.transfers.forEach(function (x) { out.push(plabel(parties, x.from) + ' → ' + plabel(parties, x.to) + ' ' + won(x.amount)); });
    }
    return out.join('\n');
  }

  /** 준비 단계 위쪽: 아직 안 정한 공용 짐 고르기 */
  function askCard(t, lines) {
    var shorts = lines.filter(function (l) { return l.kind === '물건' && shortOf(l) > 0; });
    if (!shorts.length) return null;
    return h('div.card', h('h3', '🙏 부족해요 — 동행 가족에게 부탁'),
      h('small.hint', '부탁하면 미정 공용 준비물로 올라가고, 동행 가족이 "우리가 가져갈게"를 누를 수 있어요.'),
      shorts.map(function (l) {
        var askId = 'T-ask-' + l.itemId, asked = lines.filter(function (x) { return x.itemId === askId && x.deleted !== 'Y'; })[0];
        var n = shortOf(l);
        return h('div.kv', h('span', l.name + ' ' + n + '개 부족'),
          asked ? h('span.muted', '부탁함 ✓') : h('button.btn.small', { onclick: function () {
            var it = itemOf(l);
            S.mutate([{ t: 'lines', id: S.uid('L'), set: lineSet(t.id, { kind: '물건', itemId: askId, name: l.name + ' (빌려주세요)', category: it ? it.category : '', box: '',
              qty: n, shared: 'Y', party: '미정', source: '부탁', note: '우리 보유 ' + (it ? it.owned : '?') + '개' }) }]);
            U.toast(l.name + ' ' + n + '개를 부탁 목록에 올렸어요');
          } }, '부탁하기'));
      }));
  }


  /** 동행 가족별 전용 링크: 보내기·끄기 */
  function linkCard(t, lines, parties) {
    var comps = R.parseCompanions(t.companions), until = R.addDays(t.end || t.start, 7);
    function saveComps(next, extra) { S.mutate([{ t: 'trips', id: t.id, set: Object.assign({ companions: JSON.stringify(next) }, extra || {}) }]); }
    function send(c) {
      var tok = c.token;
      if (!tok) {
        tok = randToken();
        saveComps(comps.map(function (x) { return x.name === c.name ? Object.assign({}, x, { token: tok }) : x; }), { shareUntil: until });
      } else if (t.shareUntil !== until) S.mutate([{ t: 'trips', id: t.id, set: { shareUntil: until } }]);
      shareOut('🏕️ ' + t.title + ' — ' + c.name + ' 전용', location.origin + location.pathname + '#/s/' + tok,
        '🏕️ ' + t.title + ' (' + U.range(t.start, t.end) + ')\n' + c.name + ' 전용 링크예요. 맡은 준비물을 확인하고 챙기면 체크해 주세요!');
    }
    return h('div.card', h('h3', '🔗 동행 가족별 전용 링크'),
      h('p.hint', '가족마다 다른 링크예요. 열면 로그인 없이 그 가족으로 바로 들어가서, 그 가족이 맡은 것·공용 짐·정산만 봐요. ' + U.md(until) + '에 자동으로 닫혀요.'),
      comps.map(function (c) {
        return h('div.famlink',
          h('div', h('b', famIcon(comps, c.name) + ' ' + c.name), h('small', c.token ? '링크 보냄' : '아직 안 보냄')),
          h('button.btn.small.primary', { onclick: function () { send(c); } }, c.token ? '다시 보내기' : '📤 보내기'),
          c.token ? h('button.btn.small', { onclick: function () {
            U.ask(c.name + ' 링크 끄기', '이 가족의 링크는 더 이상 열리지 않아요. 다시 보내면 새 링크가 만들어져요.', '끄기', function () {
              saveComps(comps.map(function (x) { return x.name === c.name ? Object.assign({}, x, { token: '' }) : x; }));
            }, true);
          } }, '끄기') : null);
      }),
      t.shareToken ? h('button.btn.small', { onclick: function () { S.mutate([{ t: 'trips', id: t.id, set: { shareToken: '' } }]); U.toast('예전 공용 링크를 껐어요'); } }, '예전 공용 링크 끄기') : null,
      h('button.btn.wide', { onclick: function () { shareOut(t.title, null, shareText(t.title, U.range(t.start, t.end), lines, parties, t.splitRule || '인원')); } }, '📋 카톡용 정리 복사'));
  }

  /** 짐싸기 아래: 동행 가족이 챙기는 것 현황 */
  function assignSheet(l, parties) {
    var close = U.sheet(l.name, [
      h('small.lbl', '누가 챙기나요?'),
      h('div.chips', parties.map(function (p) { return { name: p.name, label: p.label }; }).concat([{ name: '미정', label: '미정' }]).map(function (p) {
        return h('button', { class: 'chip' + (partyOf(l) === p.name ? ' on' : ''), type: 'button', onclick: function () {
          S.mutate([{ t: 'lines', id: l.id, set: { party: p.name } }]); close();
        } }, p.label);
      })),
      l.kind === '장보기' ? h('button.btn.wide', { onclick: function () { close(); amountSheet(l, parties); } }, '💰 금액 입력') : null,
    ]);
  }

  function amountInput(v) {
    return h('input', { type: 'text', inputmode: 'numeric', placeholder: '금액 (원)', value: v ? Math.round(R.num(v, 0)).toLocaleString('ko-KR') : '',
      oninput: function (e) { var d = e.target.value.replace(/[^\d]/g, ''); e.target.value = d ? Number(d).toLocaleString('ko-KR') : ''; } });
  }
  function payerPicker(parties, value, onPick) {
    var box = h('div');
    function draw() { box.innerHTML = ''; box.appendChild(U.chips(parties.map(function (p) { return { value: p.name, label: p.label }; }), [value], function (v) { value = v; onPick(v); draw(); })); }
    draw();
    return box;
  }
  function amountSheet(l, parties) {
    var amt = amountInput(l.amount), payer = l.payer || '우리';
    var close = U.sheet(l.name + ' 금액', [U.field('금액', amt), U.field('누가 결제했나요?', payerPicker(parties, payer, function (v) { payer = v; }))], [
      l.kind === '정산' ? h('button.btn.danger', { onclick: function () { S.mutate([{ t: 'lines', id: l.id, set: { deleted: 'Y' } }]); close(); } }, '삭제') : null,
      h('button.btn.primary', { onclick: function () {
        var a = amt.value.replace(/[^\d]/g, '');
        S.mutate([{ t: 'lines', id: l.id, set: { amount: a, payer: a ? payer : '' } }]); close();
      } }, '저장')]);
  }
  function costSheet(t, parties) {
    var name = h('input', { type: 'text', placeholder: '예: 캠핑장 추가 이용료, 장작' });
    var amt = amountInput(''), payer = '우리';
    var close = U.sheet('비용 추가', [U.field('항목', name), U.field('금액', amt), U.field('누가 결제했나요?', payerPicker(parties, payer, function (v) { payer = v; }))], [
      h('button.btn.primary.wide', { onclick: function () {
        var n = name.value.trim(), a = amt.value.replace(/[^\d]/g, '');
        if (!n || !a) { U.toast('항목과 금액을 입력하세요'); return; }
        S.mutate([{ t: 'lines', id: S.uid('L'), set: lineSet(t.id, { kind: '정산', itemId: S.uid('T'), name: n, category: '정산', qty: 1, source: '정산', shared: 'Y', amount: a, payer: payer }) }]);
        close();
      } }, '추가')]);
  }

  function settleView(lines, parties, rule, onRule, onRow, onAdd) {
    var money = moneyLines(lines), res = R.settle(money, parties, rule);
    return h('div.card', h('h3', '💰 정산'),
      U.seg([{ value: '인원', label: '인원 비례' }, { value: '가족', label: '가족별 균등' }], rule, onRule || function () {}),
      h('small.hint', rule === '인원' ? parties.map(function (p) { return p.label + ' ' + p.people + '명'; }).join(' · ') : '가족 수(' + parties.length + ')로 똑같이 나눠요'),
      money.map(function (l) {
        var a = R.num(l.amount, 0);
        return h('div.mrow', { onclick: onRow ? function () { onRow(l); } : null },
          h('span', l.name), a ? h('span', won(a) + ' · ' + plabel(parties, l.payer) + ' 결제') : h('span.muted', '금액 입력 ›'));
      }),
      onAdd ? h('button.btn.small', { onclick: onAdd }, '+ 비용 추가 (이용료 등)') : null,
      res.total ? h('div.settle',
        h('div.kv', h('span', '총 비용'), h('b', won(res.total))),
        parties.map(function (p) { return h('div.kv', h('span', p.label), h('span', '낸 돈 ' + won(res.paid[p.name]) + ' · 부담 ' + won(res.share[p.name]))); }),
        res.transfers.length ? res.transfers.map(function (x) {
          return h('div.transfer', '➡️ ' + plabel(parties, x.from) + ' → ' + plabel(parties, x.to) + '  ', h('b', won(x.amount)));
        }) : h('p.muted', '주고받을 돈이 없어요')) : h('p.muted', '장보기·비용에 금액을 입력하면 자동으로 나눠요'));
  }
  function settleCard(t, lines, parties, rule) {
    return settleView(lines, parties, rule,
      function (v) { S.mutate([{ t: 'trips', id: t.id, set: { splitRule: v } }]); },
      function (l) { amountSheet(l, parties); },
      function () { costSheet(t, parties); });
  }

  /* ───────── 설정: 가족 로그인 ───────── */
  function pinSheet(isChange) {
    var fam = h('input', { type: 'text', value: D().meta.familyName || '', placeholder: '예: 종원네캠핑' });
    var cur0 = h('input', { type: 'password', inputmode: 'numeric', maxlength: '6', placeholder: '현재 PIN', 'data-nofocus': '' });
    var p1 = h('input', { type: 'password', inputmode: 'numeric', maxlength: '6', placeholder: '새 PIN 6자리', 'data-nofocus': '' });
    var p2 = h('input', { type: 'password', inputmode: 'numeric', maxlength: '6', placeholder: '한 번 더', 'data-nofocus': '' });
    var err = h('p.err');
    var close = U.sheet(isChange ? '가족 이름·PIN 변경' : '가족 로그인 설정', [
      U.field('가족 이름', fam, '로그인할 때 입력해요 (띄어쓰기·대소문자 무시)'),
      isChange ? U.field('현재 PIN', cur0) : null,
      U.field('새 PIN', p1), U.field('PIN 확인', p2),
      h('small.hint', isChange ? '바꾸면 다른 기기는 모두 새 PIN으로 다시 로그인해야 해요.' : '설정하면 기존 초대 링크는 더 이상 쓸 수 없고, 다른 기기는 이 이름·PIN으로 로그인해요.'),
      err,
    ], [h('button.btn.primary.wide', { onclick: function () {
      if (!fam.value.trim()) { err.textContent = '가족 이름을 입력하세요'; return; }
      if (!/^\d{6}$/.test(p1.value)) { err.textContent = 'PIN은 숫자 6자리예요'; return; }
      if (p1.value !== p2.value) { err.textContent = 'PIN이 서로 달라요'; return; }
      if (/^(\d)\1{5}$/.test(p1.value) || '0123456789'.indexOf(p1.value) >= 0 || '9876543210'.indexOf(p1.value) >= 0) { err.textContent = '너무 쉬운 PIN이에요 (같은 숫자·연속 숫자 제외)'; return; }
      err.textContent = '저장 중…';
      S.post({ op: 'setPin', family: fam.value.trim(), pin: p1.value, currentPin: cur0.value }).then(function (j) {
        S.setCfg({ k: j.k });
        D().meta.familyName = j.familyName; D().meta.pinSet = true;
        local.lastFamily = j.familyName; saveLocal();
        close(); U.toast('가족 로그인이 설정됐어요'); S.sync(true); rerender();
      }).catch(function (e) { err.textContent = e.message || '저장 실패 (인터넷 연결 확인)'; });
    } }, '저장')]);
  }

  function familyLoginCard(inviteLink) {
    var meta = D().meta, appUrl = location.origin + location.pathname;
    if (!meta.pinSet) return h('div.card', h('h3', '🔐 가족 로그인'),
      h('p.hint', '가족 이름과 6자리 PIN을 정하면, 가족이 새 휴대폰에서도 이 정보로 로그인할 수 있어요.'),
      h('button.btn.primary.wide', { onclick: function () { pinSheet(false); } }, '가족 이름·PIN 정하기'));
    return h('div.card', h('h3', '🔐 가족 로그인'),
      h('div.kv', h('span', '가족 이름'), h('b', meta.familyName)),
      h('button.btn.primary.wide', { onclick: function () {
        shareOut('우리 가족 캠핑 준비', appUrl, '🏕️ 우리 가족 캠핑 준비 앱\n가족 이름: ' + meta.familyName + '\nPIN은 따로 알려줄게요!');
      } }, '📤 가족에게 앱 알려주기'),
      h('small.hint', 'PIN은 메시지에 넣지 않아요. 직접 알려주세요.'),
      h('div.row2',
        h('button.btn', { onclick: function () { pinSheet(true); } }, 'PIN 변경'),
        h('button.btn', { onclick: function () {
          U.ask('이 기기 로그아웃', S.queue.length ? '⚠️ 아직 전송 안 된 변경 ' + S.queue.length + '건이 사라져요.' : '다시 쓰려면 가족 이름·PIN으로 로그인해요.', '로그아웃', function () { S.reset(); location.hash = '#/'; location.reload(); }, true);
        } }, '이 기기 로그아웃')));
  }

  /* ───────── 동행 가족 화면 (가족별 전용 링크, 로그인 없음) ───────── */
  var G = { token: null, data: null, err: '', timer: null, queue: [], sending: false, offline: false };
  function gKey(p) { return 'cp.' + p + '.' + G.token; }
  function gSave() {
    try { localStorage.setItem(gKey('g'), JSON.stringify(G.data)); localStorage.setItem(gKey('gq'), JSON.stringify(G.queue)); } catch (e) {}
  }
  function guestFam() {
    if (!G.data) return '';
    if (G.data.fam) return G.data.fam; // 가족별 전용 링크
    var f = '';
    try { f = localStorage.getItem(gKey('gf')) || ''; } catch (e) {}
    return R.parseCompanions(G.data.trip.companions).some(function (c) { return c.name === f; }) ? f : '';
  }
  function guestLoad(token) {
    var startSeq = G.seq || 0;
    return S.publicPost({ op: 'shareGet', s: token }).then(function (j) {
      if (G.token !== token) return;
      G.offline = false;
      // 요청 후에 체크·빼기 등 변경이 생겼으면 낡은 응답 → 버림 (전송 후 다시 불러옴)
      if ((G.seq || 0) !== startSeq || G.queue.length || G.sending) return;
      if (!j.ok) { G.err = j.error; if (j.code === 'share_invalid') G.data = null; }
      else { G.err = ''; G.data = j; G.queue.forEach(guestApply); gSave(); }
      if (cur.name === 'guest') rerender();
    }).catch(function () {
      if (G.token !== token) return;
      G.offline = true;
      if (cur.name === 'guest') rerender();
    });
  }
  /** 서버 응답 전에 화면에 먼저 반영 (오프라인이어도 체크 유지) */
  function guestApply(op) {
    if (!G.data) return;
    var fam = guestFam();
    var l = G.data.lines.filter(function (x) { return x.id === op.id; })[0];
    if (!l) {
      if (!op.set.name) return;
      G.data.lines.push({ id: op.id, kind: op.set.kind || '물건', name: op.set.name, qty: '1', party: fam, addedBy: fam, shared: 'Y', source: '동행',
        scope: op.set.scope === '우리만' ? '우리만' : '', amount: op.set.amount || '', payer: op.set.amount ? fam : '' });
      return;
    }
    if ('party' in op.set) l.party = op.set.party;
    if ('pack' in op.set) l.pack = op.set.pack ? fam + '|' + U.nowStr() : '';
    if ('amount' in op.set) { l.amount = op.set.amount; l.payer = op.set.amount ? fam : ''; }
    if ('deleted' in op.set) l.deleted = op.set.deleted ? 'Y' : '';
    if ('scope' in op.set) { l.scope = op.set.scope === '우리만' ? '우리만' : ''; if (l.scope) { l.amount = ''; l.payer = ''; } }
  }
  function guestSend(ops) {
    ops.forEach(function (op) { guestApply(op); G.queue.push(op); });
    G.seq = (G.seq || 0) + 1;
    gSave(); rerender(); guestFlush();
  }
  function guestFlush() {
    if (G.sending || !G.queue.length || !G.token) return;
    G.sending = true;
    var batch = G.queue.slice(), token = G.token;
    S.publicPost({ op: 'shareMutate', s: token, by: guestFam(), ops: batch }).then(function (j) {
      G.sending = false;
      if (G.token !== token) return;
      G.offline = false;
      G.queue.splice(0, batch.length); gSave();
      if (!j.ok) U.toast(j.error);
      else if (j.rejected) U.toast('이미 다른 가족이 정한 항목이 있어서 새로 불러왔어요');
      if (G.queue.length) return guestFlush(); // 전송 중 쌓인 변경 먼저
      guestLoad(token);
    }).catch(function () {
      G.sending = false; G.offline = true;
      if (cur.name === 'guest') rerender();
    });
  }
  window.addEventListener('online', function () { if (cur.name === 'guest') { guestFlush(); guestLoad(G.token); } });

  function vGuest(token) {
    cur.name = 'guest';
    if (G.token !== token) {
      var cached = null, q = [];
      try { cached = JSON.parse(localStorage.getItem('cp.g.' + token)); q = JSON.parse(localStorage.getItem('cp.gq.' + token)) || []; } catch (e) {}
      clearInterval(G.timer);
      G = { token: token, data: cached, err: '', timer: null, queue: q, sending: false, offline: false };
      guestLoad(token); guestFlush();
      G.timer = setInterval(function () {
        if (cur.name !== 'guest') { clearInterval(G.timer); return; }
        if (document.visibilityState === 'visible') { guestFlush(); guestLoad(G.token); }
      }, 15000);
    }
    if (!G.data) return h('div.page.narrow', h('div.hero', h('div.logo', '🤝'), h('p', G.err || (G.offline ? '인터넷에 연결되면 불러올게요' : '불러오는 중…'))));
    var d = G.data, comps = R.parseCompanions(d.trip.companions), fam = guestFam();
    var pill = h('span.pill.' + (G.queue.length ? (G.offline ? 'off' : 'busy') : 'ok'),
      G.queue.length ? (G.offline ? '오프라인 · 대기 ' + G.queue.length : '저장 중 ' + G.queue.length) : (G.offline ? '오프라인' : '✓ 저장됨'));
    var header = h('header.top', h('div.ttl', h('h1', d.trip.title), h('div.sub', [d.trip.place, U.range(d.trip.start, d.trip.end)].filter(Boolean).join(' · '))), pill);
    if (!fam) return h('div.page.narrow', header,
      h('div.hero', h('h1', '어느 가족이세요?'), h('p.muted', d.ourName + '와(과) 함께 챙길 짐을 정해요')),
      h('div.list', comps.map(function (c) {
        return h('button.whobtn', { onclick: function () { try { localStorage.setItem('cp.gf.' + token, c.name); } catch (e) {} rerender(); } }, h('span', famIcon(comps, c.name)), c.name);
      })));
    var parties = partiesOf(d.ourName, d.ourPeople, comps), myIcon = famIcon(comps, fam);
    var items = d.lines.filter(function (l) { return l.kind !== '정산' && l.deleted !== 'Y'; });
    var und = items.filter(function (l) { return l.party === '미정'; });
    var mine = items.filter(function (l) { return l.party === fam; });
    var done = mine.filter(function (l) { return l.pack; }).length;
    var addIn = h('input', { type: 'text', placeholder: '우리가 더 챙길 것 (예: 라면, 아이 장화)' });
    var kind = '물건', kindBox = h('div'), scope = '';
    try { scope = localStorage.getItem(gKey('gs')) || ''; } catch (e) {}
    function drawKind() {
      kindBox.innerHTML = '';
      kindBox.appendChild(U.seg(['물건', '장보기'], kind, function (v) { kind = v; drawKind(); }));
      if (d.fam) {
        kindBox.appendChild(U.seg([{ value: '', label: '🤝 모두와 공유' }, { value: '우리만', label: '🔒 우리만 보기' }], scope, function (v) {
          scope = v; try { localStorage.setItem(gKey('gs'), v); } catch (e) {} drawKind();
        }));
        kindBox.appendChild(h('small.hint', scope ? '우리 가족 체크리스트에만 있어요. ' + d.ourName + '·다른 가족에게는 안 보여요.' : '모든 가족이 볼 수 있어요. "' + fam + ' 담당"으로 표시돼요.'));
      }
    }
    drawKind();
    function newId() { return 'L-' + randToken().slice(0, 14); }
    function gAmount(l) {
      if (l.payer && l.payer !== fam) { U.toast('결제한 가족: ' + plabel(parties, l.payer)); return; }
      var amt = amountInput(l.amount);
      var close = U.sheet(l.name + ' 금액', [U.field('우리가 결제한 금액', amt)], [
        l.kind === '정산' && l.addedBy === fam ? h('button.btn.danger', { onclick: function () { close(); guestSend([{ t: 'lines', id: l.id, set: { deleted: 1 } }]); } }, '삭제') : null,
        h('button.btn.primary', { onclick: function () { close(); guestSend([{ t: 'lines', id: l.id, set: { amount: amt.value.replace(/[^\d]/g, '') } }]); } }, '저장')]);
    }
    return h('div.page', header,
      G.err ? h('p.err', G.err) : null,
      h('div.card.guesthead',
        h('div.kv', h('h2', myIcon + ' ' + fam + ' 체크리스트'), h('b', done + '/' + mine.length)),
        U.bar(done, mine.length),
        mine.length && done === mine.length ? h('p', '🎉 다 챙겼어요!') : null),
      mine.length ? mine.map(function (l) {
        return h('div.line' + (l.pack ? '.done' : ''), { onclick: function () { guestSend([{ t: 'lines', id: l.id, set: { pack: l.pack ? '' : 1 } }]); } },
          h('span.ck', l.pack ? '✓' : ''),
          h('div.txt', h('div.nm', l.name, R.num(l.qty, 1) > 1 ? h('span.qty', '×' + l.qty) : null),
            h('div.meta', [l.scope === '우리만' ? h('span.priv', '🔒 우리만') : l.addedBy === fam ? h('span', '🤝 공유') : null,
              l.kind === '장보기' ? h('span', '장보기') : null, l.note ? h('span', l.note) : null,
              l.addedBy !== fam && l.source !== '동행' ? h('span', d.ourName + ' 부탁') : null])),
          h('button.more', { 'aria-label': '메뉴', onclick: function (e) {
            e.stopPropagation();
            var close = U.sheet(l.name, h('div.menu',
              l.kind === '장보기' && l.scope !== '우리만' ? h('button', { onclick: function () { close(); gAmount(l); } }, '💰 금액 입력') : null,
              l.addedBy === fam && d.fam ? h('button', { onclick: function () { close(); guestSend([{ t: 'lines', id: l.id, set: { scope: l.scope === '우리만' ? '' : '우리만' } }]); } },
                l.scope === '우리만' ? '🤝 모두와 공유로 바꾸기' : '🔒 우리만 보기로 바꾸기') : null,
              l.addedBy === fam ? h('button.danger', { onclick: function () { close(); guestSend([{ t: 'lines', id: l.id, set: { deleted: 1 } }]); } }, '🗑️ 삭제')
                : h('button', { onclick: function () { close(); guestSend([{ t: 'lines', id: l.id, set: { party: '미정' } }]); } }, '↩️ 우리가 못 챙겨요 (미정으로)')));
          } }, '⋯'));
      }) : h('p.muted.center', '아래 "아직 배정 안 된 공용 준비물"에서 가져갈 것을 골라 주세요'),
      h('div.card', h('h3', '+ 우리가 더 챙길 것'), kindBox, h('div.addrow', addIn, h('button.btn', { onclick: function () {
        var n = addIn.value.trim(); if (!n) return;
        guestSend([{ t: 'lines', id: newId(), set: { kind: kind, name: n, qty: 1, scope: d.fam ? scope : '' } }]);
        U.toast(n + (d.fam && scope ? ' 추가 (🔒 우리만)' : ' 추가 (🤝 공유)'));
      } }, '추가'))),
      und.length ? h('section.grp', h('div.grp-head', h('b', '🤔 아직 배정 안 된 공용 준비물'), h('small', und.length + '개')),
        und.map(function (l) {
          return h('div.sline',
            h('div.txt', h('div.nm', l.name, R.num(l.qty, 1) > 1 ? h('span.qty', '×' + l.qty) : null), l.kind === '장보기' ? h('small', '장보기') : (l.note ? h('small', l.note) : null)),
            h('button.btn.small.primary', { onclick: function () { guestSend([{ t: 'lines', id: l.id, set: { party: fam } }]); } }, '우리가 가져갈게'));
        })) : null,
      parties.filter(function (p) { return p.name !== fam; }).map(function (p) {
        var theirs = items.filter(function (l) { return partyOf(l) === p.name && l.party !== '미정'; });
        if (!theirs.length) return null;
        return h('section.grp', h('div.grp-head' + p.cls, h('b', p.icon + ' ' + p.label + ' 담당'), h('small', theirs.filter(isDone).length + '/' + theirs.length + ' 챙김')),
          h('p.others', theirs.map(function (l) { return (isDone(l) ? '✓ ' : '') + l.name; }).join(' · ')));
      }),
      settleView(d.lines, parties, d.trip.splitRule || '인원', null, gAmount, function () {
        var name = h('input', { type: 'text', placeholder: '예: 장작, 캠핑장 이용료' }), amt = amountInput('');
        var close = U.sheet('우리가 낸 비용', [U.field('항목', name), U.field('금액', amt)], [h('button.btn.primary.wide', { onclick: function () {
          var n = name.value.trim(), a = amt.value.replace(/[^\d]/g, '');
          if (!n || !a) { U.toast('항목과 금액을 입력하세요'); return; }
          close(); guestSend([{ t: 'lines', id: newId(), set: { kind: '정산', name: n, amount: a } }]);
        } }, '추가')]);
      }),
      h('button.btn.wide', { onclick: function () {
        shareOut(d.trip.title, null, shareText(d.trip.title, U.range(d.trip.start, d.trip.end), d.lines, parties, d.trip.splitRule || '인원'));
      } }, '📋 카톡용 정리 복사'),
      h('p.ver', (d.fam ? '🔒 ' + fam + ' 전용 링크 · ' : '') + d.ourName + ' 공유 · 로그인 없이 이 캠핑에서 맡은 것만 보여요 · 체크는 바로 저장되고, 인터넷이 끊겨도 연결되면 자동 전송돼요'));
  }


  /* ───────── 시작 ───────── */
  route(false);
  if (S.connected()) { S.flush(); S.sync(); }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
  window.__app = { route: route, D: D };
})();
