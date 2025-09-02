// scripts/generate-sitemap.js
import { readdir, readFile } from 'fs/promises';
import { join, relative } from 'path';
import { existsSync, promises as fsPromises } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import matter from 'gray-matter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_URL = 'https://xxx.com';

function getPriority(path) {
  if (path === '/') return 1.0;
  if (path === '/blog') return 0.9;
  return 0.8;
}

function getChangeFrequency(path) {
  if (path === '/' || path === '/blog') {
    return 'daily';
  }
  return 'weekly';
}

async function scanMarkdownFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await scanMarkdownFiles(fullPath));
    } else if (entry.name.endsWith('.md')) {
      const content = await readFile(fullPath, 'utf-8');
      const { data } = matter(content);
      
      // Get relative path and convert to URL path
      const relativePath = relative(join(process.cwd(), 'src/content'), dir);
      const urlPath = join(relativePath, entry.name.replace('.md', '')).replace(/\\/g, '/');
      
      files.push({
        url: urlPath,
        lastModified: data.updated || new Date().toISOString(),
        changeFrequency: getChangeFrequency(urlPath),
        priority: getPriority(urlPath)
      });
    }
  }

  return files;
}

async function generateSitemap() {
  const contentDir = join(process.cwd(), 'src/content');
  
  try {
    // Scan markdown files
    const sitemapItems = await scanMarkdownFiles(contentDir);

    // Add root and blog index pages
    sitemapItems.unshift(
      {
        url: '/',
        lastModified: new Date().toISOString(),
        changeFrequency: 'daily',
        priority: 1.0
      },
      {
        url: '/blog',
        lastModified: new Date().toISOString(),
        changeFrequency: 'daily',
        priority: 0.9
      }
    );

    // Generate TypeScript code
    const tsContent = `import type { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  return ${JSON.stringify(sitemapItems, null, 2)
    .replace(/"lastModified": "([^"]+)"/g, 'lastModified: new Date("$1")')}
}
`;

    // Write the sitemap.ts file
    const outputPath = join(process.cwd(), 'src/app/sitemap.ts');
    await fsPromises.writeFile(outputPath, tsContent);

    console.log(`Generated sitemap with ${sitemapItems.length} items`);
  } catch (error) {
    console.error('Error generating sitemap:', error);
  }
}

generateSitemap().catch(console.error);
