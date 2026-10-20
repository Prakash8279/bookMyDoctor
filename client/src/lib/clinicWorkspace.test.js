import { expect, it, vi } from 'vitest'
import { fetchAllClinicRows } from './clinicWorkspace'
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
