// SPDX-FileCopyrightText: 2026 cmdr-chara
// SPDX-License-Identifier: EUPL-1.2
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { openView, web } = require('./fixtures/refinement-page');
const { LANGUAGES } = require('../../scripts/check-localization');
const catalog = code => JSON.parse(fs.readFileSync(path.join(web, 'langs', code, 'language.json'), 'utf8'));

async function settleFonts(page) {
    await page.evaluate(async () => {
        await new Promise(resolve => requestAnimationFrame(resolve));
        await document.fonts.ready;
    });
}

test('all seventeen languages fit the minimum and wide desktop layouts without restarting', async ({ page }, info) => {
    await openView(page, 'main', { count: 3, width: 800 });
    const original = await page.locator('#modlist tr').first().elementHandle();
    for (const width of [800, 1366]) {
        await page.setViewportSize({ width, height: 720 });
        for (const code of LANGUAGES) {
            await page.evaluate(code => window.Localization.setLanguage(code), code);
            await settleFonts(page);
            await expect(page.locator('#vanilla [data-i18n]')).toHaveText(catalog(code).main_launch_vanilla);
            await expect(page.locator('html')).toHaveAttribute('dir', code === 'ar' ? 'rtl' : 'ltr');
            expect(await original.evaluate(node => node.isConnected), `${code}: retained rows`).toBe(true);
            expect(await page.locator('.viewport').evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${code} at ${width}: no horizontal overflow`).toBe(true);
            const clipped = await page.locator('#vanilla, .patch-sort-control, .mod-search-toolbar').evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().width > 0 && node.scrollWidth > node.clientWidth + 2).map(node => node.id || node.className));
            expect(clipped, `${code} at ${width}: controls wrap`).toEqual([]);
            expect(await page.locator('#vanilla .material-symbols-outlined').evaluate(node => getComputedStyle(node).fontFamily)).toContain('Material Symbols');
            if (['ar', 'ja', 'zh-CN', 'ko', 'th', 'ru', 'de'].includes(code) && width === 800) await page.screenshot({ path: info.outputPath(`locale-${code}-800.png`) });
        }
    }
});

test('Arabic mirrors the rail, isolates mixed text, and changes back without losing a search', async ({ page }, info) => {
    await openView(page, 'main', { count: 4, width: 800 });
    await page.locator('#mod-search').fill('Forest');
    await page.locator('#mod-search').focus();
    await page.evaluate(async () => {
        await window.Localization.setLanguage('ar');
        const paragraph = document.createElement('p');
        paragraph.id = 'mixed-direction';
        window.Localization.bind(paragraph, 'main_enable_mod', 'Enable {0}', 'C:\\Games\\DELTARUNE\\data.win');
        document.querySelector('.viewport').append(paragraph);
    });
    await settleFonts(page);
    const positions = await page.evaluate(() => {
        const rail = document.querySelector('.sidebar').getBoundingClientRect();
        const view = document.querySelector('.viewport').getBoundingClientRect();
        return { railLeft: rail.left, railRight: rail.right, viewLeft: view.left, viewRight: view.right, width: innerWidth };
    });
    expect(positions.railRight).toBeCloseTo(positions.width, 0);
    expect(positions.viewRight).toBeLessThanOrEqual(positions.railLeft + 1);
    expect(await page.locator('#mixed-direction').textContent()).toContain('\u2068C:\\Games\\DELTARUNE\\data.win\u2069');
    await expect(page.locator('#mod-search')).toHaveValue('Forest');
    await expect(page.locator('#mod-search')).toBeFocused();
    await page.screenshot({ path: info.outputPath('rtl-mixed-content.png') });
    await page.evaluate(() => window.Localization.setLanguage('en'));
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('#mod-search')).toHaveValue('Forest');
    expect(await page.locator('.sidebar').evaluate(node => node.getBoundingClientRect().left)).toBeCloseTo(0, 0);
});

test('locale-aware plural forms, dates and numbers agree with the selected locale in the browser', async ({ page }) => {
    await openView(page, 'main');
    for (const code of LANGUAGES) {
        const result = await page.evaluate(async code => {
            const api = window.Localization;
            await api.setLanguage(code);
            const locale = api.getLocale();
            const stripIsolates = text => text.replace(/[\u2068\u2069]/g, '');
            return {
                number: api.number(12345.67), expectedNumber: new Intl.NumberFormat(locale).format(12345.67),
                date: api.date(0, { dateStyle: 'long', timeZone: 'UTC' }),
                expectedDate: new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(0),
                relative: api.relativeTime(0, 120000), expectedRelative: new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-2, 'minute'),
                plural: [0, 1, 2, 3, 5, 11, 21, 101, 1.5].map(count => ({ count, category: new Intl.PluralRules(locale).select(count), value: stripIsolates(api.plural('gb_comments', count)), number: api.number(count) }))
            };
        }, code);
        expect(result.number).toBe(result.expectedNumber);
        expect(result.date).toBe(result.expectedDate);
        expect(result.relative).toBe(result.expectedRelative);
        const dictionary = catalog(code);
        for (const { category, value, number } of result.plural) expect(value).toBe(dictionary[`gb_comments_${category}`].replace('{0}', number));
    }
});

test('Options keeps a saved checkbox and focus while long labels and RTL categories reflow', async ({ page }, info) => {
    await openView(page, 'options', { width: 800 });
    const checkbox = page.locator('#FLAG-HASHCHECKS');
    await expect(checkbox).toBeVisible();
    await checkbox.click();
    await expect(checkbox).toBeChecked();
    await expect(page.locator('.control-save-status')).toHaveText('Saved');
    await checkbox.focus();
    await page.evaluate(() => {
        window.__optionsCheckbox = document.getElementById('FLAG-HASHCHECKS');
        window.__optionsCalls = window.__calls.length;
    });
    for (const code of ['ar', 'de', 'ja', 'ko']) {
        await page.evaluate(code => window.Localization.setLanguage(code), code);
        await settleFonts(page);
        await expect(checkbox).toBeChecked();
        await expect(checkbox).toBeEnabled();
        await expect(checkbox).toBeFocused();
        await expect(checkbox).toHaveAttribute('aria-label', catalog(code).community_hash_title);
        await expect(page.locator('#b_gen')).toHaveClass(/selected/);
        expect(await page.locator('.viewport').evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${code}: options viewport`).toBe(true);
        const clipped = await page.locator('.cat button:visible, .setting-control, .setting-title').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 2).map(node => node.id || node.className));
        expect(clipped, `${code}: options labels wrap`).toEqual([]);
        if (code === 'ar') await page.screenshot({ path: info.outputPath('options-ar-800.png') });
    }
    expect(await page.evaluate(() => ({
        sameCheckbox: window.__optionsCheckbox === document.getElementById('FLAG-HASHCHECKS'),
        calls: window.__calls.length === window.__optionsCalls,
        navigation: window.__pageTarget
    }))).toEqual({ sameCheckbox: true, calls: true, navigation: undefined });
});

