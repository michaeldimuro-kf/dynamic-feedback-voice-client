import { Subject, Observable, BehaviorSubject, from, of, throwError } from 'rxjs';
import { catchError, switchMap, tap, finalize, share, bufferTime, filter } from 'rxjs/operators';

/**
 * Service for streaming and playing audio data using RxJS
 */
export class AudioStreamService {
  // Stream of audio chunks to play
  private audioChunksSubject = new Subject<string>();
  public audioChunks$ = this.audioChunksSubject.asObservable();

  // Current playback state
  private playbackStateSubject = new BehaviorSubject<'idle' | 'playing' | 'buffering' | 'error'>('idle');
  public playbackState$ = this.playbackStateSubject.asObservable();

  // Error handling
  private errorSubject = new Subject<string>();
  public error$ = this.errorSubject.asObservable();

  // Buffering configuration
  private bufferingTime = 200; // ms, reduced from 250 for faster response
  private minBufferSize = 1; // minimum chunks to process, reduced from 2 for faster response

  // Audio context and elements
  private audioContext: AudioContext | null = null;
  private activeAudioElements: HTMLAudioElement[] = [];
  private isProcessingComplete = false;

  // Debug mode
  private debug = true;

  constructor() {
    // Initialize buffered audio stream processing
    this.setupAudioChunkProcessing();
    
    if (this.debug) {
      console.log('[AudioStreamService] Initialized');
    }
  }

  /**
   * Set up buffered processing of audio chunks
   */
  private setupAudioChunkProcessing() {
    // Buffer chunks for smoother playback
    this.audioChunks$.pipe(
      // Buffer chunks for specified time or until reaching minimum buffer size
      bufferTime(this.bufferingTime),
      // Only process non-empty buffers
      filter(chunks => chunks.length > 0),
      // Process the chunks
      tap(chunks => {
        if (this.debug) {
          console.log(`[AudioStreamService] Processing ${chunks.length} audio chunks`);
        }
        this.processAudioChunks(chunks);
      }),
      // Error handling
      catchError(err => {
        this.errorSubject.next(`Error processing audio chunks: ${err.message}`);
        this.playbackStateSubject.next('error');
        return of([]);
      }),
      // Share the stream among multiple subscribers
      share()
    ).subscribe();
  }

  /**
   * Process and play a batch of audio chunks
   */
  private processAudioChunks(chunks: string[]): void {
    if (chunks.length === 0) return;

    // If we're not playing yet, change state to buffering until first audio starts
    if (this.playbackStateSubject.value === 'idle') {
      this.playbackStateSubject.next('buffering');
    }

    // Process each chunk in the buffer
    chunks.forEach(chunk => {
      this.createAndQueueAudioElement(chunk);
    });
  }

