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
    pc_branch_matrix.md
    session_state.json
```

`canon/` is read-only after import. `campaign/` is where play changes live.

## session_state.json

Top-level fields:

- `module_id`: stable id for the imported module.
- `source_sha256`: hash of the original module file at import time.
- `canon_digest`: digest of canon files after import.
- `canon_policy`: short rule boundary and allowed mutable layers.
- `pcs`: PC records keyed by name or id.
- `npcs`: NPC records keyed by name.
- `relationships`: pairwise relationship records.
- `pc_impacts`: list of consequences caused by PCs.
- `world_changes`: list of durable changes to setting, locations, factions, clues, and resources.
- `scene_log`: append-only event list.
- `open_threads`: unresolved hooks, mysteries, pending consequences, and KP TODOs.

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
