const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'web/index.js'), 'utf8');
const languageFiles = Object.fromEntries(fs.readdirSync(path.join(root, 'web/langs')).flatMap(code =>
    ['language.json', 'metadata.txt'].flatMap(name => {
        const file = path.join(root, 'web/langs', code, name);
        return fs.existsSync(file) ? [[`./langs/${code}/${name}`, fs.readFileSync(file, 'utf8')]] : [];
    })
));
const italian = JSON.parse(languageFiles['./langs/it/language.json']);
async function setup(page) {
    await page.setViewportSize({width: 1280, height: 800});
    await page.setContent('<button class="theme-replay-event">Replay awakening</button>');
    await page.addStyleTag({path: path.join(root, 'web/index.css')});
    // The real shell initializes localization before its transition functions.
    // Keep that dependency here so accessibility bindings exercise real catalogs.
    await page.evaluate(files => {
        window.fetch = async url => {
            const body = files[String(url)];
            return new Response(body || '', { status: body === undefined ? 404 : 200 });
        };
    }, languageFiles);
    await page.addScriptTag({path: path.join(root, 'web/modules/localization.js')});
    await page.evaluate(async () => {
        await window.Localization.ready;
        await window.Localization.setLanguage('en');
    });
    const assets = Object.fromEntries(fs.readdirSync(path.join(root,'web/themes/img/the-knight-transition')).map(name => [name, 'data:image/png;base64,' + fs.readFileSync(path.join(root,'web/themes/img/the-knight-transition',name)).toString('base64')]));
    await page.evaluate(assets => {
        window.theme = {transitionEffect: 'roaring-knight-monochrome-awakening'};
        window.themeAssetUrl = (theme, kind, file) => assets[file.split('/').pop()];
        window.applyThemeStyles = () => {};
        window.deltamodBackend = {invoke: async () => false};
        window.__completed = 0;
    },assets);
    await page.addScriptTag({content: source.slice(0, source.indexOf('var themeTransitionGeneration = 0;') + 'var themeTransitionGeneration = 0;'.length).split('\n').filter(line => /^var themeTransition/.test(line)).join('\n') + '\n' + source.slice(source.indexOf('const ROARING_KNIGHT_TRANSITION'), source.indexOf('function setThemeVideoAudioEnabled'))});
    await page.evaluate(() => {
        window.completeRoaringKnightAwakening = () => { themeTransitionCompleted = true; window.__completed++; };
    });
}
test('awakening uses one crisp sprite, three distinct cuts and a short reveal', async ({page}, info) => {
    await setup(page);
    await page.clock.install();
    await page.evaluate(() => playRoaringKnightTransition());
    await expect(page.locator('#theme-transition-overlay')).toHaveAttribute('aria-label', 'Roaring Knight awakening');
    await expect(page.locator('#theme-transition-skip')).toHaveText('Skip · Esc');
    await page.locator('#theme-transition-skip').focus();
    const sameTransition = await page.evaluate(async () => {
        const overlay = document.getElementById('theme-transition-overlay');
        const skip = document.getElementById('theme-transition-skip');
        await window.Localization.setLanguage('it');
        return overlay === document.getElementById('theme-transition-overlay')
            && skip === document.getElementById('theme-transition-skip');
    });
    expect(sameTransition).toBe(true);
    await expect(page.locator('#theme-transition-overlay')).toHaveAttribute('aria-label', italian.shell_knight_awakening);
    await expect(page.locator('#theme-transition-skip')).toHaveText(italian.shell_skip);
    await expect(page.locator('#theme-transition-skip')).toBeFocused();
    await page.clock.runFor(700);
    await expect(page.locator('.theme-transition-knight')).toHaveCount(1);
    await expect(page.locator('.theme-transition-fountain, .theme-transition-sigil, .theme-transition-particles, .theme-transition-soul, .theme-transition-flight')).toHaveCount(0);
    expect(await page.locator('.theme-transition-knight').evaluate(node => getComputedStyle(node).filter)).toBe('none');
    await expect.poll(() => page.locator('.theme-transition-knight').evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
    await page.evaluate(() => document.getAnimations().forEach(animation => { animation.currentTime = 700; animation.pause(); }));
    await page.screenshot({path: info.outputPath('knight-arrival.png')});
    await page.clock.runFor(300);
    await expect(page.locator('.theme-transition-rift.is-cut')).toHaveCount(1);
    await page.clock.runFor(370);
    await expect(page.locator('.theme-transition-rift.is-cut')).toHaveCount(2);
    await page.clock.runFor(370);
    await expect(page.locator('.theme-transition-rift.is-cut')).toHaveCount(3);
    await page.evaluate(() => {
        const cuts = [...document.querySelectorAll('.theme-transition-rift.is-cut')];
        document.getAnimations().forEach(animation => {
            const cut = cuts.indexOf(animation.effect?.target);
            animation.currentTime = cut < 0 ? 1740 : 1740 - ROARING_KNIGHT_TRANSITION.cutTimes[cut];
            animation.pause();
        });
    });
    await page.screenshot({path: info.outputPath('knight-three-cuts.png')});
    await page.clock.runFor(460);
    expect(await page.evaluate(() => window.__completed)).toBe(1);
    await expect(page.locator('#theme-transition-overlay')).toHaveClass(/is-releasing/);
    await page.clock.runFor(600);
    await expect(page.locator('#theme-transition-overlay')).toHaveCount(0);
    await expect(page.locator('.theme-replay-event')).toBeFocused();
});
test('Escape cancels every phase and replay creates only one event', async ({page}) => {
    await setup(page);
    await page.clock.install();
    await page.evaluate(() => { playRoaringKnightTransition(); playRoaringKnightTransition(); });
    await expect(page.locator('#theme-transition-overlay')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.clock.runFor(8000);
    await expect(page.locator('#theme-transition-overlay')).toHaveCount(0);
    expect(await page.evaluate(() => window.__completed)).toBe(1);
    expect(await page.evaluate(() => themeTransitionPhaseTimers.length)).toBe(0);
    await page.evaluate(() => replayRoaringKnightTransition());
    await expect(page.locator('#theme-transition-overlay')).toHaveCount(1);
    await page.locator('#theme-transition-skip').click();
    await page.clock.runFor(3000);
    await expect(page.locator('#theme-transition-overlay')).toHaveCount(0);
    expect(await page.evaluate(() => window.__completed)).toBe(2);
    expect(await page.evaluate(() => themeTransitionPhaseTimers.length)).toBe(0);
});
test('reduced motion completes immediately without the event', async ({page}) => {
    await setup(page);
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.evaluate(() => playRoaringKnightTransition());
    await expect(page.locator('#theme-transition-overlay')).toHaveCount(0);
    expect(await page.evaluate(() => window.__completed)).toBe(1);
});

test('navigation retains the awakened Knight palette in seasonal decorations', async ({ page }) => {
    const { openView } = require('./fixtures/refinement-page');
    await openView(page, 'options', { width: 1280 });
    const knightTheme = JSON.parse(fs.readFileSync(path.join(root, 'web/themes/data/the-knight.theme.json'), 'utf8'));
    await page.addScriptTag({ path: path.join(root, 'web/modules/theme-sprites.js') });
    await page.addScriptTag({ path: path.join(root, 'web/modules/seasonal-events.js') });
    await page.evaluate(themeConfig => {
        document.documentElement.removeAttribute('style');
        document.documentElement.classList.add('roaring-knight-awakened');
        window.theme = themeConfig;
        window.themeTransitionCompleted = true;
        window.currentPageScript = null;
        window.addedStyle = null;
        window.PAGE_REGISTRY = { main: {}, credits: {} };
        window.loadPageMarkup = async () => '<p>Native-route palette fixture</p>';
        window.themeUsesIntegratedVideoAudio = () => false;
        window.releaseAudioBuffer = () => {};
        window.signalBenchmarkReadiness = async () => {};
        // Sprite recoloring is a separate contract; keep real color parsing.
        window.ThemeSprites = { ...window.ThemeSprites, apply: async () => {} };
        window.setRoaringKnightSpriteSet = () => {};
        window.SeasonalEvents.setMode('halloween');
        window.SeasonalEvents.setThemeReady(true);
    }, knightTheme);
    const pieces = [
        source.slice(source.indexOf('const ROARING_KNIGHT_TRANSITION'), source.indexOf('const ROARING_KNIGHT_AWAKENED_FLAG')),
        source.slice(source.indexOf('function activeThemeVisualConfig'), source.indexOf('function normalizeThemeSpriteSource')),
        source.slice(source.indexOf('function applyThemeStyles'), source.indexOf('function prefersReducedMotion')),
        source.slice(source.indexOf('async function renderPage'), source.indexOf('function suspendApplicationMedia'))
    ];
    await page.addScriptTag({ content: pieces.join('\n') });
    await page.evaluate(() => applyThemeStyles(activeThemeVisualConfig()));
    for (const route of ['main', 'credits']) {
        await page.evaluate(route => renderPage(route), route);
        const palette = await page.evaluate(() => ({
            accent: getComputedStyle(document.querySelector('.seasonal-corner-primary')).color,
            soul: getComputedStyle(document.querySelector('.seasonal-corner-secondary')).color,
            awakened: document.documentElement.classList.contains('roaring-knight-awakened')
        }));
        expect(palette).toEqual({ accent: 'rgb(198, 203, 209)', soul: 'rgb(255, 255, 255)', awakened: true });
    }
});

test('Knight panels avoid nested backdrop filters and restore other themes unchanged', async ({ page }) => {
    const { openView } = require('./fixtures/refinement-page');
    await openView(page, 'options', { width: 1280 });
    await page.evaluate(() => { document.querySelector('.alertMain').hidden = false; });
    const surfaces = page.locator('.options-page .opt, .alertMsg');
    await expect(surfaces).toHaveCount(2);
    const backdropFilters = () => surfaces.evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backdropFilter));
    const original = await backdropFilters();
    expect(original.every(filter => filter && filter !== 'none')).toBe(true);
    for (const state of ['roaring-knight-blackout', 'roaring-knight-awakened']) {
        await page.evaluate(state => document.documentElement.classList.add(state), state);
        expect(await backdropFilters()).toEqual(['none', 'none']);
        if (state === 'roaring-knight-awakened') {
            await expect.poll(() => page.locator('.viewport').evaluate(node => getComputedStyle(node).filter)).toBe('grayscale(1)');
        }
        await page.evaluate(state => document.documentElement.classList.remove(state), state);
        expect(await backdropFilters()).toEqual(original);
    }
});

