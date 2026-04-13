/**
 * AgentChat — Chat panel for communicating with Little Mike.
 * Lives in the desktop mixer sidebar or slides up on mobile.
 */

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import type { ChatMessage, ToolCall } from '../hooks/useAgent';

interface Props {
  messages: ChatMessage[];
  loading: boolean;
  onSend: (text: string) => void;
  onClear: () => void;
  collapsed: boolean;
  onToggle: () => void;
}

// ── Tool call display names ──────────────────────────────────────────────────
const TOOL_LABELS: Record<string, string> = {
  set_gain: 'Set Gain',
  set_mute: 'Mute',
  set_eq: 'Set EQ',
  set_delay: 'Set Delay',
  set_crossover: 'Set Crossover',
  set_limiter: 'Set Limiter',
  set_routing: 'Set Routing',
  recall_preset: 'Recall Preset',
  save_preset: 'Save Preset',
  rename_channel: 'Rename Channel',
};

function ToolCallBadge({ tc }: { tc: ToolCall }) {
  const label = TOOL_LABELS[tc.name] || tc.name;
  const summary = Object.entries(tc.input)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

  return (
    <div className="chat-tool-badge">
      <span className="chat-tool-icon">{tc.applied ? '✓' : '⏳'}</span>
      <span className="chat-tool-name">{label}</span>
      <span className="chat-tool-summary">{summary}</span>
    </div>
  );
}

export default function AgentChat({ messages, loading, onSend, onClear, collapsed, onToggle }: Props) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const handleSend = () => {
    if (!draft.trim() || loading) return;
    onSend(draft.trim());
    setDraft('');
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (collapsed) {
    return (
      <button className="chat-toggle-btn" onClick={onToggle} title="Open Little Mike">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <span className="chat-toggle-label">Little Mike</span>
        {loading && <span className="chat-loading-dot" />}
      </button>
    );
  }

  return (
    <div className="chat-panel">
      {/* Header */}
      <div className="chat-header">
        <div className="chat-header-left">
          <div className="chat-avatar">🎛️</div>
          <div>
            <div className="chat-name">Little Mike</div>
            <div className="chat-status">
              {loading ? 'Thinking...' : 'Online'}
            </div>
          </div>
        </div>
        <div className="chat-header-actions">
          <button className="chat-action-btn" onClick={onClear} title="Clear chat">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25ZM3.613 5.5l.614 8.57A1.75 1.75 0 0 0 5.972 15.5h4.056a1.75 1.75 0 0 0 1.745-1.43L12.387 5.5Z"/>
            </svg>
          </button>
          <button className="chat-action-btn" onClick={onToggle} title="Minimize">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="chat-messages" ref={scrollRef}>
        {messages.map((msg, i) => (
          <div key={i} className={`chat-msg chat-msg-${msg.role}`}>
            <div className="chat-msg-text">{msg.text}</div>
            {msg.toolCalls && msg.toolCalls.length > 0 && (
              <div className="chat-tool-calls">
                {msg.toolCalls.map((tc, j) => (
                  <ToolCallBadge key={j} tc={tc} />
                ))}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="chat-msg chat-msg-assistant">
            <div className="chat-typing">
              <span /><span /><span />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="chat-input-bar">
        <input
          ref={inputRef}
          type="text"
          className="chat-input"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Tell Little Mike what you need..."
          disabled={loading}
        />
        <button className="chat-send-btn" onClick={handleSend} disabled={loading || !draft.trim()}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M.989 1.012 15.244 7.63a.5.5 0 0 1 0 .74L.99 14.988a.5.5 0 0 1-.726-.479L1.45 9.5H6.5a.5.5 0 0 0 0-1H1.45L.264 1.491A.5.5 0 0 1 .989 1.012Z"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
