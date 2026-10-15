import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Check, Copy } from 'lucide-react';
import type { ChatMessage as ChatMessageType } from '../../types/chat';
import { useTranslation } from 'react-i18next';

interface ChatMessageProps {
  message: ChatMessageType;
  exploredTexts: string[];
  isStreaming?: boolean;
}

function highlightExplored(children: ReactNode, texts: string[]): ReactNode {
  if (texts.length === 0) return children;

  const process = (node: ReactNode): ReactNode => {
    if (typeof node === 'string') {
      return splitAndHighlight(node, texts);
    }
    if (Array.isArray(node)) {
      return node.map((child, i) => <span key={i}>{process(child)}</span>);
    }
    if (node && typeof node === 'object' && 'props' in node) {
      const { children: c, ...rest } = node.props as { children?: ReactNode; [key: string]: unknown };
      if (c !== undefined) {
        return { ...node, props: { ...rest, children: process(c) } };
      }
    }
    return node;
  };

  return process(children);
}

function splitAndHighlight(text: string, texts: string[]): ReactNode {
  // Sort by length descending so longer matches take priority
  const sorted = [...texts].sort((a, b) => b.length - a.length);
  const escaped = sorted.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');

  const parts = text.split(pattern);
  if (parts.length === 1) return text;

  return parts.map((part, i) => {
    const isMatch = sorted.some((t) => t.toLowerCase() === part.toLowerCase());
    if (isMatch) {
      return (
        <mark
          key={i}
          className="bg-yellow-400/25 text-yellow-300 rounded-sm px-0.5 decoration-yellow-400/50 underline underline-offset-2"
        >
          {part}
        </mark>
      );
    }
    return part;
  });
}

export const ChatMessage = memo(function ChatMessage({
  message,
  exploredTexts,
  isStreaming = false,
}: ChatMessageProps) {
  const { t } = useTranslation();
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const [copied, setCopied] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const resetTimeoutRef = useRef<number | null>(null);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content || '');
      setCopied(true);
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current);
      }
      resetTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
        resetTimeoutRef.current = null;
      }, 1500);
    } catch (error) {
      console.error('Failed to copy message content', error);
    }
  }, [message.content]);

  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const withHighlights = (children: ReactNode) =>
    isUser ? children : highlightExplored(children, exploredTexts);

  if (isSystem) {
    return (
      <div className="px-3 py-1.5">
        <div className="text-[11px] leading-relaxed text-text-muted bg-surface-800 border border-border rounded-lg px-3 py-2 italic">
          <span className="text-text-secondary font-medium not-italic text-[10px] uppercase tracking-wider">System</span>
          <div className="mt-1 whitespace-pre-wrap">{message.content}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-message-id={message.id}
      className={`px-6 py-4 ${
        isUser ? 'flex justify-end' : ''
      }`}
    >
      <div
        className={`relative group text-[16px] leading-7 ${
          isUser
            ? 'bg-accent-600 text-white rounded-2xl rounded-br-md px-5 py-3 pr-9 max-w-[90%] inline-block'
            : 'text-text-primary prose-invert max-w-none pr-8'
        }`}
      >
        <button
          type="button"
          aria-label={copied ? 'Copied message' : 'Copy message'}
          data-state={copied ? 'copied' : 'idle'}
          onClick={handleCopy}
          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-text-muted hover:text-text-primary"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        {isUser ? (
            <div className="flex flex-col gap-2">
              {message?.images?.map((img, i) => {
                const url = `data:${img.mimeType};base64,${img.base64}`;

                return (
                  <img
                    key={i}
                    src={url}
                    onClick={() => setLightbox(url)}
                    className="max-w-25 sm:max-w-25 rounded-lg cursor-pointer border border-border hover:opacity-90 transition"
                  />
                );
              })}
              {message.content && <div>{message.content}</div>}
            </div>
          ) : (
          <>
          {message.reasoning && (
            <details className="mb-3 rounded-lg border border-border bg-surface-800 px-3 py-2 text-text-secondary">
              <summary className="cursor-pointer text-xs">{t(isStreaming && !message.content ? 'chat.thinking' : 'chat.thinkingContent')}</summary>
              <div className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed">{message.reasoning}</div>
            </details>
          )}
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const code = String(children).replace(/\n$/, '');
                if (match) {
                  return (
                    <SyntaxHighlighter
                      style={oneDark}
                      language={match[1]}
                      PreTag="div"
                      customStyle={{
                        margin: '0.5rem 0',
                        borderRadius: '0.375rem',
                        fontSize: '0.875rem',
                      }}
                    >
                      {code}
                    </SyntaxHighlighter>
                  );
                }
                return (
                  <code
                    className="bg-surface-700 px-1 py-0.5 rounded text-[14px]"
                    {...props}
                  >
                    {children}
                  </code>
                );
              },
              p({ children }) {
                return <p className="mb-4 last:mb-0">{withHighlights(children)}</p>;
              },
              h1({ children }) { return <h1 className="text-[25px] leading-9 font-bold mt-6 mb-4">{withHighlights(children)}</h1>; },
              h4({ children }) { return <h4 className="text-[17px] leading-7 font-semibold mt-4 mb-2">{withHighlights(children)}</h4>; },
              h2({ children }) {
                return (
                  <h2 className="text-[21px] leading-8 font-semibold text-text-primary mt-6 mb-3">
                    {withHighlights(children)}
                  </h2>
                );
              },
              h3({ children }) {
                return (
                  <h3 className="text-[18px] leading-7 font-semibold text-text-primary mt-5 mb-2">
                    {withHighlights(children)}
                  </h3>
                );
              },
              ul({ children }) {
                return <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>;
              },
              ol({ children }) {
                return (
                  <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>
                );
              },
              li({ children }) {
                return <li className="text-[16px] leading-7">{withHighlights(children)}</li>;
              },
              blockquote({ children }) {
                return (
                  <blockquote className="border-l-2 border-accent-500 pl-3 my-2 text-text-secondary italic">
                    {children}
                  </blockquote>
                );
              },
              table({ children }) {
                return (
                  <div className="overflow-x-auto my-2">
                    <table className="min-w-full text-[14px] border-collapse">
                      {children}
                    </table>
                  </div>
                );
              },
              th({ children }) {
                return (
                  <th className="border border-border-hover px-3 py-2 bg-surface-800 text-left font-medium">
                    {withHighlights(children)}
                  </th>
                );
              },
              td({ children }) {
                return (
                  <td className="border border-border px-3 py-2">
                    {withHighlights(children)}
                  </td>
                );
              },
              strong({ children }) {
                return <strong className="font-semibold text-text-primary">{withHighlights(children)}</strong>;
              },
              a({ href, children }) {
                return (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-400 hover:underline"
                  >
                    {children}
                  </a>
                );
              },
            }}
          >
            {message.content || t(isStreaming ? message.reasoning ? 'chat.waitingForAnswer' : 'chat.waitingForResponse' : 'chat.noAnswer')}
          </Markdown>
          {!!message.previousVersions?.length && <details className="mt-4 border-t border-border pt-3 text-sm text-text-secondary"><summary className="cursor-pointer">{t('menu.previousVersions')} ({message.previousVersions.length})</summary>{message.previousVersions.map((version, index) => <div key={index} className="mt-3 whitespace-pre-wrap rounded-lg bg-surface-800 p-3">{version.content}</div>)}</details>}
          </>
        )}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            className="max-w-[90%] max-h-[90%] rounded-lg shadow-xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
});
