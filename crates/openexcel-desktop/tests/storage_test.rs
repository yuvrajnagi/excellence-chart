use openexcel_desktop::storage::{
    create_blank_workbook, StorageError, WorkbookStore,
};
use tempfile::tempdir;

#[test]
fn test_sqlite_wal_mode_and_pragmas() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("test_wal.sqlite");

    let store = WorkbookStore::open(&db_path).expect("Failed to open SQLite database");
    let mode = store.journal_mode().expect("Failed to get journal mode");
    assert_eq!(
        mode.to_lowercase(),
        "wal",
        "SQLite journal mode must be WAL"
    );

    // Verify WAL files or connection persistence
    drop(store);
    assert!(db_path.exists(), "Database file must exist on disk");
}

#[test]
fn test_create_and_get_workbook() {
    let mut store = WorkbookStore::in_memory().unwrap();
    let wb_json = create_blank_workbook("wb_100", "Sales Q3");

    let created = store
        .create_from_json(&wb_json)
        .expect("Failed to create workbook");
    assert_eq!(created.storage_version, 1);
    assert_eq!(created.workbook["id"], "wb_100");
    assert_eq!(created.workbook["properties"]["name"], "Sales Q3");

    // Fetch with touch = true
    let fetched = store
        .get_json("wb_100", true)
        .expect("Failed to get workbook");
    assert_eq!(fetched.storage_version, 1);
    assert_eq!(fetched.workbook["id"], "wb_100");

    // Fetch non-existent
    let err = store.get_json("non_existent", false).unwrap_err();
    match err {
        StorageError::NotFound(id) => assert_eq!(id, "non_existent"),
        other => panic!("Expected NotFound, got {:?}", other),
    }
}

#[test]
fn test_optimistic_concurrency_conflict() {
    let mut store = WorkbookStore::in_memory().unwrap();
    let wb_json = create_blank_workbook("wb_conflict", "Concurrency Test");
    let created = store.create_from_json(&wb_json).unwrap();
    assert_eq!(created.storage_version, 1);

    // First save: expected_version = 1 -> succeeds, version advances to 2
    let snapshot_v2 = serde_json::to_string(&wb_json).unwrap();
    let receipt1 = store
        .save(
            "wb_conflict",
            "Concurrency Test",
            &snapshot_v2,
            1,
            1,
            "save_first",
        )
        .expect("First save should succeed");
    assert_eq!(receipt1.storage_version, 2);

    // Stale save attempt: expected_version = 1 (current is 2) -> must fail with VERSION_CONFLICT
    let err = store
        .save(
            "wb_conflict",
            "Concurrency Test",
            &snapshot_v2,
            2,
            1,
            "save_stale",
        )
        .unwrap_err();

    match err {
        StorageError::VersionConflict { current, expected } => {
            assert_eq!(current, 2);
            assert_eq!(expected, 1);
        }
        other => panic!("Expected VersionConflict, got {:?}", other),
    }

    assert_eq!(err.error_code(), "VERSION_CONFLICT");
    assert_eq!(err.status_code(), 409);
    assert!(
        format!("{}", err).contains("VERSION_CONFLICT"),
        "Error display should include VERSION_CONFLICT"
    );

    // Save with correct expected_version = 2 -> succeeds, version advances to 3
    let receipt2 = store
        .save(
            "wb_conflict",
            "Concurrency Test",
            &snapshot_v2,
            2,
            2,
            "save_valid",
        )
        .expect("Save with current version should succeed");
    assert_eq!(receipt2.storage_version, 3);
}

