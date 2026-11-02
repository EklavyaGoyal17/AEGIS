import { Providers } from '@/components/providers';
import './globals.css';

export const metadata = {
  title: 'AEGIS Security Console',
  description:
    'Enterprise AI agent security operations platform — monitor, govern, and audit autonomous agent activity in real time.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased bg-neutral-950 text-neutral-100">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
