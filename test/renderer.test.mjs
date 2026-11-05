import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { rendererSource } from '../src/injection.mjs';

function fixture({ nativeLink = false, legacyFiber = false, withMenu = true, threadMenu = false } = {}) {
    const listeners = new Map();
    const timers = new Map();
    const clipboard = [];
    let timerId = 0;
    let observer;
    function matches(element, selector) {
        return selector.split(',').some(part => {
            const rule = part.trim();
            if (rule === '*') return true;
            if (rule.startsWith('.')) return element.className.split(' ').includes(rule.slice(1));
            const attribute = /^\[([^\]^=]+)(\^?=)?(?:"([^"]*)")?\]$/.exec(rule);
            if (!attribute) return false;
            const value = element.getAttribute(attribute[1]);
            if (!attribute[2]) return value !== null;
            return attribute[2] === '^=' ? value?.startsWith(attribute[3]) : value === attribute[3];
        });
    }
    class Element {
        children = [];
        attributes = new Map();
        events = new Map();
        style = {};
        className = '';
        parentElement = null;
        constructor(tag = 'DIV') { this.tagName = tag.toUpperCase(); }
        get isConnected() { return this === body || Boolean(this.parentElement?.isConnected); }
        get firstElementChild() { return this.children[0] || null; }
        setAttribute(key, value) { this.attributes.set(key, value); }
        getAttribute(key) { return this.attributes.get(key) ?? null; }
        removeAttribute(key) { this.attributes.delete(key); }
        appendChild(child) { child.remove(); child.parentElement = this; this.children.push(child); return child; }
        prepend(child) { child.remove(); child.parentElement = this; this.children.unshift(child); }
        remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
        addEventListener(type, callback) { this.events.set(type, callback); }
        closest(selector) { return matches(this, selector) ? this : this.parentElement?.closest(selector); }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
        querySelectorAll(selector) {
            return this.children.flatMap(child => [...(matches(child, selector) ? [child] : []), ...child.querySelectorAll(selector)]);
        }
        cloneNode(deep) {
            const copy = new Element(this.tagName); copy.className = this.className;
            copy.attributes = new Map(this.attributes); copy.textContent = this.textContent;
            if (deep) for (const child of this.children) copy.appendChild(child.cloneNode(true));
            return copy;
        }
    }
    const body = new Element();
    const menu = new Element('UL');
    menu.className = threadMenu ? 'ui-menu-orb' : 'message-menu__menu';
    menu.setAttribute('role', 'menu');
    const container = new Element(); container.className = 'ui-menu-scroller__content';
    menu.appendChild(container);
    const sample = new Element('LI'); sample.className = 'Orb-ListBoxItem ui-menu-item-orb';
    sample.setAttribute('data-test-tag', threadMenu ? 'thread-context-menu-mark-unseen' : 'message-menu-reply');
    sample.setAttribute('role', 'menuitem');
    sample.setAttribute('data-navkey', 'native-key');
    const label = new Element(); label.className = 'Orb-ListBoxItem-LabelWrapper';
    label.textContent = 'Native action'; sample.appendChild(label);
    if (withMenu) body.appendChild(menu);
    container.appendChild(sample);
    let originalLink;
    if (nativeLink) {
        originalLink = sample.cloneNode(true);
        originalLink.setAttribute('data-test-tag', 'message-menu-copy-message-join-link');
        container.appendChild(originalLink);
    }
    const key = { chatId: '100/0/group_1690000000000000', timestamp: 1700000000000000 };
    menu.__reactFiber$fixture = { memoizedProps: threadMenu ? { messageKey: key } : { message: key } };
    const target = new Element(); target.className = 'message'; body.appendChild(target);
    target[legacyFiber ? '__reactInternalInstance$fixture' : '__reactFiber$fixture'] = {
        memoizedProps: { detachedMessage: { chatId: '0/0/group', timestamp: 1690000000000000 } },
    };
    const document = {
        body, documentElement: body,
        createElement: tag => new Element(tag),
        querySelectorAll: selector => body.querySelectorAll(selector),
        addEventListener: (type, callback) => listeners.set(type, callback),
        removeEventListener: (type, callback) => { if (listeners.get(type) === callback) listeners.delete(type); },
    };
    const window = { innerWidth: 1000, innerHeight: 800 };
    const context = vm.createContext({
        window, document, Element, URL, console,
        navigator: { clipboard: { writeText: async text => clipboard.push(text) } },
        MutationObserver: class {
            constructor(callback) { this.callback = callback; observer = this; }
            observe() { this.connected = true; }
            disconnect() { this.connected = false; }
        },
        setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
        clearTimeout: id => timers.delete(id),
    });
    const install = options => vm.runInContext(rendererSource({ baseUrl: 'https://messenger.360.yandex.ru', routeFormat: 'hash', ...options }), context);
    const dispatch = (type, event) => listeners.get(type)?.(event);
    const flush = () => { const pending = [...timers.values()]; timers.clear(); for (const callback of pending) callback(); };
    return { install, dispatch, flush, window, menu, container, sample, originalLink, body, target, clipboard, listeners, get observer() { return observer; } };
}

