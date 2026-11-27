/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import {
  arbitrum,
  arc,
  avalanche,
  base,
  mainnet,
  optimism,
  polygon,
} from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Somente redes Mainnet suportadas pelo Circle Gateway (leitura de saldo/recibo e ENS).
const treasuryChains = [arc, mainnet, base, arbitrum, optimism, avalanche, polygon] as const

// Pre-register chain RPC URLs so trace events show correct chain names immediately
for (const chain of treasuryChains) {
  registerChain(chain.id, chain.rpcUrls.default.http[0])
}

export const config = createConfig({
  chains: [...treasuryChains],
  connectors: [injected()],
  transports: {
    [arc.id]: http(),
    [mainnet.id]: http(), // ENS resolution uses mainnet
    [base.id]: http(),
    [arbitrum.id]: http(),
    [optimism.id]: http(),
    [avalanche.id]: http(),
    [polygon.id]: http(),
  },
})
