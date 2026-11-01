# -*- coding: utf-8 -*-
"""
build-zh-data.py —— 生成 js/data-zh.js（中文识字库）

数据来源（均为开源、可商用）：
  1. 汉字顺序：《现代汉语常用字表》3500 字（语料库在线版，MIT）
     https://github.com/jinghu-moon/Simplified-Chinese-Characters
  2. 拼音 / 释义：chinese-dictionary（MIT）
     https://github.com/mapull/chinese-dictionary  character/common/char_common_detail.json
  3. 部首 / 笔画：中华新华字典数据库（MIT）
     https://github.com/pwxcoo/chinese-xinhua  data/word.json
  4. 组词用词频表：jieba 词典（MIT）
     https://github.com/fxsjy/jieba  jieba/dict.txt

用法：python build-zh-data.py [每组字数] [组数]
输出：../../js/data-zh.js
"""
import json
import os
import re
import sys
import io

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, 'data')
OUT = os.path.abspath(os.path.join(BASE, '..', 'js', 'data-zh.js'))

GROUP_SIZE = int(sys.argv[1]) if len(sys.argv) > 1 else 200
GROUP_COUNT = int(sys.argv[2]) if len(sys.argv) > 2 else 6
MAX_CHARS = GROUP_SIZE * GROUP_COUNT

CJK = re.compile(r'[\u4e00-\u9fff]')
PAREN = re.compile(r'[（(]([^（()）]*)[)）]')

# 字源、字形、通假等对小学生的识字没有帮助，直接剔除
NOISE = (
    '象形', '指事', '会意', '形声', '部首', '甲骨', '小篆', '金文', '字形', '古文字',
    '本义', '同本义', '大写作', '繁体', '声符', '义符', '简化', '引申', '假借',
    '变成', '原始', '记数符号', '两横', '演变', '原是', '后世', '借用', '借为',
    '见“', '通“', '亦声', '从二', '从子',
)

COMMON = set()   # 常用字集合（用于过滤生僻词）
FREQ = {}        # 首字 -> [(词频, 词)]
RIDX = {}        # 尾字 -> [(词频, 词)]


# ---------------------------------------------------------------- 读取
def read_order():
    p = os.path.join(DATA, 'Simplified-Chinese-Characters-main', '常用 3500 字- 语料库在线.txt')
    text = io.open(p, encoding='utf-8', errors='ignore').read()
    seen, out = set(), []
    for ch in text:
        if CJK.match(ch) and ch not in seen:
            seen.add(ch)
            out.append(ch)
    return out


def read_rank():
    """hanziDB.csv：汉字使用频率排名（MIT）"""
    p = os.path.join(DATA, 'hanzidb.csv')
    rank = {}
    if not os.path.exists(p):
        print('  ! 缺少 hanzidb.csv，按笔画序排列')
        return rank
    with io.open(p, encoding='utf-8', errors='ignore') as f:
        next(f, None)
        for line in f:
            parts = line.split(',')
            if len(parts) < 2:
                continue
            try:
                r = int(parts[0])
            except ValueError:
                continue
            ch = parts[1].strip()
            if len(ch) == 1 and ch not in rank:
                rank[ch] = r
    return rank


def read_detail():
    """char_common_detail.json：逐行一个 JSON 对象"""
    p = os.path.join(DATA, 'char_detail.json')
    out = {}
    with io.open(p, encoding='utf-8', errors='ignore') as f:
        for line in f:
            line = line.strip().rstrip(',')
            if not line or line in '[]':
                continue
            try:
                o = json.loads(line)
            except Exception:
                continue
            ch = o.get('char') or ''
            if len(ch) == 1:
                out.setdefault(ch, o)
    return out


def read_xinhua():
    p = os.path.join(DATA, 'word.json')
    raw = io.open(p, encoding='utf-8', errors='ignore').read().strip().rstrip(',')
    if not raw.endswith(']'):
        raw += ']'
    d = {}
    for it in json.loads(raw):
        w = (it.get('word') or '').strip()
        if len(w) == 1:
            d.setdefault(w, it)
    return d


def read_freq_words():
    p = os.path.join(DATA, 'jieba.txt')
    if not os.path.exists(p):
        print('  ! 缺少 jieba.txt，组词将退回字典例句')
        return {}
    idx = {}
    with io.open(p, encoding='utf-8', errors='ignore') as f:
        for line in f:
            parts = line.split()
            if len(parts) < 2:
                continue
            word = parts[0]
            if len(word) != 2:
                continue
            try:
                freq = int(parts[1])
            except ValueError:
                continue
            idx.setdefault(word[0], []).append((freq, word))
    for k in idx:
        idx[k].sort(reverse=True)
    return idx


# ---------------------------------------------------------------- 释义
def _segments(text):
    out = []
    for part in re.split(r'[。；;]', str(text)):
        part = part.strip(' ，,、:：')
        part = re.sub(r'^(本义|同本义)[:：]?', '', part).strip()
        if len(part) < 2:
            continue
        if any(k in part for k in NOISE):
            continue
        if part.startswith('姓') or '明代' in part or '清代' in part:
            continue
        out.append(part)
    return out


