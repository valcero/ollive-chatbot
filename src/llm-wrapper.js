import { GoogleGenerativeAI } from '@google/generative-ai';

// Dynamic API endpoint using Vite environment variables
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const INGESTION_ENDPOINT = `${API_BASE_URL}/api/logs`;

async function sendLogToIngestion(metadata) {
  try {
    // In a real application, you would uncomment this fetch call:
    await fetch(INGESTION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
      // Use keepalive or sendBeacon for critical logging during unmount
      keepalive: true 
    });
    
    // For demonstration, we simply log the payload being sent
    console.log('[SDK INGESTION LOG]', JSON.stringify(metadata, null, 2));
  } catch (error) {
    console.error('Failed to send log to ingestion endpoint', error);
  }
}

export class MonitoredChatSession {
  constructor(chatSession, modelName, provider, sessionId) {
    this.chatSession = chatSession;
    this.modelName = modelName;
    this.provider = provider;
    this.sessionId = sessionId;
  }

  async sendMessage(text, options) {
    const startTime = performance.now();
    const timestampStart = new Date().toISOString();
    let status = 'success';
    let error = null;
    let tokenUsage = null;
    let outputText = '';

    try {
      const result = await this.chatSession.sendMessage(text, options);
      const response = await result.response;
      outputText = response.text(); // Capture full output

      if (response.usageMetadata) {
        tokenUsage = {
          promptTokens: response.usageMetadata.promptTokenCount,
          completionTokens: response.usageMetadata.candidatesTokenCount,
          totalTokens: response.usageMetadata.totalTokenCount,
        };
      }
      
      return result;
    } catch (err) {
      if (err.name === 'AbortError' || err.message?.includes('abort')) {
        status = 'cancelled';
        error = 'Request cancelled by user';
      } else {
        status = 'error';
        error = err.message || 'Unknown error';
      }
      throw err;
    } finally {
      const endTime = performance.now();
      const latency = endTime - startTime;
      
      const metadata = {
        model: this.modelName,
        provider: this.provider,
        latencyMs: Math.round(latency),
        tokenUsage,
        timestamps: {
          start: timestampStart,
          end: new Date().toISOString()
        },
        status,
        error,
        sessionId: this.sessionId,
        inputText: text,
        outputText
      };

      // Fire and forget log transmission
      sendLogToIngestion(metadata);
    }
  }
}

export class MonitoredGenerativeAI {
  constructor(apiKey) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.provider = 'google';
  }

  getGenerativeModel(modelParams) {
    const model = this.genAI.getGenerativeModel(modelParams);
    const originalStartChat = model.startChat.bind(model);

    // Override startChat to return our MonitoredChatSession
    model.startChat = (chatParams) => {
      const session = originalStartChat(chatParams);
      // Generate a simple unique session ID if one isn't provided (or for simplicity)
      const sessionId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(7);
      
      return new MonitoredChatSession(
        session,
        modelParams.model,
        this.provider,
        sessionId
      );
    };

    return model;
  }
}
