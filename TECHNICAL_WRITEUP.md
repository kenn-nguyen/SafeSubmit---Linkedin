# SafeSubmit Technical Design

## Purpose
SafeSubmit is a client-side job search copilot. It ingests a user’s resume, a CSV of job listings, and a Gemini API key, then:
- Recruits an evaluation + resume-crafting agent panel.
- Batch-scores jobs with a rubric and visa risk assessment.
- Generates tailored Markdown resumes via a multi-phase crew with iterative QA.
- Grounds chat answers in a local vector store (RAG).
- Optionally synthesizes short audio summaries for matches.

Built as a Vite + React SPA; all heavy lifting occurs in-browser aside from Google Gemini calls.

## Key Technologies
- Framework: React 19, Vite 6, TypeScript 5.8, Lucide icons; utility-first classes in JSX.
- LLM API: `@google/genai`.
  - Models: `gemini-3-pro-preview` (agent recruitment + batch eval), `gemini-2.5-flash` (resume gen + chat), `gemini-2.5-flash-preview-tts` (audio).
- RAG: `@xenova/transformers` feature-extraction pipeline (`Xenova/all-MiniLM-L6-v2`), mean-pooled normalized embeddings, in-memory cosine search.
- Storage: `localStorage` with XOR+Base64 obfuscation for API keys; resume SHA-256 hashes to key artifacts and intents.
- Build/Tooling: Vite dev/build, TS config via `tsconfig.json`.

## Architecture (files)
- **App shell:** `App.tsx` — orchestrates state machine, logs, gating.
- **Prompts/config:** `constants.ts` — model names, rubrics, agent/crew prompts.
- **LLM orchestration:** `services/geminiService.ts` — rate limiting, crews, batch eval, resume gen, chat, TTS.
- **RAG:** `services/vectorService.ts` — model warmup/unload, indexing, cosine search.
- **Ingest:** `services/csvParser.ts` — robust CSV parsing, header mapping, HTML stripping.
- **Persistence:** `services/storageService.ts` — API key obfuscation, resume/intent/artifact caching, hashing.
- **UI:** `components/*` — AgentPanel, JobTable, ChatWidget, LogBox, DiffModal, QueueWidget, ProgressTracker, ApiKeyInput, ResumeWidget, FileUpload.

## Data Model (refs: `types.ts`)
- `Job`: core job with analysis fields (`matchScore`, `visaRisk`, `reasoning`, `evaluatedBy`, `status`) and generation fields (`generationPhase`, `generatedResume`, `audioSummary`).
- `ResumeData`: resume metadata + text + hash.
- `Agent`: name/role/focus/emoji; ordered to split evaluation vs crafting.
- `Artifact`: cached outputs keyed by `(resumeHash, jobId)`.
- `ChatMessage`: chat turns.

## Control Flow
1) **Onboarding**
   - Resume upload; API key entry.
   - `validateApiKey` pings Gemini.
   - Stuck `PROCESSING` jobs reset to `NEW` on load; session restoration pulls resume, intent, API key, artifacts.
2) **Agent Recruitment**
   - User intent → `createAgentPanel` (Gemini 3 Pro, JSON contract via `BUILD_PANEL_PROMPT`) → 6 agents (3 evaluators, 3 writers).
   - `createEvaluationInstructions` captures candidate profile + intent.
3) **Job Import**
   - `parseCSV`: quoted fields/newlines/escaped quotes, fuzzy headers, HTML stripping, salary normalization, 500-row cap.
   - Hydrates artifacts per resume hash; logs indexing/import results.
4) **Vector Indexing (RAG)**
   - `indexJobs` embeds structured job text; idempotent; sequential; warmup log + idle unload after 5 minutes.
5) **Batch Analysis**
   - `analyzeJobsInBatchV2`: batch prompt + strict JSON schema (`Schema`), guardrails (`BATCH_EVALUATION_SYSTEM_PROMPT`), Gemini 3 Pro call.
   - `cleanJson` parse; partial updates; artifacts persisted; status NEW (analyzed) or FAILED.
6) **Resume Tailoring**
   - `generateTailoredResume` (Gemini 2.5 Flash) multi-phase crew:
     - Architect → Writer → Iterative Critic/Reviser loop (JSON score, threshold, history) → Editor → QA.
   - Phase callbacks drive UI spinners; `cleanMarkdown` strips fences/filler; artifacts updated.
7) **Download/Diff**
   - If generated resume exists, download Markdown blob; otherwise generate.
   - `DiffModal` compares original vs tailored.
8) **Chat (RAG)**
   - `chatWithData`: `searchJobs` (MiniLM cosine) retrieves K jobs; injects user intent + resume snippet into `CHAT_SYSTEM`; Gemini 2.5 Flash responds grounded in retrieved jobs. Fallback: score-based slice if embeddings unavailable.
9) **Audio Summaries**
   - `generateAudioSummary` (Gemini TTS); `JobTable` decodes base64 PCM → `AudioBuffer` (24 kHz) → Web Audio playback with cleanup.

