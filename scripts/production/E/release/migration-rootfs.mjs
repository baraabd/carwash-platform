#!/usr/bin/env node
/**
 * Assemble the migration-only Bookworm native runtime from immutable inputs.
 * Debian packages are authenticated by the committed SHA256 before extraction.
 * Only runtime libraries, CA data, OS identity and original inventory/licences
 * enter the final scratch image. No package manager or shell enters that image.
 */
/* global AbortSignal -- Node 24 web API */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NATIVE_LOADER = '/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2';
const NATIVE_DIRECTORIES = ['/lib/x86_64-linux-gnu', '/usr/lib/x86_64-linux-gnu'];
const CONVERTERS = ['UHC.so', 'ISO-2022-CN-EXT.so', 'IBM1390.so', 'IBM1399.so'];
const PACKAGE_NAMES = [
  'base-files',
  'ca-certificates',
  'gcc-12-base',
  'libc6',
  'libgcc-s1',
  'libssl3',
  'libstdc++6',
];
const SHA256 = /^[a-f0-9]{64}$/;
const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');

export function validateRuntimeLock(lock) {
  assert.equal(lock?.schemaVersion, 1);
  assert.equal(lock.architecture, 'amd64');
  assert.deepEqual(lock.distribution, { id: 'debian', version: '12' });
  assert.match(lock.nodeImage, /^docker\.io\/library\/node@sha256:[a-f0-9]{64}$/);
  assert.deepEqual(lock.packages.map((item) => item.name), PACKAGE_NAMES);
  for (const item of lock.packages) {
    assert.equal(typeof item.version, 'string');
    assert.ok(item.version.length > 0 && !/\s/.test(item.version));
    assert.equal(item.architecture, item.name === 'ca-certificates' ? 'all' : 'amd64');
    assert.match(item.sha256, SHA256);
    const url = new URL(item.url);
    assert.equal(url.protocol, 'https:');
    assert.ok(['deb.debian.org', 'security.debian.org'].includes(url.hostname));
    assert.equal(url.username + url.password + url.search + url.hash, '');
    assert.ok(url.pathname.endsWith('.deb'));
  }
  assert.equal(lock.packages.find((item) => item.name === 'libssl3').version, '3.0.22-1~deb12u2');
  return lock;
}

export function parseControl(bytes) {
  const record = {};
  for (const line of bytes.toString('utf8').split('\n')) {
    if (!line || /^\s/.test(line)) continue;
    const match = /^([A-Za-z][A-Za-z0-9-]*): (.*)$/.exec(line);
    assert.ok(match, 'Invalid Debian control field');
    assert.equal(record[match[1]], undefined, 'Duplicate Debian control field');
    record[match[1]] = match[2];
  }
  return record;
}

function inside(root, file) {
  const normalized = path.resolve(root, '.' + file);
  assert.ok(normalized.startsWith(root + path.sep), 'Path escaped the assembly root');
  return normalized;
}

function write(root, file, bytes, mode = 0o644) {
  const destination = inside(root, file);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, bytes, { mode });
}

function walk(directory, prefix = '') {
  const entries = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) entries.push(...walk(path.join(directory, entry.name), relative));
    else {
      assert.ok(entry.isFile() || entry.isSymbolicLink(), 'Unexpected package file type');
      entries.push(relative);
    }
  }
  return entries;
}

function retained(file) {
  return (
    /^(?:lib|lib64|usr\/lib\/x86_64-linux-gnu|usr\/lib64)\//.test(file) ||
    /^(?:usr\/share\/doc|usr\/share\/common-licenses|usr\/share\/ca-certificates)\//.test(file) ||
    ['etc/os-release', 'etc/debian_version', 'etc/host.conf', 'usr/lib/os-release'].includes(file)
  );
}

function copyRetained(sourceRoot, root, relative) {
  const source = path.join(sourceRoot, relative);
  const destination = inside(root, '/' + relative);
  mkdirSync(path.dirname(destination), { recursive: true });
  assert.equal(existsSync(destination), false, 'Overlapping package file: ' + relative);
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) {
    const link = readlinkSync(source);
    const finalTarget = path.posix.resolve('/', path.posix.dirname(relative), link);
    assert.ok(retained(finalTarget.slice(1)), 'Unexpected runtime symlink target');
    symlinkSync(link, destination);
  } else {
    assert.ok(stat.isFile());
    copyFileSync(source, destination);
    chmodSync(destination, stat.mode & 0o777);
  }
}

function execute(program, args, options = {}) {
  const result = spawnSync(program, args, {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  });
  assert.equal(
    result.status,
    0,
    path.basename(program) + ' failed: ' + (result.error?.message ?? result.stderr).slice(-2000),
  );
  return result.stdout;
}

async function download(item) {
  const response = await fetch(item.url, {
    redirect: 'error',
    signal: AbortSignal.timeout(60000),
  });
  assert.equal(response.status, 200, 'Debian package download failed: ' + item.name);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    assert.ok(size <= 16 * 1024 * 1024, 'Unexpected Debian package size');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  assert.equal(hash(bytes), item.sha256, 'Debian package digest mismatch: ' + item.name);
  return bytes;
}

