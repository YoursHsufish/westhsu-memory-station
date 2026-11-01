/**
 * test-scenario.mjs —— 按真机使用顺序做的验收测试
 *   建档（选年级/教材）→ 六项功能逐一练习 → 切换小朋友 → 改年级 → 数据隔离
 * 分别在三种环境下跑：
 *   ① 多文件版 index.html（localStorage 正常）
 *   ② 单文件版 记忆小站.html
 *   ③ 沙箱环境（浏览器禁止写本地存储）
 *
 * 运行：NODE_PATH=<node_modules> node _tools/test-scenario.mjs
 */
import { boot, helpers, wait } from './harness.mjs';

const results = [];
function ok(cond, name, extra = '') {
  results.push({ name, pass: !!cond, extra });
  console.log((cond ? '   ✅ ' : '   ❌ ') + name + (extra ? '  → ' + extra : ''));
}

/* ---------------- 页面操作 ---------------- */
function makeApi(w) {
  const { $, $$, click, text } = helpers(w);

  function findPyCard(char) {
    for (const u of w.PY_UNITS) {
      for (const a of u.words) {
        if (a[3] != null && a[1] === char) {
          return { pinyin: a[0], char: a[1], word: a[2], base: a[3], tone: a[4] };
        }
      }
    }
    return null;
  }

  const api = {
    w, $, $$, click, text,
    async createProfile(name, opt = {}) {
      if ($('#wCreate')) click('#wCreate');
      else click('#addProfile');
      await wait(50);
      $('#pName').value = name;
      if (opt.grade) { click(`#gradePicker [data-grade="${opt.grade}"]`); await wait(20); }
      if (opt.book) { click(`#bookPicker [data-book="${opt.book}"]`); await wait(20); }
      if (opt.startEn) { click(`#startEnPicker [data-start-en="${opt.startEn}"]`); await wait(20); }
      click('#pSave');
      await wait(150);
    },
    async goto(hash) {
      w.location.hash = hash;
      w.App.render();
      await wait(60);
    },
    async openMode(mode) {
      await api.goto('#/home');
      click(`[data-start="${mode}"]`);
      await wait(80);
    },
    async closeSession() {
      if ($('#sClose')) click('#sClose');
      await wait(100);
    },
    async answerRecogKnown() {
      const word = ($('.quiz-word') || $('.quiz-char') || {}).textContent || '';
      click('#btnYes');
      await wait(50);
      const hadConfirm = !!$('#btnEasy');
      if (hadConfirm) click('#btnEasy');
      await wait(950);
      return { word: word.trim(), hadConfirm };
    },
    async answerSpellRight() {
      const zh = $('.quiz-word').textContent.trim();
      let word = null;
      for (const u of w.EN_UNITS) for (const a of u.words) if (a[1] === zh) word = a[0];
      $('#spellIn').value = word;
      click('#btnSubmit');
      await wait(90);
      const shown = $('#sBody').textContent;
      click('#btnNext');
      await wait(950);
      return { zh, word, shown };
    },
    async answerDictRight() {
      click('#btnReveal');
      await wait(60);
      const char = ($('.quiz-char') || {}).textContent || '';
      click('#btnRight');
      await wait(950);
      return { char: char.trim() };
    },
    /** 拼音拼写：输入字母 + 点声调 */
    async answerPySpell(toneMismatch) {
      const char = ($('.quiz-char') || {}).textContent.trim();
      const card = findPyCard(char);
      if (!card) return { char, card: null, body: '' };
      $('#pyIn').value = card.base;
      const tone = toneMismatch ? (card.tone % 4) + 1 : card.tone;
      const tb = $(`#toneRow [data-tone="${tone}"]`);
      if (tb) tb.click();
      await wait(30);
      click('#btnPySubmit');
      await wait(90);
      const body = $('#sBody').textContent;
      if ($('#btnNext')) click('#btnNext');
      await wait(950);
      return { char, card, body, tone };
    },
    findPyCard
  };
  return api;
}

function scopeOf(w) {
  const s = w.Store.activeProfile().settings;
  return { zh: s.unitsZh || [], en: s.unitsEn || [], py: s.unitsPy || [] };
}

