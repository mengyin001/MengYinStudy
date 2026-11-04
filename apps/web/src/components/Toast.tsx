import { useApp } from '@/state/AppContext';
import { Icon } from './Icons';

export function Toast() {
  const { state, actions } = useApp();
  const toast = state.toast;
  if (!toast) return null;
  const icon = toast.kind === 'error' ? 'alert' : toast.kind === 'success' ? 'check' : 'info';
  return (
    <div className={`toast toast--${toast.kind}`} role="status" aria-live="polite">
      <span className="toast__icon">
        <Icon name={icon} size={15} strokeWidth={1.6} />
      </span>
      <span>{toast.message}</span>
      <button type="button" onClick={actions.dismissToast} aria-label="Dismiss">
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}
