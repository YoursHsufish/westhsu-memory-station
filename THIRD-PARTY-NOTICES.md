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

---

## 其它说明

- **朗读功能**使用浏览器内置的 Web Speech API，不含任何第三方语音代码或语音资源。
- **英语词库**由软件作者按《义务教育英语课程标准》小学阶段的词汇范围自行整理，未直接复制任何教材原文。
- **拼音音节**由本软件从上述汉字数据聚合生成，未使用第三方拼音库。

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
