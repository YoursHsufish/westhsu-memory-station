/**
 * test-sync.mjs —— 「把进度搬到云端」页 + 「文本编辑器」页的验证
 *
 * 覆盖：
 *   sync.html  选文件 → 预览统计 → 登录 → 合并上传 → 核对结果
 *   editor.html 输入 / 字数统计 / 草稿自动保存
 */
import { boot, helpers, wait } from './harness.mjs';

const results = [];
const ok = (cond, name, note = '') => results.push({ pass: !!cond, name, note });

/* ---------------- 模拟云服务端 ---------------- */
function makeServer(seed) {
  return { rows: seed || [], calls: [], failNetwork: false, currentUid: null, nextId: 1 };
}

function makeClient(server, uid) {
  const delay = () => new Promise((r) => setTimeout(r, 1));
  const guard = () => {
    if (server.failNetwork) { const e = new Error('Failed to fetch'); e.name = 'TypeError'; throw e; }
  };
  function table() {
    const st = { op: null, filters: {}, payload: null };
    const api = {
      select: () => { st.op = 'select'; return api; },
      order: () => api,
      eq: (k, v) => { st.filters[k] = v; return api; },
      upsert: (rows) => { st.op = 'upsert'; st.payload = rows; return api; },
      delete: () => { st.op = 'delete'; return api; },
      then: (res, rej) => api._exec().then(res, rej)
    };
    api._exec = async () => {
      await delay();
      guard();
      server.calls.push(st.op);
      if (st.op === 'select') {
        return { data: server.rows.filter((r) => r.owner_id === uid).map((r) => ({ ...r })), error: null };
      }
      if (st.op === 'upsert') {
        (st.payload || []).forEach((row) => {
          const e = server.rows.find((r) => r.owner_id === uid && r.kid_key === row.kid_key);
          if (e) Object.assign(e, row);
          else server.rows.push({ id: server.nextId++, owner_id: uid, created_at: new Date().toISOString(), ...row });
        });
        return { data: null, error: null };
      }
      return { data: null, error: null };
    };
    return api;
  }
  return {
    auth: {
      getSession: async () => ({
        data: { session: server.currentUid === uid ? { user: { id: uid, email: 'kid@example.com' } } : null },
        error: null
      }),
      sendOtp: async () => ({ data: { verificationId: 'vid-1', isExistingUser: false }, error: null }),
      verifyOtp: async (p) => {
        server.currentUid = uid;
        // 真实 SDK 的 postForSession 返回的是 { data: session本身 }，没有 session 包裹层
        return { data: { user: { id: uid, email: p.email }, accessToken: 'at-1' }, error: null };
      },
      signOut: async () => { server.currentUid = null; return { error: null }; }
    },
    database: { from: table }
  };
}

const BACKUP = {
  app: 'ebbinghaus-kids',
  schema: 1,
  exportedAt: '2026-10-25T08:00:00.000Z',
  data: {
    v: 1,
    active: 'p1',
    profiles: [
      {
        id: 'p1', name: '娃甲', avatar: '🐻', settings: { grade: 1, textbook: '人教版 PEP' },
        data: {
          en_recog: {
            apple: { s: 1, due: '2026-10-26', c: 1, w: 0, first: '2026-10-25', last: '2026-10-25' },
            pear: { s: 2, due: '2026-10-27', c: 2, w: 1, first: '2026-10-24', last: '2026-10-25' }
          },
          zh_recog: { '人': { s: 3, due: '2026-10-29', c: 3, w: 0, first: '2026-10-23', last: '2026-10-25' } }
        },
        log: { '2026-10-25': { total: 3, correct: 2 } }
      },
      {
        id: 'p2', name: '娃乙', avatar: '🐬', settings: { grade: 5, textbook: '人教版 PEP' },
        data: {
          en_spell: { book: { s: 4, due: '2026-11-01', c: 4, w: 0, first: '2026-10-20', last: '2026-10-25' } }
        },
        log: { '2026-10-25': { total: 1, correct: 1 } }
      }
    ]
  }
};

const SCRIPTS = ['js/srs.js', 'js/store.js', 'js/cloud.js', 'js/sync.js'];

