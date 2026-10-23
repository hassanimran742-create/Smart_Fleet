/** The part of a form a field error comes from (`useZodForm`). */
interface FieldErrors {
  errorFor: (name: string) => string | undefined;
}

/**
 * A field's error in the website's own words (UX_ADMIN §1.8: "Type the business name." instead of the
 * shared "Fill this in."): `required` while the field is empty, else `otherwise` when given (a website
 * wording of a format rule), else the form's own message, which includes the server's refusals.
 */
export function requiredOr(
  form: FieldErrors,
  name: string,
  value: unknown,
  required: string,
  otherwise?: string,
): string | undefined {
  const error = form.errorFor(name);
  if (!error) return undefined;
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return required;
  return otherwise ?? error;
}
