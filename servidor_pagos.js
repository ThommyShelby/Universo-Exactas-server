const express = require('express');
const cors = require('cors');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

// 1. INICIALIZAR FIREBASE (Una sola vez)
const admin = require('firebase-admin');

// Leemos la clave secreta desde la variable de entorno de Render
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// 2. AUTENTICACIÓN CON MERCADO PAGO
const client = new MercadoPagoConfig({ accessToken: 'APP_USR-7255206779217951-030609-12efcf5c59b31376c9b06e5f9491cef5-1078511757' });

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// RUTA 1: CREAR EL LINK DE PAGO
// ==========================================
app.post('/crear_preferencia', async (req, res) => {
  try {
    const { title, price, packId, userId } = req.body;

    const preference = new Preference(client);
    
    const response = await preference.create({
      body: {
        items: [
          {
            id: 'apunte_exactas',
            title: title,
            quantity: 1,
            unit_price: Number(price),
            currency_id: 'ARS',
          }
        ],
        metadata: {
          user_id: userId,
          pack_id: packId
        },
        // ⚠️ CAMBIA ESTA URL POR LA QUE TE DIO RENDER
        // Debe terminar en /webhook
        notification_url: "https://universo-exactas-pagos.onrender.com/webhook"
      }
    });

    res.json({ 
      id: response.id, 
      init_point: response.init_point 
    });

  } catch (error) {
    console.error("Error creando preferencia:", error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// RUTA 2: EL WEBHOOK (LA "ANTENA")
// ==========================================
app.post('/webhook', async (req, res) => {
  // Respondemos 200 rápido para que MP sepa que estamos vivos
  res.status(200).send('OK');

  console.log("=========================================");
  console.log("📥 [RADAR] ¡Alguien interactuó con MP!");
  
  try {
    // MP envía datos de diferentes formas, buscamos el ID del pago
    const paymentId = req.body?.data?.id || req.query?.['data.id'] || req.query?.id;
    const type = req.body?.type || req.body?.action || req.query?.topic;

    console.log(`Tipo de evento: ${type}, ID: ${paymentId}`);

    // Si es un pago, lo vamos a buscar a la base de datos de MP
    if ((type === 'payment' || type === 'payment.created') && paymentId) {
      console.log(`🔍 Verificando el pago ${paymentId} en los servidores de MP...`);

      const paymentData = await new Payment(client).get({ id: paymentId });

      if (paymentData.status === 'approved') {
        const userId = paymentData.metadata.user_id;
        const packId = paymentData.metadata.pack_id;

        console.log(`✅ ¡DINERO RECIBIDO! Entregando apunte [${packId}] al usuario [${userId}]...`);

        // Guardar en Firebase
        const userRef = db.collection('usuarios').doc(userId);
        await userRef.update({
          misApuntes: admin.firestore.FieldValue.arrayUnion(packId)
        });

        console.log(`🚀 ¡Apunte entregado con éxito! El usuario ya puede verlo.`);
      } else {
        console.log(`⏳ El pago ${paymentId} está pendiente o rechazado. Estado: ${paymentData.status}`);
      }
    }
  } catch (error) {
    console.error("❌ Error en el Radar del Webhook:", error);
  }
});

// ==========================================
// INICIAR EL SERVIDOR
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});

