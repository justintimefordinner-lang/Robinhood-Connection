import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { BottomNav } from "@/components/BottomNav";
import { SwipeNav } from "@/components/SwipeNav";
import { PrivacyProvider } from "@/components/privacy";
import { MarginModeProvider } from "@/components/margin-mode";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Portfolio",
  description: "Personal options & equity portfolio cockpit",
  applicationName: "Portfolio",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Portfolio" },
};

export const viewport: Viewport = {
  themeColor: "#0a0e14",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full pointer-fine:flex pointer-fine:min-h-screen pointer-fine:items-center pointer-fine:justify-center pointer-fine:bg-neutral-900 pointer-fine:py-6">
        {/* Real desktop mouse: frame the app like a phone for local preview
            (a resized browser window is still "pointer: fine", so it keeps
            getting the mockup). Real touch devices — phones AND tablets —
            skip this entirely and get a full-bleed, width-responsive layout:
            phone widths look exactly as before; tablet widths scale up via
            the inner container's md:/lg: max-width instead of being boxed
            into a 400px frame. */}
        <div className="relative w-full bg-bg pointer-fine:flex pointer-fine:h-[860px] pointer-fine:max-h-[calc(100dvh-3rem)] pointer-fine:w-[400px] pointer-fine:flex-col pointer-fine:overflow-hidden pointer-fine:rounded-[2.75rem] pointer-fine:border-[6px] pointer-fine:border-neutral-800 pointer-fine:shadow-2xl pointer-fine:shadow-black/60">
          <PrivacyProvider>
            <MarginModeProvider>
              <SwipeNav className="mx-auto w-full max-w-md md:max-w-4xl lg:max-w-6xl pointer-fine:max-w-md pointer-fine:min-h-0 pointer-fine:flex-1 pointer-fine:overflow-y-auto pointer-fine:pb-6">
                {children}
              </SwipeNav>
              <BottomNav />
            </MarginModeProvider>
          </PrivacyProvider>
        </div>
      </body>
    </html>
  );
}
