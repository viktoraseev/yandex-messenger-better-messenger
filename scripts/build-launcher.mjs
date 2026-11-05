import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

export const runtimeFiles = ['asar.mjs', 'cli.mjs', 'injection.mjs', 'inspector.mjs', 'message.mjs', 'renderer.mjs', 'supervisor.mjs', 'platform.mjs'];

export function launcherConfiguration({ nodePath, appPath, port = 9231, baseUrl = 'https://messenger.360.yandex.ru', routeFormat = 'hash' }) {
    if (!path.isAbsolute(nodePath) || !path.isAbsolute(appPath)) throw new Error('Launcher requires absolute Node and Messenger paths');
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid inspector port');
    return {
        nodePath, appPath: path.resolve(appPath),
        runtimeKey: createHash('sha256').update(`${path.resolve(appPath)}:${port}`).digest('hex').slice(0, 24),
        arguments: ['start', '--notify', '--app', path.resolve(appPath), '--port', String(port), '--base-url', baseUrl, '--route-format', routeFormat],
    };
}

export function buildLauncher(output, config, compile = execFileSync) {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const bundle = path.resolve(output);
    const bundleIdentifier = config.bundleIdentifier || 'local.better-messenger.launcher';
    if (!/^[a-zA-Z0-9.-]+$/.test(bundleIdentifier)) throw new Error('Invalid bundle identifier');
    if (path.extname(bundle) !== '.app' || fs.existsSync(bundle)) throw new Error('Output must be a new .app directory; existing bundles are not overwritten');
    fs.accessSync(config.nodePath, fs.constants.X_OK);
    fs.mkdirSync(path.dirname(bundle), { recursive: true });
    fs.mkdirSync(bundle);
    const contents = path.join(bundle, 'Contents');
    const resources = path.join(contents, 'Resources');
    fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
    fs.mkdirSync(path.join(resources, 'src'), { recursive: true });
    for (const filename of runtimeFiles) fs.copyFileSync(path.join(root, 'src', filename), path.join(resources, 'src', filename));
    fs.writeFileSync(path.join(resources, 'launcher.json'), JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    fs.writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>BetterMessenger</string>
<key>CFBundleIdentifier</key><string>${bundleIdentifier}</string>
<key>CFBundleName</key><string>Better Messenger</string>
<key>CFBundleDisplayName</key><string>Better Messenger</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${packageInfo.version}</string>
<key>CFBundleVersion</key><string>${packageInfo.version}</string>
<key>LSMinimumSystemVersion</key><string>12.0</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
<key>CFBundleURLTypes</key><array><dict>
<key>CFBundleURLName</key><string>${bundleIdentifier}</string>
<key>CFBundleURLSchemes</key><array><string>better-messenger</string></array>
</dict></array>
</dict></plist>
`);
    const sources = ['main.swift', 'links.swift'].map(file => path.join(root, 'launcher', file));
    compile('/usr/bin/xcrun', ['swiftc', '-O', '-framework', 'AppKit', ...sources, '-o', path.join(contents, 'MacOS/BetterMessenger')], { stdio: 'inherit' });
    return bundle;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const { values } = parseArgs({ options: {
        output: { type: 'string', default: 'dist/Better Messenger.app' },
        app: { type: 'string', default: '/Applications/Yandex Messenger.app' },
        node: { type: 'string', default: process.execPath },
        port: { type: 'string', default: '9231' },
    } });
    if (process.platform !== 'darwin') throw new Error('Building a launcher requires macOS and Xcode Command Line Tools');
    const config = launcherConfiguration({ nodePath: path.resolve(values.node), appPath: path.resolve(values.app), port: Number(values.port) });
    console.log(buildLauncher(values.output, config));
}
