(() => {
const pageTable = document.getElementById('modlist');
pageTable.closest('table').setAttribute('aria-busy', 'true');
const loadArtwork = window.FrontendRefinements.artworkLoader();
const t = (key, fallback, ...args) =>
    window.Localization?.t(key, fallback, ...args)
        ?? String(fallback).replace(/\{(\d+)\}/g, (match, index) => args[index] ?? match);
const number = value => window.Localization?.number?.(value)
    ?? new Intl.NumberFormat(window.Localization?.getLocale?.()).format(value);
function bindText(element, render, attribute = 'textContent') {
    if (!element) return;
    if (window.Localization?.bindComputed) window.Localization.bindComputed(element, render, attribute);
    else if (attribute === 'textContent') element.textContent = render();
    else element.setAttribute(attribute, render());
}

const setInterval = (handler, delay, ...args) => {
    const interval = window.setInterval(handler, delay, ...args);
    window._intervals = window._intervals || [];
    window._intervals.push(interval);
    return interval;
};
function purifyDescription(desc) {
    if (desc === null || desc === undefined) return '';
    let text = String(desc);
    // Remove any HTML tags first
    text = purify(text);
    // Normalize whitespace/newlines to single spaces
    text = text.replace(/\s+/g, ' ').trim();
    // Only add some words
    const maxWords = 25;
    const words = text.split(' ').slice(0, maxWords);
    text = words.join(' ') + (words.length >= maxWords ? '...' : '');
    // If too long, truncate as last resort
    const max = 100;
    if (text.length > max) return text.substring(0, max) + '...';
    return text;
}

const launchButton = document.getElementById('par');
const vanillaButton = document.getElementById('vanilla');
launchButton.disabled = true;
if (vanillaButton) vanillaButton.disabled = true;
let listReady = false;
let launching = false;
let pageActive = true;
var noMergeMods = [];
// Native writes can outlive the visit that started them. A later Home visit
// must wait before reading its configuration or enabling launch.
const pendingWrites = window._homeConfigurationWrites || (window._homeConfigurationWrites = new Set());
const unsavedVariants = new Set();
const pageArguments = window._pageArguments;
window._onClosePage.push(() => { pageActive = false; });

function pageIsActive() {
    return pageActive && window.pageN === 'main' && pageTable.isConnected && launchButton.isConnected;
}

function hasUnsavedEnabledVariants() {
    return Array.from(unsavedVariants).some(select =>
        select.closest('.modrow')?.querySelector('.patch-toggle input')?.checked
    );
}

function syncLaunchButton() {
    if (pageIsActive()) {
        const disabled = !listReady || pendingWrites.size > 0 || hasUnsavedEnabledVariants() || launching;
        launchButton.disabled = disabled;
        if (vanillaButton) vanillaButton.disabled = disabled;
    }
}

function configurationWrite(save) {
    const write = Promise.resolve().then(save);
    pendingWrites.add(write);
    syncLaunchButton();
    return write.finally(() => {
        pendingWrites.delete(write);
        syncLaunchButton();
    });
}

function adaptForIconsA(elem) {
    elem.style.display = 'inline-flex';
    elem.style.alignItems = 'center';
    elem.style.gap = '4px';
    elem.style.justifyContent = 'left';
    return elem;
}
function purify(text) {
    return text.replace(/<[^>]*>/g, '');
}

function setIconText(element, iconName, text, size = 'small') {
    element.innerHTML = icon(iconName, size);
    const label = document.createElement('span');
    label.dataset.userContent = '';
    if (typeof text === 'function') bindText(label, text);
    else label.textContent = String(text ?? '');
    element.appendChild(label);
}

function getPredominantColor(img) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const width = canvas.width = 256;
    const height = canvas.height = 256;

    ctx.drawImage(img, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    const colorCount = {};
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const key = `${r},${g},${b}`;
        colorCount[key] = (colorCount[key] || 0) + 1;
    }

    let top = null;
    let second = null;
    for (const [key, count] of Object.entries(colorCount)) {
        if (!top || count > top.count) {
            second = top;
            top = { key, count };
        } else if (!second || count > second.count) {
            second = { key, count };
        }
    }

    const parseKey = (k) => {
        const [r, g, b] = k.split(',').map(Number);
        return { r, g, b };
    };

    const isBlackOrWhite = ({ r, g, b }, tol = 16) => {
        const isBlack = r <= tol && g <= tol && b <= tol;
        const isWhite = r >= 255 - tol && g >= 255 - tol && b >= 255 - tol;
        return isBlack || isWhite;
    };

    let dominantColor = top ? parseKey(top.key) : { r: 0, g: 0, b: 0 };
    if (top && isBlackOrWhite(dominantColor) && second) {
        dominantColor = parseKey(second.key);
    }

    return dominantColor;
}

function noHTML(elem) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = elem;
    return tempDiv.textContent || tempDiv.innerText || '';
}


