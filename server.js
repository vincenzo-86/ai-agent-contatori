const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
const XLSX = require('xlsx');
const fetch = require('node-fetch');

const app = express();
const upload = multer({ dest: '/tmp/uploads/' });

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static('public'));

// Database configuration
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 
    'postgresql://neondb_owner:npg_Mi6ATvx5lVrN@ep-silent-lab-a9y636bg-pooler.gwc.azure.neon.tech/ai_contatori?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

// API Keys
const VAPI_PRIVATE_KEY = process.env.VAPI_PRIVATE_KEY || 'f52ccbc7-4d9a-446a-903f-eca8d4ae5156';
const VAPI_PUBLIC_KEY = process.env.VAPI_PUBLIC_KEY || '6f95e65d-e182-4fec-b72c-a3886c5f8372';
const GATEWAY_API_TOKEN = process.env.GATEWAY_API_TOKEN || 'qsKnr3jISnKqJRSs_HawaUyEQjTpkhLYFVjbEzRc3swX4haONb_IZZkUx7hB3cF-';

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// MANUAL DATABASE INITIALIZATION ENDPOINT
app.get('/init-database', async (req, res) => {
  try {
    console.log('🔧 Initializing database...');
    
    // Create committenti table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS committenti (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(255) NOT NULL,
        codice VARCHAR(50) UNIQUE NOT NULL,
        citta VARCHAR(255),
        servizi TEXT[],
        colore VARCHAR(20),
        contatto_email VARCHAR(255),
        orari_operativi VARCHAR(255),
        descrizione_attivita TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Committenti table created');

    // Create operatori table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS operatori (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(255) NOT NULL,
        telefono VARCHAR(20),
        whatsapp VARCHAR(20),
        zone_competenza TEXT[],
        specializzazioni TEXT[],
        orari_lavoro VARCHAR(255),
        attivo BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Operatori table created');

    // Create contatori table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contatori (
        id SERIAL PRIMARY KEY,
        serial_number VARCHAR(100) UNIQUE NOT NULL,
        customer_name VARCHAR(255),
        customer_phone VARCHAR(20),
        customer_email VARCHAR(255),
        address TEXT,
        service_type VARCHAR(50),
        committente_id INTEGER REFERENCES committenti(id),
        operatore_id INTEGER REFERENCES operatori(id),
        cantiere VARCHAR(255),
        priority VARCHAR(20) DEFAULT 'normale',
        pre_assigned_date DATE,
        pre_assigned_time_slot VARCHAR(50),
        needs_confirmation BOOLEAN DEFAULT false,
        has_scheduled_appointment BOOLEAN DEFAULT false,
        confirmed_date DATE,
        confirmed_time_slot VARCHAR(50),
        modified_from_original BOOLEAN DEFAULT false,
        original_date DATE,
        original_time_slot VARCHAR(50),
        modification_date TIMESTAMP,
        modified_by VARCHAR(100),
        excel_import_batch VARCHAR(255),
        import_date TIMESTAMP DEFAULT NOW(),
        last_updated TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Contatori table created');

    // Create call_logs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS call_logs (
        id SERIAL PRIMARY KEY,
        call_id VARCHAR(255) UNIQUE,
        contatore_id INTEGER REFERENCES contatori(id),
        phone_number VARCHAR(20),
        call_type VARCHAR(50),
        duration INTEGER,
        result VARCHAR(100),
        transcript TEXT,
        ai_responses TEXT,
        call_date TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Call_logs table created');

    // Insert sample data
    await pool.query(`
      INSERT INTO committenti (nome, codice, citta, servizi, colore, contatto_email, orari_operativi, descrizione_attivita)
      VALUES 
        ('Milano Smart City', 'MSC001', 'Milano', ARRAY['acqua', 'gas', 'elettrico'], 'blue', 'operazioni@milanosmart.it', '08:00-18:00', 'Sostituzione contatori smart per rete cittadina Milano'),
        ('Roma Distribuzione', 'RD002', 'Roma', ARRAY['gas', 'elettrico'], 'green', 'tecnici@romadist.it', '07:30-17:30', 'Installazione contatori gas ed elettrici zona Roma Nord')
      ON CONFLICT (codice) DO NOTHING
    `);
    console.log('✅ Sample committenti inserted');

    await pool.query(`
      INSERT INTO operatori (nome, telefono, whatsapp, zone_competenza, specializzazioni)
      VALUES 
        ('Marco Rossi', '+393331234567', '+393331234567', ARRAY['Milano Centro', 'Porta Garibaldi'], ARRAY['acqua', 'gas']),
        ('Luca Bianchi', '+393337654321', '+393337654321', ARRAY['Milano Sud', 'Bocconi'], ARRAY['elettrico', 'multi'])
      ON CONFLICT DO NOTHING
    `);
    console.log('✅ Sample operatori inserted');

    // Insert sample contatori for testing
    await pool.query(`
      INSERT INTO contatori (
        serial_number, customer_name, customer_phone, address,
        service_type, committente_id, operatore_id, cantiere,
        pre_assigned_date, pre_assigned_time_slot, needs_confirmation
      ) VALUES 
        ('M240567891', 'Mario Rossi', '+393331234567', 'Via Roma 123, Milano', 'acqua', 1, 1, 'CNT-MI-001', '2025-06-10', '09:00-12:00', true),
        ('M240567892', 'Laura Bianchi', '+393337654321', 'Corso Buenos Aires 45, Milano', 'gas', 1, 1, 'CNT-MI-001', '2025-06-10', '14:00-17:00', true),
        ('M240567893', 'Giuseppe Verdi', '+393339876543', 'Via Brera 78, Milano', 'elettrico', 1, 2, 'CNT-MI-002', '2025-06-11', '08:00-11:00', true)
      ON CONFLICT (serial_number) DO NOTHING
    `);
    console.log('✅ Sample contatori inserted');

    res.json({
      success: true,
      message: 'Database initialized successfully!',
      tables_created: ['committenti', 'operatori', 'contatori', 'call_logs'],
      sample_data: 'inserted'
    });

  } catch (error) {
    console.error('❌ Database initialization error:', error);
    res.status(500).json({ 
      error: error.message,
      details: 'Failed to initialize database'
    });
  }
});

