# NetPerf Paperclub

[English](README.md)

由 **NetPerf** 开发、可独立部署的论文阅读与讨论服务。采用 React + Node.js + SQLite，仓库包含 1,919 篇整理后的 NSDI/SIGCOMM 英文论文数据。

- **All Paper**：搜索和筛选论文库。
- **Paper Folders**：公开/私有文件夹、协作者、笔记、批量添加、排序、个人阅读进度、Fork 与 Star。
- **Community**：评论、可修改的评分，以及须超过注册用户总数一半赞成的 Topic 修改提案。
- **账户管理**：本地登录、可选 OpenID Connect，以及管理用户权限和邀请的 Admin 页面。网页界面统一使用英文。

## 快速开始

需要 **Node.js 24+**。

```sh
npm ci
cp .env.example .env
npm run build
npm run init
npm start
```

打开 [localhost:3000](http://127.0.0.1:3000)，使用 **admin** 和初始化时终端显示的随机密码登录，再按提示修改密码。重复运行 `init` 不会重置现有密码或用户数据。

在 **Admin → Create invitation** 生成邀请码。管理员可搜索用户、修改显示名和角色、停用或恢复账户；自己的密码在账户页面修改。默认采用邀请注册。

使用 `npm start` 时需保持终端运行。后台运行、Docker 部署、升级与密码恢复请看[部署文档](docs/DEPLOYMENT.md)。

## 数据与目录

```text
corpus/<conference>/<year>/<id>.json   纳入 Git 的英文论文库
src/web/ · src/server/ · src/shared/  前端、后端与共享类型
db/migrations/                       数据库迁移
tools/ · tests/ · docs/              维护工具、测试与文档
var/                                本地数据库与备份，不纳入 Git
```

每篇论文仅含 `id`、`title`、`abstract`、`authors`、`conference`、`year`、`url`。Topics、账户、文件夹、笔记、评论、评分和阅读进度存放在运行时 SQLite 数据库中。论文库是整理后的选集，不保证完整覆盖会议全部论文。详见[数据维护](docs/DATA.md)。

## 开发与验证

```sh
npm run dev       # 前端 :5173，API :3000；先停止 npm start
npm run verify    # 构建、单元/API 测试、浏览器测试
```

浏览器测试需要 Chromium：运行 `npx playwright install chromium` 或配置 `CHROMIUM_PATH`。测试使用独立数据库，GitHub Actions 也会执行这些检查。

[架构](docs/ARCHITECTURE.md) · [参与贡献](CONTRIBUTING.md) · [安全](SECURITY.md)

程序代码与文档采用 [MIT](LICENSE) 许可证；论文内容保留原有权利，见 [NOTICE](NOTICE)。
