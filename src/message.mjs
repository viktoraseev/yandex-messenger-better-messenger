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
