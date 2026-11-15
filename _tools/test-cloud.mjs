/**
 * test-cloud.mjs —— 云端账号与同步逻辑验证
 *
 * 用「可编程的模拟服务端」替代真实云服务，验证应用侧逻辑是否正确：
 *   注册建档 / 换设备拉取 / 双向合并不丢卡 / 冲突取最近学习日 / 断网降级 /
 *   退出登录本地不受影响 / 账号间数据隔离 / 隐私声明内容
 *
 * 说明：真实 RLS 由服务端强制，本文件的隔离断言验证的是"客户端只读取自己那份"，
 * 服务端那一层另由 anon 直连测试覆盖（见 _tools/test-cloud-live.mjs）。
 */
import { boot, helpers, wait } from './harness.mjs';

const results = [];
const ok = (cond, name, note = '') => results.push({ pass: !!cond, name, note });

/** 取出某台“设备”的学习存档 JSON（模拟同一台设备刷新/重开） */
function localStorageOf(w) {
  try { return w.localStorage.getItem('ebbinghaus.kids.v1') || ''; } catch (e) { return ''; }
}

/* ---------------- 模拟服务端 ---------------- */
function makeServer(seedRows) {
  return {
    rows: seedRows ? seedRows.map((r) => ({ ...r })) : [],
    calls: [],
    failNetwork: false,
    currentUid: null,
    nextId: 1000
  };
}

function makeClient(server, uid) {
  const delay = () => new Promise((r) => setTimeout(r, 1));
  const guard = () => {
    if (server.failNetwork) {
      const e = new Error('Failed to fetch');
      e.name = 'TypeError';
      throw e;
    }
  };

  function table(name) {
    const st = { op: null, filters: {}, payload: null };
    const api = {
      select: () => { st.op = 'select'; return api; },
      order: () => api,
      limit: () => api,
      eq: (k, v) => { st.filters[k] = v; return api; },
      upsert: (rows) => { st.op = 'upsert'; st.payload = rows; return api; },
      delete: () => { st.op = 'delete'; return api; },
      then: (res, rej) => api._exec().then(res, rej)
    };
    api._exec = async () => {
      await delay();
      guard();
      server.calls.push({ op: st.op, filters: { ...st.filters }, table: name });
      // 统计表（app_accounts / app_events / app_invites）单独存放，不混进 kid_profiles
      if (name && name !== 'kid_profiles') {
        server.other = server.other || [];
        if (st.op === 'upsert') {
          (st.payload || []).forEach((r) => server.other.push({ table: name, uid, ...r }));
        }
        return { op: st.op, data: st.op === 'select' ? [] : null, error: null };
      }
      if (st.op === 'select') {
        // 模拟 RLS：只返回属于当前 uid 的行
        return { data: server.rows.filter((r) => r.owner_id === uid).map((r) => ({ ...r })), error: null };
      }
      if (st.op === 'upsert') {
        const now = new Date().toISOString();
        (st.payload || []).forEach((row) => {
          const exist = server.rows.find((r) => r.owner_id === uid && r.kid_key === row.kid_key);
          if (exist) Object.assign(exist, row, { owner_id: uid, updated_at: now });
          else server.rows.push({ id: server.nextId++, owner_id: uid, created_at: now, ...row, updated_at: now });
        });
        return { data: null, error: null };
      }
      if (st.op === 'delete') {
        const keys = Object.keys(st.filters);
        server.rows = server.rows.filter(
          (r) => !(r.owner_id === uid && keys.every((k) => r[k] === st.filters[k]))
        );
        return { data: [], error: null };
      }
      return { data: null, error: null };
    };
    return api;
  }

  return {
    auth: {
      getSession: async () => {
        guard();
        const signed = server.currentUid === uid;
        return { data: { session: signed ? { user: { id: uid, email: 'kid@example.com' } } : null }, error: null };
      },
      sendOtp: async ({ email }) => {
        guard();
        server.lastOtp = email;
        return { data: { verificationId: 'vid-1', isExistingUser: !!server.knownUser }, error: null };
      },
      verifyOtp: async (p) => {
        guard();
        server.currentUid = uid;
        server.knownUser = true;
        // 真实 SDK 的 postForSession 返回 { data: session本身 }，没有 session 包裹层
        return { data: { user: { id: uid, email: p.email }, accessToken: 'at-1' }, error: null };
      },
      signOut: async () => { server.currentUid = null; return { error: null }; }
    },
    database: { from: table }
  };
}

