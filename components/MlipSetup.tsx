'use client';
import { useEffect, useState } from 'react';
import { useLocale } from '@/app/locale-provider';
import { localRequest } from '@/lib/local-api';
import { browserEnvironment, startBrowserPoll } from '@/lib/browser-poll';

type State = { ready: boolean; freeBytes: number; requiredFreeBytes: number; supportedPlatform: boolean; reason?: string; progress: { state: string; error?: string } };
export function MlipSetup() {
  const { t } = useLocale();
  const [state, setState] = useState<State>(), [error, setError] = useState(''), [license, setLicense] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; const stop = startBrowserPoll(async () => { try { const value = await localRequest<State>('mlip'); if (live) { setState(value); setError(''); } } catch (failure) { if (live) setError((failure as Error).message); } }, 3000, browserEnvironment); return () => { live = false; stop(); }; }, []);
  const install = async () => { setBusy(true); setError(''); try { await localRequest('mlip/install', 'POST', { acceptModelLicense: license }); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); } };
  const installing = state?.progress.state === 'installing';
  return <div className="compute-pseudopotentials">
    <p>{t('MACE-MP-0b3 medium estimates energies and forces on CPU with float64 precision. Review a single point or fixed-cell relaxation separately in AI. It does not predict band gaps or replace DFT validation.', 'MACE-MP-0b3 medium memperkirakan energi dan gaya pada CPU dengan presisi float64. Tinjau single point atau relaksasi fixed-cell secara terpisah di AI. Model ini tidak memprediksi band gap atau menggantikan validasi DFT.')}</p>
    <p>{t('Separate setup requires the installed DFT Python runtime and at least 4 GiB free. Packages, model checksum and license are retained. Activation requires actual force, periodicity, relaxation and cancellation checks on this computer.', 'Setup terpisah memerlukan runtime Python DFT terpasang dan ruang kosong minimal 4 GiB. Paket, checksum model, dan lisensi disimpan. Aktivasi memerlukan pengujian gaya, periodisitas, relaksasi, dan pembatalan nyata pada komputer ini.')}</p>
    <p role="status">{state?.ready ? t('Qualified on this computer', 'Terkualifikasi di komputer ini') : state?.reason ?? t('Reading setup status…', 'Membaca status setup…')}</p>
    {state && !state.ready && <><p>{(state.freeBytes / 1024 ** 3).toFixed(1)} GiB {t('free', 'tersedia')}{!state.supportedPlatform && ` · ${t('Platform lock unavailable', 'Lock platform belum tersedia')}`}</p><label><input type="checkbox" checked={license} onChange={event => setLicense(event.target.checked)} /> {t('I have reviewed the model MIT license', 'Saya telah meninjau lisensi MIT model')}</label><p><a href="https://github.com/ACEsuit/mace-foundations/blob/main/LICENSE" target="_blank" rel="noreferrer">{t('Model license and source', 'Lisensi dan sumber model')} ↗</a></p><button className="lab-button" disabled={busy || installing || !license || !state.supportedPlatform || state.freeBytes < state.requiredFreeBytes} onClick={() => void install()}>{installing ? t('Installing and qualifying…', 'Memasang dan mengkualifikasi…') : t('Install and qualify MACE', 'Pasang dan kualifikasi MACE')}</button></>}
    {state?.progress.error && <p role="alert">{state.progress.error}</p>}{error && <p role="alert">{error}</p>}
  </div>;
}
