/**
 * build-migration-page.mjs —— 生成「一键迁移」页面
 *
 * 用法：node _tools/build-migration-page.mjs _migration/edge-backup-2026-10-25.json
 * 产物：一键迁移到360.html（内嵌备份数据，打开即自动写入当前浏览器的 localStorage）
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const rel = process.argv[2] || '_migration/edge-backup-2026-10-25.json';
const backupPath = path.resolve(ROOT, rel);
const raw = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
const data = raw.data || raw;
const OUT = path.join(path.dirname(ROOT), '一键迁移到360.html');

const payload = JSON.stringify(data);

const html = `<!DOCTYPE html>
<!--
  记忆小站 · 存档迁移页（一次性工具，用完可删）
  作用：把内嵌的备份数据合并写入当前浏览器的 localStorage。
  注意：必须用「记忆小站.html 所在的同一浏览器」打开本页，否则写入的是另一个浏览器的数据。
-->
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>记忆小站 · 存档迁移</title>
<style>
  :root { --ink:#1b2340; --ink2:#4a5470; --ink3:#8b93aa; --line:#e7ecf7; --primary:#4f6bff; --mint:#12906f; --rose:#d92b52; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif; background:#f4f7ff; color:var(--ink); padding:24px 16px 40px; }
  .wrap { max-width:640px; margin:0 auto; }
  .card { background:#fff; border-radius:22px; padding:22px; box-shadow:0 10px 30px rgba(40,62,120,.10); border:1px solid var(--line); margin-bottom:14px; }
  h1 { font-size:20px; margin:0 0 4px; }
  .sub { color:var(--ink3); font-size:13px; margin:0 0 16px; }
  .row { display:flex; justify-content:space-between; padding:9px 0; border-bottom:1px dashed var(--line); font-size:13.5px; }
  .row:last-child { border-bottom:none; }
  .k { color:var(--ink2); }
  .v { font-weight:700; }
  .fp { font-family:ui-monospace,Consolas,monospace; font-size:22px; letter-spacing:2px; color:var(--primary); }
  .ok { background:#e8f8f2; color:var(--mint); border-radius:14px; padding:12px 14px; font-size:14px; font-weight:700; text-align:center; }
  .warn { background:#fff7e6; color:#8a5300; border:1px solid #ffe0b2; border-radius:14px; padding:12px 14px; font-size:13px; line-height:1.7; }
  .err { background:#ffecef; color:var(--rose); border-radius:14px; padding:12px 14px; font-size:13px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:7px 4px; border-bottom:1px solid var(--line); }
  th { color:var(--ink3); font-weight:600; font-size:12px; }
  .btn { display:block; width:100%; padding:14px; border-radius:14px; border:none; font-size:15px; font-weight:700; cursor:pointer; margin-top:10px; }
  .btn-primary { background:linear-gradient(135deg,#5b7cff,#7b5cf6); color:#fff; }
  .btn-ghost { background:#f2f5fc; color:var(--ink2); }
  code { background:#f2f5fc; padding:1px 5px; border-radius:5px; font-size:12.5px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1>🌱 记忆小站 · 存档迁移</h1>
    <p class="sub">正在把 Edge 里的学习进度写入当前浏览器…</p>
    <div id="status">处理中…</div>
  </div>
  <div class="card" id="detail" style="display:none"></div>
  <div class="card" id="next" style="display:none"></div>
</div>

<script>
var BACKUP = ${payload};          // 内嵌的备份数据（来自 Edge）
var KEY = 'ebbinghaus.kids.v1';
var BAK = 'ebbinghaus.kids.bak';
var MODS = ['en_recog','en_spell','zh_recog','zh_dict','py_recog','py_spell'];

function countCards(st) {
  var n = 0;
  ((st && st.profiles) || []).forEach(function (p) {
    MODS.forEach(function (m) { n += Object.keys((p.data && p.data[m]) || {}).length; });
  });
  return n;
}

function fingerprint(st) {
  var parts = [];
  ((st && st.profiles) || []).forEach(function (p) {
    MODS.forEach(function (m) {
      var recs = (p.data && p.data[m]) || {};
      Object.keys(recs).forEach(function (id) {
        var r = recs[id] || {};
        parts.push(p.name + '|' + m + '|' + id + '|' + (r.s || 0) + '|' + (r.due || ''));
      });
    });
  });
  parts.sort();
  var str = parts.join(';');
  var h = 0x811c9dc5;
  for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return ('0000000' + h.toString(16).toUpperCase()).slice(-8);
}

function newId() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

/** 同一条记录取较新的一份（按 last 日期，其次 stage） */
function mergeRec(a, b) {
  if (!a) return b;
  if (!b) return a;
  var la = a.last || '', lb = b.last || '';
  if (la !== lb) return la > lb ? a : b;
  return (b.s || 0) > (a.s || 0) ? b : a;
}

