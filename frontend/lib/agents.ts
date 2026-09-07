const AGENT_NAMES: Record<string, string> = {
  "0x1ec89529a5e0c4b7d2a71fa37b826648a0eb9c1d": "DevBot",
  "0x1c534838a8b2bca2e810fa0375ce214ce89a5186": "Aria",
  "0x3014da40130d749ee3e4b5930dae5bde2b05c140": "Koda",
};

export function agentNameOf(address: string): string | null {
  return AGENT_NAMES[address.toLowerCase()] ?? null;
}

export function agentLabel(address: string): string {
  const name = agentNameOf(address);
  return name ? `${name} (${address.slice(0, 6)}...${address.slice(-4)})` : address;
}
