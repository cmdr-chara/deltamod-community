// SPDX-FileCopyrightText: 2026 cmdr-chara
// SPDX-License-Identifier: EUPL-1.2
const { test, expect } = require('@playwright/test');
const { openView, read } = require('./fixtures/refinement-page');
const japanese = JSON.parse(read('langs/ja/language.json'));
const chinese = JSON.parse(read('langs/zh-CN/language.json'));
const korean = JSON.parse(read('langs/ko/language.json'));

async function socialShop(page, { loggedIn = true, likes = 6, gallery = false } = {}) {
    if (gallery) await page.route('https://images.gamebanana.com/community-gallery/**', route => route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#365c70"/></svg>'
    }));
    await openView(page, 'gamebanana-browse', { width: 800, beforeScript: async page => {
        await page.evaluate(({ loggedIn, likes, gallery }) => {
            const game = { id: 'toby.undertale', name: 'UNDERTALE', gamebanana: { id: 6755 } };
            window.__likeRequests = [];
            window.__browseRequests = [];
            window.__alerts = [];
            window.htmlAlert = async (...args) => { window.__alerts.push(args.map(value => typeof value === 'function' ? value() : value)); return 'ok'; };
            window.deltamodBackend.invokeOptional = async () => null;
            window.deltamodBackend.invoke = async (channel, args) => {
                if (channel === 'getAvailableGames') return [game];
                if (channel === 'getCurrentGameInfo') return game;
                if (channel === 'validateGamebananaToken') return loggedIn;
                if (channel === 'gbLikeMod') {
                    window.__likeRequests.push(args);
                    return new Promise((resolve, reject) => { window.__finishLike = resolve; window.__failLike = reject; });
                }
                return false;
            };
            window.IntersectionObserver = class { observe() {} disconnect() {} };
            window.communityAPI.modSources = { browse: async request => { window.__browseRequests.push(request); return ({ ok: true, result: { payload:
                request.url.includes('/TopSubs') ? [] : {
                    _aMetadata: { _bIsComplete: true },
                    _aRecords: [{ _idRow: 42, _sModelName: 'Mod', _sName: 'Moonlight', _sDescription: 'A mod.',
                        _aSubmitter: { _sName: 'Moon team' }, _sImageUrl: window.__placeholder,
                        ...(gallery ? { _aPreviewMedia: { _aImages: Array.from({ length: 3 }, (_, index) => ({
                            _sBaseUrl: 'https://images.gamebanana.com/community-gallery',
                            _sFile: `image-${index}.svg`, _sFile100: `image-${index}.svg`
                        })) } } : {}),
                        _nLikeCount: likes, _nPostCount: 1, _tsDateAdded: 1700000000, _tsDateModified: 1700010000 }]
                }
            } }); } };
        }, { loggedIn, likes, gallery });
    } });
    await expect(page.locator('.modTitleSpan')).toHaveText('Moonlight');
}

test('social counts and likes wait for confirmation and reject duplicate clicks', async ({ page }, info) => {
    await socialShop(page);
    const like = page.getByRole('button', { name: 'Like Moonlight · 6 likes', exact: true });
    const comments = page.getByRole('button', { name: 'View comments for Moonlight · 1 comment', exact: true });
    await expect(comments.locator('.shop-social-count')).toHaveText('1');
    await expect(page.locator('.modOtherInfoSpan time')).toHaveAttribute('datetime', '2023-11-15T01:00:00.000Z');
    await like.click();
    await expect(like).toBeDisabled();
    await page.evaluate(() => document.querySelector('button[aria-pressed="false"]').onclick());
    expect(await page.evaluate(() => window.__likeRequests)).toEqual([['Mod', 42]]);
    await expect(like.locator('.shop-social-count')).toHaveText('6');
    await page.evaluate(() => window.__finishLike({ status: 200, data: null }));
    const liked = page.getByRole('button', { name: 'Liked · 7 likes', exact: true });
    await expect(liked).toBeDisabled();
    await expect(liked).toHaveAttribute('aria-pressed', 'true');
    await expect(liked.locator('.shop-social-count')).toHaveText('7');
    await page.screenshot({ path: info.outputPath('social-counts-800.png') });
});

test('failed likes can retry and an already-liked response does not increment a count', async ({ page }) => {
    await socialShop(page);
    const like = page.locator('.shop-social-action[aria-pressed]');
    for (const response of [null, { status: 500, data: null }]) {
        await like.click();
        await page.evaluate(response => window.__finishLike(response), response);
        await expect(like).toBeEnabled();
        await expect(like.locator('.shop-social-count')).toHaveText('6');
    }
    await like.click();
    await page.evaluate(() => window.__failLike('Connection unavailable'));
    await expect(like).toBeEnabled();
    await like.click();
    await page.evaluate(() => window.__finishLike({ status: 400, data: { _sErrorCode: 'ALREADY_LIKED' } }));
    await expect(like).toHaveAttribute('aria-pressed', 'true');
    await expect(like).toBeDisabled();
    await expect(like.locator('.shop-social-count')).toHaveText('6');
    expect(await page.evaluate(() => window.__alerts.length)).toBe(3);
});

test('anonymous likes remain disabled and missing counts are not invented', async ({ page }) => {
    await socialShop(page, { loggedIn: false, likes: null });
    const like = page.locator('.shop-social-action[aria-pressed]');
    await expect(like).toBeDisabled();
    await expect(like.locator('.shop-social-count')).toHaveText('—');
    await expect(like).toHaveAttribute('title', 'Log in to GameBanana to like mods');
    expect(await page.evaluate(() => window.__likeRequests)).toEqual([]);
});

