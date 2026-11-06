'use strict';
// Run inside a fresh prepared deployment directory. Does not deploy or purchase.
const fs=require('node:fs'),crypto=require('node:crypto'),net=require('node:net');
if(process.platform==='linux'&&process.getuid()!==0)throw Error('Run configure.cjs as root on the Linux server; keep secret configuration root-owned 0600');
const mode=process.env.OH_HTTPS_MODE||'domain',domain=process.env.OH_SIGNAL_DOMAIN,publicIP=process.env.OH_PUBLIC_IP,privateIP=process.env.OH_PRIVATE_IP;
const host=value=>typeof value==='string'&&value.length<=253&&value.includes('.')&&value.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
const signalHost=mode==='ip'?publicIP:domain,turnHost=process.env.OH_TURN_DOMAIN||signalHost;
if(!['domain','ip'].includes(mode)||!net.isIPv4(publicIP||'')||privateIP&&!net.isIPv4(privateIP)||mode==='domain'&&(!host(domain)||net.isIP(domain))||!(host(turnHost)||net.isIPv4(turnHost||'')))throw Error('Provide OH_HTTPS_MODE=domain|ip, OH_PUBLIC_IP, domain mode OH_SIGNAL_DOMAIN, optional OH_TURN_DOMAIN/OH_PRIVATE_IP');
// Documentation address ranges are accepted to allow offline configuration tests;
// acquisition later requires actual public reachability and an IP SAN certificate.
// IP-address HTTPS clients commonly send no SNI. Select the explicitly loaded
// IP SAN certificate for that handshake; keep normal client trust validation.
const ipHttp=`{\n  default_sni ${publicIP}\n}\n\nhttp://${publicIP} {\n  handle /.well-known/acme-challenge/* {\n    root * /var/www/acme\n    file_server\n  }\n  handle {\n    respond \"HTTPS certificate setup in progress\" 503\n  }\n}\n`;
const secret=crypto.randomBytes(32).toString('base64url'),owner=crypto.randomBytes(32).toString('base64url');
const files={
 'secrets.env':`SIGNAL_PUBLIC_URL=https://${signalHost}\nSIGNAL_OWNER_TOKEN=${owner}\nTURN_SHARED_SECRET=${secret}\nTURN_URLS=["stun:${turnHost}:3478","turn:${turnHost}:3478?transport=udp","turn:${turnHost}:3478?transport=tcp"]\nSIGNAL_TRUST_PROXY=true\nFRIENDS_DATA_DIR=/data/friends\n`,
 'Caddyfile':mode==='ip'?ipHttp:`${domain} {\n  reverse_proxy 127.0.0.1:8787\n}\n`,
 'network-deployment.json':JSON.stringify({version:1,mode,publicIP,signalHost},null,2)+'\n',
 'turnserver.conf':`listening-port=3478\nlistening-ip=${privateIP||'0.0.0.0'}\nexternal-ip=${publicIP}${privateIP?'/'+privateIP:''}\nrealm=${turnHost}\nfingerprint\nuse-auth-secret\nstatic-auth-secret=${secret}\nmin-port=49160\nmax-port=49200\nuser-quota=4\ntotal-quota=40\nmax-bps=1048576\nbps-capacity=10485760\nmax-allocate-lifetime=600\nstale-nonce=600\nno-multicast-peers\nno-tcp-relay\nno-software-attribute\nno-tls\npidfile=/tmp/turnserver.pid\nno-stdout-log\nsimple-log\nlog-file=/dev/null\ndenied-peer-ip=0.0.0.0-0.255.255.255\ndenied-peer-ip=10.0.0.0-10.255.255.255\ndenied-peer-ip=100.64.0.0-100.127.255.255\ndenied-peer-ip=127.0.0.0-127.255.255.255\ndenied-peer-ip=169.254.0.0-169.254.255.255\ndenied-peer-ip=172.16.0.0-172.31.255.255\ndenied-peer-ip=192.168.0.0-192.168.255.255\ndenied-peer-ip=224.0.0.0-255.255.255.255\ndenied-peer-ip=::1\ndenied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff\ndenied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff\n`
};
if(mode==='ip')files['Caddyfile.ip.https']=ipHttp+`\nhttps://${publicIP} {\n  tls /certs/live/ohwhale-ip/fullchain.pem /certs/live/ohwhale-ip/privkey.pem\n  reverse_proxy 127.0.0.1:8787\n}\n`;
for(const file of Object.keys(files))if(fs.existsSync(file))throw Error('Existing configuration preserved; use a fresh directory');
for(const [file,text]of Object.entries(files))fs.writeFileSync(file,text,{flag:'wx',mode:0o600});
console.log('Created private configuration files. Owner token is in secrets.env; no secret printed. No services started.');
