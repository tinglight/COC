---
name: coc-module-importer
description: 将 DOCX、Markdown 或纯文本 CoC/TRPG 模组导入为 canon 锁定的模组索引，以及可变 campaign/session 记录。用户想读取模组、提取背景规则、NPC、PC 相关分支、keeper-only 真相、线索、结局；KP 说“我是KP”要 briefing；PL 说“我是PL”要无剧透角色概念引导；KP 说“我们来备团”要导入所有角色卡、设计与模组规则相关的 PC 专属节拍，或维护现场 NPC 上下文、关系变化、PC 影响、世界状态、KP override 和 DIY 剧情补充时使用，同时不得改写核心模组规则。
---

# CoC 模组导入器

## 概览

使用这个 Skill，把一个模组文档转成 QQ CoC AI 桌边助手可用的两层资料：

- `canon/`：导入的原始事实、keeper-only 真相、规则、时间线、场景地图、线索、NPC 种子、分支触发条件和结局。导入后把这一层视为只读。
- `campaign/`：可变 KP 资料：改写、追加场景、PC 专属分支、现场日志、NPC 上下文、关系漂移，以及跑团造成的世界状态变化。

导入结果供 `.ai` 模组问答、NPC 上下文、KP 备团、session 跟踪和后续摘要使用。结构要足够清楚，让 AI 辅助能引用本地模组状态，而不是滑向外部记忆或编造事实。

永远不要为了适配一次 session 改写 canon。修正、房规、删减或扩展应写入 `campaign/keeper_overrides.md` 或 `campaign/session_state.json`，并记录原因。

## 快速开始

导入模组：

```bash
python scripts/import_module.py "path/to/module.docx" --out "path/to/output" --module-id "w-train-v2"
```

记录现场事件：

```bash
python scripts/record_session_event.py "path/to/output" --scene "car-2" --event "PC 打开了医疗柜" --pc "PC A" --npc "NPC Name" --world-change "医疗物资已经耗尽"
```

检查导入后 canon 文件是否被改动：

```bash
python scripts/check_canon_lock.py "path/to/output"
```

PC 已知后备团：

```text
把原始或粘贴的角色卡放进 campaign/pc_cards/，再填写 campaign/pc_prep_matrix.md 和 campaign/pc_branch_matrix.md。
```

为玩家塑造角色概念：

```text
询问 PL 想要的游玩体验、扮演舒适度、性格、背景和边界；推荐符合模组且无剧透的角色形象。
```

## 工作流

1. 用 `scripts/import_module.py` 读取模组文件。
2. 检查 `canon/module_index.json` 中的元数据、章节地图、规则候选、分支钩子、实体和可变 DIY 提示。
3. 跑团或编辑前先检查 `canon/canon_lock.md`。它记录来源 hash 和不可变规则边界。
4. 如果用户说“我是KP”，先给 KP 视角 briefing，而不是直接穷尽式摘要。
5. 如果用户说“我是PL”，执行无剧透 PL 角色塑造流程。
6. 如果 KP 说“我们来备团”，执行备团流程，并把所有参与角色卡导入 campaign 状态。
7. PC 已知后，用 `campaign/pc_branch_matrix.md` 把职业、技能、创伤、关系和背景钩子映射到 canon 分支触发条件。
8. 跑团过程中，用 `scripts/record_session_event.py` 追加每个有后果的事件，或手动更新 `campaign/session_state.json`。
9. KP 追加内容、替代场景、节奏变化和房规后果写入 `campaign/keeper_overrides.md`；标明每条 override 是替换呈现、添加内容，还是只改变节奏。
10. 在重要摘要、备团或发布任何派生材料前，运行 `scripts/check_canon_lock.py`。

## KP 简报规则

当用户说“我是KP”、“我是这个模组的KP”、“KP视角”，或询问怎么带这个模组时：

