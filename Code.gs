/**
 * camp-pack — 우리 가족 캠핑 준비 (Apps Script 백엔드)
 *
 * 이 파일 하나를 스프레드시트의 [확장 프로그램 > Apps Script] 에 붙여넣고
 * 시트 메뉴 [🏕️ 캠핑 준비 > 1. 초기 설정] 을 실행하세요. 자세한 방법은 설치 가이드 참고.
 */

var APP_URL = 'https://jeromettf.github.io/camp-pack/';
var TZ = 'Asia/Seoul';

var SCHEMA = {
  items: { sheet: '준비물', log: '준비물', cols: [
    ['id', 'id'], ['kind', '종류'], ['name', '이름'], ['category', '카테고리'], ['box', '수납함'],
    ['rule', '수량규칙'], ['base', '기본수량'], ['include', '포함조건'], ['exclude', '제외조건'],
    ['leave', '두고오기쉬움'], ['consumable', '소모품'], ['stock', '재고상태'], ['owner', '담당자'],
    ['memo', '메모'], ['active', '활성'], ['shared', '공용'], ['updatedAt', '수정일'],
    ['brand', '브랜드'], ['model', '제품명'], ['link', '구매링크'], ['owned', '보유수량']] },
  boxes: { sheet: '수납함', log: '수납함', cols: [
    ['id', 'id'], ['name', '이름'], ['order', '순서'], ['memo', '메모'], ['active', '활성']] },
  places: { sheet: '장소', log: '장소', cols: [
    ['id', 'id'], ['name', '이름'], ['region', '지역'], ['lat', '위도'], ['lng', '경도'], ['tags', '태그'],
    ['items', '전용준비물'], ['memo', '메모'], ['active', '활성'], ['updatedAt', '수정일']] },
  members: { sheet: '구성원', log: '구성원', cols: [
    ['id', 'id'], ['name', '이름'], ['type', '구분'], ['email', '이메일'], ['color', '색상'], ['active', '활성']] },
  trips: { sheet: '캠핑', cols: [
    ['id', 'id'], ['title', '제목'], ['start', '시작일'], ['end', '종료일'], ['placeId', '장소id'],
    ['members', '참여구성원'], ['guestAdults', '손님어른'], ['guestKids', '손님아이'], ['tagsAdd', '추가태그'],
    ['tagsRemove', '제외태그'], ['tags', '적용태그'], ['weather', '날씨'], ['status', '상태'], ['rating', '별점'],
    ['memo', '메모'], ['reviewed', '회고완료'], ['createdBy', '생성자'], ['createdAt', '생성일'], ['updatedAt', '수정일'],
    ['companions', '동행'], ['shareToken', '공유코드'], ['shareUntil', '공유만료'], ['splitRule', '정산방식']] },
  lines: { sheet: '체크', cols: [
    ['id', 'id'], ['tripId', '캠핑id'], ['kind', '종류'], ['itemId', '항목id'], ['name', '이름'], ['category', '카테고리'],
    ['box', '수납함'], ['qty', '수량'], ['owner', '담당자'], ['leave', '두고오기쉬움'], ['warn', '주의'], ['note', '메모'],
    ['source', '출처'], ['pack', '짐싸기'], ['load', '싣기'], ['back', '철수'], ['done', '완료'], ['deleted', '삭제'],
    ['updatedAt', '수정일'], ['shared', '공용'], ['party', '담당가족'], ['amount', '금액'], ['payer', '결제'], ['addedBy', '추가한가족'], ['scope', '공개범위']] },
  reviews: { sheet: '회고', cols: [
    ['id', 'id'], ['tripId', '캠핑id'], ['itemId', '항목id'], ['name', '이름'], ['result', '결과'], ['qty', '수량'],
    ['by', '작성자'], ['at', '시각']] },
  settings: { sheet: '설정', key: 'key', log: '설정', cols: [['key', '키'], ['value', '값'], ['desc', '설명']] },
  history: { sheet: '변경이력', readonly: true, cols: [
    ['at', '시각'], ['by', '사용자'], ['target', '대상'], ['targetId', '대상id'], ['action', '동작'], ['detail', '내용']] },
};
var SHEET_ORDER = ['items', 'boxes', 'places', 'members', 'trips', 'lines', 'reviews', 'settings', 'history'];

/** 동행 캠핑에서 가족끼리 나눠 챙기는 공용 짐 (v1.1 마이그레이션 기본값) */
var DEFAULT_SHARED = ['타프', '타프 폴대', '키친 테이블', '선반·랙', '돗자리', '화로대', '장작', '숯', '토치', '착화제', '그릴망',
  '버너', '부탄가스', '코펠·냄비', '프라이팬', '그리들', '칼·도마', '집게·가위', '국자·뒤집개', '주전자', '커피 도구',
  '양념 세트(소금·후추·오일)', '키친타월', '호일·랩·지퍼백', '설거지통', '주방세제·수세미', '물통(워터저그)', '일회용 접시·컵',
  '메인 랜턴', '릴선(전기 연장선)', '멀티탭', '블루투스 스피커', '보드게임', '쓰레기봉투', '모기 퇴치기·모기향', '서큘레이터'];
var LOGIN_MAX_FAIL = 10;      // 10분 안에 이만큼 틀리면
var LOGIN_LOCK_SEC = 600;     // 10분 잠금
var SHARE_FIELDS = ['id', 'kind', 'name', 'category', 'qty', 'note', 'party', 'pack', 'amount', 'payer', 'addedBy', 'shared', 'source', 'scope'];

