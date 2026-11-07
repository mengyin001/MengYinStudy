import deepseekLogo from '@/assets/providers/deepseek.png';
import glmLogo from '@/assets/providers/glm.png';

/**
 * Official provider marks, used as small app-icon tiles next to the model name.
 * The demo provider (development only) falls back to a generic sparkle.
 */
export function ProviderIcon({
  provider,
  size = 22,
  className,
}: {
  provider: string;
  size?: number;
  className?: string;
}) {
  const classes = ['provider-icon', className].filter(Boolean).join(' ');
  const src = provider === 'deepseek' ? deepseekLogo : provider === 'glm' ? glmLogo : null;

  if (src) {
    return (
      <img
        src={src}
        width={size}
        height={size}
        className={classes}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={classes}
      aria-hidden="true"
      focusable="false"
    >
      <rect width="24" height="24" rx="6" fill="#7c5cff" />
      <path
        d="m12 6.5 1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z"
        fill="#fff"
      />
    </svg>
  );
}
