# Campaign State Schema

## Folder Contract

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

`canon/` is read-only after import. `campaign/` is where play changes live.

## session_state.json

Top-level fields:

- `module_id`: stable id for the imported module.
- `source_sha256`: hash of the original module file at import time.
- `canon_digest`: digest of canon files after import.
- `canon_policy`: short rule boundary and allowed mutable layers.
- `pcs`: parsed character sheet records keyed by name or id.
- `npcs`: NPC records keyed by name.
- `relationships`: pairwise relationship records.
- `pc_impacts`: list of consequences caused by PCs.
- `pc_prep`: optional list of planned PC-specific beats before play.
- `world_changes`: list of durable changes to setting, locations, factions, clues, and resources.
- `scene_log`: append-only event list.
- `open_threads`: unresolved hooks, mysteries, pending consequences, and KP TODOs.

## PC Cards And Prep

Character sheets belong to `campaign/`, not `canon/`.

Store raw or lightly normalized card text in `campaign/pc_cards/<pc-id>.md`. Keep source filenames, pasted-text notes, and uncertainty markers so later prep can distinguish card facts from inference.

Recommended `pcs[pc_id]` fields:

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

Use `campaign/pc_prep_matrix.md` for KP planning. Recommended columns:

- `PC`
- `Card Signal`
- `Canon Hook / Source Ref`
- `Personal Beat`
- `NPC / Scene Carrier`
- `Rule Or Clue Constraint`
- `Safety / Consent Note`
- `Status`

Use `pc_prep` in `session_state.json` when a structured app/database needs the same information. Each entry should include `pc_id`, `card_signals`, `canon_refs`, `planned_beat`, `carrier`, `constraints`, `status`, and `visible_to_players`.

Do not let a PC-specific beat silently replace hidden truth, required clues, hard timeline facts, or ending conditions. If the KP wants a real rule change, record it in `keeper_overrides.md` with the original source ref and reason.

## NPC Record

Recommended fields:

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

Do not use NPC state to reveal keeper-only truth to players. Keep private knowledge separate from public behavior.

## Relationship Record

Use a stable key such as `A <-> B`. Store:

- `a`
- `b`
- `score` or `stance`
- `changes`: append-only list of `{event_id, delta, reason}`
- `visible_to_players`

## World Change Record

Store:

- `event_id`
- `scope`: location, faction, resource, clue, timeline, rumor, law, technology, or other.
- `description`
- `caused_by`
- `reversibility`: temporary, reversible, costly, irreversible, unknown.
- `source`: session event, KP override, or imported canon.

## Canon Update Rule

Never edit canon to represent play. If KP deliberately changes a rule, add an override with:

- original source reference
- changed table behavior
- reason
- whether this is presentation-only, pacing-only, clue-route-only, or true rule replacement
