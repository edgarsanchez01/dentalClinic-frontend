import type { IntakeDeclaration, IntakeDefinition, IntakeDraft, IntakePersonal } from '../api/medicalIntake';

/** Synthetic only; never loaded by production code. */
export const intakeDefinition: IntakeDefinition = {
  questionnaireVersion: 'dental-intake-demo-v1', answerOptions: ['YES', 'NO', 'UNKNOWN', 'DISCUSS_IN_CONSULTATION'],
  noticeVersion: 'intake-privacy-demo-v1', noticeText: 'Aviso demostrativo de prueba. Guardaremos tus respuestas para preparar la atención.', noticeHash: 'synthetic-hash',
  declarationVersion: 'intake-declaration-demo-v1', declarationText: 'Declaración demostrativa de prueba: he revisado los datos que declaro.', legalReviewPending: true, dentalReviewPending: true,
};
export const intakePersonal: IntakePersonal = {
  firstName: 'Paciente', lastName: 'Sintético', birthDate: '1990-04-10', canProvidePhone: true, phone: '5550101',
  emergencyContactName: 'Contacto sintético', emergencyContactRelationship: 'Amistad', emergencyContactPhone: '5550102',
};
export const exemptOnboarding = { requirement: 'EXEMPT_EXISTING' as const, progress: 'NOT_STARTED' as const, pending: false };
export function intakeDraft(complete = false): IntakeDraft {
  return { questionnaireVersion: intakeDefinition.questionnaireVersion,
    status: { requirement: 'REQUIRED', progress: complete ? 'COMPLETED' : 'NOT_STARTED', pending: !complete, version: 0 },
    personal: { ...intakePersonal },
  };
}
export function intakeDeclaration(draft: IntakeDraft, revision = 1): IntakeDeclaration {
  return { id: revision, revision, clinicalRecordId: 1, actorUserId: 9, questionnaireVersion: intakeDefinition.questionnaireVersion,
    personal: draft.personal, medical: draft.medical ?? {}, dental: draft.dental ?? {}, privacy: draft.privacy!,
    declarationVersion: intakeDefinition.declarationVersion, declarationText: intakeDefinition.declarationText, declarationConfirmed: true,
    confirmedBy: draft.personal.responsibleAdultName ? 'RESPONSIBLE_ADULT' : 'PATIENT', confirmedAt: '2026-10-17T10:00:00Z',
  };
}
