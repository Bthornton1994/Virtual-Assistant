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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      approvals: {
        Row: {
          action: string
          action_class: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          description: string
          id: string
          kind: string
          organization_id: string
          reason: string | null
          request_id: string
          requested_by: string | null
          risk_level: string
          status: string
        }
        Insert: {
          action?: string
          action_class: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          description?: string
          id?: string
          kind?: string
          organization_id: string
          reason?: string | null
          request_id: string
          requested_by?: string | null
          risk_level?: string
          status?: string
        }
        Update: {
          action?: string
          action_class?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          description?: string
          id?: string
          kind?: string
          organization_id?: string
          reason?: string | null
          request_id?: string
          requested_by?: string | null
          risk_level?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "approvals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          created_at: string
          id: string
          name: string
          organization_id: string
          path: string
          playbook_id: string | null
          request_id: string | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          organization_id: string
          path: string
          playbook_id?: string | null
          request_id?: string | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          path?: string
          playbook_id?: string | null
          request_id?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_playbook_id_fkey"
            columns: ["playbook_id"]
            isOneToOne: false
            referencedRelation: "playbooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          organization_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          organization_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      clarifications: {
        Row: {
          answer: string | null
          answered_at: string | null
          answered_by: string | null
          asked_by: string | null
          created_at: string
          id: string
          organization_id: string
          question: string
          request_id: string
        }
        Insert: {
          answer?: string | null
          answered_at?: string | null
          answered_by?: string | null
          asked_by?: string | null
          created_at?: string
          id?: string
          organization_id: string
          question: string
          request_id: string
        }
        Update: {
          answer?: string | null
          answered_at?: string | null
          answered_by?: string | null
          asked_by?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          question?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clarifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clarifications_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          organization_id: string
          request_id: string
          visibility: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          organization_id: string
          request_id: string
          visibility?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          organization_id?: string
          request_id?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      deliveries: {
        Row: {
          actions_taken: Json
          attachments: Json
          created_at: string
          created_by: string | null
          deliverables: Json
          exceptions: Json
          id: string
          next_step: string
          organization_id: string
          request_id: string
          summary: string
          unresolved_decisions: Json
        }
        Insert: {
          actions_taken?: Json
          attachments?: Json
          created_at?: string
          created_by?: string | null
          deliverables?: Json
          exceptions?: Json
          id?: string
          next_step?: string
          organization_id: string
          request_id: string
          summary: string
          unresolved_decisions?: Json
        }
        Update: {
          actions_taken?: Json
          attachments?: Json
          created_at?: string
          created_by?: string | null
          deliverables?: Json
          exceptions?: Json
          id?: string
          next_step?: string
          organization_id?: string
          request_id?: string
          summary?: string
          unresolved_decisions?: Json
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_plans: {
        Row: {
          created_at: string
          organization_id: string
          plan: Json
          request_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          plan: Json
          request_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          plan?: Json
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_plans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_plans_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          id: string
          last_accessed_at: string | null
          organization_id: string
          provider: string
          scopes: Json
          status: string
        }
        Insert: {
          id?: string
          last_accessed_at?: string | null
          organization_id: string
          provider: string
          scopes?: Json
          status?: string
        }
        Update: {
          id?: string
          last_accessed_at?: string | null
          organization_id?: string
          provider?: string
          scopes?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_notes: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          organization_id: string
          request_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          organization_id: string
          request_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          organization_id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "internal_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_notes_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          name: string
          organization_id: string
          role: string
          status: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          name: string
          organization_id: string
          role: string
          status?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          name?: string
          organization_id?: string
          role?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          company: string
          created_at: string
          email: string
          id: string
          name: string
          outcome: string
          source: string
          status: string
          utm: Json
        }
        Insert: {
          company: string
          created_at?: string
          email: string
          id: string
          name: string
          outcome?: string
          source?: string
          status?: string
          utm?: Json
        }
        Update: {
          company?: string
          created_at?: string
          email?: string
          id?: string
          name?: string
          outcome?: string
          source?: string
          status?: string
          utm?: Json
        }
        Relationships: []
      }
      operating_memory: {
        Row: {
          approval_thresholds: string
          communication_tone: string
          crm_rules: string
          escalation_contacts: string
          formatting_preferences: string
          id: string
          organization_id: string
          preferred_meeting_windows: string
          preferred_vendors: string
          prohibited_actions: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approval_thresholds?: string
          communication_tone?: string
          crm_rules?: string
          escalation_contacts?: string
          formatting_preferences?: string
          id?: string
          organization_id: string
          preferred_meeting_windows?: string
          preferred_vendors?: string
          prohibited_actions?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approval_thresholds?: string
          communication_tone?: string
          crm_rules?: string
          escalation_contacts?: string
          formatting_preferences?: string
          id?: string
          organization_id?: string
          preferred_meeting_windows?: string
          preferred_vendors?: string
          prohibited_actions?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operating_memory_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_skills: {
        Row: {
          operator_id: string
          proficiency: number
          skill_id: string
        }
        Insert: {
          operator_id: string
          proficiency?: number
          skill_id: string
        }
        Update: {
          operator_id?: string
          proficiency?: number
          skill_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_skills_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
        ]
      }
      operators: {
        Row: {
          bio: string | null
          capacity_hours: number
          id: string
          name: string
          platform_role: string
          status: string
          user_id: string
        }
        Insert: {
          bio?: string | null
          capacity_hours?: number
          id?: string
          name: string
          platform_role: string
          status?: string
          user_id: string
        }
        Update: {
          bio?: string | null
          capacity_hours?: number
          id?: string
          name?: string
          platform_role?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: string
          status?: string
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
      organizations: {
        Row: {
          company_size: string | null
          created_at: string
          id: string
          industry: string | null
          name: string
          slug: string
          timezone: string
        }
        Insert: {
          company_size?: string | null
          created_at?: string
          id?: string
          industry?: string | null
          name: string
          slug: string
          timezone?: string
        }
        Update: {
          company_size?: string | null
          created_at?: string
          id?: string
          industry?: string | null
          name?: string
          slug?: string
          timezone?: string
        }
        Relationships: []
      }
      playbook_versions: {
        Row: {
          approval_points: Json
          authority_limits: Json
          client_preferences: Json
          created_at: string
          created_by: string | null
          id: string
          known_exceptions: Json
          organization_id: string
          playbook_id: string
          qa_checklist: Json
          required_inputs: Json
          steps: Json
          templates: Json
          tools: Json
          trigger: string
          version: number
          warnings: Json
        }
        Insert: {
          approval_points?: Json
          authority_limits?: Json
          client_preferences?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          known_exceptions?: Json
          organization_id: string
          playbook_id: string
          qa_checklist?: Json
          required_inputs?: Json
          steps?: Json
          templates?: Json
          tools?: Json
          trigger?: string
          version: number
          warnings?: Json
        }
        Update: {
          approval_points?: Json
          authority_limits?: Json
          client_preferences?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          known_exceptions?: Json
          organization_id?: string
          playbook_id?: string
          qa_checklist?: Json
          required_inputs?: Json
          steps?: Json
          templates?: Json
          tools?: Json
          trigger?: string
          version?: number
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "playbook_versions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playbook_versions_playbook_id_fkey"
            columns: ["playbook_id"]
            isOneToOne: false
            referencedRelation: "playbooks"
            referencedColumns: ["id"]
          },
        ]
      }
      playbooks: {
        Row: {
          created_at: string
          created_by: string | null
          current_version: number
          id: string
          objective: string
          organization_id: string
          title: string
          updated_at: string
          workstream_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          current_version?: number
          id?: string
          objective: string
          organization_id: string
          title: string
          updated_at?: string
          workstream_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          current_version?: number
          id?: string
          objective?: string
          organization_id?: string
          title?: string
          updated_at?: string
          workstream_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "playbooks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playbooks_workstream_id_fkey"
            columns: ["workstream_id"]
            isOneToOne: false
            referencedRelation: "workstreams"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          id: string
          name: string
          title: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id: string
          name: string
          title?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          title?: string | null
        }
        Relationships: []
      }
      qa_reviews: {
        Row: {
          checklist: Json
          created_at: string
          defects: Json
          id: string
          notes: string | null
          organization_id: string
          passed: boolean
          request_id: string
          reviewer_id: string | null
          score: number
        }
        Insert: {
          checklist?: Json
          created_at?: string
          defects?: Json
          id?: string
          notes?: string | null
          organization_id: string
          passed: boolean
          request_id: string
          reviewer_id?: string | null
          score: number
        }
        Update: {
          checklist?: Json
          created_at?: string
          defects?: Json
          id?: string
          notes?: string | null
          organization_id?: string
          passed?: boolean
          request_id?: string
          reviewer_id?: string | null
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "qa_reviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_reviews_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      request_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          id: string
          operator_id: string
          organization_id: string
          request_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          operator_id: string
          organization_id: string
          request_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          operator_id?: string
          organization_id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_assignments_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_assignments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      request_steps: {
        Row: {
          detail: string | null
          id: string
          organization_id: string
          owner: string
          request_id: string
          sort_order: number
          status: string
          title: string
        }
        Insert: {
          detail?: string | null
          id?: string
          organization_id: string
          owner: string
          request_id: string
          sort_order?: number
          status?: string
          title: string
        }
        Update: {
          detail?: string | null
          id?: string
          organization_id?: string
          owner?: string
          request_id?: string
          sort_order?: number
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_steps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_steps_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      requests: {
        Row: {
          actual_effort: number
          approval_level: string
          assigned_operator_id: string | null
          automation_score: number
          created_at: string
          created_by: string | null
          customer_instructions: string
          deliverable: string | null
          description: string | null
          due_at: string | null
          estimated_effort: number
          external_communication: boolean
          id: string
          internal_instructions: string
          missing_context: Json
          objective: string
          organization_id: string
          playbook_id: string | null
          priority: string
          qa_checklist: Json
          recurring: boolean
          risk_level: string
          status: string
          title: string
          updated_at: string
          workstream_id: string | null
        }
        Insert: {
          actual_effort?: number
          approval_level?: string
          assigned_operator_id?: string | null
          automation_score?: number
          created_at?: string
          created_by?: string | null
          customer_instructions?: string
          deliverable?: string | null
          description?: string | null
          due_at?: string | null
          estimated_effort?: number
          external_communication?: boolean
          id?: string
          internal_instructions?: string
          missing_context?: Json
          objective: string
          organization_id: string
          playbook_id?: string | null
          priority?: string
          qa_checklist?: Json
          recurring?: boolean
          risk_level?: string
          status?: string
          title: string
          updated_at?: string
          workstream_id?: string | null
        }
        Update: {
          actual_effort?: number
          approval_level?: string
          assigned_operator_id?: string | null
          automation_score?: number
          created_at?: string
          created_by?: string | null
          customer_instructions?: string
          deliverable?: string | null
          description?: string | null
          due_at?: string | null
          estimated_effort?: number
          external_communication?: boolean
          id?: string
          internal_instructions?: string
          missing_context?: Json
          objective?: string
          organization_id?: string
          playbook_id?: string | null
          priority?: string
          qa_checklist?: Json
          recurring?: boolean
          risk_level?: string
          status?: string
          title?: string
          updated_at?: string
          workstream_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "requests_assigned_operator_id_fkey"
            columns: ["assigned_operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_playbook_id_fkey"
            columns: ["playbook_id"]
            isOneToOne: false
            referencedRelation: "playbooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_workstream_id_fkey"
            columns: ["workstream_id"]
            isOneToOne: false
            referencedRelation: "workstreams"
            referencedColumns: ["id"]
          },
        ]
      }
      skills: {
        Row: {
          category: string
          id: string
          name: string
        }
        Insert: {
          category: string
          id?: string
          name: string
        }
        Update: {
          category?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          current_period_end: string | null
          id: string
          monthly_hours: number
          organization_id: string
          plan: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
        }
        Insert: {
          current_period_end?: string | null
          id?: string
          monthly_hours: number
          organization_id: string
          plan: string
          status: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
        }
        Update: {
          current_period_end?: string | null
          id?: string
          monthly_hours?: number
          organization_id?: string
          plan?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      time_entries: {
        Row: {
          created_at: string
          hours: number
          id: string
          note: string | null
          operator_id: string | null
          organization_id: string
          request_id: string
        }
        Insert: {
          created_at?: string
          hours: number
          id?: string
          note?: string | null
          operator_id?: string | null
          organization_id: string
          request_id: string
        }
        Update: {
          created_at?: string
          hours?: number
          id?: string
          note?: string | null
          operator_id?: string | null
          organization_id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "operators"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_records: {
        Row: {
          hours_included: number
          hours_used: number
          id: string
          organization_id: string
          period: string
          requests_delivered: number
        }
        Insert: {
          hours_included?: number
          hours_used?: number
          id?: string
          organization_id: string
          period: string
          requests_delivered?: number
        }
        Update: {
          hours_included?: number
          hours_used?: number
          id?: string
          organization_id?: string
          period?: string
          requests_delivered?: number
        }
        Relationships: [
          {
            foreignKeyName: "usage_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      workstream_templates: {
        Row: {
          id: string
          metrics: Json
          name: string
          objective: string
          recurring_tasks: Json
          sla: string
          slug: string
        }
        Insert: {
          id?: string
          metrics?: Json
          name: string
          objective: string
          recurring_tasks?: Json
          sla: string
          slug: string
        }
        Update: {
          id?: string
          metrics?: Json
          name?: string
          objective?: string
          recurring_tasks?: Json
          sla?: string
          slug?: string
        }
        Relationships: []
      }
      workstreams: {
        Row: {
          created_at: string
          health_score: number
          hours_returned: number
          id: string
          metrics: Json
          name: string
          next_run_at: string | null
          objective: string
          organization_id: string
          owner_user_id: string | null
          recurring_tasks: Json
          schedule: Json | null
          sla: string
          status: string
          template_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          health_score?: number
          hours_returned?: number
          id?: string
          metrics?: Json
          name: string
          next_run_at?: string | null
          objective: string
          organization_id: string
          owner_user_id?: string | null
          recurring_tasks?: Json
          schedule?: Json | null
          sla: string
          status?: string
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          health_score?: number
          hours_returned?: number
          id?: string
          metrics?: Json
          name?: string
          next_run_at?: string | null
          objective?: string
          organization_id?: string
          owner_user_id?: string | null
          recurring_tasks?: Json
          schedule?: Json | null
          sla?: string
          status?: string
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workstreams_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workstreams_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "workstream_templates"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      delivery_packages: {
        Row: {
          actions_taken: Json | null
          attachments: Json | null
          created_at: string | null
          created_by: string | null
          deliverables: Json | null
          exceptions: Json | null
          id: string | null
          next_step: string | null
          organization_id: string | null
          request_id: string | null
          summary: string | null
          unresolved_decisions: Json | null
        }
        Insert: {
          actions_taken?: Json | null
          attachments?: Json | null
          created_at?: string | null
          created_by?: string | null
          deliverables?: Json | null
          exceptions?: Json | null
          id?: string | null
          next_step?: string | null
          organization_id?: string | null
          request_id?: string | null
          summary?: string | null
          unresolved_decisions?: Json | null
        }
        Update: {
          actions_taken?: Json | null
          attachments?: Json | null
          created_at?: string | null
          created_by?: string | null
          deliverables?: Json | null
          exceptions?: Json | null
          id?: string | null
          next_step?: string | null
          organization_id?: string | null
          request_id?: string | null
          summary?: string | null
          unresolved_decisions?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      is_ops_manager: { Args: never; Returns: boolean }
      is_platform_staff: { Args: never; Returns: boolean }
      my_org_ids: { Args: never; Returns: string[] }
      platform_role: { Args: never; Returns: string }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
