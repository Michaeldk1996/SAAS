# TEN-225 item 2 — NOT DEPLOYED. Here so that "we only add credentials" is true.
#
# Node 22, not `node:latest`: py_str.mjs needs JSON.parse source-text access
# (Node >= 21) and the worker REFUSES TO START without it. Pinning the major is
# what stops a base-image bump silently taking the worker below that line —
# where it would not degrade, it would stop, which is the behaviour we want but
# not the way we want to discover it.
FROM node:22-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY py_str.mjs consumer.mjs ./

# No healthcheck here on purpose. Liveness for this worker is NOT "is the
# process up" — a process can be up with a dead channel, which is the failure
# the founder named. The real check reads kibl_stream_heartbeat; a container
# healthcheck that passes on a silent worker would actively mislead.
CMD ["node", "consumer.mjs"]
