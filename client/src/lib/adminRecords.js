import { isValidElement } from 'react'
import { buildCsv } from './csv'

export function indiaRecordDate(value) {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const part = (type) => parts.find((item) => item.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

function cellText(value) {
  if (value == null || typeof value === 'boolean') return ''
  if (Array.isArray(value)) return value.map(cellText).join(' ')
  if (isValidElement(value)) return cellText(value.props.title ?? value.props.children ?? value.props.status ?? '')
  return typeof value === 'object' ? (value.name ?? value.id ?? '') : String(value)
}

export function adminTableCsv(columns, rows) {
  const exported = columns.filter((column) => !['actions', 'actionCol'].includes(column.key))
  return `\uFEFF${buildCsv(exported.map((column) => column.label), rows.map((row, index) => exported.map((column) =>
    column.exportValue ? column.exportValue(row) : column.key === 'id' ? row.id : column.key === 'bookingId' ? (row.appointment?.id || row.id) : cellText(column.render ? column.render(row, index) : row[column.key])
  )))}`
}
