import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://okwucwvdmdsepqkkmnug.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rd3Vjd3ZkbWRzZXBxa2ttbnVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMzU5NTksImV4cCI6MjA5MjkxMTk1OX0.9p9hdCQWNKCLLNCaxxwE6eJIKntjk-v_d9rMo4Yklhs';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── AUTH HELPERS ─────────────────────────────────────────────────────────────

export async function signUp(email, password, fullName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  return { data, error };
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  return { error };
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

// ─── EVENTS ──────────────────────────────────────────────────────────────────

export async function fetchEvents(userId) {
  const { data, error } = await supabase
    .from('events')
    .select(`
      *,
      event_participants(name),
      invitations(email, role, status)
    `)
    .order('created_at', { ascending: false });
  return { data, error };
}

export async function createEvent(event, participants, userId) {
  const { data: ev, error: evErr } = await supabase
    .from('events')
    .insert({ name: event.name, date: event.date, currency: event.currency, admin_id: userId })
    .select()
    .single();
  if (evErr) return { error: evErr };

  const rows = participants.map(name => ({ event_id: ev.id, name }));
  const { error: pErr } = await supabase.from('event_participants').insert(rows);
  if (pErr) return { error: pErr };

  await addHistory({ eventId: ev.id, action: 'Événement créé', actorId: userId, actorName: null, before: null, after: ev });
  return { data: ev, error: null };
}

export async function updateEventStatus(eventId, status) {
  const { data, error } = await supabase
    .from('events')
    .update({ status })
    .eq('id', eventId)
    .select()
    .single();
  return { data, error };
}

export async function deleteEvent(eventId) {
  const { error } = await supabase.from('events').delete().eq('id', eventId);
  return { error };
}

// ─── EXPENSES ────────────────────────────────────────────────────────────────

export async function fetchExpenses(eventId) {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });
  return { data, error };
}

export async function createExpense(expense, userId) {
  const { data, error } = await supabase
    .from('expenses')
    .insert({
      event_id:     expense.eventId,
      category:     expense.category,
      sub_category: expense.sub,
      detail:       expense.detail,
      qty:          expense.qty,
      unit_price:   expense.unit,
      paid_by:      expense.paidBy,
      included:     expense.included,
      created_by:   userId,
    })
    .select()
    .single();
  if (!error) await addHistory({ eventId: expense.eventId, action: 'Charge ajoutée', actorId: userId, before: null, after: data });
  return { data, error };
}

export async function updateExpense(expenseId, updates, userId, before) {
  const { data, error } = await supabase
    .from('expenses')
    .update({
      category:     updates.category,
      sub_category: updates.sub,
      detail:       updates.detail,
      qty:          updates.qty,
      unit_price:   updates.unit,
      paid_by:      updates.paidBy,
      included:     updates.included,
      version:      (before.version || 1) + 1,
    })
    .eq('id', expenseId)
    .select()
    .single();
  if (!error) await addHistory({ eventId: before.event_id, action: 'Charge modifiée', actorId: userId, before, after: data });
  return { data, error };
}

export async function deleteExpense(expense, userId) {
  const { error } = await supabase.from('expenses').delete().eq('id', expense.id);
  if (!error) await addHistory({ eventId: expense.event_id, action: 'Charge supprimée', actorId: userId, before: expense, after: null });
  return { error };
}

// ─── CONTRIBUTIONS ────────────────────────────────────────────────────────────

export async function fetchContributions(eventId) {
  const { data, error } = await supabase
    .from('contributions')
    .select('*')
    .eq('event_id', eventId);
  return { data, error };
}

export async function upsertContribution(eventId, participant, amount, userId) {
  const { data, error } = await supabase
    .from('contributions')
    .upsert({ event_id: eventId, participant, amount }, { onConflict: 'event_id,participant' })
    .select()
    .single();
  if (!error) await addHistory({ eventId, action: `Contribution de ${participant}`, actorId: userId, before: null, after: { participant, amount } });
  return { data, error };
}

