/*!
 * speech.js —— 语音朗读（Web Speech API，浏览器内置，离线可用）
 * 英语用 en-US，中文用 zh-CN；听写支持 0.4 ~ 1.4 倍速
 */
(function (global) {
  'use strict';

  var synth = global.speechSynthesis || null;
  var voices = [];
  var voiceCache = {};

  function refresh() {
    if (!synth) return;
    try { voices = synth.getVoices() || []; } catch (e) { voices = []; }
    voiceCache = {};
  }

  if (synth) {
    refresh();
    if (typeof synth.onvoiceschanged !== 'undefined') {
      synth.onvoiceschanged = refresh;
    }
  }

  function supported() { return !!synth; }

  /** 挑一个最合适的声音 */
  function pickVoice(lang) {
    if (voiceCache[lang]) return voiceCache[lang];
    if (!voices.length) refresh();
    var target = lang.toLowerCase();
    var prefix = target.split('-')[0];
    var list = voices.filter(function (v) {
      return String(v.lang || '').toLowerCase().replace('_', '-').indexOf(prefix) === 0;
    });
    if (!list.length) return null;
    // 优先本地声音、优先女声/标准音色
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

  var currentUtter = null;

  function stop() {
    if (!synth) return;
    try { synth.cancel(); } catch (e) {}
    currentUtter = null;
  }

  /**
   * 朗读
   * @param {string} text
   * @param {object} [opts] { lang, rate, pitch, onend }
   */
  function speak(text, opts) {
    opts = opts || {};
    if (!synth || !text) {
      if (opts.onend) setTimeout(opts.onend, 300);
      return null;
    }
    try { synth.cancel(); } catch (e) {}
    var u = new global.SpeechSynthesisUtterance(String(text));
    var lang = opts.lang || 'en-US';
    u.lang = lang;
    u.rate = Math.max(0.3, Math.min(2, Number(opts.rate) || 1));
    u.pitch = opts.pitch == null ? 1 : opts.pitch;
    var v = pickVoice(lang);
    if (v) u.voice = v;
    u.onend = function () { currentUtter = null; if (opts.onend) opts.onend(); };
    u.onerror = function () { currentUtter = null; if (opts.onend) opts.onend(); };
    currentUtter = u;
    synth.speak(u);
    return u;
  }

  /** 中文朗读单个汉字时，慢速 + 稍高音调更清晰 */
  function speakZh(text, rate) {
    return speak(text, { lang: 'zh-CN', rate: rate || 0.9, pitch: 1.02 });
  }

  function speakEn(text, rate) {
    return speak(text, { lang: 'en-US', rate: rate || 0.92 });
  }

  global.Speech = {
    supported: supported,
    speak: speak,
    speakZh: speakZh,
    speakEn: speakEn,
    stop: stop,
    pickVoice: pickVoice,
    refresh: refresh
  };
})(window);
