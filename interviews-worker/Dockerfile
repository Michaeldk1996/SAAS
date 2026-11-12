FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium ffmpeg xvfb pulseaudio pulseaudio-utils \
      python3 python3-pip python3-venv ca-certificates fonts-liberation \
  && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir faster-whisper
ENV PATH=/opt/venv/bin:$PATH CHROME_BIN=/usr/bin/chromium PULSE_SERVER=unix:/tmp/pulse-socket
WORKDIR /app
COPY . ./interviews-worker
RUN chmod +x interviews-worker/entrypoint.sh
CMD ["interviews-worker/entrypoint.sh"]
