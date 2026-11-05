import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { inspectApp } from './asar.mjs';
import { buildMessageLink } from './message.mjs';
import { Inspector, discover } from './inspector.mjs';
import { electronExpression, installExpression, statusExpression, healthExpression } from './injection.mjs';
import { runSupervisor } from './supervisor.mjs';
import { messengerPids, launchMessenger, notifyUnavailable } from './platform.mjs';

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        app: { type: 'string', default: '/Applications/Yandex Messenger.app' },
        port: { type: 'string', default: '9231' },
        'base-url': { type: 'string', default: 'https://messenger.360.yandex.ru' },
        'route-format': { type: 'string', default: 'hash' },
        notify: { type: 'boolean', default: false },
        'parent-pid': { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
    },
});
const command = positionals[0] || 'help';
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid inspector port');
const options = { appPath: path.resolve(values.app), baseUrl: values['base-url'], routeFormat: values['route-format'] };

function help() {
    console.log(`Better Messenger prototype (Node >=22, macOS)\n\nCommands:\n  inspect   Read installed app version and Electron fuses\n  start     Launch Messenger with a loopback inspector; supervise injection\n  attach    Inject into an already inspector-enabled Messenger; supervise reconnects\n  reload    Apply the current source once, without restarting Messenger\n  status    Print metadata/counters, not message text\n  stop      Remove injected UI/listeners; restore native links; leave Messenger running\n\nOptions:\n  --app PATH            Default: /Applications/Yandex Messenger.app\n  --port NUMBER         Default: 9231; bound to 127.0.0.1\n  --base-url HTTPS_URL  Default: https://messenger.360.yandex.ru\n  --route-format FORMAT hash (default) or pathname\n\nThe direct-link item replaces native join/share links and is always first.\nClose Messenger normally before start. No app files or messages are modified.\nCtrl+C disconnects the supervisor; the patch remains until stop or app exit.`);
}

async function connect() {
    const inspector = new Inspector();
    await inspector.connect(await discover(port));
    try {
        const actual = await inspector.evaluate(`${electronExpression}.app.getAppPath()`);
        if (actual !== path.join(options.appPath, 'Contents/Resources/app.asar')) {
            const error = new Error('Inspector belongs to a different application');
            error.code = 'ERR_INSPECTOR_IDENTITY';
            throw error;
        }
    } catch (error) {
        inspector.close();
        throw error;
    }
    return inspector;
}

async function supervise(launch) {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    buildMessageLink({ chatId: 'validation', timestamp: '1700000000000000' }, options);
    const info = inspectApp(values.app);
    if (info.fuses.some(fuse => fuse.version === 1 && !fuse.nodeCliInspect)) throw new Error('Electron main-process inspection is disabled');
    if (!fs.existsSync(path.join(options.appPath, 'Contents/MacOS/Yandex Messenger'))) throw new Error('Messenger executable not found');
    const parentPid = values['parent-pid'] && Number(values['parent-pid']);
    if (values['parent-pid'] !== undefined && (!Number.isSafeInteger(parentPid) || parentPid < 1)) throw new Error('Invalid launcher parent PID');
    try {
        await runSupervisor({ launchOnStart: launch, notifyUnavailable: values.notify }, {
            connect,
            running: () => messengerPids(options.appPath),
            launch: () => launchMessenger(options.appPath, port),
            install: inspector => inspector.evaluate(installExpression(options)),
            health: inspector => inspector.evaluate(healthExpression()),
            notify: message => { console.error(message); return notifyUnavailable(message); },
            report: event => console.log(JSON.stringify(event)),
            wait: async (ms, signal) => {
                await delay(ms, undefined, { signal });
                if (parentPid && process.ppid !== parentPid) controller.abort();
            },
        }, controller.signal);
    } finally {
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
    }
}

try {
    if (values.help || command === 'help') help();
    else if (command === 'inspect') console.log(JSON.stringify(inspectApp(values.app), null, 2));
    else if (command === 'start' || command === 'attach') await supervise(command === 'start');
    else if (command === 'status' || command === 'stop' || command === 'reload') {
        const inspector = await connect();
        try {
            if (command === 'stop') await inspector.evaluate('(async () => { await globalThis.__betterMessengerMain?.dispose?.(); globalThis.__betterMessengerDisabled = true; })()');
            if (command === 'reload') await inspector.evaluate(installExpression(options));
            console.log(JSON.stringify(await inspector.evaluate(statusExpression()), null, 2));
        } finally { inspector.close(); }
    } else throw new Error(`Unknown command: ${command}`);
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
