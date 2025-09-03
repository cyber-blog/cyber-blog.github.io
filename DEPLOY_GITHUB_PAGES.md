# GitHub Pages 部署指南

本文档将指导您如何将此 Next.js 博客模板部署到 GitHub Pages。

## 部署配置

项目已经配置了 GitHub Actions workflow 来自动部署到 GitHub Pages。相关的配置文件位于：

- `.github/workflows/deploy.yml` - GitHub Actions 部署工作流
- `next.config.ts` - Next.js 配置，已添加 GitHub Pages 支持

## 部署步骤

### 1. 创建 GitHub 仓库

如果您还没有 GitHub 仓库，请创建一个新的仓库。

### 2. 配置 GitHub Pages

1. 进入您的 GitHub 仓库
2. 点击 "Settings" 选项卡
3. 在左侧菜单中选择 "Pages"
4. 在 "Build and deployment" 部分：
   - Source: 选择 "GitHub Actions"

### 3. 更新站点配置（重要）

在部署之前，您需要更新 `src/lib/config.ts` 文件中的配置信息：

```typescript
site: {
  url: "https://yourusername.github.io/your-repo-name",
  baseUrl: "https://yourusername.github.io/your-repo-name",
  // ...
},
seo: {
  metadataBase: new URL("https://yourusername.github.io/your-repo-name"),
  // ...
}
```

如果您使用的是用户/组织站点（yourusername.github.io），则 URL 为：
```typescript
url: "https://yourusername.github.io",
baseUrl: "https://yourusername.github.io",
// ...
seo: {
  metadataBase: new URL("https://yourusername.github.io"),
  // ...
}
```

### 4. 配置 basePath（非用户站点）

如果您使用的是项目站点（yourusername.github.io/your-repo-name），需要取消注释并更新 `next.config.ts` 中的 basePath：

```typescript
const nextConfig: NextConfig = {
  // ...
  basePath: '/your-repo-name',
  assetPrefix: '/your-repo-name/',
};
```

### 5. 推送代码并触发部署

推送代码到 GitHub 仓库将会自动触发部署流程：

```bash
git add .
git commit -m "feat: 配置 GitHub Pages 部署"
git push origin main
```

### 6. 查看部署状态

1. 在 GitHub 仓库页面，点击 "Actions" 选项卡
2. 查看 "Deploy to GitHub Pages" 工作流的运行状态
3. 部署成功后，可以在 "Settings" -> "Pages" 中查看部署的 URL

## 自定义域名

如果您想使用自定义域名：

1. 在仓库的 `Settings` -> `Pages` 中设置自定义域名
2. 更新 `src/lib/config.ts` 中的所有 URL 配置
3. 取消注释 `next.config.ts` 中的 basePath 和 assetPrefix 配置

## 故障排除

如果部署失败，请检查：

1. 确保所有配置 URL 正确
2. 检查 GitHub Actions 日志以获取错误信息
3. 确保仓库设置中 Pages 的 source 设置为 GitHub Actions