/** 비어 있을 때만 채우는 기본값 */
var DEFAULT_BOXES = ['텐트가방', '침구가방', '주방박스', '식기박스', '전기·조명박스', '소품박스', '세면가방', '의류가방',
  '물놀이가방', '화로박스', '아이가방', '반려견가방', '아이스박스'];
var DEFAULT_SETTINGS = [
  ['태그_장소유형', '오토캠핑, 글램핑, 카라반, 노지, 차박', '장소 유형 태그'],
  ['태그_환경', '계곡, 바다, 산, 전기없음, 개수대없음, 매점없음', '장소 환경 태그'],
  ['태그_계절날씨', '봄가을, 하계, 동계, 혹한, 우천, 강풍', '계절·날씨 태그 (자동 제안됨)'],
  ['태그_동반', '아이, 영유아, 반려견, 손님', '동반자 태그 (구성원·손님으로 자동 결정)'],
  ['태그_기간', '1박, 연박', '기간 태그 (날짜로 자동 결정)'],
  ['태그_사용자', '', '직접 만든 태그 (쉼표로 구분)'],
  ['카테고리', '할 일, 음식·음료, 조리·식기, 텐트·설치, 침구, 가구, 불·난방, 조명·전기, 위생·세면, 옷·신발, 아이·반려견, 안전·기타', '준비물 카테고리 (표시 순서)'],
  ['이메일알림', 'Y', 'D-2 준비 알림 메일 (Y/N)'],
  ['안씀보관기준', '3', '연속으로 안 쓴 횟수가 이 값 이상이면 보관 제안'],
];
var PROTECTED = ['trips', 'lines', 'reviews', 'history'];

/* ───────────────────────── 웹 API ───────────────────────── */

function doGet() {
  return json_({ ok: true, app: 'camp-pack', hint: 'POST only' });
}

