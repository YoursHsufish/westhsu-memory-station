/* 发音模块测试（speech.js）
 *
 * 用假的 Audio 元素记录"到底播了哪几个音节、按什么顺序"，
 * 这样不开声音也能验证：拼音转音节、词语拆音节、字+词连读、缺音频时回退 TTS。
 *
 * 运行：NODE_PATH=<node_modules> node _tools/test-speech.mjs
 */
import { boot, wait } from './harness.mjs';

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? '  →  ' + extra : '')); }
  else { fail++; failures.push(name); console.log('  ❌ ' + name + (extra ? '  →  ' + extra : '')); }
}

/** 假 Audio：赋值 src 就记一条，然后异步触发 onended（模拟播放结束） */
function fakeAudio() {
  return class FakeAudio {
    constructor() {
      this._src = '';
      this.state = [];
      this.log = [];
    }
    set src(v) {
      this._src = v;
      if (v && v.indexOf('data:') !== 0) {
        FakeAudio.log.push(v);          // 记录真正播放的音节
        setTimeout(() => { if (this.onended) this.onended(); }, 1);
      }
    }
    get src() { return this._src; }
    play() { return Promise.resolve(); }
    pause() {}
    setAttribute() {}
  };
}

function mk(opts) {
  opts = opts || {};
  const files = ['js/data-zh.js', 'js/py-dict.js', 'js/audio-manifest.js', 'js/en-audio-manifest.js', 'js/speech.js'];
  const shared = { log: [], spoken: [] };
  const A = fakeAudio();
  A.log = shared.log;
  const { w, errors } = boot({
    entry: 'print.html',
    scripts: files,
    audio: opts.noAudio ? null : () => A,
    before: (win) => {
      // 假的 speechSynthesis 必须在 speech.js 执行前挂上
      win.speechSynthesis = {
        getVoices: () => [{ name: 'Fake zh', lang: 'zh-CN', localService: true }],
        speak: (u) => {
          if (String(u.text).trim()) shared.spoken.push(u.text);
          setTimeout(() => { if (u.onend) u.onend(); }, 1);
        },
        cancel: () => {},
        onvoiceschanged: null
      };
      win.SpeechSynthesisUtterance = function (text) {
        this.text = text; this.lang = ''; this.rate = 1; this.pitch = 1; this.volume = 1;
      };
    }
  });
  return { w, spoken: shared.spoken, log: shared.log, errors, A };
}

