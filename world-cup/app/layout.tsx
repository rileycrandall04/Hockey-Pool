import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "World Cup Pool",
  description:
    "Draft, track and score a real-time 2026 World Cup pool with your friends.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-puck-bg text-ice-100 antialiased">
        {children}
      </body>
    </html>
  );
}
