(() => {
const t = (key, fallback, ...args) => window.Localization?.t(key, fallback, ...args)
    ?? String(fallback).replace(/\{(\d+)\}/g, (match, index) => args[index] ?? match);
const number = (value, options) => window.Localization?.number?.(value, options)
    ?? new Intl.NumberFormat(window.Localization?.getLocale?.(), options).format(value);
const plural = (key, count, fallback, ...args) => window.Localization?.plural?.(key, count, fallback, ...args)
    ?? t(`${key}_${count === 1 ? 'one' : 'other'}`, fallback, number(count), ...args);
const localDate = millis => window.Localization?.date?.(millis, { dateStyle: 'medium', timeStyle: 'short' })
    ?? new Intl.DateTimeFormat(window.Localization?.getLocale?.(), { dateStyle: 'medium', timeStyle: 'short' }).format(millis);
function bindText(element, render, attribute = 'textContent') {
    if (!element) return;
    const compute = typeof render === 'function' ? render : () => String(render ?? '');
    if (window.Localization?.bindComputed) window.Localization.bindComputed(element, compute, attribute);
    else if (attribute === 'textContent') element.textContent = compute();
    else element.setAttribute(attribute, compute());
}
function sourceText(source, args = []) {
    const values = Array.isArray(args) ? args.map(value => typeof value === 'number' ? number(value) : value) : [];
    return window.Localization?.text?.(source, ...values)
        ?? String(source).replace(/\{(\d+)\}/g, (match, index) => values[index] ?? match);
}
function providerText(record, field, fallback = '') {
    const source = record?.[`${field}Source`];
    if (typeof source === 'string' && source.trim()) return sourceText(source, record[`${field}SourceArgs`]);
    return record?.[field] || (typeof fallback === 'function' ? fallback() : fallback);
}

function socialCount(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function socialCountLabel(kind, count) {
    if (count === null) return kind === 'likes'
        ? t('gb_likes_unknown', 'Like count unavailable') : t('gb_comments_unknown', 'Comment count unavailable');
    return plural(`gb_${kind}`, count, kind === 'likes' ? '{0} likes' : '{0} comments');
}

function likeResponseState(response) {
    const code = typeof response?.data?._sErrorCode === 'string' ? response.data._sErrorCode.toLowerCase() : '';
    if (code === 'already_liked') return 'already';
    if (Number.isInteger(response?.status) && response.status >= 200 && response.status < 300
        && !code && response?.data?._bSuccess !== false && response?.data?.success !== false) return 'liked';
    return 'failed';
}

function appendSubmissionTime(parent, mod) {
    const added = Number(mod._tsDateAdded) || 0;
    const modified = Math.max(Number(mod._tsDateModified) || 0, Number(mod._tsDateUpdated) || 0);
    const millis = Math.max(added, modified) * 1000;
    if (!Number.isFinite(millis) || millis <= 0 || !Number.isFinite(new Date(millis).valueOf())) return;
    const time = document.createElement('time');
    time.className = 'modDescSpan iptspan';
    time.dateTime = new Date(millis).toISOString();
    bindText(time, () => (localDate(millis)), 'title');
    bindText(time, () => (modified > added
        ? t('gb_updated_time', 'Updated {0}', window.Localization?.relativeTime?.(millis) ?? localDate(millis))
        : t('gb_posted_time', 'Posted {0}', window.Localization?.relativeTime?.(millis) ?? localDate(millis))));
    parent.append(time);
}

function createSocialButton(kind, mod, count) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'serietast shop-social-action';
    button.innerHTML = shopIcon(kind === 'likes' ? 'heart' : 'comment');
    const label = document.createElement('span');
    label.className = 'shop-social-label';
    bindText(label, () => (kind === 'likes' ? t('gb_like', 'Like') : t('gb_comments', 'Comments')));
    const countNode = document.createElement('span');
    countNode.className = 'shop-social-count';
    bindText(countNode, () => (count === null ? '—' : number(count)));
    bindText(countNode, () => (socialCountLabel(kind, count)), 'aria-label');
    button.append(label, countNode);
    bindText(button, () => (socialCountLabel(kind, count)), 'title');
    if (kind === 'comments') {
        bindText(button, () => (`${t('gb_view_comments_for', 'View comments for {0}', mod._sName)} · ${socialCountLabel(kind, count)}`), 'aria-label');
        return { button, label, countNode };
    }
    button.setAttribute('aria-pressed', 'false');
    bindText(button, () => (`${t('gb_like_mod', 'Like {0}', mod._sName)} · ${socialCountLabel(kind, count)}`), 'aria-label');
    button.disabled = !isGBLoggedIn;
    if (!isGBLoggedIn) bindText(button, () => (t('gb_like_login', 'Log in to GameBanana to like mods')), 'title');
    let pending = false;
    let liked = false;
    button.onclick = async () => {
        if (!isCurrentShopPage() || !isGBLoggedIn || pending || liked) return;
        pending = true;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        bindText(label, () => (t('gb_liking', 'Liking…')));
        try {
            const response = await window.deltamodBackend.invoke('gbLikeMod', [mod._sModelName, mod._idRow]);
            const result = likeResponseState(response);
            if (result === 'failed') throw localizedError(() => (t('gb_like_retry', 'GameBanana did not confirm the like. Please try again.')));
            liked = true;
            if (result === 'liked' && count !== null && count < Number.MAX_SAFE_INTEGER) count++;
            if (!isCurrentShopPage() || !button.isConnected) return;
            button.classList.add('is-liked');
            button.setAttribute('aria-pressed', 'true');
            bindText(countNode, () => (count === null ? '—' : number(count)));
            bindText(countNode, () => (socialCountLabel(kind, count)), 'aria-label');
            bindText(button, () => (socialCountLabel(kind, count)), 'title');
            bindText(button, () => (`${t('gb_liked', 'Liked')} · ${socialCountLabel(kind, count)}`), 'aria-label');
        } catch (error) {
            if (isCurrentShopPage() && button.isConnected) {
                await htmlAlert(() => (t('gb_like_failed', 'Could not like this mod')),
                    () => (describeError(error, t('gb_like_retry', 'GameBanana did not confirm the like. Please try again.'))),
                    [{ text: () => (t('allmods_ok', 'OK')), resolveWith: 'ok' }], 'error');
            }
        } finally {
            pending = false;
            if (button.isConnected) {
                button.disabled = liked || !isGBLoggedIn;
                button.removeAttribute('aria-busy');
                bindText(label, () => (liked ? t('gb_liked', 'Liked') : t('gb_like', 'Like')));
            }
        }
    };
    return { button, label, countNode };
}

const setInterval = (handler, delay, ...args) => {
    const interval = window.setInterval(handler, delay, ...args);
    window._intervals = window._intervals || [];
    window._intervals.push(interval);
    return interval;
};
let PAGE = (window._pageArguments && window._pageArguments.lp) ? parseInt(window._pageArguments.lp) : 1;
let pageActive = true;
let SHOP_PROVIDER = window._pageArguments?.provider
    || localStorage.getItem('modShopProvider')
    || 'gamebanana';
let SHOP_GAME_ID = window._pageArguments?.gameId
    || localStorage.getItem('modShopGameId')
    || null;
let SHOP_GAME = null;

const SHOP_PROVIDER_DEFS = Object.freeze([
    { id: 'gamebanana', name: 'GameBanana' },
    { id: 'nexus', name: 'Nexus Mods' },
    { id: 'moddb', name: 'ModDB (10 recent)' }
]);

// GameBanana mod-manager tool rows whose packages Deltamod can import.
// Deltamod packages carry a manifest; Deltahub/G3M packages are bare patches,
// so the importer asks which chapter they target. Prefer Deltamod when both exist.
const GAMEBANANA_DELTAMOD_TOOL_ID = 20575;
const GAMEBANANA_DELTAHUB_TOOL_ID = 20615;

function gameBananaToolIds(file) {
    return (file?._aModManagerIntegrations || []).map(integration => integration._idToolRow);
}

function eligibleGameBananaDownloads(files) {
    const downloadable = (files || []).filter(file =>
        typeof file?._sDownloadUrl === 'string' && file._sDownloadUrl.trim());
    const deltamod = downloadable.filter(file =>
        gameBananaToolIds(file).includes(GAMEBANANA_DELTAMOD_TOOL_ID));
    if (deltamod.length) return deltamod;
    return downloadable.filter(file =>
        gameBananaToolIds(file).includes(GAMEBANANA_DELTAHUB_TOOL_ID));
}

// Tauri rejects invokes with plain strings, so `.message` alone hides the backend reason.
function describeError(error, fallback) {
    if (typeof error?.messageSource === 'string' && error.messageSource.trim()) {
        return window.Localization?.text(error.messageSource) ?? error.message ?? error.messageSource;
    }
    if (typeof error?.localizedMessage === 'function') return error.localizedMessage();
    if (typeof error === 'string' && error.trim()) return error;
    return error?.message || fallback;
}
function localizedError(render) {
    const error = new Error(render());
    error.localizedMessage = render;
    return error;
}

function gameSupportsProvider(game, provider) {
    if (!game || typeof game !== 'object') return false;
    if (provider === 'gamebanana') return Number(game?.gamebanana?.id) > 0;
    if (provider === 'nexus') return Boolean(String(game?.sources?.nexus?.domain || '').trim());
    if (provider === 'moddb') return Boolean(String(game?.sources?.moddb?.slug || '').trim());
    return false;
}

function availableProvidersForGame(game) {
    return SHOP_PROVIDER_DEFS.filter(provider => gameSupportsProvider(game, provider.id));
}

async function resolveShopGame() {
    const games = await window.deltamodBackend.invoke('getAvailableGames', []);
    const supportedGames = (Array.isArray(games) ? games : [])
        .filter(game => SHOP_PROVIDER_DEFS.some(provider => gameSupportsProvider(game, provider.id)));
    if (supportedGames.length === 0) {
        throw localizedError(() => (t("shop_ui_no_supported_games_are_available_for_the_mod_shop", "No supported games are available for the Mod Shop.")));
    }

    let currentGame = null;
    try {
        currentGame = await window.deltamodBackend.invoke('getCurrentGameInfo', []);
    } catch {
        // Browsing the catalogue does not require an active installation.
    }

    const requestedId = SHOP_GAME_ID || currentGame?.id;
    SHOP_GAME = supportedGames.find(game => game.id === requestedId)
        || supportedGames.find(game => game.id === currentGame?.id)
        || supportedGames[0];
    SHOP_GAME_ID = SHOP_GAME.id;
    localStorage.setItem('modShopGameId', SHOP_GAME_ID);
    return { supportedGames, currentGame };
}

function currentShopGameBananaId() {
    return Number(SHOP_GAME?.gamebanana?.id) || 0;
}

function preserveShopArguments(extra = {}) {
    return { gameId: SHOP_GAME_ID, provider: SHOP_PROVIDER, ...extra };
}

// External catalogue requests are shared across page instances. Navigating or
// changing sort while a Nexus request is in flight must not create another
// request against the same quota window; callers with a different query wait
// for the active request to finish before starting their own.
const externalBrowseState = window._communityExternalBrowseState
    || (window._communityExternalBrowseState = { active: null });
let externalRetryTimer = null;
let gameBananaPageRequestActive = false;
let gameBananaInitialLoadComplete = false;
let gameBananaRetryPending = false;
let gameBananaHasMore = true;
let gameBananaDownloadActive = false;
let gameBananaFeaturedRecordsPromise = null;
const renderedGameBananaRecords = new Set();

window.PAGE = PAGE;

window._onClosePage.push(() => {
    pageActive = false;
    if (externalRetryTimer) {
        clearTimeout(externalRetryTimer);
        externalRetryTimer = null;
    }
    delete window.PAGE;
});

function isCurrentShopPage() {
    return pageActive && window.pageN === 'gamebanana-browse';
}

function timeoutPromise(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getThumbURL(mod) {
    try {
        if (mod._sImageUrl && mod._sImageUrl.length > 0) {
            return mod._sImageUrl;
        }
        return mod._aPreviewMedia._aImages[0]?._sBaseUrl + "/" + mod._aPreviewMedia._aImages[0]._sFile530;
    }
    catch {
        return 'https://gamebanana.com/img/gblogo.png';
    }
}

const element = document.querySelector('.scrollBottomDetector');

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (
        entry.isIntersecting
        && isCurrentShopPage()
        && gameBananaInitialLoadComplete
        && !gameBananaPageRequestActive
    ) {
        plusPage(1);
    }
  });
}, {
  threshold: 0.1
});

