// server/src/projectScanner.ts
import fs from 'node:fs';
import path from 'node:path';

export interface Project {
  name: string;
  path: string;
}

function staysUnder(root: string, candidate: string): boolean {
  const realRoot = fs.realpathSync(root);
  const real = fs.realpathSync(candidate);
  const rel = path.relative(realRoot, real);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Normalize a single root or a list of roots to an array. */
function toRoots(root: string | string[]): string[] {
  return Array.isArray(root) ? root : [root];
}

/** Immediate subdirectories of a single root whose realpath stays under it. */
function listOne(root: string): Project[] {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const out: Project[] = [];
  for (const e of entries) {
    const full = path.join(root, e.name);
    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) {
      try {
        isDir = fs.statSync(full).isDirectory();
      } catch {
        isDir = false;
      }
    }
    if (!isDir) continue;
    try {
      if (staysUnder(root, full)) out.push({ name: e.name, path: full });
    } catch {
      // unreadable / broken link — skip
    }
  }
  return out;
}

/**
 * Immediate subdirectories across one or more roots. On a name collision the
 * earlier root wins (priority order). Result is sorted by name.
 */
export function listProjects(root: string | string[]): Project[] {
  const byName = new Map<string, Project>();
  for (const r of toRoots(root)) {
    let projects: Project[];
    try {
      projects = listOne(r);
    } catch {
      continue; // unreadable root — skip
    }
    for (const p of projects) {
      if (!byName.has(p.name)) byName.set(p.name, p);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Project names are slugs: a leading alnum then alnum/_/- , max 64 chars.
 *  Excludes path separators, '.', '..', leading dots — so it can't escape the root. */
const PROJECT_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Create a new project directory under the first (default) root. Rejects bad slugs and dups. */
export function createProject(root: string | string[], name: string): Project {
  if (typeof name !== 'string' || !PROJECT_NAME_RE.test(name)) {
    throw new Error('invalid project name (use a-z, 0-9, -, _; max 64 chars)');
  }
  const target = toRoots(root)[0];
  const realRoot = fs.realpathSync(target);
  const joined = path.resolve(target, name);
  // Defense-in-depth even though the slug regex already forbids traversal.
  const lexRel = path.relative(realRoot, joined);
  if (lexRel === '' || lexRel.startsWith('..') || path.isAbsolute(lexRel)) {
    throw new Error(`project path is outside the root: ${name}`);
  }
  if (fs.existsSync(joined)) throw new Error(`project already exists: ${name}`);
  fs.mkdirSync(joined);
  return { name, path: joined };
}

/** Resolve a requested project name against a single root, enforcing the jail. */
function resolveOne(root: string, name: string): string {
  const realRoot = fs.realpathSync(root);
  const joined = path.resolve(root, name);
  // Pre-realpath check: if the lexical path escapes root, reject immediately (catches traversal
  // even when the target doesn't exist, so we surface "outside" rather than "not found").
  const lexRel = path.relative(realRoot, joined);
  if (lexRel.startsWith('..') || path.isAbsolute(lexRel)) {
    throw new Error(`project path is outside the root: ${name}`);
  }
  if (!fs.existsSync(joined)) throw new Error(`project not found: ${name}`);
  if (!staysUnder(root, joined)) throw new Error(`project path is outside the root: ${name}`);
  return fs.realpathSync(joined) === realRoot ? joined : path.resolve(root, name);
}

/**
 * Resolve a requested project name to an absolute path across one or more roots,
 * enforcing the jail. Roots are tried in priority order; the first that resolves
 * wins. If none resolve, the last root's error is surfaced.
 */
export function resolveProjectPath(root: string | string[], name: string): string {
  const roots = toRoots(root);
  let lastErr: unknown;
  for (const r of roots) {
    try {
      return resolveOne(r, name);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`project not found: ${name}`);
}
