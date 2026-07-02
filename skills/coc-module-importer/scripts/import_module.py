#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


HEADING_KEYWORDS = [
    "模组信息",
    "开团概要",
    "车卡注意事项",
    "前言",
    "故事速览",
    "守秘人信息",
    "世界观",
    "时间线",
    "真相",
    "导入",
    "剧情点",
    "调查点",
    "场景描述",
    "环境描述",
    "场景目的",
    "进一步情报",
    "结局",
    "完美结局",
    "后话",
]

RULE_KEYWORDS = [
    "使用规则",
    "推荐技能",
    "建议人数",
    "模组难度",
    "检定",
    "SAN",
    "理智",
    "秘密团",
    "注意事项",
    "规则",
    "密码",
    "条件",
]

KEEPER_KEYWORDS = ["守秘人", "真相", "幕后", "核心", "秘密", "时间线"]
WORLD_KEYWORDS = ["世界观", "公司", "列车", "都市", "舞台", "技术", "组织", "事务所"]
MUTABLE_KEYWORDS = ["自定义", "守秘人可以", "建议守秘人", "可以改", "改版", "原创", "DIY", "新增", "分发给不同"]
BRANCH_KEYWORDS = ["调查员中有", "调查员里有", "职业", "角色卡", "PC", "背景故事"]
SKILL_GATE_KEYWORDS = ["擅长", "最高", "更容易"]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\u3000", " ")).strip()


def slugify(value: str, fallback: str = "module") -> str:
    value = normalize_space(value).lower()
    value = re.sub(r"[^\w\-\u4e00-\u9fff]+", "-", value, flags=re.UNICODE)
    value = re.sub(r"-+", "-", value).strip("-_")
    return value or fallback


def read_docx(path: Path) -> list[dict[str, Any]]:
    try:
        from docx import Document
        from docx.oxml.table import CT_Tbl
        from docx.oxml.text.paragraph import CT_P
        from docx.table import Table
        from docx.text.paragraph import Paragraph
    except ImportError as exc:
        raise SystemExit("python-docx is required for DOCX import.") from exc

    doc = Document(path)
    blocks: list[dict[str, Any]] = []

    for child in doc.element.body.iterchildren():
        if isinstance(child, CT_P):
            para = Paragraph(child, doc)
            text = normalize_space(para.text)
            if not text:
                continue
            runs = [r for r in para.runs if r.text.strip()]
            bold_runs = sum(1 for r in runs if r.bold)
            blocks.append(
                {
                    "index": len(blocks),
                    "type": "paragraph",
                    "style": para.style.name if para.style else "",
                    "text": text,
                    "bold_ratio": round(bold_runs / max(len(runs), 1), 3),
                }
            )
        elif isinstance(child, CT_Tbl):
            table = Table(child, doc)
            rows = []
            for row in table.rows:
                rows.append([normalize_space(cell.text) for cell in row.cells])
            flat = " | ".join(" / ".join(cell for cell in row if cell) for row in rows)
            blocks.append(
                {
                    "index": len(blocks),
                    "type": "table",
                    "style": "",
                    "text": normalize_space(flat),
                    "rows": rows,
                    "bold_ratio": 0,
                }
            )
    return blocks


def read_text(path: Path) -> list[dict[str, Any]]:
    blocks = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        text = normalize_space(line)
        if not text:
            continue
        blocks.append(
            {
                "index": len(blocks),
                "type": "line",
                "style": "",
                "text": text,
                "bold_ratio": 0,
            }
        )
    return blocks


def read_source(path: Path) -> list[dict[str, Any]]:
    suffix = path.suffix.lower()
    if suffix == ".docx":
        return read_docx(path)
    if suffix in {".md", ".markdown", ".txt"}:
        return read_text(path)
    raise SystemExit(f"Unsupported module format: {suffix}. Use .docx, .md, or .txt.")


def is_heading(block: dict[str, Any]) -> bool:
    text = block["text"]
    style = block.get("style", "")
    if style.lower().startswith("heading") or style.startswith("标题"):
        return True
    if text.startswith("#"):
        return True
    if re.match(r"^(第[一二三四五六七八九十百0-9]+[章节幕车厢]|[0-9]+[、.．])", text):
        return True
    if text.startswith("※【") or text.startswith("【"):
        return True
    if any(k in text for k in HEADING_KEYWORDS) and len(text) <= 80:
        return True
    if block.get("bold_ratio", 0) >= 0.65 and len(text) <= 64:
        return True
    return False


