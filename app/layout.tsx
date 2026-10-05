import type { Metadata } from "next";
// Latin type, bundled so the page looks the same offline: Fraunces for headings, Figtree for text.
// Chinese uses the Mac's own Songti and PingFang.
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/figtree";
import "./globals.css";
export const metadata: Metadata = {
  title: "方寸 Diorama",
  description: "不用搬，就能换个摆法；不用买，就能先摆上看看。Rearrange your room without lifting a finger. Try it before you buy it.",
  icons: { icon: "/favicon.svg" },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  // Browser extensions (Grammarly and the like) add attributes to <html> and <body> before React
  // starts; that mismatch is theirs, not the page's.
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
