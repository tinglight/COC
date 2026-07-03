# 变更日志

本文件记录项目的用户可见变更、兼容性调整和发布验证结果。格式遵循 `docs/VERSION_LOG_RULES.md`。

## [Unreleased]

### 新增

- 新增普通群聊 AI 表情包的本地氛围判定：自动图片反应会先识别群体笑点、跑团名场面、可复用短梗和 bot 自嘲，再按概率触发，显式要图请求仍可直接触发。
- 新增 `AI_CHAT_IMAGE_MIN_GAP_MINUTES` 配置，控制普通群聊 AI 自动表情包冷却时间，默认 20 分钟，避免连续刷屏。
- 新增 `chat-meme-reaction` 项目内 Skill，定义 QQ 群聊表情包的氛围触发判定、信息安全边界、短字梗、群内经典语录和反应图提示词模板。
- 新增 QQ 出站 @ 与消息引用支持：普通 webhook 群回复会 @ 原发言者并通过 `message_reference` 引用原消息，C2C 回复会携带引用信息，底层 QQ client 支持 `mentionUserIds` 与 `messageReference` 发送选项；普通文本 @ 使用 QQ 群实测可渲染的 `<@userid>` 兼容格式，Markdown 消息继续使用 `<qqbot-at-user id="..." />`。
- 新增群聊/C2C 入站图片附件接入：当 QQ webhook 消息携带图片 `attachments` 时，机器人会把图片 URL 作为 OpenAI Responses `input_image` 传给 AI；纯 @ 图片不再被当作空消息忽略，并会在聊天审计中记录图片附件摘要。
- 新增普通群聊 AI 回复后的偶发图片反应能力：可通过 `AI_CHAT_IMAGE_ENABLED`、`AI_CHAT_IMAGE_CHANCE` 和 `AI_CHAT_IMAGE_PROMPT` 控制机器人在文字回复后异步生成并发送 QQ 反应表情包。
- 新增版本日志规则文档，统一后续发布记录口径。
- 新增提交前版本日志和自动递增版本号规则，要求源码、配置或 Skill 行为变更随提交同步更新版本号与 changelog。
- 新增本机桌面控制台 `npm.cmd run desktop`，支持管理 bot 子进程、健康检查、守护重启、日志尾随、SQLite 只读浏览、聊天审计与叙事记录筛选。
- 新增 `chat_audit_log` 本地审计表，记录后续群聊/C2C 入站消息、bot 出站回复与主动播报，便于排查进程异常前后的真实收发记录。
- 新增 `AI_REPLY_MODE=all` 的群聊全量监听选择性回复策略：机器人会接收并记录允许的群消息，但只对疑问、求助、点名搭话和少量适合接话的氛围消息触发 AI。
- 新增全量模式专用回复提示词，要求以“小豆包”人格为核心，短句、适度玩笑、优先回答群友疑问并避免刷屏。
- 新增 `bot-persona-hotplug` 的小鹰群聊人格参考文件，便于后续复用或再次热插拔。
- 新增 `.aictx` / `.aiprompt` 上下文预览命令，可在不调用模型、不写入叙事历史的情况下查看 `.ai` 本轮会携带的身份、记忆、模组和聊天历史材料。
- 新增 `.npctx` / `.npcctx` NPC 上下文预览命令，用于排查 `.npc` 本轮会带入的 Skill 约束、训练记录和同 NPC 近期叙事历史。
- 新增 `.npcdraft` NPC 候选回复命令，一次生成 3 个可供 KP 挑选或改写的候选台词，默认不写入叙事历史。
- 新增 `.npcsave` 命令，允许 KP 把手动改好的 NPC 回复记录为正式叙事历史，供后续 `.npc` 承接。
- 新增跑团记录能力：`.sc 0/1d6` 使用角色卡 SAN 时会自动写回剩余 SAN 并记录属性变化，`.hp` / `.san` 和手动 `.st` 改值会记录角色卡数值变化，`.log` 可记录重大事件、模组进度和查看最近记录。
- 新增 `build-coc-character-sheet` 项目内 Skill，用于让机器人在成员车卡、建卡、创建调查员或整理 `.st` 保存命令时逐步引导角色卡创建流程。
- 新增 NPC RP Studio 可交付切片：本机管理台可编辑 NPC 人格卡、结构化训练反馈、记忆锚点，查看后端试演 Prompt，并导出 SillyTavern `chara_card_v2` 角色卡快照与 manifest。
- 新增 `persona_cards`、`rp_training_examples`、`rp_memory_anchors` 本地 SQLite 表；`.npc`、`.npcdraft`、`.npctx` 和 `.npcdm` 会按 NPC 名称自动带入同名人格卡、训练样本和玩家可见已确认锚点。
- 新增管理台 `/api/rp/personas`、`/api/rp/training-examples`、`/api/rp/memory-anchors`、`/api/rp/inspect` 和 `/api/rp/export/sillytavern-character` 接口，用于 NPC RP Studio GUI 和 SillyTavern 导出。

