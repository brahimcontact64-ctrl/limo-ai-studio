# LIMO render worker image. Build from the app folder (it needs lib/images and lib/video):
#   docker build -f worker/Dockerfile -t limo-render-worker .
# Run with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from a secret store (never bake them into the image).
FROM node:24-bookworm-slim

# Distribution FFmpeg (H.264/AAC) and fonts with Latin + Arabic coverage for text overlays.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-noto-core fonts-dejavu-core ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/app
COPY worker/package.json worker/package-lock.json worker/
# --ignore-scripts: the bundled static FFmpeg is not needed here (FFMPEG_PATH points at the system one).
RUN cd worker && npm ci --omit=dev --ignore-scripts
COPY lib/images lib/images
COPY lib/video lib/video
COPY worker/src worker/src

ENV FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe \
    RENDER_TMP=/tmp/limo-render \
    NODE_ENV=production \
    HEALTH_PORT=8080 \
    HEALTH_HOST=0.0.0.0
EXPOSE 8080
USER node
# /livez: the main loop or a running job's heartbeat ticked recently (restart when it stops).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/livez').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "worker/src/index.ts"]
