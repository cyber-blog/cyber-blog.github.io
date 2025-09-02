import type { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
  {
    "url": "/",
    lastModified: new Date("2025-04-05T13:14:53.941Z"),
    "changeFrequency": "daily",
    "priority": 1
  },
  {
    "url": "/blog",
    lastModified: new Date("2025-04-05T13:14:53.942Z"),
    "changeFrequency": "daily",
    "priority": 0.9
  },
  {
    "url": "blog/hello-world",
    lastModified: new Date("2025-04-05T12:10:00.000Z"),
    "changeFrequency": "weekly",
    "priority": 0.8
  },
  {
    "url": "blog/intro",
    lastModified: new Date("2025-04-05T12:10:00.000Z"),
    "changeFrequency": "weekly",
    "priority": 0.8
  }
]
}