- 把回答视为守密人视角，并在有帮助时使用 keeper-only 真相。玩家可见导入语要单独标出。
- 优先说明模组爆点、拉动玩家前进的好奇钩子、最可能留下记忆的桌边时刻，以及承载关键场景、秘密、线索或情绪转折的重要 NPC。
- 解释最值得准备什么、桌上最可能发生什么，而不是只复述剧情顺序。
- NPC 介绍以桥接功能为重点：每个重要 NPC 能开启什么、承载哪个场景或揭示、给 PC 什么压力、KP 漏掉会出什么问题。
- 规则、分支、线索和隐藏真相的判断，应在可用时锚定到 canon 来源引用。
- 额外舞台建议、节奏删减或个人场景创意要标为 campaign 资料，不要当成 canon。
- 除非 KP 要求，不要倾倒完整逐场景改写。

## PL 角色塑造流程

当用户说“我是PL”、“我是玩家”、“帮我车卡”、“帮我做角色”，或询问该带什么角色时：

1. 把回答视为玩家可见。不要透露 keeper-only 真相、犯人身份、隐藏时间线、必需线索链、秘密 NPC 动机、结局或私密 PC 专属惊喜。
2. 如果有模组上下文，只使用无剧透材料：公开前提、时代、地点、语气、预期玩法、内容警告、桌面限制、玩家可见钩子和 KP 批准的招募导语。
3. 推荐概念前，先问少量塑形问题：
   - 偏好体验：调查、社交、行动、生存、神秘恐惧、情感戏、解谜、道德困境或喜剧调剂。
   - 扮演舒适度：第一次、轻量扮演、角色驱动、强沉浸，或能接受队内张力。
   - 角色类型：扎实专业人士、外来者、本地联系人、学者、怀疑论者、信徒、麻烦制造者、保护者、受害者相关者、权威人物，或被卷入太深的普通人。
   - 性格与缺点：好奇方式、恐惧反应、依恋、恶习、原则，以及绝不愿忽视什么。
   - 背景与联系：职业、家庭、债务、导师、竞争者、失踪者、组织、进入模组的理由，以及角色想从调查中得到什么。
   - 边界：主题、恐惧症、关系压力、背叛、身体恐怖、角色死亡，或希望柔化处理的话题。
4. 给出 2-4 个角色概念方向，每个包含：概念 pitch、为什么适合该模组的玩家可见前提、可能高光场景、有用但非强制技能、关系钩子、可玩的缺点，以及它大概会创造什么桌边体验。
5. 推荐优先贴合体验，而不是优化强度。除非模组玩家招募规则明说，不要说某角色“必须”有某技能。
6. 帮 PL 把选择的方向变成角色卡形象：姓名气质、职业、表面目标、私密愿望、人际钩子、调查习惯、恐惧按钮，以及 KP 可用来把角色拉进模组的一句话。
7. 如果某个角色想法与模组时代、前提、桌面语气或队伍需求冲突，建议一个邻近版本，保留用户幻想同时适配场景。
8. 如果 PL 想要更深的个人秘密或自定义钩子，询问这些内容应对玩家本人无剧透，还是交给 KP 做 campaign 备团。

## 备团流程

当 KP 说“我们来备团”、“开始备团”、“导入角色卡”或类似话时：

