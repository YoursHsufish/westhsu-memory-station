#!/usr/bin/env bash
# 下载重建词库所需的原始数据（约 40MB，一次性）
# 用法：bash _tools/fetch-data.sh
set -e
cd "$(dirname "$0")/data"

echo "1/5 常用字表（3500 字）..."
curl -sL -o zi.tar.gz "https://codeload.github.com/jinghu-moon/Simplified-Chinese-Characters/tar.gz/refs/heads/main"
tar xzf zi.tar.gz && rm -f zi.tar.gz

echo "2/5 汉字频率排名 hanziDB..."
curl -sL -o hanzidb.csv "https://raw.githubusercontent.com/ruddfawcett/hanziDB.csv/master/data/hanziDB.csv"

echo "3/5 拼音/释义 chinese-dictionary (7.7MB)..."
curl -sL -o char_detail.json "https://raw.githubusercontent.com/mapull/chinese-dictionary/main/character/common/char_common_detail.json"

echo "4/5 部首/笔画 chinese-xinhua (27MB)..."
curl -sL -o word.json "https://raw.githubusercontent.com/pwxcoo/chinese-xinhua/master/data/word.json"

echo "5/5 组词词频 jieba (5MB)..."
curl -sL -o jieba.txt "https://raw.githubusercontent.com/fxsjy/jieba/master/jieba/dict.txt"

echo "完成。接着运行：python _tools/build-zh-data.py 200 6"
