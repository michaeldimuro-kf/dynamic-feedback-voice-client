import { useEffect, useRef, useState, useCallback } from 'react';
import io, { Socket } from 'socket.io-client';
import useStore from '../store/useStore';

// Global socket instance to ensure single connection across components
let globalSocket: Socket | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_RETRY_DELAY = 1000;

// Define the message event types
interface Message {
  id: string;
  text: string;
  type: 'user' | 'bot';
  timestamp: Date;
}

// Add new interface for page summary
interface PageSummary {
  text: string;
  pageNumber: number;
  pageTitle: string;
  pageCount: number;
}

// Add interface for audio response
interface PageAudioResponse {
  audio: number[];
  pageNumber: number;
}

/**
 * Primary WebSocket connection manager for the entire application.
 * This hook creates and maintains a single global WebSocket connection
 * that is shared across all components, including voice chat functionality.
 * 
 * It handles:
 * - Socket connection and reconnection logic
 * - Event handling for messages, transcriptions, and responses
 * - Sending audio data and text inputs to the server
 */
const useSocket = () => {
  const { addMessage, setIsProcessing, setIsConnected } = useStore();
  const socketRef = useRef<Socket | null>(globalSocket);
  const [socketReady, setSocketReady] = useState<boolean>(globalSocket !== null && globalSocket.connected);

  // Add state for page narration
  const [currentPageSummary, setCurrentPageSummary] = useState<PageSummary | null>(null);
  const [isProcessingPage, setIsProcessingPage] = useState(false);
  const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const createSocketConnection = useCallback(() => {
    // If we already have a connected socket, use it
    if (globalSocket?.connected) {
      console.log('[Socket] Using existing connected socket:', globalSocket.id);
      socketRef.current = globalSocket;
      setSocketReady(true);
      setIsConnected(true);
      
      // Setup event handlers on the existing socket
      setupEventHandlers(globalSocket);
      
      return;
    }
    // If socket exists but is disconnected, try to reconnect
    if (globalSocket) {
      console.log('[Socket] Existing socket found but disconnected, attempting to reconnect...');

      if (!globalSocket.connected) {
        try {
          console.log('[Socket] Calling connect() on existing socket');
          globalSocket.connect();
        } catch (err) {
          console.error('[Socket] Error reconnecting socket:', err);
          // If reconnecting fails, create a new socket
          console.log('[Socket] Reconnection failed, will create new socket');
          globalSocket = null;
        }
      }

      socketRef.current = globalSocket;
      
      // If reconnection succeeded, setup event handlers
      if (socketRef.current?.connected) {
        console.log('[Socket] Socket reconnected, setting up event handlers');
        setupEventHandlers(socketRef.current);
      }
      
      return;
    }
    // Create a new socket if none exists
    console.log('[Socket] Creating new socket connection...');

    // Get server URL from environment or use default
    const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';
    console.log('[Socket] Connecting to server at:', serverUrl);

    try {
      const socket = io(serverUrl, {
        reconnection: true,
        reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
        reconnectionDelay: INITIAL_RETRY_DELAY,
        reconnectionDelayMax: 5000,
        timeout: 10000,
        transports: ['websocket', 'polling'], // Try WebSocket first, then fallback to polling
        forceNew: false, // Try to reuse existing connection if possible
      });

      // Save as global
      globalSocket = socket;
      socketRef.current = socket;

      // Set up debug logging for all events immediately
      console.log('[Socket] Setting up global event debugging');
      
      // Debug listener to catch ALL events
      const originalOnevent = (socket as any).onevent;
      (socket as any).onevent = function(packet: any) {
        const args = packet.data || [];
        console.log('[Socket] EVENT RECEIVED:', args[0], args.length > 1 ? JSON.stringify(args.slice(1)) : '');
        
        // Call original handler
        originalOnevent.call(this, packet);
      };
      
      // Extra logging for socket.emit to trace all outgoing events
      const originalEmit = socket.emit;
      (socket as any).emit = function(event: string, ...args: any[]) {
        console.log('[Socket] EVENT EMITTED:', event, args.length > 0 ? JSON.stringify(args) : '');
        return originalEmit.apply(this, [event, ...args]);
      };

      // Connection event handlers with more detailed logging
      socket.on('connect', () => {
        console.log('[Socket] Connected successfully with ID:', socket.id);
        reconnectAttempts = 0;
        setSocketReady(true);
        setIsConnected(true);
        
        // Setup event handlers after connection
        setupEventHandlers(socket);
      });

      socket.on('disconnect', (reason) => {
        console.log('[Socket] Disconnected - Reason:', reason);
        setSocketReady(false);
        setIsConnected(false);
      });

      socket.on('connect_error', (error) => {
        console.error('[Socket] Connection error:', error);
        reconnectAttempts++;
        setSocketReady(false);
        setIsConnected(false);

        console.log(`[Socket] Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);

        // If max reconnect attempts reached, notify user
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          addMessage('Unable to connect to server. Please check your internet connection and try again.', 'bot', false);
        }
      });

      // Add more detailed socket event logging
      socket.on('reconnect', (attemptNumber) => {
        console.log(`[Socket] Successfully reconnected after ${attemptNumber} attempts`);
        setSocketReady(true);
        setIsConnected(true);
      });

      socket.on('reconnect_attempt', (attemptNumber) => {
        console.log(`[Socket] Reconnection attempt #${attemptNumber}`);
      });

      socket.on('reconnect_error', (error) => {
        console.error('[Socket] Error during reconnection attempt:', error);
      });

      socket.on('reconnect_failed', () => {
        console.error('[Socket] Failed to reconnect after maximum attempts');
        addMessage('Connection to server lost. Please refresh the page to try again.', 'bot', false);
      });

      // Custom event handlers
      socket.on('transcription-result', (data) => {
        if (data && data.text) {
          addMessage(data.text, 'user', false);
        }
      });

      socket.on('transcription', (data) => {
        if (data && data.text) {
          addMessage(data.text, 'user', false);
        }
      });

      socket.on('ai-response', (data) => {
        if (data && data.text) {
          // Filter out function call related responses based on patterns
          
          // 1. Check if this is a page content response from get_current_page_content
          // These typically start with "Page X (Title):" format
          const isPageContentResponse = /^Page \d+ \([^)]+\):/.test(data.text);
          
          // 2. Check if this is just a current page number response
          // These typically have the format "You are currently on page X."
          const isCurrentPageResponse = /^You are currently on page \d+\./.test(data.text);
          
          // 3. Check if this looks like structured data or function output
          // Function outputs often contain JSON-like structures or are very short status messages
          const looksLikeFunctionOutput = (
            /^\s*{.*}\s*$/.test(data.text) || // JSON-like
            /^Success|Failed|Error:/.test(data.text) || // Status messages
            /Function result:/.test(data.text) // Explicit function results
          );
          
          // 4. Check if this message has the pageData property which indicates function call result
          const hasPageData = data.pageData !== undefined;
          
          if (!isPageContentResponse && 
              !isCurrentPageResponse && 
              !looksLikeFunctionOutput &&
              !hasPageData) {
            // Only add to transcript if it's not a function call result
            addMessage(data.text, 'bot', false);
          } else {
            console.log('[Socket] Filtered out function call result from transcript:', data.text.substring(0, 50) + '...');
            
            // If this has page data, it's still important for narration
            if (hasPageData) {
              console.log('[Socket] Processing page data for narration:', data.pageData);
              // Process pageData for narration (don't add to transcript)
              
              // Update the current page for narration if needed
              if (data.pageData && data.pageData.pageNumber) {
                const store = useStore.getState();
                if (store.audioState.isNarrating) {
                  store.setNarrationCurrentPage(data.pageData.pageNumber);
                }
              }
            }
          }
        } else {
          addMessage('Sorry, I received an invalid response. Please try again.', 'bot', false);
        }
      });

      socket.on('audio-response', (data) => {
        if (data && data.audio && data.audio.length > 0) {
          try {
            console.log('[Socket] Received audio response, length:', data.audio.length, 'for page:', data.pageNumber);
            
            // Convert array back to Blob
            const audioArray = new Uint8Array(data.audio);
            const audioBlob = new Blob([audioArray], { type: 'audio/mp3' });

            // Create object URL for the blob
            const audioUrl = URL.createObjectURL(audioBlob);

            // Create audio element with preload enabled
            const audio = new Audio();
            audio.preload = 'auto';
            
            // Log when metadata is loaded
            audio.onloadedmetadata = () => {
              console.log('[Socket] Audio metadata loaded, duration:', audio.duration);
            };
            
            // Log when data is loaded
            audio.onloadeddata = () => {
              console.log('[Socket] Audio data loaded, ready state:', audio.readyState);
            };
            
            // Set up event handlers BEFORE setting src
            // This ensures events are triggered in the correct order
            
            // Handle loading error
            audio.onerror = (err) => {
              console.error('[Socket] Audio loading error:', err, 'Code:', audio.error?.code);
              URL.revokeObjectURL(audioUrl);
              setIsProcessing(false);
              useStore.getState().setIsPlayingAudio(false);
            };
            
            // When audio can play through, update state
            audio.oncanplaythrough = () => {
              console.log('[Socket] Audio ready to play through');
              // Store audio element reference
              setCurrentAudio(audio);
              // Update global state
              useStore.getState().setIsPlayingAudio(true);
            };
            
            // Set up ended handler
            audio.onended = () => {
              const currentPage = data.pageNumber;
              console.log(`[Socket] Audio playback ended for page ${currentPage}`);
              
              // Clean up resources
              URL.revokeObjectURL(audioUrl);
              
              // Update component state
              setCurrentAudio(null);
              setIsProcessingPage(false);
              
              // Update global state for audio playback
              useStore.getState().setIsPlayingAudio(false);
              
              // If we're narrating and not paused, trigger narration auto-advance
              const store = useStore.getState();
              if (store.audioState.isNarrating && !store.audioState.isNarrationPaused) {
                console.log(`[Socket] Auto-advancing from page ${currentPage}`);
                
                const nextPage = currentPage + 1;
                
                if (nextPage <= store.pdfState.pageCount) {
                  // Update narration state
                  store.setNarrationCurrentPage(nextPage);
                  
                  // Change the page in the PDF viewer
                  store.setPageNum(nextPage);
                  
                  // Request the next page narration
                  setTimeout(() => {
                    if (socketRef.current) {
                      socketRef.current.emit('text-input', { 
                        text: `Using the function get_current_page_content, summarize and narrate page ${nextPage} of this document in a clear, engaging way. Speak directly to me as if you're explaining the content. DO NOT reference the document itself by saying phrases like "this document shows" or "the content mentions." Just present the information naturally.`
                      });
                    }
                  }, 500);
                } else {
                  // No more pages to narrate
                  console.log('[Socket] Reached end of document');
                  store.setIsNarrating(false);
                }
              }
            };
            
            // Now set the source and load the audio
            audio.src = audioUrl;
            
            // Log that we're attempting to play
            console.log('[Socket] Setting audio source and attempting to play');
            
            // Play the audio immediately
            const playPromise = audio.play();
            
            if (playPromise !== undefined) {
              playPromise.then(() => {
                console.log('[Socket] Audio playback started successfully');
              }).catch(err => {
                console.error('[Socket] Error playing audio:', err);
                
                if (err.name === 'NotAllowedError') {
                  console.warn('[Socket] Browser blocked autoplay. User interaction required.');
                  
                  // For Chrome, try force unlock audio by playing a short silent sound
                  try {
                    const silentContext = new (window.AudioContext || (window as any).webkitAudioContext)();
                    const silentOsc = silentContext.createOscillator();
                    const silentGain = silentContext.createGain();
                    silentGain.gain.value = 0.01;
                    silentOsc.connect(silentGain);
                    silentGain.connect(silentContext.destination);
                    silentOsc.start();
                    silentOsc.stop(silentContext.currentTime + 0.001);
                    
                    // Try playing again after a short delay
                    setTimeout(() => {
                      console.log('[Socket] Attempting playback again after silent sound');
                      audio.play().catch(e => console.error('[Socket] Still failed after silent sound:', e));
                    }, 100);
                  } catch (e) {
                    console.error('[Socket] Error creating silent sound:', e);
                  }
                  
                  // Add a one-time click handler to the document to play on next user interaction
                  const playOnUserInteraction = () => {
                    console.log('[Socket] User interaction detected, attempting playback.');
                    audio.play().catch(e => console.error('[Socket] Still failed after interaction:', e));
                    document.removeEventListener('click', playOnUserInteraction);
                  };
                  
                  document.addEventListener('click', playOnUserInteraction, { once: true });
                }
                
                setIsProcessing(false);
              });
            }
            
          } catch (error) {
            console.error('[Socket] Error processing audio response:', error);
            setIsProcessing(false);
          }
        } else {
          console.warn('[Socket] Received empty audio response');
          setIsProcessing(false);
        }
      });

      socket.on('error', (error) => {
        let errorMessage = 'An error occurred. Please try again.';

        if (typeof error === 'string') {
          errorMessage = error;
        } else if (error && typeof error === 'object' && 'message' in error) {
          errorMessage = String(error.message);
        }

        addMessage(errorMessage, 'bot', false);
        setIsProcessing(false);
      });

    } catch (error) {
      console.error('[Socket] Error creating socket connection:', error);
      setSocketReady(false);
      setIsConnected(false);
    }

  }, [addMessage, setIsProcessing, setIsConnected]);

  // Initialize socket connection
  useEffect(() => {
    // Create or get the socket connection
    createSocketConnection();
    
    console.log('[Socket] Setting up connection monitoring');

    // Check socket connection status periodically
    const checkConnectionInterval = setInterval(() => {
      const isConnected = socketRef.current?.connected ?? false;

      // If our state doesn't match the actual connection status, update it
      if (socketReady !== isConnected) {
        console.log(`[Socket] Connection state mismatch - Current: ${socketReady}, Actual: ${isConnected}`);
        setSocketReady(isConnected);
        setIsConnected(isConnected);
        
        // If the socket reconnected, we need to make sure all event listeners are registered
        if (isConnected && socketRef.current) {
          console.log('[Socket] Reconnected, refreshing event listeners');
          
          // Set up all event handlers again
          setupEventHandlers(socketRef.current);
        }
      }
    }, 5000);

    // Cleanup function
    return () => {
      clearInterval(checkConnectionInterval);
      // Don't disconnect on component unmount
      // We want to keep the connection alive
    };
  }, [createSocketConnection, socketReady]);

  // Handle page audio response function
  const handlePageAudioResponse = (data: PageAudioResponse) => {
    console.log('[Socket] Received page-audio-response event for page', data?.pageNumber);
    
    if (!data.audio || data.audio.length === 0) {
      console.warn('[Socket] Received empty page audio response');
      setIsProcessingPage(false);
      return;
    }

    try {
      // Convert array to AudioBuffer
      const audioArray = new Uint8Array(data.audio);
      const audioBlob = new Blob([audioArray], { type: 'audio/mp3' });
      const audioUrl = URL.createObjectURL(audioBlob);
      
      // Create audio element with preload enabled
      const audio = new Audio();
      audio.preload = 'auto';
      
      // Set up event handlers BEFORE setting src
      
      // Handle loading error
      audio.onerror = (err) => {
        console.error('[Socket] Page audio loading error:', err);
        URL.revokeObjectURL(audioUrl);
        setIsProcessingPage(false);
        useStore.getState().setIsPlayingAudio(false);
      };
      
      // When audio can play through, update state
      audio.oncanplaythrough = () => {
        console.log('[Socket] Page audio ready to play through');
        // Store audio element reference
        setCurrentAudio(audio);
        // Update global state
        useStore.getState().setIsPlayingAudio(true);
      };
      
      // Set up ended handler
      audio.onended = () => {
        const currentPage = data.pageNumber;
        console.log(`[Socket] Page audio playback ended for page ${currentPage}`);
        
        // Clean up resources
        URL.revokeObjectURL(audioUrl);
        
        // Update component state
        setCurrentAudio(null);
        setIsProcessingPage(false);
        
        // Update global state for audio playback
        useStore.getState().setIsPlayingAudio(false);
        
        // If we're narrating and not paused, advance to next page
        const store = useStore.getState();
        const isNarrating = store.audioState.isNarrating;
        const isNarrationPaused = store.audioState.isNarrationPaused;
        const narrationCurrentPage = store.audioState.narrationCurrentPage;
        const pageCount = store.pdfState.pageCount;
        
        if (isNarrating && !isNarrationPaused && narrationCurrentPage === currentPage) {
          console.log(`[Socket] Advancing from page ${currentPage}`);
          
          // Calculate next page
          const nextPage = narrationCurrentPage + 1;
          
          if (nextPage <= pageCount) {
            console.log(`[Socket] Moving to page ${nextPage}`);
            
            // Update narration state
            store.setNarrationCurrentPage(nextPage);
            
            // Update PDF page
            store.setPageNum(nextPage);
            
            // Request audio summary for the next page
            setTimeout(() => {
              if (socketRef.current) {
                console.log(`[Socket] Sending request for page ${nextPage}`);
                
                // For next pages, send the text message
                socketRef.current.emit('text-input', { 
                  text: `Using the function get_current_page_content, summarize and narrate page ${nextPage} of this document in a clear, engaging way. Speak directly to me as if you're explaining the content. DO NOT reference the document itself by saying phrases like "this document shows" or "the content mentions." Just present the information naturally.`
                });
              }
            }, 500);
          } else {
            // No more pages
            console.log('[Socket] Reached end of document');
            store.setIsNarrating(false);
          }
        }
      };
      
      // Now set the source and load the audio
      audio.src = audioUrl;
      
      // Play the audio immediately
      const playPromise = audio.play();
      
      if (playPromise !== undefined) {
        playPromise.catch(err => {
          console.error('[Socket] Error playing page audio:', err);
          
          if (err.name === 'NotAllowedError') {
            console.warn('[Socket] Browser blocked page audio autoplay. User interaction required.');
            
            // Add a one-time click handler to the document to play on next user interaction
            const playOnUserInteraction = () => {
              console.log('[Socket] User interaction detected, attempting page audio playback.');
              audio.play().catch(e => console.error('[Socket] Still failed after interaction:', e));
              document.removeEventListener('click', playOnUserInteraction);
            };
            
            document.addEventListener('click', playOnUserInteraction, { once: true });
          }
          
          setIsProcessingPage(false);
        });
      }
    } catch (error) {
      console.error('[Socket] Error handling page audio response:', error);
      setIsProcessingPage(false);
      useStore.getState().setIsPlayingAudio(false);
    }
  };

  // Function to set up all event handlers on the socket
  const setupEventHandlers = (socket: Socket) => {
    console.log('[Socket] Setting up event handlers');
    
    // First, remove any existing handlers to prevent duplicates
    socket.off('page-summary');
    socket.off('page-audio-response');
    socket.off('audio-response'); // Make sure we also handle this one
    socket.off('go-to-page');
    socket.off('function-call');
    socket.off('get-current-page-number');
    socket.off('function-call-result');
    socket.off('audio-state-change');
    
    // Then add our handlers
    socket.on('page-summary', (data) => {
      console.log('[Socket] Received page summary for page', data?.pageNumber);
      setCurrentPageSummary(data);
      setIsProcessingPage(false);
    });
    
    socket.on('page-audio-response', handlePageAudioResponse);
    
    // Make sure we explicitly handle audio-response in our event handlers
    socket.on('audio-response', (data) => {
      console.log('[Socket] Explicit audio-response handler called with data length:', data?.audio?.length);
      
      if (data && data.audio && data.audio.length > 0) {
        try {
          console.log('[Socket] Processing audio response, length:', data.audio.length);
          
          // Convert array to AudioBuffer
          const audioArray = new Uint8Array(data.audio);
          const audioBlob = new Blob([audioArray], { type: 'audio/mp3' });
          const audioUrl = URL.createObjectURL(audioBlob);
          
          // Store the audio URL globally for debugging
          (window as any).lastAudioUrl = audioUrl;
          console.log('[Socket] Audio URL created and stored for debugging at window.lastAudioUrl');
          
          // Create audio element with preload enabled
          const audio = new Audio();
          audio.preload = 'auto';
          
          // Set up error and event handlers
          audio.onerror = (err) => {
            console.error('[Socket] Audio loading error:', err);
            URL.revokeObjectURL(audioUrl);
            setIsProcessing(false);
          };
          
          audio.oncanplaythrough = () => {
            console.log('[Socket] Audio can play through, attempting playback');
            setCurrentAudio(audio);
            useStore.getState().setIsPlayingAudio(true);
            
            // Play it
            const playPromise = audio.play();
            if (playPromise) {
              playPromise.catch(err => {
                console.error('[Socket] Play failed in canplaythrough handler:', err);
              });
            }
          };
          
          audio.onended = () => {
            console.log('[Socket] Audio playback ended');
            URL.revokeObjectURL(audioUrl);
            setCurrentAudio(null);
            setIsProcessingPage(false);
            useStore.getState().setIsPlayingAudio(false);
          };
          
          // Set the source and attempt to play
          audio.src = audioUrl;
          
          // Force trigger playing with a timeout as backup
          setTimeout(() => {
            if (audio.paused) {
              console.log('[Socket] Audio still paused after timeout, attempting play');
              audio.play().catch(err => console.error('[Socket] Delayed play attempt failed:', err));
            }
          }, 500);
        } catch (error) {
          console.error('[Socket] Error in audio-response handler:', error);
          setIsProcessing(false);
        }
      } else {
        console.warn('[Socket] Empty audio response received');
        setIsProcessing(false);
      }
    });
    
    socket.on('go-to-page', (data) => {
      try {
        const { pageNumber } = data;
        const store = useStore.getState();
        
        // Validate page number
        if (pageNumber > 0 && pageNumber <= store.pdfState.pageCount) {
          console.log(`[Socket] Navigating to page ${pageNumber}`);
          // Update page number
          store.setPageNum(pageNumber);
        }
      } catch (error) {
        console.error('[Socket] Error handling go-to-page:', error);
      }
    });
    
    socket.on('function-call', (data) => {
      try {
        console.log('[Socket] Function call received:', data.functionName);
        const { functionName, arguments: argsString, callId, sessionId } = data;
        
        // Parse arguments
        const args = JSON.parse(argsString);
        
        // Handle different function types
        switch (functionName) {
          case 'getPageContent':
            console.log('[Socket] Get page content function call with callId:', callId);
            
            // Get the current page content from the PDF
            const store = useStore.getState();
            const pageNumber = store.pdfState.pageNum;
            const pdfDoc = store.pdfState.pdfDoc;
            
            if (pdfDoc) {
              // Actually get the text content from the current page
              console.log(`[Socket] Getting text content for page ${pageNumber}`);
              
              // Use the PDF.js document to extract text
              pdfDoc.getPage(pageNumber).then(async (page: any) => {
                try {
                  // Get text content from the page
                  const textContent = await page.getTextContent();
                  const pageText = textContent.items
                    .map((item: any) => item.str)
                    .join(' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                  
                  console.log(`[Socket] Extracted ${pageText.length} characters of text from page ${pageNumber}`);
                  
                  // Send the result back to the server
                  if (socketRef.current) {
                    console.log('[Socket] Sending function call result with real page content for callId:', callId);
                    socketRef.current.emit('function-call-result', {
                      callId,
                      sessionId,
                      functionName: 'getPageContent',
                      result: JSON.stringify({
                        content: pageText,
                        pageNumber,
                        success: true
                      })
                    });
                  }
                } catch (error: any) {
                  console.error('[Socket] Error extracting text from page:', error);
                  
                  // Send error result
                  if (socketRef.current) {
                    socketRef.current.emit('function-call-result', {
                      callId,
                      sessionId,
                      functionName: 'getPageContent',
                      result: JSON.stringify({
                        error: `Error extracting text: ${error}`,
                        success: false
                      })
                    });
                  }
                }
              }).catch((error: any) => {
                console.error('[Socket] Error getting page:', error);
                
                // Send error result
                if (socketRef.current) {
                  socketRef.current.emit('function-call-result', {
                    callId,
                    sessionId,
                    functionName: 'getPageContent',
                    result: JSON.stringify({
                      error: `Error getting page: ${error}`,
                      success: false
                    })
                  });
                }
              });
            } else {
              console.error('[Socket] PDF document not loaded, cannot get page content');
              
              // Send error result
              if (socketRef.current) {
                socketRef.current.emit('function-call-result', {
                  callId,
                  sessionId,
                  functionName: 'getPageContent',
                  result: JSON.stringify({
                    error: 'PDF document not loaded',
                    success: false
                  })
                });
              }
            }
            break;
            
          default:
            console.log('[Socket] Unknown function call:', functionName);
            break;
        }
      } catch (error) {
        console.error('[Socket] Error handling function call:', error);
      }
    });
    
    socket.on('get-current-page-number', () => {
      try {
        const currentPageNum = useStore.getState().pdfState.pageNum;
        console.log('[Socket] Reporting current page number:', currentPageNum);
        
        if (socketRef.current) {
          socketRef.current.emit('current-page-number', { 
            pageNumber: currentPageNum 
          });
        }
      } catch (error) {
        console.error('[Socket] Error handling get-current-page-number:', error);
      }
    });
    
    socket.on('function-call-result', (data) => {
      try {
        console.log('[Socket] Function call result received:', data.functionName);
        const { functionName, result } = data;
        
        // Parse result
        const resultData = JSON.parse(result);
        
        // Handle different function types
        switch (functionName) {
          case 'getPageContent':
            console.log('[Socket] Get page content result received:', resultData);
            // This result is from our get_current_page_content function
            // No need to do anything here as the server should be processing 
            // this result and generating the narration
            break;
            
          default:
            console.log('[Socket] Unknown function result:', functionName);
            break;
        }
      } catch (error) {
        console.error('[Socket] Error handling function call result:', error);
      }
    });
    
    socket.on('audio-state-change', (data) => {
      console.log('[Socket] Audio state change:', data.isPlaying);
      useStore.getState().setIsPlayingAudio(data.isPlaying);
    });
    
    console.log('[Socket] Event handlers set up successfully');
  };

  // Function to send audio data to server
  const sendAudio = useCallback(async (
    audioData: Uint8Array,
    isFinal: boolean = false,
    mimeType: string = 'audio/webm'
  ): Promise<boolean> => {
    // If socket is not connected, wait for it to connect with a timeout
    if (socketRef.current && !socketRef.current.connected) {
      console.log('Socket not connected, waiting for connection...');

      try {
        await new Promise<void>((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            reject(new Error('Connection timeout'));
          }, 5000);

          const connectHandler = () => {
            clearTimeout(timeoutId);
            resolve();
          };

          socketRef.current?.once('connect', connectHandler);

          // Clean up if we abort
          return () => {
            clearTimeout(timeoutId);
            socketRef.current?.off('connect', connectHandler);
          };
        });
      } catch (error) {
        console.error('Timed out waiting for socket connection');
        return false;
      }
    }

    // Check if we have a valid socket connection
    if (!socketRef.current) {
      console.error('No socket connection available');
      return false;
    }

    // Double check connection status before sending
    if (!socketRef.current.connected) {
      console.error('Socket is not connected, cannot send audio');
      return false;
    }

    try {
      console.log(`Sending audio data: ${audioData.length} bytes, isFinal: ${isFinal}, mimeType: ${mimeType}`);

      // Send the audio data - backend expects streaming-audio event
      socketRef.current.emit('streaming-audio', {
        audio: Array.from(audioData),
        isFinal,
        mimeType,
      });

      // Mark as processing if this is the final chunk
      if (isFinal) {
        setIsProcessing(true);
      }

      return true;
    } catch (error) {
      console.error('Error sending audio:', error);
      return false;
    }
  }, [setIsProcessing]);

  // Function to send text input instead of audio
  const sendTextInput = useCallback((text: string): boolean => {
    if (!socketRef.current || !socketRef.current.connected) {
      console.error('[Socket] Socket not connected, cannot send text');
      return false;
    }

    // Check if we're already processing and not a narration request
    const audioState = useStore.getState().audioState;
    const isNarrationRequest = text.includes('get_current_page_content') || text.includes('narrate page');
    
    // Only block non-narration requests if we're processing a response
    if (audioState.isProcessing && !isNarrationRequest) {
      console.error('[Socket] Already processing a response, cannot send new text input');
      return false;
    }
    
    // For narration requests, don't start a new one if we're already processing
    if (isNarrationRequest && (audioState.isProcessing || audioState.isRecording)) {
      console.error('[Socket] Cannot start narration while voice chat is active');
      return false;
    }

    try {
      console.log('[Socket] Sending text input:', text);
      
      // Always set processing state first
      setIsProcessing(true);
      
      // If this appears to be a narration request, set processing page state
      if (isNarrationRequest) {
        console.log('[Socket] Detected narration request, setting processing page state');
        setIsProcessingPage(true);
      }
      
      // Send the message to server
      socketRef.current.emit('text-input', { text });
      return true;
    } catch (error) {
      console.error('[Socket] Error sending text:', error);
      setIsProcessing(false);
      setIsProcessingPage(false);
      return false;
    }
  }, [setIsProcessing, setIsProcessingPage]);

  // Function to manually attempt reconnection
  const reconnect = useCallback(() => {
    if (socketRef.current && !socketRef.current.connected) {
      console.log('Manually attempting reconnection...');
      socketRef.current.connect();

      // Update connection status after a short delay to allow connection to establish
      setTimeout(() => {
        const isConnected = socketRef.current?.connected ?? false;
        setSocketReady(isConnected);
        setIsConnected(isConnected);
        console.log(`Socket connection status after reconnect attempt: ${isConnected}`);
      }, 1000);
    } else {
      console.log('Creating new connection...');
      createSocketConnection();
    }
  }, [createSocketConnection, setIsConnected]);

  // Expose the connection status to help debug issues
  const getConnectionStatus = useCallback(() => {
    const status = {
      socketExists: socketRef.current !== null,
      socketConnected: socketRef.current?.connected ?? false,
      socketReady,
      globalSocketExists: globalSocket !== null,
      globalSocketConnected: globalSocket?.connected ?? false
    };

    console.log('Socket connection status:', status);
    return status;
  }, [socketReady]);

  // Add functions to control audio playback
  const pauseAudio = () => {
    if (currentAudio) {
      currentAudio.pause();
      setIsPaused(true);
      
      // Update global narration pause state
      useStore.getState().setIsNarrationPaused(true);
      useStore.getState().setIsPlayingAudio(false);
    }
  };

  const resumeAudio = () => {
    if (currentAudio) {
      currentAudio.play().catch(err => {
        // Handle errors silently
      });
      setIsPaused(false);
      
      // Update global narration pause state
      useStore.getState().setIsNarrationPaused(false);
      
      // Ensure global audio playback state is updated
      useStore.getState().setIsPlayingAudio(true);
    }
  };

  const stopAudio = () => {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      setIsPaused(false);
      setCurrentAudio(null);
      setIsProcessingPage(false);
      
      // Update global audio state
      useStore.getState().setIsPlayingAudio(false);
      
      // Clean up any pending auto-advance timers
      if (socketRef.current) {
        socketRef.current.emit('cancel-narration-advance', {
          reason: 'audio_stopped_manually'
        });
      }
    }
  };

  // Return socket and utility functions
  return {
    socket: socketRef.current,
    socketReady,
    sendAudio,
    sendTextInput,
    pauseAudio,
    resumeAudio,
    stopAudio,
    currentPageSummary,
    isProcessingPage,
    isPaused,
    currentAudio,
    reconnect: createSocketConnection,
    // Add a function to manually trigger page advancement
    triggerPageAdvancement: () => {
      const store = useStore.getState();
      if (store.audioState.isNarrating && !store.audioState.isNarrationPaused) {
        console.log('NARRATION: Direct trigger of page advancement');
        
        const currentPage = store.audioState.narrationCurrentPage;
        const nextPage = currentPage + 1;
        
        if (nextPage <= store.pdfState.pageCount) {
          // Update narration state
          store.setNarrationCurrentPage(nextPage);
          
          // Update PDF page
          store.setPageNum(nextPage);
          
          // Request summary for next page
          if (socketRef.current) {
            // For next pages, send the text message first
            socketRef.current.emit('text-input', { 
              text: `Using the function get_current_page_content, definitively speak the content of page ${nextPage} in a summarized manner and discuss it as I am the end user. This is report which is the result of my assessment. Do not reference the content itself in your response such as \"it mentions\", \"the content states\", etc.`
            });
            
            // Then request the audio summary
            // socketRef.current.emit('summarize-page', { pageNumber: nextPage });
          }
        } else {
          // No more pages
          store.setIsNarrating(false);
        }
      }
    }
  };
};

export default useSocket; 