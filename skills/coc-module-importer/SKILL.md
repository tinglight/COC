---
name: coc-module-importer
description: Import CoC/TRPG scenario modules from DOCX, Markdown, or text into a canon-locked module index plus mutable campaign/session records. Use when the user wants to read a module script, extract background rules, NPCs, PC-dependent branches, keeper-only truth, clues, endings, brief a KP who says "我是KP", guide a PL who says "我是PL" through spoiler-safe character concept creation, prepare a table when the KP says "我们来备团", import all participating character sheets, design PC-specific beats tied to module rules, or maintain live table records of NPC context, relationship changes, PC impact, world-state changes, KP overrides, and DIY plot additions without changing core module rules.
---

# CoC Module Importer

## Overview

Use this skill to turn a scenario document into two layers for the broader QQ CoC AI table assistant:

- `canon/`: imported source facts, keeper-only truth, rules, timeline, scene map, clues, NPC seeds, branch triggers, and endings. Treat this layer as read-only after import.
- `campaign/`: mutable KP material: overrides, added scenes, PC-specific branches, live table log, NPC context, relationship drift, and world-state changes caused by play.

The imported output feeds `.ai` module questions, NPC context, KP prep, session tracking, and later summaries. Keep it structured enough that AI assistance can cite local module state without drifting into external memory or invented facts.

Never rewrite canon to fit a session. Put corrections, homebrew, cuts, or expansions in `campaign/keeper_overrides.md` or `campaign/session_state.json` with a reason.

## Quick Start

Import a module:

```bash
python scripts/import_module.py "path/to/module.docx" --out "path/to/output" --module-id "w-train-v2"
```

Record a live-table event:

```bash
python scripts/record_session_event.py "path/to/output" --scene "car-2" --event "PC opened the medical locker" --pc "PC A" --npc "NPC Name" --world-change "medical supplies are now depleted"
```

Check that canon files were not changed after import:

```bash
python scripts/check_canon_lock.py "path/to/output"
```

Prepare a table after PCs are known:

```text
Store raw or pasted character sheets in campaign/pc_cards/, then fill campaign/pc_prep_matrix.md and campaign/pc_branch_matrix.md.
```

Shape a player character concept:

```text
Ask the PL about desired play experience, roleplay comfort, personality, background, and boundaries; recommend a spoiler-safe character image that fits the module.
```

## Workflow

1. Read the module file with `scripts/import_module.py`.
2. Inspect `canon/module_index.json` for metadata, section map, rule candidates, branch hooks, entities, and mutable-DIY hints.
3. Inspect `canon/canon_lock.md` before running or editing. It states the source hash and the immutable rule boundary.
4. If the user says "我是KP", give a keeper-facing briefing before exhaustive summarization.
5. If the user says "我是PL", run the spoiler-safe PL character shaping flow.
6. If the KP says "我们来备团", run the table prep flow and import every participating character sheet into campaign state.
7. When PCs are known, use `campaign/pc_branch_matrix.md` to map occupations, skills, traumas, relationships, and backstory hooks to canon branch triggers.
8. During play, append every consequential event with `scripts/record_session_event.py` or manually update `campaign/session_state.json`.
9. Put KP additions, alternate scenes, pacing changes, and homebrew consequences in `campaign/keeper_overrides.md`; include whether each override replaces presentation, adds content, or changes only pacing.
10. Run `scripts/check_canon_lock.py` before important summaries, session prep, or publishing any derived material.

## KP Briefing Rules

When the user says "我是KP", "我是这个模组的KP", "KP视角", or asks how to bring the module:

- Treat the answer as keeper-facing and use keeper-only truth when it helps. Label any player-facing pitch separately.
- Prioritize the module's explosive points, the curiosity hooks that pull players forward, the most likely memorable table moments, and the key NPCs that carry crucial scenes, secrets, clues, or emotional turns.
- Explain what is most fun to prepare and what is most likely to happen at the table, not just the plot order.
- Keep NPC coverage bridge-focused: what each important NPC makes possible, what scene or reveal they carry, what pressure they put on PCs, and what can go wrong if the KP misses them.
- Anchor rules, branch claims, clues, and hidden truth to canon source refs when available.
- Mark any extra staging advice, pacing cut, or personal scene idea as campaign material, not canon.
- Avoid dumping a full scene-by-scene rewrite unless the KP asks for it.

## PL Character Shaping Flow

When the user says "我是PL", "我是玩家", "帮我车卡", "帮我做角色", or asks what character to bring:

1. Treat the answer as player-facing. Do not reveal keeper-only truth, culprit identity, hidden timeline, required clue chain, secret NPC motives, endings, or private PC-specific surprises.
2. If module context is available, use only spoiler-safe material: public premise, era, location, tone, expected play style, content warnings, table constraints, player-facing hooks, and KP-approved recruitment pitch.
3. Ask a small set of shaping questions before recommending a concept:
   - Preferred experience: investigation, social play, action, survival, occult dread, emotional drama, puzzle-solving, moral dilemma, or comic relief.
   - Roleplay comfort: first-time, light roleplay, character-driven, intense immersion, or okay with intra-party tension.
   - Character type: grounded professional, outsider, local contact, scholar, skeptic, believer, troublemaker, protector, victim-adjacent, authority figure, or ordinary person pulled in too deep.
   - Personality and flaws: curiosity style, fear response, attachment, vice, principle, and what they refuse to ignore.
   - Background and ties: occupation, family, debts, mentor, rival, lost person, organization, reason to enter the scenario, and one thing the character wants from the investigation.
   - Boundaries: themes, phobias, relationship pressure, betrayal, body horror, character death, or topics to keep soft.
