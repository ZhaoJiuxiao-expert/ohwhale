# Friends v1 implementation contract

Scope: persistent friend identity, QR/public short code, mutual approval, explicit live chat invitation; no offline delivery or account recovery claims. Existing manual/owner flows stay under advanced options. Server never receives message bodies. Human mode only through friend calls; AI sharing remains separately authorized.

## Server JSON API

All routes `/v1/friends`, same public origin. Registration only after UI consent. Others require `Authorization: Bearer <256-bit device token>`. Strict JSON and rate limits. IDs are 32 lowercase hex; codes are `JW-XXXX-XXXX-XXXX` base32 (exclude ambiguous characters). QR plaintext `ohwhale:friend:v1:<CODE>` refers only to the app's configured origin; no credential or arbitrary URL.

- POST `/register` `{name}` => `{self:{id,code,name},token}`. Token hash stored server-side, raw credential encrypted in privileged local store.
- GET `/state` => `{self,contacts:[{id,code,name,online}],requests:{incoming:[{id,from:{id,code,name},createdAt}],outgoing:[{id,to:{id,code,name},createdAt}]},calls:[{id,peer:{id,code,name},direction:'incoming'|'outgoing',status:'ringing'|'accepted',expiresAt}]}`. This heartbeat updates presence. No call credentials in this list.
- POST `/request` `{code}` => `{ok:true}`. No self-request, duplicates idempotent, no automatic approval for crossing requests.
- POST `/respond` `{requestId,accept:boolean}` => `{ok:true}`; receiver only.
- POST `/block` `{friendId}` => `{ok:true}`; removes friendship/request/calls, blocks new inbound request until unblock (unblock may be later release).
- POST `/call` `{friendId}` => `{callId}`; accepted contacts only, online (<60s) required, one active call per device, short 120s TTL, human mode.
- POST `/respond-call` `{callId,accept:boolean}` => `{ok:true}`; receiver only, accepted creates an already-paired existing signaling room and independent host/guest capabilities.
- POST `/session` `{callId}` => `{serverUrl,host:boolean,room:{roomId,token,expiresAt,credentialExpiresAt,iceServers,mode:'human',policy:'all'},peer:{id,code,name}}`; only accepted call participants; idempotent in TTL.
- POST `/end-call` `{callId}` => `{ok:true}`; either participant, destroys associated signaling room. Friend graph remains.

Friend graph persisted server outside code with append-only snapshots/mode0600; load validates, corrupt latest fails closed. Presence/calls ephemeral. Bounded registrations/per-IP, pending requests, total identities, relationships; authentication timing safe, errors redact credentials.

## Privileged client API (window.ly)

`friendsStatus()` -> `{enabled:boolean,serverUrl,self?}` local only.
`friendsEnable({name,consent:true})` -> status; cannot silently replace existing identity. Uses default origin; injected test origin permitted only in service constructor.
`friendsState()` -> server state.
`friendsRequest({code})`, `friendsRespond({requestId,accept})`, `friendsBlock({friendId})`, `friendsCall({friendId})`, `friendsRespondCall({callId,accept})`, `friendsSession({callId})`, `friendsEndCall({callId})` match routes above.
No device credential returned to renderer/bootstrap/export/log. Electron safeStorage; Android KeyStore endpoint-bound handle via nativeFetch. Core service tests cover disk/public leakage, server-bound token, auth errors, registration opt-in and restart.

## Renderer integration (root owns App.jsx)

Separate `FriendsPanel.jsx` component owns QR/scan/add/request/contact UI; props `{onConnect(grant),onClose(),onAdvanced()}`. It polls friendsState while mounted, supports explicit accept/dismiss live invitations, calls friendsSession on accepted then onConnect. Root mounts it as default peer modal. Root adds passive request/call badge on existing peer entry and handles repeated friend sessions using persistent peer id `friend:<id>` rather than transport session id. Root adds `PublicPeerSession.startGranted(grant,{name})`.

QR must decode/validate only this format, show public code prior to requesting, not auto-send. Camera permission explicit, stop tracks on close/unmount, image picker fallback. Name entry, friendly copy, no owner token/server config on ordinary page. Tests must demonstrate QR roundtrip + full two-device register/request/accept/restart/call-scoped authorization. Tests use isolated data; never personal conversations.
