//! Windows reference files: unmodified `data.win` files from the user's own
//! Windows copy of the game. Mods are made against these files, so platforms
//! whose data file differs (DELTARUNE's Mac `game.ios`) apply `.xdelta` mods to
//! the reference copy and publish the result in place of their own data file.

use crate::{error, state::AppState};
use deltamod_tauri_os_adapters::{DialogBackend, DialogFilter, DialogRequest};
use serde_json::{json, Value};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

const MAX_CHAPTERS: u8 = 7;
const MAX_REFERENCE_FILE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const NO_FILES_MESSAGE: &str = "That folder has no unmodified Windows data.win files. Choose the Windows game folder that contains DELTARUNE.exe and the chapter1_windows, chapter2_windows, … folders.";

/// Every reference file a mod can target, relative to the Windows game folder.
fn reference_candidates() -> Vec<String> {
    std::iter::once("data.win".to_owned())
        .chain((1..=MAX_CHAPTERS).map(|chapter| format!("chapter{chapter}_windows/data.win")))
        .collect()
}

fn current_root(state: &AppState) -> Option<PathBuf> {
    let game = super::runtime::active_game_id(state)?;
    crate::state::reference_files_root(&state.data_root, &game)
}

/// True when this platform renames the game's data file, so `.xdelta` mods
/// cannot be applied to the installed game directly.
fn needed(state: &AppState) -> bool {
    state
        .patching
        .definition
        .data_files
        .first()
        .is_some_and(|file| !file.eq_ignore_ascii_case("data.win"))
}

fn present_files(root: &Path) -> Vec<String> {
    reference_candidates()
        .into_iter()
        .filter(|relative| is_game_data_file(&root.join(relative)))
        .collect()
}

/// A regular, non-linked GameMaker data file (IFF `FORM` header).
fn is_game_data_file(path: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    if !metadata.is_file() || metadata.len() < 8 || metadata.len() > MAX_REFERENCE_FILE_BYTES {
        return false;
    }
    let mut magic = [0_u8; 4];
    fs::File::open(path)
        .and_then(|mut file| file.read_exact(&mut magic))
        .is_ok_and(|()| &magic == b"FORM")
}

fn status(state: &AppState) -> Value {
    let files = current_root(state)
        .map(|root| present_files(&root))
        .unwrap_or_default();
    json!({
        "needed": needed(state),
        "files": files,
    })
}

fn choose<D: DialogBackend>(
    dialogs: &D,
    state: &AppState,
    data: &[Value],
) -> Result<Value, String> {
    // Only platforms that rename the game's data file (macOS) use reference files.
    if !needed(state) {
        return Err(error::unavailable("referenceFiles:choose"));
    }
    let root = current_root(state).ok_or_else(|| error::unavailable("referenceFiles:choose"))?;
    let parent = root.parent().ok_or_else(error::internal)?.to_path_buf();
    // "archive" accepts a downloaded .zip/.7z (itch purchases ship zipped),
    // { "path": "..." } imports an existing folder discovered by this channel,
    // anything else keeps the folder picker.
    let arg = data.first();
    let picked_path = arg.and_then(|arg| arg.get("path")).and_then(Value::as_str);
    let archive = arg
        .and_then(Value::as_str)
        .is_some_and(|kind| kind == "archive");
    let selected;
    if let Some(path) = picked_path {
        let request = DialogRequest::folder("Windows game folder");
        selected = Some(
            deltamod_tauri_os_adapters::validate_dialog_selection(&request, Path::new(path))
                .map_err(|_| error::internal())?,
        );
    } else {
        let request = if archive {
            DialogRequest::file("Choose your Windows DELTARUNE archive").filter(
                DialogFilter::new("Archives", ["zip", "7z"]).map_err(|_| error::internal())?,
            )
        } else {
            DialogRequest::folder("Choose your Windows DELTARUNE folder")
        };
        selected = dialogs.pick(&request).map_err(|_| error::internal())?;
    }
    let Some(selected) = selected else {
        return Ok(Value::Null);
    };
    // An archive's bounded extraction lands beside the reference root and is
    // removed once the candidate files are staged from it.
    let extracted = if archive {
        let destination = parent.join(format!(".reference-extract-{}", uuid::Uuid::new_v4()));
        if let Err(error) = deltamod_archive_import_runtime::extract_archive_bounded(
            &selected,
            &destination,
            reference_archive_limits(),
            chapter_layout_dir,
            || false,
        ) {
            let _ = fs::remove_dir_all(&destination);
            return Err(error.to_string());
        }
        Some(destination)
    } else {
        None
    };
    let source = extracted.clone().unwrap_or(selected);
    let found = present_files(&source);
    let result = if found.is_empty() {
        Ok(json!({
            "ok": false,
            "message": crate::localization::text(NO_FILES_MESSAGE),
            "messageSource": NO_FILES_MESSAGE
        }))
    } else {
        publish(&source, &found, &root, state)
    };
    if let Some(dir) = extracted {
        let _ = fs::remove_dir_all(dir);
    }
    result
}

