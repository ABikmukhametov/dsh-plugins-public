/** Browser-relative download route for presented and changed files. */
export const DOWNLOAD_PATH = '/api/artifact.download'
export const DOWNLOAD_ROUTE = DOWNLOAD_PATH.slice(1)

/** Preserve the Session coordinates supplied by a delivery card or change review. */
export function downloadRoute(actionUrl: string): string {
  const source = new URL(actionUrl, 'http://dsh.invalid/')
  if (source.pathname !== '/api/present.open' && source.pathname !== '/api/changes.open') {
    throw new Error('Unsupported file action route')
  }
  return `${DOWNLOAD_ROUTE}${source.search}`
}
