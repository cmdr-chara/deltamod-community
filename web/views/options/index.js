(() => {

    // Only explicit app-owned messages enter localization; provider and user text remain literal.
    const uiHost = typeof window === 'undefined' ? globalThis : window;
    const uiText = (source, ...args) => uiHost.Localization?.text?.(source, ...args)
        ?? String(source).replace(/{(\d+)}/g, (match, index) => args[index] === undefined ? match : String(args[index]));
    const uiNumber = (value, options) => uiHost.Localization?.number?.(value, options) ?? String(value);
    const uiRender = (element, render, attribute) => {
        if (!element) return element;
        if (uiHost.Localization?.bindComputed && typeof element.setAttribute === 'function') return uiHost.Localization.bindComputed(element, render, attribute);
        if (attribute) element.setAttribute(attribute, render());
        else element.textContent = render();
        return element;
    };

const localize = (key, fallback, ...args) => (
    window.Localization?.t(key, fallback, ...args) ?? String(fallback).replace(/{(\d+)}/g, (match, index) => args[index] === undefined ? match : String(args[index]))
);
const resolveText = value => String((typeof value === 'function' ? value() : value) ?? '');
let selectSequence = 0;
const setInterval = (handler, delay, ...args) => {
    const interval = window.setInterval(handler, delay, ...args);
    window._intervals = window._intervals || [];
    window._intervals.push(interval);
    return interval;
};

function createSettingControlCell() {
    const td = document.createElement('td');
    td.className = 'setting-control-cell center';
    const control = document.createElement('div');
    control.className = 'setting-control';
    td.appendChild(control);
    return { td, control };
}

async function addCheckboxOption(name, description, flagid, requiresRestart = false, changeHandler = (e) => {}) {
    const table = document.querySelector('tbody');
    const tr = document.createElement('tr');

    const tdLabel = document.createElement('td');
    const span = document.createElement('span');
    span.className = 'setting-title';
    uiRender(span, () => resolveText(name));
    tdLabel.appendChild(span);

    tdLabel.appendChild(document.createElement('br'));

    const small = document.createElement('small');
    small.className = 'calibri';
    uiRender(small, () => resolveText(description));
    tdLabel.appendChild(small);

    if (requiresRestart) {
        const restartNote = document.createElement('small');
        restartNote.className = 'calibri';
        restartNote.style.marginTop = '7px';
        restartNote.style.display = 'block';
        restartNote.style.color = '#888';
        restartNote.style.fontSize = 'x-small';
        uiRender(restartNote, () => uiText("Requires a Deltamod Community restart to take effect."));
        tdLabel.appendChild(restartNote);
    }

    const { td: tdInput, control } = createSettingControlCell();

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'FLAG-' + flagid.toUpperCase();
    uiRender(input, () => resolveText(name), 'aria-label');
    input.checked = await window.deltamodBackend.invoke('getUniqueFlag', [flagid]);
    let savedChecked = input.checked;
    input.addEventListener('change', async (e) => {
        const nextChecked = input.checked;
        const saved = await window.FrontendRefinements.saveControl(input, () =>
            window.deltamodBackend.invoke('setUniqueFlag', [flagid, nextChecked]),
            () => { input.checked = savedChecked; });
        if (saved) {
            savedChecked = nextChecked;
            try { await changeHandler(nextChecked); }
            catch (error) { await htmlAlert(() => resolveText(name), String(error?.message || error), [{ text: () => uiText("OK"), resolveWith: 'ok' }]); }
        }
    });
    control.appendChild(input);

    tr.appendChild(tdLabel);
    tr.appendChild(tdInput);

    table.appendChild(tr);
}

function addRangeOption(name, description, {
    min = 0,
    max = 100,
    step = 1,
    value = 50,
    unit = '%',
    changeHandler = () => {}
} = {}) {
    const table = document.querySelector('tbody');
    const tr = document.createElement('tr');

    const tdLabel = document.createElement('td');
    const title = document.createElement('span');
    title.className = 'setting-title';
    uiRender(title, () => resolveText(name));
    tdLabel.appendChild(title);
    tdLabel.appendChild(document.createElement('br'));

    const help = document.createElement('small');
    help.className = 'calibri';
    uiRender(help, () => resolveText(description));
    tdLabel.appendChild(help);

    const { td: tdInput, control } = createSettingControlCell();
    tdInput.classList.add('setting-range-cell');
    control.classList.add('setting-range-control');

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.className = 'setting-range';
    input.id = 'MUSIC-VOLUME';
    uiRender(input, () => resolveText(name), 'aria-label');

    const output = document.createElement('output');
    output.className = 'setting-range-value';
    output.htmlFor = input.id;

    const updateValue = () => {
        const numericValue = Number(input.value);
        output.value = `${uiNumber(numericValue)}${unit}`;
        output.textContent = output.value;
        changeHandler(numericValue);
    };
    input.addEventListener('input', updateValue);
    uiRender(output, () => `${uiNumber(Number(input.value))}${unit}`);

    control.append(input, output);
    tr.append(tdLabel, tdInput);
    table.appendChild(tr);
    return input;
}

window.deltamodBackend.invoke('isDevMode', []).then((devmode) => {
    const devBtn = document.getElementById('b_dev');
    if (!devBtn) return;

    if (devmode) {
        // Let the category stylesheet control the button layout (flex, icon gap,
        // focus treatment) instead of overriding it with an inline display mode.
        devBtn.style.removeProperty('display');
    } else {
        devBtn.remove();
    }
});

async function addSelectOption(name, description, options, requiresRestart = false, changeHandler = (val) => {}, defaultValue = '') {
    const table = document.querySelector('tbody');
    const tr = document.createElement('tr');

    const tdLabel = document.createElement('td');
    const span = document.createElement('span');
    span.className = 'setting-title';
    uiRender(span, () => resolveText(name));
    tdLabel.appendChild(span);

    tdLabel.appendChild(document.createElement('br'));

    const small = document.createElement('small');
    small.className = 'calibri';
    uiRender(small, () => resolveText(description));
    tdLabel.appendChild(small);

    if (requiresRestart) {
        const restartNote = document.createElement('small');
        restartNote.className = 'calibri';
        restartNote.style.marginTop = '7px';
        restartNote.style.display = 'block';
        restartNote.style.color = '#888';
        restartNote.style.fontSize = 'x-small';
        uiRender(restartNote, () => uiText("Requires a Deltamod Community restart to take effect."));
        tdLabel.appendChild(restartNote);
    }

    const { td: tdInput, control } = createSettingControlCell();

    const select = document.createElement('select');
    select.id = `SELECT-OPTION-${++selectSequence}`;

    let firstValue = '';
    for (const option of options) {
        const opt = document.createElement('option');
        if (typeof option === 'object' && option !== null) {
            opt.value = option.value ?? option.id ?? option.key ?? '';
            uiRender(opt, () => resolveText(option.label ?? option.name ?? String(opt.value)));
            if (option.selected) select.value = opt.value;
        } else {
            opt.value = String(option);
            opt.textContent = String(option);
        }
        if (firstValue === '') firstValue = opt.value;
        select.appendChild(opt);
    }

    select.value = defaultValue || firstValue;
    uiRender(select, () => resolveText(name), 'aria-label');
    let savedValue = select.value;
    select.addEventListener('change', async () => {
        const nextValue = select.value;
        const saved = await window.FrontendRefinements.saveControl(select, () => changeHandler(nextValue),
            () => { select.value = savedValue; });
        if (saved) savedValue = nextValue;
    });

    control.appendChild(select);
    tr.appendChild(tdLabel);
    tr.appendChild(tdInput);
    table.appendChild(tr);
    return select;
}

async function addButton(name, description, click, buttonText, enabled = true, disabledReason = '', colour = '') {

    const table = document.querySelector('tbody');
    const tr = document.createElement('tr');

    const tdLabel = document.createElement('td');
    const span = document.createElement('span');
    span.className = 'setting-title';
    uiRender(span, () => resolveText(name));
    if (colour != '') {
        span.style.color = colour;
    }
    tdLabel.appendChild(span);

    tdLabel.appendChild(document.createElement('br'));

    const small = document.createElement('small');
    small.className = 'calibri';
    uiRender(small, () => resolveText(description));
    tdLabel.appendChild(small);

    const { td: tdInput, control } = createSettingControlCell();

    const button = document.createElement('button');
    uiRender(button, () => resolveText(buttonText));
    button.addEventListener('click', click);
    control.appendChild(button);
    if (!enabled) {
        tr.classList.add('setting-row-disabled');
        button.disabled = true;
        if (resolveText(disabledReason) !== '') {
            uiRender(small, () => '(' + resolveText(disabledReason) + ')');
            uiRender(button, () => resolveText(disabledReason), 'title');
        }
    }

    tr.appendChild(tdLabel);
    tr.appendChild(tdInput);

    table.appendChild(tr);
    return button;
}

const IS_MAC = /Macintosh|Mac OS X/.test(navigator.userAgent);
if (IS_MAC) document.getElementById('b_mac').style.display = '';

// Credits and a plain-language guide to how Mac support works.
async function addMacSupportRows() {
    await addRowHeader(() => localize('mac_credits', 'Credits'), "favorite");
    await addInfoRow(
        () => localize('mac_credit_name', 'Mac support by {0}', 'XN'),
        () => 'X: @XNXITTER',
        () => localize('mac_credit_desc', 'Made mod downloading and patching work on macOS.')
    );

    await addRowHeader(() => localize('mac_how_title', 'How Mac support works'), "laptop_mac");
    const automatic = () => localize('mac_automatic', 'Automatic');
    const rows = [
        ['mac_downloads', uiText("Downloading mods"), automatic, 'mac_downloads_desc'],
        ['mac_copy', uiText("Your game stays untouched"), (() => localize('mac_copy_value', 'Separate copy')), 'mac_copy_desc'],
        ['reference_files', uiText("Windows reference files"), (() => localize('mac_reference_value', 'Options → Installation')), 'mac_reference_desc'],
        ['mac_patch', uiText("Patch & Play"), automatic, 'mac_patch_desc'],
        ['mac_saves', uiText("Save files"), (() => localize('mac_saves_value', 'Shared')), 'mac_saves_desc'],
        ['mac_unsupported', uiText("Not supported yet"), (() => localize('mac_unsupported_value', '.csx scripts')), 'mac_unsupported_desc']
    ];
    for (const [key, fallback, value, descriptionKey] of rows) {
        await addInfoRow(() => localize(key, fallback), () => resolveText(value), () => localize(descriptionKey, ''));
    }
}

// "Chapter select, Chapters 1–3, 5" for the description; "All chapters" or a
// short list for the narrow status column.
function summarizeReferenceFiles(files) {
    const chapters = files
        .map(file => /^chapter(\d+)_windows\/data\.win$/.exec(file))
        .filter(Boolean)
        .map(match => Number(match[1]))
        .sort((a, b) => a - b);
    const ranges = [];
    for (const chapter of chapters) {
        const last = ranges[ranges.length - 1];
        if (last && chapter === last[1] + 1) last[1] = chapter;
        else ranges.push([chapter, chapter]);
    }
    const chapterText = ranges
        .map(([from, to]) => (from === to ? `${from}` : `${from}–${to}`))
        .join(', ');
    const hasSelect = files.includes('data.win');
    const chapterSelect = localize('reference_chapter_select', 'Chapter select');
    const parts = [];
    if (hasSelect) parts.push(chapterSelect);
    if (chapters.length) {
        parts.push(chapters.length === 1
            ? localize('reference_chapter', 'Chapter {0}', chapterText)
            : localize('reference_chapters', 'Chapters {0}', chapterText));
    }
    return {
        short: hasSelect && chapters.length >= 5 && ranges.length === 1 && chapters[0] === 1
            ? localize('reference_all', 'All chapters')
            : chapters.length ? localize('reference_short', 'Ch. {0}', chapterText) : chapterSelect,
        long: parts.join(', ')
    };
}

// Mods are made against the Windows data.win files. Platforms whose data file
// differs (DELTARUNE's Mac game.ios) patch a stored copy of those files instead.
async function addReferenceFileRows() {
    let status;
    try {
        status = await window.deltamodBackend.invoke('referenceFiles:status', []);
    } catch {
        return;
    }
    const files = Array.isArray(status?.files) ? status.files : [];
    if (!IS_MAC || (!status?.needed && files.length === 0)) return;

    const summary = () => summarizeReferenceFiles(files);
    const description = () => localize('reference_desc', '');
    await addRowHeader(() => localize('reference_files', 'Windows reference files'), "desktop_windows");
    await addInfoRow(
        () => localize('reference_stored', 'Stored files'),
        () => files.length ? summary().short : localize('reference_none', 'None yet'),
        () => files.length
            ? `${localize('reference_stored_list', 'Stored: {0}.', summary().long)} ${description()}`
            : description()
    );
    await addButton(
        () => files.length
            ? localize('reference_replace', 'Replace Windows reference files')
            : localize('reference_add', 'Add Windows reference files'),
        () => localize('reference_choose_desc', ''),
        async () => {
            const result = await window.deltamodBackend.invoke('referenceFiles:choose', []);
            if (result && result.ok === false) {
                await htmlAlert(
                    () => localize('reference_not_found', 'No Windows game files found'),
                    () => result.messageSource ? uiText(result.messageSource) : result.message,
                    [{ text: () => localize('allmods_ok', 'OK'), resolveWith: 'ok' }]
                );
            }
            await window.currentPageStack.cat('inst');
        },
        () => localize('reference_choose', 'Choose folder')
    );
}

async function addRowHeader(name, glyph = '') {
    const table = document.querySelector('tbody');
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 2;
    td.className = 'rowheader';
    const content = document.createElement('div');
    content.style.cssText = 'display:flex; align-items:center; gap:10px;';
    if (glyph) {
        const symbol = document.createElement('span');
        symbol.className = 'material-symbols-outlined';
        symbol.setAttribute('aria-hidden', 'true');
        symbol.textContent = glyph;
        content.appendChild(symbol);
    }
    const label = document.createElement('span');
    label.className = 'setting-title';
    uiRender(label, () => resolveText(name));
    content.appendChild(label);
    td.appendChild(content);
    tr.appendChild(td);
    table.appendChild(tr);
}

function appendPathValue(element, value) {
    const pathValue = String(value);
    const path = document.createElement('span');
    path.className = 'profile-destination-path';
    path.title = pathValue;

    for (const part of pathValue.split(/([\\/])/)) {
        if (!part) continue;
        path.appendChild(document.createTextNode(part));
        if (part === '\\' || part === '/') {
            path.appendChild(document.createElement('wbr'));
        }
    }

    element.appendChild(path);
}

async function addInfoRow(name, value, description = '', valueKind = 'text') {

    const table = document.querySelector('tbody');
    const tr = document.createElement('tr');
    const label = document.createElement('td');
    const status = document.createElement('td');
    const heading = document.createElement('span');
    heading.className = 'setting-title';
    uiRender(heading, () => resolveText(name));
    label.appendChild(heading);
    if (resolveText(description)) {
        label.appendChild(document.createElement('br'));
        const small = document.createElement('small');
        small.className = 'calibri';
        uiRender(small, () => resolveText(description));
        label.appendChild(small);
    }
    status.className = 'calibri';
    if (valueKind === 'path') {
        tr.className = 'profile-destination-row';
        appendPathValue(status, resolveText(value));
    } else {
        uiRender(status, () => resolveText(value));
    }
    tr.append(label, status);
    table.appendChild(tr);
}

function formatProfileBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return uiText("Unknown");
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${window.Localization?.number?.(value, { maximumFractionDigits: unit === 0 ? 0 : 1 }) ?? value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

async function runOfficialProfileImport(summary) {
    const operationId = crypto.randomUUID();
    const table = document.querySelector('tbody');
    const tr = document.createElement('tr');
    const label = document.createElement('td');
    const status = document.createElement('td');
    const progress = document.createElement('progress');
    const current = document.createElement('small');
    const cancel = document.createElement('button');

    uiRender(label, () => summary.previousImport ? uiText("Importing Deltamod changes") : uiText("Importing Deltamod data"));
    status.className = 'profile-import-progress';
    progress.max = Math.max(summary.totalBytes || 1, 1);
    progress.value = 0;
    current.className = 'calibri';
    uiRender(current, () => uiText("Preparing a safe copy..."));
    uiRender(cancel, () => uiText("Cancel import"));
    cancel.addEventListener('click', async () => {
        cancel.disabled = true;
        uiRender(current, () => uiText("Cancelling safely..."));
        await window.communityAPI.profile.cancel(operationId);
    });
    status.append(progress, current, cancel);
    tr.append(label, status);
    table.appendChild(tr);

    window.currentPageStack.profileImportProgress = info => {
        if (info.operationId !== operationId) return;
        progress.max = Math.max(info.total || summary.totalBytes || 1, 1);
        progress.value = Math.min(info.completed || 0, progress.max);
        const phaseLabel = () => ({
            hash: uiText("Verifying"),
            copy: uiText("Copying"),
            commit: uiText("Saving")
        }[info.phase] || uiText("Working"));
        uiRender(current, () => `${phaseLabel()}: ${info.currentItem || ''}`);
    };

    try {
        const result = await window.communityAPI.profile.import(operationId);
        progress.value = progress.max;
        uiRender(current, () => uiText("Import complete. The official profile was not changed."));
        cancel.remove();
        const choice = await htmlAlert(
            () => uiText("Deltamod data imported"),
            () => uiText('Imported installations: {0}; mods: {1}; custom themes: {2}. Restart Deltamod Community to load them.', uiNumber(result.manifest.installations), uiNumber(result.manifest.mods), uiNumber(result.manifest.themes)),
            [
                { text: () => uiText("Restart now"), resolveWith: 'restart' },
                { text: () => uiText("Restart later"), resolveWith: 'later' }
            ]
        );
        if (choice === 'restart') await window.deltamodBackend.invoke('restartCommunity', []);
    } catch (error) {
        uiRender(current, () => error.code === 'IMPORT_CANCELLED'
            ? uiText("Import cancelled. Community staging data was removed.")
            : uiText("Import failed: {0}", error.message || error));
        cancel.remove();
    }
}

var tempLock = false;
var pendingCategory = null;

window.currentPageStack.cat = async function(cat) {
    if (tempLock) {
        pendingCategory = cat;
        return;
    }
    tempLock = true;
    let tbody = document.querySelector('tbody');
    tbody.innerHTML = '';

    document.getElementById('b_gen').classList.remove('selected');
    document.getElementById('b_ui').classList.remove('selected');
    document.getElementById('b_inst').classList.remove('selected');
    document.getElementById('b_data').classList.remove('selected');
    document.getElementById('b_adv').classList.remove('selected');
    document.getElementById('b_gb').classList.remove('selected');
    document.getElementById('b_nexus').classList.remove('selected');
    document.getElementById('b_mac').classList.remove('selected');
    
    try {
        document.getElementById('b_dev').classList.remove('selected');
    }
    catch (e) {
        console.log('Dev button not found, skipping.');
    }

    if (!document.getElementById('b_' + cat)) {
        cat = 'gen';
    }
    document.getElementById('b_' + cat).classList.add('selected');
    document.querySelectorAll('[id^="b_"]').forEach(btn => {
        btn.setAttribute('aria-current', btn.id === 'b_' + cat ? 'page' : 'false');
        if (btn.id != 'b_' + cat) {
            btn.classList.add('blur');
        }
        else {
            btn.classList.remove('blur');
        }
    });
    try {
    switch (cat) {
        case 'gen':            
            await addButton(() => uiText("Open mod folder"), () => uiText("Open the folder where your mods are stored."), async () => {
                await window.deltamodBackend.invoke('openSysFolder', ['mods']);
            }, () => uiText("Open"));
            await addCheckboxOption(() => uiText("Prompt controller mode when available"), () => uiText("When enabled, you will be asked to activate Controller Mode when a compatible controller is attached. Currently only compatible with DualSense."), 'CONTROLLER');
            await addCheckboxOption(
                () => localize('community_hash_title', "Enable hash checks"),
                () => localize('community_hash_desc', "Checks mod hashes for compatibility. This may make scans slower."),
                'hashchecks',
                false
            );
            break;
        case 'ui':
            await addCheckboxOption(() => uiText("Enable music in menus"), () => uiText("Plays background music in the main menus."), 'audio', false, async (enabled) => {
                if (enabled) {
                    var a = new Audio();
                    a.src = 'audio/orch1.mp3';
                    a.playbackRate = 1.3;
                    a.play();
                    if (themeUsesIntegratedVideoAudio()) {
                        setThemeVideoAudioEnabled(true);
                    } else {
                        currentAudio = "";
                        await page(pageN);
                    }
                }
                else {
                    releaseAudioBuffer();
                    setThemeVideoAudioEnabled(false);
                }
            });
            addRangeOption(
                () => localize('community_music_volume_title', 'Music volume'),
                () => localize('community_music_volume_desc', 'Adjusts the volume of menu and theme music.'),
                {
                    value: Math.round((window.DeltamodAudioSettings?.getVolume() ?? 0.5) * 100),
                    changeHandler: value => window.DeltamodAudioSettings?.setVolume(value / 100)
                }
            );
            await addCheckboxOption(() => uiText("Enable SFX in menus"), () => uiText("Plays sound effects in the main menus."), 'sfx', false, (enabled) => {
                if (enabled) {
                    var a = new Audio();
                    a.src = 'audio/orch1.mp3';
                    a.playbackRate = 1.1;
                    a.play();
                }
            });
            await addCheckboxOption(
                () => localize('community_dynamic_music_title', "Enable dynamic music"),
                () => localize(
                    'community_dynamic_music_desc',
                    "Enables dynamic background music that changes based on the page. If unchecked, always plays the default music for your theme."
                ),
                'dynamusic',
                true
            );

            await addSelectOption(
                () => localize('community_alert_alignment', "Alert alignment"),
                () => uiText("Choose how alerts are positioned on the screen."),
                [
                    { value: "Top", label: () => uiText("Top") },
                    { value: "Center", label: () => uiText("Center") },
                    { value: "Bottom", label: () => uiText("Bottom") },
                    { value: "Separate", label: () => uiText("Separate") }
                ],
                true,
                async (val) => {
                    var oldVal = localStorage.getItem('alertAlignment');
                    localStorage.setItem('alertAlignment', val);
                    await reapplyHAStyles();
                    var response = await htmlAlert(() => uiText("Modified"), () => uiText('Alerts are aligned to {0}. Keep this setting?', uiText(val)), [{ text: () => uiText("Yes"), resolveWith: 'Y' }, { text: () => uiText('No, restore {0}', uiText(oldVal || 'Top')), resolveWith: 'N' }]);
                    if (response == 'N') {
                        localStorage.setItem('alertAlignment', oldVal);
                        await reapplyHAStyles();
                        window._pageArguments = { cat: 'ui' };
                        page('options');
                    }
                },
                localStorage.getItem('alertAlignment') || 'Top'
            );

            await addButton(() => uiText("Select a theme"), () => uiText("Opens the theme selection menu."), async () => {
                page('themesel');
            }, () => uiText("Open"));

            const seasonalModeSelect = await addSelectOption(
                () => localize('community_seasonal_title', 'Seasonal details'),
                () => localize(
                    'community_seasonal_desc',
                    'Adds calendar-based pixel details without replacing the active theme. Choose an event to preview it.'
                ),
                [
                    { value: 'auto', label: () => localize('seasonal_auto', 'Automatic') },
                    { value: 'off', label: () => localize('seasonal_off', 'Off') },
                    { value: 'womens-health', label: () => localize('seasonal_womens_health', "Women's Health") },
                    { value: 'mens-health', label: () => localize('seasonal_mens_health', "Men's Health") },
                    { value: 'easter', label: () => localize('seasonal_easter', 'Easter') },
                    { value: 'halloween', label: () => localize('seasonal_halloween', 'Halloween') },
                    { value: 'christmas', label: () => localize('seasonal_christmas', 'Christmas') },
                    { value: 'new-year', label: () => localize('seasonal_new_year', 'New Year') }
                ],
                false,
                value => window.SeasonalEvents?.setMode(value),
                window.SeasonalEvents?.getMode() || 'auto'
            );
            seasonalModeSelect.id = 'SELECT-SEASONAL-MODE';

            break;
        case 'mac':
            if (IS_MAC) await addMacSupportRows();
            break;
        case 'inst':
            var isSteam = await window.deltamodBackend.invoke('isCurrentIndexSteam', []);
            const canDisconnectSteam = window.deltamodBackend.isCommandAvailable('removeSteamIntegration');

            await addButton(() => uiText("Disconnect Steam"), () => uiText("Stops launching the current Community installation through Steam."), async () => {
                const removed = await window.deltamodBackend.invoke('removeSteamIntegration', []);
                if (removed) await window.currentPageStack.cat('inst');
            }, () => uiText("Disconnect"), isSteam && canDisconnectSteam, () => canDisconnectSteam
                ? uiText("Only available for games imported from Steam.")
                : uiText("Steam disconnection is unavailable in this app build."));

            await addButton(() => uiText("Open the Install Manager"), () => uiText("Opens the install manager menu, which allows you to delete/create installations and create shortcuts for them."), async () => {
                page('installmanager');
            }, () => uiText("Open"));

            await addReferenceFileRows();
            break;
        case 'data': {
            await addRowHeader(() => uiText("Deltamod compatibility"), "database");
            const summary = await window.communityAPI.profile.summary();
            if (!summary.exists) {
                await addInfoRow(
                    () => uiText("Official Deltamod profile"),
                    () => uiText("Not found"),
                    () => uiText("Deltamod Community uses separate storage and will not alter official Deltamod data.")
                );
                break;
            }

            await addInfoRow(() => uiText("Detected Deltamod version"), () => summary.version || uiText("Unknown"));
            await addInfoRow(() => uiText("Installations"), () => uiNumber(summary.installations || 0));
            await addInfoRow(() => uiText("Installed mods"), () => uiNumber(summary.mods || 0));
            await addInfoRow(() => uiText("Custom themes"), () => uiNumber(summary.themes || 0));
            await addInfoRow(() => uiText("Required copy space"), () => formatProfileBytes(summary.totalBytes));
            await addInfoRow(() => uiText("Available destination space"), () => formatProfileBytes(summary.availableBytes));
            await addInfoRow(() => uiText("Community destination"), () => summary.destinationRoot, () => '', 'path');

            if (summary.previousImport) {
                await addInfoRow(() => uiText("Last import"), () => window.Localization?.date?.(summary.previousImport.importedAt, { dateStyle: 'medium', timeStyle: 'short' }) ?? new Date(summary.previousImport.importedAt).toLocaleString());
            }

            await addButton(
                () => summary.previousImport ? uiText("Import changes from Deltamod") : uiText("Import from Deltamod"),
                () => uiText("Creates a validated copy in Community storage. Official Deltamod remains unchanged and usable."),
                () => runOfficialProfileImport(summary),
                () => summary.previousImport ? uiText("Import changes") : uiText("Import data"),
                summary.canImport,
                () => uiText("Not enough free space for a safe copy.")
            );
            break;
        }
        case 'adv':
            await addRowHeader(() => uiText("Please only change these settings if you know what they do."), 'warning');
            let hashButton;
            hashButton = await addButton(() => uiText("Precalculate game hashes"), () => uiText("Builds the Community-owned cache used by advanced mod checks. Game files are not modified."), async () => {
                hashButton.disabled = true;
                uiRender(hashButton, () => uiText("Scanning…"));
                window.currentPageStack.hashProgress = progress => {
                    const completed = Number(progress.completed) || 0;
                    const total = Number(progress.total) || 0;
                    uiRender(hashButton, () => total > 0
                        ? uiText("Hashing {0}/{1}", uiNumber(completed), uiNumber(total))
                        : uiText("Hashing…"));
                };
                try {
                    const result = await window.deltamodBackend.invoke('precalcGameHashes', []);
                    await htmlAlert(() => uiText("Hash cache ready"), () => uiText('Cached game files: {0}.', uiNumber(result.fileCount)), [{text: () => uiText("OK"), resolveWith:''}]);
                } catch (error) {
                    await htmlAlert(() => uiText("Hashing failed"), () => error?.messageSource ? uiText(error.messageSource) : error?.message || uiText("The game hash cache could not be built."), [{text: () => uiText("OK"), resolveWith:''}]);
                } finally {
                    delete window.currentPageStack.hashProgress;
                    hashButton.disabled = false;
                    uiRender(hashButton, () => uiText("Build cache"));
                }
            }, () => uiText("Build cache"));

            if (window.deltamodBackend.isCommandAvailable('storage:getUsage')) {
                const usage = await window.deltamodBackend.invoke('storage:getUsage', []);
                await addInfoRow(() => uiText("Provider cache"), () => formatProfileBytes(usage.cacheBytes),
                    () => uiText("Re-downloadable catalogue metadata and images."));
                await addInfoRow(() => uiText("Recovery data"), () => formatProfileBytes(usage.recoveryBytes),
                    () => uiText("Protected rollback generations; Clear cache never removes these files."));
                await addInfoRow(() => uiText("Lifecycle journals"), () => formatProfileBytes(usage.journalBytes),
                    () => uiText("Transactional records used for deterministic crash recovery."));
            }
            await addButton(
                () => uiText("Clear provider cache"),
                () => uiText("Removes only re-downloadable provider catalogue data. Recovery generations and journals are preserved."),
                async () => {
                    const result = await window.deltamodBackend.invoke('storage:clearCache', []);
                    await htmlAlert(
                        () => uiText("Cache cleared"),
                        () => uiText("Removed {0}. Recovery data was not changed.", formatProfileBytes(result.removedBytes)),
                        [{ text: () => uiText("OK"), resolveWith: '' }]
                    );
                },
                () => uiText("Clear cache"),
                window.deltamodBackend.isCommandAvailable('storage:clearCache'),
                () => uiText("Cache cleanup is unavailable in this app build.")
            );
            await addButton(
                () => uiText("Delete recovery data"),
                () => uiText("Removes only completed recovery generations that are not active, pinned, journal-referenced, among the latest three, or the sole viable recovery for an installation."),
                async () => {
                    const choice = await htmlAlert(
                        () => uiText("Delete recovery data?"),
                        () => uiText("Older removable rollback generations will be permanently deleted. Active and required recovery data will be preserved."),
                        [
                            { text: () => uiText("Delete removable data"), resolveWith: 'delete' },
                            { text: () => uiText("Cancel"), resolveWith: 'cancel' }
                        ],
                        'error'
                    );
                    if (choice !== 'delete') return;
                    const result = await window.deltamodBackend.invoke('storage:deleteRecoveryData', []);
                    await htmlAlert(
                        () => uiText("Recovery cleanup complete"),
                        () => uiText('Removed recovery generations: {0}; space freed: {1}; protected generations remaining: {2}.', uiNumber(result.removedGenerations), formatProfileBytes(result.removedBytes), uiNumber(result.protectedGenerations)),
                        [{ text: () => uiText("OK"), resolveWith: '' }]
                    );
                    window._pageArguments = { cat: 'adv' };
                    page('options');
                },
                () => uiText("Delete recovery data"),
                window.deltamodBackend.isCommandAvailable('storage:deleteRecoveryData'),
                () => uiText("Recovery cleanup is unavailable in this app build."),
                'red'
            );

            await addButton(
                () => uiText("DeltamodCLI releases"),
                () => uiText("Opens the separate DeltamodCLI project. Community does not automatically execute downloaded installer scripts."),
                async () => window.deltamodBackend.invoke('installDeltamodCLI', []),
                () => uiText("View releases"),
                window.deltamodBackend.isCommandAvailable('installDeltamodCLI'),
                () => uiText("DeltamodCLI release launching is unavailable in this app build.")
            );

            break;
        // dev isnt keyed and is always in english
        case "dev":
            await addRowHeader(() => uiText("These options are for developers only."), 'warning');
            await addButton(() => uiText("Open flag database (DEV-ONLY)"), () => uiText("Opens the database holding flags."), async () => {
                await window.deltamodBackend.invoke('openFlagDatabase', []);
            }, () => uiText("Open"), window.deltamodBackend.isCommandAvailable('openFlagDatabase'),
                () => uiText("Flag database launching is unavailable in this app build."));
            await addButton(() => uiText("Force controller mode (DEV-ONLY)"), () => uiText("Forces Controller Mode on, regardless of controller detection status"), async () => {
                await window.deltamodBackend.invoke('cmode-on', []);
            }, () => uiText("Open"), window.deltamodBackend.isCommandAvailable('cmode-on'),
                () => uiText("Controller mode is unavailable in this app build."));
            break;
        case 'gb':
            await invoke('eraseGamebananaCache', []);

            var loadtr = document.createElement('tr');
            loadtr.innerHTML = '<td colspan="2" style="text-align:center; display: flex; justify-content: center; align-items: center;"><div class="loadingBar"></div></td>';
            tbody.appendChild(loadtr);

            var tr = document.createElement('tr');
            tbody.appendChild(tr);

            var td = document.createElement('td');
            td.colSpan = 2;
            const accountLoading = document.createElement('span');
            uiRender(accountLoading, () => uiText('Loading...'));
            td.appendChild(accountLoading);

            var gamebananaUserinfo = await Promise.race([
                window.deltamodBackend.invokeOptional(
                    'getGamebananaUserinfo',
                    [],
                    { loggedIn: false }
                ),
                new Promise(resolve => setTimeout(() => resolve({ loggedIn: false }), 5000))
            ]);
            
            tbody.removeChild(loadtr);
            td.innerHTML = '';

            var flexdiv = document.createElement('div');
            flexdiv.style.display = 'flex';
            flexdiv.style.alignItems = 'center';
            flexdiv.style.gap = '10px';
            td.appendChild(flexdiv);

            var img = document.createElement('img');
            img.src = gamebananaUserinfo._sAvatarUrl || './img/mod-placeholder.png';
            img.style.width = '32px';
            img.style.height = '32px';
            img.style.border = '1px solid var(--theme-color)';
            flexdiv.appendChild(img);

            img.style.borderRadius = '5px';
            var span = document.createElement('span');
            flexdiv.appendChild(span);
            uiRender(span, () => uiText("Currently logged in as {0}", gamebananaUserinfo._sName));

            if (gamebananaUserinfo._sName == undefined) {
                uiRender(span, () => uiText("You aren't logged in to GameBanana."));
                gamebananaUserinfo = { loggedIn: false };
            }
            else {
                gamebananaUserinfo.loggedIn = true;
            }

            tr.appendChild(td);

            if (gamebananaUserinfo.loggedIn && gamebananaUserinfo._sName != undefined) {
                await addButton(() => uiText("Logout"), () => uiText("Removes your GameBanana account from Deltamod."), async () => {
                    await window.deltamodBackend.invoke('logoutGamebanana', []);
                    window._pageArguments = {cat: 'gb'};
                    page('options');
                }, () => uiText("Logout"), gamebananaUserinfo.loggedIn, () => uiText("You aren't logged in to GameBanana."), '');
            }
            else {
                await addButton(() => uiText("Login"), () => uiText("Adds a GameBanana account to Deltamod."), async () => {
                    try {
                        const loggedIn = await window.deltamodBackend.invoke('loginGamebanana', []);
                        if (loggedIn) {
                            window._pageArguments = {cat: 'gb'};
                            page('options');
                        }
                    } catch (error) {
                        await htmlAlert(
                            () => uiText("GameBanana login failed"),
                            () => error?.messageSource ? uiText(error.messageSource) : error?.message || uiText("GameBanana could not verify the signed-in account."),
                            [{ text: () => uiText("OK"), resolveWith: 'ok' }],
                            'error'
                        );
                    }
                }, () => uiText("Login"), !gamebananaUserinfo.loggedIn
                    && window.deltamodBackend.isCommandAvailable('loginGamebanana'),
                () => window.deltamodBackend.isCommandAvailable('loginGamebanana')
                    ? uiText("You are already logged in to GameBanana.")
                    : uiText("GameBanana login is unavailable in this app build."), '');
            }
            break;
        case 'nexus': {
            await addRowHeader(() => uiText("Nexus Mods"), "key");
            const status = await window.communityAPI.modSources.nexusStatus();
            if (status.connected) {
                await addInfoRow(() => uiText("Connection"), () => uiText("Connected as {0}", status.nameFallback ? uiText('Nexus Mods user') : status.name));
                await addInfoRow(() => uiText("Authentication"), () => 'Nexus Mods OAuth 2.0');
                await addInfoRow(
                    () => uiText("Download access"),
                    () => status.premium ? uiText("Premium API downloads available") : uiText("Website confirmation may be required"),
                    () => status.premium
                        ? uiText("Compatible archives can be downloaded and imported directly.")
                        : uiText("Nexus Mods restricts direct API downloads for non-premium accounts.")
                );
                await addButton(
                    () => uiText("Disconnect Nexus Mods"),
                    () => uiText("Removes the saved Nexus Mods OAuth authorization from this device."),
                    async () => {
                        await window.communityAPI.modSources.clearNexusKey();
                        window._pageArguments = { cat: 'nexus' };
                        page('options');
                    },
                    () => uiText("Disconnect")
                );
            } else {
                const registrationPending = status.code === 'NEXUS_SSO_NOT_REGISTERED'
                    || status.ssoAvailable !== true;
                const signInPending = status.ssoPending === true;
                await addInfoRow(
                    () => uiText("Connection"),
                    () => signInPending
                        ? uiText("Sign-in pending")
                        : registrationPending ? uiText("Awaiting Nexus registration") : uiText("Not connected"),
                    () => signInPending
                        ? uiText("Finish authorization in the Nexus Mods browser window, or cancel the pending sign-in below.")
                        : registrationPending
                            ? uiText("Nexus Mods must issue the OAuth client ID before Community can offer account sign-in.")
                            : (status.errorSource ? uiText(status.errorSource) : status.error || uiText("Connect a Nexus Mods account with OAuth to browse its catalogue."))
                );
                if (status.ssoAvailable === true) {
                    let signingIn = false;
                    let ssoButton;
                    const toggleSso = async () => {
                        if (signingIn) {
                            await window.communityAPI.modSources.cancelNexusSso();
                            return;
                        }
                        signingIn = true;
                        uiRender(ssoButton, () => uiText("Cancel sign-in"));
                        try {
                            await window.communityAPI.modSources.startNexusSso();
                            window._pageArguments = { cat: 'nexus' };
                            page('options');
                        } catch (error) {
                            if (error?.code !== 'NEXUS_SSO_CANCELLED') {
                                await htmlAlert(
                                    () => uiText("Nexus Mods sign-in failed"),
                                    () => error?.messageSource ? uiText(error.messageSource) : error?.message || uiText("The Nexus Mods account could not be connected."),
                                    [{ text: () => uiText("OK"), resolveWith: 'ok' }],
                                    'error'
                                );
                            }
                        } finally {
                            signingIn = false;
                            uiRender(ssoButton, () => uiText("Sign in"));
                        }
                    };
                    ssoButton = await addButton(
                        () => uiText("Sign in with Nexus Mods"),
                        () => uiText("Opens Nexus Mods in your browser and returns through Community’s fixed local callback."),
                        toggleSso,
                        () => status.ssoPending ? uiText("Cancel sign-in") : uiText("Sign in")
                    );
                    signingIn = Boolean(status.ssoPending);
                } else if (!signInPending) {
                    await addInfoRow(
                        () => 'OAuth 2.0',
                        () => uiText("Unavailable"),
                        () => uiText("This integration is waiting for the Nexus-issued OAuth client ID. No credential can be entered manually.")
                    );
                }
            }
            break;
        }
    }
    } catch (error) {
        console.error(`Unable to render options category ${cat}:`, error);
        tbody.replaceChildren();
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 2;
        uiRender(cell, () => uiText("This options category could not be loaded: {0}", String(error?.message || error)));
        row.appendChild(cell);
        tbody.appendChild(row);
    } finally {
        // as far as i know this page is the only page that needs ts
        genbtnstyles();
        rew();
        tempLock = false;
        if (pendingCategory) {
            const nextCategory = pendingCategory;
            pendingCategory = null;
            if (nextCategory !== cat) window.currentPageStack.cat(nextCategory);
        }
    }
}

if (window._pageArguments?.cat != undefined && typeof window.currentPageStack?.cat === 'function') {
    const selectedCategory = window._pageArguments.cat;
    window._pageArguments = {};
    window.currentPageStack.cat(selectedCategory);
} else {
    window.currentPageStack.cat('gen');
}
})();
