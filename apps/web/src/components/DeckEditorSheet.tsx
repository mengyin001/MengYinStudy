import { useEffect, useState } from 'react';
import type { Deck, Question } from '@mengyin/core';
import { questionTypeLabel } from '@/domain/registry';
import { useApp } from '@/state/AppContext';
import { Icon } from './Icons';
import { Note, Sheet } from './ui';

/**
 * Rename an AI-generated deck and prune its questions.
 *
 * Removals are staged until “Save changes”, so a mis-click is undone by
 * cancelling. The deck needs at least one question; deleting the whole deck
 * stays on the library row's remove action.
 */
export function DeckEditorSheet({
  open,
  deck,
  onClose,
  onSave,
}: {
  open: boolean;
  deck: Deck | null;
  onClose: () => void;
  onSave: (edit: { title: string; keepQuestionIds: string[] }) => Promise<boolean>;
}) {
  const { t } = useApp();
  const [title, setTitle] = useState('');
  const [keepIds, setKeepIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(deck?.title ?? '');
    setKeepIds(deck?.questions.map((question) => question.id) ?? []);
    setSubmitting(false);
    // Reset per deck, not per render: the deck object is rebuilt on refresh.
  }, [open, deck?.key]);

  const byId = new Map((deck?.questions ?? []).map((question) => [question.id, question]));
  const kept = keepIds
    .map((id) => byId.get(id))
    .filter((question): question is Question => Boolean(question));
  const canSave = Boolean(title.trim()) && kept.length > 0 && !submitting;

  const removeQuestion = (id: string) => {
    setKeepIds((current) => current.filter((item) => item !== id));
  };

  const save = async () => {
    if (!deck || !canSave) return;
    setSubmitting(true);
    try {
      const saved = await onSave({ title: title.trim(), keepQuestionIds: keepIds });
      if (saved) onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet
      open={open}
      title={t('deckEdit.title')}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="sheet__hint">{t('deckEdit.hint')}</span>
          <div className="sheet__actions">
            <button type="button" className="btn btn--quiet btn--sm" onClick={onClose} disabled={submitting}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={!canSave}
              onClick={() => void save()}
            >
              {submitting ? t('deckEdit.saving') : t('deckEdit.save')}
            </button>
          </div>
        </>
      }
    >
      <div className="deck-edit">
        <label className="field">
          <span className="field__label">{t('deckEdit.name')}</span>
          <input
            type="text"
            value={title}
            maxLength={80}
            autoFocus
            placeholder={t('deckEdit.namePlaceholder')}
            disabled={submitting}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void save();
              }
            }}
          />
          <span className="field__hint">{t('deckEdit.nameHint')}</span>
        </label>

        <div className="deck-edit__head">
          <span className="eyebrow">{t('deckEdit.questions', { n: kept.length })}</span>
          <span className="footnote">{t('deckEdit.keepHint')}</span>
        </div>

        {kept.length === 0 ? (
          <Note tone="warn">{t('deckEdit.needOne')}</Note>
        ) : (
          <div className="preview-list deck-edit__list">
            {kept.map((question, index) => (
              <div className="preview-row deck-edit__row" key={question.id}>
                <span className="preview-row__index">{index + 1}</span>
                <span className="preview-row__prompt" title={question.prompt}>
                  {question.prompt}
                </span>
                <span className="preview-row__meta">{questionTypeLabel(question.type, t)}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t('deckEdit.removeQuestion')}
                  title={t('deckEdit.removeQuestion')}
                  disabled={submitting}
                  onClick={() => removeQuestion(question.id)}
                >
                  <Icon name="trash" size={13} strokeWidth={1.6} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}
