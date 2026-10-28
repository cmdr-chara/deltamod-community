(() => {
const t = (key, fallback, ...args) => window.Localization?.t(key, fallback, ...args)
    ?? String(fallback).replace(/\{(\d+)\}/g, (match, index) => args[index] ?? match);
const number = (value) => window.Localization?.number?.(value)
    ?? new Intl.NumberFormat(window.Localization?.getLocale?.()).format(value);
function bindText(element, render, attribute = 'textContent') {
    if (!element) return;
    if (window.Localization?.bindComputed) window.Localization.bindComputed(element, render, attribute);
    else if (attribute === 'textContent') element.textContent = render();
    else element.setAttribute(attribute, render());
}
const args = window._pageArguments || {};
const gbModID = Number(args.id);
const gbModel = args.model;
const commentPage = Math.max(1, Math.min(10000, Number.parseInt(args.commentPage, 10) || 1));
const returnArguments = args.returnArguments || {};
const PAGE_SIZE = 30;
const MAX_REPLY_DEPTH = 4;
// Reserve the full 30-comment page even when an early thread has many replies.
const MAX_REPLY_NODES = 120;
const MAX_REPLY_REQUESTS = 20;
const visited = new Set();
let renderedReplies = 0;
let replyRequests = 0;
let isSendingComment = false;
let pageActive = true;
const controller = new AbortController();
window._pageArguments = {};
window._onClosePage ||= [];
window._onClosePage.push(() => { pageActive = false; controller.abort(); });
const active = () => pageActive && document.getElementById('commentRecords')?.isConnected;

// Some Posts responses contain a PHP warning before their JSON body.
async function readGameBananaJson(response) {
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        const start = text.search(/^[[{]/m);
        if (start < 0) throw new Error(t('gb_response_unreadable', 'GameBanana returned an unreadable response.'));
        return JSON.parse(text.slice(start));
    }
}

function commentErrorMessage(error) {
    const message = typeof error?.localizedMessage === 'function' ? error.localizedMessage()
        : typeof error === 'string' ? error : error?.message;
    return String(message || t('gb_comment_failed', 'GameBanana could not post the comment. Please retry.'))
        .replace(/^Error invoking remote method '[^']+': Error:\s*/i, '');
}

function validTarget() {
    return Number.isSafeInteger(gbModID) && gbModID > 0 && ['Mod', 'Wip'].includes(gbModel);
}

function safeGameBananaUrl(value, image = false) {
    try {
        const url = new URL(value);
        const hosts = image ? ['gamebanana.com', 'images.gamebanana.com'] : ['gamebanana.com'];
        return url.protocol === 'https:' && hosts.includes(url.hostname)
            && !url.username && !url.password && !url.port ? url.href : '';
    } catch { return ''; }
}

function commentPlainText(value) {
    const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return String(value ?? '').slice(0, 100000)
        .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:p|div)>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity) => {
            if (entity[0] !== '#') return entities[entity.toLowerCase()] || whole;
            const hex = entity[1].toLowerCase() === 'x';
            const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
            return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
                ? String.fromCodePoint(point) : whole;
        });
}

function commentTime(seconds, key, fallback) {
    const millis = Number(seconds) * 1000;
    if (!Number.isFinite(millis) || millis <= 0 || !Number.isFinite(new Date(millis).valueOf())) return null;
    const node = document.createElement('time');
    node.dateTime = new Date(millis).toISOString();
    bindText(node, () => window.Localization?.date?.(millis, { dateStyle: 'long', timeStyle: 'short' })
        ?? new Intl.DateTimeFormat(window.Localization?.getLocale?.(), { dateStyle: 'long', timeStyle: 'short' }).format(millis), 'title');
    bindText(node, () => t(key, fallback, window.Localization?.relativeTime?.(millis) ?? node.title));
    return node;
}

async function fetchComments(model, id, pageNumber = 1, perPage = PAGE_SIZE) {
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
        const response = await fetch(`https://gamebanana.com/apiv11/${model}/${id}/Posts?_nPage=${pageNumber}&_nPerpage=${perPage}&_sSort=popular`, { signal: controller.signal });
        if (!response.ok) throw new Error(t('gb_response_http', 'GameBanana returned HTTP {0}.', response.status));
        const payload = await readGameBananaJson(response);
        if (!Array.isArray(payload?._aRecords)) throw new Error(t('gb_response_unreadable', 'GameBanana returned an unreadable response.'));
        return payload;
    } finally { clearTimeout(timeout); }
}

