"use client";

import { http, createConfig, injected } from "wagmi";
import { targetChain } from "./chains";

// Shared config singleton: used by the React providers (lib/providers.tsx)
// and by the imperative @wagmi/core calls in lib/tasks.ts.
//
// Connectors: injected (browser wallet, e.g. MetaMask / any window.ethereum
// wallet on BOT Chain). Deliberately avoids RainbowKit's bundled
// coinbase/base connectors which pull a broken @coinbase/cdp-sdk dep chain.
export const config = createConfig({
  chains: [targetChain],
  connectors: [injected()],
  transports: {
    [targetChain.id]: http(targetChain.rpcUrls.default.http[0]),
  },
  ssr: true,
});