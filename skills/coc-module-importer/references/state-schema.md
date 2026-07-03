# Campaign（跑团状态层）结构

## 目录契约

```text
module-output/
  module_manifest.json
  import_summary.md
  canon/
    source_text.json
    module_index.json
    canon_lock.md
  campaign/
    keeper_overrides.md
    live_log.md
    pc_cards/
      <pc-id>.md
    pc_branch_matrix.md
    pc_prep_matrix.md
    session_state.json
```

`canon/` 导入后只读。`campaign/` 存放跑团现场变化。

## session_state.json

顶层字段：

- `module_id`：导入模组的稳定 id。
- `source_sha256`：导入时原始模组文件的 hash。
- `canon_digest`：导入后 canon 文件的 digest。
- `canon_policy`：简短规则边界和允许变动的层。
- `pcs`：按姓名或 id 索引的角色卡解析记录。
- `npcs`：按姓名索引的 NPC 记录。
- `relationships`：双人/双实体关系记录。
- `pc_impacts`：PC 造成的后果列表。
- `pc_prep`：跑团前计划的 PC 专属节拍，可选。
- `world_changes`：对设定、地点、派系、线索和资源的持久改变列表。
- `scene_log`：追加式事件列表。
- `open_threads`：未解决钩子、谜题、待处理后果和 KP TODO。

## PC 角色卡与备团

角色卡属于 `campaign/`，不属于 `canon/`。

把原始或轻度规范化的角色卡文本保存在 `campaign/pc_cards/<pc-id>.md`。保留来源文件名、粘贴文本备注和不确定标记，方便之后备团时区分角色卡事实与推断。

推荐的 `pcs[pc_id]` 字段：

- `pc_id`
- `player`
- `name`
- `occupation`
- `era_context`
- `key_skills`
- `relationships`
- `beliefs`
- `fears_or_trauma`
- `possessions`
- `organizations`
- `secrets`
- `current_motivation`
- `raw_card_ref`
- `uncertain_fields`
- `activated_branch_hooks`
- `prep_notes`

用 `campaign/pc_prep_matrix.md` 进行 KP 规划。推荐列：

- `PC`
- `Card Signal`
- `Canon Hook / Source Ref`
- `Personal Beat`
- `NPC / Scene Carrier`
- `Rule Or Clue Constraint`
- `Safety / Consent Note`
- `Status`

当结构化应用或数据库需要同样信息时，在 `session_state.json` 中使用 `pc_prep`。每条记录应包含 `pc_id`、`card_signals`、`canon_refs`、`planned_beat`、`carrier`、`constraints`、`status` 和 `visible_to_players`。

不要让 PC 专属节拍悄悄替换隐藏真相、必需线索、硬时间线事实或结局条件。如果 KP 想做真实规则变更，写入 `keeper_overrides.md`，并记录原始来源引用和原因。

## NPC 记录

推荐字段：

- `name`
- `source_refs`
- `current_scene`
- `public_state`
- `private_state`
- `known_facts`
- `goals`
- `attitude_to_pcs`
- `relationship_notes`
- `last_seen_event_id`
- `context_notes`

不要用 NPC 状态向玩家泄露 keeper-only 真相。把私密知识和公开行为分开。

## 关系记录

使用稳定 key，例如 `A <-> B`。存储：

- `a`
- `b`
- `score` 或 `stance`
- `changes`：追加式列表，元素为 `{event_id, delta, reason}`
- `visible_to_players`

## 世界变化记录

存储：

- `event_id`
- `scope`：地点、派系、资源、线索、时间线、传闻、法律、技术或其它。
- `description`
- `caused_by`
- `reversibility`：临时、可逆、有代价、不可逆、未知。
- `source`：session 事件、KP override 或导入 canon。

## Canon（原始事实层）更新规则

永远不要为了表示跑团现场而编辑 canon。如果 KP 有意改变规则，添加一条 override，并包含：

- 原始来源引用
- 改变后的本桌行为
- 原因
- 这是仅呈现变化、仅节奏变化、仅线索路线变化，还是真正替换规则