  /**
   * Create an Audio element from a base64-encoded audio chunk and queue it for playback
   */
  private createAndQueueAudioElement(base64Audio: string): void {
    try {
      // Validate base64 string is not empty
      if (!base64Audio || base64Audio.length < 10) {
        if (this.debug) {
          console.warn('[AudioStreamService] Received empty or invalid audio chunk');
        }
        return;
      }
      
      // Create audio element
      const audio = new Audio();
      
      // Try to detect audio format from first few characters
      // Most audio formats have specific signatures we can detect
      let audioFormat = 'audio/mpeg'; // Default to MP3 equivalent - more browser support than audio/mp3
      
      // Simple format detection based on base64 inspection
      // MP3 typically starts with ID3 tag (SUQz) or with a frame sync (//M) in base64
      // WebM audio often starts with 1A45DFA3 marker, which appears as "GkXfo" in base64
      // WAV files typically start with "RIFF" header, which appears as "UklGR" in base64
      // Opus in OGG container often starts with "OggS", which appears as "T2dnU" in base64
      if (base64Audio.startsWith('GkXf')) {
        audioFormat = 'audio/webm';
        if (this.debug) console.log('[AudioStreamService] Detected WebM audio format');
      } else if (base64Audio.startsWith('UklGR')) {
        audioFormat = 'audio/wav';
        if (this.debug) console.log('[AudioStreamService] Detected WAV audio format');
      } else if (base64Audio.startsWith('T2dnU')) {
        audioFormat = 'audio/ogg';
        if (this.debug) console.log('[AudioStreamService] Detected Opus/OGG audio format');
      } else if (base64Audio.startsWith('SUQz') || base64Audio.startsWith('//M')) {
        audioFormat = 'audio/mpeg';
        if (this.debug) console.log('[AudioStreamService] Detected MP3 audio format');
      } else {
        // If we can't detect, try generic audio/mpeg which has better browser support
        audioFormat = 'audio/mpeg';
        if (this.debug) console.log('[AudioStreamService] Using fallback audio format: audio/mpeg');
      }
      
      // Set up audio element with detected format
      audio.src = `data:${audioFormat};base64,${base64Audio}`;
      audio.volume = 1.0; // Ensure full volume
      
      if (this.debug) {
        console.log(`[AudioStreamService] Created audio element with ${base64Audio.length} characters of base64 data using format ${audioFormat}`);
      }
      
      // Add to active elements list for tracking
      this.activeAudioElements.push(audio);
      
      // Set up event handlers
      this.setupAudioElementEvents(audio);
      
      // Attempt to play if this is the first element or previous is already playing
      if (this.activeAudioElements.length === 1) {
        this.playAudioElement(audio);
      }
    } catch (err) {
      const errorMessage = `Error creating audio element: ${err instanceof Error ? err.message : String(err)}`;
      this.errorSubject.next(errorMessage);
      console.error('[AudioStreamService]', errorMessage);
    }
  }

  /**
   * Set up event handlers for an audio element
   */
  private setupAudioElementEvents(audio: HTMLAudioElement): void {
    // When audio can play, update state
    audio.oncanplay = () => {
      if (this.debug) {
        console.log('[AudioStreamService] Audio can play');
      }
      
      if (this.playbackStateSubject.value === 'buffering') {
        this.playbackStateSubject.next('playing');
      }
    };

    // When audio ends, play next in queue and clean up
    audio.onended = () => {
      if (this.debug) {
        console.log('[AudioStreamService] Audio playback ended');
      }
      
      // Remove from active elements
      this.activeAudioElements = this.activeAudioElements.filter(el => el !== audio);
      
      // Clean up
      audio.oncanplay = null;
      audio.onended = null;
      audio.onerror = null;
      audio.src = '';
      
      // Play next in queue if available
      if (this.activeAudioElements.length > 0) {
        this.playAudioElement(this.activeAudioElements[0]);
      } else if (this.isProcessingComplete) {
        // If no more elements and processing is complete, return to idle state
        this.playbackStateSubject.next('idle');
      }
    };

    // Handle errors
    audio.onerror = (e) => {
      const errorCode = audio.error?.code || 'none';
      const errorMsg = `Audio playback error: ${audio.error?.message || 'Unknown error'} (code: ${errorCode})`;
      
      // If it's a demuxer error, provide more specific guidance
      if (errorMsg.includes('DEMUXER_ERROR') || errorMsg.includes('Failed to load')) {
        const specificError = `Demuxer error (format mismatch): Browser cannot decode the audio format. ${errorMsg}`;
        this.errorSubject.next(specificError);
        console.error('[AudioStreamService]', specificError);
        
        // Try with a different format if this is the first error
        if (this.activeAudioElements.length <= 1) {
          console.log('[AudioStreamService] Attempting to recover with different audio format');
          
          // Create three new Audio elements with different common formats
          // to maximize chances of success
          const formats = [
            'audio/mpeg',  // MP3 equivalent, widely supported
            'audio/wav',   // Raw waveform, almost universally supported
            'audio/aac'    // AAC format, good on mobile
          ];
          
          let formatTried = false;
          
          for (const format of formats) {
            // Skip the format we already tried
            if (audio.src.includes(format)) continue;
            
            formatTried = true;
            const recoveryAudio = new Audio();
            recoveryAudio.src = audio.src.replace(/data:audio\/[^;]+;/, `data:${format};`);
            
            // Set up event handlers
            this.setupAudioElementEvents(recoveryAudio);
            
            // Add to queue
            this.activeAudioElements.push(recoveryAudio);
          }
          
          // Remove the current audio element
          this.activeAudioElements = this.activeAudioElements.filter(el => el !== audio);
          
          // Clean up the original audio element
          audio.oncanplay = null;
          audio.onended = null;
          audio.onerror = null;
          audio.src = '';
          
          // Try to play the next audio in queue if we added recovery formats
          if (formatTried && this.activeAudioElements.length > 0) {
            this.playAudioElement(this.activeAudioElements[0]);
            return;
          }
        }
      } else {
        this.errorSubject.next(errorMsg);
        console.error('[AudioStreamService]', errorMsg);
      }
      
      // Remove from active elements
      this.activeAudioElements = this.activeAudioElements.filter(el => el !== audio);
      
      // Clean up
      audio.oncanplay = null;
      audio.onended = null;
      audio.onerror = null;
      audio.src = '';
      
      // Try to continue with next audio if available
      if (this.activeAudioElements.length > 0) {
        this.playAudioElement(this.activeAudioElements[0]);
      }
    };
  }

