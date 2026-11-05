import path from 'node:path';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export function messengerPids(appPath) {
    const executable = path.join(appPath, 'Contents/MacOS/Yandex Messenger');
    return execFileSync('/bin/ps', ['-axo', 'pid=,comm='], { encoding: 'utf8', timeout: 5000 })
        .split('\n').flatMap(line => {
            const match = /^\s*(\d+)\s+(.+)$/.exec(line);
            return match && match[2] === executable ? [Number(match[1])] : [];
        });
}

export async function launchMessenger(appPath, port) {
    const executable = path.join(appPath, 'Contents/MacOS/Yandex Messenger');
    const child = spawn(executable, [`--inspect=127.0.0.1:${port}`], { detached: true, stdio: 'ignore' });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
}

export async function notifyUnavailable(message) {
    try {
        await execute('/usr/bin/osascript', ['-e', 'on run argv\n display notification (item 1 of argv) with title "Better Messenger"\nend run', message], { timeout: 10000 });
    } catch (error) {
        console.error(`Notification could not be delivered: ${error.message}`);
    }
}
