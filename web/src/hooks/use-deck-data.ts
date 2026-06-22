import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useProjects() {
  return useQuery({ queryKey: ["projects"], queryFn: () => api.projects(), staleTime: 60_000 });
}

export function useSessions() {
  return useQuery({ queryKey: ["sessions"], queryFn: () => api.sessions() });
}

// Server defaults for new chats. Effectively static per server process, so don't refetch.
export function useServerConfig() {
  return useQuery({ queryKey: ["config"], queryFn: () => api.config(), staleTime: Infinity });
}