async function createMod(mod, modListElement) {
    const enabledState = await window.deltamodBackend.invoke('getModState', [mod.uid]);
    if (!pageIsActive()) return null;
    let modRow = document.createElement('tr');

    modRow.className = 'modrow';

    // Column 1 (Mod)
    let modNameContainer = document.createElement('td');

    let bigAhhContainer = document.createElement('div');
    bigAhhContainer.className = 'patch-mod-layout';

    let imageContainer = document.createElement('div');
    imageContainer.className = 'patch-mod-artwork';

    tippy(imageContainer, {
        content: t('main_rightclick', 'Right click to view in library'),
        placement: 'right',
        delay: [100, 0],
        onMount(instance) {
            bindText(instance.popper.querySelector('.tippy-content'), () => t('main_rightclick', 'Right click to view in library'));
            const box = instance.popper.querySelector('.tippy-box');
            if (box) { box.classList.add('calibri'); box.style.border = '3px solid #ffffffff'; }
        }
    });

    const imeta = { path: window.deltamodBackend.assetUrl('app', 'web/img/mod-placeholder.png') };

    let img = document.createElement('img');
    img.width = 76;
    img.height = 76;
    img.src = imeta.path;
    img.classList.add('mod-image');
    bindText(img, () => t('main_mod_cover', '{0} cover', mod.name), 'alt');
    img.onerror = () => {
        img.onerror = null;
        img.src = window.deltamodBackend.assetUrl('app', 'web/img/mod-placeholder.png');
    };
    imageContainer.appendChild(img);

    imageContainer.oncontextmenu = async e => {
        htmlAlert(mod.name, () => (t('main_view_library', 'Do you wish to view this mod in the Library?')), [{text:() => (t('main_yes', 'Yes')),resolveWith:'accept'},{text:() => (t('main_no', 'No')),rejectWith:'close'}]).then(result => {
            if (result === 'accept') {
                window._pageArguments = { highlightMod: mod.uid };
                page('allmods');
            }
        }).catch(() => {});
    };


    let infoContainer = document.createElement('div');
    infoContainer.className = 'patch-mod-info';
    let titleSpan = document.createElement('span');
    titleSpan.innerText = mod.name;
    titleSpan.className = 'patch-mod-title';
    titleSpan.dataset.userContent = '';
    if (mod.new) {
        titleSpan = adaptForIconsA(titleSpan);
        titleSpan.style.marginBottom = '0px';
        setIconText(titleSpan, 'fiber_new', mod.name, '30px');
    }
    titleSpan.id = `modtitle-${mod.uid}`;
    infoContainer.appendChild(titleSpan);

    let descSpan = document.createElement('span');
    descSpan.className = 'calibri patch-mod-description';
    descSpan.dataset.userContent = '';
    descSpan.innerText = purifyDescription(mod.description);
    descSpan.id = `moddesc-${mod.uid}`;
    infoContainer.appendChild(descSpan);

    let flexContnainer = document.createElement('div');
    flexContnainer.className = 'patch-mod-meta';
    infoContainer.appendChild(flexContnainer);

    const authors = Array.isArray(mod.author) ? mod.author : mod.author ? [mod.author] : [];
    const authorText = () => {
        const names = authors.slice(0, 2).join(', ') || t('unknown', 'Unknown');
        return authors.length > 2 ? `${names} ${t('main_andmore', 'and {0} more', number(authors.length - 2))}` : names;
    };
    var fontSize = 13;
    let authorSpan = document.createElement('p');
    authorSpan = adaptForIconsA(authorSpan);
    authorSpan.style.margin = '0px';
    authorSpan.className = 'calibri';
    setIconText(authorSpan, 'attribution', authorText, fontSize + 'px');
    authorSpan.id = `modauthor-${mod.uid}`;
    flexContnainer.appendChild(authorSpan);

    let versionSpan = document.createElement('p');
    versionSpan = adaptForIconsA(versionSpan);
    versionSpan.style.margin = '0px';
    versionSpan.className = 'calibri';
    setIconText(versionSpan, 'change_history', () => mod.version || t('unknown', 'Unknown'), fontSize + 'px');
    versionSpan.id = `modsize-${mod.uid}`;
    flexContnainer.appendChild(versionSpan);

    if (!mod.mergeSupport) {
        noMergeMods.push({uid: mod.uid, name: mod.name});  

        let mergeSpan = document.createElement('p');
        mergeSpan = adaptForIconsA(mergeSpan);
        mergeSpan.className = 'calibri patch-mod-warning';
        setIconText(mergeSpan, 'warning', () => t('main_incompatiblemerge', 'This mod is incompatible with multiple mod support'), fontSize + 'px');
        mergeSpan.id = `modmerge-${mod.uid}`;
        infoContainer.appendChild(mergeSpan);
    }

    if (mod.variants != null) {
        let variantSelect = document.createElement('select');
        variantSelect.className = 'variant-select calibri patch-mod-variant';
        for (const variant of mod.variants) {
            let option = document.createElement('option');
            option.value = variant.filename;
            option.innerText = variant.name;
            if (variant.filename == null || variant.filename == undefined || variant.name == null || variant.name == undefined) {
                continue;
            }
            variantSelect.appendChild(option);
        }
        if (variantSelect.children.length != 0) {
            const values = Array.from(variantSelect.options, option => option.value);
            let savedVariant = values.includes(mod._selectedVariant) ? mod._selectedVariant : null;
            bindText(variantSelect, () => `${mod.name}: ${t('allmods_variants', '{0} variants', number(values.length))}`, 'aria-label');
            variantSelect.value = savedVariant ?? values[0];
            infoContainer.appendChild(variantSelect);
            const saveVariant = selectedVariant => configurationWrite(async () => {
                if (!pageIsActive()) return;
                const saved = await window.FrontendRefinements.saveControl(
                    variantSelect,
                    () => window.deltamodBackend.invoke('setModVariant', [selectedVariant, mod.folder]),
                    () => { variantSelect.value = savedVariant ?? ''; }
                );
                if (saved) {
                    savedVariant = selectedVariant;
                    unsavedVariants.delete(variantSelect);
                }
            });
            variantSelect.onchange = () => saveVariant(variantSelect.value);
            if (savedVariant === null) {
                unsavedVariants.add(variantSelect);
                saveVariant(variantSelect.value);
            }
        }
    }

    bigAhhContainer.appendChild(imageContainer);
    bigAhhContainer.appendChild(infoContainer);

    modNameContainer.appendChild(bigAhhContainer);

    // Column 2 (Actions)
    let enabledContainer = document.createElement('td');
    enabledContainer.className = 'modlist-enabled-column';
    {
        let toggleLabel = document.createElement('label');
        toggleLabel.className = 'patch-toggle';

        let enabled = document.createElement("input");
        enabled.type = 'checkbox';
        enabled.id = `modcheck-${mod.uid}`;
        bindText(enabled, () => t('main_enable_mod', 'Enable {0}', mod.name), 'aria-label');
        enabled.checked = enabledState;
        modRow.classList.toggle('is-enabled', enabled.checked);
        enabled.onchange = async e => {
            if (!pageIsActive()) return;
            const c = e.target;
            const isEnabled = c.checked;
            const forMod = mod.uid;

            modRow.classList.toggle('is-enabled', isEnabled);
            enabled.disabled = true;
            await configurationWrite(async () => {
                try {
                    await window.deltamodBackend.invoke("toggleModState", [forMod, isEnabled]);
                } catch (error) {
                    enabled.checked = !isEnabled;
                    modRow.classList.toggle('is-enabled', enabled.checked);
                    if (pageIsActive()) {
                        await htmlAlert(() => (t('refine_save_failed', 'Not saved. Try again.')), String(error?.message || error),
                            [{ text: () => (t('allmods_ok', 'OK')), resolveWith: 'ok' }]);
                    }
                } finally {
                    enabled.disabled = false;
                }
            });
        };

        let toggleTrack = document.createElement('span');
        toggleTrack.className = 'patch-toggle-track';
        toggleTrack.setAttribute('aria-hidden', 'true');
        toggleLabel.appendChild(enabled);
        toggleLabel.appendChild(toggleTrack);
        enabledContainer.appendChild(toggleLabel);
    }

    modRow.appendChild(modNameContainer);
    modRow.appendChild(enabledContainer);

    if (!modListElement?.isConnected) return null;
    modListElement.appendChild(modRow);
    loadArtwork(img, mod.uid);
    return modRow;
}

