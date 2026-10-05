import { fromISO } from './week'

const BLUE = 'FFDDEBF7'   // the light blue the sheet uses for its quarter blocks
const HEAD = 'FF1F4E79'
const thin = { style: 'thin', color: { argb: 'FFA7A9AC' } }
const border = { top: thin, left: thin, bottom: thin, right: thin }

/**
 * Builds and downloads the out-of-town sheet in the same layout people
 * already send their manager: Quarter · Year · Month · Week starting ·
 * No. of days · Out of town reason · Total Quarter days, with the quarter
 * and its total merged down the side. The quarter reads as its months
 * ("Jul – Sep 2026"), the way the request for it does, and a week that crosses
 * the quarter's edge starts on the quarter's first day, so every date on the
 * sheet is inside the quarter. ExcelJS is loaded only when someone actually
 * downloads, so it never slows the app down otherwise.
 */
export async function downloadOutOfTown({ person, quarter, rows }) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CMCHS Staff Schedule'
  const ws = wb.addWorksheet('Out of town', { views: [{ state: 'frozen', ySplit: 1 }] })

  ws.columns = [
    { header: 'Quarter', key: 'quarter', width: 16 },
    { header: 'Year', key: 'year', width: 7 },
    { header: 'Month', key: 'month', width: 7 },
    { header: 'Week starting', key: 'week', width: 14 },
    { header: 'No. of days', key: 'days', width: 11 },
    { header: 'Out of town reason', key: 'reason', width: 44 },
    { header: 'Total Quarter days', key: 'total', width: 18 },
  ]
  ws.getRow(1).eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD } }
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    c.border = border
  })

  const total = rows.reduce((n, r) => n + (Number(r.days) || 0), 0)
  rows.forEach(r => {
    const d = fromISO(r.start || r.weekStart)
    ws.addRow({
      quarter: quarter.title,
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      // UTC midnight, so Excel shows the same date in any time zone.
      week: new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())),
      days: Number(r.days) || 0,
      reason: r.reason || '',
      total,
    })
  })

  const first = 2
  const last = rows.length + 1
  for (let i = first; i <= last; i++) {
    const row = ws.getRow(i)
    row.getCell('week').numFmt = 'dd/mm/yyyy'
    row.eachCell({ includeEmpty: true }, c => { c.border = border; c.alignment = { vertical: 'middle', wrapText: true } })
    ;['year', 'month', 'days'].forEach(k => { row.getCell(k).alignment = { vertical: 'middle', horizontal: 'center' } })
  }
  if (rows.length) {
    ws.mergeCells(first, 1, last, 1)
    ws.mergeCells(first, 7, last, 7)
    for (const col of [1, 7]) {
      const c = ws.getCell(first, col)
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } }
      c.alignment = { vertical: 'middle', horizontal: 'center' }
      c.font = { bold: true }
    }
  }

  const blob = new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `Out of town - ${person} - ${quarter.title.replace(' – ', '-')}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
