use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;
use std::path::Path;

#[derive(Debug)]
pub enum StorageError {
    NotFound(String),
    VersionConflict { current: i64, expected: i64 },
    SaveIdReused,
    Sqlite(rusqlite::Error),
    Serialization(String),
    InvalidInput(String),
}

impl fmt::Display for StorageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StorageError::NotFound(id) => write!(f, "NOT_FOUND: workbook '{}' not found", id),
            StorageError::VersionConflict { current, expected } => write!(
                f,
                "VERSION_CONFLICT: expected version {}, but storage version is {}",
                expected, current
            ),
            StorageError::SaveIdReused => write!(
                f,
                "SAVE_ID_REUSED: save ID was previously used for a different snapshot"
            ),
            StorageError::Sqlite(err) => write!(f, "SQLITE_ERROR: {}", err),
            StorageError::Serialization(msg) => write!(f, "SERIALIZATION_ERROR: {}", msg),
            StorageError::InvalidInput(msg) => write!(f, "INVALID_INPUT: {}", msg),
        }
    }
}

impl std::error::Error for StorageError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            StorageError::Sqlite(err) => Some(err),
            _ => None,
        }
    }
}

impl From<rusqlite::Error> for StorageError {
    fn from(err: rusqlite::Error) -> Self {
        StorageError::Sqlite(err)
    }
}

