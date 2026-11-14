import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const statusEnum = z.enum(['draft', 'exploring', 'tested', 'stable', 'deprecated']);

/* 兼容 Obsidian Properties 清空字段时产生的 YAML null 或空串 */
const optStr = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v == null || v.trim() === '' ? undefined : v));

const optNum = z
  .number()
  .nullable()
  .optional()
  .transform((v) => v ?? undefined);

const optDate = z.coerce
  .date()
  .nullable()
  .optional()
  .transform((v) => v ?? undefined);

const strList = z
  .array(z.string())
  .nullable()
  .optional()
  .transform((v) => v ?? []);

const writing = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/writing' }),
  schema: z.object({
    id: z.string(), // LTN-xxx
    title: z.string(),
    subtitle: optStr,
    category: z.enum(['engineering', 'research', 'buildlog', 'reflection']),
    status: statusEnum,
    temperature: optNum,
    confidence: optStr,
    scope: optStr,
    tags: strList,
    published: z.coerce.date(),
    updated: optDate,
    excerpt: z.string(),
    minutes: optNum,
    featured: z.boolean().default(false),
    tempLog: z.array(z.object({ date: z.coerce.date(), status: statusEnum })).nullable().optional().transform((v) => v ?? undefined),
    notes: z.array(z.object({ anchor: z.string(), text: z.string() })).nullable().optional().transform((v) => v ?? undefined),
    parts: z
      .array(
        z.object({
          title: z.string(),
          subtitle: optStr,
          minutes: optNum,
        })
      )
      .nullable()
      .optional()
      .transform((v) => v ?? undefined),
  }),
});

const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: z.object({
    id: z.string(), // LAB-xxx
    title: z.string(),
    subtitle: z.string(),
    state: z.string(), // Active Development 等
    status: statusEnum,
    temperature: optNum,
    problem: z.string(),
    hypothesis: z.string(),
    system: strList,
    next: optStr,
    order: z.number().default(0),
  }),
});

const log = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/log' }),
  schema: z.object({
    published: z.coerce.date(),
    summary: optStr,
    link: optStr,
    tags: strList,
  }),
});

export const collections = { writing, projects, log };
