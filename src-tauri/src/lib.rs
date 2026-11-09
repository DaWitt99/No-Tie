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
        .invoke_handler(tauri::generate_handler![save_archive_file])
        .run(tauri::generate_context!())
        .expect("Błąd uruchamiania aplikacji No-Tie");
}
