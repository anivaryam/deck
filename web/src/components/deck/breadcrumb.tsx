import { Fragment } from "react";
import { ChevronLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";

export type Crumb = {
  label: string;
  /** Route to link to. Omit (or the last crumb) renders as plain current text. */
  to?: string;
  params?: Record<string, string>;
  search?: Record<string, unknown>;
};

type MobileMode =
  // full responsive trail (default)
  | "full"
  // mobile shows only the current page; nav lives elsewhere (e.g. chat hamburger)
  | "current"
  // mobile collapses to a "‹ parent" back link — for pages with no other nav
  | "back";

/** Shared, navigable breadcrumb trail.
 *  - Semantic <nav><ol> with aria-current on the active page.
 *  - Links are visibly interactive (underline on hover/focus) with a real tap
 *    target and a keyboard focus ring — not hover-only color shifts.
 *  - Separators render only *between* crumbs (no dangling leading slash).
 *  - `mobile` picks the small-screen behavior; full trail always shows ≥sm. */
export function Breadcrumb({ items, mobile = "full" }: { items: Crumb[]; mobile?: MobileMode }) {
  // nearest navigable ancestor (last linkable crumb before the current one)
  const parent = items.slice(0, -1).filter((c) => c.to).pop();

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      {/* Mobile */}
      <div className="sm:hidden">
        {mobile === "back" && parent ? (
          // Back to nearest parent + the current page, so you can leave AND still
          // know where you are. Parent truncates; the current label stays visible.
          <div className="flex min-w-0 items-center font-mono text-xs tracking-tight">
            <CrumbLink
              crumb={parent}
              className="-ml-1.5 flex min-w-0 items-center gap-0.5 px-1.5 py-1.5 font-medium text-muted-foreground"
            >
              <ChevronLeft className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{parent.label}</span>
            </CrumbLink>
            <span aria-hidden className="mx-1.5 shrink-0 select-none opacity-50">
              /
            </span>
            <Current label={items[items.length - 1]?.label ?? ""} />
          </div>
        ) : mobile === "full" ? (
          <Trail items={items} />
        ) : (
          <Current label={items[items.length - 1]?.label ?? ""} />
        )}
      </div>

      {/* Desktop — always the full trail */}
      <div className="hidden sm:block">
        <Trail items={items} />
      </div>
    </nav>
  );
}

function Trail({ items }: { items: Crumb[] }) {
  return (
    <ol className="flex min-w-0 items-center font-mono text-xs font-medium tracking-tight text-muted-foreground">
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <Fragment key={i}>
            {i > 0 && (
              <li aria-hidden className="mx-1.5 select-none opacity-50">
                /
              </li>
            )}
            <li className="min-w-0">
              {c.to && !last ? (
                <CrumbLink crumb={c} className="-mx-0.5 truncate px-0.5 py-1">
                  {c.label}
                </CrumbLink>
              ) : (
                <Current label={c.label} current={last} />
              )}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

function CrumbLink({
  crumb,
  className,
  children,
}: {
  crumb: Crumb;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    // ponytail: `to` is dynamic; TanStack's typed-route check can't see it
    <Link
      to={crumb.to as never}
      params={crumb.params as never}
      search={crumb.search as never}
      className={`rounded-sm underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className ?? ""}`}
    >
      {children}
    </Link>
  );
}

function Current({ label, current = true }: { label: string; current?: boolean }) {
  return (
    <span
      aria-current={current ? "page" : undefined}
      className={`truncate font-mono text-xs tracking-tight ${current ? "font-bold text-foreground" : "font-medium text-muted-foreground"}`}
    >
      {label}
    </span>
  );
}
