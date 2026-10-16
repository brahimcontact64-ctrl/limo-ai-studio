export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      addon_definitions: {
        Row: {
          active: boolean
          code: string
          created_at: string
          name: string
          price_dzd: number
          price_usdt: number
          resource: string
          sort_order: number
          units: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          name: string
          price_dzd: number
          price_usdt: number
          resource: string
          sort_order?: number
          units: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          name?: string
          price_dzd?: number
          price_usdt?: number
          resource?: string
          sort_order?: number
          units?: number
          updated_at?: string
        }
        Relationships: []
      }
      ai_cost_reservations: {
        Row: {
          actual_cost_cents: number | null
          billing_month: string
          committed_cost_cents: number
          created_at: string
          estimated_cost_cents: number
          id: string
          organization_id: string
          request_key: string
          settled_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          actual_cost_cents?: number | null
          billing_month: string
          committed_cost_cents: number
          created_at?: string
          estimated_cost_cents: number
          id?: string
          organization_id: string
          request_key: string
          settled_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          actual_cost_cents?: number | null
          billing_month?: string
          committed_cost_cents?: number
          created_at?: string
          estimated_cost_cents?: number
          id?: string
          organization_id?: string
          request_key?: string
          settled_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_cost_reservations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_provider_registry: {
        Row: {
          code: string
          created_at: string
          credential_env_key: string
          enabled: boolean
          is_default: boolean
          model_id: string
          official_reference: string | null
          pricing_metadata: Json
          pricing_unit: string
          provider: string
          stage_type: string
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          code: string
          created_at?: string
          credential_env_key: string
          enabled?: boolean
          is_default?: boolean
          model_id: string
          official_reference?: string | null
          pricing_metadata?: Json
          pricing_unit: string
          provider: string
          stage_type: string
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          credential_env_key?: string
          enabled?: boolean
          is_default?: boolean
          model_id?: string
          official_reference?: string | null
          pricing_metadata?: Json
          pricing_unit?: string
          provider?: string
          stage_type?: string
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      brands: {
        Row: {
          created_at: string
          external_page_id: string | null
          id: string
          name: string
          organization_id: string
          platform: string
        }
        Insert: {
          created_at?: string
          external_page_id?: string | null
          id?: string
          name: string
          organization_id: string
          platform?: string
        }
        Update: {
          created_at?: string
          external_page_id?: string | null
          id?: string
          name?: string
          organization_id?: string
          platform?: string
        }
        Relationships: [
          {
            foreignKeyName: "brands_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      character_catalog: {
        Row: {
          active: boolean
          age_group: string | null
          created_at: string
          emoji: string
          family_code: string | null
          gender_code: string | null
          id: string
          name: string
          reference_status: string
          sort_order: number
          tier: string
          tone: string
          updated_at: string
          visual_description: string | null
          visual_provider: string | null
          visual_ref: string | null
          voice_provider: string | null
          voice_ref: string | null
        }
        Insert: {
          active?: boolean
          age_group?: string | null
          created_at?: string
          emoji?: string
          family_code?: string | null
          gender_code?: string | null
          id: string
          name: string
          reference_status?: string
          sort_order?: number
          tier?: string
          tone: string
          updated_at?: string
          visual_description?: string | null
          visual_provider?: string | null
          visual_ref?: string | null
          voice_provider?: string | null
          voice_ref?: string | null
        }
        Update: {
          active?: boolean
          age_group?: string | null
          created_at?: string
          emoji?: string
          family_code?: string | null
          gender_code?: string | null
          id?: string
          name?: string
          reference_status?: string
          sort_order?: number
          tier?: string
          tone?: string
          updated_at?: string
          visual_description?: string | null
          visual_provider?: string | null
          visual_ref?: string | null
          voice_provider?: string | null
          voice_ref?: string | null
        }
        Relationships: []
      }
      character_voice_profiles: {
        Row: {
          active: boolean
          character_id: string
          created_at: string
          language_code: string
          model_id: string | null
          provider: string
          updated_at: string
          voice_ref: string
        }
        Insert: {
          active?: boolean
          character_id: string
          created_at?: string
          language_code: string
          model_id?: string | null
          provider: string
          updated_at?: string
          voice_ref: string
        }
        Update: {
          active?: boolean
          character_id?: string
          created_at?: string
          language_code?: string
          model_id?: string | null
          provider?: string
          updated_at?: string
          voice_ref?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_voice_profiles_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "character_catalog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_voice_profiles_language_code_fkey"
            columns: ["language_code"]
            isOneToOne: false
            referencedRelation: "language_catalog"
            referencedColumns: ["code"]
          },
        ]
      }
      characters: {
        Row: {
          created_at: string
          description: string
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "characters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      content_episodes: {
        Row: {
          created_at: string
          created_by: string
          ending_hook: string | null
          episode_number: number
          id: string
          last_frame_path: string | null
          last_scene_state: Json
          organization_id: string
          previous_episode_id: string | null
          script: string | null
          series_id: string
          status: string
          summary: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          ending_hook?: string | null
          episode_number: number
          id?: string
          last_frame_path?: string | null
          last_scene_state?: Json
          organization_id: string
          previous_episode_id?: string | null
          script?: string | null
          series_id: string
          status?: string
          summary?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          ending_hook?: string | null
          episode_number?: number
          id?: string
          last_frame_path?: string | null
          last_scene_state?: Json
          organization_id?: string
          previous_episode_id?: string | null
          script?: string | null
          series_id?: string
          status?: string
          summary?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_episodes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_episodes_previous_episode_id_fkey"
            columns: ["previous_episode_id"]
            isOneToOne: false
            referencedRelation: "content_episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_episodes_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "content_series"
            referencedColumns: ["id"]
          },
        ]
      }
      content_jobs: {
        Row: {
          attempt_count: number
          available_at: string
          completed_at: string | null
          created_at: string
          error_code: string | null
          id: string
          idempotency_key: string
          job_type: string
          locked_at: string | null
          locked_by: string | null
          organization_id: string
          payload: Json
          provider: string | null
          provider_cost_cents: number | null
          provider_job_id: string | null
          requested_by: string
          resource: string
          safety_review_id: string | null
          safety_status: string
          status: string
          units: number
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          idempotency_key: string
          job_type: string
          locked_at?: string | null
          locked_by?: string | null
          organization_id: string
          payload?: Json
          provider?: string | null
          provider_cost_cents?: number | null
          provider_job_id?: string | null
          requested_by: string
          resource: string
          safety_review_id?: string | null
          safety_status?: string
          status?: string
          units: number
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          idempotency_key?: string
          job_type?: string
          locked_at?: string | null
          locked_by?: string | null
          organization_id?: string
          payload?: Json
          provider?: string | null
          provider_cost_cents?: number | null
          provider_job_id?: string | null
          requested_by?: string
          resource?: string
          safety_review_id?: string | null
          safety_status?: string
          status?: string
          units?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_jobs_safety_review_id_fkey"
            columns: ["safety_review_id"]
            isOneToOne: false
            referencedRelation: "content_safety_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      content_projects: {
        Row: {
          brand_id: string
          character_id: string | null
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          script: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          character_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          script?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          character_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          script?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_projects_brand_id_organization_id_fkey"
            columns: ["brand_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "content_projects_character_id_organization_id_fkey"
            columns: ["character_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "content_projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      content_safety_reviews: {
        Row: {
          categories: Json
          created_at: string
          decision: string
          id: string
          organization_id: string
          provider: string | null
          provider_ref: string | null
          rationale: string | null
          stage: string
          target_id: string | null
          target_type: string
          user_id: string | null
        }
        Insert: {
          categories?: Json
          created_at?: string
          decision: string
          id?: string
          organization_id: string
          provider?: string | null
          provider_ref?: string | null
          rationale?: string | null
          stage: string
          target_id?: string | null
          target_type: string
          user_id?: string | null
        }
        Update: {
          categories?: Json
          created_at?: string
          decision?: string
          id?: string
          organization_id?: string
          provider?: string | null
          provider_ref?: string | null
          rationale?: string | null
          stage?: string
          target_id?: string | null
          target_type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_safety_reviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      content_series: {
        Row: {
          cast_bible: Json
          continuity_mode: string
          created_at: string
          created_by: string
          genre: string | null
          id: string
          language_code: string
          organization_id: string
          premise: string | null
          series_type: string
          status: string
          story_rules: Json
          title: string
          updated_at: string
          visual_style: Json
          world_bible: Json
        }
        Insert: {
          cast_bible?: Json
          continuity_mode?: string
          created_at?: string
          created_by: string
          genre?: string | null
          id?: string
          language_code?: string
          organization_id: string
          premise?: string | null
          series_type?: string
          status?: string
          story_rules?: Json
          title: string
          updated_at?: string
          visual_style?: Json
          world_bible?: Json
        }
        Update: {
          cast_bible?: Json
          continuity_mode?: string
          created_at?: string
          created_by?: string
          genre?: string | null
          id?: string
          language_code?: string
          organization_id?: string
          premise?: string | null
          series_type?: string
          status?: string
          story_rules?: Json
          title?: string
          updated_at?: string
          visual_style?: Json
          world_bible?: Json
        }
        Relationships: [
          {
            foreignKeyName: "content_series_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      content_type_catalog: {
        Row: {
          active: boolean
          code: string
          description: string
          label: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          code: string
          description: string
          label: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          code?: string
          description?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      export_jobs: {
        Row: {
          created_at: string
          error_code: string | null
          id: string
          master_asset_id: string
          organization_id: string
          output_asset_id: string | null
          preset_code: string
          project_id: string
          quality: string
          requested_by: string
          smart_reframe: boolean
          status: string
          subtitles: boolean
          updated_at: string
          watermark: boolean
        }
        Insert: {
          created_at?: string
          error_code?: string | null
          id?: string
          master_asset_id: string
          organization_id: string
          output_asset_id?: string | null
          preset_code: string
          project_id: string
          quality?: string
          requested_by: string
          smart_reframe?: boolean
          status?: string
          subtitles?: boolean
          updated_at?: string
          watermark?: boolean
        }
        Update: {
          created_at?: string
          error_code?: string | null
          id?: string
          master_asset_id?: string
          organization_id?: string
          output_asset_id?: string | null
          preset_code?: string
          project_id?: string
          quality?: string
          requested_by?: string
          smart_reframe?: boolean
          status?: string
          subtitles?: boolean
          updated_at?: string
          watermark?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "export_jobs_master_asset_id_fkey"
            columns: ["master_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "export_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "export_jobs_output_asset_id_fkey"
            columns: ["output_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "export_jobs_preset_code_fkey"
            columns: ["preset_code"]
            isOneToOne: false
            referencedRelation: "export_presets"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "export_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "studio_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      export_presets: {
        Row: {
          active: boolean
          aspect_ratio: string
          code: string
          height: number
          label: string
          recommended_for: string[]
          sort_order: number
          width: number
        }
        Insert: {
          active?: boolean
          aspect_ratio: string
          code: string
          height: number
          label: string
          recommended_for?: string[]
          sort_order?: number
          width: number
        }
        Update: {
          active?: boolean
          aspect_ratio?: string
          code?: string
          height?: number
          label?: string
          recommended_for?: string[]
          sort_order?: number
          width?: number
        }
        Relationships: []
      }
      facebook_pages: {
        Row: {
          connection_id: string
          created_at: string
          id: string
          organization_id: string
          page_id: string
          page_name: string
          selected: boolean
          token_secret_ref: string | null
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          id?: string
          organization_id: string
          page_id: string
          page_name: string
          selected?: boolean
          token_secret_ref?: string | null
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          page_id?: string
          page_name?: string
          selected?: boolean
          token_secret_ref?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facebook_pages_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "social_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facebook_pages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_items: {
        Row: {
          admin_note: string | null
          category: string
          created_at: string
          id: string
          importance: string
          message: string
          organization_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          category: string
          created_at?: string
          id?: string
          importance: string
          message: string
          organization_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          category?: string
          created_at?: string
          id?: string
          importance?: string
          message?: string
          organization_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_cost_policies: {
        Row: {
          code: string
          display_name: string
          enabled: boolean
          image_per_scene_cents: number
          render_flat_cents: number
          retry_buffer_percent: number
          script_flat_cents: number
          updated_at: string
          verified_at: string | null
          video_per_second_cents: number
          voice_per_minute_cents: number
        }
        Insert: {
          code: string
          display_name: string
          enabled?: boolean
          image_per_scene_cents?: number
          render_flat_cents?: number
          retry_buffer_percent?: number
          script_flat_cents?: number
          updated_at?: string
          verified_at?: string | null
          video_per_second_cents?: number
          voice_per_minute_cents?: number
        }
        Update: {
          code?: string
          display_name?: string
          enabled?: boolean
          image_per_scene_cents?: number
          render_flat_cents?: number
          retry_buffer_percent?: number
          script_flat_cents?: number
          updated_at?: string
          verified_at?: string | null
          video_per_second_cents?: number
          voice_per_minute_cents?: number
        }
        Relationships: []
      }
      generation_rate_windows: {
        Row: {
          organization_id: string
          request_count: number
          updated_at: string
          window_start: string
        }
        Insert: {
          organization_id: string
          request_count?: number
          updated_at?: string
          window_start: string
        }
        Update: {
          organization_id?: string
          request_count?: number
          updated_at?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "generation_rate_windows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_run_stages: {
        Row: {
          actual_cost_cents: number | null
          attempt_count: number
          created_at: string
          error_code: string | null
          estimated_cost_cents: number
          id: string
          locked_at: string | null
          locked_by: string | null
          next_poll_at: string | null
          organization_id: string
          output_asset_id: string | null
          output_payload: Json
          preset_code: string | null
          provider: string | null
          provider_job_id: string | null
          provider_submitted_at: string | null
          run_id: string
          scene_number: number | null
          sort_order: number
          stage_key: string
          stage_type: string
          status: string
          updated_at: string
        }
        Insert: {
          actual_cost_cents?: number | null
          attempt_count?: number
          created_at?: string
          error_code?: string | null
          estimated_cost_cents?: number
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          next_poll_at?: string | null
          organization_id: string
          output_asset_id?: string | null
          output_payload?: Json
          preset_code?: string | null
          provider?: string | null
          provider_job_id?: string | null
          provider_submitted_at?: string | null
          run_id: string
          scene_number?: number | null
          sort_order: number
          stage_key: string
          stage_type: string
          status?: string
          updated_at?: string
        }
        Update: {
          actual_cost_cents?: number | null
          attempt_count?: number
          created_at?: string
          error_code?: string | null
          estimated_cost_cents?: number
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          next_poll_at?: string | null
          organization_id?: string
          output_asset_id?: string | null
          output_payload?: Json
          preset_code?: string | null
          provider?: string | null
          provider_job_id?: string | null
          provider_submitted_at?: string | null
          run_id?: string
          scene_number?: number | null
          sort_order?: number
          stage_key?: string
          stage_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "generation_run_stages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_run_stages_output_asset_id_fkey"
            columns: ["output_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_run_stages_preset_code_fkey"
            columns: ["preset_code"]
            isOneToOne: false
            referencedRelation: "export_presets"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "generation_run_stages_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "generation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_runs: {
        Row: {
          actual_cost_cents: number | null
          ai_reservation_id: string | null
          completed_at: string | null
          cost_policy_code: string
          created_at: string
          estimated_cost_cents: number
          failure_code: string | null
          id: string
          organization_id: string
          project_id: string
          provider_snapshot: Json
          request_key: string
          requested_by: string
          root_job_id: string | null
          slots_reserved: number
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          actual_cost_cents?: number | null
          ai_reservation_id?: string | null
          completed_at?: string | null
          cost_policy_code: string
          created_at?: string
          estimated_cost_cents: number
          failure_code?: string | null
          id?: string
          organization_id: string
          project_id: string
          provider_snapshot?: Json
          request_key: string
          requested_by: string
          root_job_id?: string | null
          slots_reserved: number
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          actual_cost_cents?: number | null
          ai_reservation_id?: string | null
          completed_at?: string | null
          cost_policy_code?: string
          created_at?: string
          estimated_cost_cents?: number
          failure_code?: string | null
          id?: string
          organization_id?: string
          project_id?: string
          provider_snapshot?: Json
          request_key?: string
          requested_by?: string
          root_job_id?: string | null
          slots_reserved?: number
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "generation_runs_ai_reservation_id_fkey"
            columns: ["ai_reservation_id"]
            isOneToOne: false
            referencedRelation: "ai_cost_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_runs_cost_policy_code_fkey"
            columns: ["cost_policy_code"]
            isOneToOne: false
            referencedRelation: "generation_cost_policies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "generation_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "studio_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_runs_root_job_id_fkey"
            columns: ["root_job_id"]
            isOneToOne: false
            referencedRelation: "content_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      language_catalog: {
        Row: {
          active: boolean
          code: string
          created_at: string
          label: string
          locale: string
          native_name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          label: string
          locale: string
          native_name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          label?: string
          locale?: string
          native_name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      media_assets: {
        Row: {
          bucket_id: string
          content_project_id: string | null
          created_at: string
          episode_id: string | null
          id: string
          media_type: string
          object_path: string
          organization_id: string
          source: string
        }
        Insert: {
          bucket_id: string
          content_project_id?: string | null
          created_at?: string
          episode_id?: string | null
          id?: string
          media_type: string
          object_path: string
          organization_id: string
          source?: string
        }
        Update: {
          bucket_id?: string
          content_project_id?: string | null
          created_at?: string
          episode_id?: string | null
          id?: string
          media_type?: string
          object_path?: string
          organization_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_episode_id_fkey"
            columns: ["episode_id"]
            isOneToOne: false
            referencedRelation: "content_episodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_assets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      media_deletion_queue: {
        Row: {
          attempts: number
          bucket_id: string
          created_at: string
          deleted_at: string | null
          id: string
          last_error: string | null
          object_path: string
          organization_id: string
          status: string
        }
        Insert: {
          attempts?: number
          bucket_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_error?: string | null
          object_path: string
          organization_id: string
          status?: string
        }
        Update: {
          attempts?: number
          bucket_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_error?: string | null
          object_path?: string
          organization_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_deletion_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_outbox: {
        Row: {
          attempts: number
          channel: string
          created_at: string
          dedupe_key: string
          id: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          organization_id: string
          payload: Json
          provider_message_id: string | null
          scheduled_for: string
          sent_at: string | null
          status: string
          template_key: string
          user_id: string | null
        }
        Insert: {
          attempts?: number
          channel?: string
          created_at?: string
          dedupe_key: string
          id?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          organization_id: string
          payload?: Json
          provider_message_id?: string | null
          scheduled_for: string
          sent_at?: string | null
          status?: string
          template_key: string
          user_id?: string | null
        }
        Update: {
          attempts?: number
          channel?: string
          created_at?: string
          dedupe_key?: string
          id?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          organization_id?: string
          payload?: Json
          provider_message_id?: string | null
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          template_key?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_outbox_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_templates: {
        Row: {
          active: boolean
          body_template: string
          subject_template: string
          template_key: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          body_template: string
          subject_template: string
          template_key: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          body_template?: string
          subject_template?: string
          template_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      organization_content_preferences: {
        Row: {
          content_types: string[]
          creator_goal: string | null
          default_tone: string | null
          organization_id: string
          preferred_languages: string[]
          publishing_cadence: Json
          serial_story_mode: boolean
          target_audience: string | null
          typical_duration_seconds: number | null
          updated_at: string
        }
        Insert: {
          content_types?: string[]
          creator_goal?: string | null
          default_tone?: string | null
          organization_id: string
          preferred_languages?: string[]
          publishing_cadence?: Json
          serial_story_mode?: boolean
          target_audience?: string | null
          typical_duration_seconds?: number | null
          updated_at?: string
        }
        Update: {
          content_types?: string[]
          creator_goal?: string | null
          default_tone?: string | null
          organization_id?: string
          preferred_languages?: string[]
          publishing_cadence?: Json
          serial_story_mode?: boolean
          target_audience?: string | null
          typical_duration_seconds?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_content_preferences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          organization_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_subscriptions: {
        Row: {
          created_at: string
          organization_id: string
          plan_code: string
          renews_at: string | null
          source_payment_id: string | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          plan_code: string
          renews_at?: string | null
          source_payment_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          plan_code?: string
          renews_at?: string | null
          source_payment_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_subscriptions_plan_code_fkey"
            columns: ["plan_code"]
            isOneToOne: false
            referencedRelation: "plan_definitions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "organization_subscriptions_source_payment_id_fkey"
            columns: ["source_payment_id"]
            isOneToOne: false
            referencedRelation: "payment_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          ai_enabled: boolean
          created_at: string
          id: string
          monthly_budget_cents: number
          name: string
          publishing_enabled: boolean
        }
        Insert: {
          ai_enabled?: boolean
          created_at?: string
          id?: string
          monthly_budget_cents?: number
          name: string
          publishing_enabled?: boolean
        }
        Update: {
          ai_enabled?: boolean
          created_at?: string
          id?: string
          monthly_budget_cents?: number
          name?: string
          publishing_enabled?: boolean
        }
        Relationships: []
      }
      payment_method_settings: {
        Row: {
          account_holder: string | null
          account_number: string | null
          ccp_key: string | null
          display_name: string
          enabled: boolean
          instructions: string | null
          method: string
          redotpay_uid: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_holder?: string | null
          account_number?: string | null
          ccp_key?: string | null
          display_name: string
          enabled?: boolean
          instructions?: string | null
          method: string
          redotpay_uid?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_holder?: string | null
          account_number?: string | null
          ccp_key?: string | null
          display_name?: string
          enabled?: boolean
          instructions?: string | null
          method?: string
          redotpay_uid?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      payment_submissions: {
        Row: {
          amount_dzd: number | null
          amount_usdt: number | null
          created_at: string
          id: string
          item_code: string
          method: string
          organization_id: string
          purchase_type: string
          receipt_path: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_by: string
          transaction_ref: string
          updated_at: string
        }
        Insert: {
          amount_dzd?: number | null
          amount_usdt?: number | null
          created_at?: string
          id?: string
          item_code: string
          method: string
          organization_id: string
          purchase_type: string
          receipt_path?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_by: string
          transaction_ref: string
          updated_at?: string
        }
        Update: {
          amount_dzd?: number | null
          amount_usdt?: number | null
          created_at?: string
          id?: string
          item_code?: string
          method?: string
          organization_id?: string
          purchase_type?: string
          receipt_path?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_by?: string
          transaction_ref?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_submissions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_definitions: {
        Row: {
          active: boolean
          ai_images: number
          code: string
          created_at: string
          facebook_pages: number
          monthly_dzd: number
          name: string
          posts: number
          redotpay_usdt: number
          sort_order: number
          updated_at: string
          video_slots: number
        }
        Insert: {
          active?: boolean
          ai_images: number
          code: string
          created_at?: string
          facebook_pages: number
          monthly_dzd: number
          name: string
          posts: number
          redotpay_usdt: number
          sort_order?: number
          updated_at?: string
          video_slots: number
        }
        Update: {
          active?: boolean
          ai_images?: number
          code?: string
          created_at?: string
          facebook_pages?: number
          monthly_dzd?: number
          name?: string
          posts?: number
          redotpay_usdt?: number
          sort_order?: number
          updated_at?: string
          video_slots?: number
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_audit_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          event_type: string
          id: number
          metadata: Json
          organization_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          event_type: string
          id?: never
          metadata?: Json
          organization_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          event_type?: string
          id?: never
          metadata?: Json
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_generation_limits: {
        Row: {
          id: number
          max_active_runs_per_org: number
          max_requests_per_window: number
          provider_task_timeout_minutes: number
          request_window_seconds: number
          updated_at: string
          worker_lease_timeout_minutes: number
        }
        Insert: {
          id?: number
          max_active_runs_per_org?: number
          max_requests_per_window?: number
          provider_task_timeout_minutes?: number
          request_window_seconds?: number
          updated_at?: string
          worker_lease_timeout_minutes?: number
        }
        Update: {
          id?: number
          max_active_runs_per_org?: number
          max_requests_per_window?: number
          provider_task_timeout_minutes?: number
          request_window_seconds?: number
          updated_at?: string
          worker_lease_timeout_minutes?: number
        }
        Relationships: []
      }
      policy_acceptance_events: {
        Row: {
          accepted_at: string
          id: string
          policy_key: string
          source: string
          user_id: string
          version: string
        }
        Insert: {
          accepted_at?: string
          id?: string
          policy_key: string
          source: string
          user_id: string
          version: string
        }
        Update: {
          accepted_at?: string
          id?: string
          policy_key?: string
          source?: string
          user_id?: string
          version?: string
        }
        Relationships: []
      }
      project_export_choices: {
        Row: {
          created_at: string
          organization_id: string
          preset_code: string
          project_id: string
          quality: string
          smart_reframe: boolean
          subtitles: boolean
          updated_at: string
          watermark: boolean
        }
        Insert: {
          created_at?: string
          organization_id: string
          preset_code: string
          project_id: string
          quality?: string
          smart_reframe?: boolean
          subtitles?: boolean
          updated_at?: string
          watermark?: boolean
        }
        Update: {
          created_at?: string
          organization_id?: string
          preset_code?: string
          project_id?: string
          quality?: string
          smart_reframe?: boolean
          subtitles?: boolean
          updated_at?: string
          watermark?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "project_export_choices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_export_choices_preset_code_fkey"
            columns: ["preset_code"]
            isOneToOne: false
            referencedRelation: "export_presets"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "project_export_choices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "studio_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_scenes: {
        Row: {
          action_prompt: string | null
          camera_prompt: string | null
          continuity_notes: string | null
          created_at: string
          dialogue: string | null
          duration_seconds: number
          effects_prompt: string | null
          environment_prompt: string | null
          id: string
          lighting_prompt: string | null
          location_prompt: string | null
          music_prompt: string | null
          on_screen_text: string | null
          organization_id: string
          participants: string[]
          project_id: string
          scene_number: number
          title: string | null
          transition_out: string | null
          updated_at: string
        }
        Insert: {
          action_prompt?: string | null
          camera_prompt?: string | null
          continuity_notes?: string | null
          created_at?: string
          dialogue?: string | null
          duration_seconds?: number
          effects_prompt?: string | null
          environment_prompt?: string | null
          id?: string
          lighting_prompt?: string | null
          location_prompt?: string | null
          music_prompt?: string | null
          on_screen_text?: string | null
          organization_id: string
          participants?: string[]
          project_id: string
          scene_number: number
          title?: string | null
          transition_out?: string | null
          updated_at?: string
        }
        Update: {
          action_prompt?: string | null
          camera_prompt?: string | null
          continuity_notes?: string | null
          created_at?: string
          dialogue?: string | null
          duration_seconds?: number
          effects_prompt?: string | null
          environment_prompt?: string | null
          id?: string
          lighting_prompt?: string | null
          location_prompt?: string | null
          music_prompt?: string | null
          on_screen_text?: string | null
          organization_id?: string
          participants?: string[]
          project_id?: string
          scene_number?: number
          title?: string | null
          transition_out?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_scenes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_scenes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "studio_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      publishing_approvals: {
        Row: {
          content_project_id: string
          created_at: string
          id: string
          organization_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          content_project_id: string
          created_at?: string
          id?: string
          organization_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          content_project_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "publishing_approvals_content_project_id_organization_id_fkey"
            columns: ["content_project_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "content_projects"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "publishing_approvals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_policy_rules: {
        Row: {
          active: boolean
          code: string
          description: string
          enforcement: string
          label: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          code: string
          description: string
          enforcement: string
          label: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          code?: string
          description?: string
          enforcement?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      social_connections: {
        Row: {
          connected_by: string
          created_at: string
          expires_at: string | null
          external_user_id: string | null
          id: string
          organization_id: string
          provider: string
          status: string
          token_secret_ref: string | null
          updated_at: string
        }
        Insert: {
          connected_by: string
          created_at?: string
          expires_at?: string | null
          external_user_id?: string | null
          id?: string
          organization_id: string
          provider: string
          status?: string
          token_secret_ref?: string | null
          updated_at?: string
        }
        Update: {
          connected_by?: string
          created_at?: string
          expires_at?: string | null
          external_user_id?: string | null
          id?: string
          organization_id?: string
          provider?: string
          status?: string
          token_secret_ref?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      social_oauth_states: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          organization_id: string
          provider: string
          redirect_uri: string
          state_hash: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          organization_id: string
          provider: string
          redirect_uri: string
          state_hash: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          organization_id?: string
          provider?: string
          redirect_uri?: string
          state_hash?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_oauth_states_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      studio_projects: {
        Row: {
          brief: string
          content_type: string
          continuation_mode: boolean
          created_at: string
          created_by: string
          estimated_slots: number
          goal: string | null
          id: string
          language_code: string
          last_generation_run_id: string | null
          master_asset_id: string | null
          organization_id: string
          project_cast: Json
          series_id: string | null
          status: string
          title: string
          total_duration_seconds: number
          updated_at: string
          visual_style: string | null
        }
        Insert: {
          brief?: string
          content_type: string
          continuation_mode?: boolean
          created_at?: string
          created_by: string
          estimated_slots?: number
          goal?: string | null
          id?: string
          language_code?: string
          last_generation_run_id?: string | null
          master_asset_id?: string | null
          organization_id: string
          project_cast?: Json
          series_id?: string | null
          status?: string
          title: string
          total_duration_seconds?: number
          updated_at?: string
          visual_style?: string | null
        }
        Update: {
          brief?: string
          content_type?: string
          continuation_mode?: boolean
          created_at?: string
          created_by?: string
          estimated_slots?: number
          goal?: string | null
          id?: string
          language_code?: string
          last_generation_run_id?: string | null
          master_asset_id?: string | null
          organization_id?: string
          project_cast?: Json
          series_id?: string | null
          status?: string
          title?: string
          total_duration_seconds?: number
          updated_at?: string
          visual_style?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "studio_projects_content_type_fkey"
            columns: ["content_type"]
            isOneToOne: false
            referencedRelation: "content_type_catalog"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "studio_projects_language_code_fkey"
            columns: ["language_code"]
            isOneToOne: false
            referencedRelation: "language_catalog"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "studio_projects_last_generation_run_id_fkey"
            columns: ["last_generation_run_id"]
            isOneToOne: false
            referencedRelation: "generation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "studio_projects_master_asset_id_fkey"
            columns: ["master_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "studio_projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "studio_projects_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "content_series"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_balances: {
        Row: {
          base_facebook_pages: number
          base_images: number
          base_posts: number
          base_video_slots: number
          cycle_end: string
          cycle_start: string
          extra_facebook_pages: number
          extra_images: number
          extra_posts: number
          extra_video_slots: number
          organization_id: string
          updated_at: string
          used_facebook_pages: number
          used_images: number
          used_posts: number
          used_video_slots: number
        }
        Insert: {
          base_facebook_pages?: number
          base_images?: number
          base_posts?: number
          base_video_slots?: number
          cycle_end: string
          cycle_start: string
          extra_facebook_pages?: number
          extra_images?: number
          extra_posts?: number
          extra_video_slots?: number
          organization_id: string
          updated_at?: string
          used_facebook_pages?: number
          used_images?: number
          used_posts?: number
          used_video_slots?: number
        }
        Update: {
          base_facebook_pages?: number
          base_images?: number
          base_posts?: number
          base_video_slots?: number
          cycle_end?: string
          cycle_start?: string
          extra_facebook_pages?: number
          extra_images?: number
          extra_posts?: number
          extra_video_slots?: number
          organization_id?: string
          updated_at?: string
          used_facebook_pages?: number
          used_images?: number
          used_posts?: number
          used_video_slots?: number
        }
        Relationships: [
          {
            foreignKeyName: "usage_balances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_ledger: {
        Row: {
          created_at: string
          created_by: string | null
          delta: number
          id: string
          organization_id: string
          reason: string
          reference_id: string | null
          reference_type: string | null
          resource: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delta: number
          id?: string
          organization_id: string
          reason: string
          reference_id?: string | null
          reference_type?: string | null
          resource: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delta?: number
          id?: string
          organization_id?: string
          reason?: string
          reference_id?: string | null
          reference_type?: string | null
          resource?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_ledger_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          accepted_at: string
          account_type: string
          country_code: string
          country_name: string | null
          created_at: string
          date_of_birth: string
          first_name: string
          last_name: string
          registration_completed_at: string
          safety_policy_version: string
          state_region: string
          terms_version: string
          updated_at: string
          user_id: string
        }
        Insert: {
          accepted_at?: string
          account_type?: string
          country_code: string
          country_name?: string | null
          created_at?: string
          date_of_birth: string
          first_name: string
          last_name: string
          registration_completed_at?: string
          safety_policy_version: string
          state_region: string
          terms_version: string
          updated_at?: string
          user_id: string
        }
        Update: {
          accepted_at?: string
          account_type?: string
          country_code?: string
          country_name?: string | null
          created_at?: string
          date_of_birth?: string
          first_name?: string
          last_name?: string
          registration_completed_at?: string
          safety_policy_version?: string
          state_region?: string
          terms_version?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      video_jobs: {
        Row: {
          actual_cost_cents: number
          content_project_id: string
          created_at: string
          estimated_cost_cents: number
          id: string
          organization_id: string
          status: string
        }
        Insert: {
          actual_cost_cents?: number
          content_project_id: string
          created_at?: string
          estimated_cost_cents?: number
          id?: string
          organization_id: string
          status?: string
        }
        Update: {
          actual_cost_cents?: number
          content_project_id?: string
          created_at?: string
          estimated_cost_cents?: number
          id?: string
          organization_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_jobs_content_project_id_organization_id_fkey"
            columns: ["content_project_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "content_projects"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "video_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_retention: {
        Row: {
          organization_id: string
          past_due_since: string | null
          purge_after: string | null
          purged_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          organization_id: string
          past_due_since?: string | null
          purge_after?: string | null
          purged_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          organization_id?: string
          past_due_since?: string | null
          purge_after?: string | null
          purged_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_retention_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_generation_safety_decision: {
        Args: {
          p_categories?: Json
          p_decision: string
          p_provider?: string
          p_provider_cost_cents?: number
          p_provider_ref?: string
          p_rationale?: string
          p_run_id: string
        }
        Returns: string
      }
      approve_payment_submission: {
        Args: {
          p_payment_id: string
          p_review_note?: string
          p_reviewer_id?: string
        }
        Returns: string
      }
      attach_generation_provider_task: {
        Args: {
          p_output_payload?: Json
          p_poll_after_seconds?: number
          p_provider: string
          p_provider_job_id: string
          p_stage_id: string
        }
        Returns: string
      }
      can_edit_org: { Args: { p_org: string }; Returns: boolean }
      cancel_claimed_notification: {
        Args: { p_notification_id: string; p_reason?: string }
        Returns: string
      }
      cancel_retention_for_org: {
        Args: { p_organization_id: string }
        Returns: undefined
      }
      cancel_studio_generation: { Args: { p_run_id: string }; Returns: string }
      claim_content_jobs: {
        Args: { p_limit?: number; p_worker_id: string }
        Returns: {
          attempt_count: number
          available_at: string
          completed_at: string | null
          created_at: string
          error_code: string | null
          id: string
          idempotency_key: string
          job_type: string
          locked_at: string | null
          locked_by: string | null
          organization_id: string
          payload: Json
          provider: string | null
          provider_cost_cents: number | null
          provider_job_id: string | null
          requested_by: string
          resource: string
          safety_review_id: string | null
          safety_status: string
          status: string
          units: number
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "content_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_generation_provider_polls: {
        Args: { p_limit?: number; p_provider: string; p_worker_id: string }
        Returns: {
          actual_cost_cents: number | null
          attempt_count: number
          created_at: string
          error_code: string | null
          estimated_cost_cents: number
          id: string
          locked_at: string | null
          locked_by: string | null
          next_poll_at: string | null
          organization_id: string
          output_asset_id: string | null
          output_payload: Json
          preset_code: string | null
          provider: string | null
          provider_job_id: string | null
          provider_submitted_at: string | null
          run_id: string
          scene_number: number | null
          sort_order: number
          stage_key: string
          stage_type: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "generation_run_stages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_generation_stages: {
        Args: { p_limit?: number; p_stage_type?: string; p_worker_id: string }
        Returns: {
          actual_cost_cents: number | null
          attempt_count: number
          created_at: string
          error_code: string | null
          estimated_cost_cents: number
          id: string
          locked_at: string | null
          locked_by: string | null
          next_poll_at: string | null
          organization_id: string
          output_asset_id: string | null
          output_payload: Json
          preset_code: string | null
          provider: string | null
          provider_job_id: string | null
          provider_submitted_at: string | null
          run_id: string
          scene_number: number | null
          sort_order: number
          stage_key: string
          stage_type: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "generation_run_stages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_media_deletions: {
        Args: { p_limit?: number; p_worker_id: string }
        Returns: {
          attempts: number
          bucket_id: string
          created_at: string
          deleted_at: string | null
          id: string
          last_error: string | null
          object_path: string
          organization_id: string
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "media_deletion_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_notification_outbox: {
        Args: { p_limit?: number; p_worker_id: string }
        Returns: {
          attempts: number
          channel: string
          created_at: string
          dedupe_key: string
          id: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          organization_id: string
          payload: Json
          provider_message_id: string | null
          scheduled_for: string
          sent_at: string | null
          status: string
          template_key: string
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "notification_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cleanup_expired_social_oauth_states: { Args: never; Returns: number }
      cleanup_generation_rate_windows: { Args: never; Returns: number }
      complete_content_job: {
        Args: {
          p_job_id: string
          p_provider: string
          p_provider_cost_cents?: number
          p_provider_job_id: string
        }
        Returns: string
      }
      complete_generation_stage: {
        Args: {
          p_actual_cost_cents?: number
          p_output_asset_id?: string
          p_output_payload?: Json
          p_provider: string
          p_provider_job_id: string
          p_stage_id: string
        }
        Returns: string
      }
      complete_registration_profile: {
        Args: {
          p_account_type: string
          p_country_code: string
          p_date_of_birth: string
          p_first_name: string
          p_last_name: string
          p_safety_policy_version: string
          p_state_region: string
          p_terms_version: string
        }
        Returns: undefined
      }
      complete_registration_profile_v2: {
        Args: {
          p_account_type: string
          p_country_code: string
          p_country_name: string
          p_date_of_birth: string
          p_first_name: string
          p_last_name: string
          p_safety_policy_version: string
          p_state_region: string
          p_terms_version: string
        }
        Returns: undefined
      }
      consume_social_oauth_state: {
        Args: { p_state_hash: string }
        Returns: {
          organization_id: string
          redirect_uri: string
          user_id: string
        }[]
      }
      create_series_episode_draft: {
        Args: {
          p_ending_hook?: string
          p_last_frame_path?: string
          p_last_scene_state?: Json
          p_script?: string
          p_series_id: string
          p_summary?: string
          p_title?: string
        }
        Returns: string
      }
      defer_generation_provider_poll: {
        Args: {
          p_delay_seconds?: number
          p_output_payload?: Json
          p_stage_id: string
        }
        Returns: string
      }
      enqueue_content_job: {
        Args: {
          p_idempotency_key: string
          p_job_type: string
          p_organization_id: string
          p_payload?: Json
          p_resource: string
          p_units: number
        }
        Returns: string
      }
      fail_content_job: {
        Args: {
          p_error_code: string
          p_job_id: string
          p_provider_cost_cents?: number
          p_refund_usage?: boolean
        }
        Returns: string
      }
      fail_generation_stage: {
        Args: {
          p_actual_cost_cents?: number
          p_error_code: string
          p_provider?: string
          p_provider_job_id?: string
          p_stage_id: string
        }
        Returns: string
      }
      get_generation_provider_snapshot: { Args: never; Returns: Json }
      get_next_episode_context: { Args: { p_series_id: string }; Returns: Json }
      has_unresolved_ai_costs: {
        Args: { p_organization_id: string }
        Returns: boolean
      }
      is_org_admin: { Args: { p_organization_id: string }; Returns: boolean }
      is_org_member: { Args: { p_org: string }; Returns: boolean }
      is_org_owner: { Args: { p_org: string }; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      mark_expired_subscriptions: { Args: never; Returns: number }
      mark_retention_purge_due: { Args: never; Returns: number }
      purge_due_workspaces: { Args: never; Returns: number }
      purge_workspace_database_content: {
        Args: { p_organization_id: string }
        Returns: Json
      }
      quarantine_expired_provider_tasks: {
        Args: { p_limit?: number }
        Returns: number
      }
      quarantine_stale_generation_stages: {
        Args: { p_limit?: number }
        Returns: number
      }
      read_oauth_secret: { Args: { p_secret_id: string }; Returns: string }
      reconcile_ai_budget: {
        Args: { p_final_actual_cost_cents: number; p_reservation_id: string }
        Returns: string
      }
      refund_generation_usage_once: {
        Args: { p_job_id: string }
        Returns: boolean
      }
      request_studio_generation: {
        Args: {
          p_policy_code?: string
          p_project_id: string
          p_request_key: string
        }
        Returns: string
      }
      reserve_ai_budget: {
        Args: {
          p_estimated_cost_cents: number
          p_organization_id: string
          p_request_key: string
        }
        Returns: string
      }
      save_studio_project: {
        Args: {
          p_brief: string
          p_content_type: string
          p_continuation_mode: boolean
          p_export_presets: string[]
          p_goal: string
          p_language_code: string
          p_organization_id: string
          p_project_cast: Json
          p_project_id: string
          p_scenes: Json
          p_series_id: string
          p_title: string
          p_visual_style: string
        }
        Returns: string
      }
      schedule_retention_for_org: {
        Args: { p_organization_id: string; p_past_due_since: string }
        Returns: undefined
      }
      select_facebook_pages: {
        Args: { p_organization_id: string; p_page_ids: string[] }
        Returns: number
      }
      set_content_job_safety_decision: {
        Args: {
          p_categories?: Json
          p_decision: string
          p_job_id: string
          p_provider?: string
          p_provider_ref?: string
          p_rationale?: string
        }
        Returns: string
      }
      settle_ai_budget: {
        Args: {
          p_action: string
          p_actual_cost_cents?: number
          p_reservation_id: string
        }
        Returns: string
      }
      settle_media_deletion: {
        Args: { p_deletion_id: string; p_error?: string; p_success: boolean }
        Returns: string
      }
      settle_notification: {
        Args: {
          p_error?: string
          p_notification_id: string
          p_provider_message_id?: string
          p_success: boolean
        }
        Returns: string
      }
      store_oauth_secret: {
        Args: { p_description?: string; p_name?: string; p_secret: string }
        Returns: string
      }
      update_oauth_secret: {
        Args: { p_secret: string; p_secret_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
