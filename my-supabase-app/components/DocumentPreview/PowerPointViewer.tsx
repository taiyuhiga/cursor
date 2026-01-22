"use client";

import { useState, useEffect, useCallback } from "react";
import JSZip from "jszip";

type PowerPointViewerProps = {
  data: ArrayBuffer;
  fileName: string;
};

type SlideContent = {
  index: number;
  texts: string[];
};

// Simple XML text extractor (extracts all text nodes from PPTX slide XML)
function extractTextFromSlideXml(xml: string): string[] {
  const texts: string[] = [];

  // Match all <a:t>...</a:t> tags (text content in PPTX)
  const textMatches = xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g);
  for (const match of textMatches) {
    const text = match[1].trim();
    if (text) {
      texts.push(text);
    }
  }

  // Also match <a:p> paragraph boundaries to add line breaks
  // This is a simplified approach - real PPTX parsing is more complex
  return texts;
}

export function PowerPointViewer({ data, fileName }: PowerPointViewerProps) {
  const [slides, setSlides] = useState<SlideContent[]>([]);
  const [currentSlide, setCurrentSlide] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function parsePptx() {
      try {
        setIsLoading(true);
        setError(null);

        const zip = await JSZip.loadAsync(data);

        // Find all slide files (ppt/slides/slide*.xml)
        const slideFiles = Object.keys(zip.files)
          .filter((path) => path.match(/^ppt\/slides\/slide\d+\.xml$/))
          .sort((a, b) => {
            const numA = parseInt(a.match(/slide(\d+)\.xml$/)?.[1] || "0");
            const numB = parseInt(b.match(/slide(\d+)\.xml$/)?.[1] || "0");
            return numA - numB;
          });

        if (slideFiles.length === 0) {
          setError("No slides found in presentation");
          return;
        }

        const parsedSlides: SlideContent[] = [];

        for (let i = 0; i < slideFiles.length; i++) {
          const slideFile = zip.files[slideFiles[i]];
          const xmlContent = await slideFile.async("text");
          const texts = extractTextFromSlideXml(xmlContent);

          parsedSlides.push({
            index: i + 1,
            texts,
          });
        }

        setSlides(parsedSlides);
        setCurrentSlide(0);
      } catch (err) {
        console.error("PowerPoint parse error:", err);
        setError("Failed to parse PowerPoint file");
      } finally {
        setIsLoading(false);
      }
    }

    parsePptx();
  }, [data]);

  const goToPrevSlide = useCallback(() => {
    setCurrentSlide((prev) => Math.max(prev - 1, 0));
  }, []);

  const goToNextSlide = useCallback(() => {
    setCurrentSlide((prev) => Math.min(prev + 1, slides.length - 1));
  }, [slides.length]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-400">
        <div className="flex items-center gap-2">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span>Loading presentation...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-red-500">
        <div className="text-center">
          <p className="mb-2">{error}</p>
          <p className="text-sm opacity-70">{fileName}</p>
        </div>
      </div>
    );
  }

  if (slides.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-400">
        <p>No slides in presentation</p>
      </div>
    );
  }

  const activeSlide = slides[currentSlide];

  return (
    <div className="h-full flex flex-col bg-zinc-800">
      {/* Main content area */}
      <div className="flex-1 flex">
        {/* Slide thumbnails sidebar */}
        <div className="w-32 bg-zinc-900 overflow-y-auto border-r border-zinc-700 hidden md:block">
          {slides.map((slide, index) => (
            <button
              key={index}
              onClick={() => setCurrentSlide(index)}
              className={`w-full p-2 text-left transition-colors ${
                index === currentSlide
                  ? "bg-zinc-700"
                  : "hover:bg-zinc-800"
              }`}
            >
              <div
                className={`w-full aspect-[16/9] bg-white rounded text-xs p-1 overflow-hidden ${
                  index === currentSlide ? "ring-2 ring-blue-500" : ""
                }`}
              >
                <div className="text-zinc-600 truncate">
                  {slide.texts[0] || `Slide ${slide.index}`}
                </div>
              </div>
              <div className="text-zinc-400 text-xs mt-1 text-center">
                {slide.index}
              </div>
            </button>
          ))}
        </div>

        {/* Current slide display */}
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-4xl aspect-[16/9] bg-white rounded-lg shadow-xl p-8 overflow-auto">
            {activeSlide.texts.length > 0 ? (
              <div className="space-y-4">
                {activeSlide.texts.map((text, index) => (
                  <p
                    key={index}
                    className={`${
                      index === 0
                        ? "text-2xl font-bold text-zinc-900"
                        : "text-lg text-zinc-700"
                    }`}
                  >
                    {text}
                  </p>
                ))}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-zinc-400">
                <p>No text content on this slide</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Navigation toolbar */}
      <div className="flex items-center justify-center gap-4 px-4 py-3 bg-zinc-900 border-t border-zinc-700">
        <button
          onClick={goToPrevSlide}
          disabled={currentSlide <= 0}
          className="px-3 py-1.5 rounded bg-zinc-700 text-white hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <span className="text-white text-sm min-w-[100px] text-center">
          Slide {currentSlide + 1} / {slides.length}
        </span>
        <button
          onClick={goToNextSlide}
          disabled={currentSlide >= slides.length - 1}
          className="px-3 py-1.5 rounded bg-zinc-700 text-white hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
