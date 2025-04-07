import { useState, useEffect, useRef, useCallback } from 'react';
import useStore from '../store/useStore';
import * as pdfjsLib from 'pdfjs-dist';
// Import the worker directly (Vite will handle this correctly)
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import useSocket from '../hooks/useSocket';
import useRealtimeVoiceChat from '../hooks/useRealtimeVoiceChat';

// Set the worker explicitly from the imported module
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const PDFViewer = () => {
  // Get PDF state from global store
  const {
    pdfState,
    setPDFDoc,
    setPageNum,
    setPageCount,
    nextPage,
    prevPage,
    setBaseScale,
    audioState,
    setIsNarrating,
    setNarrationCurrentPage,
    setIsNarrationPaused
  } = useStore();

  // Get socket functionality for narration - call hook ONLY at top level
  const {
    sendTextInput,
    stopAudio,
    isProcessingPage,
    currentAudio
  } = useSocket();

  // Local state
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  // Create canvas ref
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Start narration of the PDF
  const startNarration = async () => {
    console.log("Starting Narration");
    
    // First, check if the voice chat system is already processing or recording
    const audioState = useStore.getState().audioState;
    if (audioState.isProcessing || audioState.isRecording) {
      console.error("[PDFViewer] Cannot start narration while voice chat is active");
      return;
    }
    
    // First, stop any existing audio and processing
    if (currentAudio) {
      console.log("[PDFViewer] Stopping any existing audio before starting new narration");
      stopAudio();
    }
    
    // Try to unlock audio context
    try {
      console.log("[PDFViewer] Attempting to unlock audio context...");
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0.01;
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.001);
      
      const silentAudio = new Audio();
      silentAudio.src = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAACAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV6urq6urq6urq6urq6urq6urq6urq6v////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAASDs90hvAAAAAAAAAAAAAAAAAAAA//MUZAAAAAGkAAAAAAAAA0gAAAAATEFN//MUZAMAAAGkAAAAAAAAA0gAAAAARTMu//MUZAYAAAGkAAAAAAAAA0gAAAAAOTku//MUZAkAAAGkAAAAAAAAA0gAAAAANVVV";
      const silentPlayPromise = silentAudio.play();
      if (silentPlayPromise) {
        silentPlayPromise.catch(err => {
          console.log("[PDFViewer] Silent audio playback failed:", err);
        });
      }
      
      console.log("[PDFViewer] Audio context unlocked");
    } catch (err) {
      console.error("[PDFViewer] Error unlocking audio:", err);
    }
    
    // Update global narration state
    setIsNarrating(true);
    setIsNarrationPaused(false);
    
    // Get current page number
    const store = useStore.getState();
    const currentPage = store.pdfState.pageNum;
    
    console.log(`[PDFViewer] Starting narration for current page: ${currentPage}`);
    
    // Ensure narration current page matches PDF page
    setNarrationCurrentPage(currentPage);
    
    // Try to extract the text content
    let pageText = "";
    try {
      if (pdfState.pdfDoc) {
        console.log(`[PDFViewer] Extracting text from PDF page ${currentPage}`);
        const page = await pdfState.pdfDoc.getPage(currentPage);
        const textContent = await page.getTextContent();
        pageText = textContent.items.map((item: any) => item.str).join(' ');
        console.log(`[PDFViewer] Extracted ${pageText.length} characters of text`);
      }
    } catch (err) {
      console.error("[PDFViewer] Error extracting text from PDF:", err);
      pageText = `Content from page ${currentPage}`;
    }
    
    // Send narration request
    console.log(`[PDFViewer] Sending narration request for page ${currentPage}`);
    
    const success = sendTextInput(
      `Using the function get_current_page_content, summarize and narrate page ${currentPage} of this document in a clear, engaging way. Speak directly to me as if you're explaining the content.`
    );
    
    if (!success) {
      console.error('[PDFViewer] Failed to send first narration request');
      
      setTimeout(() => {
        console.log('[PDFViewer] Trying alternate narration approach');
        sendTextInput(
          `Please narrate the following content from page ${currentPage}: ${pageText.substring(0, 1000)}... Summarize this content in a clear, engaging way.`
        );
      }, 1000);
    }
  };

  // Stop narration
  const stopNarration = () => {
    setIsNarrating(false);
    setIsNarrationPaused(false);
    stopAudio();
  };

  // Load a PDF from a URL
  const loadPDF = useCallback(async (url: string) => {
    setLoadState('loading');
    setPdfError(null);
    
    try {
      // Load the PDF document with standard configuration
      const loadingTask = pdfjsLib.getDocument({
        url,
        cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.4.120/cmaps/',
        cMapPacked: true
      });
      
      const pdfDoc = await loadingTask.promise;
      
      // Update global state with PDF document
      setPDFDoc(pdfDoc);
      
      // Set page count
      setPageCount(pdfDoc.numPages);
      
      // Set initial page number
      setPageNum(1);
      
      // Update load state
      setLoadState('success');
    } catch (error) {
      console.error('Error loading PDF:', error);
      setPdfError(error instanceof Error ? error.message : String(error));
      setLoadState('error');
    }
  }, [setPDFDoc, setPageCount, setPageNum]);

  // Load the default PDF on component mount
  useEffect(() => {
    if (!pdfState.pdfDoc) {
      loadDefaultPDF();
    }
  }, []);

  // Load default PDF
  const loadDefaultPDF = async () => {
    try {
      // Set loading state
      setLoadState('loading');
      console.log("Attempting to load default PDF");
      
      // Try loading the PDF directly from file
      const directUrl = `/files/hm.pdf?v=${Date.now()}`;
      console.log("Attempting to fetch PDF from:", directUrl);
      
      try {
        // Try fetching directly first
        const response = await fetch(directUrl);
        console.log("Fetch response status:", response.status);
        
        if (response.ok) {
          const data = await response.arrayBuffer();
          console.log("PDF data fetched successfully, size:", data.byteLength);
          
          // Basic configuration
          const loadingOptions = {
            data,
            cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.4.120/cmaps/',
            cMapPacked: true
          };
          
          console.log("Creating PDF document from data");
          const pdfDoc = await pdfjsLib.getDocument(loadingOptions).promise;
          console.log("PDF document created successfully with", pdfDoc.numPages, "pages");
          
          setPDFDoc(pdfDoc);
          setPageCount(pdfDoc.numPages);
          
          // Wait a brief moment before setting page number
          setTimeout(() => {
            setPageNum(1);
            console.log("Set page number to 1");
          }, 100);
          
          setPdfError(null);
          setLoadState('success');
          console.log("PDF loaded successfully");
          return pdfDoc;
        } else {
          console.error("Failed to load PDF, response not OK:", response.statusText);
          // Try alternate PDF location
          const alternatePath = '/hm.pdf';
          console.log("Trying alternate path:", alternatePath);
          
          const altResponse = await fetch(alternatePath);
          if (altResponse.ok) {
            const altData = await altResponse.arrayBuffer();
            console.log("Alternate PDF loaded successfully, size:", altData.byteLength);
            
            const loadingOptions = {
              data: altData,
              cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.4.120/cmaps/',
              cMapPacked: true
            };
            
            const pdfDoc = await pdfjsLib.getDocument(loadingOptions).promise;
            setPDFDoc(pdfDoc);
            setPageCount(pdfDoc.numPages);
            
            setTimeout(() => { setPageNum(1); }, 100);
            setPdfError(null);
            setLoadState('success');
            console.log("PDF loaded successfully from alternate path");
            return pdfDoc;
          } else {
            console.error("Alternate path also failed:", altResponse.statusText);
            throw new Error(`Failed to load PDF: ${response.statusText}`);
          }
        }
      } catch (e) {
        // Fallback approaches if direct fetch fails
        console.error("Error during PDF fetch:", e);
        throw e;
      }
    } catch (error) {
      // Set error state
      console.error("PDF loading error:", error);
      setPdfError(error instanceof Error ? error.message : String(error));
      setLoadState('error');
    }
  };

  // Simple page rendering function
  const renderPage = useCallback(async (pageNum: number) => {
    if (!pdfState.pdfDoc) return;
    
    try {
      setIsLoading(true);
      
      // Get the page
      const page = await pdfState.pdfDoc.getPage(pageNum);
      
      // Get the canvas and context
      const canvas = canvasRef.current;
      const container = containerRef.current;
      
      if (!canvas || !container) {
        setIsLoading(false);
        return;
      }
      
      const context = canvas.getContext('2d');
      if (!context) {
        setIsLoading(false);
        return;
      }
      
      // Reset the canvas
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      
      // Use device pixel ratio for high resolution displays
      const pixelRatio = window.devicePixelRatio || 1;
      
      // Check if we're on mobile or desktop
      const isMobile = window.innerWidth < 768;
      
      // Get container dimensions with minimal padding
      const containerWidth = container.clientWidth - (isMobile ? 16 : 64);
      
      // Get the viewport at scale 1 (let PDF.js handle orientation)
      const defaultViewport = page.getViewport({ scale: 1 });
      
      // Calculate scale based on container width
      let scale = containerWidth / defaultViewport.width;
      
      // Apply different multipliers for mobile and desktop
      scale *= isMobile ? 0.95 : 0.65;
      
      // Create the viewport with the calculated scale
      const viewport = page.getViewport({ scale });
      
      // Store the scale for reference
      setBaseScale(scale);
      
      // Set the canvas dimensions
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      
      // Apply auto-sizing with appropriate aspect ratio
      canvas.style.width = 'auto';
      canvas.style.height = 'auto';
      canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
      canvas.style.transform = 'none'; // Reset any transforms
      
      // For mobile, make sure we don't overflow
      if (isMobile) {
        canvas.style.maxWidth = '100%';
        canvas.style.maxHeight = `calc(100vh - 150px)`;
      } else {
        // For desktop, limit width to avoid excess whitespace
        canvas.style.maxWidth = '80%';
        canvas.style.margin = '0 auto';
      }
      
      // Apply pixel ratio scale
      context.scale(pixelRatio, pixelRatio);
      
      // High quality rendering settings
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      
      // Render the page
      const renderTask = page.render({
        canvasContext: context,
        viewport: viewport
      });
      
      await renderTask.promise;
      setIsLoading(false);
      
    } catch (error) {
      console.error('Error rendering PDF page:', error);
      setIsLoading(false);
    }
  }, [pdfState.pdfDoc, setBaseScale]);

  // Handle container resize
  useEffect(() => {
    if (!containerRef.current || !pdfState.pdfDoc) return;
    
    const resizeObserver = new ResizeObserver(() => {
      if (pdfState.pdfDoc && pdfState.pageNum > 0) {
        console.log("Container resized, re-rendering PDF");
        renderPage(pdfState.pageNum);
      }
    });
    
    resizeObserver.observe(containerRef.current);
    
    return () => {
      resizeObserver.disconnect();
    };
  }, [pdfState.pdfDoc, pdfState.pageNum, renderPage]);
  
  // Re-render when page number changes
  useEffect(() => {
    if (pdfState.pdfDoc && pdfState.pageNum > 0) {
      renderPage(pdfState.pageNum);
    }
  }, [pdfState.pdfDoc, pdfState.pageNum, pdfState.forceRender, renderPage]);

  // Page navigation with narration support
  const handleNextPage = () => {
    if (pdfState.pageNum < pdfState.pageCount) {
      const nextPageNum = pdfState.pageNum + 1;
      console.log(`[PDFViewer] Moving to next page: ${nextPageNum}`);
      
      // Stop any current audio processing first
      if (audioState.isNarrating && currentAudio) {
        stopAudio();
      }
      
      // Update the page number
      nextPage();
      
      // Handle narration if active
      if (audioState.isNarrating) {
        console.log(`[PDFViewer] Narration active, updating narration page to ${nextPageNum}`);
        setNarrationCurrentPage(nextPageNum);
        
        // Start narration if not paused
        if (!audioState.isNarrationPaused) {
          setTimeout(() => {
            console.log(`[PDFViewer] Starting narration for page ${nextPageNum}`);
            startNarration();
          }, 100);
        }
      }
    }
  };

  // Previous page with narration support
  const handlePrevPage = () => {
    if (pdfState.pageNum > 1) {
      const prevPageNum = pdfState.pageNum - 1;
      console.log(`[PDFViewer] Moving to previous page: ${prevPageNum}`);
      
      // Stop any current audio processing first
      if (audioState.isNarrating && currentAudio) {
        stopAudio();
      }
      
      // Update the page number
      prevPage();
      
      // Handle narration if active
      if (audioState.isNarrating) {
        console.log(`[PDFViewer] Narration active, updating narration page to ${prevPageNum}`);
        setNarrationCurrentPage(prevPageNum);
        
        // Start narration if not paused
        if (!audioState.isNarrationPaused) {
          setTimeout(() => {
            console.log(`[PDFViewer] Starting narration for page ${prevPageNum}`);
            startNarration();
          }, 100);
        }
      }
    }
  };

  // Add keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        handleNextPage();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        handlePrevPage();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [pdfState.pageNum, pdfState.pageCount, audioState.isNarrating, audioState.isNarrationPaused]);

  // Handle automatic narration for page changes when narration is enabled
  useEffect(() => {
    if (audioState.isNarrating && 
        !audioState.isNarrationPaused && 
        pdfState.pageNum === audioState.narrationCurrentPage && 
        !isProcessingPage && 
        !currentAudio) {
      
      console.log(`Auto-triggering narration for page ${pdfState.pageNum}`);
      startNarration();
    }
  }, [audioState.isNarrating, audioState.isNarrationPaused, audioState.narrationCurrentPage, 
      pdfState.pageNum, isProcessingPage, currentAudio]);

  return (
    <div className="flex flex-col h-full max-h-full overflow-hidden">
      {/* PDF Toolbar */}
      <div className="flex items-center justify-between border-b border-neutral-200 p-2">
        <h2 className="text-lg font-semibold text-neutral-800">Assessment Report</h2>
        
        <div className="flex items-center gap-2">
          {/* Navigation Controls */}
          <div className="flex items-center bg-neutral-100 rounded-lg">
            <button 
              onClick={handlePrevPage}
              disabled={pdfState.pageNum <= 1}
              className="p-1.5 text-neutral-600 hover:text-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Previous page"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6"/>
              </svg>
            </button>
            
            <div className="px-2 text-sm text-neutral-600">
              {pdfState.pageNum} / {pdfState.pageCount || "?"}
            </div>
            
            <button 
              onClick={handleNextPage}
              disabled={pdfState.pageNum >= pdfState.pageCount}
              className="p-1.5 text-neutral-600 hover:text-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Next page"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </button>
          </div>
          
          {/* Narration Button */}
          {pdfState.pdfDoc && (
            !audioState.isNarrating ? (
              <button 
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
                onClick={startNarration}
                disabled={isProcessingPage}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
                <span>Narrate</span>
              </button>
            ) : (
              <button 
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                onClick={stopNarration}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                </svg>
                <span>Stop</span>
              </button>
            )
          )}
        </div>
      </div>
      
      {/* PDF Content Area */}
      <div 
        ref={containerRef}
        className="flex-1 flex flex-col items-stretch justify-start bg-white md:bg-neutral-50 overflow-hidden"
        style={{ 
          minHeight: '300px',
          height: 'calc(100% - 12px)'
        }}
      >
        {loadState === 'loading' && (
          <div className="flex flex-col items-center justify-center h-full text-neutral-500">
            <div className="w-10 h-10 border-4 border-neutral-300 border-t-primary-500 rounded-full animate-spin mb-3"></div>
            <p>Loading document...</p>
          </div>
        )}
        
        {loadState === 'error' && (
          <div className="flex items-center justify-center h-full">
            <div className="bg-white p-6 rounded-xl shadow-card max-w-md">
              <div className="text-red-500 mb-3">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">Error Loading PDF</h3>
              <p className="text-neutral-600 mb-4">{pdfError || "Failed to load the document. Please try again."}</p>
              <button 
                onClick={() => loadDefaultPDF()}
                className="button-primary px-4 py-2 rounded-lg"
              >
                Retry
              </button>
            </div>
          </div>
        )}
        
        {loadState === 'success' && (
          <div className="pdf-container w-full h-full flex items-center justify-center py-1">
            <canvas 
              ref={canvasRef} 
              className="pdf-canvas md:max-w-[85%] lg:max-w-[75%]"
              style={{ 
                display: 'block',
                maxHeight: '100%',
                objectFit: 'contain'
              }}
            ></canvas>
          </div>
        )}
        
        {loadState === 'idle' && !pdfState.pdfDoc && (
          <div className="flex items-center justify-center h-full">
            <div className="bg-white p-6 rounded-xl shadow-card max-w-md text-center">
              <div className="text-primary-500 mb-3">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <polyline points="10 9 9 9 8 9"/>
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">No Document Loaded</h3>
              <p className="text-neutral-600 mb-4">
                Please wait while we load the default document, or select a PDF file to upload.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PDFViewer; 