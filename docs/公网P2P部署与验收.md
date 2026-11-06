# 公网连接、TURN 与验收边界

这是一套可准备到本机、待部署到用户自有服务器的方案。**目前尚未取得已部署服务器地址与证书，未采购、未部署公网服务，也没有跨 NAT / TURN 中继成功证据。** 本机测试只能证明邀请码协议与原生 RTC 集成可用；不能把它写成公网已跑通。

## 结构与授权

客户端 `src/p2p/network.js` 的 `PublicPeerSession` 包装原 `PeerLink`。它通过 HTTPS REST 每 750ms 做短期信令轮询，不使用 WebSocket。房主创建后，只有访客加入才开始收集 ICE / 生成 SDP，避免用户复制邀请码期间耗尽 RTC 连接等待。聊天、图片、音频、AI 请求和回复仍只通过 RTCDataChannel；服务器只在内存保存短期 SDP、房间授权与计数，不存聊天消息或持久化 SDP。

创建房间需要部署者的 owner token，邀请码不包含它。房间 ID 为 128-bit 随机值，邀请 secret 为 256-bit；邀请不是可枚举的六位数字。`OH1.` 码携带服务器 origin、房间 ID、一次性 secret 和到期时间，默认 5 分钟。加入后 secret 失效，访客获得独立能力 token；host 只能发 offer、guest 只能发 answer，重复阶段拒绝；双方 RTC 连接成功后删除信令房间。关闭或过期也删除。分享 AI 仍需桌面主进程额外 opt-in、额度及撤销，邀请码不等于 AI 授权。

信令地址仅 HTTPS origin 或本机测试 HTTP，禁止账号、query、fragment 和路径，fetch 禁止重定向、Cookie 与 referrer。Owner token 仅会话内存输入，不写 localStorage；不要将其放 URL、角色导出或日志。CORS 只接受同站、明确配置的来源以及 Electron `null` / Android `https://appassets.androidplatform.net` 等应用 origin。来源许可不是鉴权替代。默认房间总数100、单IP5个在途、每分钟6次创建/12次加入尝试/240次总请求；只有 loopback 代理连接且开启配置时才信任代理 IP 头。IP 只以进程随机盐哈希在内存限流。

TURN 使用服务器 `HMAC-SHA1(sharedSecret, expiry:room:role)` 生成的临时凭据，默认有效期 15 分钟，sharedSecret 永不下发。每用户名4个 allocation、总40个、单路1MiB/s、总容量10MiB/s，并拒绝私网、回环、链路本地、云元数据地址段和多播，禁用 TCP relay endpoint，不开放匿名 TURN。此方式与配置来自 [coturn 官方示例](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf)。凭据到期后的既有 allocation 生命周期取决于 coturn 刷新；客户端没有长期自动续签，长会话可能需要新邀请。停止 AI 共享仍会立即由主进程撤销，不能把它说成同时撤销已签发的 TURN 凭据。

