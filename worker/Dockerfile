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
    NODE_ENV=production
USER node
CMD ["node", "worker/src/index.ts"]
