/**
 * test-auth.mjs —— 登录会话解析的兼容性验证
 *
 * 背景：SDK 的 verifyOtp 内部会走 signIn（老用户）或 signUp（新用户），
 * 两者都经由 postForSession 提交，而 postForSession 返回的是
 * `{ data: 会话对象本身 }`（不是 `{ data: { session } }`）。
 * 早期实现按后者取值，导致「邮件收到了但提示登录未完成」。
 *
 * 这里覆盖多种返回结构，确保无论哪种都能正确建立登录态。
 */
import { boot, wait } from './harness.mjs';

const results = [];
const ok = (cond, name, note = '') => results.push({ pass: !!cond, name, note });

const SCRIPTS = ['js/srs.js', 'js/store.js', 'js/cloud.js'];
const URL_BASE = 'https://memory-station.app.workbuddy.host/sync.html';

const SESSION = { user: { id: 'uA', email: 'xucong@westair.cn' }, accessToken: 'at-1' };

function makeClient(opts) {
  return {
    auth: {
      sendOtp: async () => ({ data: { verificationId: 'vid-1', isExistingUser: !!opts.existing }, error: null }),
      verifyOtp: opts.verifyOtp,
      getSession: opts.getSession || (async () => ({ data: { session: SESSION }, error: null })),
      signOut: async () => ({ error: null })
    },
    database: { from: () => ({ select: () => ({ order: () => ({ then: (r) => Promise.resolve({ data: [], error: null }).then(r) }) }) }) }
  };
}

async function tryLogin(opts) {
  const { w } = boot({ entry: 'sync.html', scripts: SCRIPTS, url: URL_BASE, mockCloud: () => makeClient(opts) });
  await wait(80);
  const pending = { email: 'xucong@westair.cn', verificationId: 'vid-1', isExistingUser: !!opts.existing };
  try {
    const res = await w.Cloud.verifyCode(pending, '123456');
    return { ok: true, status: w.Cloud.status(), res };
  } catch (e) {
    return { ok: false, err: String((e && e.message) || e), w };
  }
}

async function main() {
  /* ===== A 文档示例结构：{ data: { session } } ===== */
  let r = await tryLogin({
    verifyOtp: async () => ({ data: { session: SESSION }, error: null }),
    getSession: async () => ({ data: { session: SESSION }, error: null })
  });
  ok(r.ok && r.status.signedIn, 'A data={session} 结构可登录');
  ok(r.ok && r.res.email === 'xucong@westair.cn', 'A 返回里带上了邮箱');

  /* ===== B 真实 SDK 结构：data 就是会话本身 ===== */
  r = await tryLogin({
    verifyOtp: async () => ({ data: SESSION, error: null }),
    getSession: async () => ({ data: { session: SESSION }, error: null })
  });
  ok(r.ok && r.status.signedIn, 'B data=会话本身（真实 SDK）可登录', r.ok ? '' : r.err);

  /* ===== C 真实结构 + getSession 暂时返回空（落盘稍慢） ===== */
  r = await tryLogin({
    verifyOtp: async () => ({ data: SESSION, error: null }),
    getSession: async () => ({ data: { session: null }, error: null })
  });
  ok(r.ok && r.status.signedIn, 'C getSession 为空时回退用返回值', r.ok ? '' : r.err);

  /* ===== D {session} 结构 + getSession 为空 ===== */
  r = await tryLogin({
    verifyOtp: async () => ({ data: { session: SESSION }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null })
  });
  ok(r.ok && r.status.signedIn, 'D 两种来源都能兜底（取 data.session）', r.ok ? '' : r.err);

  /* ===== E getSession 抛错，但返回值里有会话 ===== */
  r = await tryLogin({
    verifyOtp: async () => ({ data: SESSION, error: null }),
    getSession: async () => { throw new Error('network'); }
  });
  ok(r.ok && r.status.signedIn, 'E getSession 抛错仍能完成登录', r.ok ? '' : r.err);

  /* ===== F 登录态里没有 email 时，回退到记住的邮箱 ===== */
  r = await tryLogin({
    verifyOtp: async () => ({ data: { user: { id: 'uA' }, accessToken: 'at-1' }, error: null }),
    getSession: async () => ({ data: { session: { user: { id: 'uA' } } }, error: null })
  });
  ok(r.ok && r.status.signedIn, 'F user 无 email 时也能登录');
  ok(r.ok && /xucong@westair\.cn/.test(r.status.email), 'F 邮箱回退到本次登录填写的地址', r.ok ? r.status.email : '');

  /* ===== G 确实拿不到会话时要报错（不能假装成功） ===== */
  r = await tryLogin({
    verifyOtp: async () => ({ data: null, error: null }),
    getSession: async () => ({ data: { session: null }, error: null })
  });
  ok(!r.ok, 'G 拿不到会话时明确报错，不假装登录成功');
  ok(!r.ok && /重新发送|再试一次/.test(r.err), 'G 报错文案给出可操作建议', r.ok ? '' : r.err);

  /* ===== H 邮箱已注册的错误翻译 ===== */
  r = await tryLogin({
    verifyOtp: async () => ({ data: null, error: { message: 'user already exists', status: 409 } }),
    getSession: async () => ({ data: { session: null }, error: null })
  });
  ok(!r.ok && /已经注册过|重新发送/.test(r.err), 'H「已注册」错误转成中文可操作提示', r.ok ? '' : r.err);

  /* ===== I 验证码失效的错误翻译 ===== */
  r = await tryLogin({
    verifyOtp: async () => ({ data: null, error: { message: 'verification code expired', status: 400 } }),
    getSession: async () => ({ data: { session: null }, error: null })
  });
  ok(!r.ok && /验证码不对或已过期/.test(r.err), 'I「验证码过期」错误转成中文提示', r.ok ? '' : r.err);

  /* ===== 汇总 ===== */
  console.log('');
  let pass = 0;
  results.forEach((x) => {
    if (x.pass) pass += 1;
    console.log(`${x.pass ? '✅' : '❌'} ${x.name}${x.note ? '  → ' + x.note : ''}`);
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
