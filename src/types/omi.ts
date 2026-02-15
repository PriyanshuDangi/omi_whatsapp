/**
 * Types matching the Omi webhook payloads.
 * See: https://docs.omi.me/doc/developer/apps/Integrations
 */

export interface TranscriptSegment {
  text: string;
  speaker: string;
  speakerId: number;
  is_user: boolean;
  start: number;
  end: number;
}

export interface ActionItem {
  description: string;
  completed: boolean;
}

export interface Structured {
  title: string;
  overview: string;
  emoji: string;
  category: string;
  action_items: ActionItem[];
  events: unknown[];
}

export interface OmiMemory {
  id: string;
  created_at: string;
  started_at: string;
  finished_at: string;
  transcript_segments: TranscriptSegment[];
  structured: Structured;
  apps_response: unknown[];
  discarded: boolean;
}
