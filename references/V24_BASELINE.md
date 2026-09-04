# v24 原版基线

- 上游仓库：`https://github.com/BaiShui-xss/baishui-zmt-v24`
- 原作者完整只读仓库：`references/upstream-skill-repo/`
- 从原作者仓库提取的可运行只读基准：`references/v24-source/`
- 基线分支：`main`
- 基线提交：`d8f8e5b2d10c193d0ea0bf3581e41cc34490e55b`
- 提交时间：`2026-08-08T22:38:51+08:00`
- 提交主题：`docs(readme): 在 README 插入功能截图区（6 张核心界面实拍 + 简介）`
- 获取方式：浅克隆当前 `main`；工作树包含该提交的完整源码文件。

## 使用约束

1. `references/upstream-skill-repo/` 保存原作者完整 GitHub 仓库，只用于追溯、审计和重新提取。
2. `references/v24-source/` 保存从上游仓库提取的真正可运行 v24，只用于与 `app/` 比较。
3. 两个目录都已移除写权限，且都被项目根 `.gitignore` 排除。
4. 上游远端命名为 `upstream`，fetch URL 保留，push URL 已设置为 `DISABLED`。
5. 新产品只修改 `app/`；其初始内容与 `references/v24-source/` 一致，不包含上游 `.git` 元数据。
6. 若未来需要评估新版本，应另建临时 checkout 做差异审计；不得直接改写任一只读基准。
