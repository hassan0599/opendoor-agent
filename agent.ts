/**
 * agent.ts — ADK conversational front-end for the job application agent
 *
 * Flow:
 *  1. The agent greets you and reads your resume from disk.
 *  2. It asks you conversationally for any personal info the form may need.
 *  3. Once you confirm you're ready, it calls `submitApplication` which
 *     launches Stagehand and fills/submits the form automatically.
 *
 * Both layers use Google Gemini — ADK chat via GEMINI_API_KEY,
 * Stagehand browser agent via the same key with the google/ AI SDK provider.
 */

import {
  FunctionTool,
  LlmAgent,
  InMemorySessionService,
  Runner,
} from '@google/adk'
import { z } from 'zod'
import { loadEnv, runApplication, ExtraUserInfo, RunApplicationResult } from './apply.js'
import { parseResume } from './resumeParser.js'
import path from 'path'

// Load .env so OPENROUTER_API_KEY etc. are available when the tool fires
loadEnv()

// ---------------------------------------------------------------------------
// Resume — load once at startup so the agent knows what's already covered
// ---------------------------------------------------------------------------
const RESUME_PATH = process.env.RESUME_PATH ?? './resume.pdf'
const JOB_URL =
  process.env.JOB_URL ??
  'https://ats.rippling.com/en-CA/opendoor/jobs/f572e889-0644-4590-8a5a-64f73d7db17d/apply?step=application'

let resumeSummary = '(resume not yet loaded)'
try {
  const resume = await parseResume(RESUME_PATH)
  // Give the ADK agent a condensed view — the full text goes to Stagehand later
  resumeSummary =
    resume.rawText.slice(0, 3000) +
    (resume.rawText.length > 3000 ? '\n…(truncated)' : '')
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e)
  resumeSummary = `⚠️ Could not load resume: ${msg}`
}

// ---------------------------------------------------------------------------
// Tool: submitApplication
// The agent calls this when it has collected all the info it needs.
// ---------------------------------------------------------------------------
// Track retry count per session
let retryCount = 0
let lastExtraInfo: ExtraUserInfo = {}

