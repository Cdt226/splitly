import { useState, useEffect, useCallback } from 'react';
import { fetchPersonalBudgetLimits, upsertPersonalBudgetLimit } from '../supabase.js';

export function usePersonalBudgets(userId) {
  const [limits, setLimits] = useState([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const { data } = await fetchPersonalBudgetLimits(userId);
    setLimits(data || []);
    setLoading(false);
  }, [userId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);

  const setLimit = useCallback(async (category, monthlyLimit, currency) => {
    await upsertPersonalBudgetLimit(userId, category, Number(monthlyLimit) || 0, currency);
    await reload();
  }, [userId, reload]);

  const getLimitForCategory = useCallback(
    (category) => limits.find(l => l.category === category)?.monthly_limit || 0,
    [limits]
  );

  return { limits, loading, setLimit, getLimitForCategory };
}
