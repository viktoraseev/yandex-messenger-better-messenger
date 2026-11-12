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
const message = 'e3830e10-f8fd-4e86-9a2c-9417b1e75496/1793875547366060';
const join = `${message}/1793956421352019`;

test('browser links become ychat deeplinks only for chat routes on the base host or Telemost, join links without the thread message', { skip: process.platform !== 'darwin' && 'needs swiftc' }, t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'better-messenger-links-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const harness = path.join(directory, 'links');
    execFileSync('/usr/bin/xcrun', ['swiftc', '-parse-as-library', path.join(root, 'launcher/links.swift'), path.join(root, 'test/fixtures/links-harness.swift'), '-o', harness], { stdio: 'inherit' });
    const cases = [
        [`better-messenger://messenger.360.yandex.ru${chat}/1700000000000000`, `ychat://messenger.360.yandex.ru${chat}/1700000000000000`],
        [`better-messenger://messenger.360.yandex.ru${chat}`, `ychat://messenger.360.yandex.ru${chat}`],
        ['better-messenger://messenger.360.yandex.ru/#/join/abc', 'ychat://messenger.360.yandex.ru/#/join/abc'],
        [`better-messenger://messenger.360.yandex.ru/#/join/${join}`, `ychat://messenger.360.yandex.ru/#/join/${message}`],
        [`better-messenger://telemost.360.yandex.ru/join#${join}`, `ychat://telemost.360.yandex.ru/join#${message}`],
        [`better-messenger://telemost.360.yandex.ru/join/#${join}`, `ychat://telemost.360.yandex.ru/join/#${message}`],
        [`better-messenger://telemost.360.yandex.ru/join#${message}`, `ychat://telemost.360.yandex.ru/join#${message}`],
        ['better-messenger://telemost.360.yandex.ru/join#abc', 'ychat://telemost.360.yandex.ru/join#abc'],
        ['better-messenger://telemost.360.yandex.ru/chats/0%2F0%2Fgroup/1700000000000000', 'ychat://telemost.360.yandex.ru/chats/0%2F0%2Fgroup/1700000000000000'],
        [`better-messenger://TELEMOST.360.yandex.ru${chat}`, `ychat://TELEMOST.360.yandex.ru${chat}`],
        [`better-messenger://evil.example${chat}`, '-'],
        [`better-messenger://evil.example/join#${join}`, '-'],
        [`https://messenger.360.yandex.ru${chat}`, '-'],
        [`https://telemost.360.yandex.ru/join#${join}`, '-'],
        ['better-messenger://messenger.360.yandex.ru/#/chats/', '-'],
        ['better-messenger://messenger.360.yandex.ru/#/join/', '-'],
        ['better-messenger://telemost.360.yandex.ru/join', '-'],
        ['better-messenger://telemost.360.yandex.ru/join#/chats/0%2F0%2Fgroup', '-'],
        ['better-messenger://telemost.360.yandex.ru/chats/', '-'],
        ['better-messenger://telemost.360.yandex.ru/j/12345678901234', '-'],
        ['better-messenger://telemost.360.yandex.ru/', '-'],
        [`better-messenger://user:pass@messenger.360.yandex.ru${chat}`, '-'],
        [`better-messenger://user:pass@telemost.360.yandex.ru/join#${join}`, '-'],
    ];
    const output = execFileSync(harness, [base, ...cases.map(([input]) => input)], { encoding: 'utf8' }).trim().split('\n');
    assert.deepEqual(output, cases.map(([, expected]) => expected));
});