async function createErroringMods(errors) {
    const dialogElement = document.getElementById("error-list-dialog");
    const errorList = document.getElementById("error-list-div");

    errorList.replaceChildren();

    for (const err of errors) {
        // err { mod: string, reason: string }
        const element = document.createElement("div");
        element.className = "error-holder";

        const modId = document.createElement("span");
        bindText(modId, () => t('main_mod_id', 'Mod ID ‘{0}’', String(err.mod || '')));
        modId.style.fontSize = '20px';
        modId.style.color = '#888';

        const reasoning = document.createElement("span");
        reasoning.className = 'calibri';
        setIconText(reasoning, 'warning', err.reason, '20px');
        reasoning.style.display = 'flex';
        reasoning.style.alignItems = 'center';
        reasoning.style.gap = '8px';
        reasoning.style.justifyContent = 'left';

        var selectSpan = document.createElement('span');
        selectSpan.className = 'calibri';
        selectSpan.style.marginTop = '18px';
        selectSpan.style.display = 'block';
        bindText(selectSpan, () => t('modFail_howtoproceed', 'How do you want to proceed?'));
        

        const actionRow = document.createElement("div");
        actionRow.className = "error-buttons";
        {
            // Action Row
            const exploreBtn = document.createElement("button");
            bindText(exploreBtn, () => t('open_mod_folder', 'Open mod folder'));
            exploreBtn.onclick = () => window.deltamodBackend.invoke("openModFolder", [err.mod]);
            actionRow.appendChild(exploreBtn);

            const deleteBtn = document.createElement("button");
            bindText(deleteBtn, () => t('delete_mod', 'Delete mod'));
            deleteBtn.onclick = () => window.deltamodBackend.invoke("removeMod", [err.mod]);
            actionRow.appendChild(deleteBtn);
        }

        element.appendChild(modId);
        element.appendChild(document.createElement("br"));
        element.appendChild(reasoning);
        element.appendChild(selectSpan);
        element.appendChild(actionRow);
        errorList.appendChild(element);
    }

    dialogElement.showModal();
}

