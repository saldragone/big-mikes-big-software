/**
 * useAgent — Client hook for communicating with Little Mike (Claude Managed Agent).
 *
 * Manages session state, message history, and tool call execution.
 * Tool calls from the agent are returned to the parent component
 * which applies them via the existing WebSocket/send infrastructure.
 */

import { useState, useCallback, useRef } from 'react';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: number;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  name: string;
  input: Record<string, any>;
  id?: string;
  applied?: boolean;
}

interface UseAgentOptions {
  /** Function to get current device state for context */
  getDeviceState: () => any;
  /** Function to execute a tool call on the device */
  executeToolCall: (name: string, input: Record<string, any>) => void;
}

export function useAgent({ getDeviceState, executeToolCall }: UseAgentOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'system',
      text: "Hey — I'm Little Mike. I can control the 4.8SP, answer audio questions, or help you set up. What do you need?",
      timestamp: Date.now(),
    },
  ]);
  const [loading, setLoading] = useState(false);
  const sessionIdRef = useRef<string | null>(null);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;

    // Add user message
    const userMsg: ChatMessage = { role: 'user', text, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          message: text,
          deviceState: getDeviceState(),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();

      // Update session ID
      if (data.sessionId) {
        sessionIdRef.current = data.sessionId;
      }

      // Auto-execute tool calls
      const toolCalls: ToolCall[] = (data.toolCalls || []).map((tc: any) => ({
        ...tc,
        applied: false,
      }));

      for (const tc of toolCalls) {
        try {
          executeToolCall(tc.name, tc.input);
          tc.applied = true;
        } catch (err) {
          console.error(`[agent] Failed to execute ${tc.name}:`, err);
        }
      }

      // Add assistant message
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        text: data.response,
        timestamp: Date.now(),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      setMessages(prev => [...prev, {
        role: 'system',
        text: `Error: ${err.message}`,
        timestamp: Date.now(),
      }]);
    } finally {
      setLoading(false);
    }
  }, [loading, getDeviceState, executeToolCall]);

  const clearChat = useCallback(() => {
    sessionIdRef.current = null;
    setMessages([{
      role: 'system',
      text: "Chat cleared. What do you need?",
      timestamp: Date.now(),
    }]);
  }, []);

  return { messages, loading, sendMessage, clearChat };
}