/* ---------------- 场景 ---------------- */
async function runScenario(envLabel, opt) {
  console.log(`\n──────── ${envLabel} ────────`);
  const { w, errors } = boot(opt);
  const api = makeApi(w);
  const before = results.length;

  ok(w.Store.storageMode() === (opt.disableStorage ? 'memory' : 'localStorage'),
    '存储模式符合预期', w.Store.storageMode());

  // ---------- 1. 建档「测试」：一年级 ----------
  await api.createProfile('测试', { grade: 1, book: '人教版 PEP', startEn: 3 });
  ok(w.Store.listProfiles().length === 1, '新建档案「测试」成功', '档案数=' + w.Store.listProfiles().length);
  ok(/测试/.test(api.$('#profileName').textContent), '顶栏显示当前小朋友', api.$('#profileName').textContent);
  ok(/今天学点什么/.test(api.text()), '建档后进入首页');
  ok(api.$('#tabbar').style.display !== 'none', '底部导航出现');

  const p1 = w.Store.activeProfile();
  ok(p1.settings.grade === 1 && p1.settings.textbook === '人教版 PEP', '年级与教材已保存',
    p1.settings.grade + ' 年级 / ' + p1.settings.textbook);
  ok(/一年级/.test(api.text()) && /人教版/.test(api.text()), '首页显示年级/教材标签');

  const sc1 = scopeOf(w);
  ok(sc1.zh.length === 1 && sc1.zh[0] === 'zh1', '一年级只开放第 1 组汉字', sc1.zh.join(','));
  let enMax = 0;
  w.EN_UNITS.forEach((u) => { if (sc1.en.indexOf(u.id) >= 0 && u.grade > enMax) enMax = u.grade; });
  ok(enMax <= 3, '一年级英语不会出现四年级以上单词', '最高年级单元=' + enMax);
  const pyGrades = w.PY_UNITS.filter((u) => sc1.py.indexOf(u.id) >= 0).map((u) => u.grade);
  ok(Math.max.apply(null, pyGrades) <= 1, '一年级拼音只到第 1 组音节', '拼音组年级=' + pyGrades.join(','));

  // 队列里不能有越级内容
  await api.openMode('en_recog');
  const cardWord = api.$('.quiz-word') ? api.$('.quiz-word').textContent.trim() : '';
  let enCard = null;
  w.EN_UNITS.forEach((u) => u.words.forEach((a) => { if (a[0] === cardWord) enCard = u; }));
  ok(!!enCard && enCard.grade <= 3, '抽到的英语卡属于本年级范围', cardWord + ' / ' + (enCard && enCard.grade) + '年级');
  await api.closeSession();

  // ---------- 2. 建档「测试1」：三年级 ----------
  await api.goto('#/me');
  await api.createProfile('测试1', { grade: 3, book: '外研版', startEn: 3 });
  ok(w.Store.listProfiles().length === 2, '新建第二个档案「测试1」', '档案数=' + w.Store.listProfiles().length);
  ok(w.Store.activeProfile().name === '测试1', '自动切换到新档案');
  const p2 = w.Store.activeProfile();
  ok(p2.settings.grade === 3 && p2.settings.textbook === '外研版', '「测试1」年级教材正确',
    p2.settings.grade + ' 年级 / ' + p2.settings.textbook);
  const sc3 = scopeOf(w);
  ok(sc3.zh.length === 3, '三年级开放 3 组汉字', sc3.zh.join(','));
  ok(sc3.en.length >= sc1.en.length, '三年级英语范围不小于一年级',
    `英语单元 ${sc1.en.length}→${sc3.en.length}`);
  ok(sc3.zh.length > sc1.zh.length && sc3.py.length > sc1.py.length,
    '年级越高中文/拼音内容越多',
    `中文 ${sc1.zh.length}→${sc3.zh.length} / 拼音 ${sc1.py.length}→${sc3.py.length}`);

  // ---------- 3. 六项功能 ----------
  const six = {};

  await api.openMode('en_recog');
  ok(!!api.$('.quiz-card') && !!api.$('#btnYes') && !!api.$('#btnNo'), '①英语认词：显示单词与两个按钮');
  const r1 = await api.answerRecogKnown();
  ok(r1.hadConfirm, '①英语认词：答「认识」后要求二次确认');
  six.en_recog = Object.keys(w.Store.allRecs('en_recog'))[0];
  ok(!!six.en_recog && w.Store.getRec('en_recog', six.en_recog).s >= 1, '①英语认词：记录写入并排复习',
    six.en_recog + ' 下次 ' + w.Store.getRec('en_recog', six.en_recog).due);
  await api.closeSession();

  await api.openMode('en_spell');
  ok(!!api.$('#spellIn'), '②英语拼写：显示输入框');
  const r2 = await api.answerSpellRight();
  ok(/完全正确|差一点/.test(r2.shown), '②英语拼写：正确输入被判对', r2.word);
  ok(Object.keys(w.Store.allRecs('en_spell')).length >= 1, '②英语拼写：记录写入');
  await api.closeSession();

  await api.openMode('zh_recog');
  ok(!!api.$('.quiz-char'), '③中文认字：显示汉字');
  const r3 = await api.answerRecogKnown();
  ok(r3.hadConfirm, '③中文认字：认识后二次确认');
  ok(Object.keys(w.Store.allRecs('zh_recog')).length >= 1, '③中文认字：记录写入');
  await api.closeSession();

  await api.openMode('zh_dict');
  ok(!!api.$('#btnPlay') && !!api.$('#rateIn'), '④中文听写：播放按钮 + 语速滑块');
  api.$('#rateIn').value = '0.6';
  api.$('#rateIn').dispatchEvent(new w.Event('input'));
  await wait(40);
  ok(Math.abs(w.Store.activeProfile().settings.ttsRate - 0.6) < 1e-6, '④中文听写：语速可调并记住');
  const r4 = await api.answerDictRight();
  ok(!!r4.char && Object.keys(w.Store.allRecs('zh_dict')).length >= 1, '④中文听写：记录写入', r4.char);
  await api.closeSession();

  await api.openMode('py_recog');
  ok(!!api.$('.py-word') || !!api.$('.quiz-word'), '⑤拼音认读：显示拼音');
  const pyShown = (api.$('.py-word') || api.$('.quiz-word')).textContent.trim();
  ok(pyShown.length > 0, '⑤拼音认读：卡片内容正常', pyShown);
  const r5 = await api.answerRecogKnown();
  ok(r5.hadConfirm, '⑤拼音认读：与英语认词一致的二次确认');
  ok(Object.keys(w.Store.allRecs('py_recog')).length >= 1, '⑤拼音认读：记录写入');
  await api.closeSession();

  await api.openMode('py_spell');
  ok(!!api.$('#pyIn') && api.$$('#toneRow [data-tone]').length === 4, '⑥拼音拼写：输入框 + 4 个声调按钮');
  const r6 = await api.answerPySpell(false);
  ok(!!r6.card, '⑥拼音拼写：卡片有可拼写的音节数据', r6.char + ' → ' + (r6.card && r6.card.pinyin));
  ok(/拼音和声调都对了|字母对了/.test(r6.body), '⑥拼音拼写：输入正确被判对', (r6.card && r6.card.pinyin) || '');
  ok(Object.keys(w.Store.allRecs('py_spell')).length >= 1, '⑥拼音拼写：记录写入');
  await api.closeSession();

  // 声调错误 → 判为「差一点」
  await api.openMode('py_spell');
  const r6b = await api.answerPySpell(true);
  ok(/声调再想想/.test(r6b.body), '⑥拼音拼写：字母对、声调错 → 判为差一点', r6b.card && r6b.card.pinyin);
  await api.closeSession();

  // ---------- 3.5 关于页 / 版本与开源声明 ----------
  await api.goto('#/me');
  api.click('#aboutCard');
  await wait(90);
  const ver = (w.APP_META && w.APP_META.version) || '';
  ok(!!ver && api.text().indexOf('版本 ' + ver) >= 0, '关于页显示版本号', 'v' + ver);
  ok(/第三方开源数据声明/.test(api.text()), '关于页含第三方开源数据声明');
  ok((api.text().match(/MIT/g) || []).length >= 5, '逐条列出了各数据集的 MIT 许可');
  ok(/Copyright \(c\) 2013 Sun Junyi/.test(api.text()), '保留了原作者的版权行');
  // 点遮罩关闭（内联 onclick 在 jsdom 的 outside-only 模式下不执行，遮罩监听是 JS 绑定的）
  api.$('#sheetMask').click();
  await wait(60);
  ok(api.$('#sheetMask').hidden, '关于页可关闭');

  // ---------- 4. 进度页 ----------
  await api.goto('#/progress');
  ok(api.$$('.stat-box').length === 4 && !!api.$('svg path'), '进度页统计与遗忘曲线正常');

  // ---------- 5. 切换小朋友 ----------
  await api.goto('#/me');
  const prof1 = w.Store.listProfiles().filter((p) => p.name === '测试')[0];
  const prof2 = w.Store.listProfiles().filter((p) => p.name === '测试1')[0];
  api.click(`[data-switch="${prof1.id}"]`);
  await wait(120);
  ok(w.Store.activeProfile().name === '测试', '可以切换到「测试」');
  ok(/测试/.test(api.$('#profileName').textContent), '顶栏名字跟着变');
  ok(Object.keys(w.Store.allRecs('en_recog')).length === 0, '「测试」数据独立（0 条记录）');
  const scBack = scopeOf(w);
  ok(scBack.zh.length === 1, '切回后学习范围也变回一年级', '中文组数=' + scBack.zh.length);

  await api.goto('#/me');
  api.click(`[data-switch="${prof2.id}"]`);
  await wait(120);
  ok(w.Store.activeProfile().name === '测试1', '切回「测试1」');
  ok(Object.keys(w.Store.allRecs('en_recog')).length >= 1, '「测试1」的记录没有丢');
  ok(Object.keys(w.Store.allRecs('py_spell')).length >= 1, '「测试1」的拼音记录也没有丢');

  // ---------- 6. 修改年级 ----------
  await api.goto('#/me');
  api.click('#editScope');
  await wait(80);
  ok(!!api.$('#gradePicker') && !!api.$('#scopePreview'), '「修改学习内容」面板可打开');
  api.click('#gradePicker [data-grade="6"]');
  await wait(40);
  api.click('#sSave');
  await wait(150);
  const sc6 = scopeOf(w);
  ok(sc6.zh.length === 6, '改到六年级后开放全部 6 组汉字', sc6.zh.join(','));
  let enMax6 = 0;
  w.EN_UNITS.forEach((u) => { if (sc6.en.indexOf(u.id) >= 0 && u.grade > enMax6) enMax6 = u.grade; });
  ok(enMax6 === 6, '英语范围同步扩到六年级', '最高=' + enMax6);
  ok(Object.keys(w.Store.allRecs('py_spell')).length >= 1, '改年级不会删除已学记录');

  api.click('#editScope');
  await wait(80);
  api.click('#gradePicker [data-grade="3"]');
  await wait(40);
  api.click('#sSave');
  await wait(150);
  ok(scopeOf(w).zh.length === 3, '可以再改回三年级');

  // ---------- 7. 备份 ----------
  const dump = w.Store.exportAll();
  ok(/"测试1"/.test(dump) && /"测试"/.test(dump), '导出的备份包含两个小朋友', (dump.length / 1024).toFixed(1) + ' KB');

  ok(errors.length === 0, '全程无 JS 运行错误', errors.slice(0, 2).join(' | '));
  return results.length - before;
}

/* ---------------- 主流程 ---------------- */
async function main() {
  console.log('\n════════ 记忆小站 · 验收测试（年级配置 + 拼音） ════════');
  await runScenario('① 多文件版 index.html（正常环境）', { entry: 'index.html' });
  await runScenario('② 单文件版 记忆小站.html', { entry: '记忆小站.html' });
  await runScenario('③ 沙箱环境（浏览器禁止写存储）', { entry: '记忆小站.html', disableStorage: true });

  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  console.log('\n────────────────────────────────────────');
  console.log(`合计：${pass} 通过 / ${fail} 失败 / 共 ${results.length} 项`);
  if (fail) {
    console.log('失败项：');
    results.filter((r) => !r.pass).forEach((r) => console.log('  - ' + r.name + '  ' + r.extra));
    process.exitCode = 1;
  }
  console.log('────────────────────────────────────────\n');
}

main().catch((e) => {
  console.error('测试异常：', e);
  process.exit(1);
});
