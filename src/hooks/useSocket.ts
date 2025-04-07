import { useEffect, useRef, useState, useCallback } from 'react';
import io, { Socket } from 'socket.io-client';
import useStore from '../store/useStore';
import { audioStreamService } from '../services/audioStreamService';

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
  const [isStreaming, setIsStreaming] = useState(false);

  const currentPageTextRef = useRef<string>('');
  const autoAdvanceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Direct access to audio service instead of using the hook
  const addAudioChunk = useCallback((chunk: string) => {
    if (chunk && chunk.length > 10) {
      audioStreamService.addAudioChunk(chunk);
    } else {
      console.warn('[Socket] Invalid audio chunk received');
    }
  }, []);

  const completeAudioStream = useCallback(() => {
    audioStreamService.completeAudioStream();
  }, []);

  const resetAudioStream = useCallback(() => {
    audioStreamService.reset();
  }, []);

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
        console.log('[Socket] Explicit audio-response handler called with data length:', data?.audio?.length);
        
        if (data && data.audio && data.audio.length > 0) {
          try {
            console.log('[Socket] Processing audio response, length:', data.audio.length);
            
            // Convert array to binary data
            const audioArray = new Uint8Array(data.audio);
            
            // Process the audio data using our helper function
            processBinaryAudioData(audioArray)
              .then(base64Audio => {
                // Use our RxJS service to play the audio
                addAudioChunk(base64Audio);
                
                // Update global state
                useStore.getState().setIsPlayingAudio(true);
                
                // Mark processing as complete when the audio is done
                // We'll use a timeout as an estimation
                setTimeout(() => {
                  setIsProcessing(false);
                  useStore.getState().setIsPlayingAudio(false);
                  completeAudioStream(); // Mark the streaming as complete
                }, 5000); // Estimate for audio playback time
              })
              .catch(error => {
                console.error('[Socket] Error processing audio data:', error);
                setIsProcessing(false);
              });
          } catch (error) {
            console.error('[Socket] Error in audio-response handler:', error);
            setIsProcessing(false);
          }
        } else {
          console.warn('[Socket] Empty audio response received');
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

  // Function to extract mime type from audio data
  const detectAudioMimeType = (audioData: Uint8Array): string => {
    // Simple detection of audio format based on binary header
    if (audioData.length >= 4) {
      // WebM starts with 1A 45 DF A3
      if (audioData[0] === 0x1A && audioData[1] === 0x45 && audioData[2] === 0xDF && audioData[3] === 0xA3) {
        return 'audio/webm';
      }
      // WAV starts with RIFF header (52 49 46 46)
      else if (audioData[0] === 0x52 && audioData[1] === 0x49 && audioData[2] === 0x46 && audioData[3] === 0x46) {
        return 'audio/wav';
      }
      // MP3 typically starts with ID3 (49 44 33) or sync frame (FF Ex)
      else if ((audioData[0] === 0x49 && audioData[1] === 0x44 && audioData[2] === 0x33) ||
              (audioData[0] === 0xFF && (audioData[1] & 0xE0) === 0xE0)) {
        return 'audio/mpeg';
      }
      // OGG starts with "OggS" (4F 67 67 53)
      else if (audioData[0] === 0x4F && audioData[1] === 0x67 && audioData[2] === 0x67 && audioData[3] === 0x53) {
        return 'audio/ogg';
      }
      // AAC ADTS starts with FF F1 (sync word)
      else if (audioData[0] === 0xFF && (audioData[1] & 0xF0) === 0xF0) {
        return 'audio/aac';
      }
      // FLAC starts with "fLaC" (66 4C 61 43)
      else if (audioData[0] === 0x66 && audioData[1] === 0x4C && audioData[2] === 0x61 && audioData[3] === 0x43) {
        return 'audio/flac';
      }
    }
    
    // If we can't detect or have too little data, default to MP3 - most universally supported
    return 'audio/mpeg';
  };

  // Process binary audio data for playback
  const processBinaryAudioData = (audioArray: Uint8Array): Promise<string> => {
    return new Promise((resolve, reject) => {
      try {
        // Detect the audio format
        const mimeType = detectAudioMimeType(audioArray);
        console.log(`[Socket] Detected audio format: ${mimeType}`);
        
        // Create blob with detected mime type
        const audioBlob = new Blob([audioArray], { type: mimeType });
        
        // Read the blob as base64
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = reader.result as string;
          if (!dataUrl || typeof dataUrl !== 'string') {
            reject(new Error('[Socket] Could not convert audio data to base64'));
            return;
          }
          
          const base64Audio = dataUrl.split(',')[1]; // Remove the data URL prefix
          
          if (base64Audio && base64Audio.length > 0) {
            resolve(base64Audio);
          } else {
            reject(new Error('[Socket] Could not convert audio data to base64'));
          }
        };
        
        reader.onerror = (error) => {
          console.error('[Socket] Error reading audio data:', error);
          reject(error);
        };
        
        reader.readAsDataURL(audioBlob);
      } catch (error) {
        console.error('[Socket] Error processing binary audio data:', error);
        reject(error);
      }
    });
  };

  // Handle page audio response function
  const handlePageAudioResponse = (data: PageAudioResponse) => {
    console.log('[Socket] Received page-audio-response event for page', data?.pageNumber);
    
    if (!data.audio || data.audio.length === 0) {
      console.warn('[Socket] Received empty page audio response');
      setIsProcessingPage(false);
      return;
    }

    try {
      // Convert array to binary data
      const audioArray = new Uint8Array(data.audio);
      
      // Process the audio data
      processBinaryAudioData(audioArray)
        .then(base64Audio => {
          // Use our RxJS service to play the audio
          addAudioChunk(base64Audio);
          
          // Update global state
          useStore.getState().setIsPlayingAudio(true);
          
          // Handle auto-narration advance when audio finishes
          // We'll do this via a timeout since we can't hook into the RxJS stream's completion here
          const autoAdvanceTimeout = setTimeout(() => {
            // Check if we're still narrating (user hasn't manually stopped)
            const store = useStore.getState();
            if (store.audioState.isNarrating && !store.audioState.isNarrationPaused) {
              console.log(`[Socket] Auto-advancing from page ${data.pageNumber}`);
              
              const nextPage = data.pageNumber + 1;
              
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
                completeAudioStream(); // Mark the streaming as complete
              }
            }
            
            // Clean up state
            setIsProcessingPage(false);
            useStore.getState().setIsPlayingAudio(false);
          }, 5000); // Estimate for audio playback time
          
          // Store the timeout so we can clear it if needed
          autoAdvanceTimeoutRef.current = autoAdvanceTimeout;
        })
        .catch(error => {
          console.error('[Socket] Error processing page audio data:', error);
          setIsProcessingPage(false);
          useStore.getState().setIsPlayingAudio(false);
        });
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
          
          // Convert array to binary data
          const audioArray = new Uint8Array(data.audio);
          
          // Process the audio data using our helper function
          processBinaryAudioData(audioArray)
            .then(base64Audio => {
              // Use our RxJS service to play the audio
              addAudioChunk(base64Audio);
              
              // Update global state
              useStore.getState().setIsPlayingAudio(true);
              
              // Mark processing as complete when the audio is done
              // We'll use a timeout as an estimation
              setTimeout(() => {
                setIsProcessing(false);
                useStore.getState().setIsPlayingAudio(false);
                completeAudioStream(); // Mark the streaming as complete
              }, 5000); // Estimate for audio playback time
            })
            .catch(error => {
              console.error('[Socket] Error processing audio data:', error);
              setIsProcessing(false);
            });
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
          case 'get_current_page_content':
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
                  
                  // Store the text for reference
                  currentPageTextRef.current = pageText;
                  
                  // Send the result back to the server
                  if (socketRef.current) {
                    console.log('[Socket] Sending function call result with real page content for callId:', callId);
                    socketRef.current.emit('function-call-result', {
                      callId,
                      sessionId,
                      functionName: functionName,
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
                      functionName: functionName,
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
                    functionName: functionName,
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
                  functionName: functionName,
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
    
    // Add this function to the setupEventHandlers to ensure we catch all audio events
    socket.on('content-part-audio', (data) => {
      console.log('[Socket] Received content-part-audio event');
      
      if (data && data.audio && data.audio.length > 0) {
        try {
          // Convert array to binary data
          const audioArray = new Uint8Array(data.audio);
          
          // Process the audio data using our helper function
          processBinaryAudioData(audioArray)
            .then(base64Audio => {
              // Use our RxJS service to play the audio
              addAudioChunk(base64Audio);
              
              // Update global state
              useStore.getState().setIsPlayingAudio(true);
            })
            .catch(error => {
              console.error('[Socket] Error processing content part audio data:', error);
            });
        } catch (error) {
          console.error('[Socket] Error handling content-part-audio:', error);
        }
      }
    });

    // Add handling for the realtime audio deltas
    socket.on('realtime-event', (event) => {
      // Handle different event types
      if (event.type === 'voice-message') {
        // Voice message events from the server
        if (event.message) {
          console.log('[Socket] Received voice message from server:', event.message);
        }
      } else if (event.type === 'audio.delta' || event.type === 'response.audio.delta') {
        // Audio received via delta field (supporting both new and old event types)
        console.log('[Socket] Received audio delta event');
        
        // Handle string-based delta for older format
        if (event.delta && typeof event.delta === 'string' && event.delta.length > 0) {
          console.log('[Socket] Processing string-based audio delta');
          // Use directly if it's already a string (likely base64)
          addAudioChunk(event.delta);
          useStore.getState().setIsPlayingAudio(true);
        }
        // Handle array-based delta for newer format
        else if (event.delta && event.delta.audio && event.delta.audio.length > 0) {
          try {
            // Convert array to binary data
            const audioArray = new Uint8Array(event.delta.audio);
            
            // Process the audio data using our helper function
            processBinaryAudioData(audioArray)
              .then(base64Audio => {
                // Use our RxJS service to play the audio
                addAudioChunk(base64Audio);
                
                // Update global state
                useStore.getState().setIsPlayingAudio(true);
              })
              .catch(error => {
                console.error('[Socket] Error processing audio delta data:', error);
              });
          } catch (error) {
            console.error('[Socket] Error handling audio.delta event:', error);
          }
        }
      } else if (event.type === 'audio' && event.data?.audio) {
        console.log('[Socket] Received audio event');
        
        // Handle direct audio data 
        if (typeof event.data.audio === 'string') {
          // If it's already a string (likely base64), use it directly
          addAudioChunk(event.data.audio);
          useStore.getState().setIsPlayingAudio(true);
        } else if (Array.isArray(event.data.audio)) {
          try {
            // Convert array to binary data
            const audioArray = new Uint8Array(event.data.audio);
            
            // Process the audio data using our helper function
            processBinaryAudioData(audioArray)
              .then(base64Audio => {
                // Use our RxJS service to play the audio
                addAudioChunk(base64Audio);
                
                // Update global state
                useStore.getState().setIsPlayingAudio(true);
              })
              .catch(error => {
                console.error('[Socket] Error processing audio event data:', error);
              });
          } catch (error) {
            console.error('[Socket] Error handling audio event:', error);
          }
        }
      } else if (event.type === 'done' || event.type === 'response.audio.done') {
        // Audio streaming is complete (supporting both new and old event types)
        console.log('[Socket] Received done event for realtime audio');
        useStore.getState().setIsPlayingAudio(false);
        completeAudioStream();
        
        // Reset processing states
        setIsProcessing(false);
        setIsProcessingPage(false);
      }
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

    // Check if this is a narration request
    const isNarrationRequest = text.includes('get_current_page_content') || text.includes('narrate page');
    
    // For non-narration requests, check if we're already processing a response
    if (!isNarrationRequest && useStore.getState().audioState.isProcessing) {
      console.error('[Socket] Already processing a response, cannot send new text input');
      return false;
    }
    
    // For narration requests, check if voice recording is active (not just processing)
    if (isNarrationRequest && useStore.getState().audioState.isRecording) {
      console.error('[Socket] Cannot start narration while voice recording is active');
      return false;
    }

    try {
      console.log('[Socket] Sending text input:', text);
      
      // If this appears to be a narration request, set processing page state
      if (isNarrationRequest) {
        console.log('[Socket] Detected narration request, setting processing page state');
        setIsProcessingPage(true);
      } else {
        // For regular text input, set general processing state
        setIsProcessing(true);
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
      currentAudio.src = '';
      setCurrentAudio(null);
    }
    
    // Also stop any audio playing via RxJS
    resetAudioStream();
    
    // Clear any pending auto-advance timeout
    if (autoAdvanceTimeoutRef.current) {
      clearTimeout(autoAdvanceTimeoutRef.current);
      autoAdvanceTimeoutRef.current = null;
    }
    
    // Update global state
    useStore.getState().setIsPlayingAudio(false);
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
    setIsProcessingPage,
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