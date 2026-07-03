# NPC 扮演工作室规划（NPC RP Studio）

## 目的

第一个产品里程碑聚焦 NPC 扮演质量，而不是长篇世界模拟。目标是让每个 NPC 更容易定义、试演、批评和导出到 SillyTavern，同时保留 QQ bot 现有的 CoC 规则、权限、骰子和模组边界。

核心问题：

> 这个 NPC 听起来像真实 KP 或玩家在桌边扮演吗？

## 范围

第一版包含：

- 轻量 NPC 人格卡。
- 本地管理控制台里的 NPC 试演。
- 针对坏回复和改进回复的结构化训练反馈。
- NPC 回复提示词检查器。
- 用于手动测试的 SillyTavern 角色卡导出。
- 面向 SillyTavern 的安全导出预览、来源 manifest 和人工反馈回流设计，详见 [SillyTavern 结合设计](SILLYTAVERN_INTEGRATION_DESIGN.md)。

当前可交付切片：

- SQLite 已保存 `PersonaCard`、`TrainingExample` 和 `MemoryAnchor`。
- 本地管理控制台已有 `NPC RP Studio` 标签页，可编辑人格卡、训练反馈、记忆锚点，查看试演 Prompt，并导出 SillyTavern 角色卡快照。
- `.npc`、`.npcdraft`、`.npctx` 和 `.npcdm` 会按 NPC 名称自动带入同名人格卡、结构化训练样本和玩家可见已确认锚点。
- SillyTavern 玩家版导出会排除 `privateNotes`、KP-only 锚点和未确认关键事实，并写入 manifest。

第一版不包含：

- 完整复刻 SillyTavern 风格的 World Info。
- 长时间运行的世界状态模拟。
- 宏大的故事推进引擎。
- SillyTavern 界面扩展。
- OpenAI 兼容的 SillyTavern 网关 API。
- 自动读取或写入 SillyTavern 聊天数据库。
- 把本项目 `.env`、SQLite、keeper-only 模组资料或运行日志暴露给 SillyTavern。
- 把骰子、SAN、技能检定或角色卡数值计算移动到模型提示词里。

## 数据模型

`PersonaCard`：

- `id`
- `name`
- `role`：`bot`、`npc` 或 `narrator`
- `publicDescription`
- `privateNotes`
- `speechStyle`
- `knowledgeBoundary`
- `exampleDialogues`
- `avoidRules`
- `patiencePolicy`
- `agencyRules`
- `abnormalInputPolicy`
- `tableBoundaryPolicy`
- `anchorStyle`
- `continuityRepairPolicy`
- `tags`
- `createdAt`
- `updatedAt`

`SillyTavernExportManifest`：

- `exportId`
- `personaId`
- `npcName`
- `visibility`：`player` 或 `kp`
- `generatedAt`
- `sourceVersion`
- `sourceHash`
- `includedAnchors`
- `excludedPrivateFields`
- `targetFormat`
- `files`

`TrainingExample`：

- `id`
- `npcName`
- `issueType`
- `badReply`
- `correction`
- `goodReply`
- `score`
- `tags`
- `createdAt`
- `updatedAt`

`MemoryAnchor`：

- `id`
- `scopeType`：`campaign`、`session`、`scene` 或 `npc`
- `scopeId`
- `npcName`
- `anchorType`：`time`、`location`、`object`、`person`、`event` 或 `contradiction`
- `label`
- `content`
- `sourceMessageId`
- `sourceType`：`worldbook`、`chat`、`kp-note`、`training` 或 `model-draft`
- `visibility`：`player` 或 `kp`
- `status`：`confirmed`、`candidate` 或 `rejected`
- `createdAt`
- `updatedAt`

## 后端变更

