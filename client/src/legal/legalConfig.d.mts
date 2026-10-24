export type LegalConfigKey =
  | 'LEGAL_ENTITY_NAME'
  | 'SUPPORT_EMAIL'
  | 'MINIMUM_AGE'
  | 'POLICY_EFFECTIVE_DATE'
  | 'POSTHOG_LOCATION';

export type LegalConfig = Record<LegalConfigKey, string>;

export declare const OWNER_PLACEHOLDER_PREFIX: string;
export declare const LEGAL_CONFIG: LegalConfig;
export declare const LEGAL_PLACEHOLDER_LABELS: Record<LegalConfigKey, string>;
export declare function isOwnerPlaceholder(value: unknown): boolean;
export declare function legalPlaceholdersOutstanding(config?: LegalConfig): LegalConfigKey[];
export declare function legalText(key: LegalConfigKey, config?: LegalConfig): string;
export declare function supportEmailAddress(config?: LegalConfig): string | null;
export declare function posthogDerivesLocation(config?: LegalConfig): boolean;
