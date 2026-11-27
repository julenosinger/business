import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serveStatic } from '../server/static'

describe('backend — serviço estático (SPA same-origin)', () => {
  test('serve arquivo estático e fallback index.html', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbos-static-'))
    writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>')
    writeFileSync(join(dir, 'app.js'), 'console.log(1)')

    const index = await serveStatic(new Request('http://localhost/'), dir)
    expect(index?.status).toBe(200)
    expect((index?.headers.get('content-type') ?? '').startsWith('text/html')).toBe(true)

    const js = await serveStatic(new Request('http://localhost/app.js'), dir)
    expect((js?.headers.get('content-type') ?? '').startsWith('text/javascript')).toBe(true)

    // Fallback SPA para rota de cliente.
    const spa = await serveStatic(new Request('http://localhost/checkout/abc'), dir)
    expect(spa?.status).toBe(200)
    expect((spa?.headers.get('content-type') ?? '').startsWith('text/html')).toBe(true)

    rmSync(dir, { recursive: true, force: true })
  })

  test('não intercepta rotas /api/*', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbos-static-'))
    writeFileSync(join(dir, 'index.html'), 'x')
    expect(await serveStatic(new Request('http://localhost/api/payment-intents'), dir)).toBeNull()
    expect(await serveStatic(new Request('http://localhost/api/checkout/tok'), dir)).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  test('bloqueia path traversal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbos-static-'))
    mkdirSync(join(dir, 'sub'), { recursive: true })
    writeFileSync(join(dir, 'index.html'), 'x')
    writeFileSync(join(dir, 'sub', 'secret.txt'), 'secret')
    // Tentativa de escapar do staticDir.
    const r = await serveStatic(new Request('http://localhost/../secret.txt'), dir)
    // O path ../ normaliza para fora do staticDir → serve o fallback index.html, nunca o segredo.
    expect(r?.status).toBe(200)
    expect(await (r!.text())).not.toContain('secret')
    rmSync(dir, { recursive: true, force: true })
  })
})
