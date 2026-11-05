export async function runSupervisor({ launchOnStart, notifyUnavailable = false, interval = 5000 }, effects, signal) {
    let inspector;
    let connectedOnce = false;
    let launched = false;
    let failures = 0;
    const notified = new Set();
    const close = () => inspector?.close();
    signal.addEventListener('abort', close);
    const notifyRunning = async () => {
        const running = await effects.running();
        if (!running.length) return running;
        const key = running.join(',');
        if (!notified.has(key)) {
            notified.add(key);
            await effects.notify('Messenger запущен без доступного inspector. Чтобы вернуть Link to message, закрой Messenger штатно и открой Better Messenger. Не перезапускай его во время звонка.');
        }
        return running;
    };
    try {
        if (launchOnStart) {
            try {
                inspector = await effects.connect();
            } catch (error) {
                if (error.code === 'ERR_INSPECTOR_IDENTITY' || signal.aborted) throw error;
                if ((await effects.running()).length) {
                    if (!notifyUnavailable) throw new Error('Messenger is running without our inspector. Quit it normally, then run start again.');
                    await notifyRunning();
                } else {
                    await effects.launch();
                    launched = true;
                    effects.report({ event: 'launched' });
                }
            }
        }
        while (!signal.aborted) {
            try {
                inspector ||= await effects.connect();
                if (signal.aborted) break;
                effects.report({ event: 'installed', ...await effects.install(inspector) });
                connectedOnce = true;
                failures = 0;
                while (!signal.aborted) {
                    await effects.wait(interval, signal);
                    if (signal.aborted) break;
                    const status = await effects.health(inspector);
                    if (status.disabled) return;
                    if (!status.installed) break;
                }
            } catch (error) {
                if (signal.aborted) break;
                if (error.code === 'ERR_INSPECTOR_IDENTITY') throw error;
                if (++failures === 1 || failures % 10 === 0) effects.report({ event: 'waiting', error: error.message });
                if (notifyUnavailable && failures >= 2) await notifyRunning();
                if (launched && !connectedOnce && failures >= 15) throw new Error('Inspector never became available. Messenger files were not changed.');
            } finally {
                inspector?.close();
                inspector = undefined;
            }
            if (!signal.aborted) await effects.wait(interval, signal);
        }
    } catch (error) {
        if (!signal.aborted) throw error;
    } finally {
        inspector?.close();
        signal.removeEventListener('abort', close);
    }
}
