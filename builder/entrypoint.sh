#!/bin/sh
set -eu

mkdir -p "$BUILD_WORKSPACE_DIR" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

if [ "${ENABLE_BUILDKITD:-1}" = "1" ]; then
  echo "[entrypoint] starting rootless buildkitd"
  buildkitd \
    --root "$HOME/.local/share/buildkit" \
    --addr "$BUILDKIT_HOST" \
    --oci-worker-no-process-sandbox \
    >"$HOME/buildkitd.log" 2>&1 &

  ready=0
  for _ in $(seq 1 30); do
    if buildctl --addr "$BUILDKIT_HOST" debug workers >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 1
  done

  if [ "$ready" != "1" ]; then
    echo "[entrypoint] buildkitd did not become ready; see $HOME/buildkitd.log" >&2
    tail -n 50 "$HOME/buildkitd.log" >&2 || true
  fi
fi

exec node /app/server.mjs
