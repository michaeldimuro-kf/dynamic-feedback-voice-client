/**
 * Socket.io event constants used for communication with the server
 */
export const socketEvents = {
  // Connection events
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  CONNECT_ERROR: 'connect_error',
  RECONNECT: 'reconnect',
  RECONNECT_ATTEMPT: 'reconnect_attempt',
  RECONNECT_ERROR: 'reconnect_error',
  RECONNECT_FAILED: 'reconnect_failed',
  
  // Message events
  MESSAGE: 'message',
  TRANSCRIPTION: 'transcription',
  TRANSCRIPTION_RESULT: 'transcription-result',
  AI_RESPONSE: 'ai-response',
  AUDIO_RESPONSE: 'audio-response',
  
  // Audio state events
  AUDIO_STATE_CHANGE: 'audio-state-change',
  NARRATION_AUDIO_ENDED: 'narration-audio-ended',
  
  // Function call events
  FUNCTION_CALL: 'function-call',
  FUNCTION_CALL_RESULT: 'function-call-result',
  
  // Page navigation events
  GO_TO_PAGE: 'go-to-page',
  GET_CURRENT_PAGE: 'get-current-page',
  
  // Audio buffer events
  COMMIT_AUDIO_BUFFER: 'commit-audio-buffer',
  CREATE_RESPONSE: 'create-response',
}; 