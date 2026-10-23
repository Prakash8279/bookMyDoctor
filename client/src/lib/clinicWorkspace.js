export async function fetchAllClinicRows(apiClient, path, filters = {}) {
  const result = []
  const seen = new Set()
  let expectedTotal
  const complete = () => {
    if (expectedTotal !== undefined && result.length !== expectedTotal) throw new Error('Record count changed during loading. Refresh and try again.')
    return result
  }
  for (let page = 1; page <= 1000; page += 1) {
    const rows = await apiClient.get(path, { params: { ...filters, page, pageSize: 100 } })
    if (!Array.isArray(rows)) throw new Error('Could not read clinic records.')
    if (rows.__truncated) throw new Error('Clinic records exceed the server limit. Choose a shorter date range.')
    if (rows.__pagination && Number(rows.__pagination.page) > 0 && Number(rows.__pagination.page) !== page) {
      throw new Error('Clinic pagination changed. Refresh and try again.')
    }
    const total = rows.__pagination?.total
    if (total != null && Number.isSafeInteger(Number(total)) && Number(total) >= 0) {
      if (expectedTotal !== undefined && expectedTotal !== Number(total)) throw new Error('Record count changed during loading. Refresh and try again.')
      expectedTotal = Number(total)
    }
    for (const row of rows) {
      if (row.id != null && seen.has(row.id)) throw new Error('Records changed during loading. Refresh and try again.')
      if (row.id != null) seen.add(row.id)
      result.push(row)
    }
    // Reconciliation includes a server-computed summary outside the row array.
    if (rows.__kpi && page === 1) Object.defineProperty(result, '__kpi', { value: rows.__kpi })
    if (rows.__pagination && Number.isFinite(Number(rows.__pagination.totalPages))) {
      if (page >= Number(rows.__pagination.totalPages)) return complete()
      if (!rows.length) throw new Error('Clinic records changed during loading. Refresh and try again.')
    } else if (rows.length < 100) return complete()
  }
  throw new Error('Too many records. Choose a shorter date range.')
}
