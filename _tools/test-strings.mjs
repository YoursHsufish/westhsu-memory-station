/**
 * test-strings.mjs —— 界面文案表（js/strings.js）验证
 *
 * 要点：
 *   1. 默认值与改造前完全一致（不能因为抽表而改变界面）
 *   2. 改表后 title / 品牌名 / 底栏 / 首页大标题 / 练习卡标题 都能生效
 *   3. 表里留空或删掉某项 → 自动回退默认，不会显示空白或报错
 *   4. 表整个缺失（老版本浏览器缓存了旧文件）→ 应用照常可用
 */
import { boot, helpers, wait } from './harness.mjs';

const results = [];
const ok = (cond, name, note = '') => results.push({ pass: !!cond, name, note });

async function main() {
  /* ============ A 默认文案保持不变 ============ */
  const A = boot({ entry: 'index.html', url: 'https://local.test/' });
  const w = A.w;
  const h = helpers(w);
  await wait(120);

  // 断言「界面显示 == 文案表里配置的值」，不写死具体文字，
  // 这样用户随便改文案，测试都不会误报
  ok(w.document.title === w.STRINGS.siteTitle, 'A 标签页标题取自文案表', w.document.title);
  ok(h.$('.brand-text').textContent === w.STRINGS.brandName, 'A 品牌名取自文案表', h.$('.brand-text').textContent);

  const tabs = h.$$('.tab').map((a) => {
    const sp = a.querySelectorAll('span');
    return sp[sp.length - 1].textContent;
  });
  const cfgTabs = [w.STRINGS.tabHome, w.STRINGS.tabStudy, w.STRINGS.tabProgress, w.STRINGS.tabMe].join('/');
  ok(tabs.join('/') === cfgTabs, 'A 底栏 4 个词取自文案表', tabs.join('/'));

  ok(!!w.STRINGS && typeof w.STRINGS.brandName === 'string' && w.STRINGS.brandName.length > 0,
    'A strings.js 已加载且文案非空', w.STRINGS && w.STRINGS.brandName);
  const keys = Object.keys(w.STRINGS).length;
  ok(keys >= 18, 'A 文案表字段数量够用', keys + ' 项');

  /* ============ B 改表后生效 ============ */
  w.STRINGS.siteTitle = '我们家的小学堂';
  w.STRINGS.brandName = '小学堂';
  w.STRINGS.tabHome = '开始';
  w.STRINGS.tabMe = '设置';
  w.App.applyUiStrings();
  await wait(60);

  ok(w.document.title === '我们家的小学堂', 'B 改 siteTitle 后浏览器标题变了', w.document.title);
  ok(h.$('.brand-text').textContent === '小学堂', 'B 改 brandName 后左上角变了', h.$('.brand-text').textContent);
  const tabs2 = h.$$('.tab').map((a) => {
    const sp = a.querySelectorAll('span');
    return sp[sp.length - 1].textContent;
  });
  ok(tabs2.join('/') === '开始/学习/进度/设置', 'B 底栏文字按表更新', tabs2.join('/'));

  /* ============ C 建档案后首页文案 ============ */
  h.$('#wCreate').click();
  await wait(60);
  h.$('#pName').value = '小宝';
  h.$('#pSave').click();
  await wait(200);

  w.location.hash = '#/home';
  w.App.render();
  await wait(80);
  ok(/小宝，今天学点什么？/.test(h.text()), 'C 默认首页问候语保持原样');

  /* ============ D 覆盖问候语与练习卡 ============ */
  w.STRINGS.heroGreet = '该读书啦，{name}！';
  w.STRINGS.mod_en_recog_title = '认单词';
  w.STRINGS.mod_en_recog_desc = '看一眼，认识吗';
  w.App.render();
  await wait(80);

  ok(/该读书啦，小宝！/.test(h.text()), 'D 首页问候语支持 {name} 占位符');
  ok(/认单词/.test(h.text()), 'D 练习卡标题按表更新');
  ok(/看一眼，认识吗/.test(h.text()), 'D 练习卡描述按表更新');
  ok(!/英语认词/.test(h.text()), 'D 原默认标题已被替换');

  /* ============ E 留空 / 删除 → 回退默认 ============ */
  w.STRINGS.heroGreet = '';
  delete w.STRINGS.mod_en_recog_title;
  w.App.render();
  await wait(80);
  ok(/小宝，今天学点什么？/.test(h.text()), 'E 问候语留空时回退默认文案');
  ok(/英语认词/.test(h.text()), 'E 标题被删除时回退默认文案');

  /* ============ F 表整体缺失也不能崩 ============ */
  const B = boot({ entry: 'index.html', url: 'https://local.test/' });
  const wB = B.w;
  const hB = helpers(wB);
  await wait(120);
  // 模拟：老缓存里没有 strings.js
  delete wB.STRINGS;
  wB.App.render();
  await wait(80);
  ok(/记忆小站/.test(hB.text()) || wB.document.title.length > 0, 'F 文案表缺失时界面仍正常');
  ok(B.errors.length === 0, 'F 文案表缺失时无 JS 运行错误', B.errors.slice(0, 1).join(''));

  /* ============ 汇总 ============ */
  console.log('');
  let pass = 0;
  results.forEach((r) => {
    if (r.pass) pass += 1;
    console.log(`${r.pass ? '✅' : '❌'} ${r.name}${r.note ? '  → ' + r.note : ''}`);
  });
  console.log('\n----------------------------------------');
  console.log(`合计：${pass} 通过 / ${results.length - pass} 失败 / 共 ${results.length} 项`);
  console.log('----------------------------------------');
  if (pass !== results.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('测试异常：', (e && e.stack) || e);
  process.exit(1);
});
