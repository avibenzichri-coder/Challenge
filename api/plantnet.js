// Vercel Function: PlantNet API proxy
// Keeps the API key server-side. Accepts { image: base64, filename } as JSON.

const PLANTNET_URL = 'https://my-api.plantnet.org/v2/identify/all';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { image, filename } = req.body || {};
  if (!image) {
    return res.status(400).json({ error: 'Missing image field' });
  }

  const apiKey = process.env.PLANTNET_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const base64Data  = image.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');
    const mimeType    = image.startsWith('data:') ? image.split(';')[0].split(':')[1] : 'image/jpeg';

    const blob = new Blob([imageBuffer], { type: mimeType });
    const fd   = new FormData();
    fd.append('images', blob, filename || 'flower.jpg');
    fd.append('organs', 'flower');

    const url      = `${PLANTNET_URL}?lang=he&api-key=${apiKey}`;
    const response = await fetch(url, { method: 'POST', body: fd });
    const body     = await response.text();

    return res.status(response.status).send(body);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
