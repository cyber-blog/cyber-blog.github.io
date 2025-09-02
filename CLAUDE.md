# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

这是一个基于 Next.js 的博客模板项目，采用现代化的技术栈，包括：
- Next.js 15 with App Router
- TypeScript
- Tailwind CSS
- Shadcn/ui 组件库
- Content Collections 用于内容管理
- MDX 支持用于博客文章

## Development Commands

```bash
# 安装依赖
npm install

# 开发服务器（使用 Turbopack）
npm run dev

# 构建生产版本
npm run build

# 启动生产服务器
npm start

# 代码检查
npm run lint

# 生成 RSS 订阅
npm run generate-rss

# 生成网站地图
npm run generate-sitemap
```

## Architecture and Key Files

### 核心配置
- `src/lib/config.ts` - 所有网站配置的中心化管理文件，包括站点信息、作者信息、社交媒体链接、SEO 配置等
- `content-collections.ts` - 定义博客内容的结构和数据模式
- `.cursorrules` - 包含开发规范，强调使用 TypeScript、React、Next.js App Router、Shadcn UI 和 Tailwind CSS

### 内容管理
- `src/content/blog/` - 博客文章存储目录，支持 Markdown 和 MDX 格式
- 博客文章需要包含以下元数据：title、date、updated（可选）、keywords（可选）、featured（可选）、summary（可选）

### 路由结构
- `/` - 首页
- `/blog` - 博客文章列表
- `/blog/[...slug]` - 动态博客文章详情页

### 核心组件
- `src/components/header/` - 导航头部组件，支持桌面和移动端菜单
- `src/components/giscus-comments.tsx` - Giscus 评论系统集成
- `src/components/mdx-components.tsx` - MDX 内容渲染组件
- `src/components/toc.tsx` - 目录组件
- `src/components/ui/` - Shadcn/ui 基础 UI 组件

### 样式和字体
- 使用 LXGW WenKai Lite 字体作为主要中文字体
- Tailwind CSS 作为主要样式框架
- 响应式设计，支持移动端

### 内容生成
- `scripts/generate-rss.js` - RSS 订阅生成脚本
- `scripts/generate-sitemap.js` - 网站地图生成脚本

## Development Guidelines

### 配置修改
所有网站配置都集中在 `src/lib/config.ts` 中，包括：
- 站点基本信息
- 作者信息
- 社交媒体链接
- SEO 配置
- 导航菜单
- Giscus 评论系统配置

### 博客文章管理
- 文章放在 `src/content/blog/` 目录
- 使用 Content Collections 进行类型安全的内容管理
- 支持 Markdown 和 MDX 格式
- 文章 slug 自动基于文件路径生成

### 组件开发
- 使用 TypeScript 进行类型安全开发
- 遵循 Shadcn/ui 的组件设计模式
- 使用 Tailwind CSS 进行样式开发
- 组件应支持响应式设计

### SEO 和性能
- 内置 SEO 优化，包括 Open Graph 和 Twitter Cards
- 支持多种 RSS 订阅格式
- 使用 Next.js Image 组件优化图片加载