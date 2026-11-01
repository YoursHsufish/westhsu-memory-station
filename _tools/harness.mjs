/**
 * harness.mjs —— 用 jsdom 启动真实页面的测试基座
 * 支持三种入口：
 *   index.html（多文件版，手动注入脚本）
 *   记忆小站.html（单文件版，脚本内联，由 jsdom 自行执行）
 * 支持模拟「浏览器禁止写入本地存储」的沙箱/隐私模式
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(process.cwd());
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const FILES_PRE = ['js/meta.js', 'js/strings.js', 'js/data-en.js', 'js/data-zh.js', 'js/data-py.js', 'js/py-dict.js', 'js/audio-manifest.js', 'js/srs.js', 'js/store.js', 'js/speech.js'];
const FILE_CLOUD = 'js/cloud.js';
const FILES_POST = ['js/app.js'];

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function boot(opt = {}) {
  const entry = opt.entry || 'index.html';
  const raw = read(entry);
  // opt.scripts：手动按顺序注入脚本（用于 sync.html 这类没有 app.js 的独立页）
  const manual = Array.isArray(opt.scripts);
  // 容忍资源带版本查询串，如 js/app.js?v=1.4.1
  const single = manual ? false : (raw.indexOf('window.__SINGLE_FILE__') >= 0 || !/src="js\/app\.js[^"]*"/.test(raw));
  const errors = [];

  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e.message + ' :: ' + ((e.detail && e.detail.stack) || '')));

  const html = single ? raw : raw.replace(/<script src="[^"]+"><\/script>/g, '');
  const dom = new JSDOM(html, {
    url: opt.url || 'https://local.test/',
    runScripts: single ? 'dangerously' : 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.confirm = () => true;
      window.alert = () => {};
      // jsdom 没实现 HTMLMediaElement.play()，会往虚拟控制台抛 "Not implemented"；
      // 测试里默认关掉音频通道（正式浏览器里照常走 mp3）。
      if (opt.audio) {
        window.__AUDIO_OFF__ = false;
        window.Audio = opt.audio(window);
      } else {
        window.__AUDIO_OFF__ = true;
      }
      // 额外的注入钩子（测试用假 speechSynthesis 等），放在最后执行
      if (typeof opt.before === 'function') opt.before(window);
      if (opt.userAgent) {
        try {
          Object.defineProperty(window.navigator, 'userAgent', { get: () => opt.userAgent, configurable: true });
        } catch (e) { /* 忽略 */ }
      }
      // 预置 localStorage（测试老存档、损坏存档等场景）
      if (opt.seed) {
        try {
          Object.keys(opt.seed).forEach((k) => window.localStorage.setItem(k, opt.seed[k]));
        } catch (e) { /* 存储被禁用时忽略 */ }
      }
      if (opt.disableStorage) {
        const deny = () => {
          throw new window.DOMException('The operation is insecure.', 'SecurityError');
        };
        Object.defineProperty(window, 'localStorage', { configurable: true, get: deny });
        Object.defineProperty(window, 'sessionStorage', { configurable: true, get: deny });
      }
    }
  });

  const w = dom.window;
  if (manual) {
    if (opt.mockCloud) {
      const client = opt.mockCloud(w);
      w.WorkBuddyCloud = { createWorkBuddyCloud: () => client };
      w.__mockClient = client;
    }
    for (const f of opt.scripts) w.eval(read(f));
  } else if (!single) {
    for (const f of FILES_PRE) w.eval(read(f));
    // 云端 SDK 打桩：必须在 cloud.js 执行前挂到 window 上，loadSDK 才会直接复用它
    if (opt.mockCloud) {
      const client = opt.mockCloud(w);
      w.WorkBuddyCloud = { createWorkBuddyCloud: () => client };
      w.__mockClient = client;
    }
    w.eval(read(FILE_CLOUD));
    for (const f of FILES_POST) w.eval(read(f));
  }
  return { w, errors, single, entry };
}

export function helpers(w) {
  const $ = (sel) => w.document.querySelector(sel);
  const $$ = (sel) => Array.from(w.document.querySelectorAll(sel));
  const click = (sel) => {
    const el = $(sel);
    if (!el) throw new Error('找不到元素：' + sel);
    el.click();
    return el;
  };
  const text = () => (w.document.body.textContent || '').replace(/\s+/g, ' ');
  return { $, $$, click, text };
}
