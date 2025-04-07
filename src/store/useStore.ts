import { create } from 'zustand';

export interface Message {
  id: string;
  text: string;
  type: 'user' | 'bot';
  timestamp: Date;
}

export interface PDFState {
  pdfDoc: any | null;
  pageNum: number;
  pageCount: number;
  baseScale: number;
  forceRender: number;
}

interface AudioState {
  isRecording: boolean;
  isProcessing: boolean;
  hasPermission: boolean | null;
  isNarrating: boolean;
  isNarrationPaused: boolean;
  narrationCurrentPage: number;
  isPlayingAudio: boolean;
}

interface AppState {
  // Messages
  messages: Message[];
  addMessage: (text: string, type: 'user' | 'bot', isStreaming: boolean) => void;
  clearMessages: () => void;

  // PDF State
  pdfState: PDFState;
  setPDFDoc: (pdfDoc: any) => void;
  setPageNum: (pageNum: number) => void;
  setPageCount: (pageCount: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  setBaseScale: (baseScale: number) => void;
  pdfContent?: Record<number, string>;

  // Audio State
  audioState: AudioState;
  setIsRecording: (isRecording: boolean) => void;
  setIsProcessing: (isProcessing: boolean) => void;
  setHasPermission: (hasPermission: boolean) => void;
  setIsNarrating: (isNarrating: boolean) => void;
  setIsNarrationPaused: (isPaused: boolean) => void;
  setNarrationCurrentPage: (pageNum: number) => void;
  setIsPlayingAudio: (isPlaying: boolean) => void;

  // Connection state
  isConnected: boolean;
  setIsConnected: (isConnected: boolean) => void;
}

const useStore = create<AppState>((set, get) => ({
  // Messages
  messages: [{
    id: '1',
    text: 'Welcome to Korn Ferry Live Feedback! Start the narration to begin understanding your feedback. You can also ask questions at any time to get more information.',
    type: 'bot',
    timestamp: new Date()
  }],
  addMessage: (text: string, type: 'user' | 'bot', isStreaming: boolean = false) => {
    const state = get();
    
    // Make a copy of the current messages
    let messages = [...state.messages];

    if (messages[messages.length - 1]?.text ===text) {
      return;
    }

    
    // Generate a unique ID for new messages
    const messageId = isStreaming && messages.length > 0 && messages[messages.length - 1].type === type
      ? messages[messages.length - 1].id
      : Date.now().toString();


      // Update the last message if this is a streaming update for the same type
    if (isStreaming && messages.length > 0 && messages[messages.length - 1].type === type) {
      // Update the last message if this is a streaming update for the same type
      const lastMessage = messages[messages.length - 1];
      lastMessage.text += text;
      
      // Update the state with the modified messages array
      set({ messages: [...messages] });
    } else {
      // Add a new message
      set({
        messages: [
          ...messages,
          {
            id: messageId,
            text,
            type,
            timestamp: new Date()
          }
        ]
      });
    }
  },
  clearMessages: () => set({ messages: [] }),

  // PDF State
  pdfState: {
    pdfDoc: null,
    pageNum: 1,
    pageCount: 0,
    baseScale: 1.0,
    forceRender: 0
  },
  setPDFDoc: (pdfDoc) => set((state) => ({ 
    pdfState: { 
      ...state.pdfState, 
      pdfDoc,
      // Reset forceRender when loading a new document
      forceRender: 0 
    } 
  })),
  setPageNum: (pageNum) => set((state) => {
    // Only change page if it's different and within valid range
    if (pageNum === state.pdfState.pageNum || 
        pageNum < 1 || 
        (state.pdfState.pageCount > 0 && pageNum > state.pdfState.pageCount)) {
      return state;
    }
    
    // Increment forceRender to trigger a complete redraw
    const forceRender = state.pdfState.forceRender + 1;
    
    // If narration is enabled and we're changing pages, update the narration page
    if (state.audioState.isNarrating && !state.audioState.isNarrationPaused) {
      return {
        pdfState: { 
          ...state.pdfState, 
          pageNum, 
          forceRender 
        },
        audioState: {
          ...state.audioState,
          narrationCurrentPage: pageNum
        }
      };
    }
    
    // Otherwise just update the PDF state
    return { 
      pdfState: { 
        ...state.pdfState, 
        pageNum, 
        forceRender 
      } 
    };
  }),
  setPageCount: (pageCount) => set((state) => ({ 
    pdfState: { 
      ...state.pdfState, 
      pageCount 
    } 
  })),
  nextPage: () => set((state) => {
    // Check if we can move to next page
    if (state.pdfState.pageNum >= state.pdfState.pageCount) {
      return state;
    }
    
    const nextPageNum = state.pdfState.pageNum + 1;
    
    // If narration is enabled and we're changing pages, update the narration page
    if (state.audioState.isNarrating && !state.audioState.isNarrationPaused) {
      return {
        pdfState: { 
          ...state.pdfState, 
          pageNum: nextPageNum,
          forceRender: state.pdfState.forceRender + 1
        },
        audioState: {
          ...state.audioState,
          narrationCurrentPage: nextPageNum
        }
      };
    }
    
    // Otherwise just update the PDF state
    return { 
      pdfState: { 
        ...state.pdfState, 
        pageNum: nextPageNum,
        forceRender: state.pdfState.forceRender + 1
      } 
    };
  }),
  prevPage: () => set((state) => {
    // Check if we can move to previous page
    if (state.pdfState.pageNum <= 1) {
      return state;
    }
    
    const prevPageNum = state.pdfState.pageNum - 1;
    
    // If narration is enabled and we're changing pages, update the narration page
    if (state.audioState.isNarrating && !state.audioState.isNarrationPaused) {
      return {
        pdfState: { 
          ...state.pdfState, 
          pageNum: prevPageNum,
          forceRender: state.pdfState.forceRender + 1
        },
        audioState: {
          ...state.audioState,
          narrationCurrentPage: prevPageNum
        }
      };
    }
    
    // Otherwise just update the PDF state
    return { 
      pdfState: { 
        ...state.pdfState, 
        pageNum: prevPageNum,
        forceRender: state.pdfState.forceRender + 1
      } 
    };
  }),
  setBaseScale: (baseScale) => set((state) => ({ 
    pdfState: { 
      ...state.pdfState, 
      baseScale 
    } 
  })),

  // Audio State
  audioState: {
    isRecording: false,
    isProcessing: false,
    hasPermission: null,
    isNarrating: false,
    isNarrationPaused: false,
    narrationCurrentPage: 1,
    isPlayingAudio: false
  },
  setIsRecording: (isRecording) => set((state) => ({ 
    audioState: { ...state.audioState, isRecording } 
  })),
  setIsProcessing: (isProcessing) => set((state) => ({ 
    audioState: { ...state.audioState, isProcessing } 
  })),
  setHasPermission: (hasPermission) => set((state) => ({ 
    audioState: { ...state.audioState, hasPermission } 
  })),
  setIsNarrating: (isNarrating) => set((state) => ({ 
    audioState: { ...state.audioState, isNarrating } 
  })),
  setIsNarrationPaused: (isNarrationPaused) => set((state) => ({ 
    audioState: { ...state.audioState, isNarrationPaused } 
  })),
  setNarrationCurrentPage: (narrationCurrentPage) => set((state) => ({ 
    audioState: { ...state.audioState, narrationCurrentPage } 
  })),
  setIsPlayingAudio: (isPlayingAudio) => set((state) => ({ 
    audioState: { ...state.audioState, isPlayingAudio } 
  })),

  // Connection state
  isConnected: false,
  setIsConnected: (isConnected) => set({ isConnected }),
}));

export default useStore; 