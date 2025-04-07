import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MdMic, MdStop, MdClose } from 'react-icons/md';
import { motion, AnimatePresence } from 'framer-motion';
import MicrophonePermissionsModal from './MicrophonePermissionsModal';
import useStore from '../store/useStore';
import useRealtimeVoiceChat from '../hooks/useRealtimeVoiceChat';
import useSocket from '../hooks/useSocket';
import '../styles/AudioRecorder.css';
import { BsMicFill } from 'react-icons/bs';

/**
 * AudioRecorder component for voice chat with the AI
 */
const AudioRecorder: React.FC = () => {
  const {
    setIsRecording,
    setIsProcessing,
    audioState
  } = useStore();
  
  // Get socket connection
  const { socket, pauseAudio, resumeAudio } = useSocket();
  
  // State for the recorder UI
  const [permissionDenied, setPermissionDenied] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth < 768);
  
  // Reference to track if we're currently recording (regardless of hook state)
  const isRecordingRef = useRef<boolean>(false);
  
  // Track if narration was active before starting recording
  const wasNarratingRef = useRef<boolean>(false);
  
  // Create a ref to track if we have an outstanding narration request
  const hasActiveNarrationRef = useRef<boolean>(false);
  
  // Use our custom hook for realtime voice chat
  const {
    sessionId,
    connectionState,
    error: voiceChatError,
    startSession,
    startRecording,
    stopRecording,
    isRecording,
    isProcessing,
    isStreaming,
    endSession,
    commitAudioBuffer,
    createResponse,
    clearAudioBuffer,
    getCurrentSessionId
  } = useRealtimeVoiceChat({
    initialPrompt: 'My name is Michael. Please refer to me as such. You are a helpful assistant that answers questions about documents. Keep your answers concise and friendly. Always end your response by asking me if I have any questions or if we should continue.',
    voice: 'echo', // OpenAI voice options: alloy, ash, ballad, coral, echo, sage, shimmer, verse
    disableVad: true // Disable Voice Activity Detection for manual control
  });
  
  // Map connection state to UI state
  const voiceChatConnected = connectionState === 'connected';

  // Check if device is mobile
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Sync hook's recording state to our ref
  useEffect(() => {
    isRecordingRef.current = isRecording;
    // Update the global store state
    setIsRecording(isRecording);
  }, [isRecording, setIsRecording]);

  // Handle errors from the voice chat hook
  useEffect(() => {
    if (voiceChatError) {
      setErrorMessage(voiceChatError);
    }
  }, [voiceChatError]);
  
  // Start recording function
  const startRecordingHandler = useCallback(async () => {
    if (isRecordingRef.current || isProcessing) return;
    
    try {
      // Check if narration is active and playing audio
      if (audioState.isNarrating && !audioState.isNarrationPaused && audioState.isPlayingAudio) {
        // Store the narration state so we can resume after recording
        wasNarratingRef.current = true;
        // Pause the narration
        pauseAudio();
      } else {
        wasNarratingRef.current = false;
      }
      
      // Ensure we have a session first
      if (!sessionId) {
        await startSession();
      }
      
      // Since VAD is disabled, clear the audio buffer before starting a new recording
      const cleared = await clearAudioBuffer();
      if (!cleared) {
        // Continue anyway
      }
      
      // Start the actual recording
      const success = await startRecording();
      if (success) {
        isRecordingRef.current = true;
      } else {
        setErrorMessage("Failed to start recording");
        // If we failed to start recording but paused narration, resume it
        if (wasNarratingRef.current) {
          resumeAudio();
          wasNarratingRef.current = false;
        }
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      // If we encountered an error but paused narration, resume it
      if (wasNarratingRef.current) {
        resumeAudio();
        wasNarratingRef.current = false;
      }
    }
  }, [sessionId, startSession, startRecording, isProcessing, clearAudioBuffer, audioState, pauseAudio, resumeAudio]);
  
  // Stop recording function
  const stopRecordingHandler = useCallback(async () => {
    if (!isRecordingRef.current) return;
    
    isRecordingRef.current = false;
    
    try {
      // Store the session ID before stopping the recording to ensure it's available
      const currentSessionId = getCurrentSessionId();
      if (!currentSessionId) {
        setErrorMessage("Session ID not found. Please refresh and try again.");
        return;
      }
      
      // Check connection state before proceeding with manual control
      if (connectionState !== 'connected') {
        setErrorMessage("Not connected to server. Please refresh and try again.");
        return;
      }
      
      await stopRecording();
      
      setIsProcessing(true);

      // Since VAD is disabled, we need to manually commit the audio buffer and create a response
      
      // Manually emit the event directly if the commitAudioBuffer function fails
      try {
        const committed = await commitAudioBuffer();
        if (!committed) {
          if (socket && socket.connected) {
            socket.emit('commit-audio-buffer', { sessionId: currentSessionId });
          } else {
            throw new Error("Socket not connected");
          }
        }
      } catch (commitError) {
        setErrorMessage(commitError instanceof Error ? commitError.message : String(commitError));
        setIsProcessing(false);
        return;
      }
      
      // Create a response once the audio buffer is committed
      try {
        const responseCreated = await createResponse();
        if (!responseCreated) {
          if (socket && socket.connected) {
            socket.emit('create-response', { sessionId: currentSessionId });
          } else {
            throw new Error("Socket not connected");
          }
        }
      } catch (responseError) {
        setErrorMessage(responseError instanceof Error ? responseError.message : String(responseError));
        setIsProcessing(false);
        return;
      }
      
      // Processing will be set to false when the response is done
      // This happens in the event handlers inside useRealtimeVoiceChat
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setIsProcessing(false);
    }
  }, [stopRecording, setIsProcessing, commitAudioBuffer, createResponse, connectionState, socket, getCurrentSessionId]);
  
  // Resume narration if needed after receiving a response
  useEffect(() => {
    // If we were previously narrating, response has completed, and narration is still active but paused
    if (!isProcessing && wasNarratingRef.current && audioState.isNarrating && audioState.isNarrationPaused) {
      // Wait a short delay to ensure response audio has finished playing
      const resumeTimeout = setTimeout(() => {
        resumeAudio();
        wasNarratingRef.current = false;
        // Also reset the active narration flag when we resume audio
        hasActiveNarrationRef.current = false;
      }, 1000);
      
      return () => clearTimeout(resumeTimeout);
    }
    
    // When processing completes, reset our active narration flag
    if (!isProcessing && hasActiveNarrationRef.current) {
      hasActiveNarrationRef.current = false;
    }
  }, [isProcessing, audioState.isNarrating, audioState.isNarrationPaused, resumeAudio]);
  
  // Handle press and hold for recording
  const handleRecordButtonDown = () => {
    startRecordingHandler();
  };
  
  const handleRecordButtonUp = () => {
    stopRecordingHandler();
  };
  
  // Handle spacebar key events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !isRecordingRef.current && !isProcessing) {
        e.preventDefault();
        startRecordingHandler();
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && isRecordingRef.current) {
        e.preventDefault();
        stopRecordingHandler();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isProcessing, startRecordingHandler, stopRecordingHandler]);
  
  // Clean up when component unmounts
  useEffect(() => {
    return () => {
      if (isRecordingRef.current) {
        stopRecording();
      }
      // Reset all refs when component unmounts
      wasNarratingRef.current = false;
      hasActiveNarrationRef.current = false;
      endSession().catch(err => {
        // Silently handle error during cleanup
      });
    };
  }, [stopRecording, endSession]);
  
  // Close permission dialog
  const handleClosePermissionModal = () => {
    setPermissionDenied(false);
  };
  
  // Render more compact UI for mobile
  if (isMobile) {
    return (
      <div className="flex flex-col w-full relative">
        {permissionDenied && <MicrophonePermissionsModal onClose={handleClosePermissionModal} />}
        
        {/* Clean Minimalist Mobile UI with centered mic button */}
        <div className="flex items-center justify-between gap-2 pt-0.5 pb-2.5">
          {/* Status Indicator - Left Side */}
          <div className="flex items-center">
            <div className={`w-2 h-2 rounded-full ${voiceChatConnected ? 'bg-green-500' : 'bg-red-500'} animate-pulse mr-1.5`}></div>
            <span className="text-xs text-neutral-500 whitespace-nowrap">
              {isProcessing ? 'Processing...' : 'Ready'}
            </span>
          </div>
          
          {/* Empty middle space to balance layout */}
          <div className="flex-1"></div>
          
          {/* Keyboard Shortcut - Right Side */}
          <div className="flex items-center">
            <kbd className="text-xs px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-neutral-500 whitespace-nowrap">
              Spacebar
            </kbd>
          </div>
        </div>
        
        {/* Fixed container for the mic button */}
        <div className="mic-button-container">
          <motion.button
            className={`mic-button flex items-center justify-center rounded-full focus:outline-none ${
              isRecording 
                ? 'bg-red-500 text-white shadow-md' 
                : 'bg-white text-primary-600 border-2 border-primary-300 shadow-sm'
            }`}
            animate={
              !isRecording && !isProcessing 
                ? { 
                    boxShadow: ['0 0 0 0 rgba(59, 130, 246, 0)', '0 0 0 8px rgba(59, 130, 246, 0.2)', '0 0 0 0 rgba(59, 130, 246, 0)'],
                    transition: {
                      repeat: Infinity,
                      duration: 2
                    }
                  } 
                : {}
            }
            onTouchStart={handleRecordButtonDown}
            onTouchEnd={handleRecordButtonUp}
            onMouseDown={handleRecordButtonDown}
            onMouseUp={handleRecordButtonUp}
            onMouseLeave={isRecordingRef.current ? handleRecordButtonUp : undefined}
            disabled={!voiceChatConnected || isProcessing}
          >
            {isRecording ? (
              <MdStop className="w-6 h-6" />
            ) : (
              <motion.div
                animate={isProcessing ? {} : { scale: [1, 1.1, 1] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
              >
                <BsMicFill className="w-6 h-6" />
              </motion.div>
            )}
          </motion.button>
        </div>
        
        {/* Error Message - More compact */}
        {errorMessage && (
          <div className="mt-2 text-xs py-1.5 px-2 rounded bg-red-50 text-red-500 border border-red-100">
            {errorMessage}
            <button 
              onClick={() => setErrorMessage('')}
              className="ml-2 text-red-400 hover:text-red-600"
            >
              <MdClose size={14} />
            </button>
          </div>
        )}
      </div>
    );
  }
  
  // Desktop UI with full features
  return (
    <div className="flex flex-col w-full">
      {/* Top Status Bar - Subtle and elegant */}
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${voiceChatConnected ? 'bg-green-500' : 'bg-red-500'} animate-pulse`}></div>
          <span className="text-neutral-600 text-xs font-medium">
            {voiceChatConnected ? 'Voice Ready' : 'Connecting...'}
          </span>
        </div>
        
        <div className="text-xs text-neutral-500 font-medium flex items-center gap-1.5">
          {isProcessing ? (
            <>
              <span className="inline-block w-1.5 h-1.5 bg-primary-500 rounded-full animate-pulse"></span>
              Processing...
            </>
          ) : (
            <>
              Hold 
              <kbd className="px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded text-neutral-500 text-xs font-mono">Space</kbd>
              to speak
            </>
          )}
        </div>
      </div>
      
      {/* Main Recorder Interface - Redesigned for prominence */}
      <div className="relative rounded-xl overflow-hidden shadow-md bg-gradient-to-b from-neutral-50 to-neutral-100 p-4">
        {/* Audio Visualizer Area */}
        <div className="h-16 rounded-lg relative mb-10 backdrop-blur-sm bg-white/60 shadow-inner overflow-hidden">
          <AnimatePresence>
            {isRecording ? (
              <motion.div 
                className="flex items-end justify-center h-full w-full px-3"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {/* Dynamic audio waveform visualizer */}
                {Array.from({ length: 30 }).map((_, i) => (
                  <motion.div
                    key={i}
                    className="bg-gradient-to-t from-primary-600 to-primary-400 w-1 mx-0.5 rounded-t-full"
                    initial={{ height: '10%' }}
                    animate={{ 
                      height: `${Math.random() * 70 + 15}%` 
                    }}
                    transition={{
                      duration: 0.3,
                      repeat: Infinity,
                      repeatType: 'mirror',
                      ease: "easeInOut",
                      delay: i * 0.02 % 0.3
                    }}
                  />
                ))}
              </motion.div>
            ) : isProcessing ? (
              <motion.div 
                className="absolute inset-0 flex items-center justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="flex items-center gap-3">
                  <div className="relative w-6 h-6">
                    <motion.div 
                      className="absolute inset-0 bg-primary-500 rounded-full"
                      animate={{ 
                        scale: [1, 1.5, 1],
                        opacity: [0.7, 0.2, 0.7]
                      }}
                      transition={{
                        duration: 1.5,
                        repeat: Infinity,
                        ease: "easeInOut"
                      }}
                    />
                    <motion.div 
                      className="absolute inset-0 bg-primary-500 rounded-full"
                      animate={{ 
                        scale: [1, 1.8, 1],
                        opacity: [0.7, 0, 0.7]
                      }}
                      transition={{
                        duration: 2,
                        repeat: Infinity,
                        ease: "easeInOut",
                        delay: 0.3
                      }}
                    />
                    <div className="absolute inset-0 bg-primary-500 rounded-full" />
                  </div>
                  <span className="text-neutral-700 font-medium text-sm">Analyzing response...</span>
                </div>
              </motion.div>
            ) : (
              <motion.div 
                className="flex flex-col items-center justify-center h-full text-neutral-500"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <p className="text-sm font-medium">Ask a question about your report</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        
        {/* Central Prominent Record Button */}
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 mic-button-container desktop">
          <motion.button
            className={`mic-button desktop flex items-center justify-center rounded-full drop-shadow-lg focus:outline-none ${
              isRecording 
                ? 'bg-red-500 text-white border-2 border-red-400' 
                : 'bg-white text-primary-600 border-2 border-primary-400'
            }`}
            animate={
              isRecording 
                ? { boxShadow: '0 0 0 0px rgba(239, 68, 68, 0.7)' }
                : isProcessing
                  ? { scale: 1 }
                  : { 
                      boxShadow: [
                        '0 0 0 0px rgba(59, 130, 246, 0)',
                        '0 0 0 4px rgba(59, 130, 246, 0.3)',
                        '0 0 0 8px rgba(59, 130, 246, 0)',
                      ],
                    }
            }
            transition={
              isRecording
                ? { repeat: Infinity, duration: 2 }
                : isProcessing
                  ? { duration: 0.2 }
                  : { repeat: Infinity, duration: 2, ease: "easeInOut" }
            }
            onTouchStart={handleRecordButtonDown}
            onTouchEnd={handleRecordButtonUp}
            onMouseDown={handleRecordButtonDown}
            onMouseUp={handleRecordButtonUp}
            onMouseLeave={isRecordingRef.current ? handleRecordButtonUp : undefined}
            disabled={!voiceChatConnected || isProcessing}
            aria-label={isRecording ? "Stop recording" : "Start recording"}
          >
            {isRecording ? (
              <MdStop className="w-8 h-8" />
            ) : (
              <motion.div
                animate={isProcessing ? {} : { scale: [1, 1.1, 1] }}
                transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
              >
                <MdMic className="w-8 h-8" />
              </motion.div>
            )}
          </motion.button>
        </div>
      </div>
      
      {/* Animated Status Text - Only shows when needed */}
      <AnimatePresence>
        {isRecording && (
          <motion.div 
            className="mt-3 text-center"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <div className="inline-flex items-center px-3 py-1 bg-red-50 text-red-600 rounded-full text-xs font-medium">
              <span className="inline-block w-2 h-2 bg-red-500 rounded-full animate-pulse mr-2"></span>
              Recording...
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Error Message - Enhanced styling */}
      <AnimatePresence>
        {errorMessage && (
          <motion.div 
            className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <div className="flex justify-between items-start">
              <div className="flex gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 flex-shrink-0">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                </svg>
                <p>{errorMessage}</p>
              </div>
              <button 
                onClick={() => setErrorMessage(null)}
                className="ml-2 text-red-500 hover:text-red-700 p-1"
                aria-label="Close error message"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Permissions Modal */}
      {permissionDenied && (
        <MicrophonePermissionsModal onClose={handleClosePermissionModal} />
      )}
    </div>
  );
};

export default AudioRecorder; 
