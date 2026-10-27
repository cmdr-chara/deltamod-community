'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { verifyRustlsLock } = require('./verify-rustls-lock.cjs');

function lock(rustls, webpki) {
  return `# Cargo.lock fixture\nversion = 4\n\n[[package]]\nname = "rustls"\nversion = "${rustls}"\n\n[[package]]\nname = "rustls-webpki"\nversion = "${webpki}"\n`;
}

test('accepts supported patched TLS dependencies', () => {
  assert.deepEqual(verifyRustlsLock(lock('0.23.46', '0.103.16')), {
    rustls: ['0.23.46'],
    'rustls-webpki': ['0.103.16'],
  });
  assert.doesNotThrow(() => verifyRustlsLock(lock('0.24.0', '0.104.0')));
});

test('rejects rustls affected by GHSA-2mjx-qc3c-rqvc', () => {
  assert.throws(() => verifyRustlsLock(lock('0.23.43', '0.103.16')), /rustls 0\.23\.43.*0\.23\.46/);
  assert.throws(() => verifyRustlsLock(lock('0.23.45', '0.103.16')), /rustls 0\.23\.45.*0\.23\.46/);
});

test('rejects an outdated rustls-webpki dependency', () => {
  assert.throws(() => verifyRustlsLock(lock('0.23.46', '0.103.13')), /rustls-webpki 0\.103\.13/);
});

test('checks every resolved package version, including duplicates', () => {
  assert.throws(() => verifyRustlsLock(lock('0.23.46', '0.103.16') + '\n[[package]]\nname = "rustls"\nversion = "0.23.43"\n'), /rustls 0\.23\.43/);
});

test('fails closed on missing packages and malformed versions', () => {
  assert.throws(() => verifyRustlsLock('version = 4'), /rustls is missing/);
  assert.throws(() => verifyRustlsLock(lock('not-a-version', '0.103.16')), /Unexpected Cargo dependency version/);
});
