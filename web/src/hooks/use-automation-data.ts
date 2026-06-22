import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ---- queries ----
export function useTickets() {
  return useQuery({ queryKey: ["tickets"], queryFn: () => api.tickets() });
}

export function useTasks() {
  return useQuery({ queryKey: ["tasks"], queryFn: () => api.tasks() });
}

export function useRuns(sourceKind: "cron" | "ticket" | "goal" | "goal_verify", sourceId: string | null) {
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
    mutationFn: (args: { id: string; patch: { status?: string; pr_url?: string; title?: string; body?: string } }) =>
      api.updateTicket(args.id, args.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });
}

export function useRunTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.runTicket(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["tickets"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["runs", "ticket", id] });
    },
  });
}

export function useDeleteTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteTicket(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
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
    mutationFn: (args: { id: string; patch: { enabled?: boolean; schedule?: string; prompt?: string } }) =>
      api.updateCron(args.id, args.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cron"] }),
  });
}

export function useRunCron() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.runCron(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["cron"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["runs", "cron", id] });
    },
  });
}

export function useDeleteCron() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteCron(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cron"] }),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteTask(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
}

export function useCancelTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelTask(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
}

export function useKnowledge() {
  return useQuery({ queryKey: ["knowledge"], queryFn: () => api.knowledge() });
}

export function useGoals() {
  return useQuery({
    queryKey: ["goals"],
    queryFn: () => api.goals(),
    refetchInterval: (q) => (q.state.data?.some((g) => g.status === "building" || g.status === "verifying") ? 3000 : false),
  });
}

export function useGoal(id: string | null) {
  return useQuery({
    queryKey: ["goals", id],
    queryFn: () => (id ? api.goal(id) : Promise.resolve(null)),
    enabled: !!id,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "building" || s === "verifying" ? 3000 : false;
    },
  });
}

export function useCreateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { project: string; title: string; expected_output: string; acceptance?: string; max_iterations?: number; qa_dimensions?: string[] }) => api.createGoal(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}

export function useRunGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.runGoal(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}

export function useCancelGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelGoal(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}

export function useDeleteGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteGoal(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}
