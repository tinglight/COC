---
name: persona-style-builder
description: Create, refine, and operationalize fictional character personas, NPC voice profiles, chatbot role cards, speaking-style sheets, tone rules, catchphrases, verbal tics, knowledge boundaries, and runtime prompts. Analyze supplied chat logs, message exports, transcripts, or pasted conversations to summarize a target speaker into a reusable persona card. Use when the user asks Codex to define a character's personality, infer speaking style from chat history, extract tone and verbal habits, build bot/NPC voice behavior, handle unknown-knowledge boundaries, or produce a reusable AI performance prompt.
---

# Persona Style Builder

## Core Workflow

Turn loose personality notes or supplied chat records into two reusable layers:

1. A creator-facing persona card that records stable identity, motives, fears, knowledge scope, speech habits, and behavioral rules.
2. A runtime prompt that an AI NPC or bot can directly follow to speak in that persona.

When creating or revising a reusable persona card, extracting a persona from chat logs, writing a runtime prompt, or producing dialogue samples, read `references/persona-card-format.md`.

## Persona Construction

Extract and preserve the user's named facts first: name, gender or presentation, MBTI or archetype, fear, contradiction, catchphrases, speaking habits, social impression, and known knowledge limits.

If details are missing, infer lightly from the provided traits and mark them as adjustable instead of inventing hard lore. Ask a question only when the missing answer would change the persona's core identity or safety boundaries.

Build the persona as a set of performable rules:

- Inner driver: what the character wants, fears, hides, or protects.
- Surface impression: how other people usually read them.
- Speech mechanics: sentence openings, rhythm, vocabulary level, favorite structures, punctuation, directness, hesitation, and catchphrase frequency.
- Reasoning posture: how they argue, summarize, ask questions, admit uncertainty, or deflect ignorance.
- Knowledge model: what they know well, know vaguely, misunderstand, refuse to discuss, or should never claim to know.
- State shifts: how their voice changes when relaxed, challenged, embarrassed, wrong, praised, angry, or in group chat.

## Chat Log Extraction

When the user provides a chat log path, export file, transcript, or pasted conversation, read the available messages and identify the target speaker before summarizing. Support plain text, Markdown, JSON/JSONL, CSV, and common copied chat formats when local tools can read them.

If the target speaker is ambiguous, infer from user wording, filenames, speaker labels, or message frequency. Ask for clarification only when multiple plausible speakers would produce different persona cards.

Analyze evidence in layers:

- Message mechanics: length, punctuation, emoji/sticker markers, sentence openings, endings, repetition, correction patterns, code-switching, and reply speed if timestamps exist.
- Conversation behavior: who they answer, when they ignore, how they disagree, how they soften, how they repair mistakes, and how they handle group pressure.
- Topic and knowledge scope: topics they speak confidently about, topics they only echo, and topics where they dodge, joke, ask questions, or change frame.
- Emotional signatures: what makes them warmer, sharper, anxious, defensive, playful, formal, or terse.
- Stable style versus context: separate durable habits from one-off context, platform conventions, in-jokes, and relationship-specific behavior.

Use short evidence snippets only when helpful. Do not dump private chat content. Avoid inferring sensitive attributes, private secrets, or real-world facts that are not necessary for voice performance.

For a real living person, convert the result into a fictionalized or consent-safe voice profile unless the user clearly owns the persona or asks for self-analysis. Preserve broad style patterns without enabling deceptive impersonation.

## Runtime Prompt Rules

Make runtime prompts actionable for another AI:

- Use imperatives such as "speak as", "prefer", "avoid", and "when unsure".
- Include frequency controls for verbal tics; avoid making every reply repeat a catchphrase.
- Tell the AI how to handle unknown topics in-character without hallucinating expertise.
- Include "do not" rules for style breaks, overacting, meta explanations, and unwanted exposition.
- Include 3 to 6 short sample replies that demonstrate default tone, disagreement, uncertainty, apology or repair, and emotionally charged debate.

For real living people, do not create direct impersonation prompts. Convert the request into an original fictional persona inspired by broad traits, or ask for permission/fictionalization details when needed.

## Output Shape

For ordinary requests, provide:

1. Persona card
2. Direct runtime prompt
3. Dialogue samples
4. Tuning notes or open questions

For chat-log extraction, also provide an evidence summary with observed confidence levels and note any weak or context-dependent conclusions.

For bot integration, also provide a machine-readable `yaml` or `json` block with concise fields for `name`, `source_type`, `voice_tags`, `catchphrases`, `knowledge_scope`, `unknown_strategy`, `style_rules`, `avoid_rules`, and `confidence_notes`.
