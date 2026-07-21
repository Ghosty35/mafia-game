import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import ErrorBoundary from "./components/ErrorBoundary";
import ServiceWorkerRegistrar from "./components/ServiceWorkerRegistrar";
import PWAInstallBanner from "./components/PWAInstallBanner";
import MobileSplash from "./components/MobileSplash";
import OfflineIndicator from "./components/OfflineIndicator";
import "./globals.css";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "A Hustler's Way",
  description:
    "A modern mafia browser game. Rise through the ranks, rule the city.",
  applicationName: "A Hustler's Way",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "A Hustler's Way",
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { url: '/icon-512.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#09090b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-950">
        <div className="mafia-ambient" />
        <ErrorBoundary>
          <LanguageProvider>{children}</LanguageProvider>
        </ErrorBoundary>
        <OfflineIndicator />
        <PWAInstallBanner />
        <MobileSplash />
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
