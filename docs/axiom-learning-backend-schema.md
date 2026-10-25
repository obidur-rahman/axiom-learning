# Axiom Learning: Backend Schema

| Item | Value |
|---|---|
| Document ID | AXL-SCHEMA-001 |
| Version | 1.0 |
| Date | 2026-10-25 |
| Owner | Obidur Rahman, NorthAxis |
| Status | Draft for the prototype |
| Related documents | AXL-TRD-001, AXL-PRD-001 |

Writing rules: This document follows the ASD-STE100 rules as closely as possible. Terms are in the PRD, Section 14.

---

## 1. Purpose

This document defines the database for the prototype. The database is Supabase Postgres with the pgvector extension.

## 2. Rules

1. Each table that holds user data has a column `owner_id` or a link to a Course that has an owner.
2. Row-level security (RLS) is on for each table that holds user data.
3. Each primary key is a `uuid` with the default `gen_random_uuid()`.
4. Each table has `created_at` with the default `now()`.
5. A delete of a Course deletes all data of the Course (`on delete cascade`).
6. Model output is saved with the model name and the prompt version.
7. The embedding dimension `N` depends on the embedding model chosen in milestone M0. Set `N` before the first migration.

## 3. Extensions

```sql
create extension if not exists vector;
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;
```

## 4. Tables

### 4.1 Accounts

```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  language text not null default 'bn' check (language in ('bn','en')),
  daily_minutes int,
  created_at timestamptz not null default now()
);
```

### 4.2 Courses and Material

```sql
create table courses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  level text not null check (level in ('school','university','general')),
  language text not null check (language in ('bn','en','mixed')),
  exam_date date,
  is_premade boolean not null default false,
  cloned_from uuid references courses(id) on delete set null,
  bridge_depth int not null default 2 check (bridge_depth between 0 and 4),
  status text not null default 'draft'
    check (status in ('draft','processing','ready','failed')),
  created_at timestamptz not null default now()
);

create table materials (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  owner_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in
    ('syllabus','notes','past_questions','suggestions','textbook','other')),
  file_path text,
  mime_type text,
  size_bytes bigint,
  page_count int,
  status text not null default 'queued'
    check (status in ('queued','reading','ready','failed')),
  error_message text,
  content_hash text,
  created_at timestamptz not null default now()
);

create table material_pages (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references materials(id) on delete cascade,
  page_number int not null,
  text text,
  extraction_method text not null
    check (extraction_method in ('text_layer','ocr','vision','pasted')),
  confidence numeric(4,3),
  low_confidence boolean not null default false,
  unique (material_id, page_number)
);
```

### 4.3 Topics, edges, and weights

```sql
create table topics (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  parent_id uuid references topics(id) on delete set null,
  title text not null,
  description text,
  syllabus_order int,
  source text not null check (source in ('syllabus','notes','user','premade')),
  shared_concept_id uuid,
  created_at timestamptz not null default now()
);

create table topic_edges (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  prerequisite_id uuid not null references topics(id) on delete cascade,
  topic_id uuid not null references topics(id) on delete cascade,
  confidence numeric(4,3),
  source text not null check (source in ('model','shared','user')),
  created_at timestamptz not null default now(),
  unique (prerequisite_id, topic_id),
  check (prerequisite_id <> topic_id)
);

create table topic_weights (
  topic_id uuid primary key references topics(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  past_question_count int not null default 0,
  past_question_share numeric(5,4) not null default 0,
  suggested boolean not null default false,
  in_syllabus boolean not null default false,
  weight numeric(5,4) not null default 0,
  computed_at timestamptz not null default now()
);

create table exam_scope_rules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  topic_id uuid references topics(id) on delete cascade,
  rule_type text not null check (rule_type in ('exclude','include')),
  source_text text,
  created_at timestamptz not null default now()
);
```

### 4.4 Shared concepts (saved across Learners)

