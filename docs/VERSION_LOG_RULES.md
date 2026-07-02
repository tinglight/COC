# 版本日志规则

## 目标

- 每次版本发布都能从 `CHANGELOG.md` 看清新增、调整、修复、兼容性影响和验证结果。
- 版本号以 `package.json` 的 `version` 字段为准，Git tag 使用 `vX.Y.Z` 格式。
- 发布记录只写项目事实，不写密钥、私聊内容、未脱敏 QQ openid、完整日志或本地机器路径。

## 版本号

- `MAJOR`：破坏现有配置、命令、数据结构、Webhook 契约或 Skill 资料结构时递增。
- `MINOR`：新增向后兼容能力、命令、模块导入能力、AI/NPC 工作流或配置项时递增。
- `PATCH`：修复缺陷、补文档、优化测试、调整日志或内部实现且不改变用户契约时递增。

## 日志结构

`CHANGELOG.md` 必须保留一个 `[Unreleased]` 区块。每次开发先把变更写入 `[Unreleased]`，发布时再移动到具体版本：

```markdown
## [Unreleased]

### Added

- ...

## [0.1.0] - 2026-07-02

### Added

- ...

### Validation

- `npm.cmd test`
- `npm.cmd run typecheck`
```

可用分类：

- `Added`：新增能力、命令、配置项、脚本、文档入口。
- `Changed`：行为调整、默认值变化、体验优化。
- `Fixed`：缺陷修复、回归修正、异常处理。
- `Deprecated`：仍可用但计划移除的能力。
- `Removed`：已经移除的能力或配置。
- `Security`：签名校验、密钥处理、权限边界、数据脱敏相关调整。
- `Docs`：纯文档更新。
- `Internal`：不影响用户契约的内部整理。
- `Validation`：发布前实际执行过的验证命令和结果摘要。

## 发布检查

发布提交应同时包含：

- `package.json` 版本号更新。
- `CHANGELOG.md` 从 `[Unreleased]` 归档到新版本。
- 必要的迁移说明或配置变更说明。
- `npm.cmd test` 和 `npm.cmd run typecheck` 的结果。

发布后创建并推送 tag：

```powershell
git tag vX.Y.Z
git push origin main --tags
```

如果发布只同步文档或规则，不创建 tag；等到包含代码或配置变更的正式版本再打 tag。
