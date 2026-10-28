const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');

const root = path.join(__dirname, '..', '..');
const webRoot = path.join(root, 'web');

test.use(process.platform === 'win32' ? { channel: 'msedge' } : {});

test('language changes translate the rendered page without navigation', async ({ page }) => {
    await page.route('http://deltamod.test/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/') {
            await route.fulfill({
                contentType: 'text/html',
                body: `<!doctype html><html lang="en"><body>
                    <nav aria-label="Options"><button title="Options">Options</button></nav>
                    <main><h1 data-i18n="options">Options</h1><p id="static-copy">Data</p></main>
                </body></html>`
            });
            return;
        }

        const match = url.pathname.match(/^\/langs\/([A-Za-z0-9-]+)\/(language\.json|metadata\.txt)$/);
        if (!match) {
            await route.abort();
            return;
        }
        await route.fulfill({
            contentType: match[2].endsWith('.json') ? 'application/json' : 'text/plain',
            body: fs.readFileSync(path.join(webRoot, 'langs', match[1], match[2]), 'utf8')
        });
    });

    await page.goto('http://deltamod.test/');
    await page.addScriptTag({ path: path.join(webRoot, 'modules', 'localization.js') });
    await page.evaluate(() => {
        window.__pageCalls = 0;
        window.pageN = 'main';
        window.page = async () => { window.__pageCalls += 1; };
    });
    await page.evaluate(() => window.Localization.ready);

    await page.evaluate(() => {
        const userContent = document.createElement('p');
        userContent.id = 'dynamic-user-content';
        userContent.textContent = 'Options';
        document.querySelector('main').appendChild(userContent);
    });

    for (const [code, options, data] of [
        ['it', 'Opzioni', 'Dati'],
        ['pl', 'Ustawienia', 'Dane'],
        ['es', 'Opciones', 'Datos'],
        ['fr', 'Options', 'Données'],
        ['de', 'Optionen', 'Daten'],
        ['pt-br', 'Opções', 'Dados'],
        ['ja', 'オプション', 'データ']
    ]) {
        await page.evaluate(language => window.Localization.setLanguage(language), code);
        await expect(page.locator('main h1')).toHaveText(options);
        await expect(page.locator('nav button')).toHaveText(options);
        await expect(page.locator('nav button')).toHaveAttribute('title', options);
        await expect(page.locator('#static-copy')).toHaveText(data);
        await expect(page.locator('#dynamic-user-content')).toHaveText('Options');
    }
    expect(await page.evaluate(() => window.__pageCalls)).toBe(0);
});

