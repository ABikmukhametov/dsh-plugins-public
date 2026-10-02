/** Coverage of the native namespace dictionary keys. */
export interface CoverageReport {
  translated: number
  total: number
  missing: Record<string, string[]>
  obsolete: Record<string, string[]>
}
/**
 * Reject empty translations and changed placeholders; report accepted gaps.
 * @param russian - Russian dictionary corpus.
 * @param english - native reference dictionaries.
 * @returns coverage report.
 */
export function validate(russian: Record<string, Record<string, string>>, english: Record<string, Record<string, string>>): CoverageReport
