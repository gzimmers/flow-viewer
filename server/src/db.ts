import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

export const uid = (): string => crypto.randomUUID()
export const now = (): string => new Date().toISOString()

const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = process.env.FLOW_DATA_DIR ?? path.join(here, '..', 'data')
mkdirSync(dataDir, { recursive: true })

export const db = new DatabaseSync(path.join(dataDir, 'flow-viewer.db'))

db.exec('PRAGMA journal_mode = WAL;')
db.exec('PRAGMA foreign_keys = ON;')

const SCHEMA = `
CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT,
  default_branch TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'java',
  content TEXT NOT NULL,
  line_count INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(repository_id, path)
);

CREATE TABLE IF NOT EXISTS flows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'http',
  repository_id TEXT REFERENCES repositories(id) ON DELETE SET NULL,
  branch TEXT,
  latest_version INTEGER NOT NULL DEFAULT 1,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS flow_versions (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(flow_id, version)
);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  version_id TEXT NOT NULL REFERENCES flow_versions(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  symbol TEXT,
  file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
  start_line INTEGER,
  end_line INTEGER,
  exit_status TEXT,
  exit_label TEXT,
  meta TEXT
);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  version_id TEXT NOT NULL REFERENCES flow_versions(id) ON DELETE CASCADE,
  from_node TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  to_node TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'sync',
  label TEXT
);

CREATE INDEX IF NOT EXISTS idx_nodes_version ON nodes(version_id);
CREATE INDEX IF NOT EXISTS idx_edges_version ON edges(version_id);
CREATE INDEX IF NOT EXISTS idx_files_repo ON files(repository_id);
CREATE INDEX IF NOT EXISTS idx_flows_updated ON flows(updated_at DESC);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS flow_tags (
  flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (flow_id, tag_id)
);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  flow_id TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (collection_id, flow_id)
);
`

db.exec(SCHEMA)
