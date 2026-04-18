import * as fs from 'fs';
import { TranscriptMessageDTO } from '../types';

/** Byte offsets for polling — tracks how far we've read per file */
const fileOffsets = new Map<string, number>();

/** Active polling intervals per session */
const pollingIntervals = new Map<string, NodeJS.Timeout>();

/**
 * Parse the full JSONL transcript file into displayable messages.
 */
export function readTranscript(transcriptPath: string): TranscriptMessageDTO[] {
  if (!fs.existsSync(transcriptPath)) return [];

  const content = fs.readFileSync(transcriptPath, 'utf-8');
  fileOffsets.set(transcriptPath, Buffer.byteLength(content, 'utf-8'));

  return parseTranscriptLines(content);
}

/**
 * Read only new lines since last read (for polling).
 */
export function readNewTranscriptLines(transcriptPath: string): TranscriptMessageDTO[] {
  if (!fs.existsSync(transcriptPath)) return [];

  const stat = fs.statSync(transcriptPath);
  const lastOffset = fileOffsets.get(transcriptPath) || 0;

  if (stat.size <= lastOffset) return [];

  const fd = fs.openSync(transcriptPath, 'r');
  const buffer = Buffer.alloc(stat.size - lastOffset);
  fs.readSync(fd, buffer, 0, buffer.length, lastOffset);
  fs.closeSync(fd);

  fileOffsets.set(transcriptPath, stat.size);

  const newContent = buffer.toString('utf-8');
  return parseTranscriptLines(newContent);
}

/**
 * Start polling a transcript file for changes. Calls onNewMessages when new content found.
 */
export function startPolling(
  sessionId: string,
  transcriptPath: string,
  onNewMessages: (messages: TranscriptMessageDTO[]) => void,
  intervalMs: number = 2000
): void {
  stopPolling(sessionId);

  const interval = setInterval(() => {
    const newMessages = readNewTranscriptLines(transcriptPath);
    if (newMessages.length > 0) {
      onNewMessages(newMessages);
    }
  }, intervalMs);

  pollingIntervals.set(sessionId, interval);
}

/**
 * Stop polling for a session.
 */
export function stopPolling(sessionId: string): void {
  const existing = pollingIntervals.get(sessionId);
  if (existing) {
    clearInterval(existing);
    pollingIntervals.delete(sessionId);
  }
}

/**
 * B007: Extract token usage from a transcript JSONL file.
 * Sums input_tokens, output_tokens, cache_read_input_tokens across all assistant messages.
 */
export interface TranscriptUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  estimatedCostUSD: number;
}

/**
 * B010: Extract token usage from transcript JSONL with requestId deduplication.
 * Multiple JSONL lines can share the same requestId (one per content block in an API response).
 * Each carries the same cumulative usage — taking the LAST entry per requestId avoids overcounting.
 */
export function readUsageFromTranscript(transcriptPath: string, pricing?: { inputPer1k: number; outputPer1k: number; cacheReadPer1k: number }): TranscriptUsage {
  const defaults = { inputPer1k: 0.003, outputPer1k: 0.015, cacheReadPer1k: 0.0003 };
  const p = pricing || defaults;

  const result: TranscriptUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0, estimatedCostUSD: 0 };

  if (!fs.existsSync(transcriptPath)) return result;

  try {
    const content = fs.readFileSync(transcriptPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    // Deduplicate by requestId — keep last entry per requestId
    const byRequestId = new Map<string, any>();
    let fallbackKey = 0;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'assistant' && entry.message?.usage) {
          const key = entry.requestId || entry.uuid || `_fallback_${fallbackKey++}`;
          byRequestId.set(key, entry.message.usage);
        }
      } catch { /* skip malformed lines */ }
    }

    // Sum deduplicated usage
    for (const u of byRequestId.values()) {
      result.inputTokens += u.input_tokens || 0;
      result.outputTokens += u.output_tokens || 0;
      result.cacheReadTokens += u.cache_read_input_tokens || 0;
      result.cacheCreationTokens += u.cache_creation_input_tokens || 0;
    }
  } catch { /* file read error */ }

  result.totalTokens = result.inputTokens + result.outputTokens;
  result.estimatedCostUSD = (result.inputTokens / 1000 * p.inputPer1k) + (result.outputTokens / 1000 * p.outputPer1k) + (result.cacheReadTokens / 1000 * p.cacheReadPer1k);

  return result;
}

