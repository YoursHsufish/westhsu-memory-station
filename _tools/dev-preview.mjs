/**
 * dev-preview.mjs —— 发布前的本地预览服务（自动登录成管理员）
 *
 * 用法：
 *   node _tools/dev-preview.mjs            # http://127.0.0.1:8787/
 *   node _tools/dev-preview.mjs 9000       # 换端口
 *
 * 它做三件事：
 *   1. 把工程目录当静态站点跑起来（含 assets/audio 的 mp3）；
 *   2. 返回 index.html / admin.html 时，**只在这次响应里**插入
 *      <script src="/_dev/mock-cloud.js">，磁盘上的正式文件不动；
 *   3. /_dev/seed.json 若存在（D:\AIagent\_private\dev-seed.json），
 *      会在预览里当成「云端已有数据」灌进假云端，方便看真实档案。
 *
 * 假云端只在浏览器本机（localStorage）里跑：不联网、不写正式数据库。
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const ROOT = path.resolve(process.cwd());
const PORT = Number(process.argv[2]) || 8787;
const MOCK = path.join(ROOT, '_tools', 'dev', 'mock-cloud.js');
const SEED = path.resolve(ROOT, '..', '_private', 'dev-seed.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

/** 在 cloud.js 之前插入假云端脚本；找不到就插到 </body> 前 */
function inject(html) {
  const tag = '<script src="/_dev/mock-cloud.js"></script>\n';
  if (html.includes('/_dev/mock-cloud.js')) return html;
  const cloudTag = /<script src="js\/cloud\.js[^"]*"><\/script>/;
  if (cloudTag.test(html)) return html.replace(cloudTag, (m) => tag + m);
  return html.replace(/<\/body>/i, () => tag + '</body>');
}

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let pathname = '/';
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
  } catch (e) {
    return send(res, 400, 'bad request');
  }

  // 假云端脚本
  if (pathname === '/_dev/mock-cloud.js') {
    if (!fs.existsSync(MOCK)) return send(res, 404, 'mock-cloud.js 缺失');
    return send(res, 200, fs.readFileSync(MOCK), MIME['.js']);
  }

  // 可选种子数据（导出的备份 JSON）
  if (pathname === '/_dev/seed.json') {
    if (!fs.existsSync(SEED)) return send(res, 404, 'no seed', MIME['.json']);
    return send(res, 200, fs.readFileSync(SEED), MIME['.json']);
  }

  if (pathname === '/') pathname = '/index.html';

  // 防目录穿越
  const file = path.join(ROOT, path.normalize(pathname).replace(/^([/\\])+/, ''));
  if (!file.startsWith(ROOT)) return send(res, 403, 'forbidden');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(res, 404, '404 找不到：' + pathname);
  }

  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';

  if (ext === '.html') {
    const html = fs.readFileSync(file, 'utf8');
    return send(res, 200, inject(html), type);
  }
  return send(res, 200, fs.readFileSync(file), type);
});

server.listen(PORT, '127.0.0.1', () => {
  const base = `http://127.0.0.1:${PORT}`;
  console.log('');
  console.log('  记忆小站 · 本地预览（自动登录管理员，假云端，不会写正式数据）');
  console.log('');
  console.log('    首页      ' + base + '/');
  console.log('    我的      ' + base + '/index.html#/me');
  console.log('    进度      ' + base + '/index.html#/progress');
  console.log('    管理后台  ' + base + '/admin.html');
  console.log('    未登录效果' + base + '/?devloggedout=1');
  console.log('');
  console.log('  种子数据：' + (fs.existsSync(SEED) ? SEED + '（会被灌进假云端）' : '未配置（如需真实档案，把它放到 ' + SEED + '）'));
  console.log('  停止：在这个窗口按 Ctrl+C');
  console.log('');
});