function doPost(e) {
  var req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, code: 'bad_request', error: 'JSON 형식 오류' }); }
  try {
    // 로그인 전·동행 가족용 요청 (가족 코드 불필요)
    switch (req.op) {
      case 'meta': return json_({ ok: true, pinSet: !!props_().getProperty('PIN_HASH') });
      case 'login': return json_(login_(req.family, req.pin));
      case 'shareGet': return json_(shareGet_(req.s));
      case 'shareMutate': return json_(shareMutate_(req.s, String(req.by || ''), req.ops || []));
    }
  } catch (err) {
    return json_({ ok: false, code: 'server', error: String(err && err.message || err) });
  }
  if (!req.k || req.k !== familyCode_()) return json_({ ok: false, code: 'auth', error: '다시 로그인해 주세요' });
  try {
    switch (req.op) {
      case 'ping': return json_({ ok: true, version: version_() });
      case 'bootstrap': return json_(bootstrap_());
      case 'sync':
        var v = version_();
        return json_(String(req.since) === String(v) ? { ok: true, same: true, version: v } : bootstrap_());
      case 'mutate': return json_(mutate_(req.ops || [], String(req.by || '앱')));
      case 'tripLines': return json_({ ok: true, lines: readTable_('lines').filter(function (l) { return l.tripId === req.tripId; }) });
      case 'history': return json_({ ok: true, rows: readTable_('history').slice(-300).reverse() });
      case 'setPin': return json_(setPin_(req.family, req.pin, req.currentPin));
      case 'shareLink': {
        var r = mutate_([{ t: 'trips', id: String(req.tripId || ''), set: {}, link: { name: String(req.name || ''), action: req.action === 'revoke' ? 'revoke' : 'issue' } }], String(req.by || '앱'));
        var tok = r.links && r.links[String(req.name || '')];
        if (tok === undefined) return json_({ ok: false, code: 'bad_request', error: '동행 가족을 찾을 수 없어요' });
        return json_({ ok: true, token: tok, version: r.version });
      }
      default: return json_({ ok: false, code: 'bad_request', error: '알 수 없는 요청: ' + req.op });
    }
  } catch (err) {
    return json_({ ok: false, code: 'server', error: String(err && err.message || err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function bootstrap_() {
  migrate_();
  var today = today_();
  var recentFrom = addDays_(today, -10);
  var trips = readTable_('trips');
  var live = {};
  trips.forEach(function (t) { if (t.status !== '보관' && (!t.end || t.end >= recentFrom)) live[t.id] = 1; });
  return {
    ok: true, version: version_(),
    meta: { today: today, sheetUrl: SpreadsheetApp.getActive().getUrl(), app: APP_URL,
      familyName: props_().getProperty('FAMILY_NAME') || '', pinSet: !!props_().getProperty('PIN_HASH') },
    items: readTable_('items'), boxes: readTable_('boxes'), places: readTable_('places'),
    members: readTable_('members'), trips: trips, settings: readTable_('settings'),
    reviews: readTable_('reviews'),
    lines: readTable_('lines').filter(function (l) { return live[l.tripId]; }),
  };
}

/**
 * ops: [{t: 'lines', id: 'L-..', set: {pack: '아빠|2026-10-24 09:12'}}, ...]
 * id 로 행을 찾아 지정한 칸만 갱신(없으면 추가). 행 번호에 의존하지 않으므로 시트 정렬·삽입에 안전.
 */
function mutate_(ops, by, lockHeld) {
  var lock = lockHeld ? null : LockService.getScriptLock();
  if (lock) lock.waitLock(25000);
  try {
    var now = nowStr_(), logs = [], groups = {}, applied = 0, links = {};
    ops.forEach(function (op) {
      var s = SCHEMA[op && op.t];
      if (!s || s.readonly || !op.id || !op.set) return;
      (groups[op.t] = groups[op.t] || []).push(op);
    });
    Object.keys(groups).forEach(function (t) {
      var s = SCHEMA[t], sh = sheet_(t), keyField = s.key || 'id';
      var hdr = headerMap_(sh, s);
      var data = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, hdr.width).getValues() : [];
      var index = {};
      data.forEach(function (row, i) { var k = String(row[hdr.col[keyField]]); if (k) index[k] = i; });
      var dirty = {}, appended = [];
      groups[t].forEach(function (op) {
        var i = index[String(op.id)], row, isNew = i === undefined;
        if (op.link && isNew) return; // 없는 캠핑에 링크 만들기 금지
        if (isNew) {
          row = []; for (var c = 0; c < hdr.width; c++) row.push('');
          row[hdr.col[keyField]] = String(op.id);
          data.push(row); i = data.length - 1; index[String(op.id)] = i; appended.push(i);
        } else row = data[i];
        if (t === 'trips') prepareCompanions_(op, row, hdr, links);
        var changes = [];
        Object.keys(op.set).forEach(function (f) {
          if (f === keyField || hdr.col[f] === undefined) return;
          var nv = op.set[f] == null ? '' : String(op.set[f]);
          var ov = cell_(row[hdr.col[f]]);
          if (ov !== nv) { changes.push([f, ov, nv]); row[hdr.col[f]] = nv; }
        });
        if (!changes.length && !isNew) return;
        if (hdr.col.updatedAt !== undefined) row[hdr.col.updatedAt] = now;
        if (!isNew) dirty[i] = 1;
        applied++;
        if (s.log) logs.push([now, by, s.log, String(op.id), isNew ? '추가' : '수정', describe_(s, row, hdr, changes, isNew)]);
      });
      Object.keys(dirty).forEach(function (i) {
        i = Number(i);
        if (appended.indexOf(i) >= 0) return;
        sh.getRange(i + 2, 1, 1, hdr.width).setValues([data[i]]);
      });
      if (appended.length) {
        var start = sh.getLastRow() + 1;
        var rows = appended.map(function (i) { return data[i]; });
        sh.getRange(start, 1, rows.length, hdr.width).setNumberFormat('@').setValues(rows);
      }
    });
    if (logs.length) appendHistory_(logs);
    var v = applied ? bumpVersion_() : version_();
    return { ok: true, applied: applied, version: v, links: links };
  } finally {
    if (lock) lock.releaseLock();
  }
}

/**
 * 동행 가족 링크 코드 보호 (잠금 안에서 현재 시트 값 기준으로 처리)
 * - 일반 수정(인원 등)으로 동행 칸을 통째로 덮어써도, 이미 있는 링크 코드는 유지
 *   (다른 기기에서 아직 동기화 안 된 목록으로 저장해도 링크가 사라지지 않음)
 * - 링크 만들기/끄기는 op.link = { name, action: 'issue' | 'revoke' } 로만
 */
function prepareCompanions_(op, row, hdr, links) {
  if (hdr.col.companions === undefined) return;
  var cur = parseComps_({ companions: cell_(row[hdr.col.companions]) });
  var tokOf = {}; cur.forEach(function (c) { if (c.token) tokOf[c.name] = c.token; });
  if (op.link) {
    var name = String(op.link.name || ''), found = false;
    cur.forEach(function (c) {
      if (c.name !== name) return;
      found = true;
      if (op.link.action === 'revoke') c.token = '';
      else if (!c.token) c.token = Utilities.getUuid().replace(/-/g, '');
      links[name] = c.token || '';
    });
    if (!found) return;
    op.set = op.set || {};
    op.set.companions = JSON.stringify(cur);
    if (op.link.action !== 'revoke' && hdr.col.end !== undefined) {
      var until = addDays_(cell_(row[hdr.col.end]) || today_(), 7), had = cell_(row[hdr.col.shareUntil]);
      if (!had || had < until) op.set.shareUntil = until;
    }
    return;
  }
  if (!op.set || !('companions' in op.set)) return;
  var inc;
  try { inc = JSON.parse(op.set.companions || '[]'); } catch (e) { return; }
  if (!Array.isArray(inc)) return;
  op.set.companions = JSON.stringify(inc.map(function (c) {
    if (!c || !c.name) return c;
    var o = {}; Object.keys(c).forEach(function (k) { o[k] = c[k]; });
    // 링크 코드는 shareLink 로만 생기고 꺼짐 → 앱이 보낸 값은 무시 (꺼진 링크 부활·다른 캠핑 코드 복사 방지)
    if (tokOf[c.name]) o.token = tokOf[c.name]; else delete o.token;
    return o;
  }));
}

function describe_(s, row, hdr, changes, isNew) {
  var name = hdr.col.name !== undefined ? cell_(row[hdr.col.name]) : (hdr.col.key !== undefined ? cell_(row[hdr.col.key]) : '');
  if (isNew) return name;
  var label = {}; s.cols.forEach(function (c) { label[c[0]] = c[1]; });
  return name + ' — ' + changes.filter(function (c) { return c[0] !== 'updatedAt'; })
    .map(function (c) { return label[c[0]] + ': ' + (c[1] || '∅') + ' → ' + (c[2] || '∅'); }).join(', ');
}

/* ───────────────────────── 가족 로그인 (이름 + 6자리 PIN) ───────────────────────── */

function normName_(s) { return String(s || '').replace(/\s/g, '').toLowerCase(); }
function hashPin_(pin) {
  var salt = props_().getProperty('PIN_SALT');
  if (!salt) { salt = newCode_(); props_().setProperty('PIN_SALT', salt); }
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function login_(family, pin) {
  var p = props_();
  if (!p.getProperty('PIN_HASH')) return { ok: false, code: 'no_pin', error: '아직 가족 PIN이 설정되지 않았어요' };
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('LOGIN_FAILS') || 0);
  if (fails >= LOGIN_MAX_FAIL) return { ok: false, code: 'locked', error: '여러 번 틀려서 10분간 잠겼어요. 잠시 후 다시 시도하세요' };
  var good = normName_(family) === normName_(p.getProperty('FAMILY_NAME')) && hashPin_(String(pin || '')) === p.getProperty('PIN_HASH');
  if (!good) {
    cache.put('LOGIN_FAILS', String(fails + 1), LOGIN_LOCK_SEC);
    return { ok: false, code: 'bad_login', error: '가족 이름 또는 PIN이 맞지 않아요', left: LOGIN_MAX_FAIL - fails - 1 };
  }
  cache.remove('LOGIN_FAILS');
  return { ok: true, k: familyCode_(), familyName: p.getProperty('FAMILY_NAME') };
}

/** PIN 설정·변경 (이미 로그인된 기기에서). 바꾸면 모든 기기 토큰 교체 → 다른 기기는 다시 로그인 */
function setPin_(family, pin, currentPin) {
  var p = props_();
  family = String(family || '').trim();
  if (!family || family.length > 30) return { ok: false, code: 'bad_request', error: '가족 이름을 입력하세요' };
  if (!/^\d{6}$/.test(String(pin || ''))) return { ok: false, code: 'bad_request', error: 'PIN은 숫자 6자리예요' };
  if (p.getProperty('PIN_HASH') && hashPin_(String(currentPin || '')) !== p.getProperty('PIN_HASH'))
    return { ok: false, code: 'bad_login', error: '현재 PIN이 맞지 않아요' };
  p.setProperty('FAMILY_NAME', family);
  p.setProperty('PIN_HASH', hashPin_(String(pin)));
  var k = newCode_();
  p.setProperty('FAMILY_CODE', k);
  appendHistory_([[nowStr_(), '앱', '가족 로그인', '', 'PIN 설정', '가족 이름: ' + family]]);
  return { ok: true, k: k, familyName: family };
}

/* ───────────────────────── 같이 챙기기 (동행 가족 공유) ───────────────────────── */

function parseComps_(t) {
  try { var a = JSON.parse(t.companions || '[]'); return Array.isArray(a) ? a.filter(function (c) { return c && c.name; }) : []; }
  catch (e) { return []; }
}
/** 공유 코드 → 캠핑 (+ 가족별 전용 링크면 그 가족 이름). 예전 캠핑 공용 링크도 계속 지원 */
function shareTrip_(token) {
  if (!token || String(token).length < 16) return null;
  token = String(token);
  var t = null, fam = '';
  readTable_('trips').some(function (x) {
    if (x.shareToken && x.shareToken === token) { t = x; return true; }
    var c = parseComps_(x).filter(function (c) { return c.token && c.token === token; })[0];
    if (c) { t = x; fam = c.name; return true; }
    return false;
  });
  if (!t || t.status === '보관') return null;
  if (t.shareUntil && today_() > t.shareUntil) return null;
  t._fam = fam;
  return t;
}
/** 동행 가족이 직접 추가한 '우리만 보기' 준비물은 그 가족만 봄 (주최 가족·다른 가족에게 안 보임) */
function seenBy_(l, fam) {
  if (l.scope === '우리만') return l.deleted !== 'Y' && !!fam && l.addedBy === fam;
  return isShared_(l);
}
function isShared_(l) { return l.deleted !== 'Y' && (l.shared === 'Y' || l.kind === '장보기' || l.kind === '정산' || (l.party && l.party !== '우리')); }

function shareGet_(token) {
  var t = shareTrip_(token);
  if (!t) return { ok: false, code: 'share_invalid', error: '공유가 끝났거나 잘못된 링크예요' };
  var place = t.placeId ? readTable_('places').filter(function (p) { return p.id === t.placeId; })[0] : null;
  var people = readTable_('members').filter(function (m) {
    return ('' + t.members).split(',').indexOf(m.id) >= 0 && m.type !== '반려견';
  }).length;
  var lines = readTable_('lines').filter(function (l) { return l.tripId === t.id && seenBy_(l, t._fam); }).map(function (l) {
    var o = {}; SHARE_FIELDS.forEach(function (f) { o[f] = l[f]; }); return o;
  });
  var comps = parseComps_(t).map(function (c) { return { name: c.name, adults: c.adults, kids: c.kids }; }); // 다른 가족 링크 코드는 숨김
  return { ok: true, version: version_(), ourName: props_().getProperty('FAMILY_NAME') || '우리 가족', ourPeople: people, fam: t._fam,
    trip: { title: t.title, start: t.start, end: t.end, place: place ? place.name : '', companions: JSON.stringify(comps), splitRule: t.splitRule },
    lines: lines };
}

/** 동행 가족 변경: 허용된 필드만, 담당이 '미정'일 때만 가져가기 */
/** 검사와 쓰기를 한 잠금 안에서 (두 가족이 동시에 "우리가 가져갈게" 눌러도 한 가족만) */
function shareMutate_(token, by, ops) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return shareMutateLocked_(token, by, ops); } finally { lock.releaseLock(); }
}
function shareMutateLocked_(token, by, ops) {
  var t = shareTrip_(token);
  if (!t) return { ok: false, code: 'share_invalid', error: '공유가 끝났거나 잘못된 링크예요' };
  if (t._fam) by = t._fam; // 가족별 전용 링크: 그 가족으로 고정
  var comps = parseComps_(t).map(function (c) { return c.name; });
  if (comps.indexOf(by) < 0) return { ok: false, code: 'bad_request', error: '동행 가족 이름을 선택하세요' };
  var lines = {}, anyId = {};
  readTable_('lines').forEach(function (l) { anyId[l.id] = 1; if (l.tripId === t.id) lines[l.id] = l; });
  var safe = [], rejected = 0;
  (ops || []).slice(0, 100).forEach(function (op) {
    if (!op || op.t !== 'lines' || !op.id || !op.set) { rejected++; return; }
    var cur = lines[op.id], set = {};
    if (!cur && anyId[op.id]) { rejected++; return; } // 다른 캠핑의 줄 id 로 새 항목을 만들어 덮어쓰기 방지
    if (!cur) {
      var kind = ['물건', '장보기', '정산'].indexOf(op.set.kind) >= 0 ? op.set.kind : '물건';
      var name = String(op.set.name || '').trim().slice(0, 60);
      if (!name || String(op.id).indexOf('L-') !== 0) { rejected++; return; }
      var priv = op.set.scope === '우리만' && !!t._fam && kind !== '정산'; // 우리만 보기는 가족별 전용 링크에서만
      safe.push({ t: 'lines', id: op.id, set: { tripId: t.id, kind: kind, name: name, category: kind === '장보기' ? '음식·음료' : kind === '정산' ? '정산' : '안전·기타',
        qty: String(Math.max(1, Number(op.set.qty) || 1)), shared: 'Y', source: '동행', addedBy: by, party: by, scope: priv ? '우리만' : '',
        amount: priv ? '' : cleanAmount_(op.set.amount), payer: op.set.amount && !priv ? by : '' } });
      return;
    }
    if (!seenBy_(cur, t._fam)) { rejected++; return; }
    if ('scope' in op.set) {
      if (cur.addedBy !== by || !t._fam || cur.kind === '정산') { rejected++; return; }
      set.scope = op.set.scope === '우리만' ? '우리만' : '';
      if (set.scope) { set.amount = ''; set.payer = ''; }
    }
    if ('party' in op.set) {
      var to = String(op.set.party);
      var free = !cur.party || cur.party === '미정';
      if (to === by && (free || cur.party === by)) set.party = by;
      else if (to === '미정' && cur.party === by) set.party = '미정';
      else { rejected++; return; }
    }
    if ('pack' in op.set) {
      if ((set.party || cur.party) !== by) { rejected++; return; }
      set.pack = op.set.pack ? by + '|' + nowStr_() : '';
    }
    if ('amount' in op.set) {
      if ((set.scope != null ? set.scope : cur.scope) === '우리만') { rejected++; return; }
      // 금액은 자기 가족이 결제한 항목(또는 결제자 없음)에만 입력, 결제자는 항상 자기 가족
      if (cur.payer && cur.payer !== by) { rejected++; return; }
      set.amount = cleanAmount_(op.set.amount);
      set.payer = set.amount ? by : '';
    }
    if ('deleted' in op.set) {
      if (cur.addedBy !== by) { rejected++; return; }
      set.deleted = op.set.deleted ? 'Y' : '';
    }
    if (Object.keys(set).length) safe.push({ t: 'lines', id: op.id, set: set });
  });
  var r = safe.length ? mutate_(safe, by + '(동행)', true) : { ok: true, applied: 0, version: version_() };
  r.rejected = rejected;
  return r;
}
function cleanAmount_(v) { var n = Math.round(Number(String(v == null ? '' : v).replace(/[^\d.-]/g, ''))); return n > 0 ? String(n) : ''; }

/** v3: 카테고리 12개로 정리 (예전 → 새) */
var NEW_CATEGORIES = '할 일, 음식·음료, 조리·식기, 텐트·설치, 침구, 가구, 불·난방, 조명·전기, 위생·세면, 옷·신발, 아이·반려견, 안전·기타';
var CAT_MAP = { '할 일': '할 일', '텐트·쉘터': '텐트·설치', '침구': '침구', '가구': '가구', '주방·조리': '조리·식기', '식기': '조리·식기',
  '아이스박스·음료': '음식·음료', '조명·전기': '조명·전기', '난방·냉방': '불·난방', '화로·불': '불·난방', '위생·세면': '위생·세면',
  '의류': '옷·신발', '안전·의약': '안전·기타', '아이용품': '아이·반려견', '반려견': '아이·반려견', '놀이·취미': '안전·기타',
  '차량·기타': '안전·기타', '장보기': '음식·음료', '동행': '안전·기타' };
var NAME_CAT = { '양념 세트(소금·후추·오일)': '음식·음료', '서큘레이터': '조명·전기', '모기 퇴치기·모기향': '안전·기타' };
function newCat_(name, cat) { return NAME_CAT[name] || CAT_MAP[cat] || cat; }

/** 기존 시트를 새 버전 구조로 1회 보정 */
function migrate_() {
  var p = props_(), v = Number(p.getProperty('SCHEMA_V') || 1);
  if (v >= 3) return;
  var ops = [];
  if (v < 2) readTable_('items').forEach(function (i) {
    if (!i.shared && DEFAULT_SHARED.indexOf(i.name) >= 0) ops.push({ t: 'items', id: i.id, set: { shared: 'Y' } });
  });
  if (ops.length) mutate_(ops, '업데이트');
  // v3: 카테고리 정리 (준비물 + 모든 캠핑 체크 줄 + 설정의 카테고리 순서)
  ops = [];
  readTable_('items').forEach(function (i) { var c = newCat_(i.name, i.category); if (c !== i.category) ops.push({ t: 'items', id: i.id, set: { category: c } }); });
  if (ops.length) mutate_(ops, '업데이트');
  ops = [];
  readTable_('lines').forEach(function (l) { var c = newCat_(l.name, l.category); if (c !== l.category) ops.push({ t: 'lines', id: l.id, set: { category: c } }); });
  if (ops.length) mutate_(ops, '업데이트');
  var cats = readTable_('settings').filter(function (r) { return r.key === '카테고리'; })[0];
  if (cats) {
    var old = cats.value.split(/[,，]/).map(function (x) { return x.trim(); }).filter(String);
    var extra = old.filter(function (c) { return !CAT_MAP[c] && NEW_CATEGORIES.indexOf(c) < 0; }); // 사용자가 만든 카테고리는 유지
    mutate_([{ t: 'settings', id: '카테고리', set: { value: NEW_CATEGORIES + (extra.length ? ', ' + extra.join(', ') : '') } }], '업데이트');
  }
  p.setProperty('SCHEMA_V', '3');
}

/* ───────────────────────── 시트 입출력 ───────────────────────── */

function sheet_(t) {
  var ss = SpreadsheetApp.getActive(), s = SCHEMA[t];
  var sh = ss.getSheetByName(s.sheet);
  if (!sh) { sh = ss.insertSheet(s.sheet); }
  return sh;
}

/** 머리글 이름 → 열 번호. 사용자가 열 순서를 바꾸거나 열을 지워도 동작 (빠진 열은 끝에 다시 생성) */
function headerMap_(sh, s) {
  var lastCol = Math.max(1, sh.getLastColumn());
  var head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  var byLabel = {}; head.forEach(function (h, i) { if (h) byLabel[h] = i; });
  var col = {}, missing = [];
  s.cols.forEach(function (c) {
    if (byLabel[c[1]] !== undefined) col[c[0]] = byLabel[c[1]];
    else missing.push(c);
  });
  var width = 0;
  head.forEach(function (h, i) { if (h) width = i + 1; });
  if (missing.length) {
    sh.getRange(1, width + 1, 1, missing.length)
      .setValues([missing.map(function (c) { return c[1]; })]).setFontWeight('bold');
    missing.forEach(function (c) { col[c[0]] = width; width++; });
  }
  return { col: col, width: Math.max(width, 1) };
}

function readTable_(t) {
  var s = SCHEMA[t], sh = sheet_(t);
  var hdr = headerMap_(sh, s);
  if (sh.getLastRow() < 2) return [];
  var data = sh.getRange(2, 1, sh.getLastRow() - 1, hdr.width).getValues();
  var keyField = s.key || (t === 'history' ? 'at' : 'id');
  var out = [];
  data.forEach(function (row) {
    if (!cell_(row[hdr.col[keyField]])) return;
    var o = {};
    s.cols.forEach(function (c) { o[c[0]] = cell_(row[hdr.col[c[0]]]); });
    out.push(o);
  });
  return out;
}

function cell_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    var hm = Utilities.formatDate(v, TZ, 'HH:mm');
    return Utilities.formatDate(v, TZ, hm === '00:00' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm');
  }
  if (typeof v === 'boolean') return v ? 'Y' : '';
  return String(v).trim();
}