if (SHOP_PROVIDER === 'gamebanana') observer.observe(element);

window._onClosePage.push(() => {
    observer.disconnect();
});

function getAllThumbs(mod) {
    const images = Array.isArray(mod?._aPreviewMedia?._aImages) ? mod._aPreviewMedia._aImages : [];
    let ar = images.map(x => {
        const baseUrl = x._sBaseUrl + "/";
        const file220 = x._sFile220 || x._sFile530 || x._sFile;
        const file530 = x._sFile530 || x._sFile220 || x._sFile;
        return {
            urlA: baseUrl + x._sFile,
            urlB: baseUrl + (x._sFile100 || file220),
            urlCard220: baseUrl + file220,
            urlCard530: baseUrl + file530
        }
    });
    if (ar.length === 0) {
        const imageUrl = mod?._sImageUrl || mod?._sThumbnailUrl;
        ar.push({
            urlA: imageUrl || './img/mod-placeholder.png',
            urlB: mod?._sThumbnailUrl || imageUrl || './img/mod-placeholder.png',
            urlCard220: mod?._sThumbnailUrl || imageUrl || './img/mod-placeholder.png',
            urlCard530: imageUrl || mod?._sThumbnailUrl || './img/mod-placeholder.png'
        });
    }
    return ar;
}

function setCardImageSource(image, thumb) {
    const source220 = thumb.urlCard220 || thumb.urlCard530 || thumb.urlA;
    const source530 = thumb.urlCard530 || source220;
    const sourceSet = source220 === source530
        ? source220
        : `${source220} 220w, ${source530} 530w`;
    image.sizes = '130px';
    image.srcset = sourceSet;
    image.src = source530;
}

function createGalleryPreview(image, modName, images) {
    const preview = document.createElement('div');
    preview.className = 'mod-gallery-preview';
    preview.appendChild(image);
    if (!Array.isArray(images) || images.length === 0) return preview;

    image.tabIndex = 0;
    image.setAttribute('role', 'button');
    bindText(image, () => (t('shop_preview_count', 'Preview {0} ({1})', typeof modName === 'function' ? modName() : modName, plural('shop_images', images.length, '{0} images'))), 'aria-label');
    image.onclick = () => openImageLightbox(modName, images);
    image.onkeydown = event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            image.click();
        }
    };
    if (images.length > 1) {
        const count = document.createElement('span');
        count.className = 'mod-gallery-count';
        bindText(count, () => (`+${number(images.length - 1)}`));
        count.setAttribute('aria-hidden', 'true');
        preview.appendChild(count);
    }
    return preview;
}

function openImageLightbox(modName, imageList, initialIndex = 0) {
    const dialog = document.getElementById('modImageLightbox');
    const image = document.getElementById('modImageLightboxImage');
    const viewport = document.getElementById('modImageViewport');
    const title = document.getElementById('modImageLightboxTitle');
    const counter = document.getElementById('modImageLightboxCounter');
    const thumbnails = document.getElementById('modImageLightboxThumbnails');
    const zoomLevel = document.getElementById('modImageZoomLevel');
    const previous = document.getElementById('modImagePrevious');
    const next = document.getElementById('modImageNext');
    const zoomOut = document.getElementById('modImageZoomOut');
    const zoomIn = document.getElementById('modImageZoomIn');
    const zoomReset = document.getElementById('modImageZoomReset');
    const close = document.getElementById('modImageLightboxClose');

    const images = Array.isArray(imageList)
        ? imageList.filter(item => typeof item?.urlA === 'string' && item.urlA.length > 0)
        : [];
    if (!dialog || !image || images.length === 0) return;

    let currentIndex = Math.min(Math.max(Number(initialIndex) || 0, 0), images.length - 1);
    let zoom = 1;

    const applyZoom = () => {
        const percent = Math.round(zoom * 100);
        zoomLevel.value = `${percent}%`;
        bindText(zoomLevel, () => (number(percent / 100, { style: 'percent', maximumFractionDigits: 0 })));
        zoomOut.disabled = zoom <= 1;
        zoomIn.disabled = zoom >= 3;
        image.style.width = zoom === 1 ? 'auto' : `${percent}%`;
        image.style.maxWidth = zoom === 1 ? '100%' : 'none';
        image.style.maxHeight = zoom === 1 ? '100%' : 'none';
        image.style.cursor = zoom >= 3 ? 'zoom-out' : 'zoom-in';
        viewport.scrollTo({ top: 0, left: 0 });
    };

    const setZoom = value => {
        zoom = Math.min(3, Math.max(1, value));
        applyZoom();
    };

    const renderImage = () => {
        const selected = images[currentIndex];
        zoom = 1;
        image.src = selected.urlA;
        const name = () => typeof modName === 'function' ? modName() : modName;
        bindText(image, () => (t('shop_preview_image', '{0} preview {1}', name() || t('mod', 'Mod'), number(currentIndex + 1))), 'alt');
        bindText(title, () => (name() || t("shop_ui_image_preview", "Image preview")));
        bindText(counter, () => (t('shop_image_position', '{0} of {1}', number(currentIndex + 1), number(images.length))));
        previous.disabled = images.length < 2;
        next.disabled = images.length < 2;

        thumbnails.replaceChildren();
        images.forEach((item, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'mod-image-lightbox-thumbnail';
            bindText(button, () => (t('shop_show_image', 'Show image {0}', number(index + 1))), 'aria-label');
            button.setAttribute('aria-current', index === currentIndex ? 'true' : 'false');
            const thumbnail = document.createElement('img');
            thumbnail.src = item.urlB || item.urlA;
            thumbnail.alt = '';
            thumbnail.onerror = () => {
                thumbnail.onerror = null;
                thumbnail.src = './img/mod-placeholder.png';
            };
            button.appendChild(thumbnail);
            button.onclick = () => {
                currentIndex = index;
                renderImage();
            };
            thumbnails.appendChild(button);
        });
        applyZoom();
    };

    const move = amount => {
        if (images.length < 2) return;
        currentIndex = (currentIndex + amount + images.length) % images.length;
        renderImage();
    };

    previous.onclick = () => move(-1);
    next.onclick = () => move(1);
    zoomOut.onclick = () => setZoom(zoom - 0.25);
    zoomIn.onclick = () => setZoom(zoom + 0.25);
    zoomReset.onclick = () => setZoom(1);
    close.onclick = () => dialog.close();
    image.onclick = () => setZoom(zoom >= 3 ? 1 : zoom + 0.25);
    image.onerror = () => {
        image.onerror = null;
        image.src = './img/mod-placeholder.png';
    };
    dialog.onclick = event => {
        if (event.target === dialog) dialog.close();
    };
    dialog.onkeydown = event => {
        const direction = document.documentElement.dir === 'rtl' ? -1 : 1;
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            move(-direction);
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            move(direction);
        } else if (event.key === '+' || event.key === '=') {
            event.preventDefault();
            setZoom(zoom + 0.25);
        } else if (event.key === '-') {
            event.preventDefault();
            setZoom(zoom - 0.25);
        } else if (event.key === '0') {
            event.preventDefault();
            setZoom(1);
        }
    };

    renderImage();
    if (!dialog.open) dialog.showModal();
    close.focus();
}

function currentContentFilter() {
    return localStorage.getItem('gamebananaContentFilter') || 'all';
}

function applyContentFilter(records) {
    const filter = currentContentFilter();
    const compatibleRecords = records.filter(mod => {
        if (mod._sModelName == 'Wip' && !mod._bHasFiles) return false;
        return mod._sModelName === 'Wip' || mod._sModelName === 'Mod';
    });
    const visibleRecords = compatibleRecords.filter(mod => {
        if (filter === 'unrated') return !mod._bHasContentRatings;
        if (filter === 'rated') return Boolean(mod._bHasContentRatings);
        return true;
    });
    const excluded = compatibleRecords.length - visibleRecords.length;
    const status = document.getElementById('contentFilterStatus');
    if (status) {
        bindText(status, () => (filter === 'all'
            ? plural('shop_compatible_count', visibleRecords.length, 'Showing {0} compatible mods on this page.')
            : t('shop_content_filtered_count', 'Showing {0}; {1} excluded by the visible Content filter.', number(visibleRecords.length), number(excluded))));
    }
    return visibleRecords;
}

const featuredPeriodPriority = new Map([
    ['alltime', 7],
    ['year', 6],
    ['6month', 5],
    ['3month', 4],
    ['month', 3],
    ['week', 2],
    ['today', 1]
]);

function prioritizeFeaturedRecords(records, featuredIDs) {
    const bestRankByID = new Map();
    for (const featured of featuredIDs) {
        const rank = featuredPeriodPriority.get(featured.period) || 0;
        bestRankByID.set(featured.id, Math.max(bestRankByID.get(featured.id) || 0, rank));
    }

    return records
        .map((mod, index) => ({
            mod,
            index,
            rank: bestRankByID.get(mod._idRow) || 0
        }))
        .sort((left, right) => right.rank - left.rank || left.index - right.index)
        .map(entry => entry.mod);
}

function featuredRankForID(featuredIDs, id) {
    return featuredIDs.reduce((bestRank, featured) => {
        if (featured.id !== id) return bestRank;
        return Math.max(bestRank, featuredPeriodPriority.get(featured.period) || 0);
    }, 0);
}

function gameBananaRecordKey(record) {
    return `${record?._sModelName || 'Submission'}:${record?._idRow || 0}`;
}

async function getGameBananaFeaturedRecords(gameID) {
    if (!gameBananaFeaturedRecordsPromise) {
        gameBananaFeaturedRecordsPromise = browseGameBananaCatalog(
            `https://gamebanana.com/apiv11/Game/${gameID}/TopSubs`
        ).then(result => {
            const records = result.payload;
            return Array.isArray(records) ? records : [];
        }).catch(error => {
            console.warn('Featured GameBanana metadata is unavailable:', error);
            return [];
        });
    }
    return gameBananaFeaturedRecordsPromise;
}

function insertRankedGameBananaRow(table, row, rank) {
    row.dataset.featuredRank = String(rank);
    const lowerRankRow = Array.from(table.children).find(existingRow =>
        existingRow.dataset.featuredRank !== undefined &&
        Number(existingRow.dataset.featuredRank) < rank
    );
    if (lowerRankRow) table.insertBefore(row, lowerRankRow);
    else table.appendChild(row);
}

async function describeContentRatings(mod, chip) {
    if (!mod._bHasContentRatings) return;
    bindText(chip, () => (t("shop_ui_content_rated_submission", "Content-rated submission")));
    try {
        const response = await fetch(`https://gamebanana.com/apiv11/${mod._sModelName}/${mod._idRow}/ProfilePage`);
        if (!response.ok) return;
        const profile = await response.json();
        const ratings = Object.values(profile._aContentRatings || {});
        if (ratings.length) bindText(chip, () => (t('shop_content_labels', 'Content: {0}', ratings.join(', '))));
    } catch {}
}
    
var isGBLoggedIn = false;

