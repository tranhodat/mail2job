const U = require('../lib/util');
// Vercel Cron gọi hàm này kèm "Authorization: Bearer CRON_SECRET"
module.exports = U.h(async (req, res) => {
  if (req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET) return res.status(401).end();
  let n = 0;
  for (const e of (await U.get('users')) || []) {
    const ts = (await U.get('t:' + e)) || [];
    for (const t of ts) if (t.step === 0 && !t.error && new Date(t.runAt) <= new Date()) { await U.run(e, t); n++; }
    await U.set('t:' + e, ts);
  }
  res.json({ processed: n });
});
