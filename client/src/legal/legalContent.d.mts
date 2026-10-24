/** A string is a paragraph; an array of strings is a bulleted list. */
export type LegalBlock = string | string[];

export interface LegalSection {
  id: string;
  heading: string;
  blocks: LegalBlock[];
}

export type LegalDocumentId = 'privacy' | 'terms' | 'support';

export interface LegalDocument {
  id: LegalDocumentId;
  eyebrow: string;
  title: string;
  /** "Effective …" line, or null for pages that are not policies. */
  effective: string | null;
  standfirst: string;
  sections: LegalSection[];
}

export declare const PRIVACY_POLICY: LegalDocument;
export declare const TERMS_OF_USE: LegalDocument;
export declare const SUPPORT_PAGE: LegalDocument;
export declare const LEGAL_DOCUMENTS: Record<LegalDocumentId, LegalDocument>;
