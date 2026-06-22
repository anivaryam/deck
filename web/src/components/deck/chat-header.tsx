import { ChevronDown, PanelLeft, PanelRight } from "lucide-react";
import { Breadcrumb } from "./breadcrumb";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Model } from "@/lib/types";

type Props = {
  title: string;
  project?: string;
  model: Model;
  models: Model[];
  onModelChange: (m: Model) => void;
  onToggleSidebar: () => void;
  onToggleSettings: () => void;
};

export function ChatHeader({
  title,
  project,
  model,
  models,
  onModelChange,
  onToggleSidebar,
  onToggleSettings,
}: Props) {
  return (
    <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border bg-background px-2 py-2 sm:px-3">
      {/* left: sidebar toggle + title */}
      <div className="flex items-center gap-1">
        <IconBtn label="Toggle threads" onClick={onToggleSidebar}>
          <PanelLeft className="size-4" />
        </IconBtn>
      </div>

      <Breadcrumb
        mobile="current"
        items={[
          { label: "deck", to: "/" },
          ...(project ? [{ label: project }] : []),
          { label: title },
        ]}
      />

      {/* right */}
      <div className="flex shrink-0 items-center gap-0.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-primary"
            >
              <span className="size-1.5 rounded-full bg-primary" />
              <span className="hidden md:inline">{model.name}</span>
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 font-mono">
            {models.map((m) => (
              <DropdownMenuItem
                key={m.id}
                onClick={() => onModelChange(m)}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm">{m.name}</div>
                  <div className="truncate text-[10px] text-muted-foreground">{m.blurb}</div>
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground">{m.context}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <IconBtn label="Toggle settings" onClick={onToggleSettings}>
          <PanelRight className="size-4" />
        </IconBtn>
      </div>
    </header>
  );
}

function IconBtn({
  label,
  children,
  onClick,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClick}
          className="size-8 touch-manipulation text-muted-foreground hover:text-primary"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
