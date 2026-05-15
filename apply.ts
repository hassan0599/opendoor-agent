/**
 * apply.ts — Stagehand browser automation layer
 *
 * Exported as a function so it can be called by the ADK agent (agent.ts)
 * once the conversational layer has collected all needed information.
 *
 * Can also be run directly:  npm run apply
 */

import { Stagehand } from '@browserbasehq/stagehand'
import { parseResume } from './resumeParser.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Extra personal details the ADK chat agent collects from you before
 * kicking off the browser automation. All fields are optional strings —
 * pass whatever you gathered; omit what you don't know.
 */
export interface ExtraUserInfo {
  gender?: string
  pronouns?: string
  sexualOrientation?: string
  nationality?: string
  ethnicity?: string
  veteranStatus?: string
  disabilityStatus?: string
  requiresSponsorship?: string // e.g. "No", "Yes - H1B"
  salaryExpectation?: string
  coverLetter?: string
  howDidYouHear?: string
  [key: string]: string | undefined // any other fields the agent discovers
}

export interface RunApplicationOptions {
  resumePath?: string
  jobUrl?: string
  extraInfo?: ExtraUserInfo
}

export interface RunApplicationResult {
  success: boolean
  message: string
  needsUserInput?: boolean
  issues?: string[]
  fields?: Record<string, string>
  partialSuccess?: boolean
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env')
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim()
      if (!process.env[key]) process.env[key] = val
    }
  }
}

// ---------------------------------------------------------------------------
// Core function — callable by both the ADK agent and the CLI entry point
// ---------------------------------------------------------------------------

export async function runApplication(
  opts: RunApplicationOptions = {},
): Promise<RunApplicationResult> {
  loadEnv()

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY
  const STAGEHAND_MODEL = process.env.STAGEHAND_MODEL ?? 'google/gemini-2.0-flash'
  const resumePath =
    opts.resumePath ?? process.env.RESUME_PATH ?? './resume.pdf'
  const jobUrl =
    opts.jobUrl ??
    process.env.JOB_URL ??
    'https://ats.rippling.com/en-CA/opendoor/jobs/f572e889-0644-4590-8a5a-64f73d7db17d/apply?step=application'
  const extraInfo = opts.extraInfo ?? {}

  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set in .env')
  }

  // 1. Parse resume PDF
  console.log('\n📄 Parsing resume:', resumePath)
  let resume: Awaited<ReturnType<typeof parseResume>>
  try {
    resume = await parseResume(resumePath)
    console.log('✅ Resume parsed successfully')
    console.log('Resume text length:', resume.rawText.length, 'characters')
  } catch (error) {
    console.error('❌ Resume parsing failed:', error)
    throw new Error(`Resume parsing failed: ${error.message}`)
  }

  console.log('\n🚀 Starting Stagehand in LOCAL mode …')
  console.log('Model:', STAGEHAND_MODEL)

  const stagehand = new Stagehand({
    env: 'LOCAL',
    verbose: 2,
    disablePino: true,
    localBrowserLaunchOptions: { headless: false },
    model: {
      modelName: STAGEHAND_MODEL,
      apiKey: GEMINI_API_KEY,
    },
  })

  try {
    await stagehand.init()
    console.log('✅ Browser launched')
  } catch (error) {
    console.error('❌ Stagehand initialization failed:', error)
    throw new Error(`Stagehand failed to initialize: ${error.message}`)
  }

  const page = stagehand.context.pages()[0]!

  // 3. Navigate to the form
  console.log(`\n🌐 Navigating to: ${jobUrl}`)
  await page.goto(jobUrl, { waitUntil: 'networkidle' })
  console.log('✅ Page loaded')

  // 4. Build prompts with resume + extra info merged in
  const systemPrompt = buildSystemPrompt(resume.rawText, extraInfo)
  const instruction = buildInstruction(resumePath, extraInfo)

  // 5. Run the agent with extended instruction for autonomous file upload
  const enhancedInstruction = `${instruction}

FILE UPLOAD HANDLING:
- When you encounter a file upload field (resume/CV), use the browser's file chooser.
- For Playwright/Page: Use page.setInputFiles(selector, '${resumePath}') for input[type=file] elements.
- DO NOT wait for manual user intervention - handle file uploads completely autonomously.
- After upload, verify the file was accepted (look for filename confirmation or success indicator).

ERROR REPORTING:
- If you cannot complete a field, note what information is missing.
- If submission fails, note the exact error message shown.
- If you get stuck, describe what prevented completion.`

  const agent = stagehand.agent({ systemPrompt })

  console.log('\n🤖 Browser agent starting …\n')
  const result = await agent.execute({ instruction: enhancedInstruction, maxSteps: 50 })

  console.log('\n✅ Browser agent finished.')
  console.log('Result:', result)

  // Analyze result for issues
  const resultStr = typeof result === 'string' ? result : JSON.stringify(result)
  const issues = analyzeResultForIssues(resultStr)

  // Don't close browser if there are issues - user may need to interact
  if (issues.length > 0) {
    console.log('\n⚠️ Issues detected - keeping browser open for user intervention')
    console.log('Issues:', issues)
    // Keep browser open longer for user to see and potentially fix
    await new Promise((r) => setTimeout(r, 60_000))
  } else {
    console.log('\n👀 Browser stays open 30s for review …')
    await new Promise((r) => setTimeout(r, 30_000))
  }

  await stagehand.close()

  // Determine if we need user input
  const needsUserInput = issues.length > 0 && !resultStr.toLowerCase().includes('submitted')
  const hasSuccess = resultStr.toLowerCase().includes('submitted') || resultStr.toLowerCase().includes('confirmation')

  return {
    success: hasSuccess && issues.length === 0,
    message: resultStr,
    needsUserInput,
    issues: issues.length > 0 ? issues : undefined,
    partialSuccess: hasSuccess && issues.length > 0,
  }
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function extraInfoBlock(extra: ExtraUserInfo): string {
  const entries = Object.entries(extra).filter(([, v]) => v)
  if (entries.length === 0) return ''
  const lines = entries.map(([k, v]) => `- ${k}: ${v}`).join('\n')
  return `\n\n--- ADDITIONAL CANDIDATE INFO (collected separately) ---\n${lines}\n--- END ADDITIONAL INFO ---`
}

