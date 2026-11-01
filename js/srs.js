/*!
 * srs.js —— 艾宾浩斯遗忘曲线调度
 *
 * 复习间隔（天）：1 → 2 → 4 → 7 → 15 → 30 → 60 → 120
 * 三档作答结果：
 *   easy   确认掌握  （认识 + 二次确认确实认识；拼写完全正确；听写自评写对）
 *   hard   模糊      （认识但二次确认时发现忘了；拼写差一点；写错但认得）
 *   forgot 遗忘      （不认识；拼写错误且不认得；听写写不出）
 */
(function (global) {
  'use strict';

  var INTERVALS = [0, 1, 2, 4, 7, 15, 30, 60, 120];
  var MAX_STAGE = INTERVALS.length - 1;

  var STAGE_LABEL = ['未学', '第1次复习', '第2次复习', '第3次复习', '第4次复习', '第5次复习', '第6次复习', '第7次复习', '已掌握'];

  // 记忆强度因子 S：阶段越高，遗忘越慢
  var STRENGTH = [0.35, 1, 2.2, 4.5, 9, 18, 36, 70, 130];

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function toDateStr(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function todayStr() { return toDateStr(new Date()); }

  function parseDate(s) {
    var p = String(s).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function addDays(dateStr, n) {
    var d = parseDate(dateStr);
    d.setDate(d.getDate() + n);
    return toDateStr(d);
  }

  function diffDays(a, b) {
    return Math.round((parseDate(b) - parseDate(a)) / 86400000);
  }

  function newRecord() {
    return { s: 0, due: null, c: 0, w: 0, h: 0, first: null, last: null, streak: 0 };
  }

  /**
   * 「要重点学」的判定：这张卡反复没记住
   *
   *   w  答错（不认识 / 拼错 / 听写写不出）的累计次数
   *   h  「其实有点模糊」的累计次数
   *
   * 错 2 次以上、或者模糊 2 次以上，就说明它光靠 App 里的过一遍不够，
   * 需要单独抄出来在纸上再练——打印复习单默认就取这批卡。
   */
  var FOCUS_W = 2;
  var FOCUS_H = 2;

  function needFocus(rec) {
    if (!rec) return false;
    return (Number(rec.w) || 0) >= FOCUS_W || (Number(rec.h) || 0) >= FOCUS_H;
  }

  /** 难记程度：数字越大越该重点练（用于排序） */
  function focusScore(rec) {
    if (!rec) return 0;
    return (Number(rec.w) || 0) * 2 + (Number(rec.h) || 0);
  }

  /** 是否到期（含逾期） */
  function isDue(rec, today) {
    if (!rec) return false;
    if (rec.s === 0) return true;              // 新卡待学
    if (!rec.due) return true;
    return parseDate(rec.due) <= parseDate(today || todayStr());
  }

  /**
   * 应用一次作答结果，返回新的记录（不修改入参）
   * @param {object} rec
   * @param {'easy'|'hard'|'forgot'} outcome
   * @param {string} [today]
   */
  function apply(rec, outcome, today) {
    today = today || todayStr();
    var r = Object.assign(newRecord(), rec || {});
    var s = r.s || 0;

    if (outcome === 'easy') {
      s = Math.min(s + 1, MAX_STAGE);
      r.c = (r.c || 0) + 1;
      r.streak = (r.streak || 0) + 1;
    } else if (outcome === 'hard') {
      s = Math.max(1, Math.min(s, MAX_STAGE - 1));
      r.h = (r.h || 0) + 1;
      r.streak = 0;
    } else {
      s = Math.max(1, Math.min(1, s));   // 遗忘：回到第 1 阶段，明天重来
      r.w = (r.w || 0) + 1;
      r.streak = 0;
    }

    r.s = s;
    r.due = addDays(today, INTERVALS[s] || 1);
    if (!r.first) r.first = today;
    r.last = today;
    return r;
  }

  /** 距离下次复习的天数（用于界面显示） */
  function daysUntil(due, today) {
    if (!due) return 0;
    return diffDays(today || todayStr(), due);
  }

  /** 理论记忆保持率 R = e^(-t/S)，t 为天 */
  function retention(t, stage) {
    var S = STRENGTH[Math.max(0, Math.min(stage, MAX_STAGE))] || 1;
    return Math.exp(-Math.max(0, t) / S);
  }

  /** 生成遗忘曲线采样点（0..maxT 天） */
  function curvePoints(stage, maxT, step) {
    step = step || 0.5;
    var pts = [];
    for (var t = 0; t <= maxT + 0.0001; t += step) {
      pts.push({ t: Math.round(t * 10) / 10, r: retention(t, stage) });
    }
    return pts;
  }

  function stageLabel(s) { return STAGE_LABEL[Math.max(0, Math.min(s, MAX_STAGE))] || '未学'; }

  function intervalOf(s) { return INTERVALS[Math.max(0, Math.min(s, MAX_STAGE))] || 0; }

  global.SRS = {
    INTERVALS: INTERVALS,
    MAX_STAGE: MAX_STAGE,
    STAGE_LABEL: STAGE_LABEL,
    todayStr: todayStr,
    toDateStr: toDateStr,
    parseDate: parseDate,
    addDays: addDays,
    diffDays: diffDays,
    newRecord: newRecord,
    needFocus: needFocus,
    focusScore: focusScore,
    FOCUS_W: FOCUS_W,
    FOCUS_H: FOCUS_H,
    isDue: isDue,
    apply: apply,
    daysUntil: daysUntil,
    retention: retention,
    curvePoints: curvePoints,
    stageLabel: stageLabel,
    intervalOf: intervalOf
  };
})(window);
