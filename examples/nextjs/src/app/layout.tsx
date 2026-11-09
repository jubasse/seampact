import type { ReactNode } from "react";

export const metadata = { title: "seampact notes" };

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
