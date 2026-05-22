const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { z } = require('zod');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const dataDir = process.env.DB_DIR || __dirname;
const dbPath = path.resolve(dataDir, 'telemetry.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database', err);
  } else {
    console.log('Connected to SQLite database.');
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT,
          role TEXT,
          content TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(session_id) REFERENCES sessions(id)
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS inference_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_id INTEGER,
          model TEXT,
          provider TEXT,
          latency_ms INTEGER,
          prompt_tokens INTEGER,
          completion_tokens INTEGER,
          total_tokens INTEGER,
          start_time TEXT,
          end_time TEXT,
          status TEXT,
          error_message TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(message_id) REFERENCES messages(id)
        )
      `);
    });
  }
});

const LogSchema = z.object({
  model: z.string().min(1),
  provider: z.string().min(1),
  latencyMs: z.number().nonnegative(),
  tokenUsage: z.object({
    promptTokens: z.number().nonnegative().optional(),
    completionTokens: z.number().nonnegative().optional(),
    totalTokens: z.number().nonnegative().optional()
  }).nullable().optional(),
  timestamps: z.object({
    start: z.string().datetime(),
    end: z.string().datetime()
  }),
  status: z.enum(['success', 'error', 'cancelled']),
  error: z.string().nullable().optional(),
  sessionId: z.string().min(1),
  inputText: z.string().optional(),
  outputText: z.string().optional()
});

app.post('/api/logs', (req, res) => {
  try {
    const parsedData = LogSchema.parse(req.body);
    const {
      sessionId, model, provider, latencyMs, tokenUsage,
      timestamps, status, error, inputText, outputText
    } = parsedData;

    const promptTokens = tokenUsage?.promptTokens || 0;
    const completionTokens = tokenUsage?.completionTokens || 0;
    const totalTokens = tokenUsage?.totalTokens || 0;

    db.serialize(() => {
      db.run('INSERT OR IGNORE INTO sessions (id) VALUES (?)', [sessionId]);

      if (inputText) {
        db.run('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)', [sessionId, 'user', inputText]);
      }

      let modelContent = outputText || (status === 'error' ? 'Error generating response' : '');
      db.run('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)', [sessionId, 'model', modelContent], function (err) {
        if (err) {
          console.error('Failed to insert model message:', err);
          return res.status(500).json({ error: 'Database error storing message' });
        }

        const modelMessageId = this.lastID;

        db.run(`
          INSERT INTO inference_logs (
            message_id, model, provider, latency_ms, 
            prompt_tokens, completion_tokens, total_tokens, 
            start_time, end_time, status, error_message
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          modelMessageId, model, provider, latencyMs,
          promptTokens, completionTokens, totalTokens,
          timestamps.start, timestamps.end, status, error || null
        ], function (err2) {
          if (err2) {
            console.error('Failed to insert inference log:', err2);
            return res.status(500).json({ error: 'Database error storing telemetry' });
          }
          console.log(`[INGEST] Saved telemetry for session ${sessionId}. Message ID: ${modelMessageId}`);
          res.status(201).json({ success: true, messageId: modelMessageId, inferenceId: this.lastID });
        });
      });
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Validation Error:', error.errors);
      return res.status(400).json({ error: 'Invalid payload format', details: error.errors });
    }
    console.error('Unexpected server error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// list all conversations
app.get('/api/sessions', (req, res) => {
  db.all(`
    SELECT s.id, s.created_at, 
           (SELECT content FROM messages WHERE session_id = s.id ORDER BY id ASC LIMIT 1) as preview
    FROM sessions s
    ORDER BY s.created_at DESC
  `, [], (err, rows) => {
    if (err) {
      console.error('Error fetching sessions:', err);
      return res.status(500).json({ error: 'Database error fetching sessions' });
    }
    res.json(rows);
  });
});

// retrieve complete message history
app.get('/api/sessions/:id/messages', (req, res) => {
  const sessionId = req.params.id;
  db.all(`
    SELECT role, content 
    FROM messages 
    WHERE session_id = ? 
    ORDER BY id ASC
  `, [sessionId], (err, rows) => {
    if (err) {
      console.error('Error fetching session messages:', err);
      return res.status(500).json({ error: 'Database error fetching messages' });
    }
    res.json(rows);
  });
});

//delete a session 
app.delete('/api/sessions/:id', (req, res) => {
  const sessionId = req.params.id;

  db.serialize(() => {
    let aborted = false;
    db.run(`
      DELETE FROM inference_logs 
      WHERE message_id IN (SELECT id FROM messages WHERE session_id = ?)
    `, [sessionId], (err) => {
      if (err) {
        console.error('Error deleting inference logs:', err);
        aborted = true;
        return res.status(500).json({ error: 'Database error deleting telemetry records' });
      }
    });

    db.run(`
      DELETE FROM messages 
      WHERE session_id = ?
    `, [sessionId], (err) => {
      if (aborted) return;
      if (err) {
        console.error('Error deleting messages:', err);
        aborted = true;
        return res.status(500).json({ error: 'Database error deleting conversation messages' });
      }
    });

    db.run(`
      DELETE FROM sessions 
      WHERE id = ?
    `, [sessionId], function (err) {
      if (aborted) return;
      if (err) {
        console.error('Error deleting session:', err);
        return res.status(500).json({ error: 'Database error deleting session' });
      }

      console.log(`[INGEST] Deleted session ${sessionId} and all associated data.`);
      res.json({ success: true, message: `Session ${sessionId} deleted successfully` });
    });
  });
});

app.listen(PORT, () => {
  console.log(`Ingestion server running on http://localhost:${PORT}`);
});
