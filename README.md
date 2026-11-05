# Komari Ink

## 项目介绍

Komari 的黑白墨水风格主题。面向普通浏览器，基于官方最新稳定版功能开发，在保留功能的前提下减少资源开销。当前功能基线：Komari 1.6.1。

## 技术栈

原生 JavaScript ES Modules、HTML、CSS、SVG；使用 Komari 同源 HTTP / JSON-RPC 接口，无运行时第三方依赖。GitHub Actions 构建主题 ZIP。

## 使用方法

1. 从 [Releases](https://github.com/ohbaby30/komari-ink/releases) 下载 `Komari-Ink-v版本号.zip`，不要使用 Source code ZIP。
2. 在 Komari 后台的主题管理中上传、安装并启用。
3. 价格、周期、到期等资料在 Komari 后台维护，主题选项在后台主题管理中设置。首页可调整本机布局、刷新和线路；累计流量可打开明细，资产页查看费用与续费，点击节点查看完整信息和图表。

自行构建：进入 Actions → Release theme → Run workflow，选择 main。版本从 `komari-theme.json` 读取，构建成功后安装包发布至 Releases；已有版本不会覆盖。
