/**
 * Types matching the Omi webhook payloads.
 * See: https://docs.omi.me/doc/developer/apps/Integrations
 */

export interface TranscriptSegment {
  id?: string;
  text: string;
  speaker: string;
  speaker_id: number;
  is_user: boolean;
  person_id?: string | null;
  start: number;
  end: number;
  translations?: unknown[];
  speech_profile_processed?: boolean;
  stt_provider?: string | null;
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