function appendHistory_(rows) {
  var sh = sheet_('history');
  var hdr = headerMap_(sh, SCHEMA.history);
  var out = rows.map(function (r) {
    var row = []; for (var c = 0; c < hdr.width; c++) row.push('');
    SCHEMA.history.cols.forEach(function (c, i) { row[hdr.col[c[0]]] = r[i]; });
    return row;
  });
  sh.getRange(sh.getLastRow() + 1, 1, out.length, hdr.width).setNumberFormat('@').setValues(out);
}

/* ───────────────────────── 상태 값 ───────────────────────── */

function props_() { return PropertiesService.getScriptProperties(); }
function version_() { return Number(props_().getProperty('VERSION') || 1); }
function bumpVersion_() { var v = version_() + 1; props_().setProperty('VERSION', String(v)); return v; }
function familyCode_() { return props_().getProperty('FAMILY_CODE') || ''; }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function nowStr_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'); }
function addDays_(s, n) {
  var p = s.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
  return d.toISOString().slice(0, 10);
}
function newCode_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 20); }

/* ───────────────────────── 시트 메뉴 · 초기 설정 ───────────────────────── */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🏕️ 캠핑 준비')
    .addItem('1. 초기 설정 (처음 한 번)', 'setup')
    .addItem('2. 가족 초대 링크 보기', 'showInvite')
    .addSeparator()
    .addItem('드롭다운 목록 새로고침', 'refreshValidations')
    .addItem('알림 메일 지금 보내보기', 'dailyJob')
    .addItem('가족 이름·PIN 재설정', 'resetPin')
    .addItem('가족 코드 재발급 (기존 기기 연결 끊기)', 'resetCode')
    .addToUi();
}

