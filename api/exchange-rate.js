export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!response.ok) throw new Error('Failed to fetch exchange rate');
    const data = await response.json();
    const rate = data.rates?.INR || 83.5;
    // The rate barely moves intraday. Let Vercel's edge cache serve it for an
    // hour (and up to a day while revalidating) so we don't invoke a function
    // or hit the upstream API on every dashboard load — important on free tier.
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ rate });
  } catch (err) {
    console.error('Exchange rate fetch error, using fallback:', err);
    // Cache the fallback only briefly so a transient upstream failure recovers.
    res.setHeader('Cache-Control', 's-maxage=300');
    return res.status(200).json({ rate: 83.5 });
  }
}
