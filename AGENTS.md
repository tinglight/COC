# Project Instructions

## Versioning and Commit Log

- Before committing source, configuration, skill, or user-facing documentation changes, update `CHANGELOG.md` under `[Unreleased]` with the actual change and validation notes.
- Before committing source, configuration, or skill behavior changes, increment the project version with `npm.cmd version <major|minor|patch> --no-git-tag-version`; use `patch` for fixes/internal-compatible changes, `minor` for new backward-compatible capabilities, and `major` for breaking command/config/data/skill-contract changes.
- Commit the resulting `package.json`, `package-lock.json`, and `CHANGELOG.md` changes together with the related work.
- For pure docs/rule-only commits, update `CHANGELOG.md` but do not bump the version unless the user explicitly asks for a release.
- Do not create or push a Git tag unless the user explicitly asks for a release/tag.
- Follow `docs/VERSION_LOG_RULES.md` for changelog categories, validation entries, and release archive format.

## Skills

- Create project-specific Codex skills under `skills/<skill-name>/` in this repository by default.
- Do not put skills for this QQ CoC bot project under the user-level Codex skills directory unless the user explicitly asks for a global personal skill.
- Keep each skill self-contained with `SKILL.md` and any needed `agents/`, `references/`, `scripts/`, or `assets/` resources.
- Treat skill folders as source artifacts: they should be visible in `git status` and included when committing related work.
- Do not commit generated caches or runtime outputs such as `__pycache__/`, `.pyc`, `data/`, `logs/`, `dist/`, or `outputs/`.

Before finishing skill work:

1. Run `python C:\Users\Seija\.codex\skills\.system\skill-creator\scripts\quick_validate.py skills\<skill-name>` when the validator is available.
2. Run any script syntax checks or targeted tests needed for changed skill resources.
3. Check `git status --short skills` to confirm new or changed skill files are tracked candidates.
4. Search for accidental global-skill paths with `rg "C:\\Users\\Seija|\.codex\\skills|\.codex/skills" -g "!AGENTS.md"`.
