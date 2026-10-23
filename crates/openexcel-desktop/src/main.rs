use clap::{Parser, Subcommand};
use openexcel_desktop::file_io::LocalFileIo;
use openexcel_desktop::server::DesktopServer;
use openexcel_desktop::storage::{create_blank_workbook, WorkbookStore};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Parser)]
#[command(
    name = "openexcel-desktop",
    version = "0.1.0",
    about = "OpenExcel Native Desktop Runner and Persistence CLI"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Create a new workbook in SQLite or as a local .openexcel file
    Create {
        /// Workbook name
        #[arg(short, long, default_value = "Untitled")]
        name: String,

        /// Output path for a local .openexcel file
        #[arg(short, long, alias = "file")]
        out: Option<String>,

        /// SQLite database file path
        #[arg(long, default_value = "openexcel.sqlite")]
        db_path: String,
    },
    /// Save a workbook snapshot to disk or to SQLite
    Save {
        /// Workbook ID
        #[arg(short, long)]
        id: String,

        /// File path for local saving or loading snapshot
        #[arg(short, long)]
        file: String,

        /// SQLite database file path
        #[arg(long, default_value = "openexcel.sqlite")]
        db_path: String,
    },
    /// List workbooks in SQLite storage
    List {
        /// Maximum number of workbooks to list
        #[arg(short, long, default_value = "50")]
        limit: usize,

        /// SQLite database file path
        #[arg(long, default_value = "openexcel.sqlite")]
        db_path: String,
    },
    /// Run the embedded desktop HTTP server daemon
    Serve {
        /// Port to bind the server
        #[arg(short, long, default_value = "3001")]
        port: u16,

        /// Host to bind the server
        #[arg(long, default_value = "127.0.0.1")]
        host: String,

        /// SQLite database file path
        #[arg(long, default_value = "openexcel.sqlite")]
        db_path: String,

        /// Static directory for web UI frontend
        #[arg(long, default_value = "apps/web/dist")]
        static_dir: String,
    },
    /// Launch the native desktop application and server
    Launch {
        /// Port to bind the server
        #[arg(short, long, default_value = "3001")]
        port: u16,

        /// SQLite database file path
        #[arg(long, default_value = "openexcel.sqlite")]
        db_path: String,
    },
}

fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Create { name, out, db_path } => {
            let id = format!("wb_{}", chrono::Utc::now().timestamp_millis());
            let workbook_json = create_blank_workbook(&id, &name);

            if let Some(ref path_str) = out {
                let path = Path::new(path_str);
                LocalFileIo::save_workbook_json(path, &workbook_json)?;
                println!(
                    "Workbook '{}' created successfully at file: {} (id: {})",
                    name, path_str, id
                );
            } else {
                let mut store = WorkbookStore::open(&db_path)?;
                let res = store.create_from_json(&workbook_json)?;
                println!(
                    "Workbook '{}' created in SQLite database at {} (id: {}, storageVersion: {})",
                    name, db_path, id, res.storage_version
                );
            }
        }
        Commands::Save { id, file, db_path } => {
            let file_path = Path::new(&file);
            let mut store = WorkbookStore::open(&db_path)?;

            if file_path.exists() {
                // Read from file and save into SQLite
                let json = LocalFileIo::load_workbook_json(file_path)?;
                let name = json
                    .get("properties")
                    .and_then(|p| p.get("name"))
                    .and_then(|n| n.as_str())
                    .unwrap_or("Untitled");
                let revision = json
                    .get("revision")
                    .and_then(|r| r.as_i64())
                    .unwrap_or(0);
                let snapshot = serde_json::to_string(&json)?;
                let save_id = format!("cli_save_{}", chrono::Utc::now().timestamp_micros());

                // Try to get current version or create
                match store.get(&id, false) {
                    Ok(current) => {
                        let receipt = store.save(
                            &id,
                            name,
                            &snapshot,
                            revision,
                            current.version,
                            &save_id,
                        )?;
                        println!(
                            "Saved workbook '{}' from file {} to SQLite (version: {})",
                            id, file, receipt.storage_version
                        );
                    }
                    Err(_) => {
                        let row = store.create(&id, name, &snapshot, revision)?;
                        println!(
                            "Created workbook '{}' in SQLite from file {} (version: {})",
                            id, file, row.version
                        );
                    }
                }
            } else {
                // Export from SQLite to file
                let row = store.get(&id, false)?;
                let val: serde_json::Value = serde_json::from_str(&row.snapshot)?;
                LocalFileIo::save_workbook_json(file_path, &val)?;
                println!(
                    "Exported workbook '{}' from SQLite to file {}",
                    id, file
                );
            }
        }
        Commands::List { limit, db_path } => {
            let store = WorkbookStore::open(&db_path)?;
            let list = store.list(limit, 0, "opened")?;

            if list.items.is_empty() {
                println!("No workbooks found in SQLite database at {}.", db_path);
            } else {
                println!("Workbooks in {} (limit: {}):", db_path, limit);
                println!(
                    "{:<25} {:<25} {:<10} {:<10} {:<25}",
                    "ID", "NAME", "VERSION", "REVISION", "UPDATED"
                );
                println!("{:-<95}", "");
                for item in list.items {
                    println!(
                        "{:<25} {:<25} {:<10} {:<10} {:<25}",
                        item.id,
                        if item.name.len() > 24 {
                            format!("{}...", &item.name[..21])
                        } else {
                            item.name
                        },
                        item.storage_version,
                        item.revision,
                        item.updated_at
                    );
                }
            }
        }
        Commands::Serve {
            port,
            host,
            db_path,
            static_dir,
        } => {
            let store = WorkbookStore::open(&db_path)?;
            let static_path = if !static_dir.is_empty() {
                Some(PathBuf::from(static_dir))
            } else {
                None
            };
            let server = DesktopServer::new(&host, port, Arc::new(Mutex::new(store)), static_path)?;
            println!(
                "OpenExcel Desktop Server listening on http://{}:{} (SQLite: {})",
                server.host(),
                server.port(),
                db_path
            );
            server.run();
        }
        Commands::Launch { port, db_path } => {
            let store = WorkbookStore::open(&db_path)?;
            let static_path = Some(PathBuf::from("apps/web/dist"));
            let server = DesktopServer::new(
                "127.0.0.1",
                port,
                Arc::new(Mutex::new(store)),
                static_path,
            )?;
            println!(
                "OpenExcel Desktop Application launched at http://127.0.0.1:{} (SQLite: {})",
                server.port(),
                db_path
            );
            server.run();
        }
    }

    Ok(())
}
