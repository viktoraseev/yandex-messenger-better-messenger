export function assertLoopbackUrl(value, websocket = false) {
    const url = new URL(value);
    const expected = websocket ? 'ws:' : 'http:';
    if (url.protocol !== expected || url.hostname !== '127.0.0.1' || url.username || url.password) {
        throw new Error('Only unauthenticated 127.0.0.1 inspector endpoints are allowed');
    }
    return url;
}

export async function discover(port) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500), redirect: 'error' });
    if (!response.ok) throw new Error(`Inspector HTTP ${response.status}`);
    const targets = await response.json();
    const target = targets.find(item => item.type === 'node' && item.webSocketDebuggerUrl);
    if (!target) throw new Error('No Electron main-process inspector target');
    const url = assertLoopbackUrl(target.webSocketDebuggerUrl, true);
    if (Number(url.port) !== port) throw new Error('Inspector advertised a different port');
    return url.href;
}

export class Inspector {
    pending = new Map();
    sequence = 0;

    async connect(url) {
        assertLoopbackUrl(url, true);
        this.socket = new WebSocket(url);
        this.socket.addEventListener('message', event => {
            const message = JSON.parse(event.data);
            const request = this.pending.get(message.id);
            if (!request) return;
            this.pending.delete(message.id);
            clearTimeout(request.timer);
            if (message.error) request.reject(new Error(message.error.message));
            else request.resolve(message.result);
        });
        this.socket.addEventListener('close', () => {
            for (const request of this.pending.values()) {
                clearTimeout(request.timer);
                request.reject(new Error('Inspector disconnected'));
            }
            this.pending.clear();
        });
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.socket.close(); reject(new Error('Inspector connection timed out')); }, 5000);
            this.socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
            this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Inspector connection failed')); }, { once: true });
        });
    }

    send(method, params = {}) {
        if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Inspector is not connected'));
        const id = ++this.sequence;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Inspector request timed out: ${method}`));
            }, 10000);
            this.pending.set(id, { resolve, reject, timer });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }

    async evaluate(expression) {
        const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result?.value;
    }

    close() {
        this.socket?.close();
    }
}
