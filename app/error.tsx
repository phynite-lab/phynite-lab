'use client';

import { ErrorPage } from './error-page';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorPage variant="application" reset={reset} />;
}
