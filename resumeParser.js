import pdfParse from 'pdf-parse'
import fs from 'fs'

/**
 * Parse a resume PDF file and return the extracted text
 *
 * @param {string} resumePath - Path to the resume PDF file
 * @returns {Promise<{rawText: string}>} - Object containing the parsed resume text
 */
export async function parseResume(resumePath) {
  try {
    // Check if file exists
    if (!fs.existsSync(resumePath)) {
      throw new Error(`Resume file not found: ${resumePath}`)
    }

    // Read the PDF file
    const pdfBuffer = fs.readFileSync(resumePath)

    // Parse the PDF
    const data = await pdfParse(pdfBuffer)

    return {
      rawText: data.text,
    }
  } catch (error) {
    console.error('Error parsing resume:', error)
    throw error
  }
}
