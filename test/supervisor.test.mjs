import test from 'node:test';
import assert from 'node:assert/strict';
import { runSupervisor } from '../src/supervisor.mjs';

function fixture(overrides = {}) {
    const controller = new AbortController();
    const calls = { connects: 0, launches: 0, installs: 0, closes: 0, waits: [], notifications: [], events: [] };
    const inspector = { close: () => calls.closes++ };
    const effects = {
        connect: async () => { calls.connects++; return inspector; },
        running: async () => [42],
        launch: async () => calls.launches++,
        install: async () => { calls.installs++; return { identity: { version: '1.0' } }; },
        health: async () => ({ installed: true, disabled: true }),
        wait: async ms => calls.waits.push(ms),
        notify: async message => calls.notifications.push(message),
        report: event => calls.events.push(event),
        ...overrides,
    };
    const run = settings => runSupervisor({ launchOnStart: true, ...settings }, effects, controller.signal);
    return { controller, calls, effects, inspector, run };
}

const unavailable = () => { throw new Error('Inspector unavailable'); };

test('already inspected Messenger is attached without launching or notifications', async () => {
    const f = fixture();
    await f.run({ notifyUnavailable: true });
    assert.equal(f.calls.launches, 0);
    assert.equal(f.calls.installs, 1);
    assert.deepEqual(f.calls.waits, [5000]);
    assert.deepEqual(f.calls.notifications, []);
});

test('uninspected running Messenger is never closed or relaunched, and notified once', async () => {
    const f = fixture({ connect: unavailable });
    f.effects.wait = async () => { if (f.calls.notifications.length && ++f.calls.connects === 4) f.controller.abort(); };
    await f.run({ notifyUnavailable: true });
    assert.equal(f.calls.launches, 0);
    assert.equal(f.calls.notifications.length, 1);
    assert.match(f.calls.notifications[0], /закрой Messenger штатно/);
});

test('terminal start still refuses to disturb an uninspected running Messenger', async () => {
    const f = fixture({ connect: unavailable });
    await assert.rejects(f.run(), /Quit it normally/);
    assert.equal(f.calls.launches, 0);
});

test('another application on the inspector port is a fatal error, not a restart trigger', async () => {
    const error = Object.assign(new Error('Wrong app'), { code: 'ERR_INSPECTOR_IDENTITY' });
    const f = fixture({ connect: async () => { throw error; } });
    await assert.rejects(f.run({ notifyUnavailable: true }), error);
    assert.equal(f.calls.launches, 0);
    assert.equal(f.calls.notifications.length, 0);
});

test('first launch starts an inspected process only when Messenger is absent', async () => {
    const f = fixture({ running: async () => [] });
    let attempts = 0;
    f.effects.connect = async () => { if (++attempts === 1) unavailable(); return f.inspector; };
    await f.run({ notifyUnavailable: true });
    assert.equal(f.calls.launches, 1);
    assert.equal(f.calls.installs, 1);
});

test('a restarted inspected process is reconnected without launching another process', async () => {
    const f = fixture();
    let healthCalls = 0;
    f.effects.health = async () => { if (++healthCalls === 1) unavailable(); return { installed: true, disabled: true }; };
    await f.run({ notifyUnavailable: true });
    assert.equal(f.calls.installs, 2);
    assert.equal(f.calls.launches, 0);
    assert.equal(f.calls.notifications.length, 0);
});

test('a lost inspector after an update notifies once per new process, with no automatic launch', async () => {
    const f = fixture();
    let attempts = 0;
    let waits = 0;
    f.effects.connect = async () => { if (++attempts > 1) unavailable(); return f.inspector; };
    f.effects.health = unavailable;
    f.effects.running = async () => waits < 4 ? [43] : [44];
    f.effects.wait = async () => { if (++waits === 7) f.controller.abort(); };
    await f.run({ notifyUnavailable: true });
    assert.equal(f.calls.launches, 0);
    assert.equal(f.calls.notifications.length, 2);
});

test('normal Quit never resurrects Messenger', async () => {
    const f = fixture();
    let attempts = 0;
    let waits = 0;
    f.effects.connect = async () => { if (++attempts > 1) unavailable(); return f.inspector; };
    f.effects.health = unavailable;
    f.effects.running = async () => [];
    f.effects.wait = async () => { if (++waits === 4) f.controller.abort(); };
    await f.run({ notifyUnavailable: true });
    assert.equal(f.calls.launches, 0);
    assert.equal(f.calls.notifications.length, 0);
});

test('interrupt disconnects the supervisor without uninstalling the patch', async () => {
    const f = fixture();
    f.effects.wait = async () => { f.controller.abort(); throw new Error('Aborted'); };
    await f.run();
    assert.ok(f.calls.closes > 0);
    assert.equal(f.calls.installs, 1);
    assert.equal(f.calls.launches, 0);
});

test('a launched app without an inspector has a bounded initial wait', async () => {
    const f = fixture({ connect: unavailable, running: async () => [] });
    await assert.rejects(f.run(), /Inspector never became available/);
    assert.equal(f.calls.launches, 1);
    assert.equal(f.calls.waits.length, 14);
});
