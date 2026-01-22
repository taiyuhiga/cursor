import React from "react";

export type IconProps = { className?: string };
export type IconComponent = (props: IconProps) => React.ReactElement;

// File type icons
export const FileIcons = {
  // Folder icons
  Folder: ({ className }: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="1.5" y="5" width="13" height="8.5" rx="1.5" />
      <path d="M1.5 5V4a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.5h4" />
    </svg>
  ),
  FolderOpen: ({ className }: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1.5 6h12.6a1 1 0 0 1 .98 1.2l-1.2 4.6a1.5 1.5 0 0 1-1.47 1.1H3.1a1.5 1.5 0 0 1-1.47-1.1L.53 7.2A1 1 0 0 1 1.5 6z" />
      <path d="M1.5 5V4a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.5h4.5A1.5 1.5 0 0 1 13.5 5v1" />
    </svg>
  ),

  // Default file
  File: ({ className }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor">
      <path d="M4 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V5.414a1 1 0 0 0-.293-.707L10.293 1.293A1 1 0 0 0 9.586 1H4zm5.5 1.5v3h3L9.5 2.5z" fillOpacity="0.6" />
    </svg>
  ),

  // Plain file (no extension)
  Plain: ({ className }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 1.5H4.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V6.5L9.5 1.5z" />
      <path d="M9.5 1.5v5h5" />
    </svg>
  ),

  // Text file
  Text: ({ className }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 1.5H4.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V6.5L9.5 1.5z" />
      <path d="M9.5 1.5v5h5" />
      <path d="M5 8h6" />
      <path d="M5 10h6" />
      <path d="M5 12h4" />
    </svg>
  ),

  // Markdown file
  Markdown: ({ className }: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      className={`${className} text-sky-500`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.5 1.5H4.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V6.5L9.5 1.5z" />
      <path d="M9.5 1.5v5h5" />
      <path d="M5 9v3l1.5-2 1.5 2V9" />
    </svg>
  ),

  // TypeScript/JavaScript
  TypeScript: ({ className }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#3178c6" />
      <path d="M4.5 7h4v1h-1.5v4h-1v-4h-1.5v-1zm4.5 0h1.75c.414 0 .75.336.75.75v.5a.75.75 0 0 1-.75.75h-1v1.25h1.75v.75h-2c-.414 0-.75-.336-.75-.75v-2.5c0-.414.336-.75.75-.75z" fill="white" />
    </svg>
  ),

  JavaScript: ({ className }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#f7df1e" />
      <path d="M5.5 7v4.5c0 .5-.5 1-1 1s-1-.25-1.25-.75l-.75.5c.25.75 1 1.25 2 1.25s2-.5 2-2v-4.5h-1zm3.5 0v5.5h1v-2.5h1c1 0 1.75-.75 1.75-1.5s-.75-1.5-1.75-1.5h-2zm1 1h.75c.5 0 .75.25.75.5s-.25.5-.75.5h-.75v-1z" fill="#323232" />
    </svg>
  ),

  // JSON
  Json: ({ className }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#cbcb41" fillOpacity="0.9" />
      <path d="M5 5c-.55 0-1 .45-1 1v1c0 .55-.45 1-1 1v1c.55 0 1 .45 1 1v1c0 .55.45 1 1 1h1v-1h-.5c-.28 0-.5-.22-.5-.5v-1.5c0-.55-.45-1-1-1 .55 0 1-.45 1-1v-1.5c0-.28.22-.5.5-.5h.5v-1h-1zm6 0h-1v1h.5c.28 0 .5.22.5.5v1.5c0 .55.45 1 1 1-.55 0-1 .45-1 1v1.5c0 .28-.22.5-.5.5h-.5v1h1c.55 0 1-.45 1-1v-1c0-.55.45-1 1-1v-1c-.55 0-1-.45-1-1v-1c0-.55-.45-1-1-1z" fill="#323232" />
    </svg>
  ),

  // Lua
  Lua: ({ className }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className}>
      <circle cx="8" cy="8" r="7" fill="#000080" />
      <circle cx="8" cy="8" r="4" fill="none" stroke="white" strokeWidth="1.5" />
      <circle cx="11.5" cy="4.5" r="1.5" fill="white" />
    </svg>
  ),

  // Config/Settings
  Config: ({ className }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor">
      <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z" fillOpacity="0.7" />
      <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z" fillOpacity="0.7" />
    </svg>
  ),

  // CSS/SCSS
  Css: ({ className }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#264de4" />
      <path d="M3 3l.8 9.2L8 14l4.2-1.8L13 3H3zm7.5 3.5H5.7l.1 1.2h4.5l-.3 3.5-2 .7-2-.7-.1-1.7h1.2l.1.9.8.3.8-.3.1-1.3H5.5L5.2 5h5.5l-.2 1.5z" fill="white" />
    </svg>
  ),

  // HTML
  Html: ({ className }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#e34f26" />
      <path d="M3 3l.8 9.2L8 14l4.2-1.8L13 3H3zm7.7 3.5l-.1 1h-5l.1 1h4.7l-.3 3.5-2.1.7-2.1-.7-.1-1.5h1l.1.8.9.3 1-.3.1-1.3h-4l-.3-3.5h7.2z" fill="white" />
    </svg>
  ),

  // Python
  Python: ({ className }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className}>
      <defs>
        <linearGradient id="python-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#387eb8" />
          <stop offset="100%" stopColor="#366994" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="url(#python-grad)" />
      <path d="M8 3c-2 0-1.9 1-1.9 1v1h2v.5h-3s-1.5-.1-1.5 2c0 2.1 1.3 2 1.3 2h.8v-1s0-1.3 1.3-1.3h2s1.2 0 1.2-1.2v-2s.2-1-2.2-1zm-.9.6c.2 0 .4.2.4.4s-.2.4-.4.4-.4-.2-.4-.4.2-.4.4-.4zM8 13c2 0 1.9-1 1.9-1v-1h-2v-.5h3s1.5.1 1.5-2c0-2.1-1.3-2-1.3-2h-.8v1s0 1.3-1.3 1.3h-2s-1.2 0-1.2 1.2v2s-.2 1 2.2 1zm.9-.6c-.2 0-.4-.2-.4-.4s.2-.4.4-.4.4.2.4.4-.2.4-.4.4z" fill="white" />
    </svg>
  ),

  // SQL
  Sql: ({ className }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#16a34a" />
      <path d="M4.5 5.5h7M4.5 8h7M4.5 10.5h7" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),

  // Image files
  Image: ({ className }: IconProps) => (
    <svg viewBox="0 0 16 16" className={`${className} text-emerald-500`} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <circle cx="5.5" cy="5.5" r="1.5" />
      <path d="M14 10l-3-3-5 5" />
      <path d="M14 14l-8-8-4 4" />
    </svg>
  ),

  // Video files
  Video: ({ className }: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      className={`${className} text-red-500`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="12" height="10" rx="1.6" />
      <path d="M2 6h12" />
      <path d="M7 7.5l3 2-3 2z" fill="currentColor" stroke="none" />
    </svg>
  ),

  // Audio files
  Audio: ({ className }: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      className={`${className} text-red-500`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="5" cy="11.5" r="1.5" />
      <circle cx="10" cy="10" r="1.5" />
      <path d="M6.5 11.5V4.5" />
      <path d="M11.5 10V4" />
      <path d="M6.5 4.5 11.5 4" />
    </svg>
  ),

  // Git
  Git: ({ className }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className}>
      <path d="M15.698 7.287L8.712.302a1.03 1.03 0 0 0-1.457 0l-1.45 1.45 1.84 1.84a1.223 1.223 0 0 1 1.55 1.56l1.773 1.774a1.224 1.224 0 1 1-.733.693L8.57 5.953v4.17a1.225 1.225 0 1 1-1.008-.036V5.917a1.224 1.224 0 0 1-.665-1.608L5.09 2.5l-4.788 4.79a1.03 1.03 0 0 0 0 1.456l6.986 6.986a1.03 1.03 0 0 0 1.457 0l6.953-6.953a1.031 1.031 0 0 0 0-1.492" fill="#f05033" />
    </svg>
  ),

  // Environment file
  Env: ({ className }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className}>
      <rect x="1" y="2" width="14" height="12" rx="2" fill="#ecd53f" fillOpacity="0.9" />
      <path d="M4 5h8v1h-8v-1zm0 2.5h6v1h-6v-1zm0 2.5h5v1h-5v-1z" fill="#323232" fillOpacity="0.8" />
    </svg>
  ),

  // PDF file
  Pdf: ({ className }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#e53935" />
      <text x="8" y="10.5" textAnchor="middle" fill="white" fontSize="5" fontWeight="bold" fontFamily="system-ui">PDF</text>
    </svg>
  ),

  // Excel file
  Excel: ({ className }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#217346" />
      <path d="M4 5l3 3-3 3M12 5l-3 3 3 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  ),

  // Word file
  Word: ({ className }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#2b579a" />
      <text x="8" y="10.5" textAnchor="middle" fill="white" fontSize="7" fontWeight="bold" fontFamily="system-ui">W</text>
    </svg>
  ),

  // PowerPoint file
  PowerPoint: ({ className }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#d24726" />
      <text x="8" y="10.5" textAnchor="middle" fill="white" fontSize="7" fontWeight="bold" fontFamily="system-ui">P</text>
    </svg>
  ),

  // CSV file
  Csv: ({ className }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#217346" />
      <path d="M4 5h8M4 8h8M4 11h8" stroke="white" strokeWidth="1" strokeLinecap="round" />
      <path d="M6 5v6M10 5v6" stroke="white" strokeWidth="1" strokeLinecap="round" />
    </svg>
  ),
};