### 调整

- 调整普通群聊 AI 图片反应运行时提示词，移除“无需文字也能理解”的旧约束，改为允许安全短字梗并禁止 `先看样图`、`正在生成` 等流程说明式文案。
- 调整 `chat-meme-reaction` 文案规则，新增“这是什么梗”自检，要求表情包文字表达可复用反应而不是当前任务说明，并把 `先看样图` 这类元说明列为失败示例。
- 调整普通群聊 AI 图片反应默认提示词和配置示例，允许安全的中文短字梗或群内公开语录，并强调小尺寸贴纸感而不是完整插图。
- 普通群聊 AI 图片反应现在会在用户明确要求照片、图片、画图或表情包时绕过随机概率直接触发，并提示文字模型不要再回复“完全不能发图”。
- 将默认群聊人格从“小豆包”切换为原创虚构“小鹰人格”，覆盖 `.ai`、@bot、C2C AI 和主动回复的默认口吻。
- 精简公开 `.help` 输出，只保留骰点、检定、SAN、AI 和角色卡基础调用指令，不再展示 NPC、秘密私聊、PM、播报、记忆和训练类指令。

### 修复

- 修复 OpenAI 回复失败时后台日志只保留泛化错误的问题，现在会记录上游原始错误、耗时、模型、reasoning、触发来源、输入长度和附加上下文长度，便于排查私聊或群聊回复失败原因。
- 修复 `AI_REPLY_MODE=mention` 下，QQ 将 `<@...>` 开头的群 @ 消息投递为 `GROUP_MESSAGE_CREATE` 时机器人只记录不回复的问题。
- 修复 `.ai`、`.npc`、`.secret`、`.npcdm`、`.train` 等异步命令失败时错误逃逸到 webhook、导致群里收不到失败提示的问题。

### 文档

- 将项目规则、`.env.example` 注释、SillyTavern 体验文档、NPC RP Studio 规划和项目内 Skill 说明统一改为中文说明，保留命令、路径、字段名和配置名原文。
- 新增 NPC RP Studio 第一版规划文档，明确先聚焦 NPC 人格卡、试演、训练反馈与 SillyTavern 角色卡导出。
- 新增 SillyTavern Lab 无损体验计划，约定在项目外独立安装并记录可借鉴的角色 RP 体验。
- 新增 SillyTavern 原生 RP 体验操作指南，便于逐步评估角色卡、世界书、上下文和交互手感。
- 新增 SillyTavern RP 提示词经验记录，并把林医生实验、原生体验反馈、强角色锁、不出戏感、接戏能力、上下文预设自动化、后端剧情时间维护、耐心阈值、NPC 主观能动性和异常输入处理写入 NPC RP Studio 规划。
- 补充 SillyTavern 世界书续写、穿帮修复、连续性修复、记忆锚点和模型临时补写事实的产品化经验，并同步写入 NPC RP Studio 规划。
- 新增 SillyTavern 结合设计文档，明确本项目与酒馆的安全导出、玩家版/KP-only 数据边界、反馈回流、未来网关路线和验收标准，并在 NPC RP Studio 规划中补充导出 manifest 与回流约束。
- 更新 README 和 NPC RP Studio 规划，说明当前管理台 GUI、后端 NPC prompt 约束和 SillyTavern 导出切片已经可用。
- 补充 `AI_REPLY_MODE=all` 配置说明，标注全量接收仍会选择性回复并可能增加 AI 调用量。

### 验证

