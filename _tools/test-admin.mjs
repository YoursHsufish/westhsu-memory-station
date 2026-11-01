/* 管理后台测试：权限校验、数据展示、添加账号
 * 运行：NODE_PATH=<node_modules> node _tools/test-admin.mjs
 */
import { boot, wait } from './harness.mjs';
import { createRequire } from 'node:module';

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? '  →  ' + extra : '')); }
  else { fail++; failures.push(name); console.log('  ❌ ' + name + (extra ? '  →  ' + extra : '')); }
}

const ADMIN = 'xucong@westair.cn';
const ADMIN_UID = '2114312933574971392';

/** 可编程的假服务端 */
function makeServer() {
  return {
    currentUser: null,
    writes: [],
    db: {
      app_accounts: [
        { uid: ADMIN_UID, email: ADMIN, last_seen: '2026-11-01T10:00:00Z' },
        { uid: '2114300000000000001', email: 'friend@example.com', last_seen: '2026-11-01T09:00:00Z' }
      ],
      app_events: [
        { id: 1, uid: ADMIN_UID, email: ADMIN, kind: 'login', at: '2026-11-01T10:00:00Z', detail: {} },
        { id: 2, uid: ADMIN_UID, email: ADMIN, kind: 'login', at: '2026-11-01T11:00:00Z', detail: {} },
        { id: 3, uid: ADMIN_UID, email: ADMIN, kind: 'practice', at: '2026-11-01T11:10:00Z', detail: { cards: 20, correct: 15 } },
        { id: 4, uid: '2114300000000000001', email: 'friend@example.com', kind: 'login', at: '2026-11-01T09:00:00Z', detail: {} },
        { id: 5, uid: '2114300000000000001', email: 'friend@example.com', kind: 'practice', at: '2026-11-01T09:20:00Z', detail: { cards: 30, correct: 20 } }
      ],
      kid_profiles: [
        { kid_key: 'k1', kid_name: '楼贵', avatar: '🐻', owner_id: ADMIN_UID, cards: { zh_recog: { a: 1, b: 2, c: 3 } }, settings: {}, log: {}, updated_at: '2026-11-01T11:10:00Z' },
        { kid_key: 'k2', kid_name: '馨忆', avatar: '🐬', owner_id: ADMIN_UID, cards: { en_recog: { a: 1 } }, settings: {}, log: {}, updated_at: '2026-10-31T20:00:00Z' },
        { kid_key: 'k3', kid_name: '娃丙', avatar: '🐣', owner_id: '2114300000000000001', cards: { en_recog: { a: 1, b: 2 } }, settings: {}, log: {}, updated_at: '2026-11-01T09:20:00Z' }
      ],
      app_invites: [
        { id: 1, email: 'new@example.com', kid_name: '娃丁', grade: 2, created_at: '2026-11-01T08:00:00Z', claimed_at: null }
      ]
    }
  };
}

function mockCloud(server) {
  return () => ({
    auth: {
      sendOtp: async ({ email }) => ({ data: { verificationId: 'v-' + email, isExistingUser: true }, error: null }),
      verifyOtp: async (p) => {
        server.currentUser = p.email === ADMIN
          ? { id: ADMIN_UID, email: ADMIN }
          : { id: 'needhelp', email: p.email };
        return { data: { user: server.currentUser }, error: null };
      },
      getSession: async () => ({ data: { session: server.currentUser ? { user: server.currentUser } : null }, error: null }),
      signOut: async () => { server.currentUser = null; return { error: null }; }
    },
    database: {
      from(table) {
        return {
          select: async () => ({ data: (server.db[table] || []).slice(), error: null }),
          upsert: async (rows) => { server.writes.push({ table, rows }); return { data: rows, error: null }; },
          insert: async (rows) => { server.writes.push({ table, rows }); return { data: rows, error: null }; }
        };
      }
    }
  });
}

function mk(server) {
  const { w } = boot({
    entry: 'admin.html',
    scripts: ['js/meta.js', 'js/cloud.js', 'js/admin.js'],
    mockCloud: mockCloud(server)
  });
  const $ = (s) => w.document.querySelector(s);
  const text = () => (w.document.body.textContent || '').replace(/\s+/g, ' ');
  return { w, $, text };
}

