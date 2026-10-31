'use client';

import { useLocale } from '@/app/locale-provider';
import type { ComputeProfile } from '@/lib/compute-selection';
import { UiSelect } from './UiSelect';

export function ComputeResourcePicker({ profiles, value, disabled = false, compact = false, showRates = true, onChange }: {
  profiles: ComputeProfile[]; value?: string; disabled?: boolean; compact?: boolean; showRates?: boolean; onChange: (id: string) => void;
}) {
  const { t, intlLocale } = useLocale();
  const selected = profiles.find(item => item.id === value);
  const cpu = selected?.vcpus ?? profiles[0]?.vcpus;
  const sizes = [...new Set(profiles.map(item => item.vcpus))];
  const memory = profiles.filter(item => item.vcpus === cpu);
  return <div className="compute-resource-picker">
    <UiSelect label="vCPU" compact={compact} disabled={disabled || !profiles.length} value={cpu ? String(cpu) : ''}
      options={sizes.map(size => ({ value: String(size), label: size.toLocaleString(intlLocale) + ' vCPU' }))}
      onChange={next => {
        const candidates = profiles.filter(item => item.vcpus === Number(next));
        const preferred = [...candidates].sort((a, b) => Math.abs(a.memoryMiB - (selected?.memoryMiB ?? 0)) - Math.abs(b.memoryMiB - (selected?.memoryMiB ?? 0)) || a.hourlyMicros - b.hourlyMicros)[0];
        if (preferred) onChange(preferred.id);
      }} />
    <UiSelect label={t('Usable RAM', 'RAM tersedia')} compact={compact} disabled={disabled || !memory.length} value={selected?.id ?? ''}
      options={[...(!selected ? [{ value: '', label: t('Choose RAM', 'Pilih RAM'), disabled: true }] : []), ...memory.map(item => ({ value: item.id, label: (item.memoryMiB / 1024).toLocaleString(intlLocale, { maximumFractionDigits: 2 }) + ' GiB', detail: showRates ? item.hourlyQuanta.toLocaleString(intlLocale, { maximumFractionDigits: 6 }) + ' Quanta / h' : undefined }))]}
      onChange={onChange} />
  </div>;
}
