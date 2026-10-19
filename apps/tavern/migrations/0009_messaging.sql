CREATE TABLE telegram_accounts (
 user_id INTEGER PRIMARY KEY,
 owner TEXT NOT NULL,
 username TEXT NOT NULL
);
CREATE INDEX telegram_accounts_owner ON telegram_accounts(owner);
CREATE TABLE channel_codes (
 hash TEXT PRIMARY KEY,
 owner TEXT NOT NULL,
 username TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('private','group')),
 character_json TEXT NOT NULL,
 character_name TEXT NOT NULL,
 settings_json TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE TABLE channel_routes (
 id TEXT PRIMARY KEY,
 thread_key TEXT NOT NULL UNIQUE,
 chat_id INTEGER NOT NULL,
 thread_id INTEGER NOT NULL,
 owner TEXT NOT NULL,
 username TEXT NOT NULL,
 session_id TEXT NOT NULL UNIQUE,
 active INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL
);
CREATE INDEX channel_routes_owner ON channel_routes(owner);
