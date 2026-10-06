/* camp-pack 데이터 저장소 — 로컬 캐시 + 전송 대기열 + 서버 동기화 (오프라인 우선) */
(function () {
  'use strict';
  var LS = { cfg: 'cp.cfg', data: 'cp.data', queue: 'cp.queue', extra: 'cp.extra' };
  var TABLES = ['items', 'boxes', 'places', 'members', 'trips', 'lines', 'reviews', 'settings'];
  var POLL_MS = 12000;

  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('저장 실패', e); } }
  function emptyData() { var d = { version: 0, meta: {} }; TABLES.forEach(function (t) { d[t] = []; }); return d; }

  var S = {
    cfg: load(LS.cfg, {}),
    data: load(LS.data, null) || emptyData(),
    queue: load(LS.queue, []),
    extra: load(LS.extra, {}), // 지난 캠핑의 체크 줄 (필요할 때 받아옴)
    status: { online: navigator.onLine, busy: false, error: '', lastSync: 0, authError: false },
    listeners: [],
  };

  S.on = function (fn) { S.listeners.push(fn); };
  function emit(kind) { S.listeners.forEach(function (fn) { try { fn(kind); } catch (e) { console.error(e); } }); }

  S.api = function () { return S.cfg.api || (window.CAMP_CONFIG && window.CAMP_CONFIG.api) || ''; };
  S.connected = function () { return !!(S.api() && S.cfg.k); };
  S.setCfg = function (patch) { Object.assign(S.cfg, patch); save(LS.cfg, S.cfg); };
  S.reset = function () {
    Object.keys(LS).forEach(function (k) { localStorage.removeItem(LS[k]); });
    S.cfg = {}; S.data = emptyData(); S.queue = []; S.extra = {};
  };

  /** 재로그인 후 못 보낸 변경 되살리기 */
  S.restoreQueue = function (q) {
    S.queue = q.slice(); q.forEach(apply); save(LS.queue, S.queue); save(LS.data, S.data);
  };

  function keyOf(t) { return t === 'settings' ? 'key' : 'id'; }

  /** op 하나를 로컬 데이터에 반영 */
  function apply(op) {
    var arr = S.data[op.t]; if (!arr) return;
    var k = keyOf(op.t), row = null, i;
    for (i = 0; i < arr.length; i++) if (arr[i][k] === op.id) { row = arr[i]; break; }
    if (!row && op.t === 'lines') {
      Object.keys(S.extra).some(function (tid) {
        var ex = S.extra[tid];
        for (var j = 0; j < ex.length; j++) if (ex[j].id === op.id) { row = ex[j]; return true; }
        return false;
      });
    }
    if (!row) { row = {}; row[k] = op.id; arr.push(row); }
    Object.keys(op.set).forEach(function (f) { row[f] = op.set[f] == null ? '' : String(op.set[f]); });
  }

  /** 변경 → 즉시 화면 반영 + 대기열 → 서버 전송 */
  S.mutate = function (ops) {
    ops = ops.filter(Boolean);
    if (!ops.length) return;
    ops.forEach(apply);
    ops.forEach(function (op) { S.queue.push(op); });
    seq++;
    save(LS.queue, S.queue); save(LS.data, S.data); save(LS.extra, S.extra);
    emit('local');
    S.flush();
  };

  function post(body) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl && setTimeout(function () { ctrl.abort(); }, 25000);
    body.k = S.cfg.k;
    return fetch(S.api(), { method: 'POST', body: JSON.stringify(body), signal: ctrl && ctrl.signal, redirect: 'follow' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        if (timer) clearTimeout(timer);
        if (!j.ok) {
          var err = new Error(j.error || '서버 오류'); err.code = j.code; throw err;
        }
        S.status.online = true; S.status.authError = false;
        return j;
      })
      // 서버가 보낸 오류(로그인 만료 등)도 여기서 받도록 catch 로 (예전엔 네트워크 오류만 받아 로그인 화면이 안 떴음)
      .catch(function (e) {
        if (timer) clearTimeout(timer);
        if (!e.code) { S.status.online = false; e.offline = true; }
        if (e.code === 'auth') S.status.authError = true;
        throw e;
      });
  }
  S.post = post;

  var flushing = null, retryTimer = null, retryDelay = 5000;
  var seq = 0, needResync = false; // seq: 로컬 변경 횟수 — 이보다 먼저 출발한 동기화 응답은 낡은 데이터
  S.flush = function () {
    if (flushing || !S.queue.length || !S.connected()) return flushing || Promise.resolve();
    var batch = S.queue.slice(0, 300);
    S.status.busy = true; emit('status');
    flushing = post({ op: 'mutate', ops: batch, by: S.cfg.meName || '앱' })
      .then(function () {
        S.queue.splice(0, batch.length); save(LS.queue, S.queue);
        S.status.error = ''; retryDelay = 5000;
        flushing = null;
        if (S.queue.length) return S.flush();
        if (syncing) { needResync = true; return syncing; } // 진행 중 동기화는 변경 전 데이터 → 끝난 뒤 다시
        return S.sync(true);
      }, function (e) {
        flushing = null;
        S.status.error = e.offline ? '' : e.message;
        clearTimeout(retryTimer);
        retryTimer = setTimeout(S.flush, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 60000);
      })
      .then(function () { S.status.busy = false; emit('status'); });
    return flushing;
  };

  function replaceData(j) {
    var d = emptyData();
    d.version = j.version; d.meta = j.meta || {};
    TABLES.forEach(function (t) { d[t] = j[t] || []; });
    S.data = d;
    // 받아온 최신 데이터 위에 아직 전송 못 한 변경을 다시 얹음
    S.queue.forEach(apply);
    var me = S.cfg.me && d.members.filter(function (m) { return m.id === S.cfg.me; })[0];
    if (me && me.name !== S.cfg.meName) S.setCfg({ meName: me.name });
    save(LS.data, S.data);
  }

  var syncing = null;
  S.sync = function (force) {
    if (!S.connected()) return Promise.resolve();
    if (syncing) return syncing;
    if (S.queue.length) return S.flush();
    var startSeq = seq;
    syncing = post({ op: 'sync', since: force ? -1 : S.data.version })
      .then(function (j) {
        S.status.lastSync = Date.now(); S.status.error = '';
        // 요청 후에 생긴 변경이 있으면 이 응답은 낡았음 → 버리고 다시 받기 (뺀 준비물이 되살아나는 문제 방지)
        if (seq !== startSeq || S.queue.length || flushing) { needResync = true; return; }
        if (!j.same) { replaceData(j); emit('remote'); }
        else emit('status');
      }, function (e) {
        S.status.error = e.offline ? '' : e.message; emit('status');
      })
      .then(function () {
        syncing = null;
        if (needResync && !S.queue.length && !flushing) { needResync = false; return S.sync(true); }
      });
    return syncing;
  };

  /** 지난 캠핑(최근 목록에 없는)의 체크 줄 받아오기 */
  S.ensureLines = function (tripId) {
    if (S.data.lines.some(function (l) { return l.tripId === tripId; }) || S.extra[tripId]) return Promise.resolve();
    return post({ op: 'tripLines', tripId: tripId }).then(function (j) {
      S.extra[tripId] = j.lines; save(LS.extra, S.extra); emit('remote');
    });
  };
  // 동행 가족이 '우리만 보기'로 추가한 준비물은 주최 가족 화면에서 제외
  function notPrivate(x) { return x.scope !== '우리만'; }
  S.linesOf = function (tripId) {
    var l = S.data.lines.filter(function (x) { return x.tripId === tripId; });
    return (l.length ? l : (S.extra[tripId] || [])).filter(notPrivate);
  };

  /** 로그인 전·동행 가족용 요청 (가족 토큰 없이) */
  S.publicPost = function (body) {
    return fetch(S.api(), { method: 'POST', body: JSON.stringify(body), redirect: 'follow' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  };

  S.history = function () { return post({ op: 'history' }).then(function (j) { return j.rows; }); };

  S.uid = function (p) { return p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); };

  // 자동 동기화: 화면이 보이고 연결되어 있을 때만
  setInterval(function () {
    if (document.visibilityState === 'visible' && navigator.onLine) S.sync();
  }, POLL_MS);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') S.sync();
  });
  window.addEventListener('online', function () { S.status.online = true; emit('status'); S.flush(); S.sync(); });
  window.addEventListener('offline', function () { S.status.online = false; emit('status'); });

  window.Store = S;
})();
