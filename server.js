const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const CONFIG = {
  TWILIO_ACCOUNT_SID: process.env.TWILIO_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_TOKEN,
  TWILIO_WHATSAPP_NUMBER: 'whatsapp:+14155238886',
  META_TOKEN: process.env.META_TOKEN,
  CLIENTES: {
    '+5491138413828': 'act_580004939246874'
  }
};

app.get('/', (req, res) => res.json({ status: 'ok', mensaje: 'WonderStudio Bot funcionando' }));

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const from = req.body.From?.replace('whatsapp:', '');
    const texto = req.body.Body?.toLowerCase();
    if (!from || !texto) return;
    console.log('Mensaje de ' + from + ': ' + texto);
    if (!detectarConsulta(texto)) return;
    const adAccountId = CONFIG.CLIENTES[from];
    let respuesta;
    if (!adAccountId) {
      respuesta = 'Hola! No encontre tu cuenta configurada. Contacta a tu asesor de WonderStudio.';
    } else {
      respuesta = await obtenerInfoCampanas(adAccountId);
    }
    await enviarMensaje(req.body.From, respuesta);
  } catch (e) {
    console.error('Error webhook:', e.message);
  }
});

function detectarConsulta(texto) {
  return ['presupuesto','budget','debito','debitar','cobrar','tarjeta','cuanto invierten','cuánto invierten','cuando se debita','cuándo se debita','monto','limite','límite','gasto','inversion','inversión','factura','pago'].some(p => texto.includes(p));
}

async function obtenerInfoCampanas(adAccountId) {
  try {
    console.log('Consultando Meta Ads para:', adAccountId);
    const r = await axios.get('https://graph.facebook.com/v21.0/' + adAccountId + '/campaigns', {
      params: {
        fields: 'name,status,daily_budget,lifetime_budget,insights{spend}',
        access_token: CONFIG.META_TOKEN
      }
    });
    const campanas = r.data.data;
    console.log('Campanas recibidas:', campanas.length);
    if (!campanas || campanas.length === 0) return 'Hola! No hay campanas activas en tu cuenta ahora.';

    const activas = campanas.filter(c => c.status === 'ACTIVE');
    const pausadas = campanas.filter(c => c.status === 'PAUSED');

    let msg = `📊 Resumen Meta Ads WonderStudio:\n\n`;
    msg += `🟢 Campañas activas: ${activas.length}\n`;
    msg += `⏸ Campañas pausadas: ${pausadas.length}\n\n`;

    const totalGasto = campanas.reduce((sum, c) => {
      return sum + parseFloat(c.insights?.data?.[0]?.spend || 0);
    }, 0);

    if (totalGasto > 0) msg += `💰 Total gastado: $${totalGasto.toFixed(2)}\n\n`;

    msg += `Consultá con tu asesor de WonderStudio para más detalles.`;
    return msg;

  } catch (e) {
    console.error('Error Meta Ads completo:', JSON.stringify(e.response?.data));
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
