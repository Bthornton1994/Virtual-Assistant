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
    PostgrestVersion: "14.5"
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
      autonomy_decisions: {
        Row: {
          applied_at: string | null
          applied_by: string | null
          created_at: string
          created_by: string | null
          cycle_id: string
          decision: string
          from_level: number
          id: string
          metrics_snapshot: Json
          organization_id: string
          policy_snapshot: Json
          reason: string
          requires_approval: boolean
          status: string
          to_level: number
          workstream_id: string
        }
        Insert: {
          applied_at?: string | null
          applied_by?: string | null
          created_at?: string
          created_by?: string | null
          cycle_id: string
          decision: string
          from_level: number
          id?: string
          metrics_snapshot?: Json
          organization_id: string
          policy_snapshot?: Json
          reason: string
          requires_approval?: boolean
          status?: string
          to_level: number
          workstream_id: string
        }
        Update: {
          applied_at?: string | null
          applied_by?: string | null
          created_at?: string
          created_by?: string | null
          cycle_id?: string
          decision?: string
          from_level?: number
          id?: string
          metrics_snapshot?: Json
          organization_id?: string
          policy_snapshot?: Json
          reason?: string
          requires_approval?: boolean
          status?: string
          to_level?: number
          workstream_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "autonomy_decisions_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "gauntlet_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autonomy_decisions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autonomy_decisions_workstream_id_fkey"
            columns: ["workstream_id"]
            isOneToOne: false
            referencedRelation: "workstreams"
            referencedColumns: ["id"]
          },
        ]
      }
      autonomy_recoveries: {
        Row: {
          created_at: string
          from_level: number
          id: string
          organization_id: string
          reason: string
          recovered_by: string
          to_level: number
          workstream_id: string
        }
        Insert: {
          created_at?: string
          from_level: number
          id?: string
          organization_id: string
          reason: string
          recovered_by: string
          to_level?: number
          workstream_id: string
        }
        Update: {
          created_at?: string
          from_level?: number
          id?: string
          organization_id?: string
          reason?: string
          recovered_by?: string
          to_level?: number
          workstream_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "autonomy_recoveries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autonomy_recoveries_workstream_id_fkey"
            columns: ["workstream_id"]
            isOneToOne: false
            referencedRelation: "workstreams"
            referencedColumns: ["id"]
          },
        ]
      }
      capabilities: {
        Row: {
          created_at: string
          description: string
          display_name: string
          id: string
          input_contract_versions: Json
          key: string
          output_contract_versions: Json
          risk_class: string
          status: string
          updated_at: string
          verification_contract: Json
        }
        Insert: {
          created_at?: string
          description?: string
          display_name: string
          id?: string
          input_contract_versions?: Json
          key: string
          output_contract_versions?: Json
          risk_class: string
          status?: string
          updated_at?: string
          verification_contract?: Json
        }
        Update: {
          created_at?: string
          description?: string
          display_name?: string
          id?: string
          input_contract_versions?: Json
          key?: string
          output_contract_versions?: Json
          risk_class?: string
          status?: string
          updated_at?: string
          verification_contract?: Json
        }
        Relationships: []
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
      delegation_specs: {
        Row: {
          action_class: string
          activated_at: string | null
          activated_by: string | null
          approval_points: Json
          authority_rules: Json
          created_at: string
          created_by: string | null
          data_policy: Json
          definition_of_done: Json
          economic_envelope: Json
          exception_policy: Json
          id: string
          objective: string
          organization_id: string
          required_inputs: Json
          sla: string
          status: string
          trigger_description: string
          updated_at: string
          verification_rules: Json
          version: number
          workstream_id: string
        }
        Insert: {
          action_class?: string
          activated_at?: string | null
          activated_by?: string | null
          approval_points?: Json
          authority_rules?: Json
          created_at?: string
          created_by?: string | null
          data_policy?: Json
          definition_of_done?: Json
          economic_envelope?: Json
          exception_policy?: Json
          id?: string
          objective: string
          organization_id: string
          required_inputs?: Json
          sla?: string
          status?: string
          trigger_description?: string
          updated_at?: string
          verification_rules?: Json
          version?: number
          workstream_id: string
        }
        Update: {
          action_class?: string
          activated_at?: string | null
          activated_by?: string | null
          approval_points?: Json
          authority_rules?: Json
          created_at?: string
          created_by?: string | null
          data_policy?: Json
          definition_of_done?: Json
          economic_envelope?: Json
          exception_policy?: Json
          id?: string
          objective?: string
          organization_id?: string
          required_inputs?: Json
          sla?: string
          status?: string
          trigger_description?: string
          updated_at?: string
          verification_rules?: Json
          version?: number
          workstream_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "delegation_specs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delegation_specs_workstream_organization_fkey"
            columns: ["workstream_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "workstreams"
            referencedColumns: ["id", "organization_id"]
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
      evidence_artifacts: {
        Row: {
          content_hash: string | null
          created_at: string
          created_by: string | null
          id: string
          kind: string
          observed_at: string
          organization_id: string
          payload: Json
          request_id: string | null
          run_id: string
          source_uri: string | null
          summary: string
        }
        Insert: {
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          observed_at?: string
          organization_id: string
          payload?: Json
          request_id?: string | null
          run_id: string
          source_uri?: string | null
          summary: string
        }
        Update: {
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          observed_at?: string
          organization_id?: string
          payload?: Json
          request_id?: string | null
          run_id?: string
          source_uri?: string | null
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "evidence_artifacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_artifacts_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_artifacts_run_organization_fkey"
            columns: ["run_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "workstream_runs"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      execution_approval_requests: {
        Row: {
          action_class: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string
          organization_id: string
          plan_id: string
          requested_action: string
          requested_at: string
          requested_by: string | null
          status: string
          step_id: string
        }
        Insert: {
          action_class: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          organization_id: string
          plan_id: string
          requested_action: string
          requested_at?: string
          requested_by?: string | null
          status?: string
          step_id: string
        }
        Update: {
          action_class?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          organization_id?: string
          plan_id?: string
          requested_action?: string
          requested_at?: string
          requested_by?: string | null
          status?: string
          step_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_approval_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_approval_requests_plan_id_organization_id_fkey"
            columns: ["plan_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "execution_plans"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "execution_approval_requests_step_id_organization_id_fkey"
            columns: ["step_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "execution_plan_steps"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      execution_attempts: {
        Row: {
          ai_cost_micros: number
          attempt_number: number
          authority_snapshot: Json
          completed_at: string | null
          context_hash: string | null
          created_at: string
          executor_key: string | null
          executor_kind: string | null
          failure_class: string | null
          failure_code: string | null
          failure_summary: string | null
          heartbeat_at: string | null
          human_minutes: number
          id: string
          input_artifact_ids: Json
          lease_expires_at: string
          lease_token_hash: string
          memory_assignment_id: string | null
          memory_binding_hash: string | null
          memory_context_hash: string | null
          memory_execution_context_hash: string | null
          memory_read_receipt_hash: string | null
          memory_run_id: string | null
          memory_selected_ids: Json
          memory_selected_refs: Json
          metadata: Json
          organization_id: string
          output_artifact_ids: Json
          plan_id: string
          retry_decision: string | null
          run_id: string
          started_at: string
          status: string
          step_id: string
          tool_cost_micros: number
          worker_id: string
        }
        Insert: {
          ai_cost_micros?: number
          attempt_number: number
          authority_snapshot?: Json
          completed_at?: string | null
          context_hash?: string | null
          created_at?: string
          executor_key?: string | null
          executor_kind?: string | null
          failure_class?: string | null
          failure_code?: string | null
          failure_summary?: string | null
          heartbeat_at?: string | null
          human_minutes?: number
          id?: string
          input_artifact_ids?: Json
          lease_expires_at: string
          lease_token_hash: string
          memory_assignment_id?: string | null
          memory_binding_hash?: string | null
          memory_context_hash?: string | null
          memory_execution_context_hash?: string | null
          memory_read_receipt_hash?: string | null
          memory_run_id?: string | null
          memory_selected_ids?: Json
          memory_selected_refs?: Json
          metadata?: Json
          organization_id: string
          output_artifact_ids?: Json
          plan_id: string
          retry_decision?: string | null
          run_id: string
          started_at?: string
          status: string
          step_id: string
          tool_cost_micros?: number
          worker_id: string
        }
        Update: {
          ai_cost_micros?: number
          attempt_number?: number
          authority_snapshot?: Json
          completed_at?: string | null
          context_hash?: string | null
          created_at?: string
          executor_key?: string | null
          executor_kind?: string | null
          failure_class?: string | null
          failure_code?: string | null
          failure_summary?: string | null
          heartbeat_at?: string | null
          human_minutes?: number
          id?: string
          input_artifact_ids?: Json
          lease_expires_at?: string
          lease_token_hash?: string
          memory_assignment_id?: string | null
          memory_binding_hash?: string | null
          memory_context_hash?: string | null
          memory_execution_context_hash?: string | null
          memory_read_receipt_hash?: string | null
          memory_run_id?: string | null
          memory_selected_ids?: Json
          memory_selected_refs?: Json
          metadata?: Json
          organization_id?: string
          output_artifact_ids?: Json
          plan_id?: string
          retry_decision?: string | null
          run_id?: string
          started_at?: string
          status?: string
          step_id?: string
          tool_cost_micros?: number
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_attempts_plan_id_organization_id_fkey"
            columns: ["plan_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "execution_plans"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "execution_attempts_run_id_organization_id_fkey"
            columns: ["run_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "workstream_runs"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "execution_attempts_step_id_organization_id_fkey"
            columns: ["step_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "execution_plan_steps"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      execution_events: {
        Row: {
          actor_kind: string
          actor_ref: string | null
          attempt_id: string | null
          created_at: string
          event_type: string
          id: number
          organization_id: string
          payload: Json
          plan_id: string | null
          step_id: string | null
        }
        Insert: {
          actor_kind: string
          actor_ref?: string | null
          attempt_id?: string | null
          created_at?: string
          event_type: string
          id?: never
          organization_id: string
          payload?: Json
          plan_id?: string | null
          step_id?: string | null
        }
        Update: {
          actor_kind?: string
          actor_ref?: string | null
          attempt_id?: string | null
          created_at?: string
          event_type?: string
          id?: never
          organization_id?: string
          payload?: Json
          plan_id?: string | null
          step_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "execution_events_attempt_id_organization_id_fkey"
            columns: ["attempt_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "execution_attempts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "execution_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_events_plan_id_organization_id_fkey"
            columns: ["plan_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "execution_plans"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "execution_events_step_id_organization_id_fkey"
            columns: ["step_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "execution_plan_steps"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      execution_plan_snapshots_legacy: {
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
      execution_plan_steps: {
        Row: {
          action_class: string
          attempt_count: number
          available_at: string
          capability_key: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          data_sensitivity: string
          deadline_at: string
          depends_on: Json
          external_side_effect: boolean
          id: string
          input_artifact_ids: Json
          input_contract_version: string | null
          last_failure_class: string | null
          last_failure_code: string | null
          last_failure_summary: string | null
          lease_expires_at: string | null
          lease_worker_id: string | null
          max_attempts: number
          may_own_authoritative_state: boolean
          organization_id: string
          output_artifact_ids: Json
          output_contract_version: string | null
          plan_id: string
          requires_human_approval: boolean
          run_id: string
          sequence: number
          started_at: string | null
          status: string
          step_key: string
          title: string
          updated_at: string
        }
        Insert: {
          action_class: string
          attempt_count?: number
          available_at?: string
          capability_key: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          data_sensitivity: string
          deadline_at: string
          depends_on?: Json
          external_side_effect?: boolean
          id?: string
          input_artifact_ids?: Json
          input_contract_version?: string | null
          last_failure_class?: string | null
          last_failure_code?: string | null
          last_failure_summary?: string | null
          lease_expires_at?: string | null
          lease_worker_id?: string | null
          max_attempts?: number
          may_own_authoritative_state?: boolean
          organization_id: string
          output_artifact_ids?: Json
          output_contract_version?: string | null
          plan_id: string
          requires_human_approval?: boolean
          run_id: string
          sequence: number
          started_at?: string | null
          status?: string
          step_key: string
          title: string
          updated_at?: string
        }
        Update: {
          action_class?: string
          attempt_count?: number
          available_at?: string
          capability_key?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          data_sensitivity?: string
          deadline_at?: string
          depends_on?: Json
          external_side_effect?: boolean
          id?: string
          input_artifact_ids?: Json
          input_contract_version?: string | null
          last_failure_class?: string | null
          last_failure_code?: string | null
          last_failure_summary?: string | null
          lease_expires_at?: string | null
          lease_worker_id?: string | null
          max_attempts?: number
          may_own_authoritative_state?: boolean
          organization_id?: string
          output_artifact_ids?: Json
          output_contract_version?: string | null
          plan_id?: string
          requires_human_approval?: boolean
          run_id?: string
          sequence?: number
          started_at?: string | null
          status?: string
          step_key?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_plan_steps_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_plan_steps_plan_id_organization_id_fkey"
            columns: ["plan_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "execution_plans"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "execution_plan_steps_run_id_organization_id_fkey"
            columns: ["run_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "workstream_runs"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      execution_plans: {
        Row: {
          authority_class: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          data_policy_snapshot: Json
          delegation_spec_id: string
          delegation_spec_version: number
          frozen_at: string | null
          frozen_by: string | null
          id: string
          may_own_authoritative_state: boolean
          objective_snapshot: string
          organization_id: string
          plan_hash: string
          plan_version: number
          run_id: string
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          authority_class: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          data_policy_snapshot?: Json
          delegation_spec_id: string
          delegation_spec_version: number
          frozen_at?: string | null
          frozen_by?: string | null
          id?: string
          may_own_authoritative_state?: boolean
          objective_snapshot: string
          organization_id: string
          plan_hash: string
          plan_version?: number
          run_id: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          authority_class?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          data_policy_snapshot?: Json
          delegation_spec_id?: string
          delegation_spec_version?: number
          frozen_at?: string | null
          frozen_by?: string | null
          id?: string
          may_own_authoritative_state?: boolean
          objective_snapshot?: string
          organization_id?: string
          plan_hash?: string
          plan_version?: number
          run_id?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_plans_delegation_spec_id_fkey"
            columns: ["delegation_spec_id"]
            isOneToOne: false
            referencedRelation: "delegation_specs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_plans_organization_id_fkey1"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_plans_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "workstream_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      executor_capabilities: {
        Row: {
          capability_id: string
          created_at: string
          effective_from: string
          evidence_summary: string
          executor_profile_id: string
          qualification_status: string
          qualification_version: string
          suspended_at: string | null
          updated_at: string
        }
        Insert: {
          capability_id: string
          created_at?: string
          effective_from?: string
          evidence_summary?: string
          executor_profile_id: string
          qualification_status?: string
          qualification_version?: string
          suspended_at?: string | null
          updated_at?: string
        }
        Update: {
          capability_id?: string
          created_at?: string
          effective_from?: string
          evidence_summary?: string
          executor_profile_id?: string
          qualification_status?: string
          qualification_version?: string
          suspended_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "executor_capabilities_capability_id_fkey"
            columns: ["capability_id"]
            isOneToOne: false
            referencedRelation: "capabilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "executor_capabilities_executor_profile_id_fkey"
            columns: ["executor_profile_id"]
            isOneToOne: false
            referencedRelation: "executor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      executor_profiles: {
        Row: {
          authority_envelope: Json
          capabilities: Json
          configuration_metadata: Json
          created_at: string
          display_name: string
          executor_kind: string
          forbidden_actions: Json
          id: string
          key: string
          provider: string
          role: string
          status: string
          updated_at: string
        }
        Insert: {
          authority_envelope?: Json
          capabilities?: Json
          configuration_metadata?: Json
          created_at?: string
          display_name: string
          executor_kind: string
          forbidden_actions?: Json
          id?: string
          key: string
          provider?: string
          role?: string
          status?: string
          updated_at?: string
        }
        Update: {
          authority_envelope?: Json
          capabilities?: Json
          configuration_metadata?: Json
          created_at?: string
          display_name?: string
          executor_kind?: string
          forbidden_actions?: Json
          id?: string
          key?: string
          provider?: string
          role?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      gauntlet_cycles: {
        Row: {
          created_at: string
          created_by: string | null
          delegation_spec_id: string
          ended_at: string | null
          hypothesis: string
          id: string
          objective_snapshot: string
          organization_id: string
          parent_cycle_id: string | null
          recurrence_mode: string
          reentry_reason: string
          sequence: number
          started_at: string
          status: string
          trigger_kind: string
          trigger_ref: string | null
          updated_at: string
          workstream_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delegation_spec_id: string
          ended_at?: string | null
          hypothesis?: string
          id?: string
          objective_snapshot: string
          organization_id: string
          parent_cycle_id?: string | null
          recurrence_mode?: string
          reentry_reason?: string
          sequence: number
          started_at?: string
          status?: string
          trigger_kind?: string
          trigger_ref?: string | null
          updated_at?: string
          workstream_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delegation_spec_id?: string
          ended_at?: string | null
          hypothesis?: string
          id?: string
          objective_snapshot?: string
          organization_id?: string
          parent_cycle_id?: string | null
          recurrence_mode?: string
          reentry_reason?: string
          sequence?: number
          started_at?: string
          status?: string
          trigger_kind?: string
          trigger_ref?: string | null
          updated_at?: string
          workstream_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gauntlet_cycles_delegation_spec_id_fkey"
            columns: ["delegation_spec_id"]
            isOneToOne: false
            referencedRelation: "delegation_specs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gauntlet_cycles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gauntlet_cycles_parent_cycle_id_fkey"
            columns: ["parent_cycle_id"]
            isOneToOne: false
            referencedRelation: "gauntlet_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gauntlet_cycles_workstream_id_fkey"
            columns: ["workstream_id"]
            isOneToOne: false
            referencedRelation: "workstreams"
            referencedColumns: ["id"]
          },
        ]
      }
      gauntlet_diagnoses: {
        Row: {
          binding_constraint: string
          created_at: string
          cycle_id: string
          diagnosed_by: string | null
          diagnosis: string
          evidence_refs: Json
          hypothesis: string
          id: string
          organization_id: string
          selected_action: string
        }
        Insert: {
          binding_constraint: string
          created_at?: string
          cycle_id: string
          diagnosed_by?: string | null
          diagnosis: string
          evidence_refs?: Json
          hypothesis: string
          id?: string
          organization_id: string
          selected_action: string
        }
        Update: {
          binding_constraint?: string
          created_at?: string
          cycle_id?: string
          diagnosed_by?: string | null
          diagnosis?: string
          evidence_refs?: Json
          hypothesis?: string
          id?: string
          organization_id?: string
          selected_action?: string
        }
        Relationships: [
          {
            foreignKeyName: "gauntlet_diagnoses_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: true
            referencedRelation: "gauntlet_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gauntlet_diagnoses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gauntlet_failures: {
        Row: {
          classification: string
          corrective_action: string
          created_at: string
          created_by: string | null
          cycle_id: string
          id: string
          organization_id: string
          resolved_at: string | null
          resolved_by: string | null
          retry_decision: string
          review_id: string | null
          root_cause: string
          run_id: string | null
          severity: string
          status: string
          updated_at: string
        }
        Insert: {
          classification?: string
          corrective_action?: string
          created_at?: string
          created_by?: string | null
          cycle_id: string
          id?: string
          organization_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          retry_decision?: string
          review_id?: string | null
          root_cause?: string
          run_id?: string | null
          severity?: string
          status?: string
          updated_at?: string
        }
        Update: {
          classification?: string
          corrective_action?: string
          created_at?: string
          created_by?: string | null
          cycle_id?: string
          id?: string
          organization_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          retry_decision?: string
          review_id?: string | null
          root_cause?: string
          run_id?: string | null
          severity?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gauntlet_failures_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "gauntlet_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gauntlet_failures_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gauntlet_failures_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "gauntlet_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gauntlet_failures_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "workstream_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      gauntlet_impact_assessments: {
        Row: {
          assessed_at: string
          assessed_by: string | null
          baseline: Json
          cycle_id: string
          delta: Json
          direction: string
          evidence_quality: string
          evidence_refs: Json
          guardrails: Json
          hypothesis: string
          id: string
          interpretation: string
          observed: Json
          organization_id: string
          primary_metric: string
          receipt_id: string
          run_id: string
        }
        Insert: {
          assessed_at?: string
          assessed_by?: string | null
          baseline?: Json
          cycle_id: string
          delta?: Json
          direction: string
          evidence_quality?: string
          evidence_refs?: Json
          guardrails?: Json
          hypothesis: string
          id?: string
          interpretation?: string
          observed?: Json
          organization_id: string
          primary_metric: string
          receipt_id: string
          run_id: string
        }
        Update: {
          assessed_at?: string
          assessed_by?: string | null
          baseline?: Json
          cycle_id?: string
          delta?: Json
          direction?: string
          evidence_quality?: string
          evidence_refs?: Json
          guardrails?: Json
          hypothesis?: string
          id?: string
          interpretation?: string
          observed?: Json
          organization_id?: string
          primary_metric?: string
          receipt_id?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gauntlet_impact_assessments_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: true
            referencedRelation: "gauntlet_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gauntlet_impact_assessments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gauntlet_impact_assessments_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "outcome_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gauntlet_impact_assessments_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "workstream_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      gauntlet_observations: {
        Row: {
          created_at: string
          created_by: string | null
          cycle_id: string
          id: string
          observed_at: string
          organization_id: string
          payload: Json
          signal_type: string
          source_uri: string | null
          summary: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          cycle_id: string
          id?: string
          observed_at?: string
          organization_id: string
          payload?: Json
          signal_type: string
          source_uri?: string | null
          summary: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          cycle_id?: string
          id?: string
          observed_at?: string
          organization_id?: string
          payload?: Json
          signal_type?: string
          source_uri?: string | null
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "gauntlet_observations_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "gauntlet_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gauntlet_observations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gauntlet_reviews: {
        Row: {
          authority_incidents: Json
          challenged_assumptions: Json
          created_at: string
          cycle_id: string
          defects: Json
          evidence_gaps: Json
          hard_gate_pass: boolean
          id: string
          independent: boolean
          notes: string
          organization_id: string
          reviewed_by: string | null
          reviewer_kind: string
          reviewer_ref: string
          run_id: string
          verdict: string
        }
        Insert: {
          authority_incidents?: Json
          challenged_assumptions?: Json
          created_at?: string
          cycle_id: string
          defects?: Json
          evidence_gaps?: Json
          hard_gate_pass: boolean
          id?: string
          independent?: boolean
          notes?: string
          organization_id: string
          reviewed_by?: string | null
          reviewer_kind: string
          reviewer_ref?: string
          run_id: string
          verdict: string
        }
        Update: {
          authority_incidents?: Json
          challenged_assumptions?: Json
          created_at?: string
          cycle_id?: string
          defects?: Json
          evidence_gaps?: Json
          hard_gate_pass?: boolean
          id?: string
          independent?: boolean
          notes?: string
          organization_id?: string
          reviewed_by?: string | null
          reviewer_kind?: string
          reviewer_ref?: string
          run_id?: string
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "gauntlet_reviews_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "gauntlet_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gauntlet_reviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gauntlet_reviews_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "workstream_runs"
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
      native_skills: {
        Row: {
          capability_key: string
          created_at: string
          created_by: string
          definition_hash: string
          id: string
          payload: Json
          procedure_hash: string
          skill_key: string
          skill_version: string
          status: string
          updated_at: string
        }
        Insert: {
          capability_key: string
          created_at?: string
          created_by: string
          definition_hash: string
          id?: string
          payload: Json
          procedure_hash: string
          skill_key: string
          skill_version: string
          status: string
          updated_at?: string
        }
        Update: {
          capability_key?: string
          created_at?: string
          created_by?: string
          definition_hash?: string
          id?: string
          payload?: Json
          procedure_hash?: string
          skill_key?: string
          skill_version?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "native_skills_capability_key_fkey"
            columns: ["capability_key"]
            isOneToOne: false
            referencedRelation: "capabilities"
            referencedColumns: ["key"]
          },
        ]
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
      operational_memory_erasures: {
        Row: {
          erased_at: string
          erased_revision_count: number
          id: string
          memory_id_hash: string
          organization_id: string
          reason: string
          requested_by: string
          source_artifact_ref_count: number
        }
        Insert: {
          erased_at?: string
          erased_revision_count: number
          id?: string
          memory_id_hash: string
          organization_id: string
          reason: string
          requested_by: string
          source_artifact_ref_count: number
        }
        Update: {
          erased_at?: string
          erased_revision_count?: number
          id?: string
          memory_id_hash?: string
          organization_id?: string
          reason?: string
          requested_by?: string
          source_artifact_ref_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "operational_memory_erasures_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      operational_memory_records: {
        Row: {
          approver_id: string | null
          canonical_body: string
          claim: string
          conflict_set_id: string | null
          created_at: string
          expired_at: string | null
          expires_at: string | null
          id: string
          invalidated_at: string | null
          invalidation_reason: string | null
          kind: string
          memory_hash: string
          memory_id: string
          memory_payload: Json
          observed_at: string
          organization_id: string
          recorded_at: string
          recorded_by: string
          retention_class: string
          review_after: string | null
          revision: number
          scope_key: string
          scope_kind: string
          sensitivity: string
          source_artifact_refs: Json
          source_assignment_id: string | null
          source_kind: string
          source_run_id: string | null
          status: string
          subject_key: string
          supersedes_hash: string | null
          value: Json
        }
        Insert: {
          approver_id?: string | null
          canonical_body: string
          claim: string
          conflict_set_id?: string | null
          created_at?: string
          expired_at?: string | null
          expires_at?: string | null
          id?: string
          invalidated_at?: string | null
          invalidation_reason?: string | null
          kind: string
          memory_hash: string
          memory_id: string
          memory_payload: Json
          observed_at: string
          organization_id: string
          recorded_at: string
          recorded_by: string
          retention_class: string
          review_after?: string | null
          revision: number
          scope_key: string
          scope_kind: string
          sensitivity: string
          source_artifact_refs: Json
          source_assignment_id?: string | null
          source_kind: string
          source_run_id?: string | null
          status: string
          subject_key: string
          supersedes_hash?: string | null
          value: Json
        }
        Update: {
          approver_id?: string | null
          canonical_body?: string
          claim?: string
          conflict_set_id?: string | null
          created_at?: string
          expired_at?: string | null
          expires_at?: string | null
          id?: string
          invalidated_at?: string | null
          invalidation_reason?: string | null
          kind?: string
          memory_hash?: string
          memory_id?: string
          memory_payload?: Json
          observed_at?: string
          organization_id?: string
          recorded_at?: string
          recorded_by?: string
          retention_class?: string
          review_after?: string | null
          revision?: number
          scope_key?: string
          scope_kind?: string
          sensitivity?: string
          source_artifact_refs?: Json
          source_assignment_id?: string | null
          source_kind?: string
          source_run_id?: string | null
          status?: string
          subject_key?: string
          supersedes_hash?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "operational_memory_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
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
      outcome_receipts: {
        Row: {
          actions_taken: Json
          created_at: string
          definition_of_done_met: boolean
          exceptions: Json
          id: string
          organization_id: string
          qa_score: number | null
          run_id: string
          summary: string
          unresolved_decisions: Json
          verification_notes: string
          verification_status: string
          verified_at: string
          verified_by: string | null
        }
        Insert: {
          actions_taken?: Json
          created_at?: string
          definition_of_done_met: boolean
          exceptions?: Json
          id?: string
          organization_id: string
          qa_score?: number | null
          run_id: string
          summary: string
          unresolved_decisions?: Json
          verification_notes?: string
          verification_status: string
          verified_at?: string
          verified_by?: string | null
        }
        Update: {
          actions_taken?: Json
          created_at?: string
          definition_of_done_met?: boolean
          exceptions?: Json
          id?: string
          organization_id?: string
          qa_score?: number | null
          run_id?: string
          summary?: string
          unresolved_decisions?: Json
          verification_notes?: string
          verification_status?: string
          verified_at?: string
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outcome_receipts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcome_receipts_run_organization_fkey"
            columns: ["run_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "workstream_runs"
            referencedColumns: ["id", "organization_id"]
          },
        ]
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
      run_executor_assignments: {
        Row: {
          ai_cost_micros: number
          authority_snapshot: Json
          completed_at: string | null
          created_at: string
          created_by: string | null
          executor_profile_id: string
          human_minutes: number
          id: string
          input_artifact_id: string | null
          metadata: Json
          organization_id: string
          output_artifact_id: string | null
          phase: string
          run_id: string
          started_at: string | null
          status: string
          tool_cost_micros: number
          updated_at: string
        }
        Insert: {
          ai_cost_micros?: number
          authority_snapshot?: Json
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          executor_profile_id: string
          human_minutes?: number
          id?: string
          input_artifact_id?: string | null
          metadata?: Json
          organization_id: string
          output_artifact_id?: string | null
          phase: string
          run_id: string
          started_at?: string | null
          status?: string
          tool_cost_micros?: number
          updated_at?: string
        }
        Update: {
          ai_cost_micros?: number
          authority_snapshot?: Json
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          executor_profile_id?: string
          human_minutes?: number
          id?: string
          input_artifact_id?: string | null
          metadata?: Json
          organization_id?: string
          output_artifact_id?: string | null
          phase?: string
          run_id?: string
          started_at?: string | null
          status?: string
          tool_cost_micros?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "run_executor_assignments_executor_profile_id_fkey"
            columns: ["executor_profile_id"]
            isOneToOne: false
            referencedRelation: "executor_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_executor_assignments_input_artifact_id_fkey"
            columns: ["input_artifact_id"]
            isOneToOne: false
            referencedRelation: "evidence_artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_executor_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_executor_assignments_output_artifact_id_fkey"
            columns: ["output_artifact_id"]
            isOneToOne: false
            referencedRelation: "evidence_artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_executor_assignments_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "workstream_runs"
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
      workstream_autonomy_profiles: {
        Row: {
          created_at: string
          current_level: number
          id: string
          max_level: number
          organization_id: string
          policy: Json
          policy_version: number
          state: string
          updated_at: string
          updated_by: string | null
          workstream_id: string
        }
        Insert: {
          created_at?: string
          current_level?: number
          id?: string
          max_level?: number
          organization_id: string
          policy?: Json
          policy_version?: number
          state?: string
          updated_at?: string
          updated_by?: string | null
          workstream_id: string
        }
        Update: {
          created_at?: string
          current_level?: number
          id?: string
          max_level?: number
          organization_id?: string
          policy?: Json
          policy_version?: number
          state?: string
          updated_at?: string
          updated_by?: string | null
          workstream_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workstream_autonomy_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workstream_autonomy_profiles_workstream_id_fkey"
            columns: ["workstream_id"]
            isOneToOne: false
            referencedRelation: "workstreams"
            referencedColumns: ["id"]
          },
        ]
      }
      workstream_runs: {
        Row: {
          ai_cost_micros: number
          attempt_number: number
          completed_at: string | null
          created_at: string
          delegation_spec_id: string
          executor_summary: Json
          gauntlet_cycle_id: string | null
          human_minutes: number
          id: string
          initiated_by: string | null
          notes: string
          organization_id: string
          owner_minutes: number
          request_id: string | null
          retry_of_run_id: string | null
          started_at: string | null
          status: string
          tool_cost_micros: number
          updated_at: string
          workstream_id: string
        }
        Insert: {
          ai_cost_micros?: number
          attempt_number?: number
          completed_at?: string | null
          created_at?: string
          delegation_spec_id: string
          executor_summary?: Json
          gauntlet_cycle_id?: string | null
          human_minutes?: number
          id?: string
          initiated_by?: string | null
          notes?: string
          organization_id: string
          owner_minutes?: number
          request_id?: string | null
          retry_of_run_id?: string | null
          started_at?: string | null
          status?: string
          tool_cost_micros?: number
          updated_at?: string
          workstream_id: string
        }
        Update: {
          ai_cost_micros?: number
          attempt_number?: number
          completed_at?: string | null
          created_at?: string
          delegation_spec_id?: string
          executor_summary?: Json
          gauntlet_cycle_id?: string | null
          human_minutes?: number
          id?: string
          initiated_by?: string | null
          notes?: string
          organization_id?: string
          owner_minutes?: number
          request_id?: string | null
          retry_of_run_id?: string | null
          started_at?: string | null
          status?: string
          tool_cost_micros?: number
          updated_at?: string
          workstream_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workstream_runs_gauntlet_cycle_id_fkey"
            columns: ["gauntlet_cycle_id"]
            isOneToOne: false
            referencedRelation: "gauntlet_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workstream_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workstream_runs_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workstream_runs_retry_of_run_id_fkey"
            columns: ["retry_of_run_id"]
            isOneToOne: false
            referencedRelation: "workstream_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workstream_runs_spec_organization_fkey"
            columns: ["delegation_spec_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "delegation_specs"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "workstream_runs_workstream_organization_fkey"
            columns: ["workstream_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "workstreams"
            referencedColumns: ["id", "organization_id"]
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
      cancel_execution_plan: {
        Args: { p_actor_id: string; p_plan_id: string }
        Returns: undefined
      }
      claim_execution_step: {
        Args: {
          p_capability_key: string
          p_lease_seconds?: number
          p_lease_token_hash: string
          p_worker_id: string
        }
        Returns: {
          action_class: string
          attempt_id: string
          attempt_number: number
          capability_key: string
          executor_context: Json
          lease_expires_at: string
          plan_id: string
          run_id: string
          step_id: string
          step_key: string
        }[]
      }
      claim_execution_step_with_memory: {
        Args: {
          p_capability_key: string
          p_lease_seconds?: number
          p_lease_token_hash: string
          p_memory_assignment_id: string
          p_memory_binding_hash: string
          p_memory_context_hash: string
          p_memory_execution_context_hash: string
          p_memory_read_receipt_hash: string
          p_memory_run_id: string
          p_memory_selected_refs: Json
          p_worker_id: string
        }
        Returns: {
          action_class: string
          attempt_id: string
          attempt_number: number
          capability_key: string
          executor_context: Json
          lease_expires_at: string
          memory_assignment_id: string
          memory_binding_hash: string
          memory_context_hash: string
          memory_execution_context_hash: string
          memory_read_receipt_hash: string
          memory_run_id: string
          memory_selected_ids: Json
          memory_selected_refs: Json
          plan_id: string
          run_id: string
          step_id: string
          step_key: string
        }[]
      }
      complete_execution_attempt: {
        Args: {
          p_ai_cost_micros?: number
          p_attempt_id: string
          p_human_minutes?: number
          p_lease_token_hash: string
          p_metadata?: Json
          p_output_artifact_ids?: Json
          p_tool_cost_micros?: number
          p_worker_id: string
        }
        Returns: string
      }
      create_execution_plan: {
        Args: {
          p_authority_class: string
          p_created_at: string
          p_created_by: string
          p_data_policy_snapshot: Json
          p_delegation_spec_id: string
          p_delegation_spec_version: number
          p_objective_snapshot: string
          p_organization_id: string
          p_plan_hash: string
          p_plan_id: string
          p_plan_version: number
          p_run_id: string
          p_steps: Json
        }
        Returns: string
      }
      decide_execution_approval: {
        Args: {
          p_approval_id: string
          p_decided_by: string
          p_decision: string
          p_decision_note?: string
        }
        Returns: string
      }
      erase_operational_memory: {
        Args: {
          p_memory_id: string
          p_organization_id: string
          p_reason: string
          p_requested_by: string
        }
        Returns: {
          erased_revision_count: number
          erasure_id: string
        }[]
      }
      fail_execution_attempt: {
        Args: {
          p_ai_cost_micros?: number
          p_allow_expired?: boolean
          p_attempt_id: string
          p_failure_class: string
          p_failure_code: string
          p_failure_summary: string
          p_human_minutes?: number
          p_lease_token_hash: string
          p_metadata?: Json
          p_tool_cost_micros?: number
          p_worker_id: string
        }
        Returns: string
      }
      freeze_execution_plan: {
        Args: { p_actor_id: string; p_plan_id: string }
        Returns: undefined
      }
      heartbeat_execution_attempt: {
        Args: {
          p_attempt_id: string
          p_lease_seconds?: number
          p_lease_token_hash: string
          p_worker_id: string
        }
        Returns: string
      }
      is_ops_manager: { Args: never; Returns: boolean }
      is_org_admin: { Args: { target: string }; Returns: boolean }
      is_platform_staff: { Args: never; Returns: boolean }
      my_org_ids: { Args: never; Returns: string[] }
      persist_operational_memory: {
        Args: { p_canonical_body: string; p_memory: Json }
        Returns: {
          memory_hash: string
          memory_id: string
          organization_id: string
          record_id: string
          revision: number
        }[]
      }
      platform_role: { Args: never; Returns: string }
      read_operational_memories: {
        Args: { p_limit?: number; p_organization_id: string }
        Returns: {
          memory_payload: Json
        }[]
      }
      reap_execution_leases: { Args: { p_limit?: number }; Returns: number }
      record_work_cell_ledger_observations: {
        Args: { p_observations: Json; p_run_id: string }
        Returns: {
          artifact_id: string
          assignment_id: string
        }[]
      }
      record_work_cell_phase_artifact: {
        Args: {
          p_ai_cost_micros: number
          p_assignment_metadata: Json
          p_assignment_status: string
          p_authority_snapshot: Json
          p_content_hash: string
          p_executor_profile_id: string
          p_human_minutes: number
          p_input_artifact_id: string
          p_kind: string
          p_payload: Json
          p_phase: string
          p_run_id: string
          p_source_uri: string
          p_summary: string
          p_tool_cost_micros: number
        }
        Returns: {
          artifact_id: string
          assignment_id: string
        }[]
      }
      refresh_execution_plan_queue: {
        Args: { p_plan_id: string }
        Returns: undefined
      }
      run_has_work_cell: { Args: { p_run_id: string }; Returns: boolean }
      validate_economic_envelope_shape: {
        Args: { p_envelope: Json }
        Returns: undefined
      }
      validate_gauntlet_autonomy_policy: {
        Args: { policy_value: Json }
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
