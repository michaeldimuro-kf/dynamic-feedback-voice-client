import { useEffect, useRef } from 'react';
import useStore from '../store/useStore';
import { Message } from '../store/useStore';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { tomorrow } from 'react-syntax-highlighter/dist/esm/styles/prism';
import AudioPlaybackIndicator from './AudioPlaybackIndicator';
import '../styles/Chat.css';

// @ts-ignore
const CodeBlock = ({ className, children }) => {
  // Extract language from className if it exists
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : '';
  
  return (
    <SyntaxHighlighter 
      style={tomorrow}
      language={language}
      PreTag="div"
      className="rounded-md text-sm my-2"
    >
      {String(children).replace(/\n$/, '')}
    </SyntaxHighlighter>
  );
};

// @ts-ignore
const InlineCode = ({ className, children }) => (
  <code className={`${className} bg-neutral-100 px-1.5 py-0.5 rounded text-sm font-mono`}>
    {children}
  </code>
);

interface ChatProps {
  showHeader?: boolean;
}

const Chat = ({ showHeader = false }: ChatProps) => {
  const { messages, clearMessages } = useStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
    
    // Check if content is scrollable and add appropriate class
    if (messagesContainerRef.current) {
      const container = messagesContainerRef.current;
      // Find the nearest parent with a mobile-transcript-panel class
      let parent = container.parentElement;
      while (parent && !parent.classList.contains('mobile-transcript-panel')) {
        parent = parent.parentElement;
      }
      
      if (parent) {
        if (container.scrollHeight > container.clientHeight) {
          parent.classList.add('scrollable');
        } else {
          parent.classList.remove('scrollable');
        }
      }
    }
  }, [messages]);

  return (
    <div className="flex flex-col h-full">
      {showHeader && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200">
          <h2 className="text-lg font-semibold text-neutral-800">Transcription</h2>
          <button 
            className="text-neutral-500 hover:text-neutral-700 transition-colors p-2 rounded-full hover:bg-neutral-100" 
            title="Clear chat" 
            onClick={clearMessages}
            aria-label="Clear transcription"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18"></path>
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      )}
      
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-neutral-400 p-4 text-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="mb-2">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7.01 0 01-7 7m0 0a7 7.01 0 01-7-7m7 7v4m0-11V4" />
            </svg>
            <p>Your transcriptions will appear here</p>
          </div>
        )}
        
        {/* Audio playback indicator */}
        <AudioPlaybackIndicator />
        
        {messages.map((message: Message) => (
          <div 
            key={message.id} 
            className={`rounded-lg p-3 ${
              message.type === 'user' 
                ? 'bg-primary-50 text-neutral-800 border border-primary-100' 
                : 'bg-white border border-neutral-200 shadow-sm'
            }`}
          >
            <div className="flex items-start gap-2">
              <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5 ${
                message.type === 'user' 
                  ? 'bg-primary-500 text-white' 
                  : 'bg-neutral-100 text-neutral-500'
              }`}>
                {message.type === 'user' ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                  </svg>
                )}
              </div>
              <div className="text-sm flex-1">
                <ReactMarkdown 
                  remarkPlugins={[remarkGfm]}
                  components={{
                    // @ts-ignore
                    code({ inline, className, children, ...props }) {
                      return inline ? (
                        <InlineCode className={className} {...props}>
                          {children}
                        </InlineCode>
                      ) : (
                        <CodeBlock className={className} {...props}>
                          {children}
                        </CodeBlock>
                      );
                    }
                  }}
                >
                  {message.text}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
};

export default Chat; 
