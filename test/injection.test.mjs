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
