import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://staffrecords.net"),
  title: { default: "Staff Record", template: "%s · Staff Record" },
  description: "Every employee record, shift, wage and advance in one clear place.",
  applicationName: "Staff Record",
  alternates: { canonical: "/" },
};

export const viewport: Viewport = {
  themeColor: "#143c35",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
