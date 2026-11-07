# 哦鲸鲸 · OhWhale

哦鲸鲸 1.3.1 是一款 Windows 和 Android 聊天软件。用户可以与 AI 角色收发文字、图片和语音，通过鲸鲸号或二维码添加好友并发起点对点聊天，也可以编辑和分享角色卡。服务端提供好友申请、联机信令和带配额保护的国产模型代理。

## 运行桌面端

开发环境使用 Node.js 24 和 pnpm，Android 构建另外需要 Windows、Python 3 和带有 javac 的 JDK。先在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm start
```

原有美术资源的来源和授权范围见 [第三方说明](THIRD_PARTY_NOTICES.md)。源码中保留图片引用、角色设定和表情素材索引。要还原发行版的头像、立绘和表情，请从有权使用的本地工程复制以下路径，保留文件名及相对路径：

- `src/ui/assets/`，包括角色图片和 `stickers/` 子目录
- `src/ui/app.ico`，Windows 图标
- `android/res/drawable/app_icon.png`，Android 图标，构建时会从 `src/ui/assets/deepseek-avatar.png` 重新生成

恢复这些资源后再打包或运行需要验证内置图片的测试。用户使用步骤见 [1.3.1 使用指南](docs/使用指南-1.3.1.md)。网络服务地址位于 `src/data/network-defaults.json`。

## 换头像与收藏表情

在聊天中打开「角色资料」→「编辑角色与模型」，点击「换个头像」。选择图片后可以预览，点击「保存角色」才会生效；取消编辑会保留原头像。支持 PNG、JPEG、WebP 和 GIF 输入，单张最大 10 MB，头像按静态图片显示。自定义头像会保存在当前设备，导出角色卡时也会随卡携带。

手机长按聊天图片，或电脑右键点击图片，再点「收藏为表情」。普通点击也可打开大图并收藏。点输入框旁的笑脸进入「角色表情库」→「我的表情」，选中图片后点「插入消息」，确认后发送。收藏会在重启后保留，同一张图片重复收藏只保留一份。滑动浏览时不会触发长按收藏。

收藏的图片再次发送时会作为图片附件传递，朋友无需预先安装你的表情库。发送给 AI 时需要所选模型支持图片理解。收藏只保存在当前设备，不会自动上传到公共图库。

## 测试和构建

`pnpm test` 运行 Node 测试。WebRTC 测试使用 Playwright 和已安装的 Microsoft Edge。可通过 `P2P_BROWSER` 指定 Chromium 可执行文件。APK 归档测试需要 Python 3。

在 Windows 上，运行 `pnpm run build` 和 `pnpm run package` 生成桌面应用目录；如已有 Electron 离线压缩包缓存，可通过 `ELECTRON_ZIP_DIR` 指定目录。

运行 `python scripts/android-setup.py` 可安装 Android SDK 35。安装时由构建者审阅 SDK 许可。准备好图片后，设置 `OHWHALE_ANDROID_SIGNING_DIR` 指向本地签名目录，并在环境中设置 `OHWHALE_SIGNING_PASSWORD`。已有签名使用文件名 `ohwhale-local.jks` 和别名 `ohwhale-development`。首次构建独立测试版本时可显式执行 `node scripts/android-build.cjs --initialize-signing`，后续运行 `node scripts/android-build.cjs`。复用原版安装身份需要原签名密钥，独立生成的密钥适用于自己的安装身份。APK 输出到 `android/output/`。

## 代码目录

| 路径 | 内容 |
| --- | --- |
| `src/ui/` | React 聊天、好友面板、角色工坊和样式 |
| `src/core/` | 消息、角色、语音、模型访问和本地存储 |
| `src/p2p/` | WebRTC 连接及传输 |
| `src/mobile/`、`android/` | 移动端适配和原生接口 |
| `server/` | 信令、好友服务、模型代理及部署模板 |
| `scripts/`、`tests/` | 构建工具和自动化测试 |
| `src/data/`、`docs/`、`licenses/` | 默认配置、素材索引、协议和许可证 |

部署前请阅读 [好友服务协议](docs/friends-v1-contract.md)、[模型代理协议](docs/managed-ai-v1-contract.md) 和 [公网部署说明](docs/公网P2P部署与验收.md)。密钥、签名文件、用户数据与实例运行配置由各部署环境单独管理。
