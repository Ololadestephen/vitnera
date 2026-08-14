import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { botchain } from "../lib/config";

export function WalletButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  if (!isConnected) {
    return (
      <button className="wallet-button" disabled={isPending || connectors.length === 0} onClick={() => connect({ connector: connectors[0] })}>
        {isPending ? "Connecting" : "Connect wallet"}
      </button>
    );
  }
  if (chainId !== botchain.id) {
    return <button className="wallet-button warning" onClick={() => switchChain({ chainId: botchain.id })}>Switch to BOT Chain</button>;
  }
  return (
    <button className="wallet-button connected" title="Disconnect wallet" onClick={() => disconnect()}>
      {address?.slice(0, 6)}...{address?.slice(-4)}
    </button>
  );
}