test('Options uses the shell language picker and safely falls back from the removed Language category', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await openView(page, 'options', { width: 1100, beforeScript: async page => {
        await page.evaluate(() => {
            window._pageArguments = { cat: 'lang' };
            window.communityAPI.profile = { summary: async () => ({ exists: false }) };
        });
    } });
    await expect(page.locator('#FLAG-HASHCHECKS')).toBeVisible();
    await expect(page.locator('#b_gen')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#b_lang, .language-option-row')).toHaveCount(0);
    expect(await page.evaluate(async () => (await window.Localization.getLanguages()).map(language => language.code))).toEqual(LANGUAGES);

    await page.locator('#b_gen').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#b_ui')).toBeFocused();
    await page.keyboard.press('Enter');
    const checkbox = page.locator('#FLAG-AUDIO');
    await expect(checkbox).toBeVisible();
    await expect(page.locator('#b_ui')).toHaveAttribute('aria-current', 'page');
    await checkbox.focus();
    await page.evaluate(() => { window.__existingOptionsControl = document.getElementById('FLAG-AUDIO'); });
    await page.evaluate(() => window.Localization.setLanguage('ar', { refreshPage: false }));
    await settleFonts(page);
    await expect(page.locator('#b_ui')).toHaveText(catalog('ar').optcat_ui);
    await expect(checkbox).toBeFocused();
    expect(await checkbox.evaluate(node => node === window.__existingOptionsControl)).toBe(true);
    await expect(page.locator('#b_lang, .language-option-row')).toHaveCount(0);

    await page.locator('#b_ui').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#b_inst')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#b_data')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#b_data')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.rowheader .setting-title')).toBeVisible();

    await page.evaluate(() => window.currentPageStack.cat('lang'));
    await expect(page.locator('#FLAG-HASHCHECKS')).toBeVisible();
    await expect(page.locator('#b_gen')).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => window.__pageTarget)).toBeUndefined();
    expect(errors).toEqual([]);
});

