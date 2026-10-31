'use client';

import { Building2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocale } from '@/app/locale-provider';
import { UiSelect } from '@/components/UiSelect';
import {
  PhyniteApiError, phyniteOrganizations,
  type PhyniteOrganizationMember, type PhyniteResearchOrganization,
} from '@/lib/phynite-api';

type Action = 'create' | 'member' | 'grant' | 'allocate';

export function ResearchOrganizationsPanel({ admin = false }: { admin?: boolean }) {
  const { t } = useLocale();
  const [organizations, setOrganizations] = useState<PhyniteResearchOrganization[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<PhyniteResearchOrganization | null>(null);
  const [members, setMembers] = useState<PhyniteOrganizationMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Action | ''>('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [piId, setPiId] = useState('');
  const [newMemberId, setNewMemberId] = useState('');
  const [memberId, setMemberId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const requestKeys = useRef<Record<string, string>>({});

  const load = useCallback(async (requestedId?: string) => {
    setLoading(true);
    try {
      const listed = await phyniteOrganizations.list(admin);
      setOrganizations(listed.organizations);
      const id = requestedId || selectedId || listed.organizations[0]?.id || '';
      if (id && listed.organizations.some(org => org.id === id)) {
        const result = await phyniteOrganizations.detail(id, admin);
        setDetail(result.organization);
        setMembers(result.members);
        setSelectedId(id);
      } else {
        setDetail(null);
        setMembers([]);
        setSelectedId('');
      }
      setError('');
    } catch (failure) {
      setError(failure instanceof PhyniteApiError ? failure.message : t('Research labs could not be loaded.', 'Lab riset belum dapat dimuat.'));
    } finally {
      setLoading(false);
    }
  }, [admin, selectedId, t]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initial);
  }, [load]);

  const act = async (event: FormEvent, action: Action) => {
    event.preventDefault();
    if (busy) return;
    setBusy(action);
    setNotice('');
    try {
      if (action === 'create') {
        const result = await phyniteOrganizations.create(name.trim(), piId.trim());
        setName(''); setPiId('');
        setNotice(t('Research lab created.', 'Lab riset dibuat.'));
        await load(result.organization.id);
      } else if (detail) {
        if (action === 'member') {
          await phyniteOrganizations.addMember(detail.id, newMemberId.trim());
          setNewMemberId('');
          setNotice(t('Member added to this lab.', 'Anggota ditambahkan ke lab ini.'));
        } else {
          const keyId = [action, detail.id, memberId, amount, reason].join(':');
          const requestKey = requestKeys.current[keyId] ||= crypto.randomUUID();
          if (action === 'grant') {
            await phyniteOrganizations.grant(detail.id, amount, reason.trim(), requestKey);
            setNotice(t('Quanta granted to the lab pool.', 'Quanta diberikan ke pool lab.'));
          } else {
            await phyniteOrganizations.allocate(detail.id, memberId, amount, reason.trim(), requestKey, admin);
            setNotice(t('Quanta allocated to the member.', 'Quanta dialokasikan ke anggota.'));
          }
          delete requestKeys.current[keyId];
          setAmount(''); setReason('');
        }
        await load(detail.id);
      }
    } catch (failure) {
      setError(failure instanceof PhyniteApiError ? failure.message : t('The lab change could not be saved.', 'Perubahan lab belum dapat disimpan.'));
    } finally {
      setBusy('');
    }
  };

  if (!admin && !loading && !error && organizations.length === 0) return null;
  const canAllocate = admin || detail?.myRole === 'PI';
  const allocatableMembers = members.filter(member => member.role === 'MEMBER');

  return <section className="research-orgs" aria-labelledby={admin ? 'admin-orgs-title' : 'billing-orgs-title'}>
    <header className="research-orgs-heading"><div><p>{t('Research organizations', 'Organisasi riset')}</p><h2 id={admin ? 'admin-orgs-title' : 'billing-orgs-title'}>{t('Lab Quanta pools', 'Pool Quanta lab')}</h2><span>{t('Manage grants and member allocations. Project data stays with its owner.', 'Kelola grant dan alokasi anggota. Data project tetap milik pemiliknya.')}</span></div><button type="button" className="lab-button" disabled={loading} onClick={() => void load()}><RefreshCw size={13} />{t('Refresh', 'Perbarui')}</button></header>
    {(error || notice) && <div className="admin-control-notice" data-error={Boolean(error) || undefined} role={error ? 'alert' : 'status'}>{error || notice}</div>}
    {admin && <form className="research-orgs-create" onSubmit={event => void act(event, 'create')}><strong><Building2 size={14} />{t('Create a lab', 'Buat lab')}</strong><label>{t('Lab name', 'Nama lab')}<input value={name} onChange={event => setName(event.target.value)} minLength={3} maxLength={120} required placeholder={t('Materials Research Group', 'Grup Riset Material')} /></label><label>{t('PI account ID', 'ID akun PI')}<input value={piId} onChange={event => setPiId(event.target.value)} pattern="[0-9a-fA-F-]{36}" required placeholder={t('Copy from the user directory', 'Salin dari direktori pengguna')} /></label><button className="lab-button lab-button-primary" disabled={Boolean(busy)}>{t('Create lab', 'Buat lab')}</button></form>}
    {organizations.length > 0 && <div className="research-orgs-layout"><div className="research-orgs-list" aria-label={t('Research labs', 'Lab riset')}>{organizations.map(org => <button key={org.id} type="button" data-selected={selectedId === org.id || undefined} onClick={() => void load(org.id)}><span>{org.name}</span><strong>{org.budgetVisible ? `${org.quantaBalance} Quanta` : t('Member', 'Anggota')}</strong><small>{org.myRole || t('Operator', 'Operator')}</small></button>)}</div><div className="research-orgs-detail">{detail && <><div className="research-orgs-balance"><span>{detail.name}</span>{detail.budgetVisible ? <><strong>{detail.quantaBalance} <small>Quanta</small></strong><p>{t('Available for manual allocation. This is a credit record, not a payment balance.', 'Tersedia untuk alokasi manual. Ini catatan kredit, bukan saldo pembayaran.')}</p></> : <p>{t('Your personal Quanta allocation appears in your account balance.', 'Alokasi Quanta pribadi Anda tersedia pada saldo akun.')}</p>}</div><div className="research-orgs-members"><h3>{t('Members', 'Anggota')} <span>{members.length || (detail.myRole === 'MEMBER' ? '—' : 0)}</span></h3>{members.map(member => <div key={member.userId}><span>{member.userId}</span><strong>{member.role}</strong></div>)}{detail.myRole === 'MEMBER' && <p>{t('The PI manages lab membership and allocations.', 'PI mengelola keanggotaan dan alokasi lab.')}</p>}</div>{admin && <form className="research-orgs-form" onSubmit={event => void act(event, 'member')}><h3>{t('Add member', 'Tambah anggota')}</h3><label>{t('Account ID', 'ID akun')}<input value={newMemberId} onChange={event => setNewMemberId(event.target.value)} pattern="[0-9a-fA-F-]{36}" required placeholder={t('Copy from the user directory', 'Salin dari direktori pengguna')} /></label><button className="lab-button" disabled={Boolean(busy)}>{t('Add member', 'Tambah anggota')}</button></form>}{admin && <form className="research-orgs-form" onSubmit={event => void act(event, 'grant')}><h3>{t('Grant pool Quanta', 'Berikan Quanta ke pool')}</h3><div className="research-orgs-fields"><label>{t('Amount', 'Jumlah')}<input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} pattern="(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,6})?" required placeholder="100" /></label><label>{t('Reason', 'Alasan')}<input value={reason} onChange={event => setReason(event.target.value)} minLength={10} maxLength={500} required placeholder={t('Approved research credit', 'Kredit riset disetujui')} /></label></div><button className="lab-button lab-button-primary" disabled={Boolean(busy)}>{t('Grant Quanta', 'Berikan Quanta')}</button></form>}{canAllocate && <form className="research-orgs-form" onSubmit={event => void act(event, 'allocate')}><h3>{t('Allocate to member', 'Alokasikan ke anggota')}</h3><div className="research-orgs-fields"><UiSelect label={t('Member', 'Anggota')} value={memberId} options={[{ value: '', label: t('Choose member', 'Pilih anggota') }, ...allocatableMembers.map(member => ({ value: member.userId, label: member.userId }))]} onChange={setMemberId} /><label>{t('Amount', 'Jumlah')}<input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} pattern="(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,6})?" required placeholder="25" /></label></div><label>{t('Reason', 'Alasan')}<input value={reason} onChange={event => setReason(event.target.value)} minLength={10} maxLength={500} required placeholder={t('Approved member allocation', 'Alokasi anggota disetujui')} /></label><button className="lab-button lab-button-primary" disabled={Boolean(busy) || !memberId}>{t('Allocate Quanta', 'Alokasikan Quanta')}</button></form>}</>}</div></div>}
    {!loading && organizations.length === 0 && <p className="research-orgs-empty">{t('No research labs are registered yet.', 'Belum ada lab riset terdaftar.')}</p>}
  </section>;
}
