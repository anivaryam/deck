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

/** Immediate subdirectories of root whose realpath stays under root. */
export function listProjects(root: string): Project[] {
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
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Project names are slugs: a leading alnum then alnum/_/- , max 64 chars.
 *  Excludes path separators, '.', '..', leading dots — so it can't escape the root. */
const PROJECT_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Create a new project directory directly under root. Rejects bad slugs and dups. */
export function createProject(root: string, name: string): Project {
  if (typeof name !== 'string' || !PROJECT_NAME_RE.test(name)) {
    throw new Error('invalid project name (use a-z, 0-9, -, _; max 64 chars)');
  }
  const realRoot = fs.realpathSync(root);
  const joined = path.resolve(root, name);
  // Defense-in-depth even though the slug regex already forbids traversal.
  const lexRel = path.relative(realRoot, joined);
  if (lexRel === '' || lexRel.startsWith('..') || path.isAbsolute(lexRel)) {
    throw new Error(`project path is outside the root: ${name}`);
  }
  if (fs.existsSync(joined)) throw new Error(`project already exists: ${name}`);
  fs.mkdirSync(joined);
  return { name, path: joined };
}

/** Resolve a requested project name to an absolute path, enforcing the jail. */
export function resolveProjectPath(root: string, name: string): string {
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
