use crate::{
    channels::{import_download::run_import, nexus_oauth},
    error,
    state::AppState,
};
use deltamod_network_domain::{validate_https_url, Provider};
use deltamod_network_runtime::import_download::{
    validate_download_url, DownloadPolicy, HostAllowlist,
};
use deltamod_network_runtime::{Nexus, RuntimeError};
use deltamod_tauri_os_adapters::ChoiceBackend;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

// These parameters are fixed app-owned labels, never provider diagnostics.
fn download_failure(code: &'static str, message: &'static str) -> Value {
    json!({
        "code": code,
        "message": crate::localization::text(message),
        "messageSource": message
    })
}

fn nexus_download_error(error: RuntimeError) -> Value {
    let error = match error {
        RuntimeError::Auth(_) | RuntimeError::Http { status: 401, .. } => download_failure(
            "NEXUS_AUTH_FAILED",
            "Nexus Mods authorization is no longer valid. Sign in again.",
        ),
        RuntimeError::Http { status: 403, .. } | RuntimeError::Unsupported(_) => download_failure(
            "NEXUS_MANUAL_DOWNLOAD_REQUIRED",
            "This Nexus Mods file must be downloaded from its website.",
        ),
        RuntimeError::Http {
            status: 429,
            envelope,
            ..
        } => {
            let mut failure = download_failure(
                "NEXUS_RATE_LIMITED",
                "Nexus Mods asked Deltamod to wait before trying again.",
            );
            failure["status"] = json!(429);
            failure["retryAfterMs"] = json!(envelope.retry_after_ms);
            failure["quota"] = json!(envelope.quota);
            failure
        }
        _ => download_failure(
            "NEXUS_DOWNLOAD_FAILED",
            "The Nexus Mods download could not be completed.",
        ),
    };
    json!({"ok": false, "error": error})
}

