# Changelog

本文件记录项目的用户可见变更、兼容性调整和发布验证结果。格式遵循 `docs/VERSION_LOG_RULES.md`。

## [Unreleased]

### Added

- 新增版本日志规则文档，统一后续发布记录口径。
- 新增提交前版本日志和自动递增版本号规则，要求源码、配置或 Skill 行为变更随提交同步更新版本号与 changelog。

### Validation

- 未运行自动化测试：仅更新提交与版本日志规则文档。

## [0.1.0] - 2026-07-02

### Added

- 首次同步 QQ CoC 跑团 AI 助手项目到 GitHub。
- 包含 QQ Webhook、CoC 骰点与角色卡、模块导入、NPC 扮演、主动叙事与 OpenAI 集成的初始代码和测试。

### Validation

- `npm.cmd test`：10 个测试文件、34 个用例通过。
- `npm.cmd run typecheck`：通过。