test('Knight background follows the forward source through its full six-second cycle', async ({ page }) => {
    await page.setContent('<video id="portable" muted></video><video id="reference" muted></video>');
    const data = Object.fromEntries([
        ['portable', 'webm'], ['reference', 'mp4']
    ].map(([id, extension]) => [id, `data:video/${extension};base64,${fs.readFileSync(path.join(root, `web/themes/video/the-knight.${extension}`)).toString('base64')}`]));
    const result = await page.evaluate(async data => {
        const videos = Object.entries(data).map(([id, source]) => {
            const video = document.getElementById(id);
            video.src = source;
            return video;
        });
        await Promise.all(videos.map(video => new Promise((resolve, reject) => {
            video.addEventListener('loadeddata', resolve, { once: true });
            video.addEventListener('error', () => reject(new Error(`Unable to decode ${video.id}`)), { once: true });
        })));
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 90;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        const sample = async (video, time) => {
            await new Promise(resolve => {
                video.addEventListener('seeked', resolve, { once: true });
                video.currentTime = time;
            });
            context.drawImage(video, 0, 0, 160, 90);
            return context.getImageData(0, 0, 160, 90).data;
        };
        const errors = [];
        for (const time of [1.5, 3.5, 4.5, 5.8]) {
            const actual = await sample(videos[0], time);
            const expected = await sample(videos[1], time);
            let difference = 0;
            for (let index = 0; index < actual.length; index += 4) {
                difference += Math.abs(actual[index] - expected[index])
                    + Math.abs(actual[index + 1] - expected[index + 1])
                    + Math.abs(actual[index + 2] - expected[index + 2]);
            }
            errors.push({ time, meanDifference: difference / (160 * 90 * 3) });
        }
        return { duration: videos[0].duration, errors };
    }, data);
    expect(result.duration).toBeCloseTo(6, 2);
    for (const sample of result.errors) expect(sample.meanDifference, `forward source at ${sample.time}s`).toBeLessThan(1);
});

