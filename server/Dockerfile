FROM node:24-alpine
WORKDIR /app
COPY --chmod=0644 server/signaling.cjs server/friends.cjs server/groups.cjs server/moments.cjs server/managed-ai.cjs server/managed-models.json server/check.html server/check.js server/terms.html ./server/
COPY --chmod=0644 src/p2p/network.js src/p2p/peer.js ./src/p2p/
RUN chmod 0755 /app /app/server /app/src /app/src/p2p
USER node
CMD ["node", "server/signaling.cjs"]
