/* 记忆小站 · 管理后台
 *
 * 与使用端完全分离：使用端是 index.html（孩子用），本页是 admin.html（管理员用）。
 * 权限由数据库行级安全兜底：只有 ADMIN_UID 能读到全部账号/事件/档案，
 * 就算有人伪造前端代码，服务端也只会返回他自己的那几行。
 */
(function () {
  'use strict';

  var ADMIN_EMAIL = 'xucong@westair.cn';
  var ADMIN_UID = '2114312933574971392';

  var el = function (id) { return document.getElementById(id); };
  var body = el('admBody');
  var sub = el('admSub');

  var pending = null;      // 发码后的待验证状态
  var data = null;         // 拉取到的四张表
  var loading = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmt(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    var p2 = function (n) { return n < 10 ? '0' + n : n; };
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
      ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }

  function dayKey(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    var p2 = function (n) { return n < 10 ? '0' + n : n; };
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }

  function today() { return dayKey(Date.now()); }

  function maskEmail(e) {
    var s = String(e || '');
    var at = s.indexOf('@');
    if (at <= 0) return s;
    var n = s.slice(0, at);
    return n.slice(0, Math.min(2, n.length)) + '***' + s.slice(at);
  }

  function isAdmin() {
    var email = (Cloud.currentEmail() || '').toLowerCase();
    var uid = String(Cloud.currentUid() || '');
    return email === ADMIN_EMAIL || uid === ADMIN_UID;
  }

  /* ================= 登录 ================= */
  function renderLogin(msg) {
    sub.textContent = '仅管理员可访问';
    body.innerHTML =
      '<div class="adm-card adm-login">' +
      '<h2>管理员登录</h2>' +
      '<p class="adm-note" style="margin-top:0;margin-bottom:14px">' +
      '用管理员邮箱 <b>' + esc(ADMIN_EMAIL) + '</b> 登录，系统会给该邮箱发一封验证码。' +
      '其他邮箱即使登录成功也进不了这个页面。</p>' +
      '<div class="adm-field"><label>邮箱</label>' +
      '<input class="adm-input" id="aEmail" type="email" autocomplete="email" value="' + esc(ADMIN_EMAIL) + '" /></div>' +
      (pending
        ? '<div class="adm-field"><label>验证码（已发至 ' + esc(maskEmail(pending.email)) + '）</label>' +
          '<input class="adm-input" id="aCode" inputmode="numeric" maxlength="8" autocomplete="one-time-code" ' +
          'placeholder="6 位数字" style="letter-spacing:4px;text-align:center;font-size:18px" /></div>' +
          '<div class="adm-row"><button class="adm-btn" id="aVerify">完成登录</button>' +
          '<button class="adm-btn ghost" id="aResend">重新发送</button></div>'
        : '<button class="adm-btn" id="aSend" style="width:100%">获取验证码</button>') +
      '<div class="adm-msg' + (msg && msg.err ? ' err' : '') + '" id="aMsg">' + esc(msg ? msg.text : '') + '</div>' +
      '</div>';

    if (pending) {
      var v = el('aVerify');
      if (v) v.onclick = doVerify;
      var r = el('aResend');
      if (r) r.onclick = function () { doSend(ADMIN_EMAIL); };
      setTimeout(function () { var c = el('aCode'); if (c) c.focus(); }, 80);
      var codeInput = el('aCode');
      if (codeInput) codeInput.onkeydown = function (e) { if (e.key === 'Enter') doVerify(); };
    } else {
      var s = el('aSend');
      if (s) s.onclick = function () { doSend((el('aEmail').value || '').trim()); };
    }
  }

  function msg(text, isErr) {
    var m = el('aMsg');
    if (m) { m.textContent = text || ''; m.className = 'adm-msg' + (isErr ? ' err' : ''); }
  }

  function doSend(email) {
    if (!email) { msg('请填写邮箱', true); return; }
    msg('正在发送…');
    Cloud.sendCode(email).then(function (p) {
      pending = p;
      renderLogin({ text: '验证码已发送，请查收邮箱' });
    }).catch(function (e) {
      msg(String(e && e.message || e), true);
    });
  }

  function doVerify() {
    var code = (el('aCode') && el('aCode').value || '').trim();
    if (!code) { msg('请输入验证码', true); return; }
    msg('正在验证…');
    Cloud.verifyCode(pending, code).then(function () {
      pending = null;
      if (!isAdmin()) {
        var who = Cloud.currentEmail();
        return Cloud.signOut().then(function () {
          renderLogin({ text: '当前邮箱（' + who + '）不是管理员，已自动退出。请用 ' + ADMIN_EMAIL + ' 登录。', err: true });
        });
      }
      return loadAll();
    }).catch(function (e) {
      msg(String(e && e.message || e), true);
    });
  }

  /* ================= 数据 ================= */
  function loadAll() {
    if (loading) return Promise.resolve();
    loading = true;
    sub.textContent = '已登录：' + Cloud.currentEmail() + ' · 正在读取…';
    body.innerHTML = '<div class="adm-card"><div class="adm-empty">正在读取数据…</div></div>';

    return Promise.all([
      Cloud.dbQuery('app_accounts', '*').catch(function () { return []; }),
      Cloud.dbQuery('app_events', '*').catch(function () { return []; }),
      Cloud.dbQuery('kid_profiles', 'kid_key, kid_name, avatar, settings, cards, log, owner_id, updated_at').catch(function () { return []; }),
      Cloud.dbQuery('app_invites', '*').catch(function () { return []; })
    ]).then(function (res) {
      data = {
        accounts: res[0] || [],
        events: res[1] || [],
        profiles: res[2] || [],
        invites: res[3] || []
      };
      loading = false;
      renderDash();
      sub.textContent = '已登录：' + Cloud.currentEmail() + ' · ' + fmt(Date.now());
    }).catch(function (e) {
      loading = false;
      body.innerHTML = '<div class="adm-card"><div class="adm-msg err">读取失败：' +
        esc(String(e && e.message || e)) + '</div></div>';
    });
  }

  function cardsOf(p) {
    var c = p.cards || {};
    var n = 0;
    Object.keys(c).forEach(function (k) { n += Object.keys(c[k] || {}).length; });
    return n;
  }

  /* ================= 渲染 ================= */
  function renderDash() {
    var accounts = data.accounts.slice();
    var events = data.events.slice();
    var profiles = data.profiles.slice();
    var invites = data.invites.slice();

    // 账号兜底：还没写过 app_accounts 时，从档案的 owner_id 反推
    var byUid = {};
    accounts.forEach(function (a) { byUid[a.uid] = a; });
    profiles.forEach(function (p) {
      if (p.owner_id && !byUid[p.owner_id]) {
        byUid[p.owner_id] = { uid: p.owner_id, email: '', last_seen: p.updated_at };
        accounts.push(byUid[p.owner_id]);
      }
    });

    // 每个账号的档案与卡片
    var stat = {};
    Object.keys(byUid).forEach(function (uid) {
      stat[uid] = { profiles: 0, cards: 0, lastStudy: null, names: [] };
    });
    profiles.forEach(function (p) {
      var s = stat[p.owner_id];
      if (!s) return;
      s.profiles += 1;
      s.cards += cardsOf(p);
      var t = new Date(p.updated_at || 0).getTime();
      if (!s.lastStudy || t > s.lastStudy) s.lastStudy = t;
      if (p.kid_name) s.names.push(p.kid_name);
    });

    // 登录次数 & 最近登录
    var logins = events.filter(function (e) { return e.kind === 'login'; });
    var loginCount = {}, lastLogin = {};
    logins.forEach(function (e) {
      var uid = e.uid || '';
      loginCount[uid] = (loginCount[uid] || 0) + 1;
      var t = new Date(e.at || 0).getTime();
      if (!lastLogin[uid] || t > lastLogin[uid]) lastLogin[uid] = t;
    });

    // 概览
    var totalAccounts = Object.keys(byUid).length;
    var totalCards = profiles.reduce(function (n, p) { return n + cardsOf(p); }, 0);
    var todayEvents = events.filter(function (e) { return dayKey(e.at) === today(); });
    var todayActive = {};
    todayEvents.forEach(function (e) { todayActive[e.uid] = 1; });
    todayEvents.forEach(function (e) {
      if (e.kind === 'practice') return;
    });
    // 今日活跃也把「今天练过」算进来（看档案更新时间）
    profiles.forEach(function (p) {
      if (dayKey(p.updated_at) === today()) todayActive[p.owner_id] = 1;
    });

    var practiceEvents = events.filter(function (e) { return e.kind === 'practice'; });
    var totalGroups = practiceEvents.length;

    // 按天聚合（近 14 天）
    var days = {};
    practiceEvents.forEach(function (e) {
      var k = dayKey(e.at);
      if (!k) return;
      days[k] = days[k] || { groups: 0, cards: 0, users: {} };
      days[k].groups += 1;
      var c = (e.detail && e.detail.cards) || 0;
      days[k].cards += Number(c) || 0;
      days[k].users[e.uid] = 1;
    });

    var dayKeys = Object.keys(days).sort().reverse().slice(0, 14);

    var html = '';

    // —— 概览
    html += '<div class="adm-card"><h2>概览<i>数据来自云端数据库，实时读取</i></h2>' +
      '<div class="adm-stats">' +
      statBox(totalAccounts, '注册账号') +
      statBox(profiles.length, '小朋友档案') +
      statBox(totalCards, '累计卡片记录') +
      statBox(totalGroups, '累计练习组数') +
      statBox(Object.keys(todayActive).length, '今日活跃账号') +
      statBox(accounts.filter(function (a) { return (loginCount[a.uid] || 0) > 1; }).length, '回访账号（登录≥2 次）') +
      '</div>' +
      '<div class="adm-note">统计口径：登录次数、练习组数从「使用统计」上线后开始记录；' +
      '卡片记录与最后学习时间来自实际学习数据，含历史。</div></div>';

    // —— 账号列表
    html += '<div class="adm-card"><h2>账号与档案<i>共 ' + totalAccounts + ' 个账号</i></h2>';
    if (!accounts.length) {
      html += '<div class="adm-empty">还没有账号登录过。</div>';
    } else {
      html += '<div class="adm-scroll"><table class="adm-table"><thead><tr>' +
        '<th>邮箱</th><th>小朋友</th><th class="adm-num">档案</th><th class="adm-num">卡片</th>' +
        '<th class="adm-num">登录</th><th>最近登录</th><th>最后学习</th><th>账号 ID</th>' +
        '</tr></thead><tbody>';
      accounts.sort(function (a, b) {
        return (lastLogin[b.uid] || 0) - (lastLogin[a.uid] || 0);
      }).forEach(function (a) {
        var s = stat[a.uid] || { profiles: 0, cards: 0, lastStudy: null, names: [] };
        html += '<tr>' +
          '<td>' + (a.email ? esc(a.email) : '<span class="adm-badge warn">未记录</span>') + '</td>' +
          '<td>' + (s.names.length ? esc(s.names.join('、')) : '—') + '</td>' +
          '<td class="adm-num">' + s.profiles + '</td>' +
          '<td class="adm-num">' + s.cards + '</td>' +
          '<td class="adm-num">' + (loginCount[a.uid] || 0) + '</td>' +
          '<td>' + fmt(lastLogin[a.uid] || a.last_seen) + '</td>' +
          '<td>' + fmt(s.lastStudy) + '</td>' +
          '<td style="color:#8b93aa;font-size:11.5px">' + esc(a.uid) + '</td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '<div class="adm-note">本系统<b>不保存任何密码</b>：登录使用邮箱验证码，每次都是临时凭证，' +
      '因此不存在"密码可见性"问题——数据库里从来没有密码字段。</div></div>';

    // —— 登录记录
    html += '<div class="adm-card"><h2>登录记录<i>最近 50 条</i></h2>';
    if (!logins.length) {
      html += '<div class="adm-empty">暂无记录。启用统计后，每次登录都会记一条。</div>';
    } else {
      html += '<div class="adm-scroll"><table class="adm-table"><thead><tr>' +
        '<th>时间</th><th>账号</th></tr></thead><tbody>';
      logins.sort(function (a, b) {
        return new Date(b.at) - new Date(a.at);
      }).slice(0, 50).forEach(function (e) {
        html += '<tr><td>' + fmt(e.at) + '</td><td>' + esc(e.email || e.uid || '') + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '</div>';

    // —— 使用频次
    html += '<div class="adm-card"><h2>使用频次<i>按天统计练习组数</i></h2>';
    if (!dayKeys.length) {
      html += '<div class="adm-empty">暂无练习记录。孩子每完成一组练习会记一条。</div>';
    } else {
      html += '<table class="adm-table"><thead><tr><th>日期</th>' +
        '<th class="adm-num">练习组数</th><th class="adm-num">卡片数</th><th class="adm-num">活跃账号</th>' +
        '</tr></thead><tbody>';
      dayKeys.forEach(function (k) {
        var d = days[k];
        html += '<tr><td>' + esc(k) + '</td>' +
          '<td class="adm-num">' + d.groups + '</td>' +
          '<td class="adm-num">' + d.cards + '</td>' +
          '<td class="adm-num">' + Object.keys(d.users).length + '</td></tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    // —— 添加账号
    html += '<div class="adm-card"><h2>添加账号<i>预建账号，对方登录即生效</i></h2>' +
      '<div class="adm-row">' +
      '<div class="adm-field" style="flex:2"><label>对方邮箱</label>' +
      '<input class="adm-input" id="invEmail" type="email" placeholder="name@example.com" /></div>' +
      '<div class="adm-field"><label>小朋友昵称</label>' +
      '<input class="adm-input" id="invName" maxlength="12" placeholder="小名即可" /></div>' +
      '<div class="adm-field" style="max-width:110px"><label>年级</label>' +
      '<input class="adm-input" id="invGrade" type="number" min="1" max="6" value="1" /></div>' +
      '</div>' +
      '<button class="adm-btn" id="invAdd">添加为可用账号</button>' +
      '<div class="adm-msg" id="invMsg"></div>' +
      '<div class="adm-note">说明：平台的身份认证必须由本人邮箱验证码登录，管理员不能代替别人设置密码。' +
      '这里做的是「预建账号」——你填入邮箱后会生成一条待领取记录，对方用该邮箱登录时自动接上，' +
      '不需要再手动建档。</div>';

    if (invites.length) {
      html += '<div style="margin-top:14px"><table class="adm-table"><thead><tr>' +
        '<th>邮箱</th><th>昵称</th><th class="adm-num">年级</th><th>添加时间</th><th>状态</th>' +
        '</tr></thead><tbody>';
      invites.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); })
        .forEach(function (v) {
          html += '<tr><td>' + esc(v.email) + '</td><td>' + esc(v.kid_name) + '</td>' +
            '<td class="adm-num">' + (v.grade || 1) + '</td><td>' + fmt(v.created_at) + '</td>' +
            '<td>' + (v.claimed_at ? '<span class="adm-badge">已领取</span>'
              : '<span class="adm-badge warn">待领取</span>') + '</td></tr>';
        });
      html += '</tbody></table></div>';
    }
    html += '</div>';

    // —— 底部
    html += '<div class="adm-card" style="text-align:center">' +
      '<button class="adm-btn ghost" id="admRefresh">刷新数据</button> ' +
      '<button class="adm-btn ghost" id="admOut">退出登录</button>' +
      '<div class="adm-note">管理员：' + esc(ADMIN_EMAIL) + ' · 使用端入口是 index.html，本页仅供管理</div></div>';

    body.innerHTML = html;

    var add = el('invAdd');
    if (add) add.onclick = addInvite;
    var rf = el('admRefresh');
    if (rf) rf.onclick = function () { loadAll(); };
    var out = el('admOut');
    if (out) out.onclick = function () {
      Cloud.signOut().then(function () { pending = null; renderLogin({ text: '已退出' }); });
    };
  }

  function statBox(n, label) {
    return '<div class="adm-stat"><b>' + n + '</b><span>' + esc(label) + '</span></div>';
  }

  function addInvite() {
    var email = (el('invEmail').value || '').trim();
    var name = (el('invName').value || '').trim();
    var grade = parseInt(el('invGrade').value, 10) || 1;
    var m = el('invMsg');
    var say = function (t, bad) { m.textContent = t; m.className = 'adm-msg' + (bad ? ' err' : ' ok'); };

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say('邮箱格式不对', true); return; }
    if (!name) { say('请填小朋友昵称', true); return; }
    if (grade < 1 || grade > 6) { say('年级需在 1–6 之间', true); return; }

    say('正在保存…');
    Cloud.dbInsert('app_invites', [{ email: email, kid_name: name, grade: grade }])
      .then(function () {
        say('已添加：' + email + '（' + name + '，' + grade + '年级）。对方用该邮箱登录后自动生效。');
        setTimeout(loadAll, 800);
      })
      .catch(function (e) {
        var t = String(e && e.message || e);
        if (/duplicate|unique|已存在/i.test(t)) say('这个邮箱已经在列表里了', true);
        else say('保存失败：' + t, true);
      });
  }

  /* ================= 启动 ================= */
  function boot() {
    if (!Cloud || !Cloud.configured()) {
      sub.textContent = '';
      body.innerHTML = '<div class="adm-card"><div class="adm-msg err">' +
        '管理后台只能在发布后的线上地址打开（需要云端环境）。</div></div>';
      return;
    }
    // 先把登录界面渲染出来，保证任何时候都不白屏；再尝试恢复上次登录
    renderLogin({ text: '正在检查登录状态…' });
    Promise.resolve()
      .then(function () { return Cloud.restore(); })
      .catch(function () { return null; })
      .then(function () {
        if (Cloud.currentUid() && isAdmin()) return loadAll();
        if (Cloud.currentUid() && !isAdmin()) {
          var who = Cloud.currentEmail();
          return Cloud.signOut().then(function () {
            renderLogin({ text: '当前浏览器登录的是 ' + who + '，不是管理员，已退出。', err: true });
          });
        }
        renderLogin();
      })
      .catch(function () { renderLogin(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.Admin = { loadAll: loadAll, isAdmin: isAdmin, ADMIN_EMAIL: ADMIN_EMAIL };
})();
