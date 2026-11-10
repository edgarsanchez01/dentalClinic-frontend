import { apiFetch } from './http';

export interface MedicalOnboarding {
  requirement: 'REQUIRED' | 'EXEMPT_EXISTING';
  progress: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
  pending: boolean;
}
export interface IntakeStatus extends MedicalOnboarding { version: number }
export type Answer = 'YES' | 'NO' | 'UNKNOWN' | 'DISCUSS_IN_CONSULTATION';
export interface Question { answer: Answer; details?: string }
export interface IntakePersonal {
  firstName: string; lastName: string; birthDate?: string; phone?: string; canProvidePhone?: boolean;
  emergencyContactName?: string; emergencyContactRelationship?: string; emergencyContactPhone?: string;
  responsibleAdultName?: string; responsibleAdultRelationship?: 'MOTHER' | 'FATHER' | 'LEGAL_GUARDIAN'; responsibleAdultPhone?: string;
}
export type Medical = Partial<Record<'allergies' | 'medications' | 'medicalConditions' | 'surgeriesOrHospitalizations' | 'anesthesiaReactions' | 'bleedingOrAnticoagulants', Question>>;
export type Dental = Partial<Record<'previousTreatments' | 'orthodonticsOrAppliances' | 'currentDiscomfort' | 'gumBleedingOrSensitivity', Question>> & { consultationReason?: string };
export interface IntakeDefinition {
  questionnaireVersion: string; answerOptions: Answer[]; noticeVersion: string; noticeText: string; noticeHash: string;
  declarationVersion: string; declarationText: string; legalReviewPending: boolean; dentalReviewPending: boolean;
}
export interface IntakePrivacy {
  id: number; noticeVersion: string; noticeText: string; noticeHash: string; acknowledged: boolean;
  processingAccepted: boolean; actorUserId: number; acceptedAt: string;
}
export interface IntakeDraft {
  status: IntakeStatus; personal: IntakePersonal; medical?: Medical; dental?: Dental; privacy?: IntakePrivacy; questionnaireVersion: string;
}
export interface IntakeConfirmation {
  expectedVersion: number; operationId: string; questionnaireVersion: string; declarationVersion: string;
  declarationConfirmed: true; confirmedBy: 'PATIENT' | 'RESPONSIBLE_ADULT';
}
export interface IntakeDeclaration {
  id: number; revision: number; clinicalRecordId: number; actorUserId: number; questionnaireVersion: string;
  personal: IntakePersonal; medical: Medical; dental: Dental; privacy: IntakePrivacy; declarationVersion: string;
  declarationText: string; declarationConfirmed: true; confirmedBy: 'PATIENT' | 'RESPONSIBLE_ADULT'; confirmedAt: string;
}
export interface ConfirmationResult { version: number; medicalOnboarding: MedicalOnboarding; declaration: IntakeDeclaration }
/** Spring Page fields used by this feature (page index is `number`, not `page`). */
export interface IntakeDeclarationPage { content: IntakeDeclaration[]; number: number; size: number; totalElements: number; totalPages: number }
const base = '/api/patients/me/medical-intake';
export const medicalIntakeApi = {
  definition: () => apiFetch<IntakeDefinition>(`${base}/definition`),
  status: () => apiFetch<IntakeStatus>(`${base}/status`),
  draft: () => apiFetch<IntakeDraft>(`${base}/draft`),
  personal: (expectedVersion: number, personal: IntakePersonal) => apiFetch<IntakeDraft>(`${base}/draft/personal`, { method: 'PUT', body: { expectedVersion, personal } }),
  medical: (expectedVersion: number, medical: Medical) => apiFetch<IntakeDraft>(`${base}/draft/medical`, { method: 'PUT', body: { expectedVersion, medical } }),
  dental: (expectedVersion: number, dental: Dental) => apiFetch<IntakeDraft>(`${base}/draft/dental`, { method: 'PUT', body: { expectedVersion, dental } }),
  privacy: (expectedVersion: number, noticeVersion: string) => apiFetch<IntakeDraft>(`${base}/privacy-acknowledgements`, { method: 'POST', body: { expectedVersion, noticeVersion, acknowledged: true, processingAccepted: true } }),
  confirm: (body: IntakeConfirmation, revision: boolean) => apiFetch<ConfirmationResult>(`${base}/${revision ? 'revisions' : 'complete'}`, { method: 'POST', body }),
  latest: async () => (await apiFetch<IntakeDeclaration | undefined>(`${base}/declarations/latest`)) ?? null,
  declarations: async (page = 0, patientId?: number) => {
    const result = await apiFetch<IntakeDeclarationPage>(`${patientId ? `/api/patients/${patientId}/clinical/medical-intake` : base}/declarations?page=${page}&size=10`);
    if (!result || !Array.isArray(result.content) || !Number.isInteger(result.totalPages)) throw new Error('No se pudieron consultar las declaraciones.');
    return result;
  },
};
