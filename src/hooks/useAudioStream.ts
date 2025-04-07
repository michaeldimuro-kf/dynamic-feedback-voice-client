import { useState, useEffect, useCallback } from 'react';
import { audioStreamService } from '../services/audioStreamService';
import { Socket } from 'socket.io-client';

/**
 * Hook to manage audio streaming and playback
 * @param socket Optional socket instance - can be passed to avoid circular dependencies
 */
export const useAudioStream = (socket?: Socket | null) => {  
  // Track audio state
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [hasAudioData, setHasAudioData] = useState<boolean>(false);

  // Debug
  const debug = true;

  /**
   * Initialize event listeners for audio streaming
   */
  useEffect(() => {
    if (!socket) return;

    // Listen for audio streaming events
    const handleAudioChunk = (chunk: string) => {
      if (debug) {
        console.log(`[useAudioStream] Received audio chunk with ${chunk ? chunk.length : 0} characters`);
      }
      
      if (!chunk || chunk.length < 10) {
        console.warn('[useAudioStream] Received empty or invalid audio chunk');
        return;
      }
      
      // Set flag that we have received audio data
      setHasAudioData(true);
      
      // Send to audio service
      audioStreamService.addAudioChunk(chunk);
    };

    const handleAudioStart = () => {
      if (debug) console.log('[useAudioStream] Audio streaming started');
      setIsStreaming(true);
    };

    const handleAudioEnd = () => {
      if (debug) console.log('[useAudioStream] Audio streaming ended');
      setIsStreaming(false);
      audioStreamService.completeAudioStream();
      
      // If we never received any audio data, report an error
      if (!hasAudioData) {
        setError('No audio data was received from the server');
        console.error('[useAudioStream] Audio stream completed but no audio data was received');
      }
    };

    const handleAudioError = (errorMsg: string) => {
      console.error('[useAudioStream] Audio streaming error:', errorMsg);
      setError(errorMsg);
      setIsStreaming(false);
      audioStreamService.reset();
    };

    // Set up socket event listeners
    socket.on('audio_chunk', handleAudioChunk);
    socket.on('audio_start', handleAudioStart);
    socket.on('audio_end', handleAudioEnd);
    socket.on('audio_error', handleAudioError);
    
    // Subscribe to audio service state updates
    const playbackStateSubscription = audioStreamService.playbackState$.subscribe(state => {
      if (debug) console.log(`[useAudioStream] Audio playback state changed to: ${state}`);
      setIsPlaying(state === 'playing' || state === 'buffering');
    });
    
    const errorSubscription = audioStreamService.error$.subscribe(errorMsg => {
      console.error('[useAudioStream] Audio service error:', errorMsg);
      setError(errorMsg);
    });

    // Clean up subscriptions and event listeners
    return () => {
      socket.off('audio_chunk', handleAudioChunk);
      socket.off('audio_start', handleAudioStart);
      socket.off('audio_end', handleAudioEnd);
      socket.off('audio_error', handleAudioError);
      
      playbackStateSubscription.unsubscribe();
      errorSubscription.unsubscribe();
    };
  }, [socket, hasAudioData, debug]);

  /**
   * Stop audio playback
   */
  const stopAudio = useCallback(() => {
    if (debug) console.log('[useAudioStream] Stopping audio playback');
    audioStreamService.stopPlayback();
    setIsPlaying(false);
    
    // Signal to server to stop if we're still streaming
    if (isStreaming && socket) {
      if (debug) console.log('[useAudioStream] Sending stop_audio signal to server');
      socket.emit('stop_audio');
      setIsStreaming(false);
    }
  }, [socket, isStreaming, debug]);

  /**
   * Reset audio state when component unmounts or needs to be reset
   */
  const resetAudio = useCallback(() => {
    if (debug) console.log('[useAudioStream] Resetting audio state');
    audioStreamService.reset();
    setIsStreaming(false);
    setIsPlaying(false);
    setError(null);
    setHasAudioData(false);
  }, [debug]);

  /**
   * Request narration of text content
   */
  const requestNarration = useCallback((textContent: string, voiceConfig?: any) => {
    if (!socket) {
      const errorMsg = 'Cannot request narration: Socket not connected';
      console.error('[useAudioStream]', errorMsg);
      setError(errorMsg);
      return false;
    }
    
    if (!textContent || textContent.trim() === '') {
      const errorMsg = 'Cannot request narration: No text content provided';
      console.error('[useAudioStream]', errorMsg);
      setError(errorMsg);
      return false;
    }
    
    // Reset audio state first
    resetAudio();

    if (debug) {
      console.log(`[useAudioStream] Requesting narration for ${textContent.length} characters of text`);
      if (voiceConfig) console.log('[useAudioStream] Using voice config:', voiceConfig);
    }
    
    // Send narration request to server
    socket.emit('narrate_text', { 
      text: textContent,
      ...voiceConfig 
    });
    
    return true;
  }, [socket, resetAudio, debug]);

  // For backward compatibility
  const playAudioChunk = useCallback((base64Audio: string) => {
    audioStreamService.addAudioChunk(base64Audio);
  }, []);

  const completeAudioStream = useCallback(() => {
    audioStreamService.completeAudioStream();
  }, []);

  const resetAudioStream = useCallback(() => {
    resetAudio();
  }, [resetAudio]);

  const stopPlayback = useCallback(() => {
    stopAudio();
  }, [stopAudio]);

  return {
    isStreaming,
    isPlaying,
    error,
    stopAudio,
    resetAudio,
    requestNarration,
    hasAudioData,
    // For backward compatibility
    playAudioChunk,
    completeAudioStream,
    resetAudioStream,
    stopPlayback
  };
};

// For backward compatibility
export default useAudioStream; 