function loadInst(index) {
    window.deltamodBackend.invoke('changeSystemIndex', ["" + index])
}

(async () => {
    const errorBanner = document.getElementById("error-banner");
    const modListElement = pageTable;
    const sortWay = document.getElementById('sortWay');
    const pageRoot = pageTable.closest('.mods-page');
    errorBanner.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); errorBanner.click(); }
    });

    if (pendingWrites.size > 0) {
        await Promise.allSettled(Array.from(pendingWrites));
        if (!pageIsActive()) return;
    }
    var { modList, errors } = (await window.deltamodBackend.invoke('getModList', []));
    if (!pageIsActive()) return;

    if (pageArguments?.sortfunc && pageArguments?.sortid) {
        modList = modList.sort(pageArguments.sortfunc);
        sortWay.value = pageArguments.sortid;
    }
    else {
        // sort by name ascending by default
        modList = modList.sort((a, b) => a.name.localeCompare(b.name));
    }
    const tableTools = window.FrontendRefinements.tableTools(modListElement, {
        input: pageRoot.querySelector('#mod-search'),
        clear: pageRoot.querySelector('#clear-mod-search'),
        count: pageRoot.querySelector('#mod-search-count'),
        sort: sortWay
    });
    pageRoot.querySelector('.mod-search-toolbar').hidden = modList.length === 0;
    for (const x of modList.filter(x => !x.isIncompatible)) {
        const row = await createMod(x, modListElement);
        if (!pageIsActive()) return;
        tableTools.add(x, row);
    }
    tableTools.finish();

    if (errors.length > 0) {
        errorBanner.onclick = () => {
            rew();
            createErroringMods(errors);
        };
        bindText(errorBanner.children[0], () => t(
            'modFail_bannerTitle',
            '{0} mod(s) failed to load',
            number(errors.length)
        ));
        errorBanner.style.display = "inherit";
    } else errorBanner.style.display = "none";

    if (modList.filter(x => !x.isIncompatible).length === 0) {
        const installedModCount = await window.deltamodBackend.invoke('howManyMods', []);
        if (!pageIsActive()) return;
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 3;
        td.className = 'empty-state-cell';

        const state = document.createElement('div');
        state.className = 'empty-state';
        const stateIcon = document.createElement('img');
        stateIcon.className = 'empty-state-icon';
        stateIcon.setAttribute('aria-hidden', 'true');
        stateIcon.src = './sbar/main.png';
        stateIcon.alt = '';

        const copy = document.createElement('div');
        copy.className = 'empty-state-copy';
        const heading = document.createElement('h2');
        bindText(heading, () => t('main_empty_title', 'Your patch list is ready'));
        const description = document.createElement('p');
        bindText(description, () => t(
            'main_empty_desc',
            'Import a compatible mod package or browse the Mod Shop. Installed mods will appear here before anything touches the game files.'
        ));
        copy.append(heading, description);

        const incompatibleCount = modList.filter(x => x.isIncompatible).length;
        if (incompatibleCount > 0) {
            const detail = document.createElement('small');
            detail.className = 'empty-state-detail';
            bindText(detail, () => window.Localization?.plural
                ? window.Localization.plural('main_hidden_incompatible', incompatibleCount, '{0} incompatible mods are hidden for this installation.')
                : t(incompatibleCount === 1 ? 'main_hidden_incompatible_one' : 'main_hidden_incompatible_other', '{0} incompatible mods are hidden for this installation.', number(incompatibleCount)));
            copy.appendChild(detail);
        }

        if (installedModCount == 0) {
            const actions = document.createElement('div');
            actions.className = 'empty-state-actions';
            const shopButton = document.createElement('button');
            bindText(shopButton, () => t('browse_mod_shop', 'Browse Mod Shop'));
            shopButton.onclick = () => page('gamebanana-browse');
            actions.appendChild(shopButton);
            const importButton = document.createElement('button');
            importButton.className = 'secondary-action';
            bindText(importButton, () => t('import_mod_package', 'Import mod package'));
            importButton.onclick = () => window.deltamodBackend.invoke('importMod', []);
            actions.appendChild(importButton);
            copy.appendChild(actions);
        }

        state.append(stateIcon, copy);
        td.appendChild(state);
        tr.appendChild(td);
        modListElement.appendChild(tr);

    }

    if (window._pageArguments === pageArguments) window._pageArguments = null;

    genbtnstyles();
    pageTable.closest('table').setAttribute('aria-busy', 'false');
    listReady = true;
    syncLaunchButton();
})().catch(error => {
    if (pageIsActive()) window.FrontendRefinements.showListError(pageTable, error);
});

