import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://okwucwvdmdsepqkkmnug.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rd3Vjd3ZkbWRzZXBxa2ttbnVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMzU5NTksImV4cCI6MjA5MjkxMTk1OX0.9p9hdCQWNKCLLNCaxxwE6eJIKntjk-v_d9rMo4Yklhs';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── AUTH ─────────────────────────────────────────────────────
export async function signUp(email, password, fullName) {
  const { data, error } = await supabase.auth.signUp({
    email, password, options: { data: { full_name: fullName } },
  });
  return { data, error };
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
}

export async function signOut() {
  return await supabase.auth.signOut();
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

// ─── GUEST ACCESS ─────────────────────────────────────────────
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function sendGuestCode(email, adminUserId) {
  const code = generateCode();
  // Upsert le code pour cet email
  const { error } = await supabase
    .from('guest_codes')
    .upsert({ email, code, created_by: adminUserId }, { onConflict: 'email' });
  if (error) return { error };

  // Envoyer l'email via Supabase Edge Function ou directement
  // Pour l'instant on stocke le code et on le retourne pour test
  // En production: connecter à un service email (Resend, SendGrid etc.)
  console.log(`Code pour ${email}: ${code}`); // À remplacer par vrai email
  return { code, error: null };
}

export async function verifyGuestCode(email, code) {
  const { data, error } = await supabase
    .from('guest_codes')
    .select('*')
    .eq('email', email)
    .eq('code', code)
    .single();
  if (error || !data) return { valid: false };
  // Mettre à jour last_used
  await supabase.from('guest_codes').update({ last_used: new Date().toISOString() }).eq('email', email);
  return { valid: true, data };
}

export async function fetchGuestEvents(email) {
  // Récupérer les événements auxquels cet invité a accès
  const { data: invitations } = await supabase
    .from('invitations')
    .select('event_id, role, status')
    .eq('email', email)
    .eq('status', 'accepted');

  if (!invitations || invitations.length === 0) {
    // Essayer aussi avec status pending
    const { data: pending } = await supabase
      .from('invitations')
      .select('event_id, role, status')
      .eq('email', email);
    return { data: pending || [], error: null };
  }
  return { data: invitations, error: null };
}

export async function fetchGuestEventDetails(eventIds) {
  const { data, error } = await supabase
    .from('events')
    .select('*, event_participants(name)')
    .in('id', eventIds);
  return { data, error };
}

// ─── PENDING ACTIONS ──────────────────────────────────────────
export async function submitPendingAction({ eventId, guestEmail, actionType, actionData }) {
  const { data, error } = await supabase
    .from('pending_actions')
    .insert({ event_id: eventId, guest_email: guestEmail, action_type: actionType, action_data: actionData })
    .select()
    .single();
  return { data, error };
}

export async function fetchPendingActions(eventId) {
  const { data, error } = await supabase
    .from('pending_actions')
    .select('*')
    .eq('event_id', eventId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  return { data, error };
}

export async function fetchAllPendingActions(eventIds) {
  const { data, error } = await supabase
    .from('pending_actions')
    .select('*')
    .in('event_id', eventIds)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  return { data, error };
}

export async function approvePendingAction(actionId, adminUserId, actionData) {
  // Exécuter l'action
  if (actionData.action_type === 'add_expense') {
    const ex = actionData.action_data;
    await supabase.from('expenses').insert({
      event_id: ex.eventId, category: ex.category, sub_category: ex.sub,
      detail: ex.detail, qty: ex.qty, unit_price: ex.unit,
      paid_by: ex.paidBy, included: ex.included, created_by: adminUserId,
    });
  }
  // Marquer comme approuvée
  const { error } = await supabase
    .from('pending_actions')
    .update({ status: 'approved', resolved_at: new Date().toISOString(), resolved_by: adminUserId })
    .eq('id', actionId);
  return { error };
}

export async function rejectPendingAction(actionId, adminUserId) {
  const { error } = await supabase
    .from('pending_actions')
    .update({ status: 'rejected', resolved_at: new Date().toISOString(), resolved_by: adminUserId })
    .eq('id', actionId);
  return { error };
}

// ─── EVENTS ───────────────────────────────────────────────────
export async function fetchEvents(userId) {
  const { data, error } = await supabase
    .from('events')
    .select('*, event_participants(name), invitations(email, role, status)')
    .eq('admin_id', userId)
    .order('created_at', { ascending: false });
  return { data, error };
}

export async function createEvent(event, participants, userId) {
  const { data: ev, error: evErr } = await supabase
    .from('events')
    .insert({ name: event.name, date: event.date, currency: event.currency, admin_id: userId })
    .select().single();
  if (evErr) return { error: evErr };
  const rows = participants.map(name => ({ event_id: ev.id, name }));
  const { error: pErr } = await supabase.from('event_participants').insert(rows);
  if (pErr) return { error: pErr };
  await addHistory({ eventId: ev.id, action: 'Événement créé', actorId: userId, before: null, after: ev });
  return { data: ev, error: null };
}

export async function updateEventStatus(eventId, status) {
  const { data, error } = await supabase.from('events').update({ status }).eq('id', eventId).select().single();
  return { data, error };
}

export async function deleteEvent(eventId) {
  return await supabase.from('events').delete().eq('id', eventId);
}

// ─── PARTICIPANTS ─────────────────────────────────────────────
export async function addParticipant(eventId, name) {
  const { data, error } = await supabase
    .from('event_participants')
    .insert({ event_id: eventId, name })
    .select().single();
  return { data, error };
}

export async function removeParticipant(eventId, name) {
  const { error } = await supabase
    .from('event_participants')
    .delete()
    .eq('event_id', eventId)
    .eq('name', name);
  return { error };
}

// ─── EXPENSES ─────────────────────────────────────────────────
export async function fetchExpenses(eventId) {
  const { data, error } = await supabase
    .from('expenses').select('*').eq('event_id', eventId).order('created_at', { ascending: true });
  return { data, error };
}

export async function createExpense(expense, userId) {
  const { data, error } = await supabase.from('expenses').insert({
    event_id: expense.eventId, category: expense.category, sub_category: expense.sub,
    detail: expense.detail, qty: expense.qty, unit_price: expense.unit,
    paid_by: expense.paidBy, included: expense.included, created_by: userId,
  }).select().single();
  if (!error) await addHistory({ eventId: expense.eventId, action: 'Charge ajoutée', actorId: userId, before: null, after: data });
  return { data, error };
}

export async function updateExpense(expenseId, updates, userId, before) {
  const { data, error } = await supabase.from('expenses').update({
    category: updates.category, sub_category: updates.sub, detail: updates.detail,
    qty: updates.qty, unit_price: updates.unit, paid_by: updates.paidBy,
    included: updates.included, version: (before.version || 1) + 1,
  }).eq('id', expenseId).select().single();
  if (!error) await addHistory({ eventId: before.event_id, action: 'Charge modifiée', actorId: userId, before, after: data });
  return { data, error };
}

export async function deleteExpense(expense, userId) {
  const { error } = await supabase.from('expenses').delete().eq('id', expense.id);
  if (!error) await addHistory({ eventId: expense.event_id, action: 'Charge supprimée', actorId: userId, before: expense, after: null });
  return { error };
}

// ─── CONTRIBUTIONS ────────────────────────────────────────────
export async function fetchContributions(eventId) {
  const { data, error } = await supabase.from('contributions').select('*').eq('event_id', eventId);
  return { data, error };
}

export async function upsertContribution(eventId, participant, amount, userId) {
  const { data, error } = await supabase
    .from('contributions')
    .upsert({ event_id: eventId, participant, amount }, { onConflict: 'event_id,participant' })
    .select().single();
  if (!error) await addHistory({ eventId, action: `Contribution de ${participant}`, actorId: userId, before: null, after: { participant, amount } });
  return { data, error };
}

// ─── HISTORY ──────────────────────────────────────────────────
export async function fetchHistory(eventId) {
  const { data, error } = await supabase
    .from('history').select('*').eq('event_id', eventId).order('created_at', { ascending: true });
  return { data, error };
}

export async function addHistory({ eventId, action, actorId, before, after }) {
  await supabase.from('history').insert({
    event_id: eventId, action, actor_id: actorId, before_data: before, after_data: after,
  });
}

export async function invalidateHistory(historyId, eventId) {
  const { data: entry } = await supabase.from('history').select('created_at').eq('id', historyId).single();
  if (!entry) return { error: 'Not found' };
  const { error } = await supabase.from('history').update({ invalidated: true })
    .eq('event_id', eventId).gte('created_at', entry.created_at);
  return { error };
}

// ─── NOTIFICATIONS ────────────────────────────────────────────
export async function fetchNotifications(userId) {
  const { data, error } = await supabase
    .from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  return { data, error };
}

export async function addNotificationDB({ userId, eventId, type, message }) {
  await supabase.from('notifications').insert({ user_id: userId, event_id: eventId || null, type, message });
}

export async function markAllNotificationsRead(userId) {
  await supabase.from('notifications').update({ is_read: true }).eq('user_id', userId);
}

export async function deleteNotification(notifId) {
  await supabase.from('notifications').delete().eq('id', notifId);
}

// ─── INVITATIONS ──────────────────────────────────────────────
export async function fetchInvitations(eventId) {
  const { data, error } = await supabase.from('invitations').select('*').eq('event_id', eventId);
  return { data, error };
}

export async function sendInvitation({ eventId, email, role, invitedBy }) {
  const { data, error } = await supabase
    .from('invitations')
    .upsert({ event_id: eventId, email, role, invited_by: invitedBy, status: 'pending' }, { onConflict: 'event_id,email' })
    .select().single();
  return { data, error };
}

export async function acceptInvitation(eventId, email) {
  const { error } = await supabase.from('invitations').update({ status: 'accepted' }).eq('event_id', eventId).eq('email', email);
  return { error };
}

export async function removeInvitation(eventId, email) {
  const { error } = await supabase.from('invitations').delete().eq('event_id', eventId).eq('email', email);
  return { error };
}

export async function updateInvitationRole(eventId, email, role) {
  const { error } = await supabase.from('invitations').update({ role }).eq('event_id', eventId).eq('email', email);
  return { error };
}

// ─── REALTIME ─────────────────────────────────────────────────
export function subscribeToNotifications(userId, callback) {
  return supabase.channel(`notifs-${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, callback)
    .subscribe();
}

export function subscribeToPendingActions(eventIds, callback) {
  return supabase.channel(`pending-actions`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pending_actions' }, callback)
    .subscribe();
}

export function unsubscribe(channel) {
  if (channel) supabase.removeChannel(channel);
}

// ─── PDF EXPORT ───────────────────────────────────────────────
export function exportPDF(ev, evExp, evContribMap, participants) {
  const sym = ev.currency?.split(' ')[1] || '€';
  const budget = evExp.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
  const now = new Date().toLocaleString('fr-FR');

  const computeOwed = (expenses, person) =>
    expenses.reduce((sum, ex) => {
      const inc = ex.included || [];
      if (!inc.includes(person)) return sum;
      return sum + (ex.qty * (ex.unit_price ?? 0)) / inc.length;
    }, 0);

  const rows = evExp.map(ex => {
    const t = ex.qty * (ex.unit_price ?? 0);
    const share = (ex.included || []).length > 0 ? t / ex.included.length : 0;
    return `<tr><td>${ex.category} / ${ex.sub_category}</td><td>${ex.detail}</td><td>${ex.qty}</td><td>${(ex.unit_price ?? 0).toFixed(2)}</td><td>${t.toFixed(2)}</td><td>${ex.paid_by}</td><td>${(ex.included || []).join(', ')}</td><td>${share.toFixed(2)}</td></tr>`;
  }).join('');

  const contribRows = participants.map(p => {
    const owed = computeOwed(evExp, p);
    const paid = evContribMap[p] || 0;
    const net = paid - owed;
    const settled = Math.abs(net) <= 1;
    return `<tr><td>${p}</td><td>${owed.toFixed(2)}</td><td>${paid.toFixed(2)}</td><td style="color:${settled ? 'green' : net < 0 ? 'red' : 'blue'}">${net >= 0 ? '+' : ''}${net.toFixed(2)}</td><td>${settled ? '✓ Soldé' : net < 0 ? 'Doit encore' : 'Trop payé'}</td></tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>SplitLy – ${ev.name}</title>
  <style>
    body{font-family:Arial,sans-serif;padding:32px;color:#222;max-width:900px;margin:auto}
    h1{font-size:22px;margin-bottom:4px}h2{font-size:15px;margin:20px 0 8px;color:#444}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px}
    th{background:#f0f0f0;padding:7px 8px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
    td{padding:6px 8px;border-bottom:1px solid #eee}
    .footer{margin-top:40px;font-size:10px;color:#aaa;border-top:1px solid #eee;padding-top:12px;display:flex;justify-content:space-between}
    .info{background:#f8f8f8;padding:12px 16px;border-radius:8px;margin:16px 0;font-size:13px}
  </style></head><body>
  <h1>${ev.name}</h1>
  <p style="font-size:13px;color:#666">${ev.date} · ${participants.length} participants · ${sym}</p>
  <div class="info"><strong>Budget total :</strong> ${budget.toFixed(2)} ${sym} &nbsp;·&nbsp; <strong>Participants :</strong> ${participants.join(', ')}</div>
  <h2>Détail des charges</h2>
  <table><thead><tr><th>Catégorie</th><th>Détail</th><th>Qté</th><th>Unit.</th><th>Total</th><th>Payé par</th><th>Inclus</th><th>Part/p.</th></tr></thead><tbody>${rows}</tbody></table>
  <h2>Contributions & Soldes</h2>
  <table><thead><tr><th>Participant</th><th>Doit (${sym})</th><th>A versé (${sym})</th><th>Solde</th><th>Statut</th></tr></thead><tbody>${contribRows}</tbody></table>
  <div class="footer"><span>SplitLy — Généré le ${now}</span><span>Document non contractuel · Version du ${now}</span></div>
  </body></html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 500);
}
