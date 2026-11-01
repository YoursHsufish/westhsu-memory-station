/* 记忆小站 · 复习单生成
 *
 * 纯读取：只读本机存档（localStorage），不写任何数据、不联网。
 * 用途：把一段时间内答错或还没记牢的字词挑出来，排成可打印的一页。
 */
(function () {
  'use strict';

  var EN_UNITS = window.EN_UNITS || [];
  var ZH_UNITS = window.ZH_UNITS || [];
  var PY_UNITS = window.PY_UNITS || [];

  var EN = {}, ZH = {}, PY = {};
  EN_UNITS.forEach(function (u) {
    u.words.forEach(function (a) {
      var id = String(a[0]).toLowerCase();
      if (!EN[id]) EN[id] = { id: id, w: a[0], zh: a[1], pos: a[2] || '' };
    });
  });
  ZH_UNITS.forEach(function (u) {
    u.words.forEach(function (a) {
      if (!ZH[a[0]]) ZH[a[0]] = { id: a[0], c: a[0], pinyin: a[1], radical: a[2], strokes: a[3], mean: a[4], words: a[5] || '' };
    });
  });
  PY_UNITS.forEach(function (u) {
    u.words.forEach(function (a) {
      if (!PY[a[0]]) PY[a[0]] = { id: a[0], pinyin: a[0], c: a[1], word: a[2] || '', base: a[3] || '', tone: a[4], type: u.id === 'py_sm' ? '声母' : u.id === 'py_ym' ? '韵母' : u.id === 'py_zt' ? '整体认读' : '音节' };
    });
  });

  var MODS = [
    { key: 'zh_recog', name: '中文认字', kind: 'zh' },
    { key: 'zh_dict', name: '中文听写', kind: 'zh' },
    { key: 'en_recog', name: '英语认词', kind: 'en' },
    { key: 'en_spell', name: '英语拼写', kind: 'en' },
    { key: 'py_recog', name: '拼音认读', kind: 'py' },
    { key: 'py_spell', name: '拼音拼写', kind: 'py' }
  ];

  var el = function (id) { return document.getElementById(id); };
  var picked = {};       // 选中的模块
  var lastBuilt = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function today() {
    var d = new Date();
    var p = function (n) { return n < 10 ? '0' + n : n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function shift(days) {
    var d = new Date();
    d.setDate(d.getDate() + days);
    var p = function (n) { return n < 10 ? '0' + n : n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function profileById(id) {
    var list = (window.Store && Store.listProfiles) ? Store.listProfiles() : [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[0] || null;
  }

  /* ================= 初始化控件 ================= */
  function qs(key) {
    try {
      var m = new RegExp('[?&]' + key + '=([^&#]*)').exec(location.search);
      return m ? decodeURIComponent(m[1]) : '';
    } catch (e) { return ''; }
  }

  function initControls() {
    var profiles = (window.Store && Store.listProfiles) ? Store.listProfiles() : [];
    var sel = el('fProfile');
    if (!profiles.length) {
      sel.innerHTML = '<option>（没有档案）</option>';
    } else {
      var active = Store.activeProfile();
      sel.innerHTML = profiles.map(function (p) {
        return '<option value="' + esc(p.id) + '"' + (active && p.id === active.id ? ' selected' : '') + '>' +
          esc((p.avatar || '') + ' ' + p.name) + '</option>';
      }).join('');
    }

    el('fFrom').value = today();
    el('fTo').value = today();

    // 只列出这段时间有记录的模块，默认全选
    var box = el('fMods');
    var has = {};
    MODS.forEach(function (m) {
      var p = profileById(sel.value);
      var recs = (p && p.data && p.data[m.key]) || {};
      has[m.key] = Object.keys(recs).length > 0;
    });
    box.innerHTML = MODS.map(function (m) {
      if (!has[m.key]) return '';
      picked[m.key] = true;
      return '<span class="chip on" data-mod="' + m.key + '">' + m.name + '</span>';
    }).join('') || '<span class="chip" style="cursor:default">还没有任何练习记录</span>';

    box.onclick = function (e) {
      var t = e.target;
      if (!t || !t.getAttribute || !t.getAttribute('data-mod')) return;
      var k = t.getAttribute('data-mod');
      if (picked[k]) { delete picked[k]; t.classList.remove('on'); }
      else { picked[k] = true; t.classList.add('on'); }
    };

    // 从 App 里点「打印这份清单」过来时带上参数：print.html?rule=focus
    var urlRule = qs('rule');
    if (urlRule && el('fRule').querySelector('option[value="' + urlRule + '"]')) {
      el('fRule').value = urlRule;
      if (urlRule === 'focus') {
        // 重点练清单是"累计"概念，不受日期限制：默认放开到 90 天
        el('fFrom').value = shift(-90);
      }
    }

    el('btnBuild').onclick = build;
    el('btnPrint').onclick = function () { window.print(); };
  }

  /* ================= 收集 ================= */
  function collect() {
    var p = profileById(el('fProfile').value);
    if (!p) return [];
    var from = el('fFrom').value || today();
    var to = el('fTo').value || today();
    if (from > to) { var t = from; from = to; to = t; }
    var rule = el('fRule').value;
    // 重点练清单是累计判断，不按日期卡
    var byDate = rule !== 'focus';

    var out = [];
    MODS.forEach(function (m) {
      if (!picked[m.key]) return;
      var recs = (p.data && p.data[m.key]) || {};
      Object.keys(recs).forEach(function (id) {
        var r = recs[id];
        if (!r) return;
        var last = r.last || r.first || '';
        if (byDate && (!last || last < from || last > to)) return;

        var w = Number(r.w || 0);
        var h = Number(r.h || 0);
        var s = Number(r.s || 0);
        var keep = true;
        if (rule === 'focus') keep = (window.SRS && SRS.needFocus) ? SRS.needFocus(r) : (w >= 2 || h >= 2);
        else if (rule === 'weak') keep = (w > 0) || (s <= 2);
        else if (rule === 'wrong') keep = w > 0;
        else if (rule === 'low') keep = s <= 2;

        if (!keep) return;
        out.push({
          mod: m, id: id, rec: r, w: w, h: h, s: s, last: last,
          score: (window.SRS && SRS.focusScore) ? SRS.focusScore(r) : (w * 2 + h)
        });
      });
    });

    // 重点练：最难的排前面；其它规则：先按模块，再按错误次数
    out.sort(function (a, b) {
      if (a.mod.key !== b.mod.key) return a.mod.key < b.mod.key ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      if (b.w !== a.w) return b.w - a.w;
      return a.s - b.s;
    });
    return out;
  }

  /* ================= 渲染条目 ================= */
  function blank(w) { return '<span class="blank' + (w ? ' wide' : '') + '"></span>'; }

  /** 右上角小标签：错 x 次 · 模糊 y 次 */
  function countTag(it) {
    var a = [];
    if (it.w) a.push('错 ' + it.w + ' 次');
    if (it.h) a.push('模糊 ' + it.h + ' 次');
    return a.join(' · ') || it.mod.name;
  }

  function itemHtml(it, showAnswer) {
    var show = showAnswer !== false;
    if (it.mod.kind === 'zh') {
      var z = ZH[it.id];
      if (!z) return '';
      return '<div class="item">' +
        '<div class="item-top"><span class="big">' + esc(z.c) + '</span>' +
        '<span class="tag">' + esc(countTag(it)) + '</span></div>' +
        '<div class="py">' + (show ? esc(z.pinyin) : blank()) + '</div>' +
        (show
          ? '<div class="mean">' + esc(z.mean || '') + '</div>' +
            (z.words ? '<div class="words">组词：' + esc(z.words) + '</div>' : '')
          : '<div class="mean">' + blank(true) + '</div><div class="words">组词：' + blank(true) + '</div>') +
        '</div>';
    }

    if (it.mod.kind === 'en') {
      var e = EN[it.id];
      if (!e) return '';
      return '<div class="item">' +
        '<div class="item-top"><span class="big en">' + esc(e.w) + '</span>' +
        '<span class="tag">' + esc(countTag(it)) + '</span></div>' +
        (show
          ? '<div class="mean">' + esc((e.pos ? e.pos + ' ' : '') + e.zh) + '</div>'
          : '<div class="py">' + blank(true) + '</div><div class="mean">' + blank(true) + '</div>') +
        '</div>';
    }

    var y = PY[it.id];
    if (!y) return '';
    return '<div class="item">' +
      '<div class="item-top"><span class="big py">' + esc(y.pinyin) + '</span>' +
      '<span class="tag">' + esc(it.w || it.h ? countTag(it) : (y.type || '拼音')) + '</span></div>' +
      (show
        ? '<div class="py">例字：' + esc(y.c || '') + (y.word ? '　例词：' + esc(y.word) : '') + '</div>'
        : '<div class="py">例字：' + blank() + '　例词：' + blank(true) + '</div>') +
      '</div>';
  }

  /* ================= 生成 ================= */
  function build() {
    var items = collect();
    var cols = el('fCols').value;
    var showAnswer = el('fShow').value === '1';
    var p = profileById(el('fProfile').value);
    var from = el('fFrom').value, to = el('fTo').value;
    if (from > to) { var t = from; from = to; to = t; }

    el('fCount').textContent = items.length ? '共 ' + items.length + ' 个' : '';

    if (!items.length) {
      el('paper').innerHTML = '<div class="empty">' +
        (el('fRule').value === 'focus'
          ? '还没有需要重点练的字词。<br>同一个字词答错 2 次、或「有点模糊」2 次以上，就会出现在这里。'
          : '这段时间里没有符合条件的字词。<br>试试把「起始日期」往前调（比如近 7 天），或把筛选条件改成「这段时间练过的全部」。') +
        '</div>';
      lastBuilt = null;
      return;
    }

    var modNames = [];
    items.forEach(function (it) { if (modNames.indexOf(it.mod.name) < 0) modNames.push(it.mod.name); });

    var isFocus = el('fRule').value === 'focus';
    var rangeText = isFocus ? '累计（不看日期）' : (esc(from) + (from === to ? '' : ' ~ ' + esc(to)));
    var titleText = isFocus ? '重点练清单' : '复习单';

    var html = '<div class="sheet-head">' +
      '<div class="sheet-title">' + esc((p ? p.name + ' · ' : '') + titleText) + '</div>' +
      '<div class="sheet-meta">' + rangeText + '<br>' +
      esc(modNames.join(' / ')) + '　共 ' + items.length + ' 个</div>' +
      '</div>' +
      '<div class="sheet-fill">姓名：<span></span>　　日期：<span></span>　　家长签字：<span></span></div>' +
      '<div class="grid c' + esc(cols) + '">' +
      items.map(function (it) { return itemHtml(it, showAnswer); }).join('') +
      '</div>';

    el('paper').innerHTML = html;
    lastBuilt = { items: items.length, cols: cols };
  }

  function boot() {
    if (!window.Store) {
      el('paper').innerHTML = '<div class="empty">存档模块没加载成功，请刷新页面重试。</div>';
      return;
    }
    Store.load();
    initControls();
    build();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.PrintSheet = { build: build, collect: collect };
})();
