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
