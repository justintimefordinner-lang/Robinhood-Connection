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
  manifest: "/manifest.json",
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
      <body className="h-dvh overflow-hidden sm:flex sm:h-screen sm:items-center sm:justify-center sm:overflow-visible sm:bg-neutral-900 sm:py-6">
        {/* Real desktop mouse: frame the app like a phone for local preview
            (a resized browser window is still "pointer: fine", so it keeps
            getting the mockup). Real touch devices — phones AND tablets —
            skip the phone-frame chrome and get a full-bleed, width-responsive
            layout: phone widths look exactly as before; tablet widths scale
            up via the inner container's md:/lg: max-width instead of being
            boxed into a 400px frame. Both modes now share the same "locked
            shell, scroll only the middle" structure (body/frame never
            scroll) — needed so the bottom nav can be a plain static flex
            item instead of `position: fixed`, which mobile browsers nudge
            around as their own address bar hides/shows during a scroll. */}
        <div className="relative flex h-full w-full flex-col overflow-hidden bg-bg sm:h-[860px] sm:max-h-[calc(100dvh-3rem)] sm:w-[400px] sm:rounded-[2.75rem] sm:border-[6px] sm:border-neutral-800 sm:shadow-2xl sm:shadow-black/60">
          <PrivacyProvider>
            <MarginModeProvider>
              {/* overflow-x-hidden: prevents any accidental horizontal
                  scroll/bounce if a table or chart ever runs a few px wider
                  than the viewport (Brief's tables/heatmap are the usual
                  suspect). No longer load-bearing for swipe-to-change-tabs —
                  that gesture now lives on BottomNav instead of this
                  container, see SwipeNav.tsx's useSwipeGesture — but still
                  good hygiene to keep. */}
              <SwipeNav className="mx-auto min-h-0 w-full max-w-md flex-1 overflow-y-auto overflow-x-hidden">
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
