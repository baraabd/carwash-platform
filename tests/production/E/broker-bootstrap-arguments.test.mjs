import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const profiles = [
  {
    file: 'billing-wallet-bootstrap.sh',
    scope: { CW_FINANCE_VHOST: 'argument-fixture' },
    users: { BILLING_BROKER_PASSWORD: 'cw_billing_app', WALLET_BROKER_PASSWORD: 'cw_wallet_app' },
  },
  {
    file: 'billing-reporting-bootstrap.sh',
    scope: { CW_FINANCE_VHOST: 'argument-fixture' },
    users: {
      BILLING_BROKER_PASSWORD: 'cw_billing_app',
      REPORTING_BROKER_PASSWORD: 'cw_reporting_app',
    },
  },
  {
    file: 'acceptance-bootstrap.sh',
    scope: { CW_VHOST: 'argument-fixture' },
    users: {
      CW_INFRA_PASSWORD: 'cw_infra_topology',
      CATALOG_BROKER_PASSWORD: 'cw_catalog_app',
      COMMUNICATIONS_BROKER_PASSWORD: 'cw_communications_app',
      REPORTING_BROKER_PASSWORD: 'cw_reporting_app',
    },
  },
];

for (const profile of profiles) {
  test(
    profile.file + ' passes leading-dash passwords after the RabbitMQ option boundary unchanged',
    async () => {
      const directory = await mkdtemp(path.join(tmpdir(), 'broker-arguments-'));
      try {
        const credentials = Object.fromEntries(
          Object.keys(profile.users).map((key, i) => [
            key,
            '-Jf_m-CLI-argument-regression-fixture-' + i,
          ]),
        );
        const expected = Object.fromEntries(
          Object.entries(profile.users).map(([variable, username]) => [
            username,
            credentials[variable],
          ]),
        );
        const log = path.join(directory, 'safe-call-records.jsonl');
        const stub = [
          '#!' + process.execPath,
          "const {appendFileSync}=require('node:fs');",
          'const args=process.argv.slice(2);',
          "if(args[0]==='add_user'){",
          "if(args.length!==4||args[1]!=='--')process.exit(64);",
          'const [username,password]=args.slice(2);',
          'const expected=JSON.parse(process.env.CW_TEST_EXPECTED);',
          "if(!Object.hasOwn(expected,username)||password!==expected[username]||!password.startsWith('-'))process.exit(65);",
          "appendFileSync(process.env.CW_TEST_SAFE_LOG,JSON.stringify({username,unchanged:true,afterOptionBoundary:true})+'\\n');",
          '}',
          '',
        ].join('\n');
        await writeFile(path.join(directory, 'rabbitmqctl'), stub, { mode: 0o700 });
        const result = spawnSync('sh', [path.join(root, 'infra/rabbitmq', profile.file)], {
          encoding: 'utf8',
          timeout: 20_000,
          env: {
            ...process.env,
            ...profile.scope,
            ...credentials,
            PATH: directory + path.delimiter + (process.env.PATH ?? ''),
            CW_TEST_EXPECTED: JSON.stringify(expected),
            CW_TEST_SAFE_LOG: log,
          },
        });
        assert.equal(
          result.status,
          0,
          'the real shell provisioner must preserve positional credentials',
        );
        assert.equal(result.signal, null);
        const output = (result.stdout ?? '') + (result.stderr ?? '');
        assert.equal(
          Object.values(credentials).some((value) => output.includes(value)),
          false,
        );
        const calls = (await readFile(log, 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        assert.deepEqual(
          calls,
          Object.values(profile.users).map((username) => ({
            username,
            unchanged: true,
            afterOptionBoundary: true,
          })),
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}
