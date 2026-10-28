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

const GB_URL = 'https://gamebanana.com/apiv11/Tool/20575/ProfilePage';
const CACHE_KEY = 'deltamod-original-credits';
const FALLBACK_AVATAR = 'img/packIcon.png';

function setAvatarFallback(image) {
    image.addEventListener('error', () => {
        if (!image.src.endsWith('/img/packIcon.png')) {
            image.src = FALLBACK_AVATAR;
        }
    }, { once: true });
}

function renderContributorCredits(profile, fromCache) {
    const creditsRoot = document.querySelector('#credits');
    if (!creditsRoot) return;
    creditsRoot.replaceChildren();

    const groups = Array.isArray(profile?._aCredits) ? profile._aCredits : [];
    if (groups.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'calibri credits-state';
        uiRender(empty, () => uiText("Contributor credits are currently unavailable."));
        creditsRoot.appendChild(empty);
        return;
    }

    for (const [groupIndex, group] of groups.entries()) {
        const section = document.createElement('section');
        section.className = 'credit-group';

        const title = document.createElement('h3');
        title.id = `credit-role-${groupIndex}`;
        section.setAttribute('aria-labelledby', title.id);
        uiRender(title, () => group?._sGroupName || uiText("Contributors"));
        section.appendChild(title);

        const people = document.createElement('ul');
        people.className = 'credit-people';

        for (const credit of Array.isArray(group?._aAuthors) ? group._aAuthors : []) {
            const person = document.createElement('li');
            person.className = 'credit-person';

            const avatar = document.createElement('img');
            avatar.className = 'credits-pfp';
            avatar.src = credit?._sAvatarUrl || FALLBACK_AVATAR;
            avatar.alt = '';
            avatar.width = 36;
            avatar.height = 36;
            setAvatarFallback(avatar);

            const name = document.createElement('span');
            uiRender(name, () => credit?._sName || uiText("Unknown contributor"));

            person.append(avatar, name);
            people.appendChild(person);
        }

        section.appendChild(people);
        creditsRoot.appendChild(section);
    }

    if (fromCache) {
        const cached = document.createElement('p');
        cached.className = 'calibri credits-cache-note';
        uiRender(cached, () => uiText("Offline copy of the original project credits."));
        creditsRoot.appendChild(cached);
    }
}

async function loadContributorProfile(signal) {
    try {
        const response = await fetch(GB_URL, { signal });
        if (!response.ok) throw new Error(`GameBanana returned HTTP ${response.status}.`);
        const profile = await response.json();
        localStorage.setItem(CACHE_KEY, JSON.stringify(profile));
        return { profile, fromCache: false };
    } catch (error) {
        const cached = localStorage.getItem(CACHE_KEY) || localStorage.getItem('gbpage');
        if (!cached) throw error;
        return { profile: JSON.parse(cached), fromCache: true };
    }
}

(async () => {
    const controller = new AbortController();
    let disposed = false;
    window._onClosePage = window._onClosePage || [];
    window._onClosePage.push(() => {
        disposed = true;
        controller.abort();
    });

    const maintainerAvatar = document.querySelector('#maintainerAvatar');
    setAvatarFallback(maintainerAvatar);

    document.querySelector('#maintainerProfileButton').addEventListener('click', () => {
        window.communityAPI.app.openMaintainerProfile();
    });

    const version = await window.communityAPI.app.version();
    uiRender(document.querySelector('#version'), () => uiText("Version {0}", version));

    try {
        const result = await loadContributorProfile(controller.signal);
        if (disposed) return;
        renderContributorCredits(result.profile, result.fromCache);
    } catch (error) {
        if (disposed || error?.name === 'AbortError') return;
        console.error('Failed to load original Deltamod credits:', error);
        renderContributorCredits(null, false);
    }
})();
})();
