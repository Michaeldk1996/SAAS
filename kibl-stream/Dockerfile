# TEN-270 (founder 2026-09-24T01:21Z, build authorised): this image now runs the
# Kibl stream -> live "Now" worker, now_worker.py. Deployed by
# .github/workflows/ten270-stream-now.yml (action deploy-worker) once a Fly
# token exists; it was never deployed before.
#
# Python, not Node (founder ruling 2026-09-23). The Node image pinned its major
# because `py_str.mjs` needed JSON.parse source-text access and the worker would
# refuse to start below Node 21. That constraint is GONE: the row key now comes
# from the sweep's own Python function, so there is no cross-language lexeme to
# preserve and no runtime floor to defend.
#
# ⚠️ BUILD CONTEXT IS THE REPO ROOT, NOT THIS DIRECTORY:
#     fly deploy --dockerfile kibl-stream/Dockerfile --config kibl-stream/fly.toml .
# because the COPY below reaches archive-kibl.py and kibl_client.py, which live
# at the root. Building from inside kibl-stream/ fails on that COPY — loudly,
# which is the right failure.
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1

# pika pinned, not floated. This worker's whole value is being connected when
# nobody is looking; a surprise minor on an always-on process is the kind of
# thing that gets discovered by a gap in the archive rather than by a build log.
RUN pip install --no-cache-dir 'pika==1.3.2'

# ⚠️ THE SWEEP AND THE CLIENT ARE COPIED IN ON PURPOSE. consumer.py imports the
# sweep's own row_key_of() / to_summary() through sweep_bridge.py rather than
# reimplementing them — that is the ruling this port exists to satisfy — so an
# image without them is an image that cannot key a row. If this COPY is ever
# trimmed to "just the worker", the worker stops starting. That is the correct
# failure, and the wrong fix is to copy the functions in beside it.
# ten225_names.py too: archive-kibl.py imports it at module level, so the
# TEN-253 image (which omitted it) could not have started at all.
COPY archive-kibl.py kibl_client.py ten225_names.py ./
COPY kibl-stream/sweep_bridge.py kibl-stream/consumer.py kibl-stream/card_join.py \
     kibl-stream/now_worker.py ./kibl-stream/

# No healthcheck here on purpose. Liveness for this worker is NOT "is the
# process up" — a process can be up with a dead channel, which is the failure
# the founder named. The real check reads kibl_stream_heartbeat; a container
# healthcheck that passes on a silent worker would actively mislead.
CMD ["python3", "kibl-stream/now_worker.py"]
