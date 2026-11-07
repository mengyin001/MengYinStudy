import { useCallback, useEffect, useState } from 'react';
import { Meter } from './ui';
import { formatBytes } from '@/lib/format';
import { navigate } from '@/lib/router';
import { backend } from '@/services';
import { USER_MEDIA_LIMIT_BYTES } from '@/services/supabase/userMedia';
import { useApp } from '@/state/AppContext';
import { useAuth } from '@/state/AuthContext';
import { useUserDecks } from '@/state/UserDecksContext';
import type { UserMediaUsage } from '@/services/types';

/**
 * Always-visible cloud budget in the sidebar. Deck text counts as well as
 * images, so the bar is the single place a learner can see why a save is
 * approaching the 30 MB limit.
 */
export function StorageMeter() {
  const { t } = useApp();
  const { state: auth } = useAuth();
  const { state: decks } = useUserDecks();
  const [usage, setUsage] = useState<UserMediaUsage | null>(null);

  const fingerprint = decks.decks
    .map((deck) => `${deck.id}:${deck.updatedAt}`)
    .sort()
    .join('|');

  const load = useCallback(async () => {
    if (!auth.user) {
      setUsage(null);
      return;
    }
    try {
      setUsage(await backend.userMedia.usage());
    } catch {
      setUsage(null);
    }
  }, [auth.user]);

  useEffect(() => {
    void load();
  }, [load, fingerprint]);

  useEffect(() => {
    if (!auth.user) return;
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [auth.user, load]);

  if (!auth.user) return null;

  const limit = usage?.limit ?? USER_MEDIA_LIMIT_BYTES;
  const bytes = usage?.bytes ?? 0;
  const ratio = limit > 0 ? bytes / limit : 0;

  return (
    <button
      type="button"
      className={`storage-meter ${ratio >= 0.95 ? 'is-full' : ratio >= 0.8 ? 'is-warn' : ''}`}
      onClick={() => navigate('/settings')}
      title={t('storage.sideLabel')}
    >
      <span className="storage-meter__head">
        <span>{t('storage.sideLabel')}</span>
        <span className="storage-meter__value">
          {usage ? formatBytes(bytes) : '—'} / {formatBytes(limit)}
        </span>
      </span>
      <Meter value={Math.min(1, Math.max(0, ratio))} accent />
      {usage ? (
        <span className="storage-meter__breakdown">
          <span>{t('storage.deckPart', { size: formatBytes(usage.deckBytes) })}</span>
          <span>{t('storage.imagePart', { size: formatBytes(usage.storageBytes) })}</span>
        </span>
      ) : null}
    </button>
  );
}
