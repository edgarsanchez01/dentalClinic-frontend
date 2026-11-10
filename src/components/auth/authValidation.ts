export type AuthErrors = Record<string, string>;

export const PASSWORD_HINT = 'No se exige una combinación de letras, números o símbolos. Límite técnico: 72 bytes UTF-8; las tildes y los emojis ocupan más de un byte.';

/** Espejo de @NotBlank y PasswordPolicy; no crea una política de composición. */
export function passwordError(value: string): string | undefined {
  if (!value.trim()) return 'Escribe una contraseña.';
  if (new TextEncoder().encode(value).length > 72) return 'La contraseña supera los 72 bytes UTF-8. Acórtala; las tildes y los emojis ocupan más de un byte.';
  return undefined;
}

export function validateAuthForm(form: HTMLFormElement): AuthErrors {
  const errors: AuthErrors = {};
  for (const input of Array.from(form.querySelectorAll('input'))) {
    const label = form.querySelector(`label[for="${input.id}"]`)?.textContent ?? 'Este campo';
    if (input.required && !input.value.trim()) errors[input.id] = `${label}: completa este campo.`;
    else if (input.type === 'email' && input.validity.typeMismatch) errors[input.id] = 'Escribe un correo con un formato válido.';
    else if (input.maxLength > 0 && input.value.length > input.maxLength) errors[input.id] = `${label}: usa como máximo ${input.maxLength} caracteres.`;
  }
  return errors;
}
