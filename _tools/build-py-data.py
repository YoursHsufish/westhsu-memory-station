# -*- coding: utf-8 -*-
"""
build-py-data.py —— 生成 js/data-py.js（拼音学习库）

内容：
  1. 声母 23 / 韵母 24 / 整体认读 16（一年级基础表，人工整理，含例字例词）
  2. 常用音节：从 js/data-zh.js 的 1200 个生字聚合，同一音节取最靠前（最常用）的字作例字，
     并按该字所在年级分组，保证一年级的孩子只练到一年级的音节。

用法：python build-py-data.py
输出：../js/data-py.js
"""
import json
import os
import re
import io

BASE = os.path.dirname(os.path.abspath(__file__))
ZH = os.path.abspath(os.path.join(BASE, '..', 'js', 'data-zh.js'))
OUT = os.path.abspath(os.path.join(BASE, '..', 'js', 'data-py.js'))

# 声母 23
SHENGMU = [
    ('b', '玻', '玻璃'), ('p', '坡', '山坡'), ('m', '摸', '摸一摸'), ('f', '佛', '仿佛'),
    ('d', '得', '得到'), ('t', '特', '特别'), ('n', '讷', '口讷'), ('l', '勒', '勒紧'),
    ('g', '哥', '哥哥'), ('k', '科', '科学'), ('h', '喝', '喝水'),
    ('j', '鸡', '小鸡'), ('q', '七', '七个'), ('x', '西', '西瓜'),
    ('zh', '知', '知道'), ('ch', '吃', '吃饭'), ('sh', '狮', '狮子'), ('r', '日', '日出'),
    ('z', '字', '汉字'), ('c', '刺', '刺激'), ('s', '丝', '丝瓜'),
    ('y', '衣', '衣服'), ('w', '乌', '乌鸦'),
]

# 韵母 24
YUNMU = [
    ('a', '阿', '阿姨'), ('o', '喔', '喔喔'), ('e', '鹅', '白鹅'), ('i', '衣', '衣服'),
    ('u', '乌', '乌鸦'), ('ü', '鱼', '小鱼'),
    ('ai', '爱', '爱心'), ('ei', '诶', '诶呀'), ('ui', '威', '威风'), ('ao', '袄', '棉袄'),
    ('ou', '藕', '莲藕'), ('iu', '优', '优秀'), ('ie', '椰', '椰子'), ('üe', '月', '月亮'),
    ('er', '儿', '儿子'), ('an', '安', '安全'), ('en', '恩', '感恩'), ('in', '音', '音乐'),
    ('un', '温', '温暖'), ('ün', '云', '白云'),
    ('ang', '昂', '昂首'), ('eng', '鞥', '鞥鞥'), ('ing', '鹰', '老鹰'), ('ong', '翁', '老翁'),
]

# 整体认读 16
ZHENGTI = [
    ('zhi', '知', '知道'), ('chi', '吃', '吃饭'), ('shi', '狮', '狮子'), ('ri', '日', '日出'),
    ('zi', '字', '汉字'), ('ci', '词', '词语'), ('si', '丝', '丝瓜'),
    ('yi', '衣', '衣服'), ('wu', '乌', '乌鸦'), ('yu', '鱼', '小鱼'),
    ('ye', '叶', '树叶'), ('yue', '月', '月亮'), ('yuan', '圆', '圆圈'),
    ('yin', '音', '音乐'), ('yun', '云', '白云'), ('ying', '鹰', '老鹰'),
]

