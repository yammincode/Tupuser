// 匯出 Excel 可以直接開的 CSV（UTF-8 加 BOM，中文不會變亂碼）
// sections：[{ title, head: ['欄位',...], rows: [[...], ...] }]
export function downloadCsv(filename, sections) {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = []
  for (const sec of sections) {
    if (sec.title) lines.push(cell(sec.title))
    lines.push(sec.head.map(cell).join(','))
    for (const r of sec.rows) lines.push(r.map(cell).join(','))
    lines.push('')
  }
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename.endsWith('.csv') ? filename : filename + '.csv'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
