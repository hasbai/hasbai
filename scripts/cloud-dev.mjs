import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const image = 'hasbai-cloud-dev:chromium-pw1.63.0-node24-pnpm10.33.2-amd64-v2';
const publishedImage = 'ghcr.io/hasbai/financial-visual-ci@sha256:4aca1416fa6743042754ec8aaac4a68239f25e89e4535c5f152c2b4a6c03ce4b';
const dockerfile = readFileSync(new URL('../docker/visual-ci/Dockerfile', import.meta.url), 'utf8');
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
    let runtimeImage = image;
    if (installed.status !== 0 || installed.stdout.trim() !== `amd64 ${fingerprint}`) {
      runtimeImage = publishedImage;
      const cached = invoke(['image', 'inspect', '--format', '{{.Architecture}}', runtimeImage],
        { encoding: 'utf8', stdio: 'pipe' });
      if (cached.status !== 0 || cached.stdout.trim() !== 'amd64') {
        const pulled = invoke(['pull', '--platform', 'linux/amd64', runtimeImage]);
        if (pulled.error || pulled.status !== 0) throw new Error('Cloud development image pull failed.');
      }
    }
    const store = join(repo, '.local-visual', 'cloud-dev-pnpm-store');
    mkdirSync(store, { recursive: true });
    const result = invoke(['run', '--rm', '--init', '--ipc=host', '--platform', 'linux/amd64',
      '--user', `${process.getuid()}:${process.getgid()}`,
      '--env', 'HOME=/tmp',
      ...(process.stdin.isTTY ? ['--interactive'] : []), ...(process.stdout.isTTY ? ['--tty'] : []),
      ...ports, '--mount', `type=bind,source=${repo},target=/work`,
      '--mount', `type=bind,source=${store},target=/pnpm-store`,
      '--env', 'npm_config_store_dir=/pnpm-store',
      ...(process.env.HTTPS_PROXY || process.env.HTTP_PROXY ? ['--env', 'NODE_USE_ENV_PROXY=1'] : []),
      ...(ca ? ['--mount', `type=bind,source=${ca},target=/run/proxy-ca.pem,readonly`,
        '--env', 'NODE_EXTRA_CA_CERTS=/run/proxy-ca.pem', '--env', 'SSL_CERT_FILE=/run/proxy-ca.pem',
        '--env', 'REQUESTS_CA_BUNDLE=/run/proxy-ca.pem', '--env', 'GIT_SSL_CAINFO=/run/proxy-ca.pem'] : []),
      '--workdir', '/work', runtimeImage, ...(args.length ? args : ['bash'])]);
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } else throw new Error('Usage: node scripts/cloud-dev.mjs build | run [--publish <host:container>] [--] [command ...]');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