const submitApplication = new FunctionTool({
  name: 'submit_application',
  description:
    'Launches the browser automation to fill in and submit the job application form. ' +
    'Call this ONLY after you have collected all the extra personal information the ' +
    'user wants to provide (or they have explicitly said they are ready to proceed). ' +
    'If the form cannot be completed, this tool will return the issues that need resolution.',
  parameters: z.object({
    gender: z
      .string()
      .optional()
      .describe(
        "User's gender identity, e.g. 'Male', 'Female', 'Non-binary', 'Prefer not to say'",
      ),
    pronouns: z
      .string()
      .optional()
      .describe("User's pronouns, e.g. 'he/him', 'she/her', 'they/them'"),
    sexualOrientation: z
      .string()
      .optional()
      .describe(
        "Sexual orientation, e.g. 'Heterosexual', 'Gay or Lesbian', 'Prefer not to say'",
      ),
    nationality: z
      .string()
      .optional()
      .describe('Nationality or country of citizenship'),
    ethnicity: z
      .string()
      .optional()
      .describe(
        "Race or ethnicity, e.g. 'Asian', 'White', 'Hispanic or Latino', 'Prefer not to say'",
      ),
    veteranStatus: z
      .string()
      .optional()
      .describe(
        "Veteran status, e.g. 'Not a veteran', 'Protected veteran', 'Prefer not to say'",
      ),
    disabilityStatus: z
      .string()
      .optional()
      .describe(
        "Disability status, e.g. 'No disability', 'Yes, I have a disability', 'Prefer not to say'",
      ),
    requiresSponsorship: z
      .string()
      .optional()
      .describe(
        "Whether the applicant requires visa sponsorship, e.g. 'No', 'Yes'",
      ),
    salaryExpectation: z
      .string()
      .optional()
      .describe("Salary expectation, e.g. '$120,000', 'Open to discussion'"),
    coverLetter: z
      .string()
      .optional()
      .describe('Cover letter text if the user has provided one'),
    howDidYouHear: z
      .string()
      .optional()
      .describe(
        "How the applicant heard about the role, e.g. 'LinkedIn', 'Referral', 'Job board'",
      ),
    additionalFields: z
      .record(z.string())
      .optional()
      .describe(
        "Any other key-value pairs the form might need that don't fit the above",
      ),
    isRetry: z
      .boolean()
      .optional()
      .describe('Set to true if this is a retry attempt after previous issues'),
  }),
  execute: async (params) => {
    const { additionalFields, isRetry, ...namedFields } = params
    
    // Merge with previous info if retrying
    if (isRetry) {
      lastExtraInfo = { ...lastExtraInfo, ...namedFields, ...(additionalFields ?? {}) }
      retryCount++
    } else {
      lastExtraInfo = { ...namedFields, ...(additionalFields ?? {}) }
      retryCount = 0
    }

    console.log(`\n🚀 submit_application tool called (attempt ${retryCount + 1}) — launching browser…`)

    try {
      const result = await runApplication({
        resumePath: RESUME_PATH,
        jobUrl: JOB_URL,
        extraInfo: lastExtraInfo,
      })
      
      // Check if we need user input
      if (result.needsUserInput && result.issues && result.issues.length > 0) {
        return {
          status: 'needs_input',
          message: result.message,
          issues: result.issues,
          retryCount: retryCount + 1,
          instruction: 'The browser agent encountered issues. Please help resolve them, then I can retry the submission with your updated information.',
        }
      }
      
      if (result.partialSuccess) {
        return {
          status: 'partial_success',
          message: result.message,
          issues: result.issues,
          instruction: 'The form was partially completed but there may be some issues. Would you like me to retry, or can you provide additional information?',
        }
      }
      
      return {
        status: result.success ? 'success' : 'error',
        message: result.message,
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { 
        status: 'error', 
        message: msg,
        issues: [msg],
        instruction: 'An error occurred. Would you like me to retry, or can you provide additional information to help resolve this?',
      }
    }
  },
})

// ---------------------------------------------------------------------------
// ADK Agent definition
// ---------------------------------------------------------------------------

/**
 * ADK uses Gemini. Set GEMINI_API_KEY in .env and optionally ADK_MODEL
 * to override the default model.
 */
const ADK_MODEL = process.env.ADK_MODEL ?? 'gemini-2.0-flash'

export const rootAgent = new LlmAgent({
  name: 'job_application_assistant',
  model: ADK_MODEL,
  description:
    'Conversational assistant that collects missing personal info and then ' +
    'automatically fills out and submits a job application form. Handles errors ' +
    'by prompting the user for corrections and retrying.',
  instruction: `
You are a friendly, efficient job application assistant. The user wants to apply 
for a job. Their resume has already been loaded — here is a summary:

--- RESUME SUMMARY ---
${resumeSummary}
--- END RESUME SUMMARY ---

The target job URL is: ${JOB_URL}

YOUR JOB:
1. Greet the user warmly and briefly explain what you'll do.
2. Explain that many job forms ask for personal information that isn't typically 
   on a resume (EEO / diversity fields, visa status, salary expectations, etc.).
3. Ask the user for the following in a natural, conversational way — group related 
   questions together, don't fire them all at once:
   - Gender identity
   - Pronouns (optional)
   - Sexual orientation (many forms ask; completely optional)
   - Nationality / country of citizenship
   - Race / ethnicity
   - Veteran status
   - Disability status
   - Whether they require visa sponsorship
   - Salary expectation
   - How they heard about the role
   - Whether they have a cover letter they'd like to include
4. For every sensitive question, make clear that "Prefer not to say" is always 
   a valid answer and you will select that option on the form.
5. Once the user has answered everything they want to (or explicitly says "skip" 
   or "I'm ready"), call the \`submit_application\` tool with all collected data.
6. Report back what the browser agent found (success / CAPTCHA / error).

ERROR HANDLING (CRITICAL):
- If submit_application returns status "needs_input" or "partial_success", it means 
  there were issues that need user attention.
- The response will include an "issues" array listing what went wrong.
- Prompt the user with the specific issues and ask for the missing/correct information.
- Once the user provides updates, call submit_application again with isRetry=true 
  and include ALL the collected data (previous + new/corrected).
- Keep retrying until the form is successfully submitted or the user wants to abort.
- For CAPTCHA issues, inform the user they need to solve it manually in the open 
  browser window.

IMPORTANT:
- Never pressure the user to share sensitive information.
- Never invent or assume answers — only use what the user explicitly tells you.
- Keep the conversation focused; don't go on tangents.
- If the user says "just go" or "skip all of this", call submit_application 
  immediately with only what you already know.
- When retrying, ALWAYS include isRetry=true and merge all previously collected data.
`.trim(),
  tools: [submitApplication],
})