test('Options keeps the display font consistent between controls, section headings and information rows', async ({ page }, info) => {
    await openView(page, 'options', { width: 1100, beforeScript: async page => {
        await page.evaluate(() => {
            window.communityAPI.profile = { summary: async () => ({ exists: false }) };
        });
    } });
    await expect(page.locator('#FLAG-HASHCHECKS')).toBeVisible();
    await page.evaluate(async () => {
        await window.Localization.setLanguage('it');
        await window.currentPageStack.cat('ui');
    });
    await settleFonts(page);
    const controlFont = await page.locator('.setting-title').first().evaluate(node => getComputedStyle(node).fontFamily);
    expect(controlFont).toContain('Pixel');

    await page.evaluate(() => window.currentPageStack.cat('data'));
    const section = page.locator('.rowheader > div > span').last();
    const information = page.locator('#options tr').nth(1).locator('td').first().locator('span').first();
    await expect(information).toHaveText('Profilo di Deltamod ufficiale');
    await settleFonts(page);
    for (const heading of [section, information]) {
        expect(await heading.evaluate(node => getComputedStyle(node).fontFamily)).toBe(controlFont);
    }
    // Inspect the actual face used for accented Italian, not only a declared
    // family whose file might be missing or fall back one character at a time.
    const session = await page.context().newCDPSession(page);
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const { root } = await session.send('DOM.getDocument');
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.rowheader > div > span:last-child' });
    const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.every(font => font.isCustomFont && /8bitoperator/i.test(font.familyName))).toBe(true);
    await session.detach();
    await page.screenshot({ path: info.outputPath('options-data-it-fonts.png') });

    for (const [code, font] of [['ar', 'Noto Sans Arabic'], ['ja', 'Noto Sans CJK']]) {
        await page.evaluate(code => window.Localization.setLanguage(code), code);
        await settleFonts(page);
        for (const heading of [section, information]) {
            expect(await heading.evaluate(node => getComputedStyle(node).fontFamily)).toContain(font);
        }
        expect(await page.locator('.rowheader .material-symbols-outlined').evaluate(node => getComputedStyle(node).fontFamily)).toContain('Material Symbols');
    }
    await page.evaluate(() => window.Localization.setLanguage('it'));
    await settleFonts(page);
    expect(await information.evaluate(node => getComputedStyle(node).fontFamily)).toBe(controlFont);
});