// Chevron icon for folders
export const ChevronIcon = ({ isOpen, className }: { isOpen: boolean; className?: string }) => (
  <svg
    viewBox="0 0 16 16"
    className={`${className} transition-transform duration-150 origin-center ${isOpen ? "rotate-90" : ""}`}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6 4.5l4 3.5-4 3.5" />
  </svg>
);

// Action icons
export const ActionIcons = {
  FilePlus: ({ className }: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.5 1.5H4.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V6.5L9.5 1.5z" />
      <path d="M9.5 1.5v5h5" />
      <path d="M8 8v3" />
      <path d="M6.5 9.5h3" />
    </svg>
  ),
  FolderPlus: ({ className }: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="1.5" y="5" width="13" height="8.5" rx="1.5" />
      <path d="M1.5 5V4a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.5h4" />
      <path d="M8 8v3" />
      <path d="M6.5 9.5h3" />
    </svg>
  ),
  Refresh: ({ className }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor">
      <path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z" />
      <path d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z" />
    </svg>
  ),
  Collapse: ({ className }: IconProps) => (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor">
      <path d="M1 2a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2zm1.5.5v1h11v-1h-11zM1 8a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V8zm1.5.5v1h11v-1h-11z" />
    </svg>
  ),
  Upload: ({ className }: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.5 1.5H4.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V6.5L9.5 1.5z" />
      <path d="M9.5 1.5v5h5" />
      <path d="M8 13V9" />
      <path d="M6 11l2-2 2 2" />
    </svg>
  ),
  Export: ({ className }: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.5 1.5H4.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V6.5L9.5 1.5z" />
      <path d="M9.5 1.5v5h5" />
      <path d="M8 9v4" />
      <path d="M6 11l2 2 2-2" />
    </svg>
  ),
  FolderUpload: ({ className }: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="1.5" y="5" width="13" height="8.5" rx="1.5" />
      <path d="M1.5 5V4a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.5h4" />
      <path d="M8 12V8" />
      <path d="M6 10l2-2 2 2" />
    </svg>
  ),
  Download: ({ className }: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 2v8" />
      <path d="M5 7l3 3 3-3" />
      <path d="M2 12v1.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V12" />
    </svg>
  ),
  More: ({ className }: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="currentColor"
    >
      <circle cx="8" cy="3" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="8" cy="13" r="1.5" />
    </svg>
  ),
  Note: ({ className }: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.5 1.5H4.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V6.5L9.5 1.5z" />
      <path d="M9.5 1.5v5h5" />
      <path d="M5 8h6" />
      <path d="M5 10.5h6" />
    </svg>
  ),
  Share: ({ className }: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="3.5" r="2" />
      <circle cx="4" cy="8" r="2" />
      <circle cx="12" cy="12.5" r="2" />
      <path d="M6 9l4 2.5" />
      <path d="M10 4.5L6 7" />
    </svg>
  ),
  Cut: ({ className }: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="4" cy="4" r="2" />
      <circle cx="4" cy="12" r="2" />
      <path d="M5.5 5.5L12 12" />
      <path d="M12 4L5.5 10.5" />
    </svg>
  ),
  Copy: ({ className }: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="5" width="9" height="10" rx="1.5" />
      <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-7A1.5 1.5 0 001 3.5v7A1.5 1.5 0 002.5 12H5" />
    </svg>
  ),
  Paste: ({ className }: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="10" height="11" rx="1.5" />
      <path d="M6 4V2.5A1.5 1.5 0 017.5 1h1A1.5 1.5 0 0110 2.5V4" />
      <rect x="6" y="1" width="4" height="3" rx="0.5" />
    </svg>
  ),
  Rename: ({ className }: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11.5 2.5l2 2-8 8H3.5v-2l8-8z" />
      <path d="M10 4l2 2" />
    </svg>
  ),
  Trash: ({ className }: IconProps) => (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 4h12" />
      <path d="M5 4V2.5a1 1 0 011-1h4a1 1 0 011 1V4" />
      <path d="M12.5 4v9a1.5 1.5 0 01-1.5 1.5H5A1.5 1.5 0 013.5 13V4" />
      <path d="M6.5 7v5" />
      <path d="M9.5 7v5" />
    </svg>
  ),
};

