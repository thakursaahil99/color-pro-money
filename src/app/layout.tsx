import type { Metadata, Viewport } from "next";
import { Shell } from "@/components/Shell";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "ColorProMoney",
  description: "A 3-minute color prediction game played with virtual points only. No real money.",
};

export const viewport: Viewport = { themeColor: "#16a394", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <Shell>{children}</Shell>
        </AuthProvider>
      </body>
    </html>
  );
}
