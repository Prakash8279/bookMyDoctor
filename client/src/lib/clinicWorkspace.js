export async function fetchAllClinicRows(apiClient, path, filters = {}) {
  const result = []
  for (let page = 1; page <= 1000; page += 1) {
    const rows = await apiClient.get(path, { params: { ...filters, page, pageSize: 100 } })
    if (!Array.isArray(rows)) throw new Error('Could not read clinic records.')
    if (rows.__truncated) throw new Error('Clinic records exceed the server limit. Choose a shorter date range.')
    if (rows.__pagination && Number(rows.__pagination.page) > 0 && Number(rows.__pagination.page) !== page) {
      throw new Error('Clinic pagination changed. Refresh and try again.')
    }
    result.push(...rows)
    if (rows.__pagination && Number.isFinite(Number(rows.__pagination.totalPages))) {
      if (page >= Number(rows.__pagination.totalPages)) return result
      if (!rows.length) throw new Error('Clinic records changed during loading. Refresh and try again.')
    } else if (rows.length < 100) return result
  }
  throw new Error('Too many records. Choose a shorter date range.')
}