// Get file icon based on extension
export const getFileIcon = (fileName: string): IconComponent => {
  const name = fileName.toLowerCase();
  const dotIndex = fileName.lastIndexOf(".");
  const hasExtension = dotIndex > 0 && dotIndex < fileName.length - 1;
  const ext = hasExtension ? fileName.slice(dotIndex + 1).toLowerCase() : "";

  // Config files
  if (name.includes("config") || name.includes(".config.") || ext === "cfg" || ext === "ini") {
    return FileIcons.Config;
  }

  // Environment files
  if (name.startsWith(".env") || ext === "env") {
    return FileIcons.Env;
  }

  // Git files
  if (name === ".gitignore" || name === ".gitattributes") {
    return FileIcons.Git;
  }

  switch (ext) {
    case "md":
    case "mdx":
      return FileIcons.Markdown;
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
      return FileIcons.TypeScript;
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return FileIcons.JavaScript;
    case "json":
      return FileIcons.Json;
    case "lua":
    case "luau":
      return FileIcons.Lua;
    case "css":
    case "scss":
    case "sass":
    case "less":
      return FileIcons.Css;
    case "html":
    case "htm":
      return FileIcons.Html;
    case "py":
    case "pyw":
      return FileIcons.Python;
    case "sql":
    case "sqlite":
    case "sqlite3":
      return FileIcons.Sql;
    case "txt":
      return FileIcons.Text;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "webp":
    case "ico":
    case "bmp":
      return FileIcons.Image;
    case "mp4":
    case "webm":
    case "mov":
    case "avi":
    case "mkv":
    case "m4v":
      return FileIcons.Video;
    case "mp3":
    case "wav":
    case "ogg":
    case "m4a":
    case "flac":
    case "aac":
      return FileIcons.Audio;
    case "pdf":
      return FileIcons.Pdf;
    case "xlsx":
    case "xls":
      return FileIcons.Excel;
    case "csv":
      return FileIcons.Csv;
    case "docx":
    case "doc":
      return FileIcons.Word;
    case "pptx":
    case "ppt":
      return FileIcons.PowerPoint;
    default:
      return FileIcons.Plain;
  }
};

// Get folder color based on name
export const getFolderColor = (name: string): string => {
  const n = name.toLowerCase();
  if (n.includes("node_modules") || n.includes("vendor")) return "text-zinc-400";
  if (n.startsWith(".") || n.includes(".")) return "text-zinc-400";
  return "text-zinc-500";
};

// Alias for MediaPreview component
export const fileIcons = FileIcons;
