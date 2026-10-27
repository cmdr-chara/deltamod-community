'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Keep the release's transitive TLS dependencies above published advisory floors.
const minimumVersions = {
  rustls: '0.23.46',
  'rustls-webpki': '0.103.16',
};

function parseVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Unexpected Cargo dependency version: ${version}`);
  }
  return version.split('.').map(Number);
}

function isOlder(version, minimum) {
  const current = parseVersion(version);
  const floor = parseVersion(minimum);
  for (let index = 0; index < floor.length; index += 1) {
    if (current[index] !== floor[index]) {
      return current[index] < floor[index];
    }
  }
  return false;
}

function verifyRustlsLock(contents) {
  const packages = new Map();
  for (const block of contents.split(/(?=^\[\[package\]\]\r?$)/m)) {
    if (!/^\[\[package\]\]\r?$/m.test(block)) continue;
    const name = /^name = "([^"]+)"\r?$/m.exec(block)?.[1];
    const version = /^version = "([^"]+)"\r?$/m.exec(block)?.[1];
    if (!name || !version) continue;
    if (!packages.has(name)) packages.set(name, []);
    packages.get(name).push(version);
  }

  const checked = {};
  for (const [name, minimum] of Object.entries(minimumVersions)) {
    const versions = packages.get(name) || [];
    if (versions.length === 0) {
      throw new Error(`Cannot verify TLS security: ${name} is missing from the Tauri lockfile`);
    }
    for (const version of versions) {
      if (isOlder(version, minimum)) {
        throw new Error(`${name} ${version} is below the required security floor ${minimum}. Run cargo update -p ${name} --precise ${minimum}.`);
      }
    }
    checked[name] = versions;
  }
  return checked;
}

if (require.main === module) {
  try {
    const lockPath = path.resolve(__dirname, '../src-tauri/Cargo.lock');
    const checked = verifyRustlsLock(fs.readFileSync(lockPath, 'utf8'));
    console.log('Tauri TLS dependencies verified:', JSON.stringify(checked));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { verifyRustlsLock };
