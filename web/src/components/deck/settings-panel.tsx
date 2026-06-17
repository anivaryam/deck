import { Activity, Cpu, Plug, ShieldCheck, Wrench } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { MCP_SERVERS, TOOLS } from "@/lib/static-data";
import { cn } from "@/lib/utils";
import type { Model } from "@/lib/types";

type Props = {
  models: Model[];
  activeModelId?: string;
};

export function SettingsPanel({ models, activeModelId }: Props) {
  const activeId = activeModelId ?? models[0]?.id;
  return (
    <aside className="flex h-full w-full flex-col border-l border-border bg-sidebar">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 border-b border-border px-3 py-3">
        <Cpu className="size-4 shrink-0 text-primary" />
        <span className="truncate text-sm font-semibold">session</span>
      </div>

      <Tabs defaultValue="model" className="flex flex-1 flex-col">
        <TabsList className="m-2 grid h-8 grid-cols-4 bg-card">
          <TabsTrigger value="model" className="text-[11px]">
            <Cpu className="size-3.5" />
          </TabsTrigger>
          <TabsTrigger value="tools" className="text-[11px]">
            <Wrench className="size-3.5" />
          </TabsTrigger>
          <TabsTrigger value="mcp" className="text-[11px]">
            <Plug className="size-3.5" />
          </TabsTrigger>
          <TabsTrigger value="perm" className="text-[11px]">
            <ShieldCheck className="size-3.5" />
          </TabsTrigger>
        </TabsList>

        <div className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-4">
          <TabsContent value="model" className="mt-0 space-y-3">
            <SectionLabel>model</SectionLabel>
            {models.map((m) => {
              const active = m.id === activeId;
              return (
                <div
                  key={m.id}
                  className={cn(
                    "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded border px-2.5 py-2 text-xs",
                    active
                      ? "border-primary/40 bg-primary/5"
                      : "border-border bg-card hover:border-border/80",
                  )}
                >
                  <span className={cn("size-1.5 rounded-full", active ? "bg-primary" : "bg-muted-foreground/30")} />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{m.name}</div>
                    <div className="truncate text-[10px] text-muted-foreground">{m.blurb}</div>
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{m.context}</span>
                </div>
              );
            })}

            <Separator />
            <SectionLabel>parameters</SectionLabel>
            <Row label="temperature" value="0.7" />
            <Row label="max tokens" value="4096" />
            <Row label="thinking" value="extended" />
          </TabsContent>

          <TabsContent value="tools" className="mt-0 space-y-2">
            <SectionLabel>built-in tools</SectionLabel>
            {TOOLS.map((t) => (
              <div
                key={t.name}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded border border-border bg-card px-2.5 py-1.5 text-xs"
              >
                <span className="truncate">{t.name}</span>
                <Switch defaultChecked={t.enabled} className="scale-75" />
              </div>
            ))}
          </TabsContent>

          <TabsContent value="mcp" className="mt-0 space-y-2">
            <SectionLabel>mcp servers</SectionLabel>
            {MCP_SERVERS.map((s) => (
              <div
                key={s.name}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded border border-border bg-card px-2.5 py-2 text-xs"
              >
                <Activity
                  className={cn(
                    "size-3",
                    s.status === "connected"
                      ? "text-primary"
                      : s.status === "idle"
                        ? "text-yellow-500/70"
                        : "text-muted-foreground/40",
                  )}
                />
                <div className="min-w-0">
                  <div className="truncate font-medium">{s.name}</div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {s.tools} tools · {s.status}
                  </div>
                </div>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="perm" className="mt-0 space-y-2">
            <SectionLabel>permissions</SectionLabel>
            {[
              ["auto-read files", true],
              ["auto-edit files", false],
              ["run bash commands", false],
              ["network access", true],
            ].map(([label, v]) => (
              <div
                key={label as string}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded border border-border bg-card px-2.5 py-1.5 text-xs"
              >
                <span className="truncate">{label as string}</span>
                <Switch defaultChecked={v as boolean} className="scale-75" />
              </div>
            ))}
          </TabsContent>
        </div>
      </Tabs>
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded border border-border bg-card px-2.5 py-1.5 text-xs">
      <span className="truncate text-muted-foreground">{label}</span>
      <span className="shrink-0 text-primary">{value}</span>
    </div>
  );
}
