import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ---- queries ----
export function useTickets() {
  return useQuery({ queryKey: ["tickets"], queryFn: () => api.tickets() });
}

export function useTasks() {
  return useQuery({ queryKey: ["tasks"], queryFn: () => api.tasks() });
}

export function useRuns(sourceKind: "cron" | "ticket", sourceId: string | null) {
  return useQuery({
    queryKey: ["runs", sourceKind, sourceId],
    queryFn: () => (sourceId ? api.runs(sourceKind, sourceId) : Promise.resolve([])),
    enabled: !!sourceId,
  });
}

export function useTask(id: string | null) {
  return useQuery({
    queryKey: ["tasks", id],
    queryFn: () => (id ? api.task(id) : Promise.resolve(null)),
    enabled: !!id,
  });
}

export function useCron() {
  return useQuery({ queryKey: ["cron"], queryFn: () => api.listCron() });
}

// ---- mutations ----
export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { project: string; title: string; body?: string }) => api.createTicket(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });
}

export function useUpdateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; patch: { status?: string; pr_url?: string } }) =>
      api.updateTicket(args.id, args.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });
}

export function useRunTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.runTicket(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { project: string; prompt: string; model?: string; effort?: string }) =>
      api.createTask(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
}

export function useCreateCron() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { schedule: string; project: string; prompt: string }) => api.createCron(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cron"] }),
  });
}

export function useUpdateCron() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; enabled: boolean }) => api.updateCron(args.id, args.enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cron"] }),
  });
}

export function useDeleteCron() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteCron(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cron"] }),
  });
}