async function main() {
  console.log('=== 管理后台测试 ===\n');

  /* A. 非管理员登录被拒绝 */
  {
    const server = makeServer();
    const { $, text, w } = mk(server);
    await wait(80);
    ok(!!$('#aEmail'), 'A1 未登录时显示管理员登录表单');
    ok(/仅管理员可访问/.test(text()), 'A2 页面标明仅管理员可用');

    $('#aEmail').value = 'friend@example.com';
    $('#aSend').click();
    await wait(60);
    ok(!!$('#aCode'), 'A3 点获取验证码后出现验证码输入框');

    $('#aCode').value = '123456';
    $('#aVerify').click();
    await wait(120);
    ok(/不是管理员/.test(text()), 'A4 非管理员登录后被拒绝并提示', (text().match(/当前邮箱[^，]*/) || [''])[0]);
    ok(!/概览/.test(text()), 'A5 非管理员看不到任何数据');
    ok(server.currentUser === null, 'A6 非管理员被自动退出登录');
    ok(!server.writes.some((x) => x.table === 'app_invites'), 'A7 非管理员无法写入');
    void w;
  }

  /* B. 管理员登录后看数据 */
  {
    const server = makeServer();
    const { $, text } = mk(server);
    await wait(80);

    $('#aSend').click();
    await wait(60);
    $('#aCode').value = '123456';
    $('#aVerify').click();
    await wait(300);

    ok(/概览/.test(text()), 'B1 管理员登录后出现概览');
    ok(/注册账号/.test(text()), 'B2 概览含注册账号数');
    ok(/2\s*注册账号/.test(text()), 'B3 注册账号数正确为 2', (text().match(/(\d+)\s*注册账号/) || [''])[0]);
    ok(/3\s*小朋友档案/.test(text()), 'B4 档案数正确为 3', (text().match(/(\d+)\s*小朋友档案/) || [''])[0]);
    ok(/6\s*累计卡片记录/.test(text()), 'B5 卡片总数正确为 6（3+1+2）', (text().match(/(\d+)\s*累计卡片记录/) || [''])[0]);
    ok(/2\s*累计练习组数/.test(text()), 'B6 练习组数正确为 2', (text().match(/(\d+)\s*累计练习组数/) || [''])[0]);

    ok(/friend@example\.com/.test(text()), 'B7 账号列表显示对方邮箱');
    ok(/楼贵/.test(text()) && /馨忆/.test(text()), 'B8 账号列表显示小朋友昵称');
    ok(/不保存任何密码/.test(text()), 'B9 页面明确说明系统不存密码');

    ok(/登录记录/.test(text()), 'B10 有登录记录区块');
    ok(/使用频次/.test(text()), 'B11 有使用频次区块');
    const rows = ($('#admBody').querySelectorAll('.adm-table tr') || []).length;
    ok(rows >= 6, 'B12 各表格渲染出数据行', '共 ' + rows + ' 行');
    ok(/待领取/.test(text()), 'B13 邀请列表显示「待领取」状态');
  }

  /* C. 添加账号 */
  {
    const server = makeServer();
    const { $, text } = mk(server);
    await wait(80);
    $('#aSend').click(); await wait(60);
    $('#aCode').value = '123456';
    $('#aVerify').click(); await wait(300);

    ok(!!$('#invEmail'), 'C1 有添加账号表单');

    $('#invEmail').value = 'bad-email';
    $('#invName').value = '娃戊';
    $('#invAdd').click();
    await wait(60);
    ok(/邮箱格式不对/.test(text()), 'C2 邮箱格式错误被拦下');

    $('#invEmail').value = 'kid2@example.com';
    $('#invName').value = '娃戊';
    $('#invGrade').value = '3';
    $('#invAdd').click();
    await wait(120);

    const w0 = server.writes.filter((x) => x.table === 'app_invites');
    ok(w0.length === 1, 'C3 提交后写入 app_invites', JSON.stringify(w0[0] && w0[0].rows));
    const row = w0[0] && w0[0].rows[0];
    ok(row && row.email === 'kid2@example.com' && row.kid_name === '娃戊' && Number(row.grade) === 3,
      'C4 写入内容与表单一致');
    ok(/已添加/.test(text()), 'C5 成功后给出提示');
  }

  /* D. 云端不可用时不白屏 */
  {
    const { w } = boot({ entry: 'admin.html', scripts: ['js/meta.js', 'js/cloud.js', 'js/admin.js'] });
    await wait(80);
    const t = (w.document.body.textContent || '').replace(/\s+/g, ' ');
    ok(/只能在发布后的线上地址打开|管理员登录/.test(t), 'D1 无云端环境时给出说明或登录页，不白屏');
  }

  console.log('\n合计：' + pass + ' 通过 / ' + fail + ' 失败 / 共 ' + (pass + fail) + ' 项');
  if (fail) { console.log('失败项：' + failures.join('；')); process.exit(1); }
}

main().catch((e) => {
  console.error('测试异常：', e && (e.stack || e.message));
  process.exit(1);
});
