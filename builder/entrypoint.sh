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

# Warm the Railpack base images (builder, runtime, frontend) and the default
# runtimes (node, python, go) into the BuildKit content store so the first
# build after a boot or after the cache volume was reset does not cold-pull
# them.
#
# The builder/runtime tags use a mise-<date> scheme pinned to the Railpack
# release, and the runtimes are installed by the `packages:mise` build step,
# so both are resolved by generating a real plan. We then run the same gateway
# build the service uses (server.mjs buildImage) on a tiny dummy project per
# runtime, with push=false, so the layers land in the local BuildKit cache.
#
# The mise step has no cache mounts: its BuildKit cache key is just the parent
# builder image + the generated /etc/mise/config.toml + the command. So these
# layers are reused by any later build that resolves the same runtime version,
# regardless of the per-deployment cache-key that namespaces the npm/apt cache
# mounts. A fresh `mise install` is only a few seconds anyway, so this is a
# small win that mainly avoids cold-pulling the base images; pinned runtimes
# still install their own version on first use and then stay cached.
#
# Runs in the background: when already cached these are fast no-ops.
warm_images() {
  local warm_dir="$HOME/warmup/runtimes"
  local frontend="ghcr.io/railwayapp/railpack-frontend:latest"
  local name

  mkdir -p "$warm_dir/node" "$warm_dir/python" "$warm_dir/go"

  # node: no version pin -> resolves to the default LTS unpinned apps get
  printf '%s\n' '{"name":"__warmup__","version":"1.0.0","scripts":{"start":"node index.js"}}' \
    > "$warm_dir/node/package.json"
  printf 'console.log("ok")\n' > "$warm_dir/node/index.js"

  # python: no version pin -> resolves to the default CPython
  printf 'flask==3.0.0\n' > "$warm_dir/python/requirements.txt"
  cat > "$warm_dir/python/app.py" <<'EOF'
from flask import Flask
app = Flask(__name__)

@app.route("/")
def hello():
    return "ok"
EOF

  # go: a common go.mod directive (mise resolves the matching go toolchain)
  cat > "$warm_dir/go/go.mod" <<'EOF'
module warmup

go 1.22
EOF
  printf 'package main\n\nfunc main() {}\n' > "$warm_dir/go/main.go"

  for name in node python go; do
    local dir="$warm_dir/$name"
    local plan="$dir/railpack-plan.json"
    echo "[entrypoint] warming runtime for $name"
    if ! railpack prepare "$dir" --plan-out "$plan" --info-out "$dir/railpack-info.json" >/dev/null 2>&1; then
      echo "[entrypoint] warmup: $name: railpack prepare failed; skipping" >&2
      continue
    fi
    buildctl --addr "$BUILDKIT_HOST" build \
      --local "context=$dir" \
      --local "dockerfile=$dir" \
      --frontend=gateway.v0 \
      --opt "source=$frontend" \
      --output "type=image,name=example.com/railpack-warmup/$name:latest,push=false,compression=gzip,compression-level=1" \
      >/dev/null 2>&1 \
      || echo "[entrypoint] warmup: $name gateway build did not finish (runtime layers may still be cached)" >&2
    echo "[entrypoint] warmup: $name done"
  done
  echo "[entrypoint] warmup complete"
}

warm_images >"$HOME/warmup.log" 2>&1 &

exec node /app/server.mjs