test('Halloween stays behind content and outside the navigation rail in both layout directions', async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    for (const view of ['options', 'gamebanana-browse', 'credits']) {
        await openView(page, view, { width: 800, beforeScript: async page => {
            await page.evaluate(view => {
                if (view === 'gamebanana-browse') {
                    const game = { id: 'toby.undertale', name: 'UNDERTALE', gamebanana: { id: 6755 } };
                    window.IntersectionObserver = class { observe() {} disconnect() {} };
                    window.deltamodBackend.invokeOptional = async () => null;
                    window.deltamodBackend.invoke = async channel => {
                        if (channel === 'getAvailableGames') return [game];
                        if (channel === 'getCurrentGameInfo') return game;
                        return false;
                    };
                    window.communityAPI.modSources = { browse: async request => ({ ok: true, result: { payload:
                        request.url.includes('/TopSubs') ? [] : { _aMetadata: { _bIsComplete: true }, _aRecords: [{
                            _idRow: 42, _sModelName: 'Mod', _sName: 'Moonlight', _sDescription: 'A mod.',
                            _aSubmitter: { _sName: 'Moon team' }, _sImageUrl: window.__placeholder,
                            _nLikeCount: 6, _nPostCount: 1
                        }] }
                    } }) };
                } else if (view === 'credits') {
                    window.communityAPI.app = { version: async () => '2.1.0', openMaintainerProfile() {} };
                    const fetch = window.fetch;
                    window.fetch = url => String(url).includes('/Tool/20575/ProfilePage')
                        ? Promise.resolve(new Response(JSON.stringify({ _aCredits: [] }), { status: 200 })) : fetch(url);
                }
            }, view);
        } });
        const label = page.locator(view === 'options' ? '.setting-title' : view === 'gamebanana-browse' ? '.modTitleSpan' : '.maintainer-copy h2').first();
        await expect(label).toBeVisible();
        // The normal fixture omits shell startup. Load the real seasonal
        // controller explicitly and force a date-independent Halloween preview.
        await page.addScriptTag({ path: path.join(web, 'modules/seasonal-events.js') });
        await page.evaluate(() => {
            window.SeasonalEvents.setMode('halloween');
            window.SeasonalEvents.setThemeReady(true);
        });
        const layer = page.locator('#deltamod-seasonal-layer');
        await expect(layer).toHaveAttribute('data-event', 'halloween');
        await expect(layer).toHaveAttribute('data-active', 'true');
        await expect(layer).toHaveCSS('opacity', '1');
        await expect(page.locator('.seasonal-particle')).toHaveCount(18);
        for (const width of [800, 1366]) {
            await page.setViewportSize({ width, height: 800 });
            for (const code of ['it', 'ar']) {
                await page.evaluate(code => window.Localization.setLanguage(code), code);
                await settleFonts(page);
                const geometry = await page.evaluate(() => {
                    const rect = node => {
                        const value = node.getBoundingClientRect();
                        return { left: value.left, right: value.right, top: value.top, bottom: value.bottom };
                    };
                    return {
                        layer: rect(document.getElementById('deltamod-seasonal-layer')),
                        rail: rect(document.querySelector('.sidebar')),
                        toggle: rect(document.getElementById('language-wheel-toggle')),
                        corners: [...document.querySelectorAll('.seasonal-corner')].map(rect)
                    };
                });
                await page.screenshot({ path: info.outputPath(`halloween-${view}-${code}-${width}.png`) });
                for (const corner of geometry.corners) {
                    for (const control of [geometry.rail, geometry.toggle]) {
                        const overlaps = corner.left < control.right && corner.right > control.left
                            && corner.top < control.bottom && corner.bottom > control.top;
                        expect(overlaps, `${view}/${code}/${width}: a Halloween mark must not overlap navigation`).toBe(false);
                    }
                }
                expect(code === 'ar' ? geometry.layer.right <= geometry.rail.left : geometry.layer.left >= geometry.rail.right,
                    `${view}/${code}/${width}: the seasonal scene excludes the rail`).toBe(true);

                // Put one real particle over a label, then inspect actual paint
                // order. Temporarily enabling hit testing reveals decoration
                // stacking; restore its noninteractive state immediately.
                const ordering = await label.evaluate(node => {
                    const host = document.getElementById('deltamod-seasonal-layer');
                    const particle = host.querySelector('.seasonal-particle');
                    const label = node.getBoundingClientRect();
                    const bounds = host.getBoundingClientRect();
                    const x = label.left + Math.min(8, label.width / 2), y = label.top + label.height / 2;
                    const previousHost = host.getAttribute('style'), previousParticle = particle.getAttribute('style');
                    host.style.pointerEvents = 'auto';
                    particle.style.cssText = `left:${x - bounds.left - 8}px;top:${y - bounds.top - 8}px;width:16px;height:16px;animation:none;opacity:1;pointer-events:auto;`;
                    const stack = document.elementsFromPoint(x, y);
                    const foreground = stack.findIndex(element => element === node || node.contains(element));
                    const background = stack.indexOf(particle);
                    if (previousHost === null) host.removeAttribute('style'); else host.setAttribute('style', previousHost);
                    if (previousParticle === null) particle.removeAttribute('style'); else particle.setAttribute('style', previousParticle);
                    return { foreground, background };
                });
                expect(ordering.foreground, `${view}/${code}/${width}: label participates in paint order`).toBeGreaterThanOrEqual(0);
                expect(ordering.background, `${view}/${code}/${width}: Halloween stays behind the label`).toBeGreaterThan(ordering.foreground);
                await expect(layer).toHaveCSS('pointer-events', 'none');
            }
        }
        if (view === 'options') {
            const shell = fs.readFileSync(path.join(web, 'index.js'), 'utf8');
            const alerts = shell.slice(shell.indexOf('let alertQueue'), shell.indexOf('\nfunction credits('));
            await page.addScriptTag({ content: `
                const MOTION = { standard: 0, easeIn: 'ease', easeOut: 'ease' };
                const prefersReducedMotion = () => true;
                window.shellText = (source, ...args) => window.Localization.text(source, ...args);
                ${alerts}
            ` });
            await page.evaluate(() => {
                window.__seasonalDialog = htmlAlert('Options', 'Halloween', [{ text: 'OK', resolveWith: 'ok' }]);
            });
            const dialog = page.getByRole('alertdialog');
            await expect(dialog).toBeVisible();
            await expect(page.locator('.alertMain')).toHaveCSS('opacity', '1');
            await expect(layer).toHaveJSProperty('inert', true);
            const inFront = await dialog.evaluate(node => {
                const host = document.getElementById('deltamod-seasonal-layer');
                const previous = host.style.pointerEvents;
                // Alerts make the scene inert as well as noninteractive. Lift
                // that only during the paint-order probe, then restore it.
                const wasInert = host.inert;
                host.inert = false;
                host.style.pointerEvents = 'auto';
                const bounds = node.getBoundingClientRect();
                const stack = document.elementsFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
                const index = stack.indexOf(node);
                const result = index >= 0 && stack.indexOf(host) > index;
                host.style.pointerEvents = previous;
                host.inert = wasInert;
                return result;
            });
            expect(inFront, 'the real alert paints in front of Halloween').toBe(true);
            await page.screenshot({ path: info.outputPath('halloween-options-ar-dialog.png') });
            await dialog.getByRole('button').click();
            await expect(dialog).not.toBeVisible();
            await expect(layer).toHaveAttribute('data-active', 'true');
        }
    }
});