`iceTransportPolicy:'relay'` 强制仅用中继候选；实际路由取选中 candidate pair 的两端 candidateType，任一为 relay 就标 `relay`，有选中候选但无 relay 才标 `direct`，未取得统计则不假定直连。[W3C WebRTC](https://www.w3.org/TR/webrtc/)与[统计定义](https://www.w3.org/TR/webrtc-stats/)支持这些判据。RTC 使用 DTLS；信令与 TURN 的正常服务端不会解密 RTC 聊天内容，但自有信令仍是信任边界，尚未提供防恶意信令服务器的独立身份验证。显示名不证明身份。

## 准备部署包

在项目中运行 `node scripts/prepare-network-deploy.cjs`。它只复制明确列出的信令、RTC 客户端、验收页、配置生成器和部署文件到全新 `artifacts/network-deploy-*`，不包含聊天、profile、小说或密钥，不启动服务。不要把整个项目目录或用户数据上传服务器。

当前容器方案面向有固定公网 IPv4 的 Linux ECS，需 Docker Compose、Node24 和允许的网络端口。有域名时使用下面的原路线；**没有域名时使用新附带的 `IP-HTTPS.md`（源码文档为[公网IP证书部署](公网IP证书部署.md)）、`compose.ip.yaml` 与 `ip-https.cjs`**，通过受信 IP 短证书提供 HTTPS，不关闭证书校验。模板采用官方 `coturn/coturn:4.18.0-r0`（版本标签见 [coturn Docker 官方说明](https://github.com/coturn/coturn/blob/master/docker/coturn/README.md)）、Node24 与 Caddy2。**本机没有 Docker，尚未拉取/运行这些镜像；交付包不是已部署验收。** 正式投用前记录实际镜像 digest 并完成下述公网测试。

把准备好的包放入服务器新建的 root 专用目录，用环境变量填写 `OH_SIGNAL_DOMAIN`（域名）、`OH_PUBLIC_IP`（EIP）、`OH_PRIVATE_IP`（ECS 实际网卡 IPv4；有一对一 NAT 时应填）、可选 `OH_TURN_DOMAIN`，然后以 root 在该目录运行 `node configure.cjs`。它以600权限新建 `secrets.env`、`turnserver.conf` 和 `Caddyfile`，不覆盖已有文件，不打印 token / shared secret。先运行 `node preflight.cjs` 核实私密配置为 root:root/0600 非符号链接文件，专用目录不向组/其他用户开放写入。coturn 容器已 drop ALL capabilities，不能依赖容器root读取ubuntu属主的600配置；不要把 secret 改成全员可读或添加 DAC_OVERRIDE。Owner token 在服务器本机安全读取后只交给房主，访客只接收邀请码。验证通过后再由部署者执行 `docker compose up -d --build`。

Caddy 为信令提供 HTTPS，Node 只监听127.0.0.1:8787，容器用 Linux host network。coturn 默认开3478 UDP/TCP，relay UDP 49160–49200。默认不启用 TURN TLS：RTC 内容依然有 DTLS，但只放行443的企业网络可能无法连通。若要 `turns:5349` 或独立IP上的TURN/TLS443，必须另行部署有效证书并调整监听/安全组，不得把此模板说成已覆盖所有网络。

阿里云安全组和主机防火墙需同时允许：TCP80/443（HTTPS与证书）、UDP/TCP3478（TURN控制）、UDP49160–49200（relay）；SSH22仅允许部署者固定IP，不把管理端口开放到全网。安全组按最小权限设置，且避免改动无关服务；依据[阿里云ECS官方说明](https://www.alibabacloud.com/help/en/ecs/user-guide/start-using-security-groups)。TURN会消耗实际公网出站带宽与费用，本任务没有购买或启用收费资源。

## 客户端接口

`new PublicPeerSession({serverUrl?,ownerToken?,iceTransportPolicy:'all'|'relay',onState,onMessage,onError})`。

- `create({name,mode:'human'|'agent',agentName?}) => {code,expiresAt,serverUrl}`：房主。
- `join(code,{name}) => {serverUrl,expiresAt}`：访客；可先用 `inspectPublicInvite(code)` 查看地址和过期时间。
- `send(message)`、`close()` 与原PeerLink一致，`diagnostics()`返回候选类型、route、ICE状态、字节计数，不返回候选地址。
- `info`保留sessionId/remoteName/mode/connected/route，增加serverUrl/signalingStatus/expiresAt/credentialExpiresAt/iceTransportPolicy。`onState`仍为new/connecting/connected/disconnected/closed，阶段见signalingStatus。连接成功不代表对方保存或阅读。

## 真正公网与强制 relay 验收

1. 先查公开 `/health` 的 `turnConfigured`，它仅说明配置存在，不证明TURN能用。
2. 自有服务部署好后，在本机环境设 `OH_SIGNAL_URL` 和 `OH_SIGNAL_OWNER_TOKEN`，运行 `node scripts/public-p2p-qa.cjs`。它使用两个隔离浏览器上下文、强制relay、双向随机probe与ACK，要求双方实际统计route=relay并有传输字节，保存去敏感报告。它只能证明**同一台机器经真实公网TURN的数据路径**，明确输出crossNATVerified:false。
3. 在两台独立环境（例如Windows家庭Wi-Fi和Android蜂窝网络）分别打开 `https://自己的域名/check`，填写真实环境说明，房主输入owner token生成邀请，另一环境加入。双方连接后各点“发送验收消息”，再显示报告，须双方route=relay、policy=relay、received/acknowledged probes均大于0，并保留实际网络/设备证据。工具中的环境名称只是操作者声明，不能单独证明不同NAT。
4. 回到真实应用，分别做真人文字/图片、AI主机未授权拒绝、授权后实际模型标签、主机普通发言、停止共享与断线中断；不得用验收页的probe冒充AI请求成功。

本机已执行 `node --test tests/network-deploy.test.cjs tests/network.test.cjs`，10/10 通过：IP证书生成/编排/续期/TLS检查策略、root配置权限单元验证，房间授权、一次性邀请、角色隔离、过期、凭据HMAC、限流/大小及两隔离浏览器原生RTC短码流程；空TURN配置下明确只报告本机direct。证书流程使用依赖替身核验错误与成功分支，没有运行 Certbot/Caddy 容器、没有实际 ACME 签发。`tests/p2p.test.cjs`覆盖原手动流程与媒体分块。尚无公网/relay/跨NAT测试结果，后续应在此追加真实证据路径与日期，不回填成功记录。