test('Arabic gallery keys follow mirrored controls and retain an open preview when language changes', async ({ page }, info) => {
    await socialShop(page, { gallery: true });
    await page.locator('#searchInput').fill('Moonlight');
    const preview = page.locator('.mod-gallery-preview img').first();
    await page.evaluate(async () => {
        window.__galleryRow = document.querySelector('#modsBody tr');
        window.__galleryRequests = window.__browseRequests.length;
        await window.Localization.setLanguage('ar');
    });
    await preview.focus();
    await preview.press('Enter');
    const dialog = page.locator('#modImageLightbox');
    const thumbnails = page.locator('.mod-image-lightbox-thumbnail');
    await expect(dialog).toBeVisible();
    await expect(thumbnails.nth(0)).toHaveAttribute('aria-current', 'true');
    const positions = await page.evaluate(() => ({
        previous: document.getElementById('modImagePrevious').getBoundingClientRect().left,
        next: document.getElementById('modImageNext').getBoundingClientRect().left,
        icon: getComputedStyle(document.querySelector('#modImageNext .material-symbols-outlined')).transform
    }));
    expect(positions.previous).toBeGreaterThan(positions.next);
    expect(positions.icon).toContain('matrix(-1');
    await page.keyboard.press('ArrowLeft');
    await expect(thumbnails.nth(1)).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('+');
    await page.evaluate(() => {
        window.__galleryDialog = document.getElementById('modImageLightbox');
        window.__galleryImage = document.getElementById('modImageLightboxImage');
        window.__galleryFocus = document.activeElement;
    });
    await page.screenshot({ path: info.outputPath('arabic-gallery-800.png') });
    await page.evaluate(() => window.Localization.setLanguage('ja'));
    await expect(dialog).toBeVisible();
    await expect(thumbnails.nth(1)).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('#modImageLightboxTitle')).toHaveText('Moonlight');
    await expect(page.locator('#modImageLightboxClose')).toHaveAttribute('aria-label', japanese.shop_ui_close_image_preview);
    expect(await page.evaluate(() => ({
        sameDialog: window.__galleryDialog === document.getElementById('modImageLightbox'),
        sameImage: window.__galleryImage === document.getElementById('modImageLightboxImage'),
        sameFocus: document.activeElement === window.__galleryFocus,
        zoom: document.getElementById('modImageLightboxImage').style.width
    }))).toEqual({ sameDialog: true, sameImage: true, sameFocus: true, zoom: '125%' });
    await page.keyboard.press('ArrowRight');
    await expect(thumbnails.nth(2)).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(thumbnails.nth(1)).toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(preview).toBeFocused();
    await expect(page.locator('#searchInput')).toHaveValue('Moonlight');
    expect(await page.evaluate(() => ({
        sameRow: window.__galleryRow === document.querySelector('#modsBody tr'),
        sameRequests: window.__galleryRequests === window.__browseRequests.length
    }))).toEqual({ sameRow: true, sameRequests: true });
});

async function commentsPage(page, { id = 42, loggedIn = false } = {}) {
    await openView(page, 'gamebanana-leave-comment', { beforeScript: async page => {
        await page.evaluate(({ id, loggedIn }) => {
            window._pageArguments = { id, model: 'Mod', commentPage: 2 };
            window.__commentRequests = [];
            window.__alerts = [];
            window.htmlAlert = async (...args) => { window.__alerts.push(args.map(value => typeof value === 'function' ? value() : value)); return 'ok'; };
            window.deltamodBackend.invokeOptional = async () => loggedIn ? 'https://images.gamebanana.com/avatar.png' : null;
            window.deltamodBackend.invoke = async () => { throw 'Posting unavailable'; };
            const catalogFetch = window.fetch;
            window.fetch = async url => {
                if (!String(url).startsWith('https://gamebanana.com/')) return catalogFetch(url);
                window.__commentRequests.push(String(url));
                return new Response(JSON.stringify({ _aMetadata: { _bIsComplete: true }, _aRecords: [{
                    _idRow: 7, _aPoster: { _sName: '<b>Author</b>', _sProfileUrl: 'javascript:alert(1)' },
                    _sText: '<p>Hello &lt;Kris&gt;<br><img src=x onerror=alert(1)>Stay kind.</p>',
                    _tsDateAdded: 1700000000, _nReplyCount: 1
                }] }));
            };
        }, { id, loggedIn });
    } });
}

test('comments show safe author/time labels, use the requested page, and stop cyclic replies', async ({ page }) => {
    await commentsPage(page);
    await expect(page.locator('#commentRecords .commentBox')).toHaveCount(1);
    await expect(page.locator('.comment-author')).toHaveText('<b>Author</b>');
    await expect(page.locator('.comment-author')).not.toHaveAttribute('href');
    await expect(page.locator('.comment-text')).toHaveText('Hello <Kris>\nStay kind.\n');
    await expect(page.locator('.comment-text img, .comment-author b')).toHaveCount(0);
    await expect(page.locator('.comment-metadata time')).toHaveAttribute('datetime', '2023-11-14T22:13:20.000Z');
    await expect(page.locator('#commentsPage')).toHaveText('Page 2');
    await expect(page.locator('#previousComments')).toBeVisible();
    await expect(page.locator('#nextComments')).toBeHidden();
    const requests = await page.evaluate(() => window.__commentRequests);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toContain('_nPage=2');
});