// An archive made of only `chapter3_windows/data.win` must keep that directory:
// unwrapping it would store the chapter file as the root data.win reference.
fn chapter_layout_dir(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    let Some(rest) = name.strip_prefix("chapter") else {
        return false;
    };
    let Some(digits) = rest.strip_suffix("_windows") else {
        return false;
    };
    !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit())
}

fn reference_archive_limits() -> deltamod_archive_import_runtime::Limits {
    deltamod_archive_import_runtime::Limits {
        max_entries: 10_000,
        max_archive_bytes: 4 * 1024 * 1024 * 1024,
        max_entry_bytes: MAX_REFERENCE_FILE_BYTES,
        max_expanded_bytes: 8 * 1024 * 1024 * 1024,
        max_ratio: 200,
        max_depth: 32,
        max_manifest_bytes: 1024 * 1024,
    }
}

fn publish(
    source: &Path,
    found: &[String],
    root: &Path,
    state: &AppState,
) -> Result<Value, String> {
    let parent = root.parent().ok_or_else(error::internal)?;
    fs::create_dir_all(parent).map_err(|_| error::internal())?;
    let staging = parent.join(format!(".reference-{}", uuid::Uuid::new_v4()));
    let result = stage_and_publish(source, found, &staging, root);
    if result.is_err() {
        let _ = fs::remove_dir_all(staging);
    }
    result?;
    let mut response = status(state);
    response["ok"] = json!(true);
    Ok(response)
}

/// Copies into a private sibling folder first, so a failed or partial copy never
/// replaces a working set. On APFS `fs::copy` clones, using almost no space.
fn stage_and_publish(
    source: &Path,
    files: &[String],
    staging: &Path,
    root: &Path,
) -> Result<(), String> {
    for relative in files {
        let from = source.join(relative);
        let to = staging.join(relative);
        fs::create_dir_all(to.parent().ok_or_else(error::internal)?)
            .map_err(|_| error::internal())?;
        let copied = fs::copy(&from, &to).map_err(|_| error::internal())?;
        if copied != fs::metadata(&from).map_err(|_| error::internal())?.len()
            || !is_game_data_file(&to)
        {
            return Err(error::internal());
        }
    }
    if root.exists() {
        let retired = staging.with_extension("old");
        fs::rename(root, &retired).map_err(|_| error::internal())?;
        if fs::rename(staging, root).is_err() {
            let _ = fs::rename(&retired, root);
            return Err(error::internal());
        }
        let _ = fs::remove_dir_all(retired);
    } else {
        fs::rename(staging, root).map_err(|_| error::internal())?;
    }
    Ok(())
}

pub fn dispatch<D: DialogBackend>(
    state: &AppState,
    dialogs: &D,
    channel: &str,
    data: &[Value],
) -> Result<Option<Value>, String> {
    Ok(Some(match channel {
        "referenceFiles:status" => status(state),
        "referenceFiles:choose" => choose(dialogs, state, data)?,
        "referenceFiles:discover" => discover(state),
        _ => return Ok(None),
    }))
}

/// Scans the usual places an existing Windows install hides on this machine —
/// CrossOver/Whisky bottles, external volumes, Downloads/Desktop — for folders
/// carrying unmodified `data.win` files. Bounded: at most `MAX_SCAN_DIRS`
/// directories are visited across all roots and each root caps its depth.
const MAX_SCAN_DIRS: usize = 4096;
const MAX_DISCOVERED: usize = 32;

