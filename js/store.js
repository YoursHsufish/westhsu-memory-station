/*!
 * store.js —— 本地多用户存储（localStorage，纯前端、无后台）
 *
 * 存档保护策略（防丢档）：
 *   1. 主存档 ebbinghaus.kids.v1        —— 永远使用同一个 key，绝不随版本改名
 *   2. 上一版快照 ebbinghaus.kids.bak    —— save 时把旧值留一份（60 秒节流）
 *   3. 损坏隔离 ...v1.corrupt.<时间戳>   —— JSON 解析失败时把原文另存，不直接丢弃
 *   4. 版本号 v + 迁移链 migrate()       —— 老存档自动升级；遇到比程序新的存档只读不写
 *   5. 元信息 ebbinghaus.kids.meta       —— 上次保存/快照/导出时间
 *
 * 数据结构：
 * {
 *   v: 2,
 *   active: <profileId>,
 *   profiles: [{
 *     id, name, avatar, created, lastActive,
 *     settings: { newEn, newZh, ttsRate, ttsAuto, unitsEn: [], unitsZh: [], showPinyin: true, dailyGoal },
 *     data: { en_recog: {id: rec}, en_spell: {...}, zh_recog: {...}, zh_dict: {...} },
 *     log: { 'YYYY-MM-DD': { en_recog: {t: n, c: n}, ... , total: n, correct: n } }
 *   }]
 * }
 */
