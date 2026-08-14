import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Fingerprint } from "lucide-react";
import { usePublicClient } from "wagmi";
import { Busy } from "../components/Status";
import { vitneraAbi } from "../lib/contract";
import { appConfig, explorerTx, requireContract } from "../lib/config";

const eventNames = ["DataRoomCreated", "AIReviewRecorded", "VerifierAttestationRecorded", "DataRoomActivated", "AccessRequested", "AccessApproved", "AccessRejected", "RequestRefunded", "EarningsWithdrawn"] as const;

export function EvidencePage() {
  const client = usePublicClient();
  const evidence = useQuery({
    queryKey: ["rwa-evidence", client?.chain.id], enabled: Boolean(client),
    queryFn: async () => {
      const batches = await Promise.all(eventNames.map((eventName) => client!.getContractEvents({ address: requireContract(), abi: vitneraAbi, eventName, fromBlock: appConfig.deploymentBlock, toBlock: "latest" })));
      return batches.flat().sort((a, b) => Number((b.blockNumber ?? 0n) - (a.blockNumber ?? 0n)));
    },
  });

  return <div className="page page-enter">
    <div className="page-heading"><p className="eyebrow">Public verification</p><h1>Evidence ledger</h1><p>Contract events are read directly from BOT Chain. No private files or room keys appear here.</p></div>
    <section className="panel evidence-list">
      {evidence.isLoading && <Busy label="Reading contract events" />}
      {evidence.data?.map((event, index) => <a key={`${event.transactionHash}-${index}`} href={explorerTx(event.transactionHash)} target="_blank" rel="noreferrer" className="evidence-row"><Fingerprint /><div><strong>{event.eventName}</strong><span>Block {event.blockNumber?.toString()} · {event.transactionHash.slice(0, 12)}...{event.transactionHash.slice(-8)}</span></div><ExternalLink /></a>)}
      {!evidence.isLoading && evidence.data?.length === 0 && <div className="empty-state">No contract evidence yet.</div>}
    </section>
  </div>;
}
