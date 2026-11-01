/**
 * test-storage.mjs —— 存档保护机制验证
 *   老版本存档自动迁移、主存档损坏后从快照恢复、主存档丢失后恢复、
 *   高版本存档只读保护、导入前留快照、导出记录时间、手动恢复快照
 *
 * 运行：NODE_PATH=<node_modules> node _tools/test-storage.mjs
 */
import { boot, helpers, wait } from './harness.mjs';

const results = [];
function ok(cond, name, extra = '') {
  results.push({ name, pass: !!cond, extra });
  console.log((cond ? '   ✅ ' : '   ❌ ') + name + (extra ? '  → ' + extra : ''));
}

const KEY = 'ebbinghaus.kids.v1';
const BAK = 'ebbinghaus.kids.bak';

/** 造一份 v1 时代的老存档（没有年级配置、没有拼音模块） */
function legacyState(name = '老档案') {
  return {
    v: 1,
    active: 'p_old',
    profiles: [{
      id: 'p_old',
      name,
      avatar: '🐻',
      created: 1760000000000,
      lastActive: 1760000000000,
      settings: { newEn: 8, newZh: 8, ttsRate: 1, ttsAuto: true, showPinyin: true, dailyGoal: 30, unitsEn: [], unitsZh: [] },
      data: {
        en_recog: { apple: { s: 3, due: '2026-11-01', c: 5, w: 1, first: '2026-10-01', last: '2026-10-20', streak: 2 } },
        en_spell: { apple: { s: 1, due: '2026-10-26', c: 1, w: 0, first: '2026-10-20', last: '2026-10-20', streak: 1 } },
        zh_recog: { '一': { s: 2, due: '2026-10-27', c: 3, w: 0, first: '2026-10-18', last: '2026-10-20', streak: 2 } },
        zh_dict: {}
      },
      log: { '2026-10-20': { total: 12, correct: 9 } }
    }]
  };
}

function readAll(w) {
  const out = {};
  for (let i = 0; i < w.localStorage.length; i++) {
    const k = w.localStorage.key(i);
    out[k] = w.localStorage.getItem(k);
  }
  return out;
}