async function gameBananaLogin() {
    var loggedin = await Promise.race([
        window.deltamodBackend.invoke('validateGamebananaToken', []),
        new Promise(resolve => setTimeout(() => resolve(false), 5000))
    ]).catch(error => {
        console.warn('GameBanana account status is unavailable; continuing anonymously.', error);
        return false;
    });

    isGBLoggedIn = loggedin;

    const accountPicture = document.getElementById('gbPic');
    accountPicture.onclick = async () => {
        window._pageArguments = {
            cat: 'gb'
        };
        page('options');
    };

    if (loggedin) {
        var pic = await window.deltamodBackend.invokeOptional('getGamebananaPic', [], null);
        if (typeof pic === 'string' && pic.trim()) {
            accountPicture.src = pic;
            accountPicture.hidden = false;
            accountPicture.onerror = () => {
                accountPicture.hidden = true;
                accountPicture.removeAttribute('src');
            };
            return;
        }
    }
    accountPicture.hidden = true;
    accountPicture.removeAttribute('src');
};

function roundViews(views) {
    const n = Number(views) || 0;
    if (n >= 1000) return Math.round(n / 1000) + 'k';
    return String(n);
}

let capi = '';
let csearch = '';
function syncSearchClearButton() {
    const input = document.getElementById('searchInput');
    const clearButton = document.getElementById('clearModSearchButton');
    if (input && clearButton) clearButton.hidden = input.value.length === 0;
}

function hideSearchSuggestions() {
    const suggestions = document.querySelector('.autocomplete .results');
    if (!suggestions) return;
    suggestions.innerHTML = '';
    suggestions.style.opacity = '0';
    suggestions.style.pointerEvents = 'none';
}

function clearModSearch() {
    const input = document.getElementById('searchInput');
    if (input) input.value = '';
    csearch = '';
    syncSearchClearButton();
    hideSearchSuggestions();
    window._pageArguments = preserveShopArguments();
    page('gamebanana-browse');
}

const SHOP_ICON_PATHS = Object.freeze({
    download: '<path d="M12 4v10m-4-4 4 4 4-4M5 19h14"/>',
    loading: '<path d="M19.4 7.5A8 8 0 1 0 20 12"/>',
    cancel: '<path d="m6 6 12 12M18 6 6 18"/>',
    done: '<path d="m5 12 4 4L19 6"/>',
    question: '<circle cx="12" cy="12" r="8"/><path d="M9.8 9a2.4 2.4 0 0 1 4.6 1c0 1.8-2.4 2-2.4 4"/><path d="M12 17h.01"/>',
    comment: '<path d="M5 5h14v11H9l-4 3V5Z"/>',
    heart: '<path d="M20.5 9c0 4.8-8.5 10-8.5 10S3.5 13.8 3.5 9A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8.5 2Z"/>',
    smile: '<circle cx="12" cy="12" r="8"/><path d="M9 10h.01M15 10h.01M8.5 14c1 1.4 2.1 2 3.5 2s2.5-.6 3.5-2"/>',
    open: '<path d="M13 5h6v6m0-6-9 9"/><path d="M17 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5"/>'
});

function shopIcon(name) {
    const aliases = {
        search_activity: 'loading',
        downloading: 'loading',
        progress_activity: 'loading',
        done_outline: 'done',
        indeterminate_question_box: 'question',
        mood_heart: 'heart',
        sentiment_very_satisfied: 'smile',
        open_in_new: 'open'
    };
    const iconName = aliases[name] || name;
    const path = SHOP_ICON_PATHS[iconName];
    if (!path) return icon(name, '0.9em');
    const spinning = iconName === 'loading' ? ' is-spinning' : '';
    return `<svg class="shop-action-icon${spinning}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${path}</svg>`;
}

function formatDownloadBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes === 0) return `${number(0)} B`;
    const units = ['B', 'KB', 'MB', 'GB'];
    const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const amount = bytes / (1024 ** unit);
    const decimals = unit === 0 || amount >= 10 || Number.isInteger(amount) ? 0 : 1;
    return `${number(amount, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} ${units[unit]}`;
}

function updateModDownloadStatus({ phase = 'download', completed = 0, total = 0, currentItem = '', currentItemSource = '' }) {
    const panel = document.getElementById('modDownloadStatus');
    if (!panel) return;
    const title = document.getElementById('modDownloadStatusTitle');
    const percent = document.getElementById('modDownloadStatusPercent');
    const item = document.getElementById('modDownloadStatusItem');
    const bytes = document.getElementById('modDownloadStatusBytes');
    const track = document.getElementById('modDownloadProgressTrack');
    const bar = document.getElementById('modDownloadProgressBar');
    const completedBytes = Math.max(0, Number(completed) || 0);
    const totalBytes = Math.max(0, Number(total) || 0);
    const percentage = phase === 'complete'
        ? 100
        : totalBytes > 0
            ? Math.max(0, Math.min(100, (completedBytes / totalBytes) * 100))
            : 0;
    const titles = {
        download: ['shop_ui_downloading_mod', 'Downloading mod…'],
        import: ['shop_ui_importing_mod', 'Importing mod…'],
        complete: ['shop_ui_mod_imported_successfully', 'Mod imported successfully'],
        manual: ['shop_ui_website_confirmation_required', 'Website confirmation required'],
        failed: ['shop_ui_download_or_import_failed', 'Download or import failed'],
        cancelled: ['shop_ui_import_cancelled_or_existing_mod_kept', 'Import cancelled or existing mod kept']
    };
    const titleDefinition = Object.hasOwn(titles, phase) ? titles[phase] : titles.download;

    panel.hidden = false;
    panel.dataset.phase = phase;
    bindText(title, () => t(...titleDefinition));
    bindText(percent, () => (phase === 'cancelled'
        ? t("shop_ui_not_imported", "Not imported")
        : phase === 'import'
        ? t("shop_ui_importing", "Importing")
        : phase === 'manual'
            ? t("shop_ui_website", "Website")
        : phase === 'failed' && percentage === 0
            ? t("shop_ui_failed", "Failed")
            : number(percentage / 100, { style: 'percent', maximumFractionDigits: 0 })));
    bindText(item, () => (typeof currentItemSource === 'string' && currentItemSource.trim()
        ? sourceText(currentItemSource) : typeof currentItem === 'function' ? currentItem() : currentItem) || t('shop_ui_mod_package', 'Mod package'));
    bindText(bytes, () => (totalBytes > 0
        ? `${formatDownloadBytes(completedBytes)} / ${formatDownloadBytes(totalBytes)}`
        : completedBytes > 0
            ? formatDownloadBytes(completedBytes)
            : ''));
    track.setAttribute('aria-valuenow', String(Math.round(percentage)));
    bindText(track, () => t(...titleDefinition), 'aria-valuetext');
    bar.style.setProperty('--mod-download-progress', `${percentage}%`);
}

function setDownloadButtonIcon(button, glyph) {
    if (button) button.innerHTML = shopIcon(glyph);
}

window.currentPageStack.updateModDownloadStatus = updateModDownloadStatus;

async function search(searchQuery = null) {
    const input = document.getElementById('searchInput');
    let query = String(searchQuery ?? input.value).trim();
    if (searchQuery !== null) {
        input.value = String(searchQuery);
    }
    syncSearchClearButton();
    if (query.length === 0) {
        clearModSearch();
        return;
    }
    if (query.length < 2) {
        await htmlAlert(() => (t("shop_ui_search_query_too_short", "Search query too short")),() => (t("shop_ui_please_enter_at_least_2_characters_to_search", "Please enter at least 2 characters to search.")),[{text:() => (t("shop_ui_ok", "Ok")),resolveWith:'ok'}], 'error');
        return;
    }

    if (SHOP_PROVIDER !== 'gamebanana') {
        window._pageArguments = preserveShopArguments({
            sourceQuery: query.trim()
        });
        page('gamebanana-browse');
        return;
    }

    const gameID = currentShopGameBananaId();
    if (!gameID) {
        await htmlAlert(
            () => (t("shop_ui_gamebanana_unavailable_for_this_game", "GameBanana unavailable for this game")),
            () => (t("shop_ui_choose_a_game_with_gamebanana_support_from_the_mod_shop_game_selector", "Choose a game with GameBanana support from the Mod Shop game selector.")),
            [{ text: () => (t("shop_ui_ok", "OK")), resolveWith: 'ok' }],
            'error'
        );
        return;
    }

    {
        // Search names, descriptions, owners, credits, and studios in one
        // request so creator names work without a separate author-only mode.
        window._pageArguments.gbAPI = 'https://gamebanana.com/apiv11/Util/Search/Results?_sModelName=Mod&_sOrder=best_match&_sSearchString=' + encodeURIComponent(query) + '&_csvFields=name%2Cdescription%2Carticle%2Cattribs%2Cstudio%2Cowner%2Ccredits&_idGameRow=' + gameID + '&_nPage=$PAGE';
        window._pageArguments.gbAPIFilter = async function(data) {
            return data;
        };
    }
    window._pageArguments.leSearchQuery = query;
    page('gamebanana-browse');
}

async function featured() {
    const gameID = currentShopGameBananaId();
    if (!gameID) return;
    // Why doesn't GB have a standard endpoint format for subs SMH
    window._pageArguments.gbAPI = 'https://gamebanana.com/apiv11/Game/' + gameID + '/TopSubs';
    window._pageArguments.gbAPIFilter = async function(data) {
        return {
            _aMetadata: { _bIsComplete: true },
            _aRecords: data.map(x => {
                x.featuredDataset = true;
                return x;
            })
        };
    } 
    page('gamebanana-browse');
}

window.currentPageStack.featured = featured;
window.currentPageStack.qms = {}; //queryme stack

async function dlmod(dlurl, buttonElem=null, modid, modmodel, currentItem = `GameBanana ${modmodel} ${modid}`) {
    if (!isCurrentShopPage() || gameBananaDownloadActive) return false;
    gameBananaDownloadActive = true;
    const sidebarButtons = Array.from(document.querySelectorAll('.sidebar-button'))
        .filter(button => !button.disabled);
    sidebarButtons.forEach(button => { button.disabled = true; });
    const pageCleanups = window._onClosePage;
    let navigationReleased = false;
    const releaseNavigation = () => {
        if (navigationReleased) return;
        navigationReleased = true;
        sidebarButtons.forEach(button => { button.disabled = false; });
        // Do not mutate the cleanup array while navigation is iterating it.
        if (pageActive) {
            const index = pageCleanups.indexOf(releaseNavigation);
            if (index !== -1) pageCleanups.splice(index, 1);
        }
    };
    pageCleanups.push(releaseNavigation);
    let queryme = Math.random().toString(36).substring(2, 15);

    setDownloadButtonIcon(buttonElem, 'search_activity');
    updateModDownloadStatus({ phase: 'download', currentItem });

    const progressHandlers = window.currentPageStack.qms;
    let imported = false;
    if (buttonElem) {
        buttonElem.disabled = true;
        buttonElem.setAttribute('aria-busy', 'true');
    }
    progressHandlers[queryme] = function(info) {
        if (!isCurrentShopPage()) return;
        if (info.error) {
            setDownloadButtonIcon(buttonElem, 'cancel');
            updateModDownloadStatus({
                phase: 'failed',
                currentItem
            });
            return;
        }

        const p = Math.max(0, Math.min(100, Number(info.progress) || 0));
        updateModDownloadStatus({
            phase: info.phase || 'download',
            completed: info.downloaded,
            total: info.total,
            currentItem
        });
        if (buttonElem) {
            buttonElem.style.transition = 'none';
            buttonElem.classList.add('download-progress');
            buttonElem.style.setProperty('--download-progress', `${p}%`);
        }

    };

    try {
        const result = await window.deltamodBackend.invoke('dlmodURL',[dlurl, queryme, modid, modmodel]);
        if (result === false) {
            if (isCurrentShopPage()) updateModDownloadStatus({ phase: 'cancelled', currentItem });
            return false;
        }
        if (result !== true) throw localizedError(() => (t("shop_ui_the_importer_did_not_confirm_a_completed_import_please_retry", "The importer did not confirm a completed import. Please retry.")));
        imported = true;
        if (!isCurrentShopPage()) return true;
        setDownloadButtonIcon(buttonElem, 'done_outline');
        updateModDownloadStatus({ phase: 'complete', currentItem });
        return true;
    } catch (error) {
        if (!isCurrentShopPage()) return false;
        setDownloadButtonIcon(buttonElem, 'cancel');
        updateModDownloadStatus({ phase: 'failed', currentItem });
        await htmlAlert(
            () => (t("shop_ui_download_failed", "Download failed")),
            () => (describeError(error, t("shop_ui_the_mod_could_not_be_downloaded_or_imported", "The mod could not be downloaded or imported."))),
            [{ text: () => (t("shop_ui_ok", "OK")), resolveWith: 'ok' }]
        );
        return false;
    } finally {
        delete progressHandlers[queryme];
        gameBananaDownloadActive = false;
        if (buttonElem) {
            buttonElem.disabled = imported;
            buttonElem.removeAttribute('aria-busy');
            buttonElem.style.opacity = '';
            buttonElem.classList.remove('download-progress');
            buttonElem.style.removeProperty('--download-progress');
            if (!imported) setDownloadButtonIcon(buttonElem, 'download');
        }
        releaseNavigation();
    }
}

