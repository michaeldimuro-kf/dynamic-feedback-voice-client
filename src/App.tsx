import { useEffect, useState, useRef } from 'react'
import Header from './components/Header'
import PDFViewer from './components/PDFViewer'
import Chat from './components/Chat'
import AudioRecorder from './components/AudioRecorder'
import { socketEvents } from './constants/socketEvents'
import useSocket from './hooks/useSocket'
import useStore from './store/useStore'
import './App.css'
import { motion, AnimatePresence } from 'framer-motion'

function App() {
  const { socket, reconnect } = useSocket()
  const [isLoading, setIsLoading] = useState(true)
  // Local state for chat panel visibility
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const mainRef = useRef<HTMLDivElement>(null)
  
  // Use the store 
  const isConnected = useStore(state => state.isConnected);
  const addMessage = useStore(state => state.addMessage);
  const setIsConnected = useStore(state => state.setIsConnected);
  
  // Initialize socket connection when component mounts
  useEffect(() => {
    // Initial connection attempt
    reconnect();
  }, [reconnect]);
  
  // Handle chat panel opening/closing
  const toggleChat = () => {
    setIsChatOpen(!isChatOpen)
  }
  
  // Check if device is mobile
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768)
    }
    
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])
  
  // Handle socket connection and events
  useEffect(() => {
    if (!socket) return
    
    // On successful connection
    socket.on(socketEvents.CONNECT, () => {
      setIsLoading(false)
      setIsConnected(true)
    })
    
    // On message received
    socket.on(socketEvents.MESSAGE, (data: any) => {
      if (data?.text) {
        addMessage(data.text, 'bot', false)
      }
    })
    
    // Error handling
    socket.on(socketEvents.CONNECT_ERROR, () => {
      console.error('Socket connection error')
      setIsLoading(false)
      setIsConnected(false)
    })
    
    return () => {
      socket.off(socketEvents.CONNECT)
      socket.off(socketEvents.MESSAGE)
      socket.off(socketEvents.CONNECT_ERROR)
    }
  }, [socket, addMessage, setIsConnected])
  
  return (
    <div className="flex flex-col min-h-screen max-h-screen bg-neutral-50 text-neutral-800">
      <Header />
      
      <main 
        ref={mainRef}
        className={`flex flex-col md:flex-row flex-1 p-2 md:p-4 gap-3 md:gap-4 overflow-hidden transition-all duration-300 md:mb-0 ${
          isChatOpen && isMobile ? 'chat-open' : ''
        }`}
      >
        {/* PDF Section */}
        <section className="w-full md:w-3/5 h-full md:h-auto flex-shrink-0 md:flex-1 bg-white rounded-xl shadow-card">
          {/* PDFViewer now includes narration functionality in its header */}
          <PDFViewer />
        </section>
        
        {/* Transcription Section - Desktop */}
        {!isMobile && (
          <section className="hidden md:flex md:w-2/5 md:h-auto md:flex-col gap-2 md:gap-3">
            <div className="flex-1 overflow-hidden bg-white rounded-xl shadow-card">
              <Chat showHeader={true} />
            </div>
            
            {!isConnected && (
              <div className="bg-primary-50 text-primary-700 p-3 rounded-lg border border-primary-200 text-center">
                <p className="flex items-center justify-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" className="animate-spin">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Connecting to server...
                </p>
              </div>
            )}
            
            {/* Audio Recorder - Only displayed once on desktop */}
            <div className="bg-white rounded-xl shadow-card p-2">
              <AudioRecorder />
            </div>
          </section>
        )}
        
        {/* Mobile Transcript Section (collapsible) */}
        {isMobile && (
          <div className="mobile-view-layout">
            {/* Mobile Transcript Header - Always visible */}
            <div 
              className="transcript-header mobile" 
              onClick={toggleChat}
            >
              <h2>Transcription</h2>
              <div className={`arrow-icon ${isChatOpen ? 'open' : ''}`}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="18 15 12 9 6 15"></polyline>
                </svg>
              </div>
            </div>
            
            {/* Mobile Transcript Panel (Expandable) */}
            <div className={`mobile-transcript-panel ${isChatOpen ? 'open' : ''}`}>
              <Chat showHeader={false} />
            </div>
            
            {/* Audio Recorder - Fixed at bottom with improved layout */}
            <div className="audio-recorder-container">
              <AudioRecorder />
            </div>
          </div>
        )}
      </main>
      
      {isLoading && (
        <div className="loading-overlay">
          <div className="spinner"></div>
          <p>Connecting to server...</p>
        </div>
      )}
    </div>
  )
}

export default App
