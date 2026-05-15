# Job Application Agent

An AI-powered pipeline that:

1. **Chats with you** (via Google ADK) to collect personal info not on your resume — gender, nationality, veteran status, salary expectations, etc.
2. **Automatically fills and submits** the job application form (via Stagehand + Chromium) using your resume PDF plus whatever you provided in the chat.

---

## Architecture

```
You ──chat──▶  ADK Agent (agent.ts)
                  │  collects missing info
                  │  calls submit_application tool
                  ▼
             Stagehand browser agent (apply.ts)
                  │  parses resume PDF
                  │  opens Chromium locally
                  │  fills every form field
                  └─▶ submits the application
```

Two separate AI layers:

| Layer                       | What it does                | Model                           |
| --------------------------- | --------------------------- | ------------------------------- |
| **ADK chat**                | Conversational Q&A with you | Gemini (via GEMINI_API_KEY)     |
| **Stagehand browser agent** | Drives the browser          | Gemini (via GEMINI_API_KEY)     |

---

## Prerequisites

- **Node.js 24+** (ADK TypeScript requires it)
- **Gemini API key** → [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
- Your **resume as a PDF** with selectable text

---

## Setup

```bash
npm install
cp .env.example .env
# Edit .env — set GEMINI_API_KEY and RESUME_PATH
```

Place your resume at `./resume.pdf` (or wherever `RESUME_PATH` points).

---

## Running

### Option 1 — Web chat UI (recommended)

```bash
npm run web
# Opens http://localhost:8000
# Select "job_application_assistant" in the top-right dropdown
# Chat with the agent, answer its questions, then it submits for you
```

### Option 2 — Terminal chat

```bash
npm run chat
# Interactive CLI — same flow, no browser tab needed for the chat
```

### Option 3 — Skip the chat, run the browser agent directly

```bash
npm run apply
# Bypasses ADK entirely — goes straight to Stagehand with resume only
```

---

## How the chat flow works

1. The agent greets you and summarises what it's about to do.
2. It asks for personal info in a conversational, non-pressuring way:
   - Gender identity & pronouns
   - Sexual orientation
   - Nationality / citizenship
   - Race / ethnicity
   - Veteran status
   - Disability status
   - Visa sponsorship requirement
   - Salary expectation
   - How you heard about the role
   - Cover letter (optional)
3. For every sensitive question it reminds you that **"Prefer not to say" is always valid**.
4. Once you say you're ready (or "just go"), it calls `submit_application` and launches the browser.
5. A Chromium window opens and you can watch the agent fill in the form in real time.
6. The browser stays open 30 seconds after submission so you can verify.

---

## Project structure

```
opendoor-agent/
├── agent.ts           # ADK LlmAgent — conversational front-end
├── apply.ts           # Stagehand browser automation (also runnable standalone)
├── resumeParser.js    # PDF → text extraction
├── adk.config.js      # ADK configuration
├── adk.json           # ADK app registration
├── package.json
└── README.md
```

---

## Environment variables

| Variable            | Description                              | Default                                                                    |
| ------------------- | ---------------------------------------- | -------------------------------------------------------------------------- |
| `GEMINI_API_KEY`    | Gemini API key (required)                | —                                                                          |
| `RESUME_PATH`       | Path to your resume PDF                  | `./resume.pdf`                                                             |
| `JOB_URL`           | Target job application URL               | Rippling URL (hardcoded)                                                   |
| `ADK_MODEL`         | Model for ADK chat layer                 | `gemini-flash-lite-latest`                                                 |
| `STAGEHAND_MODEL`   | Model for Stagehand browser agent        | `google/gemini-flash-lite-latest`                                          |

---

## Troubleshooting

| Problem                   | Fix                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `Resume not found`        | Check `RESUME_PATH` in `.env`                                                       |
| `Could not extract text`  | Your PDF may be image-only — re-export with selectable text                         |
| ADK web shows no agent    | Make sure `"main": "agent.ts"` is in `package.json` and `rootAgent` is exported     |
| Agent misses a form field | Increase `maxSteps` in `apply.ts` (default: 50)                                     |
| CAPTCHA encountered       | Agent stops and reports it — solve manually in the open browser window              |
| ADK requires Node 24+     | Run `node --version`; upgrade if needed                                             |
