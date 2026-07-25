import { useCallback, useEffect, useRef, useState } from "react";

interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
  reload: () => void;
}

/** Minimal fetch-state hook: loading / error / data / manual reload. */
export function useQuery<T>(fetcher: () => Promise<T>, deps: unknown[]): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    setError(null);
    fetcher().then(
      (result) => {
        if (!alive.current) return;
        setData(result);
        setLoading(false);
      },
      (err: unknown) => {
        if (!alive.current) return;
        setError(err);
        setLoading(false);
      },
    );
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload };
}
