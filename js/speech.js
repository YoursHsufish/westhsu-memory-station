/*!
 * speech.js —— 语音朗读 v2
 *
 * 两条通道，能用哪条走哪条，优先「真声音频」：
 *   ① 音节 mp3（assets/audio/py/*.mp3）
 *      来源 davinfifield/mp3-chinese-pinyin-sound（Unlicense 公有领域），
 *      已在构建期转成 16 kHz 单声道 32 kbps 并裁掉首尾静音。
 *      汉字 → 拼音 → 音节文件；词语 → 逐字拆音节连读。
 *      不依赖系统语音包，微信 / 360 / 国产 ROM 的 WebView 也能出声。
 *   ② 浏览器内置 TTS（Web Speech API）
 *      英语单词默认走这里；中文在没有音频文件时兜底。
 *
 * 手机上不发音的三个坑，这一版都补上了：
 *   · iOS / Safari 要求 speak() 或 audio.play() 发生在用户点击的同步执行栈里
 *     → 新增 unlock()，第一次任意点击时预热一次；自动朗读不再用 setTimeout；
 *   · getVoices() 首次返回空数组，要等 voiceschanged
 *     → 没语音时最多等 900 ms，等到再读；
 *   · 部分浏览器根本没有 speechSynthesis
 *     → supported() 返回 false，界面据此把喇叭变成灰色并给提示。
 */
