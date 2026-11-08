# Cloud moments contract (1.5.0)

User requests an opt-in all-users-visible feed with likes/comments. Existing PluginStore posts are local and stay local, with no automatic migration/upload. Public means all registered OhWhale identities, not anonymous browser access. Cloud authors are real registered identities; AI-generated local drafts can be reviewed and deliberately published by the user, never automatically broadcast. Group and private chat remain separate.

## Service

Independent `server/moments.cjs`, `MOMENTS_DATA_DIR`, existing Friends authentication and accepted friendship/block graph. AES-256-GCM append-only encrypted delta journal and private assets, same bounded store principles as groups. Never delete files; tombstone operations hide content while retaining encrypted history. Service limits and precise friendly errors; no model calls.

All POST `/v1/moments/<route>` Bearer, strict fields and limits:

- `feed {scope:'public'|'friends'|'mine',beforeSeq?}` -> `{self,posts,hasMore,latestSeq}` newest first, <=30.
- `get {postId,beforeCommentSeq?}` -> `{post,comments,hasMore}` <=50 comments. Initial comment page newest, returned chronological.
- `publish {clientId,text,visibility:'public'|'friends',consent:true,attachments:[]}` -> `{post}`; author scoped idempotency, mismatching reuse rejected. text<=4000, at least text or attachment.
- `visibility {postId,visibility:'public'|'friends',consent:true}` -> `{post}`; only author. Recheck every subsequent read/interaction/asset. Explicit consent to expansion, UI explains reduction cannot retract already seen or saved copies.
- `like {postId,liked:boolean}` -> `{post}`; set/unset, one like per identity, retry safe.
- `comment {postId,clientId,text}` -> `{comment}`; <=1000 text, author scoped idempotency.
- `delete-post {postId}` -> `{ok:true}` only author; tombstone.
- `delete-comment {postId,commentId}` -> `{ok:true}` comment author OR post author for moderation; tombstone. UI labels hide/remove, does not promise physical deletion.
- `asset {postId,assetId}` -> `{dataUrl}`; no direct public asset URLs. Only member-authorized retrieval; return image assets only in v1, PNG/JPEG/GIF/WebP <=512KiB each, max2, request<=3MiB. Strict actual magic/mime/base64.

Post `{id,seq,author:{id,name},text,attachments:[{id,type:'image',mime,name,bytes}],visibility,createdAt,updatedAt,deleted,likeCount,liked,commentCount}`. Comment `{id,seq,postId,author:{id,name},text,createdAt,deleted}`. IDs32hex; times ms; seq global posts or per-post comments monotonic.

Own content readable by author. Friend scope feed includes own and current accepted-friend posts (public or friends visibility). Public scope includes public posts only; mine includes own visible posts. Blocked pairs cannot read/like/comment each other's content even public. Every action/asset rechecks current parent post visibility, friendship and block. Post hidden means no comment/asset access. Unknown/nonvisible returns generic not found. No private lists of likers exported; only count/current self liked. Cap feeds/comments, quotas and media. Default storage128MiB/revisions20000, posts5000, comments perpost500, likes perpost2000 unless implementation demonstrates safer bounds. Reject explicit capacity, never silently purge.

## Client bridge

Independent `src/core/moments-client.cjs` exports `MomentsClient` + `MOMENTS_METHODS` mapping: `momentsStatus`/status, `momentsFeed`/feed, `momentsGet`/get, `momentsPublish`/publish, `momentsVisibility`/visibility, `momentsLike`/like, `momentsComment`/comment, `momentsDeletePost`/deletePost, `momentsDeleteComment`/deleteComment, `momentsAsset`/asset. Input mirrors service, except publish attachments are existing privileged local media references. Client validates size before transmission. No new private identity/memory/provider fields.

`FriendsClient.momentsRequest` strict route allowlist; Android `momentsHttpStart` scoped exact existing HTTPS origin and POST allowlist, vault handle with existing friend purpose. No raw key in WebView. Desktop/mobile construct singleton, explicit methods in preload/dispatch; no background publish/poll worker. `moments-changed` optional event. All credentials and generated state stay in existing user data location, never code/export.

## UI ownership

Root will rename existing App-local `SpacePanel` to `LocalSpacePanel` and wrap with new `MomentsWorkspace` component, passing local panel as children. New component receives `{state,runtime,run,toast,onOpenFriends,active,children}` and owns tabs 本机/好友/公开/我的发布. Default 本机; never autoupload existing posts. Cloud feed with author/visibility/time/image, like and comments, explicit publish composer with selection friends/public and consent. Member without enabled friends identity gets friendly link to enable existing friends service. Ownership controls for change visibility/hide post; comment removal self or post owner. Explain 公共动态对所有已注册鲸友开放. Explain cloud storage and no recall of received copies. Safe per-request errors, deliberate retry with same clientId, no duplicate comment/post. No hidden paid AI interaction.

## Verification

Real HTTP three synthetic identities with accepted friends and stranger: friends visibility, public discoverability, toggle private immediate access/asset revocation, block isolation, like concurrency/idempotence, comment ownership/post owner moderation, tombstone, store restart encrypted bytes. UI desktop/mobile synthetic acceptance, no private data or real paid model. Root integrates/reviews/builds/deploys; agents do not publish/deploy.
