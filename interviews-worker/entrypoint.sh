#!/bin/bash
set -e
export DISPLAY=:99
export PULSE_SERVER=unix:/tmp/pulse-socket
Xvfb :99 -screen 0 1280x720x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
sleep 1
pulseaudio --exit-idle-time=-1 --disallow-exit -D \
  --load="module-native-protocol-unix socket=/tmp/pulse-socket auth-anonymous=1" \
  --load="module-null-sink sink_name=rec sink_properties=device.description=rec" >/tmp/pulse.log 2>&1 || true
sleep 1
pactl set-default-sink rec || true
exec node interviews-worker/worker.mjs
