import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "@/app/globals.css";

export const metadata: Metadata = {
  title: {
    default: "Genie by Zyra",
    template: "%s · Genie by Zyra",
  },
  description: "Zyra's internal AI film studio for cinematic devotional storytelling.",
  applicationName: "Genie by Zyra",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#090710",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to studio
        </a>
        {children}
      </body>
    </html>
  );
}
