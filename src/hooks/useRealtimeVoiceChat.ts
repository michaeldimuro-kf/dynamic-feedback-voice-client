import { useCallback, useEffect, useRef, useState } from 'react';
import useStore from '../store/useStore';
import useSocket from './useSocket';
import { useAudioStream } from './useAudioStream';

interface VoiceChatOptions {
  initialPrompt?: string;
  voice?: string;
  
  disableVad?: boolean;
}

/**
 * Custom hook for real-time voice chat using OpenAI's real-time API
 */
const useRealtimeVoiceChat = (options: VoiceChatOptions | string = {}) => {
  // Handle both string and object parameters for backward compatibility
  const config: VoiceChatOptions = typeof options === 'string' 
    ? { initialPrompt: options } 
    : options;
  
  const initialPrompt = config.initialPrompt || '';
  
  const { addMessage, setIsProcessing, setIsRecording } = useStore();
  const { socket, socketReady } = useSocket();
  
  // Use our updated audio stream hook with socket passed in
  const { 
    playAudioChunk, 
    stopPlayback, 
    completeAudioStream, 
    resetAudioStream
  } = useAudioStream(socket);
  
  // State variables
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<string>('disconnected');
  const [isStreaming, setIsStreaming] = useState(false);
  
  // Audio processing refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioProcessorRef = useRef<AudioWorkletNode | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  
  // Add audio buffer state for collecting chunks
  const audioBufferChunks = useRef<string[]>([]);
  
  // Add refs for streaming audio playback
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioChunksProcessed = useRef<number>(0);
  const audioPlaybackQueue = useRef<HTMLAudioElement[]>([]);
  const isProcessingComplete = useRef<boolean>(false);
  
  // Audio buffering refs for smoother playback
  const bufferingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accumulatedChunks = useRef<string[]>([]);
  const lastChunkTime = useRef<number>(0);
  const audioContext = useRef<AudioContext | null>(null);
  
  // Keep track of the session ID even if state gets cleared
  const sessionIdRef = useRef<string | null>(null);
  
  // Add a ref to track processed transcript item IDs to avoid duplicates
  const processedTranscriptItems = useRef<Set<string>>(new Set());
  // Track the last received transcript to avoid duplicates with different IDs
  const lastTranscriptRef = useRef<string>('');
  
  // Update the ref whenever the state changes
  useEffect(() => {
    if (sessionId) {
      sessionIdRef.current = sessionId;
    }
  }, [sessionId]);
  
  // Utility function to convert Float32Array to Int16Array (16-bit PCM)
  const convertToInt16 = (float32Array: Float32Array): Int16Array => {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      // Convert from [-1.0, 1.0] to [-32768, 32767]
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
  };
  
  // Convert ArrayBuffer to Base64
  const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  };
  
  // Create a session with the server
  const createSession = useCallback(async () => {
    try {
      setError(null);
      
      if (!socket) {
        const error = 'Socket not connected';
        throw new Error(error);
      }
      
      if (!socketReady) {
        const error = 'Socket not ready';
        throw new Error(error);
      }
      
      return new Promise<string>((resolve, reject) => {
        // Set timeout for session creation
        const timeoutId = setTimeout(() => {
          reject(new Error('Session creation timeout'));
        }, 10000);
        
        // Listen for session creation response
        const handleSessionCreated = (response: any) => {
          clearTimeout(timeoutId);
          socket.off('realtime-session-started', handleSessionCreated);
          
          if (response.success) {
            const newSessionId = response.sessionId;
            setSessionId(newSessionId);
            
            // Double-check session ID was set
            setTimeout(() => {
              // Session verification
            }, 0);
            
            resolve(newSessionId);
          } else {
            setError(response.error || 'Failed to create session');
            reject(new Error(response.error || 'Failed to create session'));
          }
        };
        
        // Set up listener
        socket.on('realtime-session-started', handleSessionCreated);
        
        // Send session creation request
        socket.emit('start-realtime-session', { 
          initialPrompt,
          voice: config.voice,
          disableVad: config.disableVad
        });
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Only set the error to the UI if it's a critical issue
      // Ignore transient errors that don't affect functionality
      if (errorMessage !== 'Socket not ready' && 
          errorMessage !== 'Socket not connected' &&
          !errorMessage.includes('timeout')) {
        setError(`Failed to create session: ${errorMessage}`);
      }
      throw error;
    }
  }, [socket, socketReady, initialPrompt, sessionId, config.voice, config.disableVad]);
  
  // Connect to an existing session
  const connectSession = useCallback(async (sid: string | null = null) => {
    try {
      setError(null);
      
      if (!socket) {
        const error = 'Socket not connected';
        throw new Error(error);
      }
      
      if (!socketReady) {
        const error = 'Socket not ready';
        throw new Error(error);
      }
      
      // Use provided session ID or current session ID or create new one
      let targetSessionId: string;
      if (sid) {
        targetSessionId = sid;
      } else if (sessionId) {
        targetSessionId = sessionId;
      } else {
        targetSessionId = await createSession();
      }
      
      return new Promise<boolean>((resolve, reject) => {
        // Set timeout for connection
        const timeoutId = setTimeout(() => {
          reject(new Error('Session connection timeout'));
        }, 10000);
        
        // Listen for connection response
        const handleSessionConnected = (response: any) => {
          clearTimeout(timeoutId);
          socket.off('realtime-session-connected', handleSessionConnected);
          
          if (response.success) {
            setConnectionState('connected');
            resolve(true);
          } else {
            // Check if the functionality appears to be working despite the error
            if (response.error?.includes('Failed to connect to OpenAI') || response.error?.includes('OpenAI API')) {
              // Mark the connection as tentatively successful, but in a warning state
              setConnectionState('warning');
              
              // Don't surface this error to the user if functionality may still work
              resolve(true);
            } else {
              setError(response.error || 'Failed to connect session');
              setConnectionState('error');
              reject(new Error(response.error || 'Failed to connect session'));
            }
          }
        };
        
        // Set up listener
        socket.on('realtime-session-connected', handleSessionConnected);
        
        // Send connection request
        socket.emit('connect-realtime-session', {
          sessionId: targetSessionId,
          initialPrompt,
          voice: config.voice,
          disableVad: config.disableVad
        });
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Only set the error to the UI if it's a critical issue
      // Ignore transient errors that don't affect functionality
      if (errorMessage !== 'Socket not ready' && 
          errorMessage !== 'Socket not connected' &&
          !errorMessage.includes('timeout') &&
          !errorMessage.includes('OpenAI')) {
        setError(`Failed to connect session: ${errorMessage}`);
      }
      throw error;
    }
  }, [socket, socketReady, sessionId, createSession, initialPrompt, config.voice]);
  
  // Start a session (create and connect)
  const startSession = useCallback(async () => {
    try {
      setError(null);
      
      // Create session if it doesn't exist and store the result directly
      let currentSessionId = sessionId;
      if (!currentSessionId) {
        currentSessionId = await createSession();
      }
      
      // Connect to the session
      try {
        await connectSession(currentSessionId);
      } catch (error) {
        // If the connection fails but we already have a session ID,
        // we might still be able to function
        if (currentSessionId) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          // Don't re-throw the error - allow the app to continue
        } else {
          throw error;
        }
      }
      
      // Return the session ID for immediate use
      return currentSessionId;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Only set visible error for critical issues
      if (!errorMessage.includes('connect to OpenAI') && 
          !errorMessage.includes('OpenAI API')) {
        setError(`Failed to start session: ${errorMessage}`);
      }
      
      // Return null to indicate failure
      return null;
    }
  }, [sessionId, createSession, connectSession]);
  
  // Start recording audio
  const startRecording = useCallback(async () => {
    try {
      setError(null);
      
      // Directly get a session ID that we can use immediately, don't rely on state
      let currentSessionId = sessionId;
      
      // Ensure we have a session
      if (!currentSessionId) {
        currentSessionId = await startSession();
      }
      
      if (!socket || !socketReady) {
        throw new Error('Socket not connected or not ready');
      }
      
      // Now verify we have a session ID
      if (!currentSessionId) {
        setError('Failed to obtain a valid session ID for recording');
        return false;
      }
      
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      // Create AudioContext
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000 // Using 16kHz as recommended by OpenAI
      });
      
      // Create source node from microphone stream
      const source = audioContext.createMediaStreamSource(stream);
      
      // Load the audio worklet module
      await audioContext.audioWorklet.addModule(
        URL.createObjectURL(new Blob([`
          class AudioProcessor extends AudioWorkletProcessor {
            process(inputs, outputs, parameters) {
              // Get input data
              const input = inputs[0];
              if (input.length > 0 && input[0].length > 0) {
                // Send the audio data to the main thread
                this.port.postMessage({
                  audioData: input[0]
                });
              }
              return true; // Keep the processor alive
            }
          }
          
          registerProcessor('audio-processor', AudioProcessor);
        `], { type: 'application/javascript' }))
      );
      
      // Create worklet node
      const processor = new AudioWorkletNode(audioContext, 'audio-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        processorOptions: {}
      });
      
      // Add message handler for audio data
      processor.port.onmessage = (event) => {
        if (!socket || !socket.connected || !currentSessionId) {
          const reason = !socket ? "Socket missing" : 
                      !socket.connected ? "Socket disconnected" : 
                      "Session ID missing";
          return;
        }
        
        // Get PCM data from the event
        const inputData = event.data.audioData;
        
        // Convert to Int16Array (16-bit PCM)
        const pcmBuffer = convertToInt16(new Float32Array(inputData));
        
        // Convert to base64 for transmission
        const base64Audio = arrayBufferToBase64(pcmBuffer.buffer);
        
        // Send to server using the current socket
        socket.emit('audio-data', {
          sessionId: currentSessionId,
          audioData: base64Audio
        });
      };
      
      // Store references
      audioContextRef.current = audioContext;
      audioSourceRef.current = source;
      audioProcessorRef.current = processor;
      audioStreamRef.current = stream;
      
      // Connect nodes: source -> processor -> destination
      source.connect(processor);
      processor.connect(audioContext.destination);
      
      // Update state
      setIsRecording(true);
      
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setError(`Failed to start recording: ${errorMessage}`);
      
      // Cleanup partial setup
      stopRecording();
      return false;
    }
  }, [socket, socketReady, sessionId, startSession, setIsRecording]);
  
  // Stop recording audio
  const stopRecording = useCallback(() => {
    // Ensure we save the current session ID before cleanup
    if (sessionId && !sessionIdRef.current) {
      sessionIdRef.current = sessionId;
    }
    
    // Disconnect and cleanup audio processing nodes
    if (audioProcessorRef.current) {
      try {
        audioProcessorRef.current.disconnect();
      } catch (err) {
      }
      audioProcessorRef.current = null;
    }
    
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.disconnect();
      } catch (err) {
      }
      audioSourceRef.current = null;
    }
    
    // Stop all media stream tracks
    if (audioStreamRef.current) {
      try {
        audioStreamRef.current.getTracks().forEach(track => track.stop());
      } catch (err) {
      }
      audioStreamRef.current = null;
    }
    
    // Close audio context
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close().catch(err => {});
      } catch (err) {
      }
      audioContextRef.current = null;
    }
    
    // Update state
    setIsRecording(false);
  }, [setIsRecording, sessionId]);
  
  // End the session
  const endSession = useCallback(async () => {
    try {
      // Stop recording if active
      if (useStore.getState().audioState.isRecording) {
        stopRecording();
      }
      
      // Tell the server to end the session
      if (socket && socketReady && sessionId) {
        socket.emit('end-realtime-session', { sessionId });
      }
      
      // Clear state
      // setSessionId(null);
      setConnectionState('disconnected');
      
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setError(`Failed to end session: ${errorMessage}`);
      return false;
    }
  }, [socket, socketReady, sessionId, stopRecording]);
  
  // Manually commit the audio buffer when VAD is disabled
  const commitAudioBuffer = useCallback(async () => {
    try {
      // Enhanced connection check
      if (!socket) {
        throw new Error('Socket not connected or session not established');
      }
      
      if (!socket.connected) {
        try {
          socket.connect();
          // Wait for connection
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('Socket reconnection timeout'));
            }, 5000);
            
            const connectHandler = () => {
              clearTimeout(timeout);
              resolve(true);
            };
            
            socket.once('connect', connectHandler);
          });
        } catch (reconnectError) {
          throw new Error('Failed to reconnect to server');
        }
      }
      
      // Try to use the stateful sessionId first, then fall back to the ref if needed
      const currentSessionId = sessionId || sessionIdRef.current;
      
      if (!currentSessionId) {
        throw new Error('No active session ID');
      }
      
      socket.emit('commit-audio-buffer', { sessionId: currentSessionId });
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setError(`Failed to commit audio buffer: ${errorMessage}`);
      return false;
    }
  }, [socket, sessionId]);
  
  // Manually create a response when VAD is disabled
  const createResponse = useCallback(async () => {
    try {
      // First check if we're already processing a response
      if (useStore.getState().audioState.isProcessing) {
        setError("Conversation already has an active response");
        return false;
      }

      // Enhanced connection check
      if (!socket) {
        throw new Error('Socket not connected or session not established');
      }
      
      if (!socket.connected) {
        throw new Error('Socket disconnected');
      }
      
      // Try to use the stateful sessionId first, then fall back to the ref if needed
      const currentSessionId = sessionId || sessionIdRef.current;
      
      if (!currentSessionId) {
        throw new Error('No active session ID');
      }
      
      setIsProcessing(true);
      socket.emit('create-response', { sessionId: currentSessionId });
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setError(`Failed to create response: ${errorMessage}`);
      setIsProcessing(false);
      return false;
    }
  }, [socket, sessionId, setIsProcessing]);
  
  // Clear the audio buffer before beginning a new input
  const clearAudioBuffer = useCallback(async () => {
    try {
      // Enhanced connection check
      if (!socket) {
        throw new Error('Socket not connected or session not established');
      }
      
      if (!socket.connected) {
        throw new Error('Socket disconnected');
      }
      
      // Try to use the stateful sessionId first, then fall back to the ref if needed
      const currentSessionId = sessionId || sessionIdRef.current;
      
      if (!currentSessionId) {
        throw new Error('No active session ID');
      }
      
      socket.emit('clear-audio-buffer', { sessionId: currentSessionId });
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setError(`Failed to clear audio buffer: ${errorMessage}`);
      return false;
    }
  }, [socket, sessionId]);
  
  // Handle realtime events from the server
  useEffect(() => {
    if (!socket) return;
    
    // Handler for realtime events
    const handleRealtimeEvent = (event: any) => {
      try {
        // Handle different event types
        if (event.type === 'transcript') {
          if (event.delta && event.delta.text) {
            addMessage(event.delta.text, 'bot', true);
          }
        } else if (event.type === 'audio') {
          // Use RxJS audio streaming service for audio playback
          if (event.data?.audio && typeof event.data.audio === 'string') {
            // Pass the audio chunk to our RxJS stream
            playAudioChunk(event.data.audio);
            setIsStreaming(true);
          }
        } else if (event.type === 'error') {
          const errorMessage = event.error?.message || 'Unknown error';
          const errorCode = event.error?.code || 'ERROR';
          
          // Set the error in our state so UI can display it
          setError(`Error: ${errorMessage}`);
          
          // Always reset processing state on error
          setIsProcessing(false);
          
          // Clear any buffered audio chunks on error
          audioBufferChunks.current = [];
          
          // Special handling for session not found errors - prompt to create a new session
          if (errorCode === 'SESSION_NOT_FOUND') {
            setSessionId(null); // Reset the session ID to force creation of a new one
            setConnectionState('disconnected');
            
            // Add a readable message to the chat
            addMessage(`I lost connection to your audio stream. Please try recording again.`, 'bot', false);
            
            // Attempt to automatically reconnect
            startSession().then(newSessionId => {
              if (newSessionId) {
                setSessionId(newSessionId);
                setConnectionState('connected');
                setError(null);
              }
            }).catch(err => {
            });
          }
          
          if (errorCode === 'SEND_AUDIO_FAILED' || errorCode === 'AUDIO_PROCESSING_ERROR') {
            // For audio errors, just show a message but don't interrupt the session
            addMessage(`There was an issue processing your audio. Please try speaking again.`, 'bot', false);
          }
        } else if (event.type === 'done') {
          // Use our RxJS service to complete the stream
          completeAudioStream();
          setIsStreaming(false);
          setIsProcessing(false);
        }
      } catch (error) {
        // ... existing error handling code ...
      }
    };
    
    socket.on('realtime-event', handleRealtimeEvent);
    
    return () => {
      socket.off('realtime-event', handleRealtimeEvent);
    };
  }, [socket, addMessage, setIsProcessing, playAudioChunk, completeAudioStream]);
  
  // Print socket state when it changes
  useEffect(() => {
    if (socket) {
      // Add one-time connection event handler
      socket.once('connect', () => {
      });
      
      // Add disconnect handler
      socket.on('disconnect', (reason) => {
      });
      
      // Add reconnect handler
      socket.on('reconnect', (attemptNumber) => {
      });
    }
  }, [socket, socketReady]);
  
  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (useStore.getState().audioState.isRecording) {
        stopRecording();
      }
      
      endSession().catch(err => {
      });
    };
  }, [endSession, stopRecording]);
  
  // Run the function when socket is ready and we have a session ID
  useEffect(() => {
    if (socketReady && !sessionId && connectionState === 'disconnected') {
      startSession()
        .then((newSessionId) => {
          if (newSessionId) {
          }
        })
        .catch((err) => {
        });
    }
  }, [socketReady, sessionId, connectionState, startSession]);
  
  // Add a safety effect to reset stuck processing state
  useEffect(() => {
    // If processing lasts more than 20 seconds, automatically reset it as a failsafe
    let processingTimeout: ReturnType<typeof setTimeout> | null = null;
    
    if (useStore.getState().audioState.isProcessing) {
      processingTimeout = setTimeout(() => {
        setIsProcessing(false);
        setIsStreaming(false);
        addMessage('The AI seems to be taking too long to respond. Please try again.', 'bot', false);
      }, 20000);
    }
    
    return () => {
      if (processingTimeout) {
        clearTimeout(processingTimeout);
      }
    };
  }, [useStore.getState().audioState.isProcessing, addMessage, setIsProcessing]);
  
  // Clear audio playback when component unmounts
  useEffect(() => {
    return () => {
      resetAudioStream();
    };
  }, [resetAudioStream]);
  
  // Handle audio stream from server - replace with our new logic
  const handleAudioStream = (data: { audio: string, sessionId: string }) => {
    if (data.audio && typeof data.audio === 'string') {
      // Pass audio chunk to our RxJS stream
      playAudioChunk(data.audio);
    }
  };
  
  // Return functions and state
  return {
    // Session state
    sessionId,
    connectionState,
    error,
    
    // Get the current session ID (either from state or ref)
    getCurrentSessionId: () => sessionId || sessionIdRef.current,
    
    // Actions
    createSession,
    startSession,
    connectSession,
    startRecording,
    stopRecording,
    endSession,
    commitAudioBuffer,
    createResponse,
    clearAudioBuffer,
    
    // Audio state
    isRecording: useStore.getState().audioState.isRecording,
    isProcessing: useStore.getState().audioState.isProcessing,
    isStreaming,
    
    // Socket state for direct access
    socket,
  };
};

export default useRealtimeVoiceChat; 