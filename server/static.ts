/**
 * Serviço de arquivos estáticos (SPA) do backend Bun — FIN deploy same-origin.
 *
 * Permite que o servidor Bun sirva o frontend compilado (`dist/`) E as APIs `/api/*` na MESMA
 * origem, eliminando a necessidade de proxy/cors e mantendo os cookies de sessão funcionando.
 * Rotas de cliente (ex.: `/checkout/:token`) caem no fallback `index.html`.
 */
import { join, normalize, sep } from 'node:path'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
}

function mimeOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot < 0 ? 'application/octet-stream' : (MIME[path.slice(dot).toLowerCase()] ?? 'application/octet-stream')
}

/** Serve um arquivo estático do SPA ou o fallback index.html. Retorna null se não for um caminho estático. */
export async function serveStatic(req: Request, staticDir: string): Promise<Response | null> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return null
  const url = new URL(req.url)
  const pathname = decodeURIComponent(url.pathname)
  // Rotas de API são tratadas pelo handler; aqui só servimos o SPA.
  if (pathname.startsWith('/api/')) return null

  const base = normalize(staticDir)
  const rel = pathname.replace(/^\/+/, '')
  const candidate = normalize(join(base, rel || 'index.html'))
  // Defesa contra path traversal (usa o separador nativo, `/` no Unix e `\\` no Windows).
  if (candidate !== base && !candidate.startsWith(base + sep)) return null

  const file = Bun.file(candidate)
  if (await file.exists()) {
    return new Response(file, { headers: { 'content-type': mimeOf(candidate) } })
  }

  // Fallback SPA: rotas de cliente (ex.: /checkout/:token, /checkout) servem index.html.
  const index = Bun.file(join(base, 'index.html'))
  if (await index.exists()) {
    return new Response(index, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  }
  return null
}
