/**
 * test-app.mjs —— 用 jsdom 无头运行整个网页，模拟真实点击，验证四种练习与数据落库
 * 运行：NODE_PATH=<node workspace>/node_modules node _tools/test-app.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(process.cwd());
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const results = [];
const runtimeErrors = [];
function ok(cond, name, extra = '') {
  results.push({ name, pass: !!cond, extra });
  console.log((cond ? '  ✅ ' : '  ❌ ') + name + (extra ? '  → ' + extra : ''));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function boot() {
  const html = read('index.html').replace(/<script src="[^"]+"><\/script>/g, '');
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => runtimeErrors.push(e.message + ' :: ' + (e.detail && e.detail.stack || '')));
  const dom = new JSDOM(html, {
    url: 'https://local.test/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc
  });
  const w = dom.window;
  w.confirm = () => true;
  w.alert = () => {};
  w.__AUDIO_OFF__ = true;   // jsdom 不支持音频播放
  const files = ['js/meta.js', 'js/strings.js', 'js/data-en.js', 'js/data-zh.js', 'js/data-py.js', 'js/py-dict.js', 'js/audio-manifest.js', 'js/srs.js', 'js/store.js', 'js/speech.js', 'js/cloud.js', 'js/app.js'];
  for (const f of files) {
    try {
      w.eval(read(f));
    } catch (e) {
      console.error('加载脚本失败：' + f + '\n' + e.stack);
      process.exit(1);
    }
  }
  return w;
}

const $ = (w, sel) => w.document.querySelector(sel);
const $$ = (w, sel) => Array.from(w.document.querySelectorAll(sel));
const click = (w, sel) => {
  const el = $(w, sel);
  if (!el) throw new Error('找不到元素：' + sel);
  el.click();
  return el;
};

function text(w) {
  return (w.document.body.textContent || '').replace(/\s+/g, ' ');
}

/** 已答错过的卡片（第二次出现时改为答对，避免重学循环把测试卡住） */
const wrongOnce = new Set();

/** 答完当前这张卡并等待下一张 */
async function answerOne(w, opts = {}) {
  const mode = opts.mode || 'en_recog';
  if (mode === 'en_recog' || mode === 'zh_recog') {
    const el = $(w, '.quiz-word') || $(w, '.quiz-char');
    const label = mode + ':' + (el ? el.textContent.trim() : '');
    if ($(w, '#btnYes') && !wrongOnce.has(label)) {
      wrongOnce.add(label);
      click(w, '#btnNo');
      await wait(30);
      if ($(w, '#btnNext')) { click(w, '#btnNext'); }
      await wait(1000);
      return 'forgot';
    }
    if ($(w, '#btnYes')) {
      click(w, '#btnYes');
      await wait(30);
      click(w, '#btnEasy');
      await wait(1000);
      return 'easy';
    }
    return 'none';
  }
  if (mode === 'en_spell') {
    const inp = $(w, '#spellIn');
    if (!inp) return 'end';
    const zh = $(w, '.quiz-word').textContent.trim();
    const word = lookupWord(w, zh);
    inp.value = opts.wrong ? 'zzzz' : word;
    click(w, '#btnSubmit');
    await wait(80);
    if (!$(w, '#btnNext')) return 'end';
    click(w, '#btnNext');
    await wait(1000);
    return 'answered';
  }
  if (mode === 'zh_dict') {
    if ($(w, '#btnReveal')) {
      click(w, '#btnReveal');
      await wait(40);
      click(w, '#btnRight');
      await wait(1000);
      return 'easy';
    }
    return 'none';
  }
}

function lookupWord(w, zh) {
  for (const u of w.EN_UNITS) {
    for (const arr of u.words) {
      if (arr[1] === zh) return arr[0];
    }
  }
  return 'apple';
}

async function runSession(w, mode, max = 30) {
  let n = 0;
  let first = true;
  while (n < max) {
    if ($(w, '#btnMore')) break;
    if (mode === 'en_spell') {
      const r = await answerOne(w, { mode, wrong: first });
      first = false;
      if (r === 'end') break;
    } else {
      await answerOne(w, { mode });
    }
    n += 1;
    if (!$(w, '.quiz-card') && !$(w, '#btnMore')) break;
  }
  return n;
}

