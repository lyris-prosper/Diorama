// next/dynamic for the online demo's plain Vite build: a lazy component with its loading view.
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";

export default function dynamic<P extends object>(load: () => Promise<{ default: ComponentType<P> }>, options?: { loading?: () => ReactNode; ssr?: boolean }) {
  const Lazy = lazy(load);
  return function Dynamic(props: P) {
    return (
      <Suspense fallback={options?.loading?.() ?? null}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}
