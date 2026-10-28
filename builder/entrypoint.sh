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

# Warm the Railpack base images (builder, runtime, frontend) into the BuildKit
# content store so the first build after a boot or after the cache volume was
# reset does not cold-pull them. The builder/runtime tags use a mise-<date>
# scheme pinned to the Railpack release, so we resolve them from a real plan.
# Runs in the background: when the images are already cached this is a fast
# no-op, and when they are not it performs the pull the first build would have
# done anyway.
warm_base_images() {
  local warm_dir="$HOME/warmup"
  local plan="$warm_dir/plan.json"
  local ref refs

  mkdir -p "$warm_dir/ctx" "$warm_dir/df"
  printf '{"name":"__warmup__","version":"1.0.0","engines":{"node":">=20"}}\n' > "$warm_dir/package.json"

  if ! railpack prepare "$warm_dir" --plan-out "$plan" --info-out "$warm_dir/info.json" >/dev/null 2>&1; then
    echo "[entrypoint] warmup: could not generate railpack plan; skipping base image warmup" >&2
    return 0
  fi

  refs="$( { grep -o 'ghcr.io/railwayapp/[a-z-]*:[^"]*' "$plan" || true; echo 'ghcr.io/railwayapp/railpack-frontend:latest'; } | sort -u )"

  echo "[entrypoint] warming base images into BuildKit cache:"
  for ref in $refs; do
    echo "  - $ref"
    printf 'FROM %s\n' "$ref" > "$warm_dir/df/Dockerfile"
    buildctl --addr "$BUILDKIT_HOST" build \
      --frontend dockerfile.v0 \
      --local context="$warm_dir/ctx" \
      --local dockerfile="$warm_dir/df" \
      --output "type=image,name=$ref,push=false" >/dev/null 2>&1 \
      || echo "[entrypoint] warmup: failed to warm $ref" >&2
  done
  echo "[entrypoint] base image warmup complete"
}

warm_base_images >"$HOME/warmup.log" 2>&1 &

exec node /app/server.mjs
