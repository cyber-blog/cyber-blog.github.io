import { readdir, readFile } from 'fs/promises';
import { join, relative } from 'path';
import { promises as fsPromises } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import matter from 'gray-matter';
import { Feed } from 'feed';
import { marked } from 'marked';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_URL = 'https://xxx.com';
const AUTHOR = {
  name: "Your Name",
  email: "your.email@example.com",
  link: BASE_URL
};

async function scanMarkdownFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await scanMarkdownFiles(fullPath));
    } else if (entry.name.endsWith('.md')) {
      const content = await readFile(fullPath, 'utf-8');
      const { data, content: markdown } = matter(content);
      
      // Get relative path and convert to URL path
      const relativePath = relative(join(process.cwd(), 'src/content'), dir);
      const urlPath = join(relativePath, entry.name.replace('.md', '')).replace(/\\/g, '/');
      
      files.push({
        ...data,
        content: markdown,
        url: `${BASE_URL}/${urlPath}`,
        date: new Date(data.date),
        updated: new Date(data.updated)
      });
    }
  }

  return files;
}

async function generateRSSFeed() {
  const contentDir = join(process.cwd(), 'src/content/blog');
  
  try {
    // Scan markdown files
    const posts = await scanMarkdownFiles(contentDir);

    // Sort posts by date
    posts.sort((a, b) => b.date - a.date);

    // Create feed
    const feed = new Feed({
      title: "Your Blog",
      description: "Your Blog Description",
      id: BASE_URL,
      link: BASE_URL,
      language: "en",
      image: `${BASE_URL}/favicon.png`,
      favicon: `${BASE_URL}/favicon.ico`,
      copyright: `All rights reserved ${new Date().getFullYear()}, Your Name`,
      updated: new Date(),
      generator: "Feed for Node.js",
      feedLinks: {
        rss2: `${BASE_URL}/rss.xml`,
        json: `${BASE_URL}/feed.json`,
        atom: `${BASE_URL}/atom.xml`,
      },
      author: AUTHOR
    });

    // Add posts to feed
    for (const post of posts) {
      const htmlContent = marked(post.content);
      
      feed.addItem({
        title: post.title,
        id: post.url,
        link: post.url,
        description: post.summary,
        content: htmlContent,
        author: [AUTHOR],
        date: post.date,
        updated: post.updated,
      });
    }

    // Write feed files
    await fsPromises.writeFile('./public/rss.xml', feed.rss2());
    await fsPromises.writeFile('./public/index.xml', feed.rss2());
    await fsPromises.writeFile('./public/atom.xml', feed.atom1());
    await fsPromises.writeFile('./public/feed.json', feed.json1());

    console.log(`Generated RSS feeds with ${posts.length} items`);
  } catch (error) {
    console.error('Error generating RSS feeds:', error);
  }
}

generateRSSFeed().catch(console.error); 