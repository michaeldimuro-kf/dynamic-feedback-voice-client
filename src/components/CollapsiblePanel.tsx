import { useRef, ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import useSwipe from '../hooks/useSwipe';

interface CollapsiblePanelProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  noBackdrop?: boolean;
}

const CollapsiblePanel = ({ isOpen, onClose, children, className = '', noBackdrop = false }: CollapsiblePanelProps) => {
  const panelRef = useRef<HTMLDivElement>(null);
  
  // Setup swipe handler for dismissing the panel
  useSwipe(panelRef, {
    onSwipeDown: onClose
  });
  
  return (
    <AnimatePresence mode="wait">
      {isOpen && (
        <>
          {/* Backdrop overlay - only show if noBackdrop is false */}
          {!noBackdrop && (
            <motion.div
              className="fixed inset-0 bg-black/25 z-10 md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={onClose}
            />
          )}
          
          {/* Panel content */}
          <motion.div
            ref={panelRef}
            className={`fixed inset-x-0 bottom-0 z-20 md:hidden rounded-t-2xl bg-neutral-50 shadow-lg border-t border-neutral-200 ${className}`}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ 
              type: 'spring',
              damping: 25,
              stiffness: 300,
              mass: 0.8
            }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.2}
            onDragEnd={(_, info) => {
              if (info.offset.y > 100) {
                onClose();
              }
            }}
          >
            {/* Handle bar */}
            <div className="absolute top-1.5 left-0 right-0 flex justify-center cursor-grab active:cursor-grabbing">
              <div className="w-12 h-1 bg-neutral-300 rounded-full" />
            </div>
            
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default CollapsiblePanel; 
