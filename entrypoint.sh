#!/bin/sh
# Runs at container start. Persists the OpenAI API key into ~/.codex/auth.json
# so the Codex CLI authenticates in api-key mode (the alternative is the
# WebSocket "responses" endpoint, which is ChatGPT-login-only and returns 401
# without an Authorization header).
set -e

if [ -n "$OPENAI_API_KEY" ]; then
  # Codex CLI v0.131+ removed `--api-key VALUE` in favor of reading from stdin.
  if printf '%s' "$OPENAI_API_KEY" | codex login --with-api-key 2>&1; then
    echo "[entrypoint] codex login OK"
  else
    echo "[entrypoint] codex login FAILED with exit $? — /api/sketch/analyze will 401"
  fi
else
  echo "[entrypoint] WARN: OPENAI_API_KEY is not set — /api/sketch/analyze will fail"
fi

exec "$@"
