// Netlify Function: PlantNet API proxy
// Keeps the API key server-side. Accepts { image: base64, filename, lat, lon } as JSON.

const PLANTNET_URL = 'https://my-api.plantnet.org/v2/identify/all';

exports.handler = async function (event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { image, filename, lat, lon } = body;
  if (!image) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing image field' }) };
  }

  const apiKey = process.env.PLANTNET_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  try {
    // Reconstruct the image blob from base64
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');
    const mimeType = image.startsWith('data:') ? image.split(';')[0].split(':')[1] : 'image/jpeg';

    // Build FormData manually (Node 18 has native FormData + Blob)
    const blob = new Blob([imageBuffer], { type: mimeType });
    const fd = new FormData();
    fd.append('images', blob, filename || 'flower.jpg');
    fd.append('organs', 'flower');

    // Build URL with API key + optional GPS
    let url = `${PLANTNET_URL}?lang=he&api-key=${apiKey}`;
    const latitude  = parseFloat(lat);
    const longitude = parseFloat(lon);
    if (!isNaN(latitude) && !isNaN(longitude)) {
      url += `&lat=${latitude}&lon=${longitude}`;
    }

    const response = await fetch(url, { method: 'POST', body: fd });
    const responseBody = await response.text();

    return {
      statusCode: response.status,
      headers,
      body: responseBody,
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
