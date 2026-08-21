import { hashCanonical } from "@vitnera/core";
import type { PublicClient } from "viem";
import { vitneraAbi } from "./contract";
import { appConfig, requireContract } from "./config";
import { fetchJson } from "./storage";
import { publicRoomMetadataSchema, type ChainRequest, type ChainRoom, type PublicRoomMetadata } from "./types";

type RoomResult = Omit<ChainRoom, "id" | "metadata" | "metadataVerified">;
type RequestResult = Omit<ChainRequest, "id">;
const requestReadBatchSize = 25;

export async function loadRooms(client: PublicClient): Promise<ChainRoom[]> {
  const contract = requireContract();
  const count = await client.readContract({ address: contract, abi: vitneraAbi, functionName: "roomCount" });
  const ids = Array.from({ length: Number(count) }, (_, index) => BigInt(index + 1));
  return Promise.all(
    ids.map(async (id) => {
      const result = (await client.readContract({
        address: contract,
        abi: vitneraAbi,
        functionName: "getRoom",
        args: [id],
      })) as RoomResult;
      let metadata: PublicRoomMetadata | undefined;
      let metadataVerified = false;
      try {
        metadata = publicRoomMetadataSchema.parse(await fetchJson(result.metadataUri));
        metadataVerified = (await hashCanonical(metadata)).toLowerCase() === result.metadataHash.toLowerCase();
      } catch {
        metadata = undefined;
      }
      return { id, ...result, status: Number(result.status), metadata, metadataVerified };
    }),
  );
}

export async function loadRequest(client: PublicClient, id: bigint): Promise<ChainRequest> {
  const result = (await client.readContract({
    address: requireContract(),
    abi: vitneraAbi,
    functionName: "getAccessRequest",
    args: [id],
  })) as RequestResult;
  return { id, ...result, status: Number(result.status) };
}

async function loadAllRequests(client: PublicClient): Promise<ChainRequest[]> {
  const count = await client.readContract({
    address: requireContract(),
    abi: vitneraAbi,
    functionName: "requestCount",
  });
  const requests: ChainRequest[] = [];

  for (let start = 1; start <= Number(count); start += requestReadBatchSize) {
    const end = Math.min(Number(count), start + requestReadBatchSize - 1);
    const ids = Array.from({ length: end - start + 1 }, (_, index) => BigInt(start + index));
    requests.push(...await Promise.all(ids.map((id) => loadRequest(client, id))));
  }

  return requests;
}

function newestRequestFirst(a: ChainRequest, b: ChainRequest): number {
  return a.id === b.id ? 0 : a.id > b.id ? -1 : 1;
}

async function loadInvestorRequestsFromState(client: PublicClient, investor: `0x${string}`): Promise<ChainRequest[]> {
  const normalizedInvestor = investor.toLowerCase();
  return (await loadAllRequests(client))
    .filter((request) => request.investor.toLowerCase() === normalizedInvestor)
    .sort(newestRequestFirst);
}

async function loadRoomRequestsFromState(client: PublicClient, roomId: bigint): Promise<ChainRequest[]> {
  return (await loadAllRequests(client))
    .filter((request) => request.roomId === roomId)
    .sort(newestRequestFirst);
}

export async function loadInvestorRequests(client: PublicClient, investor: `0x${string}`): Promise<ChainRequest[]> {
  if (appConfig.eventLogsSupported) {
    try {
      const logs = await client.getContractEvents({
        address: requireContract(),
        abi: vitneraAbi,
        eventName: "AccessRequested",
        args: { investor },
        fromBlock: appConfig.deploymentBlock,
        toBlock: "latest",
      });
      return (await Promise.all(logs.map((log) => loadRequest(client, log.args.requestId!))))
        .sort(newestRequestFirst);
    } catch {
      // Some BOT Chain RPC endpoints intentionally disable eth_getLogs.
    }
  }

  return loadInvestorRequestsFromState(client, investor);
}

export async function loadRoomRequests(client: PublicClient, roomId: bigint): Promise<ChainRequest[]> {
  if (appConfig.eventLogsSupported) {
    try {
      const logs = await client.getContractEvents({
        address: requireContract(),
        abi: vitneraAbi,
        eventName: "AccessRequested",
        args: { roomId },
        fromBlock: appConfig.deploymentBlock,
        toBlock: "latest",
      });
      return (await Promise.all(logs.map((log) => loadRequest(client, log.args.requestId!))))
        .sort(newestRequestFirst);
    } catch {
      // Fall back to enumerable contract state when event history is unavailable.
    }
  }

  return loadRoomRequestsFromState(client, roomId);
}
