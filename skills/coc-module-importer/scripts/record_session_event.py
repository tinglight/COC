#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def load_state(path: Path) -> tuple[Path, dict[str, Any]]:
    if path.is_dir():
        state_path = path / "campaign" / "session_state.json"
    else:
        state_path = path
    if not state_path.exists():
        raise SystemExit(f"session_state.json not found: {state_path}")
    return state_path, json.loads(state_path.read_text(encoding="utf-8"))


def write_state(path: Path, state: dict[str, Any]) -> None:
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def next_event_id(state: dict[str, Any]) -> str:
    return f"evt-{len(state.get('scene_log', [])) + 1:04d}"


def ensure_npc(state: dict[str, Any], name: str) -> dict[str, Any]:
    npcs = state.setdefault("npcs", {})
    if name not in npcs:
        npcs[name] = {
            "name": name,
            "source_refs": [],
            "current_scene": "",
            "public_state": "",
            "private_state": "",
            "known_facts": [],
            "goals": [],
            "attitude_to_pcs": {},
            "relationship_notes": [],
            "last_seen_event_id": "",
            "context_notes": [],
        }
    return npcs[name]


def relationship_key(a: str, b: str) -> str:
    left, right = sorted([a.strip(), b.strip()])
    return f"{left} <-> {right}"


def append_live_log(module_root: Path, event: dict[str, Any]) -> None:
    log_path = module_root / "campaign" / "live_log.md"
    if not log_path.exists():
        return
    participants = ", ".join(event.get("participants", [])) or "none"
    lines = [
        f"### {event['id']} - {event.get('scene') or 'unknown scene'}",
        "",
        f"- Time: {event['created_at']}",
        f"- Participants: {participants}",
        f"- Event: {event['event']}",
    ]
    if event.get("world_changes"):
        lines.append(f"- World changes: {'; '.join(event['world_changes'])}")
    if event.get("pc_impacts"):
        lines.append(f"- PC impacts: {'; '.join(event['pc_impacts'])}")
    if event.get("notes"):
        lines.append(f"- Notes: {event['notes']}")
    lines.append("")
    with log_path.open("a", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def parse_relation(value: str) -> tuple[str, str, str, str]:
    parts = [p.strip() for p in value.split("|")]
    if len(parts) != 4:
        raise SystemExit("--relation must use: A|B|delta-or-stance|reason")
    return parts[0], parts[1], parts[2], parts[3]


def parse_context(value: str) -> tuple[str, str, str]:
    parts = [p.strip() for p in value.split("|", 2)]
    if len(parts) != 3:
        raise SystemExit("--npc-context must use: NPC|field|value")
    return parts[0], parts[1], parts[2]


def main() -> None:
    parser = argparse.ArgumentParser(description="Append a live table event to campaign/session_state.json.")
    parser.add_argument("module_or_state", help="Module output folder or direct session_state.json path")
    parser.add_argument("--scene", default="", help="Scene/location id or name")
    parser.add_argument("--event", required=True, help="What happened at the table")
    parser.add_argument("--pc", action="append", default=[], help="PC involved; repeatable")
    parser.add_argument("--npc", action="append", default=[], help="NPC involved; repeatable")
    parser.add_argument("--world-change", action="append", default=[], help="Durable world change; repeatable")
    parser.add_argument("--pc-impact", action="append", default=[], help="PC impact text; repeatable")
    parser.add_argument("--relation", action="append", default=[], help="A|B|delta-or-stance|reason; repeatable")
    parser.add_argument("--npc-context", action="append", default=[], help="NPC|field|value; repeatable")
    parser.add_argument("--note", default="", help="KP-only note")
    parser.add_argument("--dry-run", action="store_true", help="Print updated JSON without writing")
    args = parser.parse_args()

    target = Path(args.module_or_state).expanduser().resolve()
    state_path, state = load_state(target)
    module_root = target if target.is_dir() else state_path.parent.parent

    event_id = next_event_id(state)
    event = {
        "id": event_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "scene": args.scene,
        "event": args.event,
        "participants": args.pc + args.npc,
        "pcs": args.pc,
        "npcs": args.npc,
        "world_changes": args.world_change,
        "pc_impacts": args.pc_impact,
        "notes": args.note,
    }
    state.setdefault("scene_log", []).append(event)

    for npc_name in args.npc:
        npc = ensure_npc(state, npc_name)
        npc["current_scene"] = args.scene or npc.get("current_scene", "")
        npc["last_seen_event_id"] = event_id
        npc.setdefault("context_notes", []).append({"event_id": event_id, "note": args.event})

    for context in args.npc_context:
        npc_name, field, value = parse_context(context)
        npc = ensure_npc(state, npc_name)
        current = npc.get(field)
        if isinstance(current, list):
            current.append({"event_id": event_id, "value": value})
        elif isinstance(current, dict):
            current[event_id] = value
        else:
            npc[field] = value
        npc["last_seen_event_id"] = event_id

    for relation in args.relation:
        a, b, delta, reason = parse_relation(relation)
        key = relationship_key(a, b)
        rel = state.setdefault("relationships", {}).setdefault(
            key,
            {"a": a, "b": b, "stance": "", "changes": [], "visible_to_players": "unknown"},
        )
        rel["stance"] = delta
        rel.setdefault("changes", []).append({"event_id": event_id, "delta": delta, "reason": reason})

    for impact in args.pc_impact:
        state.setdefault("pc_impacts", []).append({"event_id": event_id, "description": impact, "scene": args.scene})

    for change in args.world_change:
        state.setdefault("world_changes", []).append(
            {
                "event_id": event_id,
                "scope": "unspecified",
                "description": change,
                "caused_by": args.pc,
                "reversibility": "unknown",
                "source": "session event",
            }
        )

    if args.dry_run:
        print(json.dumps(state, ensure_ascii=False, indent=2))
        return

    write_state(state_path, state)
    append_live_log(module_root, event)
    print(json.dumps({"updated": str(state_path), "event_id": event_id}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
