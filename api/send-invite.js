// api/send-invite.js
// Envoie un email d'invitation à un invité avec lien d'accès direct

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { to, guestEmail, adminName, eventNames, appUrl } = req.body;
  if (!to || !guestEmail || !adminName || !eventNames?.length) {
    return res.status(400).json({ error: 'Paramètres manquants' });
  }

  const baseUrl = appUrl || 'https://splitmeapp.com';
  const accessUrl = `${baseUrl}/?guest=${encodeURIComponent(guestEmail)}`;
  const eventsListHtml = eventNames
    .map(n => `<li style="margin: 6px 0; color: #444;">${n}</li>`)
    .join('');

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Invitation SplitLy</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#0F0F0F;padding:32px 40px;text-align:center;">
              <div style="font-size:28px;font-weight:900;color:#ffffff;letter-spacing:-0.5px;font-family:Georgia,serif;">
                SplitLy
              </div>
              <div style="font-size:12px;color:#888;margin-top:4px;letter-spacing:1px;text-transform:uppercase;">
                Gestion de dépenses partagées
              </div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="font-size:22px;font-weight:700;color:#0F0F0F;margin:0 0 8px;font-family:Georgia,serif;">
                Vous avez été invité 🎉
              </p>
              <p style="font-size:14px;color:#555;margin:0 0 24px;line-height:1.6;">
                <strong style="color:#0F0F0F;">${adminName}</strong> vous invite à accéder aux événements partagés sur SplitLy.
              </p>

              <!-- Événements -->
              <div style="background:#f9f9f9;border-radius:10px;padding:16px 20px;margin-bottom:28px;border:1px solid #eee;">
                <p style="font-size:12px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.8px;margin:0 0 10px;">
                  Événements partagés
                </p>
                <ul style="margin:0;padding-left:20px;">
                  ${eventsListHtml}
                </ul>
              </div>

              <!-- CTA -->
              <div style="text-align:center;margin-bottom:28px;">
                <a href="${accessUrl}"
                   style="display:inline-block;background:#0F0F0F;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:10px;font-size:15px;font-weight:700;letter-spacing:0.3px;">
                  Accéder à mes événements →
                </a>
              </div>

              <!-- Info connexion -->
              <div style="background:#E3F2FD;border-radius:10px;padding:14px 18px;margin-bottom:20px;border:1px solid #BBDEFB;">
                <p style="font-size:13px;color:#1565C0;margin:0;line-height:1.6;">
                  <strong>Comment accéder ?</strong><br/>
                  Cliquez sur le bouton ci-dessus. Sur la page d'accès, entrez votre adresse email 
                  (<strong>${guestEmail}</strong>) et suivez les instructions pour recevoir votre code d'accès.
                  Votre session sera mémorisée 30 jours sur votre appareil.
                </p>
              </div>

              <p style="font-size:12px;color:#aaa;margin:0;line-height:1.6;">
                Si vous n'attendiez pas cette invitation, vous pouvez ignorer cet email. 
                Aucune action ne sera effectuée sur votre compte.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9f9f9;padding:20px 40px;border-top:1px solid #eee;text-align:center;">
              <p style="font-size:11px;color:#aaa;margin:0;">
                © ${new Date().getFullYear()} SplitLy · <a href="${baseUrl}" style="color:#aaa;text-decoration:none;">splitmeapp.com</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'SplitLy <noreply@splitmeapp.com>',
        to,
        subject: `${adminName} vous invite sur SplitLy`,
        html,
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data });
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