test('invalid comment targets make no provider request and failed posting preserves the draft', async ({ page }) => {
    await commentsPage(page, { id: '../42' });
    await expect(page.locator('#commentsStatus')).toContainText('could not be identified');
    expect(await page.evaluate(() => window.__commentRequests)).toEqual([]);
    await commentsPage(page, { loggedIn: true });
    await expect(page.locator('#myCommentBox')).toBeVisible();
    await page.locator('#comment').fill('A comment to retry.');
    await page.locator('#sendBtn').click();
    await expect(page.locator('#sendBtn')).toBeEnabled();
    await expect(page.locator('#comment')).toHaveValue('A comment to retry.');
    expect(await page.evaluate(() => window.__alerts[0][1])).toBe('Posting unavailable');
});

test('vanilla launch preserves selected mods and shares the launch lock', async ({ page }, info) => {
    await openView(page, 'main', { width: 800, beforeScript: async page => {
        await page.evaluate(() => {
            window.__states['mod-0'] = true;
            const invoke = window.deltamodBackend.invoke;
            window.deltamodBackend.invoke = async (channel, args) => {
                if (channel !== 'patchAndRun') return invoke(channel, args);
                window.__calls.push([channel, args]);
                return new Promise(resolve => { window.__finishLaunch = resolve; });
            };
        });
    } });
    await expect(page.getByRole('button', { name: 'Launch vanilla game', exact: true })).toBeEnabled();
    await expect(page.locator('#modcheck-mod-0')).toBeChecked();
    await page.locator('#mod-search').fill('Forest 1');
    await page.evaluate(() => { window.__launchToggle = document.getElementById('modcheck-mod-0'); });
    await page.screenshot({ path: info.outputPath('vanilla-action-800.png') });
    await page.locator('#vanilla').click();
    await expect(page.locator('#vanilla')).toBeDisabled();
    await expect(page.locator('#par')).toBeDisabled();
    for (const language of ['ar', 'ja']) {
        await page.evaluate(code => window.Localization.setLanguage(code), language);
        await expect(page.locator('#vanilla')).toBeDisabled();
        await expect(page.locator('#par')).toBeDisabled();
        await expect(page.locator('#mod-search')).toHaveValue('Forest 1');
        await expect(page.locator('#modcheck-mod-0')).toBeChecked();
        expect(await page.evaluate(() => window.__launchToggle === document.getElementById('modcheck-mod-0'))).toBe(true);
    }
    await page.evaluate(() => window.currentPageStack.playVanilla());
    expect(await page.evaluate(() => window.__calls.filter(([channel]) => channel === 'patchAndRun'))).toEqual([['patchAndRun', [[]]]]);
    await expect(page.locator('#modcheck-mod-0')).toBeChecked();
    await page.evaluate(() => window.__finishLaunch(true));
    await expect(page.locator('#vanilla')).toBeEnabled();
});

test('patch phase details and log entries remain inert and bounded', async ({ page }, info) => {
    await openView(page, 'patching');
    await page.evaluate(() => window.currentPageStack.gpl({ phase: 'staging', completed: 2, total: 4, percent: 50, currentItem: '<img src=x onerror=alert(1)>' }));
    await expect(page.locator('#patch-phase')).toHaveText('Preparing mod files');
    await expect(page.locator('#patch-step')).toHaveText('2 of 4');
    await expect(page.locator('#patch-item')).toHaveText('<img src=x onerror=alert(1)>');
    await expect(page.locator('#patch-item img, #gpl img')).toHaveCount(0);
    await expect(page.locator('#patch-percent')).toHaveText('50%');
    await page.screenshot({ path: info.outputPath('patch-status.png') });
    await page.evaluate(() => { for (let i = 0; i < 450; i++) window.currentPageStack.gpl({ log: '<b>log</b>', percent: -1 }); });
    await expect(page.locator('#gpl > div')).toHaveCount(300);
    await expect(page.locator('#gpl b')).toHaveCount(0);
    await expect(page.locator('#patch-progress')).not.toHaveAttribute('value');
});

