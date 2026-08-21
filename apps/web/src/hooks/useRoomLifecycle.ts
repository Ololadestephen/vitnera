import { useQueryClient } from "@tanstack/react-query";
import type { ChainRoom } from "../lib/types";
import { vitneraAbi } from "../lib/contract";
import { requireContract } from "../lib/config";
import type { useTransaction } from "./useTransaction";

type UseRoomLifecycleOptions = {
  tx: ReturnType<typeof useTransaction>;
  selected: ChainRoom | undefined;
  notify: (message: string) => void;
};

export function useRoomLifecycle({ tx, selected, notify }: UseRoomLifecycleOptions) {
  const queryClient = useQueryClient();

  async function pauseRoom() {
    if (!selected || selected.status !== 1) throw new Error("Only an open room can be paused");
    await tx.send(() => tx.wallet!.writeContract({ address: requireContract(), abi: vitneraAbi, functionName: "pauseDataRoom", args: [selected.id] }));
    await queryClient.invalidateQueries({ queryKey: ["rwa-rooms"] });
    notify("New access requests are paused. Existing approved access is unchanged.");
  }

  async function resumeRoom() {
    if (!selected || selected.status !== 2) throw new Error("Only a paused room can be reopened");
    await tx.send(() => tx.wallet!.writeContract({ address: requireContract(), abi: vitneraAbi, functionName: "activateDataRoom", args: [selected.id] }));
    await queryClient.invalidateQueries({ queryKey: ["rwa-rooms"] });
    notify("The room is open to access requests again.");
  }

  async function archiveRoom() {
    if (!selected || selected.status === 3) throw new Error("This room is already archived");
    if (!window.confirm("Archive this room permanently? It cannot be reopened and will stop accepting new requests.")) return;
    await tx.send(() => tx.wallet!.writeContract({ address: requireContract(), abi: vitneraAbi, functionName: "archiveDataRoom", args: [selected.id] }));
    await queryClient.invalidateQueries({ queryKey: ["rwa-rooms"] });
    notify("Room archived. Its on-chain history remains available.");
  }

  return { pauseRoom, resumeRoom, archiveRoom };
}
