# 第三方开源组件声明（THIRD-PARTY NOTICES）

**记忆小站**（下称"本软件"）自身代码由软件作者编写，以 MIT 许可证发布（见 `LICENSE`）。

本软件的**词库数据**来自下列开源项目，均使用 **MIT 许可证**。按 MIT 许可证要求，在此保留各项目的版权声明与许可声明。

> 说明：本软件只使用这些项目提供的**数据**（汉字表、频率、拼音、释义、词频），没有复制、修改或再分发其源代码；数据在构建阶段被转换为 JSON，随软件一起分发。

---

## 1. 《现代汉语常用字表》3500 字

- 项目：`jinghu-moon/Simplified-Chinese-Characters`
- 地址：https://github.com/jinghu-moon/Simplified-Chinese-Characters
- 用途：汉字范围与字序
- 许可：MIT License
- 版权：**Copyright (c) 2022 jinghu-moon**

## 2. hanziDB 汉字使用频率

- 项目：`ruddfawcett/hanziDB.csv`
- 地址：https://github.com/ruddfawcett/hanziDB.csv
- 用途：按使用频率给汉字分组（第 1 组最常用）
- 许可：MIT License
- 版权：**Copyright (c) 2017 Rudd Fawcett**

## 3. chinese-dictionary 汉语字典数据

- 项目：`mapull/chinese-dictionary`
- 地址：https://github.com/mapull/chinese-dictionary
- 用途：汉字拼音、释义、组词
- 许可：MIT License
- 版权：**Copyright (c) 2021 码谱**

## 4. 中华新华字典数据库

- 项目：`pwxcoo/chinese-xinhua`
- 地址：https://github.com/pwxcoo/chinese-xinhua
- 用途：汉字部首、笔画
- 许可：MIT License
- 版权：**Copyright (c) 2018 PWXCOO**

## 5. jieba 中文分词词典

- 项目：`fxsjy/jieba`
- 地址：https://github.com/fxsjy/jieba
- 用途：用词频挑选每个字最常用的组词
- 许可：MIT License
- 版权：**Copyright (c) 2013 Sun Junyi**

## 6. 普通话拼音音节音频（v1.7.0 起）

- 项目：`davinfifield/mp3-chinese-pinyin-sound`
- 地址：https://github.com/davinfifield/mp3-chinese-pinyin-sound
- 用途：汉字与词语的离线发音（`assets/audio/py/*.mp3`）
- 许可：**The Unlicense（公有领域）**——可自由复制、修改、分发、商用
- 说明：本项目只取其中实际用到的 766 个音节，构建时转码为 16 kHz 单声道 32 kbps 并裁掉首尾静音（原始体积 14.6 MB → 2.5 MB）。

## 7. pypinyin 汉语拼音库（仅构建阶段）

- 项目：`mozillazg/python-pinyin`
- 地址：https://github.com/mozillazg/python-pinyin
- 用途：为组词中不在 1200 字表内的汉字补拼音（生成 `js/py-dict.js`），并在构建阶段校正多音字词读音
- 许可：MIT License
- 版权：**Copyright (c) 2016 mozillazg**
- 说明：只在构建脚本 `_tools/build-audio.py` 里使用，**不随软件分发**。

---

## 其它说明

- **朗读功能**有两条通道：优先播放随软件分发的**拼音音节 mp3**（见第 6 条），没有对应音频时回退到浏览器内置的 Web Speech API。
- **英语词库**由软件作者按《义务教育英语课程标准》小学阶段的词汇范围自行整理，未直接复制任何教材原文。
- **拼音音节**由本软件从上述汉字数据聚合生成，未使用第三方拼音库（pypinyin 只在构建阶段补字表）。

---

## MIT 许可证全文

以下为上述各组件共同适用的 MIT 许可证文本（版权人见上文各条目）：

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
