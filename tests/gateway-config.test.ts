import { describe, expect, test } from 'bun:test'
import { toFunctionSelector, type Address } from 'viem'
import { gatewayConfigFor, gatewayWalletForChain, encodeDepositFor, ARC_USDC, ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID } from '../src/lib/gateway-config'

describe('FIN-04.1B.2 — configuração do Circle Gateway por ambiente', () => {
  test('Mainnet resolve contratos oficiais de produção', () => {
    const cfg = gatewayConfigFor('mainnet')
    expect(cfg.chainId).toBe(ARC_MAINNET_CHAIN_ID)
    expect(cfg.gatewayWallet.toLowerCase()).toBe('0x77777777dcc4d5a8b6e418fd04d8997ef11000ee')
    expect(cfg.gatewayMinter.toLowerCase()).toBe('0x2222222d7164433c4c09b0b0d809a9b52c04c205')
    expect(cfg.usdcToken.toLowerCase()).toBe(ARC_USDC.toLowerCase())
    expect(cfg.apiBase).toContain('gateway-api.circle.com')
  })

  test('Testnet resolve contratos oficiais de teste (isolados)', () => {
    const cfg = gatewayConfigFor('testnet')
    expect(cfg.chainId).toBe(ARC_TESTNET_CHAIN_ID)
    expect(cfg.gatewayWallet.toLowerCase()).toBe('0x0077777d7eba4688bdef3e311b846f25870a19b9')
    expect(cfg.gatewayMinter.toLowerCase()).toBe('0x0022222abe238cc2c7bb1f21003f0a260052475b')
    expect(cfg.apiBase).toContain('gateway-api-testnet.circle.com')
  })

  test('os dois ambientes não compartilham contratos', () => {
    const main = gatewayConfigFor('mainnet')
    const test = gatewayConfigFor('testnet')
    expect(main.gatewayWallet.toLowerCase()).not.toBe(test.gatewayWallet.toLowerCase())
    expect(main.gatewayMinter.toLowerCase()).not.toBe(test.gatewayMinter.toLowerCase())
    expect(main.apiBase).not.toBe(test.apiBase)
  })

  test('gatewayWalletForChain rejeita chainId de outro ambiente', () => {
    expect(gatewayWalletForChain(ARC_MAINNET_CHAIN_ID, 'mainnet')).not.toBeNull()
    expect(gatewayWalletForChain(ARC_TESTNET_CHAIN_ID, 'mainnet')).toBeNull() // testnet não resolve como mainnet
    expect(gatewayWalletForChain(ARC_MAINNET_CHAIN_ID, 'testnet')).toBeNull() // mainnet não resolve como testnet
    expect(gatewayWalletForChain(1, 'mainnet')).toBeNull() // Ethereum não é Arc
  })

  test('encodeDepositFor produz calldata válido com o selector oficial', () => {
    const token = ARC_USDC as Address
    const depositor = '0x000000000000000000000000000000000000dEaD' as Address
    const data = encodeDepositFor(token, depositor, 15_000000n) // 15 USDC em 6 casas
    expect(data.startsWith('0x')).toBe(true)
    expect(data.length).toBe(2 + 8 + 64 * 3) // selector + 3 palavras de 32 bytes
    expect(data.slice(0, 10)).toBe(toFunctionSelector('depositFor(address,address,uint256)'))
  })
})
