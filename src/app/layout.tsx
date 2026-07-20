import type { Metadata } from "next";
import "@/styles/tm-tokens.css";

export const metadata: Metadata = {
  title: "Trusted Marketing — SEO Monitor",
  description: "Client performance tracking",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