async function send() {
    if (isSendingComment || !active() || !validTarget()) return;
    const textarea = document.getElementById('comment');
    const sendButton = document.getElementById('sendBtn');
    const comment = textarea.value.trim();
    if (!comment) {
        await htmlAlert(() => (t('gb_comment_not_sent', 'Comment not sent')), () => (t('gb_comment_required', 'Enter a comment before sending.')),
            [{ text: () => (t('allmods_ok', 'OK')), resolveWith: 'ok' }], 'error');
        textarea.focus();
        return;
    }
    isSendingComment = true;
    sendButton.disabled = true;
    sendButton.setAttribute('aria-busy', 'true');
    bindText(sendButton, () => isSendingComment ? t('gb_sending_comment', 'Sending…') : t('gb_send_comment', 'Send comment'));
    try {
        const posted = await window.deltamodBackend.invoke('leaveCommentGamebanana', [gbModID, comment, gbModel]);
        if (posted !== true) {
            const message = () => t('gb_comment_unconfirmed', 'GameBanana did not confirm that the comment was posted.');
            throw Object.assign(new Error(message()), { localizedMessage: message });
        }
        if (!active()) return;
        textarea.value = '';
        await htmlAlert(() => (t('gb_comment_posted', 'Comment posted')), () => (t('gb_comment_success', 'Your comment was posted successfully.')),
            [{ text: () => (t('gb_view_comments', 'View comments')), resolveWith: 'ok' }], 'check_circle');
        if (active()) navigateComments(1);
    } catch (error) {
        if (!active()) return;
        await htmlAlert(() => (t('gb_comment_not_sent', 'Comment not sent')), () => (commentErrorMessage(error)),
            [{ text: () => (t('refine_retry', 'Retry')), resolveWith: 'retry' }], 'error');
        textarea.focus();
    } finally {
        isSendingComment = false;
        if (sendButton.isConnected) {
            sendButton.disabled = false;
            sendButton.removeAttribute('aria-busy');
            bindText(sendButton, () => t('gb_send_comment', 'Send comment'));
        }
    }
}