```sql
create table shared_concepts (
  id uuid primary key default gen_random_uuid(),
  normalized_title text not null,
  subject text,
  level text,
  language text not null,
  created_at timestamptz not null default now(),
  unique (normalized_title, subject, level, language)
);

create table shared_prereq_edges (
  id uuid primary key default gen_random_uuid(),
  prerequisite_id uuid not null references shared_concepts(id) on delete cascade,
  concept_id uuid not null references shared_concepts(id) on delete cascade,
  confidence numeric(4,3),
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  unique (prerequisite_id, concept_id)
);

alter table topics
  add constraint topics_shared_concept_fk
  foreign key (shared_concept_id) references shared_concepts(id) on delete set null;
```

Shared tables hold no user text. They hold only concept titles and edges.

### 4.5 Chunks and search

```sql
create table chunks (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  material_id uuid not null references materials(id) on delete cascade,
  topic_id uuid references topics(id) on delete set null,
  page_start int not null,
  page_end int not null,
  section_path text,
  content text not null,
  token_count int,
  content_hash text not null,
  duplicate_of uuid references chunks(id) on delete set null,
  embedding vector(1536),  -- replace 1536 with N from milestone M0
  created_at timestamptz not null default now()
);

create index chunks_course_idx on chunks (course_id);
create index chunks_topic_idx on chunks (topic_id);
create index chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);
create index chunks_content_trgm_idx on chunks using gin (content gin_trgm_ops);
create index chunks_fts_idx on chunks using gin (to_tsvector('simple', content));
```

### 4.6 Past questions

```sql
create table past_questions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  material_id uuid references materials(id) on delete cascade,
  topic_id uuid references topics(id) on delete set null,
  question_text text not null,
  year int,
  marks numeric(5,2),
  question_type text check (question_type in ('mcq','short','long','numeric')),
  created_at timestamptz not null default now()
);
```

### 4.7 Roadmaps and Overrides

```sql
create table roadmap_versions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  version int not null,
  params jsonb not null,            -- bridge_depth, weight formula values
  engine_version text not null,
  created_at timestamptz not null default now(),
  unique (course_id, version)
);

create table roadmap_nodes (
  id uuid primary key default gen_random_uuid(),
  roadmap_version_id uuid not null references roadmap_versions(id) on delete cascade,
  topic_id uuid not null references topics(id) on delete cascade,
  node_type text not null check (node_type in ('core','bridge','skipped','known')),
  reason_code text not null check (reason_code in
    ('EXAM_TOPIC','NEEDED_BY','EXCLUDED','LOW_WEIGHT','KNOWN')),
  needed_by uuid[],
  depth int,
  order_index int,
  weight numeric(5,4),
  unique (roadmap_version_id, topic_id)
);

create table node_overrides (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  owner_id uuid not null references profiles(id) on delete cascade,
  action text not null check (action in
    ('mark_skip','restore','add_node','delete_node','add_edge','delete_edge')),
  topic_id uuid references topics(id) on delete cascade,
  payload jsonb,
  created_at timestamptz not null default now()
);
```

### 4.8 Progress and Diagnostics

```sql
create table user_progress (
  user_id uuid not null references profiles(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  topic_id uuid not null references topics(id) on delete cascade,
  status text not null default 'not_started'
    check (status in ('not_started','in_progress','done','known')),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, topic_id)
);

create table diagnostics (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references topics(id) on delete cascade,
  questions jsonb not null,         -- 3 items: prompt, options, correct, explanation
  model_id text,
  prompt_version text,
  created_at timestamptz not null default now()
);

create table diagnostic_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  diagnostic_id uuid not null references diagnostics(id) on delete cascade,
  answers jsonb not null,
  correct_count int not null,
  passed boolean not null,
  created_at timestamptz not null default now()
);
```

### 4.9 Lessons