function packageFiles(controlRoot, dataRoot) {
  const checksums = readFileSync(path.join(controlRoot, 'md5sums'));
  const entries = checksums.toString('utf8').trimEnd().split('\n');
  assert.ok(entries.length > 0);
  for (const line of entries) {
    const match = /^([a-f0-9]{32})  (.+)$/.exec(line);
    assert.ok(match, 'Malformed original Debian checksum record');
    const relative = match[2];
    assert.ok(!path.isAbsolute(relative) && !relative.split('/').includes('..'));
    const file = path.join(dataRoot, relative);
    assert.ok(lstatSync(file).isFile(), 'Checksum must identify an original regular file');
    assert.equal(hash(readFileSync(file), 'md5'), match[1], 'Extracted package checksum mismatch');
  }
  return checksums;
}

/** Reject fallback to the builder's libraries even when the loader could find them. */
export function parseNativeDependencies(output, root, resolveFile = realpathSync) {
  const libraries = [];
  for (const line of output.trim().split('\n')) {
    const text = line.trim();
    if (!text || /^linux-vdso\.so\.1 /.test(text)) continue;
    assert.ok(!text.includes('not found'), 'Missing migration native dependency');
    const match = /^(?:(\S+) => )?(\/\S+) \(0x[a-f0-9]+\)$/.exec(text);
    assert.ok(match, 'Unexpected native loader output: ' + text);
    const name = path.posix.basename(match[1] ?? match[2]);
    // The loader prints the ELF interpreter's original /lib64 alias. This
    // process was invoked through the exact rootfs loader below.
    const selected =
      name === 'ld-linux-x86-64.so.2' ? inside(root, NATIVE_LOADER) : match[2];
    assert.ok(selected.startsWith(root + path.sep), 'Native dependency escaped rootfs');
    const real = resolveFile(selected);
    assert.ok(real.startsWith(root + path.sep), 'Native dependency symlink escaped rootfs');
    libraries.push({ name, path: real.slice(root.length) });
  }
  assert.ok(libraries.length > 0, 'Empty native dependency closure');
  assert.equal(new Set(libraries.map((item) => item.name)).size, libraries.length);
  return libraries.sort((a, b) => a.name.localeCompare(b.name));
}

function nativeProof(root, binary, role, finalBinary) {
  const loader = inside(root, NATIVE_LOADER);
  const libraryPath = NATIVE_DIRECTORIES.map((directory) => inside(root, directory)).join(':');
  const args = ['--inhibit-cache', '--library-path', libraryPath];
  const env = { PATH: '/usr/local/bin', HOME: '/tmp', LD_BIND_NOW: '1' };
  const output = execute(loader, [...args, '--list', binary], { env });
  const libraries = parseNativeDependencies(output, root);
  const version = execute(loader, [...args, binary, '--version'], { env }).trim();
  return { dependency: { role, binary: finalBinary, libraries }, version };
}

