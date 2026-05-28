import type {Metadata} from 'next';
import { Analytics } from '@vercel/analytics/next';
import './globals.css'; // Global styles

export const metadata: Metadata = {
  title: 'PTB-XL ECG Explorer — Clinical Database & Rhythm Simulator',
  description: 'An interactive 12-lead Electrocardiogram (ECG) explorer powered by the PTB-XL clinical database with a real-time rhythm synthesizer. Browse 21,837 clinical ECG records or simulate 28+ cardiac rhythms.',
  applicationName: 'PTB-XL ECG Explorer',
  keywords: ['ECG', 'EKG', 'electrocardiogram', 'PTB-XL', 'cardiology', 'rhythm simulator', '12-lead', 'medical education'],
  authors: [{ name: 'PTB-XL ECG Explorer' }],
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ECG Explorer',
  },
  openGraph: {
    title: 'PTB-XL ECG Explorer',
    description: 'Interactive 12-lead ECG database browser & rhythm simulator',
    type: 'website',
  },
  icons: {
    icon: [
      { url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="64" fill="%230d1117"/><path d="M420 180c-16 0-30 9-37 23l-48 84-49-84a43 43 0 0 0-75 30v196c0 13 11 24 24 24s24-11 24-24V281l37 64a43 43 0 0 0 75 0l37-64v139c0 13 11 24 24 24s24-11 24-24V223c0-24-19-43-43-43z" fill="%2300ff88"/><path d="M174 265c-8 0-16-4-20-11l-41-71v96c0 13-11 24-24 24s-24-11-24-24V147c0-19 15-34 34-34 12 0 23 6 28 17l42 72V147c0-13 11-24 24-24s24 11 24 24v131c0 19-15 34-34 34z" fill="%2300ff88"/></svg>' },
    ],
    apple: [
      { url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="64" fill="%230d1117"/><path d="M420 180c-16 0-30 9-37 23l-48 84-49-84a43 43 0 0 0-75 30v196c0 13 11 24 24 24s24-11 24-24V281l37 64a43 43 0 0 0 75 0l37-64v139c0 13 11 24 24 24s24-11 24-24V223c0-24-19-43-43-43z" fill="%2300ff88"/><path d="M174 265c-8 0-16-4-20-11l-41-71v96c0 13-11 24-24 24s-24-11-24-24V147c0-19 15-34 34-34 12 0 23 6 28 17l42 72V147c0-13 11-24 24-24s24 11 24 24v131c0 19-15 34-34 34z" fill="%2300ff88"/></svg>' },
    ],
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <meta name="theme-color" content="#0d1117" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="manifest" href="/manifest.json" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').then(function(reg) {
                    console.log('SW registered:', reg.scope);
                  }).catch(function(err) {
                    console.log('SW registration failed:', err);
                  });
                });
              }
            `,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Analytics />
      </body>
    </html>
  );
}