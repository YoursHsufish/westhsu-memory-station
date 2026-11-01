# -*- coding: utf-8 -*-
"""
build-audio.py —— 生成拼音音节音频资产

数据来源：davinfifield/mp3-chinese-pinyin-sound（Unlicense，公有领域）
  https://github.com/davinfifield/mp3-chinese-pinyin-sound
  文件名规则：<不带声调的拼音><声调>.mp3，轻声为 5，ü 写作 uu（lǜ = luu4，lüè = luue4）

做法：
  1. 从 js/data-zh.js（1200 字，带声调拼音）和 js/data-py.js（400 条）里收集
     “实际会用到的音节”，只下载这些，避免把 30 MB 全量塞进仓库；
     再统一转成 16 kHz 单声道 32 kbps 并裁掉首尾静音，约 5 KB/个（原 19 KB）；
  2. 组词/例词里出现的、不在 1200 字表内的汉字，用 pypinyin 补一份
     字→拼音 映射，写到 js/py-dict.js，供前端把词语拆成音节连读；
  3. 输出 assets/audio/py/*.mp3 与 js/audio-manifest.js（可用音节清单）。

用法：
  python _tools/build-audio.py            # 干跑：只统计，不下载
  python _tools/build-audio.py --write    # 真正下载并写文件
"""
import json
import os
import re
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = 'https://raw.githubusercontent.com/davinfifield/mp3-chinese-pinyin-sound/master/mp3/%s.mp3'
TREE = 'https://api.github.com/repos/davinfifield/mp3-chinese-pinyin-sound/git/trees/master?recursive=1'
OUT_DIR = os.path.join(ROOT, 'assets', 'audio', 'py')
# 远端文件清单缓存在工程目录之外，避免把内部清单一起发布出去
CACHE = os.path.join(os.path.dirname(ROOT), '_private', 'cache')

# 带声调 → (无声调, 声调)
TONE_TABLE = {
    'ā': ('a', 1), 'á': ('a', 2), 'ǎ': ('a', 3), 'à': ('a', 4),
    'ē': ('e', 1), 'é': ('e', 2), 'ě': ('e', 3), 'è': ('e', 4),
    'ī': ('i', 1), 'í': ('i', 2), 'ǐ': ('i', 3), 'ì': ('i', 4),
    'ō': ('o', 1), 'ó': ('o', 2), 'ǒ': ('o', 3), 'ò': ('o', 4),
    'ū': ('u', 1), 'ú': ('u', 2), 'ǔ': ('u', 3), 'ù': ('u', 4),
    'ǖ': ('uu', 1), 'ǘ': ('uu', 2), 'ǚ': ('uu', 3), 'ǜ': ('uu', 4),
    'ü': ('uu', 5),
    'ń': ('n', 2), 'ň': ('n', 3), 'ǹ': ('n', 4), 'ḿ': ('m', 2),
    'ê': ('e', 1),
}


def pinyin_key(py):
    """'zhōng' -> 'zhong1'；'de' -> 'de5'（轻声）"""
    py = (py or '').strip().lower()
    if not py:
        return None
    buf, tone = [], 5
    for ch in py:
        if ch in TONE_TABLE:
            base, tn = TONE_TABLE[ch]
            buf.append(base)
            if tn != 5:
                tone = tn
        elif ch.isalpha():
            buf.append(ch)
        # 其它字符（空格、数字、标点）丢弃
    base = ''.join(buf)
    if not base:
        return None
    return '%s%d' % (base, tone)


def load_js_array(filename, var):
    """从 js/*.js 里抠出 window.XXX = [...]; 的 JSON"""
    src = open(os.path.join(ROOT, filename), encoding='utf-8').read()
    m = re.search(re.escape('window.%s' % var) + r'\s*=\s*(\[[\s\S]*\])\s*;', src)
    if not m:
        raise SystemExit('无法从 %s 解析 %s' % (filename, var))
    return json.loads(m.group(1))


def split_words(s):
    """组词字段 '的话、的确、的哥' -> ['的话','的确','的哥']"""
    if not s:
        return []
    return [w.strip() for w in re.split(r'[、,，/；;|]', str(s)) if w.strip()]


