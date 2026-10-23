import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import type { Workbook } from '@openexcel/model';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public currentVersion?: number) { super(message); }
}
type Row = { id: string; name: string; snapshot: string; version: number; revision: number; created: string; updated: string; opened: string };
/** Every snapshot and retry receipt is committed atomically; WAL allows crash recovery. */
export class WorkbookStore {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS workbooks(id TEXT PRIMARY KEY,name TEXT NOT NULL,snapshot TEXT NOT NULL,version INTEGER NOT NULL,revision INTEGER NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL,opened TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS saves(workbook_id TEXT NOT NULL,save_id TEXT NOT NULL,digest TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(workbook_id,save_id));`);
  }
  close() { this.db.close(); }
  get(id: string, touch = false) {
    const row = this.db.prepare('SELECT * FROM workbooks WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Workbook not found');
    if (touch) this.db.prepare('UPDATE workbooks SET opened=? WHERE id=?').run(new Date().toISOString(), id);
    return { workbook: JSON.parse(row.snapshot) as Workbook, storageVersion: row.version, savedAt: row.updated };
  }
  list(limit = 50, offset = 0, order = 'recent') {
    const rows = this.db.prepare(`SELECT * FROM workbooks ORDER BY ${order === 'updated' ? 'updated' : 'opened'} DESC,id LIMIT ? OFFSET ?`).all(limit + 1, offset) as Row[];
    return { items: rows.slice(0,limit).map(r => ({id:r.id,name:r.name,storageVersion:r.version,revision:r.revision,createdAt:r.created,updatedAt:r.updated,openedAt:r.opened})), ...(rows.length>limit?{nextCursor:String(offset+limit)}:{}) };
  }
  create(workbook: Workbook) {
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO workbooks VALUES(?,?,?,?,?,?,?,?)').run(workbook.id,workbook.properties.name,JSON.stringify(workbook),1,workbook.revision,now,now,now);
    return this.get(workbook.id);
  }
  save(workbook: Workbook, expected: number, saveId: string) {
    const snapshot = JSON.stringify(workbook), digest=createHash('sha256').update(snapshot).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous=this.db.prepare('SELECT digest,response FROM saves WHERE workbook_id=? AND save_id=?').get(workbook.id,saveId) as {digest:string;response:string}|undefined;
      if(previous) {
        if(previous.digest!==digest) throw new HttpError(409,'SAVE_ID_REUSED','Save ID was used for a different snapshot');
        this.db.exec('COMMIT'); return JSON.parse(previous.response) as {storageVersion:number;savedRevision:number;savedAt:string;saveId:string;id:string};
      }
      const current=this.get(workbook.id);
      if(current.storageVersion!==expected) throw new HttpError(409,'VERSION_CONFLICT','Workbook changed since it was loaded',current.storageVersion);
      const now=new Date().toISOString(), version=current.storageVersion+1;
      this.db.prepare('UPDATE workbooks SET name=?,snapshot=?,version=?,revision=?,updated=? WHERE id=?').run(workbook.properties.name,snapshot,version,workbook.revision,now,workbook.id);
      const response={id:workbook.id,storageVersion:version,savedRevision:workbook.revision,savedAt:now,saveId};
      this.db.prepare('INSERT INTO saves VALUES(?,?,?,?)').run(workbook.id,saveId,digest,JSON.stringify(response));
      // Keep recent retry receipts bounded per workbook.
      this.db.prepare('DELETE FROM saves WHERE workbook_id=? AND rowid NOT IN (SELECT rowid FROM saves WHERE workbook_id=? ORDER BY rowid DESC LIMIT 100)').run(workbook.id,workbook.id);
      this.db.exec('COMMIT'); return response;
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  delete(id:string) {
    this.get(id); this.db.exec('BEGIN IMMEDIATE');
    try { this.db.prepare('DELETE FROM saves WHERE workbook_id=?').run(id);this.db.prepare('DELETE FROM workbooks WHERE id=?').run(id);this.db.exec('COMMIT'); }
    catch(error){this.db.exec('ROLLBACK');throw error;}
  }
}
