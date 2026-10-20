export async function fetchAllClinicRows(apiClient, path, filters = {}) {
  const result = []
  for (let page = 1; page <= 1000; page += 1) {
    const rows = await apiClient.get(path, { params: { ...filters, page, pageSize: 100 } })
    if (!Array.isArray(rows)) throw new Error('Could not read clinic records.')
    result.push(...rows)
    if (rows.length < 100 || (rows.__pagination && page >= rows.__pagination.totalPages)) return result
  }
  throw new Error('Too many records. Choose a shorter date range.')
}