test('background decodes through three consecutive explicit six-second loops', async ({page}) => {
    await page.setContent('<video muted></video>');
    const data = fs.readFileSync(path.join(root,'web/themes/video/the-knight.webm')).toString('base64');
    await page.evaluate(data => {
        const video = document.querySelector('video');
        video.src = 'data:video/webm;base64,' + data;
        video.dataset.source = 'knight';
        window.getThemeBackgroundVideo = () => video;
        window.fallBackFromThemeVideo = error => { window.__error = String(error); };
        window.__loops = 0;
        document.hasFocus = () => true;
    },data);
    await page.addScriptTag({content: source.slice(source.indexOf('function loopThemeBackgroundVideo'),source.indexOf('function applyThemeBackground'))});
    await page.evaluate(async () => {
        const video = document.querySelector('video');
        video.onended = () => { window.__loops++; loopThemeBackgroundVideo(); };
        await video.play();
    });
    expect(await page.evaluate(() => document.querySelector('video').duration)).toBeCloseTo(6, 2);
    await expect.poll(() => page.evaluate(() => window.__loops), {timeout: 24000}).toBeGreaterThanOrEqual(3);
    expect(await page.evaluate(() => window.__error)).toBeUndefined();
    expect(await page.evaluate(() => document.querySelector('video').paused)).toBe(false);
});
