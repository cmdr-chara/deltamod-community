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
(async() => {
    var table = document.getElementById("collections");
    var collections = await invoke('gamebanana_getCollections');
    if (collections.success === false && collections.message == 'You must be logged in to perform this action') {
        var tr = document.createElement("tr");
        var errortd = document.createElement("td");
        errortd.colSpan = 2;
        var errordiv = document.createElement("div");
        errordiv.style.display = "flex";
        errordiv.style.alignItems = "center";
        errordiv.style.gap = "0.5em";
        errordiv.innerHTML = icon('account_circle', '1.5em');
        const loginMessage = document.createElement('span');
        uiRender(loginMessage, () => uiText('You must be logged in to your GameBanana account to view collections.'));
        errordiv.appendChild(loginMessage);
        errortd.appendChild(errordiv);
        tr.appendChild(errortd);
        table.appendChild(tr);
        return;
    }
    for (const collection of collections) {
        var tr = document.createElement("tr");

        var nametd = document.createElement("td");
        nametd.innerText = collection.name;
        tr.appendChild(nametd);

        var actiontd = document.createElement("td");
        actiontd.classList.add("actions");
        
        var openInBrowser = document.createElement("button");
        openInBrowser.innerHTML = icon('open_in_new', '1em');
        uiRender(openInBrowser, () => uiText('View source'), 'aria-label');
        openInBrowser.addEventListener('click', async () => {
            window.open(`https://gamebanana.com/collections/${collection.id}`, '_blank');
        });
        actiontd.appendChild(openInBrowser);

        var trash = document.createElement("button");
        trash.innerHTML = icon('delete', '1em');
        uiRender(trash, () => uiText('Delete collection'), 'aria-label');
        trash.addEventListener('click', async () => {
            var htmlresp = await htmlAlert((uiText("Delete collection")), (uiText("Are you sure you want to delete this collection? This action is irreversible.")), [{
                text: uiText("Yes"),
                resolveWith: 'y'
            }, {
                text: uiText("No"),
                resolveWith: 'n'
            }]);
            if (htmlresp !== 'y') {
                return;
            }
            var resp = await invoke('gamebanana_deleteCollection', [collection.id]);
            if (!resp.success) {
                await htmlAlert(uiText("Error"), uiText("Failed to delete collection: {0}", JSON.stringify(resp.error)), [{
                    text: uiText("Ok"),
                    resolveWith: 'ok'
                }]);
            } else {
                page('collections');
            }
        });
        actiontd.appendChild(trash);
        tr.appendChild(actiontd);

        var backup = document.createElement("button");
        backup.innerHTML = icon('bottom_panel_open', '1em');
        uiRender(backup, () => uiText('Export'), 'aria-label');
        backup.addEventListener('click', async () => {
            window._pageArguments = {
                collectionId: collection.id
            };
            page('collection-exportchoose');
        });
        actiontd.appendChild(backup);
        tr.appendChild(actiontd);

        const download = document.createElement("button");
        download.innerHTML = icon('bottom_panel_close', '1em');
        uiRender(download, () => uiText('Restore collection'), 'aria-label');
        const canRestoreCollection = window.deltamodBackend
            .isCommandAvailable('gamebanana_downloadAllInCollection');
        download.disabled = !canRestoreCollection;
        uiRender(download, () => canRestoreCollection
            ? uiText("Restore collection")
            : uiText("Collection restore is unavailable in this app build"), "title");
        const restoreStatus = document.createElement("span");
        restoreStatus.className = "collection-restore-status";
        uiRender(restoreStatus, () => canRestoreCollection ? uiText("Ready") : uiText("Unavailable"));
        actiontd.appendChild(restoreStatus);
        download.addEventListener('click', async () => {
            if (!canRestoreCollection) return;
            download.disabled = true;
            uiRender(restoreStatus, () => uiText("Preparing…"));
            const stopProgress = window.deltamodBackend.on('collection-restore-progress', progress => {
                if (String(progress?.collectionId) !== String(collection.id)) return;
                const total = Number(progress.total || 0);
                const completed = Number(progress.completed || 0);
                const phaseLabels = { resolving: 'Preparing…', downloading: 'Downloading', 'item-complete': 'Complete', complete: 'Complete' };
                uiRender(restoreStatus, () => {
                    const phase = phaseLabels[progress.phase] ? uiText(phaseLabels[progress.phase]) : String(progress.phase || uiText('Working'));
                    return total > 0 ? uiText('{0} · {1}/{2}', phase, uiNumber(Math.min(completed, total)), uiNumber(total)) : phase;
                });
            });
            try {
                var resp = await invoke('gamebanana_downloadAllInCollection', [collection.id]);
                const imported = Number(resp?.imported || 0);
                const skipped = Number(resp?.skipped || resp?.skippedMods?.length || 0);
                uiRender(restoreStatus, () => uiText('Restored: {0}; skipped: {1}', uiNumber(imported), uiNumber(skipped)));
                await htmlAlert(uiText("Collection restored"), uiText("Restored {0} mods. Skipped {1} items that were unavailable or declined.", uiNumber(imported), uiNumber(skipped)), [{
                    text: uiText("Ok"),
                    resolveWith: 'ok'
                }]);
            } catch (error) {
                uiRender(restoreStatus, () => uiText("Restore failed"));
                await htmlAlert(uiText("Collection restore failed"), String(error?.message || error), [{
                    text: uiText("Ok"),
                    resolveWith: 'ok'
                }]);
            } finally {
                stopProgress();
                download.disabled = false;
            }
        });
        actiontd.appendChild(download);
        tr.appendChild(actiontd);


        table.appendChild(tr);
    }

    var addTr = document.createElement("tr");

    var nameInputTd = document.createElement("td");
    var nameInput = document.createElement("input");
    nameInput.type = "text";
    uiRender(nameInput, () => uiText("New collection name"), "placeholder");
    uiRender(nameInput, () => uiText('New collection name'), 'aria-label');
    nameInputTd.appendChild(nameInput);
    nameInput.classList.add("collection-name-input");
    addTr.appendChild(nameInputTd);

    var addActionTd = document.createElement("td");
    addActionTd.classList.add("actions");
    var addButton = document.createElement("button");
    addButton.innerHTML = icon('add', '1em');
    uiRender(addButton, () => uiText('Create collection'), 'aria-label');
    addButton.addEventListener('click', async () => {
        var name = nameInput.value.trim();
        if (name.length > 0) {
            var newCollection = await invoke('gamebanana_createCollection', [name]);
            page('collections');
        }
    });
    addActionTd.appendChild(addButton);
    addTr.appendChild(addActionTd);

    table.appendChild(addTr);
})();
})();
