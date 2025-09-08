# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

这是一个基于 Hugo Stack 主题的静态博客网站，使用 Hugo 静态站点生成器构建。该项目是从 Hugo Theme Stack Starter Template 创建的，专门针对中文内容优化。

## 核心架构

### 技术栈
- **Hugo**: 静态站点生成器 (v0.139.4 extended)
- **Go**: 模块管理 (v1.17+)
- **Hugo Stack Theme**: 主题系统 (v3.30.0)
- **GitHub Pages**: 静态托管
- **GitHub Actions**: 自动部署

### 项目结构
```
├── config/_default/          # Hugo 配置文件
│   ├── config.toml          # 主配置：站点基本信息
│   ├── params.toml          # 主题参数：样式、组件配置
│   ├── menu.toml            # 导航菜单
│   └── module.toml          # Hugo 模块配置
├── content/                 # 内容目录
│   ├── post/               # 博客文章
│   ├── page/               # 静态页面
│   └── categories/         # 分类页面
├── static/                 # 静态资源
├── assets/                 # 主题资源
└── public/                 # 构建输出 (自动生成)
```

## 开发命令

### 本地开发
```bash
hugo server                  # 启动开发服务器 (推荐)
hugo server --buildDrafts   # 包含草稿的开发服务器
```

### 构建部署
```bash
hugo --minify --gc          # 生产构建 (优化和垃圾回收)
hugo --buildDrafts          # 构建包含草稿
```

### 主题更新
```bash
hugo mod get -u github.com/CaiJimmy/hugo-theme-stack/v3
hugo mod tidy
```

## 配置要点

### 站点基本配置 (config/_default/config.toml)
- `baseurl`: 部署 URL，当前为 "https://cyber-blog.github.io"
- `languageCode`: "zh-ch"，中文语言设置
- `defaultContentLanguage`: "zh-cn"
- `hasCJKLanguage`: true，启用中日韩语言支持

### 主题配置 (config/_default/params.toml)
- 主要内容区域：`mainSections = ["post"]`
- 评论系统：Disqus 集成 (shortname: "majiang")
- 侧边栏头像和个人信息配置
- 小部件：搜索、归档、分类、标签云
- 图片处理和 OpenGraph 设置

## 内容创建

### 文章结构
- 博客文章存放在 `content/post/` 目录
- 支持 Markdown 格式
- 使用 Hugo 的 Front Matter 进行元数据配置

### 分类和页面
- 分类页面：`content/categories/`
- 静态页面：`content/page/`

## 部署系统

### 自动部署 (.github/workflows/deploy.yml)
- 触发条件：push 到 master 分支
- 构建环境：Ubuntu latest + Go 1.17+ + Hugo 0.139.4 extended
- 部署目标：gh-pages 分支
- 缓存：Hugo 资源缓存优化

### 主题自动更新 (.github/workflows/update-theme.yml)
- 定时任务：每日自动检查主题更新

## 开发注意事项

### Hugo 模块系统
- 项目使用 Hugo 模块加载主题，而非 Git 子模块
- 主题版本固定为 v3.30.0
- 主题更新需要修改 `config/_default/module.toml`

### 中文内容优化
- 启用了 CJK 语言支持，确保中文内容的 `.Summary` 和 `.WordCount` 正确
- 默认内容语言设置为中文简体

### 构建特性
- 启用 `--minify` 和 `--gc` 优化
- RSS 输出完整内容 (`rssFullContent = true`)
- 图片处理优化已启用