test('live shop language changes retain pending likes, query, page, provider text and loaded rows', async ({ page }) => {
    await socialShop(page, { likes: 1234 });
    const like = page.locator('.shop-social-action[aria-pressed]');
    const timestamp = page.locator('.modOtherInfoSpan time');
    const originalDate = await timestamp.getAttribute('title');
    await like.click();
    await page.locator('#searchInput').fill('Unsubmitted Moonlight search');
    await page.locator('#searchInput').focus();
    await page.evaluate(() => {
        window.__retainedLike = document.querySelector('.shop-social-action[aria-pressed]');
        window.__retainedRow = document.querySelector('#modsBody tr');
        window.__requestsBeforeLanguage = window.__browseRequests.length;
        window.__pageBeforeLanguage = window.PAGE;
    });
    await page.evaluate(() => window.Localization.setLanguage('ja'));
    await expect(like.locator('.shop-social-label')).toHaveText(japanese.gb_liking);
    await expect(like).toBeDisabled();
    await expect(like).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#searchInput')).toHaveValue('Unsubmitted Moonlight search');
    await expect(page.locator('#searchInput')).toBeFocused();
    await expect(page.locator('.modTitleSpan')).toHaveText('Moonlight');
    await expect(page.locator('.modAuthorSpan')).toContainText('Moon team');
    await expect(timestamp).not.toHaveAttribute('title', originalDate);
    expect(await page.evaluate(() => ({
        sameLike: window.__retainedLike === document.querySelector('.shop-social-action[aria-pressed]'),
        sameRow: window.__retainedRow === document.querySelector('#modsBody tr'),
        samePage: window.__pageBeforeLanguage === window.PAGE,
        sameRequests: window.__requestsBeforeLanguage === window.__browseRequests.length,
        navigated: window.__pageTarget
    }))).toEqual({ sameLike: true, sameRow: true, samePage: true, sameRequests: true, navigated: undefined });
    await page.evaluate(() => window.__finishLike({ status: 200, data: null }));
    await expect(like.locator('.shop-social-label')).toHaveText(japanese.gb_liked);
    await page.evaluate(() => window.Localization.setLanguage('zh-CN'));
    await expect(like.locator('.shop-social-label')).toHaveText(chinese.gb_liked);
    await expect(like).toHaveAttribute('aria-pressed', 'true');
    await expect(like.locator('.shop-social-count')).toHaveText('1,235');
    await expect(like).toHaveAttribute('aria-label', new RegExp(chinese.gb_liked));
    expect(await page.evaluate(() => window.__likeRequests.length)).toBe(1);
});