## Agentic Patterns
- **Recruitment:** `BUILD_PANEL_PROMPT` enforces 6-agent JSON split (Evaluation Crew + Crafting Crew).
- **Evaluation Crew:** `Crew` class sequences `CrewAgent` roles then `ManagerAgent` synthesis with JSON schema (`FINAL_AGENT_SYSTEM_INSTRUCTION`). Tools flag enables Google Search for research/culture focuses.
- **Batch Eval Alternative:** `analyzeJobsInBatchV2` single-call structured triage for throughput.
- **Resume Crew:** `RESUME_CREW_PROMPTS` for each phase; iterative Critic/Reviser loop with score threshold, max retries, best-draft fallback.

## RAG Details (`services/vectorService.ts`)
- Model: `@xenova/transformers` feature-extraction (`Xenova/all-MiniLM-L6-v2`), remote HF CDN, browser cache enabled.
- Memory: singleton pipeline with promise guard; idle timer clears pipeline reference for GC; vectors remain cached.
- Index content: role/company/location/salary/visa/score/description slice.
- Retrieval: cosine similarity; fallback to score-sort if embeddings unavailable.

## Prompting & Guardrails
- Rubrics: SCORING_RUBRIC (0-100 gatekeeper), VISA_GUIDE conservative rules.
- System prompts: AGENT_SYSTEM_INSTRUCTION, FINAL_AGENT_SYSTEM_INSTRUCTION, BATCH_EVALUATION_SYSTEM_PROMPT, CHAT_SYSTEM, plus resume-crew prompts (Architect, Writer, Critic, Reviser, Editor, QA).
- Output hygiene: `cleanJson` strips code fences/leading text; `cleanMarkdown` removes code fences and conversational filler.
- Schema enforcement: JSON schemas in ManagerAgent and batch eval; parse fallbacks to defaults on error.

## Reliability & Rate Limiting
- `generateWithRetry`: serialized queue, MIN_INTERVAL (2s), exponential backoff on 429/quota, retries=3, shared timestamp to avoid bursts.
- Status guards: `isGlobalBusy` and per-job generationPhase prevent conflicting actions.
- Recovery: on load, `PROCESSING` → `NEW`; hydration restores match/generation artifacts; batch failures mark `FAILED`.

## Storage & Security Posture
- API keys: XOR + Base64 obfuscation in localStorage (not cryptographic; protects against casual inspection).
- Hashing: SHA-256 of resume text keys artifacts/intents.
- Quota safety: `safeSetItem` guards localStorage errors.
- Artifacts: persist matchScore/visa/reasoning/generated resume; hydration sets analyzed jobs to `NEW` (stop spinners) or `DONE` if resume exists.

## CSV Ingest
- Manual parser supports CRLF, quoted newlines, escaped quotes.
- Fuzzy header map; HTML stripping; salary normalization heuristics; description truncation; skips empty rows; defaults for unknown title/company.

## UI & Observability
- ProgressTracker stepper; LogBox for system/agent/vector logs; QueueWidget for background monitoring.
- JobTable: sorting (publishedAt/matchScore), filters (visa, score, status, easy apply, recent), pagination, reasoning toggles, retry buttons, generation progress, audio playback.
- ChatWidget: floating panel, history, typing indicator, RAG-grounded responses.
- DiffModal: original vs tailored Markdown comparison.
- AgentPanel: intent input, recruitment trigger, evaluation/crafting crew display.

## Technical Accomplishment Mapping
- Hosted web app ready (SPA).
- Search-augmented retrieval: local embeddings + cosine search (Transformers.js).
- Conversational chat grounded in retrieved job data.
- Multiple models/APIs: Gemini 3 Pro, Gemini 2.5 Flash, Gemini 2.5 Flash TTS.
- Multiple calls & agentic workflows: sequential crew, iterative critic/reviser loop, batch JSON schema calls.
- Multiple media: text + synthesized audio.
- Prompt-injection/robustness: schema enforcement, rubric guardrails, fence/boilerplate cleaning, status recovery, artifact caching.
- Non-standard tool: client-side Transformers.js embedding pipeline; optional Google Search tool for research agents.

## Correctness & Gaps
- Strengths: schema-constrained outputs; rate-limited retries; stuck-state recovery; artifact hydration; HTML stripping; input caps; phase-specific prompts; vector model idle GC.
- Gaps: no automated tests; PDF parsing is mocked; storage obfuscation is not secure encryption; TTS assumes PCM payload structure; no offline/SSR path; error UX for RAG model load is log-based.

## Recommendations
1) Add unit tests for CSV parsing, storage obfuscation, `cleanJson`/`cleanMarkdown`, and mocked Gemini flows for batch/crew parsing.
2) Replace PDF placeholder with a lightweight serverless extractor or surface an explicit “PDF not supported” notice.
3) Add diagnostics panel: RAG model status (ready/idle/unloaded), indexed count, last Gemini call health.
4) Document deployment (Vercel/Netlify), API key setup, privacy posture (client-side only), and cite dependencies (Google Gemini, Transformers.js, Lucide, Vite/React/TS).
