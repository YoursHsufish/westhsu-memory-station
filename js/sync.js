/*!
 * sync.js —— 「把进度搬到云端」页面的逻辑
 *
 * 三步：选备份文件 → 登录 → 合并并上传 → 核对
 * 合并走 Store.importAll（逐张卡片按最近学习日取新），上传走 Cloud.syncNow。
 */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var MODS = ['en_recog', 'en_spell', 'zh_recog', 'zh_dict', 'py_recog', 'py_spell'];
  var MOD_CN = {
    en_recog: '英语认词', en_spell: '英语拼写', zh_recog: '中文认字',
    zh_dict: '中文听写', py_recog: '拼音认读', py_spell: '拼音拼写'
  };

  var backupText = '';
  var backupProfiles = null;
  var pending = null;
  var signedIn = false;

  /* ---------------- 工具 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function countCards(profiles) {
    var n = 0;
    (profiles || []).forEach(function (p) {
      MODS.forEach(function (m) { n += Object.keys((p.data && p.data[m]) || {}).length; });
    });
    return n;
  }

  function setStep(n, state) {
    var el = $('#step' + n);
    if (!el) return;
    el.classList.toggle('on', state === 'on');
    el.classList.toggle('done', state === 'done');
    var card = $('#card' + n);
    if (card) card.classList.toggle('dim', state === 'off' || state === 'wait');
  }

  function err(msg, id) {
    var el = $(id || '#err');
    if (el) el.textContent = msg || '';
  }

  /* ---------------- 第 1 步：读文件 ---------------- */
  function handleFile(file) {
    if (!file) return;
    var rd = new FileReader();
    rd.onload = function () {
      var text = String(rd.result);
      var obj;
      try {
        obj = JSON.parse(text);
      } catch (e) {
        err('这个文件不是有效的备份文件（无法解析 JSON）', '#s1note');
        return;
      }
      var data = obj && obj.data ? obj.data : obj;
      if (!data || !data.profiles || !data.profiles.length) {
        err('文件里没有找到小朋友档案，可能选错了文件', '#s1note');
        return;
      }
      backupText = text;
      backupProfiles = data.profiles;
      renderPreview(data, file.name);
      enableStep2();
    };
    rd.onerror = function () { err('文件读取失败，请重试', '#s1note'); };
    rd.readAsText(file);
  }

  function renderPreview(data, fileName) {
    var total = countCards(data.profiles);
    var html = '';
    data.profiles.forEach(function (p) {
      var n = countCards([p]);
      html += '<div class="row"><span>' + esc(p.avatar || '🐣') + ' ' + esc(p.name) +
        '<span style="color:var(--ink-3);font-size:11.5px"> · ' +
        (p.settings && p.settings.grade ? p.settings.grade + ' 年级' : '') + '</span></span>' +
        '<b>' + n + ' 张</b></div>';
    });
    html += '<div class="row" style="border-top:1px solid var(--line);margin-top:4px;padding-top:8px">' +
      '<span>合计</span><span class="total">' + data.profiles.length + ' 个档案 / ' + total + ' 张卡片</span></div>';

    var pv = $('#preview');
    pv.innerHTML = html;
    pv.hidden = false;

    var nt = $('#s1note');
    nt.textContent = '来源：' + fileName + '（备份导出于 ' +
      (data.exportedAt ? String(data.exportedAt).slice(0, 10) : '未知日期') + '）';
    nt.hidden = false;
    nt.style.color = 'var(--ink-3)';

    $('#s1hint').textContent = '已读取';
    setStep(1, 'done');
  }

  /* ---------------- 第 2 步：登录 ---------------- */
  function enableStep2() {
    setStep(2, 'on');
    $('#s2hint').textContent = signedIn ? '已登录' : '待登录';
  }

  function enableStep3() {
    setStep(2, 'done');
    setStep(3, 'on');
    $('#s2hint').textContent = '已登录';
    $('#s3hint').textContent = '待上传';
    $('#email').disabled = true;
    $('#sendBtn').hidden = true;
    $('#verifyBtn').hidden = true;
    $('#codeField').hidden = true;
    err('');
  }

  function sendCode() {
    var email = ($('#email').value || '').trim();
    err('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err('请填写正确的邮箱地址'); return; }
    var btn = $('#sendBtn');
    btn.disabled = true;
    btn.textContent = '发送中…';
    Cloud.sendCode(email).then(function (p) {
      pending = p;
      $('#codeField').hidden = false;
      $('#verifyBtn').hidden = false;
      btn.textContent = '重新发送验证码';
      btn.disabled = false;
      $('#code').focus();
      err('');
      $('#s2hint').textContent = '验证码已发送';
    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = '获取验证码';
      err(String(e.message || e));
    });
  }

  function verify() {
    var code = ($('#code').value || '').trim();
    err('');
    if (!code) { err('请输入收到的验证码'); return; }
    var btn = $('#verifyBtn');
    btn.disabled = true;
    btn.textContent = '验证中…';
    Cloud.verifyCode(pending, code).then(function (res) {
      signedIn = true;
      enableStep3();
      var tip = $('#s1hint');
      if (tip) tip.textContent = '已读取';
    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = '完成登录';
      err(String(e.message || e));
    });
  }

  /* ---------------- 第 3 步：合并并上传 ---------------- */
  function doSync() {
    $('#syncIdle').hidden = true;
    $('#syncBusy').hidden = false;
    $('#busyText').textContent = '正在合并到本机…';

    var localBefore = Store.listProfiles().length;
    var cardsBefore = countCards(Store.listProfiles());

    var merged;
    try {
      merged = Store.importAll(backupText);
    } catch (e) {
      $('#syncBusy').hidden = true;
      $('#syncIdle').hidden = false;
      err('合并失败：' + (e.message || e), '#s3hint');
      return;
    }

    $('#busyText').textContent = '正在上传到云端…';
    Cloud.syncNow({ force: true }).then(function () {
      return Cloud.countRemote();
    }).then(function (remoteRows) {
      renderDone(merged, localBefore, cardsBefore, remoteRows);
    }).catch(function (e) {
      $('#syncBusy').hidden = true;
      $('#syncIdle').hidden = false;
      var msg = String(e && (e.message || e) || '未知错误');
      $('#s3hint').textContent = '上传失败';
      $('#s3hint').style.color = '#d92b52';
      err('上传失败：' + msg + '（本机进度已合并好，重新点一次上传即可）', '#s3hint');
    });
  }

  function renderDone(merged, localBefore, cardsBefore, remoteRows) {
    var profiles = Store.listProfiles();
    var cards = countCards(profiles);
    var fp = Store.fingerprint();

    $('#syncBusy').hidden = true;
    var box = $('#syncDone');
    var ok = remoteRows >= profiles.length;

    box.innerHTML =
      '<div class="sy-result">' +
      '<div class="ico">' + (ok ? '✅' : '⚠️') + '</div>' +
      '<h3>' + (ok ? '已上传到云端' : '本机已合并，云端待确认') + '</h3>' +
      '<div style="font-size:12.5px;color:var(--ink-3)">' +
      (ok ? '换手机、换电脑用同一邮箱登录就能接着学' : '云端只回读到 ' + remoteRows + ' 条，稍后可在「我的 → 账号与云端」点立即同步') +
      '</div>' +
      '</div>' +
      '<div class="sy-kv">' +
      '<div class="row"><span>本次从备份合并</span><b>' + merged.profiles + ' 个档案 / ' + merged.cards + ' 张卡</b></div>' +
      '<div class="row"><span>本机档案数</span><b>' + localBefore + ' → ' + profiles.length + '</b></div>' +
      '<div class="row"><span>本机卡片数</span><b>' + cardsBefore + ' → ' + cards + '</b></div>' +
      '<div class="row"><span>云端回读</span><b>' + remoteRows + ' 条档案</b></div>' +
      '<div class="row"><span>数据指纹</span><b class="fp">' + fp + '</b></div>' +
      '</div>' +
      '<div style="height:14px"></div>' +
      '<a class="btn btn-primary btn-block btn-lg" href="index.html">去开始学习</a>' +
      '<div style="height:8px"></div>' +
      '<button class="btn btn-ghost btn-block" id="againBtn">再上传一次</button>';

    box.hidden = false;
    $('#s3hint').textContent = ok ? '已完成' : '待确认';
    setStep(3, 'done');
    var ab = $('#againBtn');
    if (ab) ab.onclick = function () {
      box.hidden = true;
      $('#syncIdle').hidden = false;
      doSync();
    };
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    Store.load();

    // 显示程序版本，方便确认"是不是跑到了最新代码"
    var vl = document.getElementById('verLine');
    if (vl) {
      var m = window.APP_META || {};
      vl.textContent = '程序版本 v' + (m.version || '?') + ' · 构建 ' + (m.build || '?');
    }

    /* 文件选择与拖拽 */
    var drop = $('#drop');
    var input = $('#file');
    drop.onclick = function () { input.click(); };
    input.onchange = function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) handleFile(f);
    };
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault();
        drop.classList.add('over');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault();
        drop.classList.remove('over');
      });
    });
    drop.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f);
    });

    $('#sendBtn').onclick = sendCode;
    $('#verifyBtn').onclick = verify;
    $('#code').onkeydown = function (e) { if (e.key === 'Enter') verify(); };
    $('#email').onkeydown = function (e) { if (e.key === 'Enter') sendCode(); };
    $('#syncBtn').onclick = doSync;

    setStep(2, 'wait');
    setStep(3, 'wait');

    /* 如果之前已经登录过，直接允许跳到第 3 步 */
    if (Cloud && Cloud.originUsable()) {
      Cloud.restore().then(function (already) {
        if (already) {
          signedIn = true;
          $('#email').value = (Cloud.status().email || $('#email').value);
          $('#s2hint').textContent = '已登录';
          if (backupProfiles) enableStep3();
          else {
            // 还没选文件，但已登录：第 2 步标为完成，等第 1 步
            setStep(2, 'done');
            $('#s2hint').textContent = '已登录';
            $('#email').disabled = true;
            $('#sendBtn').hidden = true;
            $('#codeField').hidden = true;
            $('#verifyBtn').hidden = true;
          }
        }
      }, function () {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
