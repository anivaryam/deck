// server/test/projectScanner.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listProjects, resolveProjectPath, createProject } from '../src/projectScanner.ts';

let root: string;
let outside: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-root-'));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-out-'));
  fs.mkdirSync(path.join(root, 'alpha'));
  fs.mkdirSync(path.join(root, 'beta'));
  fs.writeFileSync(path.join(root, 'a-file.txt'), 'x'); // not a dir, must be ignored
  fs.symlinkSync(outside, path.join(root, 'escape')); // escaping symlink, must be hidden
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe('listProjects', () => {
  it('lists only immediate subdirectories that stay under root', () => {
    const names = listProjects(root).map((p) => p.name).sort();
    expect(names).toEqual(['alpha', 'beta']);
  });
});

describe('resolveProjectPath', () => {
  it('resolves a valid child', () => {
    expect(resolveProjectPath(root, 'alpha')).toBe(path.join(root, 'alpha'));
  });
  it('rejects path traversal', () => {
    expect(() => resolveProjectPath(root, '../escape')).toThrow(/outside/i);
  });
  it('rejects an escaping symlink', () => {
    expect(() => resolveProjectPath(root, 'escape')).toThrow(/outside/i);
  });
  it('rejects a non-existent project', () => {
    expect(() => resolveProjectPath(root, 'ghost')).toThrow();
  });
});

describe('createProject', () => {
  it('creates a directory and returns its name/path', () => {
    const p = createProject(root, 'gamma');
    expect(p).toEqual({ name: 'gamma', path: path.join(root, 'gamma') });
    expect(fs.statSync(path.join(root, 'gamma')).isDirectory()).toBe(true);
    expect(listProjects(root).map((x) => x.name)).toContain('gamma');
  });
  it('rejects a duplicate', () => {
    expect(() => createProject(root, 'alpha')).toThrow(/already exists/i);
  });
  it.each(['../escape', 'a/b', '.', '..', '-leading', 'UPPER', 'with space'])(
    'rejects invalid slug %j',
    (name) => {
      expect(() => createProject(root, name)).toThrow();
    },
  );
  it('accepts slug chars (a-z 0-9 - _)', () => {
    expect(createProject(root, 'my_proj-2').name).toBe('my_proj-2');
  });
});
