// Shared CSV-building and browser-download helpers.
// Extracted from independent copies of the same "escape one cell -> join rows -> Blob -> anchor
// -> click -> revoke" pattern in AdminPages.jsx (`csvCell`/`downloadCsv`, used for doctors.csv and
// patients.csv), FeaturePages.jsx, StaffPages.jsx (x2), and three separate exportCsv functions in
// PatientPages.jsx (Family, PatientAppointments, Notifications) — found during the duplication
// audit (2026-09-05).

/**
 * Escapes one value for a CSV cell: wraps it in double quotes, doubling any embedded quote.
 * @param {*} value
 * @returns {string}
 */
export function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

/**
 * Builds a full CSV string from a header row and an array of data rows (each an array of cells).
 * @param {string[]} headers
 * @param {Array<Array<*>>} rows
 * @returns {string}
 */
export function buildCsv(headers, rows) {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')
}

/**
 * Triggers a browser download of a CSV string under the given filename.
 * @param {string} filename
 * @param {string} csv - a full CSV string, e.g. from buildCsv()
 */
export function downloadCsv(filename, csv) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
