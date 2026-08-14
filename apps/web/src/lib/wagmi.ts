import { QueryClient } from "@tanstack/react-query";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { botchain } from "./config";

export const wagmiConfig = createConfig({
  chains: [botchain],
  connectors: [injected()],
  transports: { [botchain.id]: http() },
});

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 8_000, refetchOnWindowFocus: false, retry: 1 } },
});