- 新增 `PersonaCard` 和 `TrainingExample` 的 SQLite 表与 storage 方法。
- 新增 `MemoryAnchor` 表与 storage 方法，用于记录钟表、纸条、登记册、地点、人物关系、物品交接、矛盾修复等可复用叙事锚点。
- 保留 `npc-live-roleplay` 作为共享基础规则集。
- 更新 NPC 回复构造流程：如果匹配到 `PersonaCard`，先注入人格卡，再注入通用训练规则。
- 吸收 SillyTavern 的角色持续接戏能力，但为重复、装失忆、无意义挑衅等异常输入增加耐心阈值、NPC 主观行动和 KP 层确认出口。
- 新增后端剧情时间层：维护 `sceneClock`、`turnCount`、`elapsedMinutes`、`scheduledEvents`、`timeAdvancePolicy` 和 `timeLog`，由后端根据行动类型推进时间，再把当前时间摘要注入 NPC prompt。
- 新增连续性修复策略：轻微矛盾优先角色内修复，中等矛盾请求 KP 层确认，严重矛盾允许回滚或明确更正；修复依据必须标明来自后端状态、聊天历史、世界书还是模型临时补写。
- 世界书或模组条目进入 prompt 时保留来源、可见性和事实等级；模型临时补写的新 NPC、精确数字或关键事实默认只能进入 `candidate` 状态，不能自动升格为 canon。
- SillyTavern 导出只通过独立适配层生成快照，不让酒馆字段名污染本项目核心数据模型；默认写入被 `.gitignore` 排除的 `outputs/sillytavern/<exportId>/`。
- 导出适配层默认只包含玩家可见资料；KP-only 导出必须显式触发，并在文件名、角色名或 manifest 中标出。
- SillyTavern 试演结果回流时必须由 KP 人工选择；好回复进入 `TrainingExample` 或 `exampleDialogues`，新事实先进入 `MemoryAnchor.status = candidate`。
- 新增 NPC 试演 API：
  - `GET /api/rp/personas`
  - `POST /api/rp/personas`
  - `PUT /api/rp/personas/:id`
  - `GET /api/rp/training-examples`
  - `POST /api/rp/training-examples`
  - `GET /api/rp/memory-anchors`
  - `POST /api/rp/memory-anchors`
  - `PUT /api/rp/memory-anchors/:id`
  - `POST /api/rp/rehearse`
  - `POST /api/rp/inspect`
- `POST /api/rp/export/sillytavern-character`
- `GET /api/rp/export/sillytavern/:exportId/manifest`
- 普通 SillyTavern 导出必须排除 `privateNotes`；KP-only 导出必须显式请求，并用清楚的名字标出。

## 前端变更

在现有本地管理控制台中新增 `NPC RP Studio` 标签页。

视图：

- 人格卡：创建、编辑和检查 NPC 人格卡。
- NPC 试演：选择 NPC，输入玩家台词，生成回复，并查看上下文摘要。
- 训练反馈：保存问题类型、修正建议和改进示例。
- 记忆锚点：查看和确认候选锚点，例如钟表、纸条、登记册、地点、物品交接、关系变化和矛盾修复记录。
- 提示词检查器：展示本次回复使用的人格卡、训练示例、当前剧情时间、即将触发的日程事件、命中的世界书条目、记忆锚点、最近 NPC 历史、连续性修复依据和最终任务。
- SillyTavern 导出：把当前 NPC 导出为角色卡，并显示输出路径。
- SillyTavern 导出预览：显示将写入角色卡、`character_book`、manifest 的字段，以及被排除的 keeper-only 和私密字段数量。
- SillyTavern 反馈回流：从剪贴板或手动表单保存好回复、坏回复、修正版回复和候选锚点，不自动导入整段酒馆聊天记录。
- 怪玩家测试：用重复提问、假装无事发生、突然离开又返回等输入检查 NPC 是否既能接戏，也能设边界。

界面应保持紧凑、偏操作型。不要暴露所有模型参数，也不要复制 SillyTavern 面向高级用户的完整界面。

## 验证

- 人格卡可以创建、更新和查询。
- 训练示例可以按 NPC 保存和读取。
- 记忆锚点可以按场景、NPC、可见性和状态保存、筛选和确认。
- 试演会使用人格卡、训练示例和最近 NPC 叙事事件。
- 提示词检查器返回分层摘要，显示命中的世界书条目、记忆锚点和连续性修复依据，且不会把 `privateNotes` 或 KP-only 锚点泄露到玩家可见输出。
- 剧情时间由后端推进；模型回复只表现当前 `sceneClock` 和 `scheduledEvents`，不能自行随意跳天或改写时间轴。
- 连续异常输入会先触发角色内反应，再触发 NPC 后果或 KP 层确认，避免无限耐心地强行圆场。
- 模型临时补写的新 NPC、精确人数、地点移动或关键事实默认标为候选锚点，必须经 KP 确认后才能进入长期记忆。
- 普通 SillyTavern 导出排除 KP-only 备注。
- 普通 SillyTavern 导出文件中搜索不到 `privateNotes`、keeper-only、绑定码、openid、`.env` 值和本地日志内容。
- KP-only SillyTavern 导出必须显式触发，并在 manifest 的 `visibility` 中标为 `kp`。
- SillyTavern 试演回流的新事实默认进入候选锚点，不自动写入 canon。
- 现有 `.npc`、`.train show` 和 `.train note` 行为保持兼容。
- 运行 `npm.cmd run typecheck`、`npm.cmd test` 和 `npm.cmd run build`。
