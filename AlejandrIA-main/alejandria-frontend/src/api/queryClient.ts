import { QueryClient } from "@tanstack/react-query";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
      mutations: {
        // Circulation mutations have no idempotency keys. Never retry them.
        retry: 0,
      },
    },
  });
}

export const queryClient = createQueryClient();
