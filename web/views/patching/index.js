(() => {
const t = (key, fallback, ...args) => window.Localization?.t(key, fallback, ...args)
    ?? String(fallback).replace(/\{(\d+)\}/g, (match, index) => args[index] ?? match);
window.currentPageStack = {};
const nextButton = document.getElementById('next');
const log = document.getElementById('gpl');
const progress = document.getElementById('patch-progress');
const percentLabel = document.getElementById('patch-percent');
const phaseLabel = document.getElementById('patch-phase');
const itemLabel = document.getElementById('patch-item');
const stepLabel = document.getElementById('patch-step');
const number = (value, options) => window.Localization?.number?.(value, options)
    ?? new Intl.NumberFormat(window.Localization?.getLocale?.(), options).format(value);
function bindText(element, render, attribute = 'textContent') {
    if (!element) return;
    if (window.Localization?.bindComputed) window.Localization.bindComputed(element, render, attribute);
    else if (attribute === 'textContent') element.textContent = render();
    else element.setAttribute(attribute, render());
}
bindText(nextButton, () => t('patch_return', 'Return to mod list'), 'title');
let pending = [];
let frame = 0;
let finished = false;
let lastActivity = '';
let currentStage = { phase: 'preparing', currentItem: '' };
let currentPercent = null;
const activityLabels = new WeakMap();
const phases = {
    preparing: ['patch_phase_preparing', 'Preparing'],
    restoring: ['patch_phase_restoring', 'Restoring original game files'],
    staging: ['patch_phase_staging', 'Preparing mod files'],
    patching: ['patch_phase_patching', 'Applying verified files'],
    launching: ['patch_phase_launching', 'Starting the game'],
    complete: ['patch_phase_complete', 'Complete']
};
const MAX_LINES = 300;
const boundedLogText = value => String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, 4096);
function queueLog(message, render = null) {
    // Native/provider output stays inert; only our own structured activity labels translate.
    pending.push({ text: boundedLogText(message), render });
    if (pending.length > MAX_LINES) pending = pending.slice(-MAX_LINES);
    if (!frame) frame = requestAnimationFrame(flush);
}
function updateStage(obj) {
    if (!Object.hasOwn(phases, obj.phase)) return;
    const phase = obj.phase;
    const item = typeof obj.currentItem === 'string' ? obj.currentItem.slice(0, 4096) : '';
    currentStage = { phase, currentItem: item, total: obj.total, completed: obj.completed };
    if (itemLabel) itemLabel.textContent = item;
    const identity = `${phase}\0${item}`;
    if (identity !== lastActivity) {
        lastActivity = identity;
        const render = () => {
            const label = t(...phases[phase]);
            return item ? t('patch_activity_item', '{0}: {1}', label, item) : label;
        };
        queueLog(render(), render);
    }
}
function renderProgress() {
    bindText(phaseLabel, () => t(...phases[currentStage.phase]));
    bindText(stepLabel, () => {
        const { total, completed } = currentStage;
        return Number.isSafeInteger(total) && total > 0 && Number.isSafeInteger(completed) && completed >= 0
            ? t('patch_step_count', '{0} of {1}', number(Math.min(completed, total)), number(total)) : '';
    });
    bindText(percentLabel, () => currentPercent === null ? '' : number(currentPercent / 100, { style: 'percent', maximumFractionDigits: 0 }));
}
renderProgress();
function flush() {
    frame = 0;
    if (!log.isConnected) { pending = []; return; }
    const follow = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
    const fragment = document.createDocumentFragment();
    pending.forEach(({ text, render }) => {
        const line = document.createElement('div');
        line.dataset.userContent = '';
        line.textContent = render ? boundedLogText(render()) : text;
        if (render) activityLabels.set(line, render);
        fragment.append(line);
    });
    pending = [];
    log.append(fragment);
    while (log.childElementCount > MAX_LINES) log.firstElementChild.remove();
    if (follow) log.scrollTop = log.scrollHeight;
}
window._onClosePage ||= [];
const refreshActivityLabels = () => {
    for (const line of log.children) {
        const render = activityLabels.get(line);
        if (render) line.textContent = boundedLogText(render());
    }
};
window.addEventListener('deltamod-language-change', refreshActivityLabels);
window._onClosePage.push(() => {
    cancelAnimationFrame(frame);
    pending = [];
    window.removeEventListener('deltamod-language-change', refreshActivityLabels);
});
window.currentPageStack.gpl = function (obj) {
    if (!obj || typeof obj !== 'object' || !log.isConnected || finished) return;
    updateStage(obj);
    if (obj.log) queueLog(obj.log);
    const percent = obj.percent;
    if (typeof percent === 'number' && Number.isFinite(percent) && percent >= 0) {
        progress.value = Math.min(100, percent);
        currentPercent = progress.value;
    } else {
        progress.removeAttribute('value');
        currentPercent = null;
    }
    renderProgress();
};
window.currentPageStack.next = async function () {
    await page('main');
};
window.currentPageStack.fp = async function () {
    cancelAnimationFrame(frame);
    flush();
    finished = true;
    progress.value = 100;
    currentPercent = 100;
    currentStage = { ...currentStage, phase: 'complete', completed: currentStage.total, currentItem: '' };
    renderProgress();
    if (itemLabel) itemLabel.textContent = '';
    const heading = document.getElementById('patchingTXT');
    bindText(heading, () => t('refine_patch_complete', 'Patching complete!'));
    heading.classList.add('success');
    nextButton.style.display = 'block';
};
})();
