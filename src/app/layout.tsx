import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '오후 자습 출석 & 감독 확인 시스템 | 고2 우리반 독학자습 관리',
  description:
    '고등학교 8교시(16:20~17:10)·9교시(17:20~18:10) 오후 자습 출석체크, 감독관 확인표 서명, 월별 누적 자습시간 및 담임교사 관리 시스템',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
