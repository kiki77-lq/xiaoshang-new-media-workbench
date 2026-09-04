# v24 原版基线

- 上游仓库：`https://github.com/BaiShui-xss/baishui-zmt-v24`
- 本地只读仓库路径：`references/v24-source/`
- 仓库内真正可运行的 v24 源码：`references/v24-source/references/v24-source/`
- 基线分支：`main`
- 基线提交：`d8f8e5b2d10c193d0ea0bf3581e41cc34490e55b`
- 提交时间：`2026-08-08T22:38:51+08:00`
- 提交主题：`docs(readme): 在 README 插入功能截图区（6 张核心界面实拍 + 简介）`
- 获取方式：浅克隆当前 `main`；工作树包含该提交的完整源码文件。

## 使用约束

1. `references/v24-source/` 只用于审计、差异比较和追溯，不在其中开发。
2. 上游远端命名为 `upstream`，fetch URL 保留，push URL 已设置为 `DISABLED`。
3. 基准目录及其文件已移除写权限；若工具请求在该目录写入，应直接拒绝，不得临时解除保护后开发。
4. 新产品只修改 `app/`；`app/` 初始内容从仓库内 `references/v24-source/` 子目录复制，不包含上游 `.git` 元数据。
5. `references/v24-source/` 被项目根目录 `.gitignore` 排除，避免把嵌套仓库误提交到新项目。
6. 若未来需要评估新版本，应另建临时 checkout 做差异审计；不得直接改写本基线。
