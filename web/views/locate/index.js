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

const setInterval = (handler, delay, ...args) => {
    const interval = window.setInterval(handler, delay, ...args);
    window._intervals = window._intervals || [];
    window._intervals.push(interval);
    return interval;
};
async function locateDelta() {
    if (window.gid == 'noid') {
        htmlAlert(uiText("Warning"),uiText("Please select a game."),[{text:uiText("Ok"),resolveWith:'ok'}]);
        return;
    }
    try {
        var path = await window.deltamodBackend.invoke('locateDelta',[window.gid]);
        if (path != null && path != "Invalid") {
            document.getElementById('dpath').value = path;
        }
        else if (path === "Invalid") {
            htmlAlert(uiText("Warning"), uiText('The selected folder is not a valid installation for {0}.', window.gidName), [{text:uiText("Ok"),resolveWith:'ok'}]);
        }
    } catch (error) {
        htmlAlert(uiText("Error"), uiText('Could not open the folder picker: {0}', String(error?.message || error)), [{text:uiText("Ok"),resolveWith:'ok'}]);
    }
}

async function id() {
    console.log(document.getElementById('dpath').value.replaceAll('\\', '/'));
    if (window.gid == 'noid') {
        htmlAlert(uiText("Warning"),uiText("Please select a game."),[{text:uiText("Ok"),resolveWith:'ok'}]);
        return;
    }
    setImportControlsDisabled(true);
    const result = await window.deltamodBackend.invoke("createNewInstallation", ["", "locate", (window.currentPageStack.pathOV ? window.currentPageStack.pathOV : document.getElementById('dpath').value).replaceAll('\\', '/'), (window.fromIM == undefined ? false : window.fromIM), window.gid, document.getElementById('copyAnyways').checked ? 'copy' : 'ncopy']);
    if (!result) setImportControlsDisabled(false);
}

async function steam() {
    if (window.gid == 'noid') {
        htmlAlert(uiText("Warning"),uiText("Please select a game."),[{text:uiText("Ok"),resolveWith:'ok'}]);
        return;
    }
    try {
        const imported = await window.deltamodBackend.invoke("createNewInstallation", ["steam", "", "", window.fromIM, window.gid, document.getElementById('copyAnyways').checked ? 'copy' : 'ncopy']);
        if (!imported) {
            const installations = await window.deltamodBackend.invoke('getInstallations', []);
            const existing = installations.find(installation => (
                installation.pid === window.gid && installation.steam === true
            ));
            if (existing?.index != null) {
                await window.deltamodBackend.invoke('changeSystemIndex', [String(existing.index)]);
                page(window.fromIM ? 'installmanager' : 'main');
                return;
            }
            htmlAlert(uiText("Warning"), uiText('Steam could not find a valid installation for {0}.', window.gidName), [{text:uiText("Ok"),resolveWith:'ok'}]);
        }
    } catch (error) {
        htmlAlert(uiText("Error"), uiText('Could not import from Steam: {0}', String(error?.message || error)), [{text:uiText("Ok"),resolveWith:'ok'}]);
    }
}

window.currentPageStack.id = id;

window.currentPageStack.back = function() {
    window.deltamodBackend.invoke('changeSystemIndex', ["0"]);
};

window.currentPageStack.locateDelta = locateDelta;

window.currentPageStack.steam = steam;

window.currentPageStack.downloadDelta = async function() {
    if (window.gid == 'noid') {
        htmlAlert(uiText("Warning"),uiText("Please select a game."),[{text:uiText("Ok"),resolveWith:'ok'}]);
        return;
    }
    var path = await window.deltamodBackend.invoke("downloadGame", [window.gid]);
    if (path) {
        document.getElementById('dpath').value = path;
    }

    document.querySelector('.copyAnyways').style.opacity = 0.5;
    document.querySelector('.copyAnyways').style.pointerEvents = 'none';
    document.querySelector('#copyAnyways').checked = true;
};

var currentGameImportOperation = null;
function formatImportBytes(value) {
    if (!Number.isFinite(value)) return `${uiNumber(0)} B`;
    const units = ['B', 'KiB', 'MiB', 'GiB'];
    let amount = value;
    let unit = 0;
    while (amount >= 1024 && unit < units.length - 1) {
        amount /= 1024;
        unit += 1;
    }
    return `${uiNumber(amount, { minimumFractionDigits: unit === 0 ? 0 : 1, maximumFractionDigits: unit === 0 ? 0 : 1 })} ${units[unit]}`;
}

function setImportControlsDisabled(disabled) {
    document.querySelectorAll('button:not(#cancelGameImport), input').forEach(element => {
        element.disabled = disabled;
    });
    if (!disabled) {
        updateImportMethods();
    }
}

let selectedImportFeatures = new Set();

function updateImportMethods() {
    ['steam', 'autodownload'].forEach(feature => {
        const button = document.getElementById('feat_' + feature);
        const available = selectedImportFeatures.has(feature);
        button.disabled = !available;
        button.style.opacity = available ? 1 : 0.4;
    });
}

var removeGameImportListener = window.preloadAPI.onGameImportProgress(progress => {
    currentGameImportOperation = progress.operationId;
    const container = document.getElementById('gameImportProgress');
    if (!container) return;
    container.hidden = false;
    uiRender(document.getElementById('gameImportPhase'), () => progress.phase === 'commit' ? uiText("Finalizing import…") : uiText("Copying game files…"));
    uiRender(document.getElementById('gameImportAmount'), () =>
        `${formatImportBytes(progress.completed)} / ${formatImportBytes(progress.total)}`);
    document.getElementById('gameImportFile').textContent = progress.currentItem || '';
    document.getElementById('gameImportBar').value =
        progress.total > 0 ? Math.min(1, progress.completed / progress.total) : 0;
});
window._onClosePage = window._onClosePage || [];
window._onClosePage.push(removeGameImportListener);

document.getElementById('cancelGameImport').onclick = async () => {
    if (!currentGameImportOperation) return;
    await window.deltamodBackend.invoke('cancelGameImport', [currentGameImportOperation]);
    uiRender(document.getElementById('gameImportPhase'), () => uiText("Cancelling…"));
};

(async() => {
    var allFeat = ['steam','autodownload'];
    allFeat.forEach(f => {
        document.getElementById('feat_' + f).disabled = true;
        document.getElementById('feat_' + f).style.opacity = 0.4;
    });
    window.gid = "noid";

    const games = await window.deltamodBackend.invoke('getAvailableGames',[]);
    const gOptions = document.querySelector('.gOptions');

    for (const game of games) {
            const option = document.createElement('button');
            option.type = 'button';
            option.classList.add('game-option');
            option.setAttribute('aria-label', game.name);
            option.setAttribute('aria-pressed', 'false');

            const img = document.createElement('img');
            img.id = game.id;
            img.classList.add('gameIco');
            img.alt = '';
            option.addEventListener('click', function() {
                window.gid = game.id;
                window.gidName = game.name;
                document.querySelectorAll('.game-option').forEach(x => {
                    x.classList.remove('selectedGameIco');
                    x.setAttribute('aria-pressed', 'false');
                });

                option.classList.add('selectedGameIco');
                option.setAttribute('aria-pressed', 'true');

                selectedImportFeatures = new Set(game.availableFeatures.map(feature => feature.feat));
                updateImportMethods();
            });
            img.src = './gamesIco/' + game.id+'.png';
            option.appendChild(img);
            gOptions.appendChild(option);

            tippy(option, {
                content: game.name
            });
    }
})();
})();
