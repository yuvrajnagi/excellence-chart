use std::fmt;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub enum FileIoError {
    Io(std::io::Error),
    Json(serde_json::Error),
    Persist(String),
    InvalidFormat(String),
}

impl fmt::Display for FileIoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FileIoError::Io(err) => write!(f, "IO_ERROR: {}", err),
            FileIoError::Json(err) => write!(f, "JSON_ERROR: {}", err),
            FileIoError::Persist(msg) => write!(f, "PERSIST_ERROR: failed to atomically rename file: {}", msg),
            FileIoError::InvalidFormat(msg) => write!(f, "INVALID_FORMAT: {}", msg),
        }
    }
}

impl std::error::Error for FileIoError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            FileIoError::Io(err) => Some(err),
            FileIoError::Json(err) => Some(err),
            _ => None,
        }
    }
}

impl From<std::io::Error> for FileIoError {
    fn from(err: std::io::Error) -> Self {
        FileIoError::Io(err)
    }
}

impl From<serde_json::Error> for FileIoError {
    fn from(err: serde_json::Error) -> Self {
        FileIoError::Json(err)
    }
}

pub struct LocalFileIo;

impl LocalFileIo {
    /// Atomically saves content to a file path using a temporary file in the target directory
    /// followed by an atomic rename.
    pub fn save_openexcel(path: impl AsRef<Path>, content: &str) -> Result<PathBuf, FileIoError> {
        let path = path.as_ref();
        let parent = path.parent().unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(parent)?;

        let mut temp_file = tempfile::Builder::new()
            .prefix(".tmp_openexcel_")
            .tempfile_in(parent)?;

        temp_file.write_all(content.as_bytes())?;
        temp_file.as_file().sync_all()?;

        temp_file
            .persist(path)
            .map_err(|e| FileIoError::Persist(e.to_string()))?;

        Ok(path.to_path_buf())
    }

    /// Saves a JSON workbook representation to a .openexcel file atomically.
    pub fn save_workbook_json(
        path: impl AsRef<Path>,
        workbook: &serde_json::Value,
    ) -> Result<PathBuf, FileIoError> {
        let content = serde_json::to_string_pretty(workbook)?;
        Self::save_openexcel(path, &content)
    }

    /// Saves an openexcel_core::types::Workbook to a .openexcel file atomically.
    pub fn save_workbook_core(
        path: impl AsRef<Path>,
        workbook: &openexcel_core::types::Workbook,
    ) -> Result<PathBuf, FileIoError> {
        let content = serde_json::to_string_pretty(workbook)?;
        Self::save_openexcel(path, &content)
    }

    /// Reads raw string content from a .openexcel file.
    pub fn load_openexcel(path: impl AsRef<Path>) -> Result<String, FileIoError> {
        let content = fs::read_to_string(path)?;
        Ok(content)
    }

    /// Loads and validates a .openexcel file into a serde_json::Value.
    pub fn load_workbook_json(path: impl AsRef<Path>) -> Result<serde_json::Value, FileIoError> {
        let content = Self::load_openexcel(path)?;
        let value: serde_json::Value = serde_json::from_str(&content)?;

        if !value.is_object() {
            return Err(FileIoError::InvalidFormat(
                "Workbook file root must be a JSON object".to_string(),
            ));
        }

        // Validate that schemaVersion or id is present
        if value.get("schemaVersion").is_none() && value.get("id").is_none() {
            return Err(FileIoError::InvalidFormat(
                "Workbook file missing schemaVersion or id identifier".to_string(),
            ));
        }

        Ok(value)
    }

    /// Loads a .openexcel file into an openexcel_core::types::Workbook.
    pub fn load_workbook_core(
        path: impl AsRef<Path>,
    ) -> Result<openexcel_core::types::Workbook, FileIoError> {
        let content = Self::load_openexcel(path)?;
        let workbook: openexcel_core::types::Workbook = serde_json::from_str(&content)?;
        Ok(workbook)
    }
}