```sql
create table lessons (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('course','shared')),
  course_id uuid references courses(id) on delete cascade,
  topic_id uuid references topics(id) on delete cascade,
  shared_concept_id uuid references shared_concepts(id) on delete cascade,
  language text not null check (language in ('bn','en')),
  level text not null check (level in ('school','university','general')),
  depth text not null check (depth in ('core','bridge')),
  content_md text not null,
  citations jsonb,                  -- list of chunk ids and pages
  is_general_content boolean not null default false,
  status text not null default 'active'
    check (status in ('active','flagged','replaced')),
  model_id text,
  prompt_version text,
  created_at timestamptz not null default now()
);

create unique index lessons_active_course_idx
  on lessons (topic_id, language, level, depth) where status = 'active' and scope = 'course';
create unique index lessons_active_shared_idx
  on lessons (shared_concept_id, language, level, depth) where status = 'active' and scope = 'shared';

create table lesson_reports (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references lessons(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now()
);
```

### 4.10 Practice

```sql
create table practice_items (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  topic_id uuid not null references topics(id) on delete cascade,
  item_type text not null check (item_type in ('mcq','written')),
  prompt text not null,
  options jsonb,
  correct_option int,
  model_answer text,
  rubric jsonb,                     -- key points for completeness and structure
  explanation text,
  source text not null check (source in ('past_question','generated')),
  past_question_id uuid references past_questions(id) on delete set null,
  model_id text,
  prompt_version text,
  created_at timestamptz not null default now()
);

create table practice_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  practice_item_id uuid not null references practice_items(id) on delete cascade,
  answer_text text,
  selected_option int,
  is_correct boolean,
  scores jsonb,                     -- correctness, completeness, structure (0 to 5)
  feedback_md text,
  model_id text,
  created_at timestamptz not null default now()
);
```

### 4.11 Tutor

```sql
create table tutor_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  topic_id uuid references topics(id) on delete set null,
  mode text not null default 'answer' check (mode in ('answer','guide')),
  title text,
  created_at timestamptz not null default now()
);

create table tutor_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references tutor_threads(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  citations jsonb,                  -- chunk ids, file names, pages
  from_material boolean,
  retrieval jsonb,                  -- query, chunk ids, scores
  model_id text,
  tokens_in int,
  tokens_out int,
  created_at timestamptz not null default now()
);
```

### 4.12 Sharing

```sql
create table share_links (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  created_by uuid not null references profiles(id) on delete cascade,
  token text not null unique,
  revoked boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
```

### 4.13 Jobs and usage

```sql
create table jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in (
    'read_material','build_topics','make_chunks','link_and_weight',
    'find_prerequisites','build_roadmap','build_lesson','make_practice','make_diagnostic')),
  course_id uuid references courses(id) on delete cascade,
  payload jsonb not null,
  status text not null default 'queued'
    check (status in ('queued','running','done','failed')),
  attempts int not null default 0,
  max_attempts int not null default 3,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index jobs_queue_idx on jobs (status, run_after);

create table usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  kind text not null check (kind in
    ('tutor_message','material_upload','lesson_build','practice_score','job')),
  model_id text,
  tokens_in int,
  tokens_out int,
  cost_estimate numeric(10,6),
  created_at timestamptz not null default now()
);

create table usage_limits (
  user_id uuid primary key references profiles(id) on delete cascade,
  tutor_messages_per_day int not null default 20,
  uploads_per_day int not null default 3,
  lesson_builds_per_day int not null default 30
);
```

The limit values are proposals.

## 5. Job pick-up query

The worker picks one job at a time. Use `for update skip locked`.

```sql
update jobs set status = 'running', locked_at = now(), attempts = attempts + 1
where id = (
  select id from jobs
  where status = 'queued' and run_after <= now()
  order by created_at
  for update skip locked
  limit 1
)
returning *;
```

If a job fails and `attempts` is below `max_attempts`, set the status to `queued` and set `run_after` to a later time.

## 6. Retrieval query (outline)