async function main() {
  console.log('\n=== 记忆小站 · 无头集成测试 ===\n');
  const w = boot();

  // T1 首次进入
  ok(/先给小朋友建个档案吧/.test(text(w)), 'T1 首次进入显示建档引导');
  ok($(w, '#tabbar').style.display === 'none', 'T1 无档案时隐藏底部导航');

  // T2 建档
  click(w, '#wCreate');
  await wait(50);
  ok(!$(w, '#sheetMask').hidden, 'T2 点击新建弹出档案表单');
  $(w, '#pName').value = '小雨';
  click(w, '#pSave');
  await wait(80);
  ok(/小雨/.test(text(w)), 'T2 创建档案后首页显示名字');
  ok(w.Store.listProfiles().length === 1, 'T2 档案已写入 Store', 'profiles=' + w.Store.listProfiles().length);

  // 限制新卡数量，便于测试
  const pid = w.Store.activeProfile().id;
  w.Store.updateSettings(pid, { newEn: 4, newZh: 4, ttsAuto: false });
  w.App.render();
  await wait(30);

  // T3 首页
  ok($$(w, '.mode-card').length === 6, 'T3 首页渲染 6 个练习入口（英语/中文/拼音各 2）');
  ok($$(w, '.subject-label').length === 3, 'T3 按科目分成 3 组');
  ok(w.document.querySelectorAll('.hero-stat').length === 3, 'T3 首页 3 个今日数据');
  ok($(w, '#heroStart') && !$(w, '#heroStart').disabled, 'T3「开始今天的学习」可点击');

  // T4 英语认词（模式一：认识 → 二次确认）
  click(w, '[data-start="en_recog"]');
  await wait(60);
  ok($(w, '.session') && $(w, '.quiz-word'), 'T4 英语认词会话已打开并显示单词');
  ok($(w, '#btnYes') && $(w, '#btnNo'), 'T4 有「认识 / 不认识」两个按钮');
  click(w, '#btnYes');
  await wait(40);
  ok($(w, '.answer-box') && $(w, '#btnEasy') && $(w, '#btnHard'), 'T4 认识后显示释义并要求二次确认');
  click(w, '#btnEasy');
  await wait(1000);
  ok($(w, '.quiz-word') || $(w, '#btnMore'), 'T4 二次确认后进入下一张');

  const n1 = await runSession(w, 'en_recog');
  ok(n1 >= 2, 'T4 完成英语认词一组', '作答 ' + n1 + ' 张');
  ok(!!$(w, '#btnMore'), 'T4 出现结算页');
  ok(/这一组完成啦/.test(text(w)), 'T4 结算文案正确');

  const recs = w.Store.allRecs('en_recog');
  const keys = Object.keys(recs);
  ok(keys.length >= 4, 'T4 记录已写入 localStorage', 'en_recog=' + keys.length + ' 条');
  const allScheduled = keys.every((k) => recs[k].due && recs[k].s >= 1);
  ok(allScheduled, 'T4 每张卡都有 stage 与 due 日期');
  const dueTomorrow = keys.every((k) => recs[k].due > w.SRS.todayStr() || recs[k].due === w.SRS.todayStr());
  ok(dueTomorrow, 'T4 复习日期不早于今天');

  // 返回首页
  click(w, '#btnHome');
  await wait(120);
  ok(!$(w, '.session'), 'T4 结算后回到首页（会话已关闭）');

  // T5 英语拼写（模式二）
  click(w, '[data-start="en_spell"]');
  await wait(60);
  ok(!!$(w, '#spellIn'), 'T5 拼写模式显示输入框');
  ok(/共 \d+ 个字母/.test(text(w)), 'T5 显示首字母与字母数提示');

  // 先故意拼错
  const zh1 = $(w, '.quiz-word').textContent.trim();
  const right1 = lookupWord(w, zh1);
  $(w, '#spellIn').value = 'zzzz';
  click(w, '#btnSubmit');
  await wait(80);
  ok(!!$(w, '#sBody .verdict.no'), 'T5 拼错时给出错误判定');
  ok(new RegExp(right1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test($(w, '#sBody').textContent), 'T5 拼错后展示正确单词', right1);
  click(w, '#btnNext');
  await wait(1000);

  // 再全部拼对
  let n5 = 1;
  while (!$(w, '#btnMore') && n5 < 30) {
    const r = await answerOne(w, { mode: 'en_spell' });
    if (r === 'end') break;
    n5 += 1;
  }
  ok(n5 >= 2, 'T5 完成英语拼写一组', '作答 ' + n5 + ' 张');
  const es = w.Store.allRecs('en_spell');
  ok(Object.keys(es).length >= 2, 'T5 拼写记录已保存', 'en_spell=' + Object.keys(es).length + ' 条');
  const hasWrong = Object.keys(es).some((k) => es[k].w >= 1);
  ok(hasWrong, 'T5 拼错的卡片记录了错误次数');
  if ($(w, '#btnHome')) click(w, '#btnHome');
  await wait(120);

  // T6 中文认字
  click(w, '[data-start="zh_recog"]');
  await wait(60);
  ok(!!$(w, '.quiz-char'), 'T6 中文认字显示汉字');
  const n6 = await runSession(w, 'zh_recog');
  ok(n6 >= 1, 'T6 完成中文认字一组', '作答 ' + n6 + ' 张');
  ok(Object.keys(w.Store.allRecs('zh_recog')).length >= 4, 'T6 认字记录已保存');
  click(w, '#btnHome');
  await wait(120);

  // T7 中文听写
  click(w, '[data-start="zh_dict"]');
  await wait(80);
  ok(!!$(w, '#btnPlay') && !!$(w, '#rateIn'), 'T7 听写模式有播放按钮与语速滑块');
  ok(/语速/.test(text(w)), 'T7 语速可调');
  $(w, '#rateIn').value = '0.6';
  $(w, '#rateIn').dispatchEvent(new w.Event('input'));
  await wait(30);
  ok(Math.abs(w.Store.activeProfile().settings.ttsRate - 0.6) < 1e-6, 'T7 语速修改已保存', 'rate=' + w.Store.activeProfile().settings.ttsRate);
  const n7 = await runSession(w, 'zh_dict');
  ok(n7 >= 1, 'T7 完成听写一组', '作答 ' + n7 + ' 张');
  click(w, '#btnHome');
  await wait(120);

  // T8 进度页
  w.location.hash = '#/progress';
  await wait(80);
  ok($$(w, '.stat-box').length === 4, 'T8 进度页 4 个核心指标');
  ok(!!$(w, 'svg path'), 'T8 遗忘曲线图已绘制');
  ok($$(w, '.week-col').length === 7, 'T8 最近 7 天柱状图 7 根');
  ok($$(w, '.stage-item').length === 9, 'T8 记忆稳固度 9 个阶段');
  const accTxt = text(w).match(/(\d+)%\s*累计答对率/);
  ok(!!accTxt, 'T8 显示累计答对率', accTxt ? accTxt[1] + '%' : '');

  // T9 我的页
  w.location.hash = '#/me';
  await wait(80);
  ok(/小雨/.test(text(w)) && /学习设置/.test(text(w)), 'T9 我的页显示档案与设置');
  ok($$(w, '[data-range]').length === 5, 'T9 5 个可调设置项');
  const nameBefore = w.Store.activeProfile().name;
  ok(nameBefore === '小雨', 'T9 当前档案正确');

  // T10 词库页
  w.location.hash = '#/lib/en';
  await wait(80);
  const units = $$(w, '[data-unit]');
  ok(units.length === w.EN_UNITS.length, 'T10 英语词库列出全部单元');
  const before = w.Store.activeProfile().settings.unitsEn.length || w.EN_UNITS.length;
  units[0].click();
  await wait(60);
  const after = w.Store.activeProfile().settings.unitsEn.length;
  ok(after !== before, 'T10 关闭单元后设置已更新', before + ' → ' + after);
  w.location.hash = '#/lib/zh';
  await wait(80);
  ok($$(w, '[data-unit]').length === w.ZH_UNITS.length, 'T10 中文识字库列出全部字组');

  // T11 多档案隔离
  const p2 = w.Store.createProfile('小果', '🐼');
  ok(w.Store.listProfiles().length === 2, 'T11 可创建第二个档案');
  w.Store.setActive(p2.id);
  w.App.render();
  await wait(50);
  ok(Object.keys(w.Store.allRecs('en_recog')).length === 0, 'T11 新档案数据独立（0 条记录）');
  w.Store.setActive(pid);
  w.App.render();
  await wait(50);
  ok(Object.keys(w.Store.allRecs('en_recog')).length > 0, 'T11 切回原档案记录仍在');

  // T12 备份导出 / 导入
  const dump = w.Store.exportAll();
  ok(/"profiles"/.test(dump) && dump.length > 100, 'T12 可导出备份 JSON', dump.length + ' 字节');
  const parsed = JSON.parse(dump);
  ok(parsed.data.profiles.length === 2, 'T12 备份含全部档案');

  // T13 遗忘曲线算法
  const SRS = w.SRS;
  let rec = SRS.newRecord();
  const trace = [];
  for (let i = 0; i < 8; i++) {
    rec = SRS.apply(rec, 'easy');
    trace.push(rec.s + 'd/' + rec.due);
  }
  ok(trace[trace.length - 1].startsWith('8d'), 'T13 连续答对 8 次升到最高阶段', trace.join(' '));
  const reset = SRS.apply(rec, 'forgot');
  ok(reset.s === 1, 'T13 答错回到第 1 阶段', 'stage=' + reset.s);
  ok(SRS.daysUntil(reset.due) === 1, 'T13 答错后 1 天复习', reset.due);
  const hard = SRS.apply(SRS.apply(SRS.newRecord(), 'easy'), 'hard');
  ok(hard.s === 1, 'T13 模糊不会升级', 'stage=' + hard.s);
  ok(SRS.retention(0, 1) === 1 && SRS.retention(3, 1) < 0.1 && SRS.retention(1, 1) < 0.5, 'T13 保持率随天数衰减');
  ok(SRS.retention(7, 6) > SRS.retention(7, 1), 'T13 阶段越高遗忘越慢');

  // T14 词库数据完整性
  const dupEN = new Set();
  let dupCount = 0;
  w.EN_UNITS.forEach((u) => u.words.forEach((a) => {
    const k = String(a[0]).toLowerCase();
    if (dupEN.has(k)) dupCount += 1; else dupEN.add(k);
  }));
  ok(dupCount === 0, 'T14 英语词库无重复词条', '重复 ' + dupCount + ' 个');
  const badZH = w.ZH_UNITS.reduce((n, u) => n + u.words.filter((x) => !x[0] || !x[1]).length, 0);
  ok(badZH === 0, 'T14 中文字条都有拼音', '缺失 ' + badZH + ' 个');
  const enTotal = w.EN_UNITS.reduce((n, u) => n + u.words.length, 0);
  const zhTotal = w.ZH_UNITS.reduce((n, u) => n + u.words.length, 0);
  ok(enTotal > 300 && zhTotal > 1000, 'T14 词库规模达标', '英语 ' + enTotal + ' 词 / 中文 ' + zhTotal + ' 字');

  // T15 到期复习队列（先把英语单元恢复成全选，避免受 T10 关闭单元的影响）
  w.location.hash = '#/home';
  w.Store.updateSettings(w.Store.activeProfile().id, { unitsEn: w.EN_UNITS.map((u) => u.id) });
  await wait(60);
  const recsNow = w.Store.allRecs('en_recog');
  const firstKey = Object.keys(recsNow)[0];
  recsNow[firstKey].due = w.SRS.todayStr();       // 假装今天到期
  w.Store.save();
  w.App.render();
  await wait(60);
  const heroTxt = text(w);
  ok(/待复习/.test(heroTxt), 'T15 首页显示待复习数量');
  const card = w.EN_UNITS.flatMap((u) => u.words).find((a) => String(a[0]).toLowerCase() === firstKey);
  w.App.startSession(['en_recog']);
  await wait(60);
  ok(/认识/.test(text(w)) && !!$(w, '#btnYes'), 'T15 到期卡片进入练习队列');
  const shownWord = ($(w, '.quiz-word') || {}).textContent;
  ok(!!shownWord, 'T15 复习卡正常显示', String(shownWord));
  click(w, '#btnNo');
  await wait(40);
  click(w, '#btnNext');
  await wait(1000);
  const recAfter = w.Store.getRec('en_recog', firstKey);
  ok(recAfter.s === 1 && recAfter.w >= 1, 'T16「不认识」后回到第 1 阶段并记错', 'stage=' + recAfter.s + ' 错' + recAfter.w);
  ok(recAfter.due === w.SRS.addDays(w.SRS.todayStr(), 1), 'T16 明天再复习', recAfter.due);
  if ($(w, '#sClose')) click(w, '#sClose');
  await wait(60);

  // T17 打卡与日志
  w.App.render();
  await wait(40);
  const done = w.Store.dayTotal();
  ok(done > 0, 'T17 今日练习次数已记录', done + ' 次');
  ok(w.Store.streak() >= 1, 'T17 连续打卡天数 >= 1', w.Store.streak() + ' 天');

  // T18 运行期无脚本错误
  ok(runtimeErrors.length === 0, 'T18 全程无 JS 运行错误', runtimeErrors.slice(0, 2).join(' | '));

  // 汇总
  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  console.log('\n----------------------------------------');
  console.log(`测试结果：${pass} 通过 / ${fail} 失败 / 共 ${results.length}`);
  if (fail) {
    console.log('失败项：');
    results.filter((r) => !r.pass).forEach((r) => console.log('  - ' + r.name + ' ' + r.extra));
    process.exitCode = 1;
  }
  console.log('----------------------------------------\n');
}

main().catch((e) => {
  console.error('测试异常：', e);
  process.exit(1);
});
