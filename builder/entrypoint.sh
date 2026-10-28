#!/bin/sh
set -eu

BUILDKIT_ROOT="${BUILDKIT_ROOT:-$HOME/.local/share/buildkit}"

mkdir -p "$BUILD_WORKSPACE_DIR" "$XDG_RUNTIME_DIR" "$BUILDKIT_ROOT" "$(dirname "${BUILDKIT_HOST#unix://}")"
chmod 700 "$XDG_RUNTIME_DIR"

if [ "${ENABLE_BUILDKITD:-1}" = "1" ]; then
  echo "[entrypoint] starting buildkitd (fuse-overlayfs snapshotter, root $BUILDKIT_ROOT)"
  # This is a dedicated, ephemeral build VM, so buildkitd runs as root and uses
  # the FUSE overlay snapshotter: it avoids copying every layer (which exhausts
  # the small root disk and is very slow) and does not require a user namespace.
  buildkitd \
    --root "$BUILDKIT_ROOT" \
    --addr "$BUILDKIT_HOST" \
    --oci-worker-snapshotter fuse-overlayfs \
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
