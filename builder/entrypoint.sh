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

# BuildKit and the Railpack gateway read registry credentials from the root
# user's Docker config during pulls, so write it before the first warmup build
# (the service also rewrites it before real builds).
if [ -n "${OCI_REGISTRY-}" ] && [ -n "${OCI_REGISTRY_USERNAME-}" ] && [ -n "${OCI_REGISTRY_PASSWORD-}" ]; then
  mkdir -p "$HOME/.docker"
  auth="$(printf '%s:%s' "$OCI_REGISTRY_USERNAME" "$OCI_REGISTRY_PASSWORD" | base64)"
  host="$(printf '%s' "$OCI_REGISTRY" | cut -d/ -f1)"
  printf '{"auths":{"%s":{"auth":"%s"}}}\n' "$host" "$auth" > "$HOME/.docker/config.json"
  chmod 600 "$HOME/.docker/config.json"
fi

# Warm the Railpack base images into the BuildKit content store so a build
# after a boot does not cold-pull them.
#
# There is no persistent volume anymore: the default runtimes are baked into
# our custom builder image (builder/railpack/Dockerfile), so the only images to
# pre-pull are that builder image (with the runtimes already installed), the
# Railpack runtime image, and the gateway frontend. BuildKit has no image-pull
# command, so we import each base image with a trivial `FROM` build through the
# built-in dockerfile.v0 frontend; the layers land in the local BuildKit cache.
#
# Runs in the background: when already cached these are fast no-ops.
warm_images() {
  local warm_dir="$HOME/warmup/base"
  local image

  mkdir -p "$warm_dir"

  for image in \
    "${RAILPACK_BUILDER_IMAGE:-ghcr.io/railwayapp/railpack-builder:mise-2026.10.14}" \
    "${RAILPACK_RUNTIME_IMAGE:-ghcr.io/railwayapp/railpack-runtime:mise-2026.10.14}" \
    "${RAILPACK_FRONTEND_IMAGE:-ghcr.io/railwayapp/railpack-frontend}:latest"; do
    printf 'FROM %s\n' "$image" > "$warm_dir/Dockerfile"
    echo "[entrypoint] warming base image $image"
    buildctl --addr "$BUILDKIT_HOST" build \
      --local "context=$warm_dir" \
      --local "dockerfile=$warm_dir" \
      --frontend=dockerfile.v0 \
      --output "type=image,name=example.com/railpack-warmup/base:latest,push=false,compression=gzip,compression-level=1" \
      >/dev/null 2>&1 \
      || echo "[entrypoint] warmup: $image did not finish (layers may still be cached)" >&2
    echo "[entrypoint] warmup: $image done"
  done
  echo "[entrypoint] warmup complete"
}

warm_images >"$HOME/warmup.log" 2>&1 &

exec node /app/server.mjs
