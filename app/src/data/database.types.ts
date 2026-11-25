export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      equipment: {
        Row: {
          data: NonNullable<Json>;
          id: string;
          owner_id: string;
        };
        ComputedFields: never;
        Insert: {
          data: NonNullable<Json>;
          id: string;
          owner_id: string;
        };
        Update: {
          data?: NonNullable<Json>;
          id?: string;
          owner_id?: string;
        };
        Relationships: [];
      };
      equipment_assignments: {
        Row: {
          club_label: string;
          equipment_id: string;
          owner_id: string;
          shot_id: string;
        };
        ComputedFields: never;
        Insert: {
          club_label: string;
          equipment_id: string;
          owner_id: string;
          shot_id: string;
        };
        Update: {
          club_label?: string;
          equipment_id?: string;
          owner_id?: string;
          shot_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'equipment_assignments_owner_id_equipment_id_fkey';
            columns: ['owner_id', 'equipment_id'];
            isOneToOne: false;
            referencedRelation: 'equipment';
            referencedColumns: ['owner_id', 'id'];
          },
          {
            foreignKeyName: 'equipment_assignments_owner_id_shot_id_fkey';
            columns: ['owner_id', 'shot_id'];
            isOneToOne: true;
            referencedRelation: 'shots';
            referencedColumns: ['owner_id', 'id'];
          },
        ];
      };
      imports: {
        Row: {
          content_hash: string;
          file_hash: string;
          id: string;
          original: string;
          owner_id: string;
          parser_version: string;
          session_id: string;
        };
        ComputedFields: never;
        Insert: {
          content_hash: string;
          file_hash: string;
          id: string;
          original: string;
          owner_id: string;
          parser_version: string;
          session_id: string;
        };
        Update: {
          content_hash?: string;
          file_hash?: string;
          id?: string;
          original?: string;
          owner_id?: string;
          parser_version?: string;
          session_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'imports_owner_id_session_id_fkey';
            columns: ['owner_id', 'session_id'];
            isOneToOne: true;
            referencedRelation: 'sessions';
            referencedColumns: ['owner_id', 'id'];
          },
        ];
      };
      review_events: {
        Row: {
          after_state: NonNullable<Json>;
          before_state: NonNullable<Json>;
          created_at: string;
          id: string;
          owner_id: string;
          shot_id: string;
          undone: boolean;
        };
        ComputedFields: never;
        Insert: {
          after_state: NonNullable<Json>;
          before_state: NonNullable<Json>;
          created_at?: string;
          id: string;
          owner_id: string;
          shot_id: string;
          undone?: boolean;
        };
        Update: {
          after_state?: NonNullable<Json>;
          before_state?: NonNullable<Json>;
          created_at?: string;
          id?: string;
          owner_id?: string;
          shot_id?: string;
          undone?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'review_events_owner_id_shot_id_fkey';
            columns: ['owner_id', 'shot_id'];
            isOneToOne: false;
            referencedRelation: 'shots';
            referencedColumns: ['owner_id', 'id'];
          },
        ];
      };
      reviews: {
        Row: {
          owner_id: string;
          revision: number;
          shot_id: string;
          state: NonNullable<Json>;
        };
        ComputedFields: never;
        Insert: {
          owner_id: string;
          revision: number;
          shot_id: string;
          state: NonNullable<Json>;
        };
        Update: {
          owner_id?: string;
          revision?: number;
          shot_id?: string;
          state?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: 'reviews_owner_id_shot_id_fkey';
            columns: ['owner_id', 'shot_id'];
            isOneToOne: false;
            referencedRelation: 'shots';
            referencedColumns: ['owner_id', 'id'];
          },
        ];
      };
      sessions: {
        Row: {
          data: NonNullable<Json>;
          id: string;
          owner_id: string;
        };
        ComputedFields: never;
        Insert: {
          data: NonNullable<Json>;
          id: string;
          owner_id: string;
        };
        Update: {
          data?: NonNullable<Json>;
          id?: string;
          owner_id?: string;
        };
        Relationships: [];
      };
      shots: {
        Row: {
          id: string;
          owner_id: string;
          payload: NonNullable<Json>;
          session_id: string;
        };
        ComputedFields: never;
        Insert: {
          id: string;
          owner_id: string;
          payload: NonNullable<Json>;
          session_id: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          payload?: NonNullable<Json>;
          session_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'shots_owner_id_session_id_fkey';
            columns: ['owner_id', 'session_id'];
            isOneToOne: false;
            referencedRelation: 'sessions';
            referencedColumns: ['owner_id', 'id'];
          },
        ];
      };
      user_reference_values: {
        Row: {
          data: NonNullable<Json>;
          id: string;
          owner_id: string;
        };
        ComputedFields: never;
        Insert: {
          data: NonNullable<Json>;
          id: string;
          owner_id: string;
        };
        Update: {
          data?: NonNullable<Json>;
          id?: string;
          owner_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      apply_reviews: { Args: { p_changes: Json }; Returns: undefined };
      assign_equipment: { Args: { p_preview: Json }; Returns: undefined };
      commit_import: { Args: { p_input: Json }; Returns: Json };
      dataset_page: {
        Args: { p_limit: number; p_offset: number; p_table: string };
        Returns: Json;
      };
      dataset_version: { Args: Record<PropertyKey, never>; Returns: number };
      delete_reference_value: {
        Args: { p_id: string; p_revision: number };
        Returns: undefined;
      };
      restore_backup: { Args: { p_dataset: Json }; Returns: undefined };
      save_equipment: { Args: { p_equipment: Json }; Returns: Json };
      save_reference_value: { Args: { p_value: Json }; Returns: Json };
      undo_reviews: { Args: { p_shots: Json }; Returns: undefined };
      update_session: { Args: { p_session: Json }; Returns: undefined };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  'public'
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
