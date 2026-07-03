# 表情包风格玩法

## 总原则

表情包要小、快、准。它应该在 QQ 聊天流里一眼读懂，而不是成为一张需要点开放大的完整画作。

生成时学习的是现代表情包的结构：强表情、短文字、低信息密度、反差、丧萌、自嘲、复读和场景回调。不要复制外部图片模板、真人肖像、商业角色或水印。

## 基础规格

- 画幅：正方形，适合 512-1024px 输出；提示词里强调“小表情包/贴纸感”。
- 主体：1 个原创吉祥物或简化人物/道具，优先使用本 bot 的可爱猫头鹰/小鹰桌边助手形象。
- 构图：中心主体 + 大字标题；留足白边，缩略图也能看清。
- 背景：透明、纯色、浅色渐变或极简桌面，不要复杂场景。
- 字体：粗体中文、黑白描边、高对比、1-2 行。
- 文案：2-12 字最佳，最多 18 字；不要长句、段落、小字注释。

## 文案自检

表情包文字必须像群里以后还能继续丢的反应，而不是一次性说明牌。选字前问：

- 这句话能不能离开当前截图，在类似场景继续用？
- 它表达的是情绪/状态/吐槽，还是只在解释“我正在做什么”？
- 如果群友问“这是什么梗”，能不能回答出一个共同笑点，而不是“这是当前任务说明”？

避免这类失败文案：

```text
先看样图 / 正在生成 / 文案待定 / 请你矫正 / 给你预览
```

更好的替换：

```text
在改了 / 已老实 / 这就返工 / 包能改的 / 我先缩一下
```

## 常用结构

### 单主体反应贴纸

适合大多数自动反应。

```text
主体：小鹰抱着骰子石化/探头/装死/疯狂翻笔记
文字：已老实 / 在查了 / 不妙 / 先别SAN
```

### 大字吐槽图

适合群友金句、骰点惨案、bot 自嘲。

```text
主体：小鹰缩在角落或举牌
文字：大失败也是线索 / KP沉默了 / 这很CoC
```

### 两格反差

只在信息很简单时使用。

```text
左格：过侦查前，信心满满
右格：过侦查后，抱骰子发抖
文字：前 / 后
```

两格图不要塞超过 8 个字，否则在 QQ 里会糊成一团。

### 语录牌

适合群内经典语录。

```text
主体：小鹰郑重举牌
文字：群友原句或 8-14 字压缩版
```

只使用公开、友好、无隐私的语录。若原句太长，保留最有节奏的半句。

## 跑团梗素材

这些是候选语气，不是固定必用：

- 侦查相关：`在查了`、`过个侦查`、`线索呢`、`先别急`
- SAN 相关：`先别SAN`、`稳住理智`、`我没看见`
- 骰点相关：`大失败也是线索`、`骰子有想法`、`运气检定`
- KP 相关：`KP沉默了`、`这段不妙`、`先让KP说`
- 复盘相关：`已加入疑点`、`小本本记下`、`这很CoC`

## 网络热梗语气

可借用流行语的情绪类型，但要贴合当前群：

- 自嘲摆烂：`已老实`、`我先躺一下`、`这下老实了`
- 反差装稳：`包的`、`问题不大`、`我做事你放心一半`
- 惊讶怀疑：`尊嘟假嘟`、`不确定，再看看`、`这合理吗`
- 崩溃好笑：`绷不住了`、`破防了`、`事情开始怪了`
- 温和收束：`爱你老己`、`今天先活着`、`明天再查`

不要在严肃恐怖段落硬塞流行词。网络热梗变化很快；如果语感不确定，优先写原创短句。

## 提示词模板

### 自动反应模板

```text
Generate one compact square QQ reaction meme sticker, not a full illustration.
Subject: an original cute owl tabletop assistant mascot, [emotion/action].
Caption text: "[中文短字]".
Typography: large bold simplified Chinese, high contrast, white fill with black outline, 1-2 lines, readable at small chat size.
Composition: centered sticker-like subject, simple background, minimal details, expressive face, playful but not disruptive.
Context: [用一句话概括最新群聊和 bot 回复].
Avoid: photorealistic portrait, copyrighted characters, copied meme templates, UI, chat bubbles, watermark, logo, tiny text, gore, spoilers.
```

### 群内语录模板

```text
Generate one compact square QQ meme sticker.
Subject: an original cute owl tabletop assistant solemnly holding a sign like a tabletop quote board.
Caption text exactly: "[公开语录短句]".
Typography: large bold simplified Chinese, centered, readable in QQ chat thumbnail.
Style: clean sticker, flat color, exaggerated expression, no full background scene.
Avoid: real person likeness, private information, copied internet meme template, watermark, logo, extra text.
```

### 骰点名场面模板

```text
Generate one compact square Chinese TRPG reaction meme sticker.
Subject: a cute owl dice assistant staring at a die result with dramatic disbelief, tiny notebook open.
Caption text: "[骰点短梗]".
Composition: one character, one die, simple tabletop hint, no complex scene.
Typography: bold simplified Chinese, high contrast, readable at 160px.
Avoid: horror gore, spoilers, copyrighted characters, UI, watermark, long text.
```

## 质量检查

生成提示词前确认：

- 这张图缩小后仍能看清主体和文字。
- 文字是 1 个包袱，不解释整个上下文。
- 文案不是在嘲笑一个具体玩家。
- 没有使用私聊、未公开模组信息或真实隐私。
- 风格像表情包，不像海报、封面、完整插画或设定图。
