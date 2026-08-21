import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RM Record',
  description: 'Ryan Members 상담·수업 녹음 전사 시스템',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