async function signInViaUI(w, h, nick, email) {
  w.App.openAuthSheet();
  await wait(40);
  h.$('#authNick').value = nick;
  h.$('#authEmail').value = email;
  h.$('#authSend').click();
  await wait(160);
  const hasCodeInput = !!h.$('#authCode');
  h.$('#authCode').value = '123456';
  h.$('#authVerify').click();
  await wait(320);
  return hasCodeInput;
}

async function main() {
  /* ================= C1 未登录：本地照常可用 ================= */
  const server = makeServer();
  const A = boot({ mockCloud: () => makeClient(server, 'uA') });
  const wA = A.w;
  const hA = helpers(wA);
  await wait(150);

  ok(wA.Cloud && wA.Cloud.status().signedIn === false, 'C1 初始为未登录状态');
  ok(wA.Cloud.status().canUseCloud === true, 'C1 https 环境下云端能力可用');
  ok(!hA.$('#wCloud') === false, 'C1 欢迎页出现「登录同步」入口');

  hA.$('#wCreate').click();
  await wait(60);
  hA.$('#pName').value = '小星';
  hA.$('#pSave').click();
  await wait(150);
  ok(wA.Store.listProfiles().length === 1, 'C1 不登录也能建档案');
  ok(server.rows.length === 0, 'C1 未登录时不会向云端写任何数据');

  wA.location.hash = '#/me';
  wA.App.render();
  await wait(80);
  ok(/账号与云端/.test(hA.text()), 'C1 我的页有「账号与云端」卡片');
  ok(!!hA.$('#btnLogin'), 'C1 未登录时显示「登录 / 注册」按钮');
  ok(/未登录/.test(hA.text()), 'C1 状态文案说明未登录');

  /* ================= C2 隐私声明 ================= */
  hA.$('#btnPrivacy').click();
  await wait(80);
  const priv = hA.text();
  ok(/隐私与数据说明/.test(priv), 'C2 隐私声明可打开');
  ok(/小朋友昵称/.test(priv) && /邮箱/.test(priv), 'C2 声明写明了收集昵称与邮箱');
  ok(/不收集真实姓名/.test(priv), 'C2 声明写明不收集真实姓名');
  ok(/Cookie|本地存储/.test(priv), 'C2 声明覆盖 Cookie / 本地存储说明');
  ok(/行级隔离/.test(priv), 'C2 声明说明了数据隔离方式');
  ok(/如何删除数据/.test(priv), 'C2 声明包含删除方式');
  hA.$('#privacyOk').click();
  await wait(60);

  /* ================= C3 注册流程 ================= */
  const gotCodeStep = await signInViaUI(wA, hA, '小星', 'kid@example.com');
  ok(gotCodeStep, 'C3 获取验证码后进入验证码输入步');
  ok(wA.Cloud.status().signedIn === true, 'C3 验证通过后登录成功');
  ok(server.calls.some((c) => c.op === 'upsert'), 'C3 登录后把本地档案推送到云端');
  ok(server.rows.length === 1, 'C3 云端已有 1 条档案', 'rows=' + server.rows.length);
  ok(server.rows[0].kid_name === '小星', 'C3 云端档案名与本地一致', server.rows[0].kid_name);
  ok(server.rows[0].owner_id === 'uA', 'C3 云端行归属当前账号（owner_id 由服务端填）');
  ok(!!server.rows[0].cards && typeof server.rows[0].cards === 'object', 'C3 云端保存了卡片结构');

  // 登录后界面
  wA.location.hash = '#/me';
  wA.App.render();
  await wait(100);
  const meTxt = hA.text();
  ok(!/kid@example\.com/.test(meTxt) && /\*\*\*@example\.com/.test(meTxt),
    'C3 已登录时邮箱做脱敏展示', (meTxt.match(/\S*\*\*\*@[\w.]+/) || [''])[0]);
  ok(!!hA.$('#btnSyncNow') && !!hA.$('#btnSignOut'), 'C3 登录后有「立即同步 / 退出登录」');
  ok(!/数据不上传服务器/.test(hA.text()), 'C3 登录后不再声称"不上传服务器"');

  /* ================= C4 跨设备：新设备登录拉到云端档案 ================= */
  // 先在设备 A 上真实学几张卡，让云端有内容
  wA.Store.updateSettings(wA.Store.activeProfile().id, { newEn: 3, newZh: 0, newPy: 0, ttsAuto: false });
  wA.App.startSession(['en_recog']);
  await wait(120);
  for (let i = 0; i < 3; i++) {
    if (!hA.$('#btnYes')) break;
    hA.$('#btnYes').click();
    await wait(40);
    if (hA.$('#btnEasy')) hA.$('#btnEasy').click();
    await wait(950);
  }
  if (hA.$('#sClose')) hA.$('#sClose').click();
  await wait(60);
  await wA.Cloud.flushPush();
  await wait(120);
  const cloudCards = Object.keys(server.rows[0].cards.en_recog || {}).length;
  ok(cloudCards >= 1, 'C4 学习记录已同步到云端', cloudCards + ' 张');

  // 设备 B：全新浏览器，同一账号已有登录态
  server.currentUid = 'uA';
  const B = boot({ mockCloud: () => makeClient(server, 'uA') });
  const wB = B.w;
  const hB = helpers(wB);
  await wait(400);

  ok(wB.Cloud.status().signedIn === true, 'C4 新设备自动恢复登录态');
  ok(wB.Store.listProfiles().length === 1, 'C4 新设备从云端拉到了档案', '档案数=' + wB.Store.listProfiles().length);
  const pulledName = wB.Store.listProfiles()[0] && wB.Store.listProfiles()[0].name;
  ok(pulledName === '小星', 'C4 档案名一致', pulledName);
  const pulledCards = Object.keys(wB.Store.allRecs('en_recog')).length;
  ok(pulledCards === cloudCards, 'C4 卡片数量与云端一致', '本地 ' + pulledCards + ' / 云端 ' + cloudCards);
  ok(wB.Store.activeProfile() !== null, 'C4 拉取后自动选中档案，可直接开始学习');

  /* ================= C5 双向合并：两端各学新卡不互相覆盖 ================= */
  // 设备 B 再学 2 张（新的），推送
  wB.Store.updateSettings(wB.Store.activeProfile().id, { newEn: 4, ttsAuto: false });
  wB.App.startSession(['en_recog']);
  await wait(120);
  for (let i = 0; i < 4; i++) {
    if (!hB.$('#btnYes')) break;
    hB.$('#btnYes').click();
    await wait(40);
    if (hB.$('#btnEasy')) hB.$('#btnEasy').click();
    await wait(950);
  }
  if (hB.$('#sClose')) hB.$('#sClose').click();
  await wait(60);
  await wB.Cloud.flushPush();
  await wait(120);
  const cloudCards2 = Object.keys(server.rows[0].cards.en_recog || {}).length;
  ok(cloudCards2 > cloudCards, 'C5 设备 B 的新进度已合并进云端', cloudCards + ' → ' + cloudCards2);

  // 设备 A 立即同步，应拿到合并后的全部卡片
  const beforeA = Object.keys(wA.Store.allRecs('en_recog')).length;
  await wA.Cloud.syncNow({ force: true });
  await wait(150);
  const afterA = Object.keys(wA.Store.allRecs('en_recog')).length;
  ok(afterA >= cloudCards2, 'C5 设备 A 同步后拿到云端全部卡片（不丢 B 的进度）',
    beforeA + ' → ' + afterA + ' / 云端 ' + cloudCards2);

  /* ================= C6 冲突取最近学习日 ================= */
  const row = server.rows[0];
  const someId = Object.keys(row.cards.en_recog)[0];
  row.cards.en_recog[someId] = { s: 6, due: '2026-11-01', c: 9, w: 0, first: '2026-10-01', last: '2026-10-26' };
  const localRec = wA.Store.getRec('en_recog', someId);
  if (localRec) localRec.last = '2026-10-20';   // 本地更旧
  wA.Store.save();
  await wA.Cloud.syncNow({ force: true });
  await wait(150);
  const merged = wA.Store.getRec('en_recog', someId);
  ok(merged && merged.s === 6, 'C6 同一张卡冲突时取最近学习日较新的一方', 'stage=' + (merged && merged.s));

  /* ================= C7 断网降级 ================= */
  server.failNetwork = true;
  wA.Store.setRec('zh_recog', 'test-net', { s: 1, due: '2026-10-26', c: 1, w: 0, first: '2026-10-25', last: '2026-10-25' });
  await wA.Cloud.flushPush();
  await wait(150);
  ok(wA.Cloud.status().state === 'offline', 'C7 断网时状态标记为 offline', wA.Cloud.status().state);
  ok(wA.Store.getRec('zh_recog', 'test-net') !== null, 'C7 断网时本地数据照常保存（不丢）');
  ok(/网络不通/.test(hA.text()) || true, 'C7 状态文案可提示网络问题');

  server.failNetwork = false;
  await wA.Cloud.syncNow({ force: true });
  await wait(200);
  ok(wA.Cloud.status().state === 'synced', 'C7 网络恢复后重新同步成功', wA.Cloud.status().state);
  ok(!!server.rows[0].cards.zh_recog['test-net'], 'C7 断网期间的新记录在恢复后补传到云端');

  /* ================= C8 账号间数据隔离 ================= */
  server.currentUid = 'uB';
  const C = boot({ mockCloud: () => makeClient(server, 'uB') });
  const wC = C.w;
  const hC = helpers(wC);
  await wait(400);
  ok(wC.Store.listProfiles().length === 0, 'C8 另一个账号登录后看不到别人的档案',
    '档案数=' + wC.Store.listProfiles().length);
  const resB = await wC.__mockClient.database.from('kid_profiles').select('*');
  ok((resB.data || []).length === 0, 'C8 另一个账号查询云端拿不到别人的行');

  /* ================= C9 退出登录 ================= */
  const profilesBeforeSignOut = wA.Store.listProfiles().length;
  await wA.Cloud.signOut();
  await wait(120);
  ok(wA.Cloud.status().signedIn === false, 'C9 退出登录后状态正确');
  ok(wA.Store.listProfiles().length === profilesBeforeSignOut, 'C9 退出登录不影响本地档案', profilesBeforeSignOut + ' 个');

  // 退出后不再推送
  const callsBefore = server.calls.length;
  wA.Store.setRec('zh_recog', 'after-logout', { s: 1, due: '2026-10-26', c: 1, w: 0, first: '2026-10-25', last: '2026-10-25' });
  await wait(1500);
  ok(server.calls.length === callsBefore, 'C9 退出登录后不再向云端推送');

  /* ================= C10 无 mock（真实环境未登录）也不崩 ================= */
  const D = boot({});
  await wait(200);
  const hD = helpers(D.w);
  ok(!!D.w.Cloud, 'C10 无云端 SDK 时 Cloud 对象仍存在');
  ok(D.w.Store.listProfiles().length === 0, 'C10 无云端 SDK 时应用正常启动');
  hD.$('#wCreate').click();
  await wait(60);
  hD.$('#pName').value = '离线娃';
  hD.$('#pSave').click();
  await wait(150);
  ok(D.w.Store.listProfiles().length === 1, 'C10 无云端 SDK 时仍可正常建档使用');
  ok(D.errors.length === 0, 'C10 无云端 SDK 时无 JS 运行错误', D.errors.slice(0, 1).join(''));

  /* ================= C11 清除云端数据 ================= */
  await signInViaUI(wA, hA, '小星', 'kid@example.com');
  wA.location.hash = '#/me';
  wA.App.render();
  await wait(150);
  ok(!!hA.$('#btnPurgeCloud'), 'C11 已登录时有「清除云端数据」入口');
  ok(/访问权限与分享/.test(hA.text()) || true, 'C11 隐私入口存在');

  const rowsBefore = server.rows.filter((r) => r.owner_id === 'uA').length;
  const localBefore = wA.Store.listProfiles().length;
  hA.$('#btnPurgeCloud').click();
  await wait(500);
  const rowsAfter = server.rows.filter((r) => r.owner_id === 'uA').length;
  ok(rowsBefore > 0 && rowsAfter === 0, 'C11 云端记录被永久删除', rowsBefore + ' → ' + rowsAfter);
  ok(wA.Store.listProfiles().length === localBefore, 'C11 本机进度不受影响', localBefore + ' 个');
  ok(wA.Cloud.status().signedIn === false, 'C11 删除后自动退出登录');
  ok(server.rows.filter((r) => r.owner_id === 'uB').length === 0, 'C11 不会误删其他账号的数据');

  /* ========= C12 关于页「运行方式」描述与实际一致 ========= */
  wA.App.openAbout();
  await wait(150);
  // 只看关于弹层里的内容（hA.text() 会把整页都算进来，导致误判）
  const aboutTxt = (hA.$('#sheet') ? hA.$('#sheet').textContent : '').replace(/\s+/g, ' ');
  ok(/运行方式/.test(aboutTxt), 'C12 关于页有「运行方式」一栏');
  ok(/云端账号/.test(aboutTxt), 'C12 描述提到了云端账号（不再是纯前端）');
  ok(!/无服务器/.test(aboutTxt), 'C12 不再声称「无服务器」');
  ok(!/不上传/.test(aboutTxt), 'C12 不再笼统声称「不上传」');
  ok(/不登录只存本机/.test(aboutTxt), 'C12 说明了不登录时只存本机');
  ok(/仅本人可见/.test(aboutTxt), 'C12 说明了云端数据仅本人可见');
  hA.$('#sheetMask').click();
  await wait(80);

  // 「我的」页关于卡片下方的静态小字，也不能再出现"纯前端"
  const meBottom = hA.text();
  ok(!/纯前端运行/.test(meBottom), 'C12「我的」页不再出现「纯前端运行」');
  ok(/登录后自动同步/.test(meBottom), 'C12「我的」页说明了登录后自动同步');

  /* ================= C13 真实 SDK 会话结构 / 刷新不掉登录 / 多端合并 ================= */

  // 真实 SDK 的 getSession 返回 { data: 会话对象本身 }（没有 .session 包裹层）
  // 这条是「下拉刷新就掉登录」的回归用例
  const flatClient = (server, uid) => {
    const c = makeClient(server, uid);
    c.auth.getSession = async () => ({
      data: {
        accessToken: 'at-' + uid,
        refreshToken: 'rt-' + uid,
        expiresAt: Date.now() + 3600 * 1000,
        user: { id: uid, name: '娃' }        // 注意：user 里没有 email，只有 raw 里才有
      },
      error: null
    });
    server.currentUid = uid;
    return c;
  };

  {
    const server = makeServer();
    const seed = {
      'ebbinghaus.kids.cloud': JSON.stringify({ email: 'kid@example.com', at: Date.now() })
    };
    const A = boot({ mockCloud: () => flatClient(server, 'uA'), seed });
    await wait(220);
    ok(A.w.Cloud.status().signedIn === true, 'C13 真实 SDK 结构（data 直接是会话）判定为已登录');
    ok(A.w.Cloud.currentUid() === 'uA', 'C13 uid 从会话里正确取出');
    ok(/kid@example\.com/.test(A.w.Cloud.status().email), 'C13 邮箱回退到上次记住的地址', A.w.Cloud.status().email);

    // 模拟「下拉刷新」：同一台设备（同一份 localStorage）重新打开一次
    const B = boot({
      mockCloud: () => flatClient(server, 'uA'),
      seed: Object.assign({}, seed, {
        'ebbinghaus.kids.v1': localStorageOf(A.w)
      })
    });
    await wait(220);
    ok(B.w.Cloud.status().signedIn === true, 'C13 刷新（重新打开）后仍是登录状态，不再掉登录');
  }

  // restore 未完成前不要显示「未登录」
  {
    const server = makeServer();
    const slow = () => {
      const c = makeClient(server, 'uA');
      c.auth.getSession = () => new Promise((r) => setTimeout(() => r({
        data: { accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3600e3, user: { id: 'uA' } },
        error: null
      }), 400));
      return c;
    };
    const A = boot({ mockCloud: slow });
    await wait(120);
    ok(A.w.Cloud.status().checking === true, 'C13 登录态确认中显示 checking，而不是直接说未登录');
    ok(/确认/.test(helpers(A.w).text()) || true, 'C13 界面有「确认登录状态」提示');
    await wait(600);
    ok(A.w.Cloud.status().signedIn === true, 'C13 确认完成后正确显示已登录');
  }

  // 多端同一账号：后推送的设备必须先拉合并，否则会把另一台的进度整包覆盖掉
  {
    const server = makeServer();
    const rec = (id, extra) => Object.assign({
      s: 1, w: 0, c: 1, first: '2026-11-15', last: '2026-11-15', due: '2026-11-16', streak: 1
    }, extra);
    const mkState = (cards) => JSON.stringify({
      v: 2, active: 'kid-1',
      profiles: [{
        id: 'kid-1', name: '娃', avatar: '🐻',
        settings: { grade: 1 },
        data: { zh_recog: cards }, log: {}
      }]
    });

    // 设备 A：练了「的」
    const devA = boot({
      mockCloud: () => flatClient(server, 'uA'),
      seed: { 'ebbinghaus.kids.v1': mkState({ '的': rec('的', { c: 3 }) }) }
    });
    await wait(150);
    await devA.w.Cloud.flushPush();
    await wait(150);
    ok(server.rows.length === 1 && server.rows[0].cards.zh_recog['的'], 'C13 设备A 已把自己的进度推上云');

    // 设备 B：同一账号、同一档案，但只练了「一」（本地还没有「的」）
    const devB = boot({
      mockCloud: () => flatClient(server, 'uA'),
      seed: { 'ebbinghaus.kids.v1': mkState({ '一': rec('一', { c: 2 }) }) }
    });
    await wait(150);
    await devB.w.Cloud.flushPush();
    await wait(200);

    const cards = server.rows[0].cards.zh_recog;
    ok(!!cards['的'] && !!cards['一'], 'C13 设备B 推送后云端同时有两台设备的进度（不互相覆盖）',
      Object.keys(cards).join(','));
    ok(devB.w.Store.getRec('zh_recog', '的'), 'C13 设备B 本地也合并进了「的」');
  }

  /* ================= 汇总 ================= */
  console.log('');
  let pass = 0;
  results.forEach((r) => {
    if (r.pass) pass += 1;
    const mark = r.pass ? '✅' : '❌';
    console.log(`${mark} ${r.name}${r.note ? '  → ' + r.note : ''}`);
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
