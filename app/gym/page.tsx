'use client';

import GymBoard from '../components/GymBoard';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import PageHeader from '../components/PageHeader';

export default function GymPage() {
  const { t } = useLanguage();
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <PageHeader
        title={t('gym_title')}
        subtitle={t('gym_desc')}
        icon="🏋️"
        variant="default"
      />
      <GymBoard />
    </div>
  );
}