test('the real Options recovery confirmation translates in place and cancels without deleting data', async ({ page }, info) => {
    await openView(page, 'options', { width: 800, beforeScript: async page => {
        await page.evaluate(() => {
            window._pageArguments = { cat: 'adv' };
            const invoke = window.deltamodBackend.invoke;
            window.deltamodBackend.isCommandAvailable = channel => ['storage:getUsage', 'storage:clearCache', 'storage:deleteRecoveryData'].includes(channel);
            window.deltamodBackend.invoke = async (channel, args = []) => {
                if (channel === 'storage:getUsage') {
                    window.__calls.push([channel, args]);
                    return { cacheBytes: 2048, recoveryBytes: 4096, journalBytes: 512 };
                }
                return invoke(channel, args);
            };
        });
    } });
    const source = fs.readFileSync(path.join(web, 'index.js'), 'utf8');
    const alerts = source.slice(source.indexOf('let alertQueue'), source.indexOf('\nfunction credits('));
    await page.addScriptTag({ content: `
        const MOTION = { standard: 0, easeIn: 'ease', easeOut: 'ease' };
        const prefersReducedMotion = () => true;
        window.shellText = (source, ...args) => window.Localization.text(source, ...args);
        ${alerts}
    ` });
    const opener = page.getByRole('button', { name: 'Delete recovery data', exact: true });
    await expect(opener).toBeEnabled();
    const openerNode = await opener.elementHandle();
    await page.evaluate(() => {
        const localization = window.Localization;
        window.__releasedDialogs = 0;
        window.Localization = Object.freeze({ ...localization, release(root) {
            window.__releasedDialogs++;
            localization.release(root);
        } });
    });
    await opener.click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await page.evaluate(() => {
        window.__recoveryFocus = document.activeElement;
        window.__recoveryDialog = document.querySelector('[role="alertdialog"]');
    });
    for (const code of ['ar', 'ja']) {
        await page.evaluate(code => window.Localization.setLanguage(code), code);
        await settleFonts(page);
        await expect(page.locator('.rowheader .material-symbols-outlined')).toHaveText('warning');
        await expect(page.locator('.rowheader > div > span').last()).toHaveText(await page.evaluate(() =>
            window.Localization.text('Please only change these settings if you know what they do.')));
        const expected = await page.evaluate(() => ({
            title: window.Localization.text('Delete recovery data?'),
            message: window.Localization.text('Older removable rollback generations will be permanently deleted. Active and required recovery data will be preserved.'),
            cancel: window.Localization.text('Cancel')
        }));
        await expect(page.locator('#community-alert-title')).toHaveText(expected.title);
        await expect(page.locator('#community-alert-description')).toHaveText(expected.message);
        await expect(dialog.getByRole('button', { name: expected.cancel, exact: true })).toBeVisible();
        expect(await page.evaluate(() => ({
            sameDialog: window.__recoveryDialog === document.querySelector('[role="alertdialog"]'),
            sameFocus: window.__recoveryFocus === document.activeElement,
            inert: document.querySelector('.viewport').inert
        }))).toEqual({ sameDialog: true, sameFocus: true, inert: true });
        expect(await dialog.evaluate(node => {
            const rect = node.getBoundingClientRect();
            const content = node.firstElementChild;
            // The clipped decorative icon intentionally extends beyond the
            // dialog; measure the readable content and controls instead.
            return rect.left >= 0 && rect.right <= innerWidth + 1 && content.scrollWidth <= content.clientWidth + 2;
        }), `${code}: recovery dialog fits`).toBe(true);
        await page.screenshot({ path: info.outputPath(`recovery-dialog-${code}-800.png`) });
    }
    await dialog.getByRole('button', { name: catalog('ja').cancel, exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(await openerNode.evaluate(node => node === document.activeElement)).toBe(true);
    await expect(page.locator('#b_adv')).toHaveClass(/selected/);
    expect(await page.evaluate(() => ({
        deletions: window.__calls.filter(([channel]) => channel === 'storage:deleteRecoveryData').length,
        released: window.__releasedDialogs,
        inert: document.querySelector('.viewport').inert,
        navigation: window.__pageTarget
    }))).toEqual({ deletions: 0, released: 1, inert: false, navigation: undefined });
});
