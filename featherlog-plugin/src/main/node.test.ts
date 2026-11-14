import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodeBridge } from './node';

const execFileAsync = promisify(execFile);
const dirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout;
}

afterEach(async () => {
  while (dirs.length) {
    await rm(dirs.pop()!, { recursive: true, force: true });
  }
});

describe('createNodeBridge', () => {
  it('reads/writes log files atomically, commits only src/content/log, and leaves other staged files untouched', async () => {
    const bridge = createNodeBridge();
    const root = await makeTempDir('lowtemp-node-');
    const bare = join(root, 'remote.git');
    const work = join(root, 'work');

    expect(await bridge.checkRepo('')).toBe(false);
    expect(await bridge.checkRepo(work)).toBe(false);
    expect(await bridge.listLogDates(work)).toEqual([]);
    expect(await bridge.readLogFile(work, '2026-11-13')).toBeNull();

    await execFileAsync('git', ['init', '--bare', bare]);
    await execFileAsync('git', ['clone', bare, work]);
    await git(work, ['config', 'user.name', 'Test User']);
    await git(work, ['config', 'user.email', 'test@example.com']);
    await git(work, ['checkout', '-b', 'main']);

    await mkdir(join(work, 'src', 'pages'), { recursive: true });
    await writeFile(join(work, 'src', 'pages', 'other.txt'), 'initial\n', 'utf8');
    await git(work, ['add', '.']);
    await git(work, ['commit', '-m', 'init']);
    await git(work, ['push', '-u', 'origin', 'main']);

    expect(await bridge.checkRepo(work)).toBe(true);

    // Stage an unrelated modification that must NEVER be committed by pushLogs
    await writeFile(join(work, 'src', 'pages', 'other.txt'), 'unrelated staged change\n', 'utf8');
    await git(work, ['add', 'src/pages/other.txt']);

    await bridge.writeLogFile(work, '2026-11-13', '---\npublished: 2026-11-13\n---\n\n- 10:00 [工程] 落笔\n');
    expect(await bridge.listLogDates(work)).toEqual(['2026-11-13']);
    expect(await bridge.readLogFile(work, '2026-11-13')).toContain('- 10:00 [工程] 落笔');

    const res = await bridge.pushLogs(work, ['2026-11-13']);
    expect(res).toEqual({ pushed: true, commitMessage: 'log: 2026-11-13' });

    // Confirm unrelated staged edit is still uncommitted in index
    const stagedOther = await git(work, ['diff', '--cached', '--name-only']);
    expect(stagedOther.trim()).toBe('src/pages/other.txt');
    const lastCommitFiles = await git(work, ['show', '--name-only', '--pretty=format:', 'HEAD']);
    expect(lastCommitFiles.trim()).toBe('src/content/log/2026-11-13.md');

    // Clean log directory returns no-op
    const noop = await bridge.pushLogs(work, ['2026-11-13']);
    expect(noop).toEqual({ pushed: false, commitMessage: null });

    // Clean working tree with ahead local commits still pushes
    await git(work, ['commit', '--allow-empty', '-m', 'empty ahead']);
    const ahead = await bridge.pushLogs(work, []);
    expect(ahead).toEqual({ pushed: true, commitMessage: 'log: push pending commits' });

    // Pushing after removing bare remote fails loudly
    await rm(bare, { recursive: true, force: true });
    await bridge.writeLogFile(work, '2026-11-14', '---\npublished: 2026-11-14\n---\n\n- 11:00 测试\n');
    await expect(bridge.pushLogs(work, ['2026-11-13', '2026-11-14'])).rejects.toThrow(/git push/);

    // Verify file content persisted on disk
    expect(await readFile(join(work, 'src', 'content', 'log', '2026-11-14.md'), 'utf8')).toContain('11:00 测试');
  });
});
