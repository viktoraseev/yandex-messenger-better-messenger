export function installRenderer(options) {
    const previous = window.__betterMessenger;
    previous?.uninstall?.();
    let disposed = false;
    let activeKey = null;
    let lastPoint = null;
    let fallbackTimer;
    let fallback;
    let notice;
    let noticeTimer;
    let observer;
    const inserted = new Set();
    const buttonKeys = new Map();
    const replacedMenus = new Set();
    const counters = { menuInsertions: 0, fallbackInsertions: 0, copies: 0, unresolved: 0 };
    const marker = 'data-better-messenger';
    const replacementMarker = 'data-better-messenger-replaced';
    const nativeLinks = '[data-test-tag="message-menu-copy-message-join-link"], [data-test-tag="message-menu-copy-message-link"]';
    const actionSelector = '[data-test-tag^="message-menu-"], [data-test-tag^="thread-context-menu-"]';
    const style = document.createElement('style');
    style.setAttribute(marker, 'style');
    style.textContent = `[${replacementMarker}] [data-test-tag="message-menu-copy-message-join-link"], [${replacementMarker}] [data-test-tag="message-menu-copy-message-link"] { display: none !important; }`;
    (document.head || document.body).appendChild(style);
    inserted.add(style);

    function findKey(element) {
        let current = element instanceof Element ? element : element?.parentElement;
        for (let depth = 0; current && depth < 30; depth++, current = current.parentElement) {
            const fiberProperty = Object.getOwnPropertyNames(current).find(name => name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$'));
            if (!fiberProperty) continue;
            const key = findMessageInFiber(current[fiberProperty]);
            if (key) return key;
        }
        return null;
    }

    function showNotice(text) {
        notice?.remove();
        clearTimeout(noticeTimer);
        notice = document.createElement('div');
        notice.setAttribute(marker, 'notice');
        notice.setAttribute('role', 'status');
        notice.textContent = text;
        notice.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#262626;color:white;padding:10px 16px;border-radius:8px;font:13px system-ui;box-shadow:0 4px 20px #0005';
        document.body.appendChild(notice);
        noticeTimer = setTimeout(() => { notice?.remove(); notice = null; }, 2400);
    }

    async function copy(key, button) {
        try {
            const link = buildMessageLink(key, options);
            await navigator.clipboard.writeText(link);
            counters.copies++;
            showNotice('Message link copied');
            dismissFallback();
            if (button?.isConnected && typeof KeyboardEvent !== 'undefined') {
                button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
            }
        } catch (error) {
            showNotice(`Better Messenger: ${error.message}`);
        }
    }

    function createButton(key, sample) {
        const nativeItem = sample?.tagName === 'LI';
        const button = nativeItem ? sample.cloneNode(true) : document.createElement('button');
        if (nativeItem) {
            for (const element of [button, ...button.querySelectorAll('*')]) {
                for (const attribute of ['id', 'data-key', 'data-navkey', 'data-testid', 'data-test-tag', 'aria-labelledby', 'aria-describedby', 'data-react-aria-pressable']) {
                    element.removeAttribute(attribute);
                }
            }
            const label = button.querySelector('.Orb-ListBoxItem-LabelWrapper');
            if (label) (label.firstElementChild || label).textContent = 'Link to message';
            else button.textContent = 'Link to message';
        } else {
            button.type = 'button';
            button.textContent = 'Link to message';
        }
        button.setAttribute(marker, 'link');
        button.setAttribute('data-test-tag', 'better-messenger-link');
        button.setAttribute('role', 'menuitem');
        button.setAttribute('tabindex', '0');
        button.setAttribute('aria-label', 'Link to message');
        button.setAttribute('aria-disabled', 'false');
        button.setAttribute('data-disabled', 'false');
        button.setAttribute('data-active', 'false');
        button.title = 'Copy direct link to this message';
        const iconSlot = button.querySelector('.Orb-ListBoxItem-StartSlot');
        if (iconSlot && document.createElementNS) {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            for (const [name, value] of Object.entries({ width: '16', height: '16', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'aria-hidden': 'true' })) svg.setAttribute(name, value);
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M10 13a5 5 0 0 0 7.1 0l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7M14 11a5 5 0 0 0-7.1 0l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7');
            svg.appendChild(path);
            iconSlot.replaceChildren(svg);
        }
        if (sample) button.className = sample.className;
        button.style.cssText = nativeItem ? 'cursor:pointer' : 'display:flex;align-items:center;width:100%;min-height:36px;padding:8px 12px;border:0;border-radius:4px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;flex-shrink:0';
        button.addEventListener('pointerenter', () => { button.style.background = 'rgba(127,127,127,.16)'; });
        button.addEventListener('pointerleave', () => { button.style.background = 'transparent'; });
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopImmediatePropagation();
            copy(buttonKeys.get(button), button);
        });
        button.addEventListener('keydown', event => {
            if (event.key === 'Escape') dismissFallback();
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopImmediatePropagation();
                copy(buttonKeys.get(button), button);
            }
        });
        inserted.add(button);
        buttonKeys.set(button, key);
        return button;
    }

    function dismissFallback() {
        fallback?.remove();
        fallback = null;
    }

    function addToMenus() {
        if (disposed || !document.body) return false;
        for (const element of inserted) if (!element.isConnected) { inserted.delete(element); buttonKeys.delete(element); }
        for (const menu of replacedMenus) if (!menu.isConnected) { menu.removeAttribute(replacementMarker); replacedMenus.delete(menu); }
        let found = false;
        for (const menu of document.querySelectorAll('.message-menu__menu, .yamb-message-menu__menu, .ui-menu-orb, [role="menu"]')) {
            if (menu.getAttribute(marker)) continue;
            if (!menu.querySelector(actionSelector) && !String(menu.className).split(' ').some(name => name === 'message-menu__menu' || name === 'yamb-message-menu__menu')) continue;
            found = true;
            const key = findKey(menu) || activeKey;
            if (!key) { counters.unresolved++; continue; }
            try { buildMessageLink(key, options); } catch { continue; }
            const sample = menu.querySelector(nativeLinks) || menu.querySelector(actionSelector + ', [role="menuitem"]');
            const container = sample?.closest('.ui-menu-scroller__content') || menu.querySelector('.ui-menu-scroller__content') || menu;
            let button = menu.querySelector(`[${marker}="link"]`);
            if (!button) { button = createButton(key, sample); counters.menuInsertions++; }
            buttonKeys.set(button, key);
            if (container.firstElementChild !== button) container.prepend(button);
            menu.setAttribute(replacementMarker, 'true');
            replacedMenus.add(menu);
        }
        if (found) dismissFallback();
        return found;
    }

    function onContextMenu(event) {
        if (event.target instanceof Element && event.target.closest(`[${marker}]`)) return;
        clearTimeout(fallbackTimer);
        dismissFallback();
        const messageElement = event.target instanceof Element && event.target.closest('.message, .message-row, .yamb-message-row, .yamb-threads-list-item');
        activeKey = messageElement ? findKey(event.target) : null;
        lastPoint = { x: event.clientX, y: event.clientY };
        if (!activeKey) return;
        try { buildMessageLink(activeKey, options); } catch { activeKey = null; return; }
        const key = activeKey;
        fallbackTimer = setTimeout(() => {
            if (disposed || addToMenus()) return;
            fallback = document.createElement('div');
            fallback.setAttribute(marker, 'fallback');
            fallback.setAttribute('role', 'menu');
            const x = Math.max(8, Math.min(lastPoint.x, window.innerWidth - 230));
            const y = Math.max(8, Math.min(lastPoint.y, window.innerHeight - 60));
            fallback.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:2147483646;width:220px;padding:4px;background:#262626;color:white;border:1px solid #7775;border-radius:8px;box-shadow:0 4px 20px #0005;font:13px system-ui`;
            fallback.appendChild(createButton(key));
            document.body.appendChild(fallback);
            counters.fallbackInsertions++;
        }, 250);
    }

    function onPointerDown(event) {
        if (event.target instanceof Element && !event.target.closest(`[${marker}]`)) {
            clearTimeout(fallbackTimer);
            dismissFallback();
        }
    }

    function onKeyDown(event) {
        if (event.key === 'Escape') { clearTimeout(fallbackTimer); dismissFallback(); }
    }

    function uninstall() {
        disposed = true;
        observer?.disconnect();
        clearTimeout(fallbackTimer);
        clearTimeout(noticeTimer);
        document.removeEventListener('contextmenu', onContextMenu, true);
        document.removeEventListener('pointerdown', onPointerDown, true);
        document.removeEventListener('keydown', onKeyDown, true);
        dismissFallback();
        notice?.remove();
        for (const element of inserted) element.remove();
        inserted.clear();
        buttonKeys.clear();
        for (const menu of replacedMenus) menu.removeAttribute(replacementMarker);
        replacedMenus.clear();
        if (window.__betterMessenger?.uninstall === uninstall) delete window.__betterMessenger;
    }

    document.addEventListener('contextmenu', onContextMenu, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    observer = new MutationObserver(addToMenus);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.__betterMessenger = {
        uninstall,
        status: () => ({ version: '0.2.0', ...counters, messageResolved: Boolean(activeKey), routeFormat: options.routeFormat, baseUrl: options.baseUrl }),
    };
    addToMenus();
    return window.__betterMessenger.status();
}
