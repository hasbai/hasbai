import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const image = 'hasbai-cloud-dev:pw1.63.0-node24-pnpm10.33.2-amd64-v1';
// Both manifests belong to the same official Playwright v1.63.0-noble release.
const armBase = 'FROM --platform=linux/arm64 mcr.microsoft.com/playwright@sha256:a0f4498920a5dbac63196d9140ed738ef00470f27e2e74029abd8850b7bd5717';
const amdBase = 'FROM --platform=linux/amd64 mcr.microsoft.com/playwright@sha256:bc6ab0d6d44ff4826e4cb8c1e6d801e185bfc42bb0753f8e2a30efc70db054c7';
const source = readFileSync(new URL('../docker/visual-ci/Dockerfile', import.meta.url), 'utf8');
if (!source.startsWith(armBase + '\n')) throw new Error('CI base changed; pin the matching amd64 manifest in scripts/cloud-dev.mjs.');
// Reuse every CI installation step. The session CA exists only during this RUN.
const dockerfile = '# syntax=docker/dockerfile:1\n' + source.replace(armBase, amdBase)
  .replace('/ ARM64.', '/ AMD64.')
  .replace('RUN apt-get update', `RUN --mount=type=secret,id=proxy_ca,mode=0444 \\
    if [ -f /run/secrets/proxy_ca ]; then \\
        export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; \\
        printf 'Acquire::https::CaInfo "/run/secrets/proxy_ca";\\n' > /tmp/cloud-dev-apt.conf; \\
        export APT_CONFIG=/tmp/cloud-dev-apt.conf; \\
    fi \\
    && apt-get update`)
  .trimEnd() + ' \\\n    && rm -f /tmp/cloud-dev-apt.conf\n';
const fingerprint = createHash('sha256').update(dockerfile).digest('hex');
const label = 'xyz.hasbai.cloud-dev.source';
const ca = process.env.CODEX_PROXY_CERT
  ? (existsSync('/etc/ssl/certs/ca-certificates.crt') ? '/etc/ssl/certs/ca-certificates.crt' : process.env.CODEX_PROXY_CERT)
  : null;
const invoke = (args, options = {}) => spawnSync('docker', args, { cwd: repo, stdio: 'inherit', ...options });
function build() {
  console.log('Building local-only ' + image);
  const result = invoke(['build', '--platform', 'linux/amd64', '--file', '-', '--tag', image,
    '--label', `${label}=${fingerprint}`, ...(ca ? ['--secret', `id=proxy_ca,src=${ca}`] : []),
    'docker/visual-ci'], { input: dockerfile, stdio: ['pipe', 'inherit', 'inherit'] });
  if (result.error || result.status !== 0) throw new Error('Cloud development image build failed.');
}

try {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('This local development entry requires Linux x86_64.');
  const [action, ...args] = process.argv.slice(2);
  if (action === 'build' && !args.length) build();
  else if (action === 'run') {
    const ports = [];
    while (args[0] === '--publish') {
      args.shift();
      if (!args[0]) throw new Error('--publish requires a Docker port mapping.');
      ports.push('--publish', args.shift());
    }
    if (args[0] === '--') args.shift();
    const installed = invoke(['image', 'inspect', '--format', `{{.Architecture}} {{index .Config.Labels "${label}"}}`, image],
      { encoding: 'utf8', stdio: 'pipe' });
    if (installed.status !== 0 || installed.stdout.trim() !== `amd64 ${fingerprint}`) build();
    const store = join(repo, '.local-visual', 'cloud-dev-pnpm-store');
    mkdirSync(store, { recursive: true });
    const result = invoke(['run', '--rm', '--init', '--ipc=host', '--platform', 'linux/amd64',
      '--user', `${process.getuid()}:${process.getgid()}`,
      ...(process.stdin.isTTY ? ['--interactive'] : []), ...(process.stdout.isTTY ? ['--tty'] : []),
      ...ports, '--mount', `type=bind,source=${repo},target=/work`,
      '--mount', `type=bind,source=${store},target=/pnpm-store`,
      '--env', 'npm_config_store_dir=/pnpm-store',
      ...(process.env.HTTPS_PROXY || process.env.HTTP_PROXY ? ['--env', 'NODE_USE_ENV_PROXY=1'] : []),
      ...(ca ? ['--mount', `type=bind,source=${ca},target=/run/proxy-ca.pem,readonly`,
        '--env', 'NODE_EXTRA_CA_CERTS=/run/proxy-ca.pem', '--env', 'SSL_CERT_FILE=/run/proxy-ca.pem',
        '--env', 'REQUESTS_CA_BUNDLE=/run/proxy-ca.pem', '--env', 'GIT_SSL_CAINFO=/run/proxy-ca.pem'] : []),
      '--workdir', '/work', image, ...(args.length ? args : ['bash'])]);
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } else throw new Error('Usage: node scripts/cloud-dev.mjs build | run [--publish <host:container>] [--] [command ...]');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