function moreReplies(comment, div) {
    const id = Number(comment?._idRow);
    if (!Number.isSafeInteger(id) || id <= 0) return;
    const link = document.createElement('a');
    link.className = 'comment-more-replies';
    link.href = `https://gamebanana.com/posts/${id}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    bindText(link, () => t('gb_more_replies', 'Read more replies on GameBanana'));
    div.append(link);
}

async function crawlComment(comment, div, depth = 0) {
    if (!active() || !comment || typeof comment !== 'object' || (depth > 0 && renderedReplies >= MAX_REPLY_NODES)) return;
    const id = Number(comment._idRow);
    const key = Number.isSafeInteger(id) && id > 0 ? id : null;
    if (key !== null && visited.has(key)) return;
    if (key !== null) visited.add(key);
    if (depth > 0) renderedReplies++;
    const commentDiv = document.createElement('article');
    commentDiv.className = 'commentBox';
    commentDiv.style.setProperty('--reply-depth', String(Math.min(depth, MAX_REPLY_DEPTH)));
    if (depth > 0) commentDiv.classList.add('comment-reply');
    const img = document.createElement('img');
    img.src = safeGameBananaUrl(comment._aPoster?._sAvatarUrl, true) || './img/mod-placeholder.png';
    img.alt = '';
    img.loading = 'lazy';
    img.width = 50;
    img.height = 50;
    img.onerror = () => { img.onerror = null; img.src = './img/mod-placeholder.png'; };
    const contentDiv = document.createElement('div');
    contentDiv.className = 'commentArea';
    const header = document.createElement('header');
    header.className = 'comment-metadata';
    const authorUrl = safeGameBananaUrl(comment._aPoster?._sProfileUrl);
    const author = document.createElement(authorUrl ? 'a' : 'span');
    author.className = 'comment-author';
    author.dir = 'auto';
    author.dataset.userContent = '';
    bindText(author, () => String(comment._aPoster?._sName || t('gb_unknown_author', 'Unknown author')).slice(0, 256));
    if (authorUrl) { author.href = authorUrl; author.target = '_blank'; author.rel = 'noopener noreferrer'; }
    header.append(author);
    const posted = commentTime(comment._tsDateAdded, 'gb_posted_time', 'Posted {0}');
    if (posted) header.append(posted);
    if (Number(comment._tsDateModified) > Number(comment._tsDateAdded || 0)) {
        const edited = commentTime(comment._tsDateModified, 'gb_comment_edited', 'Edited {0}');
        if (edited) header.append(edited);
    }
    const body = document.createElement('div');
    body.className = 'comment-text';
    body.dir = 'auto';
    body.dataset.userContent = '';
    body.textContent = commentPlainText(comment._sText);
    contentDiv.append(header, body);
    const stampsDiv = document.createElement('div');
    stampsDiv.className = 'stampsArea';
    for (const stampObj of (Array.isArray(comment._aStamps) ? comment._aStamps : []).slice(0, 30)) {
        const count = Number(stampObj?._nCount);
        if (!Number.isSafeInteger(count) || count < 0 || typeof stampObj?._sTitle !== 'string') continue;
        const stamp = document.createElement('span');
        stamp.className = 'stamp';
        bindText(stamp, () => t('gb_stamp_count', '{0} × {1}', stampObj._sTitle.slice(0, 100), number(count)));
        stampsDiv.append(stamp);
    }
    if (stampsDiv.childElementCount) contentDiv.append(stampsDiv);
    commentDiv.append(img, contentDiv);
    div.append(commentDiv);
    if (!(Number(comment._nReplyCount) > 0) || key === null) return;
    if (depth >= MAX_REPLY_DEPTH || renderedReplies >= MAX_REPLY_NODES || replyRequests >= MAX_REPLY_REQUESTS) {
        moreReplies(comment, contentDiv);
        return;
    }
    try {
        replyRequests++;
        const replies = await fetchComments('Post', id, 1, 20);
        if (!active()) return;
        for (const reply of replies._aRecords.slice(0, 20)) await crawlComment(reply, div, depth + 1);
        if (Number(comment._nReplyCount) > replies._aRecords.length || renderedReplies >= MAX_REPLY_NODES) moreReplies(comment, contentDiv);
    } catch {
        if (!active()) return;
        const note = document.createElement('p');
        note.className = 'comment-load-note';
        bindText(note, () => t('gb_reply_load_failed', 'Some replies could not be loaded.'));
        contentDiv.append(note);
        moreReplies(comment, contentDiv);
    }
}

function navigateComments(pageNumber) {
    window._pageArguments = { id: gbModID, model: gbModel, commentPage: pageNumber, returnArguments };
    return page('gamebanana-leave-comment');
}
window.currentPageStack.send = send;
window.currentPageStack.previousComments = () => navigateComments(Math.max(1, commentPage - 1));
window.currentPageStack.nextComments = () => navigateComments(commentPage + 1);
window.currentPageStack.backToShop = () => { window._pageArguments = returnArguments; return page('gamebanana-browse'); };
window.currentPageStack.retryComments = () => navigateComments(commentPage);

(async () => {
    const status = document.getElementById('commentsStatus');
    bindText(status, () => t('gb_comments_loading', 'Loading comments…'));
    if (!validTarget()) { bindText(status, () => t('gb_comment_target_invalid', 'This GameBanana submission could not be identified. Return to the Mod Shop and open its comments again.')); return; }
    bindText(document.getElementById('commentsPage'), () => t('gb_comment_page', 'Page {0}', number(commentPage)));
    document.getElementById('previousComments').hidden = commentPage <= 1;
    try {
        const gbPic = await Promise.race([
            window.deltamodBackend.invokeOptional('getGamebananaPic', [], null),
            new Promise(resolve => setTimeout(() => resolve(null), 5000))
        ]);
        if (!active()) return;
        document.getElementById('gbPic').src = safeGameBananaUrl(gbPic, true) || './img/mod-placeholder.png';
        document.getElementById('myCommentBox').hidden = !gbPic;
        document.getElementById('commentLoginHint').hidden = Boolean(gbPic);
    } catch { /* Public comments remain available when account status is offline. */ }
    try {
        const payload = await fetchComments(gbModel, gbModID, commentPage);
        if (!active()) return;
        const records = payload._aRecords.slice(0, PAGE_SIZE);
        for (const comment of records) await crawlComment(comment, document.getElementById('commentRecords'));
        if (!active()) return;
        bindText(status, () => records.length ? '' : t('gb_comments_empty', 'No comments yet.'));
        document.getElementById('nextComments').hidden = payload._aMetadata?._bIsComplete === true || records.length < PAGE_SIZE;
    } catch {
        if (!active()) return;
        bindText(status, () => t('gb_comment_load_failed', 'Comments could not be loaded. Please try again.'));
        document.getElementById('retryComments').hidden = false;
    }
})();
})();
