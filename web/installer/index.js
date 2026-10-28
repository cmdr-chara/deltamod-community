// SPDX-FileCopyrightText: 2026 cmdr-chara
// SPDX-License-Identifier: EUPL-1.2

(() => {
    'use strict';

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


    const backend = window.deltamodBackend;
    const form = document.getElementById('installer-form');
    const directory = document.getElementById('install-directory');
    const installButton = document.getElementById('installer-install');
    const targetSummary = document.getElementById('installer-target');
    const progress = document.getElementById('installer-progress');
    const progressFill = document.getElementById('installer-progress-fill');
    const progressTrack = progress.querySelector('.progress-track');
    const phase = document.getElementById('installer-phase');
    const percent = document.getElementById('installer-percent');
    const detail = document.getElementById('installer-detail');
    const status = document.getElementById('installer-status');
    const actions = document.getElementById('installer-actions');
    const launchButton = document.getElementById('installer-launch');
    const doneButton = document.getElementById('installer-done');
    const version = document.getElementById('installer-version');
    const heading = document.getElementById('installer-heading');
    const lede = document.querySelector('.installer-lede');
    const footerState = document.getElementById('installer-footer-state') || { textContent: '' };

    let installedDirectory = '';
    let installing = false;

    const resolveText = value => String((typeof value === 'function' ? value() : value) ?? '');

    function setStatus(message, isError = false) {
        uiRender(status, () => resolveText(message));
        status.dataset.error = isError ? 'true' : 'false';
    }

    function setProgress(value, nextPhase = phase.textContent, nextDetail = '') {
        const clamped = Math.max(0, Math.min(1, Number(value) || 0));
        const display = Math.round(clamped * 100);
        progressFill.style.width = `${display}%`;
        progressTrack.setAttribute('aria-valuenow', String(display));
        uiRender(phase, () => resolveText(nextPhase));
        uiRender(percent, () => uiNumber(clamped, { style: 'percent', maximumFractionDigits: 0 }));
        uiRender(detail, () => resolveText(nextDetail));
        uiRender(footerState, () => resolveText(nextPhase));
    }

    function setBusy(busy) {
        installing = busy;
        directory.disabled = busy;
        installButton.disabled = busy;
        uiRender(installButton, () => busy ? uiText("Installing…") : uiText("Install"));
        document.body.dataset.installerState = busy ? 'installing' : 'idle';
    }

    function setScreenCopy(nextState) {
        if (nextState === 'installing') {
            uiRender(heading, () => uiText("Installing Deltamod Community"));
            uiRender(lede, () => uiText("Downloading and preparing the app. You can leave this window open."));
            return;
        }
        if (nextState === 'ready') {
            uiRender(heading, () => uiText("Deltamod Community is ready"));
            uiRender(lede, () => uiText("Installation completed successfully."));
            return;
        }
        uiRender(heading, () => uiText("Install Deltamod Community"));
        uiRender(lede, () => uiText("Choose a folder, then Deltamod will handle the rest."));
    }

    async function closeSetup() {
        try {
            await backend?.invoke('installerQuit', []);
        } catch {
            window.close();
        }
    }

    document.getElementById('installer-minimize').addEventListener('click', () => {
        backend?.invoke('installerMinimize', []).catch(() => {});
    });
    document.getElementById('installer-close').addEventListener('click', closeSetup);
    doneButton.addEventListener('click', closeSetup);
    directory.addEventListener('input', () => {
        directory.title = directory.value;
    });

    launchButton.addEventListener('click', async () => {
        launchButton.disabled = true;
        try {
            await backend.invoke('installerLaunch', [installedDirectory]);
            await closeSetup();
        } catch (error) {
            launchButton.disabled = false;
            setStatus(() => error?.message || uiText("Deltamod could not be launched."), true);
        }
    });

    backend?.on?.('installer-progress', payload => {
        if (!payload || typeof payload !== 'object') return;
        setProgress(payload.progress, () => {
            const labels = { connecting: 'Connecting', downloading: 'Downloading', installing: 'Installing…', verifying: 'Verifying', ready: 'Ready', working: 'Working' };
            const source = labels[String(payload.phase || '').toLowerCase()];
            return source ? uiText(source) : (payload.phase || uiText('Working'));
        }, () => payload.detail || '');
    });

    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (installing) return;
        const target = directory.value.trim();
        if (!target) {
            setStatus(() => uiText("Choose an installation folder to continue."), true);
            directory.focus();
            return;
        }
        if (!backend?.invoke) {
            setStatus(() => uiText("The standalone setup is only available inside the Deltamod shell."), true);
            return;
        }

        installedDirectory = target;
        setBusy(true);
        setScreenCopy('installing');
        form.hidden = true;
        targetSummary.hidden = false;
        uiRender(targetSummary, () => uiText("Installing to {0}", target));
        targetSummary.title = target;
        progress.hidden = false;
        actions.hidden = true;
        setStatus(() => '');
        setProgress(0.08, () => uiText("Connecting"), () => uiText("Contacting the Deltamod release server"));
        try {
            await backend.invoke('installerInstall', [target]);
            form.hidden = true;
            actions.hidden = false;
            document.body.dataset.installerState = 'ready';
            setScreenCopy('ready');
            uiRender(targetSummary, () => uiText("Installed in {0}", target));
            setStatus(() => '');
            setProgress(1, () => uiText("Ready"), () => uiText("Installation complete"));
            progress.hidden = true;
            uiRender(footerState, () => uiText("Installation complete"));
        } catch (error) {
            setBusy(false);
            document.body.dataset.installerState = 'error';
            setScreenCopy('idle');
            form.hidden = false;
            targetSummary.hidden = true;
            progress.hidden = true;
            setStatus(() => error?.message || uiText("The installation could not be completed."), true);
            uiRender(footerState, () => uiText("Setup needs attention"));
        }
    });

    (async () => {
        try {
            const info = await backend?.invoke?.('installerInfo', []);
            if (info?.defaultInstallDir) directory.value = info.defaultInstallDir;
            if (info?.defaultInstallDir) directory.title = info.defaultInstallDir;
            if (info?.version) uiRender(version, () => uiText("Version {0}", info.version));
        } catch {
            uiRender(version, () => uiText("Standalone setup"));
        }
    })();
})();
