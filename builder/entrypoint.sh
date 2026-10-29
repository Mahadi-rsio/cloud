#!/bin/sh
set -eu

BUILDKIT_ROOT="${BUILDKIT_ROOT:-$HOME/.local/share/buildkit}"

mkdir -p "$BUILD_WORKSPACE_DIR" "$XDG_RUNTIME_DIR" "$BUILDKIT_ROOT" "$(dirname "${BUILDKIT_HOST#unix://}")"
chmod 700 "$XDG_RUNTIME_DIR"

if [ "${ENABLE_BUILDKITD:-1}" = "1" ]; then
  snapshotter="${BUILDKIT_SNAPSHOTTER:-fuse-overlayfs}"
  echo "[entrypoint] starting buildkitd ($snapshotter snapshotter, root $BUILDKIT_ROOT)"

  # This is a dedicated build VM, so buildkitd runs as root and uses the FUSE
  # overlay snapshotter by default: it avoids copying every layer (which
  # exhausts the small root disk and is very slow) and does not require a user
  # namespace. Set BUILDKIT_SNAPSHOTTER=overlayfs to test the native snapshotter
  # on a single build.
  #
  # The root is the buildkit_cache volume, so base images survive stop/start.
  # GC keeps total usage within the 9 GB volume (7.5 GB budget).
  start_buildkitd() {
    buildkitd \
      --root "$BUILDKIT_ROOT" \
      --addr "$BUILDKIT_HOST" \
      --oci-worker-snapshotter "$snapshotter" \
      --oci-worker-gc=true \
      --oci-worker-gc-keepstorage=7500 \
      >>"$HOME/buildkitd.log" 2>&1 &
    buildkitd_pid=$!
  }

  wait_for_buildkit() {
    for _ in $(seq 1 30); do
      if buildctl --addr "$BUILDKIT_HOST" debug workers >/dev/null 2>&1; then
        return 0
      fi
      sleep 1
    done
    return 1
  }

  start_buildkitd
  if ! wait_for_buildkit; then
    # A crash can leave the on-volume content store corrupt. Wipe it once and
    # retry so a bad cache does not keep the builder permanently down.
    echo "[entrypoint] buildkitd did not become ready; wiping $BUILDKIT_ROOT and retrying once (cache may be corrupt)" >&2
    tail -n 50 "$HOME/buildkitd.log" >&2 || true
    kill "$buildkitd_pid" 2>/dev/null || true
    wait "$buildkitd_pid" 2>/dev/null || true
    rm -rf "${BUILDKIT_ROOT:?}"/* 2>/dev/null || true
    start_buildkitd
    if ! wait_for_buildkit; then
      echo "[entrypoint] buildkitd still not ready after wipe; see $HOME/buildkitd.log" >&2
      tail -n 50 "$HOME/buildkitd.log" >&2 || true
    fi
  fi
fi

# BuildKit and the Railpack gateway read registry credentials from the root
# user's Docker config during pulls, so write it before the first warmup build
# (the service also rewrites it before real builds).
if [ -n "${OCI_REGISTRY-}" ] && [ -n "${OCI_REGISTRY_USERNAME-}" ] && [ -n "${OCI_REGISTRY_PASSWORD-}" ]; then
  mkdir -p "$HOME/.docker"
  # BusyBox base64 wraps at 76 columns; the wrapped newline would be an invalid
  # escape in the JSON string, so collapse it to a single line.
  auth="$(printf '%s:%s' "$OCI_REGISTRY_USERNAME" "$OCI_REGISTRY_PASSWORD" | base64 | tr -d '\n')"
  host="$(printf '%s' "$OCI_REGISTRY" | cut -d/ -f1)"
  printf '{"auths":{"%s":{"auth":"%s"}}}\n' "$host" "$auth" > "$HOME/.docker/config.json"
  chmod 600 "$HOME/.docker/config.json"
fi

# Warm the Railpack base images into the BuildKit content store so a build
# after a boot does not cold-pull them.
#
# BuildKit's root is the buildkit_cache volume, so after the first boot these
# imports are cheap no-ops: only base images and generic OS layers persist. The
# default runtimes are baked into our custom builder image
# (builder/railpack/Dockerfile), so the images to pre-pull are that builder
# image (runtimes already installed), the Railpack runtime image, and the
# gateway frontend. BuildKit has no image-pull command, so we import each base
# image with a trivial `FROM` build through the built-in dockerfile.v0 frontend;
# the layers land in the persistent BuildKit cache.
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