(function (global) {
  'use strict';

  /* ==================================================================
   * 一、拼音 → 音节 key
   *    'zhōng' → 'zhong1' ; 轻声 'de' → 'de5' ; ü 记作 uu (lǜ → luu4)
   * ================================================================== */
  var ACCENT = {
    'ā': 'a1', 'á': 'a2', 'ǎ': 'a3', 'à': 'a4',
    'ē': 'e1', 'é': 'e2', 'ě': 'e3', 'è': 'e4',
    'ī': 'i1', 'í': 'i2', 'ǐ': 'i3', 'ì': 'i4',
    'ō': 'o1', 'ó': 'o2', 'ǒ': 'o3', 'ò': 'o4',
    'ū': 'u1', 'ú': 'u2', 'ǔ': 'u3', 'ù': 'u4',
    'ǖ': 'uu1', 'ǘ': 'uu2', 'ǚ': 'uu3', 'ǜ': 'uu4',
    'ü': 'uu5', 'ń': 'n2', 'ň': 'n3', 'ǹ': 'n4', 'ḿ': 'm2', 'ê': 'e1'
  };

  /** 带声调拼音 → 音节 key（无声调字母 + 声调数字） */
  function syllableKey(py) {
    py = String(py == null ? '' : py).toLowerCase();
    if (!py) return null;
    var out = '', tone = 5;
    for (var i = 0; i < py.length; i++) {
      var ch = py.charAt(i);
      var hit = ACCENT[ch];
      if (hit) {
        out += hit.slice(0, -1);
        if (hit.slice(-1) !== '5') tone = Number(hit.slice(-1));
      } else if (ch >= 'a' && ch <= 'z') {
        out += ch;
      }
    }
    if (!out) return null;
    return out + tone;
  }

  /** 拼音字母本体（去掉声调），用于"没有音频时"的降级判断 */
  function baseOf(key) { return String(key || '').replace(/[1-5]$/, ''); }

  /* ==================================================================
   * 二、可用音节清单（js/audio-manifest.js）
   * ================================================================== */
  var AVAIL = null;
  function availSet() {
    if (AVAIL) return AVAIL;
    var list = global.PY_AUDIO;
    if (!list || !list.length) return null;      // 清单缺失 → 乐观尝试，404 时静默跳过
    AVAIL = {};
    for (var i = 0; i < list.length; i++) AVAIL[list[i]] = 1;
    return AVAIL;
  }

  /** 该音节有没有本地音频 */
  function hasSyl(key) {
    if (!key || !canAudio()) return false;
    var set = availSet();
    return set ? Object.prototype.hasOwnProperty.call(set, key) : true;
  }

  var AUDIO_BASE = 'assets/audio/py/';

  /* ==================================================================
   * 三、字 → 拼音（词语拆音节用）
   * ================================================================== */
  var CHAR_PY = null;
  function charPy() {
    if (CHAR_PY) return CHAR_PY;
    CHAR_PY = {};
    var zh = global.ZH_UNITS || [];
    for (var i = 0; i < zh.length; i++) {
      var ws = (zh[i] && zh[i].words) || [];
      for (var j = 0; j < ws.length; j++) {
        var a = ws[j];
        if (a && a[0] && !Object.prototype.hasOwnProperty.call(CHAR_PY, a[0])) CHAR_PY[a[0]] = a[1];
      }
    }
    var extra = global.PY_DICT || {};
    for (var k in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, k) && !Object.prototype.hasOwnProperty.call(CHAR_PY, k)) {
        CHAR_PY[k] = extra[k];
      }
    }
    return CHAR_PY;
  }

  /**
   * 词语 → 音节 key 数组；拆不出来（生僻字 / 缺音频 / 含非汉字）时返回 null
   * @param {string} word
   * @returns {string[]|null}
   */
  function wordKeys(word) {
    word = String(word == null ? '' : word).trim();
    if (!word) return null;
    var fixed = (global.PY_WORDS || {})[word];
    if (fixed) {
      var arr = String(fixed).split(/\s+/);
      for (var x = 0; x < arr.length; x++) if (!hasSyl(arr[x])) return null;
      return arr;
    }
    var cp = charPy(), out = [];
    for (var i = 0; i < word.length; i++) {
      var ch = word.charAt(i);
      if (ch < '\u4e00' || ch > '\u9fff') return null;
      var py = cp[ch];
      if (!py) return null;
      var key = syllableKey(py);
      if (!key || !hasSyl(key)) return null;
      out.push(key);
    }
    return out.length ? out : null;
  }

  /** 单字 → 音节 key（无音频时返回 null） */
  function charKey(ch, py) {
    var p = py;
    if (!p && ch) p = charPy()[ch];
    var key = p ? syllableKey(p) : null;
    return key && hasSyl(key) ? key : null;
  }

  /* ==================================================================
   * 四、播放引擎：一条音频元素 + 顺序队列
   * ================================================================== */
  var SEQ_START = 0;          // 每次播放自增，用来打断上一条
  var timer = null;
  var audioEl = null;
  var unlocked = false;
  var SILENT = 'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';

  function canAudio() {
    // 单文件分发版没有 assets/audio 目录，只走 TTS
    return !global.__AUDIO_OFF__ && !global.__SINGLE_FILE__ && typeof global.Audio === 'function';
  }

  function getAudio() {
    if (audioEl) return audioEl;
    if (!canAudio()) return null;
    try {
      audioEl = new global.Audio();
      audioEl.preload = 'auto';
      if (audioEl.setAttribute) audioEl.setAttribute('playsinline', '');
      audioEl.playsInline = true;
    } catch (e) { audioEl = null; }
    return audioEl;
  }

  /* ---------------- TTS ---------------- */
  var synth = global.speechSynthesis || null;
  var voices = [];
  var voiceCache = {};
  var currentUtter = null;

  function refresh() {
    if (!synth) return;
    try { voices = synth.getVoices() || []; } catch (e) { voices = []; }
    voiceCache = {};
  }

  if (synth) {
    refresh();
    try { synth.onvoiceschanged = refresh; } catch (e) {}
    // 少数浏览器支持 addEventListener 而不触发 onvoiceschanged
    try { if (synth.addEventListener) synth.addEventListener('voiceschanged', refresh); } catch (e) {}
  }

  function supported() { return !!synth; }
  /** 有没有任何可用的发声方式 */
  function audioReady() { return canAudio() || !!synth; }

  /** 挑一个最合适的声音 */
  function pickVoice(lang) {
    if (voiceCache[lang]) return voiceCache[lang];
    if (!voices.length) refresh();
    var target = String(lang || 'en-US').toLowerCase();
    var prefix = target.split('-')[0];
    var list = voices.filter(function (v) {
      return String(v.lang || '').toLowerCase().replace('_', '-').indexOf(prefix) === 0;
    });
    if (!list.length) return null;
    var score = function (v) {
      var s = 0;
      var n = (v.name || '').toLowerCase();
      if (v.localService) s += 4;
      if (n.indexOf('natural') >= 0 || n.indexOf('neural') >= 0) s += 3;
      if (n.indexOf('xiaoxiao') >= 0 || n.indexOf('tingting') >= 0 || n.indexOf('huihui') >= 0) s += 3;
      if (n.indexOf('samantha') >= 0 || n.indexOf('zira') >= 0 || n.indexOf('google') >= 0) s += 2;
      if (String(v.lang || '').toLowerCase().replace('_', '-') === target) s += 2;
      return s;
    };
    list.sort(function (a, b) { return score(b) - score(a); });
    voiceCache[lang] = list[0];
    return list[0];
  }

  function stopAll() {
    SEQ_START += 1;
    if (timer) { clearTimeout(timer); timer = null; }
    try { if (audioEl) { audioEl.onended = null; audioEl.onerror = null; audioEl.pause(); } } catch (e) {}
    try { if (synth) synth.cancel(); } catch (e) {}
    currentUtter = null;
  }

  /**
   * 预热：第一次任意点击时调用（必须在点击的同步栈里）
   * iOS 只允许"被用户手势解锁过"的播放，这里用静音把两条通道各捅一次。
   */
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    var a = getAudio();
    if (a) {
      try {
        a.src = SILENT;
        var p = a.play();
        if (p && p.then) p.then(function () { try { a.pause(); } catch (e) {} }, function () {});
      } catch (e) { /* 忽略：没有音频通道时全靠 TTS */ }
    }
    if (synth) {
      try {
        var u = new global.SpeechSynthesisUtterance(' ');
        u.volume = 0;
        u.lang = 'zh-CN';
        synth.speak(u);
      } catch (e) { /* 忽略 */ }
    }
    refresh();
  }

  /**
   * 读一段文本（TTS），读完回调
   * @param {string} text
   * @param {object} opts { lang, rate, pitch }
   * @param {function} cb
   * @param {number} token
   */
  function ttsSay(text, opts, cb, token) {
    opts = opts || {};
    if (!synth || !text) { if (cb) setTimeout(cb, 30); return; }
    var alive = function () { return token == null || token === SEQ_START; };
    var fire = function () {
      if (!alive()) { if (cb) cb(); return; }
      var u;
      try { u = new global.SpeechSynthesisUtterance(String(text)); }
      catch (e) { if (cb) cb(); return; }
      var lang = opts.lang || 'en-US';
      u.lang = lang;
      u.rate = Math.max(0.3, Math.min(2, Number(opts.rate) || 1));
      u.pitch = opts.pitch == null ? 1 : opts.pitch;
      var v = pickVoice(lang);
      if (v) u.voice = v;
      var done = false;
      var fin = function () { if (done) return; done = true; currentUtter = null; if (cb) cb(); };
      u.onend = fin;
      u.onerror = fin;
      currentUtter = u;
      try { synth.speak(u); } catch (e) { fin(); }
    };

    if (voices.length) { fire(); return; }
    // 语音列表还在加载：等 voiceschanged，最多 900 ms
    var once = false;
    var go = function () {
      if (once) return;
      once = true;
      refresh();
      fire();
    };
    try { synth.onvoiceschanged = function () { refresh(); go(); }; } catch (e) {}
    setTimeout(go, 900);
  }

  /** 播放单个音节；成功/失败都会回调（缺文件静默跳过，不报错） */
  function playSyl(key, rate, cb, token) {
    if (token != null && token !== SEQ_START) { if (cb) cb(); return; }
    var a = canAudio() ? getAudio() : null;
    if (!a || !hasSyl(key)) { if (cb) cb(); return; }
    var done = false;
    var fin = function () {
      if (done) return;
      done = true;
      a.onended = null;
      a.onerror = null;
      if (cb) cb();
    };
    try { a.onended = fin; a.onerror = fin; } catch (e) {}
    try {
      a.playbackRate = Math.max(0.5, Math.min(2, Number(rate) || 1));
      a.src = AUDIO_BASE + key + '.mp3';
      var p = a.play();
      if (p && p.then) p.then(null, fin);
    } catch (e) { fin(); return; }
    // 兜底：万一 onended 没触发，按音频长度 + 余量强行推进
    timer = setTimeout(fin, 2600);
  }

  /**
   * 顺序播放一串步骤
   * steps: [{k:'de5'} | {w:'的话'} | {t:'xxx', lang, rate} | {gap:240}]
   * opts:  { rate, onend, gap(词内音节间隔，默认 40) }
   */
  function playSteps(steps, opts) {
    opts = opts || {};
    stopAll();
    var token = SEQ_START;
    var list = [];
    var gapInWord = opts.gap == null ? 40 : opts.gap;

    steps.forEach(function (st) {
      if (!st) return;
      if (st.gap != null) { list.push({ type: 'gap', ms: st.gap }); return; }
      if (st.t != null) { list.push({ type: 'tts', text: st.t, lang: st.lang, rate: st.rate }); return; }
      var keys = null;
      if (st.w) keys = wordKeys(st.w);
      else if (st.k) keys = [st.k];
      if (keys && keys.length) {
        keys.forEach(function (k, i) {
          list.push({ type: 'syl', key: k });
          if (i < keys.length - 1 && gapInWord) list.push({ type: 'gap', ms: gapInWord });
        });
        return;
      }
      // 没有音频：留一条"外部兜底"标记，由调用方决定要不要整体读 TTS
      list.push({ type: 'miss' });
    });

    var i = 0;
    var step = function () {
      if (token !== SEQ_START) return;
      if (i >= list.length) { if (opts.onend) opts.onend(); return; }
      var it = list[i++];
      if (it.type === 'gap') { timer = setTimeout(step, it.ms); return; }
      if (it.type === 'miss') { step(); return; }
      if (it.type === 'tts') { ttsSay(it.text, { lang: it.lang, rate: it.rate || opts.rate }, step, token); return; }
      playSyl(it.key, opts.rate, step, token);
    };
    step();
    return token;
  }

  /* ==================================================================
   * 五、对外接口
   * ================================================================== */

  /** 通用朗读（纯 TTS） */
  function speak(text, opts) {
    opts = opts || {};
    if (!text) { if (opts.onend) setTimeout(opts.onend, 30); return null; }
    stopAll();
    ttsSay(text, opts, opts.onend, SEQ_START);
    return currentUtter;
  }

  /**
   * 读一个汉字：先读音节，再读一个组词
   * 单独念一个字，同音字太多小朋友分不清；带上词就明确了。
   * @param {string} ch 汉字
   * @param {string} py 带声调拼音（可省略，自动查表）
   * @param {string} word 组词（可省略）
   * @param {object} opts { rate, repeat }
   */
  function speakZhChar(ch, py, word, opts) {
    opts = opts || {};
    var rate = opts.rate || 1;
    var key = charKey(ch, py);
    var keys = word ? wordKeys(word) : null;
    if (!key && !keys) {
      // 完全没有音频：整段交给 TTS（用句号制造停顿）
      return speak(ch + (word ? '。' + word : ''), { lang: 'zh-CN', rate: rate, pitch: 1.02 });
    }
    var steps = [];
    if (key) steps.push({ k: key });
    if (keys) {
      if (key) steps.push({ gap: 240 });
      steps.push({ w: word });
    }
    if (opts.repeat) {
      steps.push({ gap: 320 });
      if (key) steps.push({ k: key });
      if (keys) { steps.push({ gap: 240 }); steps.push({ w: word }); }
    }
    playSteps(steps, { rate: rate, onend: opts.onend });
    return null;
  }

  /** 读一个词（逐字拆音节连读） */
  function speakZhWord(word, opts) {
    opts = opts || {};
    var rate = opts.rate || 1;
    var keys = wordKeys(word);
    if (!keys) {
      return speak(word, { lang: 'zh-CN', rate: rate, pitch: 1.02, onend: opts.onend });
    }
    playSteps([{ w: word }], { rate: rate, gap: opts.gap, onend: opts.onend });
    return null;
  }

  /** 取一个卡片上的"第一个组词"（组词字段用顿号分隔） */
  function firstWord(words) {
    if (!words) return '';
    var arr = String(words).split(/[、,，/；;|]/);
    for (var i = 0; i < arr.length; i++) {
      var w = String(arr[i] || '').trim();
      if (w) return w;
    }
    return '';
  }

  /** 中文卡（认字 / 听写）：字 → 词 */
  function speakZhCard(card, opts) {
    if (!card) return null;
    return speakZhChar(card.c, card.pinyin, firstWord(card.words), opts);
  }

  /** 拼音卡（认读 / 拼写）：例字 → 例词 */
  function speakPyCard(card, opts) {
    if (!card) return null;
    return speakZhChar(card.c, null, card.word, opts);
  }

  function speakZh(text, rate) { return speakZhCard({ c: text }, { rate: rate || 0.9 }); }
  function speakEn(text, rate) {
    return speak(text, { lang: 'en-US', rate: rate || 0.92 });
  }

  /** 统计信息：本地音频覆盖情况（诊断 / 测试用） */
  function audioInfo() {
    var set = availSet();
    return {
      audio: canAudio(),
      tts: !!synth,
      voices: voices.length,
      syllables: set ? Object.keys(set).length : 0,
      unlocked: unlocked
    };
  }

  /* ---------- 首次任意手势：解锁发音通道 ---------- */
  if (typeof global.addEventListener === 'function') {
    var once = function () {
      unlock();
      ['pointerdown', 'touchstart', 'mousedown', 'keydown', 'click'].forEach(function (ev) {
        try { global.removeEventListener(ev, once, true); } catch (e) {}
      });
    };
    ['pointerdown', 'touchstart', 'mousedown', 'keydown', 'click'].forEach(function (ev) {
      try { global.addEventListener(ev, once, true); } catch (e) {}
    });
  }

  global.Speech = {
    // 基础
    supported: supported,
    audioReady: audioReady,
    audioInfo: audioInfo,
    refresh: refresh,
    pickVoice: pickVoice,
    unlock: unlock,
    stop: stopAll,
    speak: speak,
    // 英语 / 通用
    speakEn: speakEn,
    // 中文：字 + 词
    speakZh: speakZh,
    speakZhChar: speakZhChar,
    speakZhWord: speakZhWord,
    speakZhCard: speakZhCard,
    speakPyCard: speakPyCard,
    // 工具（测试与其它模块复用）
    syllableKey: syllableKey,
    wordKeys: wordKeys,
    charKey: charKey,
    hasSyl: hasSyl,
    firstWord: firstWord,
    baseOf: baseOf
  };
})(window);