```sql
-- Vector search, limited to the Course
select id, content, page_start, section_path,
       1 - (embedding <=> $1) as score
from chunks
where course_id = $2 and duplicate_of is null
order by embedding <=> $1
limit 20;

-- Keyword search, limited to the Course
select id, content, page_start, section_path,
       similarity(content, $3) as score
from chunks
where course_id = $2 and duplicate_of is null and content % $3
order by score desc
limit 20;
```

The application code merges the two lists with reciprocal rank fusion.

## 7. Row-level security

Rules for each table group:

| Group | Rule |
|---|---|
| `profiles` | A user reads and writes the row where `id = auth.uid()`. |
| `courses` | A user reads and writes the rows where `owner_id = auth.uid()`. |
| Tables with `course_id` (`materials`, `material_pages`, `topics`, `topic_edges`, `topic_weights`, `exam_scope_rules`, `chunks`, `past_questions`, `roadmap_versions`, `roadmap_nodes`, `node_overrides`, `practice_items`, `lessons` with scope `course`) | A user reads and writes a row if the user owns the Course of the row. |
| `user_progress`, `diagnostic_attempts`, `practice_attempts`, `tutor_threads` | A user reads and writes the rows where `user_id = auth.uid()`. |
| `tutor_messages` | A user reads and writes the rows of the threads that the user owns. |
| `shared_concepts`, `shared_prereq_edges`, `lessons` with scope `shared` | All logged-in users can read. Only the server role can write. |
| `share_links` | The owner reads and writes. The server role reads a link by token. |
| `jobs`, `usage_events` | Only the server role. |
| `usage_limits` | A user can read the own row. Only the server role can write. |

Example policy:

```sql
alter table courses enable row level security;

create policy courses_owner on courses
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

alter table chunks enable row level security;

create policy chunks_owner on chunks
  for all using (
    exists (select 1 from courses c where c.id = chunks.course_id and c.owner_id = auth.uid())
  );
```

The shared view of a Roadmap (screen SC-17) is read through the server with a valid token. It returns only Topics, Nodes, and weights. It does not return Chunks, pages, or files.

## 8. Storage

| Bucket | Content | Access |
|---|---|---|
| `materials` | Uploaded files. Path: `{owner_id}/{course_id}/{material_id}/{file}` | Private. The owner reads with a signed link that expires. |

A storage policy must allow a user to access only the path that begins with the own `owner_id`.

## 9. Deletion rules

| Action | Result |
|---|---|
| Delete a Material | Delete its pages, Chunks, and past questions. Delete the file. Mark the Roadmap as out of date. |
| Delete a Course | Delete all rows with the `course_id`. Delete all files of the Course. |
| Delete an account | Delete the profile. Cascade deletes all data. Delete all files. |
| Cancel a share link | Set `revoked` to true. |

Shared concepts and shared edges hold no user text. They stay after a deletion.

## 10. Migration order

1. Extensions.
2. `profiles`, `courses`, `materials`, `material_pages`.
3. `shared_concepts`, `shared_prereq_edges`.
4. `topics`, `topic_edges`, `topic_weights`, `exam_scope_rules`.
5. `chunks` and its indexes.
6. `past_questions`.
7. `roadmap_versions`, `roadmap_nodes`, `node_overrides`.
8. `user_progress`, `diagnostics`, `diagnostic_attempts`.
9. `lessons`, `lesson_reports`.
10. `practice_items`, `practice_attempts`.
11. `tutor_threads`, `tutor_messages`.
12. `share_links`.
13. `jobs`, `usage_events`, `usage_limits`.
14. RLS policies and storage policies.
15. Seed data for the Premade Roadmaps.

## 11. Open questions

| ID | Question |
|---|---|
| SQ-1 | What is the embedding dimension `N`? Decide in milestone M0. |
| SQ-2 | Does Bangla full-text search work well with trigram search? Test in milestone M0. |
| SQ-3 | Does the free plan have enough storage for the test files? Check before launch. |
