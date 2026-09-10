# A machine that has never seen colai.
#
# The point of this image is what it does NOT contain: no Rust, no GTK headers, no cargo
# cache, and no OpenClaw checkout. It installs a released `openclaw` from npm rather than
# the fork this plugin was cut from, because the toolbar carries a copied Gateway client
# and testing it only against its own source is exactly the blind spot that copy has.
#
# There is no display in here. This proves packaging, the pre-flight checks, the build,
# and install and uninstall — not that the overlay draws. `fresh-install.sh --display`
# passes this desktop's X socket through for that last mile.
FROM debian:trixie-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates curl xz-utils git python3 build-essential pkg-config \
  && rm -rf /var/lib/apt/lists/*

# Node from nodejs.org rather than apt, so the version is the one OpenClaw asks for and
# not whatever Debian happens to carry.
ARG NODE_VERSION=22.23.2
RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
    | tar -xJ -C /usr/local --strip-components=1 \
  && node --version

# A released OpenClaw, pinned. Not the fork.
ARG OPENCLAW_VERSION=2026.9.1
RUN npm install -g "openclaw@${OPENCLAW_VERSION}" && openclaw --version

# Everything the toolbar needs to compile, installed here so a variant can take it away
# again rather than having to add it. `--variant no-headers` uninstalls these; `--variant
# no-rust` skips rustup below.
ARG WITH_HEADERS=1
RUN if [ "$WITH_HEADERS" = "1" ]; then \
      apt-get update \
      && apt-get install -y --no-install-recommends \
        libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev libayatana-appindicator3-dev librsvg2-dev \
      && rm -rf /var/lib/apt/lists/*; \
    fi

ARG WITH_RUST=1
ARG RUST_VERSION=1.97.1
RUN if [ "$WITH_RUST" = "1" ]; then \
      curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
        | sh -s -- -y --profile minimal --default-toolchain "$RUST_VERSION"; \
    fi
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /work
