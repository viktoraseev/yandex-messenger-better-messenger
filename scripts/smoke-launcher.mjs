import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { buildLauncher, launcherConfiguration } from './build-launcher.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'better-messenger-native-test-'));
const config = launcherConfiguration({ nodePath: process.execPath, appPath: path.join(directory, 'Isolated fixture.app') });
config.bundleIdentifier = `local.better-messenger.fixture.${config.runtimeKey}`;
const bundle = path.join(directory, 'Better Messenger Test.app');
let first;
let second;
let workers = [];
const records = () => {
    const file = path.join(directory, 'workers.jsonl');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
};
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(condition) {
    for (let i = 0; i < 100; i++) {
        if (condition()) return;
        await wait(100);
    }
    throw new Error('Native launcher fixture timed out');
}
try {
    buildLauncher(bundle, config);
    fs.copyFileSync(fileURLToPath(new URL('../test/fixtures/launcher-worker.mjs', import.meta.url)), path.join(bundle, 'Contents/Resources/src/cli.mjs'));
    const executable = path.join(bundle, 'Contents/MacOS/BetterMessenger');
    first = spawn(executable, [], { stdio: 'ignore' });
    await until(() => records().length === 1);
    workers = records();
    assert.equal(workers[0].parent, first.pid);
    second = spawn(executable, [], { stdio: 'ignore' });
    await until(() => second.exitCode !== null);
    assert.equal(second.exitCode, 0);
    assert.equal(records().length, 1);
    execFileSync('/usr/bin/open', ['-a', bundle]);
    await until(() => records().length === 2);
    workers = records();
    assert.equal(workers[1].parent, first.pid);
    await until(() => !alive(workers[0].pid));
    first.kill('SIGTERM');
    await until(() => !alive(workers[1].pid));
    console.log('Native launcher: start, duplicate lock, explicit reopen and parent-exit cleanup passed. Real Messenger was not used.');
} finally {
    if (first?.exitCode === null) first.kill('SIGTERM');
    if (second?.exitCode === null) second.kill('SIGTERM');
    for (const worker of workers) if (alive(worker.pid)) process.kill(worker.pid, 'SIGTERM');
    fs.rmSync(directory, { recursive: true, force: true });
}
