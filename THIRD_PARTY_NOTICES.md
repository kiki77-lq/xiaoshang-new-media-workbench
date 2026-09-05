# 上游与第三方说明

本工作台的初始 PWA/界面基线来自 [BaiShui-xss/baishui-zmt-v24](https://github.com/BaiShui-xss/baishui-zmt-v24)，原版基准提交：`d8f8e5b2d10c193d0ea0bf3581e41cc34490e55b`。

该提交的 README「许可」声明为 MIT，SKILL.md 的 license 字段也声明 MIT。上游未附独立 LICENSE 文件；这里保留其仓库归属与声明，不推定或补造作者法定姓名。原有文件中的作者、版权和许可说明保留。此私有交付不意味着修改或撤销上游许可。

后续代码是小商的拍车日记专用本地工作台：数据层、API、业务模型、8页导航、运营闭环和部署流程已经独立重构。上游 localStorage 演示数据不作为真实业务数据导入。`references/` 是本机只读审计副本，不随产品 Git 上传；来源可按上述提交重新核查。

生产依赖 csv-parse、SheetJS，以及开发依赖 Playwright、yaml 的版本和完整性见 `app/package-lock.json`，各包原始许可随依赖保留在 `node_modules` 中。安装不会将依赖目录、老板数据库或密钥提交到 Git。
