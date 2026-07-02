from __future__ import annotations

import argparse
import json
from pathlib import Path


EXPORT_NAME = "GROUP_CHAT_BOT_PERSONA_INSTRUCTIONS"
PERSONA_PATH = Path("src") / "ai" / "persona.ts"


def repo_root_from_script() -> Path:
    return Path(__file__).resolve().parents[3]


def resolve_repo(path: str | None) -> Path:
    return Path(path).resolve() if path else repo_root_from_script()


def persona_ts_path(repo: Path) -> Path:
    return repo / PERSONA_PATH


def read_persona_source(path: Path) -> str:
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        raise SystemExit(f"Persona file is empty: {path}")
    return text


def write_persona_ts(repo: Path, text: str) -> None:
    target = persona_ts_path(repo)
    target.parent.mkdir(parents=True, exist_ok=True)
    lines = text.splitlines()
    if not lines:
        body = f'export const {EXPORT_NAME} = "";\n'
    else:
        quoted = ",\n".join(f"  {json.dumps(line, ensure_ascii=False)}" for line in lines)
        body = f"export const {EXPORT_NAME} = [\n{quoted}\n].join(\"\\n\");\n"
    target.write_text(body, encoding="utf-8")


def current_persona_text(repo: Path) -> str:
    target = persona_ts_path(repo)
    if not target.exists():
        return ""
    raw = target.read_text(encoding="utf-8").strip()
    if raw == f'export const {EXPORT_NAME} = "";':
        return ""
    return raw


def status(repo: Path) -> None:
    target = persona_ts_path(repo)
    if not target.exists():
        print(f"missing: {target}")
        return
    text = current_persona_text(repo)
    if not text:
        print(f"disabled: {target}")
        return
    preview = target.read_text(encoding="utf-8").splitlines()[:6]
    print(f"enabled: {target}")
    for line in preview:
        print(line)


def apply_persona(repo: Path, persona_file: Path) -> None:
    text = read_persona_source(persona_file)
    write_persona_ts(repo, text)
    print(f"applied persona from {persona_file} -> {persona_ts_path(repo)}")


def remove_persona(repo: Path) -> None:
    write_persona_ts(repo, "")
    print(f"removed persona -> {persona_ts_path(repo)}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Apply, inspect, or remove the QQ bot group chat persona card.")
    parser.add_argument("--repo", help="Repository root. Defaults to the qq-coc-dice-bot repo containing this skill.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("status", help="Show whether src/ai/persona.ts contains an active persona.")

    apply_parser = subparsers.add_parser("apply", help="Apply a persona card from a UTF-8 text or Markdown file.")
    apply_parser.add_argument("--persona-file", required=True, help="Path to a runtime-ready persona prompt.")

    subparsers.add_parser("remove", help="Disable the active persona without changing the bot integration point.")
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    repo = resolve_repo(args.repo)

    if args.command == "status":
        status(repo)
    elif args.command == "apply":
        apply_persona(repo, Path(args.persona_file).resolve())
    elif args.command == "remove":
        remove_persona(repo)
    else:
        parser.error(f"unknown command: {args.command}")


if __name__ == "__main__":
    main()
