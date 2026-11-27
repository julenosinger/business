import { useEffect, useRef } from 'react'
import { getPublicClient } from 'wagmi/actions'
import { parseAbiItem } from 'viem'
import { toast } from 'sonner'
import { config } from '@/config'
import { useStore } from '@/lib/store'
import { t } from '@/lib/i18n'
import type { GatewayChainId } from '@/lib/gateway'
import { Amount } from '@/onchain-money'
import { USDC_DECIMALS, buildTxExplorerUrl, getUsdc } from '@/onchain-facts'

const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
const CHUNK = 2000n
const MAX_CHUNKS_PER_TICK = 5

/**
 * Concilia recebimentos em USDC: procura transferências para a carteira da cobrança, a partir do bloco
 * em que ela foi criada, e baixa a conta quando encontra o valor exato. Roda enquanto o app está aberto.
 */
export function PaymentWatcher() {
  const { data, updateRequest, receiveRequest, receiveGatewayDirect } = useStore()
  const latest = useRef(data)
  const running = useRef(false)

  useEffect(() => {
    latest.current = data
  }, [data])

  const openKey = data.requests
    .filter((r) => r.status === 'open')
    .map((r) => r.id)
    .join(',')

  useEffect(() => {
    if (!openKey) return
    const ctl = new AbortController()

    const scanRequest = async (id: string) => {
      const r = latest.current.requests.find((x) => x.id === id)
      if (!r || r.status !== 'open') return
      const usdc = getUsdc(r.chainId)
      const client = getPublicClient(config, { chainId: r.chainId as GatewayChainId })
      if (!usdc || !client) return

      const head = await client.getBlockNumber()
      const from = r.scannedTo ? BigInt(r.scannedTo) + 1n : BigInt(r.fromBlock)
      if (from > head) return

      const query = (fromBlock: bigint, toBlock: bigint) =>
        client.getLogs({ address: usdc.address as `0x${string}`, event: transferEvent, args: { to: r.recipient as `0x${string}` }, fromBlock, toBlock })

      let logs: Awaited<ReturnType<typeof query>> = []
      let scannedTo = head
      try {
        logs = await query(from, head)
      } catch {
        // Algumas redes limitam o intervalo de blocos: varre em partes e continua no próximo ciclo.
        let cursor = from
        let chunks = 0
        while (cursor <= head && chunks < MAX_CHUNKS_PER_TICK) {
          const end = cursor + CHUNK - 1n > head ? head : cursor + CHUNK - 1n
          logs = logs.concat(await query(cursor, end))
          cursor = end + 1n
          chunks += 1
        }
        scannedTo = cursor - 1n
      }

      const raw = Amount.parse(r.amount, USDC_DECIMALS).raw
      const taken = new Set(latest.current.requests.filter((x) => x.txHash).map((x) => x.txHash))
      const hit = logs.find((l) => l.args.value === raw && l.transactionHash && !taken.has(l.transactionHash))
      if (hit?.transactionHash) {
        if (r.paymentRail === 'gateway_direct') {
          receiveGatewayDirect(r.id, hit.transactionHash, hit.args.from ?? '', buildTxExplorerUrl(r.chainId, hit.transactionHash))
        } else {
          receiveRequest(r.id, hit.transactionHash, hit.args.from ?? '', buildTxExplorerUrl(r.chainId, hit.transactionHash))
        }
        toast.success(t(`Pagamento recebido: ${r.description}`, `Payment received: ${r.description}`))
      } else {
        updateRequest(r.id, { scannedTo: scannedTo.toString() })
      }
    }

    const tick = async () => {
      if (running.current || ctl.signal.aborted) return
      running.current = true
      try {
        for (const r of latest.current.requests.filter((x) => x.status === 'open')) {
          if (ctl.signal.aborted) break
          try {
            await scanRequest(r.id)
          } catch {
            // Falha de rede: tenta de novo no próximo ciclo.
          }
        }
      } finally {
        running.current = false
      }
    }

    void tick()
    const timer = setInterval(() => void tick(), 20_000)
    return () => {
      ctl.abort()
      clearInterval(timer)
    }
  }, [openKey, updateRequest, receiveRequest, receiveGatewayDirect])

  return null
}
