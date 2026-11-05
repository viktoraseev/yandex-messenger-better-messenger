import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = 'https://messenger.360.yandex.ru';
const chat = '/#/chats/0%2F0%2Fgroup';

test('browser links become ychat deeplinks only for chats on the base host', { skip: process.platform !== 'darwin' && 'needs swiftc' }, t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'better-messenger-links-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const harness = path.join(directory, 'links');
    execFileSync('/usr/bin/xcrun', ['swiftc', '-parse-as-library', path.join(root, 'launcher/links.swift'), path.join(root, 'test/fixtures/links-harness.swift'), '-o', harness], { stdio: 'inherit' });
    const cases = [
        [`better-messenger://messenger.360.yandex.ru${chat}/1700000000000000`, `ychat://messenger.360.yandex.ru${chat}/1700000000000000`],
        [`better-messenger://messenger.360.yandex.ru${chat}`, `ychat://messenger.360.yandex.ru${chat}`],
        [`better-messenger://evil.example${chat}`, '-'],
        [`https://messenger.360.yandex.ru${chat}`, '-'],
        ['better-messenger://messenger.360.yandex.ru/#/join/abc', '-'],
        ['better-messenger://messenger.360.yandex.ru/#/chats/', '-'],
        [`better-messenger://user:pass@messenger.360.yandex.ru${chat}`, '-'],
    ];
    const output = execFileSync(harness, [base, ...cases.map(([input]) => input)], { encoding: 'utf8' }).trim().split('\n');
    assert.deepEqual(output, cases.map(([, expected]) => expected));
});