test('live comment language changes retain draft, selection, sending state and loaded comments', async ({ page }) => {
    await commentsPage(page, { loggedIn: true });
    await expect(page.locator('#commentRecords .commentBox')).toHaveCount(1);
    const posted = page.locator('.comment-metadata time');
    const originalDate = await posted.getAttribute('title');
    await page.locator('#comment').fill('A draft named Download stays unchanged.');
    await page.evaluate(() => {
        window.deltamodBackend.invoke = async () => new Promise(resolve => { window.__finishComment = resolve; });
        window.__retainedComment = document.querySelector('.commentBox:not(#myCommentBox)');
    });
    await page.locator('#sendBtn').click();
    await page.locator('#comment').focus();
    await page.evaluate(() => document.getElementById('comment').setSelectionRange(3, 8));
    await page.evaluate(() => window.Localization.setLanguage('ko'));
    await expect(page.locator('#sendBtn')).toHaveText(korean.gb_sending_comment);
    await expect(page.locator('#sendBtn')).toBeDisabled();
    await expect(page.locator('#sendBtn')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#comment')).toHaveValue('A draft named Download stays unchanged.');
    await expect(page.locator('#comment')).toBeFocused();
    await expect(page.locator('#commentsPage')).toHaveText(korean.gb_comment_page.replace('{0}', '2'));
    await expect(page.locator('.comment-author')).toHaveText('<b>Author</b>');
    await expect(page.locator('.comment-text')).toHaveText('Hello <Kris>\nStay kind.\n');
    await expect(posted).not.toHaveAttribute('title', originalDate);
    expect(await page.evaluate(() => ({
        selection: [document.getElementById('comment').selectionStart, document.getElementById('comment').selectionEnd],
        requests: window.__commentRequests.length,
        sameComment: window.__retainedComment === document.querySelector('.commentBox:not(#myCommentBox)'),
        navigated: window.__pageTarget
    }))).toEqual({ selection: [3, 8], requests: 2, sameComment: true, navigated: undefined });
    await page.evaluate(() => window.__finishComment(false));
    await expect(page.locator('#sendBtn')).toBeEnabled();
    await expect(page.locator('#sendBtn')).toHaveText(korean.gb_send_comment);
    await expect(page.locator('#comment')).toHaveValue('A draft named Download stays unchanged.');
});

test('live main language changes retain mod selection, variant, filter and focus', async ({ page }) => {
    await openView(page, 'main', { beforeScript: async page => {
        await page.evaluate(() => {
            window.__states['mod-0'] = true;
            window.__mods[0].variants = [{ filename: 'one', name: 'Download' }, { filename: 'two', name: 'Custom name' }];
            window.__mods[0]._selectedVariant = 'two';
            window.__mods[0].author = ['Author', 'Friend', 'Guest'];
        });
    } });
    await expect(page.locator('#modcheck-mod-0')).toBeChecked();
    await page.locator('#mod-search').fill('Forest 1');
    await page.locator('#mod-search').focus();
    await page.evaluate(() => { window.__callsBeforeLanguage = window.__calls.length; window.__retainedToggle = document.getElementById('modcheck-mod-0'); });
    await page.evaluate(() => window.Localization.setLanguage('ja'));
    await expect(page.locator('#ptitle')).toHaveText(japanese.main_title);
    await expect(page.locator('#vanilla')).toContainText(japanese.main_launch_vanilla);
    await expect(page.locator('#modcheck-mod-0')).toBeChecked();
    await expect(page.locator('#modcheck-mod-0')).toHaveAttribute('aria-label', japanese.main_enable_mod.replace('{0}', 'Forest 1'));
    await expect(page.locator('.variant-select')).toHaveValue('two');
    await expect(page.locator('.variant-select option[value="one"]')).toHaveText('Download');
    await expect(page.locator('#mod-search')).toHaveValue('Forest 1');
    await expect(page.locator('#mod-search')).toBeFocused();
    await expect(page.locator('#modauthor-mod-0')).toContainText(japanese.main_andmore.replace('{0}', '1'));
    expect(await page.evaluate(() => ({ calls: window.__calls.length === window.__callsBeforeLanguage, sameToggle: window.__retainedToggle === document.getElementById('modcheck-mod-0') }))).toEqual({ calls: true, sameToggle: true });
});

test('live patch language changes retain progress and raw logs while translating owned activity', async ({ page }) => {
    await openView(page, 'patching');
    await page.evaluate(() => window.currentPageStack.gpl({ phase: 'staging', completed: 2, total: 4, percent: 50, currentItem: 'Download <file>', log: 'Preparing' }));
    await expect(page.locator('#gpl > div')).toHaveCount(2);
    await page.evaluate(() => { window.__retainedLog = document.getElementById('gpl').lastElementChild; });
    await page.evaluate(() => window.Localization.setLanguage('ja'));
    await expect(page.locator('#patch-phase')).toHaveText(japanese.patch_phase_staging);
    await expect(page.locator('#patch-step')).toHaveText(japanese.patch_step_count.replace('{0}', '2').replace('{1}', '4'));
    await expect(page.locator('#patch-progress')).toHaveAttribute('value', '50');
    await expect(page.locator('#patch-item')).toHaveText('Download <file>');
    await expect(page.locator('#gpl > div').first()).toContainText(japanese.patch_phase_staging);
    await expect(page.locator('#gpl > div').last()).toHaveText('Preparing');
    expect(await page.evaluate(() => window.__retainedLog === document.getElementById('gpl').lastElementChild)).toBe(true);
    await page.evaluate(() => window.currentPageStack.fp());
    await page.evaluate(() => window.Localization.setLanguage('zh-CN'));
    await expect(page.locator('#patchingTXT')).toHaveText(chinese.refine_patch_complete);
    await expect(page.locator('#patch-phase')).toHaveText(chinese.patch_phase_complete);
    await expect(page.locator('#patch-progress')).toHaveAttribute('value', '100');
    await expect(page.locator('#next')).toHaveText(chinese.patch_return);
    await expect(page.locator('#gpl > div')).toHaveCount(2);
});

test('live external catalogue language changes retain popularity, sort, query and download progress', async ({ page }) => {
    await openView(page, 'gamebanana-browse', { beforeScript: async page => {
        await page.evaluate(() => {
            const game = { id: 'toby.undertale', name: 'UNDERTALE', sources: { nexus: { domain: 'undertale' } } };
            window._pageArguments = { provider: 'nexus', sourceQuery: 'Forest' };
            window.__catalogueRequests = 0;
            window.IntersectionObserver = class { observe() {} disconnect() {} };
            window.deltamodBackend.isCommandAvailable = () => true;
            window.deltamodBackend.invoke = async channel => channel === 'getAvailableGames' ? [game] : game;
            window.communityAPI.modSources = {
                browse: async () => {
                    window.__catalogueRequests++;
                    return { ok: true, result: { cached: true, items: [{ id: 9, provider: 'nexus', title: 'Download',
                        author: 'Updates', summary: 'Comments', updatedAt: '2023-11-14T22:13:20.000Z',
                        downloads: 1234, endorsements: 56, actionLabel: 'Download', featured: true }] } };
                },
                open: async () => {}
            };
        });
    } });
    await expect(page.locator('.modTitleSpan')).toHaveText('Download');
    await page.locator('#searchInput').focus();
    await page.evaluate(() => {
        window.currentPageStack.updateModDownloadStatus({ phase: 'download', completed: 2048, total: 4096, currentItem: 'Download.zip' });
        window.__retainedExternalRow = document.querySelector('#modsBody tr');
    });
    await page.evaluate(() => window.Localization.setLanguage('ja'));
    await expect(page.locator('.modTitleSpan')).toHaveText('Download');
    await expect(page.locator('.external-source-summary')).toHaveText('Comments');
    await expect(page.locator('.modOtherInfoSpan')).toContainText('Updates');
    await expect(page.locator('.external-source-popularity')).toBeVisible();
    await expect(page.locator('.external-source-popularity')).toHaveText(
        japanese.shop_downloads_other.replace('{0}', '1,234') + ' · ' + japanese.shop_endorsements_other.replace('{0}', '56'));
    await expect(page.locator('#searchInput')).toHaveValue('Forest');
    await expect(page.locator('#searchInput')).toBeFocused();
    await expect(page.locator('#nexusSort')).toHaveValue('trending');
    await expect(page.locator('#modDownloadStatusTitle')).toHaveText(japanese.shop_ui_downloading_mod);
    await expect(page.locator('#modDownloadStatusItem')).toHaveText('Download.zip');
    await expect(page.locator('#modDownloadProgressTrack')).toHaveAttribute('aria-valuenow', '50');
    await expect(page.locator('#modDownloadProgressTrack')).toHaveAttribute('aria-valuetext', japanese.shop_ui_downloading_mod);
    await expect(page.locator('#contentFilterStatus')).toContainText(japanese.shop_ui_loaded_from_the_local_catalogue_cache);
    expect(await page.evaluate(() => ({ requests: window.__catalogueRequests, sameRow: window.__retainedExternalRow === document.querySelector('#modsBody tr') }))).toEqual({ requests: 1, sameRow: true });
});

for (const provider of ['nexus', 'moddb']) {
    test(`${provider} translates only explicit generated metadata and retains progress source labels`, async ({ page }) => {
        await openView(page, 'gamebanana-browse', { width: 800, beforeScript: async page => {
            await page.evaluate(provider => {
                const name = provider === 'nexus' ? 'Nexus Mods' : 'ModDB';
                const game = { id: 'toby.undertale', name: 'UNDERTALE', sources: { nexus: { domain: 'undertale' }, moddb: { slug: 'undertale' } } };
                window._pageArguments = { provider, sourceQuery: 'Unchanged search' };
                window.__metadataRequests = 0;
                window.__providerOpens = [];
                if (!window.crypto.randomUUID) window.crypto.randomUUID = () => '00000000-0000-4000-8000-000000000001';
                window.IntersectionObserver = class { observe() {} disconnect() {} };
                window.deltamodBackend.isCommandAvailable = () => true;
                window.deltamodBackend.invoke = async channel => channel === 'getAvailableGames' ? [game] : game;
                const generated = { id: '1', provider, title: 'Mod', titleSource: 'Mod',
                    author: `${name} contributor`, authorSource: '{0} contributor', authorSourceArgs: [name],
                    summary: 'Comments', imageUrl: window.__placeholder, sourceUrl: `https://example.test/${provider}/1`, actionLabel: 'Download' };
                const literal = { ...generated, id: '2', titleSource: null, authorSource: null, authorSourceArgs: [] };
                const attributionSource = provider === 'nexus'
                    ? 'Metadata and popularity counts provided by Nexus Mods'
                    : 'ModDB RSS exposes only its {0} most recent downloads';
                window.__attributionSource = attributionSource;
                window.communityAPI.modSources = {
                    browse: async () => {
                        window.__metadataRequests++;
                        return { ok: true, result: { items: [generated, literal],
                            attribution: 'Native fallback snapshot', attributionSource,
                            attributionSourceArgs: provider === 'moddb' ? [10] : [],
                            catalogUrl: provider === 'moddb' ? 'https://www.moddb.com/games/undertale/downloads' : undefined } };
                    },
                    open: async request => window.__providerOpens.push(request),
                    onProgress: handler => { window.__nativeProgress = handler; return () => { window.__nativeProgress = null; }; },
                    downloadNexus: async request => {
                        window.__downloadOperation = request.operationId;
                        return new Promise(resolve => { window.__finishMetadataDownload = resolve; });
                    }
                };
            }, provider);
        } });
        const rows = page.locator('#modsBody tr');
        await expect(rows).toHaveCount(2);
        const generated = rows.nth(0);
        const literal = rows.nth(1);
        await generated.locator('.mod-gallery-preview img').click();
        await page.evaluate(() => {
            window.__metadataRow = document.querySelector('#modsBody tr');
            window.__catalogLink = document.querySelector('.source-catalog-link');
            return window.Localization.setLanguage('ja');
        });
        const contributor = japanese.shop_provider_contributor.replace('{0}', provider === 'nexus' ? 'Nexus Mods' : 'ModDB');
        await expect(generated.locator('.modTitleSpan')).toHaveText(japanese.mod);
        await expect(generated.locator('.modOtherInfoSpan')).toContainText(contributor);
        await expect(literal.locator('.modTitleSpan')).toHaveText('Mod');
        await expect(literal.locator('.modOtherInfoSpan')).toContainText(`${provider === 'nexus' ? 'Nexus Mods' : 'ModDB'} contributor`);
        await expect(literal.locator('.external-source-summary')).toHaveText('Comments');
        await expect(page.locator('#modImageLightboxTitle')).toHaveText(japanese.mod);
        await expect(page.locator('#modImageLightboxImage')).toHaveAttribute('alt', japanese.shop_preview_image.replace('{0}', japanese.mod).replace('{1}', '1'));
        await page.keyboard.press('Escape');
        await expect(generated.locator('.external-source-actions button').first()).toHaveAttribute('aria-label', `${japanese.download}: ${japanese.mod}`);
        await expect(page.locator('#sourceAttribution > span')).toHaveText(await page.evaluate(provider =>
            window.Localization.text(window.__attributionSource, ...(provider === 'moddb' ? [window.Localization.number(10)] : [])), provider));
        await expect(page.locator('#searchInput')).toHaveValue('Unchanged search');
        if (provider === 'moddb') {
            await page.evaluate(() => window.Localization.setLanguage('ar'));
            await expect(page.locator('#sourceAttribution > span')).toHaveText(await page.evaluate(() =>
                window.Localization.text(window.__attributionSource, window.Localization.number(10))));
            expect(await page.evaluate(() => window.__catalogLink === document.querySelector('.source-catalog-link'))).toBe(true);
            await page.locator('.source-catalog-link').click();
            expect(await page.evaluate(() => window.__providerOpens)).toEqual([{ provider: 'moddb', url: 'https://www.moddb.com/games/undertale/downloads' }]);
        } else {
            await generated.locator('.external-source-actions button').first().click();
            await expect.poll(() => page.evaluate(() => typeof window.__nativeProgress)).toBe('function');
            await page.evaluate(() => window.__nativeProgress({
                operationId: window.__downloadOperation, phase: 'download', completed: 2048, total: 4096,
                currentItem: 'Native fallback snapshot', currentItemSource: 'Nexus Mods archive'
            }));
            await expect(page.locator('#modDownloadStatusItem')).toHaveText(japanese.native_nexus_nexus_mods_archive_6a1d2d69);
            await page.evaluate(() => window.Localization.setLanguage('ko'));
            await expect(page.locator('#modDownloadStatusItem')).toHaveText(korean.native_nexus_nexus_mods_archive_6a1d2d69);
            await expect(page.locator('#modDownloadProgressTrack')).toHaveAttribute('aria-valuenow', '50');
            await page.evaluate(() => window.__nativeProgress({
                operationId: window.__downloadOperation, phase: 'download', completed: 3072, total: 4096,
                currentItem: 'Nexus Mods archive'
            }));
            await page.evaluate(() => window.Localization.setLanguage('ja'));
            await expect(page.locator('#modDownloadStatusItem')).toHaveText('Nexus Mods archive');
            await expect(page.locator('#modDownloadProgressTrack')).toHaveAttribute('aria-valuenow', '75');
            await page.evaluate(() => window.__finishMetadataDownload({ ok: true }));
            await expect(page.locator('#modDownloadStatus')).toHaveAttribute('data-phase', 'complete');
            await expect(page.locator('#modDownloadStatusItem')).toHaveText(japanese.mod);
        }
        expect(await page.evaluate(() => ({
            requests: window.__metadataRequests,
            sameRow: window.__metadataRow === document.querySelector('#modsBody tr'),
            navigation: window.__pageTarget
        }))).toEqual({ requests: 1, sameRow: true, navigation: undefined });
    });
}

test('live catalogue error text changes without retrying its failed request', async ({ page }) => {
    await openView(page, 'gamebanana-browse', { beforeScript: async page => {
        await page.evaluate(() => {
            window.__gameRequests = 0;
            window.IntersectionObserver = class { observe() {} disconnect() {} };
            window.deltamodBackend.invoke = async () => { window.__gameRequests++; return []; };
        });
    } });
    await expect(page.locator('.shop-state h2')).toHaveText('Mod Shop could not be loaded');
    await page.evaluate(() => window.Localization.setLanguage('ko'));
    await expect(page.locator('.shop-state h2')).toHaveText(korean.shop_ui_mod_shop_could_not_be_loaded);
    await expect(page.locator('.shop-state p')).toHaveText(korean.shop_ui_no_supported_games_are_available_for_the_mod_shop);
    await expect(page.locator('.shop-state button')).toHaveText(korean.shop_ui_retry);
    expect(await page.evaluate(() => window.__gameRequests)).toBe(1);
});

async function installSharedAlerts(page) {
    const source = read('index.js');
    const alerts = source.slice(source.indexOf('let alertQueue'), source.indexOf('\nfunction credits('));
    await page.addScriptTag({ content: `
        const MOTION = { standard: 0, easeIn: 'ease', easeOut: 'ease' };
        const prefersReducedMotion = () => true;
        window.shellText = (source, ...args) => window.Localization.text(source, ...args);
        ${alerts}
    ` });
}

test('shared alert callbacks update in place while literal provider strings, focus and rejection stay intact', async ({ page }) => {
    await openView(page, 'main');
    await installSharedAlerts(page);
    await page.locator('#mod-search').focus();
    await page.evaluate(() => {
        window.__alertResults = [];
        htmlAlert(
            () => window.Localization.t('gb_comment_not_sent', 'Comment not sent'),
            () => window.Localization.t('gb_view_comments_for', 'View comments for {0}', 'Download <script>'),
            [{ text: () => window.Localization.t('gb_view_comments', 'View comments'), resolveWith: 0 },
                { text: () => window.Localization.t('cancel', 'Cancel'), rejectWith: false }]
        ).catch(value => window.__alertResults.push({ rejected: value }));
        htmlAlert('Download', 'Comments <b>literal</b>', [{ text: 'Cancel', resolveWith: false }])
            .then(value => window.__alertResults.push({ resolved: value }));
    });
    await expect(page.locator('#community-alert-title')).toHaveText('Comment not sent');
    await page.evaluate(() => {
        window.__retainedDialog = document.querySelector('.alertMsg');
        window.__retainedDismiss = document.querySelector('.alertButtons button:last-child');
    });
    await page.evaluate(() => window.Localization.setLanguage('ja'));
    await expect(page.locator('#community-alert-title')).toHaveText(japanese.gb_comment_not_sent);
    await expect(page.locator('#community-alert-description')).toHaveText(japanese.gb_view_comments_for.replace('{0}', 'Download <script>'));
    await expect(page.locator('#community-alert-description script')).toHaveCount(0);
    await expect(page.locator('.alertButtons button:last-child')).toHaveText(japanese.cancel);
    await expect(page.locator('.alertButtons button:last-child')).toBeFocused();
    expect(await page.evaluate(() => ({
        sameDialog: window.__retainedDialog === document.querySelector('.alertMsg'),
        sameDismiss: window.__retainedDismiss === document.querySelector('.alertButtons button:last-child'),
        backgroundInert: document.querySelector('.viewport').inert
    }))).toEqual({ sameDialog: true, sameDismiss: true, backgroundInert: true });
    await page.keyboard.press('Escape');
    await expect(page.locator('#community-alert-title')).toHaveText('Download');
    await expect(page.locator('#community-alert-description')).toHaveText('Comments <b>literal</b>');
    await expect(page.locator('#community-alert-description b')).toHaveCount(0);
    await page.evaluate(() => window.Localization.setLanguage('ko'));
    await expect(page.locator('#community-alert-title')).toHaveText('Download');
    await expect(page.locator('.alertButtons button')).toHaveText('Cancel');
    await page.locator('.alertButtons button').click();
    await expect(page.locator('.alertMain')).toBeHidden();
    await expect(page.locator('#mod-search')).toBeFocused();
    expect(await page.evaluate(() => window.__alertResults)).toEqual([{ rejected: false }, { resolved: false }]);
    expect(await page.locator('.viewport').evaluate(node => node.inert)).toBe(false);
});

test('native alerts resolve the latest queued language and send only cloneable labels while settling original choices', async ({ page }) => {
    await openView(page, 'main');
    await installSharedAlerts(page);
    await page.evaluate(() => {
        localStorage.setItem('alertAlignment', 'Separate');
        window.__nativeAlerts = [];
        window.__nativeAlertResolvers = [];
        window.__nativeAlertResults = [];
        window.__nativeCallbacks = 0;
        window.deltamodBackend.isCommandAvailable = channel => channel === 'htmlAlert_outwin';
        window.deltamodBackend.invoke = async (channel, args) => {
            if (channel !== 'htmlAlert_outwin') return false;
            // structuredClone rejects any function accidentally sent over IPC.
            window.__nativeAlerts.push(structuredClone(args));
            return new Promise(resolve => window.__nativeAlertResolvers.push(resolve));
        };
        htmlAlert('Provider title', 'Provider diagnostic', [{ text: 'Proceed', resolveWith: false }])
            .then(value => window.__nativeAlertResults.push(value));
        htmlAlert(
            () => window.Localization.t('gb_comment_not_sent', 'Comment not sent'),
            () => window.Localization.t('gb_comment_page', 'Page {0}', window.Localization.number(7)),
            [{ text: () => window.Localization.t('download', 'Download'), resolveWith: 0,
                onClick: () => window.__nativeCallbacks++, extraCallback: () => 'not for IPC' },
                { text: () => window.Localization.t('cancel', 'Cancel'), rejectWith: '' }]
        ).then(value => window.__nativeAlertResults.push(value));
    });
    await expect.poll(() => page.evaluate(() => window.__nativeAlerts.length)).toBe(1);
    await page.evaluate(() => window.Localization.setLanguage('zh-CN'));
    await page.evaluate(() => window.__nativeAlertResolvers[0](0));
    await expect.poll(() => page.evaluate(() => window.__nativeAlerts.length)).toBe(2);
    expect(await page.evaluate(() => window.__nativeAlerts[1])).toEqual([
        chinese.gb_comment_not_sent,
        chinese.gb_comment_page.replace('{0}', '7'),
        [{ text: chinese.download }, { text: chinese.cancel }]
    ]);
    await page.evaluate(() => window.__nativeAlertResolvers[1](0));
    await expect.poll(() => page.evaluate(() => window.__nativeAlertResults.length)).toBe(2);
    expect(await page.evaluate(() => window.__nativeAlertResults)).toEqual([false, 0]);
    expect(await page.evaluate(() => window.__nativeCallbacks)).toBe(0);
    await page.evaluate(() => {
        htmlAlert('Local callback', 'No callbacks in native data', [{ text: () => 'Run', onClick: () => window.__nativeCallbacks++ }])
            .then(value => window.__nativeAlertResults.push(value === undefined ? 'callback settled' : value));
        htmlAlert('Reject', 'Preserve rejection precedence', [{ text: () => 'Dismiss', rejectWith: '', resolveWith: 123 }])
            .catch(value => window.__nativeAlertResults.push({ rejected: value }));
    });
    await expect.poll(() => page.evaluate(() => window.__nativeAlerts.length)).toBe(3);
    expect(await page.evaluate(() => window.__nativeAlerts[2][2])).toEqual([{ text: 'Run' }]);
    await page.evaluate(() => window.__nativeAlertResolvers[2](0));
    await expect.poll(() => page.evaluate(() => window.__nativeAlerts.length)).toBe(4);
    await page.evaluate(() => window.__nativeAlertResolvers[3](0));
    await expect.poll(() => page.evaluate(() => window.__nativeAlertResults.length)).toBe(4);
    expect(await page.evaluate(() => window.__nativeAlertResults)).toEqual([false, 0, 'callback settled', { rejected: '' }]);
    expect(await page.evaluate(() => window.__nativeCallbacks)).toBe(1);
});

test('a real comment failure alert changes language without losing its draft or return focus', async ({ page }) => {
    await commentsPage(page, { loggedIn: true });
    await installSharedAlerts(page);
    await page.evaluate(() => {
        window.deltamodBackend.invoke = async () => false;
    });
    await page.locator('#comment').fill('Keep this draft after the failure.');
    await page.locator('#sendBtn').click();
    await expect(page.locator('#community-alert-description')).toHaveText('GameBanana did not confirm that the comment was posted.');
    await page.evaluate(() => window.Localization.setLanguage('ja'));
    await expect(page.locator('#community-alert-title')).toHaveText(japanese.gb_comment_not_sent);
    await expect(page.locator('#community-alert-description')).toHaveText(japanese.gb_comment_unconfirmed);
    await expect(page.locator('.alertButtons button')).toHaveText(japanese.refine_retry);
    await expect(page.locator('#comment')).toHaveValue('Keep this draft after the failure.');
    await page.locator('.alertButtons button').click();
    await expect(page.locator('#sendBtn')).toBeEnabled();
    await expect(page.locator('#comment')).toBeFocused();
    await expect(page.locator('#comment')).toHaveValue('Keep this draft after the failure.');
});
