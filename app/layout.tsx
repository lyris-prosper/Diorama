import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "房间工作台",
  description: "上传房间照片，选择家具，整理你的三维空间。",
  other: { "codex-preview": "development" },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