(function (global) {
  'use strict';

  var KEY = 'ebbinghaus.kids.v1';           // 主存档（key 名永不改变）
  var BAK = 'ebbinghaus.kids.bak';          // 上一版快照
  var METAKEY = 'ebbinghaus.kids.meta';     // 元信息
  var CORRUPT = KEY + '.corrupt.';          // 损坏存档隔离前缀
  var SCHEMA = 2;                           // 当前数据结构版本

  var state = null;
  var loadInfo = { source: 'new', fromVersion: null };
  var lastBackupAt = 0;
  var MODULES = ['en_recog', 'en_spell', 'zh_recog', 'zh_dict', 'py_recog', 'py_spell'];
  var AVATARS = ['🐣', '🐻', '🐼', '🦊', '🐨', '🐯', '🐰', '🦄', '🐬', '🐢', '🦁', '🐧'];

  var listeners = [];

  /* ---------- 存储后端：localStorage → sessionStorage → 内存 ---------- */
  var memData = {};
  var memStore = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(memData, k) ? memData[k] : null; },
    setItem: function (k, v) { memData[k] = String(v); },
    removeItem: function (k) { delete memData[k]; }
  };

  function probe(name, getter) {
    try {
      var s = getter();
      if (!s) return null;
      var k = '__ebbinghaus_probe__';
      s.setItem(k, '1');
      s.removeItem(k);
      return { mode: name, store: s };
    } catch (e) {
      return null;
    }
  }

  var backend = (function () {
    var cands = [
      function () { return probe('localStorage', function () { return global.localStorage; }); },
      function () { return probe('sessionStorage', function () { return global.sessionStorage; }); }
    ];
    for (var i = 0; i < cands.length; i++) {
      var b = cands[i]();
      if (b) return b;
    }
    return { mode: 'memory', store: memStore };
  })();

  function storageMode() { return backend.mode; }
  function persistent() { return backend.mode === 'localStorage'; }

  function uid() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function defaultSettings() {
    return {
      newEn: 8,        // 每天新学英语单词数（每项英语练习）
      newZh: 8,        // 每天新学汉字数（每项中文练习）
      newPy: 6,        // 每天新学拼音数（每项拼音练习）
      grade: 1,        // 当前年级 1-6
      textbook: '人教版 PEP', // 教材版本
      startEn: 3,      // 英语起点：1=一年级起点，3=三年级起点
      ttsRate: 1,      // 语速 0.5 ~ 1.4
      ttsAuto: true,   // 自动朗读
      showPinyin: true,
      dailyGoal: 30,
      unitsEn: [],     // 空数组 = 全部启用
      unitsZh: [],
      unitsPy: []
    };
  }

  function defaultProfile(name, avatar) {
    return {
      id: uid(),
      name: name || '小朋友',
      avatar: avatar || AVATARS[0],
      created: Date.now(),
      lastActive: Date.now(),
      settings: defaultSettings(),
      data: {},
      log: {}
    };
  }

  function normalize(p) {
    p.settings = Object.assign(defaultSettings(), p.settings || {});
    p.data = p.data || {};
    MODULES.forEach(function (m) { if (!p.data[m]) p.data[m] = {}; });
    p.log = p.log || {};
    if (!p.avatar) p.avatar = AVATARS[0];
    return p;
  }

  /* ---------- 数据结构迁移 ---------- */
  var MIGRATIONS = {
    // v1 → v2：新增年级/教材/拼音配置字段（缺的交给 defaultSettings 补）
    1: function (st) {
      (st.profiles || []).forEach(function (p) {
        if (p.settings && p.settings.grade == null) p.settings.grade = 1;
      });
      return st;
    }
  };

  function migrate(st) {
    var from = Number(st.v) || 1;
    loadInfo.fromVersion = from;
    if (from > SCHEMA) {
      // 存档来自更新的版本（例如用户回退了程序）：只读，绝不覆盖
      st.__readonly = true;
      st.__newer = from;
      return st;
    }
    while (from < SCHEMA) {
      var fn = MIGRATIONS[from];
      if (fn) {
        try { st = fn(st) || st; } catch (e) { console.warn('[store] 迁移 v' + from + ' 失败', e); }
      }
      from += 1;
      st.v = from;
    }
    st.v = SCHEMA;
    delete st.__readonly;
    return st;
  }

  /* ---------- 元信息（保存/快照/导出时间） ---------- */
  function readMeta() {
    try {
      var raw = backend.store.getItem(METAKEY);
      return raw ? (JSON.parse(raw) || {}) : {};
    } catch (e) { return {}; }
  }

  function writeMeta(patch) {
    try {
      var m = readMeta();
      for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) m[k] = patch[k];
      backend.store.setItem(METAKEY, JSON.stringify(m));
    } catch (e) { /* 元信息写失败不影响主流程 */ }
  }

  /** 只从存储里加载一次；之后一律使用内存中的 state（避免写失败时把内存数据覆盖掉） */
  function readRaw(key) {
    try { return backend.store.getItem(key); } catch (e) { return null; }
  }

  function parseState(raw) {
    if (!raw) return null;
    try {
      var obj = JSON.parse(raw);
      if (obj && obj.profiles) return obj;
    } catch (e) { /* 落到下面统一处理 */ }
    return null;
  }

  function load() {
    if (state) return state;

    var raw = readRaw(KEY);
    var obj = parseState(raw);
    var source = obj ? 'main' : 'new';

    // 主存档坏了 → 把原文隔离保存，再尝试上一版快照
    if (raw && !obj) {
      try { backend.store.setItem(CORRUPT + Date.now(), raw); } catch (e) {}
      console.warn('[store] 主存档无法解析，已隔离并尝试从快照恢复');
    }

    if (!obj) {
      var bakRaw = readRaw(BAK);
      var bakObj = parseState(bakRaw);
      if (bakObj) { obj = bakObj; source = 'backup'; }
    }

    if (!obj) {
      state = { v: SCHEMA, active: null, profiles: [] };
      loadInfo = { source: source, fromVersion: null };
      return state;
    }

    obj.profiles.forEach(normalize);
    var before = Number(obj.v) || 1;
    obj = migrate(obj);
    state = obj;
    loadInfo = { source: source, fromVersion: before };

    // 从快照恢复、或发生了版本迁移 → 立刻回写主存档，保证下次读到的是一致的
    if (source !== 'main' || before !== SCHEMA) {
      save(true);
    }
    return state;
  }

  function save(force) {
    if (!state) return;
    if (state.__readonly) {
      console.warn('[store] 存档来自更新版本 v' + state.__newer + '，已进入只读保护，不会覆盖');
      return false;
    }
    var json;
    try {
      json = JSON.stringify(state);
    } catch (e) {
      console.error('[store] 序列化失败', e);
      return false;
    }
    try {
      // 写新数据之前，把「上一份」留成快照（60 秒节流，避免每答一题都写两遍）
      var prev = backend.store.getItem(KEY);
      var now = Date.now();
      if (prev && prev !== json && (force || now - lastBackupAt > 60000)) {
        try {
          backend.store.setItem(BAK, prev);
          lastBackupAt = now;
          writeMeta({ lastBackup: now });
        } catch (e2) { /* 空间不足时放弃快照，不影响主存档 */ }
      }
      backend.store.setItem(KEY, json);
      writeMeta({ lastSave: now });
    } catch (e) {
      console.warn('[store] 写入失败，降级为内存存储', e);
      // 降级：数据仍保留在内存里，本次打开可继续用，只是关掉就没了
      try { backend.store = memStore; backend.mode = 'memory'; memStore.setItem(KEY, json); } catch (e2) {}
      if (global.App && App.onStorageDegrade) App.onStorageDegrade();
    }
    listeners.forEach(function (fn) { try { fn(state); } catch (e) {} });
  }

  function onChange(fn) { listeners.push(fn); }

  function getState() { return state || load(); }

  function listProfiles() { return getState().profiles; }

  function activeProfile() {
    var s = getState();
    return s.profiles.filter(function (p) { return p.id === s.active; })[0] || null;
  }

  function getProfile(id) {
    return getState().profiles.filter(function (p) { return p.id === id; })[0] || null;
  }

  function createProfile(name, avatar) {
    var s = getState();
    var p = defaultProfile(String(name || '').trim() || '小朋友', avatar);
    s.profiles.push(p);
    if (!s.active) s.active = p.id;
    save();
    return p;
  }

  function updateProfile(id, patch) {
    var p = getProfile(id);
    if (!p) return null;
    Object.assign(p, patch);
    save();
    return p;
  }

  function updateSettings(id, patch) {
    var p = getProfile(id);
    if (!p) return null;
    if (!p.settings) p.settings = {};
    Object.assign(p.settings, patch);
    // __ts：设置最后一次被改动的时间戳（毫秒）。云端同步时按「谁改得晚用谁」，
    // 否则另一台设备的旧设置会把新设置盖掉。放在 settings 对象里，不需要改表结构。
    p.settings.__ts = Date.now();
    save();
    return p.settings;
  }

  function removeProfile(id) {
    var s = getState();
    s.profiles = s.profiles.filter(function (p) { return p.id !== id; });
    if (s.active === id) s.active = s.profiles[0] ? s.profiles[0].id : null;
    save();
  }

  function setActive(id) {
    var s = getState();
    if (!getProfile(id)) return;
    s.active = id;
    var p = getProfile(id);
    p.lastActive = Date.now();
    save();
  }

  /* ---------- 卡片记录 ---------- */
  function getRec(module, id) {
    var p = activeProfile();
    if (!p) return null;
    return p.data[module] ? p.data[module][id] : null;
  }

  function allRecs(module) {
    var p = activeProfile();
    return (p && p.data[module]) || {};
  }

  function setRec(module, id, rec) {
    var p = activeProfile();
    if (!p) return;
    if (!p.data[module]) p.data[module] = {};
    p.data[module][id] = rec;
    save();
  }

  /* ---------- 重点学清单 ----------
   * 判定：答错 2 次以上，或「有点模糊」2 次以上（见 srs.js needFocus）
   * 这批卡靠 App 里过一遍不够，要抄到纸上练，所以单独列出来给打印用。
   */
  function focusCards(profile) {
    var p = profile || activeProfile();
    if (!p) return [];
    var out = [];
    MODULES.forEach(function (m) {
      var recs = (p.data && p.data[m]) || {};
      Object.keys(recs).forEach(function (id) {
        var r = recs[id];
        if (!r || !SRS.needFocus(r)) return;
        out.push({
          m: m,
          id: id,
          rec: r,
          w: Number(r.w) || 0,
          h: Number(r.h) || 0,
          s: Number(r.s) || 0,
          score: SRS.focusScore(r),
          last: r.last || r.first || ''
        });
      });
    });
    out.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.last < b.last ? 1 : -1;
    });
    return out;
  }

  function focusCount(profile) { return focusCards(profile).length; }

  /* ---------- 学习日志 ---------- */  function logAnswer(module, correct) {
    var p = activeProfile();
    if (!p) return;
    var d = SRS.todayStr();
    if (!p.log[d]) p.log[d] = {};
    var day = p.log[d];
    if (!day[module]) day[module] = { t: 0, c: 0 };
    day[module].t += 1;
    if (correct) day[module].c += 1;
    day.total = (day.total || 0) + 1;
    day.correct = (day.correct || 0) + (correct ? 1 : 0);
    save();
  }

  function dayLog(dateStr) {
    var p = activeProfile();
    if (!p) return null;
    return p.log[dateStr || SRS.todayStr()] || null;
  }

  function dayTotal(dateStr) {
    var d = dayLog(dateStr);
    return d ? (d.total || 0) : 0;
  }

  /** 连续打卡天数（今天未学则从昨天往前算） */
  function streak() {
    var p = activeProfile();
    if (!p) return 0;
    var n = 0;
    var cursor = SRS.todayStr();
    if (dayTotal(cursor) === 0) cursor = SRS.addDays(cursor, -1);
    while (dayTotal(cursor) > 0) {
      n += 1;
      cursor = SRS.addDays(cursor, -1);
      if (n > 3650) break;
    }
    return n;
  }

  /** 某模块的整体统计 */
  function moduleStats(module) {
    var recs = allRecs(module);
    var out = { total: 0, learned: 0, mastered: 0, learning: 0, due: 0, weak: 0, correct: 0, wrong: 0 };
    var today = SRS.todayStr();
    Object.keys(recs).forEach(function (k) {
      var r = recs[k];
      if (!r) return;
      out.total += 1;
      out.correct += r.c || 0;
      out.wrong += r.w || 0;
      if (r.s >= 1) out.learned += 1;
      if (r.s >= 7) out.mastered += 1;
      if (r.s >= 1 && r.s < 7) out.learning += 1;
      if (r.s >= 1 && SRS.parseDate(r.due) <= SRS.parseDate(today)) out.due += 1;
      if (r.w > 0 && r.s < 5) out.weak += 1;
    });
    return out;
  }

  /* ---------- 存档状态 / 恢复 ---------- */
  function countCards(st) {
    var n = 0;
    ((st && st.profiles) || []).forEach(function (p) {
      MODULES.forEach(function (m) { n += Object.keys((p.data && p.data[m]) || {}).length; });
    });
    return n;
  }

  /** 数据指纹：对「档案名+模块+卡片+阶段+复习日」排序后取 FNV-1a 32 位。
   *  迁移/导入前后对比这个值即可确认数据是否完全一致（空卡片档案不参与） */
  function fingerprint(st) {
    st = st || state;
    var parts = [];
    ((st && st.profiles) || []).forEach(function (p) {
      MODULES.forEach(function (m) {
        var recs = (p.data && p.data[m]) || {};
        Object.keys(recs).forEach(function (id) {
          var r = recs[id] || {};
          parts.push(p.name + '|' + m + '|' + id + '|' + (r.s || 0) + '|' + (r.due || ''));
        });
      });
    });
    parts.sort();
    var str = parts.join(';');
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16).toUpperCase()).slice(-8);
  }

  function storageInfo() {
    var cards = countCards(state);
    var meta = readMeta();
    return {
      mode: storageMode(),
      schema: SCHEMA,
      storedVersion: state ? state.v : null,
      source: loadInfo.source,          // main / backup / new
      fromVersion: loadInfo.fromVersion,
      readonly: !!(state && state.__readonly),
      newer: state ? state.__newer : null,
      profiles: state ? state.profiles.length : 0,
      cards: cards,
      fingerprint: fingerprint(state),
      lastSave: meta.lastSave || null,
      lastBackup: meta.lastBackup || null,
      lastExport: meta.lastExport || null,
      backupAvailable: !!readRaw(BAK)
    };
  }

  /** 从上一版快照恢复（恢复前会把当前存档再留一份，避免误操作彻底丢数据） */
  function restoreFromBackup() {
    var obj = parseState(readRaw(BAK));
    if (!obj) throw new Error('没有可用的上一版快照');
    obj.profiles.forEach(normalize);
    var cur = readRaw(KEY);
    if (cur) {
      try { backend.store.setItem(CORRUPT + 'before-restore.' + Date.now(), cur); } catch (e) {}
    }
    state = migrate(obj);
    save(true);
    return true;
  }

  /** 丢弃内存状态，重新从存储读取（用于多标签页同步） */
  function reload() {
    state = null;
    loadInfo = { source: 'new', fromVersion: null };
    return load();
  }

  /* ---------- 备份 ---------- */
  function exportAll() {
    writeMeta({ lastExport: Date.now() });
    return JSON.stringify({
      app: 'ebbinghaus-kids',
      schema: SCHEMA,
      exportedAt: new Date().toISOString(),
      data: getState()
    }, null, 2);
  }

  function importAll(text) {
    var obj = JSON.parse(text);
    var incoming = obj && obj.data ? obj.data : obj;
    if (!incoming || !incoming.profiles) throw new Error('文件格式不正确');
    save(true);   // 导入前把当前存档留一份快照
    var s = getState();
    var beforeCards = countCards(s);
    var merged = 0;
    incoming.profiles.forEach(function (np) {
      normalize(np);
      var exist = s.profiles.filter(function (p) { return p.name === np.name; })[0];
      if (exist) {
        merged += 1;
        MODULES.forEach(function (m) {
          Object.assign(exist.data[m] || (exist.data[m] = {}), np.data[m] || {});
        });
        Object.keys(np.log || {}).forEach(function (d) {
          if (!exist.log[d]) exist.log[d] = np.log[d];
        });
      } else {
        np.id = uid();
        s.profiles.push(np);
      }
    });
    save();
    return {
      profiles: incoming.profiles.length,
      merged: merged,
      cards: countCards(s) - beforeCards,
      totalProfiles: s.profiles.length
    };
  }

  global.Store = {
    MODULES: MODULES,
    AVATARS: AVATARS,
    load: load,
    save: save,
    onChange: onChange,
    getState: getState,
    listProfiles: listProfiles,
    activeProfile: activeProfile,
    getProfile: getProfile,
    createProfile: createProfile,
    updateProfile: updateProfile,
    updateSettings: updateSettings,
    removeProfile: removeProfile,
    setActive: setActive,
    getRec: getRec,
    allRecs: allRecs,
    setRec: setRec,
    focusCards: focusCards,
    focusCount: focusCount,
    logAnswer: logAnswer,
    dayLog: dayLog,
    dayTotal: dayTotal,
    streak: streak,
    moduleStats: moduleStats,
    exportAll: exportAll,
    importAll: importAll,
    storageInfo: storageInfo,
    fingerprint: fingerprint,
    restoreFromBackup: restoreFromBackup,
    reload: reload,
    storageMode: storageMode,
    persistent: persistent,
    defaultSettings: defaultSettings
  };
})(window);
