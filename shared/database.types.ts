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
          created_at: string;
        };
        Insert: {
          id?: string;
          set_id: string;
          position?: number;
          question_text: string;
          options?: Json;
          correct_index?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          set_id?: string;
          position?: number;
          question_text?: string;
          options?: Json;
          correct_index?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "questions_set_id_fkey";
            columns: ["set_id"];
            referencedRelation: "trivia_sets";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      set_visibility: "private" | "unlisted" | "public";
    };
    CompositeTypes: Record<string, never>;
  };
}