function setup() {
  var ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(TZ);
  ss.setSpreadsheetLocale('ko_KR');
  // CSV 로 만든 시트는 첫 탭 이름이 다를 수 있음 → 준비물 탭으로 이름 변경
  if (!ss.getSheetByName(SCHEMA.items.sheet)) {
    var first = ss.getSheets()[0];
    if (first && String(first.getRange(1, 1).getValue()).trim() === 'id') first.setName(SCHEMA.items.sheet);
  }
  SHEET_ORDER.forEach(function (t, i) {
    var s = SCHEMA[t], sh = sheet_(t);
    if (sh.getLastColumn() === 0) sh.getRange(1, 1, 1, s.cols.length).setValues([s.cols.map(function (c) { return c[1]; })]);
    var hdr = headerMap_(sh, s);
    sh.getRange(1, 1, 1, hdr.width).setFontWeight('bold').setBackground('#e8f0e8');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), hdr.width).setNumberFormat('@');
    ss.setActiveSheet(sh); ss.moveActiveSheet(i + 1);
  });
  seedDefaults_();
  PROTECTED.forEach(function (t) {
    var sh = sheet_(t);
    sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); });
    sh.protect().setDescription('앱이 관리하는 탭입니다').setWarningOnly(true);
    sh.setTabColor('#999999');
  });
  refreshValidations();
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (['onSheetEdit', 'dailyJob'].indexOf(tr.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(tr);
  });
  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('dailyJob').timeBased().everyDays(1).atHour(8).inTimezone(TZ).create();
  if (!familyCode_()) props_().setProperty('FAMILY_CODE', newCode_());
  if (!props_().getProperty('VERSION')) props_().setProperty('VERSION', '1');
  ss.setActiveSheet(sheet_('items'));
  SpreadsheetApp.getUi().alert('✅ 초기 설정 완료',
    '다음 단계: [배포 > 새 배포] 로 웹 앱을 배포한 뒤, 메뉴 [🏕️ 캠핑 준비 > 2. 가족 초대 링크 보기] 를 누르세요.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function seedDefaults_() {
  var ops = [];
  if (!readTable_('boxes').length) DEFAULT_BOXES.forEach(function (n, i) {
    ops.push({ t: 'boxes', id: 'B-' + (i < 9 ? '0' : '') + (i + 1), set: { name: n, order: String(i + 1), active: 'Y' } });
  });
  var have = {};
  readTable_('settings').forEach(function (s) { have[s.key] = 1; });
  DEFAULT_SETTINGS.forEach(function (s) { if (!have[s[0]]) ops.push({ t: 'settings', id: s[0], set: { value: s[1], desc: s[2] } }); });
  if (ops.length) mutate_(ops, '초기 설정');
}

