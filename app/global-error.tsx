'use client';

import { ErrorPage } from './error-page';
import { LocaleProvider } from './locale-provider';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var r=document.documentElement,t='light';try{t=localStorage.getItem('phynite-calculation-theme')==='dark'?'dark':'light'}catch(e){}r.dataset.siteTheme=t;r.dataset.workspaceTheme=t;r.classList.toggle('site-dark',t==='dark');r.style.colorScheme=t})();`,
          }}
        />
      </head>
      <body>
        <LocaleProvider>
          <ErrorPage variant="application" reset={reset} />
        </LocaleProvider>
      </body>
    </html>
  );
}
