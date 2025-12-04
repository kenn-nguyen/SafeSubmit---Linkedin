# SafeSubmit – Introduction & Product Design (PM View)

> Source alignment: Derived from the research doc `SafeSubmit - AI job search and resume builder.md` plus the implemented SPA. This expands the business/product narrative and calls out deltas between the original plan and the current code, with reasons rooted in time and tech constraints.

## Part 1: Introduction & Purpose
- **Problem framing**  
  - High-stakes candidates (Snipers, Internationals, Pivoters, Stealth seekers) fear reputational harm, visa landmines, and AI hallucinations.  
  - Shotgunners burn out sending generic PDFs, wasting time on low-signal applications.  
  - Pivoters need “translation” into new-domain language without over-claiming; Internationals need visa-aware filtering; Stealth users need control and discretion.
- **Purpose**  
  - Deliver a safety-first copilot that:  
    1) Filters and scores roles with transparent reasoning and visa risk flags.  
    2) Tailors resumes to each job without inventing facts.  
    3) Keeps the user in control (diffs, approvals, no hidden auto-apply).  
    4) Educates (explain why changes) while accelerating throughput.
- **Personas (from interviews)**  
  - Sniper: reputation protection; “Super-Editor,” hates hallucinated numbers.  
  - International candidate: visa-safe filtering and natural language; every app is a scarce “shot.”  
  - Pivoter: jargon translation with justification; needs to learn the new dialect.  
  - Stealth seeker: draft-only/blocklists; zero hidden actions.  
  - High-volume seeker: speed with guardrails (later).  
  - Power user: wants knobs, rules, and transparency.
- **Value proposition**  
  - “Scale your best self, safely.” Faster tailoring, grounded in your resume and job data, with visible reasoning and risk controls.

## Part 2: Product Design (Current Experience vs. Original Vision)
- **Current user journey (shipped SPA)**  
  1) Upload resume (TXT/MD; PDF is mocked) and enter Gemini API key (stored locally with XOR obfuscation).  
  2) Declare target intent; app recruits two AI crews (Evaluation + Resume Crafting) via Gemini 3 Pro JSON output.  
  3) Import job CSV; system parses, de-HTMLs, normalizes salary, and indexes jobs locally with Transformers.js MiniLM (RAG).  
  4) Batch-score jobs with rubric + visa risk + reasoning (Gemini 3 Pro, schema-enforced JSON); cache artifacts.  
  5) Per-job tailored resume via multi-phase crew (Architect → Writer → iterative Critic/Reviser with score threshold → Editor → QA); download Markdown; diff modal available.  
  6) Chat grounded in indexed jobs to ask “where should I apply?”; optional 15s audio summary via Gemini TTS.  
  7) All logic runs client-side; no backend, no SSO, no DB—just localStorage and in-browser embeddings.

- **Original research-driven intent vs. delivered scope**  
  - **Truth-first editor with structured Fact Base + metric-change flags**  
    - *Planned:* Parse resume into a Fact Base, lock metrics/dates, show diffs with special metric alerts.  
    - *Delivered:* Multi-phase resume generation with cleaning and diff; no Fact Base lock or metric-change alerts.  
  - **Visa-aware sponsorship intelligence**  
    - *Planned:* Employer-level priors + JD NLP for legal language, user rules to hide/show roles.  
    - *Delivered:* Prompt-based visa risk tagging; no employer priors, no dedicated legal NLP beyond prompt guardrails.  
  - **Translator with educational tooltips**  
    - *Planned:* Explain each translation (e.g., “client presentations” → “stakeholder management”) with rationale.  
    - *Delivered:* Rewrites occur; rationales/tooltips are not shown in UI.  
  - **Blocklists, draft-only, stealth UX**  
    - *Planned:* Blocklists, draft-only mode, detailed logs; no hidden actions.  
    - *Delivered:* No blocklists or stealth UI; app never auto-applies but lacks explicit stealth controls.  
  - **Controlled batch size (≤5) with queueing**  
    - *Planned:* Small, controlled batches for quality; sequential processing.  
    - *Delivered:* CSV up to 500 rows; batch analysis is allowed; generation is per-job trigger (not small capped batches).  
  - **History, applied tracking, analytics/positioning tests**  
    - *Planned:* History table, applied state, positioning experiments.  
    - *Delivered:* None beyond cached artifacts; no applied tracking or analytics.  
  - **Cover letters / multi-artifact generation**  
    - *Planned:* Resume + cover letter per job.  
    - *Delivered:* Resume only.  
  - **SSO + backend Fact Base + server vector store**  
    - *Planned:* Google SSO, backend persistence, LangChain/vector DB.  
    - *Delivered:* Client-only SPA, localStorage, in-browser RAG.  
  - **PDF/DOCX ingest with Fact Audit and “truth lock”**  
    - *Planned:* Parse PDF/DOCX into structured facts, audit/lock workflow.  
    - *Delivered:* PDF parsing mocked; no audit/lock.  
  - **Browser extension / assisted apply**  
    - *Planned:* Assist form-filling; user presses submit.  
    - *Delivered:* Not present.  
  - **Rule-based auto-apply for power users**  
    - *Planned:* User rules to auto-apply under constraints.  
    - *Delivered:* Not present (intentionally avoided).  
  - **Company-level sponsorship priors**  
    - *Planned:* Past employer sponsorship history as a prior.  
    - *Delivered:* Not present; only prompt heuristics.

