---
name: coc-module-importer
description: Import CoC/TRPG scenario modules from DOCX, Markdown, or text into a canon-locked module index plus mutable campaign/session records. Use when the user wants to read a module script, extract background rules, NPCs, PC-dependent branches, keeper-only truth, clues, endings, or maintain live table records of NPC context, relationship changes, PC impact, world-state changes, KP overrides, and DIY plot additions without changing core module rules.
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

## Workflow

1. Read the module file with `scripts/import_module.py`.
2. Inspect `canon/module_index.json` for metadata, section map, rule candidates, branch hooks, entities, and mutable-DIY hints.
3. Inspect `canon/canon_lock.md` before running or editing. It states the source hash and the immutable rule boundary.
4. When PCs are known, use `campaign/pc_branch_matrix.md` to map occupations, skills, traumas, relationships, and backstory hooks to scenes.
5. During play, append every consequential event with `scripts/record_session_event.py` or manually update `campaign/session_state.json`.
6. Put KP additions, alternate scenes, pacing changes, and homebrew consequences in `campaign/keeper_overrides.md`; include whether each override replaces presentation, adds content, or changes only pacing.
7. Run `scripts/check_canon_lock.py` before important summaries, session prep, or publishing any derived material.

## Canon Rules

- Core rules, setting premises, hidden truth, hard timeline facts, required clues, and ending conditions are canon.
- NPC improvisation, PC-tailored scene variants, sensory details, clue delivery order, and added side scenes are campaign state unless the user explicitly says they are updating the source module.
- If the module invites KP customization, preserve the invitation in canon and store the actual custom version in campaign.
- When unsure whether a change is canon or campaign, default to campaign.
- Keep source anchors. Use paragraph/block indexes from `source_text.json` when citing why a rule or branch exists.

## State Tracking

Read `references/state-schema.md` when adding new fields or wiring this into an app/database. The important state buckets are:

- `npcs`: current scene, visible behavior, private knowledge, wounds, goals, last interaction, and context notes.
- `relationships`: directional or pairwise changes between NPCs, PCs, factions, and locations.
- `pc_impacts`: what each PC changed in the world, what the world learned about them, and which module branches they activated.
- `world_changes`: durable changes to locations, factions, clues, resources, public rumors, and timeline.
- `scene_log`: append-only event stream with source, participants, and consequences.

## Import Notes

Read `references/import-policy.md` before changing import heuristics. The importer intentionally produces candidates, not final literary analysis. Prefer explicit section labels and source text over invented certainty.

For DOCX files, use `python-docx`. If a Chinese path fails in a shell, pass the path as a normal command-line argument to the script or use an environment variable rather than embedding it in piped Python source.

## Resources

- `scripts/import_module.py`: parse DOCX/Markdown/text and create canon/campaign output folders.
- `scripts/record_session_event.py`: append live-table events and update NPC, relationship, PC impact, and world state.
- `scripts/check_canon_lock.py`: detect accidental edits to canon files.
- `references/state-schema.md`: output schema and update contract.
- `references/import-policy.md`: classification rules and PC-dependent branch handling.
