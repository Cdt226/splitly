import { useMemo } from 'react';
import { PERSONAL_CATEGORIES } from '../constants.js';
import { computeNetBalance } from '../utils.js';

export function usePersonalInsights({
  currentMonthExpenses,
  prevMonthExpenses,
  budgetLimits,
  events,
  expenses,
  contributions,
  user,
}) {
  return useMemo(() => {
    const insights = [];

    const totalMonth = currentMonthExpenses.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
    const byCat = {}, byCatPrev = {};

    currentMonthExpenses.forEach(e => {
      const amt = e.qty * (e.unit_price ?? 0);
      byCat[e.category] = (byCat[e.category] || 0) + amt;
    });
    prevMonthExpenses.forEach(e => {
      const amt = e.qty * (e.unit_price ?? 0);
      byCatPrev[e.category] = (byCatPrev[e.category] || 0) + amt;
    });

    // Règle 1 : Budget dépassé ou proche (priorité 0-1)
    budgetLimits.forEach(({ category, monthly_limit }) => {
      const used = byCat[category] || 0;
      if (monthly_limit <= 0 || used <= 0) return;
      const ratio = used / monthly_limit;
      if (ratio >= 1) {
        insights.push({
          id: `budget_over_${category}`,
          type: 'danger',
          icon: '🚨',
          message: `Budget ${category} dépassé : ${Math.round(used)}€ / ${monthly_limit}€.`,
          priority: 0,
        });
      } else if (ratio >= 0.8) {
        insights.push({
          id: `budget_near_${category}`,
          type: 'warning',
          icon: '⚠️',
          message: `${category} : ${Math.round(ratio * 100)}% du budget atteint (${Math.round(used)}€ / ${monthly_limit}€).`,
          priority: 1,
        });
      }
    });

    // Règle 2 : Catégorie dominante > 35% (priorité 2)
    if (totalMonth > 0) {
      Object.entries(byCat).forEach(([cat, amt]) => {
        if (amt / totalMonth > 0.35) {
          const pct = Math.round((amt / totalMonth) * 100);
          insights.push({
            id: `dominant_${cat}`,
            type: 'info',
            icon: PERSONAL_CATEGORIES[cat]?.icon || '🏷️',
            message: `${cat} représente ${pct}% de tes dépenses ce mois (${Math.round(amt)}€).`,
            priority: 2,
          });
        }
      });
    }

    // Règle 3 : Hausse forte vs mois précédent > 40% (priorité 2)
    Object.entries(byCat).forEach(([cat, amt]) => {
      const prev = byCatPrev[cat] || 0;
      if (prev > 20 && (amt - prev) / prev > 0.4) {
        const variation = Math.round(((amt - prev) / prev) * 100);
        insights.push({
          id: `rising_${cat}`,
          type: 'warning',
          icon: '📈',
          message: `${cat} : +${variation}% vs le mois dernier (${Math.round(prev)}€ → ${Math.round(amt)}€).`,
          priority: 2,
        });
      }
    });

    // Règle 4 : Avances Splitly en attente (priorité 3)
    const userFullName = user?.user_metadata?.full_name || '';
    const userFirstName = userFullName.split(' ')[0].toLowerCase();
    let splitlyOwed = 0;

    events
      .filter(e => e.event_type !== 'personal' && e.status === 'open')
      .forEach(ev => {
        const participants = (ev.event_participants || []).map(p => p.name);
        const match = participants.find(p =>
          p.toLowerCase() === userFullName.toLowerCase() ||
          (userFirstName.length >= 3 && p.toLowerCase().startsWith(userFirstName))
        );
        if (!match) return;

        const evExp = expenses.filter(e => e.event_id === ev.id);
        const evContribs = {};
        (contributions[ev.id] || []).forEach(c => { evContribs[c.participant] = c.amount; });
        const net = computeNetBalance(evExp, evContribs, match);
        if (net > 1) splitlyOwed += net;
      });

    splitlyOwed = Math.round(splitlyOwed * 100) / 100;

    if (splitlyOwed > 50) {
      insights.push({
        id: 'splitly_advance',
        type: 'info',
        icon: '🎊',
        message: `Tu as ${splitlyOwed}€ en attente de remboursement sur tes événements Splitly.`,
        priority: 3,
      });
    }

    return insights.sort((a, b) => a.priority - b.priority).slice(0, 4);
  }, [currentMonthExpenses, prevMonthExpenses, budgetLimits, events, expenses, contributions, user]);
}
