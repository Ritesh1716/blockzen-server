const express = require('express');
const webpush = require('web-push');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ── CORS — allow requests from Vercel app ─────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-webhook-secret');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const PORT = process.env.PORT || 3000;

webpush.setVapidDetails(
  'mailto:blockzen@blockzen.app',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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

app.get('/', (req, res) => res.json({ status: 'BlockZen push server running ✅' }));

app.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

app.post('/subscribe', async (req, res) => {
  const { userId, subscription } = req.body;
  if (!userId || !subscription) return res.status(400).json({ error: 'Missing fields' });
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

app.post('/webhook/new-message', async (req, res) => {
  const secret = req.headers['x-webhook-secret'];
  if (secret !== WEBHOOK_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  const record = req.body?.record;
  if (!record) return res.status(400).json({ error: 'No record' });

  const { conversation_id, sender_id } = record;
  if (!conversation_id || !sender_id) return res.status(400).json({ error: 'Missing fields' });

  try {
    const { data: conv } = await supabase
      .from('conversations')
      .select('user1_id, user2_id')
      .eq('id', conversation_id)
      .single();

    if (!conv) return res.json({ skipped: 'conversation not found' });

    const recipientId = conv.user1_id === sender_id ? conv.user2_id : conv.user1_id;

    const { data: sub } = await supabase
      .from('push_subscriptions')
      .select('subscription')
      .eq('user_id', recipientId)
      .single();

    if (!sub) return res.json({ skipped: 'no subscription for recipient' });

    const body = NOTIF_BODIES[Math.floor(Math.random() * NOTIF_BODIES.length)];
    const pushSubscription = JSON.parse(sub.subscription);

    await webpush.sendNotification(
      pushSubscription,
      JSON.stringify({
        title: '🎮 BlockZen',
        body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'blockzen-game',
        renotify: true,
        data: { url: 'https://blockzen-tawny.vercel.app' }
      })
    );

    res.json({ success: true });
  } catch (e) {
    if (e.statusCode === 410) {
      await supabase.from('push_subscriptions').delete().eq('user_id', sender_id);
    }
    console.error('Webhook error:', e.message);
    res.json({ success: false, error: e.message });
  }
});

app.listen(PORT, () => console.log(`BlockZen push server on port ${PORT}`));