function settingList_(key) {
  var row = readTable_('settings').filter(function (r) { return r.key === key; })[0];
  return row ? row.value.split(/[,，]/).map(function (x) { return x.trim(); }).filter(String) : [];
}

function refreshValidations() {
  var rules = {
    items: {
      kind: ['물건', '할일'], category: settingList_('카테고리'),
      box: readTable_('boxes').filter(function (b) { return b.active !== 'N'; }).map(function (b) { return b.name; }),
      rule: ['고정', '가족당', '전체인원당', '어른당', '아이당', '반려견당', '박당', '가족×박', '전체×박'],
      leave: ['Y', 'N'], consumable: ['Y', 'N'], stock: ['충분', '부족', '없음'], active: ['Y', 'N'],
      owner: readTable_('members').map(function (m) { return m.name; }),
    },
    members: { type: ['어른', '아이', '영유아', '반려견'], active: ['Y', 'N'] },
    places: { active: ['Y', 'N'] },
    boxes: { active: ['Y', 'N'] },
  };
  Object.keys(rules).forEach(function (t) {
    var sh = sheet_(t), hdr = headerMap_(sh, SCHEMA[t]);
    Object.keys(rules[t]).forEach(function (f) {
      var vals = rules[t][f];
      var rng = sh.getRange(2, hdr.col[f] + 1, Math.max(1, sh.getMaxRows() - 1), 1);
      if (!vals.length) { rng.clearDataValidations(); return; }
      rng.setDataValidation(SpreadsheetApp.newDataValidation()
        .requireValueInList(vals, true).setAllowInvalid(true)
        .setHelpText('목록에서 고르세요 (앱 규칙 점검에서 오류로 표시됩니다)').build());
    });
  });
}