async function patchAndRun(vanilla = false) {
    if (!pageIsActive() || !listReady || pendingWrites.size || hasUnsavedEnabledVariants() || launching) return;
    launching = true;
    syncLaunchButton();
    try {
    var allChecks = Array.from(pageTable.querySelectorAll('input[type="checkbox"]')).filter(cb => cb.id.startsWith('modcheck-'));
    var selectedMods = vanilla ? [] : allChecks.filter(cb => cb.checked).map(cb => cb.id.replace('modcheck-', ''));

    var goOn = true;
    for (let i = 0; i < selectedMods.length; i++) {
        const modId = selectedMods[i];
        if (!goOn) break;
        if (noMergeMods.map(x => x.uid).includes(modId) && selectedMods.length > 1) {
            await htmlAlert(
                () => (t('main_incompatible_selection', 'Incompatible setting detected')),
                () => (t('main_incompatible_merge', '{0} cannot be combined with other mods. Deselect the other mods or this mod to continue.', noMergeMods.find(x => x.uid === modId).name)),
                [{ text: () => (t('allmods_ok', 'OK')), resolveWith: 'ok' }],
                'join'
            );
            goOn = false;
        }
    }
    if (!goOn || !pageIsActive()) return;

    if (selectedMods.length === 0) {
        // Empty selection uses the native patch lifecycle: reserve the launch,
        // restore tracked originals, and only then start the game. Persisted
        // mod toggles and variants remain the user's choices for their next run.
        await window.deltamodBackend.invoke('patchAndRun', [[]]);
    }
    else {
        await page('patching');
        await window.deltamodBackend.invoke('patchAndRun', [selectedMods]);
    }
    } catch (error) {
        await htmlAlert(() => (t('allmods_cant_launch', 'Could not launch the game')), String(error?.message || error),
            [{ text: () => (t('allmods_ok', 'OK')), resolveWith: 'ok' }]);
    } finally {
        launching = false;
        syncLaunchButton();
    }
}

window.currentPageStack.patchAndRun = patchAndRun;
window.currentPageStack.playVanilla = () => patchAndRun(true);
})();
