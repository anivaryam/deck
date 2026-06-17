import { Activity, Cpu, LogOut, Plug, ShieldCheck, Wrench } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { MCP_SERVERS, TOOLS } from "@/lib/static-data";
import { cn } from "@/lib/utils";
import type { Effort, EffortLevel, Model } from "@/lib/types";

type Props = {
  models: Model[];
  activeModelId?: string;
  efforts: Effort[];
  /** Pending effort for the next new chat. */
  effort: EffortLevel;
  /** The active session's locked effort, if a session is open. */
  sessionEffort?: EffortLevel;
  onEffortChange: (e: EffortLevel) => void;
  /** Disabled built-in tool names for the active session. */
  disabledTools: string[];
  /** True when a session is open (toggles are live). False greys them out. */
  toolsEditable: boolean;
  onToolsChange: (next: string[]) => void;
  onLogout: () => void;
};

// Each permission switch is a friendly alias over one or more built-in tools.
const PERMISSIONS: { label: string; tools: string[] }[] = [
  { label: "auto-read files", tools: ["Read"] },
  { label: "auto-edit files", tools: ["Write", "Edit"] },
  { label: "run bash commands", tools: ["Bash"] },
  { label: "network access", tools: ["WebFetch", "WebSearch"] },
];

export function SettingsPanel({
  models,
  activeModelId,
  efforts,
  effort,
  sessionEffort,
  onEffortChange,
  disabledTools,
  toolsEditable,
  onToolsChange,
  onLogout,
}: Props) {
  const activeId = activeModelId ?? models[0]?.id;
  const enabled = (names: string[]) => names.every((n) => !disabledTools.includes(n));
  const toggle = (names: string[], on: boolean) => onToolsChange(nextDisabled(disabledTools, names, on));
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
            <SectionLabel>reasoning effort</SectionLabel>
            {efforts.map((e) => {
              const active = e.id === effort;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onEffortChange(e.id)}
                  className={cn(
                    "grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded border px-2.5 py-2 text-left text-xs transition-colors",
                    active
                      ? "border-primary/40 bg-primary/5"
                      : "border-border bg-card hover:border-border/80",
                  )}
                >
                  <span className={cn("size-1.5 rounded-full", active ? "bg-primary" : "bg-muted-foreground/30")} />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{e.name}</div>
                    <div className="truncate text-[10px] text-muted-foreground">{e.blurb}</div>
                  </div>
                </button>
              );
            })}
            <p className="px-1 text-[10px] text-muted-foreground">
              {sessionEffort
                ? `this chat is locked to "${sessionEffort}" · selection applies to new chats`
                : `applies when you start a new chat`}
            </p>

            <Separator />
            <SectionLabel>parameters</SectionLabel>
            <Row label="temperature" value="0.7" />
            <Row label="max tokens" value="4096" />
          </TabsContent>

          <TabsContent value="tools" className="mt-0 space-y-2">
            <SectionLabel>built-in tools</SectionLabel>
            {!toolsEditable && (
              <p className="px-1 text-[10px] text-muted-foreground">open a chat to configure its tools</p>
            )}
            {TOOLS.map((t) => (
              <div
                key={t.name}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded border border-border bg-card px-2.5 py-1.5 text-xs"
              >
                <span className="truncate">{t.name}</span>
                <Switch
                  checked={enabled([t.name])}
                  disabled={!toolsEditable}
                  onCheckedChange={(on) => toggle([t.name], on)}
                  className="scale-75"
                />
              </div>
            ))}
            <p className="px-1 text-[10px] text-muted-foreground">
              off = passed to the SDK as <code>disallowedTools</code> · applies on the next turn
            </p>
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
            {!toolsEditable && (
              <p className="px-1 text-[10px] text-muted-foreground">open a chat to configure permissions</p>
            )}
            {PERMISSIONS.map((p) => (
              <div
                key={p.label}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded border border-border bg-card px-2.5 py-1.5 text-xs"
              >
                <span className="truncate">{p.label}</span>
                <Switch
                  checked={enabled(p.tools)}
                  disabled={!toolsEditable}
                  onCheckedChange={(on) => toggle(p.tools, on)}
                  className="scale-75"
                />
              </div>
            ))}
            <p className="px-1 text-[10px] text-muted-foreground">
              gates the matching built-in tools ({PERMISSIONS.map((p) => p.tools.join("/")).join(", ")})
            </p>
          </TabsContent>
        </div>
      </Tabs>

      <div className="border-t border-border px-3 py-2.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={onLogout}
          className="h-8 w-full justify-start gap-2 px-2 text-xs text-muted-foreground hover:text-destructive"
        >
          <LogOut className="size-3.5" />
          log out
        </Button>
      </div>
    </aside>
  );
}

/** Add/remove tool names from the disabled set. enabled=true removes (enables the tool). */
function nextDisabled(disabled: string[], names: string[], enabled: boolean): string[] {
  const set = new Set(disabled);
  for (const n of names) {
    if (enabled) set.delete(n);
    else set.add(n);
  }
  return [...set];
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