function showInvite() {
  var ui = SpreadsheetApp.getUi(), p = props_();
  if (!familyCode_()) { ui.alert('먼저 [1. 초기 설정] 을 실행하세요.'); return; }
  var url = p.getProperty('WEBAPP_URL') || '';
  if (!/\/exec$/.test(url)) {
    var guess = '';
    try { guess = ScriptApp.getService().getUrl() || ''; } catch (e) {}
    var r = ui.prompt('웹 앱 주소 입력',
      '[배포 > 배포 관리] 에 있는 웹 앱 URL(…/exec 로 끝나는 주소)을 붙여넣으세요.' + (/\/exec$/.test(guess) ? '\n\n추정 주소: ' + guess : ''),
      ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return;
    url = r.getResponseText().trim() || guess;
    if (!/^https:\/\/script\.google\.com\/.*\/exec$/.test(url)) { ui.alert('주소 형식이 맞지 않아요. …/exec 로 끝나야 합니다.'); return; }
    p.setProperty('WEBAPP_URL', url);
  }
  var link = APP_URL + '#api=' + encodeURIComponent(url) + '&k=' + familyCode_();
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;font-size:14px">' +
    '<p>아래 링크를 <b>휴대폰에서</b> 열면 연결됩니다. 가족에게도 이 링크를 보내세요 (카톡 등).</p>' +
    '<textarea id="l" style="width:100%;height:90px" readonly>' + link + '</textarea>' +
    '<p><button onclick="var t=document.getElementById(\'l\');t.select();document.execCommand(\'copy\');this.textContent=\'복사됨 ✓\'">링크 복사</button> ' +
    '<a href="' + link + '" target="_blank">지금 열기</a></p>' +
    '<p style="color:#888">⚠️ 이 링크를 아는 사람은 누구나 데이터를 보고 수정할 수 있어요. 가족에게만 공유하세요. ' +
    '유출되면 메뉴의 [가족 코드 재발급] 으로 막을 수 있습니다.</p></div>')
    .setWidth(520).setHeight(330);
  ui.showModalDialog(html, '👨‍👩‍👧 가족 초대 링크');
}

