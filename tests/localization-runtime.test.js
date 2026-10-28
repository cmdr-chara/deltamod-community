// SPDX-FileCopyrightText: 2026 cmdr-chara
// SPDX-License-Identifier: EUPL-1.2
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../web/modules/localization.js'), 'utf8');
const root = path.join(__dirname, '../web/langs');

function testDocument() {
    const makeNode = (nodeType, value = '') => {
        const attributes = new Map();
        const node = {
            nodeType, nodeValue: value, childNodes: [], parentNode: null,
            get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; },
            get isConnected() { return this.nodeType === 9 || Boolean(this.parentNode?.isConnected); },
            get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(child => child.textContent).join(''); },
            set textContent(text) {
                this.childNodes.forEach(child => { child.parentNode = null; });
                this.childNodes = [];
                if (String(text)) this.append(makeNode(3, String(text)));
            },
            append(child) { child.parentNode = this; this.childNodes.push(child); },
            contains(child) { return this === child || this.childNodes.some(item => item.contains(child)); },
            setAttribute(name, text) { attributes.set(name, String(text)); },
            getAttribute(name) { return attributes.get(name) ?? null; },
            removeAttribute(name) { attributes.delete(name); },
            matches(selector) {
                return this.nodeType === 1 && selector.split(',').some(part => part === '*' || /^\[[\w-]+\]$/.test(part) && attributes.has(part.slice(1, -1)));
            },
            closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; },
            querySelectorAll(selector) { return this.childNodes.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
        };
        node.dataset = new Proxy({}, {
            get: (_target, name) => attributes.get(`data-${String(name).replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`),
            set: (_target, name, text) => { node.setAttribute(`data-${String(name).replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, text); return true; }
        });
        return node;
    };
    const document = makeNode(9);
    document.documentElement = makeNode(1);
    document.append(document.documentElement);
    document.createElement = () => makeNode(1);
    document.createTreeWalker = root => {
        const collect = node => node.childNodes.flatMap(child => child.nodeType === 3 ? [child] : collect(child));
        const nodes = collect(root);
        let index = 0;
        return { currentNode: null, nextNode() { this.currentNode = nodes[index++]; return Boolean(this.currentNode); } };
    };
    return document;
}

async function runtime({ stored, languages = ['en-US'], failLocale, delay, deniedStorage = false, document: suppliedDocument, MapConstructor = Map, scriptURL } = {}) {
    const values = new Map(stored ? [['deltamodCommunityLanguage', stored]] : []);
    const events = [];
    const document = suppliedDocument || {
        documentElement: {}, querySelectorAll: () => [],
        createTreeWalker: () => ({ nextNode: () => false })
    };
    if (scriptURL) document.currentScript = { src: scriptURL };
    const context = {
        Intl, Map: MapConstructor, Set, Date, URL, Object, String, Number, JSON, Promise,
        document, navigator: { languages, language: languages[0] },
        NodeFilter: { SHOW_TEXT: 4 }, CustomEvent: class { constructor(name, init) { this.type = name; this.detail = init.detail; } },
        localStorage: {
            getItem: key => { if (deniedStorage) throw new Error('storage denied'); return values.get(key); },
            setItem: (key, value) => { if (deniedStorage) throw new Error('storage denied'); values.set(key, value); }
        },
        console: { warn() {}, error() {} },
        fetch: async url => {
            const [, code, name] = String(url).match(/langs\/([^/]+)\/([^/]+)$/) || [];
            if (delay && name === 'language.json') await delay(code);
            if ((typeof failLocale === 'function' ? failLocale(code) : code === failLocale) && name === 'language.json') return { ok: false, status: 503 };
            const file = path.join(root, code, name);
            return { ok: fs.existsSync(file), status: 404, text: async () => fs.readFileSync(file, 'utf8') };
        },
        dispatchEvent: event => events.push(event)
    };
    context.window = context;
    vm.runInNewContext(source, context);
    await context.Localization.ready;
    return { api: context.Localization, document, values, events };
}

describe('regional localization behavior', () => {
    it.each([
        ['ru-RU', 'ru'], ['uk-UA', 'uk'], ['ko-KR', 'ko'], ['th-TH', 'th'], ['ar-EG', 'ar'],
        ['tr-TR', 'tr'], ['zh', 'zh-CN'], ['zh_SG', 'zh-CN'], ['zh-Hant-CN', 'zh-TW'],
        ['zh-Hans-TW', 'zh-CN'], ['zh-HK', 'zh-TW'], ['es-MX', 'es-419'], ['es-AR', 'es-419'],
        ['es-419', 'es-419'], ['es-ES', 'es'], ['PT-pt', 'pt-br'], ['ja-JP', 'ja']
    ])('resolves %s to %s', async (input, expected) => {
        const { api } = await runtime();
        expect(api.normalizeLanguage(input)).toBe(expected);
    });
    it('walks browser preferences and honors an existing explicit choice', async () => {
        const first = await runtime({ languages: ['invalid/value', 'da-DK', 'it-CH'] });
        expect(first.api.getLanguage()).toBe('it');
        const saved = await runtime({ stored: 'pl', languages: ['it-IT'] });
        expect(saved.api.getLanguage()).toBe('pl');
        expect(saved.api.detectLanguage(['../../en', 'not_a_locale_!'])).toBe('en');
    });
    it('keeps English fallback when a selected catalog cannot load', async () => {
        const { api } = await runtime({ stored: 'it', failLocale: 'it' });
        expect(api.t('options', 'fallback')).toBe('Options');
        expect(api.t('missing', 'fallback {0}', '雪/لعبة')).toBe('fallback 雪/لعبة');
    });
    it('initializes the language picker after an English failure and retries its literal keys later', async () => {
        let unavailable = true;
        const { api, document } = await runtime({
            stored: 'it', languages: ['it-CH'], failLocale: code => code === 'en' && unavailable
        });
        const languages = await api.getLanguages();
        expect(languages.map(language => language.code)).toEqual([...api.supportedLanguages]);
        expect(languages.every(language => language.name && language.flag)).toBe(true);
        expect(api.t('options')).toBe('Opzioni');
        expect(api.text('Options')).toBe('Options');
        unavailable = false;
        await api.setLanguage('it');
        expect(api.text('Options')).toBe('Opzioni');
        expect(api.getLocale()).toBe('it-CH');
        expect(document.documentElement.lang).toBe('it');
    });
    it('can select an available language while English remains unavailable', async () => {
        const { api } = await runtime({ failLocale: 'en' });
        expect((await api.getLanguages()).filter(Boolean)).toHaveLength(17);
        await api.setLanguage('ja');
        expect(api.t('options')).toBe('オプション');
        expect(api.t('missing', 'Fallback {0}', '<literal>')).toBe('Fallback <literal>');
        await expect(api.setLanguage('en')).rejects.toThrow('Unable to load en/language.json');
        expect(api.getLanguage()).toBe('ja');
    });
    it('resolves metadata assets from the script location on standalone pages', async () => {
        const { api } = await runtime({ scriptURL: 'https://deltamod.test/modules/localization.js' });
        const languages = await api.getLanguages();
        expect(languages.find(language => language.code === 'zh-CN').flag).toBe('https://deltamod.test/langs/zh-CN/flag.svg');
    });
    it('keeps a usable session when persistence is denied', async () => {
        const { api, document } = await runtime({ deniedStorage: true });
        await api.setLanguage('it');
        expect(api.getLanguage()).toBe('it');
        expect(document.documentElement).toMatchObject({ lang: 'it', dir: 'ltr' });
    });
    it('retains regional formatting preferences while selecting the supported UI language', async () => {
        const { api, document } = await runtime({ languages: ['en-GB', 'ar-EG'] });
        expect(api.getLocale()).toBe('en-GB');
        expect(document.documentElement.lang).toBe('en');
        await api.setLanguage('ar');
        expect(api.getLocale()).toBe('ar-EG');
        expect(document.documentElement).toMatchObject({ lang: 'ar', dir: 'rtl' });
        await api.setLanguage('es-MX');
        expect(api.getLanguage()).toBe('es-419');
        expect(api.getLocale()).toBe('es-MX');
    });
    it('applies only the last concurrent language request', async () => {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const { api, values, events } = await runtime({ delay: code => code === 'it' ? gate : undefined });
        const first = api.setLanguage('it');
        await api.setLanguage('ja');
        release();
        await first;
        expect(api.getLanguage()).toBe('ja');
        expect(values.get('deltamodCommunityLanguage')).toBe('ja');
        expect(events.filter(event => event.type === 'deltamod-language-change')).toHaveLength(1);
    });
    it('uses the selected locale for numbers, dates and relative times', async () => {
        const { api } = await runtime();
        await api.setLanguage('de');
        expect(api.number(12345.67)).toBe(new Intl.NumberFormat('de').format(12345.67));
        const options = { dateStyle: 'long', timeZone: 'UTC' };
        expect(api.date(0, options)).toBe(new Intl.DateTimeFormat('de', options).format(0));
        expect(api.relativeTime(0, 60000)).toBe(new Intl.RelativeTimeFormat('de', { numeric: 'auto' }).format(-1, 'minute'));
        expect(api.relativeTime(120000, 60000)).toBe(new Intl.RelativeTimeFormat('de', { numeric: 'auto' }).format(1, 'minute'));
        expect(api.relativeTime(null)).toBe(api.t('unknown'));
        expect(api.date('not-a-date')).toBe(api.t('unknown'));
        expect(api.number(Infinity)).toBe(api.t('unknown'));
    });
    it('provides English plural fallback and preserves literal placeholder arguments', async () => {
        const { api } = await runtime();
        expect(api.plural('count_mods', 1)).toBe('1 mod');
        expect(api.plural('count_mods', 2)).toBe('2 mods');
        expect(api.t('missing', '{0} and {1}', '{1}', '✓')).toBe('{1} and ✓');
    });
});

describe('localization binding ownership', () => {
    it('replaces text and attribute renderers without removing bindings for other properties', async () => {
        const document = testDocument();
        const { api } = await runtime({ document });
        const element = document.createElement();
        document.documentElement.append(element);
        api.bindComputed(element, () => 'stale computed text');
        api.bindComputed(element, () => `live ${api.getLanguage()}`, 'aria-label');
        api.bind(element, 'options', 'Options');
        await api.setLanguage('it');
        expect(element.textContent).toBe('Opzioni');
        expect(element.getAttribute('aria-label')).toBe('live it');

        api.bindComputed(element, () => 'stale computed title', 'title');
        api.bindTextAttribute(element, 'title', 'Options');
        api.bindComputed(element, () => 'second stale text');
        api.bindText(element, 'Options');
        await api.setLanguage('ja');
        expect(element.textContent).toBe('オプション');
        expect(element.getAttribute('title')).toBe('オプション');
        expect(element.getAttribute('aria-label')).toBe('live ja');

        api.bindAttribute(element, 'title', 'data', 'Data');
        api.bindComputed(element, () => `computed ${api.getLanguage()}`, 'title');
        api.bindComputed(element, () => `computed ${api.getLanguage()}`);
        await api.setLanguage('de');
        expect(element.textContent).toBe('computed de');
        expect(element.getAttribute('title')).toBe('computed de');
        expect(element.getAttribute('aria-label')).toBe('live de');
    });

    it('releases every binding in a subtree immediately while preserving outside nodes', async () => {
        const registries = [];
        class ObservedMap extends Map {
            constructor(...args) { super(...args); registries.push(this); }
        }
        const document = testDocument();
        const { api } = await runtime({ document, MapConstructor: ObservedMap });
        const root = document.createElement();
        const child = document.createElement();
        const outside = document.createElement();
        document.documentElement.append(root);
        document.documentElement.append(outside);
        api.bindAttribute(root, 'aria-label', 'data', 'Data');
        root.append(child);
        child.textContent = 'Options';
        child.setAttribute('title', 'Options');
        api.applyKnownText(root);
        const explicit = document.createElement();
        api.bind(explicit, 'data', 'Data');
        root.append(explicit);
        api.bindAttribute(child, 'placeholder', 'options', 'Options');
        let calls = 0;
        api.bindComputed(child, () => { calls += 1; return `state ${api.getLanguage()}`; }, 'aria-valuetext');
        api.bindComputed(outside, () => `outside ${api.getLanguage()}`);
        expect(registries.some(registry => registry.has(child))).toBe(true);
        api.release(root);
        expect(registries.every(registry => [...registry.keys()].every(node => !root.contains(node)))).toBe(true);
        expect(root.getAttribute('data-i18n-aria-label')).toBeNull();
        expect(explicit.getAttribute('data-i18n')).toBeNull();
        expect(child.getAttribute('data-i18n-placeholder')).toBeNull();
        await api.setLanguage('it');
        expect(root.textContent).toBe('OptionsData');
        expect(child.getAttribute('title')).toBe('Options');
        expect(child.getAttribute('placeholder')).toBe('Options');
        expect(child.getAttribute('aria-valuetext')).toBe('state en');
        expect(calls).toBe(1);
        expect(outside.textContent).toBe('outside it');
    });
});
