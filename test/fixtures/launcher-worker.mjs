import fs from 'node:fs';
import path from 'node:path';

if (process.argv.includes('--app') && process.argv.includes('--parent-pid')) {
    const value = name => process.argv[process.argv.indexOf(name) + 1];
    const directory = path.dirname(value('--app'));
    fs.appendFileSync(path.join(directory, 'workers.jsonl'), JSON.stringify({ pid: process.pid, parent: process.ppid }) + '\n', { mode: 0o600 });
    const parentPid = Number(value('--parent-pid'));
    process.once('SIGINT', () => process.exit(0));
    process.once('SIGTERM', () => process.exit(0));
    setInterval(() => { if (process.ppid !== parentPid) process.exit(0); }, 100);
}
