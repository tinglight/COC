# QQ CoC 跑团 AI 助手

面向私人 COC/TRPG 团的 QQ 官方机器人与本地 AI 跑团工具。项目最初从 CoC 骰娘起步，现在已经扩展为集成骰子检定、角色卡、模组导入、NPC 塑造、KP 辅助、叙事记忆、主动故事和配图的桌边助手。

仓库名仍保留 `qq-coc-dice-bot`，但项目定位不再是“只会掷骰的 QQ 机器人”：QQ 只是当前聊天入口，本地模组资料、NPC 人格规则、跑团状态和 AI 生成约束才是核心能力。

## 项目定位

- **QQ 跑团入口**：通过 QQ 官方机器人 Webhook 接收群聊/C2C 消息，提供私团可用的指令、限频、白名单和签名校验。
- **CoC 规则工具层**：本地处理掷骰、技能检定、SAN Check、角色卡保存和 Excel 角色卡导入，规则结果不交给模型编造。
- **AI KP 助手层**：`.ai` 和 @机器人可以命中本地已导入模组与当前 campaign 状态；主动故事会参考叙事历史，延续中文跑团氛围。
- **模组知识层**：`skills/coc-module-importer` 将 DOCX/Markdown/text 模组拆成只读 canon 与可变 campaign，供后续问答、备团、分支追踪和 KP 改写使用。
- **NPC 扮演层**：`.npc` 与 `skills/npc-live-roleplay` 负责把 NPC 角色卡、知识边界、人格口吻和真人桌边训练规则结合起来，生成可直接发到 QQ 的扮演回复。
- **叙事记忆层**：NPC 回复、AI 回复、主动故事等会写入 SQLite 的 `narrative_events`，避免服务重启后丢失上下文。

## 功能

- `.help` 查看指令
- `.r 1d100` / `.r 2d6+3 原因` 普通掷骰
- `.ra 侦查` / `.ra 侦查 60` CoC7 技能检定
- `.sc 0/1d6 60` San Check
- `.ai 帮我描写一个地下室` 调用 OpenAI 模型回复
- `.ai 粗略介绍一下W列车这个模组` 命中本地已导入模组资料后优先按项目内 canon/campaign 信息回答
- `.npc 张管家 玩家问：昨晚钟楼亮灯时你在哪里？` 使用本地 NPC 训练 Skill 生成扮演回复
- `.train show` / `.train note ...` 查看或追加 NPC 真人感训练记录
- `.st 侦查60 聆听50 san60` 保存角色卡
- `.show` 查看角色卡
- 从 Excel 导入角色卡
- 从 DOCX/Markdown/text 导入 COC/TRPG 模组，生成只读 canon 索引与可变 campaign 跑团状态
- 主动故事、叙述者 Markdown 名片、AI 配图和叙事事件持久化
- 群白名单、消息去重、用户/群限频、QQ Webhook 签名校验

## 文档导航

- [NPC Skill 与人格规则](docs/NPC_SKILL.md)：NPC 回复、知识边界、防剧透、叙事入库和主动故事规则。
- [coc-module-importer Skill](skills/coc-module-importer/SKILL.md)：模组导入、canon/campaign 分层、跑团状态记录和 KP 改写规则。
- [npc-live-roleplay Skill](skills/npc-live-roleplay/SKILL.md)：NPC 真人桌边感、括号式 OOC、训练反馈和风格修正。

## NPC、模组与 AI 扩展

- GPT 接入后，普通骰子指令仍由本地逻辑处理，`.ai` 或 `@机器人` 消息可交给模型回复。
- `.ai` 会尝试从 `data/module_imports` 匹配本地已导入模组；命中后会把模组基础信息、实体索引、PC/DIY 分支、规则候选和当前 campaign 状态作为模型约束。
- NPC 扮演按项目文档里的 [NPC Skill 与人格规则](docs/NPC_SKILL.md) 设计：每个 NPC 有角色卡、知识边界、动机、状态、防剧透规则，以及可选的括号式桌边发言。
- 模组导入按 [coc-module-importer Skill](skills/coc-module-importer/SKILL.md) 设计：原文事实、隐藏真相、规则和结局保存在只读 `canon/`；KP 改写、PC 影响、NPC 关系和世界变化保存在 `campaign/`。
- 真人感 NPC 对话训练沉淀在 [npc-live-roleplay Skill](skills/npc-live-roleplay/SKILL.md)，评分样例和修正规则在它的 `references` 资料库中。
- 当前支持 KP 可控模式，例如 `.npc 张管家 玩家问：昨晚钟楼亮灯时你在哪里？`。机器人会把本地 Skill、桌边风格规则和训练日志作为模型约束，但只把可发送的回复发回 QQ。
- NPC 回复、`.ai` / @AI 回复、主动故事等叙事类输出会写入 SQLite 的 `narrative_events`，作为后续连续性和记忆检索依据。
- `.train 回复太像 AI，3/10，请改得更像真人桌边扮演` 可让模型按训练 Skill 做反馈/改写；`.train show` 查看训练记录摘录；`.train note 这次教训：...` 会追加到本地训练日志。

