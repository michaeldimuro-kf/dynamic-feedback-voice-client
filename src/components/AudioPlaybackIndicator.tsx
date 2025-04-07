import React from 'react';
import { useAudioStream } from '../hooks/useAudioStream';
import { BsSoundwave } from 'react-icons/bs';
import { HiSpeakerWave, HiSpeakerXMark } from 'react-icons/hi2';
import { IoMdRefresh } from 'react-icons/io';
import { MdErrorOutline } from 'react-icons/md';
import useSocket from '../hooks/useSocket';

/**
 * Component that displays the current audio playback state with animation
 */
const AudioPlaybackIndicator: React.FC = () => {
  const { socket } = useSocket();
  const { isPlaying, isStreaming, error, stopAudio, resetAudio, hasAudioData } = useAudioStream(socket);
  
  // If nothing is happening with audio, don't render anything
  if (!isPlaying && !isStreaming && !error) return null;
  
  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-xs">
      <div className="flex items-center gap-2 p-3 bg-white shadow-lg rounded-lg border border-gray-200">
        {/* Error state */}
        {error && (
          <div className="flex flex-col gap-2 w-full">
            <div className="flex items-center gap-2 text-red-600">
              <MdErrorOutline size={20} />
              <span className="text-sm font-medium">Audio Error</span>
            </div>
            <p className="text-xs text-gray-600">{error}</p>
            <button 
              onClick={resetAudio} 
              className="flex items-center justify-center gap-1 text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 px-2 py-1 rounded transition-colors"
            >
              <IoMdRefresh size={14} />
              <span>Reset Audio</span>
            </button>
          </div>
        )}
        
        {/* Buffering/Loading state */}
        {!error && isStreaming && !isPlaying && (
          <div className="flex items-center gap-2">
            <div className="animate-pulse">
              <BsSoundwave size={18} className="text-blue-600" />
            </div>
            <span className="text-sm text-gray-700">Buffering audio...</span>
          </div>
        )}
        
        {/* Playing state */}
        {!error && isPlaying && (
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <div className="w-1 h-4 bg-blue-500 animate-pulse"></div>
                <div className="w-1 h-6 bg-blue-500 animate-pulse delay-75"></div>
                <div className="w-1 h-3 bg-blue-500 animate-pulse delay-150"></div>
                <div className="w-1 h-5 bg-blue-500 animate-pulse delay-200"></div>
                <div className="w-1 h-2 bg-blue-500 animate-pulse delay-300"></div>
              </div>
              <span className="text-sm text-gray-700">Playing audio...</span>
            </div>
            <button 
              onClick={stopAudio} 
              className="text-gray-400 hover:text-red-500 transition-colors"
              title="Stop playback"
            >
              <HiSpeakerXMark size={20} />
            </button>
          </div>
        )}
        
        {/* No data received state */}
        {!error && isStreaming && !hasAudioData && (
          <div className="flex items-center gap-2 text-yellow-600">
            <div className="animate-spin">
              <IoMdRefresh size={18} />
            </div>
            <span className="text-sm">Waiting for audio data...</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default AudioPlaybackIndicator; 
