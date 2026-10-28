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

const uiTooltip = (target, render, options = {}) => {
    const copy = document.createElement('span');
    uiRender(copy, render);
    return tippy(target, { ...options, content: copy, onShow: () => { uiRender(copy, render); } });
};

const setInterval = (handler, delay, ...args) => {
    const interval = window.setInterval(handler, delay, ...args);
    window._intervals = window._intervals || [];
    window._intervals.push(interval);
    return interval;
};
(async () => {
    try {
        const installs = await window.deltamodBackend.invoke('getInstallations', []).catch(e => {
            throw new Error(`Error fetching installations: ${e.message}`);
        });
        const index = await window.deltamodBackend.invoke('getSystemIndex', []).catch(e => {
            throw new Error(`Error fetching current installation index: ${e.message}`);
        });
        const tbody = document.querySelector('#installations-list');

        for (const i in installs) {
            const install = installs[i];

            await (async (install, i) => {
                const row = document.createElement('tr');
                row.className = 'installation-row';
                const nameCell = document.createElement('td');
                const goCell = document.createElement('td');
                const buttonsDiv = document.createElement('div');
                buttonsDiv.className = 'installation-actions';

                buttonsDiv.style.display = 'flex';
                buttonsDiv.style.gap = '10px';
                buttonsDiv.style.alignItems = 'center';
                buttonsDiv.style.justifyContent = 'center';

                goCell.style.textAlign = 'center';

                console.log(JSON.stringify(install));

                const nameContainer = document.createElement('div');
                nameContainer.className = 'installation-summary';
                nameContainer.style.display = 'flex';
                nameContainer.style.justifyContent = 'left';
                nameContainer.style.alignItems = 'center';
                nameContainer.style.gap = '8px';

                const editablespan = document.createElement('input');
                editablespan.type = 'text';
                editablespan.style.display = 'block';
                editablespan.style.margin = '0';
                editablespan.style.height = '22px';
                editablespan.style.fontSize = '16px';
                let savedName = install.name || uiText("Install #{0}", install.index + 1);
                editablespan.value = savedName;
                editablespan.maxLength = 100;
                uiRender(editablespan, () => window.Localization?.t('installation', 'Installation') || uiText("Installation"), 'aria-label');
                editablespan.addEventListener('keydown', event => {
                    if (event.key === 'Enter') { event.preventDefault(); editablespan.blur(); }
                    if (event.key === 'Escape') { editablespan.value = savedName; editablespan.blur(); }
                });
                editablespan.style.cursor = 'text';

                editablespan.onblur = async () => {
                    const nextName = editablespan.value.trim();
                    if (!nextName || nextName === savedName) { editablespan.value = savedName; return; }
                    const saved = await window.FrontendRefinements.saveControl(editablespan, () =>
                        window.deltamodBackend.invoke('setInstallationCName', [install.index.toString(), nextName]),
                        () => { editablespan.value = savedName; });
                    if (saved) { savedName = nextName; install.name = nextName; editablespan.value = nextName; }
                };

                const boldName = document.createElement('img');
                boldName.style.width = '43px';
                boldName.src = './gamesIco/' + install.pid + '.png';

                const nameText = document.createElement('div');
                nameText.className = 'installation-copy';
                nameText.appendChild(editablespan);
                nameContainer.appendChild(boldName);
                nameContainer.appendChild(nameText);

                const details = document.createElement('small');
                {
                    const gname = await window.deltamodBackend
                        .invoke('getGameInfo', [install.pid])
                        .then(g => g?.name);

                    const summary = document.createElement('span');
                    uiRender(summary, () => `${gname || uiText('Unknown game')} · ${install.steam ? 'Steam' : uiText("Manual")}`);
                    details.appendChild(summary);
                    if (!install.valid) {
                        const invalid = document.createElement('span');
                        invalid.className = 'installation-invalid';
                        uiRender(invalid, () => uiText("Needs attention: {0}", install.issues.join('; ')));
                        invalid.style.display = 'block';
                        invalid.style.color = '#ffb3a3';
                        invalid.style.marginTop = '4px';
                        details.appendChild(invalid);
                    }
                }

                details.classList.add('calibri');
                details.style.color = '#888';
                details.style.display = 'block';

                nameText.appendChild(details);

                console.log('created index row for install:', install.index);

                let goBtn = document.createElement('button');
                goBtn.style.padding = '4px';
                goBtn.style.textAlign = 'center';
                goBtn = adaptForIcons(goBtn);
                goBtn.innerHTML = icon('sync_arrow_up', '18px');

                goBtn.onclick = () => {
                    console.log('Switching to installation index:', install.index);

                    window.deltamodBackend.invoke('changeSystemIndex', [
                        install.index.toString(),
                    ]);
                };

                if (index == install.index || !install.valid) {
                    goBtn.disabled = true;
                    goBtn.style.cursor = 'not-allowed';
                    goBtn.style.opacity = '0.3';
                    goBtn.innerHTML = icon(index == install.index ? 'check_circle' : 'warning', '18px');
                }
                uiRender(goBtn, () => !install.valid
                        ? uiText("Installation needs repair")
                        : index == install.index
                        ? uiText("Current installation")
                        : uiText("Switch to this installation"), 'aria-label');

                buttonsDiv.appendChild(goBtn);

                uiTooltip(goBtn, () => !install.valid
                            ? uiText("Repair or re-import this installation before switching to it")
                            : index == install.index
                            ? uiText("Current installation")
                            : uiText("Switch to this installation"), {placement: 'top', delay: [500, 0]});

                let deleteBtn = document.createElement('button');
                deleteBtn.style.padding = '4px';
                deleteBtn.style.textAlign = 'center';
                deleteBtn = adaptForIcons(deleteBtn);
                deleteBtn.innerHTML = icon('delete', '18px');
                uiRender(deleteBtn, () => uiText("Delete installation"), 'aria-label');

                deleteBtn.onclick = async () => {
                    let resp = 'N';
                    if (!window.ctrlDown) {
                        resp = await htmlAlert(
                            uiText("Warning"),
                            uiText("Are you sure you want to delete the installation \"{0}\"? This action cannot be undone.", install.name || uiText('Install #{0}', uiNumber(install.index + 1))),
                            [
                                { text: uiText("Yes"), resolveWith: 'Y' },
                                { text: uiText("No"), resolveWith: 'N' },
                            ]
                        );
                    }
                    else {
                        resp = 'Y';
                    }

                    if (resp === 'Y') {
                        window.deltamodBackend.invoke('deleteSystemIndex', [
                            install.index.toString(),
                        ]);
                    }
                };

                buttonsDiv.appendChild(deleteBtn);

                uiTooltip(deleteBtn, () => uiText("Delete installation"), {placement: 'top', delay: [500, 0]});

                if (!install.valid) {
                    let repairBtn = document.createElement('button');
                    repairBtn.style.padding = '4px';
                    repairBtn = adaptForIcons(repairBtn);
                    repairBtn.innerHTML = icon('build', '18px');
                    uiRender(repairBtn, () => uiText("Attempt safe repair"), 'aria-label');
                    repairBtn.onclick = async () => {
                        const result = await window.deltamodBackend.invoke('repairInstallation', [
                            install.index.toString()
                        ]);
                        if (result.repaired) {
                            await htmlAlert(uiText("Repair complete"), uiText("The installation is valid again."), [
                                { text: uiText("OK"), resolveWith: 'ok' }
                            ]);
                            page('installmanager');
                        } else {
                            await htmlAlert(
                                uiText("Repair could not finish"),
                                uiText("{0}\n\nUse Re-import to select a clean game folder. Existing data was not deleted.", result.issues.join('\n')),
                                [{ text: uiText("OK"), resolveWith: 'ok' }]
                            );
                        }
                    };
                    buttonsDiv.appendChild(repairBtn);
                    uiTooltip(repairBtn, () => uiText("Attempt safe repair"), {placement: 'top', delay: [500, 0]});

                    let reimportBtn = document.createElement('button');
                    reimportBtn.style.padding = '4px';
                    reimportBtn = adaptForIcons(reimportBtn);
                    reimportBtn.innerHTML = icon('drive_folder_upload', '18px');
                    uiRender(reimportBtn, () => uiText("Re-import game files"), 'aria-label');
                    reimportBtn.onclick = async () => {
                        const result = await window.deltamodBackend.invoke('reimportInstallation', [
                            install.index.toString()
                        ]);
                        if (result?.repaired) page('installmanager');
                    };
                    buttonsDiv.appendChild(reimportBtn);
                    uiTooltip(reimportBtn, () => uiText("Re-import from a clean game folder"), {placement: 'top', delay: [500, 0]});
                }

                let shortcutBtn = document.createElement('button');
                shortcutBtn.style.padding = '4px';
                shortcutBtn.style.textAlign = 'center';
                shortcutBtn = adaptForIcons(shortcutBtn);
                shortcutBtn.innerHTML = icon('forward', '18px');
                uiRender(shortcutBtn, () => uiText("Create shortcut on desktop"), "title");
                uiRender(shortcutBtn, () => uiText("Create shortcut on desktop"), 'aria-label');
                const canCreateShortcut = window.deltamodBackend.isCommandAvailable('createInstallLink');
                shortcutBtn.disabled = !canCreateShortcut;
                if (!canCreateShortcut) {
                    uiRender(shortcutBtn, () => uiText("Desktop shortcut creation is unavailable in this app build"), "title");
                }
                shortcutBtn.onclick = async () => {
                    if (!(await window.deltamodBackend.invoke('isPackaged', []))) {
                        await htmlAlert(
                            uiText("Error"),
                            uiText("This feature is only available when Deltamod is packaged."),
                            [{ text: uiText("Ok"), resolveWith: 'ok' }]
                        );
                        return;
                    }
                    try {
                        const result = await window.deltamodBackend.invoke('createInstallLink', [
                            install.index,
                        ]);
                        if (!result?.created) throw new Error('The desktop link was not created.');
                        await htmlAlert(
                            uiText("Desktop link created"),
                            uiText("A Deltamod shortcut was added to your desktop."),
                            [{ text: uiText("OK"), resolveWith: 'ok' }]
                        );
                    } catch (error) {
                        await htmlAlert(
                            uiText("Could not create desktop link"),
                            error?.message || String(error),
                            [{ text: uiText("OK"), resolveWith: 'ok' }]
                        );
                    }
                };
                uiTooltip(shortcutBtn, () => canCreateShortcut
                        ? uiText("Create shortcut on desktop")
                        : uiText("Desktop shortcut creation is unavailable in this app build"), {placement: 'top', delay: [500, 0]});

                let openBtn = document.createElement('button');
                openBtn.style.padding = '4px';
                openBtn.style.textAlign = 'center';
                openBtn = adaptForIcons(openBtn);
                openBtn.innerHTML = icon('folder_open', '18px');
                uiRender(openBtn, () => uiText("Open installation folder"), 'aria-label');

                openBtn.onclick = () => {
                    window.deltamodBackend.invoke('openInstallationFolder', [
                        install.index.toString(),
                    ]);
                };

                uiTooltip(openBtn, () => uiText("Open installation folder"), {placement: 'top', delay: [500, 0]});

                buttonsDiv.appendChild(shortcutBtn);
                buttonsDiv.appendChild(openBtn);

                goCell.appendChild(buttonsDiv);

                nameCell.appendChild(nameContainer);

                row.appendChild(nameCell);
                row.appendChild(goCell);

                tbody.appendChild(row);
            })(install, i).catch(e => {
                throw new Error(`Error creating row for installation ${install.index}: ${e.message}`);
            });
        }

        const newRow = document.createElement('tr');
        newRow.className = 'installation-create-row';
        const newCell = document.createElement('td');

        newCell.colSpan = 2;
        newCell.style.textAlign = 'center';

        const newButton = document.createElement('button');
        newButton.style.width = '100%';
        newButton.style.cursor = 'pointer';
        newButton.style.display = 'inline-flex';
        newButton.style.alignItems = 'center';
        newButton.style.gap = '10px';
        newButton.style.justifyContent = 'center';
        newButton.style.textAlign = 'center';

        newButton.innerHTML = icon('create_new_folder', '18px');
        const createLabel = document.createElement('span');
        uiRender(createLabel, () => uiText('Create new installation'));
        newButton.appendChild(createLabel);

        newButton.onclick = () => {
            window.fromIM = true;
            page('locate');
        };

        newCell.appendChild(newButton);
        newRow.appendChild(newCell);

        tbody.appendChild(newRow);

        genbtnstyles();
    } catch (e) {
        var errorTR = document.createElement('tr');
        var errorTD = document.createElement('td');
        errorTD.colSpan = 2;
        errorTD.style.fontWeight = 'bold';

        var errortitle = document.createElement('div');
        uiRender(errortitle, () => uiText("Error loading installations"));
        errortitle.style.fontSize = '18px';
        errortitle.style.marginBottom = '10px';
        errorTD.appendChild(errortitle);

        var errorMsg = document.createElement('div');
        errorMsg.textContent = [e?.message, e?.stack].filter(Boolean).join('\n') || String(e);
        errorMsg.style.whiteSpace = 'pre-wrap';
        errorMsg.style.fontSize = '14px';
        errorTD.appendChild(errorMsg);

        errorTR.appendChild(errorTD);
        document.querySelector('#installations-list').appendChild(errorTR);
    }
})().catch(e => {
    window.alert(uiText('Unexpected error: {0}', [e?.message, e?.stack].filter(Boolean).join('\n') || String(e)));
});

elisten(document, 'keydown', e => {
    var ctrlDown = e.ctrlKey || e.metaKey;
    window.ctrlDown = ctrlDown;
});

elisten(document, 'keyup', e => {
    var ctrlDown = e.ctrlKey || e.metaKey;
    window.ctrlDown = ctrlDown;
});
})();
