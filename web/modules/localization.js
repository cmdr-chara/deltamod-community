// Copyright © 2026 cmdr-chara. Original Community localization implementation.
// Licensed under the EUPL 1.2. Existing public localization API is preserved.
(() => {
    'use strict';
    const DEFAULT_LANGUAGE = 'en';
    const SUPPORTED_LANGUAGES = Object.freeze([
        'en', 'it', 'pl', 'es', 'fr', 'de', 'pt-br', 'ja', 'ru',
        'zh-CN', 'zh-TW', 'ko', 'tr', 'es-419', 'uk', 'th', 'ar'
    ]);
    const STORAGE_KEY = 'deltamodCommunityLanguage';
    const CATALOG_BASE = document.currentScript?.src ? new URL('../langs/', document.currentScript.src).href : './langs/';
    const dictionaries = new Map();
    const metadata = new Map();
    const requests = new Map();
    const formatters = new Map();
    const knownTextNodes = new Map();
    const knownAttributes = new Map();
    const bindings = new WeakMap();
    const attributeBindings = new WeakMap();
    const computedBindings = new Map();
    const localizedAttributes = ['title', 'aria-label', 'aria-valuetext', 'placeholder', 'alt'];
    const localeCodes = { 'pt-br': 'pt-BR' };
    const latinAmerica = new Set(['419', 'AR', 'BO', 'BR', 'BZ', 'CL', 'CO', 'CR', 'CU', 'DO', 'EC', 'GT', 'HN', 'MX', 'NI', 'PA', 'PE', 'PR', 'PY', 'SV', 'US', 'UY', 'VE']);
    const ignoredContent = 'script,style,textarea,code,pre,bdi,[contenteditable="true"],[data-i18n-skip],[data-user-content],.material-symbols-outlined,brand-icon';
    let reverseDictionary = new Map();
    let englishKeys = new Map();
    let changeGeneration = 0;

    function normalizeLanguage(value) {
        const candidate = String(value || '').trim().replaceAll('_', '-');
        if (!candidate) return null;
        let locale;
        try { locale = new Intl.Locale(candidate); } catch { return null; }
        const exact = SUPPORTED_LANGUAGES.find(code => code.toLowerCase() === locale.baseName.toLowerCase());
        if (exact) return exact;
        if (locale.language === 'zh') {
            if (locale.script === 'Hant') return 'zh-TW';
            if (locale.script === 'Hans') return 'zh-CN';
            return ['TW', 'HK', 'MO'].includes(locale.region) ? 'zh-TW' : 'zh-CN';
        }
        if (locale.language === 'es') return latinAmerica.has(locale.region) ? 'es-419' : 'es';
        if (locale.language === 'pt') return 'pt-br';
        return SUPPORTED_LANGUAGES.includes(locale.language) ? locale.language : null;
    }

    function detectLanguage(values) {
        for (const value of values || []) {
            const code = normalizeLanguage(value);
            if (code) return code;
        }
        return DEFAULT_LANGUAGE;
    }

    function storedLanguage() {
        try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
    }
    const browserLanguages = [...(navigator.languages || []), navigator.language].filter(Boolean);
    let currentLanguage = detectLanguage([storedLanguage(), ...browserLanguages]);
    function formattingLocale(language, requested) {
        const candidates = requested && requested !== language ? [requested, ...browserLanguages] : browserLanguages;
        for (const candidate of candidates) {
            if (normalizeLanguage(candidate) !== language) continue;
            try { return new Intl.Locale(candidate.replaceAll('_', '-')).toString(); } catch { /* Try the next preference. */ }
        }
        return localeCodes[language] || language;
    }
    let currentLocale = formattingLocale(currentLanguage);
    const getLocale = () => currentLocale;
    const bidi = value => currentLanguage === 'ar' ? `\u2068${String(value)}\u2069` : String(value);

    async function fetchLanguageFile(code, filename) {
        // All inputs are fixed catalog names or members of SUPPORTED_LANGUAGES.
        const response = await fetch(`${CATALOG_BASE}${code}/${filename}`);
        if (!response.ok) throw new Error(`Unable to load ${code}/${filename}: HTTP ${response.status}`);
        return response.text();
    }

    async function loadDictionary(code) {
        if (dictionaries.has(code)) return dictionaries.get(code);
        if (requests.has(code)) return requests.get(code);
        const request = (async () => {
            const source = await fetchLanguageFile(code, 'language.json');
            const parsed = JSON.parse(source.replace(/\/\*[\s\S]*?\*\//g, ''));
            const catalog = Object.create(null);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid translation catalog');
            for (const [key, value] of Object.entries(parsed)) {
                if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
                if (typeof value === 'string' && value.trim()) catalog[key] = value;
            }
            dictionaries.set(code, Object.freeze(catalog));
            return catalog;
        })();
        requests.set(code, request);
        try { return await request; } finally { requests.delete(code); }
    }

    async function loadMetadata(code) {
        if (metadata.has(code)) return metadata.get(code);
        const lines = (await fetchLanguageFile(code, 'metadata.txt')).split(/\r?\n/).map(line => line.trim());
        const flag = /^[A-Za-z0-9._-]+$/.test(lines[3] || '') ? lines[3] : 'flag.png';
        const entry = Object.freeze({ code, name: lines[0] || code, author: lines[1] || '', version: lines[2] || '', flag: `${CATALOG_BASE}${code}/${flag}` });
        metadata.set(code, entry);
        return entry;
    }
    function fallbackMetadata(code) {
        return Object.freeze({ code, name: code, author: '', version: '', flag: `${CATALOG_BASE}en/flag.svg` });
    }

    function interpolate(value, args) {
        return String(value).replace(/{(\d+)}/g, (match, index) => args[index] === undefined ? match : bidi(args[index]));
    }

    function t(key, fallback = key, ...args) {
        const selected = dictionaries.get(currentLanguage) || {};
        const english = dictionaries.get(DEFAULT_LANGUAGE) || {};
        return interpolate(selected[key] ?? english[key] ?? fallback, args);
    }

    function formatter(type, options = {}) {
        const key = JSON.stringify([getLocale(), type, options]);
        if (!formatters.has(key)) {
            if (formatters.size >= 64) formatters.clear();
            formatters.set(key, new Intl[type](getLocale(), options));
        }
        return formatters.get(key);
    }
    function number(value, options = {}) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? formatter('NumberFormat', options).format(numeric) : t('unknown', 'Unknown');
    }
    function date(value, options = { dateStyle: 'medium' }) {
        const timestamp = value instanceof Date ? value : new Date(value);
        if (value === null || value === undefined || value === '' || !Number.isFinite(timestamp.getTime())) return t('unknown', 'Unknown');
        return formatter('DateTimeFormat', options).format(timestamp);
    }
    function relativeTime(value, now = Date.now()) {
        const timestamp = value instanceof Date ? value.getTime() : Number(value);
        if (value === null || value === undefined || value === '' || !Number.isFinite(timestamp) || !Number.isFinite(now)) return t('unknown', 'Unknown');
        const seconds = (timestamp - now) / 1000;
        const magnitude = Math.abs(seconds);
        const units = [[60, 1, 'second'], [3600, 60, 'minute'], [86400, 3600, 'hour'], [604800, 86400, 'day'], [2629800, 604800, 'week'], [31557600, 2629800, 'month'], [Infinity, 31557600, 'year']];
        const [, divisor, unit] = units.find(([limit]) => magnitude < limit);
        const amount = Math.round(seconds / divisor) || 0;
        return formatter('RelativeTimeFormat', { numeric: 'auto' }).format(amount, unit);
    }
    function plural(key, count, fallback = key, ...args) {
        const numeric = Number(count);
        const category = formatter('PluralRules').select(Number.isFinite(numeric) ? numeric : 0);
        const englishCategory = new Intl.PluralRules('en').select(numeric);
        const selected = dictionaries.get(currentLanguage) || {};
        const english = dictionaries.get(DEFAULT_LANGUAGE) || {};
        const value = selected[`${key}_${category}`] ?? selected[`${key}_other`] ?? english[`${key}_${englishCategory}`] ?? english[`${key}_other`] ?? selected[key] ?? english[key] ?? fallback;
        return interpolate(value, [number(count), ...args]);
    }

    function rebuildReverseDictionary() {
        reverseDictionary = new Map();
        englishKeys = new Map();
        for (const [key, value] of Object.entries(dictionaries.get(DEFAULT_LANGUAGE) || {})) {
            if (!englishKeys.has(value)) englishKeys.set(value, key);
            if (value.includes('{') || value.includes('<')) continue;
            for (const dictionary of dictionaries.values()) {
                const known = dictionary[key];
                // Explicit data-i18n keys disambiguate context. Legacy static templates
                // with synonymous English keys use the first equivalent catalog entry.
                if (known && !reverseDictionary.has(known)) reverseDictionary.set(known, key);
            }
        }
    }
    function text(value, ...args) {
        const key = englishKeys.get(value);
        return key ? t(key, value, ...args) : interpolate(value, args);
    }
    function translateKnownText(value) {
        if (typeof value !== 'string') return value;
        const key = reverseDictionary.get(value) || englishKeys.get(value);
        return key ? t(key, value) : value;
    }
    function replaceTokens(html) {
        return String(html).replace(/\$\$([A-Za-z0-9_]+)\$\$/g, (_match, key) => t(key, `$$${key}$$`));
    }
    function elements(root, selector) {
        return [...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector)];
    }
    function clearPropertyBinding(element, attribute) {
        const computed = computedBindings.get(element);
        computed?.delete(attribute);
        if (computed && !computed.size) computedBindings.delete(element);
        if (attribute === 'textContent') {
            bindings.delete(element);
            element.removeAttribute('data-i18n');
            for (const node of knownTextNodes.keys()) {
                if (element.contains?.(node)) knownTextNodes.delete(node);
            }
        } else {
            const explicit = attributeBindings.get(element);
            explicit?.delete(attribute);
            if (explicit && !explicit.size) attributeBindings.delete(element);
            const known = knownAttributes.get(element);
            known?.delete(attribute);
            if (known && !known.size) knownAttributes.delete(element);
            element.removeAttribute(`data-i18n-${attribute}`);
        }
    }
    // Dispose a removed subtree explicitly; a closed dialog must not keep its
    // nodes and render closures alive until a later navigation or locale change.
    function release(root) {
        if (!root) return;
        const within = node => node === root || root.contains?.(node);
        for (const node of computedBindings.keys()) if (within(node)) computedBindings.delete(node);
        for (const node of knownTextNodes.keys()) if (within(node)) knownTextNodes.delete(node);
        for (const node of knownAttributes.keys()) if (within(node)) knownAttributes.delete(node);
        for (const element of [root, ...(root.querySelectorAll?.('*') || [])]) {
            bindings.delete(element);
            attributeBindings.delete(element);
            element.removeAttribute?.('data-i18n');
            for (const attribute of localizedAttributes) element.removeAttribute?.(`data-i18n-${attribute}`);
        }
    }
    function bind(element, key, fallback = key, ...args) {
        if (!element) return element;
        clearPropertyBinding(element, 'textContent');
        bindings.set(element, { key, fallback, args });
        element.dataset.i18n = key;
        element.textContent = t(key, fallback, ...args);
        return element;
    }
    function bindText(element, source, ...args) {
        const key = englishKeys.get(source) || reverseDictionary.get(source);
        bind(element, key || source, source, ...args);
        if (element) bindings.get(element).source = source;
        return element;
    }
    function bindAttribute(element, attribute, key, fallback = key, ...args) {
        if (!element || !localizedAttributes.includes(attribute)) return element;
        clearPropertyBinding(element, attribute);
        const attributes = attributeBindings.get(element) || new Map();
        attributes.set(attribute, { key, fallback, args });
        attributeBindings.set(element, attributes);
        element.setAttribute(`data-i18n-${attribute}`, key);
        element.setAttribute(attribute, t(key, fallback, ...args));
        return element;
    }
    function bindTextAttribute(element, attribute, source, ...args) {
        bindAttribute(element, attribute, englishKeys.get(source) || source, source, ...args);
        const binding = attributeBindings.get(element)?.get(attribute);
        if (binding) binding.source = source;
        return element;
    }
    function bindComputed(element, render, attribute = 'textContent') {
        if (!element || typeof render !== 'function' || !['textContent', ...localizedAttributes].includes(attribute)) return element;
        clearPropertyBinding(element, attribute);
        const entries = computedBindings.get(element) || new Map();
        entries.set(attribute, render);
        computedBindings.set(element, entries);
        if (attribute === 'textContent') {
            element.removeAttribute('data-i18n');
            element.textContent = render();
        } else {
            element.removeAttribute(`data-i18n-${attribute}`);
            element.setAttribute(attribute, render());
        }
        return element;
    }
    function apply(root = document) {
        elements(root, '[data-i18n]').forEach(element => {
            const binding = bindings.get(element);
            const args = binding?.args || [];
            const key = englishKeys.get(binding?.source) || element.dataset.i18n;
            element.textContent = t(key, binding?.fallback || element.textContent, ...args);
        });
        for (const [element, entries] of computedBindings) {
            if (element.isConnected === false) { computedBindings.delete(element); continue; }
            if (root !== document && element !== root && !root.contains(element)) continue;
            for (const [attribute, render] of entries) {
                if (attribute === 'textContent') element.textContent = render();
                else element.setAttribute(attribute, render());
            }
        }
        for (const attribute of localizedAttributes) {
            elements(root, `[data-i18n-${attribute}]`).forEach(element => {
                const binding = attributeBindings.get(element)?.get(attribute);
                const key = englishKeys.get(binding?.source) || element.getAttribute(`data-i18n-${attribute}`);
                element.setAttribute(attribute, t(key, binding?.fallback || element.getAttribute(attribute) || '', ...(binding?.args || [])));
            });
        }
    }

    // This is deliberately an explicit, one-time pass over app-owned static
    // markup. Do not observe arbitrary mutations: mod titles and comments may
    // happen to equal UI words and must never be translated.
    function applyKnownText(root = document) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        for (const node of nodes) {
            if (knownTextNodes.has(node) || node.parentElement?.closest(ignoredContent)) continue;
            const original = node.nodeValue || '';
            const value = original.trim();
            const key = reverseDictionary.get(value);
            if (!key) continue;
            knownTextNodes.set(node, { key, prefix: original.slice(0, original.indexOf(value)), suffix: original.slice(original.indexOf(value) + value.length) });
        }
        for (const element of elements(root, '[title],[placeholder],[aria-label],[alt]')) {
            if (element.closest(ignoredContent)) continue;
            const attributes = knownAttributes.get(element) || new Map();
            for (const attribute of ['title', 'placeholder', 'aria-label', 'alt']) {
                const key = reverseDictionary.get(element.getAttribute(attribute));
                if (key && !attributes.has(attribute)) attributes.set(attribute, key);
            }
            if (attributes.size) knownAttributes.set(element, attributes);
        }
        refreshKnownText();
        apply(root);
    }
    function refreshKnownText() {
        for (const [node, binding] of knownTextNodes) {
            if (!node.isConnected) { knownTextNodes.delete(node); continue; }
            node.nodeValue = binding.prefix + t(binding.key) + binding.suffix;
        }
        for (const [element, attributes] of knownAttributes) {
            if (!element.isConnected) { knownAttributes.delete(element); continue; }
            for (const [attribute, key] of attributes) element.setAttribute(attribute, t(key));
        }
    }
    function documentLocale() {
        document.documentElement.lang = localeCodes[currentLanguage] || currentLanguage;
        document.documentElement.dir = currentLanguage === 'ar' ? 'rtl' : 'ltr';
    }
    async function initialize() {
        try { await loadDictionary(DEFAULT_LANGUAGE); }
        catch (error) { console.warn('English translations are unavailable; using caller fallbacks until the catalog can be retried.', error); }
        if (currentLanguage !== DEFAULT_LANGUAGE) {
            try { await loadDictionary(currentLanguage); }
            catch (error) { console.warn('Using English translations until the selected catalog is available.', error); }
        }
        await Promise.all(SUPPORTED_LANGUAGES.map(async code => {
            try { await loadMetadata(code); }
            catch { metadata.set(code, fallbackMetadata(code)); }
        }));
        rebuildReverseDictionary();
        documentLocale();
        applyKnownText(document);
    }
    async function setLanguage(code, { refreshPage = false } = {}) {
        const generation = ++changeGeneration;
        const normalized = normalizeLanguage(code) || DEFAULT_LANGUAGE;
        await ready;
        await Promise.all([
            loadDictionary(normalized),
            loadDictionary(DEFAULT_LANGUAGE).catch(error => {
                console.warn('English translations remain unavailable; using caller fallbacks.', error);
            })
        ]);
        if (generation !== changeGeneration) return currentLanguage;
        currentLanguage = normalized;
        currentLocale = formattingLocale(normalized, code);
        try { localStorage.setItem(STORAGE_KEY, normalized); } catch { /* A restricted WebView still supports this session. */ }
        rebuildReverseDictionary();
        documentLocale();
        refreshKnownText();
        apply(document);
        window.dispatchEvent(new CustomEvent('deltamod-language-change', { detail: { language: normalized, locale: getLocale(), direction: document.documentElement.dir } }));
        if (refreshPage && typeof window.page === 'function' && window.pageN) await window.page(window.pageN);
        return normalized;
    }
    async function getLanguages() { await ready; return SUPPORTED_LANGUAGES.map(code => metadata.get(code) || fallbackMetadata(code)); }
    const ready = initialize().catch(error => {
        console.error('Localization initialization failed:', error);
        currentLanguage = DEFAULT_LANGUAGE;
        currentLocale = formattingLocale(DEFAULT_LANGUAGE);
        documentLocale();
    });
    window.Localization = Object.freeze({
        ready, t, text, apply, applyKnownText, bind, bindText, bindAttribute, bindTextAttribute, bindComputed, release, replaceTokens, translateKnownText,
        getLanguages, getLanguage: () => currentLanguage, getLocale, setLanguage,
        number, date, relativeTime, plural, bidi, normalizeLanguage, detectLanguage,
        supportedLanguages: SUPPORTED_LANGUAGES
    });
})();
