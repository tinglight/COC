---
name: bot-persona-hotplug
description: Apply, replace, inspect, or remove the default group-chat persona card for this QQ CoC dice bot. Use when Codex needs to enable a persona card, hot-swap the bot's group chat personality, restore the neutral assistant voice, disable/remove a persona card, or manage src/ai/persona.ts for .ai, @bot, C2C AI, or proactive AI replies.
---

# Bot Persona Hotplug

## Overview

Use this skill to change the bot-wide group chat persona that is appended to the default AI instructions in `src/ai/client.ts`. The hot-plug point is `src/ai/persona.ts`; disabling the persona should make that export an empty string instead of removing the import path.

## Quick Commands

Inspect current persona:

```powershell
python .\skills\bot-persona-hotplug\scripts\persona_hotplug.py status
```

Apply the bundled Doubao-style persona:

```powershell
python .\skills\bot-persona-hotplug\scripts\persona_hotplug.py apply --persona-file .\skills\bot-persona-hotplug\references\doubao-group-chat-persona.md
```

Remove the active persona and restore the neutral assistant voice:

```powershell
python .\skills\bot-persona-hotplug\scripts\persona_hotplug.py remove
```

## Workflow

1. Read the user's requested operation: apply, replace, inspect, or remove.
2. For a reusable persona, store the runtime prompt under `skills/bot-persona-hotplug/references/<persona-name>.md`. For a one-off swap, use a temporary file and do not commit it.
3. Run `scripts/persona_hotplug.py` from the repo root. The script only edits `src/ai/persona.ts`.
4. If the user asks for a new persona from loose notes, write the runtime prompt as direct behavior rules before applying it. Keep safety and CoC boundaries explicit.
5. Validate with `npm.cmd test -- tests/aiClient.test.ts` and `npm.cmd run typecheck`.

## Persona Rules

Keep persona text concise and runtime-ready. Include:

- Name or mode label.
- Default tone and reply length.
- Catchphrase frequency controls.
- Unknown-topic strategy.
- CoC boundaries: never invent dice rolls, character sheet values, KP secrets, hidden module truth, or rule certainty.

Do not put API keys, group openids, private logs, or real player secrets into a persona card.

## Script Notes

`scripts/persona_hotplug.py` supports `status`, `apply --persona-file <path>`, and `remove`. Use `--repo <path>` only when testing against a temporary checkout. The script writes TypeScript string arrays with proper escaping so Chinese punctuation and quotes are safe.
