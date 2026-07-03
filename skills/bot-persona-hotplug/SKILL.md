---
name: bot-persona-hotplug
description: 应用、替换、检查或移除这个 QQ CoC 骰子 bot 的默认群聊人格卡。需要启用人格卡、热切换 bot 群聊人格、恢复中性助手口吻、禁用/移除人格卡，或管理用于 `.ai`、@bot、C2C AI、主动 AI 回复的 `src/ai/persona.ts` 时使用。
---

# Bot 人格热插拔

## 概览

使用这个 Skill 改变 bot 全局群聊人格。该人格会追加到 `src/ai/client.ts` 的默认 AI 指令中。热插拔点是 `src/ai/persona.ts`；禁用人格时，应让该文件导出空字符串，而不是删除 import 路径。

## 常用命令

检查当前人格：

```powershell
python .\skills\bot-persona-hotplug\scripts\persona_hotplug.py status
```

应用内置豆包风格人格：

```powershell
python .\skills\bot-persona-hotplug\scripts\persona_hotplug.py apply --persona-file .\skills\bot-persona-hotplug\references\doubao-group-chat-persona.md
```

移除当前人格并恢复中性助手口吻：

```powershell
python .\skills\bot-persona-hotplug\scripts\persona_hotplug.py remove
```

## 工作流

1. 判断用户要执行的操作：应用、替换、检查或移除。
2. 可复用人格应把运行时提示词存到 `skills/bot-persona-hotplug/references/<persona-name>.md`。一次性切换可以用临时文件，不要提交。
3. 从仓库根目录运行 `scripts/persona_hotplug.py`。脚本只编辑 `src/ai/persona.ts`。
4. 如果用户给松散笔记并要求创建新人格，先把运行时提示词写成直接行为规则，再应用它。安全边界和 CoC 边界必须明确。
5. 用 `npm.cmd test -- tests/aiClient.test.ts` 和 `npm.cmd run typecheck` 验证。

## 人格规则

人格文本应简短，并可直接运行。包括：

- 名称或模式标签。
- 默认语气和回复长度。
- 口头禅频率控制。
- 遇到未知话题时的策略。
- CoC 边界：不得编造骰点、角色卡数值、KP 秘密、隐藏模组真相或规则确定性。

不要把 API key、群 openid、私人日志或真实玩家秘密写进人格卡。

## 脚本说明

`scripts/persona_hotplug.py` 支持 `status`、`apply --persona-file <path>` 和 `remove`。只有在临时 checkout 上测试时才使用 `--repo <path>`。脚本会用正确转义写入 TypeScript 字符串数组，中文标点和引号是安全的。
