import { useEffect, useState } from 'react';
import type { UserCollection } from '@/services/types';
import { initialsFor, toneFor } from '@/domain/plaza';
import { Icon } from './Icons';
import { Empty, Note, Sheet } from './ui';
import { useApp } from '@/state/AppContext';

export function CollectionEditorSheet({
  open,
  initial,
  busy,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  initial: UserCollection | null;
  busy: boolean;
  onClose: () => void;
  onSave: (input: { name: string; description: string | null }) => Promise<boolean>;
  onDelete?: () => Promise<void>;
}) {
  const { t } = useApp();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setDescription(initial?.description ?? '');
    setConfirmDelete(false);
    setSubmitting(false);
  }, [open, initial?.id]);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || submitting || busy) return;
    setSubmitting(true);
    const saved = await onSave({
      name: trimmed,
      description: description.trim() || null,
    });
    setSubmitting(false);
    if (saved) onClose();
  };

  const remove = async () => {
    if (!onDelete || submitting || busy) return;
    setSubmitting(true);
    await onDelete();
    setSubmitting(false);
  };

  return (
    <Sheet
      open={open}
      title={initial ? t('collections.editTitle') : t('collections.newTitle')}
      onClose={onClose}
      footer={
        confirmDelete ? (
          <>
            <span className="sheet__hint">{t('collections.deleteTitle')}</span>
            <div className="sheet__actions">
              <button type="button" className="btn btn--quiet btn--sm" onClick={() => setConfirmDelete(false)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn btn--danger btn--sm"
                disabled={submitting || busy}
                onClick={() => void remove()}
              >
                {t('collections.deleteConfirm')}
              </button>
            </div>
          </>
        ) : (
          <>
            {initial && onDelete ? (
              <button
                type="button"
                className="text-btn"
                onClick={() => setConfirmDelete(true)}
                disabled={submitting || busy}
              >
                {t('collections.delete')}
              </button>
            ) : (
              <span />
            )}
            <div className="sheet__actions">
              <button type="button" className="btn btn--quiet btn--sm" onClick={onClose}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={!name.trim() || submitting || busy}
                onClick={() => void save()}
              >
                {submitting || busy
                  ? t('collections.saving')
                  : initial
                    ? t('collections.save')
                    : t('collections.create')}
              </button>
            </div>
          </>
        )
      }
    >
      <div className="collection-form">
        <label className="field">
          <span className="field__label">{t('collections.name')}</span>
          <input
            value={name}
            maxLength={80}
            autoFocus
            placeholder={t('collections.namePlaceholder')}
            onChange={(event) => setName(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void save();
              }
            }}
          />
        </label>
        <label className="field">
          <span className="field__label">{t('collections.description')}</span>
          <textarea
            value={description}
            maxLength={2000}
            rows={3}
            placeholder={t('collections.descriptionPlaceholder')}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        {confirmDelete && initial ? (
          <Note tone="warn">{t('collections.deleteBody', { name: initial.name })}</Note>
        ) : null}
      </div>
    </Sheet>
  );
}

export function CollectionPickerSheet({
  open,
  deckTitle,
  collections,
  initialSelected,
  busy,
  onClose,
  onSave,
  onCreate,
}: {
  open: boolean;
  deckTitle: string;
  collections: readonly UserCollection[];
  initialSelected: readonly string[];
  busy: boolean;
  onClose: () => void;
  onSave: (collectionIds: string[]) => Promise<boolean>;
  onCreate?: () => void;
}) {
  const { t } = useApp();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const initialKey = [...initialSelected].sort().join('|');

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(initialSelected));
    setSubmitting(false);
    // `initialKey` is the stable form of initialSelected; the array itself is
    // rebuilt by the page on every render.
  }, [open, deckTitle, initialKey]);

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    if (submitting || busy) return;
    setSubmitting(true);
    const saved = await onSave([...selected]);
    setSubmitting(false);
    if (saved) onClose();
  };

  return (
    <Sheet
      open={open}
      title={t('collections.pickTitle', { name: deckTitle })}
      onClose={onClose}
      footer={
        <>
          <span className="sheet__hint">{t('collections.pickHint')}</span>
          <div className="sheet__actions">
            <button type="button" className="btn btn--quiet btn--sm" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={submitting || busy}
              onClick={() => void save()}
            >
              {submitting || busy ? t('collections.saving') : t('collections.pickSave')}
            </button>
          </div>
        </>
      }
    >
      {collections.length === 0 ? (
        <Empty
          title={t('collections.pickNone')}
          action={
            onCreate ? (
              <button type="button" className="text-btn" onClick={onCreate}>
                {t('collections.new')}
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="picker-list">
          {collections.map((collection) => {
            const checked = selected.has(collection.id);
            return (
              <label className={`picker-row ${checked ? 'is-on' : ''}`} key={collection.id}>
                <input type="checkbox" checked={checked} onChange={() => toggle(collection.id)} />
                <span className="picker-row__crest" data-tone={toneFor(collection.id)} aria-hidden="true">
                  {initialsFor(collection.name)}
                </span>
                <span className="picker-row__body">
                  <span className="picker-row__name">{collection.name}</span>
                  <span className="picker-row__meta">
                    {collection.deckKeys.length === 1
                      ? t('plaza.deckCountOne', { n: 1 })
                      : t('plaza.deckCount', { n: collection.deckKeys.length })}
                  </span>
                </span>
                <Icon name={checked ? 'check' : 'plus'} size={14} strokeWidth={1.8} />
              </label>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
