# 第三方代码、设计参考与图片来源

本软件名为“哦鲸鲸”，独立于 Telegram、腾讯及各模型厂商。

## 实际使用的开源代码

- [Chatscope Chat UI Kit React](https://github.com/chatscope/chat-ui-kit-react)：2.1.1，MIT；实际用于会话容器、列表、头像、消息等界面组件，并在其上扩展自有功能。
- [Chatscope Styles](https://github.com/chatscope/chat-ui-kit-styles)：1.4.0，MIT。
- [React / React DOM](https://github.com/facebook/react)：18.3.1，MIT。
- [Lucide](https://github.com/lucide-icons/lucide)：0.468.0，ISC；图标许可见其许可证副本。
- [node-qrcode](https://github.com/soldair/node-qrcode)：1.5.4，MIT；用于本机生成好友二维码。
- [jsQR](https://github.com/cozmo/jsQR)：1.4.0，Apache-2.0；用于本机识别二维码，图像不上传识别服务。
- [three.js](https://github.com/mrdoob/three.js)：0.181.2，MIT；用于本机三维小屋、OrbitControls 视角控制和 GLTFLoader 模型读取。原始许可证逐字保存在 `licenses/three-0.181.2-LICENSE.txt`，版权为 three.js authors（2010–2025）。代码及所用附加模块随应用打包，不从 CDN 加载。
- [Electron](https://github.com/electron/electron)：45.2.1，MIT，运行时所含 Chromium/Node 等另有相应许可证，随 Windows 文件夹保留。

许可证原文复制在 `licenses/` 中；构建工具不随软件提供可执行接口。WebRTC来自Electron内置Chromium实现。本软件没有复制 Telegram 或 QQ 的专有界面代码。

Windows 构建将许可证与本说明复制进应用资源；Android 构建将其复制到 APK 的 `assets/licenses/` 和 `assets/THIRD_PARTY_NOTICES.md`。最终发行包还需检查这些条目实际存在，源码中的复制逻辑不代替包内验收。

1.6 默认三维小屋由本项目代码生成基础几何体，没有新增下载的第三方房屋图片、贴图或模型。用户导入的模型及其贴图由用户提供，three.js 的 MIT 许可不会转授这些素材的权利，也不会扩大下述原有图片的授权范围。

## 仅研究与借鉴，不代表已安装

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：参照模块化会话、事件、模型适配和插件边界。没有运行其命令执行和自修改插件系统。
- [腾讯 QQ Bot](https://github.com/tencent-connect/openclaw-qqbot)：参照通道、媒体、会话职责划分。没有连接QQ账号。
- [REA](https://github.com/morluto/rea)：参照行为证据、静态资源、数据流与局限分层的方法。已对本机 QQ ASAR 的一个启动资源进行只读 REA 核查，未得到可解析源码；详见 docs/REA核查与好友流程.md。不宣称已获得QQ完整源码。
- [大肥鱼人格卡](https://aigengtu.com/persona)：参考短句、接梗、爱吃饭、小鲸鱼等人物气质，默认设定经过自主改写。没有整站复制17万字人设库，也没有启用其中描述的不存在的工具权限。

DSH/AstrBot六个插件的逐项许可及兼容性核查见 `docs/插件来源与兼容性.md`；本软件相应功能为独立原生实现。

## 图片及表情

用户提供的七张 AI 拟人参考图原样保留，原图可见“知乎 @光影伴我飞”等署名。它们不是本软件声称原创的资产。

大肥鱼端饭形象来自用户指定的[腾讯新闻文章](https://news.qq.com/rain/a/20261030A0353B00)，作者署名“数字生命卡兹克”，仅作为人物形象参考；文章未提供可认定的素材商用许可。

预置表情图来自 [梗鲸](https://aigengtu.com/) 公开图片详情页。下载原图未经裁切、去水印或重绘。32张启用图的原始链接、校验值、作者信息是否明确与权限边界记录于 `src/data/stickers.json` 和 `docs/表情素材来源.md`；没有把公开可下载视为商用授权。

应用图标与小头像使用[大肥鱼007原图](https://aigengtu.com/zh/meme/007)，只进行了完整画面的尺寸和PNG/ICO格式转换，原始WebP保留。窗口欢迎页及角色图与图标的来源记录相互独立。

当前素材用于用户要求的本机私人版本；公开分发或商业化前，应逐项获得相应素材许可，或替换为拥有相应权利的原创资产。