## 模组导入与 KP 助手

模组导入工具会把一个 COC/TRPG 模组拆成两层资料：

- `canon/`：原模组事实、隐藏真相、规则候选、时间线、场景、线索、NPC 种子、分支钩子和结局。导入后默认视为只读。
- `campaign/`：跑团现场可变资料，包括 KP 改写、PC 专属分支、现场日志、NPC 上下文、关系变化和世界状态变化。

导入示例：

```powershell
python .\skills\coc-module-importer\scripts\import_module.py "C:\path\module.docx" --out ".\data\module_imports\my-module" --module-id "my-module"
```

记录现场事件示例：

```powershell
python .\skills\coc-module-importer\scripts\record_session_event.py ".\data\module_imports\my-module" --scene "car-2" --event "调查员打开了医疗柜" --pc "PC A" --npc "萝丝" --world-change "医疗物资被取走"
```

检查 canon 是否被误改：

```powershell
python .\skills\coc-module-importer\scripts\check_canon_lock.py ".\data\module_imports\my-module"
```

当 `.ai` 文本提到已导入模组的名称、别名、组织或地点时，机器人会优先使用本地模组索引和当前 campaign 状态回答；资料不足时应明确说本地索引没有，不用外部网站或模型记忆补全。

## 设计边界

- 骰子、技能检定、SAN Check 和角色卡数值由本地代码处理，AI 不能编造骰点或规则结果。
- KP 始终拥有最终裁定权；AI 可以给建议、摘要、描写和 NPC 台词，但不能自动宣布隐藏真相、结局或不可逆剧情推进。
- 模组 canon 不随跑团现场改写；KP 自定义、删改、临场补充和 PC 后果写入 campaign。
- NPC 只能说自己应当知道、已经公开或被 KP 授权可透露的信息；括号式桌边发言也不能泄露 keeper-only 内容。
- 所有可能影响后续连续性的 AI 叙事输出都应入库，不能只留在 QQ 消息或运行日志里。

## OpenAI AI 回复

把 OpenAI API key 填到本机 `.env`，不要发到群里，也不要提交：

```env
OPENAI_API_KEY=你的key
OPENAI_MODEL=gpt-5.5
AI_REPLY_MODE=mention
AI_MAX_REPLY_CHARS=900
```

触发模式：

- `off`：关闭 AI。
- `command`：只响应 `.ai 文本`。
- `mention`：响应 `.ai 文本`、群里 `@机器人 文本`、C2C 私聊文本，默认推荐。
- `all`：响应允许群里的所有非指令消息，不推荐日常开启，容易刷屏和增加费用。

示例：

```text
@机器人 帮我描写一下这个餐桌上的尴尬气氛
.ai 写一个张管家的即兴回应
```

骰子指令仍然走本地逻辑，不会消耗 OpenAI API：

```text
.r 1d100
.ra 侦查
.sc 0/1d6
```

## 主动故事 Markdown 名片

主动群聊可以把 AI 讲故事的内容包装成 Markdown 叙述者名片，QQ 气泡身份仍然是同一个官方机器人，但正文里会显示叙述者名字、头像和副标题：

```env
PROACTIVE_CHAT_ENABLED=true
PROACTIVE_MARKDOWN_ENABLED=true
PROACTIVE_MARKDOWN_NARRATORS=守夜人|https://example.com/avatar.png|午夜叙述者;档案员|https://example.com/archive.png|调查记录
```

`PROACTIVE_MARKDOWN_NARRATORS` 用分号分隔多名叙述者，发送主动故事时按轮次轮换。头像必须是 QQ 能访问的公网 `http(s)` 图片 URL；如果 Markdown 发送失败，程序会自动回退成纯文本发送。

主动故事也可以在文字后自动生成一张配图，并通过 QQ 富媒体图片消息发出：

```env
PROACTIVE_IMAGE_ENABLED=true
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_SIZE=1024x1024
OPENAI_IMAGE_QUALITY=low
OPENAI_IMAGE_OUTPUT_FORMAT=png
```

图片生成使用同一个 `OPENAI_API_KEY`。默认提示词会生成偏 CoC 跑团氛围的无文字插图；如果要换画风，可以改 `PROACTIVE_IMAGE_PROMPT`。图片生成失败不会阻止文字故事发送。

