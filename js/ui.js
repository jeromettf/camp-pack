/* camp-pack 화면 공용 도구: DOM 생성, 바텀시트, 토스트, 칩, 날짜 */
(function () {
  'use strict';

  /** h('div.card', {onclick}, '텍스트', child...) */
  function h(sel, props) {
    var m = /^([a-z0-9]+)?((?:\.[\w-]+)*)$/i.exec(sel) || [];
    var el = document.createElement(m[1] || 'div');
    if (m[2]) el.className = m[2].split('.').filter(Boolean).join(' ');
    var kids = Array.prototype.slice.call(arguments, 2);
    if (props && (typeof props !== 'object' || props.nodeType || Array.isArray(props))) { kids.unshift(props); props = null; }
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'style') el.setAttribute('style', v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    append(el, kids);
    return el;
  }
  function append(el, kids) {
    kids.forEach(function (c) {
      if (c == null || c === false) return;
      if (Array.isArray(c)) return append(el, c);
      el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    });
  }

  /* ── 날짜 (한국 시간 기준) ── */
  function today() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  }
  function nowStr() {
    var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).reduce(function (o, x) { o[x.type] = x.value; return o; }, {});
    return p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute;
  }
  var WD = ['일', '월', '화', '수', '목', '금', '토'];
  function md(s, withDay) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); if (!m) return '';
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return (+m[2]) + '/' + (+m[3]) + (withDay ? '(' + WD[d.getUTCDay()] + ')' : '');
  }
  function range(a, b) { return a === b || !b ? md(a, true) : md(a, true) + ' ~ ' + md(b, true); }

  /* ── 바텀시트 ── */
  var sheetStack = [];
  function sheet(title, body, actions) {
    var back = h('div.sheet-back');
    var panel = h('div.sheet', { role: 'dialog', 'aria-label': title },
      h('div.sheet-head', h('b', title), h('button.icon', { onclick: close, 'aria-label': '닫기' }, '✕')),
      h('div.sheet-body', body),
      actions && actions.length ? h('div.sheet-actions', actions) : null);
    function close() {
      back.remove(); panel.remove();
      sheetStack = sheetStack.filter(function (x) { return x !== close; });
    }
    back.addEventListener('click', close);
    document.body.appendChild(back); document.body.appendChild(panel);
    sheetStack.push(close);
    var f = panel.querySelector('input:not([type=checkbox]),textarea');
    if (f && !f.hasAttribute('data-nofocus')) setTimeout(function () { f.focus(); }, 50);
    return close;
  }
  function closeSheets() { sheetStack.slice().forEach(function (c) { c(); }); }

  /** 확인 다이얼로그 (confirm 대체) */
  function ask(title, msg, okLabel, onOk, danger) {
    var close = sheet(title, h('p', msg), [
      h('button.btn', { onclick: function () { close(); } }, '취소'),
      h('button.btn.' + (danger ? 'danger' : 'primary'), { onclick: function () { close(); onOk(); } }, okLabel),
    ]);
  }

  /* ── 토스트 ── */
  var toastEl = null, toastTimer = null;
  function toast(msg, undo) {
    if (toastEl) toastEl.remove();
    clearTimeout(toastTimer);
    toastEl = h('div.toast', { role: 'status' }, h('span', msg),
      undo ? h('button', { onclick: function () { undo(); toastEl.remove(); } }, '되돌리기') : null);
    document.body.appendChild(toastEl);
    var el = toastEl;
    toastTimer = setTimeout(function () { el.remove(); }, undo ? 4000 : 2500);
  }

  /* ── 칩 선택 ── */
  function chips(options, selected, onToggle, opts) {
    opts = opts || {};
    return h('div.chips', options.map(function (o) {
      var val = typeof o === 'object' ? o.value : o, label = typeof o === 'object' ? o.label : o;
      var on = selected.indexOf(val) >= 0;
      var cls = 'chip' + (on ? ' on' : '') + (opts.auto && opts.auto.indexOf(val) >= 0 ? ' auto' : '');
      return h('button', { class: cls, type: 'button', 'aria-pressed': on ? 'true' : 'false', onclick: function () { onToggle(val, !on); } }, label);
    }));
  }
  function seg(options, value, onPick) {
    return h('div.seg', options.map(function (o) {
      var val = typeof o === 'object' ? o.value : o, label = typeof o === 'object' ? o.label : o;
      return h('button', { type: 'button', class: val === value ? 'on' : '', onclick: function () { onPick(val); } }, label);
    }));
  }
  function stepper(value, onChange, min) {
    min = min == null ? 0 : min;
    return h('div.stepper',
      h('button', { type: 'button', 'aria-label': '줄이기', onclick: function () { if (value > min) onChange(value - 1); } }, '−'),
      h('span', String(value)),
      h('button', { type: 'button', 'aria-label': '늘리기', onclick: function () { onChange(value + 1); } }, '+'));
  }
  function field(label, input, hint) {
    return h('label.field', h('span.lbl', label), input, hint ? h('small.hint', hint) : null);
  }
  function bar(done, total) {
    var pct = total ? Math.round(done / total * 100) : 0;
    return h('div.bar', { title: done + '/' + total }, h('i', { style: 'width:' + pct + '%' }));
  }

  /** 자동완성 입력 */
  function autocomplete(input, getOptions, onPick) {
    var box = h('div.ac');
    function update() {
      var q = input.value.trim();
      box.innerHTML = '';
      if (!q) return;
      getOptions(q).slice(0, 6).forEach(function (o) {
        box.appendChild(h('button', { type: 'button', onclick: function () { onPick(o); box.innerHTML = ''; } }, o.label));
      });
    }
    input.addEventListener('input', update);
    return box;
  }

  window.UI = { h: h, today: today, nowStr: nowStr, md: md, range: range, sheet: sheet, closeSheets: closeSheets,
    ask: ask, toast: toast, chips: chips, seg: seg, stepper: stepper, field: field, bar: bar, autocomplete: autocomplete };
})();
