# syntax=docker/dockerfile:1
FROM ubuntu:24.04@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852 AS prepared
ARG TARGETARCH
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 TZ=UTC PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Keep the Ubuntu/Node/Playwright versions shared by CI and local development.
# Install only the Chromium headless shell used by every visual project.
RUN --mount=type=secret,id=proxy_ca,mode=0444 \
    set -eu; \
    [ "$TARGETARCH" = amd64 ] || { echo "Only linux/amd64 is supported" >&2; exit 1; }; \
    if [ -f /run/secrets/proxy_ca ]; then \
        export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca CURL_CA_BUNDLE=/run/secrets/proxy_ca; \
        printf 'Acquire::https::CaInfo "/run/secrets/proxy_ca";\n' > /tmp/apt-proxy-ca.conf; \
        export APT_CONFIG=/tmp/apt-proxy-ca.conf; \
    fi; \
    apt-get update; \
    apt-get install -y --no-install-recommends build-essential git ca-certificates curl xz-utils fonts-noto-cjk fonts-noto-color-emoji; \
    curl --fail --show-error --location --retry 2 "https://nodejs.org/dist/v24.20.0/node-v24.20.0-linux-x64.tar.xz" -o /tmp/node.tar.xz; \
    printf '2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2  /tmp/node.tar.xz\n' | sha256sum --check; \
    tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1; \
    npm install --global pnpm@10.33.2; \
    npm exec --yes --package=playwright@1.63.0 -- playwright install --with-deps --only-shell chromium; \
    chmod -R a+rX /ms-playwright; \
    fc-cache -f; \
    node --version; \
    pnpm --version; \
    rm -rf /var/lib/apt/lists/* /root/.npm /tmp/*

# A single filesystem layer avoids copying seven parent filesystems under vfs.
FROM scratch
COPY --from=prepared / /
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 TZ=UTC PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
CMD ["/bin/bash"]
