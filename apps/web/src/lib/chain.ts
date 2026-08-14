import { hashCanonical } from "@vitnera/core";
import type { PublicClient } from "viem";
import { vitneraAbi } from "./contract";
import { appConfig, requireContract } from "./config";
import { fetchJson } from "./storage";
import { publicRoomMetadataSchema, type ChainRequest, type ChainRoom, type PublicRoomMetadata } from "./types";

type RoomResult = Omit<ChainRoom, "id" | "metadata" | "metadataVerified">;
type RequestResult = Omit<ChainRequest, "id">;

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

export async function loadInvestorRequests(client: PublicClient, investor: `0x${string}`): Promise<ChainRequest[]> {
  const logs = await client.getContractEvents({
    address: requireContract(),
    abi: vitneraAbi,
    eventName: "AccessRequested",
    args: { investor },
    fromBlock: appConfig.deploymentBlock,
    toBlock: "latest",
  });
  return Promise.all(logs.map((log) => loadRequest(client, log.args.requestId!)));
}

export async function loadRoomRequests(client: PublicClient, roomId: bigint): Promise<ChainRequest[]> {
  const logs = await client.getContractEvents({
    address: requireContract(),
    abi: vitneraAbi,
    eventName: "AccessRequested",
    args: { roomId },
    fromBlock: appConfig.deploymentBlock,
    toBlock: "latest",
  });
  return Promise.all(logs.map((log) => loadRequest(client, log.args.requestId!)));
}
