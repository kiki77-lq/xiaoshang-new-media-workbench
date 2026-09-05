# 小商的拍车日记｜新媒体运营工作台

本地优先的单团队运营工作台：**热点 → 灵感 → 内容 → 拍摄/发布 → 数据复盘 → 周/月报**。

Node 24 在电脑上运行本地 API，SQLite 保存业务数据，浏览器显示暗色青色工作台。四平台固定为抖音、视频号、小红书、微博；同一条内容有四条独立发布记录。WorkBuddy 通过 API 协作，老板电脑不需要 Codex。

## 现在可以做什么

- 灵感原话保留、结构化整理、置顶、搜索、转内容；内容制作状态和四平台发布状态分开。
- 月历拍摄/发布/待确认安排，红/蓝/紫区分，以上海时间呈现。
- 手动、CSV、Excel、WorkBuddy 导入指标；真实值/计算值/推断分开，缺失不补零；单作品复盘保留证据。
- 人工热点/竞品观察转灵感，不重复创建；保存不可变的周/月报告，复制或下载 Markdown。
- 本地设置、备份核验、二次确认恢复；安全安装和更新。

报告当前由本地确定性规则生成，不冒充 AI。应用不自动发作品、不抓取平台、不接微信、不保存平台密码，也不做多IP/Todo/素材库。

## 老板电脑首次安装

适用已验证的 macOS / POSIX Shell 路径。先安装 **Git、Node.js 24.x（含 npm）**，并让 Git 登录一个有此 Private 仓库访问权的 GitHub 账号。首次下载依赖需要联网；不要把 GitHub Token 放在仓库地址或截图里。Windows 原生安装尚未验证。

让 WorkBuddy 在你选定的安装位置执行，或在终端执行：

```bash
git clone https://github.com/kiki77-lq/xiaoshang-new-media-workbench.git
cd xiaoshang-new-media-workbench
bash scripts/install-local.sh
```

看到 `state: healthy` 后，在这台电脑打开 **http://127.0.0.1:5173**。安装会创建 `data/`、生成本地密钥、安装依赖、执行迁移、启动后台服务并检查健康状态。重复运行不会清空数据库或更换已有 Token。

若端口已被占用，脚本会拒绝启动，不会杀掉其他软件。可在同一次安装中始终指定另一个端口：

```bash
WORKBENCH_PORT=5174 bash scripts/install-local.sh
```

以后启动、更新及 WorkBuddy 也要使用同一个端口。不要一会儿默认端口，一会儿新端口。

## WorkBuddy 使用

告诉 WorkBuddy：

> 我的工作台安装在「这里填本机实际完整路径」。请读取该目录的 workbuddy/SKILL.md，使用其中的客户端帮我操作。不要直接访问 SQLite，不要输出 Token。先查看服务健康状态。

然后可以说“记个灵感”“找这周报告”“把这条内容改为制作中”“看这条作品表现”。[Skill](workbuddy/SKILL.md) 给出全部映射，[客户端](workbuddy/client.mjs) 只接受本机地址，自动读取本地凭据。写入带固定请求键，修改带当前版本号；只有 API 确认后才会说成功。原始灵感文字永远不可修改。

这是一份可由 WorkBuddy 读取的仓库内 Skill 和已测试客户端；没有宣称已在老板实际 WorkBuddy 应用中完成安装或自动发现。

## 启动、停止和检查

在安装目录执行：

```bash
node scripts/local-service.mjs status
node scripts/local-service.mjs start
node scripts/local-service.mjs stop
```

`start` 不重新安装依赖；首次使用请运行安装脚本。关机后可再 `start`。当前不注册开机启动任务。管理命令只控制能通过本机私有通道证明归属的进程，不凭 PID 文件随便杀进程。

同一个数据目录只允许一个服务使用，即使改用另一个端口也不能重复启动。`DATA_IN_USE` 表示该目录仍被占用：先确认并正常停止已知服务；不要删除 `data/local-runtime/process-lease.sqlite` 来“解锁”。它是独立的进程占用锁，不是业务数据库，系统会在占用进程真正退出后释放锁。更新期间也禁止另一个直接启动的服务进入该目录。

占用保护适用于本版本的启动和更新入口；不要让旧版程序或外部数据库工具同时操作真实库。数据目录应放在本机磁盘，不使用网络共享文件系统。

## 以后如何更新

让 WorkBuddy 在同一个安装目录执行：

```bash
bash scripts/update-local.sh
```

