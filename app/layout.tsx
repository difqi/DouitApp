import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { DouitProvider } from "./providers/DouitProvider";
import { Toaster } from "sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const description = "Catat transaksi, pahami pengeluaran, dan jaga target tabunganmu bersama asisten keuangan pribadi Douit.";

  return {
    metadataBase: new URL(origin),
    title: "Douit",
    description,
    icons: { icon: "/douit.png", shortcut: "/douit.png" },
    openGraph: {
      title: "Douit - Keuanganmu, lebih terarah.",
      description,
      locale: "id_ID",
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1662, height: 946, alt: "Douit, asisten keuangan pribadi" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Douit - Keuanganmu, lebih terarah.",
      description,
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <DouitProvider>
          {children}
          <Toaster position="top-right" richColors />
        </DouitProvider>
      </body>
    </html>
  );
}
