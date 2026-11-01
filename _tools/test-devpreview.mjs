/* 本地预览「自动登录」测试
 *
 * 验证 _tools/dev/mock-cloud.js 能让页面一打开就是「管理员已登录」，
 * 并且所有云端读写只落在本机沙箱（ebbinghaus.kids.devcloud），不碰正式数据。
 *
 * 运行：NODE_PATH=<node_modules> node _tools/test-devpreview.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { boot, wait, helpers } from './harness.mjs';

const ROOT = path.resolve(process.cwd());
const MOCK_SRC = fs.readFileSync(path.join(ROOT, '_tools/dev/mock-cloud.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? '  →  ' + extra : '')); }
  else { fail++; failures.push(name); console.log('  ❌ ' + name + (extra ? '  →  ' + extra : '')); }
}

const ADMIN_EMAIL = 'xucong@westair.cn';
const ADMIN_UID = '2114312933574971392';
const DB_KEY = 'ebbinghaus.kids.devcloud';

/** 起一个页面：先执行假云端，再让 cloud.js 复用它 */
function bootWithMock(opts = {}) {
  let instance = null;
  const { w, errors } = boot({
    entry: opts.entry || 'index.html',
    url: opts.url || 'http://127.0.0.1:8787/',
    seed: opts.seed,
    // 管理后台只加载 meta/cloud/admin，用脚本清单模式
    scripts: opts.entry === 'admin.html'
      ? ['js/meta.js', 'js/cloud.js', 'js/admin.js']
      : undefined,
    mockCloud: (win) => {
      win.eval(MOCK_SRC);
      instance = win.WorkBuddyCloud.createWorkBuddyCloud({});
      return instance;
    }
  });
  return { w, errors, client: instance, api: helpers(w) };
}

function devDb(w) {
  try { return JSON.parse(w.localStorage.getItem(DB_KEY) || '{}'); } catch (e) { return {}; }
}

async function main() {
  console.log('=== 本地预览自动登录测试 ===\n');

  /* ---------------- A. 打开即已登录 ---------------- */
  {
    const { w, errors } = bootWithMock();
    await wait(200);

    const st = w.Cloud.status();
    ok(w.__DEV_MOCK_CLOUD__ === true, 'A1 假云端已挂上（__DEV_MOCK_CLOUD__）');
    ok(st.signedIn === true, 'A2 打开就是已登录状态');
    ok(st.email === ADMIN_EMAIL, 'A3 身份是管理员邮箱', st.email);
    ok(w.Cloud.currentUid() === ADMIN_UID, 'A4 uid 是管理员 uid', w.Cloud.currentUid());
    ok(st.state === 'synced', 'A5 同步状态为 synced（走完了 pull+push）', st.state);

    const bar = w.document.getElementById('devPreviewBar');
    ok(!!bar, 'A6 顶部有「本地预览」提示条');
    const bt = (bar && bar.textContent) || '';
    ok(/本地预览/.test(bt), 'A7 提示条写明是本地预览');
    ok(bt.indexOf(ADMIN_EMAIL) >= 0, 'A8 提示条显示已登录的管理员邮箱');
    ok(/不会写正式数据/.test(bt), 'A9 提示条说明不会写正式数据');
    ok(errors.length === 0, 'A10 无 JS 运行错误', errors.slice(0, 1).join(''));
  }

  /* ---------------- B. 云端读写只落本机沙箱 ---------------- */
  {
    const { w } = bootWithMock();
    await wait(200);
    const p = w.Store.createProfile('预览娃', '🐻');
    await wait(30);
    await w.Cloud.flushPush();
    await wait(60);

    const db = devDb(w);
    const rows = db.kid_profiles || [];
    ok(rows.length === 1, 'B1 推送落到沙箱表 kid_profiles', rows.length + ' 行');
    ok(rows[0] && rows[0].kid_key === p.id, 'B2 行里的 kid_key 是本地档案 id', rows[0] && rows[0].kid_key);
    ok(rows[0] && rows[0].owner_id === ADMIN_UID, 'B3 行归属管理员 uid', rows[0] && rows[0].owner_id);
    ok(rows[0] && rows[0].kid_name === '预览娃', 'B4 档案名一起上去了');

    const n = await w.Cloud.countRemote();
    ok(n === 1, 'B5 从「云端」读回来也是 1 行', n + ' 行');

    // 再推一次同一个档案：应该 upsert 而不是新增
    await w.Cloud.flushPush();
    await wait(50);
    const rows2 = devDb(w).kid_profiles || [];
    ok(rows2.length === 1, 'B6 重复推送是 upsert，不产生重复行', rows2.length + ' 行');
  }

  /* ---------------- C. 会话持久化：刷新后仍登录 ---------------- */
  {
    const seed = {};
    {
      const { w } = bootWithMock();
      await wait(150);
      seed[DB_KEY] = w.localStorage.getItem(DB_KEY) || '{}';
      seed['ebbinghaus.kids.devcloud.session'] = '1';
    }
    const { w } = bootWithMock({ seed });
    await wait(200);
    ok(w.Cloud.status().signedIn === true, 'C1 重新打开（同一份 localStorage）仍是登录状态');

    const st2 = await w.Cloud.restore();
    ok(st2 === true, 'C2 Cloud.restore() 直接成功，不需要验证码');
  }

  /* ---------------- D. 可以手动看未登录效果 ---------------- */
  {
    const { w } = bootWithMock({ url: 'http://127.0.0.1:8787/?devloggedout=1' });
    await wait(250);
    const st = w.Cloud.status();
    ok(st.signedIn === false, 'D1 带 devloggedout=1 时是未登录');
    const bt = (w.document.getElementById('devPreviewBar') || {}).textContent || '';
    ok(/未登录/.test(bt), 'D2 提示条相应显示未登录', bt.slice(0, 40));
  }

  /* ---------------- E. 管理后台也走假云端 ---------------- */
  {
    const { w, errors } = bootWithMock({ entry: 'admin.html', url: 'http://127.0.0.1:8787/admin.html' });
    await wait(300);
    ok(w.Cloud.status().signedIn === true, 'E1 管理后台打开即已登录');
    const t = (w.document.body.textContent || '').replace(/\s+/g, ' ');
    ok(t.length > 0 && !/^\s*$/.test(t), 'E2 管理后台有内容渲染，不白屏');
    ok(errors.length === 0, 'E3 管理后台无 JS 运行错误', errors.slice(0, 1).join(''));
  }

  /* ---------------- F. 假云端没有碰真实网络 ---------------- */
  {
    const { w } = bootWithMock();
    await wait(150);
    ok(!!w.WorkBuddyCloud && typeof w.WorkBuddyCloud.createWorkBuddyCloud === 'function',
      'F1 loadSDK 直接复用假云端，不会去 CDN 拉 SDK');
    const st = w.Cloud.status();
    ok(st.endpoint.indexOf('/api/cloud') > 0, 'F2 端点是本地代理路径（正式站不变）', st.endpoint);
  }

  console.log('\n合计：' + pass + ' 通过 / ' + fail + ' 失败 / 共 ' + (pass + fail) + ' 项');
  if (fail) { console.log('失败项：' + failures.join('；')); process.exit(1); }
}

main().catch((e) => {
  console.error('测试异常：', e && (e.stack || e.message));
  process.exit(1);
});
