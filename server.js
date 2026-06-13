const express = require('express');
const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// ── ENV VARS (set these in Railway dashboard) ──────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // service role key
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET; // any random string you pick
const PORT = process.env.PORT || 3000;

// ── VAPID setup ────────────────────────────────────────────────
webpush.setVapidDetails(
  'mailto:blockzen@blockzen.app',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// ── Supabase admin client ──────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Gamified notification messages (looks like a game) ─────────
const NOTIF_TITLES = [
  '🎮 BlockZen',
  '🧩 BlockZen',
  '⚡ BlockZen',
  '🏆 BlockZen',
];
const NOTIF_BODIES = [
  'Your daily challenge is ready — can you beat your score?',
  'New blocks unlocked! Your board is waiting.',
  'Someone challenged your high score. Play now!',
  "Don't break your streak — today's puzzle is live.",
  'Your next level is within reach. Keep going!',
  '🔥 Hot streak detected — play now to keep it going.',
  'New achievement unlocked — open BlockZen to claim it!',
  'Your friend just made a move. Your turn!',
];

function getRandomNotif() {
  const title = NOTIF_TITLES[Math.floor(Math.random() * NOTIF_TITLES.length)];
  const body = NOTIF_BODIES[Math.floor(Math.random() * NOTIF_BODIES.length)];
  return { title, body };
}

// ── Health check ───────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'BlockZen push server running' }));

// ── VAPID public key endpoint (app fetches this) ───────────────
app.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// ── Register push subscription ─────────────────────────────────
// Called by the app when user enables notifications
app.post('/subscribe', async (req, res) => {
  const { userId, subscription } = req.body;
  if (!userId || !subscription) {
    return res.status(400).json({ error: 'Missing userId or subscription' });
  }
  try {
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(
        { user_id: userId, subscription: JSON.stringify(subscription), updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    console.error('Subscribe error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Unsubscribe ────────────────────────────────────────────────
app.post('/unsubscribe', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  try {
    await supabase.from('push_subscriptions').delete().eq('user_id', userId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Supabase webhook — fires when new message inserted ─────────
app.post('/webhook/new-message', async (req, res) => {
  // Verify webhook secret
  const secret = req.headers['x-webhook-secret'];
  if (secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const record = req.body?.record;
  if (!record) return res.status(400).json({ error: 'No record' });

  const { conversation_id, sender_id } = record;
  if (!conversation_id || !sender_id) return res.status(400).json({ error: 'Missing fields' });

  try {
    // 1. Find the conversation to get recipient
    const { data: conv } = await supabase
      .from('conversations')
      .select('user1_id, user2_id')
      .eq('id', conversation_id)
      .single();

    if (!conv) return res.json({ skipped: 'conversation not found' });

    // 2. Recipient is the other person (not the sender)
    const recipientId = conv.user1_id === sender_id ? conv.user2_id : conv.user1_id;

    // 3. Look up recipient's push subscription
    const { data: sub } = await supabase
      .from('push_subscriptions')
      .select('subscription')
      .eq('user_id', recipientId)
      .single();

    if (!sub) return res.json({ skipped: 'no subscription for recipient' });

    // 4. Send gamified push notification
    const { title, body } = getRandomNotif();
    const pushSubscription = JSON.parse(sub.subscription);

    await webpush.sendNotification(
      pushSubscription,
      JSON.stringify({
        title,
        body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'blockzen-game',
        renotify: true,
        data: { url: 'https://blockzen-tawny.vercel.app' }
      })
    );

    res.json({ success: true, sent: true });
  } catch (e) {
    // If subscription expired/invalid, remove it
    if (e.statusCode === 410) {
      console.log('Subscription expired, removing...');
      await supabase.from('push_subscriptions').delete().eq('user_id', sender_id);
    }
    console.error('Webhook error:', e.message);
    res.json({ success: false, error: e.message });
  }
});

app.listen(PORT, () => console.log(`BlockZen push server running on port ${PORT}`));
