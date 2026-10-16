# 校园递小帮 · Campus Express

支持多校区的校园快递代拿平台，包含微信小程序、Web 管理台，以及 Node.js / Express / MySQL 后端。

小程序提供注册、地址管理、逐件下单、优惠券、支付、订单跟踪、骑手申请与配送等功能；管理台提供订单、骑手、售后、优惠券、收入、提现和校区变更审核等功能。

## 项目结构

```text
app.js / app.json / app.wxss   微信小程序入口
pages/                        主包页面
packages/                     订单和账户分包
components/ / custom-tab-bar/  公共组件与底部导航
config/ / utils/ / styles/     配置、工具与样式
assets/                       公共图片
admin-web/                    Web 管理台源码
server/src/                   Express API 与后台任务
server/sql/                   数据库结构、迁移与回滚脚本
scripts/                      构建与校验脚本
deploy/                       Nginx 配置示例及品牌图片
```

## 开发环境

- Node.js 20 或更高版本、npm。
- 微信开发者工具。
- 后端使用 MySQL 5.7 兼容数据库。

在项目根目录安装依赖：

```bash
npm ci
npm --prefix server ci
```

## 小程序

```bash
npm run prepare:dev
npm run build:dev
npm run build:test
npm run build:prod
```

构建输出到 `dist/development`、`dist/test`、`dist/production`。在微信开发者工具中导入对应目录。

环境配置位于 `config/env.dev.js`、`config/env.test.js`、`config/env.prod.js`；微信项目配置位于 `project.config.json`。独立部署时应填写自己的微信 AppID 和合法 HTTPS 域名。

## Web 管理台

在项目根目录运行：

```bash
npm run admin:dev
```

打开 `http://127.0.0.1:4173`。开发配置启用 Mock 时，演示登录为 `admin` / `admin123`，仅用于本地演示，不是生产账号。

Mock「订单管理」包含“不划给骑手”演示：配送中的订单 `KD20260714000018` 和已接单订单 `KD20260714000015` 可操作；另有已扣留、已冻结、已结算的订单作为对照。点击后保存在浏览器本地，刷新仍显示“未划给骑手”；旧版 Mock 缓存会自动补齐缺少的字段，无需清空浏览器数据。

```bash
npm run build:admin:dev
npm run build:admin:test
npm run build:admin:prod
```

环境配置位于 `admin-web/config/`；产物输出到 `dist/admin-web/<environment>`。生产构建会排除 Mock 模块。

## 后端配置

将 `server/.env.example` 复制为 `server/.env`，在本机或部署环境中填写数据库、微信、JWT、支付和 SMTP 参数。示例中的 `REPLACE_WITH_...` 均为占位符；管理台与小程序的 JWT 密钥应分别设置。

后端从 `server/.env` 读取配置。客户端使用的微信 AppID、域名和客服信息属于公开配置，服务端的 AppSecret、数据库密码、JWT 密钥和支付签名密钥不放在客户端。

新数据库的结构定义位于 `server/sql/schema.sql`，历史版本变更位于 `server/sql/migrations/`，对应回滚脚本位于 `server/sql/rollbacks/`。请结合目标数据库的版本选择初始化及升级步骤；历史迁移包含不可重复执行的数据结构变更。

```bash
npm --prefix server start
```

服务默认监听 `127.0.0.1:5500`，健康检查为 `GET /health`。独立部署时需同时调整前端 API 域名、管理台 CORS 来源及 `server/src/routes/payments.js` 中的支付回调地址。

`server/ecosystem.config.cjs` 为 PM2 配置，`deploy/*.conf.example` 提供 Nginx 参考配置；运行用户、Node 路径、上传目录和 HTTPS 证书需与部署环境一致。

## 校验与构建

```bash
npm run validate
npm run check
npm run build:prod
npm run build:admin:prod
```

`check` 包含小程序静态检查、管理台与后端校验、上传及限流回归和单元检查。审核模式的注册、订单语义和收入展示有专门校验约束。

## 仓库内容说明

此仓库是从运行项目整理出的独立副本，保留业务源码、锁文件、数据库结构与迁移、构建脚本和项目图片。图片与公开客服信息按项目原配置保留。

私有 `.env`、开发者工具个人配置、线上专用 Nginx 配置、数据库备份、日志、一次性运维脚本、内部交接文档、工具记忆、依赖目录及构建产物不随仓库上传。`.gitignore` 已排除这些文件；环境配置只提供不含真实密钥的 `.env.example`。
