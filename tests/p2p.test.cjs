const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const source = fs.readFileSync(path.join(__dirname, '../src/p2p/peer.js'), 'utf8');
const load = () => import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('P2P validates codes, ICE, data URLs, path names, modes and size before transport', async () => {
  const { PeerLink } = await load();
  assert.throws(() => new PeerLink({ iceServers: [{ urls: 'https://example.com' }] }), /ICE/);
  const peer = new PeerLink();
  for (const code of ['', 'https://example.com', 'LY1.a', 'LY1.' + Buffer.from('{"__proto__":{}}').toString('base64url')]) await assert.rejects(peer.acceptOffer(code, { name: '测试' }));
  await assert.rejects(peer.send({ type: 'chat', id: 'x', text: '', attachments: [{ type: 'image', name: '../x.png', dataUrl: 'data:image/png;base64,YQ==' }] }));
  await assert.rejects(peer.send({ type: 'chat', id: 'x', text: '', attachments: [{ type: 'image', name: 'x.png', dataUrl: 'https://example.com/x.png' }] }));
  await assert.rejects(peer.send({ type: 'chat', id: 'x', text: '文'.repeat(3000) }), /8 KB/);
  await assert.rejects(peer.send({ type: 'agent-request', id: 'x', text: '请求' }), /AI/);
  await assert.rejects(peer.send(JSON.parse('{"type":"chat","id":"x","text":"","__proto__":{}}')));
  assert.equal({}.polluted, undefined);
  peer.close(); assert.equal(peer.info.connected, false);
});

test('P2P receives only bounded ordered frames, deduplicates, and clears transfers', async () => {
  const { PeerLink } = await load();
  const received = []; const peer = new PeerLink({ onMessage: x => received.push(x) });
  const feed = frame => peer._frame(JSON.stringify({ v: 1, ...frame }));
  const begin = { t: 'begin', id: 'a', meta: { type: 'chat', id: 'a', text: '你好', attachments: [] } };
  feed(begin); feed({ t: 'end', id: 'a' }); feed(begin); feed({ t: 'end', id: 'a' });
  assert.equal(received.length, 1);
  assert.throws(() => peer._frame('x'.repeat(16385)), /大小/);
  assert.throws(() => peer._frame('{"v":1,"t":"end","id":"x","constructor":{}}'), /不安全/);
  feed({ t: 'begin', id: 'b', meta: { type: 'chat', id: 'b', text: '', attachments: [{ type: 'image', name: 'x.png', mime: 'image/png', size: 1, chunks: 1 }] } });
  assert.throws(() => feed({ t: 'chunk', id: 'b', a: 0, i: 1, data: 'YQ==' }), /顺序/);
  assert.equal(peer._incoming.size, 0);
  assert.throws(() => feed({ t: 'begin', id: 'large', meta: { type: 'chat', id: 'large', text: 'x', attachments: [{ type: 'image', name: 'x.png', mime: 'image/png', size: 8388608, chunks: Math.ceil(4 * Math.ceil(8388608 / 3) / 12288) }] } }), /8 MB/);
  feed({ ...begin, id: 'c', meta: { ...begin.meta, id: 'c' } });
  peer.close(); assert.equal(peer._timers.size, 0); assert.equal(peer._incoming.size, 0);
});

test('P2P backpressure queue is bounded and close rejects waiting sends', async () => {
  const { PeerLink } = await load();
  const peer = new PeerLink(); peer._info.connected = true;
  peer._channel = { readyState: 'open', bufferedAmount: 999999, bufferedAmountLowThreshold: 65536, addEventListener() {}, removeEventListener() {}, close() {} };
  const sends = [0, 1, 2, 3].map(n => peer.send({ type: 'chat', id: 'wait' + n, text: '等待' }));
  await assert.rejects(peer.send({ type: 'chat', id: 'extra', text: '超额' }), /过多/);
  peer.close();
  const results = await Promise.allSettled(sends);
  assert.ok(results.every(result => result.status === 'rejected'));
  assert.equal(peer._timers.size, 0); assert.equal(peer._waiters.size, 0); assert.equal(peer._pending, 0);
});