function resetCode() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.alert('가족 코드 재발급', '모든 기기의 연결이 끊깁니다. 새 초대 링크로 다시 연결해야 해요. 계속할까요?', ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  props_().setProperty('FAMILY_CODE', newCode_());
  showInvite();
}

function resetPin() {
  var ui = SpreadsheetApp.getUi();
  var f = ui.prompt('가족 이름', '앱 로그인에 쓸 가족 이름 (예: 종원네캠핑)', ui.ButtonSet.OK_CANCEL);
  if (f.getSelectedButton() !== ui.Button.OK) return;
  var pin = ui.prompt('새 PIN', '숫자 6자리', ui.ButtonSet.OK_CANCEL);
  if (pin.getSelectedButton() !== ui.Button.OK) return;
  props_().deleteProperty('PIN_HASH');
  var r = setPin_(f.getResponseText(), pin.getResponseText().trim(), '');
  CacheService.getScriptCache().remove('LOGIN_FAILS');
  ui.alert(r.ok ? '✅ 설정 완료 — 모든 기기에서 새 PIN으로 다시 로그인하세요.' : '⚠️ ' + r.error);
}

/** 시트에서 직접 수정한 내용 → 변경이력 기록 + 앱 새로고침 신호 */
function onSheetEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet(), name = sh.getName();
  var t = null;
  Object.keys(SCHEMA).forEach(function (k) { if (SCHEMA[k].sheet === name) t = k; });
  if (!t || t === 'history') return;
  bumpVersion_();
  var s = SCHEMA[t];
  if (!s.log || e.range.getRow() === 1) return;
  var user = (e.user && e.user.getEmail && e.user.getEmail()) || '시트';
  var rows = e.range.getNumRows(), cols = e.range.getNumColumns();
  var hdr = headerMap_(sh, s);
  var keyCol = hdr.col[s.key || 'id'];
  var key = cell_(sh.getRange(e.range.getRow(), keyCol + 1).getValue());
  if (rows === 1 && cols === 1) {
    var label = cell_(sh.getRange(1, e.range.getColumn()).getValue());
    var nameCol = hdr.col.name;
    var nm = nameCol !== undefined ? cell_(sh.getRange(e.range.getRow(), nameCol + 1).getValue()) : key;
    appendHistory_([[nowStr_(), user, s.log, key, '시트 수정',
      nm + ' — ' + label + ': ' + (e.oldValue === undefined ? '∅' : e.oldValue) + ' → ' + (e.value === undefined ? '∅' : e.value)]]);
  } else {
    appendHistory_([[nowStr_(), user, s.log, key, '시트 대량 수정', rows + '행 × ' + cols + '열 (' + e.range.getA1Notation() + ')']]);
  }
}

/* ───────────────────────── 이메일 알림 ───────────────────────── */

function dailyJob() {
  var setting = readTable_('settings').filter(function (r) { return r.key === '이메일알림'; })[0];
  if (setting && String(setting.value).toUpperCase() === 'N') return;
  var today = today_(), d2 = addDays_(today, 2);
  var trips = readTable_('trips').filter(function (t) { return t.status !== '보관'; });
  var lines = null;
  var members = readTable_('members').filter(function (m) { return m.active !== 'N' && m.email; });
  var to = members.map(function (m) { return m.email; });
  if (!to.length) to = [Session.getEffectiveUser().getEmail()];
  trips.forEach(function (t) {
    if (t.start === d2) {
      lines = lines || readTable_('lines');
      var mine = lines.filter(function (l) {
        return l.tripId === t.id && l.deleted !== 'Y' && l.kind !== '수납함' && l.kind !== '정산' && (!l.party || l.party === '우리');
      });
      var left = mine.filter(function (l) { return !l.pack && !l.done; });
      var todo = left.filter(function (l) { return l.kind === '할일' || l.kind === '장보기'; });
      var undecided = lines.filter(function (l) { return l.tripId === t.id && l.deleted !== 'Y' && l.party === '미정'; }).length;
      var body = '<h3>🏕️ ' + esc_(t.title) + ' — 이틀 남았어요 (' + t.start + ')</h3>' +
        '<p>아직 안 챙긴 것 <b>' + left.length + '</b>개 (할 일·장보기 ' + todo.length + '개)' +
        (undecided ? ' · 누가 가져올지 안 정한 것 <b>' + undecided + '</b>개' : '') + '</p>' +
        '<ul>' + todo.slice(0, 15).map(function (l) { return '<li>' + esc_(l.name) + '</li>'; }).join('') + '</ul>' +
        '<p><a href="' + APP_URL + '">앱 열기</a></p>';
      MailApp.sendEmail({ to: to.join(','), subject: '[캠핑 준비] ' + t.title + ' D-2', htmlBody: body });
    }

  });
}

function esc_(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
