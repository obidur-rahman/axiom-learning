/**
 * Local SQLite schema: the local-mode translation of AXL-SCHEMA-001.
 * Notes on the translation:
 *  - No owner_id/user_id: the desktop app runs for one local user. Supabase
 *    adds them back (with RLS) only for premade/share mode.
 *  - Postgres `jsonb` becomes TEXT holding JSON; uuid arrays become TEXT
 *    holding a JSON array of ids.
 *  - Postgres `timestamptz default now()` becomes TEXT ISO timestamps.
 *  - Row ids are generated in TypeScript (crypto.randomUUID) because the
 *    SQLite builds of the app do not have `gen_random_uuid()`.
 *  - The `PRAGMA foreign_keys = ON` must run after connect for the delete
 *    cascades to work (init.ts does this).
 */
export const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('school','university','general')),
    language TEXT NOT NULL CHECK (language IN ('bn','en','mixed')),
    exam_date TEXT,
    is_premade INTEGER NOT NULL DEFAULT 0,
    cloned_from TEXT REFERENCES courses(id) ON DELETE SET NULL,
    bridge_depth INTEGER NOT NULL DEFAULT 2 CHECK (bridge_depth BETWEEN 0 AND 4),
    status TEXT NOT NULL DEFAULT 'draft'
      CHECK (status IN ('draft','processing','ready','failed')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );`,
  `CREATE TABLE IF NOT EXISTS materials (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN
      ('syllabus','notes','past_questions','suggestions','textbook','other')),
    file_path TEXT,
    mime_type TEXT,
    size_bytes INTEGER,
    page_count INTEGER,
    status TEXT NOT NULL DEFAULT 'queued'
      CHECK (status IN ('queued','reading','ready','failed')),
    error_message TEXT,
    content_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );`,
  `CREATE TABLE IF NOT EXISTS material_pages (
    id TEXT PRIMARY KEY,
    material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    text TEXT,
    extraction_method TEXT NOT NULL
      CHECK (extraction_method IN ('text_layer','ocr','vision','pasted')),
    confidence REAL,
    low_confidence INTEGER NOT NULL DEFAULT 0,
    UNIQUE (material_id, page_number)
  );`,
  `CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    syllabus_order INTEGER,
    source TEXT NOT NULL CHECK (source IN ('syllabus','notes','user','premade')),
    shared_concept_id TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );`,
  `CREATE TABLE IF NOT EXISTS topic_edges (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    prerequisite_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    confidence REAL,
    source TEXT NOT NULL CHECK (source IN ('model','shared','user')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (prerequisite_id, topic_id),
    CHECK (prerequisite_id <> topic_id)
  );`,
  `CREATE TABLE IF NOT EXISTS topic_weights (
    topic_id TEXT PRIMARY KEY REFERENCES topics(id) ON DELETE CASCADE,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    past_question_count INTEGER NOT NULL DEFAULT 0,
    past_question_share REAL NOT NULL DEFAULT 0,
    suggested INTEGER NOT NULL DEFAULT 0,
    in_syllabus INTEGER NOT NULL DEFAULT 0,
    weight REAL NOT NULL DEFAULT 0,
    computed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );`,
  `CREATE TABLE IF NOT EXISTS exam_scope_rules (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    topic_id TEXT REFERENCES topics(id) ON DELETE CASCADE,
    rule_type TEXT NOT NULL CHECK (rule_type IN ('exclude','include')),
    source_text TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );`,
  `CREATE TABLE IF NOT EXISTS roadmap_versions (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    params TEXT NOT NULL,
    engine_version TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (course_id, version)
  );`,
  `CREATE TABLE IF NOT EXISTS roadmap_nodes (
    id TEXT PRIMARY KEY,
    roadmap_version_id TEXT NOT NULL REFERENCES roadmap_versions(id) ON DELETE CASCADE,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    node_type TEXT NOT NULL CHECK (node_type IN ('core','bridge','skipped','known')),
    reason_code TEXT NOT NULL CHECK (reason_code IN
      ('EXAM_TOPIC','NEEDED_BY','EXCLUDED','LOW_WEIGHT','KNOWN')),
    needed_by TEXT,
    depth INTEGER,
    order_index INTEGER,
    weight REAL,
    UNIQUE (roadmap_version_id, topic_id)
  );`,
  `CREATE TABLE IF NOT EXISTS node_overrides (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    action TEXT NOT NULL CHECK (action IN
      ('mark_skip','restore','add_node','delete_node','add_edge','delete_edge')),
    topic_id TEXT REFERENCES topics(id) ON DELETE CASCADE,
    payload TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );`,
  `CREATE TABLE IF NOT EXISTS user_progress (
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'not_started'
      CHECK (status IN ('not_started','in_progress','done','known')),
    completed_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (course_id, topic_id)
  );`,
  `CREATE TABLE IF NOT EXISTS lessons (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL CHECK (scope IN ('course','shared')),
    course_id TEXT REFERENCES courses(id) ON DELETE CASCADE,
    topic_id TEXT REFERENCES topics(id) ON DELETE CASCADE,
    shared_concept_id TEXT,
    language TEXT NOT NULL CHECK (language IN ('bn','en','mixed')),
    depth TEXT NOT NULL CHECK (depth IN ('core','bridge')),
    content_md TEXT NOT NULL,
    citations TEXT,
    is_general_content INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active','flagged','replaced')),
    model_id TEXT,
    prompt_version TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );`,
  `CREATE TABLE IF NOT EXISTS lesson_reports (
    id TEXT PRIMARY KEY,
    lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );`,
  `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL CHECK (job_type IN (
      'read_material','build_topics','make_chunks','link_and_weight',
      'find_prerequisites','build_roadmap','build_lesson','make_practice','make_diagnostic',
      'extract_past_questions','generate_questions')),
    course_id TEXT REFERENCES courses(id) ON DELETE CASCADE,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued'
      CHECK (status IN ('queued','running','done','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    run_after TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    locked_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    finished_at TEXT
  );`,
  `CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs (status, run_after);`,
  `CREATE TABLE IF NOT EXISTS provider_config (
    id TEXT PRIMARY KEY CHECK (id = 'default'),
    base_url TEXT NOT NULL,
    chat_model TEXT NOT NULL,
    ocr_model TEXT,
    embed_model TEXT,
    mode TEXT NOT NULL DEFAULT 'local' CHECK (mode IN ('local','hosted')),
    ocr_think INTEGER NOT NULL DEFAULT 0,
    chat_think INTEGER NOT NULL DEFAULT 0,
    ocr_max_edge INTEGER NOT NULL DEFAULT 1400,
    ocr_max_tokens INTEGER NOT NULL DEFAULT 1024,
    single_model_mode INTEGER NOT NULL DEFAULT 1,
    auto_unload INTEGER NOT NULL DEFAULT 1,
    detected_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );`,
  `CREATE TABLE IF NOT EXISTS provider_fallbacks (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    base_url TEXT NOT NULL,
    chat_model TEXT NOT NULL,
    ocr_model TEXT,
    embed_model TEXT,
    mode TEXT NOT NULL DEFAULT 'hosted' CHECK (mode IN ('local','hosted')),
    ocr_think INTEGER NOT NULL DEFAULT 0,
    chat_think INTEGER NOT NULL DEFAULT 0,
    ocr_max_edge INTEGER NOT NULL DEFAULT 1400,
    ocr_max_tokens INTEGER NOT NULL DEFAULT 1024,
    single_model_mode INTEGER NOT NULL DEFAULT 1,
    auto_unload INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );`,
  `CREATE INDEX IF NOT EXISTS provider_fallbacks_order_idx
     ON provider_fallbacks (enabled, priority);`,
  `CREATE TABLE IF NOT EXISTS material_embeddings (
    material_id TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    vector TEXT NOT NULL,
    model TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (material_id, page_number),
    FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
  );`,
  /* ---- Adaptive study (schema v2) ---- */
  `CREATE TABLE IF NOT EXISTS course_study_settings (
    course_id TEXT PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
    profile TEXT NOT NULL DEFAULT 'adaptive'
      CHECK (profile IN ('past_first','notes_first','adaptive')),
    daily_minutes INTEGER NOT NULL DEFAULT 45
      CHECK (daily_minutes BETWEEN 15 AND 240),
    has_past_papers INTEGER NOT NULL DEFAULT 0,
    plan_version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );`,
  `CREATE TABLE IF NOT EXISTS exam_questions (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    material_id TEXT REFERENCES materials(id) ON DELETE SET NULL,
    topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
    source TEXT NOT NULL CHECK (source IN ('past_paper','generated','user')),
    prompt TEXT NOT NULL,
    answer_md TEXT,
    rubric_json TEXT,
    year INTEGER,
    paper_label TEXT,
    question_number TEXT,
    marks INTEGER,
    question_type TEXT NOT NULL DEFAULT 'other'
      CHECK (question_type IN
        ('definition','explanation','derivation','numerical','comparison',
         'diagram','essay','code','other')),
    difficulty INTEGER NOT NULL DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
    difficulty_source TEXT NOT NULL DEFAULT 'model'
      CHECK (difficulty_source IN ('model','user','computed')),
    pattern_key TEXT,
    pattern_label TEXT,
    citation_pages TEXT,
    status TEXT NOT NULL DEFAULT 'draft'
      CHECK (status IN ('draft','confirmed','rejected')),
    prompt_version TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );`,
  `CREATE INDEX IF NOT EXISTS exam_questions_course_idx
    ON exam_questions (course_id, status, topic_id);`,
  `CREATE TABLE IF NOT EXISTS exam_question_topics (
    question_id TEXT NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    confidence REAL,
    PRIMARY KEY (question_id, topic_id)
  );`,
  `CREATE TABLE IF NOT EXISTS study_attempts (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    item_kind TEXT NOT NULL
      CHECK (item_kind IN ('question','lesson','recall','mock')),
    question_id TEXT REFERENCES exam_questions(id) ON DELETE SET NULL,
    topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
    lesson_id TEXT REFERENCES lessons(id) ON DELETE SET NULL,
    result TEXT CHECK (result IN ('correct','partial','wrong','skipped')),
    score REAL,
    max_score REAL,
    confidence INTEGER CHECK (confidence BETWEEN 1 AND 3),
    duration_seconds INTEGER,
    meta TEXT,
    started_at TEXT,
    completed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );`,
  `CREATE TABLE IF NOT EXISTS lesson_documents (
    lesson_id TEXT PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,
    structure_json TEXT NOT NULL,
    beat_count INTEGER NOT NULL,
    prompt_version TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );`,
];

/**
 * Migration v2 rebuilds the job queue because SQLite cannot alter a CHECK
 * constraint. Existing rows are copied, so a queued job survives the upgrade.
 */
export const JOB_TABLE_DDL = `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL CHECK (job_type IN (
      'read_material','build_topics','make_chunks','link_and_weight',
      'find_prerequisites','build_roadmap','build_lesson','make_practice','make_diagnostic',
      'extract_past_questions','generate_questions')),
    course_id TEXT REFERENCES courses(id) ON DELETE CASCADE,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued'
      CHECK (status IN ('queued','running','done','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    run_after TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    locked_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    finished_at TEXT
  );`;

/**
 * Schema v3 adds the per-role model columns. SQLite cannot add several
 * columns in one statement, and a fresh table already has them, so the
 * upgrade checks PRAGMA table_info and adds only what is missing.
 */
export const PROVIDER_CONFIG_COLUMNS: [name: string, definition: string][] = [
  ['ocr_model', 'TEXT'],
  ['ocr_think', 'INTEGER NOT NULL DEFAULT 0'],
  ['chat_think', 'INTEGER NOT NULL DEFAULT 0'],
  ['ocr_max_edge', 'INTEGER NOT NULL DEFAULT 1400'],
  ['ocr_max_tokens', 'INTEGER NOT NULL DEFAULT 1024'],
  ['single_model_mode', 'INTEGER NOT NULL DEFAULT 1'],
  ['auto_unload', 'INTEGER NOT NULL DEFAULT 1'],
];

export const REBUILD_JOBS_MIGRATION: string[] = [
  `DROP TABLE IF EXISTS jobs_old;`,
  `ALTER TABLE jobs RENAME TO jobs_old;`,
  `DROP INDEX IF EXISTS jobs_queue_idx;`,
  JOB_TABLE_DDL,
  `INSERT INTO jobs (id, job_type, course_id, payload, status, attempts, max_attempts,
     run_after, locked_at, last_error, created_at, finished_at)
   SELECT id, job_type, course_id, payload, status, attempts, max_attempts,
     run_after, locked_at, last_error, created_at, finished_at FROM jobs_old;`,
  `DROP TABLE jobs_old;`,
  `CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs (status, run_after);`,
];
