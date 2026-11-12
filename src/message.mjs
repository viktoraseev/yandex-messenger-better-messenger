export function buildMessageLink(key, configuration) {
    if (!key || typeof key.chatId !== 'string' || !key.chatId || key.chatId.length > 4096) {
        throw new Error('No message chat ID');
    }
    const timestamp = typeof key.timestamp === 'string' ? key.timestamp : String(key.timestamp);
    if (!/^\d{13,17}$/.test(timestamp) || Number(timestamp) < 1000000000000 ||
        (typeof key.timestamp === 'number' && !Number.isSafeInteger(key.timestamp))) {
        throw new Error('No valid persisted message timestamp');
    }
    const url = new URL(configuration.baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
        throw new Error('baseUrl must be an HTTPS URL without credentials, query or hash');
    }
    const route = `/chats/${encodeURIComponent(key.chatId)}/${timestamp}`;
    if (configuration.routeFormat === 'hash') return `${url.href.replace(/\/$/, '')}/#${route}`;
    if (configuration.routeFormat !== 'pathname') throw new Error('Unknown link route format');
    url.pathname = `${url.pathname.replace(/\/$/, '')}${route}`;
    return url.href;
}

export function findMessageInFiber(start) {
    const valid = value => Boolean(value && typeof value.chatId === 'string' && value.chatId &&
        (typeof value.timestamp === 'number' || typeof value.timestamp === 'string'));
    const seen = new Set();
    let fiber = start;
    for (let depth = 0; fiber && depth < 100 && !seen.has(fiber); depth++, fiber = fiber.return) {
        seen.add(fiber);
        const props = fiber.memoizedProps;
        if (!props || typeof props !== 'object') continue;
        for (const candidate of [props.message, props.detachedMessage, props.messageKey, props]) {
            if (valid(candidate)) return { chatId: candidate.chatId, timestamp: candidate.timestamp };
        }
    }
    return null;
}

/// Messenger 3.31.0 opens a ychat: join link to a thread message only as a thread panel over the chat on screen.
/// Its router route /join/<invite hash>/<timestamp>/<thread message timestamp> does what the web app does: opens the
/// chat with the thread's root message highlighted, then the thread at the reply. Returns that route for such a
/// link in the Telemost (ychat://<host>/join#...) or Messenger (ychat://<host>/#/join/...) format, otherwise null.
export function threadRoute(link) {
    let url;
    try { url = new URL(link); } catch { return null; }
    if (url.protocol !== 'ychat:') return null;
    const fragment = url.hash.slice(1);
    const join = /^\/join\/?$/.test(url.pathname) ? fragment
        : (url.pathname === '/' || url.pathname === '') && fragment.startsWith('/join/') ? fragment.slice('/join/'.length) : null;
    const parts = join === null ? null : /^([A-Za-z0-9-]{1,128})\/(\d{13,17})\/(\d{13,17})$/.exec(join);
    return parts ? `/join/${parts[1]}/${parts[2]}/${parts[3]}` : null;
}
