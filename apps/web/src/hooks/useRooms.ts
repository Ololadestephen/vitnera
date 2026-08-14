import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { loadRooms } from "../lib/chain";

export function useRooms() {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["rwa-rooms", client?.chain.id],
    queryFn: () => loadRooms(client!),
    enabled: Boolean(client),
  });
}