function buildSystemPrompt(resumeText: string, extra: ExtraUserInfo): string {
  return `
You are a precise, careful job application assistant. Your job is to fill in an
online job application form accurately using the candidate's data provided below.

RULES:
1. Fill every required field. If a field is optional and the data has relevant
   info, fill it in too.
2. For EEO / diversity fields (gender, race/ethnicity, veteran status, disability,
   sexual orientation, etc.) use the values from "ADDITIONAL CANDIDATE INFO" if
   provided. If a field asks for something not supplied, choose "Prefer not to say"
   or the closest decline option — never invent data.
3. For salary expectations, use the value from additional info if supplied;
   otherwise leave blank or write "Open to discussion" if the field is required.
4. If the form has a resume/CV upload field, upload the file path given in the
   instruction.
5. After filling all fields, scroll through the entire form to verify nothing was
   missed, then click the submit button.
6. Do NOT click submit until you have reviewed the completed form.
7. If you encounter a CAPTCHA or human-verification step, stop and report it.
8. If the form navigates across multiple pages/steps, continue filling each page.

--- CANDIDATE RESUME ---
${resumeText}
--- END RESUME ---${extraInfoBlock(extra)}
`.trim()
}

function buildInstruction(
  resumeFilePath: string,
  extra: ExtraUserInfo,
): string {
  const extraHint =
    Object.keys(extra).length > 0
      ? `\n- Additional personal info (gender, nationality, etc.) is in your system prompt under "ADDITIONAL CANDIDATE INFO" — use it for any EEO or diversity fields you encounter.`
      : ''

  return `
You are on a job application form. Complete the entire application using the
candidate data in your system prompt.

Important specifics:
- If there is a file upload field for a resume/CV, upload this file: ${resumeFilePath}
  - Use page.setInputFiles() or click the upload button and handle the file chooser
  - DO NOT expect manual user intervention for file uploads
- Fill in all text fields (name, email, phone, address, LinkedIn, portfolio/website,
  work experience, education, skills, cover letter if requested, etc.) using the
  resume data.
- For dropdowns or radio buttons (e.g. "how did you hear about us?"), choose the
  most sensible option or "Other" if nothing fits.${extraHint}
- After all fields are complete, do a final review scroll, then click the submit
  (or "Apply" / "Send Application") button.
- Confirm the submission was successful by looking for a confirmation message or
  page change. Report what you see.
`.trim()
}

// ---------------------------------------------------------------------------
// CLI entry point — only runs when executed directly
// ---------------------------------------------------------------------------
function analyzeResultForIssues(resultStr: string): string[] {
  const issues: string[] = []
  const lower = resultStr.toLowerCase()
  
  if (lower.includes('captcha')) {
    issues.push('CAPTCHA encountered - requires human verification')
  }
  if (lower.includes('error') && !lower.includes('no error')) {
    issues.push('Error detected during form filling')
  }
  if (lower.includes('missing') || lower.includes('required')) {
    issues.push('Some required fields may be incomplete')
  }
  if (lower.includes('failed') && !lower.includes('no failed')) {
    issues.push('Some action failed')
  }
  if (!lower.includes('submitted') && !lower.includes('confirmation')) {
    issues.push('Form may not have been submitted successfully')
  }
  
  return issues
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  runApplication().catch((err) => {
    console.error('\n❌ Fatal error:', err.message ?? err)
    process.exit(1)
  })
}