TONE_MAP = {
    'ā': ('a', 1), 'á': ('a', 2), 'ǎ': ('a', 3), 'à': ('a', 4),
    'ē': ('e', 1), 'é': ('e', 2), 'ě': ('e', 3), 'è': ('e', 4),
    'ī': ('i', 1), 'í': ('i', 2), 'ǐ': ('i', 3), 'ì': ('i', 4),
    'ō': ('o', 1), 'ó': ('o', 2), 'ǒ': ('o', 3), 'ò': ('o', 4),
    'ū': ('u', 1), 'ú': ('u', 2), 'ǔ': ('u', 3), 'ù': ('u', 4),
    'ǖ': ('v', 1), 'ǘ': ('v', 2), 'ǚ': ('v', 3), 'ǜ': ('v', 4),
    'ń': ('n', 2), 'ň': ('n', 3), 'ǹ': ('n', 4),
    'm̀': ('m', 4), 'ê': ('e', 0),
}


def split_tone(py):
    """zhōng -> ('zhong', 1)；轻声 -> ('de', 0)"""
    base, tone = [], 0
    for ch in py:
        if ch in TONE_MAP:
            b, t = TONE_MAP[ch]
            base.append(b)
            if t:
                tone = t
        else:
            base.append(ch)
    return ''.join(base).lower(), tone


def load_zh():
    s = io.open(ZH, encoding='utf-8').read()
    arr = json.loads(s[s.index('= ') + 2:s.rindex(';')])
    return arr


def main():
    units = []
    units.append({
        'id': 'py_sm', 'name': '声母（23 个）', 'grade': 1, 'icon': '🅱️',
        'words': [[p, ch, wd] for p, ch, wd in SHENGMU],
    })
    units.append({
        'id': 'py_ym', 'name': '韵母（24 个）', 'grade': 1, 'icon': '🅰️',
        'words': [[p, ch, wd] for p, ch, wd in YUNMU],
    })
    units.append({
        'id': 'py_zt', 'name': '整体认读（16 个）', 'grade': 1, 'icon': '🔤',
        'words': [[p, ch, wd] for p, ch, wd in ZHENGTI],
    })

    zh = load_zh()
    seen = {}
    for gi, unit in enumerate(zh):
        grade = gi + 1
        for row in unit['words']:
            ch, py, _rad, _st, _mean, words = row
            base, tone = split_tone(py)
            if not base or tone == 0:
                continue
            if base in seen:
                continue
            ex = (words or '').split('、')[0]
            seen[base] = {
                'pinyin': py, 'char': ch, 'grade': grade,
                'word': ex or ch, 'base': base, 'tone': tone,
            }

    groups = {}
    for base, it in seen.items():
        groups.setdefault(it['grade'], []).append(it)

    icons = {1: '①', 2: '②', 3: '③', 4: '④', 5: '⑤', 6: '⑥'}
    for g in range(1, 7):
        items = groups.get(g, [])
        if not items:
            continue
        items.sort(key=lambda x: x['base'])
        units.append({
            'id': 'py%d' % g,
            'name': '音节 · 第 %d 组（%d 个）' % (g, len(items)),
            'grade': g,
            'icon': icons.get(g, '🎵'),
            'words': [[it['pinyin'], it['char'], it['word'], it['base'], it['tone']] for it in items],
        })

    header = (
        '/*!\n'
        ' * 拼音学习库（自动生成，请勿手改）\n'
        ' * 声母/韵母/整体认读：人工整理；音节：由 js/data-zh.js 的汉字拼音聚合\n'
        ' * 共 %d 个单元 / %d 个条目\n'
        ' * 重新生成：python _tools/build-py-data.py\n'
        ' */\n'
    ) % (len(units), sum(len(u['words']) for u in units))

    with io.open(OUT, 'w', encoding='utf-8') as f:
        f.write(header)
        f.write('window.PY_UNITS = ')
        f.write(json.dumps(units, ensure_ascii=False, separators=(',', ':')))
        f.write(';\n')

    total = sum(len(u['words']) for u in units)
    print('已生成 %s：%d 个单元 / %d 条 / %.1f KB'
          % (OUT, len(units), total, os.path.getsize(OUT) / 1024.0))
    for u in units:
        print('  %-22s %s 条  grade=%d' % (u['name'], len(u['words']), u['grade']))


if __name__ == '__main__':
    main()
