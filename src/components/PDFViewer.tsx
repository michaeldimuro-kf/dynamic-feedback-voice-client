import React, { useState, useEffect, useRef, ChangeEvent, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import { FaChevronLeft, FaChevronRight, FaUpload, FaVolumeUp, FaVolumeMute, FaPause, FaPlay } from 'react-icons/fa';
import useStore from '../store/useStore';
import useSocket from '../hooks/useSocket';
import useRealtimeVoiceChat from '../hooks/useRealtimeVoiceChat';
import { useAudioStream } from '../hooks/useAudioStream';
import AudioPlaybackIndicator from './AudioPlaybackIndicator';
import toast from 'react-hot-toast';

// Set the worker to use the local file we copied to the public directory
// This avoids CORS issues completely
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

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
    setIsNarrationPaused,
    pdfContent
  } = useStore();

  // Use Socket hook
  const {
    sendTextInput,
    stopAudio,
    isProcessingPage: socketIsProcessingPage,
    currentAudio,
    resumeAudio,
    socket
  } = useSocket();

  // Use our enhanced RxJS audio streaming service with socket passed in
  const { 
    stopAudio: stopRxJSAudio, 
    resetAudio, 
    requestNarration,
    isStreaming,
    isPlaying
  } = useAudioStream(socket);

  // Local state
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [hasFixedFirstPage, setHasFixedFirstPage] = useState<boolean>(false);
  const [lastNarratedPage, setLastNarratedPage] = useState<number>(0);
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState<number>(1.0);
  const [pdf, setPdf] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const narrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Create canvas ref
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Start narration of the PDF
  const startNarration = async () => {
    try {
      // Only proceed if we have a PDF document and we're not already processing
      if (!pdfState.pdfDoc || socketIsProcessingPage) {
        console.log("[PDFViewer] Cannot start narration: No PDF document or socket is busy");
        return;
      }
      
      const currentPageNum = pdfState.pageNum;
      
      // Prevent narrating the current page again if it's already narrating
      if (audioState.isNarrating && 
           !audioState.isNarrationPaused && 
           audioState.narrationCurrentPage === currentPageNum) {
        console.log('[PDFViewer] Already narrating this page');
        return;
      }
      
      // If we were already narrating, just resume
      if (audioState.isNarrating && audioState.isNarrationPaused) {
        console.log('[PDFViewer] Resuming paused narration');
        resumeAudio();
        return;
      }
      
      // Set global narration state
      setIsNarrating(true);
      setIsNarrationPaused(false);
      setNarrationCurrentPage(currentPageNum);
      
      // Mark this page as processed locally too
      setLastNarratedPage(currentPageNum);
      
      // First, stop any existing audio and processing
      if (currentAudio) {
        console.log("[PDFViewer] Stopping any existing audio before starting new narration");
        stopAudio();
      }
      
      // Also stop any RxJS audio streaming that might be in progress
      stopRxJSAudio();
      
      // Reset any existing audio stream
      resetAudio();
      
      // Check only if we're recording (not if processing)
      if (audioState.isRecording) {
        console.error("[PDFViewer] Cannot start narration while voice recording is active");
        return;
      }
      
      // Try to extract the actual text content from the current page
      let pageText = "";
      try {
        if (pdfState.pdfDoc) {
          console.log(`[PDFViewer] Extracting text from PDF page ${currentPageNum}`);
          const page = await pdfState.pdfDoc.getPage(currentPageNum);
          const textContent = await page.getTextContent();
          pageText = textContent.items.map((item: any) => item.str).join(' ');
          console.log(`[PDFViewer] Extracted ${pageText.length} characters of text`);
        }
      } catch (err) {
        console.error("[PDFViewer] Error extracting text from PDF:", err);
        pageText = `Content from page ${currentPageNum}`;
      }
      
      // First try using our RxJS-based narration approach
      console.log('[PDFViewer] Attempting narration using RxJS audio streaming');
      
      // Try to use the direct narration approach with our enhanced audio stream hook
      const narrationSuccess = requestNarration(pageText, {
        pageNumber: currentPageNum, 
        title: `Page ${currentPageNum}`
      });
      
      if (!narrationSuccess) {
        console.log('[PDFViewer] RxJS narration failed, falling back to socket approach');
        
        // Fall back to the original approach, but with more detailed prompt
        const socketSuccess = sendTextInput(
          `Using the function get_current_page_content, summarize and narrate page ${currentPageNum} of this document in a clear, engaging way. Speak directly to me as if you're explaining the content. DO NOT reference the document itself by saying phrases like "this document shows" or "the content mentions." Just present the information naturally.`
        );
        
        if (!socketSuccess) {
          console.error('[PDFViewer] Failed to send narration request via socket as well');
          
          // Try a direct approach with the content included
          setTimeout(() => {
            console.log('[PDFViewer] Trying alternate narration approach with content');
            sendTextInput(
              `Please narrate this content from page ${currentPageNum}: "${pageText.substring(0, 800)}..." Provide an audio narration summarizing this content in a clear, engaging way.`
            );
          }, 1000);
        }
      }
      
      // Set a backup timer in case we don't get a response from either approach
      setTimeout(() => {
        const store = useStore.getState();
        // Check if we're still narrating and no audio is playing
        if (store.audioState.isNarrating && 
            !store.audioState.isNarrationPaused && 
            !store.audioState.isPlayingAudio &&
            !isStreaming && 
            !isPlaying) {
          console.log('[PDFViewer] No audio response detected, trying final fallback approach');
          // Send a much simpler, direct narration request
          sendTextInput(
            `Narrate the following text with audio: "${pageText.substring(0, 800)}..."`
          );
        }
      }, 5000);
    } catch (error) {
      console.error("Error starting narration:", error);
    }
  };

  // Stop narration
  const stopNarration = () => {
    // Update global narration state
    setIsNarrating(false);
    setIsNarrationPaused(false);
    
    // Stop any audio playback both in our old system and new RxJS system
    stopAudio();
    stopRxJSAudio();
  };

  // Load a PDF from a URL
  const loadPDF = useCallback(async (url: string) => {
    setLoadState('loading');
    setPdfError(null);
    
    try {
      // Load the PDF document
      const loadingTask = pdfjs.getDocument(url);
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
      
      // Try loading the PDF directly from file - updated path
      const directUrl = `/hm.pdf?v=${Date.now()}`;
      console.log("Attempting to fetch PDF from:", directUrl);
      
      try {
        // Try fetching directly first
        const response = await fetch(directUrl);
        console.log("Fetch response status:", response.status);
        
        if (response.ok) {
          const data = await response.arrayBuffer();
          console.log("PDF data fetched successfully, size:", data.byteLength);
          
          // Add cMapUrl and disableAutoFetch options to ensure proper rendering
          const loadingOptions = {
            data,
            cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.4.120/cmaps/',
            cMapPacked: true,
            disableAutoFetch: true,
            disableStream: false,
            disableRange: false,
          };
          
          console.log("Creating PDF document from data");
          const pdfDoc = await pdfjs.getDocument(loadingOptions).promise;
          console.log("PDF document created successfully with", pdfDoc.numPages, "pages");
          
          setPDFDoc(pdfDoc);
          setPageCount(pdfDoc.numPages);
          
          // Wait a brief moment before setting page number to ensure first page renders properly
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
              cMapPacked: true,
              disableAutoFetch: true,
              disableStream: false,
              disableRange: false,
            };
            
            const pdfDoc = await pdfjs.getDocument(loadingOptions).promise;
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

  // Create a memoized rendering function that preserves the scaling
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
      
      // Reset the canvas completely - critical for preventing scaling issues
      context.setTransform(1, 0, 0, 1, 0, 0);
      
      // Use device pixel ratio for high resolution displays
      const pixelRatio = window.devicePixelRatio || 1;
      
      // Check if we're on mobile or desktop
      const isMobile = window.innerWidth < 768;
      
      // Get container dimensions with minimal padding
      const containerWidth = container.clientWidth - (isMobile ? 16 : 64); // Increased padding for desktop
      
      // Get the default viewport at scale 1
      const defaultViewport = page.getViewport({ scale: 1, rotation: 0 });
      
      // Extract original dimensions
      const origPageWidth = defaultViewport.width;
      const origPageHeight = defaultViewport.height;
      const origAspectRatio = origPageWidth / origPageHeight;
      
      // ALWAYS scale based on width to maintain aspect ratio
      let scale = containerWidth / origPageWidth;
      
      // Apply different multipliers for mobile and desktop
      scale *= isMobile ? 0.95 : 0.65; // Reduced desktop scale from 0.72 to 0.65
      
      console.log(`Rendering page ${pageNum} with scale ${scale} (container width: ${containerWidth}, is mobile: ${isMobile}, aspect ratio: ${origAspectRatio})`);
      
      // Create the viewport with the calculated scale
      const viewport = page.getViewport({ scale, rotation: 0 });
      
      // Store the scale for reference
      setBaseScale(scale);
      
      // Clear the canvas
      context.clearRect(0, 0, canvas.width, canvas.height);
      
      // Set the canvas dimensions for internal rendering (accounting for pixel ratio)
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      
      // Apply auto-sizing with appropriate aspect ratio
      canvas.style.width = 'auto';
      canvas.style.height = 'auto';
      canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
      
      // For mobile, make sure we don't overflow
      if (isMobile) {
        canvas.style.maxWidth = '100%';
        canvas.style.maxHeight = `calc(100vh - 150px)`;
      } else {
        // For desktop, limit width to avoid excess whitespace
        canvas.style.maxWidth = '80%';
        canvas.style.margin = '0 auto';
      }
      
      // Apply the pixel ratio scale
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

  // Function to specifically handle first page rotation issues
  const ensureCorrectOrientation = useCallback(async () => {
    if (!pdfState.pdfDoc || pdfState.pageNum !== 1) return;
    
    try {
      // Only run this fix once per PDF load
      if (hasFixedFirstPage) return;
      
      // Get the first page
      const page = await pdfState.pdfDoc.getPage(1);
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      const container = containerRef.current;
      
      if (!canvas || !context || !container) return;
      
      // Reset transformations
      context.setTransform(1, 0, 0, 1, 0, 0);
      
      // Clear the canvas
      context.clearRect(0, 0, canvas.width, canvas.height);
      
      // Check if we're on mobile or desktop
      const isMobile = window.innerWidth < 768;
      
      // Get container dimensions with minimal padding
      const containerWidth = container.clientWidth - (isMobile ? 16 : 64); // Increased padding for desktop
      
      // Get the default viewport at scale 1
      const defaultViewport = page.getViewport({ scale: 1, rotation: 0 });
      
      // Extract original dimensions
      const origPageWidth = defaultViewport.width;
      const origPageHeight = defaultViewport.height;
      const origAspectRatio = origPageWidth / origPageHeight;
      
      // ALWAYS scale based on width to maintain aspect ratio
      let scale = containerWidth / origPageWidth;
      
      // Apply different multipliers for mobile and desktop
      scale *= isMobile ? 0.95 : 0.65; // Reduced desktop scale from 0.72 to 0.65
      
      console.log(`First page orientation fix with scale ${scale} (aspect ratio: ${origAspectRatio})`);
      
      // Create the viewport with the calculated scale
      const viewport = page.getViewport({ scale, rotation: 0 });
      
      // Set the canvas dimensions for internal rendering (accounting for pixel ratio)
      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      
      // Apply auto-sizing with appropriate aspect ratio
      canvas.style.width = 'auto';
      canvas.style.height = 'auto';
      canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
      
      // For mobile, make sure we don't overflow
      if (isMobile) {
        canvas.style.maxWidth = '100%';
        canvas.style.maxHeight = `calc(100vh - 150px)`;
      } else {
        // For desktop, limit width to avoid excess whitespace
        canvas.style.maxWidth = '80%';
        canvas.style.margin = '0 auto';
      }
      
      // Apply the pixel ratio scale
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
      setHasFixedFirstPage(true);
    } catch (error) {
      console.error('Error in orientation fix:', error);
    }
  }, [pdfState.pdfDoc, pdfState.pageNum, hasFixedFirstPage]);

  // Handle container resize
  useEffect(() => {
    if (!containerRef.current || !pdfState.pdfDoc) return;
    
    const resizeObserver = new ResizeObserver(() => {
      // Only re-render if we have enough information
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

  // Enhanced next page function with narration support
  const handleNextPage = () => {
    if (pdfState.pageNum < pdfState.pageCount) {
      const nextPageNum = pdfState.pageNum + 1;
      console.log(`[PDFViewer] Moving to next page: ${nextPageNum}`);
      
      // Stop any current audio processing first
      if (audioState.isNarrating) {
        // If audio is currently playing, stop it before changing pages
        if (currentAudio) {
          stopAudio();
        }
      }
      
      // Update the page number first
      nextPage();
      
      // If narration is active, update narration state to match, regardless of pause state
      if (audioState.isNarrating) {
        console.log(`[PDFViewer] Narration active, updating narration page to ${nextPageNum}`);
        
        // Update the narration current page
        setNarrationCurrentPage(nextPageNum);
        
        // Only start narration if it's not paused
        if (!audioState.isNarrationPaused) {
          // Use setTimeout to ensure state is updated before starting narration
          setTimeout(() => {
            console.log(`[PDFViewer] Starting narration for page ${nextPageNum}`);
            startNarration();
          }, 100);
        }
      }
    }
  };

  // Enhanced previous page function with narration support
  const handlePrevPage = () => {
    if (pdfState.pageNum > 1) {
      const prevPageNum = pdfState.pageNum - 1;
      console.log(`[PDFViewer] Moving to previous page: ${prevPageNum}`);
      
      // Stop any current audio processing first
      if (audioState.isNarrating) {
        // If audio is currently playing, stop it before changing pages
        if (currentAudio) {
          stopAudio();
        }
      }
      
      // Update the page number first
      prevPage();
      
      // If narration is active, update narration state to match, regardless of pause state
      if (audioState.isNarrating) {
        console.log(`[PDFViewer] Narration active, updating narration page to ${prevPageNum}`);
        
        // Update the narration current page
        setNarrationCurrentPage(prevPageNum);
        
        // Only start narration if it's not paused
        if (!audioState.isNarrationPaused) {
          // Use setTimeout to ensure state is updated before starting narration
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

  // Run orientation fix when needed
  useEffect(() => {
    if (pdfState.pdfDoc && pdfState.pageNum === 1 && !hasFixedFirstPage) {
      ensureCorrectOrientation();
    }
  }, [pdfState.pdfDoc, pdfState.pageNum, hasFixedFirstPage, ensureCorrectOrientation]);
  
  // Handle automatic narration when page changes
  useEffect(() => {
    // If narration is enabled and the page changes, start narration for the new page
    if (audioState.isNarrating && 
        !audioState.isNarrationPaused && 
        pdfState.pageNum === audioState.narrationCurrentPage && 
        !socketIsProcessingPage) {
      console.log(`Auto-triggering narration for page ${pdfState.pageNum}`);
      
      // Stop any current audio processing first
      if (currentAudio) {
        stopAudio();
      }
      
      // Current page number from props, not getState
      const currentPageNum = pdfState.pageNum;
      
      // Ensure the narration current page is updated to match
      if (currentPageNum !== audioState.narrationCurrentPage) {
        setNarrationCurrentPage(currentPageNum);
      }
      
      // Add a small delay to ensure state updates are processed
      setTimeout(() => {
        // Send text input to narrate the current page
        sendTextInput(
          `Using the function get_current_page_content, definitively speak the content of page ${currentPageNum} in a summarized manner and discuss it as I am the end user. This is report which is the result of my assessment. Do not reference the content itself in your response such as "it mentions", "the content states", etc.`
        );
      }, 100);
    }
  }, [audioState.isNarrating, audioState.isNarrationPaused, audioState.narrationCurrentPage, pdfState.pageNum, socketIsProcessingPage, sendTextInput, setNarrationCurrentPage, currentAudio, stopAudio]);

  // Add an additional effect specifically for handling manual navigation between pages when narration is ON
  useEffect(() => {
    // Only run this if narration is active but we're not currently processing a page,
    // and the pdfState.pageNum has changed without audio processing in progress
    if (audioState.isNarrating && 
        !audioState.isNarrationPaused && 
        !socketIsProcessingPage && 
        !currentAudio &&
        pdfState.pageNum !== lastNarratedPage) {
      
      console.log(`[PDFViewer] Detected unprocessed page change to ${pdfState.pageNum}`);
      
      // Update our last narrated page
      setLastNarratedPage(pdfState.pageNum);
      
      // Update narration current page to match PDF page
      setNarrationCurrentPage(pdfState.pageNum);
      
      // Add a delay to ensure state is updated
      setTimeout(() => {
        console.log(`[PDFViewer] Starting narration for page ${pdfState.pageNum} after page change`);
        startNarration();
      }, 200);
    }
  }, [pdfState.pageNum, audioState.isNarrating, audioState.isNarrationPaused, socketIsProcessingPage, currentAudio, lastNarratedPage]);

  // Add back the manual page change handler
  useEffect(() => {
    // This effect specifically watches for manual page navigation while narration is active
    if (audioState.isNarrating) {
      // Check if the current page is different from narration current page and we're not already processing
      if (pdfState.pageNum !== audioState.narrationCurrentPage && !socketIsProcessingPage) {
        console.log(`[PDFViewer] Manual page change detected during narration - from page ${audioState.narrationCurrentPage} to ${pdfState.pageNum}`);
        
        // Stop any current audio processing first
        if (currentAudio) {
          stopAudio();
        }
        
        // Update narration current page to match the manually changed page
        setNarrationCurrentPage(pdfState.pageNum);
        
        // Store the current page number as a local variable
        const currentPageNum = pdfState.pageNum;
        
        // Only start narration if it's not paused
        if (!audioState.isNarrationPaused) {
          // Add a small delay to ensure the state update happens before sending the request
          setTimeout(() => {
            // Make sure we're not still processing a previous page
            if (socketIsProcessingPage) {
              stopAudio();
            }
            
            console.log(`[PDFViewer] Triggering narration for manually navigated page ${currentPageNum}`);
            
            // Send text input to narrate the current page with a more direct prompt
            sendTextInput(
              `Using the function get_current_page_content, summarize and narrate page ${currentPageNum} of this document in a clear, engaging way. Speak directly to me as if you're explaining the content.`
            );
          }, 300);
        }
      }
    }
  }, [pdfState.pageNum, audioState.isNarrating, audioState.isNarrationPaused, audioState.narrationCurrentPage, socketIsProcessingPage, setNarrationCurrentPage, sendTextInput, currentAudio, stopAudio]);

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
          
          {/* Display narration controls if PDF is loaded */}
          {pdfState.pdfDoc && (
            <div className="ml-3">
              {audioState.isNarrating ? (
                // Currently narrating - show stop/pause buttons
                <div className="flex gap-1">
                  {audioState.isNarrationPaused ? (
                    // Resume button (play icon)
                    <button 
                      onClick={resumeAudio}
                      className="p-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                      aria-label="Resume narration"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                      </svg>
                    </button>
                  ) : (
                    // Pause button
                    <button 
                      onClick={stopAudio} 
                      className="p-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                      aria-label="Pause narration"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="6" y="4" width="4" height="16"/>
                        <rect x="14" y="4" width="4" height="16"/>
                      </svg>
                    </button>
                  )}
                  
                  {/* Stop button */}
                  <button 
                    onClick={stopNarration}
                    className="p-1.5 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                    aria-label="Stop narration"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="6" y="6" width="12" height="12"/>
                    </svg>
                  </button>
                </div>
              ) : (
                // Start narration button
                <button 
                  onClick={startNarration}
                  className="flex items-center gap-1.5 p-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                  aria-label="Narrate page"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                  </svg>
                  <span className="text-sm font-medium">Narrate</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      
      {/* Main PDF Viewer Area */}
      <div className="flex-1 overflow-auto bg-neutral-100" ref={containerRef}>
        {/* Canvas for PDF rendering */}
        <div className="flex justify-center p-4">
          <canvas 
            ref={canvasRef} 
            className="shadow-lg bg-white"
          />
        </div>
        
        {/* Loading state */}
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
      </div>
      
      {/* Add the AudioPlaybackIndicator component */}
      <AudioPlaybackIndicator />
    </div>
  );
};

export default PDFViewer; 