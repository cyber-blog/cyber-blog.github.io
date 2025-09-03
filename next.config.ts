import type { NextConfig } from "next";
import createMDX from '@next/mdx'
import { withContentCollections } from "@content-collections/next";

const nextConfig: NextConfig = {
  pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
  // 添加 GitHub Pages 部署配置
  output: 'export',
  images: {
    unoptimized: true,
  },
  // 如果你的仓库不是用户名.github.io 格式，需要设置 basePath
  // basePath: '/your-repo-name',
  // assetPrefix: '/your-repo-name/',
};

const withMDX = createMDX({
})

export default withContentCollections(withMDX(nextConfig));
