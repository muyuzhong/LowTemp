#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const LOG_DIR = path.resolve(process.cwd(), 'src/content/log');

const pad2 = (n) => String(n).padStart(2, '0');

function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function localTimeStr(d = new Date()) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function validateDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    throw new Error(`无效日期格式 "${str}"，请使用 YYYY-MM-DD`);
  }
  return str;
}

function normalizeTime(str) {
  const m = str.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`无效时刻格式 "${str}"，请使用 HH:MM`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h === 24 && min === 0) return '24:00';
  if (h < 0 || h > 23 || min < 0 || min > 59) {
    throw new Error(`时刻超出范围 "${str}"`);
  }
  return `${pad2(h)}:${pad2(min)}`;
}

function parseArgs(argv) {
  const opts = {
    date: localDateKey(),
    at: null,
    kind: null,
    milestone: false,
    summary: null,
  };
  const rest = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--date' && argv[i + 1]) {
      opts.date = validateDate(argv[++i]);
    } else if (a === '--at' && argv[i + 1]) {
      opts.at = normalizeTime(argv[++i]);
    } else if ((a === '--kind' || a === '-k') && argv[i + 1]) {
      opts.kind = argv[++i].trim();
    } else if (a === '--milestone' || a === '-m') {
      opts.milestone = true;
    } else if ((a === '--summary' || a === '-s') && argv[i + 1]) {
      opts.summary = argv[++i].trim();
    } else if (a === '--help' || a === '-h') {
      opts.help = true;
    } else {
      rest.push(a);
    }
  }

  return { opts, text: rest.join(' ').trim() };
}

function splitFrontmatter(raw) {
  const clean = raw.replace(/^\uFEFF/, '');
  const m = clean.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fm: '', body: clean };
  return { fm: m[1], body: m[2] };
}

function yamlQuote(val) {
  return `"${val.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function upsertSummary(fm, summaryText) {
  const line = `summary: ${yamlQuote(summaryText)}`;
  if (!fm) return line;
  if (/^summary\s*:/m.test(fm)) {
    return fm.replace(/^summary\s*:.*$/m, line);
  }
  return `${fm.trimEnd()}\n${line}`;
}

function extractBulletMinutes(line) {
  const m = line.match(/^[-*]\s+(?:[*!]\s+)?(\d{2}):(\d{2})\b/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h === 24 && min === 0) return 1440;
  return h * 60 + min;
}

function appendAndSortBullet(body, newLine) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const preamble = [];
  const bullets = [];

  for (const line of lines) {
    if (/^[-*]\s+/.test(line)) {
      bullets.push(line);
    } else if (/^\s+\S/.test(line) && bullets.length > 0) {
      bullets[bullets.length - 1] += `\n${line}`;
    } else if (line.trim() && bullets.length === 0) {
      preamble.push(line);
    }
  }

  bullets.push(newLine);

  const indexed = bullets.map((line, idx) => ({
    line,
    idx,
    min: extractBulletMinutes(line),
  }));
  indexed.sort((a, b) => {
    if (a.min != null && b.min != null) return a.min - b.min || a.idx - b.idx;
    if (a.min != null) return -1;
    if (b.min != null) return 1;
    return a.idx - b.idx;
  });

  const parts = [];
  if (preamble.length > 0) {
    parts.push(preamble.join('\n'), '');
  }
  parts.push(indexed.map((x) => x.line).join('\n'));
  return `${parts.join('\n')}\n`;
}

function printUsage() {
  console.log(`用法:
  npm run log                                   查看今日日志与用法
  npm run log "刚调通唤醒死锁"                    按当前时刻追加记录
  npm run log "* LTN-030 补完实验"                以 * 或 ! 开头记为关键节点
  npm run log "[阅读] 读完第 18 章"               加 [分类] 切面标签
  npm run log "14:20 [生活] 补记散步"             指定 HH:MM 并自动按时间排序
  npm run log "summary: 今日一句话日结"           更新今日 summary（也支持 日结:）
  可选参数: --date YYYY-MM-DD  --at HH:MM  --kind 分类  -m  --summary "…"`);
}

function main() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const { opts, text } = parseArgs(process.argv.slice(2));

  if (opts.help) {
    printUsage();
    return;
  }

  const filePath = path.join(LOG_DIR, `${opts.date}.md`);
  const relPath = path.relative(process.cwd(), filePath);
  const exists = fs.existsSync(filePath);

  if (!text && !opts.summary) {
    console.log(`今日日志: ${relPath}${exists ? '' : ' (尚未创建)'}`);
    if (exists) {
      console.log('---');
      console.log(fs.readFileSync(filePath, 'utf8').trimEnd());
      console.log('---');
    }
    printUsage();
    return;
  }

  let fm = `published: ${opts.date}`;
  let body = '';
  if (exists) {
    const parsed = splitFrontmatter(fs.readFileSync(filePath, 'utf8'));
    fm = parsed.fm || fm;
    body = parsed.body;
  }

  // 处理 summary: / 日结: 前缀或 --summary 参数
  let inlineSummary = opts.summary;
  let entryText = text;
  const summaryMatch = entryText.match(/^(?:summary|日结)\s*[:：]\s*(.+)$/i);
  if (summaryMatch) {
    inlineSummary = summaryMatch[1].trim();
    entryText = '';
  }

  if (inlineSummary) {
    fm = upsertSummary(fm, inlineSummary);
  }

  let addedLine = null;
  if (entryText) {
    let working = entryText;
    let milestone = opts.milestone;
    let time = opts.at;
    let kind = opts.kind;

    // 灵活解析自然前缀：支持 "* 14:20 [工程] 内容" 或 "14:20 * [工程] 内容"
    for (let round = 0; round < 3; round++) {
      const mFlag = working.match(/^([*!])\s+([\s\S]+)$/);
      if (mFlag) {
        milestone = true;
        working = mFlag[2].trim();
        continue;
      }
      const mTime = working.match(/^(\d{1,2}:\d{2})\s+([\s\S]+)$/);
      if (mTime && !time) {
        time = normalizeTime(mTime[1]);
        working = mTime[2].trim();
        continue;
      }
      const mKind = working.match(/^\[([^\]]{1,8})\]\s+([\s\S]+)$/);
      if (mKind && !kind) {
        kind = mKind[1].trim();
        working = mKind[2].trim();
        continue;
      }
      break;
    }

    const finalTime = time ?? localTimeStr();
    const parts = ['-'];
    if (milestone) parts.push('*');
    parts.push(finalTime);
    if (kind) parts.push(`[${kind}]`);
    parts.push(working);
    addedLine = parts.join(' ');
    body = appendAndSortBullet(body, addedLine);
  }

  const normalizedBody = body ? `\n${body.replace(/^\n+/, '')}` : '\n';
  const nextContent = `---\n${fm.trimEnd()}\n---\n${normalizedBody}`;
  fs.writeFileSync(filePath, nextContent, 'utf8');

  if (inlineSummary) console.log(`已更新 summary (${relPath}): ${inlineSummary}`);
  if (addedLine) console.log(`已记录 (${relPath}): ${addedLine}`);
}

main();
