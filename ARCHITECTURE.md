# Ollive Chatbot - System Architecture Notes 🌿

This document provides a developer-focused, comprehensive architectural reference for the Ollive Chatbot monorepo. It outlines the monorepo structural blueprint, client-side inference flows, relational database schema design, and transactional safety mechanisms.

---

## 🏗️ 1. Core Architectural Blueprint

Ollive leverages a **Decoupled Monorepo Architecture**. It intentionally separates the heavy generative workloads (LLM inference) from the session tracking and metrics logging workloads.

```mermaid
graph TD
    subgraph Client [Client Interface - React & Vite]
        App[App.jsx React UI] <-->|A. Local State Management| Ref[chatRef Monitored Session]
        Ref -->|B. User Interruption / AbortSignal| Abort[AbortController]
        Ref -->|C. Direct Inference / Low Latency| Gemini[Google Gemini SDK]
        Ref -->|D. Fire-and-Forget Ingest keepalive: true| Ingest[sendLogToIngestion]
    end

    subgraph Cloud [Telemetry Service - Node.js Express & SQLite]
        Ingest -->|E. JSON Payload / Zod Validation| API[/api/logs]
        API -->|F. Serialized Write Queue| DB[(SQLite: telemetry.db)]
    end

    Gemini -.->|Client API Key / LocalStorage| GoogleCloud[Google Generative Language API]
```

### Key Components

1. **Vite React UI Client (`/src`)**: Holds the complete UI layer. To minimize server latency and eliminate backend proxy hosting costs, the client communicates **directly** with Google's Gemini SDK. 
2. **SDK Telemetry Wrapper (`src/llm-wrapper.js`)**: A wrapper around the `@google/generative-ai` SDK. It intercept messages, tracks latency, extracts token usage, and silently pushes logs to the database backend.
3. **Telemetry Ingest Express Server (`/server`)**: A lightweight Node server acting as a database gatekeeper. It enforces schema contracts using Zod and logs metrics.
4. **SQLite Storage Engine (`/server/telemetry.db`)**: A localized, highly efficient SQLite database configured for serial writes to avoid concurrency deadlocks.

---

## 💾 2. Relational Schema & State Design

The database schema is structured to decouple **chat transcripts** from **telemetry logs** while maintaining robust database normalization.

```
   sessions                         messages                          inference_logs
┌───────────────┐               ┌────────────────┐               ┌───────────────────────┐
│ id (TEXT PK)  │──────────────▶│ id (INTEGER PK)│──────────────▶│ id (INTEGER PK)       │
│ created_at    │               │ session_id (FK)│               │ message_id (INTEGER FK)│
└───────────────┘               │ role (TEXT)    │               │ model (TEXT)          │
                                │ content (TEXT) │               │ latency_ms (INTEGER)  │
                                │ created_at     │               │ prompt_tokens (INT)   │
                                └────────────────┘               │ completion_tokens (INT)│
                                                                 │ total_tokens (INT)    │
                                                                 │ status (TEXT)         │
                                                                 │ error_message (TEXT)  │
                                                                 │ created_at            │
                                                                 └───────────────────────┘
```

### Rationale Behind the Design
* **`sessions` & `messages`**: Keep chat threads cleanly grouped by `session_id` (a client-generated UUID). Resuming a chat requires only a single index lookup: `SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC`.
* **`inference_logs`**: Performance metrics are separated from the text transcripts. This ensures queries to compile performance stats (e.g., Average Latency) do not scan heavy raw message content columns, improving database index performance.

---

## 🔄 3. Critical Flow Protocols

### A. Thread-Safe Cascade Session Deletion
When deleting a conversation, we cascade-delete logs across all tables. We handle this securely in Express using SQLite's serialized transaction queue:

```javascript
app.delete('/api/sessions/:id', (req, res) => {
  const sessionId = req.params.id;

  db.serialize(() => {
    let aborted = false;
    
    // 1. Delete associated inference performance metrics
    db.run(`DELETE FROM inference_logs WHERE message_id IN (SELECT id FROM messages WHERE session_id = ?)`, [sessionId], (err) => {
      if (err) { aborted = true; return res.status(500).json({ error: '...' }); }
    });

    // 2. Delete the conversation transcripts
    db.run(`DELETE FROM messages WHERE session_id = ?`, [sessionId], (err) => {
      if (aborted) return;
      if (err) { aborted = true; return res.status(500).json({ error: '...' }); }
    });

    // 3. Delete the parent session metadata
    db.run(`DELETE FROM sessions WHERE id = ?`, [sessionId], function (err) {
      if (aborted) return;
      if (err) return res.status(500).json({ error: '...' });
      res.json({ success: true });
    });
  });
});
```
* **Aborted Safeguard**: Introducing the `aborted` boolean prevents standard node asynchronous race conditions. If step 1 or 2 encounters a locking error, the API immediately responds with a `500` status and halts downstream queries, ensuring no `ERR_HTTP_HEADERS_SENT` crashes occur.

### B. Client-Interrupt & Abort Pipeline
To implement the live generation **Stop** feature, we bind an `AbortController` signal to both the UI loading state and the underlying network request:

1. **Generation Trigger**:
   - `const controller = new AbortController();` is instantiated on form submit.
   - `chatRef.current.sendMessage(userText, { signal: controller.signal })` passes the HTTP client hook to the Gemini API wrapper.
2. **User Aborts**:
   - Clicking the **Stop** button triggers `controller.abort()`.
3. **Telemetry capture**:
   - The SDK wrapper catches the native `AbortError`.
   - The status is immediately updated to `'cancelled'`.
   - It fires `keepalive: true` to `/api/logs` to document the user cancellation before instantly resetting the frontend state.

---

## ☁️ 4. Cloud & Production Topology

When deploying to platforms like **Railway**, we leverage a dual-service setup inside a single canvas to maintain high-security standards:

```
[ Internet ] 
     │
     ├───► [ ollive-frontend (Public Client Node) ] ───► (Direct browser HTTPS calls to Gemini API)
     │
     └───► [ ollive-backend (Internal API Node) ]
                │
           (Mounts to)
                ▼
           [ /app/data Volume ] (Persistent telemetry.db file)
```

* **Data Persistence**: SQLite database changes are written to a persistent cloud volume mounted at `/app/data` with `DB_DIR=/app/data`.
* **CORS & Domain Protection**: The Express backend enforces secure CORS origins, accepting calls only from your verified frontend URL, preventing unauthorized telemetry injection.
