use openexcel_desktop::file_io::{FileIoError, LocalFileIo};
use openexcel_desktop::storage::create_blank_workbook;
use tempfile::tempdir;

#[test]
fn test_atomic_save_and_load_openexcel() {
    let dir = tempdir().unwrap();
    let file_path = dir.path().join("atomic_test.openexcel");

    let sample_content = r#"{"schemaVersion":1,"id":"wb_atomic","name":"Atomic Test"}"#;
    let saved_path = LocalFileIo::save_openexcel(&file_path, sample_content)
        .expect("Atomic save should succeed");

    assert_eq!(saved_path, file_path);
    assert!(file_path.exists(), "Target file must exist");

    // Verify content loaded
    let loaded = LocalFileIo::load_openexcel(&file_path).expect("Load must succeed");
    assert_eq!(loaded, sample_content);

    // Verify no leftover .tmp files
    let tmp_files: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with(".tmp_"))
        .collect();
    assert_eq!(tmp_files.len(), 0, "No temporary files should be left over");
}

#[test]
fn test_save_and_load_workbook_json() {
    let dir = tempdir().unwrap();
    let file_path = dir.path().join("subfolder").join("workbook.openexcel");

    let wb_json = create_blank_workbook("wb_json_1", "Financial Model 2026");
    LocalFileIo::save_workbook_json(&file_path, &wb_json)
        .expect("Saving workbook JSON in nested path must succeed");

    let loaded_json = LocalFileIo::load_workbook_json(&file_path)
        .expect("Loading workbook JSON must succeed");

    assert_eq!(loaded_json["schemaVersion"], 1);
    assert_eq!(loaded_json["id"], "wb_json_1");
    assert_eq!(
        loaded_json["properties"]["name"],
        "Financial Model 2026"
    );
    assert_eq!(loaded_json["sheetOrder"][0], "sheet1");
}

#[test]
fn test_load_invalid_file_handling() {
    let dir = tempdir().unwrap();

    // 1. Non-existent file
    let non_existent = dir.path().join("does_not_exist.openexcel");
    let err1 = LocalFileIo::load_workbook_json(&non_existent).unwrap_err();
    match err1 {
        FileIoError::Io(_) => {}
        other => panic!("Expected Io error, got {:?}", other),
    }

    // 2. Corrupted JSON file
    let bad_json_path = dir.path().join("corrupt.openexcel");
    std::fs::write(&bad_json_path, "{ malformed json").unwrap();
    let err2 = LocalFileIo::load_workbook_json(&bad_json_path).unwrap_err();
    match err2 {
        FileIoError::Json(_) => {}
        other => panic!("Expected Json error, got {:?}", other),
    }

    // 3. JSON array instead of object
    let array_path = dir.path().join("array.openexcel");
    std::fs::write(&array_path, "[1, 2, 3]").unwrap();
    let err3 = LocalFileIo::load_workbook_json(&array_path).unwrap_err();
    match err3 {
        FileIoError::InvalidFormat(_) => {}
        other => panic!("Expected InvalidFormat error, got {:?}", other),
    }

    // 4. Missing schemaVersion and id
    let missing_id_path = dir.path().join("missing.openexcel");
    std::fs::write(&missing_id_path, r#"{"foo":"bar"}"#).unwrap();
    let err4 = LocalFileIo::load_workbook_json(&missing_id_path).unwrap_err();
    match err4 {
        FileIoError::InvalidFormat(_) => {}
        other => panic!("Expected InvalidFormat error, got {:?}", other),
    }
}
