/*!
 * cloud.js —— 可选的云端同步层（本地优先，云端兜底）
 *
 * 设计原则：
 *   1. 本地存档永远是"主副本"，云端是"跨设备副本"。断网 / 未登录 / 云端故障时，
 *      应用完全照常可用，孩子的进度不会因为网络问题丢失。
 *   2. 只在两份数据都拿到手时才做合并，合并按「卡片 last（最近学习日）较新者胜」
 *      逐张比较，绝不整体覆盖，所以任何一侧都不会被另一侧的无脑覆盖吃掉。
 *   3. 用户身份由云端认证提供，数据隔离由数据库行级安全（RLS）在服务端强制，
 *      前端拿不到、也不该拿到别人的数据。
 *
 * 依赖：@tencent-ai/workbuddy-cloud-sdk（CDN 形式，按需加载，未登录不下载）
 */
(function (global) {
  'use strict';

  /* ---------- 公开配置：仅这几项可以出现在前端（服务端另做 Origin 校验） ---------- */
  var CFG = {
    // 云端网关按「Origin + 分享码 Cookie」鉴权，跨域请求会被拦成 403（浏览器只报 Failed to fetch）。
    // 所以 endpoint 必须跟随当前访问域名，绝不能写死某个域名。
    // 云端白名单内的旧域名直连；其它域名走本站 server.js 的 /api/cloud 转发（平台网关独占 /.cloud/ 路径）。
    endpoint: (function () {
      try {
        var o = global.location.origin;
        if (!/^https?:\/\//.test(o)) return '';
        if (/^https:\/\/memory-station\.app\.workbuddy\.host$/.test(o)) return o;
        return o + '/api/cloud';
      } catch (e) { /* ignore */ }
      return '';
    })(),
    oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
    publishableKey: 'wbpk_Wdb9yl8UHSyf3kFACPhq2p_oZ9g5s3f34q3jKRkM9PFRZUqDUkqsFuf'
  };
  var SDK_URL = 'https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js';
  var TABLE = 'kid_profiles';
  var PUSH_DELAY = 1200;      // 本地改动后多久推送（合并连续答题）
  var SESSION_KEY = 'ebbinghaus.kids.cloud';
  /* 记住账号密码：密文存 localStorage，解密用的 AES 密钥存 IndexedDB 且不可导出。
   * 明文密码永不落盘、不打日志、只经官方认证接口发出；用户退出登录立即清除。 */
  var CRED_KEY = 'ebbinghaus.kids.cloud.cred';
  var VAULT_DB = 'ebbinghaus-kids-vault';
  var VAULT_STORE = 'keys';
  var VAULT_ID = 'cred';

  var client = null;
  var sdkPromise = null;
  var session = null;
  var applying = false;       // 正在把云端数据写回本地，期间不触发推送
  var pushTimer = null;
  var pushing = false;
  var pendingPush = false;
  // checking：正在确认登录态（restore 没回来之前不要显示「未登录」，那只是时序假象）
  var state = 'checking';     // checking | local | signedout | syncing | synced | offline | error
  var lastError = '';
  var lastSyncAt = 0;
  var listeners = [];
  var inflight = null;

  function emit() {
    var snap = status();
    listeners.forEach(function (fn) { try { fn(snap); } catch (e) {} });
  }

  function setState(s, err) {
    state = s;
    lastError = err ? String(err.message || err) : '';
    emit();
  }

  /* ---------- 能力判断 ---------- */
  /** SDK 的登录态依赖浏览器 Origin；file:// 双击打开时 Origin 为 null，云端会拒绝，故直接禁用 */
  function originUsable() {
    try { return /^https?:$/.test(global.location.protocol); } catch (e) { return false; }
  }

  function configured() {
    return !!(CFG.endpoint && CFG.publishableKey);
  }

  /* ---------- 按需加载 SDK ---------- */
  function loadSDK() {
    if (global.WorkBuddyCloud) return Promise.resolve(global.WorkBuddyCloud);
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise(function (resolve, reject) {
      var el = global.document.createElement('script');
      el.src = SDK_URL;
      el.async = true;
      el.onload = function () {
        if (global.WorkBuddyCloud) resolve(global.WorkBuddyCloud);
        else { sdkPromise = null; reject(new Error('云端组件加载后不可用')); }
      };
      el.onerror = function () {
        sdkPromise = null;
        reject(new Error('云端组件加载失败，请检查网络后重试'));
      };
      global.document.head.appendChild(el);
    });
    return sdkPromise;
  }

  function ensureClient() {
    if (client) return Promise.resolve(client);
    return loadSDK().then(function (WB) {
      client = WB.createWorkBuddyCloud({
        endpoint: CFG.endpoint,
        oauthRelayBaseUrl: CFG.oauthRelayBaseUrl,
        publishableKey: CFG.publishableKey,
        fetch: bridgeFetch
      });
      // 订阅 SDK 的登录态事件：token 续期成功 / 被登出时同步本模块的状态，
      // 避免「页面上的登录态」和「SDK 里的登录态」各说各话。
      try {
        if (client.auth && client.auth.onAuthStateChange) {
          client.auth.onAuthStateChange(function (event, s) {
            if (event === 'SIGNED_OUT') {
              session = null;
              // 不要立刻认输：本机明明登录过却收到 SIGNED_OUT，多数是续期那一下没成功。
              // 延迟 1.2s 再走一次 restore（内部自带重试），真被登出才会停留在未登录。
              if (rememberedEmail() && state !== 'local') {
                setState('checking');
                delay(1200).then(function () {
                  return restore().catch(function () {});
                });
              } else if (state !== 'local') {
                setState('signedout');
              }
            } else if (s && (s.accessToken || s.session)) {
              session = s.session || s;
              if (state === 'signedout' || state === 'checking') setState('synced');
            }
            emit();
          });
        }
      } catch (e) { /* 老版本 SDK 没有这个接口，忽略 */ }
      return client;
    });
  }

  /**
   * 平台网关会把请求里的 authorization 换成它自己的 CloudStudio 凭证，
   * 云端登录 token 因此被顶掉 → 云端把请求当匿名处理 → 查表静默返回空数组。
   * 这里把真实 token 另存一份到 x-ms-cloud-token，由 server.js 转发时还原。
   */
  function bridgeFetch(input, init) {
    try {
      init = init || {};
      var hdrs = init.headers;
      var auth = '';
      if (hdrs && typeof hdrs.get === 'function') auth = hdrs.get('authorization') || '';
      else if (hdrs) auth = hdrs.Authorization || hdrs.authorization || '';
      if (auth) {
        var out = (typeof global.Headers === 'function') ? new global.Headers(hdrs) : Object.assign({}, hdrs);
        if (typeof out.set === 'function') out.set('x-ms-cloud-token', auth);
        else out['x-ms-cloud-token'] = auth;
        init.headers = out;
      }
    } catch (e) { /* 出错就按原样发 */ }
    return global.fetch(input, init);
  }

  /* ---------- 数据转换 ---------- */
  function profileToRow(p) {
    return {
      kid_key: p.id,
      kid_name: p.name,
      avatar: p.avatar || null,
      settings: p.settings || {},
      cards: p.data || {},
      log: p.log || {},
      version: 1,
      updated_at: new Date().toISOString()
    };
  }

  function rowToProfile(r) {
    return {
      id: r.kid_key,
      name: r.kid_name,
      avatar: r.avatar || '🐣',
      created: r.created_at ? Date.parse(r.created_at) : Date.now(),
      lastActive: Date.now(),
      settings: r.settings || {},
      data: r.cards || {},
      log: r.log || {}
    };
  }

  /**
   * 单张卡：哪台练得更晚用哪台（u = 写入时间戳，精确到毫秒）；
   * 老数据没有 u 时退回「最近学习日」，同一天再取阶段高的。
   */
  function pickRec(a, b) {
    if (!a) return b;
    if (!b) return a;
    var ua = Number(a.u) || 0, ub = Number(b.u) || 0;
    if (ua !== ub) return ua > ub ? a : b;
    var la = a.last || '', lb = b.last || '';
    if (la !== lb) return la > lb ? a : b;
    return (b.s || 0) > (a.s || 0) ? b : a;
  }

  /** 把 remote 合并进 local（逐卡），返回是否有变化 */
  function mergeInto(local, remote) {
    var changed = false;
    var modules = Store.MODULES;

    // ---- 设置（每日新词/新字/学习量等）：按「谁改得晚用谁」，并互相补齐缺的键 ----
    // 注意不能只在本地为空时才抄云端——那样改过的设置永远同步不出去。
    (function () {
      var ls = local.settings || {};
      var rs = remote.settings || {};
      var lt = Number(ls.__ts) || 0;
      var rt = Number(rs.__ts) || 0;
      var merged = Object.assign({}, rt > lt ? ls : rs, rt > lt ? rs : ls);   // 旧的垫底，新的覆盖
      if (!local.settings || JSON.stringify(merged) !== JSON.stringify(ls)) {
        local.settings = merged;
        changed = true;
      }
    })();

    if (!local.data) local.data = {};

    modules.forEach(function (m) {
      var src = (remote.data && remote.data[m]) || {};
      if (!local.data[m]) local.data[m] = {};
      var dst = local.data[m];
      Object.keys(src).forEach(function (id) {
        var merged = pickRec(dst[id], src[id]);
        if (merged !== dst[id]) { dst[id] = merged; changed = true; }
      });
    });

    local.log = local.log || {};
    Object.keys(remote.log || {}).forEach(function (d) {
      if (!local.log[d]) { local.log[d] = remote.log[d]; changed = true; }
    });

    return changed;
  }

  /** 拉取云端全部档案 */
  function pullRows() {
    return ensureClient().then(function (c) {
      return c.database.from(TABLE)
        .select('kid_key, kid_name, avatar, settings, cards, log, created_at, updated_at')
        .order('created_at', { ascending: true });
    }).then(function (res) {
      if (res.error) throw res.error;
      return res.data || [];
    });
  }

  /** 推送当前全部本地档案（按 owner_id + kid_key upsert，服务端 RLS 兜底） */
  function pushRows() {
    var rows = Store.listProfiles().map(profileToRow);
    if (!rows.length) return Promise.resolve(0);
    return ensureClient().then(function (c) {
      return c.database.from(TABLE).upsert(rows, { onConflict: 'owner_id,kid_key' });
    }).then(function (res) {
      if (res.error) throw res.error;
      return rows.length;
    });
  }

  /* ---------- 同步主流程 ---------- */
  function syncNow(opts) {
    opts = opts || {};
    if (!session) return Promise.resolve({ skipped: 'signedout' });
    if (inflight) return inflight;

    setState('syncing');
    inflight = pullRows().then(function (rows) {
      var mergedCount = 0;
      applying = true;
      try {
        var byKey = {};
        Store.listProfiles().forEach(function (p) { byKey[p.id] = p; });

        rows.forEach(function (r) {
          var remote = rowToProfile(r);
          var local = byKey[r.kid_key];
          if (!local) {
            // 云端有、本地没有 → 直接落地（新设备首次登录走这里）
            var st = Store.getState();
            st.profiles.push(remote);
            if (!st.active) st.active = remote.id;
            mergedCount += 1;
          } else if (mergeInto(local, remote)) {
            mergedCount += 1;
          }
        });

        if (mergedCount || opts.force) Store.save(true);
      } finally {
        applying = false;
      }

      return pushRows().then(function (n) {
        lastSyncAt = Date.now();
        setState('synced');
        return { pulled: rows.length, merged: mergedCount, pushed: n, at: lastSyncAt };
      });
    }).catch(function (err) {
      setState(isNetworkError(err) ? 'offline' : 'error', err);
      throw err;
    }).then(function (r) {
      inflight = null;
      return r;
    }, function (e) {
      inflight = null;
      throw e;
    });

    return inflight;
  }

  function isNetworkError(err) {
    var msg = String((err && (err.message || err.error_description || err.msg)) || '');
    return /network|fetch|timeout|Failed to fetch|offline/i.test(msg) || (err && err.name === 'TypeError');
  }

  /** 只统计云端行数（用于同步后的核对，不写本地） */
  function countRemote() {
    return pullRows().then(function (rows) { return rows.length; });
  }

  /* ---------- 变更调度 ---------- */
  function schedulePush() {
    if (!session || applying) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      pushTimer = null;
      flushPush();
    }, PUSH_DELAY);
  }

  function flushPush() {
    if (!session) return Promise.resolve();
    if (pushing) { pendingPush = true; return Promise.resolve(); }
    pushing = true;
    // 多设备同时在用一个账号时，不能「只推不拉」：
    // 另一台设备的进度会整包被覆盖掉。所以推送前先拉取合并（syncNow 内部逐卡合并）。
    return syncNow({ force: true }).then(function () {
      lastSyncAt = Date.now();
      setState('synced');
    }).catch(function (err) {
      setState(isNetworkError(err) ? 'offline' : 'error', err);
    }).then(function () {
      pushing = false;
      if (pendingPush) { pendingPush = false; return flushPush(); }
    });
  }

  /* ---------- 认证 ---------- */

  /**
   * 从 SDK 的响应里取出会话对象。
   *
   * 注意：这个 SDK 的 { data } 里**直接就是会话**（{ accessToken, refreshToken, expiresAt, user }），
   * 不是 { session: ... } 的包裹结构。以前写成 res.data.session 永远取不到值，
   * 结果每次刷新页面都误判成「未登录」——手机 App 下拉刷新就掉登录，就是这个原因。
   * 这里两种结构都兼容。
   */
  function pickSession(res) {
    if (!res || res.error || !res.data) return null;
    var d = res.data;
    if (d.session) return d.session;
    if (d.accessToken || d.access_token || (d.user && d.user.id)) return d;
    return null;
  }

  function restore() {
    if (!originUsable() || !configured()) {
      setState('local');
      return Promise.resolve(false);
    }
    return ensureClient().then(function (c) {
      return c.auth.getSession();
    }).then(function (res) {
      if (res.error && !/session|unauthenticated/i.test(String(res.error.message || ''))) {
        // 网络类错误不改变本地可用性
        setState(isNetworkError(res.error) ? 'offline' : 'signedout', res.error);
        return false;
      }
      var s = pickSession(res);
      if (!s) {
        // 只有「这台设备以前登录过」才值得再试一次续期（弱网下偶发失败）；
        // 全新设备/从未登录的访客直接给结论，别让人对着「确认中」干等。
        if (!rememberedEmail()) {
          setState('signedout');
          return false;
        }
        return retryRefresh().then(function (s2) {
          if (s2) return acceptSession(s2);
          // SDK 会话确实没了：若本机加密存了账号密码，静默重登，不让家长反复输验证码
          return autoSignIn().then(function (ok) {
            if (ok) return true;
            setState('signedout');
            return false;
          });
        });
      }
      return acceptSession(s);
    }).catch(function (err) {
      setState(isNetworkError(err) ? 'offline' : 'error', err);
      return false;
    });
  }

  /** 拿到会话后的统一收尾：记录状态并立刻同步一次 */
  function acceptSession(s) {
    session = s;
    setState('synced');
    startAutoSync();
    return syncNow({ force: false }).then(function () { return true; }, function () { return true; });
  }

  /* ---------- 多设备自动同步 ----------
   * 两台设备同时用一个账号时，光靠"谁操作谁上传"不够：
   * 另一台不点就永远看不到新进度。所以登录后按周期拉一次，
   * 切回页面 / 网络恢复时立刻拉一次，离开页面前把本机推上去。
   * 合并规则见 pickRec / mergeInto：同一张卡谁写得晚（u 时间戳）用谁，
   * 设置同理（settings.__ts），所以"始终以最新的数据为准"。
   */
  var autoSyncTimer = null;
  var AUTO_SYNC_MS = 3 * 60 * 1000;
  var hooksBound = false;

  function startAutoSync() {
    if (!hooksBound) {
      hooksBound = true;
      try {
        global.document.addEventListener('visibilitychange', function () {
          if (!session) return;
          if (global.document.hidden) flushPush();           // 切走前把本地最新进度推上去
          else syncNow({ force: true }).catch(function () {}); // 切回来立刻拉
        });
        global.addEventListener('online', function () {
          if (session) syncNow({ force: true }).catch(function () {});
        });
      } catch (e) { /* 非浏览器环境忽略 */ }
    }
    // 周期同步的触发入口（jsdom 测试里不开常驻定时器，但保留这个入口可单测）
    global.__cloudAutoSyncTick = function () {
      if (session) return syncNow({ force: false });
      return Promise.resolve(null);
    };
    // 测试环境（jsdom）里不开常驻定时器，否则进程退不掉
    if (autoSyncTimer || global.__NO_CLOUD_TIMER__) return;
    autoSyncTimer = setInterval(function () {
      if (!session || applying) return;
      syncNow({ force: false }).catch(function () {});
    }, AUTO_SYNC_MS);
  }

  /** 续期重试（带 1.2s 间隔，最多两次），弱网下不至于立刻显示未登录 */
  function retryRefresh() {
    var attempt = function (n) {
      return ensureClient().then(function (c) {
        return c.auth.refreshSession ? c.auth.refreshSession() : c.auth.getSession();
      }).then(function (r) {
        var s = pickSession(r);
        if (s) return s;
        return n > 0 ? delay(1200).then(function () { return attempt(n - 1); }) : null;
      }, function () {
        return n > 0 ? delay(1200).then(function () { return attempt(n - 1); }) : null;
      });
    };
    return attempt(1);
  }

  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ---------- 记住账号密码（加密存储 + 掉线自动登录） ----------
   * 明文只存在于内存里一次；落到 localStorage 的是 AES-GCM 密文，
   * 解密密钥放在 IndexedDB 且生成时标记 extractable=false（无法导出）。
   * 浏览器不支持 Web Crypto / IndexedDB 时静默降级为「不记住」，不影响使用。
   */
  function utf8Bytes(str) {
    try { if (global.TextEncoder) return Array.prototype.slice.call(new global.TextEncoder().encode(str)); } catch (e) {}
    var s = unescape(encodeURIComponent(String(str))), out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 255);
    return out;
  }
  function bytesUtf8(arr) {
    try { if (global.TextDecoder) return new global.TextDecoder().decode(new Uint8Array(arr)); } catch (e) {}
    var s = '';
    for (var i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    return decodeURIComponent(escape(s));
  }

  function openVault(create) {
    return new Promise(function (resolve, reject) {
      var idb = global.indexedDB;
      if (!idb || !global.crypto || !global.crypto.subtle) { reject(new Error('crypto unavailable')); return; }
      var req;
      try { req = idb.open(VAULT_DB, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(VAULT_STORE)) db.createObjectStore(VAULT_STORE);
      };
      req.onerror = function () { reject(req.error || new Error('vault open failed')); };
      req.onsuccess = function () {
        var db = req.result;
        var done = function (val, err) { try { db.close(); } catch (e) {} err ? reject(err) : resolve(val); };
        try {
          var tx = db.transaction(VAULT_STORE, 'readonly');
          var get = tx.objectStore(VAULT_STORE).get(VAULT_ID);
          get.onerror = function () { done(null, get.error); };
          get.onsuccess = function () {
            var key = get.result;
            if (key || !create) { done(key || null); return; }
            var gen;
            try { gen = global.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
            catch (e) { done(null, e); return; }
            Promise.resolve(gen).then(function (k) {
              var tx2 = db.transaction(VAULT_STORE, 'readwrite');
              tx2.objectStore(VAULT_STORE).put(k, VAULT_ID);
              tx2.oncomplete = function () { done(k); };
              tx2.onerror = function () { done(null, tx2.error); };
            }, function (e) { done(null, e); });
          };
        } catch (e) { done(null, e); }
      };
    });
  }

  function rememberCredentials(email, password) {
    var addr = String(email || '').trim(), pwd = String(password || '');
    if (!addr || !pwd) return Promise.resolve(false);
    return openVault(true).then(function (key) {
      if (!key) return false;
      var iv = new Uint8Array(12);
      global.crypto.getRandomValues(iv);
      var plain = utf8Bytes(JSON.stringify({ e: addr, p: pwd, at: Date.now() }));
      return Promise.resolve(global.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv }, key, new Uint8Array(plain)
      )).then(function (buf) {
        global.localStorage.setItem(CRED_KEY, JSON.stringify({
          v: 1,
          iv: Array.prototype.slice.call(iv),
          data: Array.prototype.slice.call(new Uint8Array(buf))
        }));
        return true;
      });
    }).catch(function () { return false; });
  }

  function loadCredentials() {
    var raw;
    try { raw = global.localStorage.getItem(CRED_KEY); } catch (e) { return Promise.resolve(null); }
    if (!raw) return Promise.resolve(null);
    var obj;
    try { obj = JSON.parse(raw); } catch (e) { return Promise.resolve(null); }
    if (!obj || obj.v !== 1 || !obj.iv || !obj.data) return Promise.resolve(null);
    return openVault(false).then(function (key) {
      if (!key) return null;
      return Promise.resolve(global.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(obj.iv) }, key, new Uint8Array(obj.data)
      )).then(function (buf) {
        var c = JSON.parse(bytesUtf8(Array.prototype.slice.call(new Uint8Array(buf))));
        return (c && c.e && c.p) ? { email: c.e, password: c.p } : null;
      });
    }).catch(function () { return null; });
  }

  function clearCredentials() {
    try { global.localStorage.removeItem(CRED_KEY); } catch (e) {}
    return Promise.resolve(true);
  }
  function hasRememberedCredentials() {
    try { return !!global.localStorage.getItem(CRED_KEY); } catch (e) { return false; }
  }

  /** 用记住的账号密码静默重新登录（token 被另一台设备顶掉 / 长时间不用导致续期失败时） */
  function autoSignIn() {
    if (!hasRememberedCredentials()) return Promise.resolve(false);
    if (!originUsable()) return Promise.resolve(false);
    return loadCredentials().then(function (c) {
      if (!c) return false;
      return signInWithPassword(c.email, c.password).then(function () {
        recordEvent('auto_login', {});
        return true;
      }, function () { return false; });
    }).catch(function () { return false; });
  }

  function sendCode(email) {
    var addr = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      return Promise.reject(new Error('请填写正确的邮箱地址'));
    }
    if (!originUsable()) {
      return Promise.reject(new Error('云端同步只能在线上版使用，请用发布后的网址打开'));
    }
    return ensureClient().then(function (c) {
      return c.auth.sendOtp({ email: addr });
    }).then(function (res) {
      if (res.error) throw res.error;
      return { email: addr, verificationId: res.data.verificationId, isExistingUser: !!res.data.isExistingUser };
    });
  }

  function verifyCode(pending, code) {
    if (!pending || !pending.verificationId) {
      return Promise.reject(new Error('请先获取验证码'));
    }
    var token = String(code || '').replace(/\s/g, '');
    if (!token) return Promise.reject(new Error('请填写收到的验证码'));

    return ensureClient().then(function (c) {
      return c.auth.verifyOtp({
        email: pending.email,
        verificationId: pending.verificationId,
        isExistingUser: pending.isExistingUser,
        token: token
      }).then(function (res) {
        if (res.error) throw normalizeAuthError(res.error, pending);
        return resolveSession(c, res.data);
      });
    }).then(function (s) {
      if (!s) {
        throw new Error('验证已通过，但没能建立登录状态。请点「重新发送」再试一次。');
      }
      session = s;
      try {
        global.localStorage.setItem(SESSION_KEY, JSON.stringify({
          email: pending.email,
          at: Date.now()
        }));
      } catch (e) { /* 存储被禁用时忽略 */ }
      setState('synced');
      recordAccount();
      recordEvent('login', {});
      return { session: s, isExistingUser: pending.isExistingUser, email: pending.email };
    });
  }

  /** SDK 的 verifyOtp 内部走 signIn（老用户）或 signUp（新用户），
   *  两者都经由 postForSession 提交，返回结构在不同版本里不一致：
   *  可能是 { data: { session } }，也可能 data 本身就是 session。
   *  所以这里不猜结构，统一用 pickSession 兼容两种。 */
  function resolveSession(c, data) {
    var fromData = function () {
      if (!data) return null;
      if (data.session) return data.session;
      if (data.accessToken || data.access_token) return data;
      if (data.user && data.user.id) return data;
      return null;
    };
    return c.auth.getSession().then(function (r) {
      return pickSession(r) || fromData();
    }, function () {
      return fromData();
    });
  }

  /** 把网关/后端的英文错误，换成能看懂、能动手的中文提示 */
  function normalizeAuthError(err, pending) {
    var raw = String((err && (err.message || err.error_description || err.msg)) || err || '');
    if (/already|exists|registered|duplicate/i.test(raw)) {
      var e1 = new Error('这个邮箱已经注册过了。请点「重新发送」拿一个新验证码，这次会以登录方式进入。');
      e1.kind = 'exists';
      return e1;
    }
    if (/expired|invalid.*code|code.*invalid|verification/i.test(raw)) {
      return new Error('验证码不对或已过期（10 分钟内有效）。请点「重新发送」再试。');
    }
    return err instanceof Error ? err : new Error(raw || '登录失败，请重试');
  }

  /* ---------- 密码登录 / 找回密码（平台认证能力） ---------- */
  function rememberEmail(email) {
    try {
      global.localStorage.setItem(SESSION_KEY, JSON.stringify({ email: email, at: Date.now() }));
    } catch (e) { /* 存储被禁用时忽略 */ }
  }

  /** 邮箱 + 密码直接登录（账号需已设置过密码） */
  function signInWithPassword(email, password) {
    var addr = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      return Promise.reject(new Error('请填写正确的邮箱地址'));
    }
    if (!password) return Promise.reject(new Error('请输入密码'));
    if (!originUsable()) {
      return Promise.reject(new Error('云端登录只能在线上版使用，请用发布后的网址打开'));
    }
    var c;
    return ensureClient().then(function (cl) {
      c = cl;
      return c.auth.signInWithPassword({ email: addr, password: String(password) });
    }).then(function (res) {
      if (res && res.error) throw normalizeAuthError(res.error, { email: addr });
      return resolveSession(c, res && res.data);
    }).then(function (s) {
      if (!s) throw new Error('登录成功，但没能建立登录状态，请重试');
      session = s;
      rememberEmail(addr);
      setState('synced');
      return { session: s, email: addr, isExistingUser: true };
    });
  }

  /** 向注册邮箱发「重置密码」验证码，返回带 updateUser 的句柄 */
  function requestPasswordReset(email) {
    var addr = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      return Promise.reject(new Error('请填写正确的邮箱地址'));
    }
    if (!originUsable()) {
      return Promise.reject(new Error('找回密码只能在线上版使用，请用发布后的网址打开'));
    }
    return ensureClient().then(function (c) {
      return c.auth.resetPasswordForEmail(addr);
    }).then(function (res) {
      if (res && res.error) throw res.error;
      var d = (res && res.data) || res || {};
      var up = d.updateUser || (d.data && d.data.updateUser);
      if (typeof up !== 'function') {
        throw new Error('没能发起密码重置，请稍后再试');
      }
      return { email: addr, updateUser: up };
    });
  }

  /** 用邮箱验证码 + 新密码完成重置，并自动登录 */
  function resetPassword(pending, code, newPassword) {
    if (!pending || typeof pending.updateUser !== 'function') {
      return Promise.reject(new Error('请先获取邮箱验证码'));
    }
    var nonce = String(code || '').replace(/\s/g, '');
    if (!nonce) return Promise.reject(new Error('请填写收到的验证码'));
    var pwd = String(newPassword || '');
    if (pwd.length < 6) return Promise.reject(new Error('密码至少 6 位'));

    var c;
    return ensureClient().then(function (cl) {
      c = cl;
      return pending.updateUser({ nonce: nonce, password: pwd });
    }).then(function (res) {
      if (res && res.error) throw normalizeAuthError(res.error, pending);
      return resolveSession(c, res && (res.data || res));
    }).then(function (s) {
      if (!s) throw new Error('密码已更新，但没能自动登录，请用新密码登录');
      session = s;
      rememberEmail(pending.email);
      setState('synced');
      return { email: pending.email, session: s };
    });
  }

  function signOut() {
    var done = function () {
      session = null;
      if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
      try { global.localStorage.removeItem(SESSION_KEY); } catch (e) {}
      clearCredentials();   // 退出即删除记住的密码，本机不再留凭据
      setState('signedout');
    };
    if (!client) { done(); return Promise.resolve(); }
    return client.auth.signOut().then(done, done);
  }

  /** 清空本账号的云端数据（本地不受影响） */
  function deleteCloudData() {
    if (!session) return Promise.reject(new Error('请先登录'));
    return ensureClient().then(function (c) {
      return c.database.from(TABLE).delete().eq('owner_id', session.user && session.user.id);
    }).then(function (res) {
      if (res.error) throw res.error;
      return true;
    });
  }

  /* ---------- 状态快照 ---------- */
  function status() {
    var remembered = rememberedEmail();
    // 有些版本的 session.user 只有 id/name，没有 email，这里逐级回退
    var email = currentEmail() || remembered || '';
    return {
      state: state,
      checking: state === 'checking',
      signedIn: !!session,
      email: email,
      rememberedEmail: remembered,
      rememberedCredentials: hasRememberedCredentials(),
      lastSyncAt: lastSyncAt,
      error: lastError,
      canUseCloud: originUsable() && configured(),
      needsOnline: !originUsable(),
      endpoint: CFG.endpoint
    };
  }

  /* ---------- 使用统计（供管理端后台读取） ----------
   * 只记录"谁登录过、谁练过多少次"，不含任何学习内容。
   * 所有写入失败都静默忽略，绝不影响正常学习。
   */
  var ACCOUNTS = 'app_accounts';
  var EVENTS = 'app_events';
  var INVITES = 'app_invites';

  function currentEmail() {
    var u = session && session.user;
    return (u && (u.email || (u.raw && u.raw.email))) || rememberedEmail() || '';
  }

  function rememberedEmail() {
    try {
      var raw = global.localStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw).email || '') : '';
    } catch (e) { return ''; }
  }

  function currentUid() {
    return (session && session.user && session.user.id) || '';
  }

  /** 登录后登记/刷新账号行（首次插入，之后只更新 last_seen） */
  function recordAccount() {
    if (!configured() || !currentUid()) return Promise.resolve(null);
    return ensureClient().then(function (c) {
      return c.database.from(ACCOUNTS).upsert([{
        uid: String(currentUid()),
        email: currentEmail(),
        last_seen: new Date().toISOString()
      }], { onConflict: 'uid' });
    }).catch(function () { return null; });
  }

  /** 记录一条事件：login / practice */
  function recordEvent(kind, detail) {
    if (!configured() || !currentUid()) return Promise.resolve(null);
    return ensureClient().then(function (c) {
      return c.database.from(EVENTS).upsert([{
        uid: String(currentUid()),
        email: currentEmail(),
        kind: String(kind || 'event'),
        detail: detail || {}
      }]);
    }).catch(function () { return null; });
  }

  /** 读取发给当前邮箱、且尚未被领取的邀请（行级安全已限定只看得到自己的） */
  function fetchInvite() {
    if (!configured() || !session) return Promise.resolve(null);
    return ensureClient().then(function (c) {
      return c.database.from(INVITES).select('id, email, kid_name, grade, claimed_at');
    }).then(function (res) {
      var rows = (res && res.data) || [];
      for (var i = 0; i < rows.length; i++) {
        if (!rows[i].claimed_at) return rows[i];
      }
      return null;
    }).catch(function () { return null; });
  }

  /* ---------- 通用查询/写入（仅管理端使用） ---------- */
  function dbQuery(table, cols) {
    return ensureClient().then(function (c) {
      return c.database.from(table).select(cols || '*');
    }).then(function (res) {
      if (res && res.error) throw res.error;
      return (res && res.data) || [];
    });
  }

  function dbInsert(table, rows, onConflict) {
    return ensureClient().then(function (c) {
      var opts = onConflict ? { onConflict: onConflict } : undefined;
      var p = opts ? c.database.from(table).upsert(rows, opts) : c.database.from(table).upsert(rows);
      return Promise.resolve(p);
    }).then(function (res) {
      if (res && res.error) throw res.error;
      return res && res.data;
    });
  }

  function onChange(fn) { listeners.push(fn); }

  global.Cloud = {
    CFG: CFG,
    TABLE: TABLE,
    originUsable: originUsable,
    configured: configured,
    restore: restore,
    sendCode: sendCode,
    verifyCode: verifyCode,
    signInWithPassword: signInWithPassword,
    rememberCredentials: rememberCredentials,
    loadCredentials: loadCredentials,
    clearCredentials: clearCredentials,
    hasRememberedCredentials: hasRememberedCredentials,
    autoSignIn: autoSignIn,
    requestPasswordReset: requestPasswordReset,
    resetPassword: resetPassword,
    signOut: signOut,
    syncNow: syncNow,
    schedulePush: schedulePush,
    flushPush: flushPush,
    deleteCloudData: deleteCloudData,
    countRemote: countRemote,
    recordAccount: recordAccount,
    recordEvent: recordEvent,
    fetchInvite: fetchInvite,
    currentEmail: currentEmail,
    currentUid: currentUid,
    dbQuery: dbQuery,
    dbInsert: dbInsert,
    status: status,
    onChange: onChange,
    // 供测试注入
    __setClient: function (c) { client = c; },
    __setSession: function (s) { session = s; }
  };
})(window);
