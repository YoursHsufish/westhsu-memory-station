/**
 * test-migrate.mjs —— 「换浏览器搬存档」端到端验证
 *   模拟：Edge 里学习 → 导出 JSON → 在 360 极速（全新环境）里导入 → 进度完全一致
 * 运行：NODE_PATH=<node_modules> node _tools/test-migrate.mjs
 */
import { boot, helpers, wait } from './harness.mjs';

const UA_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0';
const UA_360EE = 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36 QIHU 360EE';
const UA_360SE = 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36 QIHU 360SE';
const UA_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const results = [];
function ok(cond, name, extra = '') {
  results.push({ name, pass: !!cond, extra });
  console.log((cond ? '   ✅ ' : '   ❌ ') + name + (extra ? '  → ' + extra : ''));
}

async function learn(w, mode, times) {
  const { $, click } = helpers(w);
  w.App.startSession([mode]);
  await wait(80);
  for (let i = 0; i < times; i++) {
    if (!$('#btnYes')) break;
    click('#btnYes');
    await wait(40);
    if ($('#btnEasy')) click('#btnEasy');
    await wait(950);
  }
  if ($('#sClose')) click('#sClose');
  await wait(100);
}

async function main() {
  console.log('\n════════ 换浏览器搬存档 · 端到端测试 ════════\n');

  /* ---------- Edge 里学习 ---------- */
  const A = boot({ entry: 'index.html', userAgent: UA_EDGE });
  const wA = A.w;
  const { $, click } = helpers(wA);

  ok(wA.App.browserName() === 'Microsoft Edge', '① 正确识别 Edge', wA.App.browserName());

  click('#wCreate');
  await wait(50);
  $('#pName').value = '许小宝';
  click('#gradePicker [data-grade="2"]');
  await wait(20);
  click('#pSave');
  await wait(150);

  wA.Store.updateSettings(wA.Store.activeProfile().id, { newEn: 4, newZh: 4, ttsAuto: false });
  await learn(wA, 'en_recog', 3);
  await learn(wA, 'zh_recog', 2);

  const edgeInfo = wA.Store.storageInfo();
  const edgeProfile = wA.Store.activeProfile();
  const edgeName = edgeProfile.name;
  const edgeGrade = edgeProfile.settings.grade;
  const edgeCards = edgeInfo.cards;
  const edgeRec = JSON.parse(JSON.stringify(wA.Store.allRecs('en_recog')));
  const edgeLogDays = Object.keys(edgeProfile.log).length;

  ok(edgeCards > 0, '① Edge 里已经有学习记录', edgeCards + ' 张卡片');
  ok(edgeGrade === 2, '① 年级设置已保存', 'grade=' + edgeGrade);

  const dump = wA.Store.exportAll();
  ok(dump.length > 200, '① 导出的备份文件有内容', (dump.length / 1024).toFixed(1) + ' KB');

  /* ---------- 360 极速（全新环境）导入 ---------- */
  const B = boot({ entry: '记忆小站.html', userAgent: UA_360EE });   // 用实际分发的单文件版
  const wB = B.w;
  const hB = helpers(wB);

  ok(wB.App.browserName() === '360 极速浏览器', '② 正确识别 360 极速', wB.App.browserName());
  ok(wB.Store.listProfiles().length === 0, '② 新浏览器里一开始没有档案（模拟真实情况）');
  ok(!!hB.$('#wImport'), '② 欢迎页就有「从备份导入」入口（不用先建空档案）');
  ok(/先给小朋友建个档案吧/.test(hB.text()), '② 新浏览器里显示欢迎页');

  const res = wB.Store.importAll(dump);
  wB.App.render();
  await wait(80);

  wB.location.hash = '#/me';
  wB.App.render();
  await wait(80);
  ok(/360 极速浏览器/.test(hB.text()), '② 导入后存档页显示当前浏览器，便于确认没在错的环境里操作');
  ok(!!hB.$('#btnMigrate'), '② 存档页有「换浏览器 / 换电脑？」入口');

  ok(res.profiles === 1, '③ 导入识别到 1 个档案', JSON.stringify(res));
  ok(res.cards === edgeCards, '③ 卡片数量与旧浏览器一致', res.cards + ' / ' + edgeCards);
  ok(wB.Store.listProfiles().length === 1, '③ 新浏览器里出现该档案');

  const bProfile = wB.Store.activeProfile();
  ok(bProfile && bProfile.name === edgeName, '③ 档案名字一致', bProfile && bProfile.name);
  ok(bProfile.settings.grade === edgeGrade, '③ 年级设置一致', 'grade=' + bProfile.settings.grade);

  const bRec = wB.Store.allRecs('en_recog');
  let matched = 0;
  let dueMatched = 0;
  Object.keys(edgeRec).forEach((k) => {
    if (bRec[k]) {
      matched += 1;
      if (bRec[k].due === edgeRec[k].due && bRec[k].s === edgeRec[k].s) dueMatched += 1;
    }
  });
  ok(matched === Object.keys(edgeRec).length, '③ 英语记录条数一致', matched + '/' + Object.keys(edgeRec).length);
  ok(dueMatched === matched, '③ 每张卡的阶段与复习日期都一致', dueMatched + ' 张');
  ok(Object.keys(bProfile.log).length === edgeLogDays, '③ 学习日志（打卡记录）一致', edgeLogDays + ' 天');

  // 导入后能继续学习
  await learn(wB, 'en_recog', 1);
  ok(Object.keys(wB.Store.allRecs('en_recog')).length >= matched, '④ 导入后可以继续正常学习');

  /* ---------- 重复导入不会翻倍 ---------- */
  const res2 = wB.Store.importAll(dump);
  wB.App.render();
  await wait(60);
  ok(wB.Store.listProfiles().length === 1, '⑤ 重复导入不会新建重复档案', '档案数=' + wB.Store.listProfiles().length);
  ok(res2.merged === 1, '⑤ 同名档案走「合并」而不是新增', 'merged=' + res2.merged);
  ok(wB.Store.listProfiles()[0].name === edgeName, '⑤ 合并后档案没被改名');

  /* ---------- 没有档案时导入也能自动激活 ---------- */
  const C = boot({ entry: '记忆小站.html', userAgent: UA_360SE });
  ok(C.w.App.browserName() === '360 安全浏览器', '⑥ 正确识别 360 安全浏览器');
  C.w.Store.importAll(dump);
  C.w.App.render();
  await wait(60);
  ok(!!C.w.Store.activeProfile(), '⑥ 空档案导入后会自动选中该小朋友', C.w.Store.activeProfile() && C.w.Store.activeProfile().name);
  ok(/今天学点什么/.test(C.w.document.body.textContent), '⑥ 导入后直接进入首页（不是欢迎页）');

  /* ---------- 其它浏览器识别 ---------- */
  const D = boot({ entry: 'index.html', userAgent: UA_CHROME });
  ok(D.w.App.browserName() === 'Chrome', '⑦ 识别 Chrome', D.w.App.browserName());

  const allErr = [].concat(A.errors, B.errors, C.errors, D.errors);
  ok(allErr.length === 0, '⑧ 全程无 JS 运行错误', allErr.slice(0, 2).join(' | '));

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
  console.error('测试异常：', (e && (e.stack || e.message)) || e);
  process.exit(1);
});
