import type { Metadata } from "next";
import { Noto_Sans_JP, Space_Mono } from "next/font/google";
import "./globals.css";

const noto = Noto_Sans_JP({
  subsets: ["latin"],
  variable: "--font-noto",
  weight: ["400", "500", "700"],
});

const mono = Space_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "加工フローチャート",
  description: "RGBノードで加工方法の関係性を辿るインタラクティブな加工探索",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className={`${noto.variable} ${mono.variable} antialiased`}>{children}</body>
    </html>
  );
}
