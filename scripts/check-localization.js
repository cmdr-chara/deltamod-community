// SPDX-FileCopyrightText: 2026 cmdr-chara
// SPDX-License-Identifier: EUPL-1.2
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const LANGUAGES = Object.freeze(['en', 'it', 'pl', 'es', 'fr', 'de', 'pt-br', 'ja',
    'ru', 'zh-CN', 'zh-TW', 'ko', 'tr', 'es-419', 'uk', 'th', 'ar']);
const placeholders = value => [...value.matchAll(/\{\d+\}/g)].map(match => match[0]).sort();
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

function readCatalog(root, code) {
    const source = decode(fs.readFileSync(path.join(root, 'web/langs', code, 'language.json')));
    const dictionary = JSON.parse(source);
    if (!dictionary || typeof dictionary !== 'object' || Array.isArray(dictionary)) throw new Error('Expected an object');
    // Each entry is a single JSON string. Detect silently overwritten duplicate keys.
    const keys = [...source.matchAll(/^\s*"((?:[^"\\]|\\.)+)"\s*:/gm)].map(match => JSON.parse(`"${match[1]}"`));
    if (new Set(keys).size !== keys.length || keys.length !== Object.keys(dictionary).length) throw new Error('Duplicate or nested catalog keys');
    return dictionary;
}

function inspectCatalogs(root) {
    const issues = [], dictionaries = {};
    for (const code of LANGUAGES) {
        try { dictionaries[code] = readCatalog(root, code); }
        catch (error) { issues.push(`${code}: ${error.message}`); }
    }
    const english = dictionaries.en;
    if (!english) return issues;
    const expected = Object.keys(english).sort();
    for (const [code, dictionary] of Object.entries(dictionaries)) {
        const missing = expected.filter(key => !Object.hasOwn(dictionary, key));
        const extra = Object.keys(dictionary).filter(key => !Object.hasOwn(english, key));
        if (missing.length) issues.push(`${code}: missing ${missing.length} keys (${missing.slice(0, 8).join(', ')})`);
        if (extra.length) issues.push(`${code}: unknown keys (${extra.join(', ')})`);
        for (const [key, value] of Object.entries(dictionary)) {
            const label = `${code}:${key}`;
            if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || ['constructor', 'prototype', '__proto__'].includes(key)) issues.push(`${label}: unsafe key`);
            if (typeof value !== 'string' || !value.trim()) { issues.push(`${label}: empty or non-string value`); continue; }
            if (!value.isWellFormed() || value.includes('\uFFFD') || value.normalize('NFC') !== value) issues.push(`${label}: malformed or non-NFC Unicode`);
            if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u.test(value)) issues.push(`${label}: hidden control or directional override`);
            const source = english[key];
            if (typeof source !== 'string') continue;
            if (JSON.stringify(placeholders(value)) !== JSON.stringify(placeholders(source))) issues.push(`${label}: changed placeholders`);
            const markup = text => text.match(/<\/?[A-Za-z][^>]*>/g) || [];
            if (JSON.stringify(markup(value)) !== JSON.stringify(markup(source))) issues.push(`${label}: changed trusted markup or attributes`);
            if ((value.match(/\n/g) || []).length !== (source.match(/\n/g) || []).length) issues.push(`${label}: changed paragraph breaks`);
            for (const token of source.match(/https?:\/\/[^\s<>"']+|\$\$[A-Za-z0-9_]+\$\$|\b(?:meta\.toml|data\.win|game\.ios|game\.unx|toby\.deltarune|toby\.undertale)\b/g) || []) {
                if (!value.includes(token)) issues.push(`${label}: changed technical token ${token}`);
            }
        }
        try {
            const metadata = decode(fs.readFileSync(path.join(root, 'web/langs', code, 'metadata.txt'))).trim().split(/\r?\n/);
            if (metadata.length < 3 || metadata.slice(0, 3).some(value => !value.trim())) throw new Error('incomplete metadata');
            const flag = metadata[3]?.trim() || 'flag.png';
            if (!/^[A-Za-z0-9._-]+$/.test(flag) || !fs.statSync(path.join(root, 'web/langs', code, flag)).isFile()) throw new Error('invalid language emblem');
            const locale = code === 'pt-br' ? 'pt-BR' : code;
            for (const formatter of [Intl.DateTimeFormat, Intl.NumberFormat, Intl.RelativeTimeFormat]) if (!formatter.supportedLocalesOf([locale]).length) throw new Error('locale unavailable in Intl');
            const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
            for (const key of expected.filter(key => key.endsWith('_one') && Object.hasOwn(english, key.slice(0, -4) + '_other'))) {
                for (const category of categories) if (!Object.hasOwn(dictionary, key.slice(0, -4) + '_' + category)) issues.push(`${code}:${key}: missing ${category} plural`);
            }
        } catch (error) { issues.push(`${code}: ${error.message}`); }
    }
    return issues;
}

function inspectFonts(root) {
    const directory = path.join(root, 'web/commons/fonts');
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'provenance.json'), 'utf8'));
    const issues = [];
    for (const entry of manifest.fonts) {
        const bytes = fs.readFileSync(path.join(directory, entry.file));
        if (crypto.createHash('sha256').update(bytes).digest('hex') !== entry.sha256 || bytes.length !== entry.bytes) issues.push(`Font integrity mismatch: ${entry.file}`);
        if (bytes.subarray(0, 4).toString() !== 'wOF2') issues.push(`Invalid WOFF2 signature: ${entry.file}`);
    }
    const cjk = manifest.fonts.find(font => font.file.includes('CJK'));
    for (const language of ['JAN ', 'KOR ', 'ZHS ', 'ZHT ']) if (!cjk?.localizedForms.includes(language)) issues.push(`Missing CJK localized forms: ${language}`);
    const names = { ar: 'NotoSansArabic.woff2', th: 'NotoSansThai.woff2', ru: 'NotoSans.woff2', uk: 'NotoSans.woff2', ja: cjk.file, ko: cjk.file, 'zh-CN': cjk.file, 'zh-TW': cjk.file };
    const general = manifest.fonts.find(font => font.file === 'NotoSans.woff2');
    for (const code of LANGUAGES) {
        let dictionary;
        try { dictionary = readCatalog(root, code); } catch { continue; }
        const font = manifest.fonts.find(font => font.file === (names[code] || 'NotoSans.woff2'));
        const ranges = [...font.unicodeRanges, ...general.unicodeRanges];
        const missing = new Set();
        for (const character of Object.values(dictionary).join('')) {
            if (!/[\p{L}\p{M}\p{N}]/u.test(character)) continue;
            const point = character.codePointAt(0);
            if (!ranges.some(([start, end]) => point >= start && point <= end)) missing.add(character);
        }
        if (missing.size) issues.push(`${code}: bundled fonts lack ${[...missing].join('')}`);
    }
    return issues;
}

if (require.main === module) {
    const root = path.join(__dirname, '..');
    const issues = [...inspectCatalogs(root), ...inspectFonts(root)];
    if (issues.length) { console.error(issues.join('\n')); process.exitCode = 1; }
    else console.log(`Localization verified: ${LANGUAGES.length} complete catalogs, placeholders, Unicode, plural forms, metadata and bundled fonts.`);
}
module.exports = { LANGUAGES, placeholders, readCatalog, inspectCatalogs, inspectFonts };
