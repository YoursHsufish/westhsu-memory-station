/**
 * test-relearn.mjs —— 验证「当日没记住的卡片会循环重现，直到答对为止」
 * 运行：NODE_PATH=<node_modules> node _tools/test-relearn.mjs
 */
import { boot, helpers, wait } from './harness.mjs';

const results = [];
function ok(cond, name, extra = '') {
  results.push({ name, pass: !!cond, extra });
  console.log((cond ? '   ✅ ' : '   ❌ ') + name + (extra ? '  → ' + extra : ''));
}

async function answer(w, kind) {
  const { $, click } = helpers(w);
  const word = $('.quiz-word') ? $('.quiz-word').textContent.trim() : '';
  if (kind === 'known') {
    click('#btnYes');
    await wait(40);
    if ($('#btnEasy')) click('#btnEasy');
    await wait(900);
  } else {
    click('#btnNo');
    await wait(40);
    click('#btnNext');
    await wait(900);
  }
  return word;
}

async function main() {
  console.log('\n════════ 重学循环测试 ════════\n');
  const { w, errors } = boot({ entry: 'index.html' });
  const { $, $$, click, text } = helpers(w);

  // 建一个一年级档案，只留 2 张新卡，方便观察
  click('#wCreate');
  await wait(50);
  $('#pName').value = '重学测试';
  click('#gradePicker [data-grade="1"]');
  await wait(20);
  click('#pSave');
  await wait(150);
  const pid = w.Store.activeProfile().id;
  w.Store.updateSettings(pid, { newEn: 2, ttsAuto: false });
  w.App.render();
  await wait(60);

  const today = w.SRS.todayStr();
  const tomorrow = w.SRS.addDays(today, 1);

  // ---------- 场景 1：同一张卡连续答错，必须在当天反复出现 ----------
  click('[data-start="en_recog"]');
  await wait(80);

  const target = $('.quiz-word').textContent.trim();
  let seen = 0;
  let guard = 0;
  const trail = [];

  while (!(guard++ > 40) && !$('#btnMore')) {
    const word = $('.quiz-word') ? $('.quiz-word').textContent.trim() : null;
    if (!word) break;
    const isTarget = word === target;
    if (isTarget) {
      seen += 1;
      trail.push('#' + seen + ':' + word);
      // 前 3 次都答"不认识"，第 4 次才答"认识"
      await answer(w, seen <= 3 ? 'unknown' : 'known');
    } else {
      trail.push(word);
      await answer(w, 'known');
    }
  }

  ok(seen >= 4, '同一张不认识的卡当天重复出现直到答对', `出现 ${seen} 次`);
  ok(!!$('#btnMore'), '所有卡都答对后才出现结算页（不会提前结束）');
  ok(/这一组完成啦/.test(text()), '结算页文案正常');
  ok(/重新学了一遍/.test(text()), '结算页说明了「重新学了一遍」',
    (text().match(/其中\s*\d+\s*张重新学了一遍/) || [''])[0]);

  const rec = w.Store.getRec('en_recog', target.toLowerCase());
  ok(!!rec, '目标卡的记录存在', target);
  ok(rec.s === 1, '当天重复答对不会把阶段刷高（仍是第 1 阶段）', 'stage=' + rec.s);
  ok(rec.due === tomorrow, '复习日固定在明天', 'due=' + rec.due);
  ok(rec.first === today, '首次学习日期是今天', 'first=' + rec.first);

  // 结算页的「一次答对」应按首次作答统计，而不是重复次数
  const accText = (text().match(/(\d+)%\s*一次答对/) || [])[1];
  ok(accText !== undefined && Number(accText) < 100, '一次答对率按首次作答统计', accText + '%');

  // ---------- 场景 2：退出即放弃 ----------
  click('#btnHome');
  await wait(120);
  w.Store.updateSettings(pid, { newEn: 2 });
  // 让同一天能再开一组：清掉今天的日志与新卡预算限制，直接开一组新的
  click('[data-start="zh_recog"]');
  await wait(80);
  const zTarget = $('.quiz-char').textContent.trim();
  click('#btnNo');
  await wait(40);
  click('#btnNext');
  await wait(900);
  const zRec = w.Store.getRec('zh_recog', zTarget);
  ok(!!zRec && zRec.s === 1, '答「不认识」后立即写入记录', zTarget + ' stage=' + (zRec && zRec.s));
  ok(!$('#btnMore'), '此时会话尚未结束（该卡还在当日队列里）');

  click('#sClose');           // confirm 在测试里恒为 true
  await wait(150);
  ok(!$('.session'), '点退出即放弃：会话关闭');
  const zRec2 = w.Store.getRec('zh_recog', zTarget);
  ok(!!zRec2 && zRec2.s === 1 && zRec2.due === w.SRS.addDays(w.SRS.todayStr(), 1),
    '退出后记录保留，明天仍会复习', zRec2 && zRec2.due);

  ok(errors.length === 0, '全程无 JS 运行错误', errors.slice(0, 2).join(' | '));

  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  console.log('\n────────────────────────────────────────');
  console.log(`合计：${pass} 通过 / ${fail} 失败 / 共 ${results.length} 项`);
  if (fail) {
    results.filter((r) => !r.pass).forEach((r) => console.log('  - ' + r.name + '  ' + r.extra));
    process.exitCode = 1;
  }
  console.log('────────────────────────────────────────\n');
}

main().catch((e) => {
  console.error('测试异常：', e);
  process.exit(1);
});
