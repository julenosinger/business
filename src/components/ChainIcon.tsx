import { NetworkArbitrumOne, NetworkArc, NetworkAvalanche, NetworkBase, NetworkEthereum, NetworkOptimism, NetworkPolygon } from '@web3icons/react'

export function ChainIcon({ chainKey, size = 20 }: { chainKey: string; size?: number }) {
  if (chainKey.startsWith('Arc')) return <NetworkArc variant="branded" size={size} />
  if (chainKey.startsWith('Base')) return <NetworkBase variant="branded" size={size} />
  if (chainKey.startsWith('Ethereum')) return <NetworkEthereum variant="branded" size={size} />
  if (chainKey.startsWith('Arbitrum')) return <NetworkArbitrumOne variant="branded" size={size} />
  if (chainKey.startsWith('Optimism')) return <NetworkOptimism variant="branded" size={size} />
  if (chainKey.startsWith('Avalanche')) return <NetworkAvalanche variant="branded" size={size} />
  if (chainKey.startsWith('Polygon')) return <NetworkPolygon variant="branded" size={size} />
  return (
    <span className="inline-flex items-center justify-center rounded-full bg-surface-strong text-[10px] font-bold" style={{ width: size, height: size }}>
      {chainKey.slice(0, 2).toUpperCase()}
    </span>
  )
}
