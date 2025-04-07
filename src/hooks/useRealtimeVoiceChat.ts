import { useCallback, useEffect, useRef, useState } from 'react';
import useStore from '../store/useStore';
import useSocket from './useSocket';

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
    
    // Handle realtime events
    const handleRealtimeEvent = (event: any) => {
      if (event.type) {
      }
      
      // Handle different event types
      switch (event.type) {
        case 'session.created':
        case 'session.updated':
          break;
          
        case 'input_audio_buffer.speech_started':
          break;
          
        case 'input_audio_buffer.speech_stopped':
          break;
          
        case 'input_audio_buffer.committed':
          break;
          
        case 'response.created':
          setIsProcessing(true);
          break;
          
        case 'response.text.delta':
          if (event.delta && event.delta.text) {
            addMessage(event.delta.text, 'bot', true);
          }
          break;
          
        case 'response.audio_transcript.delta':
          // Handle transcript deltas (new in OpenAI realtime API)
          break;
          
        case 'response.function_call_arguments.done':
          // Handle function calls from OpenAI
          try {
            const { name, arguments: args, call_id } = event;
            
            if (name && call_id) {
              if (socket && socket.connected) {
                socket.emit('function-call', {
                  sessionId: sessionId,
                  functionName: name,
                  arguments: args,
                  callId: call_id
                });
              }
            }
          } catch (error) {
          }
          break;
          
        case 'response.audio.delta':
          if (event.delta) {
            // OpenAI sends the audio data directly in the delta property, not in delta.audio
            const audioBase64 = typeof event.delta === 'string' ? event.delta : null;
            
            if (audioBase64 && audioBase64.length > 0) {
              accumulatedChunks.current.push(audioBase64);
              
              // Indicate that we're streaming audio
              setIsStreaming(true);
              
              // Clear any existing timeout
              if (bufferingTimeoutRef.current) {
                clearTimeout(bufferingTimeoutRef.current);
              }
              
              // Use a buffering strategy based on timing and buffer size
              const BUFFER_SIZE_THRESHOLD = 5; // Process after accumulating this many chunks
              const BUFFER_TIME_MS = 300; // or process after this much time has passed since last chunk
              const currentTime = Date.now();
              
              // Logic for when to process chunks:
              // 1. If we have a large enough buffer, process immediately
              // 2. If this is the first chunk, wait a short time to accumulate more
              // 3. If it's been a while since the last chunk, process what we have
              // 4. Otherwise, set a timeout to process soon
              
              if (accumulatedChunks.current.length >= BUFFER_SIZE_THRESHOLD) {
                // We have enough chunks to process now
                processAccumulatedChunks();
              } 
              else if (audioChunksProcessed.current === 0 && accumulatedChunks.current.length >= 3) {
                // Initial playback - start after we have a few chunks
                processAccumulatedChunks();
              }
              else if (lastChunkTime.current > 0 && (currentTime - lastChunkTime.current) > 1000) {
                // It's been a while since our last chunk, process what we have
                processAccumulatedChunks();
              }
              else {
                // Set a timeout to process chunks after a short delay
                // This allows multiple chunks to accumulate for smoother playback
                bufferingTimeoutRef.current = setTimeout(() => {
                  if (accumulatedChunks.current.length > 0) {
                    processAccumulatedChunks();
                  }
                }, BUFFER_TIME_MS);
              }
              
              // Update last chunk time
              lastChunkTime.current = currentTime;
            }
          } else {
            // This is normal - OpenAI sometimes sends empty audio delta events at the start/end
          }
          break;
          
        case 'response.text.final':
          break;
          
        case 'response.audio.final':
          break;
          
        // Handle "done" events for all response types
        case 'response.audio.done':
          // Mark that processing is complete, but don't interrupt playback
          isProcessingComplete.current = true;
          
          // Clear any buffering timeout
          if (bufferingTimeoutRef.current) {
            clearTimeout(bufferingTimeoutRef.current);
            bufferingTimeoutRef.current = null;
          }
          
          // Process any remaining accumulated chunks
          if (accumulatedChunks.current.length > 0) {
            processAccumulatedChunks();
          }
          
          // Process any remaining audio buffer chunks (although this should now be empty)
          if (audioBufferChunks.current.length > 0) {
            processAndPlayAudioChunks();
          } else {
            // Only set streaming to false if there's no audio currently playing
            if (!currentAudioRef.current && audioPlaybackQueue.current.length === 0) {
              setIsStreaming(false);
            }
          }
          
          // Reset the chunk counter for the next session
          lastChunkTime.current = 0;
          break;
          
        case 'response.audio_transcript.done':
          break;
          
        case 'response.content_part.done':
          // Check if this is an audio content part with a transcript
          if (event.part && event.part.type === 'audio' && event.part.transcript) {
            const itemId = event.item_id || 'unknown';
            const transcript = event.part.transcript;
            
            // Create a compound key that includes more metadata to better identify duplicates
            const transcriptKey = `${event.response_id || ''}-${itemId}-${event.output_index || ''}-${event.content_index || ''}`;
            
            // Skip if we've already processed this transcript item ID
            if (processedTranscriptItems.current.has(transcriptKey)) {
              break;
            }
            
            // Also skip if this is the exact same transcript text we just processed
            // This helps catch duplicates that might have different IDs but same content
            if (transcript === lastTranscriptRef.current) {
              break;
            }
            
            // Add the transcript to the chat messages
            // Using append: false to create a new message rather than appending to an existing one
            addMessage(transcript, 'bot', false);
            
            // Mark this item as processed to avoid duplicate transcripts
            processedTranscriptItems.current.add(transcriptKey);
            // Also store the transcript text itself to catch duplicates with different IDs
            lastTranscriptRef.current = transcript;
          }
          break;
          
        case 'response.output_item.done':
          break;
        
        case 'response.done':
          // This is the final event, we can safely reset processing
          setIsProcessing(false);
          
          // Mark that processing is complete
          isProcessingComplete.current = true;
          
          // Clear any buffering timeout
          if (bufferingTimeoutRef.current) {
            clearTimeout(bufferingTimeoutRef.current);
            bufferingTimeoutRef.current = null;
          }
          
          // Process any remaining accumulated chunks
          if (accumulatedChunks.current.length > 0) {
            processAccumulatedChunks();
          }
          
          // Don't reset streaming flag if audio is still playing
          // It will be reset after all audio finishes playing
          
          // Clear accumulated chunks for next interaction
          accumulatedChunks.current = [];
          
          // Ensure buffer is cleared for next interaction
          audioBufferChunks.current = [];
          
          // Clear the processed transcript items for the next conversation
          processedTranscriptItems.current.clear();
          lastTranscriptRef.current = '';
          
          break;
        
        case 'error':
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
          
          break;
          
        default:
      }
    };
    
    // Function to process accumulated chunks before handing off to the audio processor
    const processAccumulatedChunks = () => {
      if (accumulatedChunks.current.length === 0) return;
      
      // Take all accumulated chunks and move them to the buffer for processing
      const chunksToProcess = [...accumulatedChunks.current];
      accumulatedChunks.current = [];
      
      // Add to our buffer and process
      audioBufferChunks.current.push(...chunksToProcess);
      
      // Update the last chunk time
      lastChunkTime.current = Date.now();
      
      // Process the buffer
      processAndPlayAudioChunks();
    };
    
    // Function to process and play accumulated audio chunks
    const processAndPlayAudioChunks = () => {
      if (audioBufferChunks.current.length === 0) return;
      
      // Take all available chunks and process them
      const chunksToProcess = [...audioBufferChunks.current];
      audioBufferChunks.current = [];
      
      try {
        // Combine the chunks
        const audioBase64 = chunksToProcess.join('');
        
        // For PCM16 format, we need to convert to a playable format
        // First, decode the base64 data
        const binaryString = atob(audioBase64);
        
        // Convert binary string to Int16Array (PCM16 format)
        const pcmData = new Int16Array(binaryString.length / 2);
        let byteIndex = 0;
        
        for (let i = 0; i < pcmData.length; i++) {
          // PCM16 is little-endian (least significant byte first)
          const byte1 = binaryString.charCodeAt(byteIndex++);
          const byte2 = binaryString.charCodeAt(byteIndex++);
          pcmData[i] = (byte2 << 8) | byte1;
        }
        
        // Convert PCM data to WAV by adding a proper header
        const wavHeader = createWavHeader(pcmData.byteLength, 24000, 1, 16);
        
        // Combine header and PCM data
        const wavData = new Uint8Array(wavHeader.length + pcmData.byteLength);
        wavData.set(wavHeader);
        // Convert Int16Array to Uint8Array to combine with header
        new Uint8Array(wavData.buffer, wavHeader.length).set(new Uint8Array(pcmData.buffer));
        
        // Create blob and URL
        const blob = new Blob([wavData], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        
        const nextAudio = new Audio(url);
        
        // Ensure smooth playback by preloading
        nextAudio.preload = 'auto';
        
        // Common setup for the audio element
        const setupAudioElement = (audio: HTMLAudioElement) => {
          audio.oncanplaythrough = () => {
          };
          
          audio.onerror = (err) => {
            URL.revokeObjectURL(url);
            checkAndFinishStreaming();
          };
          
          audio.onended = () => {
            URL.revokeObjectURL(url);
            
            // If this was the current audio, set it to null
            if (currentAudioRef.current === audio) {
              currentAudioRef.current = null;
            }
            
            // Remove this audio from the queue if it's there
            audioPlaybackQueue.current = audioPlaybackQueue.current.filter(a => a !== audio);
            
            // Play the next audio in the queue if any
            playNextInQueue();
            
            // Check if we should finish streaming
            checkAndFinishStreaming();
          };
        };
        
        // Function to play the next audio in the queue
        const playNextInQueue = () => {
          if (audioPlaybackQueue.current.length > 0 && !currentAudioRef.current) {
            const nextToPlay = audioPlaybackQueue.current[0];
            
            // Set as current audio and remove from queue
            currentAudioRef.current = nextToPlay;
            audioPlaybackQueue.current.shift();
            
            // Update global audio state
            useStore.getState().setIsPlayingAudio(true);
            
            // Start playing the next chunk slightly before the current one fully ends
            // to minimize gaps between audio segments
            nextToPlay.play().then(() => {
            }).catch(err => {
              URL.revokeObjectURL(nextToPlay.src);
              currentAudioRef.current = null;
              
              // Update global audio state on error
              useStore.getState().setIsPlayingAudio(false);
              
              checkAndFinishStreaming();
            });
          }
        };
        
        // Check if we should finish streaming (no more audio playing and no more chunks expected)
        const checkAndFinishStreaming = () => {
          if (
            isProcessingComplete.current && 
            !currentAudioRef.current && 
            audioPlaybackQueue.current.length === 0 && 
            audioBufferChunks.current.length === 0 &&
            accumulatedChunks.current.length === 0
          ) {
            setIsStreaming(false);
            
            // Update global audio state
            useStore.getState().setIsPlayingAudio(false);
            
            // Reset for next session
            audioChunksProcessed.current = 0;
            isProcessingComplete.current = false;
            lastChunkTime.current = 0;
          }
        };
        
        // Set up the audio element
        setupAudioElement(nextAudio);
        
        // Increment our counter
        audioChunksProcessed.current += chunksToProcess.length;
        
        if (!currentAudioRef.current) {
          // No audio currently playing, start this one immediately
          currentAudioRef.current = nextAudio;
          
          // Update global audio state
          useStore.getState().setIsPlayingAudio(true);
          
          nextAudio.play().then(() => {
          }).catch(err => {
            URL.revokeObjectURL(url);
            currentAudioRef.current = null;
            
            // Update global audio state on error
            useStore.getState().setIsPlayingAudio(false);
            
            checkAndFinishStreaming();
          });
        } else {
          // Add to queue to play later
          audioPlaybackQueue.current.push(nextAudio);
        }
        
      } catch (err) {
        if (err instanceof Error && err.stack) {
        }
      }
    };
    
    // Function to create a WAV header
    const createWavHeader = (dataLength: number, sampleRate: number, numChannels: number, bitsPerSample: number) => {
      const headerLength = 44;
      const wavHeader = new Uint8Array(headerLength);
      
      // "RIFF" chunk descriptor
      wavHeader.set([0x52, 0x49, 0x46, 0x46]); // "RIFF" in ASCII
      
      // Chunk size (file size - 8)
      const fileSize = dataLength + headerLength - 8;
      wavHeader.set([
        fileSize & 0xff,
        (fileSize >> 8) & 0xff,
        (fileSize >> 16) & 0xff,
        (fileSize >> 24) & 0xff
      ], 4);
      
      // "WAVE" format
      wavHeader.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE" in ASCII
      
      // "fmt " sub-chunk
      wavHeader.set([0x66, 0x6d, 0x74, 0x20], 12); // "fmt " in ASCII
      
      // Sub-chunk size (16 for PCM)
      wavHeader.set([16, 0, 0, 0], 16);
      
      // Audio format (1 for PCM)
      wavHeader.set([1, 0], 20);
      
      // Number of channels
      wavHeader.set([numChannels, 0], 22);
      
      // Sample rate
      wavHeader.set([
        sampleRate & 0xff,
        (sampleRate >> 8) & 0xff,
        (sampleRate >> 16) & 0xff,
        (sampleRate >> 24) & 0xff
      ], 24);
      
      // Byte rate = SampleRate * NumChannels * BitsPerSample/8
      const byteRate = sampleRate * numChannels * bitsPerSample / 8;
      wavHeader.set([
        byteRate & 0xff,
        (byteRate >> 8) & 0xff,
        (byteRate >> 16) & 0xff,
        (byteRate >> 24) & 0xff
      ], 28);
      
      // Block align = NumChannels * BitsPerSample/8
      const blockAlign = numChannels * bitsPerSample / 8;
      wavHeader.set([blockAlign, 0], 32);
      
      // Bits per sample
      wavHeader.set([bitsPerSample, 0], 34);
      
      // "data" sub-chunk
      wavHeader.set([0x64, 0x61, 0x74, 0x61], 36); // "data" in ASCII
      
      // Data size
      wavHeader.set([
        dataLength & 0xff,
        (dataLength >> 8) & 0xff,
        (dataLength >> 16) & 0xff,
        (dataLength >> 24) & 0xff
      ], 40);
      
      return wavHeader;
    };
    
    // Handle audio stream events specially (compatibility with older API)
    const handleAudioStream = (data: { audio: string, sessionId: string }) => {
      if (data.audio && data.audio.length > 0) {
        try {
          const audio = new Audio(`data:audio/mp3;base64,${data.audio}`);
          audio.play().catch(err => {
          });
        } catch (err) {
        }
      }
    };
    
    // Handle errors
    const handleError = (error: any) => {
      const errorMessage = typeof error === 'string' ? error : 
        (error?.message || 'Unknown server error');
      setError(errorMessage);
      
      // For general errors, add a message to the chat
      addMessage(`There was a problem with the voice chat: ${errorMessage}. Please try again.`, 'bot', false);
    };
    
    // Add event listeners
    socket.on('realtime-event', handleRealtimeEvent);
    socket.on('audio-stream', handleAudioStream);
    socket.on('error', handleError);
    
    // Cleanup function
    return () => {
      socket.off('realtime-event', handleRealtimeEvent);
      socket.off('audio-stream', handleAudioStream);
      socket.off('error', handleError);
      
      // Clean up any playing audio
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        if (currentAudioRef.current.src) {
          URL.revokeObjectURL(currentAudioRef.current.src);
        }
        currentAudioRef.current = null;
      }
      
      // Clean up any queued audio elements
      audioPlaybackQueue.current.forEach(audio => {
        if (audio.src) {
          URL.revokeObjectURL(audio.src);
        }
      });
      audioPlaybackQueue.current = [];
      
      // Clear any buffering timeout
      if (bufferingTimeoutRef.current) {
        clearTimeout(bufferingTimeoutRef.current);
        bufferingTimeoutRef.current = null;
      }
      
      // Clear accumulated chunks
      accumulatedChunks.current = [];
    };
  }, [socket, sessionId, addMessage, setIsProcessing, isStreaming]);
  
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