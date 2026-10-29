# Railpack builder image with commonly used runtimes preinstalled.
#
# Railpack's `packages:mise` build step starts from this image and runs
# `mise install` (mise_step_builder.go); the `install_bin` helper used by the
# staticfile/node-SPA providers starts from it too (install_bin_builder.go).
# Only Node.js and Python are baked in. Apps resolve their runtime versions
# through `mise` (node default "lts", python "3.13"), so the image bakes those
# defaults plus the previous LTS/minor so the normal `mise install` step is a
# no-op. Any other runtime (Go, Ruby, etc.) is installed on demand by
# `mise install` during the build — no special handling needed.
#
# The worker (server.mjs) rewrites every generated build plan to point at this
# image instead of ghcr.io/railwayapp/railpack-builder:<tag> and appends
# `mise prune --yes` after `mise install`. Pruning against the app's
# /etc/mise/config.toml keeps unneeded runtimes out of the deploy image, which
# matters because node/python plans copy the whole /mise/installs tree into
# their deploy layers.
#
# Base image: ghcr.io/railwayapp/railpack-builder:mise-2026.10.14 (the tag
# pinned by the Railpack release we ship). Keep this version aligned with the
# Railpack release the worker installs.

FROM ghcr.io/railwayapp/railpack-builder:mise-2026.10.14

# Bake the runtimes every app type in this workspace is likely to pin:
#   node   <lts>    -> 24.22.0   (also keep the previous LTS, 22.x)
#   python <3.13>   -> 3.13.16   (also keep the previous minor, 3.12.x)
#
# Versions are pinned explicitly so this image is reproducible, and `mise
# install <tool>@<version>` ignores whatever /etc/mise/config.toml an app
# later lands in the image (there is none at build time).
#
# Environment inherited from the base image:
#   MISE_DATA_DIR=/mise  MISE_CONFIG_DIR=/mise  MISE_CACHE_DIR=/mise/cache
#   MISE_INSTALL_PATH=/usr/local/bin/mise  PATH=/mise/shims:...
# so installs land under /mise/installs (what the plan copies to deploy).
RUN set -eu \
  && mise install node@22.23.3 \
  && mise install node@24.22.0 \
  && mise install python@3.12.15 \
  && mise install python@3.13.16 \
  && mise reshim

# Record what was baked for debugging, and let the plan rewrite verify at a
# glance that the image matches the base we pinned above.
RUN /usr/local/bin/mise ls --json \
  > /etc/baked-runtimes.json \
  && printf 'base-image: ghcr.io/railwayapp/railpack-builder:mise-2026.10.14\n' \
  > /etc/baked-runtimes.txt

# Smoke-test that the baked runtimes resolve through the shims (this is what
# the build steps actually invoke) before the image leaves the builder.
# Each build plan rewrites /etc/mise/config.toml to request the app's version,
# and a shim only activates what a config file requests, so this activates
# every baked version one at a time the way a plan will, then removes the file.
RUN set -eu \
  && mkdir -p /etc/mise \
  && for spec in node@22.23.3 node@24.22.0 python@3.12.15 python@3.13.16; do \
       tool="${spec%@*}"; ver="${spec#*@}"; \
       printf '[tools]\n  %s = "%s"\n' "$tool" "$ver" > /etc/mise/config.toml; \
       case "$tool" in \
         node)   [ "$(node --version)" = "v$ver" ] ;; \
         python) [ "$(python3 --version)" = "Python $ver" ] ;; \
       esac \
         || { echo "smoke test failed for $spec"; exit 1; }; \
     done \
  && rm -rf /etc/mise \
  && printf 'baked runtimes ok\n'
