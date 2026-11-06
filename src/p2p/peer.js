// Native WebRTC only: no signaling endpoint, URL download, or AI dispatch.
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FRAME = 16 * 1024;
const CHUNK = 12 * 1024; // base64 characters; JSON envelope stays below 16 KiB.
const ID = /^[a-zA-Z0-9_-]{1,80}$/;
const MIME = /^(image\/(png|jpeg|gif|webp)|audio\/(wav|x-wav|mpeg|ogg|webm|mp4))$/;
const TYPES = new Set(['chat', 'agent-request', 'agent-response', 'error']);
const encoder = new TextEncoder();
const bytes = s => encoder.encode(s).length;
const fail = s => { throw new Error(s); };
function object(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('无效的数据结构');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail('未知或不安全的字段');
  return value;
}
function string(value, max, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.length) || /\u0000/.test(value)) fail('文本格式或长度无效');
  return value;
}
function id(value) { if (typeof value !== 'string' || !ID.test(value)) fail('消息标识无效'); return value; }
function name(value, max = 100) {
  string(value, max);
  if (/[\x00-\x1f\x7f/\\:]/.test(value) || value.includes('..')) fail('名称包含不安全字符');
  return value;
}
function dataURL(value, type) {
  string(value, Math.ceil(MAX_BYTES * 4 / 3) + 100);
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match || !MIME.test(match[1]) || !match[1].startsWith(type + '/') || !match[2].length || match[2].length % 4) fail('只允许内嵌图片或音频');
  const raw = atob(match[2]);
  if (btoa(raw) !== match[2]) fail('附件编码无效');
  return { mime: match[1], base64: match[2], size: raw.length };
}
function meta(value, wire = false) {
  object(value, ['type', 'id', 'text', 'attachments', 'requestId', 'model']);
  if (!TYPES.has(value.type)) fail('消息类型无效');
  const result = { type: value.type, id: id(value.id), text: string(value.text, 65536, true), attachments: [] };
  if (bytes(result.text) > 8192) fail('单条文字超过 8 KB');
  if (value.requestId !== undefined) result.requestId = id(value.requestId);
  if (value.model !== undefined) result.model = string(value.model, 200);
  const attachments = value.attachments ?? [];
  if (!Array.isArray(attachments) || attachments.length > 8) fail('附件数量超限');
  let total = bytes(result.text);
  for (const attachment of attachments) {
    object(attachment, wire ? ['name', 'type', 'mime', 'size', 'chunks'] : ['name', 'type', 'dataUrl']);
    if (!['image', 'audio'].includes(attachment.type)) fail('附件类型无效');
    const item = { name: name(attachment.name, 160), type: attachment.type };
    if (wire) {
      if (typeof attachment.mime !== 'string' || !MIME.test(attachment.mime) || !attachment.mime.startsWith(item.type + '/')) fail('附件 MIME 无效');
      if (!Number.isSafeInteger(attachment.size) || attachment.size < 1 || attachment.size > MAX_BYTES) fail('附件大小无效');
      if (attachment.chunks !== Math.ceil(4 * Math.ceil(attachment.size / 3) / CHUNK)) fail('分块数量无效');
      Object.assign(item, { mime: attachment.mime, size: attachment.size, chunks: attachment.chunks });
    } else Object.assign(item, dataURL(attachment.dataUrl, item.type));
    total += item.size;
    if (total > MAX_BYTES) fail('消息超过 8 MB');
    result.attachments.push(item);
  }
  return result;
}
function encode(value) {
  const raw = encoder.encode(JSON.stringify(value));
  let binary = '';
  for (const byte of raw) binary += String.fromCharCode(byte);
  return 'LY1.' + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(code, kind) {
  string(code, 200000);
  if (!/^LY1\.[A-Za-z0-9_-]+$/.test(code)) fail('连接码格式无效');
  const encoded = code.slice(4).replace(/-/g, '+').replace(/_/g, '/');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)))); }
  catch { fail('连接码无法解析'); }
  object(value, kind === 'offer' ? ['v', 'kind', 'sessionId', 'name', 'mode', 'agentName', 'sdp'] : ['v', 'kind', 'sessionId', 'name', 'sdp']);
  if (value.v !== 1 || value.kind !== kind) fail('连接码版本或类型不符');
  id(value.sessionId); name(value.name); string(value.sdp, 128000);
  if (!value.sdp.startsWith('v=0\r\n') || !value.sdp.includes('m=application ') || !value.sdp.includes('a=fingerprint:sha-256 ')) fail('连接描述无效');
  if (kind === 'offer') {
    if (!['human', 'agent'].includes(value.mode)) fail('会话模式无效');
    if (value.agentName !== undefined) name(value.agentName);
  }
  return value;
}
function iceConfig(value) {
  if (!Array.isArray(value) || value.length > 8) fail('ICE 服务配置无效');
  return value.map(server => {
    object(server, ['urls', 'username', 'credential']);
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    if (!urls.length || urls.length > 8) fail('ICE 服务地址无效');
    for (const url of urls) if (typeof url !== 'string' || url.length > 512 || !/^(stun|stuns|turn|turns):[^\s@/#]+(?:\?transport=(udp|tcp))?$/.test(url)) fail('ICE 服务地址无效');
    const result = { urls: [...urls] };
    if (server.username !== undefined) result.username = string(server.username, 512, true);
    if (server.credential !== undefined) result.credential = string(server.credential, 512, true);
    return result;
  });
}

export class PeerLink {
  constructor({ onState = () => {}, onMessage = () => {}, onError = () => {}, iceServers = [], iceTransportPolicy = 'all' } = {}) {
    this._callbacks = { onState, onMessage, onError };
    this._iceServers = iceConfig(iceServers);
    if (!['all', 'relay'].includes(iceTransportPolicy)) fail('ICE 传输策略无效');
    this._iceTransportPolicy = iceTransportPolicy;
    this._info = { sessionId: '', remoteName: '', mode: 'human', connected: false };
    this._status = 'new'; this._incoming = new Map(); this._seen = new Set(); this._sent = new Set();
    this._queue = Promise.resolve(); this._receiveQueue = Promise.resolve(); this._waiters = new Set(); this._timers = new Set();
    this._closed = false; this._errors = 0; this._pending = 0;
  }
  get info() { return { ...this._info }; }
  _notify(key, value) { try { this._callbacks[key](value); } catch { /* callbacks cannot break transport cleanup */ } }
  _state(status) {
    if (status === this._status) return;
    this._status = status; this._info.connected = status === 'connected';
    this._notify('onState', { status, info: this.info });
  }
  _error(error) { this._notify('onError', error instanceof Error ? error : new Error(String(error))); }
  _timer(callback, ms) { const timer = setTimeout(() => { this._timers.delete(timer); callback(); }, ms); this._timers.add(timer); return timer; }
  _clear(timer) { clearTimeout(timer); this._timers.delete(timer); }
  _remember(set, value) { set.add(value); }
  _setup() {
    if (this._closed || this._pc) fail('请新建会话后再连接');
    if (typeof RTCPeerConnection !== 'function') fail('当前环境不支持 WebRTC');
    const pc = this._pc = new RTCPeerConnection({ iceServers: this._iceServers, iceTransportPolicy: this._iceTransportPolicy });
    pc.ondatachannel = event => {
      if (this._channel || event.channel.label !== 'lingyu-v1' || event.channel.protocol !== 'lingyu-v1') { event.channel.close(); return; }
      this._bind(event.channel);
    };
    pc.onconnectionstatechange = () => {
      if (this._closed) return;
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') { this._shutdown('disconnected'); }
      else if (pc.connectionState === 'disconnected') {
        this._state('disconnected');
        if (!this._disconnectTimer) this._disconnectTimer = this._timer(() => this._shutdown('disconnected'), 10000);
      } else if (pc.connectionState === 'connected' && this._channel?.readyState === 'open') this._connected();
    };
    this._state('connecting');
    this._connectTimer = this._timer(() => { this._error(new Error('连接超时，请检查网络或 ICE 设置')); this._shutdown('disconnected'); }, 45000);
    return pc;
  }
  _bind(channel) {
    this._channel = channel;
    channel.bufferedAmountLowThreshold = 64 * 1024;
    channel.onopen = () => this._connected();
    channel.onclose = () => { if (!this._closed) this._shutdown('disconnected'); };
    channel.onerror = () => this._error(new Error('数据通道发生错误'));
    channel.onmessage = event => {
      // Queue work so a later end frame never overtakes attachment validation.
      this._receiveQueue = this._receiveQueue.then(() => { if (!this._closed) this._frame(event.data); }).catch(error => {
        this._error(error); if (++this._errors >= 8) this._shutdown('disconnected');
      });
    };
  }
  _connected() {
    if (this._closed) return;
    this._clear(this._connectTimer); this._clear(this._disconnectTimer); this._disconnectTimer = null;
    this._state('connected');
    this.diagnostics().then(diagnostics => {
      if (this._closed) return;
      if (diagnostics.route) this._info.route = diagnostics.route;
      this._notify('onState', { status: this._status, info: this.info });
    }).catch(() => {});
  }
  async diagnostics() {
    if (!this._pc || this._closed) return { connected: false };
    const stats = await this._pc.getStats(); let pair;
    for (const item of stats.values()) if (item.type === 'transport' && item.selectedCandidatePairId) pair = stats.get(item.selectedCandidatePairId);
    if (!pair) for (const item of stats.values()) if (item.type === 'candidate-pair' && item.state === 'succeeded' && item.nominated) { pair = item; break; }
    const local = pair && stats.get(pair.localCandidateId), remote = pair && stats.get(pair.remoteCandidateId);
    const result = { connected: this.info.connected, connectionState: this._pc.connectionState, iceConnectionState: this._pc.iceConnectionState, iceGatheringState: this._pc.iceGatheringState, iceTransportPolicy: this._iceTransportPolicy };
    if (local && remote) Object.assign(result, { route: local.candidateType === 'relay' || remote.candidateType === 'relay' ? 'relay' : 'direct', localCandidateType: local.candidateType, remoteCandidateType: remote.candidateType, protocol: local.protocol, ...(local.relayProtocol ? { relayProtocol: local.relayProtocol } : {}), bytesSent: pair.bytesSent, bytesReceived: pair.bytesReceived, roundTripTime: pair.currentRoundTripTime });
    return result;
  }
  _gather() {
    const pc = this._pc;
    // Only candidates already included in the description can be sent to the other peer.
    const usable = () => {
      const sdp = pc.localDescription?.sdp || '';
      const types = [...sdp.matchAll(/^a=candidate:[^\r\n]*\styp\s(host|srflx|prflx|relay)(?:\s|$)/gm)].map(match => match[1]);
      return this._iceTransportPolicy === 'relay' ? types.includes('relay') : types.length > 0;
    };
    if (pc.iceGatheringState === 'complete') return usable() ? Promise.resolve() : Promise.reject(new Error('没有可用的 ICE 候选'));
    return new Promise((resolve, reject) => {
      const cleanup = () => { pc.removeEventListener('icegatheringstatechange', check); this._clear(timer); this._waiters.delete(abort); };
      const abort = () => { cleanup(); reject(new Error('会话已关闭')); };
      const check = () => { if (pc.iceGatheringState === 'complete') { cleanup(); usable() ? resolve() : reject(new Error('没有可用的 ICE 候选')); } };
      const timer = this._timer(() => { const available = usable(); cleanup(); available ? resolve() : reject(new Error('ICE 候选收集超时')); }, 15000);
      this._waiters.add(abort); pc.addEventListener('icegatheringstatechange', check); check();
    });
  }
  async createOffer({ name: localName, mode = 'human', agentName } = {}) {
    name(localName); if (!['human', 'agent'].includes(mode)) fail('会话模式无效');
    if (agentName !== undefined) name(agentName);
    const pc = this._setup();
    this._info.sessionId = crypto.randomUUID(); this._info.mode = mode;
    try {
      this._bind(pc.createDataChannel('lingyu-v1', { ordered: true, protocol: 'lingyu-v1' }));
      await pc.setLocalDescription(await pc.createOffer()); await this._gather();
      const value = { v: 1, kind: 'offer', sessionId: this._info.sessionId, name: localName, mode, sdp: pc.localDescription.sdp };
      if (agentName !== undefined) value.agentName = agentName;
      const code = encode(value); decode(code, 'offer'); return code;
    } catch (error) { this._shutdown('disconnected'); throw error; }
  }
  async acceptOffer(invitation, { name: localName } = {}) {
    const offer = decode(invitation, 'offer'); name(localName);
    const pc = this._setup();
    Object.assign(this._info, { sessionId: offer.sessionId, remoteName: offer.name, mode: offer.mode });
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
      await pc.setLocalDescription(await pc.createAnswer()); await this._gather();
      const code = encode({ v: 1, kind: 'answer', sessionId: offer.sessionId, name: localName, sdp: pc.localDescription.sdp });
      decode(code, 'answer'); return code;
    } catch (error) { this._shutdown('disconnected'); throw error; }
  }
  async acceptAnswer(answer) {
    const value = decode(answer, 'answer');
    if (!this._pc || this._closed || this._pc.signalingState !== 'have-local-offer' || value.sessionId !== this._info.sessionId) fail('应答不属于当前邀请');
    this._info.remoteName = value.name;
    try { await this._pc.setRemoteDescription({ type: 'answer', sdp: value.sdp }); }
    catch (error) { this._shutdown('disconnected'); throw error; }
  }
  _writable() {
    const channel = this._channel;
    if (this._closed || !this.info.connected || channel?.readyState !== 'open') return Promise.reject(new Error('对方尚未连接或已断开'));
    if (channel.bufferedAmount <= 256 * 1024) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = () => { channel.removeEventListener('bufferedamountlow', ready); this._clear(timer); this._waiters.delete(abort); };
      const abort = () => { cleanup(); reject(new Error('传输已断开')); };
      const ready = () => { cleanup(); resolve(); };
      const timer = this._timer(() => { cleanup(); reject(new Error('发送缓冲区等待超时')); }, 10000);
      this._waiters.add(abort); channel.addEventListener('bufferedamountlow', ready, { once: true });
      if (channel.bufferedAmount <= channel.bufferedAmountLowThreshold) ready();
    });
  }
  async _write(frame, deadline) {
    const text = JSON.stringify({ v: 1, ...frame });
    if (bytes(text) > MAX_FRAME) fail('数据帧超过 16 KB');
    await this._writable();
    if (deadline && Date.now() >= deadline) fail('消息发送超过 30 秒');
    this._channel.send(text);
  }
  send(value) {
    let message;
    try {
      message = meta(value);
      if (this._info.mode === 'human' && ['agent-request', 'agent-response'].includes(message.type)) fail('真人会话未启用 AI 分享');
      if (this._closed || !this.info.connected) fail('对方尚未连接或已断开');
      if (this._pending >= 4) fail('待发送消息过多，请稍后再发');
      if (this._sent.has(message.id)) fail('消息已经发送');
      if (this._sent.size >= 4096) fail('本次会话消息数量已达上限，请重新连接');
      this._remember(this._sent, message.id);
      this._pending++;
    } catch (error) { return Promise.reject(error); }
    const run = async () => {
      const deadline = Date.now() + 30000;
      const timer = this._timer(() => { this._error(new Error('消息发送超过 30 秒')); this._shutdown('disconnected'); }, 30000);
      try {
      const write = frame => this._write(frame, deadline);
      const wire = { ...message, attachments: message.attachments.map(({ name, type, mime, size, base64 }) => ({ name, type, mime, size, chunks: Math.ceil(base64.length / CHUNK) })) };
      await write({ t: 'begin', id: message.id, meta: wire });
      for (let a = 0; a < message.attachments.length; a++) {
        const attachment = message.attachments[a];
        for (let start = 0, i = 0; start < attachment.base64.length; start += CHUNK, i++) await write({ t: 'chunk', id: message.id, a, i, data: attachment.base64.slice(start, start + CHUNK) });
      }
      await write({ t: 'end', id: message.id });
      } finally { this._clear(timer); }
    };
    const promise = this._queue.then(run);
    this._queue = promise.catch(() => {});
    return promise.finally(() => { this._pending--; });
  }
  _frame(data) {
    if (typeof data !== 'string' || bytes(data) > MAX_FRAME) fail('数据帧格式或大小无效');
    let frame;
    try { frame = JSON.parse(data); } catch { fail('数据帧无法解析'); }
    if (!frame || !['begin', 'chunk', 'end'].includes(frame.t)) fail('未知数据帧');
    object(frame, frame.t === 'begin' ? ['v', 't', 'id', 'meta'] : frame.t === 'chunk' ? ['v', 't', 'id', 'a', 'i', 'data'] : ['v', 't', 'id']);
    if (frame.v !== 1) fail('数据帧版本不符'); id(frame.id);
    if (this._seen.has(frame.id)) return;
    if (frame.t === 'begin') {
      if (this._incoming.has(frame.id)) return;
      if (this._seen.size >= 4096) fail('本次会话消息数量已达上限，请重新连接');
      if (this._incoming.size >= 2) fail('同时接收的消息过多');
      const message = meta(frame.meta, true);
      if (message.id !== frame.id) fail('消息标识不符');
      if (this._info.mode === 'human' && ['agent-request', 'agent-response'].includes(message.type)) fail('真人会话未启用 AI 分享');
      const entry = { message, chunks: message.attachments.map(() => []), timer: null };
      entry.timer = this._timer(() => { this._incoming.delete(frame.id); this._remember(this._seen, frame.id); this._error(new Error('附件接收超时')); }, 30000);
      this._incoming.set(frame.id, entry); return;
    }
    const entry = this._incoming.get(frame.id);
    if (!entry) fail('未找到对应传输');
    try {
      if (frame.t === 'chunk') {
        if (!Number.isInteger(frame.a) || frame.a < 0 || frame.a >= entry.chunks.length || !Number.isInteger(frame.i)) fail('附件分块索引无效');
        const attachment = entry.message.attachments[frame.a]; const parts = entry.chunks[frame.a];
        if (frame.i !== parts.length || frame.i >= attachment.chunks || typeof frame.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(frame.data)) fail('附件分块顺序或内容无效');
        const totalChars = 4 * Math.ceil(attachment.size / 3);
        if (frame.data.length !== Math.min(CHUNK, totalChars - frame.i * CHUNK)) fail('附件分块长度无效');
        parts.push(frame.data); return;
      }
      const message = { ...entry.message, attachments: entry.message.attachments.map((attachment, index) => {
        if (entry.chunks[index].length !== attachment.chunks) fail('附件传输不完整');
        const url = `data:${attachment.mime};base64,${entry.chunks[index].join('')}`;
        if (dataURL(url, attachment.type).size !== attachment.size) fail('附件大小不符');
        return { name: attachment.name, type: attachment.type, dataUrl: url };
      }) };
      this._clear(entry.timer); this._incoming.delete(frame.id); this._remember(this._seen, frame.id);
      this._notify('onMessage', message);
    } catch (error) {
      this._clear(entry.timer); this._incoming.delete(frame.id); this._remember(this._seen, frame.id); throw error;
    }
  }
  _shutdown(status) {
    if (this._closed) { if (status === 'closed') this._state(status); return; }
    this._closed = true;
    for (const reject of [...this._waiters]) reject();
    for (const timer of this._timers) clearTimeout(timer);
    this._timers.clear(); this._incoming.clear();
    if (this._channel) { this._channel.onmessage = this._channel.onclose = this._channel.onopen = this._channel.onerror = null; this._channel.close(); }
    if (this._pc) { this._pc.ondatachannel = this._pc.onconnectionstatechange = null; this._pc.close(); }
    this._state(status);
  }
  close() { this._shutdown('closed'); }
}
