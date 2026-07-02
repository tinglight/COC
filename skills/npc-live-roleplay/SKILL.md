---
name: npc-live-roleplay
description: Train, critique, and revise CoC/TRPG NPC dialogue so it feels like a real person roleplaying at the table. Use when the user runs NPC conversation drills, gives scores or feedback such as "不像真人", asks to self-correct roleplay style, or wants to update NPC table-talk rules, OOC parenthetical asides, and training examples for this QQ CoC AI table assistant project.
---

# NPC Live Roleplay

## Purpose

Use this skill to practice and improve NPC replies that should feel like a human player or KP performing a character at a TRPG table, including optional parenthetical OOC/table-talk asides.

In this project, the skill supports the NPC roleplay layer of a broader QQ CoC AI table assistant: dice and checks stay local, module/campaign context stays bounded, and the visible reply should feel like a real table participant rather than a generic chatbot.

The core problem this skill guards against: replies can be narratively correct but still feel AI-like when they over-explain intent, repeat the same action beats, or put prompt-compliance reasoning inside parentheses.

## Workflow

1. Read `references/live-table-style.md` before generating or revising NPC dialogue.
2. If the user gives a score or critique, compare it against `references/training-log.md` and extract a concrete correction.
3. Generate the next NPC response with one visible improvement, not a full style overhaul.
4. Keep IC speech, action narration, and OOC parentheses distinct.
5. If the user asks to store lessons, append a dated entry to `references/training-log.md`.

## Response Rules

- Make the NPC answer the player's immediate line first.
- Use varied, specific physical beats; avoid starting multiple turns with the same gesture pattern.
- Parentheses should sound like table-side human leakage: small, casual, mundane, sometimes self-deprecating.
- Do not use parentheses to explain why the model chose a response.
- Do not mention prompts, safety rules, state tracking, "remembering", or implementation details in the NPC voice.
- Let awkwardness exist. Do not smooth every social friction into reassurance.
- Keep OOC asides optional and short. No aside is better than a fake one.

## Correction Priorities

When feedback says the reply is AI-like, check these in order:

1. Did the OOC aside describe internal writing logic instead of a human moment?
2. Did the reply over-validate the player or solve the emotion too neatly?
3. Did the action narration repeat a previous turn's structure?
4. Did the NPC speak with too much polished wisdom or too many quotable lines?
5. Did the response ignore the table reality the user put in parentheses?

Fix the highest-priority issue first.

## References

- `references/live-table-style.md`: style rules, good/bad OOC patterns, and anti-AI heuristics.
- `references/training-log.md`: scored examples and lessons from practice conversations.