fn download_nexus<D: ChoiceBackend>(
    app: &AppHandle,
    state: &AppState,
    dialogs: &D,
    data: &[Value],
) -> Result<Value, String> {
    let request = data
        .first()
        .and_then(Value::as_object)
        .ok_or_else(|| error::invalid("modSources:downloadNexus"))?;
    let mod_id = request
        .get("modId")
        .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
        .filter(|value| *value > 0)
        .ok_or_else(|| error::invalid("modSources:downloadNexus"))?;
    let operation_id = request
        .get("operationId")
        .and_then(Value::as_str)
        .filter(|value| {
            (1..=64).contains(&value.len())
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
        .ok_or_else(|| error::invalid("modSources:downloadNexus"))?
        .to_owned();
    let source_url = request
        .get("sourceUrl")
        .and_then(Value::as_str)
        .ok_or_else(|| error::invalid("modSources:downloadNexus"))?;
    let source = validate_https_url(Provider::Nexus, source_url)
        .map_err(|_| error::invalid("modSources:downloadNexus"))?;
    if !matches!(source.host.as_str(), "nexusmods.com" | "www.nexusmods.com") {
        return Err(error::invalid("modSources:downloadNexus"));
    }
    let game = state
        .game
        .dispatch("getCurrentGameInfo", &[])
        .map_err(|_| error::unavailable("modSources:downloadNexus"))?
        .ok_or_else(|| error::unavailable("modSources:downloadNexus"))?;
    let domain = game
        .pointer("/sources/nexus/domain")
        .and_then(Value::as_str)
        .filter(|value| {
            (1..=80).contains(&value.len())
                && value
                    .bytes()
                    .next()
                    .is_some_and(|byte| byte.is_ascii_alphanumeric())
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
        .ok_or_else(|| error::unavailable("modSources:downloadNexus"))?
        .to_owned();
    let expected_source = format!("https://www.nexusmods.com/{domain}/mods/{mod_id}");
    if source.raw.trim_end_matches('/') != expected_source {
        return Err(error::invalid("modSources:downloadNexus"));
    }

    let access_token = match nexus_oauth::access_token(state) {
        Ok(Some(token)) => token,
        Ok(None) => {
            return Ok(json!({
                "ok": false,
                "error": download_failure("NEXUS_AUTH_REQUIRED", "Nexus Mods authorization is required.")
            }));
        }
        Err(failure) => return Ok(failure.response()),
    };
    let (_, cancel) = watch::channel(false);
    let runtime = state
        .network_runtime
        .lock()
        .map_err(|_| error::internal())?;
    let resolved = match runtime.block_on(
        Nexus {
            client: &state.network,
            access_token: Some(access_token),
        }
        .resolve_primary_download(&domain, mod_id),
    ) {
        Ok(resolved) => resolved,
        Err(network_error) => return Ok(nexus_download_error(network_error)),
    };
    if validate_download_url(&resolved.download_url, HostAllowlist::NEXUS).is_err() {
        return Ok(json!({
            "ok": false,
            "error": download_failure("NEXUS_DOWNLOAD_FAILED", "Nexus Mods returned an unapproved download host.")
        }));
    }
    let download_policy = DownloadPolicy {
        maximum_bytes: resolved.maximum_bytes,
        maximum_redirects: 5,
    };
    let downloaded = runtime.block_on(state.network.download_allowlisted(
        operation_id.clone(),
        &resolved.download_url,
        HostAllowlist::NEXUS,
        download_policy,
        &cancel,
        |progress| {
            let _ = app.emit(
                "mod-source-progress",
                json!({
                    "operationId": operation_id,
                    "phase": "download",
                    "completed": progress.completed,
                    "total": progress.total.unwrap_or(0),
                    "currentItem": crate::localization::text("Nexus Mods archive"),
                    "currentItemSource": "Nexus Mods archive"
                }),
            );
        },
    ));
    drop(runtime);
    let downloaded = match downloaded {
        Ok(downloaded) => downloaded,
        Err(network_error) => return Ok(nexus_download_error(network_error)),
    };
    let _ = app.emit(
        "mod-source-progress",
        json!({
            "operationId": operation_id,
            "phase": "import",
            "completed": downloaded.bytes,
            "total": downloaded.total.unwrap_or(downloaded.bytes),
            "currentItem": resolved.file_name
        }),
    );
    match run_import(
        dialogs,
        &downloaded.path,
        &state.data_root.root.join("packets"),
        None,
        || *cancel.borrow(),
    ) {
        Ok(Value::Bool(true)) => {
            let _ = app.emit(
                "mod-source-progress",
                json!({
                    "operationId": operation_id,
                    "phase": "complete",
                    "completed": downloaded.bytes,
                    "total": downloaded.total.unwrap_or(downloaded.bytes),
                    "currentItem": resolved.file_name
                }),
            );
            Ok(json!({"ok": true, "fileName": resolved.file_name}))
        }
        Ok(_) => Ok(json!({
            "ok": false,
            "error": download_failure("NEXUS_DOWNLOAD_FAILED", "The downloaded mod was not imported.")
        })),
        Err(_) => Ok(json!({
            "ok": false,
            "error": download_failure("NEXUS_DOWNLOAD_FAILED", "The downloaded Nexus Mods archive could not be imported.")
        })),
    }
}

pub fn dispatch<D: ChoiceBackend>(
    app: &AppHandle,
    state: &AppState,
    dialogs: &D,
    channel: &str,
    data: &[Value],
) -> Result<Option<Value>, String> {
    match channel {
        "modSources:downloadNexus" => download_nexus(app, state, dialogs, data).map(Some),
        _ => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use deltamod_network_runtime::{ErrorEnvelope, QuotaWindow};
    use std::collections::BTreeMap;

    #[test]
    fn download_failure_keeps_codes_and_never_exposes_raw_provider_diagnostics() {
        for (error, code, source) in [
            (
                RuntimeError::Auth("private authorization detail".into()),
                "NEXUS_AUTH_FAILED",
                "Nexus Mods authorization is no longer valid. Sign in again.",
            ),
            (
                RuntimeError::Unsupported("private provider detail".into()),
                "NEXUS_MANUAL_DOWNLOAD_REQUIRED",
                "This Nexus Mods file must be downloaded from its website.",
            ),
            (
                RuntimeError::IncompleteDownload,
                "NEXUS_DOWNLOAD_FAILED",
                "The Nexus Mods download could not be completed.",
            ),
        ] {
            let response = nexus_download_error(error);
            assert_eq!(response["ok"], false);
            assert_eq!(response["error"]["code"], code);
            assert_eq!(response["error"]["messageSource"], source);
            assert_eq!(
                response["error"]["message"],
                crate::localization::text(source)
            );
            assert!(!response.to_string().contains("private"));
        }
    }

    #[test]
    fn localized_rate_limit_failure_retains_retry_and_quota_metadata() {
        let quota = BTreeMap::from([(
            "hourly".to_owned(),
            QuotaWindow {
                limit: Some(100),
                remaining: Some(0),
                reset_unix: Some(1234),
            },
        )]);
        let response = nexus_download_error(RuntimeError::Http {
            status: 429,
            message: "private server detail".into(),
            envelope: Box::new(ErrorEnvelope {
                operation_id: Some("private-operation-id".into()),
                code: "private-provider-code".into(),
                message: "private provider detail".into(),
                status: Some(429),
                retry_after_ms: Some(30_000),
                quota: quota.clone(),
            }),
        });
        assert_eq!(response["error"]["code"], "NEXUS_RATE_LIMITED");
        assert_eq!(response["error"]["status"], 429);
        assert_eq!(response["error"]["retryAfterMs"], 30_000);
        assert_eq!(response["error"]["quota"], json!(quota));
        assert_eq!(
            response["error"]["messageSource"],
            "Nexus Mods asked Deltamod to wait before trying again."
        );
        assert!(!response.to_string().contains("private"));
    }
}