window.currentPageStack.dlmod = async function(info) {
    let queryme = info.queryme;
    let qms = window.currentPageStack.qms;
    if (!qms[queryme]) {
        console.warn('Received dlmod progress for unknown queryme: ' + queryme);
        return;
    }
    let qme = qms[queryme];
    qme(info);
} 

window.currentPageStack.search = search;

window.currentPageStack.plusPage = plusPage;

window.currentPageStack.openImageLightbox = openImageLightbox;

var firstgeneration = true;

async function fetchGameBananaCatalogDirect(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            const error = localizedError(() => (t('gb_response_http', 'GameBanana returned HTTP {0}.', response.status)));
            error.status = response.status;
            throw error;
        }
        return {
            provider: 'gamebanana',
            payload: await response.json(),
            direct: true
        };
    } catch (error) {
        if (error?.name === 'AbortError') {
            const timeoutError = localizedError(() => (t("shop_ui_gamebanana_did_not_respond_before_the_request_timed_out", "GameBanana did not respond before the request timed out.")));
            timeoutError.code = 'GAMEBANANA_TIMEOUT';
            throw timeoutError;
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

async function browseGameBananaCatalog(url) {
    let nativeFailure = null;
    try {
        const nativeRequest = requestExternalSource({
            provider: 'gamebanana',
            url,
            gameId: SHOP_GAME_ID
        });
        const response = await Promise.race([
            nativeRequest,
            new Promise((_, reject) => setTimeout(() => {
                const error = localizedError(() => (t("shop_ui_the_native_gamebanana_request_timed_out", "The native GameBanana request timed out.")));
                error.code = 'GAMEBANANA_NATIVE_TIMEOUT';
                reject(error);
            }, 9000))
        ]);
        if (response?.ok && response.result?.payload !== undefined) {
            return response.result;
        }
        nativeFailure = localizedError(() => (response?.error?.message || t("shop_ui_the_native_gamebanana_catalogue_request_failed", "The native GameBanana catalogue request failed.")));
        nativeFailure.code = response?.error?.code || 'provider_unavailable';
    } catch (error) {
        nativeFailure = error;
    }

    // The public-read fallback keeps Linux WebKit usable if the native bridge
    // is unavailable while the public GameBanana endpoint itself is reachable.
    try {
        return await fetchGameBananaCatalogDirect(url);
    } catch (directFailure) {
        if (nativeFailure && !directFailure.cause) directFailure.cause = nativeFailure;
        throw directFailure;
    }
}

async function renderMods(table, GB_API, filter, gameID) {
    if (!isCurrentShopPage() || typeof GB_API !== 'string' || !table?.isConnected) {
        return false;
    }
    if (window.PAGE == null) {
        window.PAGE = 1;
    }
    var furl = GB_API.replace('$PAGE', window.PAGE);
    const requestedPage = window.PAGE;
    let catalog;
    let data;
    let featuredData;
    try {
        catalog = await browseGameBananaCatalog(furl);
        if (!isCurrentShopPage()) return;
        data = await filter(catalog.payload);
        if (!isCurrentShopPage()) return;
        featuredData = await getGameBananaFeaturedRecords(gameID);
        if (!isCurrentShopPage()) return;
    } catch (error) {
        console.error('GameBanana catalogue load failed:', error);
        if (isCurrentShopPage()) {
            renderGameBananaFailure(
                table,
                () => t("shop_ui_gamebanana_could_not_be_loaded", "GameBanana could not be loaded"),
                () => describeError(error, t("shop_ui_the_catalogue_request_failed_check_your_connection_and_try_again", "The catalogue request failed. Check your connection and try again.")),
                requestedPage
            );
        }
        return false;
    }

    const status = document.getElementById('contentFilterStatus');
    if (catalog.stale) {
        bindText(status, () => (t("shop_ui_showing_saved_gamebanana_results_while_the_live_catalogue_is_unavailable", "Showing saved GameBanana results while the live catalogue is unavailable.")));
    } else if (catalog.cached) {
        bindText(status, () => (t("shop_ui_loaded_this_gamebanana_page_from_the_local_catalogue_cache", "Loaded this GameBanana page from the local catalogue cache.")));
    }

    var featuredIDs = featuredData.map(x => {return {id: x._idRow, period: x._sPeriod};});

    if (firstgeneration) {
        table.replaceChildren();
        renderedGameBananaRecords.clear();
    }

    try {
        const complete = Boolean(data._aMetadata._bIsComplete);
        const pageRecords = Array.isArray(data._aRecords) ? data._aRecords : [];
        const isFeaturedDataset = pageRecords.some(record => record.featuredDataset);
        const candidates = firstgeneration && !isFeaturedDataset && /\/Subfeed(?:\?|$)/.test(GB_API)
            ? [...featuredData, ...pageRecords]
            : pageRecords;
        const pageKeys = new Set();
        const pageRows = [];
        const records = prioritizeFeaturedRecords(applyContentFilter(candidates), featuredIDs)
            .filter(record => {
                const key = gameBananaRecordKey(record);
                if (renderedGameBananaRecords.has(key) || pageKeys.has(key)) return false;
                pageKeys.add(key);
                return true;
            });

        if (records.length == 0 && firstgeneration) {
            var tr = document.createElement('tr');
            var td = document.createElement('td');
            td.colSpan = 2;
            bindText(td, () => (currentContentFilter() === 'all'
                ? t("shop_ui_no_mods_were_found_matching_your_query", "No mods were found matching your query.")
                : t("shop_ui_no_submissions_on_this_page_match_the_active_content_filter", "No submissions on this page match the active Content filter.")));
            tr.appendChild(td);
            table.appendChild(tr);
            gameBananaHasMore = false;
            firstgeneration = false;
            observer.disconnect(); // stop observing since there's no more content to load
            document.querySelector('.scrollBottomDetector').style.display = 'none'; // hide the loading indicator
            return true;
        }
        for (const mod of records) {
            await (async () => {
                var tr = document.createElement('tr');
                tr.dataset.canonicalIdentity = `gamebanana:${mod._sModelName || 'Submission'}:${mod._idRow || 0}`;

                var td0 = document.createElement('td');
                td0.style.display = 'flex';
                td0.style.alignItems = 'center';
                td0.style.gap = '14px';
                td0.style.justifyContent = 'flex-start';
                // Rendering of td0
                {
                let thumbs = getAllThumbs(mod);
                var img = document.createElement('img');
                img.className = 'modThumbImg';
                setCardImageSource(img, thumbs[0]);
                img.loading = 'lazy';
                img.decoding = 'async';
                bindText(img, () => (t('shop_preview', '{0} preview', mod._sName || t('mod', 'Mod'))), 'alt');
                img.onerror = () => {
                    img.onerror = null;
                    img.src = './img/mod-placeholder.png';
                };
                img.style.width = '130px';
                img.style.aspectRatio = '16 / 9';
                img.style.height = 'auto';
                img.style.objectFit = 'cover';
                img.style.objectPosition = 'center';

                var div0 = createGalleryPreview(img, mod._sName, thumbs);
                div0.classList.add('modThumbDiv');

                var div1 = document.createElement('div');
                div1.className = 'modCopy external-source-card';
                td0.appendChild(div0);
                td0.appendChild(div1);

                var biggerSpan = document.createElement('span');
                biggerSpan.className = 'modTitleSpan';
                biggerSpan.style.fontSize = '1.2em';
                biggerSpan.style.marginBottom = '0px';
                biggerSpan.innerText = mod._sName;
                biggerSpan.dataset.userContent = '';
                biggerSpan.dir = 'auto';
                biggerSpan.style.cursor = 'pointer';
                biggerSpan.onclick = () => {
                    window.open(mod._sProfileUrl, '_blank');
                };
                div1.appendChild(biggerSpan);
                var sourceBadge = document.createElement('span');
                sourceBadge.className = 'external-source-badge';
                sourceBadge.innerText = 'GameBanana';
                div1.appendChild(sourceBadge);

                var otherInfoSpan = document.createElement('div');
                otherInfoSpan.className = 'modOtherInfoSpan calibri';
                otherInfoSpan.style.fontSize = '0.9em';
                otherInfoSpan.style.display = 'flex';
                otherInfoSpan.style.alignItems = 'center';
                otherInfoSpan.style.flexWrap = 'wrap';
                otherInfoSpan.style.gap = '8px';
                otherInfoSpan.style.color = '#cccccc';
                otherInfoSpan.style.marginTop = '7px';
                otherInfoSpan.style.width = '100%';

                const authorName = () => {
                    const name = mod._aSubmitter?._sName || t('gb_unknown_author', 'Unknown author');
                    return mod._aSubmitter?._idRow == 1712567 ? t('shop_tenna_lover', '{0} (Tenna lover)', name) : name;
                };
                var authorSpan = document.createElement('span');
                authorSpan.className = 'modAuthorSpan iptspan';
                authorSpan.style.marginRight = '12px';
                var authorImage = document.createElement('img');
                authorImage.src = mod._aSubmitter?._sAvatarUrl || './img/mod-placeholder.png';
                authorImage.alt = '';
                authorImage.loading = 'lazy';
                authorImage.decoding = 'async';
                authorImage.className = 'modAvatarImg';
                authorImage.onerror = () => {
                    authorImage.onerror = null;
                    authorImage.src = './img/mod-placeholder.png';
                };
                const authorLabel = document.createElement('span');
                authorLabel.dataset.userContent = '';
                bindText(authorLabel, () => t('gb_author_label', 'By {0}', authorName()));
                authorSpan.append(authorImage, authorLabel);
                authorSpan.dir = 'auto';
                authorSpan.onclick = () => {
                    if (mod._aSubmitter?._sProfileUrl) window.open(mod._aSubmitter._sProfileUrl, '_blank');
                };
                authorSpan.style.cursor = 'pointer';

                var e = null;
                if (featuredIDs.find(x => x.id === mod._idRow)) {
                    biggerSpan.style.color = 'gold';
                    img.style.borderColor = 'gold';

                    var periodsDesc = [
                        ['alltime', 'shop_ui_all_time_featured', 'All-time featured'],
                        ['year', 'shop_ui_best_of_this_year', 'Best of this year'],
                        ['6month', 'shop_ui_best_of_last_6_months', 'Best of last 6 months'],
                        ['3month', 'shop_ui_best_of_last_3_months', 'Best of last 3 months'],
                        ['month', 'shop_ui_best_of_this_month', 'Best of this month'],
                        ['week', 'shop_ui_best_of_this_week', 'Best of this week'],
                        ['today', 'shop_ui_best_of_today', 'Best of today']
                    ]
                    var featSpan = document.createElement('span');
                    featSpan.className = 'modFeaturedSpan iptspan';
                    featSpan.style.display = 'inline-block';
                    for (let pd of periodsDesc) {
                    if (featuredIDs.find(x => x.id === mod._idRow && x.period === pd[0])) {
                        featSpan.innerHTML = icon(pd[0] === 'alltime' ? 'award_star' : 'editor_choice', '1.1em');
                        const featureLabel = document.createElement('span');
                        bindText(featureLabel, () => ` ${t(pd[1], pd[2])}`);
                        featSpan.append(featureLabel);
                        break;
                    }
                    }
                    featSpan.style.color = 'gold';
                    featSpan.style.marginRight = '12px';
                    e = featSpan;
                }
                otherInfoSpan.appendChild(authorSpan);
                if (e) otherInfoSpan.appendChild(e);
                if (mod._bHasContentRatings) {
                    const ratingChip = document.createElement('span');
                    ratingChip.className = 'content-rating-chip';
                    ratingChip.setAttribute('role', 'note');
                    otherInfoSpan.appendChild(ratingChip);
                    describeContentRatings(mod, ratingChip);
                }
                div1.appendChild(otherInfoSpan);

                appendSubmissionTime(otherInfoSpan, mod);

                var summary = document.createElement('div');
                summary.className = 'external-source-summary calibri';
                summary.dataset.userContent = '';
                summary.dir = 'auto';
                bindText(summary, () => (mod._sDescription || t("shop_ui_no_description_was_provided", "No description was provided.")));
                div1.appendChild(summary);
                }

                var td1 = document.createElement('td');
                td1.style.textAlign = 'center';
                td1.className = 'shop-action-cell';
                // Rendering of td1
                {
                    var dlBtn = document.createElement('button');
                    dlBtn.innerHTML = shopIcon('download');
                    dlBtn.className = 'serietast';
                    bindText(dlBtn, () => (t("shop_ui_download_and_import_mod", "Download and import mod")), 'title');
                    bindText(dlBtn, () => (t('shop_download_mod', 'Download {0}', mod._sName)), 'aria-label');
                    dlBtn.onclick = async () => {
                        if (!isCurrentShopPage() || gameBananaDownloadActive || dlBtn.disabled) return;
                        dlBtn.disabled = true;
                        dlBtn.setAttribute('aria-busy', 'true');
                        setDownloadButtonIcon(dlBtn, 'downloading');
                        dlBtn.style.opacity = '0.7';

                        const resetDownloadButton = () => {
                            dlBtn.disabled = false;
                            dlBtn.removeAttribute('aria-busy');
                            dlBtn.style.opacity = '';
                            setDownloadButtonIcon(dlBtn, 'download');
                        };
                        let dlpage;
                        try {
                            const profileUrl = `https://gamebanana.com/apiv11/${mod._sModelName}/${mod._idRow}/ProfilePage`;
                            let response;
                            try {
                                response = await fetchGameBananaCatalogDirect(profileUrl);
                            } catch {
                                // The native provider is serialized, so it is only the fallback.
                                response = await browseGameBananaCatalog(profileUrl);
                            }
                            dlpage = response.payload;
                            if (!Array.isArray(dlpage?._aFiles)) throw localizedError(() => (t("shop_ui_gamebanana_returned_an_invalid_file_list", "GameBanana returned an invalid file list.")));
                        } catch (error) {
                            resetDownloadButton();
                            if (isCurrentShopPage()) {
                                await htmlAlert(() => (t("shop_ui_download_failed", "Download failed")), () => (describeError(error, t("shop_ui_the_file_list_could_not_be_loaded_try_again", "The file list could not be loaded. Try again."))), [{ text: () => (t("shop_ui_ok", "OK")), resolveWith: 'ok' }]);
                            }
                            return;
                        }
                        if (!isCurrentShopPage() || !dlBtn.isConnected) return;
                        if (gameBananaDownloadActive) {
                            resetDownloadButton();
                            return;
                        }
                        dlBtn.removeAttribute('aria-busy');

                        var eligibleDownloads = eligibleGameBananaDownloads(dlpage._aFiles);

                        if (eligibleDownloads.length === 0) {
                            setDownloadButtonIcon(dlBtn, 'cancel');
                            var open = await htmlAlert(() => (t("shop_ui_one_click_download_not_available", "One-click download not available")), () => (t("shop_ui_this_mod_cannot_be_downloaded_via_deltamod_because_the_owner_did_not_package_it_for_u", "This mod cannot be downloaded via Deltamod because the owner did not package it for usage with the tool.")),[{text:() => (t("shop_ui_ok", "Ok")),resolveWith:'no',},{text:() => (t("shop_ui_open_mod_page_on_gamebanana", "Open mod page on GameBanana")),resolveWith:'yes'}], 'web_traffic');
                            if (open === 'yes') {
                                window.open(mod._sProfileUrl, '_blank');
                            }
                            resetDownloadButton();
                            return;
                        }

                        if (eligibleDownloads.length > 1) {
                            setDownloadButtonIcon(dlBtn, 'indeterminate_question_box');
                            var dtr = document.createElement('tr');
                            var td = document.createElement('td');
                            td.colSpan = 2;
                            dtr.appendChild(td);
                            
                            var btnsDiv = document.createElement('div');
                            td.appendChild(btnsDiv);

                            eligibleDownloads.forEach((file) => {
                                console.log(JSON.stringify(file));
                                var thisBtn = document.createElement('button');
                                thisBtn.style.display = 'inline-flex';
                                thisBtn.style.alignItems = 'center';
                                thisBtn.style.gap = '4px';
                                thisBtn.style.margin = '4px';
                                thisBtn.style.width = '100%';
                                thisBtn.onclick = async () => {
                                    if (!dtr.isConnected || gameBananaDownloadActive) return;
                                    dtr.remove();
                                    await dlmod(file._sDownloadUrl.replace('dl','mmdl'), dlBtn, mod._idRow, mod._sModelName, file._sFile || file._sName || mod._sName);
                                };
                                btnsDiv.appendChild(thisBtn);

                                var dlIcon = document.createElement('span');
                                dlIcon.innerHTML = icon('download', '1.1em');
                                thisBtn.appendChild(dlIcon);

                                var details = document.createElement('div');
                                details.style.textAlign = 'left';
                                thisBtn.appendChild(details);

                                var filename = document.createElement('span');
                                filename.innerText = file._sFile;
                                filename.dataset.userContent = '';
                                filename.style.display = 'block';
                                filename.style.fontWeight = 'bold';
                                filename.style.fontSize = '1.1em';
                                details.appendChild(filename);

                                var filesize = document.createElement('span');
                                filesize.style.display = 'block';
                                bindText(filesize, () => (` (${formatDownloadBytes(file._nFilesize)})`));
                                filesize.style.fontSize = '0.9em';
                                details.appendChild(filesize);

                                var filedesc = document.createElement('span');
                                filedesc.style.display = 'block';
                                bindText(filedesc, () => (file._sDescription || t("shop_ui_no_description_provided", "No description provided.")));
                                filedesc.style.fontSize = '0.9em';
                                filedesc.style.color = '#ffffff60';
                                details.appendChild(filedesc);

                                var filedate = document.createElement('span');
                                var fdate = new Date(file._tsDateAdded * 1000);
                                filedate.style.display = 'block';
                                bindText(filedate, () => (t('shop_file_added', 'Added {0}', Number.isFinite(fdate.valueOf()) ? localDate(fdate.valueOf()) : t('shop_date_unavailable', 'Date unavailable'))));
                                filedate.style.fontSize = '0.9em';
                                filedate.style.color = '#ffffff60';
                                details.appendChild(filedate);

                                if (file._sAvState == 'done' && file._sAvResult != 'clean') {
                                    var avspan = document.createElement('span');
                                    avspan.style.display = 'block';
                                    avspan.style.fontSize = '0.9em';
                                    avspan.style.color = '#ffffff';
                                    avspan.style.backgroundColor = '#980000';
                                    avspan.style.padding = '2px 4px';
                                    bindText(avspan, () => (t('shop_file_flagged', 'File flagged: {0}', file._sAnalysisResultVerbose)));
                                    details.appendChild(avspan);
                                }
                            });

                            const cancelChoice = document.createElement('button');
                            cancelChoice.type = 'button';
                            cancelChoice.dataset.i18n = 'cancel';
                            bindText(cancelChoice, () => (window.Localization.t('cancel', 'Cancel')));
                            cancelChoice.onclick = () => {
                                dtr.remove();
                                resetDownloadButton();
                                dlBtn.focus();
                            };
                            btnsDiv.appendChild(cancelChoice);
                            tr.insertAdjacentElement("afterend", dtr);
                            btnsDiv.querySelector('button')?.focus();

                            await timeoutPromise(100);
                            rew();

                            return;
                        }

                        const file = eligibleDownloads[0];
                        await dlmod(file._sDownloadUrl.replace('dl','mmdl'), dlBtn, mod._idRow, mod._sModelName, file._sFile || file._sName || mod._sName);
                    };

                    td1.appendChild(dlBtn);

                    const { button: commentBtn } = createSocialButton('comments', mod, socialCount(mod._nPostCount));
                    commentBtn.onclick = () => {
                        window._pageArguments = {
                            id: mod._idRow,
                            model: mod._sModelName,
                            returnArguments: preserveShopArguments({ lp: window.PAGE, leSearchQuery: csearch, gbAPI: GB_API, gbAPIFilter: filter })
                        };
                        page('gamebanana-leave-comment');
                    };
                    td1.appendChild(commentBtn);
                    const { button: likeBtn } = createSocialButton('likes', mod, socialCount(mod._nLikeCount));
                    td1.appendChild(likeBtn);
                }

                // tr-ify and add
                tr.appendChild(td0);
                tr.appendChild(td1);

                pageRows.push({ row: tr, rank: featuredRankForID(featuredIDs, mod._idRow) });
            })();
        };
        if (!isCurrentShopPage()) return false;
        // Publish a complete page together, so malformed later records cannot
        // leave partial rows or deduplication keys behind on a retry.
        for (const { row, rank } of pageRows) insertRankedGameBananaRow(table, row, rank);
        for (const key of pageKeys) renderedGameBananaRecords.add(key);
        if (complete) {
            gameBananaHasMore = false;
            observer.disconnect();
            document.querySelector('.scrollBottomDetector').style.display = 'none';
        }
    }
    catch (e) {
        console.error(e);
        if (isCurrentShopPage()) {
            renderGameBananaFailure(
                table,
                () => t('shop_ui_gamebanana_could_not_be_loaded', 'GameBanana could not be loaded'),
                () => describeError(e, t('shop_ui_the_selected_mod_catalogue_could_not_be_loaded', 'The selected mod catalogue could not be loaded.')),
                requestedPage
            );
        }
        return false;
    }

    firstgeneration = false;
    return true;
}

function renderGameBananaFailure(table, title, message, requestedPage) {
    gameBananaRetryPending = true;
    const retry = () => loadGameBananaPage(requestedPage);
    if (firstgeneration) {
        renderSourceState(table, title, message, {
            label: () => t('refine_retry', 'Retry'), run: retry
        });
        return;
    }

    // Keep the pages already read in place. A failed page must be retried
    // explicitly before infinite scrolling can request the following page.
    table.querySelector('.shop-page-retry')?.remove();
    const row = document.createElement('tr');
    row.className = 'shop-page-retry';
    const cell = document.createElement('td');
    cell.colSpan = 2;
    const detail = document.createElement('p');
    detail.className = 'calibri';
    detail.setAttribute('role', 'status');
    detail.dataset.i18n = 'shop_next_page_failed';
    bindText(detail, () => (window.Localization.t('shop_next_page_failed', 'The next page could not be loaded. Your current results are still here.')));
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.i18n = 'refine_retry';
    bindText(button, () => (window.Localization.t('refine_retry', 'Retry')));
    button.onclick = retry;
    cell.append(detail, button);
    row.append(cell);
    table.append(row);
}

function renderSourceState(table, title, message, action = null) {
    table.closest('table')?.classList.add('is-state');
    table.replaceChildren();
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 2;
    td.className = 'shop-state';
    const heading = document.createElement('h2');
    bindText(heading, title);
    const detail = document.createElement('p');
    detail.className = 'calibri';
    bindText(detail, message);
    td.append(heading, detail);
    if (action) {
        const button = document.createElement('button');
        button.type = 'button';
        bindText(button, action.label);
        button.onclick = action.run;
        td.appendChild(button);
    }
    tr.appendChild(td);
    table.appendChild(tr);
}

function renderSourceLoading(table, rowCount = 4) {
    table.closest('table')?.classList.remove('is-state');
    table.replaceChildren();

    for (let index = 0; index < rowCount; index += 1) {
        const row = document.createElement('tr');
        row.className = 'shop-skeleton-row';
        row.setAttribute('aria-hidden', 'true');

        const cell = document.createElement('td');
        cell.colSpan = 2;

        const skeleton = document.createElement('div');
        skeleton.className = 'shop-skeleton';

        const thumbnail = document.createElement('span');
        thumbnail.className = 'shop-skeleton-thumb';

        const copy = document.createElement('span');
        copy.className = 'shop-skeleton-copy';
        copy.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));

        const actions = document.createElement('span');
        actions.className = 'shop-skeleton-actions';
        actions.append(document.createElement('i'), document.createElement('i'));

        skeleton.append(thumbnail, copy, actions);
        cell.appendChild(skeleton);
        row.appendChild(cell);
        table.appendChild(row);
    }
}

function formatSourceDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return t("shop_date_unavailable", "Date unavailable");
    return localDate(date.valueOf());
}

function setExternalSourceControlsDisabled(disabled) {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.disabled = disabled;
    const searchButton = document.getElementById('modShopSearchButton');
    if (searchButton) searchButton.disabled = disabled;
    const clearButton = document.getElementById('clearModSearchButton');
    if (clearButton) clearButton.disabled = disabled;
    const sort = document.getElementById('nexusSort');
    if (sort) sort.disabled = disabled;
}

function externalBrowseRequestKey(request) {
    return JSON.stringify([
        request?.provider || '',
        request?.gameId || '',
        request?.query || '',
        request?.sort || '',
        request?.url || ''
    ]);
}

function requestExternalSource(request) {
    const key = externalBrowseRequestKey(request);
    const active = externalBrowseState.active;
    if (active) {
        if (active.key === key) return active.promise;
        // A new search may be requested from a freshly mounted page while the
        // old page is still waiting on the network. Queue it behind the old
        // request so only one Nexus call is active at a time.
        return active.promise
            .catch(() => undefined)
            .then(() => requestExternalSource(request));
    }

    const promise = Promise.resolve().then(() => window.communityAPI.modSources.browse(request));
    externalBrowseState.active = { key, promise };
    promise.finally(() => {
        if (externalBrowseState.active?.promise === promise) {
            externalBrowseState.active = null;
        }
    }).catch(() => {});
    return promise;
}

