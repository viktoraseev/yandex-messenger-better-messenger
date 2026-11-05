import { buildMessageLink, findMessageInFiber } from './message.mjs';
import { installRenderer } from './renderer.mjs';

export const electronExpression = `(typeof require === 'function' ? require('electron') : process.mainModule.require('electron'))`;

export function rendererSource(options) {
    return `(() => { ${buildMessageLink.toString()}\n${findMessageInFiber.toString()}\nreturn (${installRenderer.toString()})(${JSON.stringify(options)}); })()`;
}

export function installExpression(options) {
    const source = rendererSource(options);
    return `(async () => {
        const electron = ${electronExpression};
        const identity = { name: electron.app.getName(), version: electron.app.getVersion() };
        if (!/^(chats|q|Yandex Messenger|Яндекс Мессенджер)$/i.test(identity.name)) throw new Error('Not a recognized Messenger main process');
        if (electron.app.getAppPath() !== ${JSON.stringify(options.appPath + '/Contents/Resources/app.asar')}) throw new Error('Inspector belongs to a different Messenger installation');
        const source = ${JSON.stringify(source)};
        if (globalThis.__betterMessengerMain?.source === source) return { identity, alreadyInstalled: true };
        await globalThis.__betterMessengerMain?.dispose?.();
        globalThis.__betterMessengerDisabled = false;
        const attached = new Map();
        let disposed = false;
        const isMessenger = webContents => {
            if (webContents.isDestroyed() || webContents.getType() !== 'window') return false;
            try {
                const url = new URL(webContents.getURL());
                return url.hostname === 'files' && ['/www/index.html', '/www/index-external.html', '/index.html', '/index-external.html'].includes(url.pathname);
            } catch { return false; }
        };
        const apply = async webContents => {
            if (disposed || !isMessenger(webContents)) return null;
            return webContents.executeJavaScript(source, true);
        };
        const attach = webContents => {
            if (attached.has(webContents.id)) return;
            const loaded = () => { apply(webContents).catch(() => {}); };
            const destroyed = () => { attached.delete(webContents.id); };
            attached.set(webContents.id, { webContents, loaded, destroyed });
            webContents.on('did-finish-load', loaded);
            webContents.once('destroyed', destroyed);
        };
        const created = (_, webContents) => attach(webContents);
        electron.app.on('web-contents-created', created);
        for (const webContents of electron.webContents.getAllWebContents()) attach(webContents);
        const dispose = async () => {
            disposed = true;
            electron.app.removeListener('web-contents-created', created);
            for (const { webContents, loaded, destroyed } of attached.values()) {
                if (webContents.isDestroyed()) continue;
                webContents.removeListener('did-finish-load', loaded);
                webContents.removeListener('destroyed', destroyed);
                if (isMessenger(webContents)) await webContents.executeJavaScript('window.__betterMessenger?.uninstall?.()', true).catch(() => {});
            }
            attached.clear();
            delete globalThis.__betterMessengerMain;
        };
        globalThis.__betterMessengerMain = { dispose, version: '0.2.0', identity, source };
        const windows = [];
        for (const webContents of electron.webContents.getAllWebContents()) {
            if (!isMessenger(webContents)) continue;
            windows.push({ id: webContents.id, status: await apply(webContents) });
        }
        return { identity, windows };
    })()`;
}

export function healthExpression() {
    return '({ installed: Boolean(globalThis.__betterMessengerMain), disabled: Boolean(globalThis.__betterMessengerDisabled) })';
}

export function statusExpression() {
    return `(async () => {
        const electron = ${electronExpression};
        const windows = [];
        for (const webContents of electron.webContents.getAllWebContents()) {
            if (webContents.isDestroyed() || webContents.getType() !== 'window') continue;
            const status = await webContents.executeJavaScript('window.__betterMessenger?.status?.() ?? null', true).catch(() => null);
            if (status) windows.push({ id: webContents.id, status });
        }
        return { installed: Boolean(globalThis.__betterMessengerMain), disabled: Boolean(globalThis.__betterMessengerDisabled), windows };
    })()`;
}
