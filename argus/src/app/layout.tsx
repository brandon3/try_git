import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Argus",
  description: "Personal AI chief of staff — it watches so you don't have to.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