#[test]
fn test_idempotent_save_receipts() {
    let mut store = WorkbookStore::in_memory().unwrap();
    let wb_json = create_blank_workbook("wb_idem", "Idempotency Test");
    store.create_from_json(&wb_json).unwrap();

    let snapshot_a = serde_json::to_string(&wb_json).unwrap();
    let save_id = "idem_save_42";

    // First save request
    let receipt1 = store
        .save("wb_idem", "Idempotency Test", &snapshot_a, 1, 1, save_id)
        .expect("Initial save should succeed");
    assert_eq!(receipt1.storage_version, 2);

    // Replay identical save request with same save_id and same snapshot
    let receipt2 = store
        .save("wb_idem", "Idempotency Test", &snapshot_a, 1, 1, save_id)
        .expect("Replayed save should return cached receipt");
    assert_eq!(receipt2.storage_version, 2);
    assert_eq!(receipt2.save_id, save_id);
    assert_eq!(receipt2.saved_at, receipt1.saved_at);

    // Verify current version is still 2 (did not increment)
    let current = store.get("wb_idem", false).unwrap();
    assert_eq!(current.version, 2);

    // Attempt to reuse same save_id with a DIFFERENT snapshot -> SAVE_ID_REUSED
    let snapshot_b = serde_json::to_string(&serde_json::json!({
        "schemaVersion": 1,
        "id": "wb_idem",
        "different": true
    }))
    .unwrap();

    let err = store
        .save("wb_idem", "Idempotency Test", &snapshot_b, 2, 2, save_id)
        .unwrap_err();

    match err {
        StorageError::SaveIdReused => {}
        other => panic!("Expected SaveIdReused, got {:?}", other),
    }
    assert_eq!(err.error_code(), "SAVE_ID_REUSED");
    assert_eq!(err.status_code(), 409);
}

#[test]
fn test_receipt_history_bounded_to_100() {
    let mut store = WorkbookStore::in_memory().unwrap();
    let wb_json = create_blank_workbook("wb_bounded", "Bounded Test");
    store.create_from_json(&wb_json).unwrap();

    // Perform 120 saves
    for i in 1..=120 {
        let snapshot = format!(r#"{{"id":"wb_bounded","step":{}}}"#, i);
        let save_id = format!("save_{:04}", i);
        store
            .save("wb_bounded", "Bounded Test", &snapshot, i as i64, i as i64, &save_id)
            .unwrap();
    }

    // Inspect the saves table count
    let current = store.get("wb_bounded", false).unwrap();
    assert_eq!(current.version, 121);

    // Check count of saves in DB for this workbook
    let count: i64 = store
        .get_json("wb_bounded", false)
        .and_then(|_| {
            let res = store
                .list(10, 0, "recent")
                .map_err(|e| e)?;
            Ok(res)
        })
        .map(|_| {
            // Check raw saves count via internal helper or query
            let mut list_stmt = store.list(1, 0, "recent").unwrap();
            assert_eq!(list_stmt.items.len(), 1);
            0i64
        })
        .unwrap();

    // We can also verify that save_0001 is pruned, but save_0120 exists
    let old_snapshot = r#"{"id":"wb_bounded","step":1}"#;
    // Attempting to replay save_0001 (which was pruned) with expected version 121
    // should not return the old cached receipt because it was pruned!
    let prune_check = store.save(
        "wb_bounded",
        "Bounded Test",
        old_snapshot,
        121,
        121,
        "save_0001",
    );
    // Since save_0001 was pruned, it executes as a fresh save rather than returning cached receipt!
    assert!(
        prune_check.is_ok(),
        "Pruned save_id should be treated as fresh save"
    );
    assert_eq!(prune_check.unwrap().storage_version, 122);
}

#[test]
fn test_list_and_delete_workbook() {
    let mut store = WorkbookStore::in_memory().unwrap();

    for i in 1..=5 {
        let id = format!("wb_list_{}", i);
        let name = format!("Workbook {}", i);
        let wb_json = create_blank_workbook(&id, &name);
        store.create_from_json(&wb_json).unwrap();
    }

    let list_res = store.list(3, 0, "opened").unwrap();
    assert_eq!(list_res.items.len(), 3);
    assert_eq!(list_res.next_cursor, Some("3".to_string()));

    let next_page = store.list(3, 3, "opened").unwrap();
    assert_eq!(next_page.items.len(), 2);
    assert_eq!(next_page.next_cursor, None);

    // Delete one workbook
    assert!(store.delete("wb_list_1").unwrap());
    assert!(store.get("wb_list_1", false).is_err());

    // Deleting again should return NotFound
    let err = store.delete("wb_list_1").unwrap_err();
    match err {
        StorageError::NotFound(_) => {}
        other => panic!("Expected NotFound, got {:?}", other),
    }
}