- `npm.cmd test`：通过，12 个测试文件、101 个用例通过。
- `npm.cmd run typecheck`：通过。
- `npm.cmd run build`：通过。
- 项目内 Skill 快速验证：`bot-persona-hotplug`、`coc-module-importer`、`npc-live-roleplay`、`persona-style-builder`、`proactive-story-flavor`、`chat-meme-reaction` 和 `build-coc-character-sheet` 均通过。
- `git status --short skills`：确认本次新增与修改的项目内 Skill 文件均显示为可跟踪提交候选。
- 全局 Skill 路径扫描：仅命中 `CHANGELOG.md` 中既有验证记录，未发现本次新增或修改的 Skill 文件误写全局 Skill 路径。
- `npm.cmd test -- tests/aiClient.test.ts`：1 个测试文件、3 个用例通过，覆盖 AI client 基础指令和多模态输入构造。
- `npm.cmd run typecheck`：通过，覆盖 OpenAI 回复失败日志增强的 logger 类型检查。
- `python C:\Users\Seija\.codex\skills\.system\skill-creator\scripts\quick_validate.py skills\chat-meme-reaction`：通过，确认运行时接入后项目内表情包 Skill 结构仍有效。
- `git status --short skills`：确认 `skills/chat-meme-reaction/` 仍作为可跟踪提交候选出现；工作区仍保留既有其他 Skill 改动。
- `rg "C:\\Users\\Seija|\.codex\\skills|\.codex/skills" -g "!AGENTS.md"`：仅命中 `CHANGELOG.md` 既有验证记录，新运行时接入未误写全局 Skill 路径。
- `git diff --check -- src/server.ts src/config.ts tests/server.test.ts .env.example README.md CHANGELOG.md package.json package-lock.json skills/chat-meme-reaction`：通过，仅提示 `.env.example` 下次由 Git 触碰时会按属性转换换行。
- `npm.cmd test -- tests/server.test.ts`：通过，1 个测试文件、24 个用例覆盖普通群聊 AI 表情包氛围评分、低氛围不发、自动冷却、显式要图绕过概率和图片提示词短字梗约束。
- `npm.cmd run typecheck`：通过，覆盖 `AI_CHAT_IMAGE_MIN_GAP_MINUTES` 配置类型、运行时氛围判定和相关测试类型检查。
- `python C:\Users\Seija\.codex\skills\.system\skill-creator\scripts\quick_validate.py skills\chat-meme-reaction`：通过，覆盖本次表情包文案自检规则调整。
- `git status --short skills`：确认 `skills/chat-meme-reaction/` 仍作为可跟踪提交候选出现。
- `rg "C:\\Users\\Seija|\.codex\\skills|\.codex/skills" -g "!AGENTS.md"`：仅命中 `CHANGELOG.md` 既有验证记录，新改动未误写全局 Skill 路径。
- `git diff --check -- skills/chat-meme-reaction CHANGELOG.md package.json package-lock.json`：通过。
- `python C:\Users\Seija\.codex\skills\.system\skill-creator\scripts\quick_validate.py skills\chat-meme-reaction`：通过。
- `git status --short skills`：确认新增 `skills/chat-meme-reaction/` 已作为可跟踪提交候选出现；工作区仍保留既有其他 Skill 改动。
- `rg "C:\\Users\\Seija|\.codex\\skills|\.codex/skills" -g "!AGENTS.md"`：仅命中 `CHANGELOG.md` 既有验证记录，新表情包 Skill 未误写全局 Skill 路径。
- `npm.cmd run typecheck`：通过。
- `git diff --check -- skills/chat-meme-reaction src/config.ts .env.example README.md CHANGELOG.md package.json package-lock.json`：通过，仅提示 `.env.example` 下次由 Git 触碰时会按属性转换换行。
- 项目内 `build-coc-character-sheet` Skill 快速验证：通过。
- `npm.cmd test -- tests/commands.test.ts`：1 个测试文件、30 个用例通过，覆盖建卡请求自动带入本地 Skill instructions。
- `npm.cmd run typecheck`：通过，覆盖角色卡建卡 Skill 加载器和 AI 上下文接入。
- `git status --short skills`：确认新增 `skills/build-coc-character-sheet/` 已作为可跟踪提交候选出现。
- 全局 Skill 路径扫描：仅命中 `CHANGELOG.md` 既有历史验证记录，未发现本次新增 Skill 文件包含全局 Skill 路径。
- `git diff --check -- CHANGELOG.md package.json package-lock.json src/characterCreationSkill.ts src/narrativeContext.ts tests/commands.test.ts skills/build-coc-character-sheet`：通过。
- `npm.cmd test -- tests/qqClient.test.ts tests/server.test.ts`：通过，2 个测试文件、28 个用例覆盖 QQ 出站 @、消息引用请求体，以及 webhook 群回复/C2C 回复携带引用参数。
- `npm.cmd run typecheck`：通过，覆盖 QQ 发送选项、webhook 回复参数和相关测试类型检查。
- `npm.cmd test`：通过，12 个测试文件、94 个用例通过。
- `npm.cmd run typecheck`：通过，覆盖入站图片附件类型、OpenAI `input_image` 内容构造和 webhook 触发链路类型检查。
- `npm.cmd test -- tests/server.test.ts tests/aiClient.test.ts`：通过，2 个测试文件、25 个用例覆盖纯 @ 图片触发 AI、@ 文本加图片透传、聊天审计附件摘要和 OpenAI 多模态 content 构造。
- `npm.cmd test -- tests/server.test.ts`：通过，20 个用例覆盖普通 AI 群聊回复后异步生成并发送图片反应，以及明确要图时绕过概率触发。
- `npm.cmd run typecheck`：通过。
- 项目内 `bot-persona-hotplug` Skill 快速验证：通过。
- `npm.cmd test -- tests/aiClient.test.ts`：1 个测试文件、2 个用例通过。
- `npm.cmd run typecheck`：通过。
- `git status --short skills`：确认新增 `skills/bot-persona-hotplug/references/xiaoying-group-chat-persona.md` 已作为可跟踪提交候选出现。
- 全局 Skill 路径扫描：未发现本次新增的小鹰人格文件包含全局 Skill 路径；仓库既有 changelog 验证记录仍命中历史路径文本。
- `rg -n "[A-Za-z]{4,}" AGENTS.md README.md CHANGELOG.md docs skills -g "*.md" -g "!node_modules/**" -g "!outputs/**" -g "!data/**"`：用于检查项目自有 Markdown 中的英文残留。
- `rg -n "[A-Za-z]{4,}" .env.example docs AGENTS.md README.md CHANGELOG.md skills -g "!node_modules/**" -g "!outputs/**" -g "!data/**"`：用于检查配置样例和项目文档中的英文残留。
- `python C:\Users\Seija\.codex\skills\.system\skill-creator\scripts\quick_validate.py skills\<skill-name>`：对本次改动的 5 个项目内 Skill 均通过。
- `rg "C:\\Users\\Seija|\.codex\\skills|\.codex/skills" -g "!AGENTS.md"`：未发现误写全局 Skill 路径。
- 本次中文化为文档、规则和配置样例文字调整；未重新运行 npm 自动化测试。
- 本次仅补充 SillyTavern RP 经验文档和 NPC RP Studio 规划；未运行自动化测试。
- 本次仅补充 SillyTavern 世界书与林医生长聊实验经验文档；未运行自动化测试。
- 本次仅补充 SillyTavern 结合设计文档、README 文档导航和 NPC RP Studio 规划；未运行自动化测试。
- `git diff --check -- docs/SILLYTAVERN_INTEGRATION_DESIGN.md docs/NPC_RP_STUDIO_PLAN.md README.md CHANGELOG.md`：通过。
- `npm.cmd run typecheck`：通过。
- `npm.cmd test -- tests/server.test.ts`：1 个测试文件、18 个用例通过，覆盖全量模式疑问回复、低信号静默记录、点名搭话与 `<@...>` 群 @ 被投递为 `GROUP_MESSAGE_CREATE` 的回复路径。
- `npm.cmd test -- tests/commands.test.ts tests/server.test.ts`：2 个测试文件、36 个用例通过，覆盖 `<@...>` 群 @ 被投递为 `GROUP_MESSAGE_CREATE` 的回复路径和异步 AI 命令失败处理。
- `npm.cmd test`：12 个测试文件、81 个用例通过。
- `npm.cmd test -- tests/commands.test.ts`：1 个测试文件、22 个用例通过，覆盖公开 `.help` 不再展示 NPC、秘密私聊、PM、播报、记忆和训练类指令。
- `npm.cmd run typecheck`：通过。
- `npm.cmd test -- tests/commands.test.ts`：1 个测试文件、25 个用例通过，覆盖 `.aictx` 预览不调用模型、`.npcdraft` 不写入叙事历史、`.npcsave` 保存 KP 修正版 NPC 回复。
- `npm.cmd run typecheck`：通过。
- `npm.cmd test`：12 个测试文件、86 个用例通过。
- `npm.cmd test -- tests/commands.test.ts`：1 个测试文件、29 个用例通过，覆盖 SAN 自动写回、HP 调整入库、手动 `.st` 改值留痕和跑团事件/模组进度记录。
- `npm.cmd run typecheck`：通过。
- `npm.cmd test`：12 个测试文件、91 个用例通过。
- `npm.cmd run typecheck`：通过。
- `npm.cmd test -- tests/storage.test.ts tests/commands.test.ts tests/adminConsole.test.ts`：3 个测试文件、43 个用例通过，覆盖 RP Studio 存储、`.npc` 后端约束、管理台 RP API、Prompt Inspector 和玩家安全 SillyTavern 导出。
- `npm.cmd test`：12 个测试文件、96 个用例通过。
- `npm.cmd run build`：通过。

## [0.1.0] - 2026-07-02

### 新增

- 首次同步 QQ CoC 跑团 AI 助手项目到 GitHub。
- 包含 QQ Webhook、CoC 骰点与角色卡、模块导入、NPC 扮演、主动叙事与 OpenAI 集成的初始代码和测试。

### 验证

- `npm.cmd test`：10 个测试文件、34 个用例通过。
- `npm.cmd run typecheck`：通过。
