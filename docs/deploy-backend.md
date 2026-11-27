# Deploy do backend (Bun + SQLite) — Global Business OS

O frontend chama as APIs em **same-origin** (`/api/*`). Para isso funcionar em produção, o
backend Bun deve servir **o frontend compilado + as APIs na mesma origem** — ou o frontend
(SPA) deve reescrever `/api/*` para o backend.

## Solução recomendada: um único serviço (backend serve `dist/` + `/api/*`)

O servidor Bun (`server/`) já serve o frontend compilado (`dist/`) e as APIs na mesma origem
(ver `server/static.ts` + `server/index.ts`, variável `GBOS_STATIC_DIR`). Deploy em qualquer
host que rode Bun/Docker:

- Railway
- Render
- Fly.io
- VPS (Docker ou Bun)

### Passo a passo (Railway/Render/Fly.io via Docker)

1. **Build do frontend** já está embutido no `Dockerfile` (multi-stage).
2. Configure as variáveis de ambiente (veja abaixo).
3. Aponte o domínio para o serviço.
4. O backend inicia na porta `8787` e serve o SPA + APIs.

### Passo a passo (VPS, sem Docker)

```bash
# 1. build do frontend
bun install
bun run build        # gera dist/

# 2. configurar variáveis de ambiente (arquivo .env)
export GBOS_API_TOKEN='seu-segredo-forte'
export GBOS_DB_PATH='/data/gbos.sqlite'
export GBOS_LOGIN_SECRET='segredo-de-login'
export GBOS_COOKIE_SECURE=1
export GBOS_ALLOWED_ORIGIN='https://seu-dominio.com'
export GBOS_DEPOSITOR_MAINNET='0x000000000000000000000000000000000000000a' # opcional

# 3. iniciar
bun run server
```

## Variáveis de ambiente (somente no host do backend, NUNCA no frontend)

| Variável | Obrigatória | Descrição / exemplo |
|---|---|---|
| `GBOS_API_TOKEN` | ✅ | Segredo de autenticação do dono (Bearer). Ex.: `um-segredo-long-aleatorio` |
| `GBOS_DB_PATH` | ✅ (produção) | Caminho do SQLite. Ex.: `/data/gbos.sqlite` |
| `GBOS_LOGIN_SECRET` | recomendado | Segredo para login via cookie no navegador. |
| `GBOS_ALLOWED_ORIGIN` | opcional | Origem do frontend (CORS). Ex.: `https://business-gray-three.vercel.app` |
| `GBOS_COOKIE_SECURE` | opcional | `1` em HTTPS (cookie `Secure`). |
| `GBOS_ORG_ID` | opcional | Default `local`. |
| `GBOS_DEPOSITOR_MAINNET` | opcional | Endereço depositante institucional Arc Mainnet. |
| `GBOS_STATIC_DIR` | opcional | Diretório do frontend compilado. Default: `dist/`. |
| `PORT` | opcional | Default `8787`. |
| `GBOS_ALLOW_MEMORY` | opcional | `1` para banco em memória (só dev/testes). |
| `GBOS_AI_PROVIDER` / `GBOS_AI_API_KEY` / `GBOS_AI_MODEL` / `GBOS_AI_BASE_URL` | opcional | IA do chat. |

## Alternativa: manter o frontend na Vercel e fazer proxy de `/api/*`

O `vercel.json` do SPA não consegue reescrever `/api/*` para um host externo diretamente
(rewrites do Vercel só apontam para arquivos estáticos ou funções do próprio projeto). Para
manter o frontend na Vercel, você precisa de **uma Serverless Function do Vercel que faça
proxy reverso** para o backend Bun. Exemplo:

```jsonc
// vercel.json
{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/proxy" },
    { "source": "/((?!assets/).*)", "destination": "/index.html" }
  ]
}
```

```ts
// api/proxy.ts (Serverless Function da Vercel)
export default async function handler(req: Request) {
  const backend = process.env.GBOS_BACKEND_URL // ex.: https://seu-backend.up.railway.app
  const url = new URL(req.url)
  const target = `${backend}${url.pathname}${url.search}`
  const headers = new Headers(req.headers)
  headers.set('host', new URL(backend).host)
  return fetch(target, { method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body, redirect: 'manual' })
}
```

> ⚠️ Nesse modo, o cookie de sessão precisa de `SameSite=None; Secure` e o CORS configurado
> (`GBOS_ALLOWED_ORIGIN`), porque frontend e backend ficam em origens distintas. A solução
> recomendada (um único serviço) evita essa complexidade.

### Cloudflare Pages (alternativa de proxy estático)

`public/_redirects`:

```text
/api/*  https://seu-backend.up.railway.app/api/:splat  200
/*      /index.html                                   200
```

## Testes

### Local

```bash
# terminal 1 — backend
GBOS_ALLOW_MEMORY=1 GBOS_API_TOKEN=dev-token bun run server

# terminal 2 — frontend (usa o proxy do Vite /api → localhost:8787)
bun run dev
```

1. Abra `http://localhost:5173`.
2. Vá em **Treasury → Cobrar em USDC**.
3. Selecione a conta a receber, informe o valor e clique **Criar cobrança**.
4. Esperado: o link público é gerado (o erro "Backend de pagamentos não está acessível" **não** aparece).

### Produção (um único serviço)

1. Deploy do backend (Docker) com `GBOS_DB_PATH` e `GBOS_API_TOKEN`.
2. Abra o domínio do serviço.
3. Repita os passos do modal **Cobrar em USDC**.
4. Confirme no `Network` do navegador que `POST /api/obligations/sync` e `POST /api/payment-intents`
   retornam `200` (JSON), não HTML/404.

## Rollback

- **Código:** `git revert` dos commits desta alteração (serviço estático + Dockerfile + docs).
- **Deploy:** manter a instância anterior do backend até validar a nova. O SPA na Vercel continua
  funcionando (apenas sem as APIs) caso o backend caia.
- **Dados:** o SQLite (`GBOS_DB_PATH`) não é tocado pelo deploy — o arquivo é montado em volume
  persistente; nada é apagado.
