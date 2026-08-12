import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans, Noto_Sans_Telugu } from "next/font/google";
import TopNav from "@/components/TopNav";
import Toasts from "@/components/Toasts";
import { getSessionUser } from "@/server/current-user";
import "./globals.css";

// Three roles, all of them faces built for documents and systems rather than
// magazines. Archivo carries the headings and the hero figures; Plex Sans the
// forms; Plex Mono the codes — V-PLT-01, CH-001, E014 — because those codes are
// the spine of the product and deserve a face of their own. Noto Sans Telugu
// sits in the stack so the Telugu labels on the staff forms render as words
// instead of tofu.
const archivo = Archivo({
  subsets: ["latin"],
  // 600 and 700 are the only weights the display face is ever asked for
  // (page titles, hero figures, micro-caps heads). Without this it ships as
  // a variable font carrying every weight from 100 to 900, on a phone, in a
  // kitchen, for two of them.
  weight: ["600", "700"],
  variable: "--font-archivo",
  display: "swap",
});

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

const telugu = Noto_Sans_Telugu({
  subsets: ["telugu"],
  // NOT PRELOADED. It is the largest file in the app and it exists for the
  // Telugu labels on five staff-facing forms — so it is fetched when a page
  // actually renders Telugu, not on the login screen of every device. It
  // stays in the stack, so those labels are still words and never tofu.
  preload: false,
  weight: ["400", "500"],
  variable: "--font-telugu",
  display: "swap",
});

export const metadata: Metadata = {
  title: "KitchenBooks",
  description: "Purchase-bill bookkeeping for the kitchen",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, title: "KitchenBooks", statusBarStyle: "default" },
};

export const viewport = { themeColor: "#2f6b47" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getSessionUser();
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable} ${telugu.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TopNav user={user} />
        {children}
        <Toasts />
      </body>
    </html>
  );
}
