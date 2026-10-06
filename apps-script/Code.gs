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
    ['memo', '메모'], ['active', '활성'], ['updatedAt', '수정일']] },
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
    ['memo', '메모'], ['reviewed', '회고완료'], ['createdBy', '생성자'], ['createdAt', '생성일'], ['updatedAt', '수정일']] },
  lines: { sheet: '체크', cols: [
    ['id', 'id'], ['tripId', '캠핑id'], ['kind', '종류'], ['itemId', '항목id'], ['name', '이름'], ['category', '카테고리'],
    ['box', '수납함'], ['qty', '수량'], ['owner', '담당자'], ['leave', '두고오기쉬움'], ['warn', '주의'], ['note', '메모'],
    ['source', '출처'], ['pack', '짐싸기'], ['load', '싣기'], ['back', '철수'], ['done', '완료'], ['deleted', '삭제'],
    ['updatedAt', '수정일']] },
  reviews: { sheet: '회고', cols: [
    ['id', 'id'], ['tripId', '캠핑id'], ['itemId', '항목id'], ['name', '이름'], ['result', '결과'], ['qty', '수량'],
    ['by', '작성자'], ['at', '시각']] },
  settings: { sheet: '설정', key: 'key', log: '설정', cols: [['key', '키'], ['value', '값'], ['desc', '설명']] },
  history: { sheet: '변경이력', readonly: true, cols: [
    ['at', '시각'], ['by', '사용자'], ['target', '대상'], ['targetId', '대상id'], ['action', '동작'], ['detail', '내용']] },
};
var SHEET_ORDER = ['items', 'boxes', 'places', 'members', 'trips', 'lines', 'reviews', 'settings', 'history'];

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
  ['카테고리', '할 일, 텐트·쉘터, 침구, 가구, 주방·조리, 식기, 아이스박스·음료, 조명·전기, 난방·냉방, 화로·불, 위생·세면, 의류, 안전·의약, 아이용품, 반려견, 놀이·취미, 차량·기타', '준비물 카테고리 (표시 순서)'],
  ['이메일알림', 'Y', 'D-2 준비 알림·D+1 회고 요청 메일 (Y/N)'],
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
  if (!req.k || req.k !== familyCode_()) return json_({ ok: false, code: 'auth', error: '가족 코드가 맞지 않아요' });
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
  var today = today_();
  var recentFrom = addDays_(today, -10);
  var trips = readTable_('trips');
  var live = {};
  trips.forEach(function (t) { if (t.status !== '보관' && (!t.end || t.end >= recentFrom)) live[t.id] = 1; });
  return {
    ok: true, version: version_(),
    meta: { today: today, sheetUrl: SpreadsheetApp.getActive().getUrl(), app: APP_URL },
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
function mutate_(ops, by) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var now = nowStr_(), logs = [], groups = {}, applied = 0;
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
        if (isNew) {
          row = []; for (var c = 0; c < hdr.width; c++) row.push('');
          row[hdr.col[keyField]] = String(op.id);
          data.push(row); i = data.length - 1; index[String(op.id)] = i; appended.push(i);
        } else row = data[i];
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
    return { ok: true, applied: applied, version: v };
  } finally {
    lock.releaseLock();
  }
}

function describe_(s, row, hdr, changes, isNew) {
  var name = hdr.col.name !== undefined ? cell_(row[hdr.col.name]) : (hdr.col.key !== undefined ? cell_(row[hdr.col.key]) : '');
  if (isNew) return name;
  var label = {}; s.cols.forEach(function (c) { label[c[0]] = c[1]; });
  return name + ' — ' + changes.filter(function (c) { return c[0] !== 'updatedAt'; })
    .map(function (c) { return label[c[0]] + ': ' + (c[1] || '∅') + ' → ' + (c[2] || '∅'); }).join(', ');
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
  var today = today_(), d2 = addDays_(today, 2), d1 = addDays_(today, -1);
  var trips = readTable_('trips').filter(function (t) { return t.status !== '보관'; });
  var lines = null;
  var members = readTable_('members').filter(function (m) { return m.active !== 'N' && m.email; });
  var to = members.map(function (m) { return m.email; });
  if (!to.length) to = [Session.getEffectiveUser().getEmail()];
  trips.forEach(function (t) {
    if (t.start === d2) {
      lines = lines || readTable_('lines');
      var mine = lines.filter(function (l) { return l.tripId === t.id && l.deleted !== 'Y'; });
      var todo = mine.filter(function (l) { return (l.kind === '할일' || l.kind === '장보기') && !l.done; });
      var pack = mine.filter(function (l) { return l.kind === '물건' && !l.pack; });
      var byOwner = {};
      pack.forEach(function (l) { var o = l.owner || '담당 미정'; byOwner[o] = (byOwner[o] || 0) + 1; });
      var body = '<h3>🏕️ ' + esc_(t.title) + ' — 이틀 남았어요 (' + t.start + ')</h3>' +
        '<p>남은 할 일 <b>' + todo.length + '</b>개 · 아직 안 챙긴 짐 <b>' + pack.length + '</b>개</p>' +
        '<ul>' + todo.slice(0, 15).map(function (l) { return '<li>' + esc_(l.name) + '</li>'; }).join('') + '</ul>' +
        '<p>' + Object.keys(byOwner).map(function (o) { return esc_(o) + ' ' + byOwner[o] + '개'; }).join(' · ') + '</p>' +
        '<p><a href="' + APP_URL + '">앱 열기</a></p>';
      MailApp.sendEmail({ to: to.join(','), subject: '[캠핑 준비] ' + t.title + ' D-2', htmlBody: body });
    }
    if (t.end === d1 && t.reviewed !== 'Y') {
      MailApp.sendEmail({ to: to.join(','), subject: '[캠핑 준비] ' + t.title + ' 30초 회고',
        htmlBody: '<p>즐거운 캠핑이었나요? 안 쓴 것·부족했던 것을 30초만 기록하면 다음 준비가 더 쉬워져요.</p>' +
          '<p><a href="' + APP_URL + '#/review/' + t.id + '">회고 남기기</a></p>' });
    }
  });
}

function esc_(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
