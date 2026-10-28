// Copyright © 2026 cmdr-chara
// Licensed under the EUPL 1.2.
const path = require('node:path');
const { LANGUAGES, inspectCatalogs, inspectFonts } = require('../scripts/check-localization');
const root = path.join(__dirname, '..');
describe('shipping localization catalogs', () => {
    it('provides exactly the seventeen supported locales', () => {
        expect(LANGUAGES).toEqual(['en', 'it', 'pl', 'es', 'fr', 'de', 'pt-br', 'ja',
            'ru', 'zh-CN', 'zh-TW', 'ko', 'tr', 'es-419', 'uk', 'th', 'ar']);
    });
    it('keeps complete keys, placeholders, Unicode, technical tokens and plural categories', () => {
        expect(inspectCatalogs(root)).toEqual([]);
    });
    it('verifies font integrity, regional CJK forms and glyph coverage for all interface text', () => {
        expect(inspectFonts(root)).toEqual([]);
    });
});
