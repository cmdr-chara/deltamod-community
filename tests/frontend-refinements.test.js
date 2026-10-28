// Copyright © 2026 cmdr-chara. Licensed under the EUPL 1.2.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ui = require('../web/modules/frontend-refinements');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function localizedControls() {
    const root = new EventTarget();
    const document = { activeElement: null };
    class Element extends EventTarget {
        constructor(tag) {
            super();
            this.tagName = tag;
            this.children = [];
            this.parentElement = null;
            this.className = '';
            this.dataset = {};
            this.attributes = new Map();
            this.value = '';
            this.hidden = false;
            this.disabled = false;
            this.classList = {
                add: token => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), token])].join(' '); },
                remove: token => { this.className = this.className.split(' ').filter(value => value !== token).join(' '); }
            };
        }
        get isConnected() { return this === document.body || Boolean(this.parentElement?.isConnected); }
        get textContent() { return (this.content || '') + this.children.map(child => child.textContent).join(''); }
        set textContent(value) { this.replaceChildren(); this.content = String(value); }
        matches(selector) { return selector.startsWith('.') ? this.className.split(' ').includes(selector.slice(1)) : this.tagName === selector; }
        querySelector(selector) {
            for (const child of this.children) {
                if (child.matches(selector)) return child;
                const found = child.querySelector(selector);
                if (found) return found;
            }
            return null;
        }
        closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
        contains(node) { return this === node || this.children.some(child => child.contains(node)); }
        append(...children) {
            for (const child of children) {
                if (child.tagName === '#fragment') { this.append(...[...child.children]); continue; }
                child.remove();
                child.parentElement = this;
                this.children.push(child);
            }
        }
        remove() {
            if (!this.parentElement) return;
            if (this.contains(document.activeElement)) document.activeElement = document.body;
            this.parentElement.children = this.parentElement.children.filter(child => child !== this);
            this.parentElement = null;
        }
        replaceChildren(...children) {
            [...this.children].forEach(child => child.remove());
            this.content = '';
            this.append(...children);
        }
        setAttribute(name, value) { this.attributes.set(name, String(value)); }
        removeAttribute(name) { this.attributes.delete(name); }
        focus() { document.activeElement = this; }
        setSelectionRange(start, end, direction) {
            this.selectionStart = start;
            this.selectionEnd = end;
            this.selectionDirection = direction;
        }
    }
    document.createElement = tag => new Element(tag);
    document.createDocumentFragment = () => new Element('#fragment');
    document.body = new Element('body');
    root.document = document;
    root.page = vi.fn();
    let language = 'en';
    let locale = 'en';
    const dictionaries = {
        fr: { unknown: 'Inconnu', refine_saving: 'Enregistrement…', refine_saved: 'Enregistré', refine_save_failed: 'Non enregistré. Réessayez.' },
        ar: { unknown: 'غير معروف', refine_mod_count: '{0} من {1}', refine_saved: 'تم الحفظ' },
        tr: { refine_load_failed: 'Mod listesi yüklenemedi.', refine_retry: 'Yeniden dene' }
    };
    const bindings = new Map();
    root.Localization = {
        getLocale: () => locale,
        number: value => new Intl.NumberFormat(locale).format(value),
        t: (key, fallback, ...args) => (dictionaries[language]?.[key] || fallback)
            .replace(/\{(\d+)\}/g, (match, index) => args[index] === undefined ? match : String(args[index])),
        bind: (element, key, fallback) => {
            bindings.set(element, [key, fallback]);
            element.textContent = root.Localization.t(key, fallback);
        }
    };
    vm.runInNewContext(read('web/modules/frontend-refinements.js'), { window: root, Intl });
    return {
        ui: root.FrontendRefinements, root, document,
        changeLanguage(code, region = code) {
            language = code;
            locale = region;
            for (const [element, args] of bindings) {
                if (element.isConnected) element.textContent = root.Localization.t(...args);
            }
            root.dispatchEvent(new Event('deltamod-language-change'));
        },
        element(tag, parent = document.body) {
            const node = document.createElement(tag);
            parent.append(node);
            return node;
        }
    };
}

