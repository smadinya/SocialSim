import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SocialSim",
  description: "A terminal social simulation where the world runs whether or not you look.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