流程：记录旧 SHA → fetch → 暂停并排空请求 → 核验更新前备份 → pull --ff-only → 安装依赖 → 迁移 → 候选服务健康检查 → 开放业务访问。

脚本拒绝脏代码、非快进历史、陌生远程更换、与本机文件冲突或取消数据忽略保护的更新。**不要改成强制拉取，不要运行 reset --hard 或删除 data。** 候选版本验收前不接受业务写入；失败时回退旧代码和保护性数据库副本，保留故障提交历史。自动回退会创建 `codex/rollback-*` 分支，仍跟踪原远程主线，修复版到达后继续用同一个更新命令。

如果提示 `PENDING_UPDATE`、`PROMOTION_UNCERTAIN` 或 `ROLLBACK_INCOMPLETE`，先保留现场，不要反复安装或手动覆盖数据库。查看状态后使用明确恢复命令：

```bash
node scripts/local-service.mjs status
node scripts/local-service.mjs recover
```

若 `OPERATION_LOCKED`，先确认另一个安装/更新进程及其子进程是否仍在运行。脚本不自动清除陈旧锁；单凭父进程退出不能证明后台迁移或安装已经结束。保留锁和更新日志，请熟悉本机进程的维护者核对后处理，勿删除整个数据目录。无法证明锁归属或恢复健康时，停止操作并人工检查磁盘与备份。版本已经开放写入后，只做向前恢复，不用旧备份覆盖可能新增的数据。

## 老板数据在哪里

默认在 **安装目录下的 `data/`**，不是 `app/`。例如克隆到 `/Users/老板/工作/xiaoshang-new-media-workbench`，数据库就是该目录的 `data/workbench.sqlite`。

| 本机路径 | 用途 |
|---|---|
| `data/workbench.sqlite` 及 WAL/SHM | 真实业务数据库及运行中边文件 |
| `data/secrets.json` | 本地 Bearer Token，权限限制为本人可读写 |
| `data/backups/` | SQLite 一致性副本、校验清单、失败恢复保护文件 |
| `data/operations/` | 备份/恢复幂等收据 |
| `data/local-runtime/` | 本机进程身份、更新和恢复状态 |

这些数据、截图、依赖、密钥和数据库都被 Git 忽略。GitHub 更新只更新代码，不是数据同步。换电脑时，代码和数据要分别迁移；不要只 clone 后以为数据会回来。自定义 `WORKBENCH_DATA_DIR` 需要所有启动、更新、WorkBuddy 命令一致使用；安装绑定防止误指另一数据目录。

## 备份与恢复

设置页「立即备份」→ 等待校验通过。定期把备份数据库和同名 JSON 清单一起复制到独立安全位置，同一硬盘上的备份不能防硬盘损坏。

恢复必须先核验，再勾选确认、输入“恢复”。系统创建恢复前保护副本，替换后检查健康；失败尝试回滚，无法回滚时保持维护状态。Token 不随数据库恢复替换。备份目前保守保留，不自动删历史，需关注磁盘容量。

详见[报告、观察与恢复说明](docs/operations/reports-and-recovery.md)、[指标导入说明](docs/operations/metrics-import.md)。

## 本地与手机边界

默认只监听 `127.0.0.1`。桌面和390×844手机视口已做浏览器验证，PWA可缓存静态外壳，但所有 `/api/` 必须联网直读本机服务。电脑服务停止时，不会假装离线数据已保存。

当前**不提供公网/局域网部署或跨设备同步**；手机不能直接打开电脑的127.0.0.1地址。真正手机访问需要单独设计网络与认证，不在V1交付中。

## 开发验证与来源

```bash
cd app
npm test
npm run check
npx playwright install chromium
npm run test:e2e
```

测试自动使用全新的操作系统临时数据目录和虚构数据，不使用老板的真实 data。完整交付用例包含临时 Git clone、安装、业务链路、更新、迁移、恢复与失败回退；浏览器截图输出 `artifacts/v1-final/`，不上传Git。

应用版本0.1.0，产品Schema4。历史阶段记录见 `docs/operations/phase-*-checkpoint.md`，初始设计与计划见 `docs/superpowers/`。本地自动化通过不等于老板真实电脑或实际WorkBuddy进程已验收。

初始PWA/界面基线来自 BaiShui-xss/baishui-zmt-v24；出处、原版SHA与上游MIT声明见 [第三方说明](THIRD_PARTY_NOTICES.md)。
