import fs from 'node:fs';
import path from 'node:path';

export function readAsarFile(archive, name) {
    const fd = fs.openSync(archive, 'r');
    try {
        const prefix = Buffer.alloc(16);
        if (fs.readSync(fd, prefix, 0, 16, 0) !== 16) throw new Error('Invalid ASAR prefix');
        const headerLength = prefix.readUInt32LE(12);
        if (headerLength > 32 * 1024 * 1024) throw new Error('ASAR header is too large');
        const raw = Buffer.alloc(headerLength);
        if (fs.readSync(fd, raw, 0, raw.length, 16) !== raw.length) throw new Error('Incomplete ASAR header');
        let entry = JSON.parse(raw.toString());
        const parts = name.split('/');
        if (parts.some(part => !part || part === '.' || part === '..')) throw new Error('Invalid archive path');
        for (const part of parts) entry = entry?.files?.[part];
        if (!entry || entry.files || entry.link) throw new Error(`Not a regular ASAR file: ${name}`);
        if (entry.unpacked) return fs.readFileSync(path.join(`${archive}.unpacked`, ...parts));
        if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 64 * 1024 * 1024) {
            throw new Error('ASAR entry is too large');
        }
        const data = Buffer.alloc(entry.size);
        const offset = 8 + prefix.readUInt32LE(4) + Number(entry.offset);
        if (!Number.isSafeInteger(offset) || offset < 16 + headerLength) throw new Error('Invalid ASAR offset');
        if (fs.readSync(fd, data, 0, data.length, offset) !== data.length) throw new Error('Incomplete ASAR entry');
        return data;
    } finally {
        fs.closeSync(fd);
    }
}

export function inspectApp(appPath) {
    const archive = path.join(appPath, 'Contents/Resources/app.asar');
    const pkg = JSON.parse(readAsarFile(archive, 'package.json').toString());
    const binary = path.join(appPath, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework');
    const bytes = fs.readFileSync(binary);
    const sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
    const fuses = [];
    let from = 0;
    while (true) {
        const offset = bytes.indexOf(sentinel, from);
        if (offset < 0) break;
        const start = offset + sentinel.length;
        const version = bytes[start];
        const states = bytes.subarray(start + 2, start + 2 + bytes[start + 1]).toString();
        fuses.push({ version, states, nodeCliInspect: states[3] === '1', asarIntegrity: states[4] === '1' });
        from = start + 2;
    }
    return { appPath, version: pkg.version, main: pkg.main, fuses };
}