test('native WebRTC: two isolated contexts exchange text, chunked image/audio, reject bad frames and disconnect', { timeout: 60000 }, async () => {
  const playwright = require('playwright');
  const server = http.createServer((req, res) => {
    if (req.url === '/peer.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(source); }
    else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><meta charset="utf-8"><title>P2P loopback verification</title></html>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await playwright.chromium.launch({ executablePath: process.env.P2P_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
    const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    await Promise.all(pages.map(page => page.goto(`http://127.0.0.1:${server.address().port}`)));
    await Promise.all(pages.map(page => page.evaluate(async () => {
      const { PeerLink } = await import('/peer.js'); window.messages = []; window.errors = []; window.states = [];
      window.peer = new PeerLink({ onMessage: m => messages.push(m), onError: e => errors.push(e.message), onState: s => states.push(s) });
    })));
    const [a, b] = pages;
    const offer = await a.evaluate(() => peer.createOffer({ name: '甲', mode: 'human' }));
    const answer = await b.evaluate(code => peer.acceptOffer(code, { name: '乙' }), offer);
    await a.evaluate(code => peer.acceptAnswer(code), answer);
    await Promise.all(pages.map(page => page.waitForFunction(() => peer.info.connected)));
    assert.equal(await a.evaluate(() => peer.info.remoteName), '乙');
    assert.equal(await b.evaluate(() => peer.info.remoteName), '甲');
    await a.evaluate(async () => {
      window.frameSizes = []; const channel = peer._channel; const send = channel.send.bind(channel);
      channel.send = value => { frameSizes.push(new TextEncoder().encode(value).length); return send(value); };
      await peer.send({ type: 'chat', id: 'hello', text: '你好，真正的加密数据通道。' });
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
      const context = canvas.getContext('2d'); const pixels = context.createImageData(256, 256);
      let seed = 42;
      for (let i = 0; i < pixels.data.length; i += 4) {
        for (let k = 0; k < 3; k++) { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; pixels.data[i + k] = seed >>> 24; }
        pixels.data[i + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      const wav = new Uint8Array(180044); const view = new DataView(wav.buffer);
      const ascii = (offset, value) => { for (let i = 0; i < value.length; i++) wav[offset + i] = value.charCodeAt(i); };
      ascii(0, 'RIFF'); view.setUint32(4, wav.length - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      ascii(36, 'data'); view.setUint32(40, wav.length - 44, true);
      for (let i = 44; i < wav.length; i += 2) view.setInt16(i, Math.sin((i - 44) / 2 * Math.PI * 440 / 8000) * 8000, true);
      let binary = ''; for (const byte of wav) binary += String.fromCharCode(byte);
      window.expectedMedia = [canvas.toDataURL('image/png'), 'data:audio/wav;base64,' + btoa(binary)];
      await peer.send({ type: 'chat', id: 'media', text: '分块媒体', attachments: [{ type: 'image', name: '图片.png', dataUrl: expectedMedia[0] }, { type: 'audio', name: '录音.wav', dataUrl: expectedMedia[1] }] });
    });
    await b.waitForFunction(() => messages.length === 2);
    const expected = await a.evaluate(() => expectedMedia);
    const received = await b.evaluate(() => messages);
    assert.equal(received[0].text, '你好，真正的加密数据通道。');
    assert.deepEqual(received[1].attachments.map(x => x.dataUrl), expected);
    assert.ok((await a.evaluate(() => frameSizes)).every(size => size <= 16384));
    assert.ok((await a.evaluate(() => frameSizes.length)) > 40);
    await b.evaluate(() => peer.send({ type: 'chat', id: 'back', text: '收到' }));
    await a.waitForFunction(() => messages.length === 1);
    await a.evaluate(() => {
      // Replay a completed message: it must not reach the consumer again.
      peer._channel.send(JSON.stringify({ v: 1, t: 'begin', id: 'hello', meta: { type: 'chat', id: 'hello', text: '重播', attachments: [] } }));
      peer._channel.send(JSON.stringify({ v: 1, t: 'end', id: 'hello' }));
      peer._channel.send('not-json');
      peer._channel.send('{"v":1,"t":"end","id":"bad","__proto__":{"polluted":true}}');
      peer._channel.send(JSON.stringify({ v: 1, t: 'begin', id: 'unsafe', meta: { type: 'chat', id: 'unsafe', text: '', attachments: [{ name: '../secret.png', type: 'image', mime: 'image/png', size: 1, chunks: 1 }] } }));
    });
    await b.waitForFunction(() => errors.length === 3);
    assert.equal(await b.evaluate(() => messages.length), 2);
    assert.equal(await b.evaluate(() => ({}).polluted), undefined);
    assert.equal(await b.evaluate(() => peer._incoming.size), 0);
    await b.evaluate(() => peer.close());
    await a.waitForFunction(() => !peer.info.connected);
    assert.equal(await a.evaluate(() => peer._timers.size), 0);
    assert.equal(await a.evaluate(async () => { try { await peer.send({ type: 'chat', id: 'after', text: '断开后' }); return false; } catch { return true; } }), true);
    await Promise.all(pages.map(page => page.evaluate(async () => {
      peer.close(); const { PeerLink } = await import('/peer.js'); messages = []; errors = [];
      peer = new PeerLink({ onMessage: m => messages.push(m), onError: e => errors.push(e.message) });
    })));
    const agentOffer = await a.evaluate(() => peer.createOffer({ name: 'AI 分享端', mode: 'agent', agentName: '测试角色' }));
    const agentAnswer = await b.evaluate(code => peer.acceptOffer(code, { name: '访问端' }), agentOffer);
    await a.evaluate(code => peer.acceptAnswer(code), agentAnswer);
    await Promise.all(pages.map(page => page.waitForFunction(() => peer.info.connected)));
    await b.evaluate(() => peer.send({ type: 'agent-request', id: 'request-1', requestId: 'request-1', text: '请回答' }));
    await a.waitForFunction(() => messages.length === 1);
    await a.evaluate(() => peer.send({ type: 'agent-response', id: 'response-1', requestId: 'request-1', model: 'test-model-no-real-ai-call', text: '这是传输测试' }));
    await b.waitForFunction(() => messages.length === 1);
    assert.equal(await b.evaluate(() => messages[0].model), 'test-model-no-real-ai-call');
    assert.equal(await a.evaluate(() => peer.info.mode), 'agent');
    const mediaBytes = expected.reduce((sum, url) => sum + Buffer.from(url.split(',')[1], 'base64').length, 0);
    console.log(`P2P_VERIFIED: native RTC, isolated browser contexts, loopback only, text + ${mediaBytes} valid PNG/WAV bytes, max frame <=16384, no STUN/TURN`);
    await Promise.all(contexts.map(context => context.close()));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('bounded ICE gathering accepts only usable policy-compatible candidates and cleans up on close', async () => {
  const {PeerLink}=await load();
  const candidate=type=>`v=0\r\na=candidate:1 1 udp 1 192.0.2.1 1234 typ ${type} generation 0\r\n`;
  function make(policy,sdp,state='gathering') {
    const peer=new PeerLink({iceTransportPolicy:policy});
    const pc=new EventTarget();Object.assign(pc,{iceGatheringState:state,localDescription:{sdp},close(){}});peer._pc=pc;
    const original=peer._timer.bind(peer);peer._timer=(fn)=>original(fn,5);return peer;
  }
  for(const type of ['host','srflx','relay']){const peer=make('all',candidate(type));await peer._gather();assert.equal(peer.info.connected,false);assert.equal(peer._waiters.size,0);assert.equal(peer._timers.size,0);peer.close();}
  const missing=make('all','v=0\r\n');await assert.rejects(missing._gather(),/超时/);missing.close();
  const relayOnly=make('relay',candidate('host'));await assert.rejects(relayOnly._gather(),/超时/);relayOnly.close();
  const relay=make('relay',candidate('relay'));await relay._gather();assert.equal(relay.info.connected,false);relay.close();
  const completed=make('all','v=0\r\n','complete');await assert.rejects(completed._gather(),/没有可用/);completed.close();
  const closed=make('all',candidate('host'));const pending=closed._gather();closed.close();await assert.rejects(pending,/关闭/);assert.equal(closed._waiters.size,0);assert.equal(closed._timers.size,0);
});