4. Offer 2-4 character concept directions, each with: concept pitch, why it fits this module's player-facing premise, likely spotlight scenes, useful but not mandatory skills, relationship hooks, a playable flaw, and what experience it will probably create at the table.
5. Tune the recommendation toward experience, not optimization. Avoid saying a character "must" have a skill unless the module's player-facing recruitment rules say so.
6. Help the PL turn the chosen direction into a card image: name vibe, occupation, surface goal, private desire, interpersonal hook, investigation habit, fear button, and one sentence the KP can use to pull them into the module.
7. If a character idea would clash with the module's era, premise, table tone, or party needs, suggest a nearby version that keeps the user's fantasy while fitting the scenario.
8. If the PL wants deeper personal secrets or custom hooks, ask whether those should be spoiler-free for the player or handed to the KP for campaign prep.

## Table Prep Flow

When the KP says "我们来备团", "开始备团", "导入角色卡", or similar:

1. Confirm the module output folder and participant list if they are missing.
2. Ask the KP to provide every participating character sheet as files, pasted text, screenshots transcribed by the user, or existing local paths.
3. Preserve each raw card under `campaign/pc_cards/<pc-id>.md` when working in a module output folder. If files cannot be written, keep the same structure in the response.
4. Extract a concise PC record into `campaign/session_state.json` under `pcs`: player/name, occupation, era-relevant identity, key skills, important relationships, beliefs, fears/trauma, possessions, debts, organizations, secrets, current motivation, and uncertain fields.
5. Read `canon/module_index.json`, `canon/source_text.json`, `campaign/pc_branch_matrix.md`, and any module-specific rules before designing personal content.
6. Fill `campaign/pc_branch_matrix.md` only where a PC card activates a canon branch trigger.
7. Fill or create `campaign/pc_prep_matrix.md` with one row per PC-specific beat: PC, card signal, canon hook/source ref, planned personal beat, NPC or scene carrier, rule/clue constraints, safety/consent note, and status.
8. For each PC, design a distinct curiosity hook, pressure point, clue route, spotlight scene, and likely consequence that can coexist with the module's original rules.
9. If a desired personal beat conflicts with canon, first adjust presentation, clue delivery route, pacing, or NPC framing. Use `campaign/keeper_overrides.md` only for deliberate KP rule replacements, and label the original source ref plus reason.
10. Keep private PC-specific surprises out of player-facing summaries unless the KP explicitly asks for a shareable version.

## Canon Rules

- Core rules, setting premises, hidden truth, hard timeline facts, required clues, and ending conditions are canon.
- NPC improvisation, PC-tailored scene variants, sensory details, clue delivery order, and added side scenes are campaign state unless the user explicitly says they are updating the source module.
- If the module invites KP customization, preserve the invitation in canon and store the actual custom version in campaign.
- When unsure whether a change is canon or campaign, default to campaign.
- Keep source anchors. Use paragraph/block indexes from `source_text.json` when citing why a rule or branch exists.
- Character sheet facts can choose, parameterize, or personalize canon branch triggers; they cannot rewrite hidden truth, required clues, hard timeline facts, or ending conditions unless the KP records a deliberate override.

## State Tracking

Read `references/state-schema.md` when adding new fields or wiring this into an app/database. The important state buckets are:

- `pcs`: parsed character sheet facts, uncertainties, active module hooks, and prep notes keyed by PC id.
- `npcs`: current scene, visible behavior, private knowledge, wounds, goals, last interaction, and context notes.
- `relationships`: directional or pairwise changes between NPCs, PCs, factions, and locations.
- `pc_impacts`: what each PC changed in the world, what the world learned about them, and which module branches they activated.
- `pc_prep`: planned PC-specific beats, canon hooks, NPC/scene carriers, and rule or clue constraints.
- `world_changes`: durable changes to locations, factions, clues, resources, public rumors, and timeline.
- `scene_log`: append-only event stream with source, participants, and consequences.

## Import Notes

Read `references/import-policy.md` before changing import heuristics. The importer intentionally produces candidates, not final literary analysis. Prefer explicit section labels and source text over invented certainty.

For DOCX files, use `python-docx`. If a Chinese path fails in a shell, pass the path as a normal command-line argument to the script or use an environment variable rather than embedding it in piped Python source.

Runtime imports live under `data/module_imports`, and `data/` is ignored by git. When checking whether a module has already been imported in this project, inspect that directory directly instead of relying only on tracked-file searches such as `rg --files`.

On Windows PowerShell, read imported JSON as UTF-8 explicitly:

```powershell
Get-Content .\data\module_imports\<module-id>\canon\module_index.json -Raw -Encoding UTF8 | ConvertFrom-Json
```

## Resources

- `scripts/import_module.py`: parse DOCX/Markdown/text and create canon/campaign output folders.
- `scripts/record_session_event.py`: append live-table events and update NPC, relationship, PC impact, and world state.
- `scripts/check_canon_lock.py`: detect accidental edits to canon files.
- `references/state-schema.md`: output schema and update contract.
- `references/import-policy.md`: classification rules and PC-dependent branch handling.