// Initialize database on startup (with error handling)
const initDatabase = async () => {
  try {
    console.log('🔧 Auto-initializing database on startup...');
    await pool.query('SELECT 1'); // Test connection
    console.log('✅ Database connection successful');
    
    // Try to create tables silently
    try {
      const result = await pool.query('SELECT COUNT(*) FROM contatori');
      console.log('✅ Database already initialized');
    } catch (error) {
      console.log('⚠️ Database not initialized, use /init-database endpoint');
    }
    
  } catch (error) {
    console.error('❌ Database connection error:', error.message);
  }
};

// VAPI Webhook Handler
app.post('/vapi-webhook', async (req, res) => {
  try {
    const { message, call } = req.body;
    console.log('📞 Vapi webhook:', { type: message?.type, callId: call?.id });

    switch (message?.type) {
      case 'function-call':
        return await handleFunctionCall(req, res);
      case 'status-update':
        if (message.status === 'in-progress') {
          console.log('📞 Call started:', call?.id);
        }
        break;
      case 'transcript':
        await logTranscript(call?.id, message);
        break;
      case 'end-of-call-report':
        await handleEndOfCall(call, message);
        break;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

const handleFunctionCall = async (req, res) => {
  const { message } = req.body;
  const { name, parameters } = message.functionCall;

  try {
    let result;

    switch (name) {
      case 'lookup_contatore':
        result = await lookupContatore(parameters.matricola);
        break;
      case 'conferma_appuntamento':
        result = await confermaAppuntamento(parameters.matricola);
        break;
      case 'riprogramma_appuntamento':
        result = await riprogrammaAppuntamento(parameters.matricola, parameters.nuova_data, parameters.nuovo_orario);
        break;
      case 'escalation_operatore':
        result = await escalationOperatore(parameters.matricola, parameters.motivo);
        break;
      default:
        result = { error: `Function ${name} not recognized` };
    }

    res.json({ result });
  } catch (error) {
    res.json({ result: { error: error.message } });
  }
};

const lookupContatore = async (matricola) => {
  try {
    const query = `
      SELECT c.*, comm.nome as committente_nome, comm.descrizione_attivita,
             op.nome as operatore_nome, op.telefono as operatore_telefono
      FROM contatori c
      LEFT JOIN committenti comm ON c.committente_id = comm.id
      LEFT JOIN operatori op ON c.operatore_id = op.id
      WHERE c.serial_number = $1
    `;
    
    const result = await pool.query(query, [matricola]);
    
    if (result.rows.length === 0) {
      return {
        found: false,
        message: `Matricola ${matricola} non trovata nel sistema. Verifichi di aver digitato correttamente il numero.`
      };
    }

    const contatore = result.rows[0];
    
    return {
      found: true,
      contatore: {
        matricola: contatore.serial_number,
        cliente: contatore.customer_name,
        indirizzo: contatore.address,
        servizio: contatore.service_type,
        committente: contatore.committente_nome,
        operatore: contatore.operatore_nome,
        cantiere: contatore.cantiere,
        preAssignedDate: contatore.pre_assigned_date,
        preAssignedTimeSlot: contatore.pre_assigned_time_slot,
        needsConfirmation: contatore.needs_confirmation,
        hasScheduledAppointment: contatore.has_scheduled_appointment,
        confirmedDate: contatore.confirmed_date,
        confirmedTimeSlot: contatore.confirmed_time_slot,
        descrizioneAttivita: contatore.descrizione_attivita
      }
    };
  } catch (error) {
    return { found: false, error: error.message };
  }
};

const confermaAppuntamento = async (matricola) => {
  try {
    const updateQuery = `
      UPDATE contatori 
      SET has_scheduled_appointment = true,
          confirmed_date = pre_assigned_date,
          confirmed_time_slot = pre_assigned_time_slot,
          needs_confirmation = false,
          last_updated = NOW()
      WHERE serial_number = $1
      RETURNING *
    `;
    
    const result = await pool.query(updateQuery, [matricola]);
    
    if (result.rows.length === 0) {
      return { success: false, message: 'Contatore non trovato' };
    }

    return {
      success: true,
      message: 'Appuntamento confermato con successo. Non riceverà ulteriori comunicazioni.',
      appuntamento: {
        data: result.rows[0].confirmed_date,
        orario: result.rows[0].confirmed_time_slot
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

const riprogrammaAppuntamento = async (matricola, nuovaData, nuovoOrario) => {
  try {
    const originalQuery = `SELECT * FROM contatori WHERE serial_number = $1`;
    const originalResult = await pool.query(originalQuery, [matricola]);
    
    if (originalResult.rows.length === 0) {
      return { success: false, message: 'Contatore non trovato' };
    }

    const original = originalResult.rows[0];

    const updateQuery = `
      UPDATE contatori 
      SET has_scheduled_appointment = true,
          confirmed_date = $2,
          confirmed_time_slot = $3,
          needs_confirmation = false,
          modified_from_original = true,
          original_date = $4,
          original_time_slot = $5,
          modification_date = NOW(),
          modified_by = 'AI_Human_Simulator',
          last_updated = NOW()
      WHERE serial_number = $1
      RETURNING *
    `;
    
    await pool.query(updateQuery, [
      matricola, nuovaData, nuovoOrario,
      original.pre_assigned_date || original.confirmed_date,
      original.pre_assigned_time_slot || original.confirmed_time_slot
    ]);

    await sendOperatorNotification(matricola, original, nuovaData, nuovoOrario);

    return {
      success: true,
      message: `Appuntamento riprogrammato per ${nuovaData} alle ${nuovoOrario}. Operatore notificato.`,
      vecchioAppuntamento: {
        data: original.pre_assigned_date || original.confirmed_date,
        orario: original.pre_assigned_time_slot || original.confirmed_time_slot
      },
      nuovoAppuntamento: {
        data: nuovaData,
        orario: nuovoOrario
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

const sendOperatorNotification = async (matricola, original, nuovaData, nuovoOrario) => {
  try {
    const operatorQuery = `
      SELECT op.telefono, op.nome, c.customer_name, c.address
      FROM contatori c
      JOIN operatori op ON c.operatore_id = op.id
      WHERE c.serial_number = $1
    `;
    
    const result = await pool.query(operatorQuery, [matricola]);
    
    if (result.rows.length === 0) {
      console.log('⚠️ Operatore non trovato');
      return;
    }

    const operator = result.rows[0];
    
    const smsMessage = `🔄 RIPROGRAMMAZIONE

Cliente: ${operator.customer_name}
Matricola: ${matricola}

❌ CANCELLATO:
${original.pre_assigned_date} - ${original.pre_assigned_time_slot}

✅ NUOVO:
${nuovaData} - ${nuovoOrario}

📍 ${operator.address}`;

    await sendSMS(operator.telefono, smsMessage);
    console.log(`📱 SMS inviato a ${operator.nome}`);
    
  } catch (error) {
    console.error('❌ SMS error:', error);
  }
};

const sendSMS = async (phone, message) => {
  try {
    const response = await fetch('https://gatewayapi.com/rest/mtsms', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GATEWAY_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sender: 'AI-Contatori',
        message: message,
        recipients: [{ msisdn: phone.replace('+', '') }]
      })
    });

    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ SMS sent:', phone);
      return { success: true, result };
    } else {
      console.error('❌ SMS error:', result);
      return { success: false, error: result };
    }
  } catch (error) {
    console.error('❌ GatewayAPI error:', error);
    return { success: false, error: error.message };
  }
};

const escalationOperatore = async (matricola, motivo) => {
  try {
    await pool.query(`
      INSERT INTO call_logs (contatore_id, call_type, result, ai_responses, call_date)
      SELECT id, 'escalation', $2, $3, NOW()
      FROM contatori WHERE serial_number = $1
    `, [matricola, 'escalation_richiesta', `Motivo: ${motivo}`]);

    return {
      success: true,
      message: 'La sto trasferendo al nostro operatore specializzato che la contatterà a breve.',
      escalationId: Date.now()
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Excel import
app.post('/upload-excel', upload.single('excelFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nessun file caricato' });
    }

    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    let importedCount = 0;
    const batchId = `BATCH_${Date.now()}`;

    for (const row of data) {
      try {
        await pool.query(`
          INSERT INTO contatori (
            serial_number, customer_name, customer_phone, address,
            service_type, committente_id, operatore_id, cantiere,
            pre_assigned_date, pre_assigned_time_slot, needs_confirmation,
            excel_import_batch, priority
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11, $12)
          ON CONFLICT (serial_number) DO UPDATE SET
            pre_assigned_date = EXCLUDED.pre_assigned_date,
            pre_assigned_time_slot = EXCLUDED.pre_assigned_time_slot,
            needs_confirmation = true,
            last_updated = NOW()
        `, [
          row.Matricola,
          row.Cliente,
          row.Telefono,
          row.Indirizzo,
          row.Servizio?.toLowerCase(),
          row.Committente_ID || 1,
          row.Operatore_ID || 1,
          row.Cantiere,
          row.Data_Programmata,
          row.Fascia_Oraria,
          batchId,
          row.Priorita || 'normale'
        ]);
        
        importedCount++;
      } catch (error) {
        console.error('Excel row error:', error.message);
      }
    }

    res.json({
      success: true,
      message: `Import completato: ${importedCount} contatori importati`,
      stats: { imported: importedCount, batchId }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API endpoints
app.get('/api/dashboard', async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_contatori,
        COUNT(*) FILTER (WHERE needs_confirmation = true) as da_confermare,
        COUNT(*) FILTER (WHERE has_scheduled_appointment = true) as confermati,
        COUNT(*) FILTER (WHERE modified_from_original = true) as modificati_ai
      FROM contatori
    `);

    const recentCalls = await pool.query(`
      SELECT cl.*, c.customer_name, c.serial_number
      FROM call_logs cl
      LEFT JOIN contatori c ON cl.contatore_id = c.id
      ORDER BY cl.call_date DESC
      LIMIT 10
    `);

    res.json({
      stats: stats.rows[0],
      recentCalls: recentCalls.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/contatori', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*, comm.nome as committente_nome, op.nome as operatore_nome
      FROM contatori c
      LEFT JOIN committenti comm ON c.committente_id = comm.id
      LEFT JOIN operatori op ON c.operatore_id = op.id
      ORDER BY c.last_updated DESC
      LIMIT 100
    `);

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const logTranscript = async (callId, transcript) => {
  try {
    await pool.query(`
      INSERT INTO call_logs (call_id, transcript, call_date)
      VALUES ($1, $2, NOW())
      ON CONFLICT (call_id) DO UPDATE SET
        transcript = call_logs.transcript || ' | ' || EXCLUDED.transcript
    `, [callId, JSON.stringify(transcript)]);
  } catch (error) {
    console.error('Transcript log error:', error);
  }
};

const handleEndOfCall = async (call, report) => {
  try {
    await pool.query(`
      UPDATE call_logs 
      SET duration = $2, result = $3, ai_responses = $4
      WHERE call_id = $1
    `, [
      call.id,
      report.call?.duration || 0,
      report.summary || 'completed',
      JSON.stringify(report)
    ]);
  } catch (error) {
    console.error('End call log error:', error);
  }
};

// Dashboard HTML
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>AI Agent Contatori - Dashboard</title>
        <meta charset="utf-8">
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
            .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h1 { color: #333; }
            .status { padding: 15px; margin: 10px 0; border-radius: 5px; }
            .success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
            .info { background: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb; }
            .warning { background: #fff3cd; color: #856404; border: 1px solid #ffeaa7; }
            .endpoint { background: #f8f9fa; padding: 10px; margin: 5px 0; border-left: 3px solid #007bff; }
            button { background: #007bff; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin: 5px; }
            button:hover { background: #0056b3; }
            .init-btn { background: #28a745; }
            .init-btn:hover { background: #218838; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚀 AI Agent Contatori - Sistema Operativo</h1>
            
            <div class="status success">
                ✅ Backend attivo e funzionante
            </div>
            
            <div class="status warning">
                ⚠️ Se vedi errori database, clicca "Inizializza Database" qui sotto
            </div>
            
            <h3>🔧 Database Setup:</h3>
            <button class="init-btn" onclick="initDatabase()">🛠️ Inizializza Database</button>
            
            <h3>📊 API Endpoints:</h3>
            <div class="endpoint"><strong>GET /init-database</strong> - Inizializza database e tabelle</div>
            <div class="endpoint"><strong>POST /vapi-webhook</strong> - Webhook per Vapi.ai</div>
            <div class="endpoint"><strong>GET /api/dashboard</strong> - Statistiche sistema</div>
            <div class="endpoint"><strong>POST /upload-excel</strong> - Import contatori</div>
            
            <h3>🔧 Test Rapidi:</h3>
            <button onclick="testDashboard()">Test Dashboard API</button>
            <button onclick="testWebhook()">Test Webhook</button>
            <button onclick="testContatori()">Test Contatori</button>
            
            <div id="results" style="margin-top: 20px;"></div>
            
            <h3>📱 Prossimi Passi:</h3>
            <ol>
                <li><strong>Inizializza database</strong> (clicca bottone sopra)</li>
                <li>Configura Voice Agent su Vapi.ai con questo URL webhook</li>
                <li>Testa con matricola: M240567891</li>
                <li>Go-live!</li>
            </ol>
        </div>
        
        <script>
            async function initDatabase() {
                try {
                    document.getElementById('results').innerHTML = '<div class="status info">🔧 Inizializzando database...</div>';
                    const response = await fetch('/init-database');
                    const data = await response.json();
                    if (data.success) {
                        document.getElementById('results').innerHTML = 
                            '<div class="status success">✅ Database inizializzato: ' + JSON.stringify(data, null, 2) + '</div>';
                    } else {
                        document.getElementById('results').innerHTML = 
                            '<div class="status error">❌ Errore: ' + JSON.stringify(data, null, 2) + '</div>';
                    }
                } catch (error) {
                    document.getElementById('results').innerHTML = 
                        '<div class="status error">❌ Errore: ' + error.message + '</div>';
                }
            }
            
            async function testDashboard() {
                try {
                    const response = await fetch('/api/dashboard');
                    const data = await response.json();
                    document.getElementById('results').innerHTML = 
                        '<div class="status success">✅ Dashboard: ' + JSON.stringify(data, null, 2) + '</div>';
                } catch (error) {
                    document.getElementById('results').innerHTML = 
                        '<div class="status error">❌ Errore: ' + error.message + '</div>';
                }
            }
            
            async function testWebhook() {
                try {
                    const response = await fetch('/vapi-webhook', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ message: { type: 'test' } })
                    });
                    const data = await response.json();
                    document.getElementById('results').innerHTML = 
                        '<div class="status success">✅ Webhook: ' + JSON.stringify(data) + '</div>';
                } catch (error) {
                    document.getElementById('results').innerHTML = 
                        '<div class="status error">❌ Errore: ' + error.message + '</div>';
                }
            }
            
            async function testContatori() {
                try {
                    const response = await fetch('/api/contatori');
                    const data = await response.json();
                    document.getElementById('results').innerHTML = 
                        '<div class="status success">✅ Contatori (' + data.length + ' trovati): ' + JSON.stringify(data.slice(0,3), null, 2) + '...</div>';
                } catch (error) {
                    document.getElementById('results').innerHTML = 
                        '<div class="status error">❌ Errore: ' + error.message + '</div>';
                }
            }
        </script>
    </body>
    </html>
  `);
});

// Server startup
const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await initDatabase();
    
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🛠️ Database init: ${process.env.VERCEL_URL || 'http://localhost:3000'}/init-database`);
      console.log(`📞 Vapi webhook: ${process.env.VERCEL_URL || 'http://localhost:3000'}/vapi-webhook`);
      console.log(`📊 Dashboard: ${process.env.VERCEL_URL || 'http://localhost:3000'}`);
      console.log(`✅ System ready!`);
    });
  } catch (error) {
    console.error('❌ Startup error:', error);
  }
};

startServer();

module.exports = app;
