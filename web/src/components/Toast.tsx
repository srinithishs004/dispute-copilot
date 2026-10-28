import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { XIcon } from './Icons';

export type ToastTone = 'success' | 'danger' | 'warning' | 'info';
export type ToastInput = { title: string; body?: string; tone?: ToastTone; durationMs?: number };
type ToastItem = Required<Pick<ToastInput, 'title' | 'tone'>> & { id: number; body?: string };

type ToastApi = { show(t: ToastInput): void; dismiss(id: number): void };

const ToastContext = createContext<ToastApi | null>(null);

/** Holds the toast queue and renders it in a polite live region. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const show = useCallback(
    ({ title, body, tone = 'info', durationMs = 5000 }: ToastInput) => {
      const id = nextId.current++;
      // Keep at most three on screen.
      setItems((list) => [...list.slice(-2), { id, title, body, tone }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), durationMs),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" role="status" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div key={t.id} className={`k-toast toast toast--${t.tone}`} role={t.tone === 'danger' ? 'alert' : undefined}>
            <span className="k-toast__dot" aria-hidden="true" />
            <div className="toast__text">
              <div className="k-toast__title">{t.title}</div>
              {t.body ? <div className="k-toast__body">{t.body}</div> : null}
            </div>
            <button
              type="button"
              className="k-btn k-btn--ghost k-btn--sm k-icon-btn toast__close"
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
            >
              <XIcon size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
