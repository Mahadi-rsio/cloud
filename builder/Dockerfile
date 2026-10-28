# Cloudisy build worker image.
#
# One build at a time, isolated on a dedicated Fly machine. BuildKit runs
# rootless (no privileged container, no host Docker socket). The service talks
# to BuildKit with `buildctl`; set BUILDKIT_HOST to point at an external
# BuildKit if you prefer to run the daemon separately.

FROM node:22-bookworm-slim

ARG RAILPACK_VERSION=0.43.0
ARG BUILDKIT_VERSION=v0.17.2

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    fuse-overlayfs \
    git \
    iptables \
    tar \
    uidmap \
    xz-utils \
  && rm -rf /var/lib/apt/lists/*

# Railpack (plan generation only — builds go through the BuildKit frontend).
RUN curl -fsSL "https://github.com/railwayapp/railpack/releases/download/v${RAILPACK_VERSION}/railpack-v${RAILPACK_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
    | tar -xz -C /usr/local/bin railpack \
  && chmod +x /usr/local/bin/railpack

# BuildKit daemon + client. The release archive's top-level dir is `bin/`, so
# extracting into /usr/local (no strip) lands binaries at /usr/local/bin/.
RUN curl -fsSL "https://github.com/moby/buildkit/releases/download/${BUILDKIT_VERSION}/buildkit-${BUILDKIT_VERSION}.linux-amd64.tar.gz" \
    -o /tmp/buildkit.tar.gz \
  && tar -xzf /tmp/buildkit.tar.gz -C /usr/local \
  && rm -f /tmp/buildkit.tar.gz \
  && chmod +x /usr/local/bin/buildkitd /usr/local/bin/buildctl

# uid/gid 1000 is taken by the base image's `node` user; use 1001 instead.
RUN groupadd -g 1001 builder \
  && useradd -u 1001 -g 1001 -m -s /bin/bash builder

WORKDIR /app
COPY builder/server.mjs /app/server.mjs
COPY builder/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh && chown -R builder:builder /app

# Run as root on the dedicated, ephemeral build VM so buildkitd can access
# /dev/fuse and use the FUSE overlay snapshotter without a user namespace.
USER root

ENV NODE_ENV=production \
    PORT=8080 \
    BUILD_WORKSPACE_DIR=/home/builder/builds \
    XDG_RUNTIME_DIR=/home/builder/.run \
    BUILDKIT_HOST=unix:///home/builder/.run/buildkit/buildkitd.sock \
    ENABLE_BUILDKITD=1

EXPOSE 8080

ENTRYPOINT ["/app/entrypoint.sh"]
