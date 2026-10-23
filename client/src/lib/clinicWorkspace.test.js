import { expect, it, vi } from 'vitest'
import { fetchAllClinicRows } from './clinicWorkspace'
it('rejects missing records even when pagination incorrectly reports the final page', async () => {
  const rows = [{ id: 1 }]
  rows.__pagination = { page: 1, totalPages: 1, total: 2 }
  await expect(fetchAllClinicRows({ get: async () => rows }, '/payments')).rejects.toThrow('Record count changed')
})
it('rejects changing totals instead of producing a mixed-snapshot export', async () => {
  const first = [{ id: 1 }]
  first.__pagination = { page: 1, totalPages: 2, total: 2 }
  const last = [{ id: 2 }]
  last.__pagination = { page: 2, totalPages: 2, total: 3 }
  await expect(fetchAllClinicRows({ get: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(last) }, '/payments')).rejects.toThrow('Record count changed')
})
it('rejects truncated server data instead of exporting it as complete', async () => {
  const rows = [{id:1}]
  rows.__truncated = true
  await expect(fetchAllClinicRows({get:async()=>rows}, '/queue')).rejects.toThrow('server limit')
})
it('continues short pages when server metadata says more pages exist', async () => {
  const first = [{id:1}]
  first.__pagination = {page:1,totalPages:2}
  const last = [{id:2}]
  last.__pagination = {page:2,totalPages:2}
  const api = {get:vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(last)}
  expect(await fetchAllClinicRows(api, '/appointments')).toHaveLength(2)
})
it('rejects a repeated page rather than silently duplicating clinic records', async () => {
  const rows = [{id:1}]
  rows.__pagination = {page:1,totalPages:2}
  await expect(fetchAllClinicRows({get:async()=>rows}, '/appointments')).rejects.toThrow('pagination changed')
})
it('loads every clinic-scoped page and retains the selected dates', async () => {
  const api = { get: vi.fn().mockResolvedValueOnce(Array.from({length:100}, (_,id) => ({id}))).mockResolvedValueOnce([{id:101}]) }
  const rows = await fetchAllClinicRows(api, '/appointments', {date:'2026-10-20'})
  expect(rows).toHaveLength(101)
  expect(api.get).toHaveBeenLastCalledWith('/appointments', {params:{date:'2026-10-20',page:2,pageSize:100}})
})
it('does not keep fetching after an explicit final page', async () => {
  const rows = Array.from({length:100}, (_,id) => ({id}))
  rows.__pagination = {totalPages:1}
  const api = { get: vi.fn().mockResolvedValue(rows) }
  expect(await fetchAllClinicRows(api, '/payments')).toHaveLength(100)
  expect(api.get).toHaveBeenCalledTimes(1)
})
it('fails visibly instead of reporting malformed data as empty', async () => {
  await expect(fetchAllClinicRows({get:async()=>({})}, '/payments')).rejects.toThrow('Could not read clinic records.')
})