async function assemble({ root, deploy, lockFile, nodeImage }) {
  assert.equal(process.arch, 'x64');
  assert.equal(process.version, 'v24.21.0');
  assert.ok(path.isAbsolute(root) && root !== '/');
  assert.ok(path.isAbsolute(deploy));
  assert.equal(existsSync(root), false, 'Assembly destination must be fresh');
  const lockBytes = readFileSync(lockFile);
  const lock = validateRuntimeLock(JSON.parse(lockBytes));
  assert.match(nodeImage ?? '', /@sha256:[a-f0-9]{64}$/);
  assert.equal(nodeImage.split('@')[1], lock.nodeImage.split('@')[1], 'Wrong Node image digest');
  const temporary = mkdtempSync(path.join(tmpdir(), 'cw-migration-rootfs-'));
  mkdirSync(root, { recursive: true });
  const packages = [];
  try {
    for (const item of lock.packages) {
      const archive = path.join(temporary, item.name + '.deb');
      writeFileSync(archive, await download(item));
      const controlRoot = path.join(temporary, item.name + '-control');
      const dataRoot = path.join(temporary, item.name + '-data');
      execute('dpkg-deb', ['--control', archive, controlRoot]);
      execute('dpkg-deb', ['--extract', archive, dataRoot]);
      const originalControl = readFileSync(path.join(controlRoot, 'control'));
      const control = parseControl(originalControl);
      assert.equal(control.Package, item.name);
      assert.equal(control.Version, item.version);
      assert.equal(control.Architecture, item.architecture);
      assert.equal(control.Status, undefined, 'Unexpected installed-state metadata in source');
      const checksums = packageFiles(controlRoot, dataRoot);
      for (const file of walk(dataRoot)) {
        if (retained(file)) copyRetained(dataRoot, root, file);
      }
      const recordPath = '/var/lib/dpkg/status.d/' + item.name;
      const originalControlPath = '/usr/share/carwash/package-control/' + item.name;
      const md5sumsPath = recordPath + '.md5sums';
      const record = Buffer.from(
        originalControl.toString('utf8').trimEnd() + '\nStatus: install ok installed\n',
      );
      write(root, recordPath, record);
      write(root, originalControlPath, originalControl);
      write(root, md5sumsPath, checksums);
      packages.push({
        ...item,
        recordPath,
        recordSha256: hash(record),
        originalControlPath,
        originalControlSha256: hash(originalControl),
        md5sumsPath,
        md5sumsSha256: hash(checksums),
        copyrightPath: '/usr/share/doc/' + item.name + '/copyright',
      });
    }

    // Keep original inventory/checksums. These unused executable converters are
    // physically absent; their scan findings are still evaluated without waivers.
    for (const name of CONVERTERS) {
      const file = inside(root, '/usr/lib/x86_64-linux-gnu/gconv/' + name);
      assert.ok(lstatSync(file).isFile(), 'Missing original converter');
      unlinkSync(file);
    }
    for (const item of packages) {
      const copyright = realpathSync(inside(root, item.copyrightPath));
      assert.ok(copyright.startsWith(root + path.sep), 'Copyright symlink escaped rootfs');
      const bytes = readFileSync(copyright);
      assert.ok(bytes.length > 0);
      item.copyrightRealPath = copyright.slice(root.length);
      item.copyrightSha256 = hash(bytes);
    }

    const caDirectory = inside(root, '/usr/share/ca-certificates');
    const certificates = walk(caDirectory).filter((file) => file.endsWith('.crt'));
    assert.ok(certificates.length > 0, 'Empty Debian CA trust package');
    const bundle = certificates
      .map((file) => {
        const bytes = readFileSync(path.join(caDirectory, file), 'utf8');
        assert.ok(new X509Certificate(bytes).raw.length > 0, 'Invalid Debian trust certificate');
        return bytes.trimEnd() + '\n';
      })
      .join('');
    const caPath = '/etc/ssl/certs/ca-certificates.crt';
    write(root, caPath, bundle);
    write(
      root,
      '/etc/passwd',
      'root:x:0:0:root:/root:/sbin/nologin\nnode:x:1000:1000:node:/nonexistent:/sbin/nologin\n',
    );
    write(root, '/etc/group', 'root:x:0:\nnode:x:1000:\n');
    write(
      root,
      '/etc/nsswitch.conf',
      'passwd: files\ngroup: files\nhosts: files dns\nnetworks: files\n',
    );
    mkdirSync(inside(root, '/tmp'), { mode: 0o1777 });
    chmodSync(inside(root, '/tmp'), 0o1777);
    write(root, '/usr/local/bin/node', readFileSync(process.execPath), 0o755);
    write(root, '/usr/share/doc/node/copyright', readFileSync('/usr/local/LICENSE'));

    const owner = createRequire(path.join(deploy, 'package.json'));
    assert.equal(owner('prisma/package.json').version, '7.10.0');
    const prisma = createRequire(owner.resolve('prisma/package.json'));
    const engines = prisma('@prisma/engines');
    const engine = path.join(engines.getEnginesPath(), 'schema-engine-debian-openssl-3.0.x');
    assert.ok(engine.startsWith(deploy + path.sep), 'Engine is outside deployed dependencies');
    const nodeProof = nativeProof(
      root,
      inside(root, '/usr/local/bin/node'),
      'node',
      '/usr/local/bin/node',
    );
    assert.equal(nodeProof.version, 'v24.21.0');
    const engineProof = nativeProof(
      root,
      engine,
      'schema-engine',
      '/migrate' + engine.slice(deploy.length),
    );
    assert.ok(engineProof.version.includes(engines.enginesVersion), 'Unexpected schema engine');
    const files = walk(root)
      .filter((file) => lstatSync(path.join(root, file)).isFile())
      .map((file) => ({ path: '/' + file, sha256: hash(readFileSync(path.join(root, file))) }))
      .sort((a, b) => a.path.localeCompare(b.path));
    const receipt = {
      schemaVersion: 1,
      kind: 'carwash-migration-runtime',
      lockSha256: hash(lockBytes),
      nodeImage: lock.nodeImage,
      nodeVersion: '24.21.0',
      architecture: lock.architecture,
      distribution: lock.distribution,
      packages,
      files,
      nativeLoader: NATIVE_LOADER,
      nativeDependencies: [nodeProof.dependency, engineProof.dependency],
      caBundle: { path: caPath, sha256: hash(bundle), certificateCount: certificates.length },
    };
    write(
      root,
      '/usr/share/carwash/migration-runtime.json',
      JSON.stringify(receipt, null, 2) + '\n',
    );
    console.log(
      JSON.stringify({
        migrationRootfs: 'assembled',
        architecture: lock.architecture,
        packages: packages.length,
        files: files.length,
        nativeClosure: true,
      }),
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = (name) => {
    const index = process.argv.indexOf('--' + name);
    assert.ok(index >= 0 && process.argv[index + 1], 'Missing --' + name);
    return process.argv[index + 1];
  };
  assemble({
    root: path.resolve(option('root')),
    deploy: path.resolve(option('deploy')),
    lockFile: path.resolve(option('lock')),
    nodeImage: option('node-image'),
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