def classify_heading(title: str) -> list[str]:
    cats: list[str] = []
    if any(k in title for k in ["模组信息", "开团概要", "模组名称", "模组难度", "建议人数", "推荐技能"]):
        cats.append("metadata")
    if any(k in title for k in RULE_KEYWORDS):
        cats.append("rules")
    if any(k in title for k in KEEPER_KEYWORDS):
        cats.append("keeper_only")
    if any(k in title for k in WORLD_KEYWORDS):
        cats.append("world_lore")
    if any(k in title for k in BRANCH_KEYWORDS) or re.search(r"\*\s*调查员", title):
        cats.append("pc_branch")
    if any(k in title for k in ["导入", "车厢", "场景", "环境", "维护舱", "头等舱"]):
        cats.append("scene")
    if any(k in title for k in ["调查点", "剧情点", "情报", "线索", "日志", "记录", "文件"]):
        cats.append("clue")
    if "结局" in title:
        cats.append("ending")
    if any(k in title for k in MUTABLE_KEYWORDS):
        cats.append("mutable_hook")
    return sorted(set(cats)) or ["section"]


def build_sections(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    for block in blocks:
        if is_heading(block):
            if current:
                sections.append(current)
            current = {
                "id": f"sec-{len(sections) + 1:03d}",
                "title": block["text"],
                "categories": classify_heading(block["text"]),
                "start_block": block["index"],
                "end_block": block["index"],
                "blocks": [block["index"]],
                "paragraphs": [],
            }
        else:
            if current is None:
                current = {
                    "id": "sec-001",
                    "title": "Preamble",
                    "categories": ["section"],
                    "start_block": block["index"],
                    "end_block": block["index"],
                    "blocks": [],
                    "paragraphs": [],
                }
            current["paragraphs"].append(block["text"])
            current["blocks"].append(block["index"])
            current["end_block"] = block["index"]

    if current:
        sections.append(current)

    for section in sections:
        body = "\n".join(section["paragraphs"]).strip()
        section["text"] = body
        section["summary_candidate"] = body[:420]
    return sections


def extract_metadata(blocks: list[dict[str, Any]]) -> dict[str, str]:
    metadata: dict[str, str] = {}
    for block in blocks[:120]:
        text = block["text"]
        m = re.match(r"^【?([^】：:】]{2,24})】?[：:]\s*(.+)$", text)
        if m:
            key = normalize_space(m.group(1))
            value = normalize_space(m.group(2))
            if len(value) <= 500:
                metadata[key] = value
    return metadata


def find_lines(blocks: list[dict[str, Any]], keywords: list[str]) -> list[dict[str, Any]]:
    hits = []
    for block in blocks:
        text = block["text"]
        if any(k in text for k in keywords):
            hits.append({"block": block["index"], "text": text})
    return hits


def extract_branch_hooks(sections: list[dict[str, Any]], blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    hooks: list[dict[str, Any]] = []
    for section in sections:
        title = section["title"]
        text = "\n".join([title, section.get("text", "")])
        has_branch_marker = "pc_branch" in section["categories"] or any(k in text for k in BRANCH_KEYWORDS)
        has_title_pc_marker = bool(re.search(r"\*\s*调查员", title))
        if has_branch_marker or has_title_pc_marker:
            triggers = []
            for part in re.split(r"[*；;。]\s*", title):
                if any(k in part for k in BRANCH_KEYWORDS) or "调查员" in part:
                    triggers.append(normalize_space(part))
            for line in section.get("paragraphs", []):
                if any(k in line for k in BRANCH_KEYWORDS + MUTABLE_KEYWORDS):
                    triggers.append(line)
            if "自定义" in title or "每一车" in title:
                hook_type = "customization_policy"
            elif has_title_pc_marker or "特殊衍生" in title:
                hook_type = "major_pc_branch"
            else:
                hook_type = "pc_micro_hook"
            hooks.append(
                {
                    "id": f"branch-{len(hooks) + 1:03d}",
                    "hook_type": hook_type,
                    "section_id": section["id"],
                    "section_title": title,
                    "source_blocks": section["blocks"][:12],
                    "trigger_text": sorted(set(t for t in triggers if t)) or [title],
                    "status": "unselected_until_pc_cards_known",
                }
            )
    return hooks


def extract_entities(blocks: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    organizations: dict[str, set[int]] = {}
    npcs: dict[str, set[int]] = {}
    places: dict[str, set[int]] = {}

    for block in blocks:
        text = block["text"]
        for name in re.findall(r"([A-Za-z]公司|[A-Za-z]+公司|[\u4e00-\u9fffA-Za-z]{1,10}(?:公司|事务所|列车))", text):
            if any(noisy in name for noisy in ["对于", "每一", "本次", "调查员"]):
                continue
            organizations.setdefault(name, set()).add(block["index"])
        for name in re.findall(r"第[一二三四五六七八九十0-9]+车厢|头等舱|维护舱|小型维护舱", text):
            places.setdefault(name, set()).add(block["index"])
        for match in re.findall(r"【[^】]*[-－]([^】\-－]{1,12})的记录】", text):
            npcs.setdefault(match, set()).add(block["index"])
        npc_match = re.search(r"(?:NPC|人物|角色)[：:]\s*([^，。；;]{1,20})", text, re.IGNORECASE)
        if npc_match:
            npcs.setdefault(normalize_space(npc_match.group(1)), set()).add(block["index"])

    def pack(items: dict[str, set[int]]) -> list[dict[str, Any]]:
        return [
            {"name": name, "source_blocks": sorted(refs)[:20]}
            for name, refs in sorted(items.items(), key=lambda item: item[0])
        ]

    return {"organizations": pack(organizations), "npcs": pack(npcs), "places": pack(places)}


def section_overview(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": s["id"],
            "title": s["title"],
            "categories": s["categories"],
            "start_block": s["start_block"],
            "end_block": s["end_block"],
            "summary_candidate": s.get("summary_candidate", ""),
        }
        for s in sections
    ]


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def canon_digest(canon_dir: Path) -> str:
    h = hashlib.sha256()
    for path in sorted(canon_dir.glob("*")):
        if path.is_file():
            h.update(path.name.encode("utf-8"))
            h.update(path.read_bytes())
    return h.hexdigest()


def write_campaign_templates(out_dir: Path, module_id: str, source_sha: str, digest: str, branch_hooks: list[dict[str, Any]]) -> None:
    campaign_dir = out_dir / "campaign"
    state = {
        "module_id": module_id,
        "source_sha256": source_sha,
        "canon_digest": digest,
        "canon_policy": {
            "canon_locked": True,
            "mutable_layers": ["campaign/keeper_overrides.md", "campaign/session_state.json", "campaign/live_log.md"],
            "rule": "Do not edit canon to represent table play. Add KP changes and consequences to campaign state.",
        },
        "pcs": {},
        "npcs": {},
        "relationships": {},
        "pc_impacts": [],
        "world_changes": [],
        "scene_log": [],
        "open_threads": [],
    }
    write_json(campaign_dir / "session_state.json", state)

    (campaign_dir / "live_log.md").write_text(
        f"# Live Log - {module_id}\n\n"
        "Append session events here. Use `record_session_event.py` for structured updates.\n\n"
        "## Session 1\n\n",
        encoding="utf-8",
    )
    (campaign_dir / "keeper_overrides.md").write_text(
        f"# Keeper Overrides - {module_id}\n\n"
        "Canon remains locked. Put KP additions, cuts, pacing changes, and PC-tailored scenes here.\n\n"
        "## Override Template\n\n"
        "- Source ref:\n"
        "- Type: presentation-only | pacing-only | clue-route-only | added-scene | rule-replacement\n"
        "- Change:\n"
        "- Reason:\n"
        "- Player-visible result:\n\n",
        encoding="utf-8",
    )

    rows = [
        "# PC Branch Matrix",
        "",
        "| Branch | Type | Source Section | Trigger | Chosen PC | KP Adaptation | Status |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for hook in branch_hooks:
        trigger = "<br>".join(hook["trigger_text"])[:700]
        rows.append(f"| {hook['id']} | {hook.get('hook_type', 'pc_hook')} | {hook['section_title']} | {trigger} |  |  | pending |")
    (campaign_dir / "pc_branch_matrix.md").write_text("\n".join(rows) + "\n", encoding="utf-8")


def import_module(input_path: Path, out_dir: Path, module_id: str, overwrite: bool = False) -> dict[str, Any]:
    if out_dir.exists() and any(out_dir.iterdir()) and not overwrite:
        raise SystemExit(f"Output directory is not empty: {out_dir}. Use --overwrite to replace generated files.")

    blocks = read_source(input_path)
    sections = build_sections(blocks)
    metadata = extract_metadata(blocks)
    source_sha = sha256_file(input_path)
    generated_at = datetime.now(timezone.utc).isoformat()

    branch_hooks = extract_branch_hooks(sections, blocks)
    entities = extract_entities(blocks)
    rule_candidates = find_lines(blocks, RULE_KEYWORDS)
    mutable_hooks = find_lines(blocks, MUTABLE_KEYWORDS)

    canon_dir = out_dir / "canon"
    canon_dir.mkdir(parents=True, exist_ok=True)

    source_text = {
        "module_id": module_id,
        "source_path": str(input_path),
        "source_sha256": source_sha,
        "generated_at": generated_at,
        "blocks": blocks,
        "sections": sections,
    }
    write_json(canon_dir / "source_text.json", source_text)

    module_index = {
        "module_id": module_id,
        "metadata": metadata,
        "stats": {
            "blocks": len(blocks),
            "sections": len(sections),
            "branch_hooks": len(branch_hooks),
            "rule_candidates": len(rule_candidates),
            "mutable_hooks": len(mutable_hooks),
        },
        "sections": section_overview(sections),
        "entities": entities,
        "branch_hooks": branch_hooks,
        "rule_candidates": rule_candidates[:200],
        "mutable_hooks": mutable_hooks[:200],
        "import_warnings": [
            "Imported classifications are candidates. Use source block refs when making keeper-facing decisions.",
            "Do not modify canon for table play; write campaign overrides and session state instead.",
        ],
    }
    write_json(canon_dir / "module_index.json", module_index)

    lock_text = (
        f"# Canon Lock - {module_id}\n\n"
        f"- Source: `{input_path}`\n"
        f"- Source SHA-256: `{source_sha}`\n"
        f"- Imported at: `{generated_at}`\n\n"
        "## Locked Canon\n\n"
        "- Core rules, hidden truth, module-specific mechanisms, required clues, hard timeline facts, and ending conditions.\n"
        "- Source text in `source_text.json` and extracted indexes in `module_index.json`.\n\n"
        "## Mutable Campaign Layer\n\n"
        "- KP scene additions, PC-tailored branches, clue delivery order, NPC improvisation, relationship changes, and world consequences.\n"
        "- Store mutable changes in `campaign/`, never by editing this canon folder.\n"
    )
    (canon_dir / "canon_lock.md").write_text(lock_text, encoding="utf-8")

    digest = canon_digest(canon_dir)
    write_campaign_templates(out_dir, module_id, source_sha, digest, branch_hooks)

    manifest = {
        "module_id": module_id,
        "source_path": str(input_path),
        "source_sha256": source_sha,
        "generated_at": generated_at,
        "canon_digest": digest,
        "output_contract": {
            "canon": "read-only imported source layer",
            "campaign": "mutable play and KP override layer",
        },
    }
    write_json(out_dir / "module_manifest.json", manifest)

    summary = [
        f"# Import Summary - {module_id}",
        "",
        f"- Blocks: {len(blocks)}",
        f"- Sections: {len(sections)}",
        f"- Branch hooks: {len(branch_hooks)}",
        f"- Rule candidates: {len(rule_candidates)}",
        f"- Mutable hooks: {len(mutable_hooks)}",
        f"- Canon digest: `{digest}`",
        "",
        "## Next Steps",
        "",
        "1. Review `canon/module_index.json`.",
        "2. Fill PC-specific choices in `campaign/pc_branch_matrix.md`.",
        "3. Record play in `campaign/session_state.json` and `campaign/live_log.md`.",
        "4. Run `check_canon_lock.py` before session summaries.",
        "",
    ]
    (out_dir / "import_summary.md").write_text("\n".join(summary), encoding="utf-8")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Import a CoC/TRPG module into canon and campaign state folders.")
    parser.add_argument("input", help="Input .docx, .md, or .txt module file")
    parser.add_argument("--out", required=True, help="Output folder")
    parser.add_argument("--module-id", help="Stable module id; defaults to input file stem")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite generated files in a non-empty output directory")
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    out_dir = Path(args.out).expanduser().resolve()
    if not input_path.exists():
        raise SystemExit(f"Input file does not exist: {input_path}")

    module_id = slugify(args.module_id or input_path.stem)
    manifest = import_module(input_path, out_dir, module_id, args.overwrite)
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