function copyRateLimitMetadata(target, source) {
    if (!source || typeof source !== 'object') return target;
    if (source.retryAfterMs != null && Number.isFinite(Number(source.retryAfterMs))) {
        target.retryAfterMs = Math.max(0, Number(source.retryAfterMs));
    }
    if (source.retryAt != null) target.retryAt = source.retryAt;
    if (source.quota && typeof source.quota === 'object') target.quota = source.quota;
    return target;
}

function nexusRateLimitMetadata(error) {
    const retryAtMs = Date.parse(String(error?.retryAt || ''));
    const retryAfterMs = Number(error?.retryAfterMs);
    let waitMs = Number.isFinite(retryAfterMs) ? Math.max(0, retryAfterMs) : 0;
    if (Number.isFinite(retryAtMs)) waitMs = Math.max(waitMs, retryAtMs - Date.now());
    if (!waitMs) {
        const quotaResets = ['daily', 'hourly']
            .map(period => Date.parse(String(error?.quota?.[period]?.resetAt || '')))
            .filter(Number.isFinite)
            .map(timestamp => timestamp - Date.now())
            .filter(value => value > 0);
        if (quotaResets.length) waitMs = Math.min(...quotaResets);
    }
    // A typed rate-limit response without a usable reset value still deserves
    // a quiet wait period; never offer an immediate retry that can hammer 429.
    if (!waitMs) waitMs = 60 * 1000;
    return {
        waitMs,
        retryAtMs: Number.isFinite(retryAtMs) ? retryAtMs : Date.now() + waitMs
    };
}

function formatRateLimitMessage(error) {
    const { waitMs, retryAtMs } = nexusRateLimitMetadata(error);
    const waitSeconds = Math.max(1, Math.ceil(waitMs / 1000));
    const waitText = waitSeconds < 120
        ? plural('shop_rate_seconds', waitSeconds, '{0} seconds') : localDate(retryAtMs);
    const quotaParts = ['daily', 'hourly'].map(period => {
        const quota = error?.quota?.[period];
        if (!quota || !Number.isFinite(Number(quota.remaining))) return '';
        return period === 'daily' ? t('shop_quota_today', '{0} today', number(quota.remaining))
            : t('shop_quota_hour', '{0} this hour', number(quota.remaining));
    }).filter(Boolean);
    const quotaText = quotaParts.length ? t('shop_quota_remaining', 'Remaining quota: {0}.', quotaParts.join(', ')) : '';
    return t('shop_rate_wait', 'Nexus Mods asked Community to wait before another catalogue request. Try again after {0}. {1}', waitText, quotaText).trim();
}

function scheduleNexusRateLimitRetry(table, error) {
    if (externalRetryTimer) clearTimeout(externalRetryTimer);
    const { waitMs } = nexusRateLimitMetadata(error);
    // setTimeout accepts a signed 32-bit delay; a long quota reset is still
    // represented in the message, while the controls remain disabled safely.
    const delay = Math.min(Math.max(1000, waitMs), 2_147_000_000);
    externalRetryTimer = setTimeout(() => {
        externalRetryTimer = null;
        if (!isCurrentShopPage()) return;
        setExternalSourceControlsDisabled(false);
        renderSourceState(
            table,
            () => t("shop_ui_nexus_mods_ready_to_retry", "Nexus Mods ready to retry"),
            () => t("shop_ui_the_reported_quota_window_has_elapsed_retry_when_you_are_ready", "The reported quota window has elapsed. Retry when you are ready."),
            { label: () => t("shop_ui_retry", "Retry"), run: () => initializeExternalSource(table) }
        );
    }, delay);
}

function isNexusRateLimited(error) {
    return SHOP_PROVIDER === 'nexus'
        && (error?.code === 'NEXUS_RATE_LIMITED' || Number(error?.status) === 429);
}

async function downloadNexusSource(item, button) {
    const operationId = crypto.randomUUID();
    const original = button.innerHTML;
    button.disabled = true;
    setDownloadButtonIcon(button, 'progress_activity');
    const itemTitle = () => providerText(item, 'title', () => t('mod', 'Mod'));
    updateModDownloadStatus({ phase: 'download', currentItem: itemTitle });
    const unsubscribe = window.communityAPI.modSources.onProgress(progress => {
        if (progress.operationId !== operationId) return;
        updateModDownloadStatus({
            phase: progress.phase || 'download',
            completed: progress.completed,
            total: progress.total,
            currentItem: progress.currentItem || itemTitle,
            currentItemSource: progress.currentItemSource
        });
        if (progress.total > 0) {
            const percentage = Math.max(0, Math.min(100, (progress.completed / progress.total) * 100));
            button.classList.add('download-progress');
            button.style.setProperty('--download-progress', `${percentage}%`);
        }
    });
    try {
        const response = await window.communityAPI.modSources.downloadNexus({
            modId: item.id,
            operationId,
            sourceUrl: item.sourceUrl
        });
        if (response?.ok === false) {
            const error = localizedError(() => describeError(response?.error, t("shop_ui_nexus_mods_download_is_unavailable", "Nexus Mods download is unavailable.")));
            if (typeof response?.error?.messageSource === 'string') error.messageSource = response.error.messageSource;
            error.code = response?.error?.code || 'NEXUS_DOWNLOAD_FAILED';
            if (Number.isInteger(response?.error?.status)) error.status = response.error.status;
            copyRateLimitMetadata(error, response?.error);
            throw error;
        }
        setDownloadButtonIcon(button, 'done_outline');
        updateModDownloadStatus({ phase: 'complete', currentItem: itemTitle });
    } catch (error) {
        setDownloadButtonIcon(button, 'cancel');
        const authorizationRequired = [
            'NEXUS_SSO_REQUIRED',
            'NEXUS_AUTH_REQUIRED'
        ].includes(error?.code)
            || (error?.code === 'NEXUS_AUTH_FAILED' && Number(error?.status) !== 403);
        const manual = !authorizationRequired && (
            error?.code === 'NEXUS_MANUAL_DOWNLOAD_REQUIRED'
            || Number(error?.status) === 403
            || /non-premium|website/i.test(error?.message || '')
        );
        updateModDownloadStatus({
            phase: manual ? 'manual' : 'failed',
            currentItem: () => manual ? itemTitle() : describeError(error, itemTitle())
        });
        if (isNexusRateLimited(error)) {
            await htmlAlert(
                () => (t("shop_ui_nexus_mods_rate_limit_reached", "Nexus Mods rate limit reached")),
                () => (formatRateLimitMessage(error)),
                [{ text: () => (t("shop_ui_ok", "OK")), resolveWith: 'ok' }],
                'error'
            );
            return;
        }
        const choice = await htmlAlert(
            () => (authorizationRequired
                ? t("shop_ui_nexus_mods_authorization_required", "Nexus Mods authorization required")
                : manual ? t("shop_ui_download_confirmation_required", "Download confirmation required") : t("shop_ui_nexus_mods_download_failed", "Nexus Mods download failed")),
            () => (authorizationRequired
                ? t("shop_ui_direct_download_needs_nexus_mods_authorization_connect_with_oauth_in_settings_then_tr", "Direct download needs Nexus Mods authorization. Connect with OAuth in Settings, then try again or continue on the official mod page.")
                : manual
                    ? t("shop_ui_nexus_mods_allows_this_download_from_its_website_but_not_through_the_direct_api_for_t", "Nexus Mods allows this download from its website, but not through the direct API for this account. Open the mod page to confirm the download, or import the archive after saving it.")
                : describeError(error, t("shop_ui_the_archive_could_not_be_downloaded_and_imported", "The archive could not be downloaded and imported."))),
            authorizationRequired || manual
                ? [
                    { text: () => (t("shop_ui_open_nexus_mods", "Open Nexus Mods")), resolveWith: 'open' },
                    ...(manual ? [{ text: () => (t("shop_ui_import_archive", "Import archive")), resolveWith: 'import' }] : []),
                    { text: () => (t("shop_ui_cancel", "Cancel")), resolveWith: 'cancel' }
                ]
                : [{ text: () => (t("shop_ui_ok", "OK")), resolveWith: 'ok' }],
            authorizationRequired || manual ? undefined : 'error'
        );
        if (choice === 'open') {
            await window.communityAPI.modSources.open({ provider: 'nexus', url: item.sourceUrl });
        } else if (choice === 'import') {
            try {
                const imported = await window.deltamodBackend.invoke('importMod', []);
                if (imported) {
                    updateModDownloadStatus({ phase: 'complete', currentItem: itemTitle });
                }
            } catch (importError) {
                await htmlAlert(
                    () => (t("shop_ui_import_failed", "Import failed")),
                    () => (importError?.message || t("shop_ui_the_downloaded_archive_could_not_be_imported", "The downloaded archive could not be imported.")),
                    [{ text: () => (t("shop_ui_ok", "OK")), resolveWith: 'ok' }],
                    'error'
                );
            }
        }
    } finally {
        unsubscribe();
        button.disabled = false;
        button.classList.remove('download-progress');
        button.style.removeProperty('--download-progress');
        if (button.textContent === '') button.innerHTML = original;
    }
}

