import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLauncher, launcherConfiguration, runtimeFiles } from '../scripts/build-launcher.mjs';

test('launcher arguments preserve paths as data, including spaces and apostrophes', () => {
    const config = launcherConfiguration({ nodePath: '/tmp/Node with spaces/node', appPath: "/Applications/Someone's Messenger.app" });
    assert.equal(config.arguments[3], "/Applications/Someone's Messenger.app");
    assert.ok(config.arguments.includes('--notify'));
    assert.equal(config.arguments[config.arguments.indexOf('--base-url') + 1], 'https://messenger.360.yandex.ru');
    assert.ok(!config.arguments.includes('--stop'));
});

test('copies for the same target share a lock, different ports do not', () => {
    const configuration = { nodePath: '/tmp/node', appPath: '/Applications/Messenger.app' };
    const first = launcherConfiguration(configuration);
    assert.equal(first.runtimeKey, launcherConfiguration({ ...configuration, nodePath: '/opt/node' }).runtimeKey);
    assert.notEqual(first.runtimeKey, launcherConfiguration({ ...configuration, port: 9232 }).runtimeKey);
    assert.throws(() => launcherConfiguration({ ...configuration, appPath: 'relative' }));
    assert.throws(() => launcherConfiguration({ ...configuration, port: NaN }));
});

test('bundle contains a snapshot of the runtime, not references to the worktree', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'better-messenger-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const config = launcherConfiguration({ nodePath: process.execPath, appPath: '/Applications/Yandex Messenger.app' });
    const bundle = path.join(directory, 'Better Messenger.app');
    let compiler;
    buildLauncher(bundle, config, (...args) => { compiler = args; });
    assert.equal(compiler[0], '/usr/bin/xcrun');
    assert.equal(compiler[1].at(-1), path.join(bundle, 'Contents/MacOS/BetterMessenger'));
    const resources = path.join(bundle, 'Contents/Resources');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(resources, 'launcher.json'), 'utf8')), config);
    assert.deepEqual(fs.readdirSync(path.join(resources, 'src')).sort(), [...runtimeFiles].sort());
    const plist = fs.readFileSync(path.join(bundle, 'Contents/Info.plist'), 'utf8');
    assert.ok(plist.includes('LSUIElement'));
    assert.ok(plist.includes('<key>CFBundleURLSchemes</key><array><string>better-messenger</string></array>'));
    assert.ok(compiler[1].some(arg => arg.endsWith('launcher/links.swift')));
    assert.throws(() => buildLauncher(bundle, config, () => {}), /not overwritten/);
});