async function main() {
  console.log('\n════════ 存档保护测试 ════════\n');

  /* ---------- 1. 老版本存档自动迁移 ---------- */
  {
    const { w, errors } = boot({ entry: 'index.html', seed: { [KEY]: JSON.stringify(legacyState()) } });
    ok(w.Store.storageMode() === 'localStorage', '① 存储可用', w.Store.storageMode());
    ok(w.Store.listProfiles().length === 1, '① 读到老存档的档案', '1 个');
    ok(w.Store.getState().v === 2, '① 存档版本自动升到 v2', 'v' + w.Store.getState().v);

    const p = w.Store.activeProfile();
    ok(p.name === '老档案', '① 档案名字保留', p.name);
    ok(p.settings.grade === 1, '① 补上年级字段（默认一年级）', 'grade=' + p.settings.grade);
    ok(p.settings.unitsPy !== undefined, '① 补上拼音范围字段');
    ok(p.data.py_recog && p.data.py_spell, '① 补上拼音模块容器');

    const rec = w.Store.getRec('en_recog', 'apple');
    ok(rec && rec.s === 3 && rec.c === 5 && rec.w === 1, '① 学习记录原样保留', `stage=${rec.s} 对${rec.c} 错${rec.w}`);
    ok(rec.due === '2026-11-01', '① 复习日期没变', rec.due);
    const zh = w.Store.getRec('zh_recog', '一');
    ok(zh && zh.s === 2, '① 中文字卡也保留', 'stage=' + zh.s);
    ok(Object.keys(p.log).length === 1 && p.log['2026-10-20'].total === 12, '① 学习日志保留');

    const info = w.Store.storageInfo();
    ok(info.source === 'main', '① 读取自「主存档」', info.source);
    ok(info.fromVersion === 1, '① 记录了迁移来源版本', 'v' + info.fromVersion);
    ok(info.cards === 3, '① 统计卡片数正确', info.cards + ' 张');

    // 迁移后应已回写，主存档里是 v2
    const stored = JSON.parse(w.localStorage.getItem(KEY));
    ok(stored.v === 2, '① 迁移结果已回写主存档', 'v' + stored.v);
    ok(errors.length === 0, '① 无运行错误');
  }

  /* ---------- 2. 主存档损坏 → 从快照恢复 ---------- */
  {
    const { w, errors } = boot({
      entry: 'index.html',
      seed: { [KEY]: '{this is not json', [BAK]: JSON.stringify(legacyState('快照档案')) }
    });
    ok(w.Store.listProfiles().length === 1, '② 主存档损坏时自动用快照', '1 个档案');
    ok(w.Store.activeProfile().name === '快照档案', '② 恢复到快照里的档案', w.Store.activeProfile().name);
    const info = w.Store.storageInfo();
    ok(info.source === 'backup', '② 标记来源为「快照」', info.source);

    const all = readAll(w);
    const corruptKeys = Object.keys(all).filter((k) => k.indexOf(KEY + '.corrupt.') === 0);
    ok(corruptKeys.length === 1, '② 损坏内容被隔离保存（没有直接丢）', corruptKeys[0] || '');
    ok(all[corruptKeys[0]] === '{this is not json', '② 隔离的是原始内容');

    const stored = JSON.parse(w.localStorage.getItem(KEY));
    ok(stored.profiles && stored.profiles.length === 1, '② 已用快照重建主存档');
    ok(errors.length === 0, '② 无运行错误');
  }

  /* ---------- 3. 主存档丢失 → 从快照恢复 ---------- */
  {
    const { w } = boot({ entry: 'index.html', seed: { [BAK]: JSON.stringify(legacyState('兜底档案')) } });
    ok(w.Store.listProfiles().length === 1, '③ 主存档被清空时从快照恢复');
    ok(w.Store.activeProfile().name === '兜底档案', '③ 档案内容正确', w.Store.activeProfile().name);
  }

  /* ---------- 4. 高版本存档：只读保护 ---------- */
  {
    const newer = legacyState('未来档案');
    newer.v = 99;
    const { w } = boot({ entry: 'index.html', seed: { [KEY]: JSON.stringify(newer) } });
    const info = w.Store.storageInfo();
    ok(info.readonly === true, '④ 检测到更高版本存档 → 只读', 'stored v' + info.storedVersion);
    ok(info.newer === 99, '④ 记录存档版本号', 'v' + info.newer);

    const before = w.localStorage.getItem(KEY);
    w.Store.save();
    w.Store.updateSettings(w.Store.activeProfile().id, { newEn: 3 });
    const after = w.localStorage.getItem(KEY);
    ok(before === after, '④ 只读模式下不会覆盖高版本存档');
    ok(JSON.parse(after).v === 99, '④ 存档版本仍是 99');
  }

  /* ---------- 5. 保存时留快照 + 手动恢复 ---------- */
  {
    const { w } = boot({ entry: 'index.html' });
    helpers(w).click('#wCreate');
    await wait(50);
    helpers(w).$('#pName').value = '第一版';
    helpers(w).click('#pSave');
    await wait(150);
    w.Store.save(true);

    const before = JSON.parse(w.localStorage.getItem(KEY));
    const p = w.Store.activeProfile();
    w.Store.updateProfile(p.id, { name: '第二版' });
    w.Store.save(true);                       // 此时「第一版」应进快照

    const bak = JSON.parse(w.localStorage.getItem(BAK));
    ok(bak.profiles[0].name === '第一版', '⑤ 保存前把上一份留成快照', bak.profiles[0].name);
    ok(JSON.parse(w.localStorage.getItem(KEY)).profiles[0].name === '第二版', '⑤ 主存档是新数据');

    w.Store.restoreFromBackup();
    ok(w.Store.activeProfile().name === '第一版', '⑤ 可以从快照恢复到上一版', w.Store.activeProfile().name);

    const all = readAll(w);
    const safety = Object.keys(all).filter((k) => k.indexOf(KEY + '.corrupt.before-restore.') === 0);
    ok(safety.length === 1, '⑤ 恢复前把当前存档另存了一份（防误操作）');
  }

  /* ---------- 6. 导出记录时间 + 导入前留快照 ---------- */
  {
    const { w } = boot({ entry: 'index.html' });
    helpers(w).click('#wCreate');
    await wait(50);
    helpers(w).$('#pName').value = '存档小明';
    helpers(w).click('#pSave');
    await wait(150);

    const dump = w.Store.exportAll();
    ok(/"schema":\s*2/.test(dump), '⑥ 导出文件带 schema 版本');
    ok(/"app":\s*"ebbinghaus-kids"/.test(dump), '⑥ 导出文件带应用标识');

    const info1 = w.Store.storageInfo();
    ok(!!info1.lastExport && Date.now() - info1.lastExport < 60000, '⑥ 导出的时间被记录');

    w.Store.importAll(dump);
    ok(w.localStorage.getItem(BAK) !== null, '⑥ 导入前自动留了一份快照');
    ok(w.Store.listProfiles().length === 1, '⑥ 导入同名档案是合并而不是重复新增', '档案数=' + w.Store.listProfiles().length);
  }

  /* ---------- 7. 界面：存档状态区 ---------- */
  {
    const { w } = boot({ entry: 'index.html' });
    helpers(w).click('#wCreate');
    await wait(50);
    helpers(w).$('#pName').value = '界面测试';
    helpers(w).click('#pSave');
    await wait(150);
    w.location.hash = '#/me';
    w.App.render();
    await wait(60);
    const t = w.document.body.textContent.replace(/\s+/g, ' ');
    ok(/存档版本：v2/.test(t), '⑦ 我的页显示存档版本');
    ok(/已记录 1 个小朋友/.test(t), '⑦ 我的页显示档案与卡片数');
    ok(/上次导出：/.test(t), '⑦ 我的页显示上次导出时间');
    ok(!!helpers(w).$('#btnRestore'), '⑦ 我的页有「从上一版快照恢复」按钮');
  }

  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  console.log('\n────────────────────────────────────────');
  console.log(`合计：${pass} 通过 / ${fail} 失败 / 共 ${results.length} 项`);
  if (fail) {
    results.filter((r) => !r.pass).forEach((r) => console.log('  - ' + r.name + '  ' + r.extra));
    process.exitCode = 1;
  }
  console.log('────────────────────────────────────────\n');
}

main().catch((e) => {
  console.error('测试异常：', e);
  process.exit(1);
});
