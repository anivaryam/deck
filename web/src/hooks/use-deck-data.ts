import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useProjects() {
  return useQuery({ queryKey: ["projects"], queryFn: () => api.projects(), staleTime: 60_000 });
}

export function useSessions() {
  return useQuery({ queryKey: ["sessions"], queryFn: () => api.sessions() });
}
