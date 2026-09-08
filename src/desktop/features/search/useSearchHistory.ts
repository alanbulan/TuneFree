import { useCallback, useEffect, useState } from 'react';

const historyKey = 'tunefree_search_history';
const loadHistory = (): string[] => {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(historyKey) || '[]');
    return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string').slice(0, 18) : [];
  } catch { return []; }
};

export const useSearchHistory = () => {
  const [history, setHistory] = useState(loadHistory);
  useEffect(() => {
    try { localStorage.setItem(historyKey, JSON.stringify(history)); }
    catch (error) { console.warn('保存搜索历史失败', error); }
  }, [history]);
  const addToHistory = useCallback((term: string) => {
    const clean = term.trim();
    if (clean) setHistory((previous) => [clean, ...previous.filter((item) => item !== clean)].slice(0, 18));
  }, []);
  return { history, setHistory, addToHistory };
};
