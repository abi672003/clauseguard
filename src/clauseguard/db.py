"""SQLite schema and connection helper for ClauseGuard's contract/clause facts."""

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[2] / "db" / "clauseguard.sqlite"

SCHEMA = """
CREATE TABLE IF NOT EXISTS contracts (
    id      TEXT PRIMARY KEY,
    title   TEXT,
    text    TEXT NOT NULL,
    source  TEXT NOT NULL,
    split   TEXT NOT NULL
);

-- CUAD: one row per (contract, clause-type-question), i.e. an extraction label.
CREATE TABLE IF NOT EXISTS clauses (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_id     TEXT NOT NULL REFERENCES contracts(id),
    clause_type     TEXT NOT NULL,
    clause_text     TEXT,
    answer_start    INTEGER,
    is_impossible   INTEGER NOT NULL,
    split           TEXT NOT NULL,
    source          TEXT NOT NULL
);

-- ContractNLI: real (premise, hypothesis, label) entailment triples.
CREATE TABLE IF NOT EXISTS nli_triples (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_id     TEXT NOT NULL REFERENCES contracts(id),
    hypothesis_id   TEXT NOT NULL,
    hypothesis_text TEXT NOT NULL,
    premise         TEXT NOT NULL,
    label           TEXT NOT NULL,
    split           TEXT NOT NULL,
    source          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clauses_contract ON clauses(contract_id);
CREATE INDEX IF NOT EXISTS idx_clauses_split ON clauses(split);
CREATE INDEX IF NOT EXISTS idx_nli_split ON nli_triples(split);
CREATE INDEX IF NOT EXISTS idx_nli_contract ON nli_triples(contract_id);
"""


def get_connection(db_path: Path = DB_PATH) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA)
    return conn
