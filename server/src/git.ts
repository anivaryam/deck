import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** True if `dir` is inside a git work tree. */
export function isGitRepo(dir: string): boolean {
  try {
    execFileSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** True if the repo has at least one commit (a valid HEAD). A worktree cannot be
 *  created from an empty repo. */
export function hasCommits(dir: string): boolean {
  try {
    execFileSync('git', ['-C', dir, 'rev-parse', '--verify', 'HEAD'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Create a worktree at `worktreePath` on a new branch `branch`, off the repo's HEAD.
 *  Ensures the parent (worktrees base) directory exists, and surfaces git's real
 *  stderr on failure instead of a bare "Command failed". */
export function addWorktree(repo: string, worktreePath: string, branch: string): void {
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  try {
    execFileSync('git', ['-C', repo, 'worktree', 'add', '-b', branch, worktreePath, 'HEAD'], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } catch (e: unknown) {
    const stderr = (e as { stderr?: Buffer })?.stderr?.toString().trim();
    throw new Error(stderr || (e instanceof Error ? e.message : String(e)));
  }
}

/** Remove a worktree dir (keeps the branch). Force-removes even if dirty. */
export function removeWorktree(repo: string, worktreePath: string): void {
  execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', worktreePath], { stdio: 'ignore' });
}

/** Delete a branch (force). No-op if it doesn't exist. */
export function removeBranch(repo: string, branch: string): void {
  try { execFileSync('git', ['-C', repo, 'branch', '-D', branch], { stdio: 'ignore' }); } catch { /* absent */ }
}

/** Best-effort prune of a leftover worktree + branch + dir for a re-run. */
export function resetWorktree(repo: string, worktreePath: string, branch: string): void {
  try { removeWorktree(repo, worktreePath); } catch { /* not registered */ }
  removeBranch(repo, branch);
  try { fs.rmSync(worktreePath, { recursive: true, force: true }); } catch { /* gone */ }
  try { execFileSync('git', ['-C', repo, 'worktree', 'prune'], { stdio: 'ignore' }); } catch { /* ok */ }
}