- **Original work completed (research and design depth)**  
  - Extensive persona development from interviews (Sniper, International, Pivoter, Stealth, High-volume, Power user) with pain maps: reputational risk, visa constraints, translation anxiety, stealth needs, fatigue from volume, desire for control.  
  - Market segmentation and prioritization: “Super-persona” wedge combining high-stakes (Sniper) + visa (International) + translation (Pivoter), de-prioritizing indiscriminate auto-apply behavior.  
  - Positioning statements: “Safety-first AI copilot,” “Scale your best self, safely,” versus generic trackers/auto-apply bots.  
  - Roadmap phases drafted: Trust (Safe Harbor MVP) → Privacy (stealth/blocklists) → Controlled Scale (bounded batching/auto-apply under rules).  
  - PRD concepts: Fact Base lock, translation tooltips, diff dashboard with metric flags, sponsorship intelligence (employer priors + JD legal NLP), capped batch generation, history/apply tracking, and draft-only flows for stealth.  
  - UX intents: fact audit/lock, translation rationale tooltips, sponsorship risk pills, history and applied-state tracking, explicit “never apply” blocklists, and rule-based behaviors for power users.

- **Why scope shifted (constraints)**  
  - **Time**: Prioritized an end-to-end working SPA (upload → score → tailor → chat) over backend/SSO and deeper trust UX.  
  - **Technology/sandbox**: Client-only environment; no server DB, no LangChain backend; no PDF tooling; embeddings kept local via Transformers.js.  
  - **Safety posture**: Avoided auto-apply and backend data handling to reduce privacy risk; chose Markdown downloads and local storage.  
  - **Complexity vs. reliability**: Implemented schema-enforced batch scoring and iterative crews instead of a broader feature matrix (cover letters, analytics, blocklists) to ensure stability.

- **What is uniquely delivered despite cuts**  
  - Agentic crews for both evaluation and resume crafting, using multiple Gemini models.  
  - Local RAG (Transformers.js MiniLM) grounding chat in user-imported jobs.  
  - Iterative critic/reviser loop with phase telemetry for resume generation.  
  - Visa risk tagging and rubric-based scoring embedded directly into prompts.  
  - Audio summaries via Gemini TTS for quick review/sharing.  
  - Robust CSV ingest (fuzzy headers, HTML stripping, salary normalization) and artifact caching keyed by resume hash.

- **Near-term opportunities (to align closer to vision)**  
  1) Add Fact Base + metric-change highlighting + diff alerts; structured fact lock.  
  2) Introduce sponsorship intelligence: employer priors + JD legal NLP + user-configurable hide/show rules.  
  3) Surface translation rationale/tooltips in UI for Bella/Priya.  
  4) Add blocklists, draft-only/stealth mode, and lightweight history/apply tracking.  
  5) Replace PDF mock with real parsing; add cover letters; cap generation batches with queue UI.  
  6) Optional backend for SSO, persistence, privacy controls, and better telemetry/analytics.  
  7) Power-user rules (safe, bounded): “generate drafts automatically under thresholds; never submit.”
