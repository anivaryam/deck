import { execFileSync } from 'node:child_process';

/** True if `dir` is inside a git work tree. */
export function isGitRepo(dir: string): boolean {
  try {
    execFileSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Create a worktree at `worktreePath` on a new branch `branch`, off the repo's HEAD. */
export function addWorktree(repo: string, worktreePath: string, branch: string): void {
  execFileSync('git', ['-C', repo, 'worktree', 'add', '-b', branch, worktreePath, 'HEAD'], { stdio: 'ignore' });
}

/** Remove a worktree dir (keeps the branch). Force-removes even if dirty. */
export function removeWorktree(repo: string, worktreePath: string): void {
  execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', worktreePath], { stdio: 'ignore' });
}
