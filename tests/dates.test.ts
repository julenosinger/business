import { describe, expect, test } from 'bun:test'
import { addDaysIso, addMonthsIso, dateIssue, daysInMonth, formatIso, inRange, isValidIso, isValidTime, joinDateTime, maskDigits, maskTime, monthGrid, parseText, placeholder, splitDateTime, weekday } from '../src/lib/dates'

describe('localized dates', () => {
  test('formats the same ISO date per language', () => {
    expect(formatIso('2026-12-25', 'pt')).toBe('25/12/2026')
    expect(formatIso('2026-12-25', 'en')).toBe('12/25/2026')
    expect(formatIso('2026-01-05', 'pt')).toBe('05/01/2026')
    expect(formatIso('2026-01-05', 'en')).toBe('01/05/2026')
    expect(formatIso('', 'pt')).toBe('')
    expect(formatIso('2026-02-31', 'en')).toBe('')
    expect(placeholder('pt')).toBe('DD/MM/AAAA')
    expect(placeholder('en')).toBe('MM/DD/YYYY')
  })

  test('parses typed text in the language order and always returns ISO', () => {
    expect(parseText('25/12/2026', 'pt')).toBe('2026-12-25')
    expect(parseText('12/25/2026', 'en')).toBe('2026-12-25')
    // O mesmo texto significa coisas diferentes por idioma.
    expect(parseText('03/04/2026', 'pt')).toBe('2026-04-03')
    expect(parseText('03/04/2026', 'en')).toBe('2026-03-04')
    // Dia ou mês impossível na ordem do idioma.
    expect(parseText('12/25/2026', 'pt')).toBeNull()
    expect(parseText('25/12/2026', 'en')).toBeNull()
    expect(parseText('31/02/2026', 'pt')).toBeNull()
    expect(parseText('29/02/2026', 'pt')).toBeNull()
    expect(parseText('29/02/2028', 'pt')).toBe('2028-02-29')
    expect(parseText('2026-12-25', 'pt')).toBe('2026-12-25') // ISO direto continua aceito
    expect(parseText('2026-12-25', 'en')).toBe('2026-12-25')
    expect(parseText('2026-13-01', 'en')).toBeNull()
    expect(parseText('25/12/26', 'pt')).toBeNull()
    expect(parseText('', 'pt')).toBeNull()
  })

  test('round trip never shifts a day, whatever the language', () => {
    for (const iso of ['2026-01-01', '2026-03-08', '2026-11-01', '2026-12-31', '2028-02-29', '2027-03-28']) {
      expect(parseText(formatIso(iso, 'pt'), 'pt')).toBe(iso)
      expect(parseText(formatIso(iso, 'en'), 'en')).toBe(iso)
    }
  })

  test('mask inserts separators while typing', () => {
    expect(maskDigits('2', 'pt')).toBe('2')
    expect(maskDigits('251', 'pt')).toBe('25/1')
    expect(maskDigits('25122', 'pt')).toBe('25/12/2')
    expect(maskDigits('25122026999', 'pt')).toBe('25/12/2026')
    expect(maskDigits('12/25/2026', 'en')).toBe('12/25/2026')
    expect(maskDigits('ab', 'en')).toBe('')
  })

  test('issues: incomplete, invalid and out of range are told apart', () => {
    expect(dateIssue('', 'pt')).toBeNull()
    expect(dateIssue('25/12', 'pt')).toBe('incomplete')
    expect(dateIssue('31/02/2026', 'pt')).toBe('invalid')
    expect(dateIssue('25/12/2026', 'pt')).toBeNull()
    expect(dateIssue('25/12/2026', 'pt', '2026-12-26')).toBe('range')
    expect(dateIssue('25/12/2026', 'pt', undefined, '2026-12-24')).toBe('range')
    expect(dateIssue('25/12/2026', 'pt', '2026-12-25', '2026-12-25')).toBeNull()
    expect(inRange('2026-12-25', '2026-12-01', '2026-12-31')).toBe(true)
    expect(inRange('2027-01-01', '2026-12-01', '2026-12-31')).toBe(false)
  })

  test('calendar math is UTC based (no timezone drift)', () => {
    expect(isValidIso('2026-02-29')).toBe(false)
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(weekday('2026-11-21')).toBe(6) // sábado
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDaysIso('2026-11-01', 7)).toBe('2026-11-08')
    expect(addMonthsIso('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsIso('2026-12-15', 1)).toBe('2027-01-15')
    expect(addMonthsIso('2026-01-15', -1)).toBe('2025-12-15')
    const grid = monthGrid('2026-11-15')
    expect(grid).toHaveLength(6)
    expect(grid.every((w) => w.length === 7)).toBe(true)
    expect(grid[0]?.[0]).toBe('2026-11-01') // 1º de novembro de 2026 é domingo
    expect(grid.flat().filter((d) => d.startsWith('2026-11'))).toHaveLength(30)
    expect(monthGrid('2026-03-10')[0]?.[0]).toBe('2026-03-01') // domingo
  })

  test('time and date-time helpers', () => {
    expect(maskTime('0930')).toBe('09:30')
    expect(maskTime('9')).toBe('9')
    expect(isValidTime('23:59')).toBe(true)
    expect(isValidTime('24:00')).toBe(false)
    expect(isValidTime('12:60')).toBe(false)
    expect(joinDateTime('2026-11-21', '09:30')).toBe('2026-11-21T09:30')
    expect(joinDateTime('2026-11-21', '9:3')).toBe('')
    expect(joinDateTime('', '09:30')).toBe('')
    expect(splitDateTime('2026-11-21T09:30')).toEqual({ date: '2026-11-21', time: '09:30' })
    expect(splitDateTime('')).toEqual({ date: '', time: '' })
  })
})
