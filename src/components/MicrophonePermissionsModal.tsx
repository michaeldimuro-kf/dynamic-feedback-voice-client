import React from 'react';

interface MicrophonePermissionsModalProps {
  onClose: () => void;
}

const MicrophonePermissionsModal: React.FC<MicrophonePermissionsModalProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 bg-neutral-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-card max-w-md w-full animate-fadeIn">
        <div className="p-6">
          <div className="flex items-center mb-4 text-primary-600">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
              <line x1="12" y1="19" x2="12" y2="23"></line>
              <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
            <h2 className="text-xl font-semibold ml-2 text-neutral-800">Microphone Access Required</h2>
          </div>
          
          <p className="mb-5 text-neutral-600">
            To use the voice chat feature, please allow access to your microphone in your browser settings.
          </p>
          
          <div className="mb-6 bg-neutral-50 p-4 rounded-lg border-l-4 border-primary-400">
            <h3 className="font-semibold mb-2 text-neutral-800">How to enable microphone access:</h3>
            <ol className="list-decimal list-outside ml-5 space-y-1.5 text-neutral-700">
              <li>Click on the padlock or info icon in your browser's address bar</li>
              <li>Find "Microphone" permissions in the site settings</li>
              <li>Change the setting to "Allow"</li>
              <li>Refresh the page</li>
            </ol>
          </div>
          
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-5 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
            >
              Got It
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MicrophonePermissionsModal; 