async function main() {
  /* ================= S1 初始状态 ================= */
  const server = makeServer();
  const A = boot({
    entry: 'sync.html',
    scripts: SCRIPTS,
    url: 'https://memory-station.app.workbuddy.host/sync.html',
    mockCloud: () => makeClient(server, 'uA')
  });
  const w = A.w;
  const h = helpers(w);
  await wait(200);

  ok(!!h.$('#drop') && !!h.$('#email'), 'S1 同步页正常渲染');
  ok(h.$('#card2').classList.contains('dim'), 'S1 未选文件时第 2 步不可用');
  ok(h.$('#preview').hidden === true, 'S1 未选文件时不显示预览');
  ok(h.$('#email').value === 'xucong@westair.cn', 'S1 邮箱已预填为指定地址', h.$('#email').value);

  /* ================= S2 选文件 → 预览 ================= */
  const file = new w.File([JSON.stringify(BACKUP)], '记忆小站备份-2026-10-25.json', { type: 'application/json' });
  const input = h.$('#file');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new w.Event('change'));
  await wait(300);

  ok(h.$('#preview').hidden === false, 'S2 读取文件后显示预览');
  const pv = h.$('#preview').textContent.replace(/\s+/g, ' ');
  ok(/2 个档案 \/ 4 张卡片/.test(pv), 'S2 预览统计正确（2 档案 / 4 卡）', pv.slice(-40));
  ok(/娃甲/.test(pv) && /娃乙/.test(pv), 'S2 预览列出两个档案名');
  ok(!h.$('#card2').classList.contains('dim'), 'S2 第 2 步自动解锁');
  ok(h.$('#s1hint').textContent === '已读取', 'S2 第 1 步标记完成');

  /* ================= S3 登录 ================= */
  h.$('#sendBtn').click();
  await wait(200);
  ok(h.$('#codeField').hidden === false, 'S3 点获取验证码后出现验证码输入框');
  ok(h.$('#verifyBtn').hidden === false, 'S3 出现完成登录按钮');

  h.$('#code').value = '123456';
  h.$('#verifyBtn').click();
  await wait(250);
  ok(!h.$('#card3').classList.contains('dim'), 'S3 登录后第 3 步解锁');
  ok(h.$('#s2hint').textContent === '已登录', 'S3 第 2 步标记已登录');
  ok(h.$('#sendBtn').hidden === true, 'S3 登录后隐藏发码按钮');

  /* ================= S4 上传 ================= */
  ok(server.rows.length === 0, 'S4 上传前云端为空');
  h.$('#syncBtn').click();
  await wait(900);

  ok(h.$('#syncDone').hidden === false, 'S4 上传后显示结果面板');
  const done = h.$('#syncDone').textContent.replace(/\s+/g, ' ');
  ok(/已上传到云端/.test(done), 'S4 结果提示上传成功', done.slice(0, 30));
  ok(server.rows.length === 2, 'S4 云端已写入 2 条档案', 'rows=' + server.rows.length);
  ok(server.rows.every((r) => r.owner_id === 'uA'), 'S4 云端行归属当前账号');

  const rowA = server.rows.find((r) => r.kid_name === '娃甲');
  ok(!!rowA, 'S4 档案「娃甲」已上云');
  ok(Object.keys(rowA.cards.en_recog || {}).length === 2, 'S4 英语卡 2 张完整上传',
    Object.keys(rowA.cards.en_recog || {}).length + ' 张');
  ok(Object.keys(rowA.cards.zh_recog || {}).length === 1, 'S4 中文卡 1 张完整上传');
  ok(rowA.cards.en_recog.pear.s === 2 && rowA.cards.en_recog.pear.w === 1,
    'S4 卡片阶段与错次未丢失', 'stage=2 错1');
  ok(rowA.settings.grade === 1, 'S4 年级设置随档案上传', String(rowA.settings.grade));

  const rowB = server.rows.find((r) => r.kid_name === '娃乙');
  ok(!!rowB && Object.keys(rowB.cards.en_spell || {}).length === 1, 'S4 第二个档案也已上云');
  ok(/云端回读\s*2\s*条档案/.test(done), 'S4 结果面板显示云端回读条数');

  const fp = (done.match(/数据指纹\s*([0-9A-F]{8})/) || [])[1];
  ok(!!fp, 'S4 结果面板显示数据指纹', fp);

  ok(/本机档案数\s*0 → 2/.test(done), 'S4 显示本机档案数变化');

  /* ================= S5 身份隔离（换账号看不到） ================= */
  const server2 = makeServer(server.rows);
  server2.currentUid = 'uB';
  const B = boot({
    entry: 'sync.html',
    scripts: SCRIPTS,
    url: 'https://memory-station.app.workbuddy.host/sync.html',
    mockCloud: () => makeClient(server2, 'uB')
  });
  await wait(300);
  const hB = helpers(B.w);
  const resB = await B.w.__mockClient.database.from('kid_profiles').select('*');
  ok((resB.data || []).length === 0, 'S5 另一个账号读不到刚上传的数据');

  /* ================= E1 文本编辑器 ================= */
  const E = boot({ entry: 'editor.html', url: 'https://memory-station.app.workbuddy.host/editor.html' });
  const we = E.w;
  const he = helpers(we);
  await wait(150);

  const ta = he.$('#ta');
  ok(!!ta && !!he.$('#saveBtn'), 'E1 编辑器正常渲染');

  ta.value = '第一行\n第二行\n';
  ta.dispatchEvent(new we.Event('input'));
  await wait(60);
  ok(he.$('#charCount').textContent === '8', 'E1 字符数统计正确', he.$('#charCount').textContent);
  ok(he.$('#lineCount').textContent === '3', 'E1 行数统计正确', he.$('#lineCount').textContent);
  ok(he.$('#stateText').textContent === '未保存', 'E1 未保存状态提示正确', he.$('#stateText').textContent);

  await wait(1000);
  let draft = null;
  try { draft = JSON.parse(we.localStorage.getItem('editor.draft.v1')); } catch (e) {}
  ok(!!draft && draft.text.indexOf('第一行') >= 0, 'E1 停止输入后自动保存草稿');

  // 保存后状态
  ta.value = 'abc';
  ta.dispatchEvent(new we.Event('input'));
  await wait(1200);
  draft = null;
  try { draft = JSON.parse(we.localStorage.getItem('editor.draft.v1')); } catch (e) {}
  ok(!!draft && draft.text === 'abc', 'E1 草稿随输入更新', draft && draft.text);

  ok(E.errors.length === 0, 'E1 编辑器无 JS 运行错误', E.errors.slice(0, 1).join(''));
  ok(A.errors.length === 0, 'S1 同步页无 JS 运行错误', A.errors.slice(0, 1).join(''));

  /* ================= 汇总 ================= */
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
