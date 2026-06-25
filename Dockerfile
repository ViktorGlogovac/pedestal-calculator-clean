# Backend image for the sketch-analysis API (Express + Sharp + Tesseract +
# Python/OpenCV + OpenAI Codex CLI). Built for Cloud Run on linux/amd64.

FROM node:22-bookworm-slim

# System deps:
#   python3 + python3-opencv + python3-numpy   for server/utils/cv_ops.py
#   ca-certificates                            for outbound HTTPS (OpenAI)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-numpy \
    python3-opencv \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Codex CLI is spawned as a child process from server/pipeline/codexCli.js.
# Installing globally puts the `codex` binary on PATH. Pin to the local
# production-tested CLI version so Cloud Run does not drift on rebuilds.
RUN npm install -g @openai/codex@0.141.0

# Install npm deps first so this layer caches across code changes.
# --legacy-peer-deps: matches local install; bypasses react-canvas-draw's React
# 16/17 peer pin even though the project uses React 18 (server doesn't use it).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund --legacy-peer-deps

# Only the server runs in this image — the React frontend is served by
# Firebase Hosting, not from here.
COPY server ./server

ENV NODE_ENV=production
# Cloud Run injects PORT at runtime; default to 8080 for local docker run.
ENV PORT=8080
EXPOSE 8080

# Entrypoint runs `codex login --api-key $OPENAI_API_KEY` at container start so
# the Codex CLI uses API-key auth instead of falling back to ChatGPT-login mode
# (which 401s in a headless environment).
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "server/index.js"]
