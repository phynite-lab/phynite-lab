'use client';

import { ArrowUpRight, Check } from 'lucide-react';
import type { LabAccount, PlanId } from '@/lib/account-api';
import { localizedPlans, publicPlanId } from '@/lib/plans';
import { useLocale } from './locale-provider';

export function PlanOptions({ account, busy, onChoose }: { account: LabAccount | null; busy: string; onChoose: (plan: PlanId) => void }) {
  const { locale, t } = useLocale();
  const currentPlan = publicPlanId(account?.planId);
  return <div className="studio-plans">{localizedPlans(locale).map(plan => <article key={plan.id} data-current={currentPlan === plan.id}>
    <div className="studio-plan-top"><h3>{plan.name}</h3>{currentPlan === plan.id && <span className="lab-tag"><Check size={12} />{t('Current', 'Aktif')}</span>}</div>
    <p className="studio-plan-price">{plan.price}</p><small>{plan.note || plan.category}</small><p>{plan.description}</p>
    <ul>{plan.features.map(feature => <li key={feature}><Check size={14} /><span>{feature}</span></li>)}</ul>
    {plan.id === 'research' ? <a className="lab-button" href="/billing#payments">{t('Top up Quanta', 'Top-up Quanta')}<ArrowUpRight size={14} /></a> : plan.id === 'enterprise' ? <a className="lab-button" href="/contact">{t('Discuss requirements', 'Diskusikan kebutuhan')}<ArrowUpRight size={14} /></a> : <button className="lab-button" disabled={!account || Boolean(busy) || currentPlan === plan.id || account.requestedPlan === plan.id} onClick={() => onChoose(plan.id)}>{busy === plan.id ? t('Updating...', 'Memperbarui...') : currentPlan === plan.id ? t('Current plan', 'Paket aktif') : account?.requestedPlan === plan.id ? t('Interest registered', 'Minat terdaftar') : plan.id !== 'free' ? t('Request activation', 'Ajukan aktivasi') : t(`Use ${plan.name}`, `Gunakan ${plan.name}`)}</button>}
  </article>)}</div>;
}