// ─── HISTORY ─────────────────────────────────────────────────────────────────

export async function fetchHistory(eventId) {
  const { data, error } = await supabase
    .from('history')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });
  return { data, error };
}

export async function addHistory({ eventId, action, actorId, actorName, before, after }) {
  await supabase.from('history').insert({
    event_id:    eventId,
    action,
    actor_id:    actorId,
    actor_name:  actorName,
    before_data: before,
    after_data:  after,
  });
}

export async function invalidateHistory(historyId, eventId) {
  // Invalide cette entrée + toutes les ultérieures du même event
  const { data: entry } = await supabase.from('history').select('created_at').eq('id', historyId).single();
  if (!entry) return { error: 'Not found' };
  const { error } = await supabase
    .from('history')
    .update({ invalidated: true })
    .eq('event_id', eventId)
    .gte('created_at', entry.created_at);
  return { error };
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

export async function fetchNotifications(userId) {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return { data, error };
}

export async function addNotificationDB({ userId, eventId, type, message }) {
  const { error } = await supabase.from('notifications').insert({
    user_id:  userId,
    event_id: eventId || null,
    type,
    message,
  });
  return { error };
}

export async function markNotificationRead(notifId) {
  const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', notifId);
  return { error };
}

export async function markAllNotificationsRead(userId) {
  const { error } = await supabase.from('notifications').update({ is_read: true }).eq('user_id', userId);
  return { error };
}

export async function deleteNotification(notifId) {
  const { error } = await supabase.from('notifications').delete().eq('id', notifId);
  return { error };
}

// ─── INVITATIONS ─────────────────────────────────────────────────────────────

export async function fetchInvitations(eventId) {
  const { data, error } = await supabase
    .from('invitations')
    .select('*')
    .eq('event_id', eventId);
  return { data, error };
}

export async function sendInvitation({ eventId, email, role, invitedBy }) {
  const { data, error } = await supabase
    .from('invitations')
    .upsert({ event_id: eventId, email, role, invited_by: invitedBy, status: 'pending' }, { onConflict: 'event_id,email' })
    .select()
    .single();
  return { data, error };
}

export async function updateInvitationRole(eventId, email, role) {
  const { error } = await supabase
    .from('invitations')
    .update({ role })
    .eq('event_id', eventId)
    .eq('email', email);
  return { error };
}

export async function removeInvitation(eventId, email) {
  const { error } = await supabase
    .from('invitations')
    .delete()
    .eq('event_id', eventId)
    .eq('email', email);
  return { error };
}

// ─── ACCESS REQUESTS ─────────────────────────────────────────────────────────

export async function fetchAccessRequests(eventId) {
  const { data, error } = await supabase
    .from('access_requests')
    .select('*, profiles(email, full_name)')
    .eq('event_id', eventId)
    .eq('status', 'pending');
  return { data, error };
}

export async function respondToAccessRequest(requestId, accept, eventId, requesterEmail) {
  const { error } = await supabase
    .from('access_requests')
    .update({ status: accept ? 'accepted' : 'declined' })
    .eq('id', requestId);
  if (!error && accept) {
    await updateInvitationRole(eventId, requesterEmail, 'edit');
  }
  return { error };
}

// ─── REALTIME SUBSCRIPTIONS ───────────────────────────────────────────────────

export function subscribeToEvent(eventId, callbacks) {
  return supabase
    .channel(`event-${eventId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses',      filter: `event_id=eq.${eventId}` }, callbacks.onExpenseChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'contributions', filter: `event_id=eq.${eventId}` }, callbacks.onContributionChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'history',       filter: `event_id=eq.${eventId}` }, callbacks.onHistoryChange)
    .subscribe();
}

export function subscribeToNotifications(userId, callback) {
  return supabase
    .channel(`notifs-${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, callback)
    .subscribe();
}

export function unsubscribe(channel) {
  supabase.removeChannel(channel);
}
