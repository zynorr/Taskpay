import { defineChain } from "viem";

// BOT Chain testnet (chain 968). RPC: https://rpc.bohr.life
// Explorer: https://scan.bohr.life
export const botChainTestnet = defineChain({
  id: 968,
  name: "BOT Chain Testnet",
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.bohr.life"] },
    public: { http: ["https://rpc.bohr.life"] },
  },
  blockExplorers: {
    default: { name: "BOT Scan", url: "https://scan.bohr.life" },
  },
  testnet: true,
});

// BOT Chain mainnet (chain 677). RPC: https://rpc.botchain.ai
// Explorer: https://scan.botchain.ai
export const botChainMainnet = defineChain({
  id: 677,
  name: "BOT Chain",
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.botchain.ai"] },
    public: { http: ["https://rpc.botchain.ai"] },
  },
  blockExplorers: {
    default: { name: "BOT Scan", url: "https://scan.botchain.ai" },
  },
  testnet: false,
});

// Chain the frontend targets by default. Flip to botChainMainnet for 677.
export const targetChain = botChainTestnet;