function mergeInto(local, incoming) {
  var log = { added: 0, merged: 0, kept: 0, rows: [] };
  (incoming.profiles || []).forEach(function (src) {
    var exist = (local.profiles || []).filter(function (p) { return p.name === src.name; })[0];
    if (!exist) {
      var cp = JSON.parse(JSON.stringify(src));
      cp.id = newId();
      local.profiles.push(cp);
      log.added += 1;
      log.rows.push({ name: cp.name, cards: countCardsOne(cp), action: '新增' });
      return;
    }
    var before = countCardsOne(exist);
    MODS.forEach(function (m) {
      exist.data = exist.data || {};
      exist.data[m] = exist.data[m] || {};
      var s = (src.data && src.data[m]) || {};
      Object.keys(s).forEach(function (id) { exist.data[m][id] = mergeRec(exist.data[m][id], s[id]); });
    });
    exist.log = exist.log || {};
    Object.keys(src.log || {}).forEach(function (d) { if (!exist.log[d]) exist.log[d] = src.log[d]; });
    log.merged += 1;
    log.rows.push({ name: exist.name, cards: countCardsOne(exist), action: '合并（+' + (countCardsOne(exist) - before) + ' 张）', before: before });
  });
  return log;
}

function countCardsOne(p) {
  var n = 0;
  MODS.forEach(function (m) { n += Object.keys((p.data && p.data[m]) || {}).length; });
  return n;
}

function setStatus(html, cls) {
  document.getElementById('status').innerHTML = '<div class="' + (cls || '') + '">' + html + '</div>';
}

function run() {
  var localRaw = null, local = { v: 1, active: null, profiles: [] };
  try { localRaw = localStorage.getItem(KEY); } catch (e) {
    setStatus('当前浏览器禁止本地存储，无法自动写入。<br>请改用：记忆小站 → 我的 → 导入备份，选择 edge-backup-2026-10-25.json。', 'err');
    return;
  }
  if (localRaw) {
    try { local = JSON.parse(localRaw); } catch (e) { local = { v: 1, active: null, profiles: [] }; }
  }
  if (!local.profiles) local.profiles = [];

  var beforeProfiles = local.profiles.length;
  var beforeCards = countCards(local);
  var beforeFp = fingerprint(local);

  var log = mergeInto(local, BACKUP);
  if (!local.active) local.active = (local.profiles[0] || {}).id || null;

  try {
    if (localRaw) localStorage.setItem(BAK, localRaw);   // 写入前留一份旧存档
    localStorage.setItem(KEY, JSON.stringify(local));
  } catch (e) {
    setStatus('写入失败：' + e.message + '<br>可能是浏览器存储空间不足或处于无痕模式。', 'err');
    return;
  }

  var afterCards = countCards(local);
  var afterFp = fingerprint(local);

  setStatus('✅ 迁移完成', 'ok');

  var html = '<table>' +
    '<tr><th>档案</th><th>卡片数</th><th>处理</th></tr>' +
    log.rows.map(function (r) {
      return '<tr><td>' + r.name + '</td><td>' + r.cards + '</td><td>' + r.action + '</td></tr>';
    }).join('') +
    '</table>' +
    '<div style="margin-top:14px">' +
    '<div class="row"><span class="k">写入前</span><span class="v">' + beforeProfiles + ' 个档案 / ' + beforeCards + ' 张卡片</span></div>' +
    '<div class="row"><span class="k">写入后</span><span class="v">' + local.profiles.length + ' 个档案 / ' + afterCards + ' 张卡片</span></div>' +
    '<div class="row"><span class="k">数据指纹</span><span class="v fp">' + afterFp + '</span></div>' +
    '<div class="row"><span class="k">写入前指纹</span><span class="v" style="color:#8b93aa">' + beforeFp + '</span></div>' +
    '</div>';
  document.getElementById('detail').innerHTML = html;
  document.getElementById('detail').style.display = 'block';

  document.getElementById('next').innerHTML =
    '<h1 style="font-size:16px;margin-bottom:8px">下一步</h1>' +
    '<p class="sub" style="margin-bottom:10px">关闭本页，打开 <code>记忆小站.html</code>，在「我的 → 存档」里核对：</p>' +
    '<div class="row"><span class="k">应看到</span><span class="v">' + local.profiles.length + ' 个小朋友 / ' + afterCards + ' 张卡片</span></div>' +
    '<div class="row"><span class="k">数据指纹应为</span><span class="v fp">' + afterFp + '</span></div>' +
    '<div class="warn" style="margin-top:12px">这两个数字（卡片数、指纹）与灰色「写入前」不同是正常的；' +
    '它们应该与 Edge 里「我的 → 存档」显示的<b>卡片数</b>一致、指纹也一致（Edge 那边也升级到 v1.3.2 后可看到指纹）。</div>' +
    '<button class="btn btn-ghost" onclick="window.close()">关闭本页</button>';
  document.getElementById('next').style.display = 'block';

  window.__MIGRATION_DONE = { profiles: local.profiles.length, cards: afterCards, fingerprint: afterFp };
}

run();
</script>
</body>
</html>
`;

fs.writeFileSync(OUT, html, 'utf8');
console.log('已生成迁移页：' + OUT);
console.log('内嵌备份：' + rel + '（' + (fs.statSync(backupPath).size / 1024).toFixed(1) + ' KB）');
console.log('备份内档案：' + (data.profiles || []).map((p) => p.name).join('、'));
