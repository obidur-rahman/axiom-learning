# Axiom Learning: Desktop Pivot Plan

## Goal
Move Axiom Learning from a web app to a desktop app (Tauri) with a pluggable AI provider: any OpenAI-compatible endpoint (OpenRouter, OpenAI, local Ollama/LM Studio/vLLM). Keep the existing docs as the spec; update only the delivery model.

## Decisions
- Desktop framework: Tauri (thin Rust shell, all business logic in TS/Next.js or a sidecar).
- AI provider: a single OpenAI-compatible client configured by base URL + API key + model names. Covers hosted APIs and local endpoints.
- Data: hybrid. No login needed to use own materials. Optional account (Supabase) only to fetch premade roadmaps / shared data.
- Local models: user-run endpoint, not bundled. App does not ship inference runtime.
- Features expand/contract based on model capabilities (chat, JSON mode, embeddings, vision). Capabilities are probed at config time.
- Auto-detect: on startup, probe common local ports (11434, 1234, 8080). If an OpenAI-compatible endpoint responds, offer to use it. Manual override always available.

## Architecture
- Tauri app shell (Rust: window, file dialogs, secure storage for API key).
- Frontend: reuse the planned Next.js UI, run as Tauri webview (or static export).
- AI layer: `packages/ai` with `ProviderConfig { baseUrl, apiKey, chatModel, embedModel, capabilities }` and an OpenAI-compatible client. All pipeline steps call this abstraction; no direct vendor SDK.
- Storage: local SQLite (via Tauri) for courses, materials, roadmap, lessons, progress. Supabase used only for optional auth + premade/share fetch.
- Worker: in-process job queue in the desktop app (no separate worker host).
- OCR/read step: local (pdf.js + tesseract.js) or model vision if capability present.

## Migration from web plan
- Drop FR-140 (PWA install) — desktop app replaces it.
- Keep FR-130/131 (daily limits) only for hosted API mode; in local mode limits are advisory.
- Keep share link (FR-120..122) only when Supabase account is used.
- Accounts (FR-001..003) become optional, gated behind "Sign in for premade content".
- Replace worker host decision (M1-9) with in-process queue.

## Risks
- Tauri Rust surface must stay minimal so a non-Rust maintainer can debug; keep all logic in TS.
- Local 7-9B models may fail JSON/structured output; add retry + schema validation + fallback to API.
- Embeddings from local models may be weak; allow swapping embed model independently.
- Vision OCR depends on model capability; fall back to tesseract.

## Ordered tasks
1. Scaffold Tauri app with thin Rust shell (window, file dialogs, secure key storage). Keep all logic in TS.
2. Port web UI to Tauri webview (static export). Remove PWA install step.
3. Build `packages/ai` provider abstraction: OpenAI-compatible client, config, capability probe, auto-detect.
4. Replace Supabase-only data layer with local SQLite (courses, materials, roadmap, lessons, progress). Keep Supabase for optional auth + premade/share fetch.
5. Move worker pipeline in-process (job queue inside desktop app).
6. Implement OCR/read step with pdf.js + tesseract.js, with vision fallback if capability present.
7. Add provider settings screen (base URL, key, model, capabilities, auto-detect).
8. Make features expand/contract based on capabilities (disable embeddings search if no embed model; disable vision OCR if no vision).
9. Add offline mode: cached data usable without network.
10. Validate end-to-end with local 7B model and with OpenRouter.
- Provider probe test: chat, JSON, embeddings, vision.
- Pipeline runs end-to-end with a local 7B model and with OpenRouter.
- App starts offline and uses cached data.

## Open questions
- Which Tauri version and bundler target (NSIS/MSI/dmg)?
- Should the app auto-detect a running Ollama instance?