async function main() {
  console.log('=== 发音模块测试 ===\n');

  /* A. 拼音 → 音节 key */
  {
    const { w } = mk();
    const S = w.Speech;
    ok(S.syllableKey('zhōng') === 'zhong1', 'A1 zhōng → zhong1', S.syllableKey('zhōng'));
    ok(S.syllableKey('de') === 'de5', 'A2 轻声 de → de5', S.syllableKey('de'));
    ok(S.syllableKey('lǜ') === 'luu4', 'A3 ü 记作 uu：lǜ → luu4', S.syllableKey('lǜ'));
    ok(S.syllableKey('lüè') === 'luue4', 'A4 lüè → luue4', S.syllableKey('lüè'));
    ok(S.syllableKey('ér') === 'er2', 'A5 ér → er2', S.syllableKey('ér'));
    ok(S.syllableKey('') === null, 'A6 空字符串返回 null');
    ok(S.syllableKey('123') === null, 'A7 纯数字返回 null');
  }

  /* B. 音节清单 */
  {
    const { w } = mk();
    const S = w.Speech;
    ok(S.audioInfo().syllables > 700, 'B1 内置音节数 > 700', S.audioInfo().syllables + ' 个');
    ok(S.hasSyl('zhong1') === true, 'B2 zhong1 有音频');
    ok(S.hasSyl('biao1') === false, 'B3 上游缺的 biao1 判为没有音频', '（缺 12 个里的一个）');
  }

  /* C. 词语拆音节 */
  {
    const { w } = mk();
    const S = w.Speech;
    const k = S.wordKeys('中国');
    ok(Array.isArray(k) && k.length === 2, 'C1 「中国」拆成 2 个音节', JSON.stringify(k));
    ok(k && k[0] === 'zhong1', 'C2 第一个音节是 zhong1', k && k[0]);
    ok(S.wordKeys('Hello') === null, 'C3 含非汉字返回 null（交给 TTS）');
    ok(S.wordKeys('') === null, 'C4 空词返回 null');
    ok(S.firstWord('的话、的确、的哥') === '的话', 'C5 取第一个组词', S.firstWord('的话、的确、的哥'));
    ok(S.firstWord('') === '', 'C6 没有组词时返回空串');
  }

  /* D. 字 + 组词连读：先读音节，再读词的音节 */
  {
    const { w, log } = mk();
    const S = w.Speech;
    const card = { c: '中', pinyin: 'zhōng', words: '中国、中间' };
    S.speakZhCard(card, {});
    await wait(600);
    const seq = log.map((u) => u.split('/').pop().replace('.mp3', ''));
    ok(seq.length >= 3, 'D1 播了「中」+「中国」共 3 个音节', seq.join(' → '));
    ok(seq[0] === 'zhong1', 'D2 先读字音 zhong1', seq[0]);
    ok(seq[1] === 'zhong1' && seq[2] === 'guo2', 'D3 再读组词「中国」', seq.slice(1).join('+'));
    ok(log.every((u) => u.indexOf('assets/audio/py/') >= 0), 'D4 音频路径正确', log[0]);
  }

  /* E. 单个词连读 */
  {
    const { w, log } = mk();
    w.Speech.speakZhWord('中国');
    await wait(300);
    const seq = log.map((u) => u.split('/').pop().replace('.mp3', ''));
    ok(seq.join(',') === 'zhong1,guo2', 'E1 「中国」= zhong1 + guo2', seq.join(','));
  }

  /* F. 没有音频时回退 TTS（单文件版 / 老浏览器） */
  {
    const { w, spoken } = mk({ noAudio: true });
    const S = w.Speech;
    ok(S.audioInfo().audio === false, 'F1 关掉音频后 audioInfo 反映出来');
    S.speakZhCard({ c: '中', pinyin: 'zhōng', words: '中国' }, {});
    await wait(300);
    ok(spoken.length === 1, 'F2 只读了一条 TTS', spoken.length + ' 条');
    ok(/中/.test(spoken[0]) && /中国/.test(spoken[0]), 'F3 TTS 文本同时含字和组词', spoken[0]);
  }

  /* G. 缺音频的音节：整词回退 TTS，不会只读半个词 */
  {
    const { w, log, spoken } = mk();
    w.Speech.speakZhWord('标准');   // 标 = biao1，上游没这个音节
    await wait(200);
    ok(log.length === 0, 'G1 有字缺音频时不播半个词', log.length + ' 个音节');
    ok(spoken.length === 1 && /标准/.test(spoken[0]), 'G2 改由 TTS 读整词', spoken[0]);
  }

  /* H. 英语：优先内置离线音频，缺音频时回退 TTS */
  {
    const { w, log, spoken } = mk();
    w.Speech.speakEn('apple', 0.9);
    await wait(200);
    ok(log.some((u) => u.indexOf('assets/audio/en/') >= 0 && /apple\.mp3/.test(u)),
      'H1 英语单词优先播内置离线音频', log.join('|'));
    ok(spoken.length === 0, 'H2 有内置音频时不调用系统 TTS', spoken.join('|'));
  }
  {
    const { w, log, spoken } = mk();
    w.Speech.speakEn('not_in_dictionary_xyz', 0.9);
    await wait(1000);
    ok(spoken.indexOf('not_in_dictionary_xyz') >= 0, 'H3 词库外单词回退系统 TTS', spoken.join('|'));
    ok(!log.some((u) => u.indexOf('assets/audio/en/') >= 0), 'H4 词库外不播不存在的音频');
  }
  {
    const { w, log } = mk({ noAudio: true });
    w.Speech.speakEn('apple', 0.9);
    await wait(1000);
    ok(!log.some((u) => u.indexOf('assets/audio/en/') >= 0), 'H5 单文件版（无音频目录）不播离线音频');
  }

  /* I. stop() 能打断后续音节 */
  {
    const { w, log } = mk();
    w.Speech.speakZhWord('中国');
    w.Speech.stop();
    const n = log.length;
    await wait(120);
    ok(log.length <= n + 1, 'I1 stop 之后不再继续播放', log.length + ' 个');
  }

  /* J. 容错：卡片字段缺失也不报错 */
  {
    const { w, errors } = mk();
    const S = w.Speech;
    let threw = false;
    try {
      S.speakZhCard(null, {});
      S.speakZhWord('');
      S.speakZhChar('', '', '');
      S.speakZhCard({ c: '𠀀' }, {});      // 生僻字，查不到拼音
      S.speakPyCard({ c: '玻', word: '玻璃' }, {});
      S.unlock();
      S.stop();
    } catch (e) { threw = true; }
    ok(!threw, 'J1 空卡片 / 生僻字 / 缺字段都不抛异常');
    ok(errors.length === 0, 'J2 全程无 JS 运行错误', errors.slice(0, 1).join(''));
  }

  /* K. 语速与重复 */
  {
    const { w, log } = mk();
    w.Speech.speakZhChar('中', 'zhōng', '中国', { repeat: true });
    await wait(1400);
    const seq = log.map((u) => u.split('/').pop().replace('.mp3', ''));
    ok(seq.length >= 6, 'K1 repeat 时字和词各读两遍', seq.join(','));
  }

  console.log('\n合计：' + pass + ' 通过 / ' + fail + ' 失败 / 共 ' + (pass + fail) + ' 项');
  if (fail) { console.log('失败项：' + failures.join('；')); process.exit(1); }
}

main().catch((e) => {
  console.error('测试异常：', e && (e.stack || e.message));
  process.exit(1);
});
