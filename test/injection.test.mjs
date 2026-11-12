import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { installExpression, healthExpression } from '../src/injection.mjs';

test('same runtime source is not reinstalled by a second supervisor', async () => {
    const app = new EventEmitter();
    app.getName = () => 'chats';
    app.getVersion = () => '3.31.0';
    app.getAppPath = () => '/Mock Messenger.app/Contents/Resources/app.asar';
    const webContents = new EventEmitter();
    webContents.id = 2;
    webContents.isDestroyed = () => false;
    webContents.getType = () => 'window';
    webContents.getURL = () => 'ychat://files/www/index.html';
    const calls = [];
    webContents.executeJavaScript = async source => { calls.push(source); return { version: '0.2.0' }; };
    const context = vm.createContext({ URL, require: () => ({ app, webContents: { getAllWebContents: () => [webContents] } }) });
    const options = { appPath: '/Mock Messenger.app', baseUrl: 'https://messenger.360.yandex.ru', routeFormat: 'hash' };
    await vm.runInContext(installExpression(options), context);
    const result = await vm.runInContext(installExpression(options), context);
    assert.equal(result.alreadyInstalled, true);
    assert.equal(calls.length, 1);
    assert.equal(app.listenerCount('web-contents-created'), 1);
    await vm.runInContext(installExpression({ ...options, routeFormat: 'pathname' }), context);
    assert.equal(calls.length, 3);
    assert.equal(app.listenerCount('web-contents-created'), 1);
});

test('supervisor health checks never execute code in the renderer', () => {
    const context = vm.createContext({ __betterMessengerMain: {}, __betterMessengerDisabled: false });
    const result = vm.runInContext(healthExpression(), context);
    assert.equal(result.installed, true);
    assert.equal(result.disabled, false);
    assert.ok(!healthExpression().includes('executeJavaScript'));
});

test('a thread deeplink goes to the renderer router; other sends and a window without the patch keep the original path', async () => {
    const app = new EventEmitter();
    app.getName = () => 'chats';
    app.getVersion = () => '3.31.0';
    app.getAppPath = () => '/Mock Messenger.app/Contents/Resources/app.asar';
    const sent = [];
    const evaluated = [];
    let rendererOpens = true;
    class WebContents extends EventEmitter {
        id = 2;
        isDestroyed() { return false; }
        getType() { return 'window'; }
        getURL() { return 'ychat://files/www/index.html'; }
        async executeJavaScript(source) {
            if (!source.includes('openThreadLink?.(')) return { version: '0.3.0' };
            evaluated.push(source);
            return rendererOpens;
        }
        send(channel, payload) { sent.push([channel, payload]); }
    }
    const originalSend = WebContents.prototype.send;
    const webContents = new WebContents();
    const context = vm.createContext({ URL, require: () => ({ app, webContents: { getAllWebContents: () => [webContents] } }) });
    await vm.runInContext(installExpression({ appPath: '/Mock Messenger.app', baseUrl: 'https://messenger.360.yandex.ru', routeFormat: 'hash' }), context);
    const settle = () => new Promise(resolve => setImmediate(resolve));
    const thread = { url: 'ychat://telemost.360.yandex.ru/join#e3830e10-f8fd-4e86-9a2c-9417b1e75496/1793875547366060/1793956421352019' };
    const chat = { url: 'ychat://messenger.360.yandex.ru/#/chats/0%2F0%2Fgroup/1793875547366060' };

    webContents.send('update-available', { version: '9' });
    webContents.send('deeplink', chat);
    webContents.send('deeplink', thread);
    await settle();
    assert.deepEqual(sent, [['update-available', { version: '9' }], ['deeplink', chat]]);
    assert.equal(evaluated.length, 1);
    assert.ok(evaluated[0].includes(JSON.stringify(thread.url)));

    rendererOpens = false;
    webContents.send('deeplink', thread);
    await settle();
    assert.deepEqual(sent.at(-1), ['deeplink', thread]);

    await context.__betterMessengerMain.dispose();
    assert.equal(WebContents.prototype.send, originalSend);
});