describe('Original frontend refinement', () => {
    it('searches all author names, package IDs and versions without case sensitivity', () => {
        const mod = { name: 'Forest', author: ['Chara', 'Second'], version: '2.1', packageID: 'org.forest' };
        expect(ui.matches(mod, ' second  2.1 ')).toBe(true);
        expect(ui.matches(mod, 'ORG.forest')).toBe(true);
        expect(ui.matches(mod, 'Forest missing')).toBe(false);
        expect(ui.matches({}, '')).toBe(true);
        expect(ui.matches({ name: 'ＦＯＲＥＳＴ' }, 'forest')).toBe(true);
    });
    it('sorts numeric names, sizes, and either author representation predictably', () => {
        const mods = [
            { name: 'Mod 10', author: 'Beta', size: 10 },
            { name: 'Mod 2', author: ['Alpha'], size: 2 },
            { name: 'Mod 1', author: ['Alpha'], size: 2 }
        ];
        for (const order of ['asc', 'size-asc', 'author']) {
            expect([...mods].sort((a,b) => ui.compareMods(a,b,order)).map(mod => mod.name))
                .toEqual(['Mod 1','Mod 2','Mod 10']);
        }
        expect([...mods].sort((a,b) => ui.compareMods(a,b,'desc'))[0].name).toBe('Mod 10');
        expect(ui.compareMods({name:'A',size:null},{name:'B',size:0},'size-desc')).toBeLessThan(0);
    });
    it('uses the selected locale for Turkish search and locale-specific alphabetic ordering', () => {
        const view = localizedControls();
        view.changeLanguage('tr');
        expect(view.ui.matches({ name: 'İzmir', author: 'IŞIK' }, 'izmir ışık')).toBe(true);
        view.changeLanguage('sv');
        expect(view.ui.compareMods({ name: 'Älg' }, { name: 'Zebra' }, 'asc')).toBeGreaterThan(0);
        view.changeLanguage('de');
        expect(view.ui.compareMods({ name: 'Älg' }, { name: 'Zebra' }, 'asc')).toBeLessThan(0);
    });
    it('refreshes fallback authors, numeric counts and ordering without replacing rows or form state', () => {
        const view = localizedControls();
        const table = view.element('table');
        const tbody = view.element('tbody', table);
        const input = view.element('input');
        const count = view.element('span');
        const sort = view.element('select');
        const filter = view.element('select');
        sort.value = 'author';
        filter.value = 'deltarune';
        const helper = view.ui.tableTools(tbody, { input, count, sort, filter });
        const zebra = view.element('tr', tbody);
        const field = view.element('input', zebra);
        field.value = 'keep {0} exactly';
        field.checked = true;
        field.setSelectionRange(2, 7, 'backward');
        const elk = view.element('tr', tbody);
        helper.add({ name: 'Zebra', game: 'deltarune' }, zebra);
        helper.add({ name: 'Älg', author: 'Unknown', game: 'deltarune' }, elk);
        helper.finish();
        const headings = () => tbody.children.filter(row => row.className === 'mod-author-heading').map(row => row.textContent);
        expect(headings()).toEqual(['Unknown', 'Unknown']);
        view.changeLanguage('fr');
        expect(headings()).toEqual(['Inconnu', 'Unknown']);
        input.value = 'zebra';
        input.dispatchEvent(new Event('input'));
        field.focus();
        view.changeLanguage('ar', 'ar-EG');
        expect(count.textContent).toBe('١ من ٢');
        expect(headings()).toEqual(['غير معروف', 'Unknown']);
        expect(input.value).toBe('zebra');
        expect(filter.value).toBe('deltarune');
        expect(sort.value).toBe('author');
        expect(zebra.hidden).toBe(false);
        expect(elk.hidden).toBe(true);
        expect(field.value).toBe('keep {0} exactly');
        expect(field.checked).toBe(true);
        expect(view.document.activeElement).toBe(field);
        expect([field.selectionStart, field.selectionEnd, field.selectionDirection]).toEqual([2, 7, 'backward']);
        sort.value = 'asc';
        view.changeLanguage('sv');
        const rows = () => tbody.children.filter(row => row === zebra || row === elk);
        expect(rows()).toEqual([zebra, elk]);
        view.changeLanguage('de');
        expect(rows()).toEqual([elk, zebra]);
        view.root._onClosePage.forEach(cleanup => cleanup());
        view.changeLanguage('sv');
        expect(rows()).toEqual([elk, zebra]);
    });
    it('updates saved, saving and failed controls and retry labels while preserving raw diagnostics', async () => {
        const view = localizedControls();
        const control = view.element('input', view.element('label'));
        control.value = 'personal value';
        let resolve;
        const saving = view.ui.saveControl(control, () => new Promise(done => { resolve = done; }));
        const status = control.parentElement.querySelector('.control-save-status');
        expect(status.textContent).toBe('Saving…');
        view.changeLanguage('fr');
        expect(status.textContent).toBe('Enregistrement…');
        expect(control.disabled).toBe(true);
        resolve();
        expect(await saving).toBe(true);
        expect(status.textContent).toBe('Enregistré');
        view.changeLanguage('ar');
        expect(status.textContent).toBe('تم الحفظ');
        const rollback = vi.fn();
        expect(await view.ui.saveControl(control, () => Promise.reject(new Error('Unknown {0}')), rollback)).toBe(false);
        view.changeLanguage('fr');
        expect(status.textContent).toBe('Non enregistré. Réessayez.');
        expect(status.title).toBe('Unknown {0}');
        expect(rollback).toHaveBeenCalledOnce();
        expect(control.value).toBe('personal value');
        const tbody = view.element('tbody', view.element('table'));
        view.ui.showListError(tbody, new Error('Unknown'));
        view.changeLanguage('tr');
        expect(tbody.querySelector('p').textContent).toBe('Mod listesi yüklenemedi.');
        expect(tbody.querySelector('small').textContent).toBe('Unknown');
        const retry = tbody.querySelector('button');
        expect(retry.textContent).toBe('Yeniden dene');
        retry.dispatchEvent(new Event('click'));
        expect(view.root.page).toHaveBeenCalledWith('');
    });
    it('retains the original identity assets, sidebar, typography and language wheel', () => {
        const html = read('web/index.html');
        const css = read('web/commons/base.css');
        expect(html).toContain('class="dmodicon-ring"');
        expect(html).toContain('class="language-wheel"');
        expect(html).toContain('sbar/main.png');
        expect(css).toContain('font-family: "Pixel"');
        expect(css).toContain('backdrop-filter: blur(var(--panel-blur))');
        expect(html).not.toContain('sidebar-brand');
        expect(html).not.toContain('deltamod-revamp.css');
        expect(html).toContain('gicons/sheet.css');
        expect(html).not.toContain('href="https://fonts.googleapis.com');
    });
    it('includes refinement labels in every supported localization catalog', () => {
        const catalogs = fs.readdirSync(path.join(__dirname, '../web/langs'))
            .filter(code => fs.existsSync(path.join(__dirname, '../web/langs', code, 'language.json')))
            .map(code => JSON.parse(read(`web/langs/${code}/language.json`)));
        expect(catalogs).toHaveLength(17);
        for (const key of ['refine_search_mods','refine_search_hint','refine_clear','refine_mod_count',
            'refine_no_matches','refine_saving','refine_saved','refine_save_failed','refine_progress',
            'refine_patch_complete','refine_patch_log']) {
            for (const catalog of catalogs) expect(catalog[key], key).toBeTruthy();
        }
    });
    it('does not reload native lists on sort/filter changes or poll suggestions', () => {
        const helper = read('web/modules/frontend-refinements.js');
        expect(helper).not.toContain("invoke('getModList'");
        const shop = read('web/views/gamebanana-browse/index.js');
        expect(shop).not.toContain('let sval = 0');
        expect(shop).toContain('encodeURIComponent(query)');
        expect(shop).toContain('request.signal');
        const patch = read('web/views/patching/index.js');
        expect(patch).not.toContain('innerHTML +=');
        expect(patch).toContain('line.textContent = render ? boundedLogText(render()) : text');
    });
});
