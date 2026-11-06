# 无域名：公网 IPv4 受信证书部署

这是 1.2.1 使用的独立部署分支，短邀请码仍是 OH1，聊天仍走 RTC。当前只在本机准备与验证生成/编排逻辑，**未运行 Docker、未实际签发证书、未部署云服务器，未取得公网 relay 或跨 NAT 成功证据**。有域名时继续按 README 使用原 `compose.yaml` 和 Caddy 自动 HTTPS。

## 官方依据与范围

Let's Encrypt 已公开支持 IPv4/IPv6 地址证书，IP 证书有效期 **160 小时**，使用 shortlived profile，见[官方可用性公告](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability/)。[官方 Certbot 说明](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)要求 5.4+ 支持 IP webroot；Certbot 负责签发，网页服务器需另加载证书。本包使用 EFF 官方镜像 `certbot/certbot:v5.9.0`（[官方发布标签](https://hub.docker.com/r/certbot/certbot/tags)），运行时还会检查版本下限，不关闭 CA 或客户端 TLS 验证。

`stage` 使用独立目录的测试 CA 证书，不能提供受信聊天。`issue` 使用正式 CA，选择 `--required-profile shortlived`，不接受回退到其他 profile。`renew` 按已保存的签发设置检查是否到期，不强制每小时重签；`renew-test` 是官方 `renew --dry-run`。续期成功或无需续期都可能返回 0，因此脚本随后检查正式证书的 SAN、私钥匹配、有效期，再强制 reload Caddy 并以系统信任库检查 `https://IP/health`，要求实际服务证书指纹与本机正式证书一致。[Certbot 续期与参数文档](https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates)、[Caddy 加载证书](https://caddyserver.com/docs/caddyfile/directives/tls)、[Caddy reload](https://caddyserver.com/docs/command-line#caddy-reload)。

IPv4 必须是用户持有、固定、可直接从公网访问的地址。ECS 有一对一 NAT 时，coturn 必须同时填写实际私网网卡地址。IPv6、仅 IPv6 主机、443-only 网络、TURN/TLS 暂未由本分支覆盖。IP 证书解决 TLS 身份问题，不替代云服务条款、备案或应用授权；地域与费用按购买说明核对，未定义的“流量穿透”不能自行解释成已许可或全面禁止。

## 服务器准备

以下命令由部署者以 **root** 在**新建服务器专用目录**（例如 `/opt/ohwhale-network`）执行，不在个人资料目录执行。可先 `sudo -i` 再进入此目录/设置环境变量；Cloud Assistant root 运行也可。需要 Ubuntu 22.04/24.04 x86_64、Node.js 24、Docker Engine 与 Compose v2；先按各项目官方安装渠道安装，记录版本与镜像 digest。本机准备工具不会安装软件、采购或连接服务器。

仅上传 `node scripts/prepare-network-deploy.cjs` 新产生的白名单部署包；不上传整个项目、Android 签名密钥、SSH 私钥、聊天、小说或 profile。`runtime/` 是服务器私有 ACME 状态目录，`.dockerignore` 排除它以及 secrets/Caddy/coturn 配置，不把密钥烘焙进镜像。此后不要将配置后的部署目录公开打包。

阿里云安全组和主机防火墙允许 TCP80/443、UDP/TCP3478、UDP49160–49200；SSH22 只限管理者 IP。80 必须持续开放给 HTTP-01 续期，**不是**将聊天信令降为 HTTP。初始 HTTP 仅返回 ACME challenge，其余请求 503；正式阶段 HTTPS 才代理本机信令。不要同时运行旧域名 compose 的 Caddy 占用80/443，也不要停止无关服务器服务。

在部署目录中设置真实值；示例中 TEST-NET 地址不能用于实际申请：

```sh
export OH_HTTPS_MODE=ip
export OH_PUBLIC_IP=203.0.113.10
export OH_PRIVATE_IP=10.0.0.2
node configure.cjs
node preflight.cjs
node ip-https.cjs bootstrap
```

没有 NAT、网卡即公网 IPv4 时不设 `OH_PRIVATE_IP`。不需要 `OH_SIGNAL_DOMAIN`；TURN 默认使用公网 IP。Linux 下配置生成器要求 root，仅新建文件，遇到已有配置停止。`preflight.cjs` 要求私密配置为非符号链接的 root:root/0600 文件，部署目录 root 所有且不可由组/其他用户写入；已有 runtime 须 root/0700。每个 IP 部署操作自动重查。不要将秘密改成全员可读：coturn root 容器已 drop ALL capabilities，不能依赖 DAC_OVERRIDE 跨过 ubuntu 所有的600配置。若传输后属主不符，先由管理员核实专用目录再纠正具体文件属主，或在新 root 专用目录重新生成。脚本不自行放宽权限/增加容器 capabilities。不在命令行输出 owner token 或 TURN secret；房主只在应用内存输入 owner token，访客只拿邀请码。

## 演练与正式签发

先阅读 [Let's Encrypt 当前订户协议与条款](https://letsencrypt.org/repository/)；执行者明确同意后传 `--agree-tos`。邮箱由本人填写，仅用于这台服务器的 ACME 账户，不使用项目中的其他人的资料：

```sh
export OH_ACME_EMAIL='your-own-address@example.com'
node ip-https.cjs stage --agree-tos
node ip-https.cjs issue --agree-tos
unset OH_ACME_EMAIL
node ip-https.cjs status
```

`stage` 写 `runtime/acme-staging`，正式证书写 `runtime/acme/live/ohwhale-ip/`。首次申请失败时保留 challenge 服务与错误供排查，不关闭证书校验、不频繁强制重试、不把测试证书切入 HTTPS。`issue` 成功才将 Caddyfile 切换为显式加载正式证书的 HTTPS 配置；私钥只读挂载给 Caddy，Certbot 无 Docker socket、owner token 或 TURN secret。若 reload 或公网受信检查失败，命令以非零退出，不报告成功。检查80/443和证书目录后可重跑 `renew`；正式证书缺失则重新执行 `issue`。

脚本默认 Node 系统信任库，不读取项目自定义 CA，不接受 `NODE_TLS_REJECT_UNAUTHORIZED=0` 作为验收方法。ECS 若无法经自己的公网 IP 回环访问，脚本的最终公网检查可能失败，不能直接跳过；应另外从独立设备完成受信 TLS 检查并定位回环限制，再决定部署适配，保留尚未通过的状态。

## 自动续期与监测

160 小时不是传统90天证书，不能依赖手动维护。以下生成 systemd 模板但不会自行安装：

```sh
node ip-https.cjs units
systemd-analyze verify ./ohwhale-ip-renew.service ./ohwhale-ip-renew.timer
node ip-https.cjs renew-test
sudo install -m 0644 ohwhale-ip-renew.service /etc/systemd/system/ohwhale-ip-renew.service
sudo install -m 0644 ohwhale-ip-renew.timer /etc/systemd/system/ohwhale-ip-renew.timer
sudo systemctl daemon-reload
sudo systemctl start ohwhale-ip-renew.service
sudo systemctl enable --now ohwhale-ip-renew.timer
node ip-https.cjs renewal-status
sudo journalctl -u ohwhale-ip-renew.service -n 30
```

模板每小时检查、最多随机延迟5分钟，机器恢复后补触发；同一个 oneshot service 不并发执行。不要同时手工启动多个签发/续期命令。当前续期模板**只允许 `/opt/ohwhale-network`**，其他路径（含空格、引号、换行或specifier）明确拒绝；WorkingDirectory输出不加argv引号，适配Ubuntu22.04/systemd249的字面路径解析。ExecStart固定使用bootstrap安装的 `/usr/local/bin/node`，不依赖交互shell PATH。迁移目录需要另行审核适配，不直接沿用模板。服务器必须先跑 `systemd-analyze verify` 和renew-test，通过后再安装/启动timer；本机Windows未运行systemd。脚本状态输出 `expiresAt`、`remainingHours`、`attention`，不足48小时标记需处理；失败会使 service 非零退出。**这不是自动通知系统**，部署者须监控失败与剩余期限；不能宣称仅生成 timer 文件便已保障续期。

`renewal-status` 精确读取systemd show属性，要求timer持久enabled且active，service为oneshot、Result=success、ExecMainStatus=0且已结束inactive（或成功active状态）。正常oneshot完成后inactive并非失败；不再把 `systemctl status` 对inactive返回3误报为部署失败，也不吞掉timer关闭、服务失败或无法读取属性等真错误。它核对最近一次service结果，不代替未来每次续期的监控。

续期检查同时验证公网 HTTPS。保留 `/health` 不含密钥、`/check` 不含消息持久化；Certbot 本机日志与 ACME 账户文件私有保留，勿公开。云重装/更换公网 IP 后需要按新 IP 重签并更新 TURN external-ip；旧 IP 证书和邀请码不可作为新地址身份依据。

## 强制 relay 验收

先从外部浏览器打开 `https://实际IP/health` 和 `/check`，必须没有证书例外。按 README 跑 `scripts/public-p2p-qa.cjs` 可验证同机两个隔离浏览器经真实 TURN，报告仍是 `crossNATVerified:false`。随后在 Windows 家庭网络与 Android 蜂窝等**两台独立环境**打开 `/check`，强制 relay、双向 probe/ACK、选中候选 `route=relay` 和真实字节计数均需通过，再验真实应用文字/图片/AI分享/撤销。环境标签只是操作声明，不能单独证明跨 NAT。签发成功、`turnConfigured:true` 或两浏览器本机连通都不能替代这些验收。
