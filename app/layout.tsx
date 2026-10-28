import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "@fontsource-variable/outfit";
import "./globals.css";

export const metadata: Metadata = {
  title: "PetroTrack",
  description: "Fuel depot manager: sales, deliveries, stock, credit and profit.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f5f1e8",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <Toaster
          position="top-center"
          closeButton
          toastOptions={{
            style: {
              borderRadius: 18,
              background: "#1e1e1c",
              color: "#fff",
              border: "none",
              fontFamily: "var(--font-sans)",
              fontSize: 15,
            },
          }}
        />
      </body>
    </html>
  );
}
