# 新香港 Ubuntu 22.04 主机：可审查初始化步骤

只针对根新建并核实的 Ubuntu 22.04 x86_64；不连接、重装或修改原杭州 Windows 实例。这里交付命令文件，**尚未运行远端安装/上传/部署，公网/TURN仍未验收**。ECS资源条款的同意不等于新增端口或CA条款已批准，后两项由根通过相应界面核实。

## 最小依赖与来源

主机2核2GB、40GB、固定公网IPv4；无需桌面、数据库、GPU、Python、npm依赖或Docker Desktop。基础工具为系统bash/apt/dpkg/systemd/awk/grep；脚本安装ca-certificates、curl、gnupg、xz-utils、tar、coreutils，以及Docker Engine/CLI、containerd.io、buildx和Compose插件。Node24仅用于配置与部署命令；应用Node运行于已声明的容器镜像。

`bootstrap-ubuntu2204.sh` 遵循[Docker官方Ubuntu apt仓库步骤](https://docs.docker.com/engine/install/ubuntu/)，使用HTTPS与独立Signed-By keyring；它不执行网上安装脚本、不删除冲突包或原配置。发现已有容器运行时/Node/目标配置会停止，交根审查。Docker安装可能启动本机daemon并创建其默认网络；不会自动开放应用安全组或调用云API。

Node没有本项目所需的“Node24官方apt源”这条路线，不能把NodeSource称为Node官方。脚本改用[nodejs.org官方发行](https://nodejs.org/en/download)：获取latest-v24.x的SHASUMS及签名，使用[Node官方release-keys](https://github.com/nodejs/release-keys)当次核到的8个active主指纹验证签名，再从已签名清单选出唯一Linux x64压缩包、锁定实际版本下载并核SHA256。未知/更换签名者、下载竞争或校验失败均停止；不跳过验证。公钥从官方仓库HTTPS获取并逐一核固定指纹，独立GNUPGHOME不改用户钥匙串。可核下载和签名材料保留在新的root私有/var/tmp目录，不自动删除。

## 本机包与上传

旧包目录保持不动；`node scripts/prepare-network-deploy.cjs` 产生新的白名单目录，`python scripts/prepare-network-tar.py --bundle artifacts/明确的新目录` 只归档严格白名单文件，生成新的tar.gz和SHA256侧文件并读回验证成员哈希。无现成旧tar包时就这样新建；不要上传整个仓库。配置生成后的目录会出现secret/runtime等额外文件，归档脚本将拒绝它，避免误传密钥。

根先通过已授权的阿里云上传/连接方式把tar.gz、SHA256侧文件送到**新Linux**；本文不包含SSH密码、私钥或上传命令，也不将这些资料放入包。服务端核对来自本机可信侧文件的哈希：

```sh
sudo -i
cd /root
sha256sum --check 明确的部署包.tar.gz.sha256
# 必须是全新的目标，不覆盖任何已有目录；归档只有ohwhale-network/根目录。
test ! -e /opt/ohwhale-network
tar --list --gzip --file 明确的部署包.tar.gz
tar --extract --gzip --file 明确的部署包.tar.gz --directory /opt --no-same-owner
cd /opt/ohwhale-network
bash -n bootstrap-ubuntu2204.sh deploy-ubuntu2204.sh
bash bootstrap-ubuntu2204.sh --check
bash bootstrap-ubuntu2204.sh --install-dependencies
```

tar命令只用于核过哈希且确认来源的这个白名单包，不适用于任意用户提供的压缩包。脚本保留旧文件，未提供删除/重装命令。安装器不应盲目重复运行；失败时先看已完成哪一步，再由根处理新主机上具体残留，不能运行删库/清系统脚本。

## 配置、启动、签发分别执行

```sh
export OH_PUBLIC_IP='新Linux实际固定公网IPv4'
export OH_PRIVATE_IP='新Linux网卡实际IPv4'
bash deploy-ubuntu2204.sh --configure
```

公网即网卡IPv4、没有一对一NAT时不设OH_PRIVATE_IP；ECS有私网网卡时必须填真实值。configure/preflight要求root及root:root/0600，生成ownerToken/TURNsecret不打印它们。不要使用旧Windows的IP，不使用示例保留地址。不要 `cat secrets.env`、`docker compose config`（不带--quiet）、环境全集或终端录屏来展示秘密。

根另行核实并批准**新Linux实例**安全组及主机防火墙：TCP80/443、UDP/TCP3478、UDP49160–49200；SSH22只允许管理IP，或使用已授权的云助手。不要为了容器清空iptables、关闭全部防火墙或开放所有端口。Docker的端口暴露与防火墙限制见[官方说明](https://docs.docker.com/engine/install/ubuntu/#firewall-limitations)；本方案使用Linux host网络，规则必须在实例和主机两层核对。

确认上述新访问后，根才设置标记并启动：

```sh
export OH_NETWORK_PORTS_APPROVED=yes
bash deploy-ubuntu2204.sh --deploy
```

此时只有ACME HTTP challenge与TURN监听，信令未正式HTTPS上线。根阅读[CA条款](https://letsencrypt.org/repository/)并取得相应确认、使用明确提供的本人邮箱后才执行：

```sh
export OH_CA_TERMS_APPROVED=yes
export OH_ACME_EMAIL='明确提供的运维本人邮箱'
bash deploy-ubuntu2204.sh --issue-ip-certificate
unset OH_ACME_EMAIL
bash deploy-ubuntu2204.sh --renewal
bash deploy-ubuntu2204.sh --status
```

不会从本机记忆提取邮箱。IP证书160小时有效，测试/正式目录隔离、正式TLS校验和每小时续期规则沿用[IP证书说明](公网IP证书部署.md)（包内IP-HTTPS.md）。证书成功不代表TURN或跨NAT成功；后续必须按README执行强制relay、双向ACK、真实应用文字/图片/AI分享及撤销验收，保留实际证据。不要把本机生成命令文件写成云端已执行。