impl StorageError {
    pub fn error_code(&self) -> &'static str {
        match self {
            StorageError::NotFound(_) => "NOT_FOUND",
            StorageError::VersionConflict { .. } => "VERSION_CONFLICT",
            StorageError::SaveIdReused => "SAVE_ID_REUSED",
            StorageError::Sqlite(_) => "SQLITE_ERROR",
            StorageError::Serialization(_) => "SERIALIZATION_ERROR",
            StorageError::InvalidInput(_) => "INVALID_INPUT",
        }
    }

    pub fn status_code(&self) -> u16 {
        match self {
            StorageError::NotFound(_) => 404,
            StorageError::VersionConflict { .. } => 409,
            StorageError::SaveIdReused => 409,
            StorageError::InvalidInput(_) => 400,
            StorageError::Sqlite(_) => 500,
            StorageError::Serialization(_) => 500,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkbookRow {
    pub id: String,
    pub name: String,
    pub snapshot: String,
    pub version: i64,
    pub revision: i64,
    pub created: String,
    pub updated: String,
    pub opened: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookSummary {
    pub id: String,
    pub name: String,
    pub storage_version: i64,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
    pub opened_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveReceipt {
    pub id: String,
    pub storage_version: i64,
    pub saved_revision: i64,
    pub saved_at: String,
    pub save_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListWorkbooksResponse {
    pub items: Vec<WorkbookSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GetWorkbookResponse {
    pub workbook: serde_json::Value,
    pub storage_version: i64,
    pub saved_at: String,
}

pub struct WorkbookStore {
    conn: Connection,
}

impl WorkbookStore {
    /// Opens or creates a SQLite database at the specified path with WAL mode and full durability.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StorageError> {
        let conn = Connection::open(path)?;
        let store = Self { conn };
        store.init_schema()?;
        Ok(store)
    }

    /// Creates an in-memory SQLite database for ephemeral testing.
    pub fn in_memory() -> Result<Self, StorageError> {
        let conn = Connection::open_in_memory()?;
        let store = Self { conn };
        store.init_schema()?;
        Ok(store)
    }

    fn init_schema(&self) -> Result<(), StorageError> {
        self.conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = FULL;
             PRAGMA busy_timeout = 5000;
             PRAGMA foreign_keys = ON;

             CREATE TABLE IF NOT EXISTS workbooks (
                 id TEXT PRIMARY KEY,
                 name TEXT NOT NULL,
                 snapshot TEXT NOT NULL,
                 version INTEGER NOT NULL,
                 revision INTEGER NOT NULL,
                 created TEXT NOT NULL,
                 updated TEXT NOT NULL,
                 opened TEXT NOT NULL
             );

             CREATE INDEX IF NOT EXISTS idx_workbooks_updated ON workbooks(updated DESC);
             CREATE INDEX IF NOT EXISTS idx_workbooks_opened ON workbooks(opened DESC);

             CREATE TABLE IF NOT EXISTS saves (
                 workbook_id TEXT NOT NULL,
                 save_id TEXT NOT NULL,
                 digest TEXT NOT NULL,
                 response TEXT NOT NULL,
                 PRIMARY KEY(workbook_id, save_id),
                 FOREIGN KEY(workbook_id) REFERENCES workbooks(id) ON DELETE CASCADE
             );",
        )?;
        Ok(())
    }

    /// Creates a new workbook in the store with version 1.
    pub fn create(
        &mut self,
        id: &str,
        name: &str,
        snapshot: &str,
        revision: i64,
    ) -> Result<WorkbookRow, StorageError> {
        let now = Utc::now().to_rfc3339();
        let version = 1i64;

        self.conn.execute(
            "INSERT INTO workbooks (id, name, snapshot, version, revision, created, updated, opened)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, name, snapshot, version, revision, now, now, now],
        )?;

        Ok(WorkbookRow {
            id: id.to_string(),
            name: name.to_string(),
            snapshot: snapshot.to_string(),
            version,
            revision,
            created: now.clone(),
            updated: now.clone(),
            opened: now,
        })
    }

    /// Creates a workbook from a serde_json::Value representing a workbook.
    pub fn create_from_json(
        &mut self,
        workbook: &serde_json::Value,
    ) -> Result<GetWorkbookResponse, StorageError> {
        let id = workbook
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| StorageError::InvalidInput("Missing workbook id".to_string()))?;
        let name = workbook
            .get("properties")
            .and_then(|p| p.get("name"))
            .and_then(|n| n.as_str())
            .unwrap_or("Untitled");
        let revision = workbook
            .get("revision")
            .and_then(|r| r.as_i64())
            .unwrap_or(0);
        let snapshot = serde_json::to_string(workbook)
            .map_err(|e| StorageError::Serialization(e.to_string()))?;

        let row = self.create(id, name, &snapshot, revision)?;
        Ok(GetWorkbookResponse {
            workbook: workbook.clone(),
            storage_version: row.version,
            saved_at: row.updated,
        })
    }

    /// Retrieves a workbook row by ID. Optionally updates the `opened` timestamp.
    pub fn get(&mut self, id: &str, touch: bool) -> Result<WorkbookRow, StorageError> {
        let row_opt = self.conn.query_row(
            "SELECT id, name, snapshot, version, revision, created, updated, opened FROM workbooks WHERE id = ?1",
            params![id],
            |row| {
                Ok(WorkbookRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    snapshot: row.get(2)?,
                    version: row.get(3)?,
                    revision: row.get(4)?,
                    created: row.get(5)?,
                    updated: row.get(6)?,
                    opened: row.get(7)?,
                })
            },
        ).optional()?;

        let mut workbook_row = row_opt.ok_or_else(|| StorageError::NotFound(id.to_string()))?;

        if touch {
            let now = Utc::now().to_rfc3339();
            self.conn.execute(
                "UPDATE workbooks SET opened = ?1 WHERE id = ?2",
                params![now, id],
            )?;
            workbook_row.opened = now;
        }

        Ok(workbook_row)
    }

    /// Retrieves a workbook parsed as JSON along with its storage version and saved timestamp.
    pub fn get_json(&mut self, id: &str, touch: bool) -> Result<GetWorkbookResponse, StorageError> {
        let row = self.get(id, touch)?;
        let parsed: serde_json::Value = serde_json::from_str(&row.snapshot)
            .map_err(|e| StorageError::Serialization(e.to_string()))?;
        Ok(GetWorkbookResponse {
            workbook: parsed,
            storage_version: row.version,
            saved_at: row.updated,
        })
    }

    /// Saves a workbook snapshot atomically using BEGIN IMMEDIATE, optimistic concurrency control,
    /// and idempotent SHA-256 digest caching bounded to 100 receipts.
    pub fn save(
        &mut self,
        workbook_id: &str,
        name: &str,
        snapshot: &str,
        revision: i64,
        expected_version: i64,
        save_id: &str,
    ) -> Result<SaveReceipt, StorageError> {
        let mut hasher = Sha256::new();
        hasher.update(snapshot.as_bytes());
        let digest = format!("{:x}", hasher.finalize());

        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;

        // 1. Idempotency Check: if this (workbook_id, save_id) has already been saved
        let cached_receipt: Option<(String, String)> = tx
            .query_row(
                "SELECT digest, response FROM saves WHERE workbook_id = ?1 AND save_id = ?2",
                params![workbook_id, save_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;

        if let Some((prev_digest, cached_response)) = cached_receipt {
            if prev_digest != digest {
                return Err(StorageError::SaveIdReused);
            }
            tx.commit()?;
            let receipt: SaveReceipt = serde_json::from_str(&cached_response)
                .map_err(|e| StorageError::Serialization(e.to_string()))?;
            return Ok(receipt);
        }

        // 2. Concurrency Check: verify current storage version matches expected_version
        let current_version: Option<i64> = tx
            .query_row(
                "SELECT version FROM workbooks WHERE id = ?1",
                params![workbook_id],
                |row| row.get(0),
            )
            .optional()?;

        let current = match current_version {
            Some(v) => v,
            None => return Err(StorageError::NotFound(workbook_id.to_string())),
        };

        if current != expected_version {
            return Err(StorageError::VersionConflict {
                current,
                expected: expected_version,
            });
        }

        // 3. Update workbook
        let new_version = current + 1;
        let now = Utc::now().to_rfc3339();
        tx.execute(
            "UPDATE workbooks SET name = ?1, snapshot = ?2, version = ?3, revision = ?4, updated = ?5 WHERE id = ?6",
            params![name, snapshot, new_version, revision, now, workbook_id],
        )?;

        // 4. Record save receipt
        let receipt = SaveReceipt {
            id: workbook_id.to_string(),
            storage_version: new_version,
            saved_revision: revision,
            saved_at: now,
            save_id: save_id.to_string(),
        };

        let response_str = serde_json::to_string(&receipt)
            .map_err(|e| StorageError::Serialization(e.to_string()))?;

        tx.execute(
            "INSERT INTO saves (workbook_id, save_id, digest, response) VALUES (?1, ?2, ?3, ?4)",
            params![workbook_id, save_id, digest, response_str],
        )?;

        // 5. Trim older receipts (keep recent 100 receipts per workbook)
        tx.execute(
            "DELETE FROM saves WHERE workbook_id = ?1 AND rowid NOT IN (
                SELECT rowid FROM saves WHERE workbook_id = ?1 ORDER BY rowid DESC LIMIT 100
             )",
            params![workbook_id],
        )?;

        tx.commit()?;
        Ok(receipt)
    }

    /// Lists workbooks with pagination and ordering.
    pub fn list(
        &self,
        limit: usize,
        offset: usize,
        order: &str,
    ) -> Result<ListWorkbooksResponse, StorageError> {
        let order_col = match order {
            "updated" => "updated",
            _ => "opened",
        };

        let sql = format!(
            "SELECT id, name, version, revision, created, updated, opened
             FROM workbooks
             ORDER BY {} DESC, id ASC
             LIMIT ?1 OFFSET ?2",
            order_col
        );

        let fetch_limit = limit + 1;
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(params![fetch_limit as i64, offset as i64], |row| {
            Ok(WorkbookSummary {
                id: row.get(0)?,
                name: row.get(1)?,
                storage_version: row.get(2)?,
                revision: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                opened_at: row.get(6)?,
            })
        })?;

        let mut items = Vec::new();
        for r in rows {
            items.push(r?);
        }

        let next_cursor = if items.len() > limit {
            items.truncate(limit);
            Some((offset + limit).to_string())
        } else {
            None
        };

        Ok(ListWorkbooksResponse { items, next_cursor })
    }

    /// Deletes a workbook and cascades its save receipts.
    pub fn delete(&mut self, id: &str) -> Result<bool, StorageError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;

        let deleted_count =
            tx.execute("DELETE FROM workbooks WHERE id = ?1", params![id])?;

        if deleted_count == 0 {
            return Err(StorageError::NotFound(id.to_string()));
        }

        tx.execute("DELETE FROM saves WHERE workbook_id = ?1", params![id])?;
        tx.commit()?;
        Ok(true)
    }

    /// Helper to verify SQLite journal mode is WAL.
    pub fn journal_mode(&self) -> Result<String, StorageError> {
        let mode: String = self
            .conn
            .query_row("PRAGMA journal_mode;", [], |row| row.get(0))?;
        Ok(mode)
    }
}

/// Helper function to create a new canonical blank workbook JSON structure matching schemaVersion 1.
pub fn create_blank_workbook(id: &str, name: &str) -> serde_json::Value {
    let now = Utc::now().to_rfc3339();
    let sheet_id = "sheet1";
    serde_json::json!({
        "schemaVersion": 1,
        "id": id,
        "revision": 0,
        "properties": {
            "name": name,
            "dateSystem": "1900",
            "locale": "en-US",
            "author": "OpenExcel Desktop",
            "description": "",
            "createdAt": now,
            "modifiedAt": now,
            "activeSheetId": sheet_id,
            "theme": {
                "name": "OpenExcel",
                "fontFamily": "Arial",
                "colors": ["#FFFFFF", "#000000", "#4472C4", "#ED7D31", "#A5A5A5", "#FFC000"]
            },
            "namedStyles": {}
        },
        "sheetOrder": [sheet_id],
        "sheets": {
            sheet_id: {
                "id": sheet_id,
                "tiles": {},
                "properties": {
                    "name": "Sheet1",
                    "hidden": false,
                    "defaultRowHeight": 24.0,
                    "defaultColumnWidth": 100.0,
                    "rowInfo": {},
                    "columnInfo": {},
                    "groups": [],
                    "merges": [],
                    "conditionalFormats": [],
                    "validations": [],
                    "tables": [],
                    "pivots": [],
                    "charts": [],
                    "view": {
                        "freezeRows": 0,
                        "freezeColumns": 0,
                        "zoom": 100,
                        "scrollRow": 0,
                        "scrollColumn": 0,
                        "active": { "row": 0, "col": 0 },
                        "selection": [{ "top": 0, "left": 0, "bottom": 0, "right": 0 }],
                        "gridlines": true
                    }
                }
            }
        },
        "styles": {},
        "names": []
    })
}
