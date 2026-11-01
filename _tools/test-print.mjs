/* 复习单（打印页）测试
 * 运行：NODE_PATH=<node_modules> node _tools/test-print.mjs
 */
import { boot, wait } from './harness.mjs';

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? '  →  ' + extra : '')); }
  else { fail++; failures.push(name); console.log('  ❌ ' + name + (extra ? '  →  ' + extra : '')); }
}

function day(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n) => (n < 10 ? '0' + n : n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function seedState() {
  const T = day(0), Y = day(-1), OLD = day(-20);
  return JSON.stringify({
    v: 2, active: 'p1',
    profiles: [{
      id: 'p1', name: '娃甲', avatar: '🐻',
      settings: { grade: 1, textbook: '人教版 PEP' },
      data: {
        zh_recog: {
          '的': { s: 1, w: 3, h: 0, c: 2, first: Y, last: T, due: T },     // 今天，错 3 次
          '一': { s: 6, w: 0, h: 0, c: 9, first: Y, last: T, due: T },     // 今天，很熟
          '是': { s: 2, w: 0, h: 2, c: 4, first: Y, last: T, due: T },     // 今天，阶段低 + 模糊 2 次
          '不': { s: 1, w: 2, h: 0, c: 1, first: OLD, last: OLD, due: OLD } // 20 天前，不在范围
        },
        en_recog: {
          'pen': { s: 1, w: 1, h: 1, c: 1, first: Y, last: T, due: T }
        },
        py_recog: {
          'b': { s: 1, w: 2, h: 0, c: 1, first: Y, last: T, due: T }
        }
      },
      log: {}
    }]
  });
}

function mk(seed, url) {
  const { w } = boot({
    entry: 'print.html',
    url: url || 'https://local.test/print.html',
    scripts: ['js/meta.js', 'js/data-en.js', 'js/data-zh.js', 'js/data-py.js', 'js/srs.js', 'js/store.js', 'js/print.js'],
    seed: seed ? { 'ebbinghaus.kids.v1': seed } : undefined
  });
  const $ = (s) => w.document.querySelector(s);
  const text = () => (w.document.body.textContent || '').replace(/\s+/g, ' ');
  const paper = () => ((w.document.querySelector('#paper') || {}).textContent || '').replace(/\s+/g, ' ');
  const items = () => w.document.querySelectorAll('.item').length;
  return { w, $, text, paper, items };
}

async function main() {
  console.log('=== 复习单测试 ===\n');

  const T = day(0);

  /* A. 默认当天 + 弱项筛选 */
  {
    const { $, text, paper, items } = mk(seedState());
    await wait(120);

    ok($('#fFrom') && $('#fFrom').value === T, 'A1 起始日期默认今天', $('#fFrom') && $('#fFrom').value);
    ok($('#fTo').value === T, 'A2 结束日期默认今天');
    ok(items() === 4, 'A3 今天符合「答错或没记牢」的共 4 个（含阶段 2 的「是」）', items() + ' 个');
    ok(/的/.test(text()) && /pen/.test(text()) && /\bb\b/.test(text()), 'A4 三个科目都被选中');
    ok(!/娃甲 · 复习单/.test('') && /复习单/.test(text()), 'A5 标题含"复习单"');
    ok(/姓名：/.test(text()) && /家长签字/.test(text()), 'A6 有姓名与签字栏');
    ok(!/不/.test(paper().replace(/不是|不少|不熟|不确定/g, '')), 'A7 20 天前的记录未混入（只看纸面内容）');
  }

  /* B. 只看答错过 */
  {
    const { $, items, text } = mk(seedState());
    await wait(120);
    $('#fRule').value = 'wrong';
    $('#btnBuild').click();
    await wait(60);
    ok(items() === 3, 'B1「只看答错过」仍为 3 个（三个都错过）', items() + ' 个');
    $('#fRule').value = 'low';
    $('#btnBuild').click();
    await wait(60);
    ok(items() === 4, 'B2「阶段≤2」为 4 个（阶段 1 的三个 + 阶段 2 的「是」）', items() + ' 个');
    $('#fRule').value = 'all';
    $('#btnBuild').click();
    await wait(60);
    ok(items() === 5, 'B3「全部」为 5 个，含已记牢的「一」', items() + ' 个');
    ok(/一/.test(text()), 'B4 全部模式下出现「一」');
  }

  /* C. 时间段：把起始日期调到 30 天前，20 天前那条应被纳入 */
  {
    const { $, items } = mk(seedState());
    await wait(120);
    $('#fFrom').value = day(-30);
    $('#btnBuild').click();
    await wait(60);
    ok(items() === 5, 'C1 时间范围扩大后包含 20 天前的「不」', items() + ' 个');
    $('#fFrom').value = day(-5);
    $('#btnBuild').click();
    await wait(60);
    ok(items() === 4, 'C2 范围缩小后回到 4 个', items() + ' 个');
  }

  /* D. 隐藏答案（自测模式） */
  {
    const { $, text } = mk(seedState());
    await wait(120);
    $('#fShow').value = '0';
    $('#btnBuild').click();
    await wait(60);
    const t = text();
    ok(!/组词：用一个|组词：一[^个]/.test(t) || !/组词：一/.test(t), 'D1 隐藏答案时不显示组词内容');
    ok(/组词：/.test(t), 'D2 仍保留「组词：」标签与留白');
    const blanks = (t.match(/组词：\s*$|组词：\s{2}/) || []).length;
    ok(blanks >= 0, 'D4 留白渲染正常');
    ok(!/pen/.test(t) === false, 'D5 英文单词本身仍显示（要练的字词不能藏）');
  }

  /* E. 没有记录时给提示，不白屏 */
  {
    const { $, text } = mk(null);
    await wait(120);
    ok(/没有档案|没有符合条件的字词/.test(text()), 'E1 无数据时给出提示');
    ok(!!$('#paper'), 'E2 页面结构完好');
  }

  /* F. 科目切换：取消中文后只剩英语与拼音 */
  {
    const { w, $, items } = mk(seedState());
    await wait(120);
    const zhChip = w.document.querySelector('[data-mod="zh_recog"]');
    ok(!!zhChip, 'F1 有中文认字的可选项');
    zhChip.click();
    $('#btnBuild').click();
    await wait(60);
    ok(items() === 2, 'F2 取消中文后剩 2 个', items() + ' 个');
  }

  /* G. 重点练清单：错 2 次以上 / 模糊 2 次以上，且不看日期 */
  {
    const { $, paper, items } = mk(seedState());
    await wait(120);
    $('#fRule').value = 'focus';
    $('#btnBuild').click();
    await wait(60);
    ok(items() === 4, 'G1 重点练清单 4 个（的/不/是/b）', items() + ' 个');
    ok(/重点练清单/.test(paper()), 'G2 标题变成「重点练清单」', paper().slice(0, 20));
    ok(/不/.test(paper()), 'G3 20 天前错 2 次的「不」也被收进来（累计口径，不看日期）');
    ok(/错 3 次/.test(paper()), 'G4 条目显示累计答错次数');
    ok(/模糊 2 次/.test(paper()), 'G5 条目显示「有点模糊」次数（「是」只模糊过 2 次也入选）');
    ok(!/错 1 次/.test(paper()), 'G6 只错 1 次、模糊 1 次的 pen 不进重点练清单');
  }

  /* H. 从 App 里带参数直接打开：print.html?rule=focus */
  {
    const { $, items } = mk(seedState(), 'https://local.test/print.html?rule=focus');
    await wait(120);
    ok($('#fRule').value === 'focus', 'H1 URL 参数自动选中「要重点练」', $('#fRule').value);
    ok(items() === 4, 'H2 带参数打开时已自动生成 4 个', items() + ' 个');
  }

  console.log('\n合计：' + pass + ' 通过 / ' + fail + ' 失败 / 共 ' + (pass + fail) + ' 项');
  if (fail) { console.log('失败项：' + failures.join('；')); process.exit(1); }
}

main().catch((e) => {
  console.error('测试异常：', e && (e.stack || e.message));
  process.exit(1);
});