1. 如果缺少模组输出目录和参与者名单，先确认。
2. 请 KP 提供所有参与角色卡：文件、粘贴文本、由用户转写的截图，或现有本地路径。
3. 在模组输出目录内工作时，把每张原始卡保存到 `campaign/pc_cards/<pc-id>.md`。如果不能写文件，在回复中保持同样结构。
4. 在 `campaign/session_state.json` 的 `pcs` 下提取简洁 PC 记录：玩家/姓名、职业、时代相关身份、关键技能、重要关系、信念、恐惧/创伤、物品、债务、组织、秘密、当前动机和不确定字段。
5. 设计个人内容前，读取 `canon/module_index.json`、`canon/source_text.json`、`campaign/pc_branch_matrix.md` 和任何模组专属规则。
6. 只有当 PC 角色卡触发 canon 分支条件时，才填写 `campaign/pc_branch_matrix.md`。
7. 填写或创建 `campaign/pc_prep_matrix.md`，每个 PC 专属节拍一行：PC、角色卡信号、canon 钩子/来源引用、计划个人节拍、NPC 或场景承载者、规则/线索约束、安全/同意备注和状态。
8. 为每个 PC 设计不同的好奇钩子、压力点、线索路线、高光场景和可能后果，且必须能与模组原始规则共存。
9. 如果想要的个人节拍与 canon 冲突，先调整呈现、线索投放路线、节奏或 NPC 框架。只有 KP 明确替换规则时，才写入 `campaign/keeper_overrides.md`，并标明原来源引用和原因。
10. 除非 KP 明确要求可分享版本，否则不要把私密 PC 专属惊喜写进玩家可见摘要。

## Canon（原始事实层）规则

- 核心规则、设定前提、隐藏真相、硬时间线事实、必需线索和结局条件是 canon。
- NPC 即兴、PC 定制场景变体、感官细节、线索投放顺序和追加支线场景属于 campaign 状态，除非用户明确说正在更新源模组。
- 如果模组邀请 KP 自定义，canon 中保留这条邀请，实际自定义版本写入 campaign。
- 不确定某个变更属于 canon 还是 campaign 时，默认归入 campaign。
- 保留来源锚点。引用某条规则或分支存在的原因时，使用 `source_text.json` 的段落/块索引。
- 角色卡事实可以选择、参数化或个性化 canon 分支触发条件；除非 KP 记录明确 override，否则不能改写隐藏真相、必需线索、硬时间线事实或结局条件。

## 状态跟踪

新增字段或接入应用/数据库时，阅读 `references/state-schema.md`。重要状态桶包括：

- `pcs`：按 PC id 记录解析后的角色卡事实、不确定点、已激活模组钩子和备团备注。
- `npcs`：当前场景、可见行为、私密知识、伤势、目标、上次互动和上下文备注。
- `relationships`：NPC、PC、派系和地点之间的有向或双向变化。
- `pc_impacts`：每个 PC 改变了世界什么、世界了解了他们什么，以及他们激活了哪些模组分支。
- `pc_prep`：计划中的 PC 专属节拍、canon 钩子、NPC/场景承载者，以及规则或线索约束。
- `world_changes`：地点、派系、线索、资源、公开传闻和时间线的持久变化。
- `scene_log`：带来源、参与者和后果的追加式事件流。

## 导入注意事项

改动导入启发式前，阅读 `references/import-policy.md`。导入器刻意产出候选项，而不是最终文学分析。优先相信明确章节标签和来源文本，不要编造确定性。

DOCX 文件使用 `python-docx`。如果中文路径在 shell 里失败，把路径作为普通命令行参数传给脚本，或使用环境变量，不要把路径嵌进管道 Python 源码。

运行时导入位于 `data/module_imports`，且 `data/` 被 git 忽略。检查本项目是否已经导入某个模组时，直接检查这个目录，不要只依赖 `rg --files` 这类跟踪文件搜索。

在 Windows PowerShell 中，显式按 UTF-8 读取导入 JSON：

```powershell
Get-Content .\data\module_imports\<module-id>\canon\module_index.json -Raw -Encoding UTF8 | ConvertFrom-Json
```

## 资源

- `scripts/import_module.py`：解析 DOCX/Markdown/text，并创建 canon/campaign 输出目录。
- `scripts/record_session_event.py`：追加现场事件，并更新 NPC、关系、PC 影响和世界状态。
- `scripts/check_canon_lock.py`：检测 canon 文件是否被意外编辑。
- `references/state-schema.md`：输出结构和更新契约。
- `references/import-policy.md`：分类规则和 PC 相关分支处理。
