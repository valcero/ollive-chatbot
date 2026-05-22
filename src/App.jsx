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

function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem('gemini_model') || 'gemini-1.5-flash');
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState([
    { role: 'model', text: 'Hello! I am your AI assistant. How can I help you today?' }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  const messagesEndRef = useRef(null);
  const chatRef = useRef(null);

  // Initialize Gemini Chat
  useEffect(() => {
    if (apiKey) {
      try {
        const genAI = new MonitoredGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: selectedModel });
        chatRef.current = model.startChat({
          history: [],
          generationConfig: {
            maxOutputTokens: 1000,
          },
        });
      } catch (err) {
        setError("Failed to initialize Gemini. Check your API key or model availability.");
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
    const key = e.target.value;
    setApiKey(key);
    localStorage.setItem('gemini_api_key', key);
  };

  const handleModelChange = (e) => {
    const val = e.target.value;
    setSelectedModel(val);
    localStorage.setItem('gemini_model', val);
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

    try {
      const result = await chatRef.current.sendMessage(userText);
      const response = await result.response;
      const botText = response.text();
      
      setMessages(prev => [...prev, { role: 'model', text: botText }]);
    } catch (err) {
      console.error(err);
      setError(`Error: ${err.message || 'Failed to get response'}`);
      // Remove the last message from chat history in API if possible, but startChat handles it.
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app-container">
      <header className="header">
        <div className="header-title">
          <BotIcon />
          <span>Gemini Chat</span>
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
            <option value="gemini-1.5-flash">Gemini 1.5 Flash (Default)</option>
            <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
            <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
            <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
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
          <div className="loading-indicator">
            <div className="dot"></div>
            <div className="dot"></div>
            <div className="dot"></div>
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
  );
}

export default App;
