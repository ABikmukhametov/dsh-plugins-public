/** Validate translation data independently of registration and browser state. */

/**
 * Reject empty values and changed placeholder sets; report allowed gaps.
 * @param {Record<string, Record<string, string>>} russian - imported translation corpus.
 * @param {Record<string, Record<string, string>>} english - native DSH reference dictionaries.
 * @returns {{translated: number, total: number, missing: Record<string, string[]>, obsolete: Record<string, string[]>}} coverage report.
 */
export function validate(russian, english) {
  const errors = []
  const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',')
  for (const [namespace, dict] of Object.entries(russian)) {
    for (const [key, value] of Object.entries(dict)) {
      const spaceSeparator = namespace === 'chat' && key === 'number.groupSeparator' && value === ' '
      if (typeof value !== 'string' || (value.trim() === '' && !spaceSeparator)) {
        errors.push(`${namespace}.${key}: empty or non-string translation`)
        continue
      }
      const reference = english[namespace]?.[key]
      if (reference !== undefined && placeholders(value) !== placeholders(reference)) {
        errors.push(`${namespace}.${key}: placeholders differ`)
      }
    }
  }
  if (errors.length > 0) throw new Error(errors.join('\n'))
  const report = { translated: 0, total: 0, missing: {}, obsolete: {} }
  for (const [namespace, dict] of Object.entries(english)) {
    const keys = Object.keys(dict)
    const ru = russian[namespace] ?? {}
    const missing = keys.filter(key => !(key in ru))
    report.total += keys.length
    report.translated += keys.length - missing.length
    if (missing.length > 0) report.missing[namespace] = missing
  }
  for (const [namespace, dict] of Object.entries(russian)) {
    const obsolete = Object.keys(dict).filter(key => !(key in (english[namespace] ?? {})))
    if (obsolete.length > 0) report.obsolete[namespace] = obsolete
  }
  return report
}
