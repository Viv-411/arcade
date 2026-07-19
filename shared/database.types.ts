/**
 * TypeScript types for the Supabase schema, in the format emitted by
 * `supabase gen types typescript`. Hand-written to match
 * supabase/migrations/ so the repo typechecks without a running local stack;
 * after schema changes, regenerate with `npm run db:types` (requires
 * `supabase start`).
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string;
          display_name: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          username: string;
          display_name?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          username?: string;
          display_name?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      trivia_sets: {
        Row: {
          id: string;
          owner_id: string;
          title: string;
          description: string | null;
          category: string | null;
          visibility: Database["public"]["Enums"]["set_visibility"];
          is_removed: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          title: string;
          description?: string | null;
          category?: string | null;
          visibility?: Database["public"]["Enums"]["set_visibility"];
          is_removed?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          title?: string;
          description?: string | null;
          category?: string | null;
          visibility?: Database["public"]["Enums"]["set_visibility"];
          is_removed?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "trivia_sets_owner_id_fkey";
            columns: ["owner_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      questions: {
        Row: {
          id: string;
          set_id: string;
          position: number;
          question_text: string;
          options: Json;
          correct_index: number;
          source_set_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          set_id: string;
          position?: number;
          question_text: string;
          options?: Json;
          correct_index?: number;
          source_set_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          set_id?: string;
          position?: number;
          question_text?: string;
          options?: Json;
          correct_index?: number;
          source_set_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "questions_set_id_fkey";
            columns: ["set_id"];
            referencedRelation: "trivia_sets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "questions_source_set_id_fkey";
            columns: ["source_set_id"];
            referencedRelation: "trivia_sets";
            referencedColumns: ["id"];
          },
        ];
      };
      trivia_set_shares: {
        Row: {
          id: string;
          set_id: string;
          shared_with: string;
          shared_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          set_id: string;
          shared_with: string;
          shared_by: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          set_id?: string;
          shared_with?: string;
          shared_by?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "trivia_set_shares_set_id_fkey";
            columns: ["set_id"];
            referencedRelation: "trivia_sets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "trivia_set_shares_shared_with_fkey";
            columns: ["shared_with"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "trivia_set_shares_shared_by_fkey";
            columns: ["shared_by"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      friendships: {
        Row: {
          id: string;
          requester_id: string;
          addressee_id: string;
          status: "pending" | "accepted";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          requester_id: string;
          addressee_id: string;
          status?: "pending" | "accepted";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          requester_id?: string;
          addressee_id?: string;
          status?: "pending" | "accepted";
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "friendships_requester_id_fkey";
            columns: ["requester_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "friendships_addressee_id_fkey";
            columns: ["addressee_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      chats: {
        Row: {
          id: string;
          kind: "dm" | "group";
          name: string | null;
          created_by: string;
          dm_key: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          kind: "dm" | "group";
          name?: string | null;
          created_by: string;
          dm_key?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          kind: "dm" | "group";
          name: string | null;
          created_by: string;
          dm_key: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      chat_members: {
        Row: { chat_id: string; user_id: string; last_read_at: string; joined_at: string };
        Insert: { chat_id: string; user_id: string; last_read_at?: string; joined_at?: string };
        Update: Partial<{ chat_id: string; user_id: string; last_read_at: string; joined_at: string }>;
        Relationships: [
          {
            foreignKeyName: "chat_members_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      chat_messages: {
        Row: {
          id: string;
          chat_id: string;
          sender_id: string;
          kind: "text" | "invite";
          body: string;
          invite: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          chat_id: string;
          sender_id: string;
          kind?: "text" | "invite";
          body: string;
          invite?: Json | null;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          chat_id: string;
          sender_id: string;
          kind: "text" | "invite";
          body: string;
          invite: Json | null;
          created_at: string;
        }>;
        Relationships: [
          {
            foreignKeyName: "chat_messages_sender_id_fkey";
            columns: ["sender_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      player_stats: {
        Row: {
          user_id: string;
          games_played: number;
          wins: number;
          per_game: Json;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          games_played?: number;
          wins?: number;
          per_game?: Json;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          games_played?: number;
          wins?: number;
          per_game?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "player_stats_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      record_game_result: {
        Args: { p_user_id: string; p_game: string; p_won: boolean };
        Returns: undefined;
      };
    };
    Enums: {
      set_visibility: "private" | "unlisted" | "public";
    };
    CompositeTypes: Record<string, never>;
  };
}
