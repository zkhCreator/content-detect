# 贡献指南

1. 阅读待修改文件顶部的职责说明与 [架构文档](docs/ARCHITECTURE.md)。新源文件同样需要说明目的、输入输出和非目标。
2. 安装 Node.js 22+，运行 `npm ci`。
3. 使用合成页面、合成目标与明确标识的测试凭据。真实 Key 只在本机插件中填写，不要粘贴到 issue、终端命令或测试。
4. 修改后运行 `npm run check`；涉及提取、权限、UI 或后台生命周期时，构建后运行 `npm run test:browser`。
5. 按模块提交。提交者自行配置其 GitHub noreply 邮箱，避免私人邮箱随历史公开。
6. 提交前检查 `git diff --cached` 和隐私扫描。不要提交 `dist/`、浏览器 profile、真实页面截图、日志或环境文件。

本项目不需要开发服务端、配置环境变量或连接自己的浏览器 profile 才能运行自动测试。升级 Playwright 时需同时验证工具栏授权的 CDP `Extensions.triggerAction` 与浏览器弹窗页面测试行为。

改变隐私行为、站点权限或第三方请求字段时，同时更新 README 和 PRIVACY.md。跨浏览器移植不得在存储隔离失败时静默降低安全约束。
