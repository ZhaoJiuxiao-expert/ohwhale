# REA 核查与好友流程

2026-11-05，使用 [REA 官方技能](https://github.com/morluto/rea/blob/main/.agents/skills/reverse-engineer-anything/SKILL.md) 的只读静态 JavaScript 分析入口；通过 `pnpm dlx rea-agents@latest analyze-javascript-application`，从目标项目之外启动。没有注册全局 MCP，没有运行 QQ 或注入代码。

目标为本机 `<QQ 安装目录>/versions\9.9.33-52230\resources\app\application.asar`。仅选择容器中已经盘点的 `app_launcher/index.js`，每文件预算 10 秒。ASAR SHA-256 为 `882aa00613afd72f63b424dce347d0bffceb25c5ce643babcebe2776ab8606d7`；REA 原始证据 ID 为 `ev_943ffd7629010cea17a68ea8b2e13348a4ed79d4647e0920265575e4888f9abe`，完整本地证据保留于开发 artifacts，不随应用分发。

REA 识别到 185 个相关资源文件；选中的启动资源只有 80 bytes，标记为无效 UTF-8，解析成功的 JavaScript 文件数为 0。其余 184 个资源不在此次选定分析范围内。结果覆盖状态为 partial。工具流程成功结束不意味着获得了源码或行为证明，不能把 0 条调用关系理解为程序没有这些功能。

此次没有查明 QQ 的真实加好友协议、服务端实现或加密策略，也没有读取 QQ 用户目录、聊天、账号配置或凭据。本机先前的 ASAR/字符串分析另见《本机QQ静态分析与工程借鉴》，仍按其原始时间与方法记录。

## 哦鲸鲸自己的设计决定

以下为本项目实现选择，不声称来自 QQ 反编译结果：

1. 公开的固定鲸鲸号和二维码用于找到对方；二维码不携带登录凭据、API 密钥或管理令牌。
2. 好友申请必须由接收方确认；扫码只填写号码，不自动发送申请。
3. 好友关系与临时网络会话分开保存。断线后重新邀请，仍回到同一份本机聊天。
4. 连接邀请需接听，双方保持应用前台；本版不声称实现离线消息投递、账号找回或多端同步。
5. 电脑使用系统凭据加密，Android 使用 KeyStore 的专用用途与固定接口白名单。好友服务只保存必要身份和关系数据，消息内容经既有 WebRTC 通道传输。
6. 高级一次性邀请和 AI 额度分享保持独立授权。添加好友本身不授予他人使用模型的权限。

实际运行和安全核验结果另记验收报告，不以本设计文档代替测试。
