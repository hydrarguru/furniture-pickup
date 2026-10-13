import type { AdminRequestDetail, StatusChange } from "@hamtning/shared";
import {
  QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ApiError } from "../lib/api.js";
import { adminApi, type ListFilter } from "./api.js";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Don't retry auth or validation failures; do retry flaky network once.
        retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 1,
        staleTime: 10_000,
      },
    },
  });
}

export const keys = {
  me: ["me"] as const,
  summary: ["summary"] as const,
  requests: ["requests"] as const,
  list: (status: ListFilter, q: string) => ["requests", "list", status, q] as const,
  detail: (id: string) => ["requests", "detail", id] as const,
  categories: ["categories"] as const,
};

export const useMe = () =>
  useQuery({ queryKey: keys.me, queryFn: adminApi.me, staleTime: Infinity });

export const useSummary = (pollWhileStreamDown: boolean) =>
  useQuery({
    queryKey: keys.summary,
    queryFn: adminApi.summary,
    // The SSE stream keeps this fresh; poll only as a fallback when it isn't connected.
    refetchInterval: pollWhileStreamDown ? 30_000 : false,
  });

export const useRequestList = (status: ListFilter, q: string) =>
  useInfiniteQuery({
    queryKey: keys.list(status, q),
    queryFn: ({ pageParam }) => adminApi.listRequests({ status, q, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

export const useRequestDetail = (id: string) =>
  useQuery({ queryKey: keys.detail(id), queryFn: () => adminApi.getRequest(id) });

/** Mutations on one request: put the fresh detail in the cache and refresh lists and counts. */
function useRequestMutation<V>(id: string, fn: (vars: V) => Promise<AdminRequestDetail>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (detail) => {
      qc.setQueryData(keys.detail(id), detail);
      void qc.invalidateQueries({ queryKey: [...keys.requests, "list"] });
      void qc.invalidateQueries({ queryKey: keys.summary });
    },
  });
}

export const useChangeStatus = (id: string) =>
  useRequestMutation(id, (change: StatusChange) => adminApi.changeStatus(id, change));

export const useAddNote = (id: string) =>
  useRequestMutation(id, (note: string) => adminApi.addNote(id, note));

export const useCategories = () =>
  useQuery({
    queryKey: keys.categories,
    queryFn: () => adminApi.categories().then((r) => r.categories),
  });
