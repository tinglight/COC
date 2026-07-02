# Import Policy

## Goal

Convert a TRPG module into structured material without pretending that the importer has perfect understanding. Preserve source anchors and separate locked canon from mutable campaign state.

## Classification

- Metadata: module name, system, player count, length, era, stage, recommended skills, warnings.
- Core rules: system rules, module-specific mechanics, hard constraints, required checks, secret-table mode, ending requirements.
- Keeper-only truth: hidden cause, true timeline, culprit/black-box mechanism, late reveal, player-facing falsehoods.
- World lore: factions, technology, geography, recurring terms, organizations, public beliefs.
- Scene: intro, location, room, carriage, chapter, act, investigation area, chase, combat, finale.
- Clue: documents, logs, physical evidence, surveillance, NPC testimony, check-gated facts.
- NPC: named people, roles, logs by named persons, factions with agents, relationship-bearing entities.
- PC branch: sections triggered by occupation, skill, belief, trauma, backstory, relationship, or character-card trait.
- Ending: explicit ending labels, required conditions, aftermath variants.
- Mutable hook: lines telling the KP to customize, rewrite, add, omit, route clues differently, or tailor content to PCs.

## PC-Dependent Modules

For modules that change heavily by character card:

1. Keep the original branch trigger in canon.
2. Extract a campaign branch row for each trigger.
3. Do not choose a branch until PC cards are known.
4. Let KP write the concrete adapted scene in campaign, not canon.
5. Track which PC activated which branch and what world facts changed because of it.

Use `hook_type` to separate scale:

- `customization_policy`: the module's instruction for how KP should adapt content.
- `major_pc_branch`: a scene, route, or ending-scale branch driven by PC traits.
- `pc_micro_hook`: a smaller conditional detail, clue, easter egg, check modifier, or personal resonance.

## Source Integrity

Use paragraph/block indexes from the imported `source_text.json`. If a generated summary conflicts with source text, source text wins. If a source document is updated, re-import to a new output folder or record a deliberate source-version migration.

## Copyright And Table Use

Do not paste large module passages back into chat unless the user explicitly requests them and has rights to share them. Local structured files may contain extracted source text for private table use. Summaries in chat should stay brief.
