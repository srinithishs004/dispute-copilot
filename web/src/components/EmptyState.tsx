import type { ReactNode } from 'react';

type Props = { glyph: ReactNode; title: string; children?: ReactNode; actions?: ReactNode };

export function EmptyState({ glyph, title, children, actions }: Props) {
  return (
    <div className="k-empty">
      <div className="k-empty__glyph" aria-hidden="true">
        {glyph}
      </div>
      <h2 className="empty__title">{title}</h2>
      {children ? <p>{children}</p> : null}
      {actions ? <div className="empty__actions">{actions}</div> : null}
    </div>
  );
}
