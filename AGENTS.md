# Project Instructions

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