fn discovery_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        roots.extend([
            home.join("Library/Application Support/CrossOver/Bottles"),
            home.join("Library/Application Support/com.isaacmarovitz.Whisky"),
            home.join("Downloads"),
            home.join("Desktop"),
        ]);
    }
    roots
}

/// Directories never worth descending into while scanning for a Windows game.
fn descendable(name: &str) -> bool {
    !name.starts_with('.')
        && !name.ends_with(".app")
        && !name.eq_ignore_ascii_case("__MACOSX")
        && !name.eq_ignore_ascii_case("$RECYCLE.BIN")
}

/// Subdirectories of a mounted volume that plausibly hold a Windows install.
fn volume_descendable(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.contains("steam")
        || lower.contains("gog")
        || lower.contains("deltarune")
        || lower.contains("undertale")
        || lower.starts_with("program files")
        || lower == "games"
}

fn volume_roots() -> Vec<PathBuf> {
    let volumes = Path::new("/Volumes");
    let Ok(entries) = fs::read_dir(volumes) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| entry.path())
        .collect()
}

fn discover(state: &AppState) -> Value {
    if !needed(state) {
        return json!({ "needed": false, "candidates": [] });
    }
    let mut visited = 0_usize;
    let mut candidates = Vec::new();
    'roots: for (root, depth) in discovery_roots()
        .into_iter()
        .map(|root| (root, 8_usize))
        .chain(volume_roots().into_iter().map(|root| (root, 4_usize)))
    {
        let mut queue = std::collections::VecDeque::from([(root, 0_usize)]);
        while let Some((dir, level)) = queue.pop_front() {
            if visited >= MAX_SCAN_DIRS || candidates.len() >= MAX_DISCOVERED {
                break 'roots;
            }
            visited += 1;
            let files = present_files(&dir);
            if !files.is_empty() {
                candidates.push(json!({
                    "path": dir.to_string_lossy(),
                    "files": files,
                }));
                continue;
            }
            if level >= depth {
                continue;
            }
            let Ok(entries) = fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                if !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                    continue;
                }
                let name = entry.file_name();
                let Some(name) = name.to_str() else {
                    continue;
                };
                if !descendable(name) {
                    continue;
                }
                // Direct children of a volume are always checked, but only
                // plausibly game-related folders are descended further.
                if level == 1 && depth == 4 && !volume_descendable(name) {
                    continue;
                }
                queue.push_back((entry.path(), level + 1));
            }
        }
    }
    json!({ "needed": true, "candidates": candidates })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data_file(path: &Path, body: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut bytes = b"FORM".to_vec();
        bytes.extend_from_slice(body);
        fs::write(path, bytes).unwrap();
    }

    #[test]
    fn only_gamemaker_data_files_in_known_places_are_references() {
        let dir = std::env::temp_dir().join(format!("deltamod-ref-{}", uuid::Uuid::new_v4()));
        data_file(&dir.join("data.win"), b"root");
        data_file(&dir.join("chapter3_windows/data.win"), b"three");
        fs::create_dir_all(dir.join("chapter4_windows")).unwrap();
        fs::write(dir.join("chapter4_windows/data.win"), b"not gamemaker").unwrap();
        data_file(&dir.join("chapter9_windows/data.win"), b"unknown chapter");
        assert_eq!(
            present_files(&dir),
            ["data.win", "chapter3_windows/data.win"]
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn publishing_replaces_the_previous_set_atomically() {
        let dir = std::env::temp_dir().join(format!("deltamod-ref-{}", uuid::Uuid::new_v4()));
        let source = dir.join("windows");
        let root = dir.join("reference-files/toby.deltarune");
        data_file(&source.join("chapter3_windows/data.win"), b"three");
        data_file(&root.join("chapter1_windows/data.win"), b"old");
        let files = present_files(&source);
        stage_and_publish(&source, &files, &dir.join("reference-files/.stage"), &root).unwrap();
        assert_eq!(present_files(&root), ["chapter3_windows/data.win"]);
        assert_eq!(
            fs::read_dir(dir.join("reference-files")).unwrap().count(),
            1,
            "no staging or retired folders are left behind"
        );
        let _ = fs::remove_dir_all(dir);
    }
}