/**
 * Parse raw JSONL content into transcript messages.
 * Filters out progress events, file-history snapshots, and thinking blocks.
 * Consolidates assistant content blocks into readable messages.
 */
function parseTranscriptLines(content: string): TranscriptMessageDTO[] {
  const messages: TranscriptMessageDTO[] = [];
  const lines = content.split('\n').filter(Boolean);

  for (const line of lines) {
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    // Skip non-message types
    if (obj.type === 'progress' || obj.type === 'file-history-snapshot') continue;
    if (obj.isSidechain) continue;

    // User text message
    if (obj.type === 'user' && obj.message?.role === 'user' && typeof obj.message.content === 'string') {
      messages.push({
        type: 'user',
        text: obj.message.content,
        timestamp: obj.timestamp,
      });
      continue;
    }

    // User message with content array (tool results)
    if (obj.type === 'user' && obj.message?.role === 'user' && Array.isArray(obj.message?.content)) {
      for (const block of obj.message.content) {
        if (block.type === 'tool_result') {
          const resultText = typeof block.content === 'string'
            ? block.content
            : Array.isArray(block.content)
              ? block.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
              : JSON.stringify(block.content);

          messages.push({
            type: 'tool_result',
            text: resultText.substring(0, 2000),
            toolId: block.tool_use_id,
            timestamp: obj.timestamp,
          });
        }
      }
      continue;
    }

    // Assistant message with content array
    if (obj.type === 'assistant' && obj.message?.role === 'assistant' && Array.isArray(obj.message?.content)) {
      for (const block of obj.message.content) {
        if (block.type === 'text' && block.text) {
          messages.push({
            type: 'assistant',
            text: block.text,
            timestamp: obj.timestamp,
          });
        }
        if (block.type === 'tool_use') {
          const inputSummary = block.input?.command
            ? block.input.command
            : block.input?.file_path
              ? block.input.file_path
              : block.input?.pattern
                ? block.input.pattern
                : JSON.stringify(block.input || {});

          messages.push({
            type: 'tool_use',
            text: inputSummary.substring(0, 500),
            toolName: block.name,
            toolId: block.id,
            timestamp: obj.timestamp,
          });
        }
      }
      continue;
    }

    // Assistant message with single contentBlock (streaming format)
    if (obj.type === 'assistant' && obj.contentBlock) {
      const block = obj.contentBlock;
      if (block.type === 'text' && block.text) {
        messages.push({
          type: 'assistant',
          text: block.text,
          timestamp: obj.timestamp,
        });
      }
      if (block.type === 'tool_use') {
        const inputSummary = block.input?.command
          ? block.input.command
          : block.input?.file_path
            ? block.input.file_path
            : block.input?.pattern
              ? block.input.pattern
              : JSON.stringify(block.input || {});

        messages.push({
          type: 'tool_use',
          text: inputSummary.substring(0, 500),
          toolName: block.name,
          toolId: block.id,
          timestamp: obj.timestamp,
        });
      }
      continue;
    }

    // User message with single contentBlock (tool result streaming format)
    if (obj.type === 'user' && obj.contentBlock) {
      const block = obj.contentBlock;
      if (block.type === 'tool_result') {
        const resultText = typeof block.content === 'string'
          ? block.content
          : Array.isArray(block.content)
            ? block.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
            : JSON.stringify(block.content);

        messages.push({
          type: 'tool_result',
          text: resultText.substring(0, 2000),
          toolId: block.tool_use_id,
          timestamp: obj.timestamp,
        });
      }
      continue;
    }
  }

  return messages;
}
