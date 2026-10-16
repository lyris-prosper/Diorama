import type { Metadata } from "next";
// Type, bundled so the page looks the same offline: Fraunces (upright and its true italic) for
// Latin, Noto Serif SC for Chinese where the system has no Songti (phones, Windows). The Chinese
// font comes in slices by character range; a page loads only the slices its text uses.
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/fraunces/full-italic.css";
import "@fontsource-variable/noto-serif-sc";
import "./globals.css";
export const metadata: Metadata = {
  title: "方寸 Diorama",
  description: "方寸之间，摆出心里的家。Rearrange your room without lifting a finger. Try it before you buy it.",
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