test('missing native thread link is added using the open menu message', async () => {
    const f = fixture(); f.install();
    const button = f.container.firstElementChild;
    assert.ok(button);
    button.events.get('click')({ preventDefault() {}, stopImmediatePropagation() {} });
    await Promise.resolve();
    assert.equal(f.clipboard[0], 'https://messenger.360.yandex.ru/#/chats/100%2F0%2Fgroup_1690000000000000/1700000000000000');
});

test('native join link is replaced by one direct link at the first position', () => {
    const f = fixture({ nativeLink: true }); f.install();
    assert.equal(f.window.__betterMessenger.status().menuInsertions, 1);
    assert.equal(f.menu.getAttribute('data-better-messenger-replaced'), 'true');
    assert.equal(f.container.firstElementChild.getAttribute('data-better-messenger'), 'link');
    assert.equal(f.container.firstElementChild.getAttribute('data-navkey'), null);
    assert.ok(f.originalLink.isConnected);
    f.window.__betterMessenger.uninstall();
    assert.equal(f.menu.getAttribute('data-better-messenger-replaced'), null);
    assert.ok(f.originalLink.isConnected);
});

test('Threads list menu is extended in place, without a fallback overlay', () => {
    const f = fixture({ threadMenu: true }); f.install();
    f.dispatch('contextmenu', { target: f.target, clientX: 50, clientY: 50 }); f.flush();
    assert.equal(f.container.firstElementChild.getAttribute('data-better-messenger'), 'link');
    assert.equal(f.window.__betterMessenger.status().fallbackInsertions, 0);
});

test('an existing menu reused for another message copies the new message key', async () => {
    const f = fixture(); f.install();
    f.menu.__reactFiber$fixture.memoizedProps.message.timestamp = 1700000000000001;
    f.observer.callback();
    f.container.firstElementChild.events.get('click')({ preventDefault() {}, stopImmediatePropagation() {} });
    await Promise.resolve();
    assert.match(f.clipboard[0], /\/1700000000000001$/);
    assert.equal(f.window.__betterMessenger.status().menuInsertions, 1);
});

test('header gets a fallback when the app opens no menu, including React 16', async () => {
    const f = fixture({ withMenu: false, legacyFiber: true }); f.install();
    f.dispatch('contextmenu', { target: f.target, clientX: 900, clientY: 700 });
    f.flush();
    const fallback = f.body.children.find(child => child.getAttribute('data-better-messenger') === 'fallback');
    assert.ok(fallback);
    fallback.children[0].events.get('click')({ preventDefault() {}, stopImmediatePropagation() {} });
    await Promise.resolve();
    assert.equal(f.clipboard[0], 'https://messenger.360.yandex.ru/#/chats/0%2F0%2Fgroup/1690000000000000');
});

test('reinstallation is idempotent and uninstall removes all listeners/UI', () => {
    const f = fixture(); f.install(); f.install();
    assert.equal(f.container.children.filter(child => child.getAttribute('data-better-messenger') === 'link').length, 1);
    assert.equal(f.listeners.size, 3);
    f.window.__betterMessenger.uninstall();
    assert.equal(f.listeners.size, 0);
    assert.equal(f.observer.connected, false);
    assert.equal(f.container.children.filter(child => child.getAttribute('data-better-messenger') === 'link').length, 0);
    assert.equal(f.window.__betterMessenger, undefined);
});

test('Escape dismisses a pending fallback without copying', () => {
    const f = fixture({ withMenu: false }); f.install();
    f.dispatch('contextmenu', { target: f.target, clientX: 20, clientY: 20 });
    f.dispatch('keydown', { key: 'Escape' }); f.flush();
    assert.equal(f.window.__betterMessenger.status().fallbackInsertions, 0);
    assert.equal(f.clipboard.length, 0);
});