  /**
   * Play an audio element
   */
  private playAudioElement(audio: HTMLAudioElement): void {
    try {
      // Pre-load the audio first
      audio.load();
      
      // Then try to play once loaded
      const playPromise = audio.play();
      
      if (playPromise !== undefined) {
        playPromise.then(() => {
          if (this.debug) {
            console.log('[AudioStreamService] Audio playback started successfully');
          }
        }).catch(error => {
          const errorMsg = `Failed to play audio: ${error.message}`;
          this.errorSubject.next(errorMsg);
          console.error('[AudioStreamService]', errorMsg);
          
          // Handle autoplay policy issues
          if (error.name === 'NotAllowedError') {
            // We'll need user interaction to play
            const errorMsg = 'Audio playback requires user interaction';
            this.errorSubject.next(errorMsg);
            console.error('[AudioStreamService]', errorMsg);
            
            // Add a one-time click handler to try again
            const playOnce = () => {
              audio.play().catch(e => console.error('[AudioStreamService] Retry play failed:', e));
              document.removeEventListener('click', playOnce);
            };
            document.addEventListener('click', playOnce, { once: true });
          }
        });
      }
    } catch (error) {
      const errorMsg = `Failed to play audio: ${error instanceof Error ? error.message : String(error)}`;
      this.errorSubject.next(errorMsg);
      console.error('[AudioStreamService]', errorMsg);
    }
  }

  /**
   * Add a new audio chunk to the stream
   */
  public addAudioChunk(base64Audio: string): void {
    if (this.debug) {
      console.log(`[AudioStreamService] Adding audio chunk (${base64Audio ? base64Audio.substring(0, 20) + '...' : 'empty'})`);
    }
    
    // Make sure we actually have data
    if (!base64Audio || base64Audio.length < 10) {
      console.warn('[AudioStreamService] Attempted to add invalid audio chunk');
      return;
    }
    
    this.audioChunksSubject.next(base64Audio);
  }

  /**
   * Stop all active audio playback
   */
  public stopPlayback(): void {
    if (this.debug) {
      console.log('[AudioStreamService] Stopping all audio playback');
    }
    
    // Stop all currently playing audio elements
    this.activeAudioElements.forEach(audio => {
      audio.pause();
      audio.src = '';
    });
    
    // Clear the queue
    this.activeAudioElements = [];
    
    // Reset state
    this.playbackStateSubject.next('idle');
  }

  /**
   * Mark processing as complete when all audio chunks have been received
   */
  public completeAudioStream(): void {
    if (this.debug) {
      console.log('[AudioStreamService] Audio stream completed');
    }
    
    this.isProcessingComplete = true;
    
    // If no active elements, immediately return to idle state
    if (this.activeAudioElements.length === 0) {
      this.playbackStateSubject.next('idle');
    }
  }

  /**
   * Reset the service to its initial state
   */
  public reset(): void {
    if (this.debug) {
      console.log('[AudioStreamService] Resetting audio stream service');
    }
    
    this.stopPlayback();
    this.isProcessingComplete = false;
  }
}

// Export singleton instance
export const audioStreamService = new AudioStreamService(); 

