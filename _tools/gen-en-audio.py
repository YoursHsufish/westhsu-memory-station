#!/usr/bin/env python3
"""
gen-en-audio.py —— 生成英语单词离线音频（构建期工具，不随软件分发）

背景：
  · WorkBuddy 云端 SDK 没有 TTS 接口（认证/数据库/存储/LLM 四类，无语音合成）；
    即使有，按量计费也不适合孩子每天点几十次发音。
  · 安卓 WebView / 国产 ROM 常常没有英语 TTS 语音包，speechSynthesis 有对象但读不出声。
  · 所以采用与中文拼音音频相同的成熟方案：构建期生成 MP3，随软件内置，运行时零联网、零费用。

工具：edge-tts（GPL-3.0 开源工具，调用 Edge 在线朗读生成音频文件）。
     本工具只在开发机上运行一次；产物是 462 个静态 mp3，运行时不访问任何云服务。

用法：python3 _tools/gen-en-audio.py            # 增量生成（已存在的跳过）
      python3 _tools/gen-en-audio.py --force    # 全部重新生成
"""
import asyncio
import json
import os
import re
import sys
import edge_tts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORDS_JSON = os.path.join(os.path.dirname(ROOT), '_enwords.json')
OUT_DIR = os.path.join(ROOT, 'assets', 'audio', 'en')
MANIFEST = os.path.join(ROOT, 'js', 'en-audio-manifest.js')
VOICE = 'en-US-JennyNeural'          # 清晰的女声，适合小学生
RATE = '-10%'                        # 稍慢，方便跟读
CONCURRENCY = 6


def slug(word):
    s = word.lower().strip()
    s = re.sub(r'[^a-z0-9]+', '_', s).strip('_')
    return s or 'word'


async def generate_one(sem, word, force):
    name = slug(word) + '.mp3'
    path = os.path.join(OUT_DIR, name)
    if not force and os.path.exists(path) and os.path.getsize(path) > 1000:
        return word, name, 'skip'
    async with sem:
        for attempt in range(3):
            try:
                comm = edge_tts.Communicate(word, VOICE, rate=RATE)
                await comm.save(path)
                if os.path.getsize(path) > 1000:
                    return word, name, 'ok'
            except Exception:
                if os.path.exists(path):
                    try:
                        os.remove(path)
                    except OSError:
                        pass
                await asyncio.sleep(1.5 * (attempt + 1))
    return word, name, 'FAIL'


async def main():
    force = '--force' in sys.argv
    with open(WORDS_JSON, 'r', encoding='utf-8') as f:
        words = json.load(f)
    os.makedirs(OUT_DIR, exist_ok=True)
    sem = asyncio.Semaphore(CONCURRENCY)
    tasks = [generate_one(sem, w, force) for w in words]
    results = []
    for i, chunk in enumerate(range(0, len(tasks), 60)):
        part = await asyncio.gather(*tasks[chunk:chunk + 60])
        results.extend(part)
        done = sum(1 for r in results if r[2] != 'FAIL')
        print(f'  {done}/{len(words)} 完成', flush=True)

    failed = [w for w, _, s in results if s == 'FAIL']
    mapping = {w.lower(): n for w, n, s in results if s != 'FAIL'}
    with open(MANIFEST, 'w', encoding='utf-8', newline='\n') as f:
        f.write('/*! en-audio-manifest.js —— 内置英语单词音频清单（自动生成，请勿手改） */\n')
        f.write('window.EN_AUDIO = ' + json.dumps(mapping, ensure_ascii=False, sort_keys=True) + ';\n')
    print(f'音频: {len(mapping)} 个, 失败: {len(failed)}')
    if failed:
        print('失败单词:', ', '.join(failed[:30]))
        sys.exit(1)


if __name__ == '__main__':
    asyncio.run(main())
