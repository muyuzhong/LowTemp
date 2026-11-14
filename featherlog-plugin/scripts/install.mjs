import { access, copyFile, mkdir, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');

const TARGETS = [
  join(configHome, 'Featherlog', 'plugins', 'lowtemp'),
  join(configHome, 'Featherlog-dev', 'plugins', 'lowtemp'),
];

const FILES = ['main.js', 'ui.js', 'manifest.json'];

for (const file of FILES) {
  await access(join(dist, file));
}

async function atomicInstall(targetDir) {
  await mkdir(targetDir, { recursive: true });
  for (const file of FILES) {
    const tmp = join(targetDir, `.${file}.tmp.${process.pid}`);
    await copyFile(join(dist, file), tmp);
    await rename(tmp, join(targetDir, file));
  }
}

for (const targetDir of TARGETS) {
  await atomicInstall(targetDir);
  console.log('Installed lowtemp plugin to', targetDir);
}
