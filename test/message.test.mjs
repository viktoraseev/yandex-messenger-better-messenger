import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMessageLink, findMessageInFiber, threadRoute } from '../src/message.mjs';
import { assertLoopbackUrl } from '../src/inspector.mjs';
import { rendererSource, installExpression } from '../src/injection.mjs';

const configuration = { baseUrl: 'https://messenger.360.yandex.ru', routeFormat: 'hash' };
const timestamp = 1700000000000000;

test('direct group message link does not need an invite hash', () => {
    assert.equal(buildMessageLink({ chatId: '0/0/group', timestamp }, configuration), 'https://messenger.360.yandex.ru/#/chats/0%2F0%2Fgroup/1700000000000000');
});

test('thread reply retains full thread ID and reply timestamp', () => {
    const chatId = '100/0/group_1690000000000000';
    assert.equal(buildMessageLink({ chatId, timestamp }, configuration), 'https://messenger.360.yandex.ru/#/chats/100%2F0%2Fgroup_1690000000000000/1700000000000000');
});

test('thread header links to the parent chat and root message', () => {
    const key = findMessageInFiber({ memoizedProps: { detachedMessage: { chatId: '0/0/group', timestamp } } });
    assert.equal(buildMessageLink(key, configuration), 'https://messenger.360.yandex.ru/#/chats/0%2F0%2Fgroup/1700000000000000');
});

test('private thread and string timestamp preserve identity', () => {
    const chatId = '110/0/user-a_user-b_1690000000000000';
    assert.match(buildMessageLink({ chatId, timestamp: '1700000000000001' }, configuration), /110%2F0%2Fuser-a_user-b_1690000000000000\/1700000000000001$/);
});

test('pathname links preserve a deployment path', () => {
    assert.equal(buildMessageLink({ chatId: '0/0/group', timestamp }, { baseUrl: 'https://example.com/messenger', routeFormat: 'pathname' }), 'https://example.com/messenger/chats/0%2F0%2Fgroup/1700000000000000');
});

test('invalid keys and origins are rejected', () => {
    for (const value of [undefined, null, NaN, -1, 0, Number.MAX_SAFE_INTEGER + 1, 'not-a-timestamp']) {
        assert.throws(() => buildMessageLink({ chatId: '0/0/group', timestamp: value }, configuration));
    }
    const credentialedUrl = new URL('https://example.com');
    credentialedUrl.username = 'user';
    credentialedUrl.password = 'password';
    for (const baseUrl of ['http://example.com', credentialedUrl.href, 'https://example.com/#route', 'https://example.com/?token=secret']) {
        assert.throws(() => buildMessageLink({ chatId: 'group', timestamp }, { ...configuration, baseUrl }));
    }
});

test('React message lookup walks ancestors without using forwarded content', () => {
    const original = { chatId: 'original', timestamp: timestamp - 1 };
    const parent = { memoizedProps: { chatId: 'current', timestamp, forwardMessage: original } };
    const start = { memoizedProps: { children: 'not inspected' }, return: parent };
    assert.deepEqual(findMessageInFiber(start), { chatId: 'current', timestamp });
});

test('cyclic and missing React fibers terminate', () => {
    const fiber = { memoizedProps: {} }; fiber.return = fiber;
    assert.equal(findMessageInFiber(fiber), null);
    assert.equal(findMessageInFiber(null), null);
});

test('inspector connections must stay on numeric IPv4 loopback', () => {
    assert.equal(assertLoopbackUrl('ws://127.0.0.1:9231/abc', true).hostname, '127.0.0.1');
    for (const url of ['ws://example.com:9231/abc', 'ws://0.0.0.0:9231', 'wss://127.0.0.1:9231', 'ws://u:p@127.0.0.1:9231']) {
        assert.throws(() => assertLoopbackUrl(url, true));
    }
});

test('injection source is syntactically valid and options remain data', () => {
    const options = { ...configuration, always: false, extra: '\"}); throw new Error(\"injection\"); //' };
    assert.doesNotThrow(() => new Function(rendererSource(options)));
    assert.doesNotThrow(() => new Function(installExpression(options)));
});

test('a join link to a thread message becomes the router route of the web app, other links do not', () => {
    const message = 'e3830e10-f8fd-4e86-9a2c-9417b1e75496/1793875547366060/1793956421352019';
    const route = `/join/${message}`;
    assert.equal(threadRoute(`ychat://telemost.360.yandex.ru/join#${message}`), route);
    assert.equal(threadRoute(`ychat://telemost.360.yandex.ru/join/#${message}`), route);
    assert.equal(threadRoute(`ychat://messenger.360.yandex.ru/#/join/${message}`), route);
    for (const link of [
        'ychat://telemost.360.yandex.ru/join#e3830e10-f8fd-4e86-9a2c-9417b1e75496/1793875547366060',
        'ychat://telemost.360.yandex.ru/join#e3830e10-f8fd-4e86-9a2c-9417b1e75496',
        'ychat://messenger.360.yandex.ru/#/chats/0%2F0%2Fgroup/1793875547366060',
        `https://telemost.360.yandex.ru/join#${message}`,
        'ychat://telemost.360.yandex.ru/join#a%2F..%2Fsettings/1793875547366060/1793956421352019',
        'ychat://telemost.360.yandex.ru/join#abc/1793875547366060/1793956421352019/extra',
        'ychat://telemost.360.yandex.ru/joined#abc/1793875547366060/1793956421352019',
        'not a url',
        undefined,
    ]) assert.equal(threadRoute(link), null, String(link));
});
