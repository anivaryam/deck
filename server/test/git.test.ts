import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isGitRepo, hasCommits, addWorktree, removeWorktree } from '../src/git.ts';

let repo: string;
let wtBase: string;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-git-'));
  execFileSync('git', ['-C', repo, 'init', '-q']);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 't@t.t']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'T']);
  fs.writeFileSync(path.join(repo, 'README.md'), 'hi');
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
  wtBase = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-wt-'));
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(wtBase, { recursive: true, force: true });
});

describe('git worktree helpers', () => {
  it('isGitRepo is true for a repo, false for a plain dir', () => {
    expect(isGitRepo(repo)).toBe(true);
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'plain-'));
    expect(isGitRepo(plain)).toBe(false);
    fs.rmSync(plain, { recursive: true, force: true });
  });

  it('adds a worktree on a new branch, then removes it (branch persists)', () => {
    const wt = path.join(wtBase, 'g1');
    addWorktree(repo, wt, 'goal/g1');
    expect(fs.existsSync(path.join(wt, 'README.md'))).toBe(true);
    const branches = execFileSync('git', ['-C', repo, 'branch', '--list', 'goal/g1']).toString();
    expect(branches).toMatch(/goal\/g1/);
    removeWorktree(repo, wt);
    expect(fs.existsSync(wt)).toBe(false);
    expect(execFileSync('git', ['-C', repo, 'branch', '--list', 'goal/g1']).toString()).toMatch(/goal\/g1/);
  });
});

describe('git worktree helpers — robustness', () => {
  it('hasCommits is true for a repo with a commit, false for an empty repo', () => {
    expect(hasCommits(repo)).toBe(true);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-empty-'));
    execFileSync('git', ['-C', empty, 'init', '-q']);
    expect(hasCommits(empty)).toBe(false);
    fs.rmSync(empty, { recursive: true, force: true });
  });

  it('addWorktree creates a missing parent (worktrees base) directory', () => {
    const deep = path.join(wtBase, 'does', 'not', 'exist', 'g2');
    addWorktree(repo, deep, 'goal/g2');
    expect(fs.existsSync(path.join(deep, 'README.md'))).toBe(true);
    removeWorktree(repo, deep);
  });

  it('addWorktree surfaces git stderr (empty-repo HEAD) instead of a bare command', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-empty-'));
    execFileSync('git', ['-C', empty, 'init', '-q']);
    expect(() => addWorktree(empty, path.join(wtBase, 'g3'), 'goal/g3')).toThrow(/HEAD|invalid reference/i);
    fs.rmSync(empty, { recursive: true, force: true });
  });
});
