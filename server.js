const express = require('express');
const axios = require('axios');
const { google } = require('googleapis');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const SHEET_ID = '1m6Fvsd33SVYiLNld5veXLw0vYhYfeuTYLCFvJSf6Zow';

const CONFIG = {
  TWILIO_ACCOUNT_SID: process.env.TWILIO_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_TOKEN,
  TWILIO_WHATSAPP_NUMBER: 'whatsapp:+14155238886',
  META_TOKEN: process.env.META_TOKEN,
};

let clientesCache = {};
let cacheTime = 0;

async function cargarClientes() {
  const ahora = Date.now();
  if (ahora - cacheTime < 5 * 60 * 1000 && Object.keys(clientesCache).length > 0) {
    return clientesCache;
  }
  try {
    console.log('Cargando clientes desde Google Sheets...');
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'A2:C200',
    });
    const rows = r.data.values || [];
    const mapa = {};
    for (const row of rows) {
      const telefono = row[0]?.trim();
      const adAccountId = row[1]?.trim();
      if (telefono && adAccountId) {
        mapa[telefono] = adAccountId;
      }
    }
    clientesCache = mapa;
    cacheTime = ahora;
    console.log('Clientes cargados:', Object.keys(mapa).length);
    return mapa;
  } catch (e) {
    console.error('Error cargando clientes:', e.message);
    return clientesCache;
  }
}

app.get('/', (req, res) => res.json({ status: 'ok', mensaje: 'WonderStudio Bot funcionando' }));

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const from = req.body.From?.replace('whatsapp:', '');
    const texto = req.body.Body?.toLowerCase();
    if (!from || !texto) return;
    console.log('Mensaje de ' + from + ': ' + texto);
    if (!detectarConsulta(texto)) return;
    const clientes = await cargarClientes();
    const adAccountId = clientes[from];
    let respuesta;
    if (!adAccountId) {
      respuesta = 'Hola! No encontre tu cuenta configurada. Contacta a tu asesor de WonderStudio.';
    } else {
      respuesta = await obtenerInversion(adAccountId);
    }
    await enviarMensaje(req.body.From, respuesta);
  } catch (e) {
    console.error('Error webhook:', e.message);
  }
});

function detectarConsulta(texto) {
  return ['presupuesto','budget','debito','debitar','cobrar','tarjeta','cuanto invierten','cuánto invierten','cuando se debita','cuándo se debita','monto','limite','límite','gasto','inversion','inversión','factura','pago'].some(p => texto.includes(p));
}

async function obtenerInversion(adAccountId) {
  try {
    console.log('Consultando Meta Ads para:', adAccountId);
    const r = await axios.get('https://graph.facebook.com/v21.0/' + adAccountId + '/adsets', {
      params: {
        fields: 'status,daily_budget,lifetime_budget,campaign_id',
        filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]),
        limit: 100,
        access_token: CONFIG.META_TOKEN
      }
    });

    const adsets = r.data.data || [];
    console.log('Ad sets activos:', adsets.length);

    let totalDiario = 0;
    const campaignIds = new Set();

    for (const a of adsets) {
      if (a.daily_budget) {
        totalDiario += parseInt(a.daily_budget);
      } else {
        campaignIds.add(a.campaign_id);
      }
    }

    if (campaignIds.size > 0) {
      const ids = Array.from(campaignIds).join(',');
      const rc = await axios.get('https://graph.facebook.com/v21.0/', {
        params: {
          ids: ids,
          fields: 'status,daily_budget',
          access_token: CONFIG.META_TOKEN
        }
      });
      for (const camp of Object.values(rc.data)) {
        if (camp.daily_budget) {
          totalDiario += parseInt(camp.daily_budget);
        }
      }
    }

    if (totalDiario === 0) return '💰 No hay presupuesto diario configurado en campañas activas.';
    return `💰 Inversión diaria activa: $${(totalDiario / 100).toFixed(2)}/día`;

  } catch (e) {
    console.error('Error Meta Ads:', JSON.stringify(e.response?.data));
    console.error('Error Meta Ads mensaje:', e.message);
    return 'No pude acceder a los datos ahora. Intenta mas tarde o contacta a tu asesor.';
  }
}

async function enviarMensaje(to, body) {
  const url = 'https://api.twilio.com/2010-04-01/Accounts/' + CONFIG.TWILIO_ACCOUNT_SID + '/Messages.json';
  await axios.post(url,
    new URLSearchParams({ From: CONFIG.TWILIO_WHATSAPP_NUMBER, To: to, Body: body }),
    { auth: { username: CONFIG.TWILIO_ACCOUNT_SID, password: CONFIG.TWILIO_AUTH_TOKEN } }
  );
  console.log('Mensaje enviado a ' + to);
}

app.listen(process.env.PORT || 3000, () => console.log('Bot corriendo'));
