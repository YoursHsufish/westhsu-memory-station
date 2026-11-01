/*!
 * mock-cloud.js —— 本地预览用的「假云端」（只在本地预览服务里注入，正式页面不加载）
 *
 * 目的：发布前的临时测试时，打开页面就自动是「管理员已登录」状态，
 *      不用每次收验证码，也不会碰到正式的云端数据。
 *
 * 工作方式：
 *   · 冒充 @tencent-ai/workbuddy-cloud-sdk，cloud.js 里 loadSDK() 会直接复用它；
 *   · auth.getSession() 永远返回管理员会话（xucong@westair.cn）；
 *   · database 读写落在 localStorage 的 ebbinghaus.kids.devcloud（本机沙箱表），
 *     不联网、不写正式库；
 *   · 可选：/_dev/seed.json 存在时（来自「导出备份」的 JSON），首次加载灌进去，
 *     这样预览里就能看到真实的档案与卡片。
 *
 * 想测「未登录」流程：地址后加 ?devloggedout=1
 */
(function (global) {
  'use strict';

  var DB_KEY = 'ebbinghaus.kids.devcloud';
  var SESSION_KEY = 'ebbinghaus.kids.devcloud.session';
  var TABLES = ['kid_profiles', 'app_accounts', 'app_events', 'app_invites'];

  var ADMIN = {
    id: '2114312933574971392',
    email: 'xucong@westair.cn',
    name: '许琮-Stephen Hsu'
  };

  /* ---------------- 沙箱表 ---------------- */
  var db = null;

  function blankDb() {
    var o = {};
    TABLES.forEach(function (t) { o[t] = []; });
    return o;
  }

  function loadDb() {
    if (db) return db;
    db = null;
    try {
      var raw = global.localStorage.getItem(DB_KEY);
      if (raw) db = JSON.parse(raw);
    } catch (e) { db = null; }
    if (!db || typeof db !== 'object') db = blankDb();
    TABLES.forEach(function (t) { if (!db[t]) db[t] = []; });
    return db;
  }

  function saveDb() {
    try { global.localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) { /* 忽略 */ }
  }

  /** 首次进入时把种子数据塞进沙箱（只在表为空时做一次） */
  var seeded = false;
  function seedOnce() {
    if (seeded) return Promise.resolve();
    seeded = true;
    var cur = loadDb();
    if (cur.kid_profiles.length) return Promise.resolve();
    if (typeof global.fetch !== 'function') return Promise.resolve();
    return global.fetch('/_dev/seed.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (json) {
        if (!json) return;
        var st = json.data || json;                  // 兼容「导出备份」包裹格式
        (st.profiles || []).forEach(function (p) {
          cur.kid_profiles.push({
            kid_key: p.id,
            kid_name: p.name,
            avatar: p.avatar || '🐣',
            settings: p.settings || {},
            cards: p.data || {},
            log: p.log || {},
            owner_id: ADMIN.id,
            created_at: new Date(p.created || Date.now()).toISOString(),
            updated_at: new Date().toISOString()
          });
        });
        saveDb();
      })
      .catch(function () { /* 没有种子就空着 */ });
  }

  /* ---------------- 会话 ---------------- */
  function loggedOutForced() {
    try { return /[?&]devloggedout=1/.test(global.location.search); } catch (e) { return false; }
  }

  function sessionOn() {
    if (loggedOutForced()) return false;
    try {
      var raw = global.localStorage.getItem(SESSION_KEY);
      if (raw === '0') return false;
    } catch (e) { /* 忽略 */ }
    return true;
  }

  function setSession(on) {
    try { global.localStorage.setItem(SESSION_KEY, on ? '1' : '0'); } catch (e) { /* 忽略 */ }
  }

  function makeSession() {
    return {
      access_token: 'dev-preview-token',
      refresh_token: 'dev-preview-refresh',
      expires_at: Math.floor(Date.now() / 1000) + 86400,
      user: { id: ADMIN.id, email: ADMIN.email, name: ADMIN.name }
    };
  }

  /* ---------------- 查询器（模拟 Supabase 风格的链式调用） ---------------- */
  function project(row, cols) {
    if (!cols || cols === '*') return Object.assign({}, row);
    var out = {};
    String(cols).split(',').forEach(function (c) {
      var k = c.trim();
      if (k && Object.prototype.hasOwnProperty.call(row, k)) out[k] = row[k];
    });
    return out;
  }

  function tableRows(name) {
    var d = loadDb();
    if (!d[name]) d[name] = [];
    return d[name];
  }

  function runQuery(name, st) {
    var rows = tableRows(name);

    if (st.del) {
      var keep = st.eq
        ? rows.filter(function (r) { return String(r[st.eq[0]]) !== String(st.eq[1]); })
        : [];
      loadDb()[name] = keep;
      saveDb();
      return { data: null, error: null };
    }

    if (st.upsert) {
      var list = Array.isArray(st.upsert[0]) ? st.upsert[0] : [st.upsert[0]];
      var onConflict = (st.upsert[1] && st.upsert[1].onConflict) || '';
      var keys = onConflict ? String(onConflict).split(',').map(function (s) { return s.trim(); }) : null;
      list.forEach(function (row) {
        var hit = null;
        if (keys && keys.length) {
          // 只比对面里真的给了值的列（owner_id 这类由服务端补的列，前端不会传）
          var use = keys.filter(function (k) { return row[k] !== undefined && row[k] !== null; });
          if (use.length) {
            hit = rows.filter(function (r) {
              return use.every(function (k) { return String(r[k]) === String(row[k]); });
            })[0] || null;
          }
        }
        if (hit) Object.assign(hit, row);
        else rows.push(Object.assign({ owner_id: ADMIN.id }, row));
      });
      saveDb();
      return { data: list, error: null };
    }

    // select
    var data = rows.slice();
    if (st.eq) {
      data = data.filter(function (r) { return String(r[st.eq[0]]) === String(st.eq[1]); });
    }
    if (st.order) {
      var col = st.order[0];
      var asc = !(st.order[1] && st.order[1].ascending === false);
      data.sort(function (a, b) {
        var x = String(a[col] == null ? '' : a[col]);
        var y = String(b[col] == null ? '' : b[col]);
        var r = x < y ? -1 : (x > y ? 1 : 0);
        return asc ? r : -r;
      });
    }
    return { data: data.map(function (r) { return project(r, st.cols); }), error: null };
  }

  function makeQuery(name) {
    var st = { cols: '*', order: null, upsert: null, del: false, eq: null };
    var q = {
      select: function (cols) { st.cols = cols || '*'; return q; },
      order: function (col, opt) { st.order = [col, opt || {}]; return q; },
      upsert: function (rows, opts) { st.upsert = [rows, opts]; return q; },
      delete: function () { st.del = true; return q; },
      eq: function (col, val) { st.eq = [col, val]; return q; },
      // 让 `await from(...).select()` / `.upsert()` 都成立
      then: function (ok, bad) {
        return seedOnce().then(function () {
          return runQuery(name, st);
        }).then(ok, bad);
      }
    };
    return q;
  }

  /* ---------------- 客户端 ---------------- */
  var client = {
    auth: {
      getSession: function () {
        return Promise.resolve({
          data: { session: sessionOn() ? makeSession() : null },
          error: null
        });
      },
      getUser: function () {
        return Promise.resolve({
          data: { user: sessionOn() ? makeSession().user : null },
          error: null
        });
      },
      sendOtp: function (opts) {
        return Promise.resolve({
          data: { verificationId: 'dev-preview', isExistingUser: true, email: opts && opts.email },
          error: null
        });
      },
      verifyOtp: function () {
        setSession(true);
        return Promise.resolve({ data: { session: makeSession() }, error: null });
      },
      signInWithPassword: function () {
        setSession(true);
        return Promise.resolve({ data: { session: makeSession() }, error: null });
      },
      resetPasswordForEmail: function () {
        return Promise.resolve({
          data: {
            updateUser: function () {
              setSession(true);
              return Promise.resolve({ data: { session: makeSession() }, error: null });
            }
          },
          error: null
        });
      },
      signOut: function () {
        setSession(false);
        return Promise.resolve({ error: null });
      }
    },
    database: { from: makeQuery },
    // 方便调试
    __dev: { reset: function () { db = blankDb(); saveDb(); }, admin: ADMIN }
  };

  global.WorkBuddyCloud = {
    createWorkBuddyCloud: function () { return client; }
  };
  global.__DEV_MOCK_CLOUD__ = true;

  /* ---------------- 顶部提示条：别把预览当成正式站 ---------------- */
  function banner() {
    if (global.top !== global.self) return;          // 不在 iframe 里画
    if (document.getElementById('devPreviewBar')) return;
    var on = sessionOn();
    var bar = document.createElement('div');
    bar.id = 'devPreviewBar';
    bar.style.cssText = 'position:relative;z-index:9999;display:flex;align-items:center;gap:10px;flex-wrap:wrap;' +
      'padding:9px 14px;background:#0f172a;color:#e7ecf7;font-size:12.5px;line-height:1.5;' +
      'font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;';
    bar.innerHTML =
      '<span style="flex:none;background:#22c39a;color:#062d22;font-weight:800;border-radius:6px;padding:2px 7px">本地预览</span>' +
      '<span style="flex:1;min-width:200px">' +
      (on
        ? '已自动登录：<b>' + ADMIN.email + '</b>（管理员）· 云端是<b>本机假云端</b>，不会写正式数据'
        : '当前为<b>未登录</b>状态（地址带 devloggedout=1）；去掉参数即可自动登录') +
      '<span style="opacity:.7">　点这里</span> <a href="' + (on ? '?devloggedout=1' : '?') +
      '" style="color:#8fb0ff">' + (on ? '看未登录效果' : '恢复自动登录') + '</a>' +
      '</span>' +
      '<span style="opacity:.6">v' + ((global.APP_META && global.APP_META.version) || '') + '</span>';
    var body = document.body;
    if (body && body.firstChild) body.insertBefore(bar, body.firstChild);
    else if (body) body.appendChild(bar);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(banner, 60); });
  } else {
    setTimeout(banner, 60);
  }
})(window);
