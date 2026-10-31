'use client';

import { useLocale } from './locale-provider';
import styles from './error-page.module.css';

type ErrorPageProps = {
  variant: 'not-found' | 'application';
  reset?: () => void;
};

export function ErrorPage({ variant, reset }: ErrorPageProps) {
  const { t } = useLocale();
  const isNotFound = variant === 'not-found';

  return (
    <main className={`${styles.screen} phynite-error-screen`} aria-labelledby="error-title">
      <section className={styles.message}>
        <p className={styles.code}>{isNotFound ? '404' : 'ERROR'}</p>
        <h1 id="error-title">
          {isNotFound ? t('Page not found.', 'Halaman tidak ditemukan.') : t('An error occurred.', 'Terjadi kesalahan.')}
        </h1>
        <button
          className={styles.backButton}
          type="button"
          onClick={() => {
            if (window.history.length > 1) window.history.back();
            else if (reset) reset();
            else window.location.assign('/');
          }}
        >
          {t('Go back', 'Kembali')}
        </button>
      </section>
    </main>
  );
}