const EXTERNAL_SOURCE_LABELS = Object.freeze({
    moddb: 'ModDB',
    nexus: 'Nexus Mods'
});

function externalSourceLabel(provider = SHOP_PROVIDER) {
    return EXTERNAL_SOURCE_LABELS[provider] || t("shop_ui_external_source", "External source");
}

function renderExternalMods(table, result) {
    table.closest('table')?.classList.remove('is-state');
    table.replaceChildren();
    const items = Array.isArray(result?.items) ? result.items : [];
    const status = document.getElementById('contentFilterStatus');
    const attribution = document.getElementById('sourceAttribution');
    const providerLabel = externalSourceLabel();
    bindText(status, () => {
        const count = SHOP_PROVIDER === 'moddb'
            ? plural('shop_moddb_count', items.length, 'Showing all {0} downloads exposed by ModDB’s recent RSS feed.')
            : plural('shop_nexus_count', items.length, 'Showing {0} Nexus mods.');
        const freshness = result?.stale
            ? t('shop_ui_showing_saved_results_because_the_live_catalogue_is_unavailable', 'Showing saved results because the live catalogue is unavailable.')
            : result?.cached ? t('shop_ui_loaded_from_the_local_catalogue_cache', 'Loaded from the local catalogue cache.') : '';
        return [count, freshness].filter(Boolean).join(' ');
    });
    const attributionLabel = document.createElement('span');
    attributionLabel.dataset.userContent = '';
    bindText(attributionLabel, () => providerText(result, 'attribution'));
    attribution.replaceChildren(attributionLabel);
    if (SHOP_PROVIDER === 'moddb' && result?.catalogUrl) {
        const browseFullCatalog = document.createElement('a');
        browseFullCatalog.href = result.catalogUrl;
        browseFullCatalog.className = 'source-catalog-link';
        bindText(browseFullCatalog, () => (t('shop_full_catalogue', 'Browse the full {0} catalogue', providerLabel)));
        browseFullCatalog.onclick = event => {
            event.preventDefault();
            return window.communityAPI.modSources.open({
                provider: SHOP_PROVIDER,
                url: result.catalogUrl
            });
        };
        attribution.append(' ', browseFullCatalog);
    }

    if (items.length === 0) {
        renderSourceState(
            table,
            () => t("shop_ui_no_mods_found", "No mods found"),
            () => SHOP_PROVIDER === 'moddb'
                ? t("shop_ui_the_rss_feed_contains_only_recent_moddb_downloads_older_entries_may_still_be_availabl", "The RSS feed contains only recent ModDB downloads. Older entries may still be available in the complete catalogue.")
                : t("shop_ui_try_another_search_or_change_the_catalogue_sort", "Try another search or change the catalogue sort."),
            SHOP_PROVIDER === 'moddb' && result?.catalogUrl ? {
                label: () => t('shop_full_catalogue', 'Browse the full {0} catalogue', providerLabel),
                run: () => window.communityAPI.modSources.open({
                    provider: SHOP_PROVIDER,
                    url: result.catalogUrl
                })
            } : null
        );
        return;
    }

    for (const item of items) {
        const itemTitle = () => providerText(item, 'title', () => t('mod', 'Mod'));
        const tr = document.createElement('tr');
        tr.dataset.canonicalIdentity = item.canonicalIdentity || `${item.provider}:${item.id}`;
        const info = document.createElement('td');
        info.style.display = 'flex';
        info.style.alignItems = 'center';
        info.style.gap = '14px';

        const image = document.createElement('img');
        image.className = 'modThumbImg';
        image.width = 130;
        image.height = 76;
        image.loading = 'lazy';
        image.alt = '';
        image.src = item.imageUrl || './img/mod-placeholder.png';
        image.onerror = () => {
            image.onerror = null;
            image.src = './img/mod-placeholder.png';
        };
        const previewImages = item.imageUrl ? [{
            urlA: item.imageUrl,
            urlB: item.imageUrl,
            urlCard220: item.imageUrl,
            urlCard530: item.imageUrl
        }] : [];
        const preview = createGalleryPreview(image, itemTitle, previewImages);

        const card = document.createElement('div');
        card.className = 'external-source-card';
        const title = document.createElement('span');
        title.className = 'modTitleSpan';
        bindText(title, itemTitle);
        title.dataset.userContent = '';
        const badge = document.createElement('span');
        badge.className = 'external-source-badge';
        bindText(badge, () => (externalSourceLabel(item.provider)));
        const featured = document.createElement('span');
        featured.className = 'external-featured-badge';
        bindText(featured, () => (t("shop_ui_featured", "Featured")));
        const meta = document.createElement('div');
        meta.className = 'modOtherInfoSpan calibri';
        const authorDate = document.createElement('span');
        authorDate.dataset.userContent = '';
        const author = () => providerText(item, 'author', () => t('shop_provider_contributor', '{0} contributor', externalSourceLabel(item.provider)));
        bindText(authorDate, () => (item.updatedAt ? `${author()} · ${formatSourceDate(item.updatedAt)}` : author()));
        meta.append(authorDate);
        if (item.provider === 'nexus') {
            const popularity = document.createElement('span');
            popularity.className = 'external-source-popularity calibri';
            bindText(popularity, () => (`${plural('shop_downloads', Number(item.downloads) || 0, '{0} downloads')} · ${plural('shop_endorsements', Number(item.endorsements) || 0, '{0} endorsements')}`));
            meta.appendChild(popularity);
        }
        const summary = document.createElement('div');
        summary.className = 'external-source-summary calibri';
        summary.dataset.userContent = '';
        bindText(summary, () => (item.summary || t("shop_ui_no_description_was_provided", "No description was provided.")));
        card.append(title, badge);
        if (item.featured) card.appendChild(featured);
        card.appendChild(meta);
        if (item.contentRating === 'adult') {
            const rating = document.createElement('span');
            rating.className = 'content-rating-chip';
            bindText(rating, () => (t("shop_ui_adult_content", "Adult content")));
            card.appendChild(rating);
        }
        card.appendChild(summary);
        info.append(preview, card);

        const actions = document.createElement('td');
        const actionGroup = document.createElement('div');
        actionGroup.className = 'external-source-actions';
        const primary = document.createElement('button');
        primary.type = 'button';
        const actionLabel = () => item.actionLabel === 'Download' ? t('download', 'Download')
            : item.actionLabel === 'Open download page' ? t('shop_open_download_page', 'Open download page')
            : t("shop_ui_open_source_page", "Open source page");
        bindText(primary, actionLabel, 'title');
        bindText(primary, () => `${actionLabel()}: ${itemTitle()}`, 'aria-label');
        primary.innerHTML = shopIcon(item.provider === 'nexus' ? 'download' : 'open');
        const canDownload = item.provider !== 'nexus'
            || window.deltamodBackend.isCommandAvailable('modSources:downloadNexus');
        primary.disabled = !canDownload;
        if (!canDownload) {
            bindText(primary, () => (t("shop_ui_direct_nexus_downloads_are_unavailable_in_this_app_build", "Direct Nexus downloads are unavailable in this app build")), 'title');
            bindText(primary, () => (t('shop_direct_unavailable_item', 'Direct Nexus download unavailable: {0}', itemTitle())), 'aria-label');
        }
        primary.onclick = () => item.provider === 'nexus'
            ? downloadNexusSource(item, primary)
            : window.communityAPI.modSources.open({ provider: item.provider, url: item.sourceUrl });

        const open = document.createElement('button');
        open.type = 'button';
        bindText(open, () => (t("shop_ui_open_source_page", "Open source page")), 'title');
        bindText(open, () => (t('shop_open_source_item', 'Open {0} on {1}', itemTitle(), externalSourceLabel(item.provider))), 'aria-label');
        open.innerHTML = shopIcon('open');
        open.onclick = () => window.communityAPI.modSources.open({
            provider: item.provider,
            url: item.sourceUrl
        });
        actionGroup.append(primary);
        if (item.provider === 'nexus') actionGroup.append(open);
        actions.appendChild(actionGroup);
        tr.append(info, actions);
        table.appendChild(tr);
    }
}

async function initializeExternalSource(table) {
    setExternalSourceControlsDisabled(true);
    const query = String(window._pageArguments?.sourceQuery || '').trim();
    const sort = document.getElementById('nexusSort')?.value || 'latest_added';
    if (query) {
        document.getElementById('searchInput').value = query;
        syncSearchClearButton();
        const searchIndicator = document.getElementById('searchInd');
        searchIndicator.style.display = 'block';
        bindText(searchIndicator, () => (t('shop_search_results', 'Currently showing results for “{0}”', query)));
    }
    renderSourceLoading(table);
    try {
        const request = {
            provider: SHOP_PROVIDER,
            gameId: SHOP_GAME_ID,
            query,
            sort
        };
        const response = await requestExternalSource(request);
        if (!response?.ok) {
            const error = localizedError(() => describeError(response?.error, t("shop_ui_the_selected_mod_catalogue_could_not_be_loaded", "The selected mod catalogue could not be loaded.")));
            if (typeof response?.error?.messageSource === 'string') error.messageSource = response.error.messageSource;
            error.code = response?.error?.code || 'MOD_SOURCE_BROWSE_FAILED';
            if (Number.isInteger(response?.error?.status)) {
                error.status = response.error.status;
            }
            copyRateLimitMetadata(error, response?.error);
            throw error;
        }
        if (isCurrentShopPage()) {
            renderExternalMods(table, response.result);
            setExternalSourceControlsDisabled(false);
        }
    } catch (error) {
        if (!isCurrentShopPage()) return;
        if (isNexusRateLimited(error)) {
            setExternalSourceControlsDisabled(true);
            renderSourceState(table, () => t("shop_ui_nexus_mods_rate_limit_reached", "Nexus Mods rate limit reached"), () => formatRateLimitMessage(error));
            scheduleNexusRateLimitRetry(table, error);
            return;
        }
        const needsNexusAuth = [
            'NEXUS_SSO_REQUIRED',
            'NEXUS_AUTH_REQUIRED',
            'NEXUS_AUTH_FAILED'
        ].includes(error?.code);
        setExternalSourceControlsDisabled(needsNexusAuth);
        renderSourceState(
            table,
            () => needsNexusAuth ? t("shop_ui_sign_in_with_nexus_mods", "Sign in with Nexus Mods") : t("shop_ui_catalogue_unavailable", "Catalogue unavailable"),
            () => needsNexusAuth
                ? t("shop_ui_connect_your_nexus_mods_account_with_oauth_in_settings_before_browsing_this_catalogue", "Connect your Nexus Mods account with OAuth in Settings before browsing this catalogue.")
                : describeError(error, t("shop_ui_the_selected_mod_catalogue_could_not_be_loaded", "The selected mod catalogue could not be loaded.")),
            needsNexusAuth ? {
                label: () => t("shop_ui_open_nexus_mods_settings", "Open Nexus Mods settings"),
                run: () => {
                    window._pageArguments = { cat: 'nexus' };
                    page('options');
                }
            } : {
                label: () => t("shop_ui_retry", "Retry"),
                run: () => initializeExternalSource(table)
            }
        );
    }
}