主动故事发送成功后会同时写入主动故事轻量历史和统一叙事事件表，避免服务重启后忘记前文或重复同一段悬念。

## 本机启动

```powershell
npm.cmd install
Copy-Item .env.example .env
npm.cmd run dev
```

把 QQ 后台拿到的 `AppID`、`AppSecret` 填到 `.env`，不要提交或截图泄露 `.env`。当前实测 QQ 回调地址校验用 `AppSecret` 回签可保存成功，因此默认建议：

```env
QQ_VALIDATION_SECRET_SOURCE=appSecret
```

`QQ_BOT_SECRET` 只作为兼容旧 Token/机器人令牌的备用项；如果以后某个机器人确实需要 Token 校验，再把 `QQ_VALIDATION_SECRET_SOURCE` 改成 `botSecret` 并重启服务。

## 本机 HTTPS 隧道

推荐用 Cloudflare Tunnel 快速测试：

```powershell
cloudflared tunnel --url http://localhost:3000
```

然后把输出的 HTTPS 地址填入 QQ 后台 Webhook：

```text
https://xxxx.trycloudflare.com/qq/webhook
```

如果没有安装 `cloudflared`，也可以用 ngrok、frp 或其它能提供公网 HTTPS 的隧道工具。

## QQ Webhook 踩坑记录

- QQ 后台回调地址必须填 `/qq/webhook`，不要填 `/health`。`/health` 只用于自己检查隧道是否连通。
- 如果输入框左侧已经固定显示 `https://`，输入框里只填 `域名/qq/webhook`，不要重复粘贴协议。
- quick tunnel 地址会变。`cloudflared` 进程退出、电脑断网或 tunnel 失效后，需要重新运行 `cloudflared tunnel --url http://localhost:3000`，并把新的 `https://xxxx.trycloudflare.com/qq/webhook` 更新到 QQ 后台。
- 改 `.env` 后必须重启 `npm.cmd run dev`。`tsx watch` 会自动重启代码改动，但不会可靠地因为 `.env` 变化重载配置。
- 这次旧机器人保存成功时，QQ 的校验请求表现为 `appSecretVerifiesRequest: true`、`botSecretVerifiesRequest: false`，服务端用 `AppSecret` 生成验证响应签名后保存成功。保留 `QQ_VALIDATION_SECRET_SOURCE=appSecret` 是当前推荐配置。
- 如果后台仍提示“校验签名失败”，先看服务日志：只要出现 `headerAppIdMatchesConfig: true`、`appSecretVerifiesRequest: true`、`statusCode: 200`，说明请求已经打到本机，问题通常在响应签名口径、后台缓存、或填错路径。
- QQ 后台的 AIGC 机器人目前可能提示“暂不支持 AIGC 机器人进入社群场景以及上架后全量对所有用户使用”。这不是代码问题；这种状态下新建同类机器人也无法配置新沙箱群，只能用私聊或平台已经允许的旧群。

## QQ 后台需要你操作

1. 登录 QQ 开放平台并创建官方机器人。
2. 填机器人资料、头像、简介；如果后台允许，再配置沙箱测试群。
3. 在开发设置复制 `AppID`、`AppSecret` 到本机 `.env`。
4. Webhook 地址填 `https://你的隧道域名/qq/webhook`。
5. 事件订阅至少打开 C2C 和群聊相关事件，例如 `C2C_MESSAGE_CREATE`、`GROUP_AT_MESSAGE_CREATE`、`GROUP_MESSAGE_CREATE`。
6. 先用 C2C 私聊发 `.help` 验证链路；如果平台允许群场景，再把机器人加入私人团测试群，用 `@机器人 .help` 测试。

第一次不知道群 `openid` 时，可以先让 `QQ_ALLOWED_GROUP_OPENIDS` 为空，发一条群消息后查看服务日志，再把群 openid 填回 `.env` 并重启。

## 测试

```powershell
npm.cmd test
npm.cmd run typecheck
```

Node 需要 24 或更新版本，因为项目使用内置 `node:sqlite`。

## 从 Excel 角色卡导入

先预览解析结果，不写入数据库：

```powershell
npm.cmd run import:sheet -- --file "C:\path\角色卡.xlsx" --dry-run
```

确认群和用户 `openid` 后写入当前数据库：

```powershell
npm.cmd run import:sheet -- --file "C:\path\角色卡.xlsx" --scope-type group --scope-id 群openid --user-id 用户openid
```

默认读取工作表 `人物卡`，也可以用 `--sheet` 指定其它工作表。
