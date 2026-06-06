import { useState, type ReactNode, useEffect } from "react";

export interface ExpandableContainerProps {
  children: ReactNode;
  className?: string;
  title?: string;
}

export default function ExpandableContainer({ children, className = "", title }: ExpandableContainerProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Prevent background scrolling when expanded
  useEffect(() => {
    if (isExpanded) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isExpanded]);

  return (
    <>
      {/* Backdrop */}
      {isExpanded && (
        <div 
          className="fixed inset-0 z-[9998] bg-base-content/40 backdrop-blur-[2px] animate-in fade-in duration-200"
          onClick={() => setIsExpanded(false)}
        />
      )}

      {/* Main Container */}
      <div
        className={
          isExpanded
            ? "fixed inset-0 m-auto w-[92vw] max-w-[1400px] h-[92vh] max-h-[900px] z-[9999] flex flex-col bg-base-100 rounded-2xl shadow-2xl border border-base-300 p-4 sm:p-5 animate-in fade-in zoom-in-[0.98] duration-200"
            : `relative group ${className}`
        }
      >
        {isExpanded && (
          <div className="flex items-center justify-between mb-3 shrink-0">
            {title ? (
              <h2 className="text-xl font-bold text-base-content tracking-tight ml-2">{title}</h2>
            ) : (
              <div></div>
            )}
            <button 
              className="btn btn-sm btn-ghost btn-circle" 
              onClick={() => setIsExpanded(false)}
              title="Close Modal"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
        )}

        {!isExpanded && (
          <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <button 
              className="btn btn-sm btn-square btn-neutral shadow-md" 
              onClick={() => setIsExpanded(true)}
              title="Expand to Modal"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
            </button>
          </div>
        )}

        <div className={isExpanded ? "flex-1 min-h-0 w-full flex flex-col" : "w-full h-full"}>
          {children}
        </div>
      </div>
    </>
  );
}
