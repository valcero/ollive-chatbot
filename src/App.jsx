import { useState, useRef, useEffect } from 'react';
import { MonitoredGenerativeAI } from './llm-wrapper';
import ReactMarkdown from 'react-markdown';
import './App.css';

const BotIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 8V4H8" />
    <rect width="16" height="12" x="4" y="8" rx="2" />
    <path d="M2 14h2" />
    <path d="M20 14h2" />
    <path d="M15 13v2" />
    <path d="M9 13v2" />
  </svg>
);

const SettingsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const SendIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m22 2-7 20-4-9-9-4Z" />
    <path d="M22 2 11 13" />
  </svg>
);

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const generateNewSessionId = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(7);

function App() {
  const [apiKey, setApiKey] = useState(() => (localStorage.getItem('gemini_api_key') || '').trim());
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem('gemini_model') || 'gemini-2.5-flash');
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'model', text: 'Hello! I am your AI assistant. How can I help you today?' }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [sessionsList, setSessionsList] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(() => {
    return localStorage.getItem('gemini_current_session') || generateNewSessionId();
  });
  
  const messagesEndRef = useRef(null);
  const chatRef = useRef(null);
  const abortControllerRef = useRef(null);

  // Fetch the list of sessions from the backend
  const fetchSessions = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/sessions`);
      if (res.ok) {
        const data = await res.json();
        setSessionsList(data);
      }
    } catch (err) {
      console.error("Failed to fetch sessions:", err);
    }
  };

  // Initial load
  useEffect(() => {
    fetchSessions();
    if (currentSessionId) {
      handleResumeSession(currentSessionId, true);
    }
  }, []);

  // Sync session changes with list
  useEffect(() => {
    fetchSessions();
  }, [currentSessionId]);

  // Sync API Key & Model Changes
  useEffect(() => {
    const trimmedKey = apiKey.trim();
    if (trimmedKey && chatRef.current) {
      try {
        const genAI = new MonitoredGenerativeAI(trimmedKey);
        const model = genAI.getGenerativeModel({ model: selectedModel });
        // Retrieve existing history of the current chatRef
        const existingHistory = chatRef.current.chatSession ? chatRef.current.chatSession.history : [];
        chatRef.current = model.startChat({
          history: existingHistory,
          generationConfig: {
            maxOutputTokens: 1000,
          },
        });
        chatRef.current.sessionId = currentSessionId;
      } catch (err) {
        console.error("Error re-initializing chat:", err);
      }
    }
  }, [apiKey, selectedModel]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSaveApiKey = (e) => {
    const key = e.target.value.trim();
    setApiKey(key);
    localStorage.setItem('gemini_api_key', key);
  };

  const handleModelChange = (e) => {
    const val = e.target.value;
    setSelectedModel(val);
    localStorage.setItem('gemini_model', val);
  };

  // Resume a past conversation session
  const handleResumeSession = async (sessionId, isInitial = false) => {
    setIsLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/messages`);
      if (!res.ok) throw new Error("Failed to load messages");
      const messagesData = await res.json();

      const uiMessages = messagesData.map(msg => ({
        role: msg.role,
        text: msg.content
      }));

      setMessages(uiMessages.length > 0 ? uiMessages : [
        { role: 'model', text: 'Hello! I am your AI assistant. How can I help you today?' }
      ]);

      setCurrentSessionId(sessionId);
      localStorage.setItem('gemini_current_session', sessionId);

      const trimmedKey = apiKey.trim();
      if (trimmedKey) {
        const genAI = new MonitoredGenerativeAI(trimmedKey);
        const model = genAI.getGenerativeModel({ model: selectedModel });
        
        const formattedHistory = messagesData.map(msg => ({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content }]
        }));

        chatRef.current = model.startChat({
          history: formattedHistory,
          generationConfig: {
            maxOutputTokens: 1000,
          },
        });
        chatRef.current.sessionId = sessionId;
      }
    } catch (err) {
      if (!isInitial) {
        setError("Error loading conversation: " + err.message);
      } else {
        // Fallback: if it's the initial page load and fails, initialize session locally
        handleNewChat(sessionId);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Start a fresh, clean chat session
  const handleNewChat = (specificId = null) => {
    const newId = specificId || generateNewSessionId();
    setCurrentSessionId(newId);
    localStorage.setItem('gemini_current_session', newId);
    setMessages([
      { role: 'model', text: 'Hello! I am your AI assistant. How can I help you today?' }
    ]);
    setError("");
    
    const trimmedKey = apiKey.trim();
    if (trimmedKey) {
      try {
        const genAI = new MonitoredGenerativeAI(trimmedKey);
        const model = genAI.getGenerativeModel({ model: selectedModel });
        chatRef.current = model.startChat({
          history: [],
          generationConfig: {
            maxOutputTokens: 1000,
          },
        });
        chatRef.current.sessionId = newId;
      } catch (err) {
        console.error("Failed to initialize Gemini:", err);
      }
    }
  };

  // Delete a conversation session cascadingly
  const handleDeleteSession = async (e, sessionId) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this conversation?")) return;
    
    try {
      const res = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        if (currentSessionId === sessionId) {
          handleNewChat();
        } else {
          fetchSessions();
        }
      } else {
        setError("Failed to delete session");
      }
    } catch (err) {
      console.error("Error deleting session:", err);
      setError("Error deleting session");
    }
  };

  // Cancel/Abort active generation request
  const handleCancelGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    
    if (!inputValue.trim()) return;
    
    if (!apiKey) {
      setError('Please configure your Gemini API key in settings first.');
      setShowSettings(true);
      return;
    }

    if (!chatRef.current) {
      setError('Chat not initialized correctly. Check your API key.');
      return;
    }

    const userText = inputValue.trim();
    setInputValue('');
    setError('');
    
    // Add user message to UI
    setMessages(prev => [...prev, { role: 'user', text: userText }]);
    setIsLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const result = await chatRef.current.sendMessage(userText, { signal: controller.signal });
      const response = await result.response;
      const botText = response.text();
      
      setMessages(prev => [...prev, { role: 'model', text: botText }]);
    } catch (err) {
      if (err.name === 'AbortError' || err.message?.includes('abort')) {
        setError('Response generation stopped by user.');
        return;
      }
      console.error(err);
      setError(`Error: ${err.message || 'Failed to get response'}`);
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
      fetchSessions(); // Refresh listing to capture preview
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar for listing and managing sessions */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <button className="new-chat-btn" onClick={() => handleNewChat()}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14"/>
              <path d="M12 5v14"/>
            </svg>
            <span>New Chat</span>
          </button>
        </div>
        
        <div className="sidebar-sessions">
          {sessionsList.map((session) => (
            <div 
              key={session.id} 
              className={`session-item ${currentSessionId === session.id ? 'active' : ''}`}
              onClick={() => handleResumeSession(session.id)}
            >
              <div className="session-info">
                <span className="session-preview">
                  {session.preview || "Empty Conversation"}
                </span>
                <span className="session-date">
                  {new Date(session.created_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </span>
              </div>
              <button 
                className="session-delete-btn" 
                onClick={(e) => handleDeleteSession(e, session.id)}
                aria-label="Delete Conversation"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18"/>
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Main Chat area */}
      <div className="chat-main">
        <header className="header">
          <div className="header-title">
            <BotIcon />
            <span>Gemini Chat</span>
            <span className="active-model-tag">{selectedModel}</span>
          </div>
          <button 
            className="settings-btn"
            onClick={() => setShowSettings(!showSettings)}
            aria-label="Settings"
          >
            <SettingsIcon />
          </button>
        </header>

        {showSettings && (
          <div className="settings-panel">
            <h3>Settings</h3>
            <p>Enter your Gemini API key:</p>
            <input 
              type="password" 
              placeholder="AIzaSy..." 
              value={apiKey}
              onChange={handleSaveApiKey}
            />
            <p style={{ marginTop: '10px', marginBottom: '5px' }}>Select Model:</p>
            <select value={selectedModel} onChange={handleModelChange}>
              <option value="gemini-2.5-flash">Gemini 2.5 Flash (Default)</option>
              <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
              <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
              <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
              <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
            </select>
            <p style={{ fontSize: '11px', opacity: 0.7, marginTop: '10px' }}>
              Your key is stored locally in your browser.
            </p>
          </div>
        )}

        <main className="chat-container">
          {error && (
            <div className="error-message">
              {error}
            </div>
          )}
          
          {messages.map((msg, index) => (
            <div key={index} className={`message ${msg.role}`}>
              <div className="message-content">
                {msg.role === 'model' ? (
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                ) : (
                  msg.text
                )}
              </div>
            </div>
          ))}
          
          {isLoading && (
            <div className="loading-container-wrapper">
              <div className="loading-indicator">
                <div className="dot"></div>
                <div className="dot"></div>
                <div className="dot"></div>
              </div>
              <button className="cancel-gen-btn" onClick={handleCancelGeneration} title="Stop Response">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="18" height="18" x="3" y="3" rx="2"/>
                </svg>
                <span>Stop</span>
              </button>
            </div>
          )}
          <div ref={messagesEndRef} />
        </main>

        <footer className="input-area">
          <form className="input-form" onSubmit={handleSendMessage}>
            <input 
              type="text" 
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Type a message..."
              disabled={isLoading}
              autoFocus
            />
            <button 
              type="submit" 
              className="send-btn" 
              disabled={!inputValue.trim() || isLoading}
            >
              <SendIcon />
            </button>
          </form>
        </footer>
      </div>
    </div>
  );
}

export default App;
