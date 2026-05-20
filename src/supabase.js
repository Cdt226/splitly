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

  // Stocker le code en base
  const { error } = await supabase
    .from('guest_codes')
    .upsert({ email, code, created_by: adminUserId }, { onConflict: 'email' });
  if (error) return { error };

  // Envoyer l'email via la Vercel Function
  try {
    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: email,
        subject: 'Votre code d\'accès SplitLy',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:40px 32px;background:#fff;border-radius:16px">
            <div style="font-family:Georgia,serif;font-size:28px;font-weight:700;color:#0F0F0F;margin-bottom:8px">SplitLy</div>
            <div style="font-size:13px;color:#aaa;margin-bottom:32px">Gestion de dépenses partagées</div>
            <p style="font-size:15px;color:#444;margin-bottom:24px">Voici votre code d'accès :</p>
            <div style="font-size:42px;font-weight:800;letter-spacing:10px;color:#0F0F0F;padding:24px;background:#f5f5f5;border-radius:12px;text-align:center;font-family:monospace">
              ${code}
            </div>
            <p style="color:#888;font-size:13px;margin-top:24px;line-height:1.6">
              Entrez ce code sur la page d'accueil de SplitLy pour accéder aux événements partagés avec vous.<br>
              Ce code est valable indéfiniment.
            </p>
            <div style="margin-top:32px;padding-top:20px;border-top:1px solid #eee;font-size:11px;color:#ccc">
              SplitLy — Gestion de dépenses partagées · splitmeapp.com
            </div>
          </div>
        `,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      console.error('Erreur envoi email:', err);
    }
  } catch (e) {
    console.error('Erreur appel API email:', e);
  }

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
  const type = actionData.action_type;
  const data = actionData.action_data;

  try {
    if (type === 'add_expense') {
      await supabase.from('expenses').insert({
        event_id: data.eventId, category: data.category, sub_category: data.sub,
        detail: data.detail, qty: data.qty, unit_price: data.unit,
        paid_by: data.paidBy, included: data.included, created_by: adminUserId,
        comment: data.comment || null,
      });
    } else if (type === 'modify_expense') {
      if (data.expense_id) {
        await supabase.from('expenses').update({
          category: data.category, sub_category: data.sub,
          detail: data.detail, qty: Number(data.qty), unit_price: Number(data.unit),
          paid_by: data.paidBy, included: data.included, comment: data.comment || null,
        }).eq('id', data.expense_id);
      }
    } else if (type === 'add_cotisation') {
      await supabase.from('cotisations').insert({
        event_id: data.event_id,
        participant_name: data.participant_name,
        montant: Number(data.montant),
        forme: data.forme || 'especes',
        statut: Number(data.montant) > 0 ? 'paye' : 'impaye',
        description: data.description || null,
      });
    } else if (type === 'edit_cotisation') {
      if (data.cotisation_id) {
        await supabase.from('cotisations').update({
          montant: Number(data.montant),
          forme: data.forme,
          statut: Number(data.montant) > 0 ? 'paye' : 'impaye',
          description: data.description || null,
        }).eq('id', data.cotisation_id);
      }
    } else if (type === 'add_participant') {
      await supabase.from('event_participants').insert({
        event_id: actionData.event_id,
        name: data.name,
      });
    }
  } catch (execErr) {
    console.error('approvePendingAction exec error:', execErr);
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
    .neq('archived', true)
    .order('created_at', { ascending: false });
  return { data, error };
}

export async function createEvent(event, participants, userId) {
  const { data: ev, error: evErr } = await supabase
    .from('events')
    .insert({
      name: event.name,
      date: event.date,
      currency: event.currency,
      admin_id: userId,
      event_type: event.event_type || 'split',
      cotisation_cible: event.cotisation_cible || 0,
      nombre_invites: event.nombre_invites || 0,
      allow_multiple_contributions: event.allow_multiple_contributions || false,
    })
    .select().single();
  if (evErr) return { error: evErr };
  const rows = participants.map(name => ({ event_id: ev.id, name }));
  const { error: pErr } = await supabase.from('event_participants').insert(rows);
  if (pErr) return { error: pErr };
  await addHistory({ eventId: ev.id, action: 'Événement créé', actorId: userId, before: null, after: ev });
  return { data: ev, error: null };
}

// ─── COTISATIONS (Option 2 — Budget) ─────────────────────────
export async function fetchCotisations(eventId) {
  const { data, error } = await supabase
    .from('cotisations')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });
  return { data, error };
}

export async function createCotisation(cotisation, actorId = null) {
  const { data, error } = await supabase
    .from('cotisations')
    .insert(cotisation)
    .select().single();
  if (data && !error) {
    await addHistory({ eventId: cotisation.event_id, action: "Cotisation ajoutée", actorId, before: null, after: data });
  }
  return { data, error };
}

export async function updateCotisation(id, updates, actorId = null) {
  // Sauvegarder l'état avant
  const { data: before } = await supabase.from('cotisations').select('*').eq('id', id).single();
  const { data, error } = await supabase
    .from('cotisations')
    .update(updates)
    .eq('id', id)
    .select().single();
  if (data && !error && before) {
    await addHistory({ eventId: before.event_id, action: "Cotisation modifiée", actorId, before, after: data });
  }
  return { data, error };
}

export async function deleteCotisation(id, actorId = null) {
  const { data: before } = await supabase.from('cotisations').select('*').eq('id', id).single();
  const { error } = await supabase.from('cotisations').delete().eq('id', id);
  if (!error && before) {
    await addHistory({ eventId: before.event_id, action: "Cotisation supprimée", actorId, before, after: null });
  }
  return { error };
}


export async function updateEventStatus(eventId, status) {
  const { data, error } = await supabase.from('events').update({ status }).eq('id', eventId).select().single();
  return { data, error };
}

export async function updateEvent(eventId, fields, userId) {
  const { data, error } = await supabase
    .from('events')
    .update(fields)
    .eq('id', eventId)
    .eq('admin_id', userId)
    .select().single();
  return { data, error };
}

export async function deleteEvent(eventId) {
  return await supabase.from('events').delete().eq('id', eventId);
}

export async function archiveEvent(eventId, userId) {
  const { data, error } = await supabase
    .from('events')
    .update({ archived: true, archived_at: new Date().toISOString(), archived_by: userId })
    .eq('id', eventId)
    .select().single();
  return { data, error };
}

export async function restoreEvent(eventId) {
  const { data, error } = await supabase
    .from('events')
    .update({ archived: false, archived_at: null, archived_by: null })
    .eq('id', eventId)
    .select().single();
  return { data, error };
}

export async function fetchArchivedEvents(userId) {
  const { data, error } = await supabase
    .from('events')
    .select('*, event_participants(name)')
    .eq('admin_id', userId)
    .eq('archived', true)
    .order('archived_at', { ascending: false });
  return { data, error };
}

// ─── PARTICIPANTS ─────────────────────────────────────────────
export async function addParticipant(eventId, name, actorId = null) {
  const { data, error } = await supabase
    .from('event_participants')
    .insert({ event_id: eventId, name })
    .select().single();
  if (data && !error) {
    await addHistory({ eventId, action: "Participant ajouté", actorId, before: null, after: { name } });
  }
  return { data, error };
}

export async function removeParticipant(eventId, name, actorId = null) {
  // Nettoyer le participant des tableaux "included" dans les charges
  const { data: expenses } = await supabase
    .from('expenses')
    .select('id, included')
    .eq('event_id', eventId);

  if (expenses) {
    for (const ex of expenses) {
      if ((ex.included || []).includes(name)) {
        const newIncluded = ex.included.filter(p => p !== name);
        await supabase.from('expenses')
          .update({ included: newIncluded })
          .eq('id', ex.id);
      }
    }
  }

  // Supprimer aussi ses contributions
  await supabase.from('contributions')
    .delete()
    .eq('event_id', eventId)
    .eq('participant', name);

  const { error } = await supabase
    .from('event_participants')
    .delete()
    .eq('event_id', eventId)
    .eq('name', name);

  if (!error) {
    await addHistory({ eventId, action: "Participant supprimé", actorId, before: { name }, after: null });
  }
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
    paid_by: expense.is_unpaid ? null : expense.paidBy,
    included: expense.included, created_by: userId,
    is_unpaid: expense.is_unpaid || false,
    comment: expense.comment || null,
    expense_date: expense.expense_date || null,
    original_currency: expense.original_currency || null,
    original_amount: expense.original_amount || null,
    exchange_rate: expense.exchange_rate || null,
    exchange_rate_date: expense.exchange_rate_date || null,
  }).select().single();
  if (!error) {
    await addHistory({ eventId: expense.eventId, action: 'Charge ajoutée', actorId: userId, before: null, after: data });
    await logAudit('expenses', data.id, 'INSERT', null, data, userId);
  }
  return { data, error };
}

export async function updateExpense(expenseId, updates, userId, before) {
  const { data, error } = await supabase.from('expenses').update({
    category: updates.category, sub_category: updates.sub, detail: updates.detail,
    qty: updates.qty, unit_price: updates.unit,
    paid_by: updates.is_unpaid ? null : updates.paidBy,
    included: updates.included,
    is_unpaid: updates.is_unpaid || false,
    comment: updates.comment || null,
    expense_date: updates.expense_date || null,
    original_currency: updates.original_currency || null,
    original_amount: updates.original_amount || null,
    exchange_rate: updates.exchange_rate || null,
    exchange_rate_date: updates.exchange_rate_date || null,
  }).eq('id', expenseId).select().single();
  if (!error) {
    await addHistory({ eventId: before.event_id, action: 'Charge modifiée', actorId: userId, before, after: data });
    await logAudit('expenses', expenseId, 'UPDATE', before, data, userId);
  }
  return { data, error };
}

export async function deleteExpense(expense, userId) {
  const { error } = await supabase.from('expenses').delete().eq('id', expense.id);
  if (!error) {
    await addHistory({ eventId: expense.event_id, action: 'Charge supprimée', actorId: userId, before: expense, after: null });
    await logAudit('expenses', expense.id, 'DELETE', expense, null, userId);
  }
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

export async function recordPayment(eventId, participant, amount, note, userId) {
  const { data, error } = await supabase
    .from('payments')
    .insert({ event_id: eventId, participant, amount, note: note || null, created_by: userId })
    .select().single();
  return { data, error };
}

export async function fetchPayments(eventId) {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false });
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

export async function logAudit(tableName, recordId, action, oldValues, newValues, userId) {
  try {
    await supabase.from('audit_logs').insert({
      table_name: tableName, record_id: recordId, action,
      old_values: oldValues ?? null, new_values: newValues ?? null,
      performed_by: userId || null,
    });
  } catch {}
}

export async function fetchAuditLogs(tableName, recordId) {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .eq('table_name', tableName)
    .eq('record_id', recordId)
    .order('performed_at', { ascending: false });
  return { data, error };
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

export async function sendInvitation({ eventId, email, role, invitedBy, permissions }) {
  const perms = permissions || ["read_only"];
  const { data, error } = await supabase
    .from('invitations')
    .upsert({ event_id: eventId, email, role, invited_by: invitedBy, status: 'pending', permissions: perms }, { onConflict: 'event_id,email' })
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

export async function updateInvitationPermissions(eventId, email, permissions, applyToAll = false) {
  if (applyToAll) {
    // Appliquer à toutes les invitations de cet email
    const { error } = await supabase.from('invitations').update({ permissions }).eq('email', email);
    return { error };
  }
  const { error } = await supabase.from('invitations').update({ permissions }).eq('event_id', eventId).eq('email', email);
  return { error };
}

export async function updatePersonalEventCurrency(eventId, currency) {
  const { data, error } = await supabase
    .from('events')
    .update({ currency })
    .eq('id', eventId)
    .select()
    .single();
  return { data, error };
}

export async function fetchInvitationPermissions(eventId, email) {
  const { data, error } = await supabase
    .from('invitations')
    .select('permissions')
    .eq('event_id', eventId)
    .eq('email', email)
    .single();
  return { data: data?.permissions || ["read_only"], error };
}

export async function requestPermissions(eventId, guestEmail, requestedPermissions) {
  // Crée une notification pour l'admin via pending_actions
  const { data: ev } = await supabase.from('events').select('admin_id, name').eq('id', eventId).single();
  if (!ev) return { error: new Error("Événement introuvable") };
  const { error } = await supabase.from('pending_actions').insert({
    event_id: eventId,
    guest_email: guestEmail,
    action_type: 'request_permissions',
    action_data: { requested: requestedPermissions, event_name: ev.name },
    status: 'pending',
  });
  // Notifier l'admin — email + insertion notification via service role (bypass RLS guest)
  if (!error) {
    fetch('/api/send-notification-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adminId: ev.admin_id,
        eventId,
        guestEmail,
        eventName: ev.name,
        requestedPermissions,
      }),
    }).catch(() => {});
  }
  return { error };
}

// ─── REALTIME ─────────────────────────────────────────────────
export function subscribeToNotifications(userId, callback) {
  return supabase.channel(`notifs-${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, callback)
    .subscribe();
}

