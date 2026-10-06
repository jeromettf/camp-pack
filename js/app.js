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
  var STAGE_DONE_MSG = { todo: '할 일 끝!', pack: '짐싸기 완료!', load: '차에 다 실었어요!', back: '빠짐없이 챙겼어요!' };

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
  function me() { return S.cfg.meName || '나'; }
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

    if (!S.connected() || S.status.authError) { el = vConnect(); showNav = false; }
    else if (!D().version) { el = vLoading(); showNav = false; }
    else if (!S.cfg.me || !byId('members', S.cfg.me)) { el = vWhoAmI(); showNav = false; }
    else if (!p.length) { el = vHome(); navActive = '#/'; }
    else if (p[0] === 'new') { el = vWizard('new', null, r.q); showNav = false; }
    else if (p[0] === 'trip' && p[2] === 'edit') { el = vWizard('edit', p[1], r.q); showNav = false; }
    else if (p[0] === 'trip') { el = vTrip(p[1]); showNav = false; }
    else if (p[0] === 'review') { el = vReview(p[1]); showNav = false; }
    else if (p[0] === 'history') { el = vHistory(); navActive = '#/history'; }
    else if (p[0] === 'stats') { el = vStats(); navActive = '#/history'; }
    else if (p[0] === 'items') { el = vItems(); navActive = '#/items'; }
    else if (p[0] === 'item') { el = vItemEdit(p[1]); showNav = false; }
    else if (p[0] === 'places') { el = vPlaces(); navActive = '#/items'; }
    else if (p[0] === 'place') { el = vPlaceEdit(p[1]); showNav = false; }
    else if (p[0] === 'boxes') { el = vBoxes(); navActive = '#/items'; }
    else if (p[0] === 'settings') { el = vSettings(); navActive = '#/settings'; }
    else if (p[0] === 'log') { el = vLog(); navActive = '#/settings'; }
    else { el = empty('페이지를 찾을 수 없어요', h('a.btn', { href: '#/' }, '홈으로')); }

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
      if ((S.status.authError && cur.name !== 'connect') || cur.name === 'loading') rerender();
      return;
    }
    if (cur.live || cur.name === 'loading' || cur.name === 'whoami' || cur.name === 'connect') rerender();
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

  function vConnect() {
    cur.name = 'connect';
    var api = h('input', { type: 'url', placeholder: 'https://script.google.com/macros/s/…/exec', value: S.cfg.api || '' });
    var k = h('input', { type: 'text', placeholder: '가족 코드', value: S.cfg.k || '' });
    var err = h('p.err');
    return h('div.page.narrow',
      h('div.hero', h('div.logo', '🏕️'), h('h1', '우리 가족 캠핑 준비'),
        h('p', S.status.authError ? '가족 코드가 바뀌었어요. 새 초대 링크로 다시 열어주세요.' : '가족에게 받은 초대 링크를 열면 자동으로 연결돼요.')),
      h('details.card', h('summary', '직접 입력하기'),
        U.field('웹 앱 주소', api), U.field('가족 코드', k), err,
        h('button.btn.primary.wide', {
          onclick: function () {
            if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(api.value.trim())) { err.textContent = '주소는 …/exec 로 끝나야 해요'; return; }
            S.setCfg({ api: api.value.trim(), k: k.value.trim() });
            S.status.authError = false;
            S.sync(true).then(function () {
              if (S.status.authError) err.textContent = '가족 코드가 맞지 않아요';
              else if (!D().version) err.textContent = '연결 실패: ' + (S.status.error || '인터넷 연결을 확인하세요');
              rerender();
            });
            rerender();
          },
        }, '연결')));
  }

  function vLoading() {
    cur.name = 'loading';
    if (S.status.online && Date.now() - loadingAt > 5000) { loadingAt = Date.now(); S.sync(true); }
    return h('div.page.narrow', h('div.hero', h('div.logo.spin', '⛺'), h('p', S.status.online ? '불러오는 중…' : '인터넷에 연결되면 불러올게요'),
      S.status.error ? h('p.err', S.status.error) : null));
  }

  function vWhoAmI() {
    cur.name = 'whoami';
    var people = members().filter(function (m) { return m.type !== '반려견'; });
    var name = h('input', { type: 'text', placeholder: '예: 아빠, 엄마, 지우' });
    var type = '어른';
    var typeSeg = h('div');
    function drawSeg() { typeSeg.innerHTML = ''; typeSeg.appendChild(U.seg(['어른', '아이'], type, function (v) { type = v; drawSeg(); })); }
    drawSeg();
    return h('div.page.narrow',
      h('div.hero', h('div.logo', '👋'), h('h1', '누구세요?'), h('p', '체크할 때 누가 챙겼는지 표시돼요. 이 기기에만 저장됩니다.')),
      people.length ? h('div.list', people.map(function (m) {
        return h('button.whobtn', { onclick: function () { S.setCfg({ me: m.id, meName: m.name }); go('#/'); rerender(); } },
          h('span', TYPE_ICON[m.type] || '🧑'), m.name);
      })) : null,
      h('div.card', h('h3', people.length ? '목록에 없어요 — 새로 등록' : '처음이시네요! 이름을 등록하세요'),
        name, typeSeg,
        h('button.btn.primary.wide', {
          onclick: function () {
            var n = name.value.trim(); if (!n) { name.focus(); return; }
            var id = S.uid('M');
            S.setCfg({ me: id, meName: n });
            S.mutate([{ t: 'members', id: id, set: { name: n, type: type, active: 'Y' } }]);
            go('#/'); rerender();
          },
        }, '시작하기')));
  }

  /* ───────── 홈 ───────── */
  function vHome() {
    cur.name = 'home'; cur.live = true;
    var trips = D().trips.filter(function (t) { return t.status !== '보관'; });
    var upcoming = trips.filter(function (t) { var p = phase(t); return p === '예정' || p === '진행중'; })
      .sort(function (a, b) { return a.start < b.start ? -1 : 1; });
    var td = U.today();
    var reviewDue = trips.filter(function (t) { return phase(t) === '완료' && !R.yes(t.reviewed) && R.daysBetween(t.end, td) <= 30; });
    var past = trips.filter(function (t) { return phase(t) === '완료'; }).sort(function (a, b) { return a.start < b.start ? 1 : -1; });
    var lint = lintProblems();
    var unused = R.unusedSuggestions(D().items, D().trips, D().reviews, R.num(setting('안씀보관기준'), 3));
    var restock = D().items.filter(function (i) { return R.active(i) && R.yes(i.consumable) && (i.stock === '부족' || i.stock === '없음'); });

    return h('div.page',
      top('캠핑 준비', { sub: '안녕하세요, ' + me() + '님' }),
      lint.length ? h('a.alert.warn', { href: '#/items' }, '⚠️ 준비물 규칙 오류 ' + lint.length + '건 — 목록에서 빠질 수 있어요') : null,
      restock.length ? h('a.alert', { href: '#/items' }, '🛒 구매 필요 소모품 ' + restock.length + '개: ' + restock.slice(0, 3).map(function (i) { return i.name; }).join(', ') + (restock.length > 3 ? ' 외' : '')) : null,
      unused.length ? h('a.alert', { href: '#/stats' }, '💤 최근 ' + setting('안씀보관기준') + '번 연속 안 쓴 장비 ' + unused.length + '개 — 정리할까요?') : null,
      reviewDue.map(function (t) {
        return h('a.card.review-due', { href: '#/review/' + t.id }, h('b', '📝 ' + t.title + ' 30초 회고'), h('small', '안 쓴 것·부족했던 것을 남기면 다음 준비가 더 정확해져요'));
      }),
      upcoming.length ? upcoming.map(tripCard) : h('div.card.center', h('p', '예정된 캠핑이 없어요')),
      h('div.row2',
        h('a.btn.primary.big', { href: '#/new' }, '+ 새 캠핑'),
        past.length ? h('button.btn.big', { onclick: function () { pickPast(past); } }, '↻ 지난번처럼') : null),
      past.length ? h('section',
        h('div.sec-head', h('h2', '최근 캠핑'), h('a', { href: '#/history' }, '전체 보기')),
        past.slice(0, 3).map(function (t) { return pastRow(t); })) : null);
  }

  function tripCard(t) {
    var lines = S.linesOf(t.id), pl = placeOf(t);
    return h('a.card.trip', { href: '#/trip/' + t.id },
      h('div.trip-head', h('div', h('b', t.title), h('small', [pl ? pl.name : '장소 미정', U.range(t.start, t.end)].join(' · '))),
        h('span.badge' + (phase(t) === '진행중' ? '.live' : ''), dday(t))),
      h('div.stages', R.STAGES.map(function (s) {
        var p = R.progress(lines, s.key);
        return h('div.st', h('small', s.label + ' ' + p.done + '/' + p.total), U.bar(p.done, p.total));
      })));
  }
  function pastRow(t) {
    var pl = placeOf(t);
    return h('a.prow', { href: '#/trip/' + t.id },
      h('div', h('b', t.title), h('small', (pl ? pl.name + ' · ' : '') + U.range(t.start, t.end))),
      h('span', R.yes(t.reviewed) ? '★'.repeat(R.num(t.rating, 0)) || '✓' : h('span.muted', '회고 전')));
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
      title: '', start: '', end: '', placeId: '', guestAdults: '0', guestKids: '0', tagsAdd: '', tagsRemove: '', weather: '',
      members: members().map(function (m) { return m.id; }).join(','),
    };
    if (src) ['title', 'start', 'end', 'placeId', 'members', 'guestAdults', 'guestKids', 'tagsAdd', 'tagsRemove', 'weather', 'memo']
      .forEach(function (f) { t[f] = src[f] || ''; });
    W = { key: key, mode: mode, tripId: tripId, fromId: mode === 'new' && src ? src.id : null, step: 1, t: t,
      titleTouched: mode === 'edit', removed: {}, qty: {}, open: {}, forced: {}, extras: [], sel: null, weatherState: '' };
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
      W.step = 3;
      if (pendingWeather && pendingWeather.tripId === tripId) W.t.weather = JSON.stringify(pendingWeather.w);
      pendingWeather = null;
    }
    if (mode === 'edit' && q.get('step')) W.step = R.num(q.get('step'), 1);
  }

  function vWizard(mode, tripId, q) {
    cur.name = 'wizard';
    if (mode === 'edit' && !byId('trips', tripId)) return empty('캠핑을 찾을 수 없어요');
    initWizard(mode, tripId, q);
    var steps = ['날짜·장소', '인원', '조건', mode === 'edit' ? '변경 확인' : '목록 확인'];
    var body = [wizStep1, wizStep2, wizStep3, mode === 'edit' ? wizDiff : wizPreview][W.step - 1]();
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
        h('a.small', { href: '#/settings' }, '구성원 추가·관리 ›')),
      h('div.card', h('h3', '함께 가는 손님'),
        h('div.kv', h('span', '어른'), U.stepper(R.num(t.guestAdults, 0), function (v) { t.guestAdults = String(v); rerender(); })),
        h('div.kv', h('span', '아이'), U.stepper(R.num(t.guestKids, 0), function (v) { t.guestKids = String(v); rerender(); })),
        h('small.hint', '손님 수는 의자·식기처럼 "전체인원당" 준비물에만 반영돼요')),
      h('p.summary', '가족 ' + c.family + '명' + (c.pets ? ' + 반려견 ' + c.pets : '') + (c.guestAdults + c.guestKids ? ' + 손님 ' + (c.guestAdults + c.guestKids) + '명' : '') + ' · ' + (c.nights || '당일') + (c.nights ? '박' : '')),
      wizNav('다음', function () { W.step = 3; rerender(); }, ids.length > 0));
  }

  function wizStep3() {
    var t = W.t, pl = byId('places', t.placeId);
    var c = R.deriveContext(t, D().members, pl);
    var wx = R.parseWeather(t.weather);
    if (!wx && W.weatherState !== 'loading' && W.weatherState !== t.start + (pl ? pl.id : '')) {
      W.weatherState = 'loading';
      forecast(pl, t.start, t.end).then(function (w) {
        W.weatherState = t.start + (pl ? pl.id : '');
        if (!w.unavailable) t.weather = JSON.stringify(w);
        else W.weatherMsg = w.unavailable;
        if (cur.name === 'wizard' && W.step === 3) rerender();
      });
    }
    var msg = { nocoord: '장소에 지역(위치)을 등록하면 날씨를 자동 반영해요', far: '예보는 출발 16일 전부터 나와요. 가까워지면 다시 확인해 알려드릴게요', past: '', offline: '날씨를 불러오지 못했어요 (오프라인)', error: '날씨 정보를 불러오지 못했어요' };
    function toggle(v, on) {
      var add = R.list(t.tagsAdd), rem = R.list(t.tagsRemove), isAuto = c.autoTags.indexOf(v) >= 0;
      if (on) { rem = rem.filter(function (x) { return x !== v; }); if (!isAuto && add.indexOf(v) < 0) add.push(v); }
      else { add = add.filter(function (x) { return x !== v; }); if (isAuto && rem.indexOf(v) < 0) rem.push(v); }
      t.tagsAdd = add.join(', '); t.tagsRemove = rem.join(', '); rerender();
    }
    return h('div',
      h('div.card.weather',
        h('h3', '🌤️ 날씨'),
        wx ? [h('p', wx.text), wx.tags.length ? h('p', '→ ', h('b', wx.tags.join(', ')), ' 조건 자동 적용') : h('p.muted', '특별히 준비할 날씨 조건 없음'),
          h('button.btn.small', { onclick: function () { t.weather = ''; W.weatherState = ''; rerender(); } }, '다시 불러오기')]
          : h('p.muted', W.weatherState === 'loading' ? '불러오는 중…' : (msg[W.weatherMsg] || ''))),
      h('div.card',
        h('h3', '이번 캠핑 조건'),
        h('small.hint', '테두리 있는 칩 = 자동 판단. 탭해서 켜고 끌 수 있어요.'),
        tagGroups().map(function (g) {
          return h('div.tg', h('small.lbl', g.group), U.chips(g.tags, c.tags, toggle, { auto: c.autoTags }));
        })),
      wizNav('다음', function () { W.step = 4; rerender(); }));
  }

  function compute() {
    var t = W.t;
    return R.buildLines({ trip: t, items: D().items, boxes: boxes(), members: D().members, place: byId('places', t.placeId),
      trips: D().trips.filter(function (x) { return x.id !== W.tripId; }), reviews: D().reviews });
  }

  function wizPreview() {
    var res = compute();
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
      wizNav('캠핑 만들기', function () { createTrip(res, forced); }));
  }

  function lineSet(tripId, l) {
    return { tripId: tripId, kind: l.kind, itemId: l.itemId || '', name: l.name, category: l.category || '', box: l.box || '',
      qty: String(l.qty || 1), owner: l.owner || '', leave: l.leave || '', warn: l.warn || '', note: l.note || '', source: l.source || '수동' };
  }

  function createTrip(res, forced) {
    var id = S.uid('T'), ops = [], ctx = res.ctx, now = U.nowStr();
    ops.push({ t: 'trips', id: id, set: Object.assign({}, W.t, { tags: ctx.tags.join(', '), status: '', createdBy: me(), createdAt: now }) });
    var final = res.lines.filter(function (l) { return l.kind !== '수납함' && !W.removed[l.itemId]; }).map(function (l) {
      return Object.assign({}, l, { qty: W.qty[l.itemId] != null ? W.qty[l.itemId] : l.qty });
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
    R.boxLinesFor(final, boxes()).forEach(function (b) { final.push(b); });
    final.forEach(function (l) { ops.push({ t: 'lines', id: S.uid('L'), set: lineSet(id, l) }); });
    S.mutate(ops);
    W = null;
    U.toast('체크리스트를 만들었어요');
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
    ops.push({ t: 'trips', id: tripId, set: Object.assign({}, W.t, { tags: res.ctx.tags.join(', ') }) });
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
    // 수납함 줄 다시 계산
    var need = R.boxLinesFor(live.filter(function (l) { return l.kind === '물건'; }), boxes());
    var needKeys = {}; need.forEach(function (b) { needKeys[R.lineKey(b)] = b; });
    var haveKeys = {};
    existing.filter(function (l) { return l.kind === '수납함'; }).forEach(function (b) {
      var k = R.lineKey(b);
      if (needKeys[k]) { haveKeys[k] = 1; if (b.deleted === 'Y') ops.push({ t: 'lines', id: b.id, set: { deleted: '' } }); }
      else if (b.deleted !== 'Y') ops.push({ t: 'lines', id: b.id, set: { deleted: 'Y' } });
    });
    need.forEach(function (b) { if (!haveKeys[R.lineKey(b)]) ops.push({ t: 'lines', id: S.uid('L'), set: lineSet(tripId, b) }); });
    local.dismiss[tripId] = (local.dismiss[tripId] || []).concat(dismissed); saveLocal();
    S.mutate(ops);
    W = null;
    U.toast('반영했어요');
    go('#/trip/' + tripId);
  }

  /* ───────── 체크리스트 ───────── */
  function vTrip(id) {
    var t = byId('trips', id);
    if (!t) return empty('캠핑을 찾을 수 없어요', h('a.btn', { href: '#/' }, '홈으로'));
    cur.name = 'trip'; cur.live = true;
    var lines = S.linesOf(id);
    if (!lines.length && !S.extra[id]) {
      S.ensureLines(id).catch(function () {});
      return h('div.page', top(t.title, { back: '#/' }), empty('체크리스트를 불러오는 중… (오프라인이면 연결 후 표시돼요)'));
    }
    var ph = phase(t), pl = placeOf(t);
    var tab = local.tab[id] || (ph === '진행중' ? 'back' : 'pack');
    var field = R.stageField(tab);
    var filter = local.filter || 'all';
    var shown = R.stageLines(lines, tab);
    var prog = R.progress(lines, tab);
    if (filter === 'mine') shown = shown.filter(function (l) { return l.owner === me(); });
    if (filter === 'left') shown = shown.filter(function (l) { return !l[field]; });

    return h('div.page.trip-page',
      top(t.title, {
        back: '#/', sub: [pl ? pl.name : '', U.range(t.start, t.end), dday(t)].filter(Boolean).join(' · '),
        right: h('button.icon', { 'aria-label': '메뉴', onclick: function () { tripMenu(t); } }, '⋯'),
      }),
      tripBanners(t, lines),
      h('nav.tabs', R.STAGES.map(function (s) {
        var p = R.progress(lines, s.key);
        return h('button', { class: s.key === tab ? 'on' : '', onclick: function () { local.tab[id] = s.key; saveLocal(); rerender(); } },
          h('span', s.label), h('small', p.done + '/' + p.total));
      })),
      U.bar(prog.done, prog.total),
      h('div.toolbar',
        U.seg([{ value: 'all', label: '전체' }, { value: 'left', label: '남은 것' }, { value: 'mine', label: '내 담당' }], filter, function (v) { local.filter = v; saveLocal(); rerender(); }),
        tab === 'pack' ? U.seg([{ value: 'box', label: '수납함별' }, { value: 'cat', label: '종류별' }], local.group || 'box', function (v) { local.group = v; saveLocal(); rerender(); }) : null),
      prog.total && prog.done === prog.total ? h('div.alert.good', '🎉 ' + STAGE_DONE_MSG[tab]) : null,
      tab === 'todo' ? h('p.hint', '할 일과 장보기 목록이에요. 장보기는 아래 버튼으로 여러 줄을 한 번에 붙여넣을 수 있어요.') : null,
      tab === 'load' ? h('p.hint', '수납함 단위로 실어요. 박스에 안 들어가는 큰 짐은 따로 표시돼요.') : null,
      tab === 'back' ? h('p.hint', '철수할 때 수납함과 두고 오기 쉬운 물건만 확인해요.') : null,
      groupsFor(tab, shown, lines).map(function (g) { return group(g, field, lines); }),
      !shown.length ? empty(filter === 'all' ? '항목이 없어요' : '조건에 맞는 항목이 없어요') : null,
      h('div.bottombar',
        h('button.btn', { onclick: function () { quickAdd(t, tab); } }, '+ 추가'),
        tab === 'todo' ? h('button.btn', { onclick: function () { pasteGroceries(t); } }, '🛒 장보기 붙여넣기') : null,
        ph === '진행중' || ph === '완료' ? h('button.btn.warn', { onclick: function () { forgotSheet(t); } }, '😱 깜빡했어요') : null));
  }

  function groupsFor(tab, shown, lines) {
    var out = [];
    function push(name, arr) { if (arr.length) out.push({ name: name, lines: arr }); }
    if (tab === 'todo') {
      push('할 일', shown.filter(function (l) { return l.kind === '할일'; }));
      push('장보기', shown.filter(function (l) { return l.kind === '장보기'; }));
    } else if (tab === 'pack') {
      var by = {}, useBox = (local.group || 'box') === 'box';
      shown.forEach(function (l) { var k = useBox ? (l.box || '개별 짐 (큰 짐)') : (l.category || '기타'); (by[k] = by[k] || []).push(l); });
      var order = useBox ? boxes().map(function (b) { return b.name; }) : categories();
      sortByOrder(Object.keys(by), order).forEach(function (k) { push(k, by[k]); });
    } else {
      push('수납함', shown.filter(function (l) { return l.kind === '수납함'; }).map(function (b) {
        var n = lines.filter(function (l) { return l.kind === '물건' && l.box === b.name && l.deleted !== 'Y'; });
        return Object.assign({ _count: n.length, _packed: n.filter(function (l) { return l.pack; }).length }, b);
      }));
      push('개별 짐', shown.filter(function (l) { return l.kind === '물건' && !l.box; }));
      if (tab === 'back') push('두고 오기 쉬운 물건', shown.filter(function (l) { return l.kind === '물건' && l.box && R.yes(l.leave); }));
    }
    return out;
  }

  function group(g, field, all) {
    var done = g.lines.filter(function (l) { return l[field]; }).length;
    var allDone = done === g.lines.length;
    return h('section.grp',
      h('div.grp-head', h('b', g.name), h('small', done + '/' + g.lines.length),
        h('button.btn.small', {
          onclick: function () {
            var targets = g.lines.filter(function (l) { return allDone ? l[field] : !l[field]; });
            var val = allDone ? '' : me() + '|' + U.nowStr();
            var prev = targets.map(function (l) { return { t: 'lines', id: l.id, set: (function () { var o = {}; o[field] = l[field] || ''; return o; })() }; });
            S.mutate(targets.map(function (l) { var o = {}; o[field] = val; return { t: 'lines', id: l.id, set: o }; }));
            U.toast(g.name + ' ' + targets.length + '개 ' + (allDone ? '해제' : '체크'), function () { S.mutate(prev); });
          },
        }, allDone ? '모두 해제' : '모두 ✓')),
      g.lines.map(function (l) { return lineRow(l, field); }));
  }

  function lineRow(l, field) {
    var on = !!l[field];
    var meta = [];
    if (l.owner) meta.push(h('span.owner', l.owner));
    if (l.kind === '수납함' && l._count != null) meta.push(h('span', '안에 ' + l._count + '개' + (l._packed < l._count ? ' (짐싸기 ' + l._packed + '/' + l._count + ')' : '')));
    if (l.note) meta.push(h('span', l.note));
    if (on) meta.push(h('span.by', '✓ ' + checkedBy(l[field])));
    return h('div.line' + (on ? '.done' : '') + (l.warn === 'Y' ? '.warnline' : ''), {
      onclick: function () {
        var o = {}; o[field] = on ? '' : me() + '|' + U.nowStr();
        S.mutate([{ t: 'lines', id: l.id, set: o }]);
        if (on) U.toast(l.name + ' 체크 해제', function () { var b = {}; b[field] = l[field]; S.mutate([{ t: 'lines', id: l.id, set: b }]); });
        if (navigator.vibrate) navigator.vibrate(10);
      },
    },
      h('span.ck', { 'aria-hidden': 'true' }, on ? '✓' : ''),
      h('div.txt', h('div.nm', (l.warn === 'Y' ? '⚠️ ' : '') + (l.kind === '수납함' ? '📦 ' : '') + l.name, R.num(l.qty, 1) > 1 ? h('span.qty', '×' + l.qty) : null),
        meta.length ? h('div.meta', meta) : null),
      h('button.more', { 'aria-label': '편집', onclick: function (e) { e.stopPropagation(); editLine(l); } }, '⋯'));
  }

  function tripBanners(t, lines) {
    var out = [], ph = phase(t);
    if (ph === '완료' || ph === '보관') {
      if (ph === '완료' && !R.yes(t.reviewed)) out.push(h('a.alert', { href: '#/review/' + t.id }, '📝 30초 회고 남기기 — 다음 캠핑이 더 정확해져요'));
      return out;
    }
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
    // 창고·조건 변경 감지
    var res = R.buildLines({ trip: t, items: D().items, boxes: boxes(), members: D().members, place: pl,
      trips: D().trips.filter(function (x) { return x.id !== t.id; }), reviews: D().reviews });
    var d = R.diffLines(lines, res.lines), dis = local.dismiss[t.id] || [];
    var n = d.add.filter(function (l) { return l.kind !== '수납함' && dis.indexOf('a:' + R.lineKey(l)) < 0; }).length +
      d.qty.filter(function (x) { return dis.indexOf('q:' + R.lineKey(x.line)) < 0; }).length +
      d.remove.filter(function (l) { return l.kind !== '수납함' && dis.indexOf('r:' + R.lineKey(l)) < 0; }).length;
    if (n) out.push(h('a.alert', { href: '#/trip/' + t.id + '/edit?step=4', onclick: function () { W = null; } }, '🔄 준비물 창고가 바뀌어 반영할 항목이 ' + n + '건 있어요'));
    return out;
  }

  function tripMenu(t) {
    var close = U.sheet(t.title, h('div.menu',
      h('button', { onclick: function () { close(); W = null; go('#/trip/' + t.id + '/edit'); } }, '✏️ 조건 수정 (날짜·인원·장소·날씨)'),
      h('button', { onclick: function () { close(); pasteGroceries(t); } }, '🛒 장보기 붙여넣기'),
      h('button', { onclick: function () { close(); go('#/review/' + t.id); } }, '📝 회고하기'),
      h('button', { onclick: function () { close(); editTrip(t); } }, '🏷️ 이름·메모 수정'),
      h('button', { onclick: function () { close(); W = null; go('#/new?from=' + t.id); } }, '↻ 이 캠핑처럼 새 캠핑 만들기'),
      h('button', { onclick: function () { local.wake = local.wake === false; saveLocal(); wake(local.wake !== false); close(); U.toast(local.wake !== false ? '체크리스트 화면이 꺼지지 않아요' : '화면 켜두기 해제'); } },
        (local.wake !== false ? '🔆 화면 켜두기: 켜짐' : '🔅 화면 켜두기: 꺼짐')),
      t.status === '보관'
        ? h('button', { onclick: function () { close(); S.mutate([{ t: 'trips', id: t.id, set: { status: '' } }]); U.toast('복원했어요'); } }, '♻️ 보관 해제')
        : h('button.danger', { onclick: function () { close(); U.ask('캠핑 보관', '홈과 기록에서 숨겨요. 기록 > 보관함에서 복원할 수 있어요.', '보관', function () { S.mutate([{ t: 'trips', id: t.id, set: { status: '보관' } }]); go('#/'); }, true); } }, '🗄️ 보관하기 (삭제 대신)'),
));
  }

  function editTrip(t) {
    var title = h('input', { type: 'text', value: t.title });
    var memo = h('textarea', { rows: 3, placeholder: '메모' }, t.memo || '');
    var close = U.sheet('이름·메모', [U.field('이름', title), U.field('메모', memo)], [
      h('button.btn.primary.wide', { onclick: function () { S.mutate([{ t: 'trips', id: t.id, set: { title: title.value.trim() || t.title, memo: memo.value } }]); close(); } }, '저장')]);
  }

  function editLine(l) {
    var qty = R.num(l.qty, 1), owner = l.owner || '';
    var name = h('input', { type: 'text', value: l.name, 'data-nofocus': '' });
    var note = h('input', { type: 'text', value: l.note || '', placeholder: '메모', 'data-nofocus': '' });
    var qBox = h('div'), oBox = h('div');
    function draw() {
      qBox.innerHTML = ''; qBox.appendChild(U.stepper(qty, function (v) { qty = v; draw(); }, 1));
      oBox.innerHTML = ''; oBox.appendChild(U.chips(members().filter(function (m) { return m.type !== '반려견'; }).map(function (m) { return m.name; }), [owner], function (v, on) { owner = on ? v : ''; draw(); }));
    }
    draw();
    var inside = l.kind === '수납함' ? S.linesOf(l.tripId).filter(function (x) { return x.kind === '물건' && x.box === l.name && x.deleted !== 'Y'; }) : [];
    var close = U.sheet(l.name, [
      U.field('이름 (이번 캠핑만)', name),
      l.kind !== '수납함' ? U.field('수량', qBox) : null,
      U.field('담당', oBox),
      U.field('메모', note),
      inside.length ? h('div.inside', h('small.lbl', '이 수납함에 든 것'), h('p', inside.map(function (x) { return (x.pack ? '✓ ' : '· ') + x.name; }).join('  '))) : null,
      l.itemId && byId('items', l.itemId) ? h('a.small', { href: '#/item/' + l.itemId, onclick: function () { close(); } }, '창고에서 이 준비물 규칙 편집 ›') : null,
    ], [
      h('button.btn.danger', { onclick: function () {
        close(); S.mutate([{ t: 'lines', id: l.id, set: { deleted: 'Y' } }]);
        U.toast(l.name + ' 뺐어요', function () { S.mutate([{ t: 'lines', id: l.id, set: { deleted: '' } }]); });
      } }, '이번 캠핑에서 빼기'),
      h('button.btn.primary', { onclick: function () {
        S.mutate([{ t: 'lines', id: l.id, set: { name: name.value.trim() || l.name, qty: String(qty), owner: owner, note: note.value } }]); close();
      } }, '저장')]);
  }

  function quickAdd(t, tab) {
    var kind = tab === 'todo' ? '할일' : '물건';
    var name = h('input', { type: 'text', placeholder: '이름 (창고에서 검색)' });
    var save = false, picked = null, category = '차량·기타', box = '';
    var kindBox = h('div'), opt = h('div');
    function draw() {
      kindBox.innerHTML = '';
      if (tab === 'todo') kindBox.appendChild(U.seg(['할일', '장보기'], kind, function (v) { kind = v; draw(); }));
      opt.innerHTML = '';
      if (!picked && kind !== '장보기') {
        opt.appendChild(h('label.inline', h('input', { type: 'checkbox', checked: save, onchange: function (e) { save = e.target.checked; draw(); } }), ' 준비물 창고에도 저장 (다음 캠핑에도 포함)'));
        if (save) {
          opt.appendChild(U.field('카테고리', selectEl(categories(), category, function (v) { category = v; })));
          if (kind === '물건') opt.appendChild(U.field('수납함', selectEl([''].concat(boxes().map(function (b) { return b.name; })), box, function (v) { box = v; }, { '': '개별 (큰 짐)' })));
        }
      } else if (picked) opt.appendChild(h('small.hint', '창고 항목: ' + picked.name + (picked.box ? ' · ' + picked.box : '')));
    }
    var ac = U.autocomplete(name, function (q) { return itemOptions(q); }, function (o) { picked = o.item; name.value = o.item.name; kind = o.item.kind === '할일' ? '할일' : '물건'; draw(); });
    name.addEventListener('input', function () { if (picked && name.value !== picked.name) { picked = null; draw(); } });
    draw();
    var close = U.sheet('추가', [kindBox, name, ac, opt], [h('button.btn.primary.wide', { onclick: function () {
      var n = name.value.trim(); if (!n) { name.focus(); return; }
      var ops = [], itemId = picked ? picked.id : '';
      if (!picked && save && kind !== '장보기') {
        itemId = S.uid('I');
        ops.push({ t: 'items', id: itemId, set: { kind: kind, name: n, category: category, box: kind === '물건' ? box : '', rule: '고정', base: '1', active: 'Y' } });
      }
      if (picked && !R.active(picked)) ops.push({ t: 'items', id: picked.id, set: { active: 'Y' } });
      var l = { kind: kind, itemId: itemId || S.uid('T'), name: n, category: kind === '장보기' ? '장보기' : picked ? picked.category : category,
        box: kind === '물건' ? (picked ? picked.box : box) : '', qty: picked ? R.num(picked.base, 1) : 1, leave: picked && R.yes(picked.leave) ? 'Y' : '', source: '수동' };
      ops.push({ t: 'lines', id: S.uid('L'), set: lineSet(t.id, l) });
      var lines = S.linesOf(t.id);
      if (l.kind === '물건' && l.box && !lines.some(function (x) { return x.kind === '수납함' && x.name === l.box && x.deleted !== 'Y'; }))
        R.boxLinesFor([l], boxes()).forEach(function (b) { ops.push({ t: 'lines', id: S.uid('L'), set: lineSet(t.id, b) }); });
      S.mutate(ops); close(); U.toast(n + ' 추가');
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
        return { t: 'lines', id: S.uid('L'), set: lineSet(t.id, { kind: '장보기', itemId: S.uid('T'), name: n, category: '장보기', qty: 1, source: '장보기' }) };
      }));
      local.tab[t.id] = 'todo'; saveLocal();
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
  function vReview(id) {
    var t = byId('trips', id);
    if (!t) return empty('캠핑을 찾을 수 없어요');
    cur.name = 'review';
    var lines = S.linesOf(id);
    if (!lines.length) { S.ensureLines(id).then(rerender).catch(function () {}); return h('div.page', top('회고', { back: true }), empty('불러오는 중…')); }
    if (!RV || RV.tripId !== id) {
      var prev = D().reviews.filter(function (r) { return r.tripId === id && r.result; });
      RV = { tripId: id, unused: {}, short: {}, stock: {}, rating: R.num(t.rating, 0), memo: t.memo || '' };
      prev.forEach(function (r) { if (r.result === '안씀') RV.unused[r.itemId] = 1; if (r.result === '부족') RV.short[r.itemId] = R.num(r.qty, 1); });
    }
    var things = lines.filter(function (l) { return l.kind === '물건' && l.deleted !== 'Y' && byId('items', l.itemId); });
    var byCat = {};
    things.forEach(function (l) { (byCat[l.category || '기타'] = byCat[l.category || '기타'] || []).push(l); });
    var cats = sortByOrder(Object.keys(byCat), categories());
    var consum = things.map(function (l) { return byId('items', l.itemId); }).filter(function (i) { return R.yes(i.consumable); });
    var forgot = D().reviews.filter(function (r) { return r.tripId === id && r.result === '깜빡함'; });

    function catChips(map, single) {
      return cats.map(function (c) {
        return h('div.tg', h('small.lbl', c), U.chips(byCat[c].map(function (l) { return { value: l.itemId, label: l.name }; }),
          Object.keys(map), function (v, on) { if (on) map[v] = 1; else delete map[v]; rerender(); }));
      });
    }
    return h('div.page',
      top('30초 회고', { back: '#/trip/' + id, sub: t.title + ' · ' + U.range(t.start, t.end) }),
      h('details.card', { open: true }, h('summary', h('b', '1. 이번에 안 쓴 것'), ' ', h('small', Object.keys(RV.unused).length + '개')),
        h('small.hint', '3번 연속 안 쓰면 정리를 제안해요'), catChips(RV.unused)),
      h('details.card', { open: Object.keys(RV.short).length > 0 }, h('summary', h('b', '2. 부족했던 것'), ' ', h('small', Object.keys(RV.short).length + '개')),
        h('small.hint', '다음 캠핑에서 수량을 늘려 드려요'), catChips(RV.short)),
      consum.length ? h('details.card', h('summary', h('b', '3. 소모품 남은 양')),
        consum.map(function (i) {
          var v = RV.stock[i.id] || i.stock || '충분';
          return h('div.kv', h('span', i.name), U.seg(['충분', '부족', '없음'], v, function (x) { RV.stock[i.id] = x; rerender(); }));
        })) : null,
      h('div.card', h('b', '4. 깜빡한 것'),
        forgot.length ? h('p', forgot.map(function (r) { return '⚠️ ' + r.name; }).join('  ')) : h('p.muted', '없음'),
        h('button.btn.small', { onclick: function () { forgotSheet(t); } }, '+ 깜빡한 것 추가')),
      h('div.card', h('b', '별점'),
        h('div.stars', [1, 2, 3, 4, 5].map(function (n) { return h('button', { class: n <= RV.rating ? 'on' : '', onclick: function () { RV.rating = n; rerender(); } }, '★'); })),
        h('textarea', { rows: 3, placeholder: '메모 (좋았던 점, 다음엔 이렇게)', oninput: function (e) { RV.memo = e.target.value; } }, RV.memo)),
      h('button.btn.primary.wide.big', { onclick: function () { saveReview(t, things); } }, '회고 저장'));
  }

  function saveReview(t, things) {
    var ops = [], at = U.nowStr();
    var prev = D().reviews.filter(function (r) { return r.tripId === t.id; });
    function rv(itemId, type, on, qty) {
      var id = 'R-' + t.id + '-' + itemId + '-' + type;
      var ex = prev.filter(function (r) { return r.id === id; })[0];
      if (!on && !(ex && ex.result)) return;
      var it = byId('items', itemId);
      ops.push({ t: 'reviews', id: id, set: { tripId: t.id, itemId: itemId, name: it ? it.name : '', result: on ? type : '', qty: String(qty || 1), by: me(), at: at } });
    }
    things.forEach(function (l) {
      rv(l.itemId, '안씀', !!RV.unused[l.itemId]);
      rv(l.itemId, '부족', !!RV.short[l.itemId], 1);
    });
    Object.keys(RV.stock).forEach(function (iid) { ops.push({ t: 'items', id: iid, set: { stock: RV.stock[iid] } }); });
    ops.push({ t: 'trips', id: t.id, set: { reviewed: 'Y', rating: String(RV.rating || ''), memo: RV.memo } });
    S.mutate(ops);
    RV = null;
    U.toast('회고 저장! 다음 캠핑에 반영돼요');
    go('#/');
  }

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
            h('span', ph === '완료' ? (R.yes(t.reviewed) ? '★'.repeat(R.num(t.rating, 0)) || '✓' : h('span.muted', '회고 전')) : h('span.badge', ph === '보관' ? '보관' : dday(t)))),
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
    var short = count(rv.filter(function (r) { return r.result === '부족'; }), function (r) { return r.name; }).slice(0, 5);
    var unused = R.unusedSuggestions(D().items, D().trips, D().reviews, R.num(setting('안씀보관기준'), 3));
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
      rank('📉 자주 부족한 것', short, '회'),
      h('div.card', h('h3', '💤 계속 안 쓰는 장비'),
        unused.length ? unused.map(function (i) {
          return h('div.kv', h('span', i.name), h('button.btn.small', { onclick: function () {
            S.mutate([{ t: 'items', id: i.id, set: { active: 'N' } }]); U.toast(i.name + ' 보관함으로', function () { S.mutate([{ t: 'items', id: i.id, set: { active: 'Y' } }]); }); rerender();
          } }, '보관'));
        }) : h('p.muted', '최근 ' + (setting('안씀보관기준') || 3) + '번 회고 기준으로 계속 안 쓴 장비가 없어요')));
  }

  /* ───────── 준비물 창고 ───────── */
  function storeTabs(on) {
    return U.seg([{ value: '#/items', label: '준비물' }, { value: '#/places', label: '장소' }, { value: '#/boxes', label: '수납함' }], on, go);
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
        return !q || (i.name + ' ' + i.category + ' ' + i.box + ' ' + i.include).indexOf(q) >= 0;
      });
      var by = {};
      items.forEach(function (i) { (by[i.category || '기타'] = by[i.category || '기타'] || []).push(i); });
      list.innerHTML = '';
      if (!items.length) list.appendChild(empty('항목이 없어요'));
      sortByOrder(Object.keys(by), categories()).forEach(function (c) {
        list.appendChild(h('section.grp', h('div.grp-head', h('b', c), h('small', by[c].length)),
          by[c].map(function (i) {
            var meta = [i.box, i.rule && i.rule !== '고정' ? i.rule + ' ' + i.base : (R.num(i.base, 1) > 1 ? '×' + i.base : ''),
              i.include ? '+' + i.include : '', i.exclude ? '−' + i.exclude : '', R.yes(i.consumable) ? '소모품 ' + (i.stock || '') : ''].filter(Boolean).join(' · ');
            return h('a.irow', { href: '#/item/' + i.id }, h('div', h('b', i.name), meta ? h('small', meta) : null),
              i.stock === '부족' || i.stock === '없음' ? h('span.badge.warn', i.stock) : h('span', '›'));
          })));
      });
    }
    draw();
    return h('div.page', top('준비물 창고'), storeTabs('#/items'),
      lint.length ? h('div.card.lint', h('h3', '⚠️ 규칙 점검 ' + lint.length + '건'), h('small.hint', '이 항목들은 조건이 잘못되어 목록에서 빠질 수 있어요'),
        lint.map(function (p) { return h('a.irow', { href: '#/item/' + p.item.id }, h('div', h('b', p.item.name || '(이름 없음)'), h('small', p.problems.join(', '))), h('span', '›')); })) : null,
      h('div.row2', search, h('a.btn.primary', { href: '#/item/new' }, '+ 추가')),
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
      E = Object.assign({ kind: '물건', name: '', category: '차량·기타', box: '', rule: '고정', base: '1', include: '', exclude: '', leave: '', consumable: '', stock: '', owner: '', memo: '', active: 'Y' }, src || {});
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
    var ex = { family: 4, adults: 2, kids: 2, infants: 0, pets: 0, total: 4, nights: 2 };
    var exQty = R.num(E.base, 1) * R.multiplier(E.rule, ex);
    return h('div.page',
      top(isNew ? '새 준비물' : E.name, { back: '#/items' }),
      h('div.card',
        U.seg(['물건', '할일'], E.kind || '물건', function (v) { set('kind', v); }),
        U.field('이름', name),
        U.field('카테고리', selectEl(categories(), E.category, function (v) { E.category = v; })),
        E.kind !== '할일' ? U.field('수납함', selectEl([''].concat(boxes().map(function (b) { return b.name; })), E.box, function (v) { E.box = v; }, { '': '개별 (박스에 안 들어가는 큰 짐)' }), '싣기·철수는 수납함 단위로 체크해요') : null,
        h('div.row2',
          U.field('수량 규칙', selectEl(R.RULES, E.rule || '고정', function (v) { set('rule', v); })),
          U.field('기본 수량', U.stepper(R.num(E.base, 1), function (v) { set('base', String(v)); }, 1))),
        h('small.hint', '예) 가족 4명(어른2·아이2) 2박이면 → ' + exQty + '개')),
      h('div.card', h('h3', '언제 챙기나요?'),
        h('small.hint', '비워두면 항상 포함. 여러 개 고르면 하나라도 해당할 때 포함. 둘 다 필요하면 "조합"으로.'),
        tagEditor('include')),
      h('div.card', h('h3', '이럴 땐 빼요'), h('small.hint', '하나라도 해당하면 제외 (포함보다 우선)'), tagEditor('exclude')),
      h('div.card',
        h('label.toggle', h('input', { type: 'checkbox', checked: R.yes(E.leave), onchange: function (e) { set('leave', e.target.checked ? 'Y' : ''); } }), ' 두고 오기 쉬운 물건 (철수 때 따로 확인)'),
        h('label.toggle', h('input', { type: 'checkbox', checked: R.yes(E.consumable), onchange: function (e) { E.consumable = e.target.checked ? 'Y' : ''; if (E.consumable && !E.stock) E.stock = '충분'; rerender(); } }), ' 소모품 (재고 관리)'),
        R.yes(E.consumable) ? U.field('재고', U.seg(['충분', '부족', '없음'], E.stock || '충분', function (v) { set('stock', v); })) : null,
        U.field('기본 담당', U.chips(members().filter(function (m) { return m.type !== '반려견'; }).map(function (m) { return m.name; }), [E.owner], function (v, on) { set('owner', on ? v : ''); })),
        U.field('메모', memo)),
      h('div.wiz-nav',
        !isNew ? h('button.btn' + (R.active(E) ? '.danger' : ''), { onclick: function () {
          S.mutate([{ t: 'items', id: id, set: { active: R.active(E) ? 'N' : 'Y' } }]); E = null; U.toast(R.active(src) ? '보관했어요' : '복원했어요'); go('#/items');
        } }, R.active(E) ? '보관' : '복원') : h('span'),
        h('button.btn.primary', { onclick: function () {
          var n = E.name.trim(); if (!n) { name.focus(); return; }
          var dup = D().items.filter(function (i) { return i.name === n && i.id !== id; })[0];
          if (dup) { U.toast('같은 이름이 이미 있어요'); return; }
          var set2 = {};
          ['kind', 'name', 'category', 'box', 'rule', 'base', 'include', 'exclude', 'leave', 'consumable', 'stock', 'owner', 'memo', 'active'].forEach(function (f) { set2[f] = f === 'name' ? n : E[f]; });
          if (set2.kind === '할일') set2.box = '';
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

  function vBoxes() {
    cur.name = 'boxes';
    var all = D().boxes.slice().sort(function (a, b) { return R.num(a.order, 99) - R.num(b.order, 99); });
    function cnt(name) { return D().items.filter(function (i) { return R.active(i) && i.box === name; }).length; }
    function move(i, d) {
      var j = i + d; if (j < 0 || j >= all.length) return;
      var a = all[i], b = all[j];
      S.mutate([{ t: 'boxes', id: a.id, set: { order: String(j + 1) } }, { t: 'boxes', id: b.id, set: { order: String(i + 1) } }]
        .concat(all.map(function (x, k) { return k !== i && k !== j && R.num(x.order, 0) !== k + 1 ? { t: 'boxes', id: x.id, set: { order: String(k + 1) } } : null; })));
      rerender();
    }
    function edit(b) {
      var name = h('input', { type: 'text', value: b ? b.name : '', placeholder: '예: 주방박스' });
      var memo = h('input', { type: 'text', value: b ? b.memo : '', placeholder: '메모 (보관 위치 등)', 'data-nofocus': '' });
      var close = U.sheet(b ? '수납함 수정' : '새 수납함', [U.field('이름', name), U.field('메모', memo)], [
        b ? h('button.btn', { onclick: function () { S.mutate([{ t: 'boxes', id: b.id, set: { active: R.active(b) ? 'N' : 'Y' } }]); close(); rerender(); } }, R.active(b) ? '보관' : '복원') : null,
        h('button.btn.primary', { onclick: function () {
          var n = name.value.trim(); if (!n) return;
          var ops = [];
          if (b) {
            ops.push({ t: 'boxes', id: b.id, set: { name: n, memo: memo.value } });
            if (n !== b.name) D().items.forEach(function (i) { if (i.box === b.name) ops.push({ t: 'items', id: i.id, set: { box: n } }); });
          } else ops.push({ t: 'boxes', id: S.uid('B'), set: { name: n, memo: memo.value, order: String(all.length + 1), active: 'Y' } });
          S.mutate(ops); close(); rerender();
        } }, '저장')]);
    }
    return h('div.page', top('수납함'), storeTabs('#/boxes'),
      h('p.hint', '수납함(박스·가방)을 정해두면 차에 실을 때와 철수할 때 박스 단위로 빠르게 체크할 수 있어요. 순서는 체크리스트 표시 순서예요.'),
      h('button.btn.primary.wide', { onclick: function () { edit(null); } }, '+ 새 수납함'),
      all.map(function (b, i) {
        return h('div.irow' + (R.active(b) ? '' : '.off'),
          h('div', { onclick: function () { edit(b); } }, h('b', '📦 ' + b.name), h('small', cnt(b.name) + '개' + (b.memo ? ' · ' + b.memo : ''))),
          h('div.ord', h('button.icon', { onclick: function () { move(i, -1); }, 'aria-label': '위로' }, '▲'), h('button.icon', { onclick: function () { move(i, 1); }, 'aria-label': '아래로' }, '▼')));
      }));
  }

  /* ───────── 설정 ───────── */
  function vSettings() {
    cur.name = 'settings';
    var link = location.origin + location.pathname + '#api=' + encodeURIComponent(S.cfg.api || '') + '&k=' + (S.cfg.k || '');
    function memberSheet(m) {
      var name = h('input', { type: 'text', value: m ? m.name : '', placeholder: '호칭 (예: 엄마, 첫째)' });
      var email = h('input', { type: 'email', value: m ? m.email : '', placeholder: '알림 받을 이메일 (선택)', 'data-nofocus': '' });
      var type = m ? m.type : '어른';
      var segBox = h('div');
      function draw() { segBox.innerHTML = ''; segBox.appendChild(U.seg(['어른', '아이', '영유아', '반려견'], type, function (v) { type = v; draw(); })); }
      draw();
      var close = U.sheet(m ? m.name : '구성원 추가', [U.field('이름', name), U.field('구분', segBox, '아이 = 초등 이상, 영유아 = 부모와 함께 자는 아이'), U.field('이메일', email, 'D-2 준비 알림·회고 요청 메일을 받아요')], [
        m ? h('button.btn', { onclick: function () { S.mutate([{ t: 'members', id: m.id, set: { active: R.active(m) ? 'N' : 'Y' } }]); close(); rerender(); } }, R.active(m) ? '숨기기' : '다시 표시') : null,
        h('button.btn.primary', { onclick: function () {
          var n = name.value.trim(); if (!n) { name.focus(); return; }
          S.mutate([{ t: 'members', id: m ? m.id : S.uid('M'), set: { name: n, type: type, email: email.value.trim(), active: m ? m.active || 'Y' : 'Y' } }]);
          close(); rerender();
        } }, '저장')]);
    }
    function settingSheet(key, label, hint) {
      var ta = h('textarea', { rows: 4 }, setting(key));
      var close = U.sheet(label, [ta, hint ? h('small.hint', hint) : null], [h('button.btn.primary.wide', { onclick: function () {
        S.mutate([{ t: 'settings', id: key, set: { value: R.list(ta.value).join(', ') } }]); close(); rerender();
      } }, '저장')]);
    }
    var mail = setting('이메일알림') !== 'N';
    return h('div.page', top('설정'),
      h('div.card', h('h3', '나'),
        h('div.kv', h('span', '이 기기 사용자: ', h('b', me())), h('button.btn.small', { onclick: function () { S.setCfg({ me: '' }); rerender(); } }, '변경'))),
      h('div.card', h('h3', '가족 구성원'),
        D().members.map(function (m) {
          return h('button.irow' + (R.active(m) ? '' : '.off'), { onclick: function () { memberSheet(m); } },
            h('div', h('b', (TYPE_ICON[m.type] || '') + ' ' + m.name), h('small', [m.type, m.email].filter(Boolean).join(' · '))), h('span', '›'));
        }),
        h('button.btn.wide', { onclick: function () { memberSheet(null); } }, '+ 구성원 추가')),
      h('div.card', h('h3', '가족 초대'),
        h('p.hint', '이 링크를 가족 휴대폰에서 열면 바로 연결돼요. 링크를 아는 사람은 누구나 볼 수 있으니 가족에게만 보내세요.'),
        h('button.btn.primary.wide', { onclick: function () {
          if (navigator.share) navigator.share({ title: '우리 가족 캠핑 준비', text: '캠핑 준비 앱 초대 링크예요', url: link }).catch(function () {});
          else if (navigator.clipboard) navigator.clipboard.writeText(link).then(function () { U.toast('링크를 복사했어요'); });
          else U.sheet('초대 링크', h('textarea', { rows: 4, readonly: true }, link));
        } }, '📤 초대 링크 보내기')),
      h('div.card', h('h3', '조건·분류'),
        h('button.irow', { onclick: function () { settingSheet('태그_사용자', '직접 만든 조건 태그', '쉼표로 구분. 예: 캠핑카, 낚시, 스키'); } }, h('div', h('b', '직접 만든 조건 태그'), h('small', setting('태그_사용자') || '없음')), h('span', '›')),
        h('button.irow', { onclick: function () { settingSheet('카테고리', '카테고리 (표시 순서)', '쉼표로 구분'); } }, h('div', h('b', '카테고리'), h('small', categories().length + '개')), h('span', '›')),
        h('a.irow', { href: '#/boxes' }, h('div', h('b', '수납함'), h('small', boxes().length + '개')), h('span', '›'))),
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

  /* ───────── 시작 ───────── */
  route(false);
  if (S.connected()) { S.flush(); S.sync(); }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
  window.__app = { route: route, D: D };
})();
