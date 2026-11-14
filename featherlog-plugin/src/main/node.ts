import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createSetup, type LowtempBridge } from './index';

const execFileAsync = promisify(execFile);
const LOG_FILE = /^(\d{4}-\d{2}-\d{2})\.md$/;

function logDir(repoPath: string): string {
  return join(repoPath, 'src', 'content', 'log');
}

function logFilePath(repoPath: string, date: string): string {
  return join(logDir(repoPath), `${date}.md`);
}

function formatExecError(error: unknown, args: readonly string[]): Error {
  if (error && typeof error === 'object') {
    const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr.trim() : '';
    const stdout = 'stdout' in error && typeof error.stdout === 'string' ? error.stdout.trim() : '';
    const msg = error instanceof Error ? error.message : String(error);
    const detail = stderr || stdout || msg;
    return new Error(`git ${args[0] ?? ''} 失败: ${detail}`);
  }
  return new Error(String(error));
}

async function runGit(repoPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: repoPath,
      timeout: 30_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return stdout;
  } catch (error) {
    throw formatExecError(error, args);
  }
}

export function createNodeBridge(): LowtempBridge {
  return {
    async checkRepo(repoPath) {
      if (!repoPath.trim()) return false;
      try {
        await stat(join(repoPath, '.git'));
        return true;
      } catch {
        return false;
      }
    },

    async listLogDates(repoPath) {
      try {
        const entries = await readdir(logDir(repoPath), { withFileTypes: true });
        return entries
          .filter((entry) => entry.isFile())
          .map((entry) => LOG_FILE.exec(entry.name)?.[1])
          .filter((date): date is string => Boolean(date))
          .sort();
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          return [];
        }
        throw error;
      }
    },

    async readLogFile(repoPath, date) {
      try {
        return await readFile(logFilePath(repoPath, date), 'utf8');
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          return null;
        }
        throw error;
      }
    },

    async writeLogFile(repoPath, date, content) {
      const directory = logDir(repoPath);
      await mkdir(directory, { recursive: true });
      const target = logFilePath(repoPath, date);
      const temp = join(directory, `.tmp-${process.pid}-${randomUUID()}`);
      await writeFile(temp, content, 'utf8');
      await rename(temp, target);
    },

    async pushLogs(repoPath, dates) {
      const status = await runGit(repoPath, ['status', '--porcelain', '--', 'src/content/log']);
      if (status.trim()) {
        await runGit(repoPath, ['add', '--', 'src/content/log']);
        const uniqueDates = [...new Set(dates)].sort();
        const commitMessage =
          uniqueDates.length === 1
            ? `log: ${uniqueDates[0]}`
            : uniqueDates.length > 1
              ? `log: ${uniqueDates[0]}..${uniqueDates.at(-1)}`
              : 'log: sync timeline';
        await runGit(repoPath, ['commit', '--only', '-m', commitMessage, '--', 'src/content/log']);
        await runGit(repoPath, ['push']);
        return { pushed: true, commitMessage };
      }

      let ahead = 0;
      try {
        const count = await runGit(repoPath, ['rev-list', '--count', '@{u}..HEAD']);
        ahead = Number(count.trim()) || 0;
      } catch {
        ahead = 0;
      }
      if (ahead > 0) {
        await runGit(repoPath, ['push']);
        return { pushed: true, commitMessage: 'log: push pending commits' };
      }
      return { pushed: false, commitMessage: null };
    },
  };
}

export const setup = createSetup(createNodeBridge());
