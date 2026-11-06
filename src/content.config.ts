import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const statusEnum = z.enum(['draft', 'exploring', 'tested', 'stable', 'deprecated']);

const writing = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/writing' }),
  schema: z.object({
    id: z.string(), // LTN-xxx
    title: z.string(),
    subtitle: z.string().optional(),
    category: z.enum(['engineering', 'research', 'buildlog', 'reflection']),
    status: statusEnum,
    temperature: z.number().optional(),
    confidence: z.string().optional(),
    scope: z.string().optional(),
    tags: z.array(z.string()).default([]),
    published: z.coerce.date(),
    updated: z.coerce.date().optional(),
    excerpt: z.string(),
    minutes: z.number().optional(),
    featured: z.boolean().default(false),
    tempLog: z.array(z.object({ date: z.coerce.date(), status: statusEnum })).optional(),
    notes: z.array(z.object({ anchor: z.string(), text: z.string() })).optional(),
    parts: z
      .array(
        z.object({
          title: z.string(),
          subtitle: z.string().optional(),
          minutes: z.number().optional(),
        })
      )
      .optional(),
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
    temperature: z.number().optional(),
    problem: z.string(),
    hypothesis: z.string(),
    system: z.array(z.string()).default([]),
    next: z.string().optional(),
    order: z.number().default(0),
  }),
});

const log = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/log' }),
  schema: z.object({
    published: z.coerce.date(),
    link: z.string().optional(),
  }),
});

export const collections = { writing, projects, log };
