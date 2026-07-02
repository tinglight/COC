---
name: proactive-story-flavor
description: Create, revise, or inject player-safe module-world flavor into QQ CoC bot proactive story broadcasts. Use when Codex needs to make automatic/proactive stories fit a running scenario's era, location, institutions, social tensions, rumors, workplaces, and side incidents while preserving the existing proactive story cycle, cast/world growth rules, anti-repetition rules, 1-2 sentence Chinese output, and no-spoiler/no-main-plot boundaries.
---

# Proactive Story Flavor

## Overview

Use this skill to turn a CoC/TRPG module's worldview into ambient side stories for the QQ bot's proactive broadcasts. The stories should deepen era atmosphere and give players roleplay inspiration, but must stay outside the core scenario solution, required clue chain, hidden truth, and irreversible campaign outcomes.

This skill complements `coc-module-importer`: use the importer first when raw module files need canon/campaign extraction, then use this skill to derive broadcast-safe flavor material.

## Workflow

1. Establish audience and secrecy.
   - Treat proactive broadcasts as player-facing unless the user explicitly requests KP-only prep.
   - If keeper-only material is present, extract only public premises, era, location, tone, visible institutions, and already-revealed consequences.
2. Extract flavor anchors from module or campaign context.
   - Prefer concrete social surfaces: local jobs, bureaucracy, transport, shops, schools, hospitals, churches/temples, newspapers, rumors, class pressure, law enforcement, family obligations, and material culture.
   - Keep hidden mythos causes, culprit logic, required clues, ending conditions, and private NPC motives out of broadcasts.
3. Build a side-story palette.
   - Create 3-6 active elements: people, factions, places, objects, records, debts, rumors, or offscreen pressures.
   - Give each new element one motive, limitation, trace, or social role.
4. Match the proactive loop.
   - Use the scheduler's current beat internally when available; never print beat labels.
   - Advance one observable change each time: choice, relationship shift, clue-state change, physical trace, false lead, cost, risk, or new question.
5. Draft the broadcast or prompt insert.
   - Default finished story output: 1-2 short Chinese sentences.
   - Do not output analysis, JSON, bullet points, or story labels unless the user asks for planning artifacts.
6. Check continuity.
   - Avoid repeating recent images, actions, sounds, sentence shapes, or the same two recurring actors.
   - If recent stories used a strong motif, switch to a different social surface and a different concrete trace.

## Safety Boundaries

- Do not reveal keeper-only truth, culprit identity, hidden timelines, required clue routes, private NPC secrets, or endings.
- Do not decide PC actions, invent dice results, force irreversible campaign outcomes, or create a mandatory clue unless the KP explicitly approves it.
- Do not let side stories solve the main mystery or imply that players must chase them.
- Do not import modern institutions, technology, slang, or public norms that conflict with the module era.
- If a secret canon detail is tempting, translate it into a vague public symptom only when that symptom is already visible or KP-approved; otherwise omit it.

## Flavor Construction

Read `references/flavor-fill-patterns.md` when generating a batch of seeds, revising runtime prompts, or needing a structured palette.

Build flavor from three layers:

- **World rules**: era, geography, law, travel speed, media, medicine, money, religion, class, local taboos.
- **Social scenes**: where ordinary people encounter pressure without touching the main plot.
- **Visible traces**: objects, notices, damaged routines, overheard mistakes, missing records, minor debts, changed prices, or new rumors.

Strong side stories usually follow:

```text
public world pressure + ordinary actor + small choice/misunderstanding + visible trace + consequence/question
```

## Proactive Loop Contract

Always preserve the bot's proactive story rules:

- Keep the story to 1-2 short Chinese sentences unless asked for planning material.
- Maintain an implicit roster of 3-6 active story elements.
- Rotate focus through people, places, organizations, objects, records, rumors, and consequences instead of mechanically alternating two characters.
- Make the current beat do work: grounding, distortion, foreshadowing, rising pressure, burst, fallout, new normal, return-with-clue, or contrast/turn/reconciliation.
- Include at least one specific noun and one consequence or question that can matter later.
- Keep the line atmospheric but actionable; avoid empty mood-only prose.

## Deliverables

Choose the smallest useful output:

- **Finished broadcasts**: ready-to-send 1-2 sentence Chinese proactive stories.
- **Flavor packet**: player-safe world anchors, active elements, forbidden spoilers, and a next-beat directive.
- **Seed bank**: side-story seeds with social scene, visible trace, consequence, PC inspiration, and no-spoiler guard.
- **Runtime prompt insert**: concise prompt text that can be added to `PROACTIVE_PROMPT` or code while preserving existing scheduler rules.

When editing runtime files, preserve the contracts in `src/proactive.ts` and `docs/NPC_SKILL.md`; update tests or docs only if behavior changes.

## Quality Gate

Before delivering, verify:

- The story fits the current module's public world and era.
- The side event is related to the setting but not the core mainline.
- It creates atmosphere and character inspiration without requiring player action.
- It advances the proactive cycle rather than restating suspense.
- It avoids recent repeated motifs and recurring two-character loops.
- It is safe to show to players.

## Resources

- `references/flavor-fill-patterns.md`: palette, social-scene prompts, cycle mapping, seed-bank template, and runtime prompt insert template.
