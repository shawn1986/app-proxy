import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export function openDatabase(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.exec(`
    create table if not exists sessions (
      id text primary key,
      started_at text not null,
      method text not null,
      scheme text not null check (scheme in ('http', 'https')),
      host text not null,
      path text not null,
      query text not null,
      request_headers text not null,
      request_body_path text,
      request_body_preview text,
      response_status integer,
      response_headers text not null,
      response_body_path text,
      response_body_preview text,
      duration_ms integer,
      error_code text,
      error_message text
    );
  `);
  return db;
}
