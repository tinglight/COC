# SillyTavern 实验环境体验计划

## 目的

创建一个一次性、与项目隔离的 SillyTavern 实验环境，在把任何设计借鉴到本 bot 前，先体验真实产品。这个实验环境不能读取本项目的 `.env`、SQLite 数据库、模组导入、日志或 keeper-only 文件。

## 安装边界

- 安装到仓库外：`D:\Apps\SillyTavern-Lab\SillyTavern`。
- SillyTavern 用户数据保留在它自己的安装目录里。
- 不要连接 QQ bot 数据库。
- 不要导入私人跑团资料或 keeper-only 模组数据。
- 如果不再需要实验环境，删除 `D:\Apps\SillyTavern-Lab`。

## 体验检查清单

1. 在干净的浏览器会话里启动 SillyTavern。
2. 用一次性用户 persona 完成首次设置。
3. 只通过 SillyTavern 正常界面连接模型服务商。
4. 手动创建一个简单 NPC 角色卡。
5. 测试 Description、Personality、Scenario、First Message 和 Example Dialogues 对说话方式的影响。
6. 创建一个包含 3 到 5 条公开资料的小型 World Info/Lorebook。
7. 观察关键词触发 lore 后，NPC 回复如何变化或被约束。
8. 打开提示词/上下文相关界面，记录哪些地方有帮助、哪些地方让人困惑。
9. 手动把本项目里的一个 NPC 概念复制到 SillyTavern，用来对比工作流。
10. 记录对本项目 NPC RP Studio 设计有用的经验。

## 要学习什么

值得借鉴：

- 用角色卡结构稳定 NPC 身份和口吻。
- 用示例对话作为实用的口吻塑形工具。
- 上下文预览和 token 预算可见性。
- 清晰区分角色、用户 persona、lore 和聊天历史。

第一版应避免：

- 暴露过多高级控制项。
- 要求 KP 用户理解正则、向量匹配、定时效果或插入深度细节。
- 把 SillyTavern 当成 CoC 规则或 keeper-only canon 的事实来源。
- 在 NPC 口吻质量稳定前，先做庞大的世界模拟。

## 成功标准

- SillyTavern 能在本机启动并用浏览器打开。
- 测试 NPC 至少能生成一条模型回复。
- 小型 lorebook 能明显改变或约束回复。
- 能识别至少三个可借鉴的设计点，以及三个应避免的复杂度陷阱。
