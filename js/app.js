/*!
 * app.js —— 记忆小站 主程序
 * 网页应用：不登录时数据只在本机 localStorage；登录后另存一份到云端，
 * 由数据库行级安全按账号隔离（见 js/cloud.js）。
 */
(function () {
  'use strict';

  var view = document.getElementById('view');
  var tabbar = document.getElementById('tabbar');
  var sheetMask = document.getElementById('sheetMask');
  var sheet = document.getElementById('sheet');
  var toastEl = document.getElementById('toast');

  var Cloud = window.Cloud || null;   // 云端同步层（可选，缺失时退化为纯本地）
  var STR = window.STRINGS || {};     // 界面文案表（js/strings.js）

  /** 取文案：strings.js 里留空或没写 → 用默认值，保证改坏也不影响使用 */
  function t(key, dflt) {
    var v = STR[key];
    return (v === null || v === undefined || v === '') ? dflt : String(v);
  }

  var META = window.APP_META || {
    name: '记忆小站', subtitle: '', version: '1.0.0', build: '', author: '', contact: '', license: 'MIT', copyright: ''
  };

  var ROUTES = ['home', 'study', 'progress', 'me', 'lib'];
  var sessionRoot = null;
  var S = null;            // 当前会话状态
  var pendingTimer = null;

  /* ================= 工具 ================= */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.classList.remove('show'); }, 1900);
  }
  function shuffle(a) {
    var arr = a.slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }

  function fmtTime(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    var p2 = function (n) { return n < 10 ? '0' + n : n; };
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
      ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }

  /** 识别当前浏览器，避免用户在"错误的浏览器"里找不到进度 */
  function browserName() {
    var ua = (navigator && navigator.userAgent) || '';
    if (/QIHU 360EE|360EE/i.test(ua)) return '360 极速浏览器';
    if (/QIHU 360SE|360SE/i.test(ua)) return '360 安全浏览器';
    if (/Edg\//.test(ua)) return 'Microsoft Edge';
    if (/OPR\//.test(ua)) return 'Opera';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Chrome\//.test(ua)) return 'Chrome';
    if (/Safari\//.test(ua)) return 'Safari';
    return '未知浏览器';
  }

  function daysSince(ts) {
    if (!ts) return Infinity;
    return Math.floor((Date.now() - ts) / 86400000);
  }

  /* ================= 词库索引 ================= */
  var EN_INDEX = {};   // id -> {w, zh, pos, unit}
  var ZH_INDEX = {};
  var PY_INDEX = {};
  var EN_UNITS = window.EN_UNITS || [];
  var ZH_UNITS = window.ZH_UNITS || [];
  var PY_UNITS = window.PY_UNITS || [];

  // 六项练习（英语 2 + 中文 2 + 拼音 2），结构完全一致
  var MODS = ['en_recog', 'en_spell', 'zh_recog', 'zh_dict', 'py_recog', 'py_spell'];
  var SUBJECTS = [
    { key: 'en', name: '英语', icon: '📘', mods: ['en_recog', 'en_spell'] },
    { key: 'zh', name: '中文', icon: '📗', mods: ['zh_recog', 'zh_dict'] },
    { key: 'py', name: '拼音', icon: '🎵', mods: ['py_recog', 'py_spell'] }
  ];
  var GRADE_NAMES = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'];
  var TEXTBOOKS = ['人教版 PEP', '外研版', '译林版', '北师大版', '闽教版', '通用课标'];

  EN_UNITS.forEach(function (u) {
    u.words.forEach(function (arr) {
      var id = String(arr[0]).toLowerCase();
      if (!EN_INDEX[id]) {
        EN_INDEX[id] = { id: id, w: arr[0], zh: arr[1], pos: arr[2] || '', unit: u.name, grade: u.grade, unitId: u.id };
      }
    });
  });
  ZH_UNITS.forEach(function (u) {
    u.words.forEach(function (arr) {
      var id = arr[0];
      if (!ZH_INDEX[id]) {
        ZH_INDEX[id] = { id: id, c: arr[0], pinyin: arr[1], radical: arr[2], strokes: arr[3], mean: arr[4], words: arr[5] || '', unit: u.name, unitId: u.id };
      }
    });
  });

  PY_UNITS.forEach(function (u) {
    u.words.forEach(function (arr) {
      var id = arr[0];
      if (!PY_INDEX[id]) {
        PY_INDEX[id] = {
          id: id,
          pinyin: arr[0],
          c: arr[1],
          word: arr[2] || '',
          base: arr[3] || '',
          tone: arr[4] == null ? 0 : Number(arr[4]),
          spell: arr[3] != null && arr[4] != null,
          unit: u.name,
          unitId: u.id,
          grade: u.grade,
          type: u.id === 'py_sm' ? '声母' : u.id === 'py_ym' ? '韵母' : u.id === 'py_zt' ? '整体认读' : '音节'
        };
      }
    });
  });

  function unitsOf(kind) {
    return kind === 'en' ? EN_UNITS : kind === 'zh' ? ZH_UNITS : PY_UNITS;
  }

  /** 按年级 + 教材推算学习范围（只会包含本年级及以下内容） */
  function scopeUnits(grade, startEn) {
    var g = Math.max(1, Math.min(6, Number(grade) || 1));
    var enGrade = startEn === 1 ? g : Math.max(3, g);
    enGrade = Math.max(1, Math.min(6, enGrade));
    var enIds = EN_UNITS.filter(function (u) { return u.grade <= enGrade; }).map(function (u) { return u.id; });
    if (!enIds.length) {
      var minG = Math.min.apply(null, EN_UNITS.map(function (u) { return u.grade; }));
      enIds = EN_UNITS.filter(function (u) { return u.grade === minG; }).map(function (u) { return u.id; });
    }
    return {
      unitsEn: enIds,
      unitsZh: ZH_UNITS.slice(0, g).map(function (u) { return u.id; }),
      unitsPy: PY_UNITS.filter(function (u) { return u.grade <= g; }).map(function (u) { return u.id; })
    };
  }

  /** 把存档里的年级配置落成具体单元范围（不删除已有学习记录） */
  function applyGradeScope(profile) {
    if (!profile) return;
    var st = profile.settings;
    var scope = scopeUnits(st.grade, st.startEn);
    Store.updateSettings(profile.id, scope);
  }

  function enabledUnitIds(kind) {
    var p = Store.activeProfile();
    var key = kind === 'en' ? 'unitsEn' : kind === 'zh' ? 'unitsZh' : 'unitsPy';
    var saved = (p && p.settings[key]) || [];
    var all = unitsOf(kind).map(function (u) { return u.id; });
    return saved.filter(function (id) { return all.indexOf(id) >= 0; }).length ? saved : all;
  }

  function isUnitOn(kind, id) {
    var p = Store.activeProfile();
    var key = kind === 'en' ? 'unitsEn' : kind === 'zh' ? 'unitsZh' : 'unitsPy';
    var saved = (p && p.settings[key]) || [];
    if (!saved.length) return true;
    return saved.indexOf(id) >= 0;
  }

  function itemsOf(kind) {
    var unitIds = enabledUnitIds(kind);
    var units = unitsOf(kind).filter(function (u) { return unitIds.indexOf(u.id) >= 0; });
    var out = [];
    units.forEach(function (u) {
      u.words.forEach(function (arr) {
        var id = kind === 'en' ? String(arr[0]).toLowerCase() : arr[0];
        if (out.indexOf(id) < 0) out.push(id);
      });
    });
    return out;
  }

  function cardOf(module, id) {
    if (module.indexOf('en') === 0) return EN_INDEX[id];
    if (module.indexOf('py') === 0) return PY_INDEX[id];
    return ZH_INDEX[id];
  }

  /* ================= 目录 ================= */
  function moduleMeta(module) {
    return {
      en_recog: { title: t('mod_en_recog_title', '英语认词'), icon: '📖', tone: 'tone-blue', desc: t('mod_en_recog_desc', '看英文，说自己认不认识'), tag: '英语 · 认词', kind: 'en' },
      en_spell: { title: t('mod_en_spell_title', '英语拼写'), icon: '⌨️', tone: 'tone-mint', desc: t('mod_en_spell_desc', '看中文，拼出英文单词'), tag: '英语 · 拼写', kind: 'en' },
      zh_recog: { title: t('mod_zh_recog_title', '中文认字'), icon: '🈶', tone: 'tone-amber', desc: t('mod_zh_recog_desc', '看汉字，说自己认不认识'), tag: '中文 · 认字', kind: 'zh' },
      zh_dict: { title: t('mod_zh_dict_title', '中文听写'), icon: '🎧', tone: 'tone-violet', desc: t('mod_zh_dict_desc', '听发音，自己写下来'), tag: '中文 · 听写', kind: 'zh' },
      py_recog: { title: t('mod_py_recog_title', '拼音认读'), icon: '🎵', tone: 'tone-pink', desc: t('mod_py_recog_desc', '看拼音，读一读认不认识'), tag: '拼音 · 认读', kind: 'py' },
      py_spell: { title: t('mod_py_spell_title', '拼音拼写'), icon: '✍️', tone: 'tone-cyan', desc: t('mod_py_spell_desc', '看汉字，写出拼音和声调'), tag: '拼音 · 拼写', kind: 'py' }
    }[module];
  }

  /* ================= 会话队列 ================= */
  function buildQueue(modules, opts) {
    opts = opts || {};
    var p = Store.activeProfile();
    var today = SRS.todayStr();
    var due = [];
    var fresh = [];
    var limit = opts.limit == null ? Infinity : opts.limit;

    modules.forEach(function (m) {
      var meta = moduleMeta(m);
      var ids = itemsOf(meta.kind);
      if (m === 'py_spell') {
        ids = ids.filter(function (id) { return PY_INDEX[id] && PY_INDEX[id].spell; });
      }
      var recs = Store.allRecs(m);
      // 每项练习各自计算新卡预算（认词 / 拼写是同一批词的不同技能，进度独立）
      var newBudget = m.indexOf('en') === 0 ? (p.settings.newEn || 0)
        : m.indexOf('py') === 0 ? (p.settings.newPy || 0)
        : (p.settings.newZh || 0);
      var learnedToday = Object.keys(recs).filter(function (k) {
        return recs[k] && recs[k].first === today;
      }).length;
      var freshLeft = Math.max(0, newBudget - learnedToday);

      ids.forEach(function (id) {
        var r = recs[id];
        if (r && r.s > 0) {
          if (SRS.parseDate(r.due) <= SRS.parseDate(today)) due.push({ m: m, id: id });
        } else if (!r) {
          fresh.push({ m: m, id: id });
        }
      });
      // 保存本轮新卡预算
      fresh.forEach(function (f) { if (f.m === m) f._budget = freshLeft; });
    });

    // 新卡按各模块预算截断
    var budgetUsed = {};
    var pickedFresh = [];
    shuffle(fresh).forEach(function (f) {
      var b = f._budget == null ? 999 : f._budget;
      budgetUsed[f.m] = budgetUsed[f.m] || 0;
      if (budgetUsed[f.m] < b) {
        budgetUsed[f.m] += 1;
        delete f._budget;
        pickedFresh.push(f);
      }
    });

    var q = shuffle(due);
    // 与新词交替，避免同一模块连续出现
    var mixed = [];
    var di = 0, fi = 0;
    while (di < q.length || fi < pickedFresh.length) {
      if (di < q.length) mixed.push(q[di++]);
      if (fi < pickedFresh.length && (fi <= di || di >= q.length)) mixed.push(pickedFresh[fi++]);
    }
    // 同一模块的卡片尽量不连续排在一起
    mixed = interleaveByModule(mixed);
    if (limit !== Infinity) mixed = mixed.slice(0, limit);
    return mixed;
  }

  function interleaveByModule(list) {
    var buckets = {};
    list.forEach(function (it) {
      (buckets[it.m] = buckets[it.m] || []).push(it);
    });
    var keys = Object.keys(buckets);
    var out = [];
    var guard = 0;
    while (out.length < list.length && guard < 10000) {
      guard += 1;
      var added = false;
      keys.forEach(function (k) {
        if (buckets[k].length) { out.push(buckets[k].shift()); added = true; }
      });
      if (!added) break;
    }
    return out;
  }

  function dueCount(module) {
    var p = Store.activeProfile();
    if (!p) return 0;
    var ids = itemsOf(moduleMeta(module).kind);
    var recs = Store.allRecs(module);
    var today = SRS.todayStr();
    var n = 0;
    ids.forEach(function (id) {
      var r = recs[id];
      if (r && r.s > 0 && SRS.parseDate(r.due) <= SRS.parseDate(today)) n += 1;
    });
    return n;
  }

  function freshCount(module) {
    var p = Store.activeProfile();
    if (!p) return 0;
    var ids = itemsOf(moduleMeta(module).kind);
    var recs = Store.allRecs(module);
    var n = 0;
    ids.forEach(function (id) { if (!recs[id]) n += 1; });
    return n;
  }

  /* ================= 路由 ================= */
  function currentRoute() {
    var h = (location.hash || '#/home').replace(/^#\/?/, '');
    var parts = h.split('?')[0].split('/');
    return { name: parts[0] || 'home', param: parts[1] || '' };
  }

  function render() {
    var r = currentRoute();
    var name = ROUTES.indexOf(r.name) >= 0 ? r.name : 'home';
    if (!Store.listProfiles().length) {
      renderWelcome();
      updateChrome();
      return;
    }
    if (!Store.activeProfile()) Store.setActive(Store.listProfiles()[0].id);

    if (name === 'home') renderHome();
    else if (name === 'study') renderStudy();
    else if (name === 'progress') renderProgress();
    else if (name === 'me') renderMe();
    else if (name === 'lib') renderLib(r.param || 'en');
    updateChrome();
  }

  function updateChrome() {
    var p = Store.activeProfile();
    var chip = document.getElementById('profileChip');
    if (p) {
      document.getElementById('profileAvatar').textContent = p.avatar;
      document.getElementById('profileName').textContent = p.name;
      chip.style.visibility = 'visible';
    } else {
      document.getElementById('profileAvatar').textContent = '🐣';
      document.getElementById('profileName').textContent = '新建小朋友';
    }
    // 存储环境提示
    var banner = document.getElementById('storeBanner');
    if (banner) {
      var mode = Store.storageMode();
      if (mode === 'localStorage') {
        banner.hidden = true;
      } else {
        banner.hidden = false;
        document.getElementById('storeBannerText').textContent = mode === 'sessionStorage'
          ? '当前环境不能长期保存，档案只在本次打开有效'
          : '当前环境无法保存数据，关掉页面档案就会丢失';
        var bb = document.getElementById('storeBannerBtn');
        if (bb && !bb._bound) {
          bb._bound = true;
          bb.onclick = openStorageHelp;
        }
      }
    }

    var tab = currentRoute().name;
    $$('.tab').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-tab') === tab || (tab === 'lib' && a.getAttribute('data-tab') === 'study'));
    });
    tabbar.style.display = Store.listProfiles().length ? '' : 'none';
  }

  window.addEventListener('hashchange', render);

  /* ================= 欢迎页（无档案） ================= */
  function renderWelcome() {
    view.innerHTML =
      '<div style="padding-top:38px;text-align:center">' +
      '<div style="font-size:56px">🌱</div>' +
      '<h1 style="font-size:26px;font-weight:800;margin:12px 0 6px">记忆小站</h1>' +
      '<p style="color:var(--ink-3);font-size:14px;line-height:1.8">按艾宾浩斯遗忘曲线安排复习<br>让每个孩子都有自己的学习档案</p>' +
      '</div>' +
      '<div class="card" style="margin-top:26px">' +
      '<h3 style="font-size:16px;font-weight:800;margin-bottom:4px">先给小朋友建个档案吧</h3>' +
      '<p style="font-size:13px;color:var(--ink-3);margin-bottom:14px">每个档案独立记录记忆进度，可以建多个。</p>' +
      '<button class="btn btn-primary btn-block btn-lg" id="wCreate">＋ 新建小朋友</button>' +
      '<div style="height:10px"></div>' +
      '<button class="btn btn-ghost btn-block" id="wImport">从备份导入（换浏览器/换电脑）</button>' +
      '<input type="file" id="wImportFile" accept="application/json,.json" hidden />' +
      (Cloud && Cloud.status().canUseCloud && !Cloud.status().signedIn
        ? '<div style="height:10px"></div><button class="btn btn-ghost btn-block" id="wCloud">☁️ 已有账号？登录同步</button>'
        : '') +
      '</div>' +
      '<div class="list" style="margin-top:16px">' +
      '<div class="row"><div class="row-main"><div class="row-title">📖 英语认词 · ⌨️ 英语拼写</div><div class="row-sub">' + Object.keys(EN_INDEX).length + ' 个单词，覆盖小学常见主题</div></div></div>' +
      '<div class="row"><div class="row-main"><div class="row-title">🈶 中文认字 · 🎧 中文听写</div><div class="row-sub">' + Object.keys(ZH_INDEX).length + ' 个常用字，含拼音与组词</div></div></div>' +
      '<div class="row"><div class="row-main"><div class="row-title">🎵 拼音认读 · ✍️ 拼音拼写</div><div class="row-sub">' + Object.keys(PY_INDEX).length + ' 个声母/韵母/音节，按年级分配</div></div></div>' +
      '<div class="row"><div class="row-main"><div class="row-title">🔒 不登录也能用</div><div class="row-sub">不注册也能学，进度存在本机；想多设备同步再登录</div></div></div>' +
      '<div class="row"><div class="row-main"><div class="row-title">📦 已经学过一阵了？</div><div class="row-sub">点上方「从备份导入」，换浏览器/换电脑进度不丢</div></div></div>' +
      '</div>';
    $('#wCreate').onclick = function () { openProfileSheet(null); };
    var wc = $('#wCloud');
    if (wc) wc.onclick = openAuthSheet;
    $('#wImport').onclick = function () { $('#wImportFile').click(); };
    $('#wImportFile').onchange = function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) doImportFile(f);
    };
  }

  /** 统一的导入处理：「我的」页和欢迎页共用 */
  function doImportFile(file) {
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var res = Store.importAll(String(rd.result));
        toast('导入成功：' + res.profiles + ' 个档案 / ' + res.cards + ' 张卡片');
        if (!location.hash) location.hash = '#/home';
        render();
      } catch (err) {
        toast('导入失败：' + err.message);
      }
    };
    rd.onerror = function () { toast('文件读取失败'); };
    rd.readAsText(file);
  }

  /* ================= 首页 ================= */
  function renderHome() {
    var p = Store.activeProfile();
    var todayDone = Store.dayTotal();
    var goal = p.settings.dailyGoal || 30;
    var dueAll = MODS.reduce(function (n, m) { return n + dueCount(m); }, 0);
    var freshAll = Math.min(freshCount('en_recog'), p.settings.newEn || 0) +
      Math.min(freshCount('zh_recog'), p.settings.newZh || 0) +
      Math.min(freshCount('py_recog'), p.settings.newPy || 0);
    var hour = new Date().getHours();
    var greet = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
    var hasTask = dueAll > 0 || freshAll > 0;

    var html = '';
    html += '<section class="hero">' +
      '<div class="hero-top"><span>' + greet + '，' + esc(p.avatar) + '</span><span>🔥 连续 ' + Store.streak() + ' 天</span></div>' +
      '<h1>' + esc(t('heroGreet', '{name}，今天学点什么？').replace('{name}', p.name)) + '</h1>' +
      '<div class="hero-scope">' + gradeLabel(p) + '</div>' +
      '<p class="sub">' + (hasTask
        ? '有 ' + dueAll + ' 张卡片到了复习时间' + (freshAll ? '，还能学 ' + freshAll + ' 张新卡' : '')
        : '今天没有到期复习，明天再来看看～') + '</p>' +
      '<div class="hero-stats">' +
      '<div class="hero-stat"><b>' + todayDone + '</b><span>今日已练</span></div>' +
      '<div class="hero-stat"><b>' + pct(todayDone, goal) + '%</b><span>今日目标</span></div>' +
      '<div class="hero-stat"><b>' + dueAll + '</b><span>待复习</span></div>' +
      '</div>' +
      '<button class="hero-cta" id="heroStart"' + (hasTask ? '' : ' disabled') + '>' +
      (hasTask ? t('heroStart', '▶ 开始今天的学习') : t('heroDone', '今天完成啦 🎉')) + '</button>' +
      '</section>';

    html += '<div class="section-title"><h2>六项练习</h2><a class="link" href="#/study">全部</a></div>';
    html += subjectSectionsHtml(false);

    // 记忆概况
    var allMods = MODS;
    var learned = 0, mastered = 0;
    var totalPool = MODS.reduce(function (n, m) {
      var kind = moduleMeta(m).kind;
      var n2 = itemsOf(kind).length;
      if (m === 'py_spell') n2 = itemsOf(kind).filter(function (id) { return PY_INDEX[id] && PY_INDEX[id].spell; }).length;
      return n + n2;
    }, 0);
    allMods.forEach(function (m) {
      var st = Store.moduleStats(m);
      learned += st.learned;
      mastered += st.mastered;
    });
    html += '<div class="section-title"><h2>记忆概况</h2><a class="link" href="#/progress">详细数据</a></div>';
    html += '<div class="card">' +
      '<div style="display:flex;justify-content:space-between;font-size:13px;color:var(--ink-2);font-weight:600;margin-bottom:8px">' +
      '<span>已学卡片 ' + learned + ' 张</span><span>掌握 ' + mastered + ' 张</span></div>' +
      '<div class="bar"><i style="width:' + pct(learned, totalPool) + '%"></i></div>' +
      '<div style="font-size:12px;color:var(--ink-3);margin-top:8px">共 ' + totalPool + ' 张卡片（词库开启范围内的练习单元）</div>' +
      '</div>';

    html += '<div class="section-title"><h2>小提示</h2><span class="link" style="color:var(--ink-3)">艾宾浩斯</span></div>' +
      '<div class="card" style="font-size:13.5px;color:var(--ink-2);line-height:1.75">' +
      '学完一个词，第 <b>1、2、4、7、15、30、60</b> 天各复习一次，就能把它变成长期记忆。' +
      '每次复习都答对，间隔会越来越长；答错就从第 1 天重新开始。' +
      '</div>';

    view.innerHTML = html;
    var heroStart = $('#heroStart');
    if (heroStart) heroStart.onclick = function () { startSession(allMods); };
    $$('[data-start]').forEach(function (btn) {
      btn.onclick = function () { startSession([btn.getAttribute('data-start')]); };
    });
  }

  /* ================= 学习页 ================= */
  function renderStudy() {
    var html = '<div class="section-title"><h2>选择练习</h2><button class="link" id="editGrade">' + gradeLabel(Store.activeProfile()) + ' ›</button></div>';
    html += subjectSectionsHtml(true);

    html += '<div class="section-title"><h2>练习范围</h2></div>';
    html += '<div class="list">' +
      '<a class="row" href="#/lib/en"><div class="row-main"><div class="row-title">📚 英语词库</div>' +
      '<div class="row-sub">已选 ' + enabledUnitIds('en').length + ' / ' + EN_UNITS.length + ' 个主题单元</div></div><span class="chev-r">›</span></a>' +
      '<a class="row" href="#/lib/zh"><div class="row-main"><div class="row-title">🈶 中文识字</div>' +
      '<div class="row-sub">已选 ' + enabledUnitIds('zh').length + ' / ' + ZH_UNITS.length + ' 个字组</div></div><span class="chev-r">›</span></a>' +
      '<div class="row"><div class="row-main"><div class="row-title">🎵 拼音（跟随年级）</div>' +
      '<div class="row-sub">已选 ' + enabledUnitIds('py').length + ' / ' + PY_UNITS.length + ' 个单元，改年级会自动匹配</div></div></div>' +
      '</div>';

    html += '<div class="section-title"><h2>今日安排</h2></div>';
    html += '<div class="card" style="font-size:13.5px;color:var(--ink-2);line-height:1.9">' +
      '英语每项练习新词：<b>' + (Store.activeProfile().settings.newEn) + '</b> / 天　中文新字：<b>' + (Store.activeProfile().settings.newZh) + '</b> / 天　拼音：<b>' + (Store.activeProfile().settings.newPy) + '</b> / 天<br>' +
      '到期复习：英语 ' + (dueCount('en_recog') + dueCount('en_spell')) + ' 张，中文 ' + (dueCount('zh_recog') + dueCount('zh_dict')) + ' 张，拼音 ' + (dueCount('py_recog') + dueCount('py_spell')) + ' 张' +
      '<div style="margin-top:10px"><a class="btn btn-ghost" href="#/me" style="padding:8px 14px;font-size:13px">调整每日新卡数量</a></div>' +
      '</div>';

    view.innerHTML = html;
    $$('[data-start]').forEach(function (btn) {
      btn.onclick = function () { startSession([btn.getAttribute('data-start')]); };
    });
    var eg = $('#editGrade');
    if (eg) eg.onclick = function () { openProfileSheet(Store.activeProfile()); };
  }

  /* ================= 练习卡渲染 ================= */
  function modeCardHtml(m, withStats) {
    var meta = moduleMeta(m);
    var d = dueCount(m);
    var extra = '';
    if (withStats) {
      var st = Store.moduleStats(m);
      extra = '<div style="margin-top:12px;font-size:11.5px;color:var(--ink-3)">已学 ' + st.learned + ' · 掌握 ' + st.mastered + '</div>';
    }
    return '<button class="mode-card ' + meta.tone + '" data-start="' + m + '">' +
      '<span class="ico">' + meta.icon + '</span>' +
      '<h3>' + meta.title + '</h3><p>' + meta.desc + '</p>' +
      '<span class="badge' + (d ? '' : ' zero') + '">' + (d ? d + ' 待复习' : '无到期') + '</span>' +
      extra + '</button>';
  }

  function subjectSectionsHtml(withStats) {
    var out = '';
    SUBJECTS.forEach(function (sub) {
      out += '<div class="subject-label"><span>' + sub.icon + ' ' + sub.name + '</span>' +
        '<i>' + sub.mods.length + ' 项</i></div>';
      out += '<div class="mode-grid">' + sub.mods.map(function (m) { return modeCardHtml(m, withStats); }).join('') + '</div>';
    });
    return out;
  }

  function gradeLabel(p) {
    if (!p) return '';
    var g = GRADE_NAMES[Math.max(0, Math.min(5, (p.settings.grade || 1) - 1))];
    return g + ' · ' + (p.settings.textbook || '人教版 PEP');
  }

  /* ================= 词库选择页 ================= */
  function renderLib(kind) {
    kind = kind === 'zh' ? 'zh' : 'en';
    var units = kind === 'en' ? EN_UNITS : ZH_UNITS;
    var title = kind === 'en' ? '英语词库' : '中文识字库';
    var html = '<div class="section-title"><h2>' + title + '</h2><a class="link" href="#/study">返回</a></div>' +
      '<p style="font-size:13px;color:var(--ink-3);margin-bottom:14px">开启的单元会进入每天的复习计划。只勾选孩子正在学的内容即可，避免负担过重。</p>' +
      '<div class="unit-grid">';

    units.forEach(function (u) {
      var on = isUnitOn(kind, u.id);
      var n = u.words.length;
      html += '<button class="unit-item' + (on ? ' on' : '') + '" data-unit="' + u.id + '">' +
        '<span class="u-ico">' + (u.icon || '📚') + '</span>' +
        '<span class="u-main"><span class="u-name">' + esc(u.name) + '</span>' +
        '<span class="u-sub">' + n + ' 个' + (kind === 'en' ? '单词' : '字') + (u.grade ? ' · ' + u.grade + ' 年级' : '') + '</span></span>' +
        '<span class="toggle' + (on ? ' on' : '') + '"></span>' +
        '</button>';
    });
    html += '</div>';
    html += '<div style="display:flex;gap:10px;margin:16px 0 8px">' +
      '<button class="btn btn-ghost" id="libAll" style="flex:1">全选</button>' +
      '<button class="btn btn-ghost" id="libNone" style="flex:1">全不选</button></div>';

    view.innerHTML = html;

    $$('[data-unit]').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-unit');
        var key = kind === 'en' ? 'unitsEn' : 'unitsZh';
        var all = units.map(function (u) { return u.id; });
        var cur = enabledUnitIds(kind);
        var next = cur.indexOf(id) >= 0 ? cur.filter(function (x) { return x !== id; }) : cur.concat([id]);
        if (!next.length) { toast('至少要留一个单元哦'); return; }
        var ordered = all.filter(function (x) { return next.indexOf(x) >= 0; });
        Store.updateSettings(Store.activeProfile().id, { [key]: ordered });
        renderLib(kind);
      };
    });
    var allBtn = $('#libAll'), noneBtn = $('#libNone');
    if (allBtn) allBtn.onclick = function () {
      Store.updateSettings(Store.activeProfile().id, { [kind === 'en' ? 'unitsEn' : 'unitsZh']: units.map(function (u) { return u.id; }) });
      renderLib(kind);
    };
    if (noneBtn) noneBtn.onclick = function () {
      Store.updateSettings(Store.activeProfile().id, { [kind === 'en' ? 'unitsEn' : 'unitsZh']: [units[0].id] });
      renderLib(kind);
    };
  }

  /* ================= 进度页 ================= */
  function renderProgress() {
    var p = Store.activeProfile();
    var mods = MODS;
    var sum = { learned: 0, mastered: 0, due: 0, correct: 0, wrong: 0 };
    mods.forEach(function (m) {
      var st = Store.moduleStats(m);
      sum.learned += st.learned; sum.mastered += st.mastered;
      sum.due += st.due; sum.correct += st.correct; sum.wrong += st.wrong;
    });
    var acc = pct(sum.correct, sum.correct + sum.wrong);

    var html = '';
    html += '<div class="stat-grid">' +
      '<div class="stat-box"><div class="num">' + sum.learned + '</div><div class="lbl">已学卡片</div></div>' +
      '<div class="stat-box"><div class="num">' + sum.mastered + '</div><div class="lbl">已掌握（第7次以上）</div></div>' +
      '<div class="stat-box"><div class="num">' + acc + '<small>%</small></div><div class="lbl">累计答对率</div></div>' +
      '<div class="stat-box"><div class="num">' + Store.streak() + '<small>天</small></div><div class="lbl">连续打卡</div></div>' +
      '</div>';

    // 7 日
    html += '<div class="section-title"><h2>最近 7 天</h2><span class="link" style="color:var(--ink-3)">共 ' + weekSum() + ' 次</span></div>';
    html += '<div class="card"><div class="week-chart">' + weekBars() + '</div></div>';

    // 遗忘曲线
    html += '<div class="section-title"><h2>为什么这样复习</h2></div>';
    html += '<div class="card"><div class="curve-wrap">' + curveSvg() + '</div>' +
      '<div class="curve-legend"><span><i style="background:#ff6b81"></i>不复习</span>' +
      '<span><i style="background:#4f6bff"></i>按时复习</span>' +
      '<span><i style="background:#22c39a"></i>复习节点</span></div>' +
      '<div style="font-size:12.5px;color:var(--ink-3);margin-top:10px;line-height:1.7">' +
      '遗忘在学习后立刻开始，20 分钟就只剩一半。每次在「快忘记」的时候复习一次，记忆保存时间就会翻倍。</div>' +
      '</div>';

    // 阶段分布
    html += '<div class="section-title"><h2>记忆稳固度</h2></div>';
    var dist = stageDist();
    var maxd = Math.max.apply(null, dist.concat([1]));
    html += '<div class="card"><div class="stage-list">' + dist.map(function (n, i) {
      return '<div class="stage-item"><span class="nm">' + i + ' · ' + ['未学', '第1轮', '第2轮', '第3轮', '第4轮', '第5轮', '第6轮', '第7轮', '已掌握'][i] + '</span>' +
        '<span class="bar' + (i >= 7 ? ' mint' : '') + '"><i style="width:' + pct(n, maxd) + '%"></i></span>' +
        '<span class="ct">' + n + '</span></div>';
    }).join('') + '</div></div>';

    // 薄弱词
    var weak = weakList();
    if (weak.length) {
      html += '<div class="section-title"><h2>需要加强</h2><a class="link" href="#/study">去练习</a></div>';
      html += '<div class="list">' + weak.map(function (it) {
        return '<div class="row"><div class="row-main"><div class="row-title">' + esc(it.label) + '</div>' +
          '<div class="row-sub">' + esc(it.sub) + ' · 错 ' + it.w + ' 次</div></div>' +
          '<span class="chev-r">' + (it.s >= 1 ? '第' + it.s + '轮' : '新') + '</span></div>';
      }).join('') + '</div>';
    }

    // 重点学清单（错 2 次以上 / 模糊 2 次以上）
    var focus = Store.focusCards();
    html += '<div class="section-title"><h2>要重点练</h2>' +
      (focus.length ? '<button class="link" id="goFocusPrint">打印这份清单</button>' : '') + '</div>';
    if (!focus.length) {
      html += '<div class="card"><div style="font-size:13px;color:var(--ink-3);line-height:1.8">' +
        '还没有需要重点练的字词。<br>同一个字词<b>答错 2 次</b>、或者<b>「有点模糊」2 次</b>，就会自动收进这份清单，' +
        '可以一键排版打印到纸上练。</div></div>';
    } else {
      html += '<div class="card">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
        '<div style="width:44px;height:44px;border-radius:14px;background:#fff1f3;display:grid;place-items:center;font-size:21px">📌</div>' +
        '<div style="flex:1"><div style="font-weight:800;font-size:15px">' + focus.length + ' 张要单独练</div>' +
        '<div style="font-size:12px;color:var(--ink-3);margin-top:2px">答错 2 次以上，或「有点模糊」2 次以上</div></div>' +
        '</div>' +
        '<div class="list">' + focus.slice(0, 6).map(function (it) {
          var c = cardOf(it.m, it.id);
          if (!c) return '';
          return '<div class="row"><div class="row-main">' +
            '<div class="row-title">' + esc(it.m.indexOf('en') === 0 ? c.w : c.c) + '</div>' +
            '<div class="row-sub">' + esc(it.m.indexOf('en') === 0 ? c.zh : (c.pinyin || '')) + ' · ' + esc(moduleMeta(it.m).title) + '</div>' +
            '</div><span class="chev-r">' + focusTag(it) + '</span></div>';
        }).join('') + '</div>' +
        (focus.length > 6 ? '<div style="font-size:12px;color:var(--ink-3);margin-top:8px;text-align:center">还有 ' + (focus.length - 6) + ' 张，打印单里会全部列出</div>' : '') +
        '<button class="btn btn-primary btn-block" id="goFocusPrint2" style="margin-top:12px">整理成一页，打印出来练</button>' +
        '</div>';
    }

    view.innerHTML = html;

    var goFocus = function () { openPrintSheet('focus'); };
    var g1 = $('#goFocusPrint'), g2 = $('#goFocusPrint2');
    if (g1) g1.onclick = goFocus;
    if (g2) g2.onclick = goFocus;
  }

  /** 清单里的次数标签：错 x 次 · 模糊 y 次 */
  function focusTag(it) {
    var a = [];
    if (it.w) a.push('错 ' + it.w + ' 次');
    if (it.h) a.push('模糊 ' + it.h + ' 次');
    return a.join(' · ') || '—';
  }

  /** 打开打印复习单（线上版才有这一页） */
  function openPrintSheet(rule) {
    if (window.__SINGLE_FILE__) {
      toast('单文件版没有打印页，请用线上版：' + (META.siteUrl || '记忆小站'));
      return;
    }
    window.open('print.html?rule=' + encodeURIComponent(rule || 'weak'), '_blank');
  }

  function weekSum() {
    var n = 0;
    for (var i = 6; i >= 0; i--) n += Store.dayTotal(SRS.addDays(SRS.todayStr(), -i));
    return n;
  }

  function weekBars() {
    var days = ['日', '一', '二', '三', '四', '五', '六'];
    var vals = [];
    for (var i = 6; i >= 0; i--) {
      var d = SRS.addDays(SRS.todayStr(), -i);
      vals.push({ d: d, v: Store.dayTotal(d), w: days[SRS.parseDate(d).getDay()] });
    }
    var max = Math.max.apply(null, vals.map(function (x) { return x.v; }).concat([1]));
    return vals.map(function (x) {
      var h = x.v ? Math.max(6, Math.round((x.v / max) * 84)) : 3;
      return '<div class="week-col"><span class="v">' + (x.v || '') + '</span>' +
        '<div class="bar-v' + (x.v ? '' : ' empty') + '" style="height:' + h + 'px"></div>' +
        '<span class="d">' + x.w + '</span></div>';
    }).join('');
  }

  function curveSvg() {
    var W = 320, H = 150, pad = 8;
    var maxT = 16;
    function x(t) { return pad + (t / maxT) * (W - pad * 2); }
    function y(r) { return H - pad - r * (H - pad * 2); }
    var pathNo = SRS.curvePoints(1, maxT, 0.5).map(function (p, i) {
      return (i ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.r).toFixed(1);
    }).join(' ');
    var pathYes = SRS.curvePoints(6, maxT, 0.5).map(function (p, i) {
      return (i ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.r).toFixed(1);
    }).join(' ');
    var marks = [1, 2, 4, 7, 15].map(function (t) {
      return '<circle cx="' + x(t).toFixed(1) + '" cy="' + y(SRS.retention(t, 6)).toFixed(1) + '" r="3.4" fill="#22c39a"/>';
    }).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block">' +
      '<line x1="' + pad + '" y1="' + (H - pad) + '" x2="' + (W - pad) + '" y2="' + (H - pad) + '" stroke="#e7ecf7"/>' +
      '<line x1="' + pad + '" y1="' + pad + '" x2="' + pad + '" y2="' + (H - pad) + '" stroke="#e7ecf7"/>' +
      '<path d="' + pathNo + '" fill="none" stroke="#ff6b81" stroke-width="2.4" stroke-linecap="round" opacity=".9"/>' +
      '<path d="' + pathYes + '" fill="none" stroke="#4f6bff" stroke-width="2.8" stroke-linecap="round"/>' +
      marks +
      '<text x="' + pad + '" y="' + (H - 0.5) + '" font-size="9" fill="#8b93aa">0</text>' +
      '<text x="' + (W - pad - 10) + '" y="' + (H - 0.5) + '" font-size="9" fill="#8b93aa">' + maxT + '天</text>' +
      '<text x="' + (pad + 2) + '" y="' + (pad + 8) + '" font-size="9" fill="#8b93aa">100%</text>' +
      '</svg>';
  }

  function stageDist() {
    var dist = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    MODS.forEach(function (m) {
      var recs = Store.allRecs(m);
      Object.keys(recs).forEach(function (k) {
        var s = recs[k] ? recs[k].s || 0 : 0;
        dist[Math.max(0, Math.min(8, s))] += 1;
      });
    });
    return dist;
  }

  function weakList() {
    var out = [];
    MODS.forEach(function (m) {
      var recs = Store.allRecs(m);
      Object.keys(recs).forEach(function (k) {
        var r = recs[k];
        if (r && r.w > 0 && r.s < 6) {
          var c = cardOf(m, k);
          if (!c) return;
          out.push({
            label: m.indexOf('en') === 0 ? c.w : c.c,
            sub: (m.indexOf('en') === 0 ? c.zh : (c.pinyin || '')) + ' · ' + moduleMeta(m).title,
            w: r.w, s: r.s || 0
          });
        }
      });
    });
    out.sort(function (a, b) { return b.w - a.w; });
    return out.slice(0, 6);
  }

  /* ================= 我的 ================= */
  function renderMe() {
    var p = Store.activeProfile();
    var html = '';
    html += cloudCardHtml();
    html += '<div class="section-title"><h2>小朋友档案</h2><button class="link" id="addProfile">＋ 新建</button></div>';
    html += '<div class="profile-list">' + Store.listProfiles().map(function (pr) {
      return '<div class="profile-item' + (pr.id === p.id ? ' active' : '') + '">' +
        '<div class="p-avatar">' + pr.avatar + '</div>' +
        '<div class="p-main"><div class="p-name">' + esc(pr.name) + (pr.id === p.id ? ' <span class="chip mint" style="font-size:11px;vertical-align:2px">使用中</span>' : '') + '</div>' +
        '<div class="p-sub">' + profileSummary(pr) + '</div></div>' +
        (pr.id === p.id
          ? '<button class="icon-btn" data-edit="' + pr.id + '" title="修改">✏️</button>'
          : '<button class="icon-btn" data-switch="' + pr.id + '" title="切换">切换</button>') +
        '</div>';
    }).join('') + '</div>';

    var s = p.settings;
    // 打印复习单入口
    var fc = Store.focusCount();
    html += '<div class="section-title"><h2>打印复习单</h2></div>';
    html += '<div class="card" style="display:flex;align-items:center;gap:12px">' +
      '<div style="width:42px;height:42px;border-radius:13px;background:#eef2ff;display:grid;place-items:center;font-size:20px">🖨</div>' +
      '<div style="flex:1;min-width:0">' +
      '<div style="font-weight:800;font-size:14px">把不熟的字词排成一页带打印</div>' +
      '<div style="font-size:12px;color:var(--ink-3);margin-top:3px">按日期筛出答错过的字词，含拼音、组词、释义，也可只印字留白自测</div>' +
      '</div>' +
      '<button class="btn btn-ghost" id="btnPrintSheet" style="flex:none;padding:8px 14px;font-size:13px">去生成</button>' +
      '</div>';
    html += '<div class="card" style="display:flex;align-items:center;gap:12px;margin-top:10px">' +
      '<div style="width:42px;height:42px;border-radius:13px;background:#fff1f3;display:grid;place-items:center;font-size:20px">📌</div>' +
      '<div style="flex:1;min-width:0">' +
      '<div style="font-weight:800;font-size:14px">重点练清单' + (fc ? ' · ' + fc + ' 张' : '') + '</div>' +
      '<div style="font-size:12px;color:var(--ink-3);margin-top:3px">答错 2 次以上、或「有点模糊」2 次以上的字词，自动收在这里</div>' +
      '</div>' +
      '<button class="btn btn-ghost" id="btnFocusSheet" style="flex:none;padding:8px 14px;font-size:13px"' + (fc ? '' : ' disabled') + '>去打印</button>' +
      '</div>';

    html += '<div class="section-title"><h2>学习内容</h2><button class="link" id="editScope">修改 ›</button></div>';
    html += '<div class="card">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">' +
      '<div style="width:44px;height:44px;border-radius:14px;background:var(--primary-weak);display:grid;place-items:center;font-size:22px">🎓</div>' +
      '<div style="flex:1"><div style="font-weight:800;font-size:15px">' + gradeLabel(p) + '</div>' +
      '<div style="font-size:12.5px;color:var(--ink-3);margin-top:2px">中文 ' + (s.unitsZh || []).length + ' 组 · 拼音 ' + (s.unitsPy || []).length + ' 组 · 英语 ' + (s.unitsEn || []).length + ' 单元 · ' + (s.startEn === 1 ? '一年级起点' : '三年级起点') + '</div></div>' +
      '</div>' +
      '<div style="font-size:12.5px;color:var(--ink-3);line-height:1.7">练习内容只会落在<b>本年级及以下</b>，不会出现高年级的生字和单词。改年级后旧记录不会丢，只是不再出新卡。</div>' +
      '</div>';

    html += '<div class="section-title"><h2>学习设置</h2></div>';
    html += '<div class="card">' +
      rangeRow('每日新词（每项英语练习）', 'newEn', s.newEn, 0, 30, 1, '个') +
      rangeRow('每日新字（每项中文练习）', 'newZh', s.newZh, 0, 30, 1, '个') +
      rangeRow('每日新拼音（每项拼音练习）', 'newPy', s.newPy, 0, 20, 1, '个') +
      rangeRow('每日练习目标', 'dailyGoal', s.dailyGoal, 10, 120, 5, '次') +
      rangeRow('朗读语速', 'ttsRate', s.ttsRate, 0.5, 1.4, 0.1, '倍') +
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0">' +
      '<span style="font-size:13.5px;font-weight:600;color:var(--ink-2)">自动朗读单词 / 汉字</span>' +
      '<button class="toggle' + (s.ttsAuto ? ' on' : '') + '" data-toggle="ttsAuto"></button></div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0">' +
      '<span style="font-size:13.5px;font-weight:600;color:var(--ink-2)">中文答案页显示拼音</span>' +
      '<button class="toggle' + (s.showPinyin ? ' on' : '') + '" data-toggle="showPinyin"></button></div>' +
      '</div>';

    html += '<div class="section-title"><h2>存档</h2></div>';
    var info = Store.storageInfo();
    var modeText = info.mode === 'localStorage' ? '本机浏览器本地存储'
      : info.mode === 'sessionStorage' ? '仅当前标签页（关掉即清空）' : '仅内存（关掉即丢失）';
    var sourceText = { main: '主存档', backup: '从快照恢复', new: '新建' }[info.source] || info.source;
    var needBackup = info.cards > 20 && daysSince(info.lastExport) > 30;

    if (needBackup) {
      html += '<div class="card" style="margin-bottom:10px;background:#fff7e6;border-color:#ffe0b2;font-size:12.5px;color:#8a5300;line-height:1.6">' +
        '⚠️ 已经 <b>' + (daysSince(info.lastExport) === Infinity ? '很久' : daysSince(info.lastExport) + ' 天') +
        '</b> 没导出备份了。浏览器清理缓存或换电脑都可能让进度丢失，建议现在导出一次。' +
        '<div style="margin-top:8px"><button class="btn btn-amber" id="btnExport2" style="padding:8px 14px;font-size:13px">立即导出备份</button></div>' +
        '</div>';
    }

    html += '<div class="card" style="margin-bottom:10px;font-size:13px;color:var(--ink-2);line-height:1.9">' +
      '当前浏览器：<b>' + esc(browserName()) + '</b>（进度只存在这个浏览器里）' +
      '<br>存储位置：<b style="color:' + (info.mode === 'localStorage' ? '#12906f' : '#d92b52') + '">' + modeText + '</b>' +
      '<br>存档版本：<b>v' + info.storedVersion + '</b>　程序版本：v' + esc(META.version) +
      '　读取自：' + sourceText +
      '<br>已记录 <b>' + info.profiles + '</b> 个小朋友、<b>' + info.cards + '</b> 张学习卡片' +
      '<br>数据指纹：<b style="font-family:ui-monospace,Consolas,monospace;letter-spacing:1px">' + info.fingerprint + '</b>' +
      '<span style="font-size:11.5px;color:var(--ink-3)">（迁移/备份后对比这个值可确认数据一致）</span>' +
      '<br>上一版快照：' + fmtTime(info.lastBackup) +
      '<br>上次导出：' + (info.lastExport ? fmtTime(info.lastExport) : '从未导出') +
      (info.readonly ? '<div style="margin-top:6px;color:#d92b52">⚠️ 检测到更高版本的存档（v' + info.newer + '），已切换为只读保护，不会覆盖你的进度。</div>' : '') +
      '<div style="font-size:12px;color:var(--ink-3);margin-top:6px">' +
      (cloudSignedIn()
        ? '本机始终保留完整副本；登录状态下另有一份加密传输的云端副本，只有你自己的账号能读。'
        : '数据不上传服务器，只存在这台设备。浏览器「清除浏览数据」会删掉它，换设备请用下面的导出/导入。') +
      '</div>' +
      '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="btn btn-ghost" id="btnMigrate" style="padding:8px 14px;font-size:13px">换浏览器 / 换电脑？</button>' +
      '<button class="btn btn-ghost" id="btnRestore" style="padding:8px 14px;font-size:13px"' + (info.backupAvailable ? '' : ' disabled') + '>从上一版快照恢复</button>' +
      '</div>' +
      '</div>';
    html += '<div class="list">' +
      '<button class="row" id="btnExport"><div class="row-main"><div class="row-title">导出备份</div><div class="row-sub">下载全部档案的 JSON 文件</div></div><span class="chev-r">›</span></button>' +
      '<label class="row" for="importFile"><div class="row-main"><div class="row-title">导入备份</div><div class="row-sub">从 JSON 文件恢复进度</div></div><span class="chev-r">›</span></label>' +
      '<input type="file" id="importFile" accept="application/json,.json" hidden />' +
      '<button class="row" id="btnReset"><div class="row-main"><div class="row-title" style="color:#e8436a">清空当前档案进度</div><div class="row-sub">保留档案，只清空记忆记录</div></div><span class="chev-r">›</span></button>' +
      '<button class="row" id="btnDelete"><div class="row-main"><div class="row-title" style="color:#e8436a">删除当前档案</div><div class="row-sub">档案及其全部记录都会被移除</div></div><span class="chev-r">›</span></button>' +
      '</div>';

    html += '<button class="card about-card" id="aboutCard" style="margin-top:16px;text-align:left;width:100%;display:block">' +
      '<div style="display:flex;align-items:center;gap:10px">' +
      '<div style="width:38px;height:38px;border-radius:12px;background:var(--primary-weak);display:grid;place-items:center;font-size:19px">🌱</div>' +
      '<div style="flex:1"><div style="font-weight:800;font-size:14.5px">' + esc(META.name) + ' v' + esc(META.version) + '</div>' +
      '<div style="font-size:12px;color:var(--ink-3);margin-top:2px">作者：' + esc(META.author) + ' · ' + esc(META.license) + ' 许可</div></div>' +
      '<span class="chev-r">›</span>' +
      '</div></button>' +
      '<div style="font-size:12px;color:var(--ink-3);line-height:1.8;padding:0 6px 6px">' +
      '本地随时可用，登录后自动同步；换设备先用「导出备份」再导入也可。' +
      '中文发音用内置音节音频（离线也能读），英语用浏览器自带的语音引擎。' +
      '</div>';

    view.innerHTML = html;

    bindCloudCard();
    $('#addProfile').onclick = function () { openProfileSheet(null); };
    var bps = $('#btnPrintSheet');
    if (bps) {
      if (window.__SINGLE_FILE__) {
        bps.textContent = '需线上版';
        bps.disabled = true;
      } else {
        bps.onclick = function () { openPrintSheet('weak'); };
      }
    }
    var bfs = $('#btnFocusSheet');
    if (bfs) {
      if (window.__SINGLE_FILE__) {
        bfs.textContent = '需线上版';
        bfs.disabled = true;
      } else if (!bfs.disabled) {
        bfs.onclick = function () { openPrintSheet('focus'); };
      }
    }
    var ac = $('#aboutCard');
    if (ac) ac.onclick = openAbout;
    var es = $('#editScope');
    if (es) es.onclick = function () { openScopeSheet(Store.activeProfile()); };
    $$('[data-switch]').forEach(function (b) {
      b.onclick = function () { Store.setActive(b.getAttribute('data-switch')); render(); toast('已切换档案'); };
    });
    $$('[data-edit]').forEach(function (b) {
      b.onclick = function () { openProfileSheet(Store.getProfile(b.getAttribute('data-edit'))); };
    });
    $$('[data-range]').forEach(function (input) {
      input.oninput = function () {
        var key = input.getAttribute('data-range');
        var val = Number(input.value);
        Store.updateSettings(p.id, { [key]: val });
        var out = $('#val-' + key);
        if (out) out.textContent = val + (input.getAttribute('data-unit') || '');
      };
    });
    $$('[data-toggle]').forEach(function (b) {
      b.onclick = function () {
        var key = b.getAttribute('data-toggle');
        Store.updateSettings(p.id, { [key]: !p.settings[key] });
        b.classList.toggle('on');
      };
    });
    var bm = $('#btnMigrate');
    if (bm) bm.onclick = openMigrateHelp;
    var br = $('#btnRestore');
    if (br) br.onclick = function () {
      if (!confirm('用「上一版快照」覆盖当前进度吗？当前存档也会被另存一份，可再次恢复。')) return;
      try {
        Store.restoreFromBackup();
        toast('已恢复到上一版快照');
        render();
      } catch (e) {
        toast('恢复失败：' + e.message);
      }
    };
    var bx2 = $('#btnExport2');
    if (bx2) bx2.onclick = function () { $('#btnExport').click(); };
    $('#btnExport').onclick = function () {
      var blob = new Blob([Store.exportAll()], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '记忆小站备份-' + SRS.todayStr() + '.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
      toast('备份已下载');
    };
    $('#importFile').onchange = function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) doImportFile(f);
    };
    $('#btnReset').onclick = function () {
      if (!confirm('确定清空「' + p.name + '」的所有记忆记录吗？此操作不可撤销。')) return;
      p.data = {};
      MODS.forEach(function (m) { p.data[m] = {}; });
      p.log = {};
      Store.save();
      toast('已清空进度');
      render();
    };
    $('#btnDelete').onclick = function () {
      if (!confirm('确定删除档案「' + p.name + '」吗？')) return;
      Store.removeProfile(p.id);
      toast('已删除');
      location.hash = '#/home';
      render();
    };
  }

  function profileSummary(pr) {
    var learned = 0, mastered = 0;
    MODS.forEach(function (m) {
      var recs = pr.data[m] || {};
      Object.keys(recs).forEach(function (k) {
        var r = recs[k];
        if (r && r.s >= 1) learned += 1;
        if (r && r.s >= 7) mastered += 1;
      });
    });
    var days = Object.keys(pr.log || {}).filter(function (d) { return (pr.log[d].total || 0) > 0; }).length;
    return '已学 ' + learned + ' 张 · 掌握 ' + mastered + ' 张 · 学习 ' + days + ' 天';
  }

  function rangeRow(label, key, val, min, max, step, unit) {
    return '<div style="padding:8px 0">' +
      '<div style="display:flex;justify-content:space-between;font-size:13.5px;font-weight:600;color:var(--ink-2)">' +
      '<span>' + label + '</span><span id="val-' + key + '" style="color:var(--primary)">' + val + unit + '</span></div>' +
      '<input type="range" data-range="' + key + '" data-unit="' + unit + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '" style="width:100%" />' +
      '</div>';
  }

  /* ================= 换浏览器 / 换电脑 ================= */
  function openMigrateHelp() {
    var bn = browserName();
    sheet.innerHTML = '<div class="sheet-handle"></div>' +
      '<h3>换浏览器 / 换电脑怎么办？</h3>' +
      '<p class="sheet-sub">你现在用的是 <b>' + esc(bn) + '</b>。进度存在这个浏览器里，' +
      '换一个浏览器（比如 Edge → 360 极速）就要搬一次。</p>' +
      '<div class="list" style="box-shadow:none">' +
      '<div class="row" style="align-items:flex-start"><div class="row-main">' +
      '<div class="row-title">第 1 步：在旧浏览器里导出</div>' +
      '<div class="row-sub">「我的 → 导出备份」，会下载一个 <b>记忆小站备份-日期.json</b>。' +
      '这个文件包含所有小朋友的档案、每张卡的复习阶段和日期、学习日志。</div></div></div>' +
      '<div class="row" style="align-items:flex-start"><div class="row-main">' +
      '<div class="row-title">第 2 步：在新浏览器里打开同一个文件</div>' +
      '<div class="row-sub">把 <b>记忆小站.html</b> 用新浏览器打开（右键 →「打开方式」→ 选 360 极速）。</div></div></div>' +
      '<div class="row" style="align-items:flex-start"><div class="row-main">' +
      '<div class="row-title">第 3 步：导入备份</div>' +
      '<div class="row-sub">「我的 → 导入备份」选刚才那个 json。同名档案会<b>合并</b>，不会重复新建。</div></div></div>' +
      '</div>' +
      '<div class="card" style="background:#fff7e6;border-color:#ffe0b2;font-size:12.5px;color:#8a5300;line-height:1.7;margin-top:4px">' +
      '⚠️ 不要把浏览器的存档文件夹直接拷过去。那是 LevelDB 二进制库，还混着其它网站的数据，' +
      '拷了大概率读不出来（而且可能把新浏览器里其它数据弄坏）。导出 json 才是可靠方式。' +
      '</div>' +
      '<div style="font-size:12px;color:var(--ink-3);line-height:1.7;margin-top:10px">' +
      '导入后可以先看一眼「存档」里的档案数和卡片数，和旧浏览器一致就说明搬成功了。' +
      '之后建议固定用新浏览器，别再两边混着练，否则会分裂成两份进度。</div>' +
      '<div style="height:14px"></div>' +
      '<button class="btn btn-primary btn-block btn-lg" onclick="document.getElementById(\'sheetMask\').hidden=true">知道了</button>';
    sheetMask.hidden = false;
  }

  /* ================= 云端账号 ================= */
  var pendingOtp = null;
  var pendingReset = null;
  var authMode = 'otp'; // otp | password

  function cloudSignedIn() {
    return !!(Cloud && Cloud.status().signedIn);
  }

  function maskEmail(e) {
    var str = String(e || '');
    var at = str.indexOf('@');
    if (at <= 0) return str;
    var name = str.slice(0, at);
    var keep = name.length <= 2 ? 1 : 2;
    return name.slice(0, keep) + '***' + str.slice(at);
  }

  function agoText(ts) {
    if (!ts) return '尚未同步';
    var d = Math.floor((Date.now() - ts) / 1000);
    if (d < 60) return '刚刚';
    if (d < 3600) return Math.floor(d / 60) + ' 分钟前';
    if (d < 86400) return Math.floor(d / 3600) + ' 小时前';
    return Math.floor(d / 86400) + ' 天前';
  }

  function cloudStatusText(st) {
    if (st.needsOnline) return { tone: '#8a5300', text: '离线文件版 · 云端同步需用线上网址' };
    if (!st.signedIn) return { tone: '#8b93aa', text: '未登录 · 进度只存在本浏览器' };
    if (st.state === 'syncing') return { tone: '#4f6bff', text: '正在同步…' };
    if (st.state === 'offline') return { tone: '#d92b52', text: '网络不通，改动已存本地，联网后自动补传' };
    if (st.state === 'error') return { tone: '#d92b52', text: '同步失败：' + (st.error || '未知原因') };
    return { tone: '#12906f', text: '已同步 · ' + agoText(st.lastSyncAt) };
  }

  function cloudCardHtml() {
    if (!Cloud) return '';
    var st = Cloud.status();
    var tone = cloudStatusText(st);
    var html = '<div class="section-title"><h2>账号与云端</h2></div>';
    html += '<div class="card" style="margin-bottom:10px;font-size:13px;color:var(--ink-2);line-height:1.85">';
    html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">' +
      '<div style="width:38px;height:38px;border-radius:12px;background:var(--primary-weak);display:grid;place-items:center;font-size:19px">&#9729;</div>' +
      '<div style="flex:1">' +
      '<div style="font-weight:800;font-size:14.5px">' + (st.signedIn ? esc(maskEmail(st.email)) : '云端同步（可选）') + '</div>' +
      '<div style="font-size:12px;color:' + tone.tone + ';margin-top:2px">' + esc(tone.text) + '</div>' +
      '</div></div>';

    if (st.signedIn) {
      html += '<div style="font-size:12px;color:var(--ink-3);line-height:1.7">同一账号在任何设备打开都能接着学。云端只存你自己账号下的档案，别人看不到；本机也保留完整副本，断网照常学。</div>';
      html += '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="btn btn-ghost" id="btnSyncNow" style="padding:8px 14px;font-size:13px">立即同步</button>' +
        '<button class="btn btn-ghost" id="btnSignOut" style="padding:8px 14px;font-size:13px">退出登录</button>' +
        '<button class="btn btn-ghost" id="btnPrivacy" style="padding:8px 14px;font-size:13px">隐私说明</button>' +
        '<button class="btn btn-ghost" id="btnPurgeCloud" style="padding:8px 14px;font-size:13px;color:#d92b52">清除云端数据</button>' +
        '</div>';
    } else if (st.needsOnline) {
      html += '<div style="font-size:12px;color:var(--ink-3);line-height:1.7">你现在打开的是离线文件版。云端登录需要浏览器同源环境，改用发布后的线上网址打开就能登录，两台设备会自动接上同一份进度。</div>';
      html += '<div style="margin-top:10px"><button class="btn btn-ghost" id="btnPrivacy" style="padding:8px 14px;font-size:13px">隐私说明</button></div>';
    } else {
      html += '<div style="font-size:12px;color:var(--ink-3);line-height:1.7">用邮箱注册后，同一账号在各设备看到同一份进度。不注册也照常能用，进度会好好待在这台电脑上。</div>';
      html += '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="btn btn-primary" id="btnLogin" style="padding:9px 16px;font-size:13.5px">登录 / 注册</button>' +
        '<button class="btn btn-ghost" id="btnPrivacy" style="padding:8px 14px;font-size:13px">隐私说明</button>' +
        '</div>';
    }
    html += '</div>';
    return html;
  }

  function bindCloudCard() {
    if (!Cloud) return;
    var bl = $('#btnLogin');
    if (bl) bl.onclick = openAuthSheet;
    var bp = $('#btnPrivacy');
    if (bp) bp.onclick = openPrivacy;
    var bs = $('#btnSyncNow');
    if (bs) bs.onclick = function () {
      bs.disabled = true;
      bs.textContent = '同步中…';
      Cloud.syncNow({ force: true }).then(function (r) {
        toast('已同步：云端 ' + r.pulled + ' 个档案，合并 ' + r.merged + ' 个');
        render();
      }).catch(function (e) {
        toast('同步失败：' + (e.message || e));
        render();
      });
    };
    var bp2 = $('#btnPurgeCloud');
    if (bp2) bp2.onclick = function () {
      var n = Store.listProfiles().length;
      var msg = '这会永久删除你账号下的全部云端记录（本机进度不受影响，仍在）。\n\n' +
        '删除后本次登录会自动退出；换设备再登录就看不到这些进度了。\n' +
        '如果之后继续在本机学习并重新登录，会重新上传。\n\n' +
        '确定删除 ' + n + ' 个小朋友的云端记录吗？';
      if (!confirm(msg)) return;
      bp2.disabled = true;
      bp2.textContent = '删除中…';
      Cloud.deleteCloudData().then(function () {
        return Cloud.signOut();
      }).then(function () {
        toast('云端数据已清除，本机进度仍保留');
        render();
      }).catch(function (e) {
        toast('清除失败：' + (e.message || e));
        bp2.disabled = false;
        bp2.textContent = '清除云端数据';
      });
    };
    var bo = $('#btnSignOut');
    if (bo) bo.onclick = function () {
      if (!confirm('退出登录后，本机进度仍然保留，只是不再同步到云端。确定退出？')) return;
      Cloud.signOut().then(function () { toast('已退出登录'); render(); });
    };
  }

  /* ---------- 登录 / 注册（邮箱验证码 / 邮箱密码） ---------- */
  function openAuthSheet() {
    pendingOtp = null;
    pendingReset = null;
    authMode = 'otp';
    renderAuthStep1();
  }

  function authError(msg) {
    var el = $('#authErr');
    if (el) el.textContent = msg || '';
  }

  /** 把浏览器原始的英文网络错误翻成人话，避免用户看到 Failed to fetch 不知所措 */
  function authErrText(e) {
    var m = String((e && (e.message || e)) || '');
    if (/Failed to fetch|NetworkError|network error|load failed|fetch/i.test(m)) {
      return '连不上云端服务。请确认用发布后的 https 网址打开、网络正常，然后重试。';
    }
    if (/timeout|timed out/i.test(m)) return '云端响应超时，请稍后重试。';
    return m || '操作失败，请重试';
  }

  /** 登录方式切换条 */
  function authTabsHtml() {
    var on = 'flex:1;border:0;padding:9px 6px;border-radius:9px;font-weight:700;font-size:13.5px;cursor:pointer;';
    var act = 'background:#fff;color:var(--primary);box-shadow:0 1px 4px rgba(30,50,110,.10);';
    var idle = 'background:transparent;color:var(--ink-3);';
    return '<div style="display:flex;gap:6px;background:#f1f4fb;padding:4px;border-radius:12px;margin:2px 0 16px">' +
      '<button type="button" id="authTabOtp" style="' + on + (authMode === 'otp' ? act : idle) + '">验证码登录</button>' +
      '<button type="button" id="authTabPwd" style="' + on + (authMode === 'password' ? act : idle) + '">密码登录</button>' +
      '</div>';
  }

  function bindAuthTabs() {
    var a = $('#authTabOtp'), b = $('#authTabPwd');
    if (a) a.onclick = function () { authMode = 'otp'; renderAuthStep1(); };
    if (b) b.onclick = function () { authMode = 'password'; renderAuthStep1(); };
  }

  function renderAuthStep1() {
    var isPwd = authMode === 'password';
    sheet.innerHTML = '<div class="sheet-handle"></div>' +
      '<h3>登录 / 注册</h3>' +
      authTabsHtml() +
      (isPwd
        ? '<p class="sheet-sub">用邮箱和密码登录；忘记密码可通过邮箱验证码重置。</p>' +
          '<div class="field"><label>邮箱</label>' +
          '<input class="text-input" id="authEmail" type="email" inputmode="email" autocomplete="email" placeholder="name@example.com" /></div>' +
          '<div class="field"><label>密码</label>' +
          '<input class="text-input" id="authPassword" type="password" autocomplete="current-password" placeholder="请输入密码" /></div>' +
          '<div id="authErr" style="font-size:12.5px;color:#d92b52;min-height:18px;margin:2px 2px 6px"></div>' +
          '<button class="btn btn-primary btn-block btn-lg" id="authPwdLogin">登 录</button>' +
          '<div style="height:10px"></div>' +
          '<button class="btn btn-ghost btn-block" id="authForgot">忘记密码？用邮箱验证码重置</button>'
        : '<p class="sheet-sub">用邮箱识别身份，不用设密码、不用记用户名。</p>' +
          '<div class="field"><label>小朋友昵称<span style="font-weight:500;color:var(--ink-3)">（可选，随便起，不用真名）</span></label>' +
          '<input class="text-input" id="authNick" maxlength="12" placeholder="例如：小雨" /></div>' +
          '<div class="field"><label>邮箱</label>' +
          '<input class="text-input" id="authEmail" type="email" inputmode="email" autocomplete="email" placeholder="name@example.com" /></div>' +
          '<div id="authErr" style="font-size:12.5px;color:#d92b52;min-height:18px;margin:2px 2px 6px"></div>' +
          '<button class="btn btn-primary btn-block btn-lg" id="authSend">获取验证码</button>') +
      '<div style="height:8px"></div><button class="btn btn-ghost btn-block" id="authCancel">取消</button>' +
      '<div style="font-size:11.5px;color:var(--ink-3);line-height:1.75;margin-top:12px">' +
      '注册只需邮箱与昵称，不收集真实姓名、手机号等信息。提交前请阅读' +
      '<a href="javascript:void(0)" id="authPrivacy" style="color:var(--primary);font-weight:700">《隐私与数据说明》</a>。' +
      '</div>';
    sheetMask.hidden = false;
    setTimeout(function () { var i = $('#authEmail'); if (i) i.focus(); }, 80);

    bindAuthTabs();
    $('#authCancel').onclick = closeSheet;
    $('#authPrivacy').onclick = openPrivacy;

    if (isPwd) {
      $('#authForgot').onclick = function () {
        var e = ($('#authEmail').value || '').trim();
        renderForgotStep1(e);
      };
      var doLogin = function () {
        var email = ($('#authEmail').value || '').trim();
        var emEl = $('#authEmail'); if (emEl && emEl.value !== email) emEl.value = email;  // 回填去空格后的地址，肉眼可核对
        var pwd = ($('#authPassword').value || '');
        authError('');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { authError('请填写正确的邮箱地址'); return; }
        if (!pwd) { authError('请输入密码'); return; }
        var btn = $('#authPwdLogin');
        btn.disabled = true;
        btn.textContent = '登录中…';
        Cloud.signInWithPassword(email, pwd).then(function (res) {
          return finishSignIn(res, '');
        }).catch(function (e) {
          authError(authErrText(e));
          btn.disabled = false;
          btn.textContent = '登 录';
        });
      };
      $('#authPwdLogin').onclick = doLogin;
      $('#authPassword').onkeydown = function (e) { if (e.key === 'Enter') doLogin(); };
      return;
    }

    $('#authSend').onclick = function () {
      var email = ($('#authEmail').value || '').trim();
      var emEl = $('#authEmail'); if (emEl && emEl.value !== email) emEl.value = email;  // 回填去空格后的地址，肉眼可核对
      var nick = ($('#authNick').value || '').trim();
      authError('');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { authError('请填写正确的邮箱地址'); return; }
      var btn = $('#authSend');
      btn.disabled = true;
      btn.textContent = '发送中…';
      Cloud.sendCode(email).then(function (pending) {
        pendingOtp = pending;
        pendingOtp.nick = nick;
        renderAuthStep2(pending);
      }).catch(function (e) {
        authError(authErrText(e));
        btn.disabled = false;
        btn.textContent = '获取验证码';
      });
    };
  }

  /* ---------- 找回密码（邮箱验证码 → 设置新密码） ---------- */
  function renderForgotStep1(prefill) {
    sheet.innerHTML = '<div class="sheet-handle"></div>' +
      '<h3>找回密码</h3>' +
      '<p class="sheet-sub">输入注册邮箱，我们会发送验证码，验证后可设置新密码。</p>' +
      '<div class="field"><label>注册邮箱</label>' +
      '<input class="text-input" id="resetEmail" type="email" inputmode="email" autocomplete="email" placeholder="name@example.com" value="' + esc(prefill || '') + '" /></div>' +
      '<div id="authErr" style="font-size:12.5px;color:#d92b52;min-height:18px;margin:2px 2px 6px"></div>' +
      '<button class="btn btn-primary btn-block btn-lg" id="resetSend">发送验证码</button>' +
      '<div style="height:8px"></div><button class="btn btn-ghost btn-block" id="resetBack">返回登录</button>';
    sheetMask.hidden = false;
    setTimeout(function () { var i = $('#resetEmail'); if (i) i.focus(); }, 80);

    $('#resetBack').onclick = function () { authMode = 'password'; renderAuthStep1(); };
    $('#resetSend').onclick = function () {
      var email = ($('#resetEmail').value || '').trim();
      authError('');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { authError('请填写正确的邮箱地址'); return; }
      var btn = $('#resetSend');
      btn.disabled = true;
      btn.textContent = '发送中…';
      Cloud.requestPasswordReset(email).then(function (pending) {
        pendingReset = pending;
        renderForgotStep2(pending);
      }).catch(function (e) {
        authError(authErrText(e));
        btn.disabled = false;
        btn.textContent = '发送验证码';
      });
    };
  }

  function renderForgotStep2(pending) {
    sheet.innerHTML = '<div class="sheet-handle"></div>' +
      '<h3>设置新密码</h3>' +
      '<p class="sheet-sub">验证码已发到 <b>' + esc(maskEmail(pending.email)) + '</b>。</p>' +
      '<div class="field"><label>邮箱验证码</label>' +
      '<input class="text-input" id="resetCode" inputmode="numeric" maxlength="8" autocomplete="one-time-code" placeholder="123456" style="letter-spacing:6px;font-size:20px;text-align:center" /></div>' +
      '<div class="field"><label>新密码<span style="font-weight:500;color:var(--ink-3)">（至少 6 位）</span></label>' +
      '<input class="text-input" id="resetPwd1" type="password" autocomplete="new-password" placeholder="设置新密码" /></div>' +
      '<div class="field"><label>确认新密码</label>' +
      '<input class="text-input" id="resetPwd2" type="password" autocomplete="new-password" placeholder="再输入一次" /></div>' +
      '<div id="authErr" style="font-size:12.5px;color:#d92b52;min-height:18px;margin:2px 2px 6px"></div>' +
      '<button class="btn btn-primary btn-block btn-lg" id="resetSubmit">重置密码并登录</button>' +
      '<div style="height:8px"></div>' +
      '<div style="display:flex;gap:8px">' +
      '<button class="btn btn-ghost" id="resetBack2" style="flex:1">换个邮箱</button>' +
      '<button class="btn btn-ghost" id="resetResend" style="flex:1">重新发送</button>' +
      '</div>';
    sheetMask.hidden = false;
    setTimeout(function () { var i = $('#resetCode'); if (i) i.focus(); }, 80);

    $('#resetBack2').onclick = function () { renderForgotStep1(pending.email); };
    $('#resetResend').onclick = function () {
      var b = $('#resetResend');
      b.disabled = true;
      b.textContent = '发送中…';
      Cloud.requestPasswordReset(pending.email).then(function (np) {
        pendingReset = np;
        toast('已重新发送');
        b.disabled = false;
        b.textContent = '重新发送';
      }).catch(function (e) {
        authError(authErrText(e));
        b.disabled = false;
        b.textContent = '重新发送';
      });
    };
    var submit = function () {
      var code = ($('#resetCode').value || '').trim();
      var p1 = ($('#resetPwd1').value || '');
      var p2 = ($('#resetPwd2').value || '');
      authError('');
      if (!code) { authError('请输入收到的验证码'); return; }
      if (p1.length < 6) { authError('密码至少 6 位'); return; }
      if (p1 !== p2) { authError('两次输入的密码不一致'); return; }
      var btn = $('#resetSubmit');
      btn.disabled = true;
      btn.textContent = '提交中…';
      Cloud.resetPassword(pending, code, p1).then(function (res) {
        toast('密码已设置，正在登录…');
        return finishSignIn({ email: res.email, isExistingUser: true }, '');
      }).catch(function (e) {
        authError(authErrText(e));
        btn.disabled = false;
        btn.textContent = '重置密码并登录';
      });
    };
    $('#resetSubmit').onclick = submit;
    $('#resetCode').onkeydown = function (e) { if (e.key === 'Enter') submit(); };
  }

  function renderAuthStep2(pending) {
    sheet.innerHTML = '<div class="sheet-handle"></div>' +
      '<h3>输入验证码</h3>' +
      '<p class="sheet-sub">验证码已发到 <b>' + esc(maskEmail(pending.email)) + '</b>，几分钟内有效。</p>' +
      '<div class="field"><label>6 位验证码</label>' +
      '<input class="text-input" id="authCode" inputmode="numeric" maxlength="8" autocomplete="one-time-code" placeholder="123456" style="letter-spacing:6px;font-size:20px;text-align:center" /></div>' +
      '<div id="authErr" style="font-size:12.5px;color:#d92b52;min-height:18px;margin:2px 2px 6px"></div>' +
      '<button class="btn btn-primary btn-block btn-lg" id="authVerify">完成登录</button>' +
      '<div style="height:8px"></div>' +
      '<div style="display:flex;gap:8px">' +
      '<button class="btn btn-ghost" id="authBack" style="flex:1">换个邮箱</button>' +
      '<button class="btn btn-ghost" id="authResend" style="flex:1">重新发送</button>' +
      '</div>';
    sheetMask.hidden = false;
    setTimeout(function () { var i = $('#authCode'); if (i) i.focus(); }, 80);

    $('#authBack').onclick = renderAuthStep1;
    $('#authResend').onclick = function () {
      var b = $('#authResend');
      b.disabled = true;
      b.textContent = '发送中…';
      Cloud.sendCode(pending.email).then(function (np) {
        pendingOtp = np;
        pendingOtp.nick = pending.nick;
        toast('已重新发送');
        b.disabled = false;
        b.textContent = '重新发送';
      }).catch(function (e) {
        authError(authErrText(e));
        b.disabled = false;
        b.textContent = '重新发送';
      });
    };
    var sub = function () {
      var code = ($('#authCode').value || '').trim();
      if (!code) { authError('请输入收到的验证码'); return; }
      var btn = $('#authVerify');
      btn.disabled = true;
      btn.textContent = '验证中…';
      Cloud.verifyCode(pending, code).then(function (res) {
        return finishSignIn(res, pending.nick);
      }).catch(function (e) {
        authError(authErrText(e));
        btn.disabled = false;
        btn.textContent = '完成登录';
      });
    };
    $('#authVerify').onclick = sub;
    $('#authCode').onkeydown = function (e) { if (e.key === 'Enter') sub(); };
  }

  /** 登录成功后的收尾：拉云端 → 都没有档案时用昵称建一个 */
  function finishSignIn(res, nick) {
    closeSheet();
    return Cloud.syncNow({ force: true }).then(function () {
      if (Store.listProfiles().length) return null;
      // 没有本地档案时：优先用管理员在后台「预建账号」里填的昵称与年级
      var useInvite = function (inv) {
        var name = (inv && inv.kid_name) || nick;
        if (!name) return null;
        var np = Store.createProfile(name, '🐣');
        Store.setActive(np.id);
        if (inv && inv.grade) Store.updateSettings(np.id, { grade: Number(inv.grade) || 1 });
        applyGradeScope(Store.getProfile(np.id));
        return Cloud.flushPush();
      };
      if (!Cloud.fetchInvite) return useInvite(null);
      return Cloud.fetchInvite().then(function (inv) {
        return useInvite(inv);
      }, function () { return useInvite(null); });
    }).then(function () {
      toast(res.isExistingUser ? '欢迎回来，进度已同步' : '注册成功，开始学习吧');
      if (!location.hash || location.hash === '#/') location.hash = '#/home';
      render();
    }).catch(function (e) {
      toast('登录成功，但同步暂时失败：' + (e.message || e));
      render();
    });
  }

  /* ---------- 隐私与数据说明 ---------- */
  function openPrivacy() {
    var rows = [
      ['收集哪些信息',
        '只有两项：<b>小朋友昵称</b>（注册时自己起，可以是小名，不需要真实姓名）和<b>邮箱</b>（仅用于识别账号、找回进度）。'],
      ['不收集什么',
        '不收集真实姓名、身份证号、手机号、住址、位置、照片、通讯录、设备识别码，也不做任何行为画像或广告投放。'],
      ['数据存在哪里',
        '两部分：① 本机浏览器本地存储（离线也能用）；② 登录状态下同步一份到云端数据库。云端数据库按账号做了行级隔离，服务端强制校验身份，<b>别的家长登录后读不到你的数据</b>。'],
      ['关于 Cookie 与本地存储',
        '本应用不使用广告 Cookie，也不使用第三方统计。浏览器本地存储只做两件事：保存登录状态（免得每次都要输验证码）和缓存学习进度以支持离线。清除浏览器数据会退出登录，重新登录即可从云端取回进度。'],
      ['登录时会跳转吗',
        '不会跳到第三方页面，也没有广告或统计插件。验证码直接在当前页填写，整个登录过程不离开本应用。'],
      ['访问权限与分享',
        '本站通过邀请链接访问，没有拿到链接的人打不开，确保只有你邀请的家庭能看到。' +
        '<b>第一次必须点带分享码的完整链接</b>（形如 <code>…/?sharecode=…</code>）；打开后浏览器会记住一个 30 天的访问凭据' +
        '（一个只用于验证访问权限的 cookie，不含任何个人信息）。这期间直接输入网址也能进；' +
        '换浏览器、清了缓存或换设备时，重新点一次分享链接即可。链接请只发给亲友，别发到公开群或社交平台。'],
      ['未成年人保护',
        '本应用面向小学生，账号由家长代为注册。我们只保存一个昵称，不采集任何可识别儿童真实身份的信息；家长可随时在「我的 → 账号」中退出登录或清除云端数据。'],
      ['如何删除数据',
        '本机数据：在浏览器里清除本站数据，或在「我的」删除对应的小朋友档案。云端数据：登录后点「账号与云端 → 清除云端数据」，会永久删除该账号下的全部云端记录并自动退出登录。'],
      ['变更与联系',
        '隐私政策如有变更会在应用内提示。问题请联系 ' + (META.contact || META.author) + '。']
    ];
    sheet.innerHTML = '<div class="sheet-handle"></div>' +
      '<h3>隐私与数据说明</h3>' +
      '<p class="sheet-sub">更新日期 2026-10-25 · 适用于 v' + esc(META.version) + ' 及以后版本</p>' +
      '<div style="max-height:52vh;overflow:auto">' +
      rows.map(function (r) {
        return '<div style="padding:11px 2px;border-bottom:1px solid var(--line)">' +
          '<div style="font-weight:800;font-size:13.5px;margin-bottom:4px">' + r[0] + '</div>' +
          '<div style="font-size:12.5px;color:var(--ink-2);line-height:1.75">' + r[1] + '</div>' +
          '</div>';
      }).join('') +
      '</div>' +
      '<div style="height:14px"></div>' +
      '<button class="btn btn-primary btn-block btn-lg" id="privacyOk">我明白了</button>';
    sheetMask.hidden = false;
    $('#privacyOk').onclick = function () {
      if (pendingOtp) { renderAuthStep1(); } else { closeSheet(); }
    };
  }

  /* ================= 关于 / 开源声明 ================= */
  var THIRD_PARTY = [
    { name: '《现代汉语常用字表》3500 字', use: '汉字范围与字序', repo: 'jinghu-moon/Simplified-Chinese-Characters', license: 'MIT', copyright: 'Copyright (c) 2022 jinghu-moon' },
    { name: 'hanziDB 汉字使用频率', use: '汉字分组排序', repo: 'ruddfawcett/hanziDB.csv', license: 'MIT', copyright: 'Copyright (c) 2017 Rudd Fawcett' },
    { name: 'chinese-dictionary 汉语字典数据', use: '拼音与释义', repo: 'mapull/chinese-dictionary', license: 'MIT', copyright: 'Copyright (c) 2021 码谱' },
    { name: '中华新华字典数据库', use: '部首与笔画', repo: 'pwxcoo/chinese-xinhua', license: 'MIT', copyright: 'Copyright (c) 2018 PWXCOO' },
    { name: 'jieba 中文分词词典', use: '组词词频排序', repo: 'fxsjy/jieba', license: 'MIT', copyright: 'Copyright (c) 2013 Sun Junyi' },
    { name: '普通话拼音音节音频', use: '中文与词语发音（内置 766 个音节）', repo: 'davinfifield/mp3-chinese-pinyin-sound', license: 'Unlicense（公有领域）', copyright: '已捐入公有领域，可自由使用' },
    { name: 'pypinyin 汉语拼音库', use: '组词补拼音（仅生成词库时使用，不随软件分发）', repo: 'mozillazg/python-pinyin', license: 'MIT', copyright: 'Copyright (c) 2016 mozillazg' }
  ];

  function openAbout() {
    var LOG = (META.changelog || []);
    sheet.innerHTML = '<div class="sheet-handle"></div>' +
      '<div style="text-align:center;padding:6px 0 2px">' +
      '<div style="font-size:44px">🌱</div>' +
      '<h3 style="margin-top:8px">' + esc(META.name) + '</h3>' +
      '<p class="sheet-sub" style="margin-bottom:6px">' + esc(META.subtitle) + '</p>' +
      '<div class="chip violet">版本 ' + esc(META.version) + '</div>' +
      (META.build ? ' <span class="chip">' + esc(META.build) + '</span>' : '') +
      '</div>' +
      '<div class="list" style="margin-top:14px">' +
      '<div class="row"><div class="row-main"><div class="row-title">作者</div>' +
      '<div class="row-sub">' + esc(META.author) + (META.contact ? ' · ' + esc(META.contact) : '') + '</div></div></div>' +
      '<div class="row"><div class="row-main"><div class="row-title">许可协议</div>' +
      '<div class="row-sub">本软件以 ' + esc(META.license) + ' 许可发布　' + esc(META.copyright) + ' ' + esc(META.author) + '</div></div></div>' +
      '<div class="row"><div class="row-main"><div class="row-title">运行方式</div>' +
      '<div class="row-sub">网页 + 云端账号；不登录只存本机，登录后同步上云、仅本人可见</div></div></div>' +
      '<div class="row"><div class="row-main"><div class="row-title">发音来源</div>' +
      '<div class="row-sub">中文：随软件内置的拼音音节音频（离线可用）；英语：浏览器自带的语音引擎</div></div></div>' +
      '</div>' +
      // ---------- 版本更新记录 ----------
      '<div class="section-title" style="margin:18px 0 8px"><h2 style="font-size:14px">版本更新记录</h2></div>' +
      (LOG.length ? '<div class="list">' + LOG.map(function (c) {
        var cur = String(c.ver) === String(META.version);
        return '<div class="row" style="align-items:flex-start;padding:11px 14px"><div class="row-main">' +
          '<div class="row-title" style="font-size:13.5px">v' + esc(c.ver) +
          (c.date ? '<span style="font-size:11.5px;color:var(--ink-3);font-weight:600;margin-left:8px">' + esc(c.date) + '</span>' : '') +
          (cur ? '<span class="chip mint" style="font-size:10.5px;margin-left:6px;padding:2px 7px">当前版本</span>' : '') +
          '</div>' +
          (c.items || []).map(function (it) {
            return '<div class="row-sub" style="font-size:12px;line-height:1.65">· ' + esc(it) + '</div>';
          }).join('') +
          '</div></div>';
      }).join('') + '</div>'
        : '<div style="font-size:12px;color:var(--ink-3)">暂无记录。</div>') +
      '<div class="section-title" style="margin:18px 0 8px"><h2 style="font-size:14px">第三方开源数据声明</h2></div>' +
      '<div style="font-size:12px;color:var(--ink-3);line-height:1.7;margin-bottom:8px">' +
      '下列数据集分别以 MIT 或 Unlicense（公有领域）许可使用，版权归原作者所有。本软件仅使用其数据，未修改或再分发其源代码。' +
      '</div>' +
      '<div class="list">' + THIRD_PARTY.map(function (t) {
        return '<div class="row" style="padding:11px 14px"><div class="row-main">' +
          '<div class="row-title" style="font-size:13.5px">' + esc(t.name) + '</div>' +
          '<div class="row-sub">' + esc(t.repo) + ' · ' + esc(t.license) + ' · ' + esc(t.use) + '</div>' +
          '<div class="row-sub" style="font-size:11.5px">' + esc(t.copyright) + '</div>' +
          '</div></div>';
      }).join('') + '</div>' +
      '<div style="font-size:12px;color:var(--ink-3);line-height:1.7;margin-top:12px">' +
      '中文发音使用上述「普通话拼音音节音频」（公有领域），不是第三方语音引擎；英语发音使用浏览器内置的 Web Speech API。' +
      '英语词库按课程标准的词汇范围自行整理。完整声明见随附的 THIRD-PARTY-NOTICES.md。</div>' +
      '<div style="height:14px"></div>' +
      '<button class="btn btn-primary btn-block btn-lg" onclick="document.getElementById(\'sheetMask\').hidden=true">关闭</button>';
    sheetMask.hidden = false;
  }

  /* ================= 存储提示 ================= */
  function openStorageHelp() {
    var mode = Store.storageMode();
    sheet.innerHTML = '<div class="sheet-handle"></div>' +
      '<h3>为什么档案会消失？</h3>' +
      '<p class="sheet-sub">' +
      (mode === 'sessionStorage'
        ? '浏览器只允许在本次标签页里临时保存，关掉标签页就会被清空。'
        : '当前页面是「预览 / 内嵌」方式打开的，浏览器出于安全限制，禁止网页在这里写入本地存储。') +
      '</p>' +
      '<div class="list" style="box-shadow:none;border-color:#e7ecf7">' +
      '<div class="row"><div class="row-main"><div class="row-title">方法一：下载单文件版（推荐）</div>' +
      '<div class="row-sub">拿到 <b>记忆小站.html</b> 后双击用浏览器打开，进度就能一直保存</div></div></div>' +
      '<div class="row"><div class="row-main"><div class="row-title">方法二：用本地服务器打开</div>' +
      '<div class="row-sub">在文件夹里执行 <code>python -m http.server 8080</code>，访问 localhost:8080</div></div></div>' +
      '<div class="row"><div class="row-main"><div class="row-title">方法三：先导出备份</div>' +
      '<div class="row-sub">在「我的 → 导出备份」存成 JSON，换环境后再导入</div></div></div>' +
      '</div>' +
      '<div style="height:12px"></div>' +
      '<button class="btn btn-primary btn-block btn-lg" onclick="document.getElementById(\'sheetMask\').hidden=true">我知道了</button>';
    sheetMask.hidden = false;
  }

  function onStorageDegrade() {
    var banner = document.getElementById('storeBanner');
    if (banner && Store.storageMode() !== 'localStorage') {
      banner.hidden = false;
      var t = document.getElementById('storeBannerText');
      if (t) t.textContent = '保存失败，已改为临时保存：关掉页面后档案会丢失';
      toast('保存空间不足，已切换为临时保存');
    }
  }

  /* ================= 档案弹层 ================= */
  var pickedAvatar = Store.AVATARS[0];
  var pickedGrade = 1;
  var pickedBook = TEXTBOOKS[0];
  var pickedStartEn = 3;

  function gradePickerHtml() {
    return '<div class="opt-row" id="gradePicker">' +
      GRADE_NAMES.map(function (g, i) {
        var n = i + 1;
        return '<button class="opt-chip' + (n === pickedGrade ? ' active' : '') + '" data-grade="' + n + '">' + g + '</button>';
      }).join('') + '</div>';
  }

  function bookPickerHtml() {
    return '<div class="opt-row wrap" id="bookPicker">' +
      TEXTBOOKS.map(function (b) {
        return '<button class="opt-chip sm' + (b === pickedBook ? ' active' : '') + '" data-book="' + esc(b) + '">' + esc(b) + '</button>';
      }).join('') + '</div>';
  }

  function startEnPickerHtml() {
    return '<div class="opt-row" id="startEnPicker">' +
      '<button class="opt-chip sm' + (pickedStartEn === 1 ? ' active' : '') + '" data-start-en="1">一年级起点</button>' +
      '<button class="opt-chip sm' + (pickedStartEn === 3 ? ' active' : '') + '" data-start-en="3">三年级起点</button>' +
      '</div>';
  }

  function scopePreviewHtml() {
    var sc = scopeUnits(pickedGrade, pickedStartEn);
    var zhCount = ZH_UNITS.filter(function (u) { return sc.unitsZh.indexOf(u.id) >= 0; })
      .reduce(function (n, u) { return n + u.words.length; }, 0);
    var pyCount = PY_UNITS.filter(function (u) { return sc.unitsPy.indexOf(u.id) >= 0; })
      .reduce(function (n, u) { return n + u.words.length; }, 0);
    var enCount = EN_UNITS.filter(function (u) { return sc.unitsEn.indexOf(u.id) >= 0; })
      .reduce(function (n, u) { return n + u.words.length; }, 0);
    var enMax = 0;
    EN_UNITS.forEach(function (u) { if (sc.unitsEn.indexOf(u.id) >= 0 && u.grade > enMax) enMax = u.grade; });
    return '<div class="scope-preview" id="scopePreview">' +
      '本次范围：中文 <b>' + zhCount + '</b> 字（第 1-' + sc.unitsZh.length + ' 组）· ' +
      '拼音 <b>' + pyCount + '</b> 条 · ' +
      '英语 <b>' + enCount + '</b> 词（到' + (GRADE_NAMES[enMax - 1] || '三年级') + '）</div>';
  }

  function bindPickers(onChange) {
    $$('#gradePicker [data-grade]').forEach(function (b) {
      b.onclick = function () {
        pickedGrade = Number(b.getAttribute('data-grade'));
        $$('#gradePicker .opt-chip').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        var pv = $('#scopePreview');
        if (pv) pv.outerHTML = scopePreviewHtml();
        if (onChange) onChange();
      };
    });
    $$('#bookPicker [data-book]').forEach(function (b) {
      b.onclick = function () {
        pickedBook = b.getAttribute('data-book');
        $$('#bookPicker .opt-chip').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
      };
    });
    $$('#startEnPicker [data-start-en]').forEach(function (b) {
      b.onclick = function () {
        pickedStartEn = Number(b.getAttribute('data-start-en'));
        $$('#startEnPicker .opt-chip').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        var pv = $('#scopePreview');
        if (pv) pv.outerHTML = scopePreviewHtml();
      };
    });
  }

  function openProfileSheet(profile) {
    pickedAvatar = profile ? profile.avatar : Store.AVATARS[Math.floor(Math.random() * Store.AVATARS.length)];
    pickedGrade = profile ? (profile.settings.grade || 1) : 1;
    pickedBook = profile ? (profile.settings.textbook || TEXTBOOKS[0]) : TEXTBOOKS[0];
    pickedStartEn = profile ? (profile.settings.startEn || 3) : 3;

    sheet.innerHTML =
      '<div class="sheet-handle"></div>' +
      '<h3>' + (profile ? '档案与学习内容' : '新建小朋友') + '</h3>' +
      '<p class="sheet-sub">选好年级和教材，练习内容就只会落在这个年级及以下。</p>' +
      '<div class="field"><label>名字</label>' +
      '<input class="text-input" id="pName" maxlength="12" placeholder="例如：小雨" value="' + esc(profile ? profile.name : '') + '" /></div>' +
      '<div class="field"><label>选个头像</label><div class="avatar-picker" id="avatarPicker">' +
      Store.AVATARS.map(function (a) {
        return '<button class="avatar-opt' + (a === pickedAvatar ? ' active' : '') + '" data-av="' + a + '">' + a + '</button>';
      }).join('') + '</div></div>' +
      '<div class="field"><label>现在读几年级</label>' + gradePickerHtml() + '</div>' +
      '<div class="field"><label>教材版本</label>' + bookPickerHtml() + '</div>' +
      '<div class="field"><label>英语起点</label>' + startEnPickerHtml() + '</div>' +
      scopePreviewHtml() +
      '<div style="height:12px"></div>' +
      '<button class="btn btn-primary btn-block btn-lg" id="pSave">' + (profile ? '保存' : '创建档案') + '</button>' +
      '<div style="height:8px"></div><button class="btn btn-ghost btn-block" id="pCancel">取消</button>';

    sheetMask.hidden = false;
    setTimeout(function () { var i = $('#pName'); if (i) i.focus(); }, 60);

    $$('#avatarPicker [data-av]').forEach(function (b) {
      b.onclick = function () {
        pickedAvatar = b.getAttribute('data-av');
        $$('#avatarPicker .avatar-opt').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
      };
    });
    bindPickers();
    $('#pCancel').onclick = closeSheet;
    $('#pSave').onclick = function () {
      var name = ($('#pName').value || '').trim();
      if (!name) { $('#pName').focus(); toast('给小朋友起个名字吧'); return; }
      if (profile) {
        Store.updateProfile(profile.id, { name: name, avatar: pickedAvatar });
        Store.updateSettings(profile.id, { grade: pickedGrade, textbook: pickedBook, startEn: pickedStartEn });
        applyGradeScope(Store.getProfile(profile.id));
        toast('已保存，学习范围已更新');
      } else {
        var np = Store.createProfile(name, pickedAvatar);
        Store.updateSettings(np.id, { grade: pickedGrade, textbook: pickedBook, startEn: pickedStartEn });
        applyGradeScope(np);
        Store.setActive(np.id);
        toast('欢迎，' + name + '！已切换到' + GRADE_NAMES[pickedGrade - 1]);
      }
      closeSheet();
      if (!location.hash) location.hash = '#/home';
      render();
    };
  }

  /** 只改年级/教材（不改名字头像） */
  function openScopeSheet(profile) {
    if (!profile) return;
    pickedGrade = profile.settings.grade || 1;
    pickedBook = profile.settings.textbook || TEXTBOOKS[0];
    pickedStartEn = profile.settings.startEn || 3;
    sheet.innerHTML =
      '<div class="sheet-handle"></div>' +
      '<h3>调整学习内容</h3>' +
      '<p class="sheet-sub">' + esc(profile.name) + '现在读几年级？练习内容会自动跟着年级走。</p>' +
      '<div class="field"><label>年级</label>' + gradePickerHtml() + '</div>' +
      '<div class="field"><label>教材版本</label>' + bookPickerHtml() + '</div>' +
      '<div class="field"><label>英语起点</label>' + startEnPickerHtml() + '</div>' +
      scopePreviewHtml() +
      '<div style="height:12px"></div>' +
      '<button class="btn btn-primary btn-block btn-lg" id="sSave">保存</button>' +
      '<div style="height:8px"></div><button class="btn btn-ghost btn-block" id="sCancel">取消</button>';
    sheetMask.hidden = false;
    bindPickers();
    $('#sCancel').onclick = closeSheet;
    $('#sSave').onclick = function () {
      Store.updateSettings(profile.id, { grade: pickedGrade, textbook: pickedBook, startEn: pickedStartEn });
      applyGradeScope(Store.getProfile(profile.id));
      closeSheet();
      toast('已切到' + GRADE_NAMES[pickedGrade - 1] + '的内容');
      render();
    };
  }

  function closeSheet() {
    sheetMask.hidden = true;
    sheet.innerHTML = '';
  }
  sheetMask.addEventListener('click', function (e) {
    if (e.target === sheetMask) closeSheet();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (!sheetMask.hidden) closeSheet();
      else if (S && !S.finished) askQuit();
    }
  });

  /* ============================================================
   *                        学习会话
   * ============================================================ */
  function startSession(modules) {
    var p = Store.activeProfile();
    if (!p) { openProfileSheet(null); return; }
    var queue = buildQueue(modules);
    if (!queue.length) {
      openEmptySheet();
      return;
    }
    S = {
      modules: modules,
      queue: queue,
      i: 0,
      total: queue.length,
      done: 0,
      correct: 0,
      startAt: Date.now(),
      finished: false,
      firstCorrect: 0,     // 首次作答就答对
      firstWrong: 0,       // 首次没答对
      relearnSet: {},      // 今天需要重学的卡片（去重）
      relearnPassed: 0,    // 重学后终于记住的张数
      phase: 'ask',
      picked: null,
      answered: false,
      cur: null
    };
    openSession();
    primeNextAudio();   // 第一张也读一遍（此处仍在点击的同步栈里）
  }

  /**
   * 预读「下一张卡」的发音。
   *
   * 为什么不用 setTimeout：iOS / Safari 只允许在用户点击的同步执行栈里发声，
   * 放到定时器里一定静默失败——这正是之前手机上听不到声音的原因。
   * 所以答案按钮的点击处理里就把下一张读完，780 ms 后卡片出现时声音已经在了。
   */
  function primeNextAudio() {
    if (!S || !S.queue) return;
    var next = S.queue[S.i];
    if (!next) return;
    var card = cardOf(next.m, next.id);
    if (!card) return;
    var st = Store.activeProfile().settings || {};
    var rate = st.ttsRate || 1;
    if (next.m === 'zh_dict') {
      Speech.speakZhCard(card, { rate: rate });          // 听写：先读字，再读一个组词
    } else if (next.m === 'zh_recog' && st.ttsAuto) {
      Speech.speakZhCard(card, { rate: rate });
    } else if (next.m === 'py_recog' && st.ttsAuto) {
      Speech.speakPyCard(card, { rate: rate });
    } else if (next.m === 'en_recog' && st.ttsAuto) {
      Speech.speakEn(card.w, rate);
    }
  }

  function openEmptySheet() {
    var p = Store.activeProfile();
    var next = nearestDue();
    sheet.innerHTML = '<div class="sheet-handle"></div>' +
      '<div style="text-align:center;padding:10px 0 4px"><div style="font-size:46px">🎉</div>' +
      '<h3 style="margin-top:8px">今天已完成</h3>' +
      '<p class="sheet-sub">' + (next
        ? '下次复习时间：<b>' + next.due + '</b>（还有 ' + next.days + ' 天）'
        : '可以到「练习范围」里多开几个单元，练更多内容。') + '</p></div>' +
      '<a class="btn btn-primary btn-block btn-lg" href="#/study" onclick="document.getElementById(\'sheetMask\').hidden=true">去选练习范围</a>' +
      '<div style="height:8px"></div><button class="btn btn-ghost btn-block" onclick="document.getElementById(\'sheetMask\').hidden=true">好的</button>';
    sheetMask.hidden = false;
  }

  function nearestDue() {
    var best = null;
    MODS.forEach(function (m) {
      var recs = Store.allRecs(m);
      Object.keys(recs).forEach(function (k) {
        var r = recs[k];
        if (r && r.due) {
          var d = SRS.daysUntil(r.due);
          if (d > 0 && (!best || d < best.days)) best = { due: r.due, days: d };
        }
      });
    });
    return best;
  }

  function openSession() {
    sessionRoot = document.createElement('div');
    sessionRoot.className = 'session';
    sessionRoot.id = 'session';
    sessionRoot.innerHTML =
      '<div class="session-head">' +
      '<button class="close-x" id="sClose">✕</button>' +
      '<div class="session-progress"><div class="meta"><span id="sMeta">第 1 张</span><span id="sPct">0%</span></div>' +
      '<div class="bar"><i id="sBar" style="width:0%"></i></div></div>' +
      '</div>' +
      '<div class="session-body" id="sBody"></div>' +
      '<div class="session-foot" id="sFoot"></div>';
    document.body.appendChild(sessionRoot);
    $('#sClose').onclick = askQuit;
    nextCard();
  }

  function askQuit() {
    if (!S || S.finished) { closeSession(); return; }
    var left = Math.max(0, S.queue.length - S.i);
    var msg = left > 0
      ? '还有 ' + left + ' 张没学完（没记住的会重新出现，直到记住为止）。现在退出就算今天先放弃，它们明天还会再来。确定退出？'
      : '要结束这次练习吗？已经答过的卡片会保存。';
    if (confirm(msg)) closeSession();
  }

  function closeSession() {
    if (sessionRoot) sessionRoot.remove();
    sessionRoot = null;
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    Speech.stop();
    S = null;
    render();
  }

  function nextCard() {
    if (!S) return;
    if (S.i >= S.queue.length) { finishSession(); return; }
    S.cur = S.queue[S.i];
    S.phase = 'ask';
    S.picked = null;
    S.answered = false;
    var m = S.cur.m;
    if (m === 'en_recog' || m === 'zh_recog') renderRecogAsk();
    else if (m === 'en_spell') renderSpellAsk();
    else if (m === 'py_recog') renderPyRecogAsk();
    else if (m === 'py_spell') renderPySpellAsk();
    else renderDictAsk();
    updateSessionProgress();
  }

  function updateSessionProgress() {
    if (!S) return;
    var el1 = $('#sMeta'), el2 = $('#sPct'), bar = $('#sBar');
    if (!el1) return;
    var left = Math.max(0, S.queue.length - S.i);
    var p = Math.min(100, Math.round((S.done / S.total) * 100));
    if (S.done >= S.total) {
      el1.textContent = '巩固重学 · 还剩 ' + left + ' 张';
      p = 100;
    } else {
      el1.textContent = '第 ' + Math.min(S.done + 1, S.total) + ' / ' + S.total + ' 张' +
        (left > S.total - S.done ? ' · 待重学 ' + (left - (S.total - S.done)) : '');
    }
    el2.textContent = p + '%';
    bar.style.width = p + '%';
  }

  function body(html) { $('#sBody').innerHTML = html; }
  function foot(html) { $('#sFoot').innerHTML = html; }

  /* ---------- 模式一：认词 / 认字 ---------- */
  function renderRecogAsk() {
    var m = S.cur.m;
    var card = cardOf(m, S.cur.id);
    if (!card) { S.i += 1; nextCard(); return; }
    var isEn = m === 'en_recog';

    body(
      '<div class="quiz-card">' +
      '<span class="quiz-tag">' + esc(card.unit) + (isEn ? ' · ' + (card.grade || '') + '年级' : '') + '</span>' +
      (isEn
        ? '<div class="quiz-word">' + esc(card.w) + '</div>'
        : '<div class="quiz-char">' + esc(card.c) + '</div>') +
      '<div class="quiz-hint">' + (isEn ? '读一读，你认识它吗？' : '看一看，这个字你认识吗？') + '</div>' +
      speakBtnHtml('btnSpeak', isEn ? '朗读' : '读字 + 组词') +
      '</div>'
    );
    foot('<div class="btn-pair">' +
      '<button class="btn btn-rose btn-lg" id="btnNo">不认识</button>' +
      '<button class="btn btn-mint btn-lg" id="btnYes">认识</button>' +
      '</div>');

    $('#btnSpeak').onclick = function () {
      if (isEn) Speech.speakEn(card.w, Store.activeProfile().settings.ttsRate);
      else Speech.speakZhCard(card, { rate: Store.activeProfile().settings.ttsRate });
    };
    $('#btnYes').onclick = function () { S.picked = 'yes'; renderRecogAnswer(); };
    $('#btnNo').onclick = function () { S.picked = 'no'; renderRecogAnswer(); };
  }

  /** 喇叭按钮（浏览器完全不支持发声时置灰并提示） */
  function speakBtnHtml(id, title, extraStyle) {
    var ok = window.Speech && Speech.audioReady();
    return '<button class="speak-btn' + (ok ? '' : ' off') + '" id="' + id + '" title="' + esc(title || '朗读') + '"' +
      (extraStyle ? ' style="' + extraStyle + '"' : '') +
      (ok ? '' : ' aria-disabled="true"') + '>🔊</button>';
  }

  /** 组词拆成可点的小标签：点哪个读哪个（都是音节音频连读） */
  function wordChipsHtml(words, style) {
    var list = String(words || '').split(/[、,，/；;|]/).map(function (w) { return String(w).trim(); })
      .filter(function (w) { return w; });
    if (!list.length) return '';
    return '<div class="word-chips" style="' + (style || '') + '">' + list.map(function (w) {
      return '<button class="word-chip" data-word="' + esc(w) + '">🔊 ' + esc(w) + '</button>';
    }).join('') + '</div>';
  }

  /** 给组词标签挂上朗读 */
  function bindWordChips(root, rate) {
    $$('.word-chip', root || document).forEach(function (b) {
      b.onclick = function () {
        var w = b.getAttribute('data-word');
        if (!w) return;
        Speech.speakZhWord(w, { rate: rate || Store.activeProfile().settings.ttsRate });
      };
    });
  }

  function renderRecogAnswer() {
    var m = S.cur.m;
    var card = cardOf(m, S.cur.id);
    var isEn = m === 'en_recog';
    S.phase = 'answer';

    var inner = isEn
      ? '<div class="answer-box">' +
        '<div class="answer-zh">' + esc(card.zh) + '</div>' +
        '<div class="answer-meta">' +
        (card.pos ? '<span class="chip">' + esc(card.pos) + '</span>' : '') +
        '<span class="chip mint">' + esc(card.unit) + '</span>' +
        '</div>' +
        '<div class="answer-say"><button class="btn btn-ghost" id="btnSpeak2" style="padding:8px 14px;font-size:13px">🔊 听发音</button></div>' +
        '</div>'
      : '<div class="answer-box">' +
        '<div class="answer-zh" style="font-size:26px">' + esc(card.c) + '</div>' +
        '<div class="answer-meta" style="margin-top:6px">' +
        (Store.activeProfile().settings.showPinyin ? '<span class="chip violet">' + esc(card.pinyin) + '</span>' : '') +
        (card.radical ? '<span class="chip">部首 ' + esc(card.radical) + '</span>' : '') +
        (card.strokes ? '<span class="chip">' + esc(card.strokes) + ' 画</span>' : '') +
        '</div>' +
        (card.mean ? '<div style="font-size:14px;color:var(--ink-2);margin-top:12px;line-height:1.7">' + esc(card.mean) + '</div>' : '') +
        (card.words ? wordChipsHtml(card.words, 'margin-top:8px') : '') +
        '<div class="answer-say"><button class="btn btn-ghost" id="btnSpeak2" style="padding:8px 14px;font-size:13px">🔊 读字 + 组词</button></div>' +
        '</div>';

    body('<div class="quiz-card">' +
      '<span class="quiz-tag">' + esc(moduleMeta(m).tag) + '</span>' +
      (isEn
        ? '<div style="font-size:15px;color:var(--ink-3);font-weight:600">' + esc(card.w) + '</div>'
        : '') +
      inner +
      '<div class="ask-confirm">' + (S.picked === 'yes'
        ? '再想一下：刚才你是真的想起来了，还是有点模糊？'
        : '记一下它，明天我们要再见到它。') + '</div>' +
      '</div>');

    if (S.picked === 'yes') {
      foot('<div class="btn-pair">' +
        '<button class="btn btn-amber btn-lg" id="btnHard">其实有点忘</button>' +
        '<button class="btn btn-mint btn-lg" id="btnEasy">确实认识</button>' +
        '</div>');
      $('#btnEasy').onclick = function () { answer('easy'); };
      $('#btnHard').onclick = function () { answer('hard'); };
    } else {
      foot('<div class="btn-stack"><button class="btn btn-primary btn-lg" id="btnNext">看懂啦，下一个</button></div>');
      $('#btnNext').onclick = function () { answer('forgot'); };
    }

    var s2 = $('#btnSpeak2');
    if (s2) s2.onclick = function () {
      if (isEn) Speech.speakEn(card.w, Store.activeProfile().settings.ttsRate);
      else Speech.speakZhCard(card, { rate: Store.activeProfile().settings.ttsRate });
    };
    if (!isEn) bindWordChips($('#sBody'));
  }

  /* ---------- 模式二：英语拼写 ---------- */
  function renderSpellAsk() {
    var card = cardOf('en_spell', S.cur.id);
    if (!card) { S.i += 1; nextCard(); return; }
    var letters = card.w.replace(/[^A-Za-z]/g, '');
    var tip = card.w.charAt(0).toUpperCase() + ' ' + new Array(Math.max(1, letters.length)).join('· ');

    body('<div class="quiz-card">' +
      '<span class="quiz-tag">' + esc(card.unit) + ' · 拼写</span>' +
      '<div class="quiz-word" style="font-size:clamp(28px,9vw,40px)">' + esc(card.zh) + '</div>' +
      '<div class="quiz-hint">' + (card.pos ? esc(card.pos) + ' · ' : '') + '首字母 ' + esc(card.w.charAt(0).toUpperCase()) +
      ' · 共 ' + letters.length + ' 个字母</div>' +
      '<input class="spell-input" id="spellIn" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="在这里输入英文" />' +
      '<button class="speak-btn" id="btnSpeak" title="听发音">🔊</button>' +
      '</div>');
    foot('<button class="btn btn-primary btn-lg btn-block" id="btnSubmit">确定（回车）</button>');

    var inp = $('#spellIn');
    setTimeout(function () { if (inp) inp.focus(); }, 120);
    inp.onkeydown = function (e) { if (e.key === 'Enter') submitSpell(); };
    $('#btnSubmit').onclick = submitSpell;
    $('#btnSpeak').onclick = function () { Speech.speakEn(card.w, Store.activeProfile().settings.ttsRate); };
  }

  function normalizeWord(s) {
    return String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  }

  function levenshtein(a, b) {
    var m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    var prev = new Array(n + 1);
    for (var j = 0; j <= n; j++) prev[j] = j;
    for (var i = 1; i <= m; i++) {
      var cur = [i];
      for (var k = 1; k <= n; k++) {
        cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  function submitSpell() {
    if (!S || S.phase === 'answer') return;
    var card = cardOf('en_spell', S.cur.id);
    var inp = $('#spellIn');
    var raw = inp ? inp.value : '';
    if (!raw.trim()) { toast('先写一写答案吧'); if (inp) inp.focus(); return; }
    S.phase = 'answer';
    var target = normalizeWord(card.w);
    var got = normalizeWord(raw);
    var dist = levenshtein(got, target);
    var outcome, verdict, cls;

    if (got === target) {
      outcome = 'easy';
      cls = 'ok';
      verdict = '✅ 完全正确！' + (Math.random() < 0.35 ? ' 太棒了～' : '');
    } else if (dist <= 2) {
      outcome = 'hard';
      cls = 'mid';
      verdict = '✏️ 差一点点，注意拼写细节';
    } else {
      outcome = 'forgot';
      cls = 'no';
      verdict = '❌ 再看看正确的写法';
    }
    if (inp) { inp.classList.add(got === target ? 'right' : 'wrong'); inp.disabled = true; }

    body('<div class="quiz-card">' +
      '<span class="quiz-tag">' + esc(card.unit) + ' · 拼写</span>' +
      '<div class="quiz-word" style="font-size:clamp(22px,7vw,30px);color:var(--ink-3);font-weight:700">' + esc(card.zh) + '</div>' +
      '<div class="quiz-word" style="font-size:clamp(30px,10vw,44px);margin-top:6px">' + esc(card.w) + '</div>' +
      '<div class="quiz-hint">你的答案：' + esc(raw.trim() || '（空）') + '</div>' +
      '<div class="verdict ' + cls + '">' + verdict + '</div>' +
      '<button class="speak-btn" id="btnSpeak2">🔊</button>' +
      '</div>');
    foot('<button class="btn btn-primary btn-lg btn-block" id="btnNext">继续</button>');
    $('#btnSpeak2').onclick = function () { Speech.speakEn(card.w, 0.9); };
    $('#btnNext').onclick = function () { answer(outcome); };
    Speech.speakEn(card.w, 0.9);
  }

  /* ---------- 拼音认读（与英语认词同一套交互） ---------- */
  function renderPyRecogAsk() {
    var card = cardOf('py_recog', S.cur.id);
    if (!card) { S.i += 1; nextCard(); return; }
    body(
      '<div class="quiz-card">' +
      '<span class="quiz-tag">' + esc(card.type) + ' · ' + esc(card.unit) + '</span>' +
      '<div class="quiz-word py-word">' + esc(card.pinyin) + '</div>' +
      '<div class="quiz-hint">读一读，这个音你认得吗？</div>' +
      speakBtnHtml('btnSpeak', '读例字 + 例词') +
      '</div>'
    );
    foot('<div class="btn-pair">' +
      '<button class="btn btn-rose btn-lg" id="btnNo">不认识</button>' +
      '<button class="btn btn-mint btn-lg" id="btnYes">认识</button>' +
      '</div>');

    $('#btnSpeak').onclick = function () { Speech.speakPyCard(card, { rate: Store.activeProfile().settings.ttsRate }); };
    $('#btnYes').onclick = function () { S.picked = 'yes'; renderPyRecogAnswer(); };
    $('#btnNo').onclick = function () { S.picked = 'no'; renderPyRecogAnswer(); };
  }

  function renderPyRecogAnswer() {
    var card = cardOf('py_recog', S.cur.id);
    S.phase = 'answer';

    body('<div class="quiz-card">' +
      '<span class="quiz-tag">' + esc(card.type) + ' · ' + esc(card.unit) + '</span>' +
      '<div class="quiz-word py-word" style="font-size:clamp(30px,10vw,44px);color:var(--ink-3)">' + esc(card.pinyin) + '</div>' +
      '<div class="answer-box">' +
      '<div style="display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap">' +
      '<div class="quiz-char" style="font-size:clamp(54px,18vw,84px);line-height:1">' + esc(card.c) + '</div>' +
      '<div style="text-align:left">' +
      '<div class="chip violet">' + esc(card.type) + '</div>' +
      (card.base && card.tone ? '<div style="font-size:12.5px;color:var(--ink-3);margin-top:4px">' + esc(card.base) + ' · 第 ' + card.tone + ' 声</div>' : '') +
      '</div></div>' +
      (card.word ? wordChipsHtml(card.word, 'margin-top:12px;justify-content:center') : '') +
      '<div class="answer-say"><button class="btn btn-ghost" id="btnSpeak2" style="padding:8px 14px;font-size:13px">🔊 读例字 + 例词</button></div>' +
      '</div>' +
      '<div class="ask-confirm">' + (S.picked === 'yes'
        ? '再想一下：刚才你是真的读出来了，还是有点模糊？'
        : '记一下它，明天我们要再见到它。') + '</div>' +
      '</div>');

    if (S.picked === 'yes') {
      foot('<div class="btn-pair">' +
        '<button class="btn btn-amber btn-lg" id="btnHard">其实有点忘</button>' +
        '<button class="btn btn-mint btn-lg" id="btnEasy">确实认识</button>' +
        '</div>');
      $('#btnEasy').onclick = function () { answer('easy'); };
      $('#btnHard').onclick = function () { answer('hard'); };
    } else {
      foot('<div class="btn-stack"><button class="btn btn-primary btn-lg" id="btnNext">看懂啦，下一个</button></div>');
      $('#btnNext').onclick = function () { answer('forgot'); };
    }
    var s2 = $('#btnSpeak2');
    if (s2) s2.onclick = function () { Speech.speakPyCard(card, { rate: Store.activeProfile().settings.ttsRate }); };
    bindWordChips($('#sBody'));
  }

  /* ---------- 拼音拼写（与英语拼写同一套交互 + 声调选择） ---------- */
  var pickedTone = 0;

  function normalizePy(s) {
    return String(s || '').toLowerCase()
      .replace(/ü/g, 'v')
      .replace(/[^a-zv]/g, '');
  }

  function renderPySpellAsk() {
    var card = cardOf('py_spell', S.cur.id);
    if (!card) { S.i += 1; nextCard(); return; }
    pickedTone = 0;

    body('<div class="quiz-card">' +
      '<span class="quiz-tag">' + esc(card.unit) + ' · 写拼音</span>' +
      '<div class="quiz-char" style="font-size:clamp(58px,20vw,92px)">' + esc(card.c) + '</div>' +
      '<div class="quiz-hint">写出它的拼音，再点一下声调</div>' +
      '<input class="spell-input" id="pyIn" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="输入拼音字母，如 zhong" />' +
      '<div class="tone-row" id="toneRow">' +
      '<button class="tone-btn" data-tone="1">ˉ 一声</button>' +
      '<button class="tone-btn" data-tone="2">ˊ 二声</button>' +
      '<button class="tone-btn" data-tone="3">ˇ 三声</button>' +
      '<button class="tone-btn" data-tone="4">ˋ 四声</button>' +
      '</div>' +
      '</div>');
    foot('<button class="btn btn-primary btn-lg btn-block" id="btnPySubmit">确定（回车）</button>');

    var inp = $('#pyIn');
    setTimeout(function () { if (inp) inp.focus(); }, 120);
    inp.onkeydown = function (e) { if (e.key === 'Enter') submitPySpell(); };
    $$('#toneRow [data-tone]').forEach(function (b) {
      b.onclick = function () {
        var t = Number(b.getAttribute('data-tone'));
        pickedTone = pickedTone === t ? 0 : t;
        $$('#toneRow .tone-btn').forEach(function (x) { x.classList.remove('active'); });
        if (pickedTone) b.classList.add('active');
      };
    });
    $('#btnPySubmit').onclick = submitPySpell;
  }

  function submitPySpell() {
    if (!S || S.phase === 'answer') return;
    var card = cardOf('py_spell', S.cur.id);
    var inp = $('#pyIn');
    var raw = inp ? inp.value : '';
    if (!raw.trim()) { toast('先写一写拼音吧'); if (inp) inp.focus(); return; }
    S.phase = 'answer';

    var got = normalizePy(raw);
    var target = normalizePy(card.base);
    var outcome, cls, verdict;

    if (got !== target) {
      outcome = 'forgot';
      cls = 'no';
      verdict = '❌ 拼音拼错了，看看正确写法';
    } else if (!pickedTone) {
      outcome = 'hard';
      cls = 'mid';
      verdict = '✏️ 字母对了，记得标声调';
    } else if (pickedTone === card.tone) {
      outcome = 'easy';
      cls = 'ok';
      verdict = '✅ 拼音和声调都对了！';
    } else {
      outcome = 'hard';
      cls = 'mid';
      verdict = '✏️ 字母对了，声调再想想';
    }

    body('<div class="quiz-card">' +
      '<span class="quiz-tag">' + esc(card.unit) + ' · 写拼音</span>' +
      '<div class="quiz-char" style="font-size:clamp(46px,15vw,72px);line-height:1.1">' + esc(card.c) + '</div>' +
      '<div class="quiz-word py-word" style="font-size:clamp(28px,9vw,40px);margin-top:8px">' + esc(card.pinyin) + '</div>' +
      '<div class="quiz-hint">你的答案：' + esc(raw.trim()) + (pickedTone ? ' · 第' + pickedTone + '声' : ' · 未选声调') + '</div>' +
      '<div class="verdict ' + cls + '">' + verdict + '</div>' +
      (card.word ? wordChipsHtml(card.word, 'margin-top:8px;justify-content:center') : '') +
      speakBtnHtml('btnSpeak2') +
      '</div>');
    foot('<button class="btn btn-primary btn-lg btn-block" id="btnNext">继续</button>');
    $('#btnSpeak2').onclick = function () { Speech.speakPyCard(card, { rate: 0.9 }); };
    $('#btnNext').onclick = function () { answer(outcome); };
    bindWordChips($('#sBody'), 0.9);
    Speech.speakPyCard(card, { rate: 0.9 });
  }

  /* ---------- 中文听写 ---------- */
  function renderDictAsk() {
    var card = cardOf('zh_dict', S.cur.id);
    if (!card) { S.i += 1; nextCard(); return; }
    var rate = Store.activeProfile().settings.ttsRate || 1;

    body('<div class="quiz-card">' +
      '<span class="quiz-tag">' + esc(card.unit) + ' · 听写</span>' +
      '<div style="font-size:64px;line-height:1.1;margin:8px 0 2px">🎧</div>' +
      '<div class="quiz-hint" style="font-size:14px">听发音（先读字，再读一个组词），在纸上写下来，再点「看答案」对照</div>' +
      '<button class="speak-btn" id="btnPlay" style="margin-top:18px">▶</button>' +
      '<div class="tts-row"><label>语速</label>' +
      '<input type="range" id="rateIn" min="0.4" max="1.4" step="0.1" value="' + rate + '" />' +
      '<span id="rateVal" style="font-size:12.5px;color:var(--ink-3);width:34px;text-align:right">' + Number(rate).toFixed(1) + 'x</span></div>' +
      '<div style="margin-top:6px"><button class="btn btn-ghost" id="btnAgain" style="padding:8px 14px;font-size:13px">🔁 再听一次</button></div>' +
      '</div>');
    foot('<button class="btn btn-primary btn-lg btn-block" id="btnReveal">看答案</button>');

    // 播放发生在点击栈里（iOS 才允许出声），不再用 setTimeout
    window.__playDict = function () {
      Speech.speakZhCard(card, { rate: Number(rate) });
      var b = $('#btnPlay');
      if (b) { b.classList.add('playing'); setTimeout(function () { if (b) b.classList.remove('playing'); }, 1200); }
    };
    $('#btnPlay').onclick = function () { window.__playDict(); };
    $('#btnAgain').onclick = function () { window.__playDict(); };
    $('#rateIn').oninput = function () {
      rate = Number(this.value);
      $('#rateVal').textContent = rate.toFixed(1) + 'x';
      Store.updateSettings(Store.activeProfile().id, { ttsRate: rate });
    };
    $('#btnReveal').onclick = function () { renderDictAnswer(card); };
  }

  function renderDictAnswer(card) {
    S.phase = 'answer';
    body('<div class="quiz-card">' +
      '<span class="quiz-tag">' + esc(card.unit) + ' · 听写</span>' +
      '<div class="quiz-char" style="font-size:clamp(70px,24vw,120px)">' + esc(card.c) + '</div>' +
      '<div class="answer-box">' +
      '<div class="answer-meta" style="margin-top:0">' +
      (Store.activeProfile().settings.showPinyin ? '<span class="chip violet">' + esc(card.pinyin) + '</span>' : '') +
      (card.radical ? '<span class="chip">部首 ' + esc(card.radical) + '</span>' : '') +
      (card.strokes ? '<span class="chip">' + esc(card.strokes) + ' 画</span>' : '') +
      '</div>' +
      (card.mean ? '<div style="font-size:13.5px;color:var(--ink-2);margin-top:10px;line-height:1.7">' + esc(card.mean) + '</div>' : '') +
      (card.words ? wordChipsHtml(card.words, 'margin-top:8px;justify-content:center') : '') +
      '<div class="answer-say"><button class="btn btn-ghost" id="btnSpeak2" style="padding:8px 14px;font-size:13px">🔊 再听一遍</button></div>' +
      '</div>' +
      '<div class="ask-confirm">你写对了吗？</div>' +
      '</div>');
    foot('<div class="btn-pair">' +
      '<button class="btn btn-amber btn-lg" id="btnWrong">写错了 / 写不出</button>' +
      '<button class="btn btn-mint btn-lg" id="btnRight">写对了</button>' +
      '</div>');
    $('#btnSpeak2').onclick = function () { Speech.speakZhCard(card, { rate: 0.85 }); };
    $('#btnRight').onclick = function () { answer('easy'); };
    $('#btnWrong').onclick = function () { answer('forgot'); };
    bindWordChips($('#sBody'), 0.85);
  }

  /* ---------- 统一提交 ----------
   * 规则：
   *  - 首次作答：正常写入遗忘曲线排程；
   *  - 没答对（不认识 / 拼错 / 听写错 / 拼音错、或"有点模糊"）→ 重新插回当日队列，隔几张再来；
   *  - 重学卡必须答对才离开队列，答错继续循环（有安全阀防止死循环）；
   *  - 重学答对不额外升级阶段，只保证「明天再复习一次」，避免一天之内把阶段刷高。
   */
  function answer(outcome) {
    if (!S || S.answered) return;
    S.answered = true;
    var cur = S.cur;

    if (cur.relearn) { handleRelearn(cur, outcome); return; }

    var rec = Store.getRec(cur.m, cur.id) || SRS.newRecord();
    var isNew = !rec.first;
    var next = SRS.apply(rec, outcome);
    Store.setRec(cur.m, cur.id, next);

    var ok = outcome === 'easy';
    Store.logAnswer(cur.m, ok);
    S.done += 1;
    if (ok) { S.correct += 1; S.firstCorrect += 1; } else { S.firstWrong += 1; }

    S.i += 1;

    if (ok && isNew) {
      // 新卡第一次就答对：当天再出现一次，作为 5 分钟节点的短间隔巩固
      requeue(cur, outcome, 'fresh');
    } else if (!ok) {
      // 没答对：进入当日重学循环，直到答对为止
      requeue(cur, outcome, 'retry');
    }

    updateSessionProgress();
    flashVerdict(outcome, next, cur);
  }

  /** 把卡片插回当日队列：隔 3 张后重现，队列不够就放到队尾 */
  function requeue(item, outcome, reason) {
    var hard = outcome === 'hard';
    var q = {
      m: item.m,
      id: item.id,
      relearn: true,
      reason: reason || 'retry',
      tries: item.tries || 0,
      maxTries: item.maxTries || (hard ? 1 : 5)
    };
    if (q.reason === 'retry') S.relearnSet[item.m + ':' + item.id] = true;
    var at = Math.min(S.queue.length, S.i + 3);
    S.queue.splice(at, 0, q);
  }

  /** 重学卡：答对才放行；答错继续循环 */
  function handleRelearn(cur, outcome) {
    var today = SRS.todayStr();
    var rec = Store.getRec(cur.m, cur.id) || SRS.newRecord();

    if (outcome === 'easy') {
      // 当天已巩固过一次：阶段不升级，复习日固定在明天
      rec.last = today;
      rec.c = (rec.c || 0) + 1;
      if (!rec.due || SRS.parseDate(rec.due) <= SRS.parseDate(today)) {
        rec.due = SRS.addDays(today, 1);
      }
      Store.setRec(cur.m, cur.id, rec);
      Store.logAnswer(cur.m, true);
      S.correct += 1;
      S.relearnPassed += 1;
      S.i += 1;
      flashVerdict('easy', rec, cur);
      return;
    }

    Store.logAnswer(cur.m, false);
    S.relearnSet[cur.m + ':' + cur.id] = true;   // 这张确实重学了
    cur.tries = (cur.tries || 0) + 1;
    // 当天重学时又答错 / 又模糊，也累计进去：这两类卡就是要单独打印出来练的
    if (outcome === 'hard') rec.h = (rec.h || 0) + 1;
    else rec.w = (rec.w || 0) + 1;
    rec.last = today;
    Store.setRec(cur.m, cur.id, rec);
    S.i += 1;

    if (cur.tries <= (cur.maxTries || 5)) {
      // 还没记住：继续插回队列
      S.queue.splice(Math.min(S.queue.length, S.i + 3), 0, cur);
      flashVerdict(outcome, null, cur);
    } else {
      // 安全阀：同一张反复错很多次，先放过，明天再来（避免卡死）
      cur.skipped = true;
      flashVerdict('giveup', null, cur);
    }
  }

  function flashVerdict(outcome, rec, item) {
    var relearn = !!(item && item.relearn);
    var msg, cls;

    primeNextAudio();   // 顺手把下一张读出来（必须在点击栈里，见函数注释）

    if (outcome === 'easy') {
      cls = 'ok';
      if (relearn) msg = item.reason === 'fresh' ? '✅ 再确认一次，记住了' : '✅ 这次记住了！明天再复习';
      else msg = '👍 记住啦！下次复习：' + SRS.intervalOf(rec.s) + ' 天后';
    } else if (outcome === 'hard') {
      cls = 'mid';
      msg = relearn ? '🤔 还是有点模糊，再来一次' : '🤔 有点模糊，等会儿再出现';
    } else if (outcome === 'giveup') {
      cls = 'mid';
      msg = '⏭ 这张先放过，明天再来';
    } else {
      cls = 'no';
      msg = relearn ? '🔁 还没记住，稍后再来一次' : '📌 没记住，等会儿还会出现';
    }

    var t = document.createElement('div');
    t.className = 'verdict ' + cls;
    t.style.cssText = 'position:fixed;left:50%;bottom:calc(104px + var(--safe-b));transform:translateX(-50%);z-index:100;box-shadow:0 10px 24px rgba(20,30,70,.12);background:#fff;';
    t.textContent = msg;
    document.body.appendChild(t);
    pendingTimer = setTimeout(function () {
      t.remove();
      pendingTimer = null;
      if (S && !S.finished) nextCard();
    }, 780);
  }

  /* ---------- 结算 ---------- */
  function finishSession() {
    S.finished = true;
    S.done = S.total;
    // 使用频次统计：每组练习记一条，只含张数与答对率，不含具体卡片
    if (Cloud && Cloud.recordEvent) {
      try {
        Cloud.recordEvent('practice', {
          cards: S.total,
          correct: S.firstCorrect,
          mins: Math.max(1, Math.round((Date.now() - S.startAt) / 60000))
        });
      } catch (e) { /* 统计失败不影响学习 */ }
    }
    var acc = pct(S.firstCorrect, S.total);
    var mins = Math.max(1, Math.round((Date.now() - S.startAt) / 60000));
    var relearned = Object.keys(S.relearnSet).length;
    var skipped = S.queue.filter(function (x) { return x.skipped; }).length;
    body('<div class="quiz-card" style="text-align:center">' +
      '<div style="font-size:52px">🎉</div>' +
      '<h2 style="font-size:22px;font-weight:800;margin:10px 0 4px">这一组完成啦！</h2>' +
      '<p style="font-size:13.5px;color:var(--ink-3)">用时约 ' + mins + ' 分钟' +
      (relearned ? ' · 其中 ' + relearned + ' 张重新学了一遍' : '') + '</p>' +
      '<div class="hero-stats" style="margin-top:18px">' +
      '<div class="hero-stat" style="background:#f5f8ff;border-color:#e7ecf7"><b style="color:#1b2340">' + S.total + '</b><span style="color:#8b93aa">练习张数</span></div>' +
      '<div class="hero-stat" style="background:#f5f8ff;border-color:#e7ecf7"><b style="color:#22c39a">' + acc + '%</b><span style="color:#8b93aa">一次答对</span></div>' +
      '<div class="hero-stat" style="background:#f5f8ff;border-color:#e7ecf7"><b style="color:#4f6bff">' + Store.streak() + '</b><span style="color:#8b93aa">连续天数</span></div>' +
      '</div>' +
      (relearned
        ? '<div class="verdict ok" style="margin-top:14px">今天有 ' + relearned + ' 张一开始没记住，' +
          (skipped ? (relearned - skipped) : relearned) + ' 张已经当场记住，明天会再复习一次' +
          (skipped ? '；另有 ' + skipped + ' 张暂时放过' : '') + '</div>'
        : '') +
      '<div style="font-size:13px;color:var(--ink-3);margin-top:16px;line-height:1.7">明天记得回来复习，记忆才会真正留下来。</div>' +
      '</div>');
    foot('<div class="btn-stack">' +
      '<button class="btn btn-primary btn-lg btn-block" id="btnMore">再来一组</button>' +
      '<button class="btn btn-ghost btn-block" id="btnHome">回到首页</button></div>');
    confetti();
    $('#btnMore').onclick = function () {
      var mods = S.modules;
      closeSession();
      setTimeout(function () { startSession(mods); }, 120);
    };
    $('#btnHome').onclick = function () { closeSession(); location.hash = '#/home'; };
  }

  function confetti() {
    var colors = ['#5b7cff', '#7b5cf6', '#22c39a', '#ffab2e', '#ff6b81'];
    var box = document.createElement('div');
    box.className = 'confetti';
    for (var i = 0; i < 40; i++) {
      var s = document.createElement('i');
      s.style.left = Math.random() * 100 + '%';
      s.style.background = colors[i % colors.length];
      s.style.animationDelay = (Math.random() * 0.7) + 's';
      s.style.animationDuration = (1.6 + Math.random() * 1.2) + 's';
      box.appendChild(s);
    }
    document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, 3200);
  }

  /** 老版本档案没有年级范围，首次打开按年级补齐 */
  function migrateScopes() {
    Store.listProfiles().forEach(function (p) {
      if (p.settings.gradeSet) return;
      if (!(p.settings.unitsZh || []).length && !(p.settings.unitsEn || []).length) {
        applyGradeScope(p);
      }
      Store.updateSettings(p.id, { gradeSet: true });
    });
  }

  /* ================= 多标签页同步 ================= */
  window.addEventListener('storage', function (e) {
    if (!e || e.key !== 'ebbinghaus.kids.v1') return;
    if (S && !S.finished) return;     // 正在练习时不打断，避免覆盖当前作答
    try {
      Store.reload();
      render();
    } catch (err) { /* 忽略 */ }
  });

  /** 把 strings.js 里的文案套到静态外壳上（title、品牌名、底栏 4 个词） */
  function applyUiStrings() {
    if (STR.siteTitle) document.title = String(STR.siteTitle);
    var brand = document.querySelector('.brand-text');
    if (brand && STR.brandName) brand.textContent = String(STR.brandName);
    var map = { home: 'tabHome', study: 'tabStudy', progress: 'tabProgress', me: 'tabMe' };
    $$('.tab').forEach(function (a) {
      var key = map[a.getAttribute('data-tab')];
      if (!key || !STR[key]) return;
      var spans = a.querySelectorAll('span');
      if (spans.length >= 2) spans[spans.length - 1].textContent = String(STR[key]);
    });
  }

  /* ================= 启动 ================= */
  applyUiStrings();
  Store.load();
  migrateScopes();

  // 云端同步：只在登录后才推送；练习过程中不打断界面
  if (Cloud) {
    Store.onChange(function () { Cloud.schedulePush(); });
    Cloud.onChange(function (st) {
      if (S && !S.finished) return;
      var name = currentRoute().name;
      if (name === 'me' || name === 'home') render();
    });
  } else {
    Store.onChange(function () {});
  }

  render();

  // 恢复上次的登录态（异步，不阻塞首屏）
  if (Cloud && Cloud.originUsable()) {
    Cloud.restore().then(function (ok) { if (ok) render(); }, function () {});
  }

  window.App = {
    toast: toast,
    render: render,
    startSession: startSession,
    onStorageDegrade: onStorageDegrade,
    openStorageHelp: openStorageHelp,
    openAbout: openAbout,
    openMigrateHelp: openMigrateHelp,
    browserName: browserName,
    openAuthSheet: openAuthSheet,
    openPrivacy: openPrivacy,
    cloudCardHtml: cloudCardHtml,
    maskEmail: maskEmail,
    applyUiStrings: applyUiStrings,
    getSession: function () { return S; }
  };

  // PWA（仅 http/https 下注册，本地 file:// 打开不影响使用）
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0 && !window.__SINGLE_FILE__) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