async function plusPage(amt) {
    if (!gameBananaInitialLoadComplete || gameBananaRetryPending || !gameBananaHasMore) return;
    if (!Number.isFinite(amt) || amt <= 0) return;
    return loadGameBananaPage(window.PAGE + amt);
}

async function loadGameBananaPage(requestedPage) {
    if (
        !isCurrentShopPage() ||
        gameBananaPageRequestActive ||
        typeof window.currentPageStack?.GB_API !== 'string' ||
        !window.currentPageStack?.table?.isConnected
    ) {
        return;
    }
    if (!Number.isFinite(window.PAGE)) window.PAGE = 1;
    const previousPage = window.PAGE;
    window.PAGE = requestedPage;
    gameBananaPageRequestActive = true;
    gameBananaRetryPending = false;
    const { table, GB_API, filter, gameID } = window.currentPageStack;
    if (firstgeneration) renderSourceLoading(table);
    table.querySelector('.shop-page-retry')?.remove();
    table.setAttribute('aria-busy', 'true');
    try {
        const loaded = await renderMods(table, GB_API, filter, gameID);
        if (!isCurrentShopPage()) return;
        if (loaded) gameBananaInitialLoadComplete = true;
        else window.PAGE = previousPage;
    } finally {
        gameBananaPageRequestActive = false;
        table.removeAttribute('aria-busy');
    }
}

(async () => {
    let table = document.getElementById('modsBody');
    const sourceSelect = document.getElementById('modSourceSelect');
    const gameSelect = document.getElementById('modGameSelect');
    try {
        const { supportedGames } = await resolveShopGame();
        if (!isCurrentShopPage()) return;
        gameSelect.replaceChildren();
        for (const game of supportedGames) {
            const option = document.createElement('option');
            option.value = game.id;
            option.innerText = game.name;
            option.dataset.userContent = '';
            gameSelect.appendChild(option);
        }
        gameSelect.value = SHOP_GAME_ID;
        gameSelect.addEventListener('change', () => {
            const selectedGame = supportedGames.find(game => game.id === gameSelect.value);
            if (!selectedGame) return;
            localStorage.setItem('modShopGameId', selectedGame.id);
            const providers = availableProvidersForGame(selectedGame);
            const provider = providers.some(item => item.id === SHOP_PROVIDER)
                ? SHOP_PROVIDER
                : providers[0]?.id || 'gamebanana';
            localStorage.setItem('modShopProvider', provider);
            window._pageArguments = { gameId: selectedGame.id, provider };
            page('gamebanana-browse');
        });

        const availableProviders = availableProvidersForGame(SHOP_GAME);
        if (!availableProviders.some(provider => provider.id === SHOP_PROVIDER)) {
            SHOP_PROVIDER = availableProviders[0]?.id || 'gamebanana';
        }
        sourceSelect.replaceChildren();
        for (const provider of availableProviders) {
            const option = document.createElement('option');
            option.value = provider.id;
            bindText(option, () => provider.id === 'moddb' ? t('shop_ui_moddb_10_recent', 'ModDB (10 recent)') : provider.name);
            sourceSelect.appendChild(option);
        }
        sourceSelect.value = SHOP_PROVIDER;
        sourceSelect.addEventListener('change', () => {
            localStorage.setItem('modShopProvider', sourceSelect.value);
            window._pageArguments = { gameId: SHOP_GAME_ID, provider: sourceSelect.value };
            page('gamebanana-browse');
        });
        localStorage.setItem('modShopProvider', SHOP_PROVIDER);

    const isGameBanana = SHOP_PROVIDER === 'gamebanana';
    if (SHOP_PROVIDER === 'moddb') {
        bindText(document.getElementById('searchInput'), () => (t("shop_ui_search_recent_moddb_downloads", "Search recent ModDB downloads…")), 'placeholder');
    }
    document.getElementById('gamebananaFilterControls').hidden = !isGameBanana;
    document.getElementById('nexusSortControls').hidden = SHOP_PROVIDER !== 'nexus';
    document.getElementById('gbPic').hidden = true;
    document.querySelector('.scrollBottomDetector').style.display = isGameBanana ? '' : 'none';

    if (!isGameBanana) {
        observer.disconnect();
        const nexusSort = document.getElementById('nexusSort');
        nexusSort.value = localStorage.getItem('nexusModSortV2') || 'trending';
        nexusSort.addEventListener('change', () => {
            localStorage.setItem('nexusModSortV2', nexusSort.value);
            initializeExternalSource(table);
        });
        window.currentPageStack = {
            ...window.currentPageStack,
            table,
            provider: SHOP_PROVIDER
        };
        await initializeExternalSource(table);
        genbtnstyles();
        return;
    }

    const gameID = currentShopGameBananaId();
    if (!gameID) throw localizedError(() => (t("shop_ui_the_selected_game_is_not_mapped_to_gamebanana", "The selected game is not mapped to GameBanana.")));
    let GB_API = 'https://gamebanana.com/apiv11/Game/' + gameID + '/Subfeed?_sSort=default&_nPage=$PAGE';
    const contentRatingFilter = document.getElementById('contentRatingFilter');
    contentRatingFilter.value = currentContentFilter();
    contentRatingFilter.addEventListener('change', () => {
        localStorage.setItem('gamebananaContentFilter', contentRatingFilter.value);
        window._pageArguments = preserveShopArguments({
            lp: '1',
            gbAPI: capi || undefined,
            gbAPIFilter: window.currentPageStack.filter,
            leSearchQuery: csearch || undefined
        });
        page('gamebanana-browse');
    });
    let filter = async function(a) {
        return a;
    };

    if (window._pageArguments && window._pageArguments.gbAPI && window._pageArguments.gbAPIFilter) {
        GB_API = window._pageArguments.gbAPI;
        filter = window._pageArguments.gbAPIFilter;
    }

    if (window._pageArguments && window._pageArguments.leSearchQuery) {
        document.getElementById('searchInput').value = window._pageArguments.leSearchQuery;
        csearch = window._pageArguments.leSearchQuery;
        syncSearchClearButton();

        let searchInd = document.getElementById('searchInd');
        searchInd.style.display = 'block';
        bindText(searchInd, () => (t('shop_search_results', 'Currently showing results for “{0}”', csearch)));
    }

    capi = GB_API;
    window._pageArguments = {}; // reset page arguments

    await gameBananaLogin();
    if (!isCurrentShopPage()) return;

    renderSourceLoading(table);

    window.currentPageStack = {
        ...window.currentPageStack,
        table,
        GB_API,
        filter,
        gameID
    };

    await loadGameBananaPage(window.PAGE);

    genbtnstyles();
    } catch (error) {
        console.error('Mod Shop initialization failed:', error);
        if (isCurrentShopPage()) {
            setExternalSourceControlsDisabled(false);
            sourceSelect.disabled = false;
            gameSelect.disabled = false;
            renderSourceState(
                table,
                () => t("shop_ui_mod_shop_could_not_be_loaded", "Mod Shop could not be loaded"),
                () => describeError(error, t("shop_ui_the_mod_shop_failed_to_initialize", "The Mod Shop failed to initialize.")),
                { label: () => t("shop_ui_retry", "Retry"), run: () => {
                    window._pageArguments = preserveShopArguments();
                    page('gamebanana-browse');
                } }
            );
        }
    }
})();

var searchel = document.getElementById('searchInput');
var autocomplete = document.querySelector('.autocomplete .results');
var clearSearchButton = document.getElementById('clearModSearchButton');
clearSearchButton.addEventListener('click', clearModSearch);
searchel.addEventListener('input', syncSearchClearButton);
searchel.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && searchel.value) {
        event.preventDefault();
        clearModSearch();
    }
});
syncSearchClearButton();
searchel.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        search();
    }
});

// Suggestions are input-driven, cancel stale requests, and use the active game.
let suggestionTimer;
let suggestionRequest;
let suggestionGame;
let suggestionSequence = 0;
let activeSuggestion = -1;
autocomplete.id = 'mod-search-suggestions';
autocomplete.setAttribute('role', 'listbox');
searchel.setAttribute('role', 'combobox');
searchel.setAttribute('aria-autocomplete', 'list');
searchel.setAttribute('aria-controls', autocomplete.id);
searchel.setAttribute('aria-expanded', 'false');
function closeSuggestions() {
    suggestionSequence++;
    clearTimeout(suggestionTimer);
    suggestionRequest?.abort();
    activeSuggestion = -1;
    autocomplete.replaceChildren();
    autocomplete.style.opacity = '0';
    autocomplete.style.pointerEvents = 'none';
    searchel.setAttribute('aria-expanded', 'false');
    searchel.removeAttribute('aria-activedescendant');
}
function scheduleSuggestions() {
    closeSuggestions();
    const query = searchel.value.trim();
    if (SHOP_PROVIDER !== 'gamebanana' || query.length < 3) return;
    const sequence = suggestionSequence;
    suggestionTimer = setTimeout(async () => {
        const request = new AbortController();
        suggestionRequest = request;
        try {
            suggestionGame ||= Promise.resolve(currentShopGameBananaId());
            const gameID = await suggestionGame;
            if (!gameID || sequence !== suggestionSequence || !isCurrentShopPage()) return;
            const response = await fetch('https://gamebanana.com/apiv12/Util/Search/Suggestions?_idGameRow='
                + encodeURIComponent(gameID) + '&_sSearchString=' + encodeURIComponent(query), { signal: request.signal });
            if (!response.ok) return;
            const results = await response.json();
            if (sequence !== suggestionSequence || !isCurrentShopPage() || document.activeElement !== searchel) return;
            if (!Array.isArray(results)) return;
            const fragment = document.createDocumentFragment();
            results.filter(item => typeof item === 'string').slice(0, 8).forEach((item, index) => {
                const result = document.createElement('div');
                result.className = 'result';
                result.id = `mod-suggestion-${index}`;
                result.setAttribute('role', 'option');
                result.setAttribute('aria-selected', 'false');
                result.textContent = item;
                result.dataset.userContent = '';
                // Keep focus in the combobox until its click is handled.
                result.addEventListener('mousedown', event => event.preventDefault());
                result.addEventListener('click', () => {
                    searchel.value = item;
                    closeSuggestions();
                    syncSearchClearButton();
                    search(item);
                });
                fragment.append(result);
            });
            autocomplete.replaceChildren(fragment);
            const open = autocomplete.childElementCount > 0;
            autocomplete.style.opacity = open ? '1' : '0';
            autocomplete.style.pointerEvents = open ? 'auto' : 'none';
            searchel.setAttribute('aria-expanded', String(open));
        } catch (_) {
            // Suggestions are optional. Full search remains available on failures.
        }
    }, 240);
}
searchel.addEventListener('input', scheduleSuggestions);
searchel.addEventListener('focus', scheduleSuggestions);
searchel.addEventListener('blur', closeSuggestions);
clearSearchButton.addEventListener('click', closeSuggestions);
searchel.addEventListener('keydown', event => {
    const options = [...autocomplete.children];
    if (event.key === 'Escape') { closeSuggestions(); return; }
    if (options.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        activeSuggestion = (activeSuggestion + (event.key === 'ArrowDown' ? 1 : options.length - 1) + options.length) % options.length;
        options.forEach((option, index) => option.setAttribute('aria-selected', String(index === activeSuggestion)));
        searchel.setAttribute('aria-activedescendant', options[activeSuggestion].id);
    }
    if (event.key === 'Enter' && activeSuggestion >= 0 && options[activeSuggestion]) {
        event.preventDefault();
        options[activeSuggestion].click();
    }
});
window._onClosePage.push(closeSuggestions);
})();
