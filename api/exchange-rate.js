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
    return res.status(200).json({ rate });
  } catch (err) {
    console.error('Exchange rate fetch error, using fallback:', err);
    return res.status(200).json({ rate: 83.5 });
  }
}