// Exercise the shipped wheel against real locale catalogs and flag assets.
async function openLanguageWheel(page, width = 800, { reducedMotion = 'reduce' } = {}) {
    const { openView, read } = require('./fixtures/refinement-page');
    await page.emulateMedia({ reducedMotion });
    await page.route('http://deltamod.test/**', async route => {
        const relative = new URL(route.request().url()).pathname.slice(1);
        if (relative === 'fixture') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html></html>' });
        const file = path.resolve(webRoot, relative);
        if (!file.startsWith(webRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
        await route.fulfill({
            contentType: require('mime-types').lookup(file) || 'application/octet-stream',
            body: fs.readFileSync(file)
        });
    });
    await page.goto('http://deltamod.test/fixture');
    await openView(page, 'options', { width });
    await page.evaluate(() => { window.prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches; });
    const shell = read('index.js');
    const start = shell.indexOf('async function setupLanguageWheel()');
    const end = shell.indexOf('\n/**', start);
    await page.addScriptTag({ content: shell.slice(start, end) });
    await page.evaluate(() => setupLanguageWheel());
    await page.locator('#language-wheel-toggle').click();
    await expect(page.locator('#language-wheel')).toHaveClass(/is-open/);
}

async function expectWheelFlags(page) {
    const flags = page.locator('#language-wheel-sectors image');
    await expect(flags).toHaveCount(await page.locator('.language-wheel-option').count());
    // Decode the exact URLs painted by the SVG patterns using the browser's image
    // decoder, so malformed, missing or blocked flag files fail the check.
    expect(await flags.evaluateAll(async nodes => Promise.all(nodes.map(node => new Promise(resolve => {
        const image = new Image();
        image.onload = () => resolve(image.naturalWidth > 0 && image.naturalHeight > 0);
        image.onerror = () => resolve(false);
        image.src = node.href.baseVal;
    }))))).not.toContain(false);
    await expect(page.locator('.language-wheel-option img')).toHaveCount(0);
    await expect(page.locator('.language-wheel-current img')).toHaveCount(0);
}

test('the language wheel has two complete flag pages and retains selection, keyboard and focus', async ({ page }) => {
    await openLanguageWheel(page);
    const wheel = page.locator('#language-wheel');
    const options = page.locator('.language-wheel-option');
    await expect(options).toHaveCount(9);
    await expect(page.locator('#language-wheel-page')).toHaveText('1 / 2');
    await expect(page.locator('#language-wheel-previous')).toBeDisabled();
    const first = await options.evaluateAll(buttons => buttons.map(button => button.dataset.language));
    await expectWheelFlags(page);

    // Replacing a sector under a stationary pointer must not override keyboard preview.
    await page.locator('.language-wheel-option[data-language="ru"]').hover();
    await options.first().focus();
    await page.keyboard.press('PageDown');
    await expect(page.locator('#language-wheel-current-name')).toHaveText('简体中文');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
    await expect(page.locator('#language-wheel-current-name')).toHaveText('繁體中文');
    await expect(options).toHaveCount(8);
    await expect(page.locator('#language-wheel-next')).toBeDisabled();
    await expect(page.locator('#language-wheel-page')).toHaveText('2 / 2');
    const second = await options.evaluateAll(buttons => buttons.map(button => button.dataset.language));
    expect(new Set([...first, ...second]).size).toBe(17);
    expect([...first, ...second]).toEqual(await page.evaluate(async () => (await window.Localization.getLanguages()).map(language => language.code)));
    await expectWheelFlags(page);

    // All page controls participate in the dialog's keyboard focus loop.
    await page.locator('#language-wheel-previous').focus();
    await page.keyboard.press('Tab');
    await expect(options.first()).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#language-wheel-previous')).toBeFocused();
    // A pending settings language change may settle while the dialog is open.
    await options.first().focus();
    await page.evaluate(() => window.Localization.setLanguage('it'));
    await expect(page.locator('.language-wheel-option[data-language="it"]')).toBeFocused();
    await page.evaluate(() => window.Localization.setLanguage('ar'));
    await expect(page.locator('.language-wheel-option[data-language="ar"]')).toBeFocused();
    await page.locator('#language-wheel-previous').focus();
    await page.evaluate(() => window.Localization.setLanguage('en'));
    await expect(page.locator('.language-wheel-option[data-language="en"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(wheel).toBeHidden();
    await expect(page.locator('#language-wheel-toggle')).toBeFocused();

    await page.locator('#language-wheel-toggle').click();
    await expect(wheel).toHaveAttribute('data-page', '1');
    await expect(page.locator('.language-wheel-option[data-language="en"]')).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.locator('.language-wheel-option[data-language="ar"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.Localization.getLanguage())).toBe('ar');
    await expect(wheel).toBeHidden();
    await page.locator('#language-wheel-toggle').click();
    await expect(wheel).toHaveAttribute('data-page', '2');
    await expect(page.locator('.language-wheel-option[data-language="ar"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.language-wheel-option[data-language="ar"]')).toBeFocused();
    await page.locator('#language-wheel-backdrop').click({ position: { x: 5, y: 5 } });
    await expect(wheel).toBeHidden();
    await expect(page.locator('#language-wheel-toggle')).toBeFocused();
});

for (const width of [800, 1366]) {
    test(`both language pages show legible flags and pagination at ${width}px`, async ({ page }, info) => {
        await openLanguageWheel(page, width);
        await page.evaluate(() => window.Localization.setLanguage('it'));
        const wheel = page.locator('#language-wheel');
        const shots = [];
        for (const number of [1, 2]) {
            await expect(wheel).toHaveAttribute('data-page', String(number));
            await expectWheelFlags(page);
            const bounds = await page.locator('#language-wheel-next').boundingBox();
            expect(bounds.width).toBeGreaterThanOrEqual(40);
            expect(bounds.height).toBeGreaterThanOrEqual(40);
            shots.push(await page.screenshot({ path: info.outputPath(`wheel-page-${number}-${width}.png`) }));
            if (number === 1) await page.locator('#language-wheel-next').click();
        }
        expect(shots).toHaveLength(2);
    });
}


test('the animated language wheel survives close and immediate reopen', async ({ page }) => {
    await openLanguageWheel(page, 800, { reducedMotion: 'no-preference' });
    await expect(page.locator('.language-wheel-option[data-language="en"]')).toBeFocused();
    // Two events within the same task exercise cancellation of the 230ms close timer.
    await page.evaluate(() => {
        document.getElementById('language-wheel-backdrop').click();
        document.getElementById('language-wheel-toggle').click();
    });
    await page.waitForTimeout(300);
    await expect(page.locator('#language-wheel')).toBeVisible();
    await expect(page.locator('#language-wheel')).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('#language-wheel-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.language-wheel-option[data-language="en"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#language-wheel')).toBeHidden();
    await expect(page.locator('#language-wheel-toggle')).toBeFocused();
});

async function measureWheelFlagCoverage(page) {
    const urls = await page.locator('#language-wheel-sectors image').evaluateAll(images => images.map(image => image.getAttribute('href')));
    const originals = Object.fromEntries(urls.map(url => {
        const file = path.resolve(webRoot, new URL(url, 'http://deltamod.test/').pathname.slice(1));
        if (!file.startsWith(webRoot + path.sep)) throw new Error('Unexpected flag path');
        return [url, fs.readFileSync(file, 'utf8')];
    }));
    return page.evaluate(async originals => {
        const svg = document.getElementById('language-wheel-sectors');
        const snapshot = svg.cloneNode(true);
        snapshot.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        snapshot.setAttribute('width', '330');
        snapshot.setAttribute('height', '330');
        // Make the actual flag assets self-contained for a transparent SVG raster.
        // Alpha distinguishes unpainted gaps from legitimate black flag stripes.
        for (const image of snapshot.querySelectorAll('image')) {
            image.setAttribute('href', `data:image/svg+xml;charset=utf-8,${encodeURIComponent(originals[image.getAttribute('href')])}`);
        }
        const image = new Image();
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(snapshot))}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 330;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, 330, 330).data;
        return [...svg.querySelectorAll('.language-wheel-sector')].map(sector => {
            let sampled = 0, uncovered = 0, minimumAlpha = 255;
            const box = sector.getBBox();
            for (let y = Math.ceil(box.y); y < box.y + box.height; y += 3) {
                for (let x = Math.ceil(box.x); x < box.x + box.width; x += 3) {
                    // Exclude the antialiased boundary and the deliberate inter-sector gap.
                    if (![[0, 0], [-2, 0], [2, 0], [0, -2], [0, 2]].every(([dx, dy]) =>
                        sector.isPointInFill(new DOMPoint(x + .5 + dx, y + .5 + dy)))) continue;
                    sampled += 1;
                    const alpha = pixels[(y * 330 + x) * 4 + 3];
                    minimumAlpha = Math.min(minimumAlpha, alpha);
                    if (alpha < 250) uncovered += 1;
                }
            }
            return { language: sector.dataset.language, sampled, uncovered, minimumAlpha };
        });
    }, originals);
}

test('opaque flags paint every wedge interior across both language pages', async ({ page }) => {
    await openLanguageWheel(page);
    const measurements = [];
    for (const number of [1, 2]) {
        await expect(page.locator('#language-wheel')).toHaveAttribute('data-page', String(number));
        await expectWheelFlags(page);
        measurements.push(...await measureWheelFlagCoverage(page));
        if (number === 1) await page.locator('#language-wheel-next').click();
    }
    expect(measurements).toHaveLength(17);
    expect(measurements.every(result => result.sampled > 100)).toBe(true);
    expect(measurements.filter(result => result.uncovered > 0)).toEqual([]);
});