def main():
    write = '--write' in sys.argv
    zh_units = load_js_array('js/data-zh.js', 'ZH_UNITS')
    py_units = load_js_array('js/data-py.js', 'PY_UNITS')

    # ---------- 1. 汉字 → 拼音 ----------
    char_py = {}
    for u in zh_units:
        for a in u['words']:
            char_py.setdefault(a[0], a[1])

    # ---------- 2. 需要发音的“词” ----------
    words = set()
    for u in zh_units:
        for a in u['words']:
            for w in split_words(a[5] if len(a) > 5 else ''):
                words.add(w)
    for u in py_units:
        for a in u['words']:
            if len(a) > 2 and a[2]:
                for w in split_words(a[2]):
                    words.add(w)

    # ---------- 3. 词里出现的、1200 字表外的字，用 pypinyin 补 ----------
    extra = {}
    try:
        from pypinyin import pinyin, Style
    except ImportError:
        pinyin = None
        print('⚠ 没装 pypinyin，跳过补字表（pip install pypinyin）')

    missing_chars = set()
    for w in words:
        for ch in w:
            if not ('\u4e00' <= ch <= '\u9fff'):
                continue
            if ch in char_py:
                continue
            missing_chars.add(ch)
    if pinyin and missing_chars:
        for ch in sorted(missing_chars):
            try:
                r = pinyin(ch, style=Style.TONE, heteronym=False)
                extra[ch] = r[0][0]
            except Exception:
                pass

    # ---------- 4. 收集音节 ----------
    need = set()
    for py in char_py.values():
        k = pinyin_key(py)
        if k:
            need.add(k)
    for py in extra.values():
        k = pinyin_key(py)
        if k:
            need.add(k)

    # ---------- 4.5 多音字词：整词读音与逐字主读音不同的单独记一份 ----------
    word_fix = {}
    if pinyin:
        for w in sorted(words):
            if len(w) < 2:
                continue
            try:
                ph = [x[0] for x in pinyin(w, style=Style.TONE, heteronym=False)]
            except Exception:
                continue
            if len(ph) != len(w):
                continue
            naive, ok = [], True
            for ch in w:
                if not ('\u4e00' <= ch <= '\u9fff'):
                    ok = False
                    break
                py = char_py.get(ch) or extra.get(ch)
                if not py:
                    ok = False
                    break
                naive.append(py)
            if not ok or ph == naive:
                continue
            keys = [pinyin_key(x) for x in ph]
            if all(keys):
                word_fix[w] = ' '.join(keys)
        print('多音字词修正：%d 条' % len(word_fix))

    # ---------- 5. 对照远端文件清单 ----------
    os.makedirs(CACHE, exist_ok=True)
    tree_file = os.path.join(CACHE, 'py-tree.json')
    if not os.path.exists(tree_file):
        print('拉取远端文件清单…')
        with urllib.request.urlopen(TREE, timeout=60) as r:
            open(tree_file, 'wb').write(r.read())
    tree = json.load(open(tree_file, encoding='utf-8'))
    avail = {}
    for t in tree['tree']:
        p = t['path']
        if p.startswith('mp3/') and p.endswith('.mp3'):
            avail[p[4:-4]] = t.get('size', 0)

    have = sorted(k for k in need if k in avail)
    lack = sorted(k for k in need if k not in avail)
    total = sum(avail[k] for k in have)

    print('汉字 %d 个 · 词 %d 个 · 补充字 %d 个' % (len(char_py), len(words), len(extra)))
    print('需要音节 %d 个：可下载 %d 个（约 %.1f MB），缺 %d 个' % (
        len(need), len(have), total / 1048576.0, len(lack)))
    if lack:
        print('  缺失：' + ', '.join(lack))
    cov_char = sum(1 for py in char_py.values() if pinyin_key(py) in avail)
    print('汉字覆盖率：%d / %d = %.1f%%' % (cov_char, len(char_py), 100.0 * cov_char / max(1, len(char_py))))

    # 词覆盖率
    def word_ok(w):
        for ch in w:
            if not ('\u4e00' <= ch <= '\u9fff'):
                return False
            py = char_py.get(ch) or extra.get(ch)
            if not py or pinyin_key(py) not in avail:
                return False
        return True
    ok = sum(1 for w in words if word_ok(w))
    print('词语覆盖率：%d / %d = %.1f%%' % (ok, len(words), 100.0 * ok / max(1, len(words))))

    if not write:
        print('\n（干跑，未写文件；加 --write 真正下载）')
        return

    # ---------- 6. 下载并转码 ----------
    import miniaudio
    import lameenc

    os.makedirs(OUT_DIR, exist_ok=True)
    done = skip = fail = 0

    def transcode(src_bytes):
        """mp3 -> 16 kHz 单声道 32 kbps，并裁掉首尾静音"""
        d = miniaudio.decode(src_bytes, sample_rate=16000, nchannels=1)
        pcm = d.samples
        n = len(pcm)
        # 首尾静音裁剪（阈值 800/32768，留 30 ms 余量）
        th = 800
        st = 0
        while st < n and abs(pcm[st]) < th:
            st += 1
        en = n
        while en > st and abs(pcm[en - 1]) < th:
            en -= 1
        pad = int(16000 * 0.03)
        st = max(0, st - pad)
        en = min(n, en + pad)
        if en - st < 1600:          # 太短说明整段近乎静音，保留原样
            st, en = 0, n
        seg = pcm[st:en]
        enc = lameenc.Encoder()
        enc.set_bit_rate(32)
        enc.set_in_sample_rate(16000)
        enc.set_channels(1)
        enc.set_quality(4)
        out = enc.encode(bytes(seg.tobytes()))
        out += enc.flush()
        return out

    for i, k in enumerate(have):
        path = os.path.join(OUT_DIR, k + '.mp3')
        if os.path.exists(path) and os.path.getsize(path) > 500:
            skip += 1
            continue
        raw = None
        for attempt in range(3):
            try:
                with urllib.request.urlopen(RAW % k, timeout=60) as r:
                    raw = r.read()
                break
            except Exception as e:
                if attempt == 2:
                    print('  下载失败 %s: %s' % (k, e))
                else:
                    time.sleep(1.5)
        if raw is None:
            fail += 1
            continue
        try:
            open(path, 'wb').write(transcode(raw))
            done += 1
        except Exception as e:
            fail += 1
            print('  转码失败 %s: %s' % (k, e))
        if (i + 1) % 50 == 0:
            print('  … %d / %d' % (i + 1, len(have)))
    print('下载转码 %d，已存在跳过 %d，失败 %d' % (done, skip, fail))

    # ---------- 7. 前端补充字表 ----------
    lines = ['/*!',
             ' * py-dict.js —— 组词用字补充拼音表（自动生成，请勿手改）',
             ' * 只收录「不在 1200 字表内、但出现在组词/例词中」的汉字，',
             ' * 用于把词语拆成音节、按音节连读发音。',
             ' * 拼音来源：pypinyin（MIT）｜音节音频：davinfifield/mp3-chinese-pinyin-sound（Unlicense）',
             ' * 重新生成：python _tools/build-audio.py --write',
             ' */']
    body = json.dumps(extra, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    lines.append('window.PY_DICT = ' + body + ';')
    wbody = json.dumps(word_fix, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    lines.append('window.PY_WORDS = ' + wbody + ';')
    open(os.path.join(ROOT, 'js', 'py-dict.js'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    print('已写 js/py-dict.js（%d 字 · %d 条多音字词）' % (len(extra), len(word_fix)))

    # ---------- 8. 音节清单（供测试校验） ----------
    man = {'syllables': sorted(k for k in have if os.path.exists(os.path.join(OUT_DIR, k + '.mp3'))),
           'count': 0}
    man['count'] = len(man['syllables'])
    js = ['/*! audio-manifest.js —— 已内置的音节清单（自动生成，请勿手改） */',
          'window.PY_AUDIO = ' + json.dumps(man['syllables'], ensure_ascii=False, separators=(',', ':')) + ';']
    open(os.path.join(ROOT, 'js', 'audio-manifest.js'), 'w', encoding='utf-8').write('\n'.join(js) + '\n')
    size = sum(os.path.getsize(os.path.join(OUT_DIR, f)) for f in os.listdir(OUT_DIR))
    print('已写 js/audio-manifest.js（%d 个音节）· 音频合计 %.1f MB' % (man['count'], size / 1048576.0))


if __name__ == '__main__':
    main()
