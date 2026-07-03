# 项目规则

## 版本号与提交日志

- 提交源码、配置、Skill 或面向用户的文档变更前，必须在 `CHANGELOG.md` 的 `[Unreleased]` 区块记录实际变更和验证说明。
- 提交源码、配置或 Skill 行为变更前，必须用 `npm.cmd version <major|minor|patch> --no-git-tag-version` 递增项目版本；修复和内部兼容调整用 `patch`，新增向后兼容能力用 `minor`，破坏命令、配置、数据或 Skill 契约的变更用 `major`。
- 把对应的 `package.json`、`package-lock.json` 和 `CHANGELOG.md` 变更与相关工作一起提交。
- 纯文档或规则变更只更新 `CHANGELOG.md`，不要递增版本号，除非用户明确要求发布版本。
- 不要创建或推送 Git tag，除非用户明确要求发布或打 tag。
- 遵循 `docs/VERSION_LOG_RULES.md` 中的 changelog 分类、验证记录和发布归档格式。

## Skill 目录规则

- 默认在本仓库的 `skills/<skill-name>/` 下创建项目专用 Codex Skill。
- 不要把这个 QQ CoC bot 项目的 Skill 放到用户级 Codex Skill 目录，除非用户明确要求创建全局个人 Skill。
- 每个 Skill 都应自包含，包含 `SKILL.md` 以及必要的 `agents/`、`references/`、`scripts/` 或 `assets/` 资源。
- Skill 目录视为源码产物：相关工作提交时，它们应出现在 `git status` 中并一并纳入提交。
- 不要提交生成缓存或运行时输出，例如 `__pycache__/`、`.pyc`、`data/`、`logs/`、`dist/` 或 `outputs/`。

完成 Skill 工作前：

1. 如果验证器可用，运行 `python C:\Users\Seija\.codex\skills\.system\skill-creator\scripts\quick_validate.py skills\<skill-name>`。
2. 对改过的 Skill 资源运行必要的脚本语法检查或目标测试。
3. 运行 `git status --short skills`，确认新增或修改的 Skill 文件是可跟踪的提交候选。
4. 用 `rg "C:\\Users\\Seija|\.codex\\skills|\.codex/skills" -g "!AGENTS.md"` 搜索是否误写入了全局 Skill 路径。
