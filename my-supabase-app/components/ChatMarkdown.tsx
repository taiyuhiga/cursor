import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

type Props = {
  content: string;
};

export function ChatMarkdown({ content }: Props) {
  return (
    <div className="space-y-2">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="list-disc pl-5 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="whitespace-pre-wrap">{children}</li>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
              {children}
            </a>
          ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-md bg-zinc-50 border border-zinc-200 p-3">{children}</pre>
          ),
          code: ({ className, children, ...props }) => {
            const text = (Array.isArray(children) ? children.join("") : String(children)).replace(/\n$/, "");
            const isBlock = (className ?? "").includes("language-") || text.includes("\n");
            if (!isBlock) {
              return (
                <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.95em]" {...props}>
                  {text}
                </code>
              );
            }
            return (
              <code className={`block whitespace-pre font-mono text-[12px] leading-snug text-zinc-800 ${className ?? ""}`} {...props}>
                {text}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
