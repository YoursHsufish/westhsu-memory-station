/**
 * build-single.mjs —— 把多文件工程打包成一个独立 HTML（可直接分发）
 *
 * 用法：node _tools/build-single.mjs
 * 产物：
 *   记忆小站-v<版本号>.html   ← 带版本号，分发用这个
 *   记忆小站.html             ← 同内容的最新版，方便本地双击
 *
 * 版本号 / 作者取自 js/meta.js
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const SCRIPTS = [
  'js/meta.js',
  'js/strings.js',
  'js/data-en.js',
  'js/data-zh.js',
  'js/data-py.js',
  'js/srs.js',
  'js/store.js',
  'js/speech.js',
  'js/cloud.js',
  'js/app.js'
];

/* ---------- 从 meta.js 读版本与作者 ---------- */
const metaSrc = read('js/meta.js');
const pick = (key, fallback = '') => {
  const m = metaSrc.match(new RegExp(key + "\\s*:\\s*'([^']*)'"));
  return m ? m[1] : fallback;
};
const VERSION = pick('version', '0.0.0');
const AUTHOR = pick('author', '');
const LICENSE = pick('license', 'MIT');
const NAME = pick('name', '记忆小站');
const TODAY = new Date().toISOString().slice(0, 10);

let html = read('index.html');

/* ---------- 去掉只在 http 环境下有意义的引用 ---------- */
html = html.replace(/\s*<link rel="manifest"[^>]*>/g, '');
html = html.replace(/\s*<link rel="apple-touch-icon"[^>]*>/g, '');
html = html.replace(/\s*<link rel="icon"[^>]*>/g, '');
html = html.replace(/\s*<meta name="theme-color"[^>]*>/g, '');

/* ---------- 内联 CSS ---------- */
const css = read('css/app.css');
html = html.replace(
  /<link rel="stylesheet" href="css\/app\.css[^"]*" \/>/,
  () => '<style>\n' + css + '\n</style>'
);

/* ---------- 内联 JS（保持顺序），并标记单文件模式 ---------- */
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
const jsBlocks = SCRIPTS.map((f) => {
  let code = read(f);
  if (f === 'js/app.js') {
    code = code.replace(
      "if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0 && !window.__SINGLE_FILE__) {",
      "if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0 && !window.__SINGLE_FILE__) {"
    );
  }
  return '<script>\n/* ===== ' + f + ' ===== */\n' + safe(code) + '\n</script>';
}).join('\n');

html = html.replace(
  /<script src="js\/meta\.js[^"]*"><\/script>[\s\S]*?<script src="js\/app\.js[^"]*"><\/script>/,
  () => '<script>window.__SINGLE_FILE__ = true;</script>\n' + jsBlocks
);

/* ---------- 头部版权与许可声明（MIT 要求保留声明） ---------- */
const header = `<!--
  ============================================================
  ${NAME} v${VERSION} —— 艾宾浩斯遗忘曲线记忆练习
  作者：${AUTHOR}
  许可：${LICENSE} License　${TODAY} 构建
  ------------------------------------------------------------
  本文件是「单文件版」：样式、脚本、词库全部内联，双击即可用，
  不需要任何其它文件。学习数据默认保存在浏览器本地；
  登录云端账号后另有一份同步副本，仅本人账号可见（可选功能，不登录照常可用）。

  第三方开源数据（均为 MIT 许可，版权归原作者）：
    · 《现代汉语常用字表》3500 字 — jinghu-moon/Simplified-Chinese-Characters
      Copyright (c) 2022 jinghu-moon
    · hanziDB 汉字使用频率 — ruddfawcett/hanziDB.csv
      Copyright (c) 2017 Rudd Fawcett
    · chinese-dictionary 汉语字典数据 — mapull/chinese-dictionary
      Copyright (c) 2021 码谱
    · 中华新华字典数据库 — pwxcoo/chinese-xinhua
      Copyright (c) 2018 PWXCOO
    · jieba 中文分词词典（组词词频）— fxsjy/jieba
      Copyright (c) 2013 Sun Junyi
  以上组件均以 MIT 许可证授权，许可全文见 https://opensource.org/licenses/MIT
  本软件仅使用其数据，未修改或再分发其源代码。完整声明见 THIRD-PARTY-NOTICES.md。
  ============================================================
-->`;
html = html.replace('<!DOCTYPE html>', () => '<!DOCTYPE html>\n' + header);

html = html.replace(
  '<title>记忆小站 · 遗忘曲线单词卡</title>',
  () => `<title>${NAME} v${VERSION} · ${AUTHOR}</title>`
);

/* ---------- 输出 ---------- */
const outLatest = path.join(ROOT, '记忆小站.html');
const outVersioned = path.join(ROOT, `记忆小站-v${VERSION}.html`);
fs.writeFileSync(outLatest, html, 'utf8');
fs.writeFileSync(outVersioned, html, 'utf8');

const kb = (fs.statSync(outLatest).size / 1024).toFixed(0);
console.log('已生成：');
console.log('  ' + outLatest + `（${kb} KB）`);
console.log('  ' + outVersioned + `（${kb} KB）← 分发用这个`);
console.log(`  版本 ${VERSION} · 作者 ${AUTHOR}`);
if (/待填写/.test(AUTHOR)) {
  console.log('\n⚠ 提醒：js/meta.js 里的 author 还是占位符，分发前请改成你的名字。');
}
