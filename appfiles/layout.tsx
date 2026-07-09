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
  maximumScale: 5,
  userScalable: true,
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
      <body className="h-dvh overflow-hidden pointer-fine:flex pointer-fine:h-screen pointer-fine:items-center pointer-fine:justify-center pointer-fine:overflow-visible pointer-fine:bg-neutral-900 pointer-fine:py-6">
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
        <div className="relative flex h-full w-full flex-col overflow-hidden bg-bg pointer-fine:h-[860px] pointer-fine:max-h-[calc(100dvh-3rem)] pointer-fine:w-[400px] pointer-fine:rounded-[2.75rem] pointer-fine:border-[6px] pointer-fine:border-neutral-800 pointer-fine:shadow-2xl pointer-fine:shadow-black/60">
          <PrivacyProvider>
            <MarginModeProvider>
              {/* overflow-x-hidden is load-bearing, not decorative: per the CSS
                  spec, pairing overflow-y:auto with an overflow-x left at
                  "visible" forces overflow-x to compute as "auto" too. That
                  made SwipeNav's isInsideHorizontalScroller() check (which
                  looks for overflowX === "auto"/"scroll" while walking up
                  from the touch target) treat this whole container as a
                  horizontal scroller on any page whose content is even a
                  few px wider than the viewport — which killed swipe-away
                  entirely on Brief (its tables/heatmap run wide) while
                  leaving narrower pages unaffected. Pinning overflow-x to
                  hidden here stops that computed value from ever becoming
                  "auto" in the first place. */}
              <SwipeNav className="mx-auto min-h-0 w-full max-w-md flex-1 overflow-y-auto overflow-x-hidden md:max-w-4xl lg:max-w-6xl pointer-fine:max-w-md">
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
