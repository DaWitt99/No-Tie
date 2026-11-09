use serde::{Deserialize, Serialize};
#[cfg(desktop)]
use std::io::Write;
#[cfg(desktop)]
use std::path::{Component, Path};
use tauri_plugin_dialog::DialogExt;
#[cfg(mobile)]
use tauri_plugin_fs::{FsExt, OpenOptions};

#[cfg(desktop)]
#[tauri::command]
async fn save_archive_file(
    app: tauri::AppHandle,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<Option<String>, String> {
    let file_path = Path::new(&file_name);
    if file_path.components().count() != 1
        || !matches!(file_path.components().next(), Some(Component::Normal(_)))
        || file_path
            .extension()
            .and_then(|extension| extension.to_str())
            != Some("zip")
    {
        return Err("Nieprawidłowa nazwa pliku paczki ZIP.".into());
    }

    let Some(selected_folder) = app
        .dialog()
        .file()
        .set_title("Wybierz folder zapisu paczki ZIP")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let folder = selected_folder
        .into_path()
        .map_err(|error| format!("Nie udało się odczytać wybranego folderu: {error}"))?;
    if !folder.is_dir() {
        return Err("Wybrany folder nie istnieje lub nie jest dostępny.".into());
    }

    let stem = file_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("no-tie-notatki");
    let mut suffix = 1_u32;
    loop {
        let candidate_name = if suffix == 1 {
            file_name.clone()
        } else {
            format!("{stem}-{suffix}.zip")
        };
        let candidate = folder.join(candidate_name);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(mut output) => {
                if let Err(error) = output.write_all(&bytes) {
                    let _ = std::fs::remove_file(&candidate);
                    return Err(format!("Nie udało się zapisać paczki ZIP: {error}"));
                }
                return Ok(Some(candidate.to_string_lossy().into_owned()));
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => suffix += 1,
            Err(error) => return Err(format!("Nie udało się utworzyć paczki ZIP: {error}")),
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
struct OllamaModel {
    name: String,
    #[serde(default)]
    size: Option<u64>,
    #[serde(default)]
    modified_at: Option<String>,
}

#[derive(Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaModel>,
}

#[derive(Clone, Deserialize, Serialize)]
struct OllamaMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct OllamaChatStreamChunk {
    #[serde(default)]
    message: Option<OllamaMessage>,
    #[serde(default)]
    error: Option<String>,
}

fn ollama_api_url(base_url: &str, route: &str) -> Result<String, String> {
    let base_url = base_url.trim().trim_end_matches('/');
    let parsed = reqwest::Url::parse(base_url).map_err(|_| {
        "Podaj prawidłowy adres serwera Ollama, np. http://localhost:11434.".to_string()
    })?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Adres Ollama musi zaczynać się od http:// lub https://.".into());
    }
    let base_url = base_url.strip_suffix("/api").unwrap_or(base_url);
    Ok(format!("{base_url}/api/{route}"))
}

#[tauri::command]
async fn ollama_list_models(base_url: String) -> Result<Vec<OllamaModel>, String> {
    let url = ollama_api_url(&base_url, "tags")?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|error| format!("Nie udało się przygotować połączenia: {error}"))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|_| format!("Nie można połączyć się z Ollama pod adresem {base_url}. Sprawdź, czy Ollama jest uruchomiona."))?;
    let response = response
        .error_for_status()
        .map_err(|error| format!("Ollama zwróciła błąd: {error}"))?;
    response
        .json::<OllamaTagsResponse>()
        .await
        .map(|result| result.models)
        .map_err(|error| format!("Nie udało się odczytać listy modeli Ollama: {error}"))
}

fn forward_ollama_stream_line(
    line: &[u8],
    on_chunk: &tauri::ipc::Channel<String>,
) -> Result<(), String> {
    let line = String::from_utf8_lossy(line);
    let line = line.trim();
    if line.is_empty() {
        return Ok(());
    }
    let chunk: OllamaChatStreamChunk = serde_json::from_str(line)
        .map_err(|error| format!("Nie udało się odczytać strumienia Ollama: {error}"))?;
    if let Some(error) = chunk.error {
        return Err(error);
    }
    if let Some(message) = chunk.message {
        if !message.content.is_empty() {
            on_chunk
                .send(message.content)
                .map_err(|error| format!("Nie udało się przesłać odpowiedzi do interfejsu: {error}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn ollama_chat_stream(
    base_url: String,
    model: String,
    messages: Vec<OllamaMessage>,
    on_chunk: tauri::ipc::Channel<String>,
) -> Result<(), String> {
    let model = model.trim();
    if model.is_empty() {
        return Err("Wybierz model w ustawieniach Ollama.".into());
    }
    let url = ollama_api_url(&base_url, "chat")?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|error| format!("Nie udało się przygotować połączenia: {error}"))?;
    let response = client
        .post(url)
        .json(&serde_json::json!({ "model": model, "messages": messages, "stream": true }))
        .send()
        .await
        .map_err(|_| format!("Nie można połączyć się z Ollama pod adresem {base_url}. Sprawdź, czy Ollama jest uruchomiona."))?;
    let response = response
        .error_for_status()
        .map_err(|error| format!("Ollama zwróciła błąd: {error}"))?;
    let mut response = response;
    let mut pending = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Nie udało się odebrać strumienia Ollama: {error}"))?
    {
        pending.extend_from_slice(&chunk);
        while let Some(line_end) = pending.iter().position(|byte| *byte == b'\n') {
            let line = pending.drain(..=line_end).collect::<Vec<_>>();
            forward_ollama_stream_line(&line, &on_chunk)?;
        }
    }
    if !pending.is_empty() {
        forward_ollama_stream_line(&pending, &on_chunk)?;
    }
    Ok(())
}

#[cfg(mobile)]
#[tauri::command]
async fn save_archive_file(
    app: tauri::AppHandle,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<Option<String>, String> {
    let Some(selected_file) = app
        .dialog()
        .file()
        .set_title("Zapisz paczkę ZIP")
        .set_file_name(file_name)
        .add_filter("Paczka ZIP", &["zip"])
        .blocking_save_file()
    else {
        return Ok(None);
    };

    let mut options = OpenOptions::new();
    options.read(false).write(true).truncate(true);
    let mut output = app
        .fs()
        .open(selected_file.clone(), options)
        .map_err(|error| format!("Nie udało się otworzyć wybranego pliku: {error}"))?;
    let write_result = std::io::Write::write_all(&mut output, &bytes);
    drop(output);

    #[cfg(target_os = "ios")]
    app.fs()
        .stop_accessing_security_scoped_resource(selected_file.clone())
        .map_err(|error| format!("Nie udało się zamknąć dostępu do pliku: {error}"))?;

    write_result.map_err(|error| format!("Nie udało się zapisać paczki ZIP: {error}"))?;
    Ok(Some(selected_file.to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            save_archive_file,
            ollama_list_models,
            ollama_chat_stream
        ])
        .run(tauri::generate_context!())
        .expect("Błąd uruchamiania aplikacji No-Tie");
}
