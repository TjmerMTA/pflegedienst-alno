import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Статьи блога: один .md = одна статья, адрес /blog/<имя-файла>/
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string().max(170),
      date: z.coerce.date(),
      updated: z.coerce.date().optional(),
      author: z.string().default('Team Pflegedienst ALNO'),
      image: image().optional(),
      imageAlt: z.string().optional(),
      tags: z.array(z.string()).default([]),
      draft: z.boolean().default(false),
    }),
});

// Услуги: каждая — своя SEO-страница /leistungen/<имя-файла>/
const leistungen = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/leistungen' }),
  schema: z.object({
    title: z.string(),
    metaTitle: z.string(),
    description: z.string().max(170),
    teaser: z.string(),
    icon: z.string(),
    order: z.number(),
    highlights: z.array(z.string()),
    payer: z.string(),
  }),
});

export const collections = { blog, leistungen };
