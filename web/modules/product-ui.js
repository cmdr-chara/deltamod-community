// Copyright © 2026 cmdr-chara
// Licensed under the EUPL 1.2.

(function bootstrapProductUi(globalScope, factory) {
    const api = factory();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (globalScope && typeof globalScope === 'object') {
        globalScope.DeltamodProductUI = api;
    }
})(typeof window !== 'undefined' ? window : globalThis, () => {
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


    const CONTRACT_SCHEMA_VERSION = 1;
    const LIVE_ADAPTER_UNAVAILABLE =
        'Installed Mods v2 live data is unavailable because no backend contract commands exist yet.';
    const DEFAULT_ARTWORK = './img/mod-placeholder.png';
    const LIFECYCLE_UNAVAILABLE = 'Available when safe lifecycle commands are connected.';
    const PREFLIGHT_UNAVAILABLE =
        'Unavailable until lifecycle contract evidence can be reviewed for this package.';
    const RESTORE_UNAVAILABLE =
        'Restore is unavailable because this app bridge does not expose the restore command.';
    let componentId = 0;

    function nextId(prefix) {
        componentId += 1;
        return `${prefix}-${componentId}`;
    }

    function safeText(value, fallback = '') {
        if (value === null || value === undefined || value === '') return fallback;
        return String(value);
    }

    const resolveText = value => typeof value === 'function' ? value() : safeText(value);
    // These are protocol enums, never provider titles or user-entered names.
    function uiIdentifier(value, fallback = 'Unknown') {
        const labels = {
            install: 'Install', update: 'Update', uninstall: 'Uninstall', verify: 'Verify',
            repair: 'Repair', recover: 'Recover', profile_switch: 'Profile switch',
            queued: 'Queued', running: 'Running', cancelling: 'Cancelling', succeeded: 'Succeeded',
            failed: 'Failed', cancelled: 'Cancelled', recovery_required: 'Recovery required', recovered: 'Recovered',
            preflight: 'Preflight', downloading: 'Downloading', staging: 'Staging', backing_up: 'Backing up',
            applying: 'Applying', verifying: 'Verifying', committing: 'Committing', rolling_back: 'Rolling back',
            cleaning_up: 'Cleaning up', complete: 'Complete', pending: 'Pending', unknown: 'Unknown',
            no_action: 'No action', retry: 'Retry', reauthenticate: 'Reauthenticate', free_space: 'Free space',
            resolve_conflict: 'Resolve conflict', select_exact_source: 'Select exact source',
            confirmed: 'Confirmed', copied: 'Copied', replaced: 'Replaced', removed: 'Removed', restored: 'Restored',
            different_content: 'Different content', external_modification: 'External modification',
            unknown_existing_file: 'Unknown existing file', unreadable_entry: 'Unreadable entry',
            non_regular_entry: 'Not a regular file', aliased_entry: 'Aliased entry', conflict: 'Conflicting file'
        };
        const source = labels[safeText(value).toLowerCase()];
        return source ? uiText(source) : humanizeIdentifier(value, uiText(fallback));
    }

    function safeSha256(value) {
        const candidate = safeText(value).trim().toLowerCase();
        return /^[a-f0-9]{64}$/.test(candidate) ? candidate : null;
    }

    function optionalTimestamp(value) {
        if (value === null || value === undefined || value === '') return null;
        const timestamp = Number(value);
        return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : null;
    }

    function getDocument(options = {}) {
        const candidate = options.document ||
            (typeof document !== 'undefined' ? document : null);
        if (!candidate || typeof candidate.createElement !== 'function') {
            throw new TypeError('A DOM document is required to create product UI.');
        }
        return candidate;
    }

    function createElement(doc, tagName, className, text) {
        const element = doc.createElement(tagName);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = safeText(text);
        return element;
    }

    function setData(element, name, value) {
        element.setAttribute(`data-${name}`, safeText(value));
    }

    function clampNumber(value, minimum, maximum) {
        const number = Number(value);
        if (!Number.isFinite(number)) return minimum;
        return Math.min(maximum, Math.max(minimum, number));
    }

    function humanizeIdentifier(value, fallback = uiText("Unknown")) {
        const text = safeText(value, fallback)
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!text) return fallback;
        return text.charAt(0).toUpperCase() + text.slice(1);
    }

    function safeExternalUrl(value) {
        const candidate = safeText(value).trim();
        if (!candidate) return null;

        try {
            const parsed = new URL(candidate);
            if (!['https:', 'http:'].includes(parsed.protocol)) return null;
            if (parsed.username || parsed.password) return null;
            return parsed.href;
        } catch (_error) {
            return null;
        }
    }

    function safeRelativeArtworkUrl(value) {
        const candidate = safeText(value).trim();
        if (!candidate.startsWith('./')) return null;

        let decoded = candidate;
        try {
            for (let pass = 0; pass < 5; pass += 1) {
                const next = decodeURIComponent(decoded);
                if (next === decoded) break;
                decoded = next;
                if (pass === 4 && decodeURIComponent(decoded) !== decoded) return null;
            }
        } catch (_error) {
            return null;
        }

        if (
            decoded.includes('\0') ||
            decoded.includes('\\') ||
            decoded.includes(':') ||
            decoded.includes('?') ||
            decoded.includes('#')
        ) {
            return null;
        }
        const segments = decoded.slice(2).split('/');
        if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
            return null;
        }
        return `./${segments.map(encodeURIComponent).join('/')}`;
    }

    function safeArtworkUrl(value) {
        const candidate = safeText(value).trim();
        if (!candidate) return DEFAULT_ARTWORK;
        return safeRelativeArtworkUrl(candidate) || safeExternalUrl(candidate) || DEFAULT_ARTWORK;
    }

    function deepFreeze(value, seen = new Set()) {
        if (!value || typeof value !== 'object' || seen.has(value)) return value;
        seen.add(value);
        Object.values(value).forEach(entry => deepFreeze(entry, seen));
        return Object.freeze(value);
    }

    function cloneFixtureModel(value) {
        if (typeof structuredClone === 'function') return structuredClone(value);
        return JSON.parse(JSON.stringify(value));
    }

    function asArray(value) {
        if (value === null || value === undefined) return [];
        return Array.isArray(value) ? value : [value];
    }

    function errorCode(error) {
        const candidate = typeof error === 'string'
            ? error
            : error?.code || error?.errorCode || error?.messageKey || '';
        const normalized = safeText(candidate).trim();
        return normalized.length > 0 && normalized.length <= 128 &&
            /^[A-Za-z0-9._:-]+$/.test(normalized)
            ? normalized
            : 'unknown_error';
    }

    function normalizeCatalogError(error) {
        return {
            code: errorCode(error),
            operationId: safeText(error?.operationId || error?.operation_id),
            phase: safeText(error?.phase),
            recoveryAction: safeText(error?.recoveryAction || error?.recovery_action),
            retryable: error?.retryable === true
        };
    }

    function isStartupRecoveryError(error) {
        const code = errorCode(error).toLowerCase();
        return (code.includes('startup') && code.includes('recovery')) ||
            code === 'recovery_required' ||
            code === 'recovery_unavailable';
    }

    function normalizedErrorList(errors) {
        return asArray(errors)
            .map(normalizeCatalogError)
            .filter(error => error.code !== 'unknown_error');
    }

    function assertContract(contract, documentKind) {
        if (!contract || typeof contract !== 'object') {
            throw new TypeError(`Missing ${documentKind} contract.`);
        }
        if (contract.schemaVersion !== CONTRACT_SCHEMA_VERSION) {
            throw new RangeError(
                `Unsupported ${documentKind} schema version: ${safeText(contract.schemaVersion, 'missing')}.`
            );
        }
        if (contract.documentKind !== documentKind) {
            throw new TypeError(
                `Expected ${documentKind} contract, received ${safeText(contract.documentKind, 'missing')}.`
            );
        }
        return contract;
    }

    function optionalContract(contract, documentKind) {
        return contract === null || contract === undefined
            ? null
            : assertContract(contract, documentKind);
    }

    function verificationForInstance(results, instanceId) {
        return results.find(result => result.modInstanceId === instanceId) || null;
    }

    function healthForInstallation(reports, installationId) {
        return reports.find(report => report.installationId === installationId) || null;
    }

    function conflictsForMod(reports, installationId, instanceId) {
        return reports
            .filter(report => report.installationId === installationId)
            .flatMap(report => report.conflicts || [])
            .filter(conflict =>
                conflict.requestingOwner === instanceId ||
                asArray(conflict.existingOwners).includes(instanceId)
            );
    }

    function warningForMod(mod, verification, health, conflicts, overlays) {
        const explicit = overlays.warningByInstanceId?.[mod.instanceId];
        if (explicit) return safeText(explicit);
        if (conflicts.length > 0) return uiText("Review file conflicts before making changes.");
        if (verification && asArray(verification.issues).length > 0) {
            const count = verification.issues.length;
            return uiText('Verification issues to review: {0}.', uiNumber(count));
        }
        if (health && health.state !== 'healthy') return uiText("Game health needs review.");
        return null;
    }

    function nonNegativeNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? number : null;
    }

    function reviewOwners(value) {
        return Array.from(new Set(asArray(value)
            .map(owner => safeText(owner).trim())
            .filter(Boolean)
            .slice(0, 32)));
    }

    function normalizeReviewFile(file, fallbackAction = 'unchanged') {
        if (!file || typeof file !== 'object') return null;
        const path = safeText(file.path || file.pathIdentityKey).trim();
        if (!path) return null;
        return {
            path,
            action: safeText(file.action, fallbackAction),
            previousSha256: safeSha256(file.previousSha256 || file.expectedSha256),
            proposedSha256: safeSha256(file.proposedSha256 || file.stagingSha256),
            existingOwners: reviewOwners(file.existingOwners || file.owners),
            backupRequired: file.backupRequired === true ||
                Boolean(file.backupPath || file.backupSha256)
        };
    }

    function normalizeReviewConflict(conflict) {
        if (!conflict || typeof conflict !== 'object') return null;
        const path = safeText(conflict.path || conflict.pathIdentityKey).trim();
        if (!path) return null;
        return {
            path,
            reason: safeText(conflict.reason, 'conflict'),
            existingOwners: reviewOwners(conflict.existingOwners)
        };
    }

    function reviewProvider(provider = {}, fallback = {}) {
        const candidate = provider && typeof provider === 'object' ? provider : {};
        return {
            id: safeText(candidate.providerId || candidate.id, safeText(fallback.id, 'unknown')),
            displayName: safeText(
                candidate.displayName,
                safeText(fallback.displayName, humanizeIdentifier(candidate.providerId || candidate.id, uiText("Unknown source")))
            ),
            displayNameFallback: !candidate.displayName && (fallback.displayNameFallback || (!fallback.displayName && !candidate.providerId && !candidate.id ? 'Unknown source' : null)),
            versionId: safeText(candidate.versionId || fallback.versionId),
            resourceId: safeText(candidate.resourceId || fallback.resourceId)
        };
    }

    function matchingOperationRecord(installed, records) {
        const installationId = safeText(installed?.installationId);
        const instanceId = safeText(installed?.instanceId);
        return asArray(records)
            .filter(record => {
                const intent = record?.request?.intent || {};
                return safeText(intent.installationId) === installationId &&
                    (!intent.modInstanceId || safeText(intent.modInstanceId) === instanceId);
            })
            .sort((left, right) => Number(right.updatedAtMs) - Number(left.updatedAtMs))[0] || null;
    }

    function matchingLifecycleJournal(installed, record, journals) {
        const operationId = safeText(record?.request?.operationId);
        const installationId = safeText(installed?.installationId);
        return asArray(journals)
            .filter(journal =>
                (operationId && safeText(journal?.operationId) === operationId) ||
                (!operationId && safeText(journal?.installationId) === installationId)
            )
            .sort((left, right) => Number(right.updatedAtMs) - Number(left.updatedAtMs))[0] || null;
    }

    function createPreflightReview(
        installed = {},
        mod = {},
        operationRecords = [],
        lifecycleJournals = [],
        conflicts = [],
        health = null,
        supplied = null
    ) {
        const record = matchingOperationRecord(installed, operationRecords);
        const journal = matchingLifecycleJournal(installed, record, lifecycleJournals);
        const intent = record?.request?.intent || {};
        const suppliedObject = supplied && typeof supplied === 'object' ? supplied : null;
        const suppliedFiles = suppliedObject && Array.isArray(suppliedObject.files)
            ? suppliedObject.files.map(file => normalizeReviewFile(file)).filter(Boolean)
            : null;
        const journalFiles = asArray(journal?.mutations)
            .map(file => normalizeReviewFile(file, 'replace'))
            .filter(Boolean);
        const installedFiles = asArray(installed?.files)
            .map(file => normalizeReviewFile(file))
            .filter(Boolean);
        const files = suppliedFiles || (journalFiles.length > 0 ? journalFiles : installedFiles);
        const provider = reviewProvider(
            suppliedObject?.provider || intent.provider || installed?.provider,
            mod.provider
        );
        const suppliedBackupFiles = nonNegativeNumber(suppliedObject?.backupFiles);
        const journalBackupFiles = journal
            ? asArray(journal.mutations).filter(mutation =>
                Boolean(mutation?.backupPath || mutation?.backupSha256)
            ).length
            : null;
        const backupFiles = suppliedBackupFiles ?? journalBackupFiles ??
            files.filter(file => file.backupRequired).length;
        const suppliedFileCount = nonNegativeNumber(suppliedObject?.fileCount);
        const fileCount = suppliedFileCount ?? (files.length || nonNegativeNumber(mod.fileCount) || 0);
        const suppliedExternalChanges = nonNegativeNumber(suppliedObject?.externalChanges);

        return {
            source: safeText(
                suppliedObject?.source,
                suppliedObject
                    ? 'preflight-contract'
                    : journal
                        ? 'lifecycle-journal'
                        : 'installed-mod-contract'
            ),
            modInstanceId: safeText(
                suppliedObject?.modInstanceId || suppliedObject?.mod_instance_id || installed?.instanceId || mod.id
            ),
            installationId: safeText(
                suppliedObject?.installationId || suppliedObject?.installation_id || installed?.installationId || mod.installationId
            ),
            modName: safeText(suppliedObject?.modName || suppliedObject?.displayName, safeText(mod.name, uiText("Installed package"))),
            modNameFallback: !suppliedObject?.modName && !suppliedObject?.displayName && (mod.nameFallback || !mod.name),
            operationId: safeText(
                suppliedObject?.operationId || suppliedObject?.operation_id || record?.request?.operationId || journal?.operationId
            ),
            kind: safeText(
                suppliedObject?.kind || intent.kind || journal?.operation,
                'review'
            ),
            provider,
            version: safeText(
                suppliedObject?.version || provider.versionId || intent.version || mod.version,
                uiText("Unknown")
            ),
            versionFallback: !suppliedObject?.version && !provider.versionId && !intent.version && (mod.versionFallback || !mod.version),
            archiveSha256: safeSha256(
                suppliedObject?.archiveSha256 || intent.archiveSha256 || installed?.archiveSha256 || mod.archiveSha256
            ),
            filePlanFingerprint: safeSha256(
                suppliedObject?.filePlanFingerprint || intent.filePlanFingerprint ||
                    installed?.filePlanFingerprint || mod.filePlanFingerprint
            ),
            files,
            fileCount,
            stagingBytes: nonNegativeNumber(suppliedObject?.stagingBytes),
            backupFiles,
            conflicts: (suppliedObject && Array.isArray(suppliedObject.conflicts)
                ? suppliedObject.conflicts
                : conflicts)
                .map(normalizeReviewConflict)
                .filter(Boolean),
            externalChanges: suppliedExternalChanges ??
                nonNegativeNumber(health?.unknownModifiedFiles) ??
                (health?.state === 'external_changes_detected' ? 1 : 0)
        };
    }

    function suppliedPreflightReviews(fixture, overlays) {
        const supplied = overlays.preflightReviews ?? overlays.preflightReports ??
            fixture.preflightReviews ?? fixture.preflightReports ??
            fixture.preflightReview ?? fixture.preflightReport;
        return supplied === undefined
            ? []
            : asArray(supplied).filter(review => review && typeof review === 'object');
    }

    function mapContractsV1Fixture(fixture, overlays = {}) {
        if (!fixture || typeof fixture !== 'object') {
            throw new TypeError('A contracts-v1 fixture object is required.');
        }

        const installedContracts = asArray(fixture.installedMods || fixture.installedMod)
            .map(contract => assertContract(contract, 'installed_mod'));
        const providerDescriptors = asArray(
            fixture.providerDescriptors || fixture.providerDescriptor
        ).map(contract => assertContract(contract, 'provider_descriptor'));
        const verificationResults = asArray(
            fixture.verificationResults || fixture.verificationResult
        ).map(contract => assertContract(contract, 'verification_result'));
        const healthReports = asArray(
            fixture.gameHealthReports || fixture.gameHealthReport
        ).map(contract => assertContract(contract, 'game_health_report'));
        const conflictReports = asArray(
            fixture.conflictReports || fixture.conflictReport
        ).map(contract => assertContract(contract, 'conflict_report'));
        const operationProgress = optionalContract(
            fixture.operationProgress,
            'operation_progress'
        );
        const operationRecords = asArray(fixture.operationRecords || fixture.operationRecord)
            .map(contract => assertContract(contract, 'operation_record'));
        const lifecycleJournals = asArray(fixture.lifecycleJournals || fixture.lifecycleJournal)
            .map(contract => assertContract(contract, 'lifecycle_journal'));
        const productError = optionalContract(fixture.productError, 'product_error');
        const catalogErrors = normalizedErrorList(fixture.errors);
        const startupRecoveryErrors = catalogErrors.filter(isStartupRecoveryError);
        const preflightContracts = suppliedPreflightReviews(fixture, overlays);

        const readOnly = overlays.readOnly !== false;
        const mods = installedContracts.map(installed => {
            const providerRef = installed.provider || {};
            const providerDescriptor = providerDescriptors.find(
                descriptor => descriptor.providerId === providerRef.providerId
            );
            const verification = verificationForInstance(
                verificationResults,
                installed.instanceId
            );
            const health = healthForInstallation(healthReports, installed.installationId);
            const conflicts = conflictsForMod(
                conflictReports,
                installed.installationId,
                installed.instanceId
            );
            const availableVersion = overlays.availableVersionByInstanceId?.[installed.instanceId];

            return {
                id: safeText(installed.instanceId),
                folder: safeText(overlays.foldersByInstanceId?.[installed.instanceId]),
                installationId: safeText(installed.installationId),
                modId: safeText(installed.modId),
                name: safeText(installed.displayName, uiText("Unnamed mod")),
                nameFallback: !installed.displayName,
                version: safeText(installed.version, uiText("Unknown")),
                versionFallback: !installed.version,
                archiveSha256: safeSha256(installed.archiveSha256),
                filePlanFingerprint: safeSha256(installed.filePlanFingerprint),
                artworkUrl: safeArtworkUrl(
                    overlays.artworkByInstanceId?.[installed.instanceId] || DEFAULT_ARTWORK
                ),
                provider: {
                    id: safeText(providerRef.providerId, 'unknown'),
                    displayName: safeText(
                        providerDescriptor?.displayName,
                        humanizeIdentifier(providerRef.providerId, uiText("Unknown source"))
                    ),
                    displayNameFallback: !providerDescriptor?.displayName && !providerRef.providerId ? 'Unknown source' : null,
                    itemKind: safeText(providerRef.itemKind, 'item'),
                    resourceId: safeText(providerRef.resourceId),
                    artifactId: safeText(providerRef.artifactId),
                    versionId: safeText(providerRef.versionId),
                    canonicalUrl: safeText(providerRef.canonicalUrl)
                },
                verification: verification
                    ? {
                        state: safeText(verification.state, 'unknown'),
                        checkedFiles: clampNumber(
                            verification.checkedFiles,
                            0,
                            Number.MAX_SAFE_INTEGER
                        ),
                        issues: asArray(verification.issues),
                        verifiedAtMs: Number(verification.verifiedAtMs) || null
                    }
                    : { state: 'unverified', checkedFiles: 0, issues: [], verifiedAtMs: null },
                health: health
                    ? {
                        state: safeText(health.state, 'unknown'),
                        checkedAtMs: Number(health.checkedAtMs) || null,
                        unknownModifiedFiles: clampNumber(
                            health.unknownModifiedFiles,
                            0,
                            Number.MAX_SAFE_INTEGER
                        )
                    }
                    : { state: 'unknown', checkedAtMs: null, unknownModifiedFiles: 0 },
                fileCount: asArray(installed.files).length,
                installedAtMs: Number(installed.installedAtMs) || null,
                updatedAtMs: Number(installed.updatedAtMs) || null,
                update: availableVersion
                    ? { state: 'available', availableVersion: safeText(availableVersion) }
                    : { state: 'current', availableVersion: null },
                conflicts,
                warning: warningForMod(installed, verification, health, conflicts, overlays),
                warningOwned: !overlays.warningByInstanceId?.[installed.instanceId],
                readOnly
            };
        });

        const preflightReviews = installedContracts
            .map((installed, index) => {
                const mod = mods[index];
                const supplied = preflightContracts.find(review =>
                    safeText(review.modInstanceId || review.mod_instance_id) === installed.instanceId
                ) || (preflightContracts.length === 1 ? preflightContracts[0] : null);
                return createPreflightReview(
                    installed,
                    mod,
                    operationRecords,
                    lifecycleJournals,
                    mod.conflicts,
                    healthForInstallation(healthReports, installed.installationId),
                    supplied
                );
            })
            .filter(review => review.fileCount > 0 || review.operationId || review.archiveSha256 || review.filePlanFingerprint);

        const model = {
            source: 'contracts-v1',
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            status: safeText(overlays.status, mods.length > 0 ? 'ready' : 'empty'),
            readOnly,
            mods,
            operationProgress,
            operationRecords,
            lifecycleJournals,
            productError,
            catalogErrors,
            startupRecoveryErrors,
            preflightReviews,
            conflictReports,
            healthReports
        };
        model.diagnostics = createSanitizedDiagnostics(model, overlays.runtime);
        return model;
    }

    function createFixtureInstalledModsAdapter(fixture, overlays = {}) {
        // Freeze a detached snapshot so the caller-owned golden fixture remains
        // available for other contract tests and cannot be mutated through the UI.
        const snapshot = deepFreeze(cloneFixtureModel(mapContractsV1Fixture(fixture, overlays)));
        return Object.freeze({
            kind: 'fixture',
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            readOnly: true,
            async load() {
                return snapshot;
            }
        });
    }

    function legacyProvider(mod = {}) {
        const explicit = mod.provider && typeof mod.provider === 'object'
            ? mod.provider
            : {};
        const gameBanana = mod.gamebanana && typeof mod.gamebanana === 'object'
            ? mod.gamebanana
            : {};
        const isGameBanana = gameBanana.supports === true ||
            safeText(explicit.providerId || explicit.id).toLowerCase() === 'gamebanana';
        const id = isGameBanana
            ? 'gamebanana'
            : safeText(explicit.providerId || explicit.id, 'unknown').toLowerCase();
        return {
            id,
            displayName: isGameBanana
                ? 'GameBanana'
                : safeText(explicit.displayName, uiText("Source not recorded")),
            displayNameFallback: !isGameBanana && !explicit.displayName ? 'Source not recorded' : null,
            itemKind: safeText(explicit.itemKind, 'mod'),
            resourceId: safeText(explicit.resourceId || (isGameBanana ? gameBanana.id : '')),
            artifactId: safeText(explicit.artifactId),
            versionId: safeText(explicit.versionId),
            canonicalUrl: safeExternalUrl(explicit.canonicalUrl || mod.sourceUrl)
        };
    }

    function mapLegacyInstalledMod(mod, index) {
        if (!mod || typeof mod !== 'object') {
            throw new TypeError('Installed mod entries must be objects.');
        }
        const id = safeText(
            mod.instanceId || mod.uid || mod.folder || mod.packageID,
            `legacy-record-${index + 1}`
        );
        const packageId = safeText(mod.modId || mod.packageID);
        const fileCount = Array.isArray(mod.files)
            ? mod.files.length
            : Number.isInteger(mod.fileCount) && mod.fileCount >= 0
                ? mod.fileCount
                : null;
        return {
            id,
            folder: safeText(mod.folder),
            installationId: safeText(mod.installationId || mod.game),
            modId: packageId === 'und.und.und' ? '' : packageId,
            name: safeText(mod.displayName || mod.name, uiText("Unnamed mod")),
            nameFallback: !mod.displayName && !mod.name,
            version: safeText(mod.version, uiText("Unknown")),
            versionFallback: !mod.version,
            archiveSha256: safeSha256(mod.archiveSha256 || mod.sha256),
            filePlanFingerprint: safeSha256(mod.filePlanFingerprint),
            artworkUrl: DEFAULT_ARTWORK,
            provider: legacyProvider(mod),
            verification: {
                state: 'unverified',
                checkedFiles: 0,
                issues: [],
                verifiedAtMs: null
            },
            health: { state: 'unknown', checkedAtMs: null, unknownModifiedFiles: 0 },
            fileCount,
            installedAtMs: optionalTimestamp(mod.installedAtMs),
            updatedAtMs: optionalTimestamp(mod.updatedAtMs),
            update: { state: 'unknown', availableVersion: null },
            conflicts: [],
            warning: uiText("Verification and lifecycle metadata are not available for this legacy record."),
            warningOwned: true,
            legacyMetadata: true,
            readOnly: true
        };
    }

    function mapLegacyModList(response) {
        if (!response || typeof response !== 'object' || !Array.isArray(response.modList)) {
            throw new TypeError('The installed mod catalogue returned an invalid response.');
        }
        const errors = Array.isArray(response.errors) ? response.errors : [];
        const mods = response.modList.map(mapLegacyInstalledMod);
        const catalogErrors = normalizedErrorList(errors);
        return {
            source: 'legacy-live',
            schemaVersion: null,
            status: mods.length > 0 ? 'ready' : errors.length > 0 ? 'error' : 'empty',
            readOnly: true,
            mods,
            operationProgress: null,
            operationRecords: [],
            lifecycleJournals: [],
            productError: errors.length > 0
                ? { code: 'installed_mod_scan_failed' }
                : null,
            catalogErrors,
            startupRecoveryErrors: [],
            conflictReports: [],
            healthReports: [],
            diagnostics: null,
            libraryWarningCount: errors.length,
            libraryWarning: errors.length > 0 && mods.length > 0
                ? uiText('Installed records that could not be read: {0}.', uiNumber(errors.length))
                : null
        };
    }

    function createLegacyLiveInstalledModsAdapter(invoke) {
        if (typeof invoke !== 'function') {
            throw new TypeError('A backend invoke function is required.');
        }
        return Object.freeze({
            kind: 'legacy-live',
            readOnly: true,
            async load() {
                const response = await invoke('getModList', []);
                return deepFreeze(mapLegacyModList(response));
            }
        });
    }

    function createUnavailableLiveInstalledModsAdapter() {
        return Object.freeze({
            kind: 'live-unavailable',
            readOnly: true,
            async load() {
                throw new Error(LIVE_ADAPTER_UNAVAILABLE);
            }
        });
    }

    function createLifecycleLiveInstalledModsAdapter(invoke) {
        if (typeof invoke !== 'function') {
            throw new TypeError('A backend invoke function is required.');
        }
        return Object.freeze({
            kind: 'lifecycle-live',
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            readOnly: false,
            async load() {
                const response = await invoke('lifecycle:getInstalledMods', []);
                if (!response || typeof response !== 'object') {
                    throw new TypeError('The lifecycle catalogue returned an invalid response.');
                }
                const errors = normalizedErrorList(response.errors);
                const startupRecoveryErrors = errors.filter(isStartupRecoveryError);
                const model = mapContractsV1Fixture(response, {
                    readOnly: false,
                    foldersByInstanceId: response.foldersByInstanceId || {},
                    runtime: response.runtime || {},
                    status: asArray(response.installedMods).length > 0
                        ? 'ready'
                        : errors.length > 0 ? 'error' : 'empty'
                });
                model.libraryWarningCount = errors.length;
                model.libraryWarning = errors.length > 0
                    ? uiText('Local packages that could not be adopted safely: {0}.', uiNumber(errors.length))
                    : null;
                model.catalogErrors = errors;
                model.startupRecoveryErrors = startupRecoveryErrors;
                if (startupRecoveryErrors.length > 0) {
                    model.productError = {
                        code: startupRecoveryErrors[0].code,
                        recoveryAction: startupRecoveryErrors[0].recoveryAction,
                        retryable: startupRecoveryErrors[0].retryable
                    };
                }
                return deepFreeze(model);
            }
        });
    }

    const InstalledModsAdapters = Object.freeze({
        fixture: createFixtureInstalledModsAdapter,
        legacyLive: createLegacyLiveInstalledModsAdapter,
        lifecycleLive: createLifecycleLiveInstalledModsAdapter,
        live: createUnavailableLiveInstalledModsAdapter
    });

    function ProviderBadge(provider = {}, options = {}) {
        const doc = getDocument(options);
        const badge = uiRender(createElement(doc, 'span', 'product-badge product-provider-badge'), () => provider.displayNameFallback ? uiText(provider.displayNameFallback) : safeText(provider.displayName, humanizeIdentifier(provider.id, uiText("Unknown source"))));
        setData(badge, 'provider', safeText(provider.id, 'unknown'));
        uiRender(badge, () => uiText("Source: {0}", badge.textContent), 'title');
        return badge;
    }

    function VerificationBadge(verification = {}, options = {}) {
        const doc = getDocument(options);
        const state = safeText(verification.state, 'unverified').toLowerCase();
        const labels = {
            healthy: 'Verified healthy',
            warning: 'Verification warning',
            unhealthy: 'Verification failed',
            failed: 'Verification failed',
            unverified: 'Not verified',
            unknown: 'Verification unknown'
        };
        const tone = state === 'healthy'
            ? 'success'
            : ['warning', 'unverified', 'unknown'].includes(state)
                ? 'warning'
                : 'danger';
        const badge = uiRender(createElement(doc, 'span', `product-badge product-verification-badge is-${tone}`), () => labels[state] ? uiText(labels[state]) : uiText('Verification unknown'));
        setData(badge, 'verification-state', state);
        if (Number.isFinite(Number(verification.checkedFiles))) {
            const checkedFiles = Number(verification.checkedFiles);
            uiRender(badge, () => uiText('{0}; files checked: {1}', badge.textContent, uiNumber(checkedFiles)), 'title');
        }
        return badge;
    }

    function HealthBadge(health = {}, options = {}) {
        const doc = getDocument(options);
        const state = safeText(health.state, 'unknown').toLowerCase();
        const labels = {
            healthy: 'Game healthy',
            modified_as_expected: 'Modified as expected',
            external_changes_detected: 'External changes detected',
            missing_files: 'Missing files',
            conflicting_ownership: 'Ownership conflict',
            interrupted_operation: 'Interrupted operation',
            repair_available: 'Repair available',
            unknown: 'Game health unknown'
        };
        const tone = ['healthy', 'modified_as_expected'].includes(state)
            ? 'success'
            : state === 'unknown'
                ? 'neutral'
                : ['missing_files', 'conflicting_ownership', 'interrupted_operation'].includes(state)
                    ? 'danger'
                    : 'warning';
        const badge = uiRender(createElement(doc, 'span', `product-badge product-health-badge is-${tone}`), () => labels[state] ? uiText(labels[state]) : uiText('Game health unknown'));
        setData(badge, 'health-state', state);
        return badge;
    }

    function GameHealthSummary(reports = [], options = {}) {
        const doc = getDocument(options);
        const normalizedReports = asArray(reports);
        const titleId = nextId('game-health-summary-title');
        const section = createElement(doc, 'section', 'product-health-summary');
        section.setAttribute('aria-labelledby', titleId);

        const priority = new Map([
            ['healthy', 0],
            ['modified_as_expected', 1],
            ['unknown', 2],
            ['external_changes_detected', 3],
            ['repair_available', 4],
            ['missing_files', 5],
            ['conflicting_ownership', 6],
            ['interrupted_operation', 7]
        ]);
        const overallState = normalizedReports.reduce((current, report) => {
            const candidate = safeText(report?.state, 'unknown').toLowerCase();
            return (priority.get(candidate) ?? 2) > (priority.get(current) ?? 2)
                ? candidate
                : current;
        }, normalizedReports.length > 0 ? 'healthy' : 'unknown');

        const header = createElement(doc, 'div', 'product-health-summary-heading');
        const headingCopy = createElement(doc, 'div');
        const title = uiRender(createElement(doc, 'h2', null), () => uiText("Game health"));
        title.id = titleId;
        const installationCount = normalizedReports.length;
        headingCopy.append(
            title,
            uiRender(createElement(doc, 'p', null), () => installationCount === 1
                    ? uiText("Current state for this game installation.")
                    : uiText("Current state across {0} game installations.", installationCount))
        );
        header.append(
            headingCopy,
            HealthBadge({ state: overallState }, { document: doc })
        );

        const totals = normalizedReports.reduce((result, report) => ({
            managed: result.managed + clampNumber(
                report?.lifecycleOwnedFiles,
                0,
                Number.MAX_SAFE_INTEGER - result.managed
            ),
            external: result.external + clampNumber(
                report?.unknownModifiedFiles,
                0,
                Number.MAX_SAFE_INTEGER - result.external
            ),
            interrupted: result.interrupted + asArray(report?.interruptedOperations).length
        }), { managed: 0, external: 0, interrupted: 0 });

        const metrics = createElement(doc, 'dl', 'product-health-metrics');
        const metric = (label, value, testId) => {
            const item = createElement(doc, 'div', 'product-health-metric');
            const term = uiRender(createElement(doc, 'dt', null), () => resolveText(label));
            const description = uiRender(createElement(doc, 'dd', null), () => uiNumber(value));
            setData(description, 'testid', testId);
            item.append(term, description);
            return item;
        };
        metrics.append(
            metric(() => uiText("Installations"), installationCount, 'health-installations'),
            metric(() => uiText("Managed files"), totals.managed, 'health-managed-files'),
            metric(() => uiText("External changes"), totals.external, 'health-external-changes'),
            metric(() => uiText("Interrupted operations"), totals.interrupted, 'health-interrupted-operations')
        );

        section.append(header, metrics);
        setData(section, 'health-state', overallState);
        return section;
    }

    function statusBadge(label, state, doc) {
        const badge = uiRender(createElement(doc, 'span', `product-badge product-status-badge is-${safeText(state, 'neutral')}`), () => resolveText(label));
        setData(badge, 'status', safeText(state, 'neutral'));
        return badge;
    }

    function OperationProgress(progress = {}, options = {}) {
        const doc = getDocument(options);
        const section = createElement(doc, 'section', 'product-operation-progress');
        section.setAttribute('role', 'status');
        section.setAttribute('aria-live', 'polite');
        setData(section, 'state', safeText(progress.state, 'unknown'));

        const heading = createElement(doc, 'div', 'product-operation-progress-heading');
        const title = uiRender(createElement(doc, 'h2', null), () => resolveText(options.title) || uiText("{0} progress", uiIdentifier(progress.kind, 'Operation')));
        const state = statusBadge(
            () => uiIdentifier(progress.state, 'Pending'),
            progress.state === 'succeeded'
                ? 'success'
                : progress.state === 'failed'
                    ? 'danger'
                    : 'neutral',
            doc
        );
        heading.append(title, state);

        const total = clampNumber(progress.total, 0, Number.MAX_SAFE_INTEGER);
        const completed = clampNumber(progress.completed, 0, total || Number.MAX_SAFE_INTEGER);
        const progressElement = createElement(doc, 'progress', 'product-progress-bar');
        uiRender(progressElement, () => safeText(options.progressLabel, uiText("Operation progress")), 'aria-label');
        if (total > 0) {
            progressElement.max = total;
            progressElement.value = completed;
            progressElement.setAttribute('max', String(total));
            progressElement.setAttribute('value', String(completed));
        }

        const detail = createElement(doc, 'div', 'product-operation-progress-detail');
        const countText = () => total > 0 ? uiText('{0} of {1}', uiNumber(completed), uiNumber(total)) : uiText('Preparing');
        const phaseText = () => uiIdentifier(progress.phase, 'Pending');
        detail.append(
            uiRender(createElement(doc, 'span', null), () => `${phaseText()} · ${countText()}`),
            createElement(doc, 'span', null, safeText(progress.currentItem))
        );
        if (!progress.currentItem) detail.lastChild.hidden = true;

        section.append(heading, progressElement, detail);

        if (progress.cancellable || options.showCancel) {
            const cancel = uiRender(createElement(doc, 'button', 'secondary-action'), () => uiText("Cancel"));
            cancel.type = 'button';
            const canCancel = typeof options.onCancel === 'function';
            cancel.disabled = !canCancel;
            cancel.setAttribute('aria-disabled', String(!canCancel));
            if (!canCancel) uiRender(cancel, () => uiText(LIFECYCLE_UNAVAILABLE), 'title');
            if (canCancel) cancel.addEventListener('click', () => options.onCancel(progress));
            section.appendChild(cancel);
        }

        return section;
    }

    function operationTone(state) {
        if (state === 'succeeded') return 'success';
        if (['failed', 'recovery_required', 'cancelled'].includes(state)) return 'danger';
        return 'neutral';
    }

    function OperationsCenter(records = [], options = {}) {
        const doc = getDocument(options);
        const section = createElement(doc, 'section', 'product-operations-center');
        const titleId = nextId('operations-center-title');
        section.setAttribute('aria-labelledby', titleId);

        const normalized = [...asArray(records)]
            .sort((left, right) => Number(right.updatedAtMs) - Number(left.updatedAtMs))
            .slice(0, 100);
        const header = createElement(doc, 'div', 'product-section-heading');
        const title = uiRender(createElement(doc, 'h2', null), () => uiText("Recent operations"));
        title.id = titleId;
        header.append(title, statusBadge(() => uiText("{0} recorded", normalized.length), 'neutral', doc));
        section.appendChild(header);

        if (normalized.length === 0) {
            section.appendChild(uiRender(createElement(doc, 'p', 'product-section-empty'), () => uiText("No lifecycle operations have been recorded yet.")));
            return section;
        }

        const list = createElement(doc, 'ol', 'product-operation-history');
        normalized.forEach(record => {
            const item = createElement(doc, 'li', 'product-operation-history-item');
            setData(item, 'operation-state', safeText(record.state, 'unknown'));
            const copy = createElement(doc, 'div', 'product-operation-history-copy');
            copy.append(
                uiRender(createElement(doc, 'strong', null), () => uiIdentifier(record.request?.intent?.kind, 'Operation')),
                uiRender(createElement(doc, 'span', null), () => `${uiIdentifier(record.phase, 'Pending')} · ${formatDate(record.updatedAtMs, options.locale).label}`)
            );
            item.append(
                copy,
                statusBadge(
                    () => uiIdentifier(record.state),
                    operationTone(record.state),
                    doc
                )
            );

            if (record.error) {
                const recovery = uiRender(createElement(doc, 'button', 'secondary-action'), () => uiText("Open recovery"));
                recovery.type = 'button';
                const canRecover = typeof options.onRecover === 'function';
                recovery.disabled = !canRecover;
                recovery.setAttribute('aria-disabled', String(!canRecover));
                if (!canRecover) uiRender(recovery, () => safeText(options.recoveryUnavailableReason, uiText(LIFECYCLE_UNAVAILABLE)), 'title');
                if (canRecover) recovery.addEventListener('click', () => options.onRecover(record));
                item.appendChild(recovery);
            }
            list.appendChild(item);
        });
        section.appendChild(list);
        return section;
    }

    function RecoveryCenter(journals = [], options = {}) {
        const doc = getDocument(options);
        const section = createElement(doc, 'section', 'product-recovery-center');
        const titleId = nextId('recovery-center-title');
        section.setAttribute('aria-labelledby', titleId);
        const normalized = [...asArray(journals)]
            .sort((left, right) => Number(right.updatedAtMs) - Number(left.updatedAtMs));
        const startupErrors = normalizedErrorList(
            options.startupRecoveryErrors || options.startupErrors
        );
        const header = createElement(doc, 'div', 'product-section-heading');
        const title = uiRender(createElement(doc, 'h2', null), () => uiText("Recovery"));
        title.id = titleId;
        const unresolved = normalized.filter(journal => journal.phase !== 'complete').length;
        const needsAttention = unresolved > 0 || startupErrors.length > 0;
        const attentionCount = unresolved + startupErrors.length;
        setData(section, 'state', needsAttention ? 'required' : 'ready');
        header.append(
            title,
            statusBadge(
                () => needsAttention
                    ? uiText("{0} needs attention", attentionCount)
                    : uiText("Ready"),
                needsAttention ? 'danger' : 'success',
                doc
            )
        );
        section.appendChild(header);

        if (startupErrors.length > 0 && normalized.length > 0) {
            const startupEntry = createElement(doc, 'article', 'product-recovery-entry');
            setData(startupEntry, 'recovery-state', 'required');
            const startupCopy = createElement(doc, 'div', 'product-recovery-copy');
            startupCopy.append(
                uiRender(createElement(doc, 'strong', null), () => uiText("Startup recovery needs attention")),
                createElement(
                    doc,
                    'span',
                    null,
                    startupErrors.map(error => error.code).join(' · ')
                ),
                uiRender(createElement(doc, 'p', 'product-recovery-next-step'), () => uiText("Review the persisted recovery entries below before starting another lifecycle change."))
            );
            startupCopy.lastChild.setAttribute('role', 'alert');
            startupEntry.appendChild(startupCopy);
            const startupStatus = uiRender(createElement(doc, 'span', 'product-badge is-danger'), () => uiText("Blocked"));
            startupEntry.appendChild(startupStatus);
            section.appendChild(startupEntry);
        }

        if (normalized.length === 0) {
            if (startupErrors.length > 0) {
                const list = createElement(doc, 'div', 'product-recovery-list');
                const entry = createElement(doc, 'article', 'product-recovery-entry');
                setData(entry, 'recovery-state', 'required');
                const copy = createElement(doc, 'div', 'product-recovery-copy');
                copy.append(
                    uiRender(createElement(doc, 'strong', null), () => uiText("Startup recovery is blocked")),
                    createElement(
                        doc,
                        'span',
                        null,
                        startupErrors.map(error => error.code).join(' · ')
                    )
                );
                const reason = uiRender(createElement(doc, 'p', 'product-recovery-next-step'), () => safeText(
                        options.restoreUnavailableReason,
                        uiText("No persisted recovery generation is available to restore.")
                    ));
                const reasonId = nextId('recovery-unavailable');
                reason.id = reasonId;
                copy.appendChild(reason);
                const restore = uiRender(createElement(doc, 'button', 'secondary-action'), () => uiText("Restore"));
                restore.type = 'button';
                restore.disabled = true;
                restore.setAttribute('aria-disabled', 'true');
                restore.setAttribute('aria-describedby', reasonId);
                uiRender(restore, () => uiText("Restore startup recovery (unavailable)"), 'aria-label');
                uiRender(restore, () => reason.textContent, 'title');
                entry.append(copy, restore);
                list.appendChild(entry);
                section.appendChild(list);
                return section;
            }
            section.appendChild(uiRender(createElement(doc, 'p', 'product-section-empty'), () => uiText("No recovery generation is available.")));
            return section;
        }

        const list = createElement(doc, 'div', 'product-recovery-list');
        normalized.forEach(journal => {
            const entry = createElement(doc, 'article', 'product-recovery-entry');
            setData(entry, 'recovery-state', journal.phase === 'complete' ? 'available' : 'required');
            const copy = createElement(doc, 'div', 'product-recovery-copy');
            const reasonId = nextId('recovery-entry-description');
            copy.append(
                uiRender(createElement(doc, 'strong', null), () => journal.phase === 'complete' ? uiText("Last working state") : uiText("Interrupted operation")),
                uiRender(createElement(doc, 'span', null), () => uiText("{0} · {1} file changes · {2}", uiIdentifier(journal.operation, 'Operation'), asArray(journal.mutations).length, formatDate(journal.updatedAtMs, options.locale).label)),
                uiRender(createElement(doc, 'p', 'product-recovery-next-step'), () => journal.phase === 'complete'
                        ? uiText("Restore this verified generation only after reviewing the preflight facts above.")
                        : uiText("Restore the last working state before starting another lifecycle change."))
            );
            copy.lastChild.id = reasonId;
            const restore = uiRender(createElement(doc, 'button', 'secondary-action'), () => uiText("Restore"));
            restore.type = 'button';
            const canRestore = typeof options.onRestore === 'function';
            restore.disabled = !canRestore;
            restore.setAttribute('aria-disabled', String(!canRestore));
            uiRender(restore, () => uiText(canRestore ? 'Restore {0}' : 'Restore {0} (unavailable)', uiIdentifier(journal.operation, 'Last working state')), 'aria-label');
            restore.setAttribute('aria-describedby', reasonId);
            if (!canRestore) {
                const unavailableReason = () => safeText(options.restoreUnavailableReason, uiText(RESTORE_UNAVAILABLE));
                uiRender(copy.lastChild, unavailableReason);
                uiRender(restore, unavailableReason, 'title');
            }
            if (canRestore) restore.addEventListener('click', () => options.onRestore(journal));
            entry.append(copy, restore);
            list.appendChild(entry);
        });
        section.appendChild(list);
        return section;
    }

    function diagnosticToken(value, allowed, fallback = 'unknown') {
        const token = safeText(value).trim();
        return token.length > 0 && token.length <= 64 && allowed.test(token)
            ? token
            : fallback;
    }

    function createSanitizedDiagnostics(model = {}, runtime = {}) {
        const mods = asArray(model.mods);
        const startupRecoveryErrors = Array.from(new Set(
            asArray(model.startupRecoveryErrors || model.catalogErrors)
                .filter(isStartupRecoveryError)
                .map(error => diagnosticToken(errorCode(error), /^[a-z0-9_.:-]+$/i, ''))
                .filter(Boolean)
        )).sort();
        const providers = Array.from(new Set(mods
            .map(mod => diagnosticToken(mod.provider?.id, /^[a-z0-9._-]+$/, ''))
            .filter(Boolean)))
            .sort();
        const healthStates = {};
        asArray(model.healthReports).forEach(report => {
            const state = diagnosticToken(report.state, /^[a-z0-9_]+$/);
            healthStates[state] = (healthStates[state] || 0) + 1;
        });
        return deepFreeze({
            documentKind: 'sanitized_diagnostics',
            schemaVersion: 1,
            application: {
                version: diagnosticToken(runtime.version, /^[a-z0-9.+_-]+$/i),
                shell: diagnosticToken(runtime.shell, /^(tauri|unknown)$/),
                platform: diagnosticToken(runtime.platform, /^(windows|linux|macos|unknown)$/)
            },
            lifecycle: {
                installedMods: mods.length,
                recordedOperations: asArray(model.operationRecords).length,
                recoveryGenerations: asArray(model.lifecycleJournals).length,
                preflightReviews: asArray(model.preflightReviews).length,
                startupRecoveryErrors,
                healthStates
            },
            providers
        });
    }

    function DiagnosticsPanel(diagnostics = {}, options = {}) {
        const doc = getDocument(options);
        const section = createElement(doc, 'section', 'product-diagnostics-panel');
        const titleId = nextId('diagnostics-title');
        section.setAttribute('aria-labelledby', titleId);
        const header = createElement(doc, 'div', 'product-section-heading');
        const title = uiRender(createElement(doc, 'h2', null), () => uiText("Support diagnostics"));
        title.id = titleId;
        header.appendChild(title);

        const summary = createElement(doc, 'p', 'product-diagnostics-summary');
        const startupErrors = asArray(diagnostics.lifecycle?.startupRecoveryErrors);
        uiRender(summary, () => [
            uiText('{0} mods · {1} operations · {2} recovery generations',
                uiNumber(clampNumber(diagnostics.lifecycle?.installedMods, 0, Number.MAX_SAFE_INTEGER)),
                uiNumber(clampNumber(diagnostics.lifecycle?.recordedOperations, 0, Number.MAX_SAFE_INTEGER)),
                uiNumber(clampNumber(diagnostics.lifecycle?.recoveryGenerations, 0, Number.MAX_SAFE_INTEGER))),
            startupErrors.length ? uiText('Startup recovery errors: {0}', uiNumber(startupErrors.length)) : ''
        ].filter(Boolean).join(' · '));
        const copy = uiRender(createElement(doc, 'button', 'secondary-action'), () => uiText("Copy diagnostics"));
        copy.type = 'button';
        const copyStatus = createElement(doc, 'span', 'product-copy-status');
        copyStatus.setAttribute('role', 'status');
        copyStatus.setAttribute('aria-live', 'polite');
        const canCopy = typeof options.onCopy === 'function';
        copy.disabled = !canCopy;
        copy.setAttribute('aria-disabled', String(!canCopy));
        if (!canCopy) uiRender(copy, () => uiText("Available when the desktop clipboard bridge is connected."), "title");
        if (canCopy) {
            copy.addEventListener('click', () => {
                uiRender(copyStatus, () => uiText("Copying…"));
                Promise.resolve(options.onCopy(JSON.stringify(diagnostics, null, 2)))
                    .then(() => {
                        uiRender(copyStatus, () => uiText("Copied."));
                    })
                    .catch(() => {
                        uiRender(copyStatus, () => uiText("Clipboard unavailable."));
                    });
            });
        }
        section.append(header, summary, copy, copyStatus);
        return section;
    }

    function preflightActionLabel(action) {
        const labels = {
            create: uiText("Create"),
            replace: uiText("Replace"),
            co_own_identical: uiText("Keep shared copy"),
            delete: uiText("Delete"),
            keep_for_other_owners: uiText("Keep for another owner"),
            already_missing: uiText("Already missing"),
            unchanged: uiText("Unchanged")
        };
        return labels[safeText(action).toLowerCase()] || humanizeIdentifier(action, uiText("Review"));
    }

    function PreflightReview(review = {}, options = {}) {
        const doc = getDocument(options);
        const section = createElement(doc, 'section', 'product-preflight-review');
        const titleId = nextId('preflight-review-title');
        const descriptionId = nextId('preflight-review-description');
        section.setAttribute('aria-labelledby', titleId);
        section.setAttribute('aria-describedby', descriptionId);
        setData(section, 'review-source', safeText(review.source, 'contract'));
        setData(section, 'review-kind', safeText(review.kind, 'review'));

        const heading = createElement(doc, 'div', 'product-section-heading');
        const title = uiRender(createElement(doc, 'h2', null), () => uiText("Preflight review"));
        title.id = titleId;
        const state = review.conflicts?.length > 0 || review.externalChanges > 0
            ? 'blocked'
            : 'recorded';
        heading.append(
            title,
            statusBadge(() => state === 'blocked' ? uiText("Review required") : uiText("Contract evidence"), state === 'blocked' ? 'danger' : 'neutral', doc)
        );

        const description = uiRender(createElement(doc, 'p', 'product-preflight-description'), () => review.source === 'preflight-contract'
                ? uiText("Review the backend-provided plan before making an enabled lifecycle change.")
                : uiText("Reviewable facts from the installed, operation, and recovery contracts. A new backend preflight is still authoritative at mutation time."));
        description.id = descriptionId;

        const summary = createElement(doc, 'dl', 'product-preflight-summary');
        const addSummary = (label, value, testId) => {
            const item = createElement(doc, 'div', 'product-preflight-summary-item');
            const term = uiRender(createElement(doc, 'dt', null), () => resolveText(label));
            const valueNode = uiRender(createElement(doc, 'dd', null), () => resolveText(value));
            if (testId) setData(valueNode, 'testid', testId);
            item.append(term, valueNode);
            summary.appendChild(item);
        };
        addSummary(() => uiText("Package"), () => review.modNameFallback ? uiText('Installed package') : safeText(review.modName, uiText("Installed package")));
        addSummary(() => uiText("Operation"), () => uiIdentifier(review.kind, 'Review'));
        addSummary(() => uiText("Provider"), () => review.provider?.displayNameFallback ? uiText(review.provider.displayNameFallback) : safeText(review.provider?.displayName, uiText("Unknown source")));
        addSummary(() => uiText("Version"), () => review.versionFallback ? uiText('Unknown') : safeText(review.version, uiText("Unknown")));
        addSummary(() => uiText("Files"), () => uiNumber(review.fileCount), 'preflight-file-count');
        addSummary(() => uiText("Backups"), () => uiNumber(review.backupFiles), 'preflight-backup-count');
        if (review.externalChanges > 0) {
            addSummary(() => uiText("External changes"), () => String(review.externalChanges), 'preflight-external-changes');
        }

        const identifiers = createElement(doc, 'p', 'product-preflight-identifiers');
        uiRender(identifiers, () => {
            const parts = [];
            if (review.archiveSha256) parts.push(uiText('Archive SHA-256 {0}', shortenedHash(review.archiveSha256)));
            if (review.filePlanFingerprint) parts.push(uiText('File plan {0}', shortenedHash(review.filePlanFingerprint)));
            if (review.operationId) parts.push(uiText('Operation {0}', review.operationId));
            return parts.length ? parts.join(' · ') : uiText('Exact archive, file plan, and operation identity are not recorded.');
        });

        const files = createElement(doc, 'ul', 'product-preflight-files');
        review.files.slice(0, 100).forEach(file => {
            const item = createElement(doc, 'li', 'product-preflight-file');
            const path = createElement(doc, 'code', 'product-preflight-path', file.path);
            const detail = uiRender(createElement(doc, 'span', 'product-preflight-file-detail'), () => [preflightActionLabel(file.action), file.backupRequired ? uiText('Backup required') : ''].filter(Boolean).join(' · '));
            item.append(path, detail);
            if (file.existingOwners.length > 0) {
                item.appendChild(uiRender(createElement(doc, 'span', 'product-preflight-owners'), () => uiText("Owners: {0}", file.existingOwners.join(', '))));
            }
            files.appendChild(item);
        });
        if (review.files.length === 0) {
            files.appendChild(uiRender(createElement(doc, 'li', 'product-section-empty'), () => uiText("No affected files are recorded in the available contracts.")));
        }

        section.append(heading, description, summary, identifiers, files);
        if (review.conflicts.length > 0) {
            const conflicts = uiRender(createElement(doc, 'p', 'product-preflight-warning'), () => uiText('Recorded file conflicts: {0}. Resolve conflicts before making changes.', uiNumber(review.conflicts.length)));
            conflicts.setAttribute('role', 'alert');
            section.appendChild(conflicts);
        } else if (review.externalChanges > 0) {
            const external = uiRender(createElement(doc, 'p', 'product-preflight-warning'), () => uiText('Recorded external changes: {0}. Lifecycle actions must re-check the installation.', uiNumber(review.externalChanges)));
            external.setAttribute('role', 'alert');
            section.appendChild(external);
        }
        return section;
    }

    function StatePanel(kind, options = {}) {
        const doc = getDocument(options);
        const panel = createElement(doc, 'section', `product-state product-state-${kind}`);
        setData(panel, 'state', kind);
        panel.setAttribute('role', kind === 'error' ? 'alert' : 'status');

        const marker = createElement(doc, 'span', 'product-state-marker', options.marker || '◆');
        marker.setAttribute('aria-hidden', 'true');
        const copy = createElement(doc, 'div', 'product-state-copy');
        const heading = uiRender(createElement(doc, 'h2', null), () => resolveText(options.title));
        const message = uiRender(createElement(doc, 'p', null), () => resolveText(options.message));
        copy.append(heading, message);

        const actions = asArray(options.actions).filter(Boolean);
        if (actions.length > 0) {
            const actionRow = createElement(doc, 'div', 'product-state-actions');
            actions.forEach(action => {
                const button = uiRender(createElement(
                    doc,
                    'button',
                    action.secondary ? 'secondary-action' : ''
                ), () => resolveText(action.label));
                button.type = 'button';
                button.disabled = Boolean(action.disabled) || typeof action.onActivate !== 'function';
                button.setAttribute('aria-disabled', String(button.disabled));
                if (button.disabled && action.unavailableReason) {
                    uiRender(button, () => resolveText(action.unavailableReason), 'title');
                }
                if (!button.disabled) {
                    button.addEventListener('click', event => action.onActivate(event));
                }
                actionRow.appendChild(button);
            });
            copy.appendChild(actionRow);
        }

        panel.append(marker, copy);
        return panel;
    }

    function EmptyState(options = {}) {
        return StatePanel('empty', {
            title: () => safeText(resolveText(options.title), uiText("No installed mods yet")),
            message: () => safeText(
                resolveText(options.message),
                uiText("Installed packages will appear here when lifecycle support is available.")
            ),
            marker: options.marker || '◇',
            actions: options.actions,
            document: options.document
        });
    }

    function ErrorState(options = {}) {
        return StatePanel('error', {
            title: () => safeText(resolveText(options.title), uiText("Unable to load installed mods")),
            message: () => safeText(resolveText(options.message), uiText("Try again when the data source is available.")),
            marker: options.marker || '!',
            actions: options.actions,
            document: options.document
        });
    }

    function RecoveryErrorState(errors = [], options = {}) {
        const normalized = normalizedErrorList(errors);
        const first = normalized[0] || {};
        const code = safeText(first.code, 'startup_recovery_failed');
        const operationId = safeText(first.operationId);
        const message = () => code === 'PATCH_STARTUP_RECOVERY_BLOCKED'
            ? uiText("A startup patch recovery is blocked. Review the persisted operation and recovery state before making changes.")
            : uiText("A startup lifecycle recovery could not be completed. Review the persisted recovery state before making changes.");
        const detail = () => operationId ? uiText('Operation {0} remains recorded for investigation.', operationId) : '';
        const panel = StatePanel('recovery-error', {
            title: () => safeText(resolveText(options.title), uiText("Startup recovery needs attention")),
            message: () => [message(), detail()].filter(Boolean).join(' '),
            marker: options.marker || '!',
            actions: options.actions,
            document: options.document
        });
        setData(panel, 'error-code', code);
        return panel;
    }

    function OfflineState(options = {}) {
        return StatePanel('offline', {
            title: () => safeText(resolveText(options.title), uiText("You are offline")),
            message: () => safeText(
                resolveText(options.message),
                uiText("Installed records remain available, but provider details may be out of date.")
            ),
            marker: options.marker || '○',
            actions: options.actions,
            document: options.document
        });
    }

    function Skeleton(options = {}) {
        const doc = getDocument(options);
        const section = createElement(doc, 'section', 'product-skeleton');
        section.setAttribute('role', 'status');
        section.setAttribute('aria-busy', 'true');
        uiRender(section, () => safeText(resolveText(options.label), uiText("Loading installed mods")), 'aria-label');
        setData(section, 'state', 'loading');

        const announcement = uiRender(createElement(doc, 'span', 'product-visually-hidden'), () => safeText(resolveText(options.label), uiText("Loading installed mods")));
        section.appendChild(announcement);
        const rows = clampNumber(options.rows || 2, 1, 6);
        for (let index = 0; index < rows; index += 1) {
            const row = createElement(doc, 'div', 'product-skeleton-row');
            row.setAttribute('aria-hidden', 'true');
            row.append(
                createElement(doc, 'span', 'product-skeleton-artwork'),
                createElement(doc, 'span', 'product-skeleton-copy'),
                createElement(doc, 'span', 'product-skeleton-action')
            );
            section.appendChild(row);
        }
        return section;
    }

    function getFocusableElements(container) {
        if (!container || typeof container.querySelectorAll !== 'function') return [];
        return Array.from(
            container.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')
        ).filter(element =>
            !element.disabled &&
            !element.hidden &&
            element.getAttribute('aria-hidden') !== 'true' &&
            element.getAttribute('tabindex') !== '-1'
        );
    }

    function dialogIsOpen(dialog) {
        return Boolean(dialog.open || dialog.hasAttribute('open'));
    }

    function createDialogController(dialog, initialFocus, options = {}) {
        const doc = dialog.ownerDocument;
        let returnFocus = null;
        let didRestoreFocus = true;

        const restoreFocus = () => {
            if (didRestoreFocus) return;
            didRestoreFocus = true;
            if (returnFocus && returnFocus.isConnected !== false &&
                typeof returnFocus.focus === 'function') {
                returnFocus.focus();
            }
        };

        const close = (value = 'cancel') => {
            if (!dialogIsOpen(dialog)) {
                restoreFocus();
                return;
            }
            if (typeof dialog.close === 'function') dialog.close(value);
            else dialog.removeAttribute('open');
            restoreFocus();
            if (typeof options.onClose === 'function') options.onClose(value);
        };

        const open = trigger => {
            returnFocus = trigger || doc.activeElement || null;
            didRestoreFocus = false;
            if (!dialogIsOpen(dialog)) {
                if (typeof dialog.showModal === 'function') dialog.showModal();
                else dialog.setAttribute('open', '');
            }
            const focusTarget = initialFocus || getFocusableElements(dialog)[0];
            if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();
        };

        dialog.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close('cancel');
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = getFocusableElements(dialog);
            if (focusable.length === 0) {
                event.preventDefault();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && doc.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && doc.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });
        dialog.addEventListener('cancel', event => {
            event.preventDefault();
            close('cancel');
        });
        dialog.addEventListener('close', restoreFocus);

        return { element: dialog, open, close };
    }

    function Confirmation(options = {}) {
        const doc = getDocument(options);
        const titleId = nextId('product-confirmation-title');
        const descriptionId = nextId('product-confirmation-description');
        const dialog = createElement(doc, 'dialog', 'product-dialog product-confirmation');
        dialog.setAttribute('aria-labelledby', titleId);
        dialog.setAttribute('aria-describedby', descriptionId);

        const heading = uiRender(createElement(doc, 'h2', null), () => safeText(resolveText(options.title), uiText("Confirm action")));
        heading.id = titleId;
        const description = uiRender(createElement(doc, 'p', null), () => resolveText(options.message));
        description.id = descriptionId;
        dialog.append(heading, description);

        let confirmationInput = null;
        if (options.requiredText) {
            const inputId = nextId('product-confirmation-input');
            const field = createElement(doc, 'label', 'product-confirmation-field');
            field.setAttribute('for', inputId);
            field.appendChild(uiRender(createElement(doc, 'span', null), () => uiText("Type {0} to continue", safeText(options.requiredText))));
            confirmationInput = createElement(doc, 'input');
            confirmationInput.id = inputId;
            confirmationInput.type = 'text';
            confirmationInput.autocomplete = 'off';
            field.appendChild(confirmationInput);
            dialog.appendChild(field);
        }

        const actions = createElement(doc, 'div', 'product-dialog-actions');
        const cancelButton = uiRender(createElement(doc, 'button', 'secondary-action'), () => safeText(resolveText(options.cancelLabel), uiText("Cancel")));
        cancelButton.type = 'button';
        const confirmButton = uiRender(createElement(doc, 'button', options.danger ? 'product-button-danger' : ''), () => safeText(resolveText(options.confirmLabel), uiText("Continue")));
        confirmButton.type = 'button';
        if (confirmationInput) confirmButton.disabled = true;
        actions.append(cancelButton, confirmButton);
        dialog.appendChild(actions);

        const controller = createDialogController(
            dialog,
            confirmationInput || cancelButton,
            { onClose: options.onClose }
        );
        cancelButton.addEventListener('click', () => controller.close('cancel'));
        confirmButton.addEventListener('click', () => {
            if (confirmButton.disabled) return;
            if (typeof options.onConfirm === 'function') options.onConfirm();
            controller.close('confirm');
        });
        if (confirmationInput) {
            confirmationInput.addEventListener('input', () => {
                confirmButton.disabled = confirmationInput.value !== safeText(options.requiredText);
            });
        }

        const open = trigger => {
            if (confirmationInput) {
                confirmationInput.value = '';
                confirmButton.disabled = true;
            }
            controller.open(trigger);
        };

        return {
            ...controller,
            open,
            cancelButton,
            confirmButton,
            confirmationInput
        };
    }

    function DangerConfirmation(options = {}) {
        return Confirmation({
            ...options,
            danger: true,
            title: () => safeText(resolveText(options.title), uiText("Confirm destructive action")),
            confirmLabel: () => safeText(resolveText(options.confirmLabel), uiText("Confirm"))
        });
    }

    function shortenedHash(value) {
        const text = safeText(value);
        return text.length > 16 ? `${text.slice(0, 12)}…` : text;
    }

    function ConflictDialog(report = {}, options = {}) {
        const doc = getDocument(options);
        const titleId = nextId('product-conflict-title');
        const descriptionId = nextId('product-conflict-description');
        const dialog = createElement(doc, 'dialog', 'product-dialog product-conflict-dialog');
        dialog.setAttribute('aria-labelledby', titleId);
        dialog.setAttribute('aria-describedby', descriptionId);

        const conflicts = asArray(report.conflicts);
        const title = uiRender(createElement(doc, 'h2', null), () => safeText(resolveText(options.title), uiText("File conflicts")));
        title.id = titleId;
        const description = uiRender(createElement(doc, 'p', null), () => safeText(
                resolveText(options.message),
                uiText('Files to review before changes can continue: {0}.', uiNumber(conflicts.length))
            ));
        description.id = descriptionId;
        const list = createElement(doc, 'ul', 'product-conflict-list');

        conflicts.forEach(conflict => {
            const item = createElement(doc, 'li', 'product-conflict-item');
            const path = createElement(doc, 'code', 'product-conflict-path', conflict.path);
            const reason = uiRender(createElement(doc, 'span', 'product-conflict-reason'), () => uiIdentifier(conflict.reason, 'Conflicting file'));
            const owners = asArray(conflict.existingOwners).map(owner => safeText(owner)).join(', ');
            const owner = uiRender(createElement(doc, 'span', 'product-conflict-owner'), () => owners ? uiText("Currently owned by {0}", owners) : uiText("Existing owner unavailable"));
            item.append(path, reason, owner);

            if (conflict.actualSha256 || conflict.proposedSha256) {
                item.appendChild(uiRender(createElement(doc, 'span', 'product-conflict-hashes'), () => uiText("Current {0} · Proposed {1}", shortenedHash(conflict.actualSha256), shortenedHash(conflict.proposedSha256))));
            }
            list.appendChild(item);
        });

        const actions = createElement(doc, 'div', 'product-dialog-actions');
        const closeButton = uiRender(createElement(doc, 'button', 'secondary-action'), () => uiText("Close"));
        closeButton.type = 'button';
        actions.appendChild(closeButton);
        dialog.append(title, description, list, actions);

        const controller = createDialogController(dialog, closeButton, {
            onClose: options.onClose
        });
        closeButton.addEventListener('click', () => controller.close('close'));
        return { ...controller, closeButton };
    }

    function Toast(options = {}) {
        const doc = getDocument(options);
        const tone = safeText(options.tone, 'info');
        const toast = createElement(doc, 'article', `product-toast is-${tone}`);
        toast.setAttribute('role', ['danger', 'error'].includes(tone) ? 'alert' : 'status');
        const copy = createElement(doc, 'div', 'product-toast-copy');
        copy.append(
            uiRender(createElement(doc, 'strong', null), () => safeText(resolveText(options.title), uiText("Notification"))),
            uiRender(createElement(doc, 'p', null), () => resolveText(options.message))
        );
        const closeButton = uiRender(createElement(doc, 'button', 'product-toast-close'), () => uiText("Close"));
        closeButton.type = 'button';
        uiRender(closeButton, () => uiText("Dismiss notification"), 'aria-label');
        const dismiss = () => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
            if (typeof options.onDismiss === 'function') options.onDismiss();
        };
        closeButton.addEventListener('click', dismiss);
        toast.append(copy, closeButton);
        return { element: toast, closeButton, dismiss };
    }

    function NotificationCenter(options = {}) {
        const doc = getDocument(options);
        const center = createElement(doc, 'section', 'product-notification-center');
        uiRender(center, () => safeText(resolveText(options.label), uiText("Notifications")), 'aria-label');
        center.setAttribute('aria-live', 'polite');
        const notify = notification => {
            const toast = Toast({ ...notification, document: doc });
            center.appendChild(toast.element);
            return toast;
        };
        const clear = () => center.replaceChildren();
        return { element: center, notify, clear };
    }

    function formatDate(timestamp, locale) {
        if (timestamp === null || timestamp === undefined || timestamp === '') {
            return { label: uiText("Unknown"), iso: '' };
        }
        const date = new Date(Number(timestamp));
        if (!Number.isFinite(date.getTime())) return { label: uiText("Unknown"), iso: '' };
        try {
            return {
                label: new Intl.DateTimeFormat(uiHost.Localization?.getLocale?.() || locale || 'en', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                }).format(date),
                iso: date.toISOString()
            };
        } catch (_error) {
            return { label: date.toISOString().slice(0, 10), iso: date.toISOString() };
        }
    }

    function detailItem(doc, label, value, valueNode = null) {
        const wrapper = createElement(doc, 'div', 'product-mod-detail');
        wrapper.append(
            uiRender(createElement(doc, 'dt', null), () => resolveText(label)),
            valueNode || uiRender(createElement(doc, 'dd', null), () => resolveText(value))
        );
        return wrapper;
    }

    function sourceLink(provider, doc) {
        const url = safeExternalUrl(provider.canonicalUrl);
        if (!url) {
            const unavailable = uiRender(createElement(doc, 'span', 'product-source-unavailable'), () => uiText("Source unavailable"));
            setData(unavailable, 'testid', 'mod-source-link');
            return unavailable;
        }
        const link = uiRender(createElement(doc, 'a', 'product-source-link'), () => uiText("View source"));
        link.href = url;
        link.setAttribute('href', url);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
        setData(link, 'testid', 'mod-source-link');
        return link;
    }

    function lifecycleButton(
        doc,
        action,
        label,
        modName,
        describedBy,
        onActivate,
        unavailableReason = LIFECYCLE_UNAVAILABLE
    ) {
        const button = uiRender(createElement(doc, 'button', 'secondary-action product-lifecycle-action'), () => uiText(label));
        button.type = 'button';
        const available = typeof onActivate === 'function';
        button.disabled = !available;
        button.setAttribute('aria-disabled', String(!available));
        uiRender(button, () => uiText(available ? '{0}: {1}' : '{0}: {1} (unavailable)', uiText(label), resolveText(modName)), 'aria-label');
        if (!available) {
            button.setAttribute('aria-describedby', describedBy);
            uiRender(button, () => [LIFECYCLE_UNAVAILABLE, PREFLIGHT_UNAVAILABLE, RESTORE_UNAVAILABLE].includes(unavailableReason) ? uiText(unavailableReason) : resolveText(unavailableReason), 'title');
        } else {
            button.addEventListener('click', () => onActivate());
        }
        setData(button, 'lifecycle-action', action);
        return button;
    }

    function InstalledModCard(mod = {}, options = {}) {
        const doc = getDocument(options);
        const titleId = nextId('installed-mod-title');
        const unavailableId = nextId('installed-mod-actions-unavailable');
        const card = createElement(doc, 'article', 'product-mod-card');
        card.setAttribute('role', 'listitem');
        card.setAttribute('aria-labelledby', titleId);
        setData(card, 'mod-instance', safeText(mod.id));

        const header = createElement(doc, 'header', 'product-mod-header');
        const artwork = createElement(doc, 'img', 'product-mod-artwork');
        artwork.src = safeArtworkUrl(mod.artworkUrl);
        artwork.setAttribute('src', artwork.src);
        artwork.alt = '';
        artwork.setAttribute('alt', '');
        artwork.width = 88;
        artwork.height = 88;
        artwork.addEventListener('error', () => {
            if (artwork.getAttribute('src') === DEFAULT_ARTWORK) return;
            artwork.src = DEFAULT_ARTWORK;
            artwork.setAttribute('src', DEFAULT_ARTWORK);
        }, { once: true });

        const identity = createElement(doc, 'div', 'product-mod-identity');
        const eyebrow = uiRender(createElement(doc, 'span', 'product-mod-eyebrow'), () => uiText("Installed package"));
        const displayName = () => mod.nameFallback ? uiText('Unnamed mod') : safeText(mod.name, uiText('Unnamed mod'));
        const name = uiRender(createElement(doc, 'h2', 'product-mod-name'), displayName);
        name.id = titleId;
        const badges = createElement(doc, 'div', 'product-mod-badges');
        badges.append(
            ProviderBadge(mod.provider, { document: doc }),
            VerificationBadge(mod.verification, { document: doc }),
            HealthBadge(mod.health, { document: doc })
        );
        if (mod.update?.state === 'available') {
            badges.appendChild(statusBadge(
                () => uiText("{0} available", safeText(mod.update.availableVersion, uiText('New version'))),
                'update',
                doc
            ));
        } else if (mod.update?.state === 'current') {
            badges.appendChild(statusBadge(() => uiText("Up to date"), 'neutral', doc));
        } else {
            badges.appendChild(statusBadge(() => uiText("Update status unknown"), 'neutral', doc));
        }
        identity.append(eyebrow, name, badges);
        header.append(artwork, identity);

        const details = createElement(doc, 'dl', 'product-mod-details');
        const installedDate = formatDate(mod.installedAtMs, options.locale);
        const dateValue = createElement(doc, 'dd');
        const time = uiRender(createElement(doc, 'time', null), () => formatDate(mod.installedAtMs, options.locale).label);
        if (installedDate.iso) time.setAttribute('datetime', installedDate.iso);
        dateValue.appendChild(time);
        const providerLabel = () => {
            const label = mod.provider?.displayNameFallback ? uiText(mod.provider.displayNameFallback) : safeText(mod.provider?.displayName, uiText('Unknown source'));
            return mod.provider?.resourceId ? `${label} #${safeText(mod.provider.resourceId)}` : label;
        };
        const hasFileCount = Number.isInteger(mod.fileCount) && mod.fileCount >= 0;
        const fileCount = hasFileCount
            ? clampNumber(mod.fileCount, 0, Number.MAX_SAFE_INTEGER)
            : null;
        const checksum = safeSha256(mod.archiveSha256);
        details.append(
            detailItem(doc, () => uiText("Version"), () => mod.versionFallback ? uiText('Unknown') : safeText(mod.version, uiText("Unknown"))),
            detailItem(doc, () => uiText("Source"), providerLabel),
            detailItem(
                doc,
                () => uiText("Files"),
                () => fileCount === null
                    ? uiText("Not recorded")
                    : uiNumber(fileCount)
            ),
            detailItem(doc, () => uiText("Archive SHA-256"), () => checksum || uiText("Not recorded")),
            detailItem(doc, () => uiText("Installed"), null, dateValue),
            detailItem(doc, () => uiText("Provider page"), null, (() => {
                const value = createElement(doc, 'dd');
                value.appendChild(sourceLink(mod.provider || {}, doc));
                return value;
            })())
        );

        const states = createElement(doc, 'div', 'product-mod-states');
        if (mod.update?.state === 'available') {
            const update = createElement(doc, 'p', 'product-mod-state is-update');
            setData(update, 'state', 'update');
            uiRender(update, () => uiText("Update {0} is available.", safeText(mod.update.availableVersion)));
            states.appendChild(update);
        }
        if (mod.warning) {
            const warning = uiRender(createElement(doc, 'p', 'product-mod-state is-warning'), () => {
                if (!mod.warningOwned) return mod.warning;
                if (mod.legacyMetadata) return uiText('Verification and lifecycle metadata are not available for this legacy record.');
                return warningForMod({ instanceId: mod.id }, mod.verification, mod.health, asArray(mod.conflicts), {});
            });
            warning.setAttribute('role', 'status');
            setData(warning, 'state', 'warning');
            states.appendChild(warning);
        }

        if (asArray(mod.conflicts).length > 0) {
            const conflictRow = createElement(doc, 'div', 'product-mod-state is-conflict');
            setData(conflictRow, 'state', 'conflict');
            const count = mod.conflicts.length;
            conflictRow.appendChild(uiRender(createElement(doc, 'p', null), () => uiText('File conflicts to review: {0}.', uiNumber(count))));
            const dialog = ConflictDialog(
                { conflicts: mod.conflicts, installationId: mod.installationId },
                { document: doc }
            );
            const review = uiRender(createElement(doc, 'button', 'secondary-action'), () => uiText("Review conflicts"));
            review.type = 'button';
            setData(review, 'testid', 'review-conflicts');
            review.addEventListener('click', () => dialog.open(review));
            conflictRow.appendChild(review);
            states.append(conflictRow, dialog.element);
        }

        const unavailable = uiRender(createElement(doc, 'p', 'product-action-unavailable'), () => options.preflightReview
                ? uiText("Lifecycle actions repeat authoritative preflight checks before changing files.")
                : uiText(PREFLIGHT_UNAVAILABLE));
        unavailable.id = unavailableId;
        const actions = createElement(doc, 'div', 'product-mod-actions');
        const openFolder = mod.folder && typeof options.onOpenFolder === 'function'
            ? () => options.onOpenFolder(mod)
            : null;
        const lifecycleAction = callback => !mod.readOnly && typeof callback === 'function'
            ? () => callback(mod)
            : null;
        const mutationAction = callback => options.preflightReview
            ? lifecycleAction(callback)
            : null;
        actions.append(
            lifecycleButton(
                doc,
                'update',
                'Update',
                displayName,
                unavailableId,
                mutationAction(
                    mod.installationId === 'local-packet-library' ? options.onUpdate : null
                ),
                options.preflightReview ? LIFECYCLE_UNAVAILABLE : PREFLIGHT_UNAVAILABLE
            ),
            lifecycleButton(
                doc,
                'verify',
                'Verify files',
                displayName,
                unavailableId,
                lifecycleAction(options.onVerify)
            ),
            lifecycleButton(
                doc,
                'repair',
                'Repair',
                displayName,
                unavailableId,
                mutationAction(options.onRepair),
                options.preflightReview ? LIFECYCLE_UNAVAILABLE : PREFLIGHT_UNAVAILABLE
            ),
            lifecycleButton(
                doc,
                'open-folder',
                'Open folder',
                displayName,
                unavailableId,
                openFolder
            ),
            lifecycleButton(
                doc,
                'uninstall',
                'Uninstall',
                displayName,
                unavailableId,
                mutationAction(options.onUninstall),
                options.preflightReview ? LIFECYCLE_UNAVAILABLE : PREFLIGHT_UNAVAILABLE
            )
        );

        card.append(header, details);
        if (states.childNodes.length > 0) card.appendChild(states);
        if (options.preflightReview) {
            card.appendChild(PreflightReview(options.preflightReview, {
                document: doc,
                locale: options.locale
            }));
        }
        card.append(unavailable, actions);
        return card;
    }

    function errorMessage(productError) {
        const known = {
            installation_busy: uiText("Another operation is using this installation."),
            provider_offline: uiText("The provider is currently unavailable."),
            verification_failed: uiText("Installed files could not be verified.")
        };
        return known[productError?.code] || uiText("Installed mod data could not be loaded.");
    }

    function installedModNeedsAttention(mod) {
        return Boolean(
            mod.warning ||
            asArray(mod.conflicts).length > 0 ||
            !['healthy', 'modified_as_expected'].includes(mod.health?.state) ||
            mod.verification?.state !== 'healthy'
        );
    }

    function InstalledModsToolbar(mods = [], options = {}) {
        const doc = getDocument(options);
        const toolbar = createElement(doc, 'div', 'product-library-toolbar');
        toolbar.setAttribute('role', 'search');

        const searchLabel = uiRender(createElement(doc, 'label', 'product-visually-hidden'), () => uiText("Search installed mods"));
        const search = createElement(doc, 'input', 'product-library-search');
        const searchId = nextId('installed-mod-search');
        search.id = searchId;
        search.type = 'search';
        uiRender(search, () => uiText("Search name, version, or provider"), "placeholder");
        search.autocomplete = 'off';
        searchLabel.setAttribute('for', searchId);

        const filterLabel = uiRender(createElement(doc, 'label', 'product-visually-hidden'), () => uiText("Filter mods"));
        const filter = createElement(doc, 'select', 'product-library-filter');
        const filterId = nextId('installed-mod-filter');
        filter.id = filterId;
        filterLabel.setAttribute('for', filterId);
        [
            ['all', 'All installed mods'],
            ['updates', 'Updates available'],
            ['attention', 'Needs attention'],
            ['healthy', 'Healthy']
        ].forEach(([value, label]) => {
            const option = uiRender(createElement(doc, 'option', null), () => uiText(label));
            option.value = value;
            option.setAttribute('value', value);
            filter.appendChild(option);
        });
        filter.value = 'all';

        const apply = () => {
            const query = safeText(search.value).trim().toLocaleLowerCase();
            const mode = safeText(filter.value, 'all');
            const visible = asArray(mods).filter(mod => {
                const searchable = [
                    mod.name,
                    mod.version,
                    mod.provider?.displayName,
                    mod.provider?.id
                ].map(value => safeText(value).toLocaleLowerCase()).join('\n');
                if (query && !searchable.includes(query)) return false;
                if (mode === 'updates') return mod.update?.state === 'available';
                if (mode === 'attention') return installedModNeedsAttention(mod);
                if (mode === 'healthy') return !installedModNeedsAttention(mod);
                return true;
            });
            if (typeof options.onFilter === 'function') options.onFilter(visible);
        };
        search.addEventListener('input', apply);
        filter.addEventListener('change', apply);
        toolbar.append(searchLabel, search, filterLabel, filter);
        return { element: toolbar, search, filter, apply };
    }

    function modelPreflightReview(model, mod) {
        const supplied = model.preflightReviews ?? model.preflightReports ?? model.preflightReview;
        if (supplied !== undefined) {
            const reviews = asArray(supplied).filter(review => review && typeof review === 'object');
            if (reviews.length === 0) return null;
            return reviews.find(review =>
                safeText(review.modInstanceId || review.mod_instance_id) === safeText(mod.id)
            ) || (reviews.length === 1 ? reviews[0] : null);
        }
        if (model.source === 'legacy-live') return null;

        const installed = {
            instanceId: mod.id,
            installationId: mod.installationId,
            displayName: mod.name,
            version: mod.version,
            archiveSha256: mod.archiveSha256,
            filePlanFingerprint: mod.filePlanFingerprint,
            provider: mod.provider,
            files: mod.files
        };
        const review = createPreflightReview(
            installed,
            mod,
            [],
            [],
            mod.conflicts,
            mod.health
        );
        return review.fileCount > 0 || review.archiveSha256 || review.filePlanFingerprint
            ? review
            : null;
    }

    function InstalledModsView(model = {}, options = {}) {
        const doc = getDocument(options);
        const view = createElement(doc, 'div', 'product-installed-mods-view');
        const state = safeText(options.state || model.status, 'ready');
        setData(view, 'view-state', state);

        if (state === 'loading' || state === 'skeleton') {
            view.appendChild(Skeleton({ document: doc, rows: options.skeletonRows || 2 }));
            return view;
        }

        const mods = asArray(model.mods);
        const startupRecoveryErrors = normalizedErrorList(
            model.startupRecoveryErrors || model.catalogErrors
        ).filter(isStartupRecoveryError);
        if (startupRecoveryErrors.length > 0) {
            view.appendChild(RecoveryErrorState(
                startupRecoveryErrors,
                {
                    document: doc,
                    ...options.error
                }
            ));
        } else if (state === 'offline') {
            view.appendChild(OfflineState({ document: doc, ...options.offline }));
        } else if (state === 'error') {
            view.appendChild(ErrorState({
                document: doc,
                message: () => errorMessage(model.productError || model.catalogErrors?.[0]),
                ...options.error
            }));
        } else if (state === 'empty' || mods.length === 0) {
            view.appendChild(EmptyState({ document: doc, ...options.empty }));
        }

        if (asArray(model.healthReports).length > 0) {
            view.appendChild(GameHealthSummary(model.healthReports, { document: doc }));
        }

        if (model.libraryWarning) {
            const warning = createElement(
                doc,
                'p',
                'product-library-warning',
                safeText(model.libraryWarning)
            );
            if (Number.isInteger(model.libraryWarningCount)) uiRender(warning, () => uiText(model.source === 'legacy-live' ? 'Installed records that could not be read: {0}.' : 'Local packages that could not be adopted safely: {0}.', uiNumber(model.libraryWarningCount)));
            warning.setAttribute('role', 'status');
            view.appendChild(warning);
        }

        if (model.operationProgress) {
            view.appendChild(OperationProgress(model.operationProgress, {
                document: doc,
                title: options.operationTitle
            }));
        }

        view.appendChild(OperationsCenter(model.operationRecords, {
            document: doc,
            locale: options.locale,
            onRecover: options.onRecoverOperation,
            recoveryUnavailableReason: options.recoveryUnavailableReason
        }));

        view.appendChild(RecoveryCenter(model.lifecycleJournals, {
            document: doc,
            locale: options.locale,
            onRestore: options.onRestore,
            startupRecoveryErrors,
            restoreUnavailableReason: options.restoreUnavailableReason
        }));

        view.appendChild(DiagnosticsPanel(
            model.diagnostics || createSanitizedDiagnostics(model, model.runtime),
            {
                document: doc,
                onCopy: options.onCopyDiagnostics
            }
        ));

        if (state === 'error' || state === 'offline' || state === 'empty' || mods.length === 0) {
            return view;
        }

        const summary = uiRender(createElement(doc, 'p', 'product-library-summary'), () => uiText('Installed packages: {0}', uiNumber(mods.length)));
        summary.setAttribute('role', 'status');
        const list = createElement(doc, 'div', 'product-mod-list');
        list.setAttribute('role', 'list');
        const renderFilteredMods = visible => {
            list.replaceChildren();
            visible.forEach(mod => list.appendChild(InstalledModCard(mod, {
                document: doc,
                locale: options.locale,
                preflightReview: modelPreflightReview(model, mod),
                onOpenFolder: options.onOpenFolder,
                onUpdate: options.onUpdate,
                onVerify: options.onVerify,
                onRepair: options.onRepair,
                onUninstall: options.onUninstall
            })));
            uiRender(summary, () => visible.length === mods.length
                ? uiText('Installed packages: {0}', uiNumber(mods.length))
                : uiText("{0} of {1} installed packages shown", uiNumber(visible.length), uiNumber(mods.length)));
            if (visible.length === 0) {
                list.appendChild(uiRender(createElement(doc, 'p', 'product-library-empty-filter'), () => uiText("No installed mods match this search.")));
            }
        };
        const toolbar = InstalledModsToolbar(mods, {
            document: doc,
            onFilter: renderFilteredMods
        });
        renderFilteredMods(mods);
        view.append(toolbar.element, summary, list);
        return view;
    }

    function renderInstalledModsV2(root, model = {}, options = {}) {
        if (!root || typeof root.replaceChildren !== 'function') {
            throw new TypeError('A root DOM element is required to render Installed Mods v2.');
        }
        const doc = options.document || root.ownerDocument;
        const view = InstalledModsView(model, { ...options, document: doc });
        root.replaceChildren(view);
        root.setAttribute('aria-busy', 'false');
        return view;
    }

    return Object.freeze({
        CONTRACT_SCHEMA_VERSION,
        LIVE_ADAPTER_UNAVAILABLE,
        InstalledModsAdapters,
        mapContractsV1Fixture,
        createFixtureInstalledModsAdapter,
        createLegacyLiveInstalledModsAdapter,
        createLifecycleLiveInstalledModsAdapter,
        mapLegacyModList,
        createUnavailableLiveInstalledModsAdapter,
        renderInstalledModsV2,
        InstalledModsView,
        InstalledModsToolbar,
        InstalledModCard,
        OperationProgress,
        OperationsCenter,
        RecoveryCenter,
        DiagnosticsPanel,
        createSanitizedDiagnostics,
        ProviderBadge,
        VerificationBadge,
        HealthBadge,
        GameHealthSummary,
        EmptyState,
        ErrorState,
        OfflineState,
        Skeleton,
        Confirmation,
        DangerConfirmation,
        ConflictDialog,
        Toast,
        NotificationCenter,
        safeExternalUrl
    });
});