def clean_meaning(explanations):
    """现代义项优先；义项太少时退回「本义」"""
    senses, benyi = [], ''
    for e in explanations:
        content = (e.get('content') or '').strip()
        if not content:
            continue
        inner = PAREN.findall(content)
        if inner:
            if not benyi:
                m = re.search(r'本义[:：]\s*([^。；;)）]+)', inner[0])
                if m:
                    benyi = m.group(1).strip(' ，,、')
            continue
        for seg in _segments(content):
            if seg not in senses:
                senses.append(seg)

    picked = senses[:2]
    if len(picked) >= 2:
        out = picked[0] + '；' + picked[1]
    elif picked and len(picked[0]) >= 4:
        out = picked[0]
    elif benyi:
        out = benyi
    elif picked:
        out = picked[0]
    else:
        out = ''

    if len(out) > 40:
        out = out[:38].rstrip('，、 ') + '…'
    return out


# ---------------------------------------------------------------- 组词
def collect_words(ch, pron):
    picked = []
    for freq, w in FREQ.get(ch, [])[:600]:
        if len(picked) >= 3:
            break
        if w not in picked and all(c in COMMON for c in w):
            picked.append(w)
    if len(picked) < 3:
        for freq, w in RIDX.get(ch, [])[:600]:
            if len(picked) >= 3:
                break
            if w not in picked and all(c in COMMON for c in w):
                picked.append(w)
    if len(picked) >= 2:
        return '、'.join(picked[:3])

    extra = []
    for pr in pron:
        for ex in pr.get('explanations') or []:
            for w in ex.get('words') or []:
                word = (w.get('word') or '').strip()
                if 2 <= len(word) <= 3 and word not in extra:
                    extra.append(word)
    for w in extra:
        if len(picked) >= 3:
            break
        if w not in picked:
            picked.append(w)
    return '、'.join(picked[:3])


# ---------------------------------------------------------------- 主流程
def main():
    global COMMON, FREQ, RIDX
    base = read_order()
    rank = read_rank()
    # 常用字表 ∩ 频率表，按使用频率从高到低排序（越靠前越常用）
    order = [c for c in base if c in rank]
    order.sort(key=lambda c: rank[c])
    order += [c for c in base if c not in rank]
    detail = read_detail()
    xinhua = read_xinhua()
    COMMON = set(order[:2000])
    FREQ = read_freq_words()
    for first, lst in FREQ.items():
        for freq, w in lst[:200]:
            RIDX.setdefault(w[1], []).append((freq, w))
    for k in RIDX:
        RIDX[k].sort(reverse=True)

    print('字表 %d 字，释义 %d 条，新华字典 %d 条，高频两字词首字 %d 个' %
          (len(order), len(detail), len(xinhua), len(FREQ)))

    picked = []
    for ch in order:
        if len(picked) >= MAX_CHARS:
            break
        d = detail.get(ch)
        if not d:
            continue
        pron = d.get('pronunciations') or []
        if not pron:
            continue
        # 多音字：义项最多的读音通常就是最常用的读音
        pron_sorted = sorted(pron, key=lambda p: len(p.get('explanations') or []), reverse=True)
        main_pron = pron_sorted[0]
        pinyin = re.split(r'[,，]', (main_pron.get('pinyin') or '').strip())[0]
        if not pinyin:
            continue
        all_ex = [e for e in (main_pron.get('explanations') or [])]
        x = xinhua.get(ch) or {}
        picked.append([
            ch, pinyin,
            (x.get('radicals') or '').strip(),
            str(x.get('strokes') or '').strip(),
            clean_meaning(all_ex),
            collect_words(ch, pron),
        ])

    units, icons = [], ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']
    for g in range(GROUP_COUNT):
        chunk = picked[g * GROUP_SIZE:(g + 1) * GROUP_SIZE]
        if not chunk:
            break
        units.append({
            'id': 'zh%d' % (g + 1),
            'name': '第 %d 组 · 常用度 %d-%d' % (g + 1, g * GROUP_SIZE + 1, g * GROUP_SIZE + len(chunk)),
            'icon': icons[g] if g < len(icons) else '📕',
            'words': chunk,
        })

    header = (
        '/*!\n'
        ' * 中文识字库（自动生成，请勿手改）\n'
        ' * 字序：《现代汉语常用字表》3500 字 ∩ hanziDB 使用频率（MIT）\n'
        ' * 拼音/释义：chinese-dictionary（MIT）｜部首/笔画：chinese-xinhua（MIT）｜组词排序：jieba 词频（MIT）\n'
        ' * 参数：每组 %d 字 × %d 组，共 %d 字\n'
        ' * 重新生成：python _tools/build-zh-data.py\n'
        ' */\n'
    ) % (GROUP_SIZE, len(units), len(picked))

    with io.open(OUT, 'w', encoding='utf-8') as f:
        f.write(header)
        f.write('window.ZH_UNITS = ')
        f.write(json.dumps(units, ensure_ascii=False, separators=(',', ':')))
        f.write(';\n')

    size = os.path.getsize(OUT)
    print('已生成 %s：%d 组 / %d 字 / %.1f KB' % (OUT, len(units), len(picked), size / 1024.0))
    for row in units[0]['words'][:6]:
        print('  样例：', ' | '.join(row))


if __name__ == '__main__':
    main()
