#![forbid(unsafe_code)]
#![warn(clippy::all)]

use flate2::read::GzDecoder;
use sevenz_rust2::{Archive as SevenArchive, ArchiveReader as SevenReader, Password};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use tempfile::{Builder, TempDir};
use thiserror::Error;

mod raw_package;

pub use raw_package::{RawPackage, RawPatch, RawPlan, MAX_CHAPTER, ROOT_DATA};

const COPY_BUFFER_BYTES: usize = 64 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ArchiveFormat {
    Zip,
    TarGz,
    TarLzma,
    SevenZip,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Limits {
    pub max_entries: usize,
    pub max_archive_bytes: u64,
    pub max_entry_bytes: u64,
    pub max_expanded_bytes: u64,
    pub max_ratio: u64,
    pub max_depth: usize,
    pub max_manifest_bytes: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_entries: 20_000,
            max_archive_bytes: 2 * 1024 * 1024 * 1024,
            max_entry_bytes: 2 * 1024 * 1024 * 1024,
            max_expanded_bytes: 4 * 1024 * 1024 * 1024,
            max_ratio: 200,
            max_depth: 32,
            max_manifest_bytes: 1024 * 1024,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DuplicateDecision {
    Replace,
    KeepExisting,
    Cancel,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExistingMod<'a> {
    pub package_id: &'a str,
    pub destination: &'a Path,
    pub old_version: Option<&'a str>,
    pub new_version: Option<&'a str>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImportResult {
    pub destination: PathBuf,
    pub package_id: String,
    pub format: ArchiveFormat,
    pub files: usize,
    pub expanded_bytes: u64,
    pub replaced_existing: bool,
}

pub struct StagedModArchive {
    _staging: TempDir,
    content_root: PathBuf,
    package_id: String,
    version: Option<String>,
    pub format: ArchiveFormat,
    pub files: usize,
    pub expanded_bytes: u64,
}

impl StagedModArchive {
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.content_root
    }

    #[must_use]
    pub fn package_id(&self) -> &str {
        &self.package_id
    }

    #[must_use]
    pub fn version(&self) -> Option<&str> {
        self.version.as_deref()
    }

    pub fn bind_identity(&self, unique_id: &str) -> Result<(), ImportError> {
        if unique_id.is_empty() || unique_id.len() > 256 || unique_id.chars().any(char::is_control)
        {
            return Err(ImportError::Manifest("installed identity is invalid"));
        }
        let identity = serde_json::to_vec(&serde_json::json!({
            "uniqueId": unique_id,
            "new": false
        }))
        .map_err(|_| ImportError::Manifest("identity metadata is invalid"))?;
        fs::write(self.content_root.join("__deltaID.json"), identity)?;
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GameImportResult {
    pub root: PathBuf,
    pub format: ArchiveFormat,
    pub files: usize,
    pub expanded_bytes: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LegacySourceMetadata {
    pub gamebanana_id: String,
    pub gamebanana_model: String,
}

impl LegacySourceMetadata {
    pub fn new(id: impl Into<String>, model: impl Into<String>) -> Result<Self, ImportError> {
        let value = Self {
            gamebanana_id: id.into(),
            gamebanana_model: model.into(),
        };
        if value.gamebanana_id.is_empty()
            || value.gamebanana_id.len() > 100
            || value.gamebanana_id.chars().any(char::is_control)
            || value.gamebanana_model.is_empty()
            || value.gamebanana_model.len() > 32
            || !value
                .gamebanana_model
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric())
        {
            return Err(ImportError::Manifest(
                "GameBanana source metadata is invalid",
            ));
        }
        Ok(value)
    }
}

#[derive(Debug, Error)]
pub enum ImportError {
    #[error("ARCHIVE_CANCELLED: archive import was cancelled")]
    Cancelled,
    #[error("ARCHIVE_UNSUPPORTED: unsupported or malformed archive")]
    Unsupported,
    #[error("ARCHIVE_UNSUPPORTED: RAR archives are not supported; re-pack the mod as .zip or .7z")]
    Rar,
    #[error("ARCHIVE_SOURCE: archive source is not a private regular file")]
    InvalidSource,
    #[error("ARCHIVE_LIMIT: {0}")]
    Limit(&'static str),
    #[error("ARCHIVE_UNSAFE_PATH: {0}")]
    UnsafePath(String),
    #[error("ARCHIVE_DUPLICATE_PATH: {0}")]
    DuplicatePath(String),
    #[error("ARCHIVE_ENTRY_TYPE: links and special entries are forbidden: {0}")]
    EntryType(String),
    #[error("ARCHIVE_MANIFEST: {0}")]
    Manifest(&'static str),
    #[error("ARCHIVE_DESTINATION: {0}")]
    Destination(&'static str),
    #[error("ARCHIVE_KEPT_EXISTING: existing mod was kept")]
    KeptExisting,
    #[error("ARCHIVE_IO: {0}")]
    Io(#[from] io::Error),
    #[error("ARCHIVE_FORMAT: {0}")]
    Format(String),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum EntryKind {
    File,
    Directory,
}

#[derive(Clone, Debug)]
struct EntryPlan {
    path: PathBuf,
    folded: String,
    size: u64,
    compressed: Option<u64>,
    kind: EntryKind,
}

#[derive(Debug)]
struct Inventory {
    entries: Vec<EntryPlan>,
    files: usize,
    expanded: u64,
}

#[derive(Debug)]
struct Manifest {
    package_id: String,
    version: Option<String>,
}

struct LimitedWriter<'a, C> {
    file: File,
    written: u64,
    limit: u64,
    cancelled: &'a C,
}

impl<C: Fn() -> bool> Write for LimitedWriter<'_, C> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if (self.cancelled)() {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "cancelled"));
        }
        let next = self
            .written
            .checked_add(bytes.len() as u64)
            .ok_or_else(|| io::Error::other("LZMA output size overflow"))?;
        if next > self.limit {
            return Err(io::Error::other("LZMA output size limit exceeded"));
        }
        let written = self.file.write(bytes)?;
        self.written += written as u64;
        Ok(written)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.file.flush()
    }
}

fn decode_lzma<C: Fn() -> bool>(
    archive: &Path,
    limit: u64,
    cancelled: &C,
) -> Result<tempfile::NamedTempFile, ImportError> {
    let decoded = tempfile::NamedTempFile::new()?;
    let mut writer = LimitedWriter {
        file: decoded.reopen()?,
        written: 0,
        limit,
        cancelled,
    };
    lzma_rs::lzma_decompress(&mut BufReader::new(File::open(archive)?), &mut writer).map_err(
        |error| {
            if cancelled() {
                ImportError::Cancelled
            } else {
                ImportError::Format(error.to_string())
            }
        },
    )?;
    writer.flush()?;
    Ok(decoded)
}

pub fn detect_format(path: &Path) -> Result<ArchiveFormat, ImportError> {
    let mut file = File::open(path)?;
    let mut signature = [0_u8; 8];
    let read = file.read(&mut signature)?;
    let bytes = &signature[..read];
    if bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06") {
        return Ok(ArchiveFormat::Zip);
    }
    if bytes.starts_with(b"7z\xBC\xAF\x27\x1C") {
        return Ok(ArchiveFormat::SevenZip);
    }
    if bytes.starts_with(&[0x1f, 0x8b]) {
        return Ok(ArchiveFormat::TarGz);
    }
    // RAR starts with "Rar!" (0x52), which would otherwise pass the LZMA property check.
    if bytes.starts_with(b"Rar!\x1a\x07") {
        return Err(ImportError::Rar);
    }
    // LZMA-alone property bytes are 0..=224. The following dictionary size is
    // validated by the decoder; tar validation prevents treating arbitrary data as an archive.
    if bytes.first().is_some_and(|value| *value <= 224) {
        return Ok(ArchiveFormat::TarLzma);
    }
    Err(ImportError::Unsupported)
}

pub fn import_archive<C, D>(
    archive: &Path,
    packet_root: &Path,
    limits: Limits,
    cancelled: C,
    duplicate: D,
) -> Result<ImportResult, ImportError>
where
    C: Fn() -> bool,
    D: FnOnce(ExistingMod<'_>) -> DuplicateDecision,
{
    import_archive_with_source(archive, packet_root, limits, None, cancelled, duplicate)
}

/// Extracts and validates a mod archive without publishing it. The returned
/// private staging directory is deleted automatically unless the caller keeps
/// the object alive while a transactional publisher consumes its files.
pub fn stage_mod_archive<C: Fn() -> bool>(
    archive: &Path,
    staging_parent: &Path,
    limits: Limits,
    cancelled: C,
) -> Result<StagedModArchive, ImportError> {
    check_cancelled(&cancelled)?;
    validate_limits(limits)?;
    let source = fs::symlink_metadata(archive).map_err(|_| ImportError::InvalidSource)?;
    if !source.file_type().is_file()
        || source.file_type().is_symlink()
        || source.len() == 0
        || source.len() > limits.max_archive_bytes
    {
        return Err(ImportError::InvalidSource);
    }
    fs::create_dir_all(staging_parent)?;
    let parent_metadata = fs::symlink_metadata(staging_parent)?;
    if !parent_metadata.is_dir() || parent_metadata.file_type().is_symlink() {
        return Err(ImportError::Destination("archive staging parent is unsafe"));
    }
    let staging_parent = fs::canonicalize(staging_parent)?;
    let format = detect_format(archive)?;
    let inventory = inventory(archive, format, source.len(), limits, &cancelled)?;
    let source_after_inventory = fs::metadata(archive)?;
    if source_after_inventory.len() != source.len()
        || source_after_inventory.modified().ok() != source.modified().ok()
    {
        return Err(ImportError::InvalidSource);
    }
    let staging = Builder::new()
        .prefix(".mod-lifecycle-")
        .tempdir_in(staging_parent)?;
    extract(
        archive,
        format,
        &inventory,
        staging.path(),
        limits,
        &cancelled,
    )?;
    validate_tree(staging.path(), limits, &cancelled)?;
    let content_root = identify_content_root(staging.path())?;
    normalize_legacy_manifest(&content_root, limits.max_manifest_bytes)?;
    // Conversion can replace a JSON file with a larger TOML file and can
    // introduce canonical names (for example, meta.toml). Re-run the same
    // containment, collision and expanded-size checks over the normalized
    // tree before exposing it to a lifecycle caller.
    validate_tree(staging.path(), limits, &cancelled)?;
    let manifest = read_manifest(&content_root, limits.max_manifest_bytes)?;
    if !content_root.join("modding.xml").is_file() {
        return Err(ImportError::Manifest("root modding.xml is missing"));
    }
    check_cancelled(&cancelled)?;
    Ok(StagedModArchive {
        _staging: staging,
        content_root,
        package_id: manifest.package_id,
        version: manifest.version,
        format,
        files: inventory.files,
        expanded_bytes: inventory.expanded,
    })
}

/// Extracts a downloaded game into a missing private destination and publishes it
/// only after the complete tree and the packaged executable contract validate.
pub fn import_game_archive<C: Fn() -> bool>(
    archive: &Path,
    destination: &Path,
    executable: &str,
    limits: Limits,
    cancelled: C,
) -> Result<GameImportResult, ImportError> {
    check_cancelled(&cancelled)?;
    validate_limits(limits)?;
    if executable.is_empty()
        || executable.len() > 160
        || executable.contains(['/', '\\'])
        || executable.chars().any(char::is_control)
        || destination.exists()
    {
        return Err(ImportError::Destination("invalid game destination"));
    }
    let source = fs::symlink_metadata(archive).map_err(|_| ImportError::InvalidSource)?;
    if !source.is_file()
        || source.file_type().is_symlink()
        || source.len() == 0
        || source.len() > limits.max_archive_bytes
    {
        return Err(ImportError::InvalidSource);
    }
    let parent = destination
        .parent()
        .ok_or(ImportError::Destination("game destination has no parent"))?;
    fs::create_dir_all(parent)?;
    let parent_metadata = fs::symlink_metadata(parent)?;
    if !parent_metadata.is_dir() || parent_metadata.file_type().is_symlink() {
        return Err(ImportError::Destination(
            "game destination parent is unsafe",
        ));
    }
    let parent = fs::canonicalize(parent)?;
    let format = detect_format(archive)?;
    let inventory = inventory(archive, format, source.len(), limits, &cancelled)?;
    let after = fs::metadata(archive)?;
    if after.len() != source.len() || after.modified().ok() != source.modified().ok() {
        return Err(ImportError::InvalidSource);
    }
    let staging = Builder::new().prefix(".game-import-").tempdir_in(&parent)?;
    extract(
        archive,
        format,
        &inventory,
        staging.path(),
        limits,
        &cancelled,
    )?;
    validate_tree(staging.path(), limits, &cancelled)?;
    let content_root = identify_content_root(staging.path())?;
    let executable_path = content_root.join(executable);
    let executable_metadata = fs::symlink_metadata(&executable_path)
        .map_err(|_| ImportError::Destination("packaged game executable is missing"))?;
    if !executable_metadata.is_file() || executable_metadata.file_type().is_symlink() {
        return Err(ImportError::Destination(
            "packaged game executable is invalid",
        ));
    }
    check_cancelled(&cancelled)?;
    let commit_source = if content_root == staging.path() {
        staging.keep()
    } else {
        let detached = Builder::new().prefix(".game-commit-").tempdir_in(&parent)?;
        fs::remove_dir(detached.path())?;
        fs::rename(&content_root, detached.path())?;
        detached.keep()
    };
    fs::rename(&commit_source, destination)?;
    Ok(GameImportResult {
        root: destination.to_path_buf(),
        format,
        files: inventory.files,
        expanded_bytes: inventory.expanded,
    })
}

pub fn import_archive_with_source<C, D>(
    archive: &Path,
    packet_root: &Path,
    limits: Limits,
    source_metadata: Option<&LegacySourceMetadata>,
    cancelled: C,
    duplicate: D,
) -> Result<ImportResult, ImportError>
where
    C: Fn() -> bool,
    D: FnOnce(ExistingMod<'_>) -> DuplicateDecision,
{
    import_archive_with_resolver(
        archive,
        packet_root,
        limits,
        source_metadata,
        cancelled,
        duplicate,
        |_| None,
    )
}

/// Like [`import_archive_with_source`], but a package with no manifest that
/// contains patch files (a Deltahub/G3M "raw" package) is passed to `resolve`.
/// Returning `None` cancels the import.
pub fn import_archive_with_resolver<C, D, R>(
    archive: &Path,
    packet_root: &Path,
    limits: Limits,
    source_metadata: Option<&LegacySourceMetadata>,
    cancelled: C,
    duplicate: D,
    resolve: R,
) -> Result<ImportResult, ImportError>
where
    C: Fn() -> bool,
    D: FnOnce(ExistingMod<'_>) -> DuplicateDecision,
    R: FnOnce(&RawPackage) -> Option<RawPlan>,
{
    check_cancelled(&cancelled)?;
    validate_limits(limits)?;
    let source = fs::symlink_metadata(archive).map_err(|_| ImportError::InvalidSource)?;
    if !source.file_type().is_file() || source.file_type().is_symlink() {
        return Err(ImportError::InvalidSource);
    }
    if source.len() == 0 || source.len() > limits.max_archive_bytes {
        return Err(ImportError::Limit("compressed archive size limit exceeded"));
    }

    let format = detect_format(archive)?;
    let inventory = inventory(archive, format, source.len(), limits, &cancelled)?;
    let source_after_inventory = fs::metadata(archive)?;
    if source_after_inventory.len() != source.len()
        || source_after_inventory.modified().ok() != source.modified().ok()
    {
        return Err(ImportError::InvalidSource);
    }

    fs::create_dir_all(packet_root)?;
    let packet_root = fs::canonicalize(packet_root)?;
    let staging = Builder::new()
        .prefix(".mod-import-")
        .tempdir_in(&packet_root)?;
    extract(
        archive,
        format,
        &inventory,
        staging.path(),
        limits,
        &cancelled,
    )?;
    validate_tree(staging.path(), limits, &cancelled)?;
    let content_root = identify_content_root(staging.path())?;
    normalize_legacy_manifest(&content_root, limits.max_manifest_bytes)?;
    if fs::symlink_metadata(content_root.join("meta.toml")).is_err() {
        if let Some(package) = raw_package::inspect(&content_root)? {
            let plan = resolve(&package).ok_or(ImportError::Cancelled)?;
            check_cancelled(&cancelled)?;
            raw_package::write_manifest(&content_root, &package, &plan, limits.max_manifest_bytes)?;
        }
    }
    validate_tree(staging.path(), limits, &cancelled)?;
    let manifest = read_manifest(&content_root, limits.max_manifest_bytes)?;
    if !content_root.join("modding.xml").is_file() {
        return Err(ImportError::Manifest("root modding.xml is missing"));
    }
    if let Some(source_metadata) = source_metadata {
        write_source_metadata(&content_root, limits.max_manifest_bytes, source_metadata)?;
    }

    let destination = packet_root.join(&manifest.package_id);
    if destination.parent() != Some(packet_root.as_path()) {
        return Err(ImportError::Destination(
            "package destination escaped packet root",
        ));
    }
    let existing_version = if destination.exists() {
        read_manifest(&destination, limits.max_manifest_bytes)
            .ok()
            .and_then(|value| value.version)
    } else {
        None
    };
    let decision = if destination.exists() {
        duplicate(ExistingMod {
            package_id: &manifest.package_id,
            destination: &destination,
            old_version: existing_version.as_deref(),
            new_version: manifest.version.as_deref(),
        })
    } else {
        DuplicateDecision::Replace
    };
    match decision {
        DuplicateDecision::KeepExisting => {
            return Err(ImportError::KeptExisting);
        }
        DuplicateDecision::Cancel => return Err(ImportError::Cancelled),
        DuplicateDecision::Replace => {}
    }
    check_cancelled(&cancelled)?;

    write_identity(&content_root, &destination)?;

    let commit_source = if content_root == staging.path() {
        staging.keep()
    } else {
        let detached = Builder::new()
            .prefix(".mod-commit-")
            .tempdir_in(&packet_root)?;
        fs::remove_dir(detached.path())?;
        fs::rename(&content_root, detached.path())?;
        detached.keep()
    };
    let replaced_existing = destination.exists();
    commit(commit_source, &destination, replaced_existing)?;
    Ok(ImportResult {
        destination,
        package_id: manifest.package_id,
        format,
        files: inventory.files,
        expanded_bytes: inventory.expanded,
        replaced_existing,
    })
}

fn write_identity(root: &Path, destination: &Path) -> Result<(), ImportError> {
    let existing = destination.join("__deltaID.json");
    let identity = fs::read(&existing)
        .ok()
        .filter(|bytes| bytes.len() <= 64 * 1024)
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .filter(|value| {
            value
                .get("uniqueId")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|id| {
                    !id.is_empty() && id.len() <= 256 && !id.chars().any(char::is_control)
                })
        })
        .unwrap_or_else(|| {
            serde_json::json!({
                "uniqueId": uuid::Uuid::new_v4().to_string(),
                "new": true
            })
        });
    let bytes = serde_json::to_vec_pretty(&identity)
        .map_err(|_| ImportError::Manifest("mod identity could not be serialized"))?;
    fs::write(root.join("__deltaID.json"), bytes)?;
    Ok(())
}

fn write_source_metadata(
    root: &Path,
    max_bytes: u64,
    source: &LegacySourceMetadata,
) -> Result<(), ImportError> {
    let path = root.join("meta.toml");
    let text =
        fs::read_to_string(&path).map_err(|_| ImportError::Manifest("meta.toml is not UTF-8"))?;
    let mut value = toml::from_str::<toml::Value>(&text)
        .map_err(|_| ImportError::Manifest("meta.toml is invalid"))?;
    let metadata = value
        .get_mut("metadata")
        .and_then(toml::Value::as_table_mut)
        .ok_or(ImportError::Manifest("metadata table is missing"))?;
    metadata.insert(
        "gamebanana_id".into(),
        toml::Value::String(source.gamebanana_id.clone()),
    );
    metadata.insert(
        "gamebanana_model".into(),
        toml::Value::String(source.gamebanana_model.clone()),
    );
    let serialized = toml::to_string(&value)
        .map_err(|_| ImportError::Manifest("meta.toml could not be serialized"))?;
    if serialized.len() as u64 > max_bytes {
        return Err(ImportError::Manifest("meta.toml has an invalid size"));
    }
    fs::write(path, serialized)?;
    Ok(())
}

fn validate_limits(limits: Limits) -> Result<(), ImportError> {
    if limits.max_entries == 0
        || limits.max_archive_bytes == 0
        || limits.max_entry_bytes == 0
        || limits.max_expanded_bytes == 0
        || limits.max_ratio == 0
        || limits.max_depth == 0
        || limits.max_manifest_bytes == 0
    {
        return Err(ImportError::Limit("limits must be non-zero"));
    }
    Ok(())
}

fn check_cancelled(cancelled: &impl Fn() -> bool) -> Result<(), ImportError> {
    if cancelled() {
        Err(ImportError::Cancelled)
    } else {
        Ok(())
    }
}

fn normalize_entry(name: &str, limits: Limits) -> Result<(PathBuf, String), ImportError> {
    if name.is_empty()
        || name.starts_with('/')
        || name.starts_with('\\')
        || name.chars().any(char::is_control)
    {
        return Err(ImportError::UnsafePath(name.into()));
    }
    let mut path = PathBuf::new();
    let mut folded = Vec::new();
    for component in name.split(['/', '\\']).filter(|value| !value.is_empty()) {
        let trimmed = component.trim_end_matches([' ', '.']);
        let stem = trimmed.split('.').next().unwrap_or_default();
        let reserved = matches!(
            stem.to_ascii_uppercase().as_str(),
            "CON"
                | "PRN"
                | "AUX"
                | "NUL"
                | "COM1"
                | "COM2"
                | "COM3"
                | "COM4"
                | "COM5"
                | "COM6"
                | "COM7"
                | "COM8"
                | "COM9"
                | "LPT1"
                | "LPT2"
                | "LPT3"
                | "LPT4"
                | "LPT5"
                | "LPT6"
                | "LPT7"
                | "LPT8"
                | "LPT9"
        );
        if component == "."
            || component == ".."
            || trimmed != component
            || trimmed.is_empty()
            || component.contains(':')
            || reserved
        {
            return Err(ImportError::UnsafePath(name.into()));
        }
        path.push(component);
        folded.push(component.to_ascii_lowercase());
    }
    if folded.is_empty() || folded.len() > limits.max_depth {
        return Err(ImportError::UnsafePath(name.into()));
    }
    Ok((path, folded.join("/")))
}

fn finish_inventory(
    entries: Vec<EntryPlan>,
    archive_bytes: u64,
    limits: Limits,
) -> Result<Inventory, ImportError> {
    if entries.is_empty() || entries.len() > limits.max_entries {
        return Err(ImportError::Limit("archive entry count limit exceeded"));
    }
    let mut names = BTreeMap::<String, EntryKind>::new();
    let mut expanded = 0_u64;
    let mut files = 0_usize;
    for entry in &entries {
        if names.insert(entry.folded.clone(), entry.kind).is_some() {
            return Err(ImportError::DuplicatePath(entry.path.display().to_string()));
        }
        if entry.kind == EntryKind::File {
            let child_prefix = format!("{}/", entry.folded);
            if names.keys().any(|name| name.starts_with(&child_prefix)) {
                return Err(ImportError::DuplicatePath(entry.path.display().to_string()));
            }
        }
        let mut parent = entry.path.parent();
        while let Some(value) = parent.filter(|value| !value.as_os_str().is_empty()) {
            let key = value
                .to_string_lossy()
                .replace('\\', "/")
                .to_ascii_lowercase();
            if names.get(&key).is_some_and(|kind| *kind == EntryKind::File) {
                return Err(ImportError::DuplicatePath(entry.path.display().to_string()));
            }
            parent = value.parent();
        }
        if entry.kind == EntryKind::File {
            files += 1;
            if entry.size > limits.max_entry_bytes {
                return Err(ImportError::Limit("individual entry size limit exceeded"));
            }
            if entry.compressed == Some(0) && entry.size > 0 {
                return Err(ImportError::Limit("invalid compressed entry size"));
            }
            if entry
                .compressed
                .is_some_and(|size| size > 0 && entry.size / size.max(1) > limits.max_ratio)
            {
                return Err(ImportError::Limit(
                    "individual compression ratio limit exceeded",
                ));
            }
            expanded = expanded
                .checked_add(entry.size)
                .ok_or(ImportError::Limit("expanded size overflow"))?;
        }
    }
    if files == 0 || expanded > limits.max_expanded_bytes {
        return Err(ImportError::Limit("expanded archive size limit exceeded"));
    }
    if expanded / archive_bytes.max(1) > limits.max_ratio {
        return Err(ImportError::Limit(
            "archive compression ratio limit exceeded",
        ));
    }
    Ok(Inventory {
        entries,
        files,
        expanded,
    })
}

fn inventory(
    archive: &Path,
    format: ArchiveFormat,
    archive_bytes: u64,
    limits: Limits,
    cancelled: &impl Fn() -> bool,
) -> Result<Inventory, ImportError> {
    let entries = match format {
        ArchiveFormat::Zip => inventory_zip(archive, limits, cancelled)?,
        ArchiveFormat::TarGz => inventory_tar(
            GzDecoder::new(BufReader::new(File::open(archive)?)),
            limits,
            cancelled,
        )?,
        ArchiveFormat::TarLzma => {
            let decoded = decode_lzma(archive, limits.max_expanded_bytes, cancelled)?;
            inventory_tar(decoded.reopen()?, limits, cancelled)?
        }
        ArchiveFormat::SevenZip => inventory_seven(archive, limits, cancelled)?,
    };
    finish_inventory(entries, archive_bytes, limits)
}

fn inventory_zip(
    path: &Path,
    limits: Limits,
    cancelled: &impl Fn() -> bool,
) -> Result<Vec<EntryPlan>, ImportError> {
    let mut archive = zip::ZipArchive::new(File::open(path)?)
        .map_err(|error| ImportError::Format(error.to_string()))?;
    if archive.len() > limits.max_entries {
        return Err(ImportError::Limit("archive entry count limit exceeded"));
    }
    let mut entries = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        check_cancelled(cancelled)?;
        let file = archive
            .by_index(index)
            .map_err(|error| ImportError::Format(error.to_string()))?;
        let (path, folded) = normalize_entry(file.name(), limits)?;
        let mode = file.unix_mode().unwrap_or(0);
        let file_type = mode & 0o170000;
        let kind = if file.is_dir() || file_type == 0o040000 {
            EntryKind::Directory
        } else if file_type == 0 || file_type == 0o100000 {
            EntryKind::File
        } else {
            return Err(ImportError::EntryType(file.name().into()));
        };
        entries.push(EntryPlan {
            path,
            folded,
            size: file.size(),
            compressed: Some(file.compressed_size()),
            kind,
        });
    }
    Ok(entries)
}

fn inventory_tar<R: Read>(
    reader: R,
    limits: Limits,
    cancelled: &impl Fn() -> bool,
) -> Result<Vec<EntryPlan>, ImportError> {
    let mut archive = tar::Archive::new(reader);
    let mut plans = Vec::new();
    for item in archive.entries()? {
        check_cancelled(cancelled)?;
        if plans.len() >= limits.max_entries {
            return Err(ImportError::Limit("archive entry count limit exceeded"));
        }
        let entry = item?;
        let raw = entry.path_bytes();
        let name = std::str::from_utf8(&raw)
            .map_err(|_| ImportError::UnsafePath("non-UTF-8 archive path".into()))?;
        let (path, folded) = normalize_entry(name, limits)?;
        let kind = if entry.header().entry_type().is_dir() {
            EntryKind::Directory
        } else if entry.header().entry_type().is_file() {
            EntryKind::File
        } else {
            return Err(ImportError::EntryType(name.into()));
        };
        plans.push(EntryPlan {
            path,
            folded,
            size: entry.size(),
            compressed: None,
            kind,
        });
    }
    Ok(plans)
}

fn inventory_seven(
    path: &Path,
    limits: Limits,
    cancelled: &impl Fn() -> bool,
) -> Result<Vec<EntryPlan>, ImportError> {
    let archive =
        SevenArchive::open(path).map_err(|error| ImportError::Format(error.to_string()))?;
    if archive.files.len() > limits.max_entries {
        return Err(ImportError::Limit("archive entry count limit exceeded"));
    }
    validate_seven_block_ratios(&archive, limits, cancelled)?;
    archive
        .files
        .iter()
        .map(|entry| {
            check_cancelled(cancelled)?;
            let (path, folded) = normalize_entry(entry.name(), limits)?;
            if entry.is_anti_item()
                || entry.has_windows_attributes && entry.windows_attributes() & 0x400 != 0
            {
                return Err(ImportError::EntryType(entry.name().into()));
            }
            Ok(EntryPlan {
                path,
                folded,
                size: entry.size(),
                // A solid block shares compressed bytes among its members. The
                // reader assigns a packed size only to the first member; zero
                // on later members does not mean an invalid compressed stream.
                // Ratios are checked once per block above, including non-solid
                // single-file blocks. Individual expanded sizes remain bounded.
                compressed: None,
                kind: if entry.is_directory() {
                    EntryKind::Directory
                } else {
                    EntryKind::File
                },
            })
        })
        .collect()
}

fn validate_seven_block_ratios(
    archive: &SevenArchive,
    limits: Limits,
    cancelled: &impl Fn() -> bool,
) -> Result<(), ImportError> {
    let starts = archive.stream_map.block_first_pack_stream_index();
    if starts.len() != archive.blocks.len() {
        return Err(ImportError::Format("7z block stream map mismatch".into()));
    }
    for (index, block) in archive.blocks.iter().enumerate() {
        check_cancelled(cancelled)?;
        // Multiple packed streams can feed one block (for example BCJ2).
        // Count those bytes once, rather than once per extracted member.
        let end = starts
            .get(index + 1)
            .copied()
            .unwrap_or(archive.pack_sizes().len());
        let streams = archive
            .pack_sizes()
            .get(starts[index]..end)
            .filter(|streams| !streams.is_empty())
            .ok_or_else(|| ImportError::Format("7z block stream range is invalid".into()))?;
        let compressed = streams.iter().try_fold(0_u64, |total, size| {
            total
                .checked_add(*size)
                .ok_or(ImportError::Limit("compressed block size overflow"))
        })?;
        let expanded = block.get_unpack_size();
        if compressed == 0 && expanded > 0 {
            return Err(ImportError::Limit("invalid compressed block size"));
        }
        if u128::from(expanded) > u128::from(compressed) * u128::from(limits.max_ratio) {
            return Err(ImportError::Limit(
                "7z block compression ratio limit exceeded",
            ));
        }
    }
    Ok(())
}

fn extract(
    archive: &Path,
    format: ArchiveFormat,
    inventory: &Inventory,
    staging: &Path,
    limits: Limits,
    cancelled: &impl Fn() -> bool,
) -> Result<(), ImportError> {
    match format {
        ArchiveFormat::Zip => extract_zip(archive, inventory, staging, limits, cancelled),
        ArchiveFormat::TarGz => extract_tar(
            GzDecoder::new(BufReader::new(File::open(archive)?)),
            inventory,
            staging,
            limits,
            cancelled,
        ),
        ArchiveFormat::TarLzma => {
            let decoded = decode_lzma(archive, limits.max_expanded_bytes, cancelled)?;
            extract_tar(decoded.reopen()?, inventory, staging, limits, cancelled)
        }
        ArchiveFormat::SevenZip => extract_seven(archive, inventory, staging, limits, cancelled),
    }
}

fn prepare_destination(staging: &Path, plan: &EntryPlan) -> Result<Option<File>, ImportError> {
    let destination = staging.join(&plan.path);
    if plan.kind == EntryKind::Directory {
        fs::create_dir_all(destination)?;
        return Ok(None);
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map(Some)
        .map_err(ImportError::Io)
}

fn copy_bounded<R: Read + ?Sized>(
    reader: &mut R,
    writer: &mut File,
    expected: u64,
    limits: Limits,
    cancelled: &impl Fn() -> bool,
) -> Result<(), ImportError> {
    let mut buffer = [0_u8; COPY_BUFFER_BYTES];
    let mut written = 0_u64;
    loop {
        check_cancelled(cancelled)?;
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        written = written
            .checked_add(read as u64)
            .ok_or(ImportError::Limit("entry size overflow"))?;
        if written > expected || written > limits.max_entry_bytes {
            return Err(ImportError::Limit("entry exceeded its declared size"));
        }
        io::Write::write_all(writer, &buffer[..read])?;
    }
    if written != expected {
        return Err(ImportError::Format(
            "entry size did not match inventory".into(),
        ));
    }
    writer.sync_all()?;
    Ok(())
}

fn extract_zip(
    path: &Path,
    inventory: &Inventory,
    staging: &Path,
    limits: Limits,
    cancelled: &impl Fn() -> bool,
) -> Result<(), ImportError> {
    let mut archive = zip::ZipArchive::new(File::open(path)?)
        .map_err(|error| ImportError::Format(error.to_string()))?;
    for (index, plan) in inventory.entries.iter().enumerate() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| ImportError::Format(error.to_string()))?;
        if let Some(mut output) = prepare_destination(staging, plan)? {
            copy_bounded(&mut entry, &mut output, plan.size, limits, cancelled)?;
        }
    }
    Ok(())
}

fn extract_tar<R: Read>(
    reader: R,
    inventory: &Inventory,
    staging: &Path,
    limits: Limits,
    cancelled: &impl Fn() -> bool,
) -> Result<(), ImportError> {
    let mut archive = tar::Archive::new(reader);
    for (item, plan) in archive.entries()?.zip(&inventory.entries) {
        let mut entry = item?;
        if let Some(mut output) = prepare_destination(staging, plan)? {
            copy_bounded(&mut entry, &mut output, plan.size, limits, cancelled)?;
        }
    }
    Ok(())
}

fn extract_seven(
    path: &Path,
    inventory: &Inventory,
    staging: &Path,
    limits: Limits,
    cancelled: &impl Fn() -> bool,
) -> Result<(), ImportError> {
    let mut plans = inventory
        .entries
        .iter()
        .map(|plan| (plan.folded.clone(), plan))
        .collect::<BTreeMap<_, _>>();
    let mut reader = SevenReader::open(path, Password::empty())
        .map_err(|error| ImportError::Format(error.to_string()))?;
    reader
        .for_each_entries(|entry, stream| {
            let (_, folded) = normalize_entry(entry.name(), limits)
                .map_err(|error| sevenz_rust2::Error::Other(error.to_string().into()))?;
            let plan = plans
                .remove(&folded)
                .ok_or_else(|| sevenz_rust2::Error::Other("inventory mismatch".into()))?;
            if let Some(mut output) = prepare_destination(staging, plan)
                .map_err(|error| sevenz_rust2::Error::Other(error.to_string().into()))?
            {
                copy_bounded(stream, &mut output, plan.size, limits, cancelled)
                    .map_err(|error| sevenz_rust2::Error::Other(error.to_string().into()))?;
            }
            Ok(true)
        })
        .map_err(|error| ImportError::Format(error.to_string()))?;
    if !plans.is_empty() {
        return Err(ImportError::Format("7z inventory mismatch".into()));
    }
    Ok(())
}

fn validate_tree(
    root: &Path,
    limits: Limits,
    cancelled: &impl Fn() -> bool,
) -> Result<(), ImportError> {
    let canonical_root = fs::canonicalize(root)?;
    let mut queue = vec![(canonical_root.clone(), 0_usize)];
    let mut folded = BTreeSet::new();
    let mut files = 0_usize;
    let mut bytes = 0_u64;
    while let Some((directory, depth)) = queue.pop() {
        check_cancelled(cancelled)?;
        for item in fs::read_dir(&directory)? {
            let entry = item?;
            let metadata = fs::symlink_metadata(entry.path())?;
            if metadata.file_type().is_symlink() {
                return Err(ImportError::EntryType(entry.path().display().to_string()));
            }
            let canonical = fs::canonicalize(entry.path())?;
            if !canonical.starts_with(&canonical_root) {
                return Err(ImportError::UnsafePath(entry.path().display().to_string()));
            }
            let relative = canonical
                .strip_prefix(&canonical_root)
                .map_err(|_| ImportError::UnsafePath(entry.path().display().to_string()))?;
            let key = relative
                .to_string_lossy()
                .replace('\\', "/")
                .to_ascii_lowercase();
            if !folded.insert(key) {
                return Err(ImportError::DuplicatePath(relative.display().to_string()));
            }
            if metadata.is_dir() {
                if depth + 1 > limits.max_depth {
                    return Err(ImportError::Limit("extracted tree depth limit exceeded"));
                }
                queue.push((canonical, depth + 1));
            } else if metadata.is_file() {
                files += 1;
                bytes = bytes
                    .checked_add(metadata.len())
                    .ok_or(ImportError::Limit("extracted tree size overflow"))?;
                if files > limits.max_entries || bytes > limits.max_expanded_bytes {
                    return Err(ImportError::Limit("extracted tree limit exceeded"));
                }
            } else {
                return Err(ImportError::EntryType(entry.path().display().to_string()));
            }
        }
    }
    Ok(())
}

fn identify_content_root(staging: &Path) -> Result<PathBuf, ImportError> {
    let entries = fs::read_dir(staging)?.collect::<Result<Vec<_>, _>>()?;
    let content = entries
        .iter()
        .filter(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            name != "__MACOSX" && name != ".DS_Store" && !name.starts_with("._")
        })
        .collect::<Vec<_>>();
    // Wrapper detection ignores Finder metadata only after the entire archive
    // was inventoried, size-bounded, extracted and link/path-validated.
    if content.len() == 1 && content[0].file_type()?.is_dir() {
        Ok(content[0].path())
    } else {
        Ok(staging.to_path_buf())
    }
}

fn json_to_toml(value: serde_json::Value) -> Result<toml::Value, ImportError> {
    match value {
        serde_json::Value::Null => Err(ImportError::Manifest("legacy JSON contains null")),
        serde_json::Value::Bool(value) => Ok(toml::Value::Boolean(value)),
        serde_json::Value::Number(value) => {
            if let Some(value) = value.as_i64() {
                Ok(toml::Value::Integer(value))
            } else if let Some(value) = value.as_u64() {
                i64::try_from(value)
                    .map(toml::Value::Integer)
                    .map_err(|_| ImportError::Manifest("legacy JSON integer is out of range"))
            } else {
                value
                    .as_f64()
                    .filter(|value| value.is_finite())
                    .map(toml::Value::Float)
                    .ok_or(ImportError::Manifest(
                        "legacy JSON contains an invalid number",
                    ))
            }
        }
        serde_json::Value::String(value) => Ok(toml::Value::String(value)),
        serde_json::Value::Array(values) => values
            .into_iter()
            .map(json_to_toml)
            .collect::<Result<Vec<_>, _>>()
            .map(toml::Value::Array),
        serde_json::Value::Object(values) => values
            .into_iter()
            .map(|(key, value)| Ok((key, json_to_toml(value)?)))
            .collect::<Result<toml::map::Map<_, _>, ImportError>>()
            .map(toml::Value::Table),
    }
}

fn normalize_legacy_manifest(root: &Path, max_bytes: u64) -> Result<(), ImportError> {
    let json_path = root.join("meta.json");
    let wrapper_path = root.join("_deltamodInfo.json");
    let icon_path = root.join("icon.png");
    let wrapper_icon_path = root.join("_icon.png");
    let toml_path = root.join("meta.toml");
    // A canonical TOML manifest is authoritative. Leave any legacy JSON in
    // place so a package cannot accidentally have its identity replaced by a
    // stale sidecar.
    if toml_path.exists() {
        if !icon_path.exists() && wrapper_icon_path.exists() {
            fs::rename(wrapper_icon_path, icon_path)?;
        }
        return Ok(());
    }
    let source_path = if json_path.exists() {
        json_path.clone()
    } else if wrapper_path.exists() {
        wrapper_path
    } else {
        return Ok(());
    };
    let metadata = fs::metadata(&source_path)
        .map_err(|_| ImportError::Manifest("legacy meta.json is missing"))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > max_bytes {
        return Err(ImportError::Manifest(
            "legacy meta.json has an invalid size",
        ));
    }
    let text = fs::read_to_string(&source_path)
        .map_err(|_| ImportError::Manifest("legacy meta.json is not UTF-8"))?;
    let mut value = serde_json::from_str::<serde_json::Value>(&text)
        .map_err(|_| ImportError::Manifest("legacy meta.json is invalid"))?;
    let color = if let Some(metadata) = value
        .get_mut("metadata")
        .and_then(serde_json::Value::as_object_mut)
    {
        let color = metadata.remove("color");
        if let Some(demo_mod) = metadata.remove("demoMod") {
            let demo_mod = demo_mod.as_bool().ok_or(ImportError::Manifest(
                "legacy metadata.demoMod must be boolean",
            ))?;
            if !metadata.contains_key("game") {
                metadata.insert(
                    "game".to_owned(),
                    serde_json::Value::String(if demo_mod {
                        "toby.deltarune.demo".to_owned()
                    } else {
                        "toby.deltarune".to_owned()
                    }),
                );
            }
        }
        color
    } else {
        None
    };
    if let (Some(color), Some(root)) = (color, value.as_object_mut()) {
        root.insert("color".to_owned(), color);
    }
    let toml = toml::to_string_pretty(&json_to_toml(value)?)
        .map_err(|_| ImportError::Manifest("legacy meta.json could not be converted"))?;
    if toml.len() as u64 > max_bytes {
        return Err(ImportError::Manifest("converted meta.toml is too large"));
    }
    // Keep conversion private and all-or-nothing. The temporary file is
    // removed by NamedTempFile on every error; persist_noclobber then gives
    // the canonical name without ever truncating an existing manifest.
    let mut output = tempfile::NamedTempFile::new_in(root)?;
    output.write_all(toml.as_bytes())?;
    output.as_file().sync_all()?;
    output
        .persist_noclobber(&toml_path)
        .map_err(|error| error.error)?;
    fs::remove_file(source_path)?;
    if !icon_path.exists() && wrapper_icon_path.exists() {
        fs::rename(wrapper_icon_path, icon_path)?;
    }
    Ok(())
}

fn read_manifest(root: &Path, max_bytes: u64) -> Result<Manifest, ImportError> {
    let toml_path = root.join("meta.toml");
    let json_path = root.join("meta.json");
    let legacy_path = root.join("_deltamodInfo.json");
    let value = if toml_path.exists() {
        let metadata = fs::metadata(&toml_path)
            .map_err(|_| ImportError::Manifest("root meta.toml is missing"))?;
        if !metadata.is_file() || metadata.len() == 0 || metadata.len() > max_bytes {
            return Err(ImportError::Manifest("meta.toml has an invalid size"));
        }
        let text = fs::read_to_string(&toml_path)
            .map_err(|_| ImportError::Manifest("meta.toml is not UTF-8"))?;
        toml::from_str::<toml::Value>(&text)
            .map_err(|_| ImportError::Manifest("meta.toml is invalid"))?
    } else {
        let path = if json_path.exists() {
            json_path
        } else {
            legacy_path
        };
        let metadata =
            fs::metadata(&path).map_err(|_| ImportError::Manifest("root meta.toml is missing"))?;
        if !metadata.is_file() || metadata.len() == 0 || metadata.len() > max_bytes {
            return Err(ImportError::Manifest(
                "legacy meta.json has an invalid size",
            ));
        }
        let text = fs::read_to_string(path)
            .map_err(|_| ImportError::Manifest("legacy meta.json is not UTF-8"))?;
        json_to_toml(
            serde_json::from_str::<serde_json::Value>(&text)
                .map_err(|_| ImportError::Manifest("legacy meta.json is invalid"))?,
        )?
    };
    let metadata = value
        .get("metadata")
        .and_then(toml::Value::as_table)
        .ok_or(ImportError::Manifest("metadata table is missing"))?;
    let package_id = metadata
        .get("packageID")
        .and_then(toml::Value::as_str)
        .ok_or(ImportError::Manifest("metadata.packageID is missing"))?;
    if package_id == "und.und.und"
        || package_id.is_empty()
        || package_id.len() > 128
        || !package_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
        || package_id.starts_with('.')
        || package_id.ends_with('.')
    {
        return Err(ImportError::Manifest("metadata.packageID is unsafe"));
    }
    if !metadata.contains_key("game") && !metadata.contains_key("demoMod") {
        return Err(ImportError::Manifest("metadata.game is missing"));
    }
    Ok(Manifest {
        package_id: package_id.into(),
        version: metadata
            .get("version")
            .and_then(toml::Value::as_str)
            .map(str::to_owned),
    })
}

fn commit(source: PathBuf, destination: &Path, replacing: bool) -> Result<(), ImportError> {
    commit_with_cleanup(source, destination, replacing, |path| {
        fs::remove_dir_all(path)
    })
}

fn commit_with_cleanup<F>(
    source: PathBuf,
    destination: &Path,
    replacing: bool,
    cleanup_backup: F,
) -> Result<(), ImportError>
where
    F: FnOnce(&Path) -> io::Result<()>,
{
    if !replacing {
        return fs::rename(source, destination).map_err(ImportError::Io);
    }
    let parent = destination
        .parent()
        .ok_or(ImportError::Destination("destination has no parent"))?;
    let backup = Builder::new().prefix(".mod-backup-").tempdir_in(parent)?;
    fs::remove_dir(backup.path())?;
    let backup_path = backup.keep();
    fs::rename(destination, &backup_path)?;
    if let Err(error) = fs::rename(&source, destination) {
        let _ = fs::rename(&backup_path, destination);
        let _ = fs::remove_dir_all(source);
        return Err(ImportError::Io(error));
    }

    // Publication already succeeded. Backup cleanup is best-effort so a
    // cleanup failure cannot be reported as an installation failure.
    let _ = cleanup_backup(&backup_path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn zip_fixture(entries: &[(&str, &[u8])]) -> tempfile::NamedTempFile {
        let file = tempfile::NamedTempFile::new().unwrap();
        let mut zip = zip::ZipWriter::new(file.reopen().unwrap());
        for (name, bytes) in entries {
            zip.start_file(*name, SimpleFileOptions::default()).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
        file
    }

    fn valid_entries() -> Vec<(&'static str, &'static [u8])> {
        vec![
            (
                "mod/meta.toml",
                b"[metadata]\npackageID='example.safe'\ngame='toby.deltarune'\nversion='1'\n",
            ),
            ("mod/modding.xml", b"<mod/>"),
        ]
    }

    #[test]
    fn legacy_json_manifest_is_converted_before_publish() {
        let archive = zip_fixture(&[
            (
                "mod/meta.json",
                br##"{"metadata":{"packageID":"legacy.safe","demoMod":true,"version":"1.2.3","color":"#abc"}}"##,
            ),
            ("mod/modding.xml", b"<mod/>"),
        ]);
        let packets = tempfile::tempdir().unwrap();
        let result = import_archive(
            archive.path(),
            packets.path(),
            Limits::default(),
            || false,
            |_| DuplicateDecision::Cancel,
        )
        .unwrap();
        assert_eq!(result.package_id, "legacy.safe");
        let converted = fs::read_to_string(result.destination.join("meta.toml")).unwrap();
        let converted = toml::from_str::<toml::Value>(&converted).unwrap();
        let metadata = converted.get("metadata").unwrap().as_table().unwrap();
        assert_eq!(
            metadata.get("game").unwrap().as_str(),
            Some("toby.deltarune.demo")
        );
        assert_eq!(metadata.get("version").unwrap().as_str(), Some("1.2.3"));
        assert!(!metadata.contains_key("demoMod"));
        assert!(!metadata.contains_key("color"));
        assert_eq!(
            converted.get("color").and_then(toml::Value::as_str),
            Some("#abc")
        );
        assert!(!result.destination.join("meta.json").exists());
    }

    #[test]
    fn legacy_wrapper_manifest_and_icon_names_are_accepted() {
        let archive = zip_fixture(&[
            (
                "mod/_deltamodInfo.json",
                br#"{"metadata":{"packageID":"wrapped.safe","demoMod":true}}"#,
            ),
            ("mod/_icon.png", b"png"),
            ("mod/modding.xml", b"<mod/>"),
        ]);
        let packets = tempfile::tempdir().unwrap();
        let result = import_archive(
            archive.path(),
            packets.path(),
            Limits::default(),
            || false,
            |_| DuplicateDecision::Cancel,
        )
        .unwrap();
        assert_eq!(result.package_id, "wrapped.safe");
        assert!(result.destination.join("meta.toml").is_file());
        assert!(result.destination.join("icon.png").is_file());
        let converted = fs::read_to_string(result.destination.join("meta.toml")).unwrap();
        assert!(converted.contains("game = \"toby.deltarune.demo\""));
    }

    #[test]
    fn canonical_toml_wins_over_legacy_json() {
        let archive = zip_fixture(&[
            (
                "mod/meta.toml",
                b"[metadata]\npackageID='canonical.safe'\ngame='toby.deltarune'\nversion='9'\n",
            ),
            ("mod/meta.json", b"{not json"),
            ("mod/modding.xml", b"<mod/>"),
        ]);
        let packets = tempfile::tempdir().unwrap();
        let result = import_archive(
            archive.path(),
            packets.path(),
            Limits::default(),
            || false,
            |_| DuplicateDecision::Cancel,
        )
        .unwrap();
        assert_eq!(result.package_id, "canonical.safe");
        let manifest = fs::read_to_string(result.destination.join("meta.toml")).unwrap();
        let manifest = toml::from_str::<toml::Value>(&manifest).unwrap();
        assert_eq!(
            manifest
                .get("metadata")
                .and_then(toml::Value::as_table)
                .and_then(|metadata| metadata.get("packageID"))
                .and_then(toml::Value::as_str),
            Some("canonical.safe")
        );
        assert!(result.destination.join("meta.json").is_file());
    }

    #[test]
    fn legacy_json_stage_keeps_normalized_content_inside_private_root() {
        let archive = zip_fixture(&[
            (
                "mod/meta.json",
                br#"{"metadata":{"packageID":"staged.safe","demoMod":false,"version":"2"}}"#,
            ),
            ("mod/modding.xml", b"<mod/>"),
        ]);
        let parent = tempfile::tempdir().unwrap();
        let staged =
            stage_mod_archive(archive.path(), parent.path(), Limits::default(), || false).unwrap();
        assert_eq!(staged.package_id(), "staged.safe");
        assert_eq!(staged.version(), Some("2"));
        assert!(staged.root().join("meta.toml").is_file());
        assert!(staged
            .root()
            .starts_with(fs::canonicalize(parent.path()).unwrap()));
        assert!(staged.root().join("modding.xml").is_file());
    }

    #[test]
    fn malformed_legacy_manifests_never_publish() {
        let cases: &[(&[u8], &str)] = &[
            (
                br#"{"metadata":{"packageID":"invalid.safe","game":"toby.deltarune"}"#,
                "legacy meta.json is invalid",
            ),
            (
                br#"{"metadata":{"packageID":"../escape","game":"toby.deltarune"}}"#,
                "metadata.packageID is unsafe",
            ),
        ];
        for &(manifest, expected) in cases {
            let archive =
                zip_fixture(&[("mod/meta.json", manifest), ("mod/modding.xml", b"<mod/>")]);
            let packets = tempfile::tempdir().unwrap();
            let result = import_archive(
                archive.path(),
                packets.path(),
                Limits::default(),
                || false,
                |_| DuplicateDecision::Cancel,
            );
            assert!(matches!(result, Err(ImportError::Manifest(message)) if message == expected));
            assert_eq!(fs::read_dir(packets.path()).unwrap().count(), 0);
        }

        let archive = zip_fixture(&[
            (
                "mod/meta.json",
                br#"{"metadata":{"packageID":"too.large","game":"toby.deltarune"}}"#,
            ),
            ("mod/modding.xml", b"<mod/>"),
        ]);
        let packets = tempfile::tempdir().unwrap();
        let limits = Limits {
            max_manifest_bytes: 8,
            ..Limits::default()
        };
        assert!(matches!(
            import_archive(
                archive.path(),
                packets.path(),
                limits,
                || false,
                |_| DuplicateDecision::Cancel,
            ),
            Err(ImportError::Manifest(
                "legacy meta.json has an invalid size"
            ))
        ));
        assert_eq!(fs::read_dir(packets.path()).unwrap().count(), 0);
    }

    #[test]
    fn legacy_json_number_and_null_conversion_is_explicit() {
        let integer = serde_json::from_str::<serde_json::Value>("9223372036854775807").unwrap();
        assert_eq!(
            json_to_toml(integer).unwrap(),
            toml::Value::Integer(i64::MAX)
        );

        let too_large = serde_json::from_str::<serde_json::Value>("9223372036854775808").unwrap();
        assert!(matches!(
            json_to_toml(too_large),
            Err(ImportError::Manifest("legacy JSON integer is out of range"))
        ));
        assert!(matches!(
            json_to_toml(serde_json::Value::Null),
            Err(ImportError::Manifest("legacy JSON contains null"))
        ));
    }

    #[test]
    fn normalized_manifest_cannot_create_a_case_collision() {
        let archive = zip_fixture(&[
            (
                "mod/meta.json",
                br#"{"metadata":{"packageID":"collision.safe","game":"toby.deltarune"}}"#,
            ),
            ("mod/META.TOML", b"stale canonical name"),
            ("mod/modding.xml", b"<mod/>"),
        ]);
        let packets = tempfile::tempdir().unwrap();
        assert!(import_archive(
            archive.path(),
            packets.path(),
            Limits::default(),
            || false,
            |_| DuplicateDecision::Cancel,
        )
        .is_err());
        assert_eq!(fs::read_dir(packets.path()).unwrap().count(), 0);
    }

    fn tar_fixture() -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut tar = tar::Builder::new(&mut bytes);
            for (name, contents) in valid_entries() {
                let mut header = tar::Header::new_gnu();
                header.set_size(contents.len() as u64);
                header.set_mode(0o644);
                header.set_cksum();
                tar.append_data(&mut header, name, contents).unwrap();
            }
            tar.finish().unwrap();
        }
        bytes
    }

    fn write_fixture(bytes: &[u8]) -> tempfile::NamedTempFile {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(bytes).unwrap();
        file.flush().unwrap();
        file
    }

    #[test]
    fn zip_import_flattens_and_commits() {
        let archive = zip_fixture(&valid_entries());
        let packets = tempfile::tempdir().unwrap();
        let result = import_archive(
            archive.path(),
            packets.path(),
            Limits::default(),
            || false,
            |_| DuplicateDecision::Cancel,
        )
        .unwrap();
        assert_eq!(result.format, ArchiveFormat::Zip);
        assert!(result.destination.join("meta.toml").is_file());
        let identity: serde_json::Value =
            serde_json::from_slice(&fs::read(result.destination.join("__deltaID.json")).unwrap())
                .unwrap();
        assert!(identity["uniqueId"]
            .as_str()
            .is_some_and(|id| !id.is_empty()));
        assert!(!result.destination.join("mod").exists());
    }

    #[test]
    fn deltahub_package_gets_synthesized_meta_toml() {
        let info = br#"{
            "metadata": {
                "name": "Kaizo Roaring Knight",
                "version": "v2.3.3",
                "author": ["EnderCat8"],
                "demoMod": false,
                "packageID": "gb.kaizoknight.ec8",
                "tags": ["challenge"]
            },
            "deltaruneTargetVersion": "1.06"
        }"#;
        let archive = zip_fixture(&[
            ("kaizo/_deltamodInfo.json", info),
            (
                "kaizo/modding.xml",
                b"<patch type=\"xdelta\" patch=\"./k.xdelta\" to=\"./chapter3_windows/data.win\" />",
            ),
        ]);
        let packets = tempfile::tempdir().unwrap();
        let result = import_archive(
            archive.path(),
            packets.path(),
            Limits::default(),
            || false,
            |_| DuplicateDecision::Cancel,
        )
        .unwrap();
        assert_eq!(result.package_id, "gb.kaizoknight.ec8");
        let manifest: toml::Value =
            toml::from_str(&fs::read_to_string(result.destination.join("meta.toml")).unwrap())
                .unwrap();
        assert_eq!(manifest["deltaruneTargetVersion"].as_str(), Some("1.06"));
        assert_eq!(
            manifest["metadata"]["game"].as_str(),
            Some("toby.deltarune")
        );
        assert_eq!(manifest["metadata"]["version"].as_str(), Some("v2.3.3"));
        assert_eq!(
            manifest["metadata"]["author"].as_array().unwrap()[0].as_str(),
            Some("EnderCat8")
        );
    }

    #[test]
    fn raw_deltahub_archives_import_through_the_resolver() {
        let entries: [(&str, &[u8]); 3] = [
            ("kaizo_knight.xdelta", b"patch"),
            ("custom song (optional)/kaizoknight.ogg", b"ogg"),
            ("README.txt", b"put data.win from chapter3_windows first"),
        ];
        let packets = tempfile::tempdir().unwrap();
        let cancelled = import_archive_with_resolver(
            zip_fixture(&entries).path(),
            packets.path(),
            Limits::default(),
            None,
            || false,
            |_| DuplicateDecision::Cancel,
            |_| None,
        );
        assert!(matches!(cancelled, Err(ImportError::Cancelled)));

        let result = import_archive_with_resolver(
            zip_fixture(&entries).path(),
            packets.path(),
            Limits::default(),
            None,
            || false,
            |_| DuplicateDecision::Cancel,
            |package| {
                assert_eq!(package.suggested_chapter(&package.patches[0]), Some(3));
                Some(RawPlan {
                    package_id: "gb.662826".into(),
                    name: "Kaizo Knight".into(),
                    chapters: vec![3],
                })
            },
        )
        .unwrap();
        assert_eq!(result.package_id, "gb.662826");
        let modding = fs::read_to_string(result.destination.join("modding.xml")).unwrap();
        assert!(modding.contains("chapter3_windows/data.win"));
        assert!(result.destination.join("kaizoknight.ogg").is_file());
    }

    #[test]
    fn rar_archives_get_a_clear_error() {
        let archive = write_fixture(b"Rar!\x1a\x07\x01\x00rest-of-archive");
        assert!(matches!(
            detect_format(archive.path()),
            Err(ImportError::Rar)
        ));
    }

    #[test]
    fn tar_gz_import_is_end_to_end() {
        let mut compressed = Vec::new();
        {
            let mut encoder =
                flate2::write::GzEncoder::new(&mut compressed, flate2::Compression::default());
            encoder.write_all(&tar_fixture()).unwrap();
            encoder.finish().unwrap();
        }
        let archive = write_fixture(&compressed);
        let packets = tempfile::tempdir().unwrap();
        let result = import_archive(
            archive.path(),
            packets.path(),
            Limits::default(),
            || false,
            |_| DuplicateDecision::Cancel,
        )
        .unwrap();
        assert_eq!(result.format, ArchiveFormat::TarGz);
        assert!(result.destination.join("modding.xml").is_file());
    }

    #[test]
    fn tar_lzma_import_is_end_to_end_and_disk_bounded() {
        let mut compressed = Vec::new();
        lzma_rs::lzma_compress(&mut io::Cursor::new(tar_fixture()), &mut compressed).unwrap();
        let archive = write_fixture(&compressed);
        let packets = tempfile::tempdir().unwrap();
        let result = import_archive(
            archive.path(),
            packets.path(),
            Limits::default(),
            || false,
            |_| DuplicateDecision::Cancel,
        )
        .unwrap();
        assert_eq!(result.format, ArchiveFormat::TarLzma);
        assert!(result.destination.join("meta.toml").is_file());
    }

    // Harmless self-authored fixtures produced by 7-Zip 23.01, not by the reader
    // under test. Recreate from the three contents asserted below with:
    // 7z a -t7z -m0=lzma2 -mx=5 -ms=on (or off) -mtm=off -mtc=off -mta=off
    //   -mhc=off fixture.7z mod/meta.toml mod/modding.xml mod/payload.txt
    // Inline bytes keep the shared-block regression portable without a 7z binary.
    const SEVEN_SOLID_FIXTURE: &[u8] = &[
        0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0x00, 0x04, 0xda, 0xca, 0x8c, 0x36, 0xa3, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0xae, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x96, 0x97,
        0x34, 0x6a, 0xe0, 0x00, 0xb8, 0x00, 0x9b, 0x5d, 0x00, 0x2d, 0x9b, 0x48, 0xa7, 0x77, 0x64,
        0x0c, 0x41, 0x5b, 0xd5, 0xc7, 0x48, 0xee, 0xe7, 0xb9, 0xea, 0x67, 0xe1, 0xd5, 0x4b, 0x1c,
        0x22, 0x02, 0x2c, 0x6c, 0xe3, 0x2e, 0xc5, 0xb0, 0x3e, 0xac, 0xe6, 0x42, 0xd6, 0x7d, 0x81,
        0x62, 0xa4, 0x09, 0x05, 0x5a, 0x30, 0x00, 0xf6, 0x58, 0xd2, 0x4a, 0xe1, 0x4c, 0x7d, 0xe3,
        0x08, 0x6d, 0x2c, 0xe2, 0xf2, 0x5a, 0x59, 0x9a, 0xa9, 0x65, 0x27, 0x37, 0x4a, 0x4c, 0x27,
        0xf4, 0x6f, 0xde, 0x8b, 0x80, 0x22, 0x99, 0x25, 0xfd, 0x41, 0x89, 0x7e, 0x5f, 0x75, 0x3c,
        0xae, 0xf1, 0xfb, 0x77, 0x73, 0x4f, 0x53, 0x5a, 0x24, 0x31, 0x56, 0x86, 0xc7, 0xe6, 0x71,
        0x17, 0xac, 0xe9, 0x34, 0xc1, 0x59, 0x4a, 0x0f, 0xb0, 0x3f, 0x23, 0x52, 0x05, 0x3f, 0x4e,
        0x8e, 0xf2, 0x83, 0x5e, 0x0a, 0x70, 0xdf, 0xf0, 0xe6, 0x24, 0xea, 0xd1, 0x72, 0xc9, 0x39,
        0x9f, 0x89, 0x8b, 0x22, 0x23, 0x39, 0xfd, 0x95, 0xc0, 0x1b, 0xc1, 0x73, 0x7b, 0x23, 0xb0,
        0x4e, 0xe1, 0xdb, 0x57, 0xe7, 0x2b, 0x89, 0xcf, 0x5e, 0x4e, 0xab, 0xcb, 0x0f, 0x16, 0x00,
        0x01, 0x04, 0x06, 0x00, 0x01, 0x09, 0x80, 0xa3, 0x00, 0x07, 0x0b, 0x01, 0x00, 0x01, 0x21,
        0x21, 0x01, 0x00, 0x0c, 0x80, 0xb9, 0x00, 0x08, 0x0d, 0x03, 0x09, 0x47, 0x47, 0x0a, 0x01,
        0xa0, 0x94, 0x24, 0x3c, 0xa4, 0x3d, 0x2b, 0x81, 0xed, 0x2a, 0x9b, 0xbf, 0x00, 0x00, 0x05,
        0x03, 0x19, 0x0d, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x11, 0x5d, 0x00, 0x6d, 0x00, 0x6f, 0x00, 0x64, 0x00, 0x2f, 0x00, 0x6d, 0x00, 0x65,
        0x00, 0x74, 0x00, 0x61, 0x00, 0x2e, 0x00, 0x74, 0x00, 0x6f, 0x00, 0x6d, 0x00, 0x6c, 0x00,
        0x00, 0x00, 0x6d, 0x00, 0x6f, 0x00, 0x64, 0x00, 0x2f, 0x00, 0x6d, 0x00, 0x6f, 0x00, 0x64,
        0x00, 0x64, 0x00, 0x69, 0x00, 0x6e, 0x00, 0x67, 0x00, 0x2e, 0x00, 0x78, 0x00, 0x6d, 0x00,
        0x6c, 0x00, 0x00, 0x00, 0x6d, 0x00, 0x6f, 0x00, 0x64, 0x00, 0x2f, 0x00, 0x70, 0x00, 0x61,
        0x00, 0x79, 0x00, 0x6c, 0x00, 0x6f, 0x00, 0x61, 0x00, 0x64, 0x00, 0x2e, 0x00, 0x74, 0x00,
        0x78, 0x00, 0x74, 0x00, 0x00, 0x00, 0x15, 0x0e, 0x01, 0x00, 0x20, 0x80, 0xa4, 0x81, 0x20,
        0x80, 0xa4, 0x81, 0x20, 0x80, 0xa4, 0x81, 0x00, 0x00,
    ];

    const SEVEN_NONSOLID_FIXTURE: &[u8] = &[
        0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0x00, 0x04, 0x55, 0xa7, 0x60, 0x02, 0xc3, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0xae, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x5a, 0xb3,
        0xa1, 0x76, 0x01, 0x00, 0x46, 0x5b, 0x6d, 0x65, 0x74, 0x61, 0x64, 0x61, 0x74, 0x61, 0x5d,
        0x0a, 0x70, 0x61, 0x63, 0x6b, 0x61, 0x67, 0x65, 0x49, 0x44, 0x3d, 0x27, 0x65, 0x78, 0x61,
        0x6d, 0x70, 0x6c, 0x65, 0x2e, 0x73, 0x6f, 0x6c, 0x69, 0x64, 0x27, 0x0a, 0x67, 0x61, 0x6d,
        0x65, 0x3d, 0x27, 0x74, 0x6f, 0x62, 0x79, 0x2e, 0x64, 0x65, 0x6c, 0x74, 0x61, 0x72, 0x75,
        0x6e, 0x65, 0x27, 0x0a, 0x76, 0x65, 0x72, 0x73, 0x69, 0x6f, 0x6e, 0x3d, 0x27, 0x31, 0x27,
        0x0a, 0x00, 0xe0, 0x00, 0x46, 0x00, 0x41, 0x5d, 0x00, 0x1e, 0x1b, 0x49, 0xe6, 0x56, 0xc8,
        0x52, 0x7c, 0x15, 0xd2, 0xd5, 0x35, 0x3c, 0xf4, 0x74, 0x03, 0xdd, 0xa1, 0xc9, 0x59, 0xd4,
        0x84, 0xf8, 0xbb, 0x66, 0xad, 0x35, 0xf4, 0xa3, 0x1a, 0x3e, 0xe5, 0x0c, 0x8e, 0x66, 0x3f,
        0xa0, 0x41, 0x70, 0x0d, 0xa8, 0x92, 0x3d, 0xd0, 0x20, 0xe8, 0x67, 0xce, 0xf7, 0xe2, 0xbe,
        0x5e, 0x2c, 0x94, 0xee, 0x7d, 0x6e, 0xf3, 0x37, 0x7d, 0xbc, 0x25, 0xf2, 0x00, 0x00, 0x00,
        0x01, 0x00, 0x2a, 0x44, 0x65, 0x6c, 0x74, 0x61, 0x6d, 0x6f, 0x64, 0x20, 0x73, 0x6f, 0x6c,
        0x69, 0x64, 0x20, 0x61, 0x72, 0x63, 0x68, 0x69, 0x76, 0x65, 0x20, 0x72, 0x65, 0x67, 0x72,
        0x65, 0x73, 0x73, 0x69, 0x6f, 0x6e, 0x20, 0x66, 0x69, 0x78, 0x74, 0x75, 0x72, 0x65, 0x2e,
        0x0a, 0x00, 0x01, 0x04, 0x06, 0x00, 0x03, 0x09, 0x4b, 0x49, 0x2f, 0x00, 0x07, 0x0b, 0x03,
        0x00, 0x01, 0x21, 0x21, 0x01, 0x00, 0x01, 0x21, 0x21, 0x01, 0x00, 0x01, 0x21, 0x21, 0x01,
        0x00, 0x0c, 0x47, 0x47, 0x2b, 0x00, 0x08, 0x0a, 0x01, 0xa0, 0x94, 0x24, 0x3c, 0xa4, 0x3d,
        0x2b, 0x81, 0xed, 0x2a, 0x9b, 0xbf, 0x00, 0x00, 0x05, 0x03, 0x19, 0x06, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x11, 0x5d, 0x00, 0x6d, 0x00, 0x6f, 0x00, 0x64, 0x00, 0x2f, 0x00, 0x6d,
        0x00, 0x65, 0x00, 0x74, 0x00, 0x61, 0x00, 0x2e, 0x00, 0x74, 0x00, 0x6f, 0x00, 0x6d, 0x00,
        0x6c, 0x00, 0x00, 0x00, 0x6d, 0x00, 0x6f, 0x00, 0x64, 0x00, 0x2f, 0x00, 0x6d, 0x00, 0x6f,
        0x00, 0x64, 0x00, 0x64, 0x00, 0x69, 0x00, 0x6e, 0x00, 0x67, 0x00, 0x2e, 0x00, 0x78, 0x00,
        0x6d, 0x00, 0x6c, 0x00, 0x00, 0x00, 0x6d, 0x00, 0x6f, 0x00, 0x64, 0x00, 0x2f, 0x00, 0x70,
        0x00, 0x61, 0x00, 0x79, 0x00, 0x6c, 0x00, 0x6f, 0x00, 0x61, 0x00, 0x64, 0x00, 0x2e, 0x00,
        0x74, 0x00, 0x78, 0x00, 0x74, 0x00, 0x00, 0x00, 0x15, 0x0e, 0x01, 0x00, 0x20, 0x80, 0xa4,
        0x81, 0x20, 0x80, 0xa4, 0x81, 0x20, 0x80, 0xa4, 0x81, 0x00, 0x00,
    ];

    #[test]
    fn seven_zip_solid_and_non_solid_external_fixtures_import_exact_contents() {
        for (bytes, solid) in [(SEVEN_SOLID_FIXTURE, true), (SEVEN_NONSOLID_FIXTURE, false)] {
            let archive = write_fixture(bytes);
            let parsed = SevenArchive::open(archive.path()).unwrap();
            assert_eq!(parsed.is_solid, solid);
            assert_eq!(parsed.blocks.len(), if solid { 1 } else { 3 });
            assert_eq!(parsed.files.len(), 3);
            if solid {
                assert_eq!(parsed.stream_map.file_block_index, vec![Some(0); 3]);
                assert!(parsed.files[0].compressed_size > 0);
                assert!(parsed.files[1..]
                    .iter()
                    .all(|entry| entry.size() > 0 && entry.compressed_size == 0));
            } else {
                assert_eq!(
                    parsed.stream_map.file_block_index,
                    vec![Some(0), Some(1), Some(2)]
                );
                assert!(parsed.files.iter().all(|entry| entry.compressed_size > 0));
            }
            let packets = tempfile::tempdir().unwrap();
            let result = import_archive(
                archive.path(),
                packets.path(),
                Limits::default(),
                || false,
                |_| DuplicateDecision::Cancel,
            )
            .unwrap();
            assert_eq!(result.package_id, "example.solid");
            assert_eq!(result.format, ArchiveFormat::SevenZip);
            assert_eq!(result.files, 3);
            for (name, expected) in [
                ("meta.toml", b"[metadata]\npackageID='example.solid'\ngame='toby.deltarune'\nversion='1'\n".as_slice()),
                ("modding.xml", b"<mod><patch type=\"override\" patch=\"payload.txt\" to=\"solid.txt\"/></mod>\n".as_slice()),
                ("payload.txt", b"Deltamod solid archive regression fixture.\n".as_slice()),
            ] {
                assert_eq!(fs::read(result.destination.join(name)).unwrap(), expected);
            }
        }
    }

    #[test]
    fn seven_zip_import_is_end_to_end() {
        let source = tempfile::tempdir().unwrap();
        let mod_root = source.path().join("mod");
        fs::create_dir(&mod_root).unwrap();
        for (name, contents) in valid_entries() {
            let basename = Path::new(name).file_name().unwrap();
            fs::write(mod_root.join(basename), contents).unwrap();
        }
        let archive = tempfile::NamedTempFile::new().unwrap();
        sevenz_rust2::compress_to_path(source.path(), archive.path()).unwrap();
        let packets = tempfile::tempdir().unwrap();
        let result = import_archive(
            archive.path(),
            packets.path(),
            Limits::default(),
            || false,
            |_| DuplicateDecision::Cancel,
        )
        .unwrap();
        assert_eq!(result.format, ArchiveFormat::SevenZip);
        assert!(result.destination.join("modding.xml").is_file());
    }

    #[test]
    fn seven_zip_solid_and_non_solid_fixtures_keep_resource_and_path_limits() {
        for bytes in [SEVEN_SOLID_FIXTURE, SEVEN_NONSOLID_FIXTURE] {
            for (limits, reason) in [
                (
                    Limits {
                        max_archive_bytes: bytes.len() as u64 - 1,
                        ..Limits::default()
                    },
                    "compressed archive size limit exceeded",
                ),
                (
                    Limits {
                        max_entries: 2,
                        ..Limits::default()
                    },
                    "archive entry count limit exceeded",
                ),
                (
                    Limits {
                        max_entry_bytes: 64,
                        ..Limits::default()
                    },
                    "individual entry size limit exceeded",
                ),
                (
                    Limits {
                        max_expanded_bytes: 100,
                        ..Limits::default()
                    },
                    "expanded archive size limit exceeded",
                ),
            ] {
                let archive = write_fixture(bytes);
                let packets = tempfile::tempdir().unwrap();
                let result = import_archive(
                    archive.path(),
                    packets.path(),
                    limits,
                    || false,
                    |_| panic!("a rejected archive must not reach publication"),
                );
                assert!(
                    matches!(result, Err(ImportError::Limit(value)) if value == reason),
                    "{result:?}"
                );
                assert_eq!(fs::read_dir(packets.path()).unwrap().count(), 0);
            }
            let archive = write_fixture(bytes);
            let packets = tempfile::tempdir().unwrap();
            let result = import_archive(
                archive.path(),
                packets.path(),
                Limits {
                    max_depth: 1,
                    ..Limits::default()
                },
                || false,
                |_| panic!("an unsafe path must not reach publication"),
            );
            assert!(matches!(result, Err(ImportError::UnsafePath(_))));
            assert_eq!(fs::read_dir(packets.path()).unwrap().count(), 0);
        }
    }

    #[test]
    fn seven_zip_shared_block_ratio_cannot_be_hidden_by_other_blocks() {
        use sevenz_rust2::{
            ArchiveEntry, ArchiveWriter, EncoderConfiguration, EncoderMethod, SourceReader,
        };

        let archive = tempfile::NamedTempFile::new().unwrap();
        let mut writer = ArchiveWriter::new(archive.reopen().unwrap()).unwrap();
        let payload = vec![b'x'; 4096];
        writer
            .push_archive_entries(
                vec![
                    ArchiveEntry::new_file("mod/first.bin"),
                    ArchiveEntry::new_file("mod/second.bin"),
                ],
                vec![
                    SourceReader::new(payload.as_slice()),
                    SourceReader::new(payload.as_slice()),
                ],
            )
            .unwrap();
        // A separate stored block keeps the overall archive ratio small. It must
        // not dilute the limit on the two files sharing the compressed block.
        writer.set_content_methods(vec![EncoderConfiguration::new(EncoderMethod::COPY)]);
        let padding = vec![b'p'; 32 * 1024];
        for (name, data) in valid_entries() {
            writer
                .push_archive_entry(ArchiveEntry::new_file(name), Some(data))
                .unwrap();
        }
        writer
            .push_archive_entry(
                ArchiveEntry::new_file("mod/padding.bin"),
                Some(padding.as_slice()),
            )
            .unwrap();
        writer.finish().unwrap();
        let parsed = SevenArchive::open(archive.path()).unwrap();
        assert!(parsed.is_solid);
        assert_eq!(
            &parsed.stream_map.file_block_index[..2],
            &[Some(0), Some(0)]
        );
        let packed = parsed.pack_sizes()[0];
        let shared_expanded = parsed.blocks[0].get_unpack_size();
        assert_eq!(shared_expanded, (2 * payload.len()) as u64);
        let limits = Limits {
            max_ratio: (payload.len() as u64).div_ceil(packed),
            ..Limits::default()
        };
        assert!((payload.len() as u64) <= packed * limits.max_ratio);
        assert!(shared_expanded > packed * limits.max_ratio);
        let expanded: u64 = parsed.files.iter().map(|entry| entry.size()).sum();
        assert!(expanded < fs::metadata(archive.path()).unwrap().len() * limits.max_ratio);

        let packets = tempfile::tempdir().unwrap();
        let result = import_archive(
            archive.path(),
            packets.path(),
            limits,
            || false,
            |_| panic!("an over-limit block must not reach publication"),
        );
        assert!(
            matches!(
                result,
                Err(ImportError::Limit(
                    "7z block compression ratio limit exceeded"
                ))
            ),
            "{result:?}"
        );
        assert_eq!(fs::read_dir(packets.path()).unwrap().count(), 0);

        let result = import_archive(
            archive.path(),
            packets.path(),
            Limits {
                max_ratio: shared_expanded.div_ceil(packed),
                ..limits
            },
            || false,
            |_| DuplicateDecision::Cancel,
        )
        .unwrap();
        assert_eq!(
            fs::read(result.destination.join("first.bin")).unwrap(),
            payload
        );
        assert_eq!(
            fs::read(result.destination.join("second.bin")).unwrap(),
            payload
        );
        assert_eq!(
            fs::read(result.destination.join("padding.bin")).unwrap(),
            padding
        );
    }

    #[test]
    fn seven_zip_solid_extraction_rejects_corruption_and_declared_size_overrun() {
        let mut corrupt = SEVEN_SOLID_FIXTURE.to_vec();
        corrupt[48] ^= 0xff;
        let archive = write_fixture(&corrupt);
        let packets = tempfile::tempdir().unwrap();
        let result = import_archive(
            archive.path(),
            packets.path(),
            Limits::default(),
            || false,
            |_| panic!("a corrupt archive must not reach publication"),
        );
        assert!(matches!(result, Err(ImportError::Format(_))));
        assert_eq!(fs::read_dir(packets.path()).unwrap().count(), 0);

        let archive = write_fixture(SEVEN_SOLID_FIXTURE);
        let mut plan = inventory(
            archive.path(),
            ArchiveFormat::SevenZip,
            SEVEN_SOLID_FIXTURE.len() as u64,
            Limits::default(),
            &|| false,
        )
        .unwrap();
        plan.entries[0].size -= 1;
        let staging = tempfile::tempdir().unwrap();
        let result = extract_seven(
            archive.path(),
            &plan,
            staging.path(),
            Limits::default(),
            &|| false,
        );
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("entry exceeded its declared size"));
    }

    #[test]
    fn traversal_ads_reserved_and_case_collisions_are_rejected() {
        for entries in [
            vec![("../escape", b"x".as_slice())],
            vec![("safe/file:stream", b"x".as_slice())],
            vec![("safe/CON.txt", b"x".as_slice())],
            vec![
                ("safe/A.txt", b"x".as_slice()),
                ("safe/a.TXT", b"y".as_slice()),
            ],
            vec![("safe/child", b"x".as_slice()), ("safe", b"y".as_slice())],
        ] {
            let archive = zip_fixture(&entries);
            let packets = tempfile::tempdir().unwrap();
            assert!(import_archive(
                archive.path(),
                packets.path(),
                Limits::default(),
                || false,
                |_| DuplicateDecision::Cancel,
            )
            .is_err());
            assert_eq!(fs::read_dir(packets.path()).unwrap().count(), 0);
        }
    }

    #[test]
    fn zip_symlinks_are_rejected_during_preflight() {
        let file = tempfile::NamedTempFile::new().unwrap();
        let mut zip = zip::ZipWriter::new(file.reopen().unwrap());
        zip.add_symlink("link", "../target", SimpleFileOptions::default())
            .unwrap();
        zip.finish().unwrap();
        let packets = tempfile::tempdir().unwrap();
        assert!(matches!(
            import_archive(
                file.path(),
                packets.path(),
                Limits::default(),
                || false,
                |_| DuplicateDecision::Cancel
            ),
            Err(ImportError::EntryType(_))
        ));
    }

    #[test]
    fn cancellation_cleans_private_staging() {
        let archive = zip_fixture(&valid_entries());
        let packets = tempfile::tempdir().unwrap();
        let calls = std::cell::Cell::new(0);
        let result = import_archive(
            archive.path(),
            packets.path(),
            Limits::default(),
            || {
                calls.set(calls.get() + 1);
                calls.get() > 3
            },
            |_| DuplicateDecision::Cancel,
        );
        assert!(matches!(result, Err(ImportError::Cancelled)));
        assert_eq!(fs::read_dir(packets.path()).unwrap().count(), 0);
    }

    #[test]
    fn existing_destination_requires_explicit_boundary_decision() {
        let first = zip_fixture(&valid_entries());
        let packets = tempfile::tempdir().unwrap();
        import_archive(
            first.path(),
            packets.path(),
            Limits::default(),
            || false,
            |_| DuplicateDecision::Cancel,
        )
        .unwrap();
        let second = zip_fixture(&valid_entries());
        let kept = import_archive(
            second.path(),
            packets.path(),
            Limits::default(),
            || false,
            |_| DuplicateDecision::KeepExisting,
        );
        assert!(matches!(kept, Err(ImportError::KeptExisting)));
        assert!(packets.path().join("example.safe/meta.toml").is_file());
    }

    #[test]
    fn replacing_a_mod_preserves_its_identity() {
        let packets = tempfile::tempdir().unwrap();
        let first = zip_fixture(&valid_entries());
        let first = import_archive(
            first.path(),
            packets.path(),
            Limits::default(),
            || false,
            |_| DuplicateDecision::Cancel,
        )
        .unwrap();
        let original = fs::read(first.destination.join("__deltaID.json")).unwrap();
        let second = zip_fixture(&valid_entries());
        let second = import_archive(
            second.path(),
            packets.path(),
            Limits::default(),
            || false,
            |_| DuplicateDecision::Replace,
        )
        .unwrap();
        assert_eq!(
            fs::read(second.destination.join("__deltaID.json")).unwrap(),
            original
        );
    }

    #[test]
    fn cleanup_failure_after_replace_does_not_report_commit_failure() {
        let root = tempfile::tempdir().unwrap();
        let destination = root.path().join("installed");
        let source = root.path().join("replacement");
        fs::create_dir(&destination).unwrap();
        fs::create_dir(&source).unwrap();
        fs::write(destination.join("value"), b"old").unwrap();
        fs::write(source.join("value"), b"new").unwrap();

        commit_with_cleanup(source, &destination, true, |_| {
            Err(io::Error::other("injected cleanup failure"))
        })
        .unwrap();

        assert_eq!(fs::read(destination.join("value")).unwrap(), b"new");
    }

    #[test]
    fn downloaded_import_commits_validated_legacy_source_metadata() {
        let archive = zip_fixture(&valid_entries());
        let packets = tempfile::tempdir().unwrap();
        let source = LegacySourceMetadata::new("1234", "Mod").unwrap();
        let result = import_archive_with_source(
            archive.path(),
            packets.path(),
            Limits::default(),
            Some(&source),
            || false,
            |_| DuplicateDecision::Cancel,
        )
        .unwrap();
        let manifest = fs::read_to_string(result.destination.join("meta.toml")).unwrap();
        assert!(manifest.contains("gamebanana_id = \"1234\""));
        assert!(manifest.contains("gamebanana_model = \"Mod\""));
    }

    #[test]
    fn invalid_legacy_source_metadata_is_rejected_before_import() {
        assert!(LegacySourceMetadata::new("1234", "../Mod").is_err());
        assert!(LegacySourceMetadata::new("", "Mod").is_err());
    }

    #[test]
    fn game_archive_unwraps_validates_and_commits_atomically() {
        let archive = zip_fixture(&[(
            "game/DELTARUNE.exe",
            b"verified executable bytes".as_slice(),
        )]);
        let parent = tempfile::tempdir().unwrap();
        let destination = parent.path().join("installed");
        let result = import_game_archive(
            archive.path(),
            &destination,
            "DELTARUNE.exe",
            Limits::default(),
            || false,
        )
        .unwrap();
        assert_eq!(result.root, destination);
        assert!(result.root.join("DELTARUNE.exe").is_file());
        assert!(!result.root.join("game").exists());
    }

    #[test]
    fn game_archive_missing_executable_never_publishes_destination() {
        let archive = zip_fixture(&[("game/readme.txt", b"not a game".as_slice())]);
        let parent = tempfile::tempdir().unwrap();
        let destination = parent.path().join("installed");
        assert!(import_game_archive(
            archive.path(),
            &destination,
            "DELTARUNE.exe",
            Limits::default(),
            || false,
        )
        .is_err());
        assert!(!destination.exists());
        assert_eq!(fs::read_dir(parent.path()).unwrap().count(), 0);
    }

    #[test]
    fn tar_links_are_rejected_during_preflight() {
        let file = tempfile::NamedTempFile::new().unwrap();
        let mut builder = tar::Builder::new(file.reopen().unwrap());
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(tar::EntryType::Symlink);
        header.set_size(0);
        header.set_cksum();
        builder
            .append_data(&mut header, "link", io::empty())
            .unwrap();
        builder.finish().unwrap();
        // Raw tar is deliberately not a supported channel format; exercise the tar inventory directly.
        assert!(
            inventory_tar(File::open(file.path()).unwrap(), Limits::default(), &|| {
                false
            })
            .is_err()
        );
    }
    #[test]
    fn finder_sidecars_do_not_hide_a_wrapped_mod_manifest() {
        for sidecar in ["__MACOSX/._Mod", ".DS_Store", "._Mod"] {
            let archive = zip_fixture(&[
                (
                    "Mod/meta.toml",
                    b"[metadata]\npackageID='test.finder'\ngame='toby.undertale'\n",
                ),
                ("Mod/modding.xml", b"<root/>"),
                (sidecar, b"finder metadata"),
            ]);
            let packets = tempfile::tempdir().unwrap();
            let result = import_archive(
                archive.path(),
                packets.path(),
                Limits::default(),
                || false,
                |_| DuplicateDecision::KeepExisting,
            )
            .unwrap();
            assert!(result.destination.join("meta.toml").is_file());
            assert!(!result.destination.join("Mod").exists());
        }
    }

    #[test]
    fn finder_metadata_is_not_a_bypass_for_path_validation_or_ambiguous_roots() {
        for extra in ["__MACOSX/../../outside", "other/readme.txt"] {
            let archive = zip_fixture(&[
                (
                    "Mod/meta.toml",
                    b"[metadata]\npackageID='test.finder'\ngame='toby.undertale'\n",
                ),
                ("Mod/modding.xml", b"<root/>"),
                (extra, b"untrusted"),
            ]);
            let packets = tempfile::tempdir().unwrap();
            assert!(import_archive(
                archive.path(),
                packets.path(),
                Limits::default(),
                || false,
                |_| DuplicateDecision::KeepExisting
            )
            .is_err());
            assert_eq!(fs::read_dir(packets.path()).unwrap().count(), 0);
        }
    }
}
