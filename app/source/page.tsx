import { notFound } from 'next/navigation';
import Link from 'next/link';
import { localAppMode } from '@/lib/local-runtime';
import { releaseSource } from '@/lib/release-source';
import '../account/settings.css';

export default function SourcePage() {
  if (!localAppMode()) notFound();
  const source = releaseSource();
  return <main className="lab-page studio-page"><div className="settings-content settings-main">
    <header className="settings-page-heading"><div><h1>Source code and license</h1><p>Phynite Lab · {source.version}</p></div></header>
    <section className="settings-section"><h2>GNU Affero General Public License v3</h2>
      <p>Phynite Lab is free software licensed under GNU AGPL v3. You may use, study, modify and redistribute it under that license. Modified versions offered over a network must offer their corresponding source to users as required by the license.</p>
      <p><a href={source.url} target="_blank" rel="noreferrer">View the source for this version</a></p>
      {source.archive && <p><a href={source.archive}>Download corresponding source</a></p>}
      {source.commit && <p>Source commit: <code>{source.commit}</code></p>}
      <p>Third-party components retain their own licenses. License texts and third-party notices are included with the installed npm packages and source release.</p>
      <p><Link href="/account/compute">Back to settings</Link></p>
    </section>
  </div></main>;
}
