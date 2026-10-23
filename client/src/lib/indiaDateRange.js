import { indiaRecordDate } from './adminRecords'

export function isIndiaDateRangeValid(from, to) {
  return (!from && !to) || Boolean(from && to && from <= to)
}

export function inIndiaDateRange(value, from, to) {
  if (!from && !to) return true
  if (!isIndiaDateRangeValid(from, to)) return false
  const day = indiaRecordDate(value)
  return Boolean(day && day >= from && day <= to)
}