export function subscribeToGuestPendingActions(guestEmail, callback) {
  return supabase.channel(`guest-pending-admin-${guestEmail.replace('@', '-')}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pending_actions', filter: `guest_email=eq.${guestEmail}` }, callback)
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

// ─── PDF EXPORT — Style C : Rapport financier ────────────────
export function exportPDF(ev, evExp, evContribMap, participants) {
  const sym = ev.currency?.split(' ')[1] || '€';
  const budget = evExp.reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
  const now = new Date().toLocaleString('fr-FR');
  const dateOnly = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

  const fmt = (n) => {
    const parts = Number(n).toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
    return `${parts.join('.')} ${sym}`;
  };

  const computeOwed = (expenses, person) =>
    expenses.reduce((sum, ex) => {
      const inc = ex.included || [];
      if (!inc.includes(person)) return sum;
      return sum + (ex.qty * (ex.unit_price ?? 0)) / inc.length;
    }, 0);

  // Grouper les charges par catégorie
  const categories = ['Nourriture', 'Boisson', 'Transport', 'Accessoires'];
  const catColors = { Nourriture: '#2E7D32', Boisson: '#1565C0', Transport: '#F57F17', Accessoires: '#6A1B9A' };
  const catIcons = { Nourriture: '🍽️', Boisson: '🥤', Transport: '🚖', Accessoires: '🎉' };

  const expenseRows = evExp.map((ex, i) => {
    const t = ex.qty * (ex.unit_price ?? 0);
    const share = (ex.included || []).length > 0 ? t / ex.included.length : 0;
    const bg = i % 2 === 0 ? '#fff' : '#f9f9f9';
    return `<tr style="background:${bg}">
      <td style="padding:9px 12px">${catIcons[ex.category] || ''} ${ex.sub_category || ''}</td>
      <td style="padding:9px 12px;font-weight:600">${ex.detail}</td>
      <td style="padding:9px 12px;text-align:center">${ex.qty}</td>
      <td style="padding:9px 12px;text-align:right">${fmt(ex.unit_price ?? 0)}</td>
      <td style="padding:9px 12px;text-align:right;font-weight:700">${fmt(t)}</td>
      <td style="padding:9px 12px">${ex.paid_by}</td>
      <td style="padding:9px 12px;font-size:11px;color:#666">${(ex.included || []).join(', ')}</td>
      <td style="padding:9px 12px;text-align:right;color:#2E7D32;font-weight:600">${fmt(share)}</td>
    </tr>`;
  }).join('');

  // Stats par catégorie
  const catStats = categories.map(cat => {
    const total = evExp.filter(e => e.category === cat).reduce((s, e) => s + e.qty * (e.unit_price ?? 0), 0);
    if (total === 0) return '';
    const pct = budget > 0 ? ((total / budget) * 100).toFixed(0) : 0;
    const color = catColors[cat] || '#333';
    return `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-size:12px;font-weight:600">${catIcons[cat]} ${cat}</span>
        <span style="font-size:12px;font-weight:700;color:${color}">${fmt(total)} (${pct}%)</span>
      </div>
      <div style="background:#eee;height:6px;border-radius:3px;overflow:hidden">
        <div style="background:${color};height:6px;width:${pct}%;border-radius:3px"></div>
      </div>
    </div>`;
  }).join('');

  const contribRows = participants.map((p, i) => {
    const owed = computeOwed(evExp, p);
    const paid = evContribMap[p] || 0;
    const net = paid - owed;
    const settled = Math.abs(net) <= 1;
    const hasCharges = owed > 0;
    const statusColor = !hasCharges ? '#aaa' : settled ? '#2E7D32' : net < 0 ? '#C62828' : '#1565C0';
    const statusLabel = !hasCharges ? '—' : settled ? '✓ Soldé' : net < 0 ? `Doit encore ${fmt(Math.abs(net))}` : `Trop payé ${fmt(net)}`;
    const bg = i % 2 === 0 ? '#fff' : '#f9f9f9';
    return `<tr style="background:${bg}">
      <td style="padding:10px 12px;font-weight:600">${p}</td>
      <td style="padding:10px 12px;text-align:right">${hasCharges ? fmt(owed) : '—'}</td>
      <td style="padding:10px 12px;text-align:right">${hasCharges ? fmt(paid) : '—'}</td>
      <td style="padding:10px 12px;text-align:right;font-weight:700;color:${statusColor}">${!hasCharges ? '—' : (net >= 0 ? '+' : '') + fmt(Math.abs(net)).replace(` ${sym}`, '') + ' ' + sym}</td>
      <td style="padding:10px 12px;color:${statusColor};font-weight:600">${statusLabel}</td>
    </tr>`;
  }).join('');

  // Calcul remboursements
  const nets = {};
  participants.forEach(p => { nets[p] = computeOwed(evExp, p) > 0 ? (evContribMap[p] || 0) - computeOwed(evExp, p) : 0; });
  const creditors = Object.entries(nets).filter(([,v]) => v > 1).sort((a,b) => b[1]-a[1]);
  const debtors = Object.entries(nets).filter(([,v]) => v < -1).sort((a,b) => a[1]-b[1]);
  const transactions = [];
  const cr = creditors.map(([p,v]) => ({p, v}));
  const de = debtors.map(([p,v]) => ({p, v: -v}));
  let i = 0, j = 0;
  while (i < cr.length && j < de.length) {
    const amount = Math.min(cr[i].v, de[j].v);
    if (amount > 0.01) transactions.push({ from: de[j].p, to: cr[i].p, amount });
    cr[i].v -= amount; de[j].v -= amount;
    if (cr[i].v <= 0.01) i++;
    if (de[j].v <= 0.01) j++;
  }

  const txRows = transactions.length === 0
    ? '<tr><td colspan="3" style="text-align:center;color:#2E7D32;font-weight:600;padding:16px">✓ Aucun remboursement nécessaire — tout est soldé</td></tr>'
    : transactions.map((t, idx) => `<tr style="background:${idx % 2 === 0 ? '#fff' : '#f9f9f9'}">
        <td style="padding:10px 12px;font-weight:600">${t.from}</td>
        <td style="padding:10px 12px;text-align:center;color:#888">→</td>
        <td style="padding:10px 12px;font-weight:600">${t.to}</td>
        <td style="padding:10px 12px;text-align:right;font-weight:700;color:#C62828">${fmt(t.amount)}</td>
      </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>SplitLy — ${ev.name}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', Arial, sans-serif; color: #1a1a1a; background: #fff; }
    
    /* En-tête */
    .header { background: linear-gradient(135deg, #0F0F0F 0%, #1a1a2e 100%); color: #fff; padding: 36px 40px 28px; }
    .header-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
    .logo { font-size: 28px; font-weight: 800; letter-spacing: -1px; }
    .doc-type { font-size: 11px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: rgba(255,255,255,0.5); margin-bottom: 6px; }
    .event-name { font-size: 22px; font-weight: 700; }
    .header-meta { display: flex; gap: 24px; }
    .meta-item { font-size: 12px; color: rgba(255,255,255,0.6); }
    .meta-value { font-size: 14px; font-weight: 600; color: #fff; margin-top: 2px; }

    /* Résumé */
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; border-bottom: 2px solid #f0f0f0; }
    .summary-item { padding: 20px 24px; border-right: 1px solid #f0f0f0; }
    .summary-item:last-child { border-right: none; }
    .summary-label { font-size: 10px; font-weight: 700; color: #aaa; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
    .summary-value { font-size: 20px; font-weight: 800; color: #0F0F0F; }
    .summary-sub { font-size: 11px; color: #aaa; margin-top: 3px; }

    /* Sections */
    .section { padding: 28px 40px; border-bottom: 1px solid #f5f5f5; }
    .section-title { font-size: 13px; font-weight: 700; color: #0F0F0F; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
    .section-title::before { content: ''; display: inline-block; width: 4px; height: 16px; background: #0F0F0F; border-radius: 2px; }

    /* Tables */
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    thead tr { background: #0F0F0F; color: #fff; }
    thead th { padding: 10px 12px; text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; }
    tbody tr:hover { background: #f5f5f5; }

    /* Catégories */
    .cat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

    /* Footer */
    .footer { padding: 20px 40px; background: #f9f9f9; display: flex; justify-content: space-between; align-items: center; }
    .footer-logo { font-size: 15px; font-weight: 800; color: #0F0F0F; }
    .footer-text { font-size: 10px; color: #aaa; text-align: right; }

    @media print {
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>

  <!-- EN-TÊTE -->
  <div class="header">
    <div class="header-top">
      <div>
        <div class="doc-type">Rapport de dépenses</div>
        <div class="event-name">${ev.name}</div>
      </div>
      <div class="logo">SplitLy</div>
    </div>
    <div class="header-meta">
      <div class="meta-item">
        <div>Date de l'événement</div>
        <div class="meta-value">${ev.date}</div>
      </div>
      <div class="meta-item">
        <div>Participants</div>
        <div class="meta-value">${participants.length} personne${participants.length > 1 ? 's' : ''}</div>
      </div>
      <div class="meta-item">
        <div>Devise</div>
        <div class="meta-value">${ev.currency || sym}</div>
      </div>
      <div class="meta-item">
        <div>Généré le</div>
        <div class="meta-value">${dateOnly}</div>
      </div>
    </div>
  </div>

  <!-- RÉSUMÉ CHIFFRES CLÉS -->
  <div class="summary">
    <div class="summary-item">
      <div class="summary-label">Budget total</div>
      <div class="summary-value">${fmt(budget)}</div>
      <div class="summary-sub">${evExp.length} charge${evExp.length > 1 ? 's' : ''}</div>
    </div>
    <div class="summary-item">
      <div class="summary-label">Part moyenne</div>
      <div class="summary-value">${fmt(participants.length > 0 ? budget / participants.length : 0)}</div>
      <div class="summary-sub">par participant</div>
    </div>
    <div class="summary-item">
      <div class="summary-label">Soldés</div>
      <div class="summary-value">${participants.filter(p => { const o = computeOwed(evExp, p); return o === 0 || Math.abs((evContribMap[p]||0) - o) <= 1; }).length}/${participants.length}</div>
      <div class="summary-sub">participants</div>
    </div>
    <div class="summary-item">
      <div class="summary-label">Statut</div>
      <div class="summary-value" style="color:${ev.status === 'closed' ? '#2E7D32' : '#F57F17'}">${ev.status === 'closed' ? 'Bouclé' : 'En cours'}</div>
      <div class="summary-sub">${ev.status === 'closed' ? 'Données figées' : 'Peut être modifié'}</div>
    </div>
  </div>

  <!-- RÉPARTITION PAR CATÉGORIE -->
  <div class="section">
    <div class="section-title">Répartition par catégorie</div>
    <div class="cat-grid">${catStats}</div>
  </div>

  <!-- DÉTAIL DES CHARGES -->
  <div class="section">
    <div class="section-title">Détail des charges</div>
    <table>
      <thead>
        <tr>
          <th>Catégorie</th>
          <th>Description</th>
          <th style="text-align:center">Qté</th>
          <th style="text-align:right">Unitaire</th>
          <th style="text-align:right">Total</th>
          <th>Payé par</th>
          <th>Participants inclus</th>
          <th style="text-align:right">Part/p.</th>
        </tr>
      </thead>
      <tbody>${expenseRows}</tbody>
      <tfoot>
        <tr style="background:#f0f0f0;font-weight:700">
          <td colspan="4" style="padding:10px 12px;font-size:12px">TOTAL</td>
          <td style="padding:10px 12px;text-align:right;font-size:13px">${fmt(budget)}</td>
          <td colspan="3"></td>
        </tr>
      </tfoot>
    </table>
  </div>

  <!-- CONTRIBUTIONS & SOLDES -->
  <div class="section">
    <div class="section-title">Contributions & Soldes</div>
    <table>
      <thead>
        <tr>
          <th>Participant</th>
          <th style="text-align:right">Part due (${sym})</th>
          <th style="text-align:right">Versé (${sym})</th>
          <th style="text-align:right">Solde</th>
          <th>Statut</th>
        </tr>
      </thead>
      <tbody>${contribRows}</tbody>
    </table>
  </div>

  <!-- REMBOURSEMENTS -->
  <div class="section">
    <div class="section-title">Remboursements à effectuer</div>
    <table>
      <thead>
        <tr>
          <th>De</th>
          <th style="text-align:center"></th>
          <th>Vers</th>
          <th style="text-align:right">Montant</th>
        </tr>
      </thead>
      <tbody>${txRows}</tbody>
    </table>
  </div>

  <!-- FOOTER -->
  <div class="footer">
    <div>
      <div class="footer-logo">SplitLy</div>
      <div style="font-size:10px;color:#aaa;margin-top:2px">Gestion de dépenses partagées</div>
    </div>
    <div class="footer-text">
      <div>Document généré le ${now}</div>
      <div style="margin-top:2px">Document non contractuel — Version de référence au ${now}</div>
    </div>
  </div>

  <script>window.onload = () => setTimeout(() => window.print(), 600);</script>
</body>
</html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
}

// ─── SIGNALEMENTS ─────────────────────────────────────────────
export async function createReport({ userId, userEmail, category, message, eventId }) {
  const { data, error } = await supabase
    .from('reports')
    .insert({ user_id: userId, user_email: userEmail, category, message, event_id: eventId || null })
    .select().single();
  return { data, error };
}

export async function fetchReports() {
  const { data, error } = await supabase
    .from('reports')
    .select('*')
    .order('created_at', { ascending: false });
  return { data, error };
}
export async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  return { data, error };
}

export async function updateProfile(userId, updates) {
  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();
  return { data, error };
}

// ─── SUPER ADMIN ──────────────────────────────────────────────
export async function fetchAdminUsers() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { data: null, error: new Error('Non connecté') };

  const response = await fetch('/api/admin-users', {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
  });
  const json = await response.json();
  if (!response.ok) return { data: null, error: new Error(json.error) };
  return { data: json.users, error: null };
}

export async function adminUserAction(action, userId) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: new Error('Non connecté') };

  const response = await fetch('/api/admin-users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, userId }),
  });
  const json = await response.json();
  if (!response.ok) return { error: new Error(json.error) };
  return { data: json, error: null };
}

// ─── REMINDERS ────────────────────────────────────────────────
export async function sendReminderForEvent(eventId) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: new Error("Not authenticated") };
  const response = await fetch("/api/send-reminder-event", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ eventId }),
  });
  const json = await response.json();
  if (!response.ok) return { error: new Error(json.error || "Erreur serveur") };
  return { data: json, error: null };
}

// ─── PERSONAL EVENT ───────────────────────────────────────────
export async function fetchOrCreatePersonalEvent(userId) {
  const { data: existing } = await supabase
    .from('events')
    .select('*')
    .eq('admin_id', userId)
    .eq('event_type', 'personal')
    .neq('archived', true)
    .maybeSingle();

  if (existing) return { data: existing, error: null };

  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('events')
    .insert({
      name: 'Mes dépenses',
      date: today,
      currency: 'EUR €',
      admin_id: userId,
      event_type: 'personal',
      status: 'open',
    })
    .select()
    .single();

  return { data, error };
}

// ─── PERSONAL BUDGET LIMITS ───────────────────────────────────
export async function fetchPersonalBudgetLimits(userId) {
  const { data, error } = await supabase
    .from('personal_budget_limits')
    .select('*')
    .eq('user_id', userId)
    .order('category');
  return { data: data || [], error };
}

export async function upsertPersonalBudgetLimit(userId, category, monthlyLimit, currency) {
  if (monthlyLimit <= 0) {
    const { error } = await supabase
      .from('personal_budget_limits')
      .delete()
      .eq('user_id', userId)
      .eq('category', category);
    return { error };
  }
  const { data, error } = await supabase
    .from('personal_budget_limits')
    .upsert(
      { user_id: userId, category, monthly_limit: monthlyLimit, currency, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,category' }
    )
    .select()
    .single();
  return { data, error };
}
