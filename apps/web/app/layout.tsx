import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Athena — Your company knows how',
  description: 'Learn a company procedure from evidence, confirm the policy, and put it to work with current graph-based authority.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
