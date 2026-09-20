#!/usr/bin/env node
/**
 * Repository secret scan.
 *
 * Deliberately a repository-local script rather than a third-party action: it
 * runs identically on a developer machine and in CI, needs no network, and adds
 * no supply-chain dependency to a gate whose whole purpose is to protect the
 * repository.
 *
 * This is NOT a replacement for a dedicated scanning product. It detects the
 * shapes this project can actually leak - private keys, cloud and provider
 * tokens, credentials embedded in a DSN, and the generated per-run acceptance
 * files - and it fails closed on anything it matches.
 *
 *   node scripts/check-secrets.mjs            scan tracked files
 *   node scripts/check-secrets.mjs --all      scan the working tree too
 */
import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Paths that legitimately contain credential-shaped text: the documentation that
 * tells an operator which variables exist, and the example environment file.
 * They are still scanned for private keys and real provider tokens below.
 */
const DSN_DOCUMENTATION = [
  '.env.example',
  'docs/',
  'infra/README.md',
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
];

/**
 * Test and fixture code, exempt from the DSN rule ONLY.
 *
 * These files are full of deliberately realistic-looking connection strings,
 * and several of them exist precisely to prove that the log redactor strips a
 * password out of a DSN - the fake credential IS the test input. Matching them
 * would train everyone to ignore this gate, which is worse than the narrow hole
 * it closes.
 *
 * This is a real, accepted limitation: a genuine credential pasted into a test
 * file would not be caught by the DSN rule. It would still be caught by the
 * private-key, provider-token, JWT and forbidden-path rules, and real runtime
 * credentials in this project are generated per run into the git-ignored
 * .acceptance/ directory rather than written into source at all.
 */
const DSN_TEST_FIXTURES = ['tests/', '/test/', 'scripts/dev/'];

const BINARY_OR_GENERATED = [
  'node_modules/',
  'dist/',
  'dist-tests/',
  'src/generated/',
  '.git/',
  'design/',
  'apps/customer-web/prototype/',
  'pnpm-lock.yaml',
];

const RULES = [
  {
    id: 'private-key',
    description: 'PEM private key block',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
    allowDocumentation: false,
  },
  {
    id: 'aws-access-key',
    description: 'AWS access key id',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
    allowDocumentation: false,
  },
  {
    id: 'github-token',
    description: 'GitHub personal access / app token',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
    allowDocumentation: false,
  },
  {
    id: 'slack-token',
    description: 'Slack token',
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
    allowDocumentation: false,
  },
  {
    id: 'stripe-key',
    description: 'Stripe secret key',
    pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
    allowDocumentation: false,
  },
  {
    id: 'jwt-with-payload',
    description: 'Hard-coded JWT',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    allowDocumentation: false,
  },
  {
    id: 'dsn-credentials',
    description: 'Credentials embedded in a connection string',
    // A password inside a DSN. ${...}, $VAR and obvious placeholders are allowed.
    pattern:
      /\b(?:postgres(?:ql)?|amqps?|mongodb(?:\+srv)?|redis|mysql):\/\/[^\s:/?#@'"]+:(?!\$|%s|\*{3}|\[REDACTED\]|password@|changeme@|example@)[^\s:/?#@'"]{3,}@/,
    allowDocumentation: true,
  },
];

/** Generated per-run acceptance material must never be committed at all. */
const FORBIDDEN_PATHS = [
  { pattern: /(^|\/)\.acceptance\//, reason: 'per-run acceptance credentials' },
  { pattern: /(^|\/)\.env$/, reason: 'local environment file' },
  { pattern: /(^|\/)\.env\.(?!example)/, reason: 'local environment file' },
  { pattern: /\.(pem|key|pfx|p12|jks|keystore)$/i, reason: 'key material' },
  { pattern: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/, reason: 'ssh private key' },
];

function trackedFiles() {
  const result = spawnSync('git', ['-C', ROOT, 'ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr}`);
  return result.stdout.split('\0').filter(Boolean);
}

function untrackedFiles() {
  const result = spawnSync(
    'git',
    ['-C', ROOT, 'ls-files', '-z', '--others', '--exclude-standard'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr}`);
  return result.stdout.split('\0').filter(Boolean);
}

const isDocumentation = (file) => DSN_DOCUMENTATION.some((prefix) => file.startsWith(prefix));
const isTestFixture = (file) => DSN_TEST_FIXTURES.some((fragment) => file.includes(fragment));
const isSkipped = (file) => BINARY_OR_GENERATED.some((fragment) => file.includes(fragment));

async function scanFile(file) {
  const findings = [];
  for (const rule of FORBIDDEN_PATHS) {
    if (rule.pattern.test(file)) {
      findings.push({ file, line: 0, rule: 'forbidden-path', description: rule.reason });
    }
  }
  if (isSkipped(file)) return findings;

  const absolute = path.join(ROOT, file);
  let info;
  try {
    info = await stat(absolute);
  } catch {
    return findings;
  }
  if (!info.isFile() || info.size > MAX_BYTES) return findings;

  let text;
  try {
    text = await readFile(absolute, 'utf8');
  } catch {
    return findings;
  }
  // A NUL byte means binary; there is nothing useful to match in it.
  if (text.includes('\u0000')) return findings;

  // The DSN rule is relaxed for documentation and for test fixtures; every other
  // rule still applies to both.
  const dsnExempt = isDocumentation(file) || isTestFixture(file);
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (line.length > 4096) continue;
    for (const rule of RULES) {
      if (rule.allowDocumentation && dsnExempt) continue;
      if (rule.pattern.test(line)) {
        findings.push({
          file,
          line: index + 1,
          rule: rule.id,
          description: rule.description,
        });
      }
    }
  }
  return findings;
}

async function main() {
  const includeUntracked = process.argv.includes('--all');
  const files = [...trackedFiles(), ...(includeUntracked ? untrackedFiles() : [])];

  const findings = [];
  for (const file of files) findings.push(...(await scanFile(file)));

  if (findings.length > 0) {
    console.error(`Secret scan FAILED: ${findings.length} finding(s).\n`);
    for (const finding of findings) {
      console.error(`  ${finding.file}:${finding.line}  [${finding.rule}] ${finding.description}`);
    }
    console.error(
      '\nNothing here is auto-fixed. Remove the value, rotate it if it was ever real,\n' +
        'and keep generated credentials in the git-ignored .acceptance/ directory.',
    );
    process.exit(1);
  }

  console.log(
    `Secret scan passed: ${files.length} files checked against ${RULES.length} content rules ` +
      `and ${FORBIDDEN_PATHS.length} path rules.`,
  );
  console.log(
    'Scope: this repository\u2019s own leak shapes. It is not a full scanning product and does ' +
      'not inspect git history.',
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
